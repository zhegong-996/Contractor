// 本机 Acceptance 报告服务。
//
//   npm run acceptance:list                    列出已归档轮次
//   npm run acceptance:report -- <taskId>       生成中文 HTML 报告
//   npm run acceptance:serve                    只监听 127.0.0.1:4192 的只读报告服务
//   npm run acceptance:self-check -- <round.json>  从一轮评审沉淀自查标准
//
// 不启动 lobehub/acceptance 的 CLI 与云端报告服务；业务材料不出本机。
import { existsSync, readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { runtime } from '../src/config.ts';
import { USER_HELP } from '../src/user-language.ts';
import { listBundles, readBundle, readSelfCheck, recordSelfCheck, writeReportHtml,
  renderAcceptanceHtml, renderIndexHtml, renderOverviewHtml,
  type OverviewService } from '../src/acceptance-report.ts';
import type { AcceptanceRound } from '../src/acceptance-round.ts';

const action = process.argv[2];
const rootDir = runtime('acceptance');
const v06Dir = runtime('v06');
const standards = () => readSelfCheck(v06Dir).standards.map(item => item.text);

if (action === 'list') {
  console.log(JSON.stringify(listBundles(rootDir), null, 2));
} else if (action === 'report') {
  const taskId = process.argv[3];
  if (!taskId) throw new Error('Usage: npm run acceptance:report -- <taskId>');
  const report = readBundle(rootDir, taskId);
  if (!report) throw new Error(`未找到归档报告：${taskId}（先运行 npm run acceptance:export -- ${taskId}）`);
  const file = writeReportHtml(runtime('acceptance', taskId.replace(/[^a-zA-Z0-9_-]/g, '_')),
    report, { taskId, standards: standards() });
  console.log(JSON.stringify({ taskId, file, url: `http://127.0.0.1:4192/acceptance/${taskId}`,
    verdict: report.summary.verdict, cases: report.cases.length }, null, 2));
} else if (action === 'self-check') {
  const file = process.argv[3];
  if (!file) throw new Error('Usage: npm run acceptance:self-check -- <round.json>');
  const round = JSON.parse(readFileSync(file, 'utf8')) as AcceptanceRound;
  const record = recordSelfCheck(v06Dir, round, String((round as any).taskId ?? 'unknown'));
  console.log(JSON.stringify({ total: record.standards.length, items: record.standards }, null, 2));
} else if (action === 'serve') {
  const port = Number(process.argv[3] ?? 4192);
  // 用 node:http 直连 loopback 探测，绕开环境里可能已失效的 HTTP_PROXY。
  const probe = (targetPort: number, path: string): Promise<{ ok: boolean; detail: string; latencyMs: number | null }> =>
    new Promise(resolve => {
      const started = Date.now();
      const req = httpRequest({ hostname: '127.0.0.1', port: targetPort, path, method: 'GET', timeout: 1200 }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { if (body.length < 400) body += chunk; });
        res.on('end', () => {
          let detail = `HTTP ${res.statusCode}`;
          try {
            const json = JSON.parse(body);
            const picked = [json.status, json.scope, json.engine, json.model].filter(Boolean).map(String);
            if (picked.length) detail = picked.slice(0, 3).join(' · ');
          } catch { /* 非 JSON 的健康检查响应 */ }
          resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400,
            detail, latencyMs: Date.now() - started });
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => resolve({ ok: false, detail: '本机端口未响应', latencyMs: null }));
      req.end();
    });

  const readJson = (file: string): any | null => {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; }
    catch { return null; }
  };

  /** 只读汇总：服务状态实时探测；组织草案只取计数与布尔值，绝不渲染姓名 / open_id。 */
  const overview = async (): Promise<string> => {
    const checks = await Promise.all([
      probe(3100, '/api/health'), probe(4180, '/health'), probe(4190, '/health'), probe(port, '/health'),
    ]);
    const defs: (Omit<OverviewService, 'ok' | 'detail' | 'latencyMs'> & { note: string })[] = [
      { name: 'Paperclip 工作台', port: 3100, note: '宿主界面与中文视图',
        href: 'http://127.0.0.1:3100/SUI/knowledge-workspaces', linkLabel: '打开工作台' },
      { name: '本机 Bridge', port: 4180, note: '只读 action 与派单接口' },
      { name: 'Apple Vision 端点', port: 4190, note: '设备端 OCR / 图像分类，无外发' },
      { name: '本机报告服务', port, note: '逐项验收报告与总览', href: '/', linkLabel: '报告索引' },
    ];
    const services: OverviewService[] = defs.map(({ note, ...d }, i) => ({
      ...d, ok: checks[i]!.ok, latencyMs: checks[i]!.latencyMs,
      detail: `${note} · ${checks[i]!.detail}`,
    }));
    const cfg = readJson(runtime('config.json')) ?? {};
    const acc = cfg.acceptance ?? {};
    const draft = readJson(runtime('org-mapping-draft.json'));
    return renderOverviewHtml({
      generatedAt: new Date().toISOString(), services,
      acceptance: { mode: String(acc.mode ?? 'legacy'), level: String(acc.level ?? 'L3'),
        reviewerModel: String(acc.reviewerModel ?? 'independent-reviewer'),
        visualEndpoint: String(acc.visualReviewer?.endpoint ?? '未配置（结构式评审）'),
        multiUserSso: cfg.multiUserSso === true },
      help: USER_HELP.split('\n'),
      org: draft ? { draftAvailable: draft.available === true, generatedAt: String(draft.generatedAt ?? ''),
        memberCount: Array.isArray(draft.members) ? draft.members.length : 0,
        departmentScopeMissing: draft.departmentScopeMissing === true, applied: null } : null,
      standardsCount: readSelfCheck(v06Dir).standards.length,
      bundles: listBundles(rootDir),
    });
  };

  const server = createServer(async (req, res) => {
    if (req.method !== 'GET') { res.statusCode = 405; res.end('Method not allowed'); return; }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/health') { res.end(JSON.stringify({ ok: true, scope: 'loopback-only', overview: '/overview' })); return; }
    if (url.pathname === '/overview') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(await overview()); return;
    }
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(renderIndexHtml(listBundles(rootDir))); return;
    }
    const match = /^\/acceptance\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
    if (!match) { res.statusCode = 404; res.end('Not found'); return; }
    const report = readBundle(rootDir, match[1]!);
    if (!report) { res.statusCode = 404; res.end('该任务还没有归档报告'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderAcceptanceHtml(report, { taskId: match[1]!, standards: standards() }));
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(JSON.stringify({ ok: true, url: `http://127.0.0.1:${port}/`,
      overview: `http://127.0.0.1:${port}/overview`,
      bound: '127.0.0.1', note: '本机只读报告服务；不启动 Acceptance 云端服务，业务材料不外发' }, null, 2));
  });
} else {
  console.log('Usage: npm run acceptance:list | acceptance:report -- <taskId> | acceptance:serve | acceptance:self-check -- <round.json>');
  process.exitCode = 1;
}
