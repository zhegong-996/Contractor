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

export class RuntimeGuardBridge {
  constructor(
    readonly store: { audit: (action: string, issueId: string, detail: unknown) => void },
    readonly policies?: PolicyProvider,
    readonly enforce = false,
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
}
