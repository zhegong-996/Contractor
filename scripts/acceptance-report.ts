// 本机 Acceptance 报告服务。
//
//   npm run acceptance:list                    列出已归档轮次
//   npm run acceptance:report -- <taskId>       生成中文 HTML 报告
//   npm run acceptance:serve                    只监听 127.0.0.1:4192 的只读报告服务
//   npm run acceptance:self-check -- <round.json>  从一轮评审沉淀自查标准
//
// 不启动 lobehub/acceptance 的 CLI 与云端报告服务；业务材料不出本机。
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { runtime } from '../src/config.ts';
import { listBundles, readBundle, readSelfCheck, recordSelfCheck, writeReportHtml,
  renderAcceptanceHtml, renderIndexHtml } from '../src/acceptance-report.ts';
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
  const server = createServer((req, res) => {
    if (req.method !== 'GET') { res.statusCode = 405; res.end('Method not allowed'); return; }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/health') { res.end(JSON.stringify({ ok: true, scope: 'loopback-only' })); return; }
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
      bound: '127.0.0.1', note: '本机只读报告服务；不启动 Acceptance 云端服务，业务材料不外发' }, null, 2));
  });
} else {
  console.log('Usage: npm run acceptance:list | acceptance:report -- <taskId> | acceptance:serve | acceptance:self-check -- <round.json>');
  process.exitCode = 1;
}
