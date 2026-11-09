// AI 原生协作核心 + 成本闸 + 证据口径（对齐 dsh-superagent / lobehub acceptance，借概念）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { delegate, narrowMandate, narrowBudget, makeHandoff, handoffValid, ROLE_SPECS, type Assignment } from '../src/agent-delegation.ts';
import { budgetStatus, withinBudget, DEFAULT_ACCEPTANCE_BUDGET } from '../src/acceptance-budget.ts';
import { isProgrammaticGate, requiredEvidenceSatisfied, comparisonComplete } from '../src/acceptance-evidence.ts';

test('Agent 委托 Agent：授权范围不可变，子委托不得越权', () => {
  const parent = { scope: ['/repo/app'], grant: 'edit' } as const;
  assert.equal(narrowMandate(parent, { scope: ['/repo/app'], grant: 'edit' }).ok, true);
  assert.equal(narrowMandate(parent, { scope: ['/repo/app', '/etc'], grant: 'edit' }).ok, false, '范围超出父');
  assert.equal(narrowMandate(parent, { scope: ['/repo/app'], grant: 'full' }).ok, false, 'grant 高于父');
});

test('Agent 委托 Agent：预算只减不增，深度超过 8 层熔断', () => {
  assert.equal(narrowBudget({ maxContextChars: 10000, maxToolCalls: 10, maxDurationMs: 1000 }, { maxContextChars: 20000, maxToolCalls: 5, maxDurationMs: 500 }).ok, false);
  let seq = 0;
  const makeId = () => `a${++seq}`;
  const root = delegate({ task: '筹备活动', role: 'coordinator', mandate: { scope: [], grant: 'full' }, budget: ROLE_SPECS.coordinator.budget }, makeId);
  assert.equal(root.ok, true);
  // 向下委托到第 9 层应熔断
  let current = (root as { assignment: Assignment }).assignment;
  let fused = false;
  for (let i = 0; i < 10 && !fused; i++) {
    const r = delegate({ task: '子任务', parent: current, role: 'worker', mandate: { scope: [], grant: 'edit' }, budget: ROLE_SPECS.worker.budget }, makeId);
    if (!r.ok) { fused = r.state === 'fused'; break; }
    current = r.assignment;
  }
  assert.equal(fused, true, '第 9 层应熔断');
});

test('acquire-once handoff：修订变了即失效，路径不是复用', () => {
  const h = makeHandoff('worker-1', '已确认端口是 4200', 'PROJECT.md@r1', 'r1');
  assert.equal(handoffValid(h, 'r1'), true);
  assert.equal(handoffValid(h, 'r2'), false, '修订变了，旧事实失效需重新获取');
  assert.match(h.facts, /4200/);
});

test('成本闸：green/yellow/red 三档，red 只留证不 pass', () => {
  assert.equal(budgetStatus({ images: 5, tokens: 1000, durationMs: 1000 }, DEFAULT_ACCEPTANCE_BUDGET).tier, 'green');
  assert.equal(budgetStatus({ images: 19, tokens: 1000, durationMs: 1000 }, DEFAULT_ACCEPTANCE_BUDGET).tier, 'yellow');
  const red = budgetStatus({ images: 21, tokens: 1000, durationMs: 1000 }, DEFAULT_ACCEPTANCE_BUDGET);
  assert.equal(red.tier, 'red');
  assert.equal(red.blocked, true, 'red 必须阻断');
  assert.match(red.reason, /blocked/);
  assert.equal(withinBudget({ images: 21, tokens: 0, durationMs: 0 }, DEFAULT_ACCEPTANCE_BUDGET).ok, false);
});

test('HARD RULE：程序 gate 永远不是验收检查', () => {
  assert.equal(isProgrammaticGate({ title: '单测通过', method: 'run pnpm test' }), true);
  assert.equal(isProgrammaticGate({ title: '类型检查', method: 'tsc --noEmit' }), true);
  assert.equal(isProgrammaticGate({ title: 'CI 绿了' }), true);
  assert.equal(isProgrammaticGate({ title: '覆盖率 90%' }), true);
  assert.equal(isProgrammaticGate({ title: '用户点登录后能看到主页' }), false);
  assert.equal(isProgrammaticGate({ title: '切换主题后按钮颜色变化', method: '人工观察' }), false);
});

test('requiredEvidence 强制 uncertain：声明了证据类型缺了就不 pass', () => {
  assert.equal(requiredEvidenceSatisfied(['screenshot'], ['screenshot']).satisfied, true);
  const missing = requiredEvidenceSatisfied(['screenshot', 'recording'], ['screenshot']);
  assert.equal(missing.satisfied, false);
  assert.deepEqual(missing.missing, ['recording']);
});

test('before/after 对比：只有 after 不能证明替换了旧状态', () => {
  assert.equal(comparisonComplete({ before: 'a.png', after: 'b.png', sameView: true }).ok, true);
  assert.equal(comparisonComplete(undefined).ok, false);
  assert.equal(comparisonComplete({ before: '', after: 'b.png', sameView: true }).ok, false);
  assert.equal(comparisonComplete({ before: 'a.png', after: 'b.png', sameView: false }).ok, false);
});
