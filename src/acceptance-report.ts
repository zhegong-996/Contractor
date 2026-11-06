/**
 * 本机验收报告服务（替代 Acceptance 云端报告服务）。
 *
 * lobehub/acceptance 的 CLI 与云端报告服务刻意不启动 —— 业务材料不外发。
 * 这里用本仓库自己的适配层提供同等的「报告可读 / 可归档 / 可回放」能力：
 * - 把 result.json 渲染成中文 HTML 报告，只绑定 127.0.0.1 的本机服务提供；
 * - 报告索引列出所有已归档轮次；
 * - 打回原因沉淀为下次自查标准，落本机 `.runtime/v06/`，不进仓库。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AcceptanceReport } from './acceptance-interop.ts';
import { selfCheckStandards, type AcceptanceRound } from './acceptance-round.ts';

const escape = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface BundleSummary {
  taskId: string;
  entry: string;
  verdict: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  createdAt: string;
  dir: string;
  hasHtml: boolean;
}

export function listBundles(rootDir: string): BundleSummary[] {
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const dir = path.join(rootDir, entry.name);
      const file = path.join(dir, 'result.json');
      if (!existsSync(file)) return null;
      try {
        const report = JSON.parse(readFileSync(file, 'utf8')) as AcceptanceReport;
        return { taskId: entry.name, entry: report.entry,
          verdict: report.summary?.verdict ?? 'unknown', total: report.summary?.total ?? 0,
          passed: report.summary?.passed ?? 0, failed: report.summary?.failed ?? 0,
          blocked: report.summary?.blocked ?? 0, createdAt: report.createdAt,
          dir, hasHtml: existsSync(path.join(dir, 'report.html')) } as BundleSummary;
      } catch { return null; }
    })
    .filter((item): item is BundleSummary => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readBundle(rootDir: string, taskId: string): AcceptanceReport | null {
  const safe = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const file = path.join(rootDir, safe, 'result.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as AcceptanceReport;
}

const statusLabel = (status: string) =>
  ({ pass: '通过', fail: '未通过', blocked: '受阻', partial: '部分通过' } as Record<string, string>)[status] ?? status;

export function renderAcceptanceHtml(report: AcceptanceReport, meta: {
  taskId: string; standards?: string[]; limitations?: string[];
}): string {
  const cases = report.cases ?? [];
  const standards = meta.standards ?? [];
  const limitations = meta.limitations ?? [];
  const rows = cases.map(item => `<tr>
      <td>${escape(item.name)}</td>
      <td class="status-${escape(item.status)}">${escape(statusLabel(item.status))}</td>
      <td>${escape(item.observation)}</td>
      <td>${escape(item.surface)}</td>
      <td>${(item.evidence ?? []).map(e => `<code>${escape(e.path)}</code>`).join('<br>') || '—'}</td>
    </tr>`).join('');
  const planRows = (report.plan ?? []).map(item => `<tr>
      <td>${escape(item.title)}</td><td>${escape(item.method)}</td>
      <td>${escape(item.expected)}</td><td>${escape(item.verifier)}</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>逐项验收报告 · ${escape(meta.taskId)}</title>
<style>
:root{color-scheme:light}
body{margin:0;padding:32px;background:#f7f8fa;color:#1f2329;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1040px;margin:0 auto;background:#fff;border:1px solid #e5e6eb;border-radius:12px;padding:28px}
h1{font-size:22px;margin:0 0 6px}h2{font-size:16px;margin:28px 0 10px}
.meta{color:#646a73;font-size:13px}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}
.card{flex:1;min-width:120px;background:#f7f8fa;border-radius:8px;padding:12px 14px}
.card b{display:block;font-size:22px;line-height:1.2}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e5e6eb;vertical-align:top}
th{background:#f7f8fa;font-weight:600}code{font-size:12px;background:#f2f3f5;padding:2px 5px;border-radius:4px;word-break:break-all}
.status-pass{color:#0f7b4f;font-weight:600}.status-fail{color:#c9353f;font-weight:600}.status-blocked{color:#b7791f;font-weight:600}
.notice{background:#f0f6ff;border-left:3px solid #2b6cb0;padding:12px 14px;border-radius:6px;margin-top:24px}
ul{margin:8px 0;padding-left:20px}
</style></head><body><div class="wrap">
<h1>逐项验收报告</h1>
<p class="meta">任务 ${escape(meta.taskId)} · ${escape(report.entry)} · 生成于 ${escape(report.createdAt)} · 格式遵循 Apache-2.0 开源验收报告契约（本机映射）</p>
<div class="cards">
  <div class="card"><b>${report.summary.total}</b>检查项</div>
  <div class="card"><b class="status-pass">${report.summary.passed}</b>通过</div>
  <div class="card"><b class="status-fail">${report.summary.failed}</b>未通过</div>
  <div class="card"><b class="status-blocked">${report.summary.blocked}</b>受阻</div>
  <div class="card"><b>${escape(statusLabel(report.summary.verdict))}</b>结论</div>
</div>
<h2>开工前锁定的验收清单</h2>
<table><thead><tr><th>检查项</th><th>判定方式</th><th>期望</th><th>执行者</th></tr></thead><tbody>${planRows || '<tr><td colspan="4">无</td></tr>'}</tbody></table>
<h2>逐项判定与证据</h2>
<table><thead><tr><th>检查项</th><th>判定</th><th>观察</th><th>界面</th><th>证据文件</th></tr></thead><tbody>${rows || '<tr><td colspan="5">无</td></tr>'}</tbody></table>
<h2>下次自查标准（由打回原因沉淀）</h2>
${standards.length ? `<ul>${standards.map(s => `<li>${escape(s)}</li>`).join('')}</ul>` : '<p class="meta">本轮没有被打回的检查项，暂无新增自查标准。</p>'}
${limitations.length ? `<h2>判定限制</h2><ul>${limitations.map(s => `<li>${escape(s)}</li>`).join('')}</ul>` : ''}
<div class="notice"><b>边界</b>：本报告由独立评审者产出，只提供证据与逐项判定，<b>不代替原发起人在原会话「确认验收」</b>；未通过的检查项不会被算作通过；本机报告只监听 127.0.0.1，业务正文、密钥与截图不上传云端。</div>
</div></body></html>`;
}

export function writeReportHtml(dir: string, report: AcceptanceReport, meta: {
  taskId: string; standards?: string[]; limitations?: string[];
}): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'report.html');
  writeFileSync(file, renderAcceptanceHtml(report, meta), { mode: 0o600 });
  return file;
}

export interface OverviewService {
  name: string;
  port: number;
  ok: boolean;
  detail: string;
  latencyMs: number | null;
  /** Optional in-page link; only loopback URLs are ever supplied. */
  href?: string;
  linkLabel?: string;
}

export interface OverviewInput {
  generatedAt: string;
  services: OverviewService[];
  acceptance: { mode: string; level: string; reviewerModel: string; visualEndpoint: string; multiUserSso: boolean };
  /** Chinese user commands, kept in sync with src/user-language.ts. */
  help: string[];
  org: {
    draftAvailable: boolean; generatedAt: string; memberCount: number;
    departmentScopeMissing: boolean; applied: boolean | null;
  } | null;
  standardsCount: number;
  bundles: BundleSummary[];
}

/**
 * 本机总览页：把「服务是否真的活着」「验收链当前配置」「用户能说什么」
 * 「归档证据在哪」放在一页里。所有内容只读，且不渲染任何真实姓名、
 * open_id 或密钥 —— 组织草案只传入计数与布尔值。
 */
export function renderOverviewHtml(input: OverviewInput): string {
  const services = input.services.map(s => `<div class="svc">
      <div class="svc-head"><span class="dot ${s.ok ? 'on' : 'off'}"></span>
        <b>${escape(s.name)}</b><span class="port">:${s.port}</span></div>
      <div class="svc-state ${s.ok ? 'ok' : 'bad'}">${s.ok ? '在线' : '离线'}${s.latencyMs === null ? '' : ` · ${s.latencyMs}ms`}</div>
      <p>${escape(s.detail)}</p>
      ${s.href ? `<a class="link" href="${escape(s.href)}">${escape(s.linkLabel ?? '打开')} →</a>` : ''}
    </div>`).join('');
  const help = input.help.map(line => `<li>${escape(line)}</li>`).join('');
  const org = input.org;
  const orgText = !org ? '本机还没有生成组织草案，可运行 npm run org:preview 生成。' :
    `草案${org.draftAvailable ? '已生成' : '不可用'} · 可见成员 <b>${org.memberCount}</b> 名（姓名与标识不在本页展示） · 部门范围${org.departmentScopeMissing ? '未授权' : '已授权'} · 导入状态：${org.applied === null ? '见工作台组织视图（本页不读取业务库）' : org.applied ? '已导入' : '未导入'}`;
  const reportRows = input.bundles.map(item => `<tr>
      <td><a href="/acceptance/${escape(item.taskId)}">${escape(item.taskId)}</a></td>
      <td>${escape(item.entry)}</td><td>${escape(statusLabel(item.verdict))}</td>
      <td>${item.passed}/${item.total}</td><td>${escape(item.createdAt)}</td></tr>`).join('');
  const a = input.acceptance;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>本机协作系统 · 成果总览</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;padding:28px 18px 48px;background:#f5f7fa;color:#1f2329;font:14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1080px;margin:0 auto}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:20px}
h1{font-size:23px;margin:0 0 4px}h2{font-size:16px;margin:0 0 14px}
.sub{color:#646a73;font-size:13px;margin:0}
.refresh{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;background:#2b6cb0;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}
.card{background:#fff;border:1px solid #e5e6eb;border-radius:12px;padding:20px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px;margin-bottom:16px}
.svc{background:#fff;border:1px solid #e5e6eb;border-radius:12px;padding:16px}
.svc-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:none}
.dot.on{background:#0f9d58}.dot.off{background:#d93025}
.port{color:#8a9099;font-size:12px}
.svc-state{margin-top:8px;font-weight:600}.svc-state.ok{color:#0f7b4f}.svc-state.bad{color:#c9353f}
.svc p{color:#646a73;font-size:12px;margin:8px 0;min-height:32px;word-break:break-word}
h3{font-size:13px;margin:18px 0 6px;color:#4e5969}
code{font-size:12px;background:#f2f3f5;padding:2px 5px;border-radius:4px;word-break:break-all}
.link{display:inline-block;min-height:32px;line-height:32px;color:#2b6cb0;text-decoration:none;font-size:13px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e5e6eb;vertical-align:top}
th{background:#f7f8fa;font-weight:600;white-space:nowrap}
.scroll{overflow-x:auto}
a{color:#2b6cb0}
ul,ol{margin:8px 0;padding-left:20px}li{margin:5px 0}
.badge{display:inline-block;background:#eef4ff;color:#2b5cb0;border-radius:5px;padding:1px 8px;font-size:12px;font-weight:600}
.steps{counter-reset:s;list-style:none;padding:0;margin:0}
.steps li{position:relative;padding:8px 0 8px 34px;border-bottom:1px dashed #e5e6eb}
.steps li:before{counter-increment:s;content:counter(s);position:absolute;left:0;top:9px;width:22px;height:22px;border-radius:50%;background:#2b6cb0;color:#fff;text-align:center;line-height:22px;font-size:12px}
.notice{background:#fff8e6;border-left:3px solid #d99a1c;border-radius:6px;padding:14px 16px;font-size:13px}
.notice b{color:#8a5a00}
.meta{color:#646a73;font-size:12px;margin-top:12px}
@media(max-width:680px){body{padding:18px 12px 36px}h1{font-size:20px}.two{grid-template-columns:1fr}.card{padding:16px}}
</style></head><body><div class="wrap">
<header><div><h1>本机协作系统 · 成果总览</h1>
<p class="sub">第六轮交付：中文用户指令 · 按清单确认验收 · 飞书组织草案 · 本机验收报告　|　只监听 127.0.0.1，业务材料不出本机</p></div>
<a class="refresh" href="/overview">刷新状态</a></header>

<div class="grid">${services}</div>

<div class="two">
  <div class="card"><h2>当前实例的验收链</h2>
  <div class="scroll"><table><tbody>
    <tr><th>验收模式</th><td><span class="badge">${escape(a.mode)}</span></td></tr>
    <tr><th>核验等级</th><td>${escape(a.level)}</td></tr>
    <tr><th>独立评审者</th><td>${escape(a.reviewerModel)}</td></tr>
    <tr><th>视觉端点</th><td>${escape(a.visualEndpoint)}</td></tr>
    <tr><th>真人多租户</th><td>${a.multiUserSso ? '已启用' : '未启用（本机单一负责人 + 服务身份）'}</td></tr>
    <tr><th>自查标准</th><td>${input.standardsCount} 条（由打回原因沉淀）</td></tr>
  </tbody></table></div></div>
  <div class="card"><h2>按清单确认验收怎么走</h2>
  <ol class="steps">
    <li>发起任务时锁定验收清单，之后不得改写</li>
    <li>独立评审者按清单逐项判定，视觉证据绑定截图</li>
    <li>逐项报告归档到本机，未通过项不算通过</li>
    <li><b>只由原发起人在原会话「确认验收」</b>，报告不代替人签字</li>
  </ol></div>
</div>

<div class="two">
  <div class="card"><h2>用户可以直接说的中文</h2><ul>${help}</ul>
  <p class="meta">旧英文斜杠命令仅作内部兼容，不再出现在帮助、工作台或报告里。</p></div>
  <div class="card"><h2>飞书组织映射（脱敏）</h2><p>${orgText}</p>
  <h3>要真正导入，还差三步</h3>
  <ol><li>补齐部门范围授权（草案已如实标注缺失，不臆造部门）</li>
  <li>组织 owner 按姓名 / 工号核对成员映射，确认组织表</li>
  <li>审核通过后执行 <code>npm run org:apply -- &lt;组织表&gt;</code></li></ol>
  <p class="sub">草案不参与派单；导入职能注册表必须由组织 owner 审核后执行，且不等于真人登录或员工多租户。</p>
  ${org ? `<p class="meta">草案生成于 ${escape(org.generatedAt)}</p>` : ''}</div>
</div>

<div class="card"><h2>已归档的逐项验收报告</h2>
<div class="scroll"><table><thead><tr><th>任务</th><th>轮次</th><th>结论</th><th>通过/总数</th><th>生成时间</th></tr></thead>
<tbody>${reportRows || '<tr><td colspan="5">暂无归档报告</td></tr>'}</tbody></table></div>
<p class="meta"><a href="/">打开报告索引</a> · 报告只读取已归档结果，不启动开源项目的云端报告服务。</p></div>

<div class="notice"><b>严格边界</b>：本页是本机只读状态展示，不是生产发布或真实业务最终验收。
「按清单确认验收」是已实现且有端到端单测的代码路径，<b>尚未由真人在真实业务单上执行</b>；
本机视觉评审只提供证据与逐项判定，<b>不代替原发起人在原会话「确认验收」</b>；
真实姓名、open_id、密钥与业务正文只在 .runtime，不入库、不上传云端；
真实员工多租户、飞书进群、生产发布与真实 PR / CI 交付均未发生。</div>
<p class="meta">状态读取时间：${escape(input.generatedAt)}　·　服务状态为实时探测结果，离线不代表代码故障。</p>
</div></body></html>`;
}

export function renderIndexHtml(summaries: BundleSummary[]): string {
  const rows = summaries.map(item => `<tr>
    <td><a href="/acceptance/${escape(item.taskId)}">${escape(item.taskId)}</a></td>
    <td>${escape(item.entry)}</td><td>${escape(statusLabel(item.verdict))}</td>
    <td>${item.passed}/${item.total}</td><td>${escape(item.createdAt)}</td>
    <td>${item.hasHtml ? '已生成' : '待生成'}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>本机验收报告索引</title>
<style>body{margin:0;padding:32px;background:#f7f8fa;color:#1f2329;font:14px/1.6 -apple-system,"PingFang SC",sans-serif}
.wrap{max-width:960px;margin:0 auto;background:#fff;border:1px solid #e5e6eb;border-radius:12px;padding:28px}
h1{font-size:20px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #e5e6eb}
th{background:#f7f8fa}a{color:#2b6cb0}.meta{color:#646a73}</style></head><body><div class="wrap">
<h1>本机验收报告索引</h1><p class="meta">只监听 127.0.0.1 的本机报告服务；不启动开源项目的云端报告服务，业务材料不外发。
<a href="/overview">→ 打开本机成果总览（服务状态、验收链配置、中文指令、组织草案）</a></p>
<table><thead><tr><th>任务</th><th>轮次</th><th>结论</th><th>通过/总数</th><th>生成时间</th><th>HTML 报告</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">暂无归档报告，先运行 npm run acceptance:export -- &lt;任务ID&gt;</td></tr>'}</tbody></table></div></body></html>`;
}

export interface SelfCheckRecord {
  schemaVersion: 1;
  updatedAt: string;
  standards: { text: string; taskId: string; round: number; at: string }[];
  note: string;
}

const SELF_CHECK_FILE = 'self-check-standards.json';

export function readSelfCheck(dir: string): SelfCheckRecord {
  const file = path.join(dir, SELF_CHECK_FILE);
  if (!existsSync(file)) return { schemaVersion: 1, updatedAt: '', standards: [],
    note: '打回原因沉淀为下次自查标准；不自动改写已锁定的验收清单。' };
  return JSON.parse(readFileSync(file, 'utf8')) as SelfCheckRecord;
}

/** 幂等累积：同一任务同一轮的同一条原因不会重复写入。 */
export function recordSelfCheck(dir: string, round: AcceptanceRound, taskId: string): SelfCheckRecord {
  const current = readSelfCheck(dir);
  const at = new Date().toISOString();
  const known = new Set(current.standards.map(item => item.text));
  for (const text of selfCheckStandards(round)) {
    if (known.has(text)) continue;
    current.standards.push({ text, taskId, round: round.round, at });
    known.add(text);
  }
  current.updatedAt = at;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, SELF_CHECK_FILE);
  writeFileSync(file + '.tmp', JSON.stringify(current, null, 2), { mode: 0o600 });
  renameSync(file + '.tmp', file);
  return current;
}
