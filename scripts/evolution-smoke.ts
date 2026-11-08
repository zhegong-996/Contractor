// 方案 C-6 真跑：沉淀回流 → 交付前强制自查 → 候选改进 → 工程回放闸门 →
// 真人批准 → 版本 / 灰度 / 生效 / 回滚 → 效果对比。
//
// 全程在临时目录的独立治理台账上跑，绝不写真实
// `.runtime/evolution/events.jsonl`、`.runtime/memory/events.jsonl` 或任何
// 已锁定清单 / 权限 / 历史任务；报告落在 `.runtime/evolution-smoke.json`。
// 用法：npm run evolution:smoke
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runtime } from '../src/config.ts';
import { memoryEvent } from '../src/memory-log.ts';
import type { MemoryEvent } from '../src/architecture-contracts.ts';
import {
  EvolutionLedger, FileEvolutionSink, evolutionLogPath, readEvolutionEvents,
  replayEvolution, FORBIDDEN_TARGET_LABELS,
} from '../src/evolution-ledger.ts';
import {
  EvolutionService, evaluateSelfCheck, engineeringGate, aggregateEffects, compareEffects,
  assertDeliverySelfCheck, standardsRevision,
  type EvolutionDeps, type EffectObservation,
} from '../src/evolution.ts';

type Check = { name: string; ok: boolean; detail: Record<string, unknown> };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: Record<string, unknown> = {}) => checks.push({ name, ok, detail });

const dir = mkdtempSync(path.join(tmpdir(), 'suitme-c6-'));
const logFile = evolutionLogPath(dir);
const sealedPlanFile = path.join(dir, 'sealed-plan.json');
writeFileSync(sealedPlanFile, JSON.stringify({ taskId: 'SUI-C6', items: ['必须有截图证据'] }), { mode: 0o600 });
const sealedBefore = readFileSync(sealedPlanFile, 'utf8');

let tick = 0;
const fixedNow = () => `2026-11-08T03:00:${String(tick++).padStart(2, '0')}.000Z`;
let standards = [
  '检查项：缺少截图证据',
  '检查项：预览版本与交付提交不一致',
  '检查项：越权引用了其它空间的资料',
];
let memoryEvents: MemoryEvent[] = [];
let memoryErrors: string[] = [];
let gateEnabled = true;

const ledger = new EvolutionLedger([new FileEvolutionSink(logFile)]);
const deps: EvolutionDeps = {
  standards: () => standards,
  memoryEvents: () => memoryEvents,
  memoryErrors: () => memoryErrors,
  ledger,
  eventsFile: () => logFile,
  now: fixedNow,
  selfCheckGateEnabled: gateEnabled,
  canaryPercent: 20,
};
// 开关可变：让同一 service 能验证「按配置关闭」这一支，不重建台账。
Object.defineProperty(deps, 'selfCheckGateEnabled', { get: () => gateEnabled });
const service = new EvolutionService(deps);
const snapshot = () => replayEvolution(readEvolutionEvents(logFile).events);

const realEvolutionLog = evolutionLogPath();
const realMemoryLog = path.join(runtime('memory'), 'events.jsonl');
const lineCount = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
const realEvolutionBefore = lineCount(realEvolutionLog);
const realMemoryBefore = lineCount(realMemoryLog);

const TASK = 'SUI-C6';
const itemsFor = (list: string[], overrides: Record<number, Partial<{ status: 'passed' | 'failed'; evidence: string }>> = {}) =>
  list.map((standard, i) => ({ standard, status: (overrides[i]?.status ?? 'passed') as 'passed' | 'failed',
    evidence: overrides[i]?.evidence ?? `evidence-${i + 1}` }));

// --- A. 交付前自查闸门 ------------------------------------------------------
{
  const gate = service.deliveryGate(TASK);
  check('A1 有沉淀标准却未自查 → 阻断交付', !gate.ok && gate.gate === 'blocked'
    && gate.standardsCount === 3 && gate.missing.length === 0, { gate: gate.gate, reason: gate.reason });
  let blocked = '';
  try { assertDeliverySelfCheck(TASK, service); } catch (error) { blocked = String(error); }
  check('A2 交付守门点抛中文错误，不先交付再补自查', /交付前自查未通过/.test(blocked)
    && /确认验收/.test(blocked) && snapshot().gatePasses.length === 0, { blocked: blocked.slice(0, 120) });

  service.recordSelfCheck({ taskId: TASK, checks: itemsFor(standards.slice(0, 2)), actor: 'worker-a' });
  const partial = service.deliveryGate(TASK);
  check('A3 自查少一条 → 精确列出缺项', !partial.ok && partial.missing.length === 1
    && partial.missing[0] === standards[2], { missing: partial.missing });

  let emptyEvidence = '';
  try { service.recordSelfCheck({ taskId: TASK,
    checks: itemsFor(standards, { 1: { evidence: '' } }), actor: 'worker-a' }); }
  catch (error) { emptyEvidence = String(error); }
  check('A4 证据为空的自查项直接拒绝登记', emptyEvidence.length > 0, { detail: emptyEvidence.slice(0, 90) });

  service.recordSelfCheck({ taskId: TASK, checks: itemsFor(standards, { 0: { status: 'failed' } }), actor: 'worker-a' });
  const failedGate = service.deliveryGate(TASK);
  check('A5 明确未通过的自查项阻断交付', !failedGate.ok && failedGate.failed.length === 1,
    { failed: failedGate.failed });

  service.recordSelfCheck({ taskId: TASK, checks: itemsFor(standards), actor: 'worker-a' });
  const passed = assertDeliverySelfCheck(TASK, service);
  const stateA = snapshot();
  check('A6 逐条通过且留证据 → 闸门放行并留痕', passed.ok && passed.gate === 'passed'
    && passed.matched.length === 3 && stateA.gatePasses.length === 1, { gate: passed.gate });
  check('A7 自查与放行两类事件 modelCalls 恒为 0', stateA.modelCalls === 0
    && readEvolutionEvents(logFile).events.every(e => e.modelCalls === 0), { events: readEvolutionEvents(logFile).events.length });

  standards = [...standards, '检查项：未标注交付提交号'];
  const stale = service.deliveryGate(TASK);
  check('A8 标准更新后旧自查立即失效（防蒙混）', !stale.ok
    && snapshot().selfChecks[TASK]?.standardsRevision !== stale.standardsRevision
    && /旧标准快照/.test(stale.reason), { reason: stale.reason });

  service.recordSelfCheck({ taskId: TASK, checks: itemsFor(standards), actor: 'worker-a' });
  const refreshed = service.deliveryGate(TASK);
  check('A9 按新快照重新自查后放行', refreshed.ok && refreshed.standardsCount === 4,
    { matched: refreshed.matched.length });

  gateEnabled = false;
  const disabled = evaluateSelfCheck({ taskId: TASK, standards, run: null, enabled: false });
  check('A10 按配置关闭闸门仍如实标 gate=disabled', disabled.ok && disabled.gate === 'disabled'
    && /最终验收/.test(disabled.reason), { reason: disabled.reason });
  gateEnabled = true;
  const none = evaluateSelfCheck({ taskId: TASK, standards: [], run: null, enabled: true });
  check('A11 无沉淀标准时无项可比，不逼造自查', none.ok && none.gate === 'no-standards',
    { reason: none.reason });
}

// --- B. 候选改进闭环 --------------------------------------------------------
const cleanEvents = (count: number, modelCalls = 0): MemoryEvent[] => Array.from({ length: count }, (_, i) =>
  memoryEvent({ kind: 'source-ingested', actor: 'smoke', at: `2026-11-08T02:00:0${i}.000Z`,
    idempotencyKey: `c6-src-${i}`, sourceRef: { sourceId: `src-${i}`, revision: 'r1' },
    modelCalls: i === 0 ? modelCalls : 0, payload: { taskId: TASK, text: `证据 ${i}` } }));
memoryEvents = cleanEvents(3);
memoryErrors = [];

const p1 = service.propose({ title: '交付前补截图证据', reason: '逐项评审打回：缺少截图证据',
  sourceTaskId: TASK, sourceRound: 2, actor: 'worker-a' });
check('B1 打回原因沉淀为候选改进', p1.state === 'proposed', { state: p1.state, id: p1.id });

const forbidden = service.propose({ title: '自动放宽权限', reason: '想让助手自己改清单',
  sourceTaskId: TASK, sourceRound: 3, targets: ['sealed-acceptance-plan'], actor: 'worker-a' });
const forbiddenState = snapshot();
check('B2 触碰已锁定清单的候选直接拒绝并留违规痕', forbidden.state === 'rejected'
  && forbiddenState.violations.some(v => v.includes(FORBIDDEN_TARGET_LABELS['sealed-acceptance-plan'])),
  { state: forbidden.state, violations: forbiddenState.violations.length });

const gate1 = service.gate(p1.id);
check('B3 工程闸门用既有共享现场做确定性回放验证', gate1.passed && gate1.replayTwiceEqual
  && gate1.sourceEvents === 3 && gate1.modelCalls === 0 && gate1.state === 'gate-passed',
  { checksum: gate1.replayChecksum.slice(0, 12), checks: gate1.checks.length });

check('B4 空回放证据不放行', !engineeringGate({ candidate: { title: 'x', reason: '打回',
  sourceTaskId: TASK, sourceRound: 1, targets: [] }, events: [] }).passed);
check('B5 回放输入有坏行不放行', !engineeringGate({ candidate: { title: 'x', reason: '打回',
  sourceTaskId: TASK, sourceRound: 1, targets: [] }, events: memoryEvents,
  logErrors: ['line 1: bad'] }).passed);
check('B6 回放链含模型调用不放行（C-P3 红线）', !engineeringGate({ candidate: { title: 'x',
  reason: '打回', sourceTaskId: TASK, sourceRound: 1, targets: [] },
  events: cleanEvents(2, 1) }).passed);
check('B7 候选缺来源任务 / 触碰禁改对象不放行',
  !engineeringGate({ candidate: { title: 'x', reason: '打回', sourceTaskId: '', sourceRound: 1,
    targets: [] }, events: memoryEvents }).passed
  && !engineeringGate({ candidate: { title: 'x', reason: '打回', sourceTaskId: TASK,
    sourceRound: 1, targets: ['human-signature'] }, events: memoryEvents }).passed);

service.review({ id: p1.id, decision: 'approved', reason: 'Agent 自批试探', actor: 'worker-a', actorType: 'agent' });
check('B8 Agent 自己批准被拦并留痕，状态不前进', snapshot().candidates[p1.id]?.state === 'gate-passed'
  && snapshot().violations.some(v => /Agent 不能自己让改进生效/.test(v)), { state: snapshot().candidates[p1.id]?.state });

const p2 = service.propose({ title: '未过闸门就想批准', reason: '异常：预览版本不一致',
  sourceTaskId: TASK, sourceRound: 4, actor: 'worker-a' });
service.review({ id: p2.id, decision: 'approved', reason: '跳过工程闸门', actor: 'owner-a', actorType: 'human' });
check('B9 跳过工程闸门不得批准', snapshot().candidates[p2.id]?.state === 'proposed'
  && snapshot().violations.some(v => /未通过工程闸门/.test(v)), { state: snapshot().candidates[p2.id]?.state });

service.review({ id: p1.id, decision: 'approved', reason: '真人核可改进范围', actor: 'owner-a', actorType: 'human' });
check('B10 真人批准 → approved', snapshot().candidates[p1.id]?.state === 'approved'
  && snapshot().candidates[p1.id]?.reviewedBy === 'owner-a');

let agentRollout = '';
try { service.handle('improvement-rollout', { candidateId: p1.id, phase: 'active' },
  { admin: false, agent: 'worker-a' }); } catch (error) { agentRollout = String(error); }
check('B11 非真人主体让改进生效被服务层直接拒绝', /只有组织级真人负责人/.test(agentRollout),
  { detail: agentRollout.slice(0, 90) });

const p3 = service.propose({ title: '无人审直接灰度', reason: '异常：越权引用',
  sourceTaskId: TASK, sourceRound: 5, actor: 'worker-a' });
service.gate(p3.id);
service.rollout({ id: p3.id, phase: 'canary', actor: 'owner-a', actorType: 'human' });
check('B12 未经真人批准不得灰度', snapshot().candidates[p3.id]?.state === 'gate-passed'
  && snapshot().violations.some(v => /未经真人批准/.test(v)), { state: snapshot().candidates[p3.id]?.state });

const canary = service.rollout({ id: p1.id, phase: 'canary', actor: 'owner-a', actorType: 'human' });
check('B13 真人灰度 20% 并带可回滚版本号', canary.state === 'canary'
  && snapshot().candidates[p1.id]?.canaryPercent === 20 && !!canary.version,
  { version: canary.version, percent: snapshot().candidates[p1.id]?.canaryPercent });
const active = service.rollout({ id: p1.id, phase: 'active', version: canary.version,
  actor: 'owner-a', actorType: 'human' });
check('B14 生效版本进入台账，不写任何生产配置', active.state === 'active'
  && snapshot().activeVersion === canary.version && readFileSync(sealedPlanFile, 'utf8') === sealedBefore,
  { activeVersion: snapshot().activeVersion });
check('B15 生效不改写自查标准文件与已锁定清单', standards.length === 4
  && readFileSync(sealedPlanFile, 'utf8') === sealedBefore);

service.rollout({ id: p1.id, phase: 'rolled-back', version: canary.version,
  reason: '灰度后返工率上升，真人决定回滚', actor: 'owner-a', actorType: 'human' });
const rolled = snapshot();
check('B16 真人回滚：状态、原因与生效版本都如实回退', rolled.candidates[p1.id]?.state === 'rolled-back'
  && rolled.activeVersion === null && /返工率/.test(rolled.candidates[p1.id]?.rollbackReason ?? ''),
  { state: rolled.candidates[p1.id]?.state, activeVersion: rolled.activeVersion });

const dupPropose = service.propose({ title: '重复登记', reason: '逐项评审打回：缺少截图证据',
  sourceTaskId: TASK, sourceRound: 2, actor: 'worker-a' });
const dupGate = service.gate(p1.id);
check('B17 重复业务动作按幂等键去重，历史不回溯改写',
  dupPropose.result.duplicate === true && dupGate.append.duplicate === true
  && snapshot().candidates[p1.id]?.state === 'rolled-back',
  { proposeDuplicate: dupPropose.result.duplicate, gateDuplicate: dupGate.append.duplicate });
// 直接追加两条绕过 idempotencyKey 的同类事件，验证状态机本身也会拒绝并留痕。
ledger.append({ kind: 'improvement-proposed', actor: 'worker-a', actorType: 'agent',
  taskId: TASK, candidateId: p1.id, idempotencyKey: 'forced-duplicate-propose',
  payload: { candidateId: p1.id, title: '重复登记', reason: '重复登记试探', targets: [] } });
ledger.append({ kind: 'gate-evaluated', actor: 'system', actorType: 'system', candidateId: p1.id,
  idempotencyKey: 'forced-duplicate-gate',
  payload: { candidateId: p1.id, passed: true, checks: [{ id: 'has-reason', ok: true, note: 'ok' }] } });
check('B18 状态机拒绝重复登记与重复闸门，且候选状态不被改写',
  snapshot().violations.some(v => /重复登记/.test(v))
  && snapshot().violations.some(v => /重复跑工程闸门/.test(v))
  && snapshot().candidates[p1.id]?.state === 'rolled-back', { violations: snapshot().violations.length });

// --- C. 效果对比 ------------------------------------------------------------
const before: EffectObservation[] = [
  { taskId: 'T1', judgedItems: 5, passedItems: 3, reworkRounds: 2, modelCalls: 10, humanInterrupts: 4 },
  { taskId: 'T2', judgedItems: 5, passedItems: 4, reworkRounds: 1, modelCalls: 8, humanInterrupts: 3 },
];
const after: EffectObservation[] = [
  { taskId: 'T3', judgedItems: 5, passedItems: 5, reworkRounds: 0, modelCalls: 4, humanInterrupts: 1 },
  { taskId: 'T4', judgedItems: 5, passedItems: 5, reworkRounds: 0, modelCalls: 4, humanInterrupts: 1 },
];
const beforeMetrics = aggregateEffects(before);
const afterMetrics = aggregateEffects(after);
check('C1 四项指标确定性聚合', beforeMetrics.comparable && beforeMetrics.sampleSize === 2
  && beforeMetrics.passRate === 0.7 && beforeMetrics.reworkRate === 1.5
  && beforeMetrics.costPerTask === 9 && beforeMetrics.humanInterrupts === 7
  && beforeMetrics.modelCalls === 0, { passRate: beforeMetrics.passRate, costPerTask: beforeMetrics.costPerTask });

const comparison = compareEffects(beforeMetrics, afterMetrics);
const verdict = (id: string) => comparison.rows.find(r => r.id === id)?.verdict;
check('C2 通过率↑ / 返工率↓ / 成本↓ / 被打断↓ 均判为变好', comparison.comparable
  && verdict('passRate') === 'improved' && verdict('reworkRate') === 'improved'
  && verdict('costPerTask') === 'improved' && verdict('humanInterrupts') === 'improved',
  { rows: comparison.rows.map(r => `${r.id}:${r.verdict}`) });
check('C3 反向变化判为变差并提示人审回滚',
  compareEffects(afterMetrics, beforeMetrics).rows.filter(r => r.verdict === 'regressed').length === 4);

const missingInterrupts = aggregateEffects([
  { taskId: 'T5', judgedItems: 2, passedItems: 2, reworkRounds: 0, modelCalls: 1 },
]);
check('C4 人被打断次数缺观测 → 如实不可比，不补零', !missingInterrupts.comparable
  && missingInterrupts.humanInterrupts === null
  && missingInterrupts.missing.some(m => m.includes('人被打断次数')), { missing: missingInterrupts.missing });
const noJudged = aggregateEffects([{ taskId: 'T6', judgedItems: 0, passedItems: 0,
  reworkRounds: 0, modelCalls: 0, humanInterrupts: 0 }]);
check('C5 无逐项判定 → 通过率 null，不编造 100%', noJudged.passRate === null && !noJudged.comparable);
let badObservation = '';
try { aggregateEffects([{ taskId: 'T7', judgedItems: 1, passedItems: 2,
  reworkRounds: 0, modelCalls: 0 } as EffectObservation]); } catch (error) { badObservation = String(error); }
check('C6 通过项多于判定项的观测被拒绝', badObservation.length > 0);

service.measure({ window: 'before', observations: before, actor: 'inspection-agent' });
service.measure({ window: 'after', observations: after, actor: 'inspection-agent' });
const view = service.view();
check('C7 前后窗口登记后视图给出四项对比', !!view.effectComparison
  && view.effectComparison!.rows.length === 4 && view.effectWindows.includes('before')
  && view.effectWindows.includes('after'), { windows: view.effectWindows });
check('C8 观测不齐时对比不可比且逐项说明不编造数字',
  !compareEffects(beforeMetrics, missingInterrupts).comparable
  && compareEffects(beforeMetrics, missingInterrupts).rows.some(r => r.delta === null && /不编造数字/.test(r.note)));

// --- D. 台账完整性、红线与真实数据零副作用 ---------------------------------
{
  const events = readEvolutionEvents(logFile).events;
  const first = replayEvolution(events), second = replayEvolution(events);
  check('D1 台账两次重放 checksum 逐字节一致', first.checksum === second.checksum,
    { checksum: first.checksum.slice(0, 16) });
  appendFileSync(logFile, '{broken json\n', { mode: 0o600 });
  const broken = readEvolutionEvents(logFile);
  check('D2 台账坏行如实记 errors，绝不静默丢弃', broken.errors.length === 1
    && service.view().logErrors.length === 1, { errors: broken.errors });
  check('D3 所有治理事件 modelCalls 恒为 0（C-P3）',
    broken.events.every(e => e.modelCalls === 0) && view.modelCalls === 0, { events: broken.events.length });
  check('D4 中文红线三条完整呈现', view.redLines.length === 3
    && view.redLines.some(r => r.includes('不能自己让改进生效'))
    && view.redLines.some(r => r.includes('不改写已锁定')), { redLines: view.redLines });
  check('D5 视图如实暴露越权尝试留痕', view.violations.length > 0,
    { violations: view.violations.length });
  check('D6 真实治理台账行数前后不变', lineCount(realEvolutionLog) === realEvolutionBefore,
    { before: realEvolutionBefore, after: lineCount(realEvolutionLog) });
  check('D7 真实 B1 记忆主干行数前后不变（独立台账不污染重放）',
    lineCount(realMemoryLog) === realMemoryBefore,
    { before: realMemoryBefore, after: lineCount(realMemoryLog) });
  check('D8 已锁定清单字节未变（生效不等于自动改写）',
    readFileSync(sealedPlanFile, 'utf8') === sealedBefore);
}

const failed = checks.filter(c => !c.ok).map(c => c.name);
const report = {
  ok: failed.length === 0,
  note: '隔离临时台账真跑；未写真实 .runtime/evolution/events.jsonl 与 .runtime/memory/events.jsonl，未改写已锁定清单 / 权限 / 人签 / 历史任务',
  checks: checks.length, failed, details: checks,
  realLogs: { evolutionBefore: realEvolutionBefore, evolutionAfter: lineCount(realEvolutionLog),
    memoryBefore: realMemoryBefore, memoryAfter: lineCount(realMemoryLog) },
  at: '2026-11-08T03:00:00.000Z',
};
const out = path.join(runtime(), 'evolution-smoke.json');
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failed, report: path.relative(runtime(), out) }, null, 2));
rmSync(dir, { recursive: true, force: true });
if (failed.length) process.exitCode = 1;
