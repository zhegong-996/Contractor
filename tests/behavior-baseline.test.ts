import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freezeTraceSnapshot, diffGolden, scoreSnapshot, armFlags,
  FORBIDDEN_OUTBOUND_TOOLS, FORBIDDEN_TOOL_PREFIXES,
  toolSurfaceSignature, inspectOutboundTools, assertOutboundTools,
  assertDecisionTraceIsolation,
} from '../src/behavior-baseline.ts';

const REAL_OUTBOUND_TOOLS = [
  'list_tasks', 'read_task', 'claim_task', 'submit_checkpoint', 'publish_delivery',
  'propose_knowledge', 'professional_workspaces', 'read_task_context', 'read_context_record',
  'read_knowledge_graph', 'search_task_context', 'expand_authorized_context',
  'request_material_access', 'read_authorized_material', 'propose_professional_knowledge',
  'acknowledge_stopped_execution',
];

const rawReport = (steps: number, ok = true) => ({
  ok, at: '2026-11-08T05:00:00Z', port: 4190,
  steps: Array.from({ length: steps }, (_, i) => ({ name: 'step-' + i, hits: 1, tabFound: true })),
  checks: { index: { ok: true }, styles: { ok: true } },
  failed: [], url: 'http://127.0.0.1:4190/',
});

test('P-8 冻结快照排除易变字段：时间 / 端口 / URL 变化不影响签名', () => {
  const a = freezeTraceSnapshot('walkthrough', { ...rawReport(3), at: '2026-11-08T05:00:00Z', port: 4190 });
  const b = freezeTraceSnapshot('walkthrough', { ...rawReport(3), at: '2026-11-09T09:00:00Z', port: 5180 });
  assert.equal(a.signature, b.signature);
  assert.ok(a.excludedKeys.includes('at') && a.excludedKeys.includes('port') && a.excludedKeys.includes('url'));
  assert.equal(a.modelCalls, 0);
  assert.ok(a.count > 0);
});

test('P-8 冻结快照内容变化即变签名，且条目按键稳定排序', () => {
  const a = freezeTraceSnapshot('walkthrough', rawReport(3));
  const b = freezeTraceSnapshot('walkthrough', rawReport(4));
  assert.notEqual(a.signature, b.signature);
  const keys = a.entries.map(e => e.key);
  assert.deepEqual(keys, [...keys].sort());
});

test('P-8 golden diff 逐项分类新增 / 删除 / 改变 / 未变', () => {
  const golden = freezeTraceSnapshot('walkthrough', { ok: true, steps: ['a', 'b'] });
  const current = freezeTraceSnapshot('walkthrough', { ok: false, steps: ['a', 'c'], extra: 1 });
  const diff = diffGolden(golden, current);
  assert.equal(diff.ok, false);
  assert.ok(diff.changed.some(d => d.key === 'ok'));
  assert.ok(diff.added.some(d => d.key === 'extra'));
  assert.ok(diff.removed.length === 0 || diff.removed.every(d => typeof d.key === 'string'));
  assert.equal(diff.unchanged > 0, true);
});

test('P-8 纯评分器：相同判 identical，退化判 regressed，种类不同不编造分数', () => {
  const golden = freezeTraceSnapshot('walkthrough', rawReport(3));
  assert.equal(scoreSnapshot(golden, golden).verdict, 'identical');
  assert.equal(scoreSnapshot(golden, golden).passRate, 1);
  const regressed = freezeTraceSnapshot('walkthrough', { ...rawReport(3), ok: false });
  const score = scoreSnapshot(golden, regressed);
  assert.equal(score.verdict, 'regressed');
  assert.equal(score.modelCalls, 0);
  const mismatched = scoreSnapshot(golden, freezeTraceSnapshot('console', rawReport(3)));
  assert.equal(mismatched.comparable, false);
  assert.equal(mismatched.passRate, null);
});

test('P-8 双臂旗标：样本不足不比较、不补零、不估算', () => {
  const report = armFlags([1, 1], [1, 1]);
  assert.ok(report.flags.includes('insufficient-samples'));
  assert.equal(report.comparable, false);
  assert.equal(report.control.mean, 1);
  assert.equal(report.treatment.samples, 2);
  assert.ok(report.note.includes('样本不足'));
});

test('P-8 双臂旗标：无区分差异标 non-discriminating，不宣称改进有效', () => {
  const report = armFlags([1, 1, 1, 1, 1], [1, 1, 1, 1, 1]);
  assert.ok(report.flags.includes('non-discriminating'));
  assert.equal(report.comparable, false);
  assert.equal(report.delta, 0);
  assert.ok(report.note.includes('不能据此宣称'));
});

test('P-8 双臂旗标：臂内波动过大标 high-variance', () => {
  const report = armFlags([1, 1, 1, 1, 100], [2, 2, 2, 2, 2]);
  assert.ok(report.flags.includes('high-variance'));
  assert.equal(report.comparable, false);
});

test('P-8 双臂旗标：样本足、有区分且波动可接受才 comparable', () => {
  const report = armFlags([1, 1, 1, 1, 1], [2, 2, 2, 2, 2]);
  assert.deepEqual(report.flags, ['ok']);
  assert.equal(report.comparable, true);
  assert.equal(report.delta, 1);
  assert.equal(report.minSamples, 5);
  assert.equal(report.modelCalls, 0);
});

test('P-8 工具面签名顺序无关，新增 / 改名都会变', () => {
  const a = toolSurfaceSignature(['a', 'b', 'c']);
  assert.equal(a, toolSurfaceSignature(['c', 'a', 'b']));
  assert.notEqual(a, toolSurfaceSignature(['a', 'b', 'c', 'd']));
  assert.notEqual(a, toolSurfaceSignature(['a', 'b', 'C']));
});

test('P-8 出站「不暴露」清单覆盖验收 / 发起 / 越权 / 撤权 / 删除 / 绕过', () => {
  const joined = FORBIDDEN_OUTBOUND_TOOLS.join(' ');
  for (const term of ['confirm_acceptance', 'create_task', 'admin_all', 'revoke_access', 'delete_task', 'bypass_approval'])
    assert.ok(joined.includes(term), '缺少禁止项 ' + term);
  assert.ok(FORBIDDEN_TOOL_PREFIXES.includes('admin_'));
});

test('P-8 精确名与禁止前缀都能被拦下，并给出理由', () => {
  const inspection = inspectOutboundTools(['read_task', 'confirm_acceptance', 'admin_secret', 'bypass_check']);
  assert.equal(inspection.ok, false);
  assert.equal(inspection.forbiddenHits.length, 3);
  assert.ok(inspection.forbiddenHits.every(hit => hit.reason.length > 0));
  assert.equal(inspection.modelCalls, 0);
});

test('P-8 真实出站 MCP 工具面通过硬断言，且签名稳定', () => {
  const result = assertOutboundTools(REAL_OUTBOUND_TOOLS);
  assert.equal(result.ok, true);
  assert.equal(result.signature, toolSurfaceSignature(REAL_OUTBOUND_TOOLS));
  assert.equal(inspectOutboundTools(REAL_OUTBOUND_TOOLS).forbiddenHits.length, 0);
});

test('P-8 硬断言命中即抛错，空工具面也拒绝（无法核对不暴露清单）', () => {
  assert.throws(() => assertOutboundTools(['confirm_acceptance']), /禁止工具/);
  assert.throws(() => assertOutboundTools(['admin_dump_private']), /禁止前缀/);
  assert.throws(() => assertOutboundTools([]), /工具面为空/);
});

test('P-8 自动决策独立留痕：不与业务写入共用 id、字段齐备、时间单调', () => {
  const decisions = [
    { id: 'r001', at: '2026-11-08T01:00:00Z', kind: 'routing-decided' },
    { id: 'r002', at: '2026-11-08T01:01:00Z', kind: 'routing-decided' },
  ];
  const result = assertDecisionTraceIsolation({ decisions, businessWriteIds: ['t001', 't002'] });
  assert.equal(result.isolated, true);
  assert.equal(result.decisions, 2);
  assert.deepEqual(result.overlappingIds, []);
  assert.equal(result.modelCalls, 0);
});

test('P-8 决策留痕共用 id / 倒序 / 缺字段一律拒绝', () => {
  const good = { id: 'r001', at: '2026-11-08T01:00:00Z', kind: 'routing-decided' };
  assert.throws(() => assertDecisionTraceIsolation({ decisions: [good], businessWriteIds: ['r001'] }), /共用了 id/);
  assert.throws(() => assertDecisionTraceIsolation({ decisions: [
    { id: 'r002', at: '2026-11-08T02:00:00Z', kind: 'routing-decided' },
    { id: 'r001', at: '2026-11-08T01:00:00Z', kind: 'routing-decided' },
  ], businessWriteIds: [] }), /时间倒序/);
  assert.throws(() => assertDecisionTraceIsolation({ decisions: [
    { id: '', at: '2026-11-08T01:00:00Z', kind: 'routing-decided' },
  ], businessWriteIds: [] }), /缺少 id/);
});
