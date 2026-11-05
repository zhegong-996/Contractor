// Best-effort bridge between the existing execution chain and the read-only
// trace projection. The trace is evidence, not a second business database:
// a failure to record or to bill must NEVER change a task, receipt or
// acceptance outcome. Every failure lands in the native audit table instead.
import type { Config } from './config.ts';
import type { Store } from './store.ts';
import type { Paperclip } from './paperclip.ts';
import { EventSink, traceGaps, type CollabEvent, type NormalizedEvent } from './event-stream.ts';

export type TraceInput = CollabEvent | NormalizedEvent | null | undefined;

function unwrap(input: TraceInput): CollabEvent | null {
  if (!input) return null;
  if ('event' in (input as object)) return (input as NormalizedEvent).event;
  return input as CollabEvent;
}

export class TraceBridge {
  constructor(readonly pc: Paperclip, readonly config: Config, readonly store: Store) {}

  private sink() { return new EventSink(this.pc, this.config.companyId); }

  private failure(kind: string, taskId: string, error: unknown) {
    // Even auditing must not become a new failure point for a business action.
    try { this.store.audit(`trace.${kind}-failed`, taskId, { reason: String(error).slice(0, 300) }); }
    catch { /* the trace is advisory; the business result stands */ }
  }

  /** Accepts either a validated CollabEvent or the output of a from* normalizer. */
  async append(taskId: string, input: TraceInput): Promise<{ recorded: boolean; reason?: string }> {
    const event = unwrap(input);
    if (!event) return { recorded: false, reason: 'invalid-event' };
    try {
      const result = await this.sink().append(taskId, event);
      try { this.store.audit('trace.appended', taskId, { kind: event.kind, duplicate: result.duplicate, gaps: result.gaps }); } catch { /* advisory */ }
      return { recorded: !result.duplicate };
    } catch (error) {
      this.failure('append', taskId, error);
      return { recorded: false, reason: 'trace-sink-unavailable' };
    }
  }

  /** Backfill real usage/cost into the native Paperclip cost ledger. Never invents amounts. */
  async flush(taskId: string, agentKey: string): Promise<{ posted: number; skipped: number; reason?: string }> {
    const agentId = this.config.agents[agentKey]?.paperclipId;
    if (!agentId || !this.config.companyId) return { posted: 0, skipped: 0, reason: 'no-company-or-agent-binding' };
    try {
      const result = await this.sink().flushCosts(taskId, agentId, this.config.projectId);
      try { this.store.audit('trace.cost-flushed', taskId, result); } catch { /* advisory */ }
      return result;
    } catch (error) {
      this.failure('cost-flush', taskId, error);
      return { posted: 0, skipped: 0, reason: 'cost-ledger-unavailable' };
    }
  }

  async view(taskId: string): Promise<{ events: CollabEvent[]; gaps: string[]; available: boolean }> {
    try {
      const events = await this.sink().read(taskId);
      return { events, gaps: traceGaps(events), available: true };
    } catch (error) {
      this.failure('read', taskId, error);
      return { events: [], gaps: ['trace: 读取失败，未据此判定验收'], available: false };
    }
  }
}
