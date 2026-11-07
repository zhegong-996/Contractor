// 本机代码交付台：只监听 127.0.0.1，同时提供
//   git://127.0.0.1:<gitPort>/<repo>.git  （clone / pull / push）
//   http://127.0.0.1:<port>/             （中文交付台、审批、通知记录）
//
// 国内环境不需要 GitHub 账号 / token / 海外网络。没有实际连接的服务
// 不提供可点入口，只在说明文字里列出，避免空壳按钮。
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, runtime } from '../src/config.ts';
import { LocalGitDelivery, type LocalDeliveryRecord } from '../src/local-git.ts';
import { command } from '../src/commands.ts';

const config = loadConfig();
const service = new LocalGitDelivery(config);
const port = config.delivery.port;
const reposDir = runtime('git', 'repos');
mkdirSync(reposDir, { recursive: true });
await service.ensureRepo();

const daemon = spawn('git', ['daemon', '--reuseaddr', '--export-all',
  `--base-path=${reposDir}`, '--enable=receive-pack', '--listen=127.0.0.1',
  `--port=${config.delivery.gitPort}`, reposDir], { stdio: 'ignore' });
daemon.on('error', error => console.error('git daemon 启动失败：', String(error)));
process.on('SIGTERM', () => { daemon.kill('SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { daemon.kill('SIGTERM'); process.exit(0); });

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const label = (value: string) => ({ open: '待审批', approved: '已同意', rejected: '已打回', merged: '已合并' }[value] ?? value);
const ciLabel = (value: string) => ({ pending: '校验中', passed: '通过', failed: '未通过' }[value] ?? value);

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · 本机代码交付台</title><style>
:root{color-scheme:light}*{box-sizing:border-box}
body{margin:0;padding:26px 16px 48px;background:#f5f7fa;color:#1f2329;font:14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1040px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}
.sub{color:#646a73;font-size:13px;margin:0 0 18px}a{color:#2b6cb0}
.card{background:#fff;border:1px solid #e5e6eb;border-radius:12px;padding:20px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}
.kv{background:#f7f8fa;border-radius:8px;padding:12px 14px;font-size:13px}.kv b{display:block;font-size:12px;color:#646a73;font-weight:500}
code{background:#f2f3f5;padding:3px 6px;border-radius:4px;font-size:12px;word-break:break-all}
pre{background:#1f2329;color:#f7f8fa;padding:12px 14px;border-radius:8px;overflow-x:auto;font-size:12px;margin:8px 0}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e5e6eb;vertical-align:top}th{background:#f7f8fa;font-weight:600}
.scroll{overflow-x:auto}.badge{display:inline-block;padding:1px 8px;border-radius:5px;font-size:12px;background:#eef4ff;color:#2b5cb0}
.badge.ok{background:#e8f5ee;color:#0f7b4f}.badge.bad{background:#fdecee;color:#c9353f}.badge.warn{background:#fff4e0;color:#b7791f}
ul{margin:8px 0;padding-left:20px}li{margin:5px 0}
button{min-height:44px;padding:0 16px;border:1px solid #c9cdd4;border-radius:8px;background:#fff;color:#1f2329;font-size:13px;cursor:pointer;margin-right:8px}
button.primary{background:#2b6cb0;color:#fff;border-color:#2b6cb0}button.danger{color:#c9353f}
input[type=text]{min-height:44px;padding:0 10px;border:1px solid #c9cdd4;border-radius:8px;font-size:13px;min-width:180px}
.notice{background:#fff8e6;border-left:3px solid #d99a1c;border-radius:6px;padding:14px 16px;font-size:13px;margin-top:16px}
.meta{color:#646a73;font-size:12px}.status{font-size:13px;margin-top:10px}
@media(max-width:680px){body{padding:18px 12px 36px}.card{padding:16px}h1{font-size:20px}}
</style></head><body><div class="wrap">
<h1>本机代码交付台</h1><p class="sub">只监听 127.0.0.1 的本机 Git 服务与合并审批 · 不依赖 GitHub 账号、token 或海外网络</p>
${body}
<div class="notice"><b>边界</b>：这里的「审批」是代码合并审批，<b>不等于业务验收</b>；业务验收仍由原发起人在原会话「确认验收」。
本页不连接企业微信、腾讯文档、Gitee / CNB / 工蜂等外部服务，未接通的服务不提供入口。</div>
</div></body></html>`;
}

function deliveryRows(records: LocalDeliveryRecord[]): string {
  return records.map(r => `<tr>
    <td><a href="/delivery/${r.id}">#${r.id}</a></td><td>${esc(r.identifier)}</td>
    <td><code>${esc(r.branch)}</code></td><td><code>${esc(r.headSha.slice(0, 10))}</code></td>
    <td><span class="badge ${r.ci === 'passed' ? 'ok' : r.ci === 'failed' ? 'bad' : 'warn'}">${ciLabel(r.ci)}</span></td>
    <td><span class="badge ${r.status === 'approved' || r.status === 'merged' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'}">${label(r.status)}</span></td>
    <td>${r.notifications.length}</td><td>${esc(r.createdAt)}</td></tr>`).join('');
}

async function renderHome(): Promise<string> {
  const info = await service.repoInfo();
  const records = service.list();
  const clone = `git clone ${info.cloneUrl}`;
  const push = `git push ${info.cloneUrl} HEAD:refs/heads/你的分支`;
  return page('总览', `
  <div class="grid">
    <div class="kv"><b>本机仓库</b>${esc(info.repoName)}.git</div>
    <div class="kv"><b>main 基线</b><code>${esc(info.mainSha.slice(0, 12))}</code></div>
    <div class="kv"><b>分支数</b>${info.branches.length}</div>
    <div class="kv"><b>交付请求</b>${info.deliveries} 条</div>
  </div>
  <div class="card"><h2>拉取与推送代码</h2>
    <p class="sub">git daemon 监听 <code>127.0.0.1:${config.delivery.gitPort}</code>，支持 clone / pull / push，仅限本机。</p>
    <pre>${esc(clone)}
${esc(push)}</pre>
    <p class="meta">已有分支：${info.branches.map(b => `<code>${esc(b)}</code>`).join(' ') || '仅 main'}</p>
    <details><summary>最近提交</summary><pre>${esc(info.log || '（暂无）')}</pre></details>
  </div>
  <div class="card"><h2>本机交付请求与审批</h2>
  <div class="scroll"><table><thead><tr><th>编号</th><th>任务</th><th>分支</th><th>提交</th><th>本机 CI</th><th>合并审批</th><th>通知</th><th>创建时间</th></tr></thead>
  <tbody>${deliveryRows(records) || '<tr><td colspan="8">还没有交付请求。可通过「开始开发并交付」或 npm run delivery:demo 生成一条真实记录。</td></tr>'}</tbody></table></div></div>
  <div class="card"><h2>通知记录</h2>
    ${records.length ? `<ul>${records.flatMap(r => r.notifications.slice(-4).map(n => `<li><a href="/delivery/${r.id}">#${r.id}</a> · ${esc(n.kind)} · ${esc(n.text)} <span class="meta">${esc(n.at)}</span></li>`)).join('')}</ul>`
      : '<p class="meta">暂无通知。提交、本机 CI、审批与预览都会在这里留下记录；业务通知沿用现有飞书通道。</p>'}
  </div>`);
}

function renderDelivery(r: LocalDeliveryRecord): string {
  return page(`交付 #${r.id}`, `
  <div class="grid">
    <div class="kv"><b>任务</b>${esc(r.identifier)}</div>
    <div class="kv"><b>分支</b><code>${esc(r.branch)}</code></div>
    <div class="kv"><b>提交</b><code>${esc(r.headSha.slice(0, 12))}</code></div>
    <div class="kv"><b>本机 CI</b><span class="badge ${r.ci === 'passed' ? 'ok' : r.ci === 'failed' ? 'bad' : 'warn'}">${ciLabel(r.ci)}</span></div>
    <div class="kv"><b>合并审批</b><span class="badge ${r.status === 'approved' || r.status === 'merged' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'}">${label(r.status)}</span></div>
  </div>
  <div class="card"><h2>本机 CI 判定</h2><p>${esc(r.ciNote)}</p>
    <h2>改动文件（${r.changedFiles.length}）</h2><ul>${r.changedFiles.map(f => `<li><code>${esc(f)}</code></li>`).join('') || '<li>无</li>'}</ul>
    <p class="meta"><a href="/preview/${r.id}">查看本机预览版本</a> · 基线 <code>${esc(r.baseSha.slice(0, 12))}</code></p></div>
  <div class="card"><h2>合并审批</h2>
    <p class="sub">审批人由本机填写；这一步只决定是否允许合并代码，不代替业务验收。</p>
    <input type="text" id="actor" placeholder="审批人（例如：组织 owner）" value="organization-owner" />
    <input type="text" id="note" placeholder="审批意见（可选）" />
    <div style="margin-top:12px"><button class="primary" data-decision="approved">同意合并</button>
    <button class="danger" data-decision="rejected">打回</button><button data-decision="merge">登记已合并</button></div>
    <div class="status" id="status" role="status"></div>
    <h2 style="margin-top:20px">审批记录</h2>
    <ul>${r.approvals.map(a => `<li><b>${esc(a.actor)}</b> ${a.decision === 'approved' ? '同意' : '打回'}：${esc(a.note || '无补充说明')} <span class="meta">${esc(a.at)}</span></li>`).join('') || '<li>暂无审批</li>'}</ul>
  </div>
  <div class="card"><h2>通知记录</h2><ul>${r.notifications.map(n => `<li><b>${esc(n.kind)}</b> · ${esc(n.text)} <span class="meta">${esc(n.at)}</span></li>`).join('') || '<li>暂无通知</li>'}</ul></div>
  <script>
  const status=document.getElementById('status');
  for(const button of document.querySelectorAll('button[data-decision]'))button.addEventListener('click',async()=>{
    status.textContent='正在提交…';
    try{const response=await fetch('/api/deliveries/${r.id}/decide',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({decision:button.dataset.decision,actor:document.getElementById('actor').value||'organization-owner',note:document.getElementById('note').value})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||'提交失败');status.textContent='已记录，正在刷新…';location.reload();}
    catch(error){status.textContent=String(error.message||error);}
  });
  </script>`);
}

async function renderPreview(id: number): Promise<string> {
  const r = service.read(id);
  if (!r) return page('预览', '<div class="card">该交付请求不存在。</div>');
  return page(`预览 #${id}`, `<div class="card"><h2>本机预览版本</h2>
    <p>提交 <code>${esc(r.headSha)}</code> · 状态 ${esc(label(r.status))} · 本机 CI ${esc(ciLabel(r.ci))}</p>
    <p class="sub">预览固定到确切提交；合并与发布按配置自动执行，只作用于本机裸仓库与本机预览制品，不发布业务仓库、不触发云端 CI。业务验收仍须由原发起人在原会话「确认验收」。</p>
    ${r.publishedAt ? `<p class="sub">已自动发布 ${esc(r.publishedAt)} · 确切提交 <code>${esc(r.mergeSha ?? r.headSha)}</code></p>` : ''}
    <h2>本次改动</h2><ul>${r.changedFiles.map(f => `<li><code>${esc(f)}</code></li>`).join('') || '<li>无</li>'}</ul>
    <p><a href="/delivery/${id}">← 返回交付详情</a></p></div>`);
}

function json(res: any, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') return json(res, 200, { ok: true, scope: 'loopback-only',
    git: service.cloneUrl, port, gitPort: config.delivery.gitPort, provider: 'local-git' });
  if (url.pathname === '/api/state') {
    return json(res, 200, { repo: await service.repoInfo(), deliveries: service.list() });
  }
  if (req.method === 'POST' && url.pathname === '/api/repos') {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer);
    let name = '';
    try { name = String(JSON.parse(Buffer.concat(chunks).toString('utf8')).name ?? ''); } catch { /* 空 body */ }
    if (!/^[a-z0-9][a-z0-9._-]{1,40}$/.test(name)) return json(res, 400, { error: '仓库名只能使用小写字母、数字、点、下划线与连字符' });
    const target = path.join(reposDir, `${name}.git`);
    if (existsSync(target)) return json(res, 200, { ok: true, existed: true, url: `git://127.0.0.1:${config.delivery.gitPort}/${name}.git` });
    await command('git', ['init', '--bare', target]);
    return json(res, 200, { ok: true, url: `git://127.0.0.1:${config.delivery.gitPort}/${name}.git` });
  }
  const decide = /^\/api\/deliveries\/(\d+)\/decide$/.exec(url.pathname);
  if (req.method === 'POST' && decide) {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer);
    let input: any = {};
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 空 body */ }
    const decision = String(input.decision ?? '');
    if (!['approved', 'rejected', 'merge'].includes(decision)) return json(res, 400, { error: '审批动作只能是 approved / rejected / merge' });
    try {
      const record = await service.decide(Number(decide[1]), decision as any,
        String(input.actor ?? 'organization-owner').slice(0, 60), String(input.note ?? '').slice(0, 300));
      return json(res, 200, { ok: true, id: record.id, status: record.status, notifications: record.notifications.length });
    } catch (error) { return json(res, 400, { error: String((error as Error).message ?? error) }); }
  }
  if (req.method !== 'GET') { res.statusCode = 405; res.end('Method not allowed'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname === '/') return res.end(await renderHome());
  const delivery = /^\/delivery\/(\d+)$/.exec(url.pathname);
  if (delivery) {
    const record = service.read(Number(delivery[1]));
    return res.end(record ? renderDelivery(record) : page('未找到', '<div class="card">该交付请求不存在。</div>'));
  }
  const preview = /^\/preview\/(\d+)$/.exec(url.pathname);
  if (preview) return res.end(await renderPreview(Number(preview[1])));
  res.statusCode = 404; res.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ ok: true, url: `http://127.0.0.1:${port}/`,
    git: service.cloneUrl, bound: '127.0.0.1',
    note: '本机 Git 交付台；未连接的服务不提供入口；业务验收仍由原发起人在原会话确认' }, null, 2));
});
