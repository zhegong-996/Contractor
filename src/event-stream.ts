// Unified, read-only event projection. This is NOT a second business database:
// the only writes are a Paperclip task document ('trace') and the native cost ledger.
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const evidenceKindSchema = z.enum(['captured', 'imported', 'authored']);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;
export const eventKindSchema = z.enum(['model', 'tool', 'receipt', 'ci', 'checkpoint', 'gate', 'acceptance']);
export type EventKind = z.infer<typeof eventKindSchema>;

export const tokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cached: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const sourceRefSchema = z.object({ id: z.string().min(1), revision: z.string().min(1) });
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const collabEventSchema = z.object({
  taskId: z.string().min(1),
  at: z.string().datetime(),
  kind: eventKindSchema,
  actor: z.string().min(1),
  provenance: z.string().min(1),
  evidenceKind: evidenceKindSchema,
  model: z.string().optional(),
  tool: z.string().optional(),
  tokens: tokenUsageSchema.optional(),
  costCents: z.number().nonnegative().optional(),
  sourceRef: sourceRefSchema.optional(),
  checkpoint: z.string().optional(),
  outcome: z.string().optional(),
  refs: z.array(z.string()).default([]),
});
export type CollabEvent = z.infer<typeof collabEventSchema>;
export type NormalizedEvent = { event: CollabEvent | null; missing: string[] };

export function eventId(event: CollabEvent): string {
  const stable = [event.taskId, event.at, event.kind, event.actor, event.provenance,
    event.checkpoint ?? '', event.outcome ?? '', event.tool ?? ''].join('|');
  return createHash('sha256').update(stable).digest('hex').slice(0, 32);
}

function normalize(input: unknown): NormalizedEvent {
  const parsed = collabEventSchema.safeParse(input);
  if (parsed.success) return { event: parsed.data, missing: [] };
  return { event: null, missing: parsed.error.issues.map(issue => issue.path.join('.') || 'root') };
}

function amount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function usageOf(raw: Record<string, any> | undefined): { tokens?: TokenUsage; costCents?: number } {
  const source = raw?.usage ?? raw?.sessionUsage;
  if (!source || typeof source !== 'object') return {};
  const tokens: TokenUsage = {
    input: amount(source.input ?? source.inputTokens),
    output: amount(source.output ?? source.outputTokens),
    cached: amount(source.cached ?? source.cachedInputTokens),
  };
  const hasTokens = tokens.input + tokens.output + tokens.cached > 0;
  const cost = typeof source.cost === 'number' ? source.cost
    : typeof source.costCents === 'number' ? source.costCents : undefined;
  return { ...(hasTokens ? { tokens } : {}), ...(cost !== undefined && cost >= 0 ? { costCents: cost } : {}) };
}

function timestamp(at?: string): string {
  if (at && !Number.isNaN(Date.parse(at))) return new Date(at).toISOString();
  return new Date().toISOString();
}

/** Harness / assistant-turn: one model invocation, captured from the CLI adapter receipt. */
export function fromAssistantTurn(raw: {
  taskId: string; jobId?: string; runId?: string; engine?: string; model?: string;
  usage?: Record<string, any>; at?: string; outcome?: string; sourceRef?: SourceRef;
}): NormalizedEvent {
  const { tokens, costCents } = usageOf(raw);
  return normalize({
    taskId: raw.taskId, at: timestamp(raw.at), kind: 'model',
    actor: raw.engine ?? 'workspace-assistant', provenance: 'harness', evidenceKind: 'captured',
    ...(raw.model ? { model: raw.model } : {}), ...(tokens ? { tokens } : {}),
    ...(costCents !== undefined ? { costCents } : {}),
    ...(raw.sourceRef ? { sourceRef: raw.sourceRef } : {}),
    ...(raw.outcome ? { outcome: raw.outcome } : {}),
    refs: [raw.jobId, raw.runId].filter((value): value is string => typeof value === 'string'),
  });
}

/** Autoloop worker journal: one execution receipt, including CLI usage when available. */
export function fromWorkerJournal(raw: {
  taskId: string; runId?: string; agent?: string; model?: string; usage?: Record<string, any>;
  at?: string; outcome?: string; session?: string; sourceRef?: SourceRef;
}): NormalizedEvent {
  const { tokens, costCents } = usageOf(raw);
  return normalize({
    taskId: raw.taskId, at: timestamp(raw.at), kind: 'receipt',
    actor: raw.agent ?? 'autoloop-worker', provenance: 'autoloop', evidenceKind: 'captured',
    ...(raw.model ? { model: raw.model } : {}), ...(tokens ? { tokens } : {}),
    ...(costCents !== undefined ? { costCents } : {}),
    ...(raw.sourceRef ? { sourceRef: raw.sourceRef } : {}),
    ...(raw.outcome ? { outcome: raw.outcome } : {}),
    ...(raw.session ? { checkpoint: raw.session } : {}),
    refs: [raw.runId].filter((value): value is string => typeof value === 'string'),
  });
}

/** One tool invocation. Agent-written conclusions must be marked 'authored', never 'captured'. */
export function fromToolCall(raw: {
  taskId: string; callId: string; tool: string; jobId?: string; runId?: string;
  at?: string; outcome?: string; evidenceKind?: EvidenceKind; sourceRef?: SourceRef;
}): NormalizedEvent {
  return normalize({
    taskId: raw.taskId, at: timestamp(raw.at), kind: 'tool',
    actor: raw.tool, provenance: 'harness', evidenceKind: raw.evidenceKind ?? 'captured',
    tool: raw.tool, ...(raw.outcome ? { outcome: raw.outcome } : {}),
    ...(raw.sourceRef ? { sourceRef: raw.sourceRef } : {}),
    refs: [raw.callId, raw.jobId, raw.runId].filter((value): value is string => typeof value === 'string'),
  });
}

/** GitHub CI / preview: a delivery outcome, not a claim that the work is correct. */
export function fromDelivery(raw: {
  taskId: string; sha?: string; ci?: string; environment?: string; pr?: number;
  at?: string; sourceRef?: SourceRef;
}): NormalizedEvent {
  return normalize({
    taskId: raw.taskId, at: timestamp(raw.at), kind: 'ci',
    actor: 'github-actions', provenance: 'github', evidenceKind: 'captured',
    outcome: raw.ci ?? 'unknown', ...(raw.sha ? { checkpoint: raw.sha } : {}),
    ...(raw.sourceRef ? { sourceRef: raw.sourceRef } : {}),
    refs: [raw.pr !== undefined ? `pr:${raw.pr}` : '', raw.environment ?? ''].filter(Boolean),
  });
}

/** Explicit gate / acceptance / checkpoint events. Evidence kind is chosen by the caller. */
export function capture(input: z.input<typeof collabEventSchema>): NormalizedEvent {
  return normalize(input);
}

/** B2 admission: fields that must exist before L4 evidence-based acceptance is allowed. */
export function traceGaps(events: CollabEvent[]): string[] {
  const gaps: string[] = [];
  if (!events.length) return ['events: 事件流为空'];
  const kinds = new Set(events.map(event => event.kind));
  for (const kind of ['model', 'receipt', 'ci'] as const) {
    if (!kinds.has(kind)) gaps.push(`kind:${kind} 缺失`);
  }
  if (!events.some(event => event.tokens)) gaps.push('tokens: 未记录任何 token 用量');
  if (!events.some(event => typeof event.costCents === 'number')) gaps.push('costCents: 未记录任何成本');
  if (!events.some(event => event.sourceRef)) gaps.push('sourceRef: 无来源版本引用');
  return gaps;
}

export function assertTraceReady(events: CollabEvent[], level: string): { ready: boolean; gaps: string[] } {
  const gaps = traceGaps(events);
  if (level === 'L4' && gaps.length) throw new Error(`L4 验收证据链不完整：${gaps.join('；')}`);
  return { ready: true, gaps };
}

/** Native Paperclip cost-event payload. Returns null when usage/cost cannot be reported truthfully. */
export function costEventFor(event: CollabEvent, opts: {
  agentId: string; projectId?: string; issueId?: string;
}): Record<string, unknown> | null {
  if (!event.tokens || typeof event.costCents !== 'number') return null;
  return {
    agentId: opts.agentId,
    issueId: opts.issueId ?? event.taskId,
    ...(opts.projectId ? { projectId: opts.projectId } : {}),
    provider: event.provenance,
    model: event.model ?? event.provenance,
    inputTokens: event.tokens.input,
    cachedInputTokens: event.tokens.cached,
    outputTokens: event.tokens.output,
    costCents: Math.round(event.costCents),
    occurredAt: event.at,
    idempotencyKey: `trace:${eventId(event)}`,
  };
}

export function projectTrace(events: CollabEvent[]): string {
  return '```json\n' + JSON.stringify({ schemaVersion: 1, events, gaps: traceGaps(events) }, null, 2) + '\n```';
}

export function parseTrace(body: string): CollabEvent[] {
  const text = String(body ?? '').trim();
  if (!text) return [];
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(text);
  let parsed: unknown;
  try { parsed = JSON.parse(fenced ? fenced[1]! : text); }
  catch { return []; }
  const list = Array.isArray(parsed) ? parsed : (parsed as { events?: unknown })?.events;
  if (!Array.isArray(list)) return [];
  return list.flatMap(item => {
    const result = collabEventSchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

export interface TraceWriter {
  get<T = any>(route: string): Promise<T>;
  document(issueId: string, key: string, title: string, body: string): Promise<any>;
  post<T = any>(route: string, body: unknown): Promise<T>;
}

export class EventSink {
  constructor(readonly writer: TraceWriter, readonly companyId?: string) {}

  async read(taskId: string): Promise<CollabEvent[]> {
    let doc: any;
    try { doc = await this.writer.get(`/issues/${taskId}/documents/trace`); }
    catch (error) { if (String(error).includes(': 404 ')) return []; throw error; }
    return parseTrace(String(doc?.body ?? ''));
  }

  async append(taskId: string, event: CollabEvent): Promise<{ events: CollabEvent[]; gaps: string[]; duplicate: boolean }> {
    const existing = await this.read(taskId);
    const key = eventId(event);
    if (existing.some(item => eventId(item) === key)) {
      return { events: existing, gaps: traceGaps(existing), duplicate: true };
    }
    const events = [...existing, event];
    await this.writer.document(taskId, 'trace', '统一事件流水', projectTrace(events));
    return { events, gaps: traceGaps(events), duplicate: false };
  }

  async flushCosts(taskId: string, agentId: string, projectId?: string): Promise<{ posted: number; skipped: number }> {
    if (!this.companyId) return { posted: 0, skipped: 0 };
    const events = await this.read(taskId);
    let posted = 0, skipped = 0;
    for (const event of events) {
      const payload = costEventFor(event, { agentId, projectId });
      if (!payload) { skipped++; continue; }
      try {
        await this.writer.post(`/companies/${this.companyId}/cost-events`, payload);
        posted++;
      } catch (error) {
        if (/duplicate|409|idempoten/i.test(String(error))) skipped++;
        else throw error;
      }
    }
    return { posted, skipped };
  }
}
