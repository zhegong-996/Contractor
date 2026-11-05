// The trace is evidence, not a business database. Any failure must be
// absorbed and audited — a broken sink must never change a task outcome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TraceBridge } from '../src/trace-bridge.ts';
import { capture } from '../src/event-stream.ts';
import type { Config } from '../src/config.ts';
import type { Store } from '../src/store.ts';
import type { Paperclip } from '../src/paperclip.ts';

const at = '2026-11-05T12:00:00.000Z';

function event(extra: Record<string, unknown> = {}) {
  const result = capture({ taskId: 'task-1', at, kind: 'model', actor: 'tester',
    provenance: 'test', evidenceKind: 'captured', ...extra });
  assert.ok(result.event, JSON.stringify(result.missing));
  return result.event!;
}

function setup(configOverride: Record<string, unknown> = {}) {
  const docs: Record<string, any> = {};
  const posts: { route: string; body: any }[] = [];
  const audits: any[][] = [];
  const pc = {
    get: async (route: string) => {
      const key = route.split('/').pop()!;
      if (!docs[key]) throw new Error(`Paperclip GET ${route}: 404 not found`);
      return docs[key];
    },
    document: async (_issueId: string, key: string, _title: string, body: string) => {
      docs[key] = { body, latestRevisionId: 'rev-1' }; return {};
    },
    post: async (route: string, body: unknown) => { posts.push({ route, body }); return {}; },
  } as unknown as Paperclip;
  const store = { audit: (...args: any[]) => audits.push(args) } as unknown as Store;
  const config = { companyId: 'company-1', projectId: 'project-1',
    agents: { dev: { paperclipId: 'agent-1' } }, ...configOverride } as unknown as Config;
  return { bridge: new TraceBridge(pc, config, store), pc, docs, posts, audits };
}

test('a normal append lands in the native document and the audit table', async () => {
  const { bridge, docs, audits } = setup();
  assert.deepEqual(await bridge.append('task-1', event()), { recorded: true });
  assert.match(docs.trace.body, /schemaVersion/);
  assert.ok(audits.some(row => row[0] === 'trace.appended'));
});

test('invalid or duplicate events are absorbed, never thrown at the caller', async () => {
  const { bridge } = setup();
  assert.deepEqual(await bridge.append('task-1', null), { recorded: false, reason: 'invalid-event' });
  const duplicate = event();
  assert.deepEqual(await bridge.append('task-1', duplicate), { recorded: true });
  assert.deepEqual(await bridge.append('task-1', duplicate), { recorded: false });
});

test('a broken trace sink does not fail the business action', async () => {
  const { bridge, pc, audits } = setup();
  (pc as any).get = async () => { throw new Error('Paperclip GET /trace: 500 backend down'); };
  const result = await bridge.append('task-1', event());
  assert.deepEqual(result, { recorded: false, reason: 'trace-sink-unavailable' });
  assert.ok(audits.some(row => row[0] === 'trace.append-failed'));
});

test('cost is only flushed with a company and agent binding', async () => {
  const unbound = setup({ companyId: undefined });
  assert.equal((await unbound.bridge.flush('task-1', 'dev')).reason, 'no-company-or-agent-binding');
  assert.equal(unbound.posts.length, 0);

  const { bridge, posts, audits } = setup();
  await bridge.append('task-1', event({ model: 'gpt-prod', tokens: { input: 10, output: 2, cached: 0 },
    costCents: 7, sourceRef: { id: 'doc', revision: 'v1' } }));
  const flushed = await bridge.flush('task-1', 'dev');
  assert.equal(flushed.posted, 1);
  assert.match(posts[0]!.route, /\/cost-events$/);
  assert.equal(posts[0]!.body.costCents, 7);
  assert.ok(audits.some(row => row[0] === 'trace.cost-flushed'));
});

test('a failed read reports unavailable instead of fabricating an empty, passing chain', async () => {
  const { bridge, pc } = setup();
  (pc as any).get = async () => { throw new Error('Paperclip GET /trace: 503 unavailable'); };
  const view = await bridge.view('task-1');
  assert.equal(view.available, false);
  assert.deepEqual(view.events, []);
  assert.ok(view.gaps.some(gap => gap.includes('未据此判定验收')));
});
