// Preserve the upstream optimistic-revision contract when updating an existing task document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Paperclip } from '../src/paperclip.ts';
test('document updates use the latestRevisionId returned by the real API contract', async () => {
  const pc = new Paperclip('http://127.0.0.1:3100'); const calls: any[] = [];
  pc.request = (async (method: string, route: string, body: any) => {
    calls.push({ method, route, body });
    return method === 'GET' ? { body: 'existing task checkpoint', latestRevisionId: 'revision-two' } : { latestRevisionId: 'revision-three' };
  }) as any;
  await pc.document('task', 'handoff', '交接包', 'updated checkpoint');
  assert.equal(calls[1].body.baseRevisionId, 'revision-two');
});
