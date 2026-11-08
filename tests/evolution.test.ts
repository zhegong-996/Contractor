// 方案 C-6 · 沉淀回流与自演进闭环的契约：
// 交付前逐条自查强制比对、工程闸门确定性回放、真人批准才生效、可回滚、
// 效果缺数据不可比、独立台账不污染 B1 主干、各处接线不漂移。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configSchema } from '../src/config.ts';
import { memoryEvent } from '../src/memory-log.ts';
import type { MemoryEvent } from '../src/architecture-contracts.ts';
import {
  evolutionEvent, evolutionEventSchema, evolutionLogPath, EvolutionLedger,
  FileEvolutionSink, readEvolutionEvents, replayEvolution,
  FORBIDDEN_CHANGE_TARGETS,
} from '../src/evolution-ledger.ts';
import {
  evaluateSelfCheck, standardsRevision, engineeringGate, aggregateEffects, compareEffects,
  EvolutionService, assertDeliverySelfCheck, SELF_CHECK_RED_LINES,
  type EvolutionDeps, type SelfCheckRun,
} from '../src/evolution.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const standards = ['检查项：缺少截图证据', '检查项：预览版本不一致'];
const items = (list = standards) => list.map((standard, i) => ({ standard,
  status: 'passed' as const, evidence: `evidence-${i}` }));
const run = (list = standards, revision = standardsRevision(list)): SelfCheckRun => ({
  taskId: 'SUI-C6', standardsRevision: revision, checks: items(list),
  at: '2026-11-08T03:00:00.000Z', actor: 'worker-a',
});
const cleanEvents = (): MemoryEvent[] => Array.from({ length: 2 }, (_, i) => memoryEvent({
  kind: 'source-ingested', actor: 'test', at: `2026-11-08T03:00:0${i}.000Z`,
  idempotencyKey: `evo-test-${i}`, sourceRef: { sourceId: `src-${i}`, revision: 'r1' },
  modelCalls: 0, payload: { taskId: 'SUI-C6' },
}));

test('标准快照稳定且与顺序无关，产出方不能自己声明版本', () => {
  assert.equal(standardsRevision(standards), standardsRevision([...standards].reverse()));
  assert.notEqual(standardsRevision(standards), standardsRevision([...standards, '新增标准']));
});

test('有沉淀标准却没自查：阻断交付并给中文原因', () => {
  const gate = evaluateSelfCheck({ taskId: 'SUI-C6', standards });
  assert.equal(gate.ok, false);
  assert.equal(gate.gate, 'blocked');
  assert.equal(gate.standardsCount, 2);
  assert.match(gate.reason, /还没有交付前自查记录/);
  assert.equal(gate.modelCalls, 0);
});

test('缺条 / 未通过 / 无证据 / 旧快照四种情况都不得放行', () => {
  const missing = evaluateSelfCheck({ taskId: 'SUI-C6', standards,
    run: run(standards.slice(0, 1), standardsRevision(standards)) });
  assert.deepEqual(missing.missing, [standards[1]]);
  assert.equal(missing.ok, false);
  const failed = evaluateSelfCheck({ taskId: 'SUI-C6', standards, run: {
    ...run(), checks: items().map((x, i) => i === 0 ? { ...x, status: 'failed' } : x) } });
  assert.deepEqual(failed.failed, [standards[0]]);
  const weak = evaluateSelfCheck({ taskId: 'SUI-C6', standards, run: {
    ...run(), checks: items().map((x, i) => i === 0 ? { ...x, evidence: '' } : x) } });
  assert.deepEqual(weak.weakEvidence, [standards[0]]);
  const stale = evaluateSelfCheck({ taskId: 'SUI-C6', standards,
    run: run(standards, 'old-revision') });
  assert.match(stale.reason, /旧标准快照/);
});

test('逐条通过且留证据才允许交付，放行不等于验收', () => {
  const gate = evaluateSelfCheck({ taskId: 'SUI-C6', standards, run: run() });
  assert.equal(gate.ok, true);
  assert.equal(gate.gate, 'passed');
  assert.equal(gate.matched.length, 2);
  assert.match(gate.reason, /最终验收仍由原发起人确认/);
  assert.equal(evaluateSelfCheck({ taskId: 'SUI-C6', standards: [], run: null }).gate, 'no-standards');
  assert.equal(evaluateSelfCheck({ taskId: 'SUI-C6', standards, run: null, enabled: false }).gate, 'disabled');
});

test('工程闸门复用既有共享现场回放：两次一致、零模型调用、无坏行才通过', () => {
  const result = engineeringGate({ candidate: { title: '补截图', reason: '打回：缺截图',
    sourceTaskId: 'SUI-C6', sourceRound: 1, targets: [] }, events: cleanEvents() });
  assert.equal(result.passed, true);
  assert.equal(result.replayTwiceEqual, true);
  assert.equal(result.modelCalls, 0);
  assert.ok(result.replayChecksum.length > 0);
  const bad = [
    engineeringGate({ candidate: { title: 'x', reason: '打回', sourceTaskId: 'SUI-C6',
      sourceRound: 1, targets: [] }, events: [] }),
    engineeringGate({ candidate: { title: 'x', reason: '打回', sourceTaskId: 'SUI-C6',
      sourceRound: 1, targets: [] }, events: cleanEvents(), logErrors: ['line 1: bad'] }),
    engineeringGate({ candidate: { title: 'x', reason: '', sourceTaskId: 'SUI-C6',
      sourceRound: 1, targets: [] }, events: cleanEvents() }),
    engineeringGate({ candidate: { title: 'x', reason: '打回', sourceTaskId: '',
      sourceRound: 1, targets: [] }, events: cleanEvents() }),
    engineeringGate({ candidate: { title: 'x', reason: '打回', sourceTaskId: 'SUI-C6',
      sourceRound: 1, targets: [FORBIDDEN_CHANGE_TARGETS[0]] }, events: cleanEvents() }),
  ];
  assert.ok(bad.every(r => !r.passed), '五种不合格回放输入都必须拦截');
});

test('治理事件强制 modelCalls=0，坏行不静默丢弃', () => {
  const event = evolutionEvent({ kind: 'effect-measured', actor: 'system', actorType: 'system',
    at: '2026-11-08T03:00:00.000Z', payload: { window: 'before' } });
  assert.equal(event.modelCalls, 0);
  assert.throws(() => evolutionEventSchema.parse({ ...event, modelCalls: 1 }));
});

test('状态机：Agent 自己批准被拦，真人批准 → 灰度 → 生效 → 回滚全程可追溯', () => {
  const at = (n: number) => `2026-11-08T03:00:${String(n).padStart(2, '0')}.000Z`;
  const id = 'cand-1';
  const events = [
    evolutionEvent({ kind: 'improvement-proposed', actor: 'worker', actorType: 'agent', at: at(1),
      candidateId: id, payload: { candidateId: id, title: '补截图', reason: '打回：缺截图',
        sourceTaskId: 'SUI-C6', sourceRound: 1, targets: [] } }),
    evolutionEvent({ kind: 'gate-evaluated', actor: 'system', actorType: 'system', at: at(2),
      candidateId: id, payload: { candidateId: id, passed: true,
        checks: [{ id: 'has-reason', ok: true, note: 'ok' }] } }),
    evolutionEvent({ kind: 'human-reviewed', actor: 'worker', actorType: 'agent', at: at(3),
      candidateId: id, payload: { candidateId: id, decision: 'approved' } }),
    evolutionEvent({ kind: 'human-reviewed', actor: 'owner', actorType: 'human', at: at(4),
      candidateId: id, payload: { candidateId: id, decision: 'approved' } }),
    evolutionEvent({ kind: 'rollout-changed', actor: 'owner', actorType: 'human', at: at(5),
      candidateId: id, payload: { candidateId: id, phase: 'canary', version: 'v1', canaryPercent: 20 } }),
    evolutionEvent({ kind: 'rollout-changed', actor: 'owner', actorType: 'human', at: at(6),
      candidateId: id, payload: { candidateId: id, phase: 'active', version: 'v1' } }),
    evolutionEvent({ kind: 'rollout-changed', actor: 'owner', actorType: 'human', at: at(7),
      candidateId: id, payload: { candidateId: id, phase: 'rolled-back', version: 'v1',
        reason: '效果变差' } }),
  ];
  const state = replayEvolution(events);
  assert.equal(state.candidates[id]?.state, 'rolled-back');
  assert.equal(state.activeVersion, null);
  assert.equal(state.candidates[id]?.reviewedBy, 'owner');
  assert.equal(state.candidates[id]?.history.length, 6);
  assert.ok(state.violations.some(v => /Agent 不能自己让改进生效/.test(v)));
  assert.equal(state.checksum, replayEvolution(events).checksum);
  assert.equal(state.modelCalls, 0);
});

test('状态机：触碰四类禁改对象的候选直接拒绝，跳过闸门不得批准或灰度', () => {
  const at = (n: number) => `2026-11-08T03:00:${String(n).padStart(2, '0')}.000Z`;
  const forbidden = replayEvolution([evolutionEvent({ kind: 'improvement-proposed', actor: 'a',
    actorType: 'agent', at: at(1), candidateId: 'c-x', payload: { candidateId: 'c-x', title: 'x',
      reason: '打回', sourceTaskId: 'SUI-C6', sourceRound: 1,
      targets: ['sealed-acceptance-plan', 'human-signature'] } })]);
  assert.equal(forbidden.candidates['c-x']?.state, 'rejected');
  assert.ok(forbidden.violations.some(v => /已锁定的验收清单/.test(v)));
  const skipped = replayEvolution([
    evolutionEvent({ kind: 'improvement-proposed', actor: 'a', actorType: 'agent', at: at(1),
      candidateId: 'c-y', payload: { candidateId: 'c-y', title: 'y', reason: '打回',
        sourceTaskId: 'SUI-C6', sourceRound: 1, targets: [] } }),
    evolutionEvent({ kind: 'human-reviewed', actor: 'owner', actorType: 'human', at: at(2),
      candidateId: 'c-y', payload: { candidateId: 'c-y', decision: 'approved' } }),
    evolutionEvent({ kind: 'rollout-changed', actor: 'owner', actorType: 'human', at: at(3),
      candidateId: 'c-y', payload: { candidateId: 'c-y', phase: 'active', version: 'v9' } }),
  ]);
  assert.equal(skipped.candidates['c-y']?.state, 'proposed');
  assert.equal(skipped.activeVersion, null);
  assert.ok(skipped.violations.some(v => /未通过工程闸门/.test(v)));
});

test('效果四项指标：缺观测如实不可比，方向判定不靠模型', () => {
  const before = aggregateEffects([
    { taskId: 'T1', judgedItems: 5, passedItems: 3, reworkRounds: 2, modelCalls: 10, humanInterrupts: 4 },
    { taskId: 'T2', judgedItems: 5, passedItems: 4, reworkRounds: 1, modelCalls: 8, humanInterrupts: 3 },
  ]);
  const after = aggregateEffects([
    { taskId: 'T3', judgedItems: 5, passedItems: 5, reworkRounds: 0, modelCalls: 4, humanInterrupts: 1 },
  ]);
  assert.equal(before.passRate, 0.7);
  assert.equal(before.costPerTask, 9);
  assert.equal(before.modelCalls, 0);
  const comparison = compareEffects(before, after);
  assert.equal(comparison.comparable, true);
  assert.deepEqual(comparison.rows.map(r => r.verdict), ['improved', 'improved', 'improved', 'improved']);
  assert.equal(comparison.modelCalls, 0);
  const missing = aggregateEffects([{ taskId: 'T4', judgedItems: 1, passedItems: 1,
    reworkRounds: 0, modelCalls: 1 }]);
  assert.equal(missing.comparable, false);
  assert.equal(missing.humanInterrupts, null);
  assert.ok(missing.missing.some(m => m.includes('人被打断次数')));
  assert.throws(() => aggregateEffects([{ taskId: 'T5', judgedItems: 1, passedItems: 2,
    reworkRounds: 0, modelCalls: 0 }]));
});

test('服务层端到端：登记自查 → 闸门放行 → 视图给出中文红线与放行次数', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-evo-test-'));
  const file = evolutionLogPath(dir);
  let tick = 0;
  const deps: EvolutionDeps = {
    standards: () => standards, memoryEvents: () => cleanEvents(), memoryErrors: () => [],
    ledger: new EvolutionLedger([new FileEvolutionSink(file)]), eventsFile: () => file,
    now: () => `2026-11-08T03:01:${String(tick++).padStart(2, '0')}.000Z`,
    selfCheckGateEnabled: true, canaryPercent: 20,
  };
  try {
    const service = new EvolutionService(deps);
    assert.throws(() => assertDeliverySelfCheck('SUI-C6', service), /交付前自查未通过/);
    service.recordSelfCheck({ taskId: 'SUI-C6', checks: items(), actor: 'worker-a' });
    const gate = assertDeliverySelfCheck('SUI-C6', service);
    assert.equal(gate.gate, 'passed');
    const view = service.view();
    assert.equal(view.standardsCount, 2);
    assert.equal(view.selfCheckRuns, 1);
    assert.equal(view.gatePasses, 1);
    assert.deepEqual(view.redLines, [...SELF_CHECK_RED_LINES]);
    assert.equal(view.modelCalls, 0);
    assert.equal(view.logErrors.length, 0);
    assert.equal(readEvolutionEvents(file).events.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('配置：默认强制自查闸门、灰度 20%，红线不提供关闭开关', () => {
  const config = read('src/config.ts');
  const parsed = configSchema.parse({ paperclipUrl: 'http://127.0.0.1:3100', repository: 'test/repo',
    checkout: '/tmp/x', allowedPaths: ['pilot/'], agents: {}, defaultAgent: 'manual',
    feishu: { profile: 'test' } });
  assert.equal(parsed.evolution.selfCheckGate.enabled, true);
  assert.equal(parsed.evolution.canaryPercent, 20);
  assert.doesNotMatch(config, /evolution:[\s\S]{0,600}requireHumanReview/);
  assert.match(config, /不提供配置项/);
});

test('接线：交付守门、v06 只读白名单、控制台与脚本入口都不漂移', () => {
  const controller = read('src/controller.ts');
  assert.match(controller, /assertDeliverySelfCheck\(id, new EvolutionService\(defaultEvolutionDeps\(this\.config\)\)\)/);
  assert.ok(controller.indexOf('assertDeliverySelfCheck(id') < controller.indexOf('this.github.publish(task)'),
    '自查闸门必须在真正交付之前');
  assert.match(read('src/v06.ts'), /isEvolutionAction\(action\)/);
  assert.match(read('src/v06.ts'), /setEvolution\(/);
  assert.match(read('src/server.ts'), /\.setEvolution\(V06Services\.evolutionWithConfig\(config\)\)/);
  assert.match(read('src/server.ts'), /'evolution-view','execution-view'\]/);
  assert.match(read('scripts/console-server.ts'), /'v06-evolution-view'/);
  const app = read('console/app.js');
  // P-12：Vue 前端以「沉淀与自演进」卡片呈现（EP descriptions）。
  assert.match(app, /沉淀与自演进/);
  assert.match(app, /safe\('v06-evolution-view'\)/);
  assert.match(app, /交付前自查/);
  assert.match(read('package.json'), /"evolution:smoke": "node --import tsx scripts\/evolution-smoke\.ts"/);
});
