import test from 'node:test';
import assert from 'node:assert/strict';
import { FeishuSources, safeProjectMessages, withFeishuReads, type FeishuReference } from '../src/feishu-sources.ts';
const reference: FeishuReference = { provider: 'feishu', kind: 'docx', profile: 'test-cli', appId: 'cli-test', userOpenId: 'ou-reader',
  token: 'doc-test', messageIds: [], title: '真实来源接口测试', url: 'https://company.feishu.cn/docx/doc-test' };
const identity = { identity: 'user', available: true, appId: reference.appId, onBehalfOf: { openId: reference.userOpenId } };
test('Feishu reader pins the delegated user and refuses a changed connection before fetching content', async () => {
  const calls: string[][] = [], source = new FeishuSources(async args => { calls.push(args); return { ...identity, onBehalfOf: { openId: 'another-user' } }; });
  await assert.rejects(source.read(reference), /身份已变化/); assert.equal(calls.length, 1);
});
test('request-local reuse avoids duplicate network reads but the next operation revalidates the real revision', async () => {
  let revision = 1, reads = 0;
  const source = new FeishuSources(async args => { if (args[0] === 'whoami') return identity; reads++; return { ok: true, identity: 'user', data: { document: { document_id: 'doc-test', revision_id: revision, content: '需求正文 v' + revision } } }; });
  const first = await withFeishuReads(async () => { const a = await source.read(reference), b = await source.read(reference); assert.equal(a.hash, b.hash); return a; });
  assert.equal(reads, 1); revision++;
  const next = await withFeishuReads(() => source.read(reference)); assert.equal(reads, 2); assert.notEqual(first.hash, next.hash);
});
test('withdrawn, foreign, bot and credential messages cannot enter the authorized discussion excerpt', () => {
  const ref = { ...reference, kind: 'messages' as const, chatId: 'chat-one', messageIds: ['message-1', 'message-2', 'message-3', 'message-4', 'message-5'] };
  const msg = { message_id: 'message-1', chat_id: 'chat-one', content: '项目验收需要保留当前版本', msg_type: 'text', sender: { name: '成员', sender_type: 'user' }, create_time: '2026-11-05 10:00' };
  const result = safeProjectMessages([msg, { ...msg, message_id: 'message-2', deleted: true }, { ...msg, message_id: 'message-3', chat_id: 'foreign-chat' },
    { ...msg, message_id: 'message-4', content: '访问密码: forbidden-test-value' }, { ...msg, message_id: 'message-5', sender: { sender_type: 'bot' } }, { ...msg, message_id: 'not-approved' }], ref);
  assert.deepEqual(result.map(m => m.id), ['message-1']);
});
test('losing original source access never falls back to a previously read body', async () => {
  let allowed = true;
  const source = new FeishuSources(async args => { if (args[0] === 'whoami') return identity; if (!allowed) throw new Error('permission denied');
    return { ok: true, identity: 'user', data: { document: { document_id: 'doc-test', revision_id: 1, content: '项目原文' } } }; });
  assert.equal((await withFeishuReads(() => source.read(reference))).body, '项目原文'); allowed = false;
  await assert.rejects(withFeishuReads(() => source.read(reference)), /permission denied/);
});
test('an omitted message blocks the old discussion scope instead of returning a partial source as still authorized', async () => {
  let removed = false;
  const ref = { ...reference, kind: 'messages' as const, chatId: 'chat-one', messageIds: ['message-1', 'message-2'] };
  const source = new FeishuSources(async args => args[0] === 'whoami' ? identity : { ok: true, identity: 'user', data: { messages: [
    { message_id: 'message-1', chat_id: 'chat-one', msg_type: 'text', content: '已补充需求', sender: { sender_type: 'user' } },
    { message_id: 'message-2', chat_id: 'chat-one', msg_type: 'text', content: '旧讨论', deleted: removed, sender: { sender_type: 'user' } }] } });
  const a = await source.read(ref); assert.equal(a.details.returnedCount, 2); removed = true;
  await assert.rejects(source.read(ref), /重新确认范围/);
});
