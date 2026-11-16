import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { nextRun, parseCron } from '../upstream/autoloop/kernel/cron.ts';
import { feishuTriggerId } from '../src/upstream.ts';
import { confirmedDiscussionDestination, digestProposals, Discussions, discussionText, discussionZone, type DigestScope, type Observation } from '../src/workbench/discussion.ts';
import { readDiscussionHistory, readDiscussionThread, refreshDiscussionMessages } from '../src/workbench/discussion-intake.ts';
import { FeishuSources } from '../src/feishu-sources.ts';
import type { SuperAgentStore } from '../src/superagent-ports.ts';

test('群整理按上海时间在半天结束运行，回执须覆盖本批且只能引用本项目', () => {
  const next = nextRun(parseCron('0 0,12 * * *')!, Date.parse('2026-11-14T11:59:58+08:00'), discussionZone);
  assert.equal(next, Date.parse('2026-11-14T12:00:00+08:00'));
  const scope: DigestScope = { project: 'one', slot: next!, ids: ['first', 'second'], topics: ['reason'], tickets: ['known'],
    facts: [], matches: {}, unavailable: [], relatedGithub: {} };
  const event = (message: string, action: string, extra: object = {}) => ({ id: message, type: 'discussion.destination',
    subject: '', summary: '', detail: JSON.stringify({ message, action, ...extra }), link: '', hops: 0 });
  const review = event('first', 'link', { ticket: 'known', title: '换行问题', reason: '引用了现有任务' });
  const ignore = event('second', 'dismiss');
  assert.deepEqual(digestProposals(scope, [review, ignore])?.map(item => item.action), ['link', 'dismiss']);
  assert.equal(digestProposals(scope, [review]), undefined);
  assert.equal(digestProposals(scope, [review, review]), undefined);
  assert.equal(digestProposals(scope, [event('first', 'link', { ticket: 'other', title: '不明项目', reason: '不明来源' }), ignore]), undefined);
  assert.equal(digestProposals(scope, [event('first', 'topic', { topic: 'reason', title: '密码：测试', reason: '私密内容' }), ignore]), undefined);
  assert.equal(digestProposals({ ...scope, matches: { second: null } }, [review, ignore])?.[1]?.action, 'review');
  assert.equal(digestProposals({ ...scope, unavailable: ['second'] }, [review, ignore])?.[1]?.action, 'review');
  const suggestion = { message: 'first', action: 'create' as const, title: '换行问题', reason: '模型推测要开新单' };
  const original = { id: 'known', topic: 'reason' };
  assert.deepEqual(confirmedDiscussionDestination(suggestion, original), { action: 'link', ticket: 'known', topic: 'reason' });
  assert.equal(confirmedDiscussionDestination({ ...suggestion, action: 'review' }, original).action, 'review');
});

test('两人的相同反馈保留各自来源和修改记录，撤回一条只清掉对应正文及证据', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const discussions = new Discussions({ db } as SuperAgentStore);
    const first: Observation = { id: 'a', message: 'om_a', project: 'one', chat: 'oc_room', at: 1000, text: '窄屏推荐理由重复换行',
      actor: { provider: 'feishu', namespace: 'app', id: 'ou_first', label: 'first' }, member: 'first',
      origin: { key: 'feishu:a', label: '飞书原消息', url: 'https://example.com/a' } };
    const second: Observation = { ...first, id: 'b', message: 'om_b', at: 1100, member: 'second',
      actor: { ...first.actor, id: 'ou_second' }, origin: { key: 'feishu:b', label: '飞书原消息', url: 'https://example.com/b' } };
    for (const message of [first, second]) discussions.remember(message);
    assert.deepEqual(discussions.batch('one', 1250).map(row => row.id), [first.id]);
    discussions.saveItem({ id: 'summary', project: 'one', slot: 1250, title: '重复换行', reason: '两家门店反馈',
      destination: { action: 'link', ticket: 'known' }, status: 'applied', ticket: 'known',
      messageRefs: [first.id, second.id], evidence: [discussions.sourceEvidence(first), discussions.sourceEvidence(second)] });
    for (const message of [first, second]) discussions.settle(message.id, 'summary', false);
    const edit = { ...first, text: '更正：发生在 360px', updatedAt: 1500 };
    for (const message of [edit, first, { ...edit, updatedAt: 1600 }]) discussions.remember(message);
    const archived = discussions.item('summary')!;
    const [a, b] = discussions.sources(archived);
    assert.equal(a?.member, 'first');
    assert.equal(b?.member, 'second');
    assert.notEqual(a?.sender, b?.sender);
    assert.equal(a?.digestRevision, a?.revisions[0]?.revision);
    assert.deepEqual(discussions.revisions(first.id).map(version => version.text), [first.text, edit.text]);
    assert.deepEqual(discussions.batch('one', 2000), []);
    assert.equal(discussions.withdraw('one', 'oc_room', first.id, 2000), 'known');
    const remaining = discussions.item('summary')!;
    assert.deepEqual(remaining.messageRefs, [second.id]);
    assert.deepEqual(remaining.evidence.map(row => row.url), [second.origin.url]);
    assert.deepEqual(discussions.revisions(first.id).map(version => version.text), [null, null]);
    discussions.remember(edit);
    assert.deepEqual(discussions.item('summary')?.messageRefs, [second.id]);
    assert.equal(discussions.source(first.id), undefined);
  } finally { db.close(); }
});

test('群整理过滤闲聊和凭据，重放及完全相同的讨论只保留一条可处理反馈', () => {
  assert.equal(discussionText('大家晚饭吃什么？'), '');
  assert.equal(discussionText('收到！'), '');
  assert.equal(discussionText('access_token=redacted'), '');
  assert.ok(discussionText('顾客问晚饭吃什么时，推荐文案也会出错。'));
  const db = new DatabaseSync(':memory:');
  try {
    const discussions = new Discussions({ db } as SuperAgentStore);
    const message: Observation = { id: 'message1', message: 'message1', project: 'one', chat: 'oc_room', at: 1000, text: '有换行问题',
      actor: { provider: 'feishu', namespace: 'app', id: 'ou_one', label: 'one' }, origin: { key: 'feishu:one', label: '原消息' } };
    discussions.track('one', 'oc_room', 500);
    discussions.advance('one', 'oc_room', 900);
    discussions.advance('one', 'oc_room', 850);
    assert.equal(discussions.chat('one', 'oc_room')?.cursor, 900);
    discussions.remember({ ...message, text: '', id: 'noise' });
    discussions.remember(message);
    discussions.remember(message);
    discussions.remember({ ...message, id: 'msg2', at: 1500 });
    discussions.remember({ ...message, id: 'msg3', at: 1800, root: 'another' });
    assert.deepEqual(discussions.batch('one', 2100).map(x => x.id), ['message1', 'msg3']);
    assert.deepEqual(discussions.messageGroupFor('message1', 1400).map(x => x.id), ['message1']);
    assert.deepEqual(discussions.messageGroupFor('message1', 2100).map(x => x.id), ['message1', 'msg2']);
    assert.deepEqual(discussions.batch('one', 1000), []);
    assert.deepEqual(discussions.batch('another', 2100), []);
    const metadata = db.prepare('SELECT body FROM workbench_discussion_message WHERE id=?');
    assert.equal(metadata.get('noise')?.body, null);
    discussions.withdraw('one', 'oc_room', 'msg3', 1800);
    assert.deepEqual(discussions.batch('one', 2100).map(x => x.id), ['message1']);
  } finally { db.close(); }
});

test('补读校验授权身份与时间窗，沿用 Super-agent 原消息编号及回复根', async () => {
  const start = Date.parse('2026-11-14T00:00:00Z');
  const settings = { profile: 'reader', appId: 'cli_reader', userOpenId: 'ou_reader', member: 'product' };
  const feishu = { profile: 'bot', appId: 'cli_bot', botId: 'ou_bot' };
  const message = (id: string, ts: number, chat = 'oc_room') => ({ message_id: id, chat_id: chat, create_time: String(ts), update_time: String(ts + 20),
    msg_type: 'text', root_id: 'om_root', message_position: '13', sender: { id: 'ou_reader', sender_type: 'user', id_type: 'open_id' },
    body: { content: JSON.stringify({ text: '推荐理由补充反馈' }) } });
  let historyReads = 0;
  const reader = new FeishuSources(async args => {
    if (args[0] === 'whoami') return { identity: 'user', available: true, appId: settings.appId, onBehalfOf: { openId: settings.userOpenId } };
    historyReads++;
    const params = JSON.parse(args[args.indexOf('--params') + 1]!);
    if (args[2]?.endsWith('/mget')) {
      assert.deepEqual(params.message_ids, ['om_message', 'om_withdrawn', 'om_missing']);
      return { ok: true, identity: 'user', data: { items: [message('om_message', start - 100),
        { ...message('om_withdrawn', start - 100), deleted: true }, message('om_not_requested', start)] } };
    }
    assert.equal(typeof params.start_time, 'string');
    assert.equal(params.container_id, 'oc_room');
    const deleted = { ...message('om_withdrawn', start + 11), deleted: true };
    return { ok: true, identity: 'user', data: { items: params.page_token ? [deleted]
      : [message('om_message', start + 10), message('om_early', start - 1), message('om_outside', start + 12, 'oc_other')],
      has_more: !params.page_token, page_token: params.page_token ? '' : 'second' } };
  });
  const batch = await readDiscussionHistory(reader, settings, feishu, 'oc_room', start, start + 1000);
  assert.equal(historyReads, 2);
  assert.deepEqual(batch.withdrawn, [feishuTriggerId('om_withdrawn')]);
  assert.equal(batch.inputs.length, 1);
  assert.equal(batch.inputs[0]?.origin.key, 'feishu:cli_bot:oc_room:om_root');
  assert.equal(batch.inputs[0]?.sender.namespace, settings.appId);
  assert.ok(batch.inputs[0]?.origin.url?.endsWith('position=13'));
  assert.equal(batch.inputs[0]?.trigger.id, feishuTriggerId('om_message'));
  assert.equal(batch.inputs[0]?.updatedAt, start + 30);
  const refreshed = await refreshDiscussionMessages(reader, settings, feishu, 'oc_room', ['om_message', 'om_withdrawn', 'om_missing']);
  assert.deepEqual(refreshed.inputs.map(row => row.trigger.id), [feishuTriggerId('om_message')]);
  assert.deepEqual(refreshed.withdrawn, [feishuTriggerId('om_withdrawn')]);
  await assert.rejects(readDiscussionHistory(reader, { ...settings, userOpenId: 'ou_changed' }, feishu, 'oc_room', start, start + 1000), /身份已变化/);
});

test('话题补读接收真实 API 的负数群位置，保留根消息并忽略其他话题的回复', async () => {
  const start = 1794793440000;
  const history = { profile: 'reader', appId: 'cli_reader', userOpenId: 'ou_reader', member: 'product' };
  const feishu = { profile: 'bot', appId: 'cli_bot', botId: 'ou_bot' };
  const thread = { id: 'omt_one', root: 'om_root', at: start };
  const sample = { message_id: 'om_reply', chat_id: 'oc_room', root_id: thread.root, thread_id: thread.id,
    msg_type: 'text', create_time: String(start + 1), message_position: '-3',
    sender: { id: history.userOpenId, id_type: 'open_id', sender_type: 'user' },
    body: { content: JSON.stringify({ text: '/答 先场景后事实' }) } };
  const reader = new FeishuSources(async args => {
    if (args[0] === 'whoami') return { identity: 'user', available: true, appId: history.appId, onBehalfOf: { openId: history.userOpenId } };
    const params = JSON.parse(args[args.indexOf('--params') + 1]!);
    assert.equal(params.container_id_type, 'thread');
    assert.equal(params.container_id, thread.id);
    assert.equal(params.start_time, undefined);
    return { ok: true, identity: 'user', data: { items: [
      sample, { ...sample, message_id: 'om_outside', root_id: 'om_other_root' },
      { ...sample, message_id: 'om_other_chat', chat_id: 'oc_other' },
    ] } };
  });
  const result = await readDiscussionThread(reader, history, feishu, 'oc_room', thread, start, start + 200, AbortSignal.timeout(1000));
  assert.equal(result.inputs.length, 1);
  const reply = result.inputs[0]!;
  assert.equal(reply.answer, '先场景后事实');
  assert.equal(reply.trigger.id, feishuTriggerId('om_reply'));
  assert.equal(reply.origin.key, 'feishu:cli_bot:oc_room:om_root');
});
