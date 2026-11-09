// 多 Agent 并行 + 对账→决策上下文 + 显式指代（V4）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { planParallel, fanOut, fanIn } from '../src/fanout.ts';
import { delegate, ROLE_SPECS } from '../src/agent-delegation.ts';
import { openReconcileDecision, reconcileDecisionRecord } from '../src/reconcile-decision.ts';
import { reconcile } from '../src/reconcile.ts';
import { explicitTaskReference, passThroughDecision } from '../src/pass-through.ts';

test('并行计划：子任务越权/预算越界整份拒绝，不产出半张计划', () => {
  const parent = { mandate: { scope: ['/repo'] as const, grant: 'edit' as const }, budget: ROLE_SPECS.coordinator.budget };
  const ok = planParallel({
    task: 't', parent,
    subtasks: [{ task: 'a', mandate: { scope: [], grant: 'read' }, budget: ROLE_SPECS.worker.budget }],
    summary: { task: 'sum', mandate: { scope: [], grant: 'read' }, budget: ROLE_SPECS.checker.budget },
  });
  assert.ok(ok.ok);

  const bad = planParallel({
    task: 't', parent,
    subtasks: [{ task: 'a', mandate: { scope: ['/etc'], grant: 'edit' }, budget: ROLE_SPECS.worker.budget }],
    summary: { task: 'sum', mandate: { scope: [], grant: 'read' }, budget: ROLE_SPECS.checker.budget },
  });
  assert.equal(bad.ok, false);
  assert.match((bad as { reason: string }).reason, /越权/);

  assert.equal(planParallel({ task: 't', parent, subtasks: [], summary: { task: 's', mandate: { scope: [], grant: 'read' }, budget: ROLE_SPECS.checker.budget } }).ok, false);
});

test('fan-out/fan-in：N 个 worker 并行，汇总标记空产出', () => {
  let seq = 0;
  const makeId = () => `a${++seq}`;
  const coordinator = delegate({ task: 't', role: 'coordinator', mandate: { scope: [], grant: 'full' }, budget: ROLE_SPECS.coordinator.budget }, makeId);
  assert.ok(coordinator.ok);
  if (!coordinator.ok) return;
  const plan = planParallel({
    task: 't', parent: { mandate: coordinator.assignment.mandate, budget: ROLE_SPECS.coordinator.budget },
    subtasks: [
      { task: 'a', mandate: { scope: [], grant: 'edit' }, budget: ROLE_SPECS.worker.budget },
      { task: 'b', mandate: { scope: [], grant: 'edit' }, budget: ROLE_SPECS.worker.budget },
    ],
    summary: { task: 'sum', mandate: { scope: [], grant: 'read' }, budget: ROLE_SPECS.checker.budget },
  });
  assert.ok(plan.ok);
  if (!plan.ok) return;
  const workers = fanOut({ coordinator: coordinator.assignment, plan: plan.plan, makeId });
  assert.equal(workers.length, 2);
  // 所有 worker 深度一致（并行，互不嵌套）
  assert.equal(new Set(workers.map(w => w.depth)).size, 1);

  const packed = fanIn({
    summaryTask: 'sum',
    workerResults: [
      { worker: workers[0]!, output: '结果 A' },
      { worker: workers[1]!, output: '' },
    ],
  });
  assert.equal(packed.emptyCount, 1);
  assert.equal(packed.complete, false);
  assert.match(packed.brief, /（无产出）/);
});

test('对账结论 → 决策上下文：findings 与 clean 都正确入 contextRefs', () => {
  const result = reconcile({
    declared: [{ id: 'E1', name: '能导出', required: true }],
    produced: [{ id: 'E1', status: 'passed' }],
  });
  const dp = openReconcileDecision({ result, subject: 'task:1', artifactRef: 'report:R1' });
  assert.equal(dp.kind, 'acceptance');
  assert.equal(dp.status, 'pending');
  assert.ok(dp.contextRefs.some(ref => /没有差异|逐项对上/.test(ref)));

  const notComparable = reconcile({ declared: [{ id: 'E1', name: 'x', required: true }], produced: null });
  const dp2 = openReconcileDecision({ result: notComparable, subject: 'task:2' });
  assert.ok(dp2.contextRefs.some(ref => /无产物可比对/.test(ref)));
  assert.equal(reconcileDecisionRecord({ result: notComparable, subject: 't', decidedBy: 'u' }).outcome, 'not-comparable');
});

test('V4 显式指代：点名任务号唯一接续，点名不唯一或没点返回 null', () => {
  const candidates = [
    { id: 't1', phase: 'running', identifier: 'SUI-123' },
    { id: 't2', phase: 'running', identifier: 'SUI-124' },
  ];
  assert.equal(explicitTaskReference('SUI-123 帮我改一下', candidates)?.id, 't1');
  assert.equal(explicitTaskReference('帮我改一下', candidates), null);
  // SUI-123 不能误匹配 SUI-1234
  const similar = [{ id: 't1', phase: 'running', identifier: 'SUI-123' }, { id: 't2', phase: 'running', identifier: 'SUI-1234' }];
  assert.equal(explicitTaskReference('SUI-123 在吗', similar)?.id, 't1');
});

test('pass-through：多条在办任务 + 点名 → 直接接续，不再 ambiguous', () => {
  const decision = passThroughDecision({
    candidates: [
      { id: 't1', phase: 'running', identifier: 'SUI-123', binding: { senderId: 'u', chatId: 'c' } },
      { id: 't2', phase: 'running', identifier: 'SUI-124', binding: { senderId: 'u', chatId: 'c' } },
    ],
    actor: { id: 'u', chatId: 'c' },
    text: 'SUI-124 加一条说明',
  });
  assert.equal(decision.kind, 'direct');
  assert.equal(decision.taskId, 't2');

  const noRef = passThroughDecision({
    candidates: [
      { id: 't1', phase: 'running', identifier: 'SUI-123', binding: { senderId: 'u', chatId: 'c' } },
      { id: 't2', phase: 'running', identifier: 'SUI-124', binding: { senderId: 'u', chatId: 'c' } },
    ],
    actor: { id: 'u', chatId: 'c' },
    text: '帮我改一下',
  });
  assert.equal(noRef.kind, 'ambiguous');
  assert.equal(noRef.needsTaskReference, true);
});
