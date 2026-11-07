// 统一路由 Trace：五个派活点写同一份 append-only 事件日志。
//
// 与 trace-bridge.ts 的分工：TraceBridge 写的是「验收证据 / 成本」投影，属于
// 业务验收链；这里写的是「谁把任务交给谁」的路由决策链。两者都是 best-effort，
// 写入失败绝不改变任务、回执或验收结果（与 TraceBridge 的 advisory 语义一致）。
//
// B 阶段复用：每行都是严格通过 memoryEventSchema 的 MemoryEvent，
// readRoutingEvents() / replayRouting() 就是记忆主干重放的最小实现，
// 不需要再引入第二个日志格式。
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { runtime } from './config.ts';
import { memoryEventSchema, type MemoryEvent } from './architecture-contracts.ts';
import { decisionOf, toMemoryEvent, type RoutingDecision } from './routing-decision.ts';

export const routingLogPath = (dir?: string) => path.join(dir ?? runtime('routing'), 'events.jsonl');

export interface RoutingSink { write(line: string): void }

export class FileRoutingSink implements RoutingSink {
  constructor(readonly file: string) { mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); }
  write(line: string) { appendFileSync(this.file, line + '\n', { mode: 0o600 }); }
}

export class MemoryRoutingSink implements RoutingSink {
  readonly lines: string[] = [];
  write(line: string) { this.lines.push(line); }
}

export type RoutingAudit = (action: string, issueId: string | null, value: unknown) => void;

export class RoutingTrace {
  private readonly seen = new Set<string>();
  constructor(
    readonly sinks: RoutingSink[] = [new FileRoutingSink(routingLogPath())],
    private audit?: RoutingAudit,
  ) {}

  /** 追加一次审计通道；server.ts 启动时调用一次，五个调用点无需各自持有 Store。 */
  attachAudit(audit: RoutingAudit) { this.audit = audit; return this; }

  /**
   * 记录一条路由决策。永远同步、永远不抛错：日志是证据，不是业务前置条件。
   */
  record(decision: RoutingDecision): { written: boolean; reason?: string; duplicate: boolean } {
    if (this.seen.has(decision.decisionId)) return { written: false, duplicate: true, reason: 'duplicate-in-process' };
    try {
      const event = memoryEventSchema.parse(toMemoryEvent(decision));
      const line = JSON.stringify(event);
      let written = 0;
      for (const sink of this.sinks) {
        try { sink.write(line); written++; } catch { /* 单个 sink 失败不影响其它 sink */ }
      }
      this.seen.add(decision.decisionId);
      try {
        this.audit?.('routing.decision', decision.taskId, {
          decisionId: decision.decisionId, stage: decision.stage,
          caller: decision.caller, target: decision.target, basisKind: decision.basis.kind,
          outcome: decision.outcome, requiresHumanSignature: decision.requiresHumanSignature,
          sourceCount: decision.scope.sourceIds.length,
        });
      } catch { /* 审计表不可用不改业务结果 */ }
      return { written: written > 0, duplicate: false, ...(written === 0 ? { reason: 'no-sink-available' } : {}) };
    } catch (error) {
      return { written: false, duplicate: false, reason: 'invalid-decision: ' + String(error).slice(0, 200) };
    }
  }
}

let current: RoutingTrace | undefined;
/**
 * 五个调用点共用的单例。测试进程由 scripts/test.ts 标记 COLLAB_TEST_TRACE=memory，
 * 事件只进内存，避免把测试动作混进真实业务 Trace（审计留痕必须只含真实动作）。
 */
export function getRoutingTrace(): RoutingTrace {
  if (current) return current;
  if (process.env.COLLAB_TEST_TRACE === 'memory') return current = new RoutingTrace([new MemoryRoutingSink()]);
  return current = new RoutingTrace();
}
export function setRoutingTrace(trace: RoutingTrace | null): void { current = trace ?? undefined; }

/** 只读重放：所有行必须通过 memoryEventSchema，坏行不静默丢弃，记入 errors。 */
export function readRoutingEvents(file = routingLogPath()): { events: MemoryEvent[]; errors: string[] } {
  if (!existsSync(file)) return { events: [], errors: [] };
  const events: MemoryEvent[] = [], errors: string[] = [];
  readFileSync(file, 'utf8').split('\n').filter(Boolean).forEach((line, index) => {
    try { events.push(memoryEventSchema.parse(JSON.parse(line))); }
    catch (error) { errors.push(`line ${index + 1}: ${String(error).slice(0, 160)}`); }
  });
  return { events, errors };
}

export type RoutingProjection = {
  events: number;
  decisions: number;
  uniqueDecisions: number;
  byStage: Record<string, number>;
  byTargetRole: Record<string, number>;
  humanSignature: number;
  rejected: number;
  tasks: string[];
  chain: { taskId: string; at: string; caller: string; target: string; stage: string }[];
};

/** B 阶段验收口径：重放可复现（同一日志两次投影结果一致）、去重后按时间有序。 */
export function replayRouting(events: MemoryEvent[]): RoutingProjection {
  const seen = new Set<string>();
  const decisions = events.map(decisionOf).filter((d): d is RoutingDecision => d !== null)
    .filter(d => !seen.has(d.decisionId) && Boolean(seen.add(d.decisionId)))
    .sort((a, b) => a.at.localeCompare(b.at));
  const byStage: Record<string, number> = {}, byTargetRole: Record<string, number> = {};
  for (const d of decisions) {
    byStage[d.stage] = (byStage[d.stage] ?? 0) + 1;
    byTargetRole[d.target.role] = (byTargetRole[d.target.role] ?? 0) + 1;
  }
  return {
    events: events.length, decisions: decisions.length, uniqueDecisions: seen.size,
    byStage, byTargetRole,
    humanSignature: decisions.filter(d => d.requiresHumanSignature).length,
    rejected: decisions.filter(d => d.outcome === 'rejected').length,
    tasks: [...new Set(decisions.map(d => d.taskId))],
    chain: decisions.map(d => ({ taskId: d.taskId, at: d.at,
      caller: d.caller.actor + ':' + d.caller.role, target: d.target.agentKey ?? d.target.serviceId ?? d.target.roleId ?? d.target.role,
      stage: d.stage })),
  };
}
