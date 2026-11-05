// v0.6 FR-22 / FR-23 / FR-24 — attention budget, intervention and Watchdog.
//
// These are CONTRACT-LEVEL rules. The repository already implements parts of
// them (event coalescing, self-progress exclusion, <=12 tool calls per turn,
// <=2 rechecks per delegation, `ask` releasing execution, Autoloop session
// resume). This module makes those rules explicit, configurable and testable
// WITHOUT replacing or forking the existing runtime.
import { z } from 'zod';

export const attentionPolicySchema = z.object({
  schemaVersion: z.literal(1),
  /** Fast programmatic filter, then a slower semantic judgement. */
  twoStageFilter: z.boolean().default(true),
  ignoreSelfProgress: z.boolean().default(true),
  maxToolCallsPerTurn: z.number().int().min(1).default(12),
  maxRechecksPerDelegation: z.number().int().min(0).default(2),
  /** Periodic inspection inside one's own responsibility boundary only. */
  patrolIntervalMinutes: z.number().int().min(1).default(60),
  proactiveWithinRoleBoundary: z.boolean().default(true),
  sensitivity: z.enum(['low', 'normal', 'high']).default('normal'),
  maxInterruptionsPerPersonPerDay: z.number().int().min(1).default(8),
}).strict();
export type AttentionPolicy = z.infer<typeof attentionPolicySchema>;
export const defaultAttentionPolicy = (): AttentionPolicy => attentionPolicySchema.parse({ schemaVersion: 1 });

export interface IncomingEvent {
  id: string;
  kind: 'self-progress' | 'tool-call' | 'review' | 'external' | 'signal' | 'delegation';
  actorId: string;
  targetUserId: string;
  withinRoleBoundary: boolean;
  /** A short machine-readable summary used by the fast filter. */
  summary: string;
  at: string;
}

export type FilterDecision = { wake: boolean; stage: 'fast' | 'semantic' | 'budget'; reason: string };

/** Stage 1 (cheap) + stage 2 (semantic) + attention budget. Pure, replayable. */
export function filterEvent(event: IncomingEvent, policy: AttentionPolicy, state: {
  toolCallsThisTurn: number; rechecksThisDelegation: number; interruptionsToday: Record<string, number>;
}): FilterDecision {
  if (policy.ignoreSelfProgress && event.kind === 'self-progress') return { wake: false, stage: 'fast', reason: '自身进度通知不唤醒' };
  if (event.kind === 'tool-call' && state.toolCallsThisTurn >= policy.maxToolCallsPerTurn)
    return { wake: false, stage: 'budget', reason: `本轮工具调用已达上限 ${policy.maxToolCallsPerTurn}` };
  if (event.kind === 'delegation' && state.rechecksThisDelegation >= policy.maxRechecksPerDelegation)
    return { wake: false, stage: 'budget', reason: `单次委托复查已达上限 ${policy.maxRechecksPerDelegation}` };
  if ((state.interruptionsToday[event.targetUserId] ?? 0) >= policy.maxInterruptionsPerPersonPerDay)
    return { wake: false, stage: 'budget', reason: '目标成员当日被打断次数已达上限' };
  if (!event.withinRoleBoundary && policy.proactiveWithinRoleBoundary && event.kind === 'signal')
    return { wake: false, stage: 'semantic', reason: '不在职责边界内的主动信号不唤醒' };
  const sensitivityGate = policy.sensitivity === 'low' && event.kind === 'signal' ? false : true;
  if (!sensitivityGate) return { wake: false, stage: 'semantic', reason: '低敏感度下信号类事件静默' };
  return { wake: true, stage: 'semantic', reason: '需要人工或 Agent 注意力' };
}

// --- FR-22 intervention ---------------------------------------------------
export const interventionSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  actorUserId: z.string().min(1),
  action: z.enum(['pause', 'stop', 'rollback', 'resume']),
  checkpoint: z.string().optional(),
  reason: z.string().min(1),
  at: z.string(),
}).strict();
export type Intervention = z.infer<typeof interventionSchema>;

export function assertIntervention(input: Intervention, current: { phase: string; lease?: string }): Intervention {
  interventionSchema.parse(input);
  if (input.action === 'resume' && !input.checkpoint) throw new Error('恢复执行必须指定检查点');
  if (input.action === 'rollback' && !input.checkpoint) throw new Error('回滚必须指定上一已验收版本');
  if (input.action === 'stop' && current.phase === 'unknown') throw new Error('执行状态未知，须先核对原执行终止后再介入');
  return input;
}

// --- FR-24 Watchdog -------------------------------------------------------
export interface RunHeartbeat {
  taskId: string; runId: string; lastProgressAt: string; checkpoint?: string;
  status: 'running' | 'waiting-human' | 'succeeded' | 'failed';
  toolCalls: number;
}

export const watchdogPolicySchema = z.object({
  schemaVersion: z.literal(1),
  stallMinutes: z.number().int().min(1).default(15),
  maxToolCallsPerRun: z.number().int().min(1).default(200),
  /** Waiting on a human releases execution; it is NOT a stall. */
  humanWaitReleasesExecution: z.boolean().default(true),
}).strict();
export type WatchdogPolicy = z.infer<typeof watchdogPolicySchema>;
export const defaultWatchdogPolicy = (): WatchdogPolicy => watchdogPolicySchema.parse({ schemaVersion: 1 });

export type WatchdogVerdict = { taskId: string; runId: string; state: 'healthy' | 'stalled' | 'runaway' | 'waiting'; reason: string; resumeFrom?: string };

export function inspectRun(run: RunHeartbeat, policy: WatchdogPolicy, now = new Date().toISOString()): WatchdogVerdict {
  const base = { taskId: run.taskId, runId: run.runId };
  if (run.status === 'waiting-human') return { ...base, state: 'waiting', reason: '等待人工，执行已释放，不算卡死', ...(run.checkpoint ? { resumeFrom: run.checkpoint } : {}) };
  if (run.status !== 'running') return { ...base, state: 'healthy', reason: `执行已终止：${run.status}` };
  if (run.toolCalls > policy.maxToolCallsPerRun) return { ...base, state: 'runaway', reason: `工具调用 ${run.toolCalls} 超过单轮上限 ${policy.maxToolCallsPerRun}` };
  const minutes = (Date.parse(now) - Date.parse(run.lastProgressAt)) / 60000;
  if (minutes > policy.stallMinutes) return { ...base, state: 'stalled', reason: `已 ${minutes.toFixed(1)} 分钟无进度`, ...(run.checkpoint ? { resumeFrom: run.checkpoint } : {}) };
  return { ...base, state: 'healthy', reason: '进度正常' };
}

/** Recovery is always from an existing checkpoint; no replay of external actions. */
export function recoveryFrom(verdict: WatchdogVerdict): { allowed: boolean; reason: string } {
  if (verdict.state === 'healthy' || verdict.state === 'waiting') return { allowed: false, reason: '无需恢复' };
  if (!verdict.resumeFrom) return { allowed: false, reason: '没有检查点，禁止自动重放外部动作，须人工核对' };
  return { allowed: true, reason: `从既有检查点 ${verdict.resumeFrom} 恢复，不重放任何已发生的外部动作` };
}
