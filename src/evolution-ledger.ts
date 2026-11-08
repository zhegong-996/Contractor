// 方案 C-6 · 治理与自演进台账（append-only，独立于 B1 共享记忆主干）。
//
// 为什么不并入 `.runtime/memory/events.jsonl`：B1/B2 的主干是「知识从哪来、
// 变成什么、被谁撤权」，其 checksum 与四类投影是已验收的确定性契约。C-6 记录
// 的是「谁自查过 / 谁提了改进 / 谁批准 / 谁灰度 / 谁回滚」这类治理事实，不是
// 知识事实；写进主干会改变既有重放结果与 checkpoint 证据，等于回溯改写历史。
// 因此这里另起一份只增不改的台账，两者由 `causedBy` / `taskId` 互相引用，
// 不复制数据、不产生第二套真相源。
//
// 红线（C-P4）：Agent 可以提出改进，不能自己让改进生效。台账只记录状态，
// 绝不改写已锁定的验收清单、权限规则、人签红线或历史任务。
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { runtime } from './config.ts';

export const EVOLUTION_EVENT_KINDS = [
  'self-check-recorded',   // 产出方在交付前逐条自查
  'delivery-gate-passed',  // 工程闸门放行（只是允许交付，仍要人签）
  'improvement-proposed',  // 打回 / 异常沉淀为候选改进
  'gate-evaluated',        // 工程闸门：确定性回放验证结果
  'human-reviewed',        // 人审决定（必须真人）
  'rollout-changed',       // 版本 / 灰度 / 生效 / 可回滚
  'effect-measured',       // 效果快照
] as const;
export type EvolutionEventKind = typeof EVOLUTION_EVENT_KINDS[number];

export const IMPROVEMENT_STATES = [
  'proposed', 'gate-failed', 'gate-passed', 'approved', 'canary', 'active', 'rolled-back', 'rejected',
] as const;
export type ImprovementState = typeof IMPROVEMENT_STATES[number];

/** 自我改进永不得自动改写的四类对象；命中即拒绝登记，不是「先记下再说」。 */
export const FORBIDDEN_CHANGE_TARGETS = [
  'sealed-acceptance-plan', 'permission-rules', 'human-signature', 'historical-task',
] as const;
export const FORBIDDEN_TARGET_LABELS: Record<typeof FORBIDDEN_CHANGE_TARGETS[number], string> = {
  'sealed-acceptance-plan': '已锁定的验收清单',
  'permission-rules': '权限规则',
  'human-signature': '人签红线',
  'historical-task': '历史任务',
};

/** modelCalls 恒为 0：C-P3 要求工程闸门是确定性工程层，不调用任何模型。 */
export const evolutionEventSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(EVOLUTION_EVENT_KINDS),
  at: z.string().min(1),
  actor: z.string().min(1),
  actorType: z.enum(['human', 'agent', 'system']),
  taskId: z.string().min(1).optional(),
  candidateId: z.string().min(1).optional(),
  causedBy: z.string().min(1).optional(),
  /** 本条事件的内容哈希，用于核对留痕未被改写；不是组织配置版本。 */
  revision: z.string().min(1),
  modelCalls: z.literal(0),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type EvolutionEvent = z.infer<typeof evolutionEventSchema>;

export type EvolutionEventInput = {
  kind: EvolutionEventKind;
  actor: string;
  actorType: 'human' | 'agent' | 'system';
  at?: string;
  taskId?: string;
  candidateId?: string;
  causedBy?: string;
  payload?: Record<string, unknown>;
  /** 提供时不把时间纳入 id：同一业务动作重试不会产生重复治理事件。 */
  idempotencyKey?: string;
};

const stable = (value: unknown) => JSON.stringify(value);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function evolutionEvent(input: EvolutionEventInput): EvolutionEvent {
  const at = input.at ?? new Date().toISOString();
  const payload = input.payload ?? {};
  const identity = input.idempotencyKey ?? [input.kind, input.actor, input.actorType, at,
    input.taskId ?? '', input.candidateId ?? '', input.causedBy ?? '', stable(payload)].join('|');
  return evolutionEventSchema.parse({
    id: hash('evolution:' + identity).slice(0, 32),
    kind: input.kind, at, actor: input.actor, actorType: input.actorType,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.candidateId ? { candidateId: input.candidateId } : {}),
    ...(input.causedBy ? { causedBy: input.causedBy } : {}),
    revision: hash(stable(payload)).slice(0, 24),
    modelCalls: 0 as const,
    payload,
  });
}

export interface EvolutionSink { write(line: string): void }
export class FileEvolutionSink implements EvolutionSink {
  constructor(readonly file: string) { mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); }
  write(line: string) { appendFileSync(this.file, line + '\n', { mode: 0o600 }); }
}
export class InMemoryEvolutionSink implements EvolutionSink {
  readonly lines: string[] = [];
  write(line: string) { this.lines.push(line); }
}

export const evolutionLogPath = (dir?: string) => path.join(dir ?? runtime('evolution'), 'events.jsonl');

export class EvolutionLedger {
  private readonly seen = new Set<string>();
  constructor(readonly sinks: EvolutionSink[] = [new FileEvolutionSink(evolutionLogPath())]) {}
  /** 证据写入永不影响业务结果：失败只如实返回，不抛错。 */
  append(input: EvolutionEventInput): { written: boolean; duplicate: boolean; event?: EvolutionEvent; reason?: string } {
    let event: EvolutionEvent;
    try { event = evolutionEvent(input); }
    catch (error) { return { written: false, duplicate: false, reason: 'invalid-event: ' + String(error).slice(0, 200) }; }
    if (this.seen.has(event.id)) return { written: false, duplicate: true, event, reason: 'duplicate-in-process' };
    let written = 0;
    for (const sink of this.sinks) {
      try { sink.write(JSON.stringify(event)); written++; } catch { /* 单个 sink 失败不影响其它 sink */ }
    }
    this.seen.add(event.id);
    return { written: written > 0, duplicate: false, event,
      ...(written === 0 ? { reason: 'no-sink-available' } : {}) };
  }
}

let current: EvolutionLedger | undefined;
export function getEvolutionLedger(): EvolutionLedger {
  if (current) return current;
  if (process.env.COLLAB_TEST_EVOLUTION === 'memory') return current = new EvolutionLedger([new InMemoryEvolutionSink()]);
  return current = new EvolutionLedger();
}
export function setEvolutionLedger(ledger: EvolutionLedger | null): void { current = ledger ?? undefined; }

/** 只读重放输入：坏行绝不静默丢弃，记入 errors 供视图如实显示。 */
export function readEvolutionEvents(file = evolutionLogPath()): { events: EvolutionEvent[]; errors: string[] } {
  if (!existsSync(file)) return { events: [], errors: [] };
  const events: EvolutionEvent[] = [], errors: string[] = [];
  readFileSync(file, 'utf8').split('\n').filter(Boolean).forEach((line, index) => {
    try { events.push(evolutionEventSchema.parse(JSON.parse(line))); }
    catch (error) { errors.push(`line ${index + 1}: ${String(error).slice(0, 160)}`); }
  });
  return { events, errors };
}

export interface SelfCheckCheck { standard: string; status: string; evidence: string }
export interface SelfCheckRecordState {
  taskId: string; standardsRevision: string; items: number; checks: SelfCheckCheck[]; at: string; actor: string;
}
export interface CandidateState {
  id: string; title: string; reason: string; sourceTaskId: string; sourceRound: number;
  targets: string[]; state: ImprovementState; at: string; actor: string;
  gateChecks?: { id: string; ok: boolean; note: string }[];
  replayChecksum?: string;
  reviewedBy?: string; reviewDecision?: 'approved' | 'rejected'; reviewReason?: string;
  version?: string; canaryPercent?: number; rollbackReason?: string;
  history: { state: ImprovementState; at: string; actor: string }[];
}
export interface EffectSnapshotState { window: string; at: string; actor: string; metrics: Record<string, unknown> }
export interface EvolutionState {
  selfChecks: Record<string, SelfCheckRecordState>;
  selfCheckCount: number;
  gatePasses: { taskId: string; standardsRevision: string; at: string }[];
  candidates: Record<string, CandidateState>;
  effects: EffectSnapshotState[];
  activeVersion: string | null;
  /** 非法迁移 / Agent 自审 / 跳过闸门等：如实留痕，绝不静默吞掉。 */
  violations: string[];
  checksum: string;
  modelCalls: 0;
}

const asString = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const asNumber = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const asBool = (value: unknown) => value === true;

/** 稳定快照：显式排序，保证同一批事件两次重放 checksum 逐字节一致。 */
function stableSnapshot(state: Omit<EvolutionState, 'checksum'>): string {
  return JSON.stringify({
    selfChecks: Object.values(state.selfChecks).sort((a, b) => a.taskId.localeCompare(b.taskId)),
    selfCheckCount: state.selfCheckCount,
    gatePasses: [...state.gatePasses].sort((a, b) => (a.at + a.taskId).localeCompare(b.at + b.taskId)),
    candidates: Object.values(state.candidates).sort((a, b) => a.id.localeCompare(b.id)),
    effects: [...state.effects].sort((a, b) => (a.at + a.window).localeCompare(b.at + b.window)),
    activeVersion: state.activeVersion,
    violations: [...state.violations].sort(),
    modelCalls: state.modelCalls,
  });
}

/**
 * 纯函数重放：状态迁移在台账层完成，业务层只读结果。
 * 所有让改进「生效」的路径都必须有真人 actor 与已通过工程闸门的证据。
 */
export function replayEvolution(events: EvolutionEvent[]): EvolutionState {
  const state: Omit<EvolutionState, 'checksum'> = {
    selfChecks: {}, selfCheckCount: 0, gatePasses: [], candidates: {}, effects: [],
    activeVersion: null, violations: [], modelCalls: 0,
  };
  const violation = (event: EvolutionEvent, reason: string) =>
    state.violations.push(`${event.kind}@${event.id.slice(0, 8)} by ${event.actorType}:${event.actor} — ${reason}`);

  for (const event of events) {
    if (event.modelCalls !== 0) { violation(event, '治理事件调用过模型，违反 C-P3 工程层红线'); continue; }
    const payload = event.payload;
    switch (event.kind) {
      case 'self-check-recorded': {
        const taskId = asString(payload.taskId, event.taskId ?? '');
        if (!taskId) { violation(event, '自查记录缺少任务编号'); break; }
        const checks: SelfCheckCheck[] = Array.isArray(payload.checks)
          ? payload.checks.map((c: any) => ({ standard: asString(c?.standard),
              status: asString(c?.status), evidence: asString(c?.evidence) })) : [];
        state.selfChecks[taskId] = { taskId,
          standardsRevision: asString(payload.standardsRevision),
          items: asNumber(payload.items, checks.length), checks, at: event.at, actor: event.actor };
        state.selfCheckCount++;
        break;
      }
      case 'delivery-gate-passed': {
        const taskId = asString(payload.taskId, event.taskId ?? '');
        if (!taskId) { violation(event, '交付闸门放行缺少任务编号'); break; }
        state.gatePasses.push({ taskId, standardsRevision: asString(payload.standardsRevision), at: event.at });
        break;
      }
      case 'improvement-proposed': {
        const id = asString(payload.candidateId, event.candidateId ?? '');
        if (!id) { violation(event, '候选改进缺少标识'); break; }
        if (state.candidates[id]) { violation(event, '候选改进重复登记，历史不回溯改写'); break; }
        const targets = Array.isArray(payload.targets) ? payload.targets.map(String) : [];
        const forbidden = targets.filter(t => (FORBIDDEN_CHANGE_TARGETS as readonly string[]).includes(t));
        const reason = asString(payload.reason);
        if (!reason) { violation(event, '候选改进缺少打回 / 异常原因'); break; }
        const base: CandidateState = {
          id, title: asString(payload.title, '未命名改进'), reason,
          sourceTaskId: asString(payload.sourceTaskId, event.taskId ?? ''),
          sourceRound: asNumber(payload.sourceRound), targets,
          state: forbidden.length ? 'rejected' : 'proposed',
          at: event.at, actor: event.actor,
          history: [{ state: forbidden.length ? 'rejected' : 'proposed', at: event.at, actor: event.actor }],
        };
        if (forbidden.length) {
          const labels = forbidden.map(t => FORBIDDEN_TARGET_LABELS[t as keyof typeof FORBIDDEN_TARGET_LABELS] ?? t);
          violation(event, `候选改进试图改写禁改对象：${labels.join('、')}，已拒绝登记`);
          base.rollbackReason = `禁改对象：${labels.join('、')}`;
        }
        state.candidates[id] = base;
        break;
      }
      case 'gate-evaluated': {
        const id = asString(payload.candidateId, event.candidateId ?? '');
        const candidate = state.candidates[id];
        if (!candidate) { violation(event, '工程闸门结果找不到对应候选改进'); break; }
        const passed = asBool(payload.passed);
        const checks = Array.isArray(payload.checks)
          ? payload.checks.map((c: any) => ({ id: asString(c?.id), ok: c?.ok === true, note: asString(c?.note) })) : [];
        if (passed && checks.some(c => !c.ok)) { violation(event, '闸门自称通过却含未通过检查项'); break; }
        if (candidate.state !== 'proposed') { violation(event, `候选当前为 ${candidate.state}，不得重复跑工程闸门`); break; }
        candidate.gateChecks = checks;
        candidate.replayChecksum = asString(payload.replayChecksum);
        candidate.state = passed ? 'gate-passed' : 'gate-failed';
        candidate.history.push({ state: candidate.state, at: event.at, actor: event.actor });
        break;
      }
      case 'human-reviewed': {
        const id = asString(payload.candidateId, event.candidateId ?? '');
        const candidate = state.candidates[id];
        if (!candidate) { violation(event, '人审找不到对应候选改进'); break; }
        // 红线：Agent 不能自己让改进生效，也不能自己批准。
        if (event.actorType !== 'human') { violation(event, '非真人主体试图人审，Agent 不能自己让改进生效'); break; }
        const decision = payload.decision === 'approved' ? 'approved' : 'rejected';
        if (decision === 'approved' && candidate.state !== 'gate-passed') {
          violation(event, `未通过工程闸门（当前 ${candidate.state}）不得批准`); break;
        }
        candidate.reviewedBy = event.actor;
        candidate.reviewDecision = decision;
        candidate.reviewReason = asString(payload.reason);
        candidate.state = decision === 'approved' ? 'approved' : 'rejected';
        candidate.history.push({ state: candidate.state, at: event.at, actor: event.actor });
        break;
      }
      case 'rollout-changed': {
        const id = asString(payload.candidateId, event.candidateId ?? '');
        const candidate = state.candidates[id];
        if (!candidate) { violation(event, '灰度 / 回滚找不到对应候选改进'); break; }
        const phase = asString(payload.phase);
        if (phase === 'rolled-back') {
          if (!['approved', 'canary', 'active'].includes(candidate.state)) {
            violation(event, `候选当前为 ${candidate.state}，没有可回滚的生效状态`); break;
          }
          candidate.rollbackReason = asString(payload.reason, '人审后主动回滚');
          candidate.state = 'rolled-back';
          candidate.history.push({ state: 'rolled-back', at: event.at, actor: event.actor });
          if (state.activeVersion === candidate.version) state.activeVersion = null;
          break;
        }
        if (!['canary', 'active'].includes(phase)) { violation(event, `未知灰度阶段 ${phase}`); break; }
        if (event.actorType !== 'human') { violation(event, '非真人主体试图让改进生效'); break; }
        if (!candidate.reviewedBy || candidate.reviewDecision !== 'approved') {
          violation(event, '未经真人批准不得灰度 / 生效'); break;
        }
        if (candidate.state !== 'approved' && !(phase === 'active' && candidate.state === 'canary')) {
          violation(event, `候选当前为 ${candidate.state}，不得直接跳到 ${phase}`); break;
        }
        if (!asString(payload.version)) { violation(event, '灰度 / 生效缺少版本号，无法回滚'); break; }
        candidate.version = asString(payload.version);
        candidate.canaryPercent = phase === 'canary' ? asNumber(payload.canaryPercent, 20) : 100;
        candidate.state = phase === 'canary' ? 'canary' : 'active';
        if (candidate.state === 'active') state.activeVersion = candidate.version;
        candidate.history.push({ state: candidate.state, at: event.at, actor: event.actor });
        break;
      }
      case 'effect-measured': {
        state.effects.push({ window: asString(payload.window, '未命名窗口'), at: event.at, actor: event.actor,
          metrics: payload.metrics && typeof payload.metrics === 'object' ? payload.metrics as Record<string, unknown> : {} });
        break;
      }
    }
  }
  return { ...state, checksum: hash(stableSnapshot(state)) };
}

/** 内容哈希版本：候选改进、自查清单共用，避免两套版本口径。 */
export function contentRevision(value: unknown): string { return hash(stable(value)).slice(0, 24); }
export function candidateId(sourceTaskId: string, sourceRound: number, reason: string): string {
  return hash(`candidate:${sourceTaskId}:${sourceRound}:${reason}`).slice(0, 24);
}
