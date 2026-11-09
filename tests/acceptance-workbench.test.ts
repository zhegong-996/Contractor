// 验收工作台只是把既有清单、逐项判定、审查编组与报告聚合给控制台看。
// 它不能生成新的通过结论，也不能在未锁定清单的任务上伪造一份清单。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan } from '../src/acceptance-plan.ts';
import { assertEvidenceRegions, evaluateRound, EVIDENCE_REGION_LIMIT } from '../src/acceptance-round.ts';
import { defaultAgentRegistry, reviewCrew } from '../src/agent-registry.ts';
import { buildAcceptanceWorkbench } from '../src/acceptance-workbench.ts';

const lockedAt = '2026-11-09T00:00:00.000Z';
const plan = createPlan({
  taskId: 'task-1',
  names: ['首页可打开', '错误提示可读'],
  lockedBy: 'owner-a',
  level: 'L3',
  producerModel: 'producer-model',
  reviewerModel: 'independent-model',
  lockedAt,
});
const round = evaluateRound({
  plan,
  reviewerModel: 'independent-model',
  producerModel: 'producer-model',
  round: 2,
  evidence: {
    'item-1': {
      refs: ['event-1'], evidenceKind: 'captured',
      sourceRefs: [{ id: 'source-1', revision: 'rev-1' }],
      regions: [{ x: 10, y: 20, width: 120, height: 40, note: '主按钮' }],
    },
    'item-2': {
      refs: ['event-2'], evidenceKind: 'captured',
      sourceRefs: [{ id: 'source-1', revision: 'rev-1' }],
    },
  },
});

test('工作台按清单顺序合并逐项判定与区域', () => {
  const view = buildAcceptanceWorkbench({
    taskId: 'task-1',
    plan: { plan, revision: 'rev-9' },
    round,
    crew: reviewCrew(defaultAgentRegistry(), { taskId: 'task-1' }),
    report: {
      available: true, verdict: 'passed', cases: 2, createdAt: '2026-11-09T01:00:00.000Z',
      archivedRounds: 1, selfCheckStandards: ['补充移动端截图'],
      reportUrl: 'http://127.0.0.1:4192/acceptance/task-1', note: '本机只读报告',
    },
  });
  assert.equal(view.plan?.locked, true);
  assert.equal(view.plan?.revision, 'rev-9');
  assert.equal(view.items.length, 2);
  assert.equal(view.items[0]?.status, 'passed');
  assert.equal(view.items[0]?.regions[0]?.note, '主按钮');
  assert.deepEqual(view.items[1]?.regions, []);
  assert.deepEqual(view.summary, { total: 2, passed: 2, failed: 0, blocked: 0, pending: 0 });
  assert.equal(view.readiness.ready, true);
  assert.equal(view.round?.rejected.closeTask, false);
  assert.deepEqual(view.round?.rejected.recheckItems, []);
});

test('未锁定清单时不伪造条目，如实列出缺口', () => {
  const view = buildAcceptanceWorkbench({
    taskId: 'task-legacy',
    plan: null,
    round: null,
    crew: reviewCrew(defaultAgentRegistry(), { taskId: 'task-legacy' }),
    report: null,
  });
  assert.equal(view.plan, null);
  assert.deepEqual(view.items, []);
  assert.equal(view.readiness.ready, false);
  assert.ok(view.readiness.gaps.some(gap => gap.includes('沿用原发起人核可')));
  assert.ok(view.readiness.gaps.some(gap => gap.includes('尚未完成独立逐项评审')));
  assert.equal(view.crew.configured, false);
  assert.ok(view.crew.degraded?.includes('不硬造验收 Agent'));
});

test('未通过项进入打回与下次自查标准，不被抹平', () => {
  const failed = evaluateRound({
    plan,
    reviewerModel: 'independent-model',
    producerModel: 'producer-model',
    evidence: {
      'item-1': { refs: ['event-1'], evidenceKind: 'captured', sourceRefs: [{ id: 's', revision: 'r' }] },
      'item-2': { refs: ['event-2'], evidenceKind: 'imported', sourceRefs: [{ id: 's', revision: 'r' }] },
    },
  });
  const view = buildAcceptanceWorkbench({
    taskId: 'task-1', plan: { plan, revision: 'rev-1' }, round: failed,
    crew: reviewCrew(defaultAgentRegistry(), { taskId: 'task-1' }), report: null,
  });
  assert.equal(view.summary.failed, 1);
  assert.equal(view.readiness.ready, false);
  assert.deepEqual(view.round?.rejected.recheckItems, ['item-2']);
  assert.deepEqual(view.round?.rejected.keepItems, ['item-1']);
  assert.ok(view.selfCheckStandards.some(item => item.startsWith('错误提示可读：')));
});

test('证据区域只接受有限、正向的坐标，最多 8 个', () => {
  assert.deepEqual(assertEvidenceRegions(undefined), []);
  assert.deepEqual(assertEvidenceRegions([]), []);
  assert.equal(assertEvidenceRegions([{ x: 0, y: 0, width: 1, height: 1 }]).length, 1);
  assert.throws(() => assertEvidenceRegions('bad'), /必须是数组/);
  assert.throws(() => assertEvidenceRegions([{ x: -1, y: 0, width: 1, height: 1 }]), /范围不合法/);
  assert.throws(() => assertEvidenceRegions([{ x: 0, y: 0, width: 0, height: 1 }]), /范围不合法/);
  assert.throws(() => assertEvidenceRegions([{ x: 0, y: 0, width: 1, height: Infinity }]), /有限数/);
  const tooMany = Array.from({ length: EVIDENCE_REGION_LIMIT + 1 }, () => ({ x: 0, y: 0, width: 1, height: 1 }));
  assert.throws(() => assertEvidenceRegions(tooMany), /最多/);
  assert.throws(() => evaluateRound({
    plan, reviewerModel: 'independent-model', producerModel: 'producer-model',
    evidence: { 'item-1': { refs: ['e'], evidenceKind: 'captured', sourceRefs: [{ id: 's', revision: 'r' }],
      regions: [{ x: 0, y: 0, width: 0, height: 10 }] } },
  }), /范围不合法/);
});
