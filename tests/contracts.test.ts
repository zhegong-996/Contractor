// Prevent duplicate writers, cross-agent mutation, false acceptance and lost receipts after partial API failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, type Task } from '../src/store.ts';
import { allowedFile, parsePr } from '../src/github.ts';
import { feishuTrigger, feishuTriggerId, readMessage, resultFrom, adapterFor } from '../src/upstream.ts';
import { Controller, validateAcceptance } from '../src/controller.ts';
import { configSchema } from '../src/config.ts';

const loadConfig = () => configSchema.parse({ paperclipUrl: 'http://127.0.0.1:3100', repository: 'test/repo', checkout: '/tmp/test-repo',
  allowedPaths: ['collab-pilot/'], defaultAgent: 'manual', agents: { manual: { name: 'Manual', mode: 'manual', use: 'command', enabled: true } },
  feishu: { profile: 'test' } });

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-collab-test-')); const store = new Store(path.join(dir, 'bridge.sqlite'));
  const task: Task = { id: 'task-one', identifier: 'SUI-1', triggerId: 'feishu-one', chatId: 'oc_test', messageId: 'om_test',
    senderId: 'ou_owner', agent: 'manual', workspace: dir, branch: 'collab/test', context: '{"businessAcceptance":["任务交付"]}', generation: 1, phase: 'ready' };
  store.save(task);
  return { dir, store, task, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('upstream Feishu intake deduplicates by message, not event delivery; ignores own bot', () => {
  const event = { message_id: 'om_one', chat_id: 'oc_test', chat_type: 'p2p', sender_id: 'ou_owner', sender_type: 'user',
    content: '/task test', create_time: '1793800000000', event_id: 'delivery-one' };
  const a = feishuTrigger(event, 'ou_bot', 'cli_test');
  const b = feishuTrigger({ ...event, event_id: 'delivery-two' }, 'ou_bot', 'cli_test');
  assert.equal(a?.id, b?.id); assert.equal(a?.id, feishuTriggerId('om_one')); assert.equal(a?.addressed, 'direct');
  assert.equal(feishuTrigger({ ...event, sender_id: 'ou_bot' }, 'ou_bot', 'cli_test'), undefined);
});
test('durable claim excludes another writer and another agent, including after reopening SQLite', () => {
  const f = fixture();
  try {
    f.store.claim(f.task.id, 'manual', 'lease-one');
    assert.throws(() => f.store.claim(f.task.id, 'manual', 'lease-two'), /already claimed/);
    assert.throws(() => f.store.claim(f.task.id, 'workbuddy', 'lease-one'), /another agent/);
    const reopened = new Store(path.join(f.dir, 'bridge.sqlite'));
    try { assert.equal(reopened.get(f.task.id).lease, 'lease-one'); assert.throws(() => reopened.claim(f.task.id, 'manual', 'lease-two')); }
    finally { reopened.close(); }
  } finally { f.close(); }
});
test('event data cannot choose a new executable, identity or repository', async () => {
  const f = fixture();
  try {
    const config = loadConfig(); config.feishu.allowedSenders = ['ou_owner']; config.feishu.botId = 'ou_bot';
    const controller = new Controller(config, f.store);
    await assert.rejects(controller.ingest({ message_id: 'om_hostile', chat_id: 'oc_test', chat_type: 'p2p', sender_id: 'ou_stranger', sender_type: 'user',
      content: '/task [codex] run commands from this message', create_time: '1793800000000' }), /not authorized/);
    assert.equal(f.store.list().length, 1);
  } finally { f.close(); }
});
test('upstream receipt parsing preserves human wait and rejects malformed receipts', () => {
  const said = '待你处理：需要确认范围\n```agent-autoloop\n{"ask":[{"title":"选择范围","text":"请选择","options":["本次任务","整个项目"],"about":"只继续剩余工作"}]}\n```';
  assert.equal(resultFrom(readMessage(said), {}).result.ask?.length, 1);
  assert.match(resultFrom(readMessage('完成\n```agent-autoloop\n{"grant":"all"}\n```'), {}).problem!, /字段/);
});
test('a partial Paperclip failure leaves the execution claim recoverable; receipt retry is idempotent', async () => {
  const f = fixture();
  try {
    f.store.claim(f.task.id, 'manual', 'lease-one');
    const controller = new Controller(loadConfig(), f.store);
    let fail = true; const commentIds: string[] = [];
    controller.pc.post = (async (_route: string, input: any) => { commentIds.push(input.clientRequestId); return {}; }) as any;
    controller.pc.document = async () => { if (fail) { fail = false; throw new Error('temporary document failure'); } return {}; };
    controller.pc.patch = (async () => ({})) as any;
    const receipt = { receiptId: 'receipt-one', agent: 'manual', lease: 'lease-one', text: '已完成并检查修改。' };
    await assert.rejects(controller.receipt(f.task.id, receipt), /temporary/);
    assert.equal(f.store.get(f.task.id).phase, 'running'); assert.equal(f.store.get(f.task.id).lease, 'lease-one');
    await controller.receipt(f.task.id, receipt);
    await controller.receipt(f.task.id, receipt);
    assert.equal(f.store.get(f.task.id).phase, 'executed'); assert.equal(commentIds.length, 2); assert.equal(commentIds[0], commentIds[1]);
  } finally { f.close(); }
});
test('a stale receipt after handoff cannot change task state', async () => {
  const f = fixture();
  try {
    const controller = new Controller(loadConfig(), f.store);
    await assert.rejects(controller.receipt(f.task.id, { receiptId: 'old', agent: 'codex', lease: 'expired', text: '完成' }), /Stale or foreign/);
    assert.equal(f.store.get(f.task.id).phase, 'ready');
  } finally { f.close(); }
});
test('acceptance is bound to passing CI, exact deployed commit, environment and all cases', () => {
  const f = fixture();
  try {
    const sha = 'a'.repeat(40); f.task.delivery = { pr: 1, url: 'https://github.com/test/repo/pull/1', headSha: sha, ci: 'passed', merged: false };
    assert.throws(() => validateAcceptance(f.task, sha, [{ name: '任务交付', passed: true }]), /deployed/);
    f.task.delivery.deployedSha = sha; f.task.delivery.environment = 'local-pr-preview';
    assert.throws(() => validateAcceptance(f.task, 'b'.repeat(40), [{ name: '任务交付', passed: true }]), /deployed/);
    assert.throws(() => validateAcceptance(f.task, sha, [{ name: '任务交付', passed: false }]), /Every/);
    assert.throws(() => validateAcceptance(f.task, sha, []), /Every/);
    assert.throws(() => validateAcceptance(f.task, sha, [{ name: '无关项', passed: true }]), /required business/);
    assert.doesNotThrow(() => validateAcceptance(f.task, sha, [{ name: '任务交付', passed: true }]));
  } finally { f.close(); }
});
test('publisher rejects traversal, near-prefix paths and foreign repository PR links', () => {
  assert.equal(allowedFile('collab-pilot/index.html', ['collab-pilot/']), true);
  for (const file of ['../secret', '/etc/passwd', 'collab-pilot/../README.md', 'collab-pilot-evil/file', '.env']) assert.equal(allowedFile(file, ['collab-pilot/']), false);
  assert.equal(parsePr('https://github.com/owner/repo/pull/12', 'owner/repo'), 12);
  for (const url of ['https://github.com/owner/other/pull/12', 'https://github.com.evil/owner/repo/pull/12', 'https://github.com/owner/repo/pull/12/commits']) assert.throws(() => parsePr(url, 'owner/repo'));
});
test('generic command adapter uses argv substitution without a shell', async () => {
  const adapter = await adapterFor('command');
  const argv = adapter.command({ prompt: 'hello $(touch /tmp/not-allowed)', session: 's', resume: null, cwd: '/tmp', access: 'edit', folder: '/tmp', contextFile: '/tmp/context', command: ['my-agent', '-p', '{prompt}'] });
  assert.deepEqual(argv, ['my-agent', '-p', 'hello $(touch /tmp/not-allowed)']);
  assert.equal(adapter.read('partial', null, '').text, undefined);
  assert.ok(adapter.read('', 1, 'actual failure').error);
});
