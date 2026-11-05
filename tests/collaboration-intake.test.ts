import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.ts';
import { CollaborationIntake } from '../src/collaboration-intake.ts';
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-im-context-')), store = new Store(path.join(dir, 'state.sqlite'));
  const task: any = { id: 'task-one', identifier: 'SUI-1', triggerId: 'private-task', chatId: 'local', messageId: 'local', senderId: 'local-operator',
    agent: 'executor', generation: 1, phase: 'ready', kind: 'collaboration', context: '{}', workspace: '', branch: '' }; store.save(task);
  const state: any = { sources: ['approved-source'], requests: ['approved-request'], history: [], imBinding: { senderId: 'ou_owner', chatId: 'oc_test' } };
  const calls: string[] = []; const w: any = { config: { feishu: { allowedSenders: ['ou_owner'], allowedChats: ['oc_test'], botId: 'ou_bot', appId: 'cli_test' }, paperclipUrl: 'http://localhost:3100' },
    store, state: async () => state, save: async (t: any) => { store.save(t); }, manager: (a: any) => { if (!a.admin) throw new Error('Unauthorized'); } };
  const assistant: any = { delegate: async (_id: string, enabled: boolean) => { calls.push(enabled ? 'resume' : 'pause'); }, taskContext: { note: async () => { calls.push('note'); } } };
  const event = { message_id: 'om_resume', chat_id: 'oc_test', chat_type: 'p2p', sender_id: 'ou_owner', sender_type: 'user', content: '/collab SUI-1 接续', create_time: '1793800000000' };
  return { store, task, state, calls, event, intake: new CollaborationIntake(w, assistant), close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('a real IM command resumes the same pre-bound task once without adding sources or permissions', async () => {
  const f = fixture(); try {
    await f.intake.ingest(f.event); await f.intake.ingest({ ...f.event, event_id: 'another-delivery' });
    assert.equal(f.store.list().length, 1); assert.deepEqual(f.calls, ['resume']); assert.equal(f.store.get(f.task.id).messageId, 'om_resume');
    assert.deepEqual(f.state.sources, ['approved-source']); assert.deepEqual(f.state.requests, ['approved-request']);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM outbox').get()?.n, 1);
  } finally { f.close(); }
});
test('a whitelist alone cannot control another task that was not bound to this chat and sender', async () => {
  const f = fixture(); try { f.state.imBinding = undefined; await assert.rejects(f.intake.ingest(f.event), /binding/); assert.equal(f.calls.length, 0); }
  finally { f.close(); }
});
test('unapproved senders cannot resume, append background or change a task', async () => {
  const f = fixture(); try { await assert.rejects(f.intake.ingest({ ...f.event, sender_id: 'ou_stranger', content: '/collab SUI-1 authorize everyone' }), /Unauthorized/); assert.equal(f.calls.length, 0); }
  finally { f.close(); }
});
test('pause does not create another task or treat IM text as permission approval', async () => {
  const f = fixture(); try { await f.intake.ingest({ ...f.event, content: '/collab SUI-1 暂停' }); assert.deepEqual(f.calls, ['pause']); assert.equal(f.store.list().length, 1); }
  finally { f.close(); }
});
