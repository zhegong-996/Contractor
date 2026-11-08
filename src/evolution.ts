// 方案 C-6 · 沉淀回流与自演进闭环（C-P4）。
//
// 一句话：打回原因沉淀成自查标准 → 下次交付前由确定性工程闸门逐条比对 →
// 异常再沉淀为候选改进 → 工程闸门用既有共享现场回放验证 → 真人批准 →
// 版本 / 灰度 / 生效 / 可回滚 → 效果对比（通过率、返工率、单任务成本、人被打断次数）。
//
// 三条不可越过的线：
//   1. 工程层 `modelCalls=0`，不调用任何模型；AI 层只接工程层判不准的少数。
//   2. Agent 可以提出改进，不能自己批准、不能自己让改进生效，也不能改写
//      已锁定清单 / 权限规则 / 人签红线 / 历史任务。
//   3. 闸门放行只代表「允许交付」，最终验收仍是原发起人在原会话「确认验收」。
//
// 本文件只做确定性计算与服务编排；状态迁移的守门在 `evolution-ledger.ts`。
import { z } from 'zod';
import { loadConfig, runtime, type Config } from './config.ts';
import { readSelfCheck } from './acceptance-report.ts';
import { readBridgedEvents } from './memory-log.ts';
import { memoryReplayReport } from './memory-projections.ts';
import type { MemoryEvent } from './architecture-contracts.ts';
import {
  EvolutionLedger, getEvolutionLedger, evolutionLogPath, readEvolutionEvents,
  replayEvolution, contentRevision, candidateId, FORBIDDEN_CHANGE_TARGETS,
  FORBIDDEN_TARGET_LABELS,
  type EvolutionState, type SelfCheckCheck, type CandidateState,
} from './evolution-ledger.ts';

export const SELF_CHECK_RED_LINES = [
  '自查标准由打回原因沉淀，不改写已锁定的验收清单',
  '交付闸门只是工程层放行，不替代原发起人在原会话确认验收',
  'Agent 可以提出改进，不能自己让改进生效',
] as const;

export const IMPROVEMENT_STATE_LABELS: Record<string, string> = {
  proposed: '已提出，待工程回放验证', 'gate-failed': '工程闸门未通过',
  'gate-passed': '回放验证通过，待真人批准', approved: '真人已批准，待灰度',
  canary: '灰度中', active: '已生效', 'rolled-back': '已回滚', rejected: '已拒绝',
};

// --- 交付前自查闸门 ---------------------------------------------------------

export const selfCheckItemSchema = z.object({
  standard: z.string().min(1).max(500),
  status: z.enum(['passed', 'failed']),
  evidence: z.string().min(1).max(1000),
}).strict();
export type SelfCheckItem = z.infer<typeof selfCheckItemSchema>;

export interface SelfCheckRun {
  taskId: string; standardsRevision: string; checks: SelfCheckItem[]; at: string; actor: string;
}

export interface DeliveryGateResult {
  ok: boolean;
  gate: 'disabled' | 'no-standards' | 'blocked' | 'passed';
  reason: string;
  standardsCount: number;
  standardsRevision: string;
  matched: string[];
  missing: string[];
  failed: string[];
  weakEvidence: string[];
  modelCalls: 0;
}

const normalizeStandard = (text: string) => String(text ?? '').trim().replace(/\s+/g, ' ');
/** 标准快照：服务端计算，产出方不能自己声明版本来蒙混。 */
export function standardsRevision(standards: string[]): string {
  return contentRevision([...standards].map(normalizeStandard).sort());
}

/**
 * 纯函数闸门：有沉淀标准时，本任务必须有一份与当前标准快照一致、逐条通过且
 * 有证据的自查记录，才允许交付。不读时钟、不 IO、不调用模型。
 */
export function evaluateSelfCheck(input: {
  taskId: string; standards: string[]; run?: SelfCheckRun | null; enabled?: boolean;
}): DeliveryGateResult {
  const standards = [...new Set((input.standards ?? []).map(normalizeStandard).filter(Boolean))].sort();
  const revision = standardsRevision(standards);
  const base = { standardsCount: standards.length, standardsRevision: revision,
    matched: [] as string[], missing: [] as string[], failed: [] as string[],
    weakEvidence: [] as string[], modelCalls: 0 as const };
  if (input.enabled === false) return { ...base, ok: true, gate: 'disabled',
    reason: '交付前自查闸门已按配置关闭；最终验收仍由原发起人确认。' };
  if (!standards.length) return { ...base, ok: true, gate: 'no-standards',
    reason: '目前没有历史打回沉淀的自查标准，本次无项可比对；最终验收仍由原发起人确认。' };
  const run = input.run ?? null;
  if (!run) return { ...base, ok: false, gate: 'blocked',
    reason: `已有 ${standards.length} 条沉淀自查标准，但本任务还没有交付前自查记录；请先逐条登记自查结果与证据。` };
  if (run.standardsRevision !== revision) return { ...base, ok: false, gate: 'blocked',
    reason: '自查记录对应的是旧标准快照，标准更新后必须重新逐条自查。' };
  const byStandard = new Map((run.checks ?? []).map(item => [normalizeStandard(item.standard), item]));
  for (const standard of standards) {
    const item = byStandard.get(standard);
    if (!item) { base.missing.push(standard); continue; }
    base.matched.push(standard);
    if (item.status !== 'passed') base.failed.push(standard);
    if (!String(item.evidence ?? '').trim()) base.weakEvidence.push(standard);
  }
  const problems = [
    base.missing.length ? `缺 ${base.missing.length} 条自查` : '',
    base.failed.length ? `${base.failed.length} 条未通过` : '',
    base.weakEvidence.length ? `${base.weakEvidence.length} 条没有证据` : '',
  ].filter(Boolean).join('、');
  return problems
    ? { ...base, ok: false, gate: 'blocked', reason: `交付前自查未通过：${problems}；请补齐后重新交付。` }
    : { ...base, ok: true, gate: 'passed',
      reason: `${standards.length} 条沉淀标准已逐条自查通过并留证据，允许交付；最终验收仍由原发起人确认。` };
}

// --- 工程闸门：用既有共享现场做确定性回放验证 -------------------------------

export interface EngineeringGateResult {
  passed: boolean;
  checks: { id: string; ok: boolean; note: string }[];
  replayChecksum: string;
  replayTwiceEqual: boolean;
  sourceEvents: number;
  modelCalls: 0;
  reason: string;
}

/** 复用 B1/B2 已验收的 `memoryReplayReport`，不引入第二套重放或第二套 checksum。 */
export function engineeringGate(input: {
  candidate: { title: string; reason: string; sourceTaskId: string; sourceRound: number; targets: string[] };
  events: MemoryEvent[];
  logErrors?: string[];
}): EngineeringGateResult {
  const logErrors = input.logErrors ?? [];
  const forbidden = (input.candidate.targets ?? [])
    .filter(t => (FORBIDDEN_CHANGE_TARGETS as readonly string[]).includes(t));
  const report = memoryReplayReport(input.events, logErrors);
  const checks: EngineeringGateResult['checks'] = [
    { id: 'has-reason', ok: !!input.candidate.reason.trim(),
      note: input.candidate.reason.trim() ? '候选改进有真实打回 / 异常原因' : '缺少打回 / 异常原因' },
    { id: 'has-source', ok: !!input.candidate.sourceTaskId,
      note: input.candidate.sourceTaskId ? `来源任务 ${input.candidate.sourceTaskId} 第 ${input.candidate.sourceRound} 轮` : '缺少来源任务，不能凭空改进' },
    { id: 'no-forbidden-targets', ok: forbidden.length === 0,
      note: forbidden.length
        ? `试图改写禁改对象：${forbidden.map(t => FORBIDDEN_TARGET_LABELS[t as keyof typeof FORBIDDEN_TARGET_LABELS] ?? t).join('、')}`
        : '未触碰已锁定清单 / 权限规则 / 人签红线 / 历史任务' },
    { id: 'has-replay-evidence', ok: input.events.length > 0,
      note: `回放输入 ${input.events.length} 条共享现场事件` },
    { id: 'replay-deterministic', ok: report.replayTwiceEqual,
      note: report.replayTwiceEqual ? '两次重放 checksum 逐字节一致' : '两次重放结果不一致，不得放行' },
    { id: 'replay-clean', ok: report.deterministic && report.modelCalls === 0
        && report.integrity.invalidRows.length === 0 && report.integrity.danglingCausedBy.length === 0,
      note: `工程层 modelCalls=${report.modelCalls}，坏行 ${report.integrity.invalidRows.length}，悬空因果 ${report.integrity.danglingCausedBy.length}` },
    { id: 'no-log-errors', ok: logErrors.length === 0,
      note: logErrors.length ? `回放输入有 ${logErrors.length} 处坏行，不得静默放行` : '回放输入无坏行' },
  ];
  const passed = checks.every(c => c.ok);
  return { passed, checks, replayChecksum: String(report.checksum), replayTwiceEqual: report.replayTwiceEqual,
    sourceEvents: input.events.length, modelCalls: 0,
    reason: passed ? '工程闸门通过：回放可复现、无模型调用、未触碰禁改对象；仍需真人批准。'
      : '工程闸门未通过：' + checks.filter(c => !c.ok).map(c => c.note).join('；') };
}

// --- 效果对比：四项指标，缺数据如实不可比 -----------------------------------

export const effectObservationSchema = z.object({
  taskId: z.string().min(1).max(120),
  judgedItems: z.number().int().nonnegative(),
  passedItems: z.number().int().nonnegative(),
  reworkRounds: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
  humanInterrupts: z.number().int().nonnegative().optional(),
}).strict().superRefine((o, ctx) => {
  if (o.passedItems > o.judgedItems) ctx.addIssue({ code: z.ZodIssueCode.custom,
    message: '通过项不能多于判定项' });
});
export type EffectObservation = z.infer<typeof effectObservationSchema>;

export interface EffectMetrics {
  comparable: boolean;
  sampleSize: number;
  passRate: number | null;
  reworkRate: number | null;
  /** 单任务成本代理：模型调用次数 / 任务。未接入金额账本时不编造金额。 */
  costPerTask: number | null;
  humanInterrupts: number | null;
  missing: string[];
  modelCalls: 0;
  note: string;
}

export function aggregateEffects(observations: EffectObservation[]): EffectMetrics {
  const rows = observations.map(o => effectObservationSchema.parse(o));
  const sampleSize = rows.length;
  const judged = rows.reduce((n, o) => n + o.judgedItems, 0);
  const passedItems = rows.reduce((n, o) => n + o.passedItems, 0);
  const rework = rows.reduce((n, o) => n + o.reworkRounds, 0);
  const calls = rows.reduce((n, o) => n + o.modelCalls, 0);
  const interruptsKnown = rows.every(o => typeof o.humanInterrupts === 'number');
  const missing: string[] = [];
  if (!sampleSize) missing.push('没有观测样本');
  if (!judged) missing.push('没有逐项判定记录，通过率不可比');
  if (!interruptsKnown) missing.push('人被打断次数未逐单观测');
  const metrics: EffectMetrics = {
    comparable: missing.length === 0, sampleSize,
    passRate: judged ? passedItems / judged : null,
    reworkRate: sampleSize ? rework / sampleSize : null,
    costPerTask: sampleSize ? calls / sampleSize : null,
    humanInterrupts: interruptsKnown && sampleSize
      ? rows.reduce((n, o) => n + (o.humanInterrupts ?? 0), 0) : null,
    missing, modelCalls: 0,
    note: '单任务成本以「模型调用次数 / 任务」为代理；本机金额账本未接入观测时不编造金额。',
  };
  return metrics;
}

export interface EffectComparisonRow {
  id: 'passRate' | 'reworkRate' | 'costPerTask' | 'humanInterrupts';
  label: string; before: number | null; after: number | null; delta: number | null;
  verdict: 'improved' | 'regressed' | 'flat' | 'unknown';
  note: string;
}
export interface EffectComparison {
  comparable: boolean; rows: EffectComparisonRow[]; modelCalls: 0; note: string;
}

const EFFECT_DIRECTIONS: { id: EffectComparisonRow['id']; label: string; higherBetter: boolean }[] = [
  { id: 'passRate', label: '通过率', higherBetter: true },
  { id: 'reworkRate', label: '返工率', higherBetter: false },
  { id: 'costPerTask', label: '单任务成本（模型调用次数）', higherBetter: false },
  { id: 'humanInterrupts', label: '人被打断次数', higherBetter: false },
];

export function compareEffects(before: EffectMetrics, after: EffectMetrics): EffectComparison {
  const rows = EFFECT_DIRECTIONS.map(({ id, label, higherBetter }) => {
    const b = before[id], a = after[id];
    const delta = b !== null && a !== null ? a - b : null;
    const verdict: EffectComparisonRow['verdict'] = delta === null ? 'unknown'
      : Math.abs(delta) < 1e-9 ? 'flat'
        : (higherBetter ? delta > 0 : delta < 0) ? 'improved' : 'regressed';
    return { id, label, before: b, after: a, delta, verdict,
      note: delta === null ? '缺少可比数据，不编造数字'
        : verdict === 'improved' ? '按改进方向变好' : verdict === 'regressed' ? '按改进方向变差，需人审是否回滚' : '无明显变化' };
  });
  const comparable = before.comparable && after.comparable && rows.every(r => r.delta !== null);
  return { comparable, rows, modelCalls: 0,
    note: comparable ? '前后窗口观测齐全，工程层只给对比结果，是否保留改进仍由人决定。'
      : '前后窗口观测不齐，效果对比不可比；缺项已逐条标出，不补零、不估算。' };
}

// --- 服务编排：v06 / controller / CLI / 真跑共用同一套依赖注入 ---------------

export interface EvolutionDeps {
  standards: () => string[];
  memoryEvents: () => MemoryEvent[];
  memoryErrors: () => string[];
  ledger: EvolutionLedger;
  eventsFile: () => string;
  now: () => string;
  selfCheckGateEnabled: boolean;
  canaryPercent: number;
}

export function defaultEvolutionDeps(config: Pick<Config, 'evolution'> = loadConfig()): EvolutionDeps {
  return {
    standards: () => readSelfCheck(runtime('v06')).standards.map(item => item.text),
    memoryEvents: () => readBridgedEvents().events,
    memoryErrors: () => readBridgedEvents().errors,
    ledger: getEvolutionLedger(),
    eventsFile: () => evolutionLogPath(),
    now: () => new Date().toISOString(),
    selfCheckGateEnabled: config.evolution.selfCheckGate.enabled,
    canaryPercent: config.evolution.canaryPercent,
  };
}

export interface EvolutionView {
  available: true;
  selfCheckGateEnabled: boolean;
  standardsCount: number;
  standardsRevision: string;
  standards: string[];
  deliveryGateNote: string;
  selfCheckRuns: number;
  gatePasses: number;
  candidates: { id: string; title: string; state: string; stateLabel: string; version?: string;
    canaryPercent?: number; reviewedBy?: string; gatePassed?: boolean; rollbackReason?: string }[];
  activeVersion: string | null;
  canaryPercent: number;
  violations: string[];
  effectComparison: EffectComparison | null;
  effectWindows: string[];
  redLines: string[];
  note: string;
  checksum: string;
  modelCalls: 0;
  logErrors: string[];
}

export class EvolutionService {
  constructor(readonly deps: EvolutionDeps = defaultEvolutionDeps()) {}

  private append(input: Omit<Parameters<EvolutionLedger['append']>[0], 'at'>) {
    return this.deps.ledger.append({ ...input, at: this.deps.now() });
  }
  private snapshot(): EvolutionState {
    return replayEvolution(readEvolutionEvents(this.deps.eventsFile()).events);
  }
  private currentStandards() { return this.deps.standards(); }

  /** 只读视图：所有数字都来自台账或当前标准文件，无数据如实标「不可比」。 */
  view(): EvolutionView {
    const state = this.snapshot();
    const standards = this.currentStandards();
    const gate = evaluateSelfCheck({ taskId: '__view__', standards, enabled: this.deps.selfCheckGateEnabled });
    const windows = [...new Set(state.effects.map(e => e.window))];
    const before = [...state.effects].reverse().find(e => e.window === 'before');
    const after = [...state.effects].reverse().find(e => e.window === 'after');
    const comparison = before && after
      ? compareEffects(before.metrics as unknown as EffectMetrics, after.metrics as unknown as EffectMetrics) : null;
    return {
      available: true, selfCheckGateEnabled: this.deps.selfCheckGateEnabled,
      standardsCount: standards.length, standardsRevision: gate.standardsRevision,
      standards: standards.slice(-20),
      deliveryGateNote: standards.length
        ? `已有 ${standards.length} 条沉淀标准：交付前必须逐条自查并留证据，闸门默认强制。`
        : '暂无历史打回沉淀的自查标准，交付闸门当前无项可比对。',
      selfCheckRuns: state.selfCheckCount, gatePasses: state.gatePasses.length,
      candidates: Object.values(state.candidates).sort((a, b) => a.at.localeCompare(b.at)).map(c => ({
        id: c.id, title: c.title, state: c.state, stateLabel: IMPROVEMENT_STATE_LABELS[c.state] ?? c.state,
        ...(c.version ? { version: c.version } : {}),
        ...(c.canaryPercent !== undefined ? { canaryPercent: c.canaryPercent } : {}),
        ...(c.reviewedBy ? { reviewedBy: c.reviewedBy } : {}),
        gatePassed: (c.gateChecks ?? []).length > 0 && (c.gateChecks ?? []).every(x => x.ok),
        ...(c.rollbackReason ? { rollbackReason: c.rollbackReason } : {}),
      })),
      activeVersion: state.activeVersion, canaryPercent: this.deps.canaryPercent,
      violations: state.violations.slice(-20), effectComparison: comparison,
      effectWindows: windows, redLines: [...SELF_CHECK_RED_LINES],
      note: '工程闸门只做确定性回放与清单比对；改进能否生效由真人决定，历史任务不回溯改写。',
      checksum: state.checksum, modelCalls: 0,
      logErrors: readEvolutionEvents(this.deps.eventsFile()).errors,
    };
  }

  /** 产出方登记本任务交付前逐条自查；标准快照由服务端算，不接受客户端声明。 */
  recordSelfCheck(input: { taskId: string; checks: SelfCheckItem[]; actor: string;
    actorType?: 'human' | 'agent' | 'system' }) {
    const checks = input.checks.map(item => selfCheckItemSchema.parse(item));
    const revision = standardsRevision(this.currentStandards());
    return this.append({ kind: 'self-check-recorded', actor: input.actor,
      actorType: input.actorType ?? 'agent', taskId: input.taskId,
      idempotencyKey: `self-check:${input.taskId}:${revision}:${contentRevision(checks)}`,
      payload: { taskId: input.taskId, standardsRevision: revision, items: checks.length, checks } });
  }

  /** controller.publish() 前调用：不通过就阻止交付，绝不「先交付再补自查」。 */
  deliveryGate(taskId: string): DeliveryGateResult {
    const standards = this.currentStandards();
    const recorded = this.snapshot().selfChecks[taskId];
    const run: SelfCheckRun | null = recorded ? {
      taskId, standardsRevision: recorded.standardsRevision,
      checks: recorded.checks.map(c => ({ standard: c.standard,
        status: c.status === 'passed' ? 'passed' : 'failed', evidence: c.evidence })),
      at: recorded.at, actor: recorded.actor,
    } : null;
    return evaluateSelfCheck({ taskId, standards, run, enabled: this.deps.selfCheckGateEnabled });
  }
  /** 闸门放行只是留痕，不代表验收通过；写失败不影响交付结果。 */
  markDeliveryPassed(taskId: string, gate: DeliveryGateResult) {
    return this.append({ kind: 'delivery-gate-passed', actor: 'delivery-gate', actorType: 'system',
      taskId, idempotencyKey: `delivery-gate:${taskId}:${gate.standardsRevision}`,
      payload: { taskId, standardsRevision: gate.standardsRevision, items: gate.matched.length,
        note: '工程闸门放行；最终验收仍由原发起人在原会话确认验收' } });
  }

  /** 打回 / 异常 → 候选改进。禁改对象由台账层直接拒绝登记，不是「先记下再说」。 */
  propose(input: { title: string; reason: string; sourceTaskId: string; sourceRound: number;
    targets?: string[]; actor: string }) {
    const id = candidateId(input.sourceTaskId, input.sourceRound, input.reason);
    const result = this.append({ kind: 'improvement-proposed', actor: input.actor, actorType: 'agent',
      taskId: input.sourceTaskId, candidateId: id,
      idempotencyKey: `improvement:${id}`,
      payload: { candidateId: id, title: input.title, reason: input.reason,
        sourceTaskId: input.sourceTaskId, sourceRound: input.sourceRound, targets: input.targets ?? [] } });
    return { id, result, state: this.snapshot().candidates[id]?.state ?? null };
  }

  /** 工程闸门：对同一份共享现场事件做确定性回放验证，结果写台账。 */
  gate(id: string, actor = 'engineering-gate') {
    const candidate = this.snapshot().candidates[id];
    if (!candidate) throw new Error('找不到这个候选改进，先由打回 / 异常沉淀候选');
    const result = engineeringGate({
      candidate: { title: candidate.title, reason: candidate.reason, sourceTaskId: candidate.sourceTaskId,
        sourceRound: candidate.sourceRound, targets: candidate.targets },
      events: this.deps.memoryEvents(), logErrors: this.deps.memoryErrors(),
    });
    const append = this.append({ kind: 'gate-evaluated', actor, actorType: 'system', candidateId: id,
      idempotencyKey: `gate:${id}:${result.replayChecksum}`,
      payload: { candidateId: id, passed: result.passed, checks: result.checks,
        replayChecksum: result.replayChecksum, sourceEvents: result.sourceEvents, reason: result.reason } });
    return { ...result, state: this.snapshot().candidates[id]?.state ?? null, append };
  }

  /** 人审：actorType 由调用方按真实认证身份给出，Agent 尝试会在台账留违规痕。 */
  review(input: { id: string; decision: 'approved' | 'rejected'; reason: string;
    actor: string; actorType: 'human' | 'agent' | 'system' }) {
    const result = this.append({ kind: 'human-reviewed', actor: input.actor, actorType: input.actorType,
      candidateId: input.id, idempotencyKey: `review:${input.id}:${input.decision}:${input.actor}`,
      payload: { candidateId: input.id, decision: input.decision, reason: input.reason } });
    return { result, state: this.snapshot().candidates[input.id]?.state ?? null };
  }

  /** 版本 / 灰度 / 生效 / 回滚：全部留有版本与主体，随时可退回上一版。 */
  rollout(input: { id: string; phase: 'canary' | 'active' | 'rolled-back'; version?: string;
    canaryPercent?: number; reason?: string; actor: string;
    actorType: 'human' | 'agent' | 'system' }) {
    const version = input.version ?? `v${contentRevision(input.id).slice(0, 8)}`;
    const result = this.append({ kind: 'rollout-changed', actor: input.actor, actorType: input.actorType,
      candidateId: input.id, idempotencyKey: `rollout:${input.id}:${input.phase}:${version}`,
      payload: { candidateId: input.id, phase: input.phase, version,
        canaryPercent: input.phase === 'canary' ? (input.canaryPercent ?? this.deps.canaryPercent) : 100,
        reason: input.reason ?? '' } });
    return { result, version, state: this.snapshot().candidates[input.id]?.state ?? null };
  }

  /** 登记一个效果观测窗口；缺项如实标不可比，不补零、不估算。 */
  measure(input: { window: string; observations: EffectObservation[]; actor: string;
    actorType?: 'human' | 'agent' | 'system' }) {
    const metrics = aggregateEffects(input.observations);
    const result = this.append({ kind: 'effect-measured', actor: input.actor,
      actorType: input.actorType ?? 'system',
      idempotencyKey: `effect:${input.window}:${contentRevision(metrics)}`,
      payload: { window: input.window, sampleSize: metrics.sampleSize, metrics } });
    return { metrics, result };
  }

  /** v06 统一转发：写动作都在这里收口，控制台只开放 view 一个只读动作。 */
  handle(action: string, p: any, actor: { admin: boolean; userId?: string; agent?: string }): unknown {
    const human = !!actor.userId && !actor.agent && actor.admin;
    const actorType: 'human' | 'agent' | 'system' = human ? 'human' : actor.agent ? 'agent' : 'system';
    const who = actor.userId ?? actor.agent ?? 'local-operator';
    switch (action) {
      case 'evolution-view': return this.view();
      case 'self-check-record': return this.recordSelfCheck({ taskId: String(p.taskId ?? ''),
        checks: Array.isArray(p.checks) ? p.checks : [], actor: who, actorType });
      case 'improvement-propose': return this.propose({ title: String(p.title ?? ''),
        reason: String(p.reason ?? ''), sourceTaskId: String(p.sourceTaskId ?? ''),
        sourceRound: Number(p.sourceRound ?? 0), targets: Array.isArray(p.targets) ? p.targets.map(String) : [],
        actor: who });
      case 'improvement-gate': return this.gate(String(p.candidateId ?? ''), who);
      case 'improvement-review': {
        if (!human) throw new Error('只有组织级真人负责人可以批准改进；Agent 不能自己让改进生效');
        return this.review({ id: String(p.candidateId ?? ''),
          decision: p.decision === 'approved' ? 'approved' : 'rejected',
          reason: String(p.reason ?? ''), actor: who, actorType });
      }
      case 'improvement-rollout': {
        if (!human) throw new Error('只有组织级真人负责人可以灰度 / 生效 / 回滚改进');
        return this.rollout({ id: String(p.candidateId ?? ''),
          phase: ['canary', 'active', 'rolled-back'].includes(String(p.phase)) ? p.phase : 'canary',
          version: p.version ? String(p.version) : undefined,
          canaryPercent: typeof p.canaryPercent === 'number' ? p.canaryPercent : undefined,
          reason: String(p.reason ?? ''), actor: who, actorType });
      }
      case 'effect-measure': return this.measure({ window: String(p.window ?? ''),
        observations: Array.isArray(p.observations) ? p.observations : [], actor: who, actorType });
      default: throw new Error('未知的自演进动作：' + action);
    }
  }
}

/**
 * 交付前唯一守门点：不通过就抛中文错误阻止交付，绝不「先交付再补自查」。
 * 放行只写一条留痕，不改写已锁定清单，也不等于验收通过。
 */
export function assertDeliverySelfCheck(taskId: string, service: EvolutionService = new EvolutionService()): DeliveryGateResult {
  const gate = service.deliveryGate(taskId);
  if (!gate.ok) throw new Error(`交付前自查未通过：${gate.reason}（最终验收仍由原发起人在原会话确认验收）`);
  service.markDeliveryPassed(taskId, gate);
  return gate;
}

const EVOLUTION_ACTIONS = [
  'evolution-view', 'self-check-record', 'improvement-propose', 'improvement-gate',
  'improvement-review', 'improvement-rollout', 'effect-measure',
] as const;
export function isEvolutionAction(action: string): boolean {
  return (EVOLUTION_ACTIONS as readonly string[]).includes(action);
}
export { EVOLUTION_ACTIONS };
