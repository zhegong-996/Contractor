import test from 'node:test';
import assert from 'node:assert/strict';
import { readMessage, resultFrom } from '../upstream/autoloop/worker/contract.ts';
import { adapterFor } from '../upstream/autoloop/worker/agents.ts';
import { allowedFile, parsePr } from '../src/github.ts';
import { feishuTrigger, feishuTriggerId, sendFeishu } from '../src/upstream.ts';

test('upstream Feishu intake deduplicates by message, not event delivery; ignores own bot', () => {
  const event = { message_id: 'om_one', chat_id: 'oc_test', chat_type: 'p2p', sender_id: 'ou_owner', sender_type: 'user',
    content: '/task test', create_time: '1793800000000', event_id: 'delivery-one' };
  const a = feishuTrigger(event, 'ou_bot', 'cli_test');
  const b = feishuTrigger({ ...event, event_id: 'delivery-two' }, 'ou_bot', 'cli_test');
  assert.equal(a?.id, b?.id); assert.equal(a?.id, feishuTriggerId('om_one')); assert.equal(a?.addressed, 'direct');
  assert.equal(feishuTrigger({ ...event, sender_id: 'ou_bot' }, 'ou_bot', 'cli_test'), undefined);
});
test('upstream Feishu replies retry long outbox IDs with a bounded stable key while preserving existing short keys', async () => {
  const keys: string[] = []; let interrupted = true;
  const host = { commands: { lark: async (args: string[]) => {
    const key = args[args.indexOf('--idempotency-key') + 1]!;
    if (key.length > 50) throw new Error('Feishu key exceeds 50 characters');
    keys.push(key);
    if (interrupted) { interrupted = false; throw new Error('response lost'); }
    return {};
  } } };
  const message = { id: 'assistant-prepared:' + 'a'.repeat(36), text: 'Work drafts ready', channel: { address: { messageId: 'om_test' } } };
  await assert.rejects(sendFeishu(host, message), /response lost/);
  assert.equal(await sendFeishu(host, message), 'sent'); assert.equal(keys[0], keys[1]);
  await sendFeishu(host, { ...message, id: message.id + '-different-job' }); assert.notEqual(keys[1], keys[2]);
  await sendFeishu(host, { ...message, id: 'existing-short-key' }); assert.equal(keys[3], 'existing-short-key');
});
test('upstream receipt parsing preserves human wait and rejects malformed receipts', () => {
  const said = '待你处理：需要确认范围\n```agent-autoloop\n{"ask":[{"title":"选择范围","text":"请选择","options":["本次任务","整个项目"],"about":"只继续剩余工作"}]}\n```';
  assert.equal(resultFrom(readMessage(said), {}).result.ask?.length, 1);
  assert.match(resultFrom(readMessage('完成\n```agent-autoloop\n{"grant":"all"}\n```'), {}).problem!, /字段/);
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
