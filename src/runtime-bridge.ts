// v0.6 P3 — connect the FR-22/23/24 contracts to the real execution path.
//
// This bridge OBSERVES. It never changes a notification, a receipt, a lease,
// a restart or a task state. The repository already has coalescing,
// self-progress exclusion, per-turn tool limits and session resume; replacing
// them here would regress verified journeys. `enforce` is opt-in via
// config.runtimeGuard and is recorded on every observation so the decision is
// auditable before anyone turns it on.
import { defaultAttentionPolicy, defaultWatchdogPolicy, filterEvent, inspectRun, recoveryFrom,
  type AttentionPolicy, type WatchdogPolicy, type IncomingEvent, type RunHeartbeat } from './runtime-guard.ts';
// 12b ⑩：升级通道「只通知不代批」+ 限速静音（纯函数，状态从 audit 表重建）。
import { escalationGate, ESCALATION_WINDOW_MS, type EscalationEvent } from './escalation.ts';

export type PolicyProvider = (space: string) => Promise<{ attention: AttentionPolicy; watchdog: WatchdogPolicy }>;

export interface TurnObservation {
  taskId: string;
  runId: string;
  actorId: string;
  summary: string;
  at: string;
  targetUserId?: string;
  kind?: IncomingEvent['kind'];
  toolCallsThisTurn?: number;
  rechecksThisDelegation?: number;
  interruptionsToday?: Record<string, number>;
  status?: RunHeartbeat['status'];
  lastProgressAt?: string;
  checkpoint?: string;
}

export interface Observation {
  attention: { wake: boolean; stage: string; reason: string };
  watchdog: { state: string; reason: string; recoveryAllowed: boolean; recoveryReason: string };
  enforced: boolean;
}

/** Notifications that ask a person to decide, approve or verify must never be
 *  suppressed by an attention budget — otherwise a task can wait forever. */
export const HUMAN_REQUIRED_OUTBOX = /^(ask|preview|accept|pr|intake|agent-service|collab-intake|workspace-completed|v06:grant-request|v06:transfer):/;

export interface NotificationGate {
  deliver: boolean;
  reason: string;
  mustDeliver: boolean;
  observation: Observation;
}

export class RuntimeGuardBridge {
  constructor(
    /** 12b ⑩：升级闸需要从 audit 表重建窗口状态；无 db 的测试桩自动退化为「无历史可查」。 */
    readonly store: { audit: (action: string, issueId: string, detail: unknown) => void;
      db?: { prepare: (sql: string) => { all: (...args: any[]) => any[] } } },
    readonly policies?: PolicyProvider,
    readonly enforce = false,
    readonly protectHumanNotifications = true,
  ) {}

  async observe(input: TurnObservation, space = 'default'): Promise<Observation> {
    // A policy lookup failure must not affect the turn; defaults are safe.
    const configured = this.policies ? await this.policies(space).catch(() => null) : null;
    const attentionPolicy = configured?.attention ?? defaultAttentionPolicy();
    const watchdogPolicy = configured?.watchdog ?? defaultWatchdogPolicy();
    const attention = filterEvent({
      id: `${input.taskId}:${input.runId}:${input.at}`,
      kind: input.kind ?? 'tool-call',
      actorId: input.actorId,
      targetUserId: input.targetUserId ?? input.actorId,
      withinRoleBoundary: true,
      summary: input.summary,
      at: input.at,
    }, attentionPolicy, {
      toolCallsThisTurn: input.toolCallsThisTurn ?? 0,
      rechecksThisDelegation: input.rechecksThisDelegation ?? 0,
      interruptionsToday: input.interruptionsToday ?? {},
    });
    const verdict = inspectRun({
      taskId: input.taskId,
      runId: input.runId,
      lastProgressAt: input.lastProgressAt ?? input.at,
      status: input.status ?? 'running',
      toolCalls: input.toolCallsThisTurn ?? 0,
      ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
    }, watchdogPolicy, input.at);
    const recovery = recoveryFrom(verdict);
    const result: Observation = {
      attention: { wake: attention.wake, stage: attention.stage, reason: attention.reason },
      watchdog: { state: verdict.state, reason: verdict.reason, recoveryAllowed: recovery.allowed, recoveryReason: recovery.reason },
      enforced: this.enforce,
    };
    this.store.audit('v06.runtime-observed', input.taskId, { runId: input.runId, space, ...result });
    return result;
  }

  /**
   * The actual enforcement point: low-value / self-progress outbox rows are
   * not sent when `enforce` is on. Human-required messages always pass, and
   * a task waiting on a person is recorded as `waiting-human` (never a stall).
   *
   * 12b ⑩（第三十一轮）：人必达消息之上再叠一层「升级通道闸」——同一问题
   * 等待期间不重复打扰、1 小时窗口最多 3 条升级通知，超出静音并留痕计数；
   * 恒不代批（通知文案不带也不代替批准动作）。首个新问题必达，不因限速漏发。
   */
  async gateNotification(input: {
    taskId: string; notificationId: string; summary: string; at?: string;
  }, space = 'default'): Promise<NotificationGate> {
    const at = input.at ?? new Date().toISOString();
    const mustDeliver = this.protectHumanNotifications
      && (HUMAN_REQUIRED_OUTBOX.test(input.notificationId)
        || /等待人工|请确认|需要你|请审批|请验收|追问/.test(input.summary));
    const selfProgress = /^(assistant-prepared|self-progress|worker-progress):/.test(input.notificationId);
    const observation = await this.observe({
      taskId: input.taskId, runId: `notify:${input.notificationId}`, actorId: 'system',
      summary: input.summary.slice(0, 200), at, kind: selfProgress ? 'self-progress' : 'signal',
      status: mustDeliver && /^(ask|v06:grant-request|v06:transfer):/.test(input.notificationId)
        ? 'waiting-human' : 'running',
    }, space);
    let deliver = !this.enforce || mustDeliver || observation.attention.wake;
    let reason = !this.enforce ? '只观测：未启用拦截'
      : mustDeliver ? '人工介入/结果通知，必须送达（等待人工不算卡死）'
        : observation.attention.reason;
    // 升级通道闸：只作用于人必达的升级类通知；被静音的如实记 audit 可追溯。
    if (mustDeliver) {
      const windowStart = new Date(Date.parse(at) - ESCALATION_WINDOW_MS).toISOString();
      const rows = this.store.db
        ? (this.store.db.prepare("SELECT value FROM audit WHERE action='v06.escalation-notified' AND at >= ? ORDER BY at")
          .all(windowStart) as { value: string }[])
        : [];
      const history: EscalationEvent[] = rows
        .map(row => { try { return JSON.parse(row.value) as EscalationEvent; } catch { return null; } })
        .filter((event): event is EscalationEvent => event !== null);
      const escalation = escalationGate(history,
        { taskId: input.taskId, topic: input.summary.slice(0, 160), at: Date.parse(at) });
      if (!escalation.notify) {
        deliver = false;
        reason = `升级通道静音（${escalation.reason}）；不代批，新问题不受限速影响`;
        this.store.audit('v06.escalation-muted', input.taskId,
          { notificationId: input.notificationId, topic: input.summary.slice(0, 160), reason: escalation.reason,
            windowCount: escalation.windowCount, mustDeliver: true, advisory: true });
      } else {
        this.store.audit('v06.escalation-notified', input.taskId,
          { taskId: input.taskId, topic: input.summary.slice(0, 160), at: Date.parse(at),
            notificationId: input.notificationId, windowCount: escalation.windowCount });
      }
    }
    this.store.audit('v06.notification-gated', input.taskId,
      { notificationId: input.notificationId, deliver, mustDeliver, reason, enforced: this.enforce });
    return { deliver, reason, mustDeliver, observation };
  }
}
