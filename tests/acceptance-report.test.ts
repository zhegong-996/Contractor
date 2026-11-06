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
  renderOverviewHtml, writeReportHtml, recordSelfCheck, readSelfCheck } from '../src/acceptance-report.ts';
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

test('本机总览页展示实时状态、中文指令与边界，且不渲染任何真实身份信息', () => {
  const html = renderOverviewHtml({
    generatedAt: '2026-11-06T12:00:00.000Z',
    services: [
      { name: 'Paperclip 工作台<script>', port: 3100, ok: true, detail: '宿主界面 <b>', latencyMs: 3,
        href: 'http://127.0.0.1:3100/SUI/knowledge-workspaces', linkLabel: '打开工作台' },
      { name: 'Apple Vision 端点', port: 4190, ok: false, detail: '本机端口未响应', latencyMs: null },
    ],
    acceptance: { mode: 'independent', level: 'L3', reviewerModel: 'apple-vision-local',
      visualEndpoint: 'http://127.0.0.1:4190/v1/chat/completions', multiUserSso: false },
    help: ['发起协作：任务 要办的事', '按清单确认验收：确认验收 任务编号'],
    // 即使调用方误把成员明细传进来，总览页也只渲染计数与布尔值。
    org: { draftAvailable: true, generatedAt: '2026-11-06T11:00:00.000Z', memberCount: 5,
      departmentScopeMissing: true, applied: null,
      members: [{ name: '张三', openId: 'ou_secret_123' }] } as any,
    standardsCount: 1, bundles: [],
  });
  assert.match(html, /成果总览/);
  assert.match(html, /Paperclip 工作台&lt;script&gt;/);
  assert.match(html, /宿主界面 &lt;b&gt;/);
  assert.doesNotMatch(html, /<script>|张三|ou_secret_123/);
  assert.match(html, /在线/);
  assert.match(html, /离线/);
  assert.match(html, /independent/);
  assert.match(html, /apple-vision-local/);
  assert.match(html, /可见成员 <b>5<\/b> 名/);
  assert.match(html, /姓名与标识不在本页展示/);
  assert.match(html, /按清单确认验收：确认验收 任务编号/);
  assert.match(html, /不代替原发起人在原会话「确认验收」/);
  assert.match(html, /尚未由真人在真实业务单上执行/);
  assert.doesNotMatch(html, /\/accept/);
  assert.match(renderIndexHtml([]), /href="\/overview"/);
});

test('报告服务已接入工作台、编排与评审链，新增总览页也只监听本机', () => {
  assert.match(source('src/v06.ts'), /case 'acceptance-report-view'/);
  assert.match(source('src/server.ts'), /'acceptance-report-view'/);
  assert.match(source('plugins/knowledge-workspaces/src/ui/v06-panels.tsx'), /验收报告与自查标准/);
  assert.match(source('src/controller.ts'), /recordSelfCheck\(runtime\('v06'\), report, id\)/);
  assert.match(source('scripts/acceptance-report.ts'), /server\.listen\(port, '127\.0\.0\.1'/);
  assert.match(source('scripts/acceptance-report.ts'), /url\.pathname === '\/overview'/);
  // 状态探测走 node:http 直连，不经代理；组织草案不把成员明细带进页面。
  assert.match(source('scripts/acceptance-report.ts'), /request as httpRequest/);
  assert.doesNotMatch(source('scripts/acceptance-report.ts'), /draft\.members\.map/);
  assert.match(source('src/acceptance-report.ts'), /姓名与标识不在本页展示/);
  assert.doesNotMatch(source('scripts/acceptance-report.ts'), /0\.0\.0\.0/);
  const pkg = JSON.parse(source('package.json'));
  for (const key of ['acceptance:list', 'acceptance:report', 'acceptance:serve', 'acceptance:self-check']) {
    assert.ok(pkg.scripts[key], `缺少 ${key}`);
  }
});
