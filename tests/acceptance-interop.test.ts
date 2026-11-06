import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPlan } from '../src/acceptance-plan.ts';
import { evaluateRound } from '../src/acceptance-round.ts';
import { eventId, type CollabEvent } from '../src/event-stream.ts';
import { toAcceptancePlanItems, toAcceptanceReport, assertAcceptanceReport,
  writeAcceptanceBundle, upstreamInfo, ACCEPTANCE_UPSTREAM } from '../src/acceptance-interop.ts';

const at = '2026-11-06T00:00:00.000Z';
const events: CollabEvent[] = [
  { taskId: 'T-1', at, kind: 'ci', actor: 'chrome-headless', provenance: 'screenshot-a', evidenceKind: 'captured', refs: [], outcome: 'captured' },
  { taskId: 'T-1', at, kind: 'tool', actor: 'worker', provenance: 'cli-log', evidenceKind: 'captured', refs: [], outcome: 'captured' },
];
const plan = createPlan({ taskId: 'T-1', names: ['页面可见验收与责任', '命令输出包含版本号'],
  lockedBy: 'owner', producerModel: 'producer-gpt', reviewerModel: 'apple-vision-local', lockedAt: at });
function roundWith(statuses: ('passed' | 'failed' | 'blocked')[]) {
  const evidence = Object.fromEntries(plan.items.map((item, i) => [item.id, {
    refs: statuses[i] === 'blocked' ? [] : [eventId(events[i]!)],
    evidenceKind: item.evidenceKind,
    sourceRefs: statuses[i] === 'blocked' ? [] : [{ id: `source-${i}`, revision: 'rev-1' }],
  }]));
  const round = evaluateRound({ plan, reviewerModel: 'apple-vision-local', producerModel: 'producer-gpt',
    evidence, events, round: 1, planRevision: 'rev-plan' });
  return { ...round, judgements: round.judgements.map((j, i) => ({ ...j, status: statuses[i]! })) };
}

test('acceptance submodule 固定在 Apache-2.0 提交且规范文件存在', () => {
  const info = upstreamInfo();
  assert.equal(info.version, '0.10.0');
  assert.equal(info.commit, 'f720feb862bdbe3acc653bdedc297e20e08be1ae');
  assert.ok(existsSync(path.join(ACCEPTANCE_UPSTREAM, 'LICENSE')));
  assert.match(readFileSync(info.licensePath, 'utf8'), /Apache License/);
  assert.match(readFileSync(info.schemaPath, 'utf8'), /"cases"/);
});

test('锁定清单逐项映射到 acceptance 冻结 plan，ID 保持不变', () => {
  const entries = toAcceptancePlanItems(plan, 'llm');
  assert.deepEqual(entries.map(e => e.id), plan.items.map(i => i.id));
  assert.equal(entries[0]!.verifier, 'llm');
  assert.deepEqual(entries[0]!.requiredEvidence, ['screenshot']);
  assert.match(entries[0]!.method, /apple-vision-local/);
});

test('逐项评审报告导出为上游 result.json 形状，证据都带真实描述', () => {
  const report = toAcceptanceReport({ plan, round: roundWith(['passed', 'passed']), events });
  assertAcceptanceReport(report);
  assert.equal(report.summary.verdict, 'pass');
  assert.equal(report.cases.length, plan.items.length);
  assert.ok(report.cases.every(c => c.evidence.every(e => e.path.startsWith('assets/') && e.description.length > 12)));
  assert.ok(report.cases[0]!.evidence[0]!.description.includes('chrome-headless'));
  assert.ok(report.surfaces.includes('web'));
});

test('打回与受阻如实落到 fail / blocked / partial，不伪造通过', () => {
  const report = toAcceptanceReport({ plan, round: roundWith(['passed', 'blocked']), events });
  assertAcceptanceReport(report);
  assert.equal(report.cases[1]!.status, 'blocked');
  assert.deepEqual(report.cases[1]!.evidence, []);
  assert.equal(report.summary.verdict, 'partial');
  assert.equal(report.summary.blocked, 1);
});

test('导出目录里每个证据路径都是真实文件，result.json 可回放', () => {
  const report = toAcceptanceReport({ plan, round: roundWith(['passed', 'passed']), events });
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-acceptance-'));
  const written = writeAcceptanceBundle(dir, report, { events });
  for (const item of report.cases) for (const evidence of item.evidence)
    assert.ok(existsSync(path.join(dir, evidence.path)), `${evidence.path} 必须真实存在`);
  const saved = JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8'));
  assert.equal(saved.summary.total, 2);
  assert.ok(written.includes('report.md'));
  assert.match(readFileSync(path.join(dir, 'report.md'), 'utf8'), /不替代发起人/);
});

test('清单被改写时拒绝导出；证据缺描述时不接受', () => {
  const tampered = { ...plan, hash: 'deadbeef' };
  assert.throws(() => toAcceptanceReport({ plan: tampered, round: roundWith(['passed', 'passed']) }), /验收清单已变更/);
  const report = toAcceptanceReport({ plan, round: roundWith(['passed', 'passed']), events });
  report.cases[0]!.evidence[0]!.description = 'x';
  assert.throws(() => assertAcceptanceReport(report), /具体描述/);
});

test('多个检查项引用同一捕获事件时，证据文件只写一次、导出清单不重复', () => {
  const shared = evaluateRound({ plan, reviewerModel: 'apple-vision-local', producerModel: 'producer-gpt',
    evidence: Object.fromEntries(plan.items.map(item => [item.id, {
      refs: [eventId(events[0]!)], evidenceKind: item.evidenceKind,
      sourceRefs: [{ id: 'shared-capture', revision: 'rev-1' }],
    }])), events, round: 1, planRevision: 'rev-plan' });
  const report = toAcceptanceReport({ plan, round: shared, events });
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-acceptance-shared-'));
  const written = writeAcceptanceBundle(dir, report, { events });
  assert.equal(new Set(written).size, written.length, '导出清单不能有重复路径');
  assert.equal(written.filter(file => file.startsWith('assets/')).length, 1);
  assert.ok(existsSync(path.join(dir, written.find(file => file.startsWith('assets/'))!)));
});
