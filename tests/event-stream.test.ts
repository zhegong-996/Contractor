// The trace projection is the single evidence source for acceptance. It must
// never invent usage/cost, and it must never become a second business database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fromAssistantTurn, fromWorkerJournal, fromToolCall, fromDelivery, capture,
  traceGaps, assertTraceReady, costEventFor, eventId, parseTrace, projectTrace,
  EventSink, type CollabEvent, type TraceWriter,
} from '../src/event-stream.ts';

const at = '2026-11-05T12:00:00.000Z';
const agentId = '00000000-0000-4000-8000-000000000000';

function event(partial: Partial<CollabEvent> & Pick<CollabEvent, 'kind'>): CollabEvent {
  const result = capture({ taskId: 'task-one', at, actor: 'tester', provenance: 'test', evidenceKind: 'captured', ...partial });
  assert.deepEqual(result.missing, []);
  assert.ok(result.event);
  return result.event!;
}

function mockWriter() {
  const docs: Record<string, { body: string; latestRevisionId: string }> = {};
  const posts: { route: string; body: unknown }[] = [];
  const writer: TraceWriter = {
    get: async <T = any>(route: string): Promise<T> => {
      const key = route.split('/').pop()!;
      if (!docs[key]) throw new Error(`Paperclip GET ${route}: 404 not found`);
      return docs[key] as T;
    },
    document: async (_issueId, key, _title, body) => {
      docs[key] = { body, latestRevisionId: `rev-${Object.keys(docs).length + 1}` };
      return {};
    },
    post: async <T = any>(route: string, body: unknown): Promise<T> => {
      posts.push({ route, body }); return {} as T;
    },
  };
  return { writer, docs, posts };
}

test('the three existing evidence sources normalize into one shape', () => {
  const model = fromAssistantTurn({ taskId: 'task-one', at, engine: 'codex', model: 'gpt-prod',
    usage: { input: 100, output: 20, cached: 5, costCents: 42 }, jobId: 'job-1', runId: 'run-1' });
  assert.deepEqual(model.missing, []);
  assert.equal(model.event!.kind, 'model');
  assert.equal(model.event!.provenance, 'harness');
  assert.equal(model.event!.evidenceKind, 'captured');
  assert.deepEqual(model.event!.tokens, { input: 100, output: 20, cached: 5 });
  assert.equal(model.event!.costCents, 42);
  assert.deepEqual(model.event!.refs, ['job-1', 'run-1']);

  const receipt = fromWorkerJournal({ taskId: 'task-one', at, agent: 'codex', model: 'gpt-prod',
    usage: { inputTokens: 3, outputTokens: 4 }, outcome: 'done', session: 'sess-1' });
  assert.equal(receipt.event!.kind, 'receipt');
  assert.equal(receipt.event!.provenance, 'autoloop');
  assert.equal(receipt.event!.checkpoint, 'sess-1');
  assert.deepEqual(receipt.event!.tokens, { input: 3, output: 4, cached: 0 });

  const ci = fromDelivery({ taskId: 'task-one', at, sha: 'a'.repeat(40), ci: 'passed', pr: 3, environment: 'local-pr-preview' });
  assert.equal(ci.event!.kind, 'ci');
  assert.equal(ci.event!.outcome, 'passed');
  assert.equal(ci.event!.checkpoint, 'a'.repeat(40));
});

test('agent-written conclusions stay authored and are never reported as captured evidence', () => {
  const written = fromToolCall({ taskId: 'task-one', at, callId: 'call-1', tool: 'write_summary', evidenceKind: 'authored' });
  assert.equal(written.event!.evidenceKind, 'authored');
  assert.notEqual(written.event!.evidenceKind, 'captured');
  const captured = fromToolCall({ taskId: 'task-one', at, callId: 'call-2', tool: 'read_source' });
  assert.equal(captured.event!.evidenceKind, 'captured');
});

test('malformed events are rejected with field paths instead of being silently stored', () => {
  const bad = capture({ taskId: '', at: 'not-a-date', kind: 'model', actor: '', provenance: '', evidenceKind: 'captured' });
  assert.equal(bad.event, null);
  assert.ok(bad.missing.length >= 3);
});

test('cost is only reported when usage and cost are both known; idempotency is stable', () => {
  const withCost = event({ kind: 'model', model: 'gpt-prod', tokens: { input: 100, output: 20, cached: 5 },
    costCents: 42, sourceRef: { id: 'doc', revision: 'v1' } });
  const payload = costEventFor(withCost, { agentId, projectId: 'project-one' })!;
  assert.equal(payload.inputTokens, 100);
  assert.equal(payload.cachedInputTokens, 5);
  assert.equal(payload.costCents, 42);
  assert.match(String(payload.idempotencyKey), /^trace:/);
  assert.equal(costEventFor({ ...withCost, costCents: undefined }, { agentId }), null);
  assert.equal(costEventFor({ ...withCost, tokens: undefined }, { agentId }), null);
  assert.equal(costEventFor(withCost, { agentId })!.idempotencyKey, costEventFor({ ...withCost }, { agentId })!.idempotencyKey);
});

test('L4 admission requires a complete, replayable evidence chain', () => {
  const gaps = traceGaps([event({ kind: 'model' })]);
  assert.ok(gaps.some(gap => gap.includes('receipt')));
  assert.ok(gaps.some(gap => gap.includes('ci')));
  assert.ok(gaps.some(gap => gap.includes('costCents')));
  assert.throws(() => assertTraceReady([], 'L4'), /证据链不完整/);
  assert.doesNotThrow(() => assertTraceReady([], 'L3'));
  const complete = [
    event({ kind: 'model', tokens: { input: 1, output: 1, cached: 0 }, costCents: 1, sourceRef: { id: 'doc', revision: 'v1' } }),
    event({ kind: 'receipt' }),
    event({ kind: 'ci' }),
  ];
  assert.deepEqual(traceGaps(complete), []);
  assert.doesNotThrow(() => assertTraceReady(complete, 'L4'));
});

test('the projection round-trips and tolerates empty or invalid documents', () => {
  const events = [event({ kind: 'model' }), event({ kind: 'ci', checkpoint: 'abc' })];
  assert.equal(parseTrace(projectTrace(events)).length, 2);
  assert.deepEqual(parseTrace(''), []);
  assert.deepEqual(parseTrace('not json'), []);
  assert.deepEqual(parseTrace('```json\n{"events":[{"bad":true}]}\n```'), []);
});

test('EventSink appends idempotently and posts only truthful costs to the native ledger', async () => {
  const { writer, docs, posts } = mockWriter();
  const sink = new EventSink(writer, 'company-one');
  const recorded = event({ kind: 'model', model: 'gpt-prod', tokens: { input: 10, output: 2, cached: 0 },
    costCents: 7, sourceRef: { id: 'doc', revision: 'v1' } });
  const first = await sink.append('task-one', recorded);
  assert.equal(first.duplicate, false);
  assert.equal(first.events.length, 1);
  const second = await sink.append('task-one', recorded);
  assert.equal(second.duplicate, true);
  assert.equal((await sink.read('task-one')).length, 1);
  assert.ok(docs.trace.body.includes('统一事件流水') === false || docs.trace.body.includes('schemaVersion'));

  await sink.append('task-one', event({ kind: 'receipt' }));
  const flushed = await sink.flushCosts('task-one', agentId);
  assert.equal(flushed.posted, 1);
  assert.equal(flushed.skipped, 1);
  assert.match(posts[0]!.route, /\/cost-events$/);
  assert.equal((posts[0]!.body as any).costCents, 7);
});

test('without a company binding the sink never writes cost events', async () => {
  const { writer, posts } = mockWriter();
  const sink = new EventSink(writer);
  await sink.append('task-one', event({ kind: 'model', tokens: { input: 1, output: 1, cached: 0 }, costCents: 1 }));
  assert.deepEqual(await sink.flushCosts('task-one', agentId), { posted: 0, skipped: 0 });
  assert.equal(posts.length, 0);
});
