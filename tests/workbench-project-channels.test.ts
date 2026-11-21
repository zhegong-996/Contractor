import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Trigger } from '../upstream/superagent/src/core/index.ts';
import { feishuTopicInput, feishuTopicUrl, type FeishuTopicAddress, type FeishuTopicTransport } from '../src/workbench/feishu-topics.ts';
import { feishuIngressText } from '../src/workbench/feishu-ingress-envelope.ts';

test('飞书话题链接核对群和话题 ID，重复参数冲突时拒绝', () => {
  const url = feishuTopicUrl({ chat: 'oc_store', root: 'om_product', thread: 'omt_product' });
  assert.equal(feishuTopicInput('oc_store', url), 'omt_product');
  assert.equal(feishuTopicInput('oc_other', url), undefined);
  assert.equal(feishuTopicInput('oc_store', url + '&openthreadid=omt_other'), undefined);
  assert.equal(feishuTopicInput('oc_store', url.replace('feishu.cn', 'feishu.cn.example.com')), undefined);
  assert.equal(feishuTopicInput('oc_store', 'om_product'), 'om_product');
  assert.equal(feishuIngressText(JSON.stringify({ zh_cn: { content: [[{ tag: 'text', text: '门店原始反馈' }]] } }), 'post'), '门店原始反馈');
});

test('新项目首个主题、共群双向归属、重启去重、交付配置与按版验收', { timeout: 35000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-project-channels-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'));
  const checkout = path.join(state, 'delivery-checkout');
  await mkdir(checkout);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', '门店交付基线');
  git('remote', 'add', 'origin', 'https://github.com/example/store-test.git');
  const head = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', head);
  const [{ ConsoleAuth }, { settingsSchema }, { openCollaboration }, { feishuTrigger, feishuTriggerId }, { discussionInput }, { messageRef }] = await Promise.all([
    import('../src/console-auth.ts'), import('../src/workbench/config.ts'), import('../src/workbench/collaboration.ts'),
    import('../src/upstream.ts'), import('../src/workbench/discussion-intake.ts'), import('../src/workbench/channel-links.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'project-channels-fixture-password');
  for (const person of ['engineer', 'reader', 'outside']) await auth.createAccount(person, 'project-channels-fixture-password', 'operator', 'product');
  const worker = path.join(state, 'fixture-worker.mjs');
  await writeFile(worker, 'console.log("小屏规则和交付证据已核对。")\n');
  const settings = {
    executionRuntime: 'contractor', workbenchPublicUrl: 'https://workbench.example.invalid',
    feishu: { profile: 'fixture', botId: 'ou_bot', appId: 'app', allowedGroups: ['oc_store', 'oc_other'] },
    crossChannel: {}, attribution: { checkouts: { 'example/store-test': checkout } },
    octop: { python: '/usr/bin/python3', profiles: [], channels: [{ id: 'ding', kind: 'dingtalk', credential: 'ding',
      allowAccountBinding: true, allowedConversations: [{ chat: 'ding-store', label: '门店钉钉联调' }] },
    { id: 'wx-team', kind: 'wecom', credential: 'wx-team', allowAccountBinding: true,
      allowedConversations: [{ chat: 'wx-group', label: '门店企业微信联调' }] }] },
    projects: [{ id: 'starter', title: '可信交付项目', members: ['product', 'engineer'], maintainers: ['product'],
      resources: [{ source: 'github', externalId: 'example/store-test', state: 'bound', contributors: ['engineer'],
        execution: { base: 'main', paths: ['collab-pilot/'], requiredChecks: [{ name: 'mobile-layout', app: 'github-actions' }] } }] }],
    functions: [{ id: 'review', title: '验收核对' }],
    agents: [{ id: 'fixture-agent', title: '门店小屏 Agent', kind: 'personal', owner: 'engineer', projects: ['starter'], function: 'review',
      skill: '给出核对结论', capability: '小屏验收核对', engine: 'command', model: 'fixture', command: [process.execPath, worker], active: true,
      execution: { kind: 'test', provider: 'fixture' } }],
  };
  const native = new Map<string, FeishuTopicAddress>();
  const published: { chat: string; label: string; url: string }[] = [];
  const linked: { root: string; url: string }[] = [];
  const outbound: { message?: string; text: string }[] = [];
  const sentIM: { connector: string; chat: string; text: string; proactive: boolean }[] = [];
  const transport: FeishuTopicTransport = {
    async resolve(chat, value) {
      if (value !== 'om_existing' && value !== 'omt_existing') throw new Error('找不到话题');
      return { chat: 'oc_store', root: 'om_existing', thread: 'omt_existing' };
    },
    async publish(chat, id, label, url) {
      const old = native.get(id);
      if (old) return old;
      native.set(id, { chat, root: 'om_generated', thread: 'omt_generated' });
      published.push({ chat, label, url });
      throw new Error('模拟飞书已创建、回执丢失');
    },
    async reply(address, _key, url) { linked.push({ root: address.root, url }); return { chat: address.chat, message: 'om_worklink' }; },
  };
  async function launch() {
    return openCollaboration(settingsSchema.parse(settings), auth, async value => {
      outbound.push({ message: value.channel.address.messageId, text: value.text });
      return 'sent';
    }, undefined, { ready: () => true, async send(address, text, _card, _receipt, proactive) {
      sentIM.push({ connector: address.connector, chat: address.chat, text, proactive: !!proactive });
      return address.kind === 'dingtalk' ? 'markdown' : undefined;
    } }, undefined, transport);
  }
  let work = await launch();
  t.after(async () => { await work.close(); await rm(state, { recursive: true, force: true }); });
  const first = { nonce: randomUUID(), title: '门店推荐理由', firstTopic: '小屏换行' };
  const { id: parent, topic: topic } = work.createProject('product', first);
  assert.ok(topic);
  assert.deepEqual(work.createProject('product', first), { id: parent, topic });
  const { id: child, topic: childTopic } = work.createProject('product', { nonce: randomUUID(), title: '门店试点', parent, firstTopic: '验收样例' });
  assert.ok(childTopic);
  work.createTopic('product', parent, { id: 'alternate', title: '子主题', parent: topic });
  work.addProjectMember('product', parent, 'engineer');
  work.addProjectMember('product', parent, 'reader', 'reader');
  work.addProjectAgent('engineer', parent, 'fixture-agent');
  work.bindFeishuGroup('product', parent, { chat: 'oc_store', label: '联调群', shared: true });
  work.bindFeishuGroup('product', child, { chat: 'oc_store', label: '联调群', shared: true });
  assert.equal(work.feishuProject('oc_store', 'om_unknown'), undefined);
  await assert.rejects(work.setFeishuTopic('engineer', parent, { topic, chat: 'oc_store', source: 'om_existing' }), { status: 403 });
  await assert.rejects(work.setFeishuTopic('product', parent, { topic, chat: 'oc_other', source: 'om_existing' }), { status: 409 });
  const a = await work.setFeishuTopic('product', parent, { topic, chat: 'oc_store', source: 'omt_existing' });
  assert.equal(a.root, 'om_existing');
  await assert.rejects(work.setFeishuTopic('product', child, { topic: childTopic, chat: 'oc_store', source: 'om_existing' }), { status: 409 });
  await assert.rejects(work.setFeishuTopic('product', child, { topic: childTopic, chat: 'oc_store', label: '门店试点' }), { status: 503 });
  await work.close();
  work = await launch();
  const b = await work.setFeishuTopic('product', child, { topic: childTopic, chat: 'oc_store', label: '门店试点' });
  assert.equal(b.root, 'om_generated');
  assert.equal(published.length, 1);
  assert.ok(published[0]?.url.includes('/' + child + '/project/' + childTopic));
  assert.equal(work.feishuProject('oc_store', 'omt_existing')?.id, parent);
  assert.equal(work.feishuProject('oc_store', 'om_generated')?.id, child);
  assert.throws(() => work.projectFeishuTopics('reader', child), { status: 404 });
  assert.throws(() => work.setTopicContacts('reader', parent, topic, ['fixture-agent']), { status: 403 });
  work.setTopicContacts('product', parent, topic, ['fixture-agent']);
  assert.deepEqual(work.topicContacts('product', parent, topic).chosen, ['fixture-agent']);
  work.setIMTopic('product', parent, { connector: 'ding', chat: 'ding-store', tag: 'mobile', topic });
  assert.throws(() => work.setIMTopic('product', child, { connector: 'ding', chat: 'ding-store', tag: 'mobile', topic: childTopic }), { status: 409 });
  work.setIMTopic('product', child, { connector: 'ding', chat: 'ding-store', tag: 'child', topic: childTopic });
  work.setIMTopic('product', parent, { connector: 'wx-team', chat: 'wx-group', topic });
  assert.deepEqual(work.projectChannels('product', parent).find(row => row.connector === 'ding')?.topics, [topic]);
  for (const person of ['product', 'engineer', 'reader', 'outside']) {
    const actor = { provider: 'feishu' as const, namespace: 'app', id: 'ou_' + person, label: person };
    assert.equal(work.proveAccount(work.accountProof(person, 'feishu').command.split(' ')[1]!, actor), true);
    work.confirmAccount(person, 'feishu', actor);
  }
  for (const namespace of ['ding', 'wx-team']) {
    const actor = { provider: 'octop' as const, namespace, id: 'im-engineer', label: '研发' };
    assert.equal(work.proveAccount(work.accountProof('engineer', 'octop').command.split(' ')[1]!, actor), true);
    work.confirmAccount('engineer', 'octop', actor);
  }
  const note = (message: string, text: string, actor = 'product', root = 'om_existing', parentId?: string, at = Date.now() + 10) => {
    const trigger = feishuTrigger({ message_id: message, root_id: root, parent_id: parentId, chat_id: 'oc_store', chat_type: 'group',
      sender_type: 'user', sender_id: 'ou_' + actor, content: text, create_time: String(at) }, 'ou_bot', 'app') as Trigger;
    return discussionInput(trigger, 'app');
  };
  const firstNote = note('om_record', '原始小屏反馈', 'engineer');
  const witnessed = note('om_seen_reply', '核对话题', 'engineer', 'om_seen_root');
  work.observeFeishuTopic({ ...witnessed.trigger, meta: { ...witnessed.trigger.meta, threadId: 'omt_seen' } });
  assert.equal((await work.setFeishuTopic('product', parent, { chat: 'oc_store', topic: 'alternate', source: 'omt_seen' })).root, 'om_seen_root');
  work.rememberDiscussion(firstNote);
  work.rememberDiscussion(firstNote);
  work.rememberDiscussion(note('om_outside', '项目外可读群但无权回写内部', 'outside'));
  work.rememberDiscussion(note('om_peer', '子项目独立内容', 'product', 'om_generated'));
  const edited = { ...firstNote, trigger: { ...firstNote.trigger, text: '补充 320px 与 360px 验收' }, updatedAt: Date.parse(firstNote.trigger.at) + 1000 };
  work.rememberDiscussion(edited);
  work.rememberDiscussion(firstNote);
  assert.deepEqual(work.conversation('engineer', parent, { topic }).map(row => row.text), [edited.trigger.text]);
  assert.deepEqual(work.conversation('product', child, { topic: childTopic }).map(row => row.text), ['子项目独立内容']);
  const dTalk = { connector: 'ding', kind: 'dingtalk' as const, chat: 'ding-store', sender: 'im-engineer', direct: false };
  const wChat = { connector: 'wx-team', kind: 'wecom' as const, chat: 'wx-group', sender: 'im-engineer', direct: false };
  const imEvent = (address: typeof dTalk | typeof wChat, message: string, text: string) =>
    work.receiveOctopIM({ address: { ...address, message }, at: new Date(Date.now() + 10).toISOString(), text });
  imEvent(dTalk, 'ignore', '共享群无标识');
  imEvent(dTalk, 'no-child', '[主题:child] 非子项目成员的反馈');
  imEvent(dTalk, 'ding-1', '[主题:mobile] 钉钉小屏反馈');
  imEvent(dTalk, 'ding-1', '[主题:mobile] 钉钉小屏反馈');
  imEvent(wChat, 'wx-1', '企微小屏反馈');
  assert.deepEqual(work.conversation('engineer', parent, { topic }).slice(-2).map(row => [row.channel, row.actor, row.text]),
    [['dingtalk', 'engineer', '钉钉小屏反馈'], ['wecom', 'engineer', '企微小屏反馈']]);
  const privateNote = { topic, text: '仅留工作台', nonce: randomUUID() };
  work.postConversation('engineer', parent, privateNote);
  assert.ok(!outbound.some(row => row.text.includes(privateNote.text)));
  const sharedNote = { topic, text: '公开回复原话题', nonce: randomUUID(), feishu: true };
  work.postConversation('engineer', parent, sharedNote);
  work.postConversation('engineer', parent, sharedNote);

  await assert.rejects(work.projectDeliverySetup('outside', parent), { status: 404 });
  assert.deepEqual((await work.projectDeliverySetup('product', parent)).options[0]?.contributors, ['engineer']);
  assert.throws(() => work.attachDeliveryProfile('product', parent, { source: 'starter', repository: 'example/store-test', contributors: ['reader'] }), { status: 409 });
  work.attachDeliveryProfile('product', parent, { source: 'starter', repository: 'example/store-test', contributors: ['engineer'] });
  const target = (await work.projectDeliverySetup('product', parent)).targets[0]!;
  assert.deepEqual(target.checkout, { state: 'ready', head });
  assert.equal(work.githubProject('example/store-test', { key: 'unclaimed', label: '新 Issue' })?.id, 'starter');
  assert.equal((await work.dispatchReadiness('product', parent, { agent: 'fixture-agent', topic, target: target.ref })).state, 'ready');
  work.setPointPolicy('product', { enabled: true, rates: [{ provider: 'fixture', model: 'fixture', multiplier: 1, reserveTokens: 100 }], tokensPerPoint: 1000 });
  work.setPointLimit('product', { kind: 'project', subject: parent, period: 'day', limit: 0 });
  assert.ok((await work.dispatchReadiness('product', parent, { agent: 'fixture-agent', topic })).issues.some(row => row.kind === 'quota'));
  const pool = work.pointLimit('product', { kind: 'project', subject: parent });
  assert.throws(() => work.setPointLimit('product', { ...pool, limit: 100, revision: pool.revision - 1 }), { status: 409 });
  work.setPointLimit('product', { ...pool, limit: null });

  const { ticket } = work.start('product', { project: parent, topic, agent: 'fixture-agent', nonce: randomUUID(), material: [],
    title: '门店推荐理由小屏复核', request: '核对正文不会横向溢出', priority: 'normal' }, undefined, true);
  assert.ok(ticket);
  const imOptions = work.projectIMTopics('engineer', parent).filter(row => row.canPublish);
  const [dingOption, wxOption] = [imOptions.find(row => row.kind === 'dingtalk')!, imOptions.find(row => row.kind === 'wecom')!];
  assert.throws(() => work.publishIMWork('reader', ticket, dingOption.id), { status: 403 });
  work.publishIMWork('product', ticket, dingOption.id);
  work.publishIMWork('product', ticket, dingOption.id);
  const wxReply = { nonce: randomUUID(), topic, text: '企微公开回复', im: wxOption.id };
  work.postConversation('engineer', parent, wxReply);
  work.postConversation('engineer', parent, wxReply);
  await work.publishFeishuWork('product', ticket, 'oc_store');
  await work.publishFeishuWork('product', ticket, 'oc_store');
  assert.equal(linked.length, 1);
  assert.equal(linked[0]?.root, 'om_existing');
  assert.ok(linked[0]?.url.endsWith('/work/' + ticket));
  assert.equal(work.channelTicket(messageRef(feishuTriggerId('om_worklink'))), ticket);
  const reply = note('om_followup', '这条补充属于原单', 'engineer', 'om_existing', 'om_worklink');
  assert.equal(work.receiveFeishuReply(reply, parent), true);
  assert.equal(work.receiveFeishuReply(reply, parent), true);
  assert.equal(work.detail('engineer', ticket).channelHistory.filter(row => row.text === '这条补充属于原单').length, 1);
  assert.equal(work.receiveFeishuReply(note('om_cross', '跨项目引用', 'product', 'om_generated', 'om_worklink'), child), false);
  const incoming = note('om_request', '生成独立测试任务', 'product');
  const request = { ...incoming, project: parent, agent: 'fixture-agent', request: incoming.trigger.text };
  assert.equal(work.receiveChannel(request).status, 'pending');
  assert.equal(work.receiveChannel(request).status, 'duplicate');
  const second = work.resolveChannel('product', incoming.trigger.id, { action: 'create', agent: 'fixture-agent' }).ticket;
  assert.ok(second && second !== ticket);
  assert.equal(work.detail('product', second).topicTitle, '小屏换行');
  const context = work.ticketTopicContext('product', second);
  assert.ok(context.recent.some(row => row.source === 'feishu' && row.text === edited.trigger.text && row.url));
  assert.ok(context.recent.some(row => row.source === 'im' && row.text === '企微小屏反馈'));

  const result = await wait(() => {
    const view = work.detail('product', ticket);
    return view.endReason === 'completed' ? view.result : undefined;
  });
  assert.equal(outbound.filter(row => row.message === 'om_existing' && row.text.includes(sharedNote.text)).length, 1);
  await wait(() => work.detail('product', ticket).imPublications.find(row => row.destination === dingOption.id && row.state === 'sent'));
  assert.deepEqual(sentIM.filter(row => row.proactive).map(row => [row.connector, row.chat]).sort(), [['ding', 'ding-store'], ['wx-team', 'wx-group']]);
  assert.ok(sentIM.find(row => row.connector === 'ding')?.text.startsWith('[主题:mobile] 有一项协作工单'));
  work.transferProjectMaintainer('product', parent, 'engineer');
  work.removeProjectMember('engineer', parent, 'product');
  assert.equal(work.detail('engineer', ticket).result?.revision, result.revision);
  assert.throws(() => work.detail('product', ticket), { status: 404 });
  assert.throws(() => work.transferAcceptance('reader', ticket, { member: 'reader', previous: 'product', revision: result.revision, reason: '测试' }), { status: 403 });
  assert.throws(() => work.transferAcceptance('engineer', ticket, { member: 'engineer', previous: 'product', revision: 'a'.repeat(64), reason: '测试旧版' }), { status: 409 });
  const transfer = { member: 'engineer', previous: 'product', revision: result.revision, reason: '产品离开项目，由现任维护人验收' };
  work.transferAcceptance('engineer', ticket, transfer);
  work.transferAcceptance('engineer', ticket, transfer);
  assert.equal(work.overview('engineer').needsYou.filter(row => row.ticket === ticket && row.kind === 'acceptance').length, 1);
  await work.accept('engineer', ticket, result.revision, '', '');
  await work.accept('engineer', ticket, result.revision, '', '');
  assert.equal(work.detail('engineer', ticket).work.accepted?.actor, 'engineer');
  assert.equal(work.detail('engineer', ticket).work.requester, 'product');

  async function wait<T>(fn: () => T | undefined) {
    const until = Date.now() + 11000;
    while (Date.now() < until) {
      const value = fn();
      if (value !== undefined) return value;
      await delay(100);
    }
    throw new Error('工单未产生预期成果');
  }
});
