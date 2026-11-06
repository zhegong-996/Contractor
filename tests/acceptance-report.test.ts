// 本机 Acceptance 报告服务：中文报告、归档索引、打回原因幂等沉淀，
// 并且不把英文协议词 /accept 带回给报告读者。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync as read } from 'node:fs';
import { root } from '../src/config.ts';
import { listBundles, readBundle, renderAcceptanceHtml, renderIndexHtml,
  writeReportHtml, recordSelfCheck, readSelfCheck } from '../src/acceptance-report.ts';
import type { AcceptanceReport } from '../src/acceptance-interop.ts';
import type { AcceptanceRound } from '../src/acceptance-round.ts';

const source = (file: string) => read(path.join(root, file), 'utf8');

function report(): AcceptanceReport {
  return {
    title: '逐项验收报告', createdAt: '2026-11-06T10:00:00.000Z', entry: '第 1 轮',
    subject: 'task-demo', surfaces: ['web'],
    plan: [{ id: 'item-1', title: '页面可见验收与责任', category: '锁定验收项',
      verifier: 'agent', method: '截图文字核对', expected: '验收与责任', requiredEvidence: ['screenshot'] }],
    cases: [{ id: 'item-1', category: '锁定验收项', name: '页面可见验收与责任<script>',
      surface: 'web', status: 'pass', observation: '按锁定标准通过',
      evidence: [{ path: 'assets/e1.txt', description: '捕获记录' }] }],
    summary: { total: 1, passed: 1, failed: 0, blocked: 0, verdict: 'pass',
      conclusion: '独立评审者按开工前锁定清单逐项判定，报告只提供证据。' },
  } as AcceptanceReport;
}

function round(overall: 'passed' | 'failed' = 'passed'): AcceptanceRound {
  return { schemaVersion: 1, taskId: 'task-demo', round: 1, planHash: 'h', planRevision: null,
    reviewer: { model: 'reviewer', producerModel: 'producer', requiresVision: true },
    judgements: overall === 'passed'
      ? [{ itemId: 'item-1', name: '页面可见验收与责任', status: 'passed', evidenceRefs: ['e1'], reason: '' }]
      : [{ itemId: 'item-2', name: '文案完整', status: 'failed', evidenceRefs: [], reason: '截图里没有这段文案' }],
    overall, createdAt: '2026-11-06T10:00:00.000Z' } as unknown as AcceptanceRound;
}

test('中文 HTML 报告转义用户内容、标注边界，且不出现英文 /accept', () => {
  const html = renderAcceptanceHtml(report(), { taskId: 'task-demo', standards: ['文案完整：补齐说明'],
    limitations: ['主观视觉质量由发起人核可'] });
  assert.match(html, /逐项验收报告/);
  assert.match(html, /不代替原发起人在原会话「确认验收」/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /\/accept/);
  assert.match(html, /文案完整：补齐说明/);
  assert.match(html, /业务正文、密钥与截图不上传云端/);
  assert.match(renderIndexHtml(listBundles(mkdtempSync(path.join(tmpdir(), 'empty-')))), /暂无归档报告/);
});

test('归档索引与 HTML 报告落盘可回放', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-bundles-'));
  const bundle = path.join(dir, 'task-demo');
  mkdirSync(bundle, { recursive: true });
  writeFileSync(path.join(bundle, 'result.json'), JSON.stringify(report()));
  const list = listBundles(dir);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.verdict, 'pass');
  assert.equal(list[0]!.hasHtml, false);
  assert.equal(readBundle(dir, 'task-demo')?.cases.length, 1);
  assert.equal(readBundle(dir, '../escape'), null);
  const file = writeReportHtml(bundle, report(), { taskId: 'task-demo' });
  assert.match(readFileSync(file, 'utf8'), /逐项验收报告/);
  assert.equal(listBundles(dir)[0]!.hasHtml, true);
  rmSync(dir, { recursive: true, force: true });
});

test('打回原因沉淀为自查标准，同一轮重复记录不新增', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-selfcheck-'));
  const first = recordSelfCheck(dir, round('failed'), 'task-demo');
  assert.equal(first.standards.length, 1);
  assert.match(first.standards[0]!.text, /截图里没有这段文案/);
  assert.equal(recordSelfCheck(dir, round('failed'), 'task-demo').standards.length, 1);
  assert.equal(recordSelfCheck(dir, round('passed'), 'task-demo').standards.length, 1);
  assert.match(readSelfCheck(dir).note, /不自动改写已锁定的验收清单/);
  rmSync(dir, { recursive: true, force: true });
});

test('报告服务已接入工作台、编排与评审链，且只监听本机', () => {
  assert.match(source('src/v06.ts'), /case 'acceptance-report-view'/);
  assert.match(source('src/server.ts'), /'acceptance-report-view'/);
  assert.match(source('plugins/knowledge-workspaces/src/ui/v06-panels.tsx'), /验收报告与自查标准/);
  assert.match(source('src/controller.ts'), /recordSelfCheck\(runtime\('v06'\), report, id\)/);
  assert.match(source('scripts/acceptance-report.ts'), /server\.listen\(port, '127\.0\.0\.1'/);
  assert.doesNotMatch(source('scripts/acceptance-report.ts'), /0\.0\.0\.0/);
  const pkg = JSON.parse(source('package.json'));
  for (const key of ['acceptance:list', 'acceptance:report', 'acceptance:serve', 'acceptance:self-check']) {
    assert.ok(pkg.scripts[key], `缺少 ${key}`);
  }
});
