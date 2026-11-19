import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Trigger } from '../upstream/superagent/src/core/index.ts';
import { readCardClick } from '../src/workbench/feishu-cards.ts';

test('主题咨询通过原生执行隔离来源，重放只派一次，且只回原飞书话题', { timeout: 30000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-topic-consultation-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'));
  const historyFixture = path.join(state, 'history.json');
  await writeFile(historyFixture, '[]');
  await writeFile(path.join(state, 'lark-cli'), [
    '#!' + process.execPath,
    "const fs=require('node:fs');",
    'const params=process.argv.includes("--params")&&JSON.parse(process.argv[process.argv.indexOf("--params")+1]);',
    "const items=['omt_recovery','omt_private'].includes(params?.container_id)?JSON.parse(fs.readFileSync(" + JSON.stringify(historyFixture) + ",'utf8')):[];",
    "console.log(JSON.stringify(process.argv.includes('whoami')?{identity:'user',available:true,appId:'reader',onBehalfOf:{openId:'ou_reader'}}:{ok:true,identity:'user',data:{items}}));",
  ].join('\n'), { mode: 0o700 });
  const priorPath = process.env.PATH;
  process.env.PATH = state + path.delimiter + priorPath;
  t.after(() => { process.env.PATH = priorPath; });
  const worker = path.join(state, 'worker.mjs');
  await writeFile(worker, [
    "import {readFileSync} from 'node:fs';",
    "const context=JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT,'utf8'));",
    "const scope=JSON.stringify(context);",
    "const marker=process.argv[2]; const other=marker==='COPY_ONLY'?'WRAP_ONLY':'COPY_ONLY';",
    "if(!scope.includes(marker)||scope.includes(other)) process.exit(1);",
    "const prompt=process.argv[3];",
    "if(!prompt.includes('项目主题内的只读咨询')||!prompt.includes('knowledge.source')||prompt.includes('CODE_TEMPLATE_ONLY')) process.exit(1);",
    "const citation=context.events.find(e=>e.type==='knowledge.source').detail.match(/\\[记忆:[^\\]]+\\]/)[0];",
    "const body='查询结论 '+marker+'\\n\\n'+('详细说明。'.repeat(110))+'\\n\\n- 最后一项验收条件 '+citation;",
    "if(scope.includes('仅返回摘要测试')) { console.log('查询结论 '+citation); process.exit(0); }",
    "if(scope.includes('错误引用测试')) { console.log('咨询已回复\\n```agent-autoloop\\n'+JSON.stringify({events:[{id:'consultation-reply',type:'contractor.consultation-reply',detail:'没有引用的正文'}]})+'\\n```'); process.exit(0); }",
    "console.log('咨询已回复\\n```agent-autoloop\\n'+JSON.stringify({events:[{id:'consultation-reply',type:'contractor.consultation-reply',detail:body}]})+'\\n```');",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { feishuTrigger }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'), import('../src/upstream.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'test-only-password');
  for (const actor of ['engineer', 'outsider']) await auth.createAccount(actor, 'test-only-password', 'operator', 'product');
  const config = settingsSchema.parse({
    workbenchPublicUrl: 'https://collab.example.com',
    projects: [{ id: 'store', title: '门店', parent: 'pilot', members: ['product', 'engineer'], maintainers: ['product'],
      topics: [{ id: 'recommendation', title: '推荐理由' }, { id: 'other', title: '其他', parent: 'recommendation' }],
      resources: [{ source: 'feishu', externalId: 'oc_test', label: '试验群', state: 'bound', topic: 'recommendation' },
        { source: 'github', externalId: 'team/test', label: '试验仓', state: 'bound', contributors: ['engineer'],
          execution: { base: 'main', paths: ['collab-pilot/'] } }] },
      { id: 'pilot', title: '内部项目线', parent: 'org', members: ['product'], maintainers: ['product'] },
      { id: 'org', title: '公司项目', members: ['product'], maintainers: ['product'] },
      { id: 'private-pilot', title: '子项目', parent: 'store', members: ['product'], maintainers: ['product'],
        topics: [{ id: 'private-review', title: '内部核对' }] }],
    attribution: { checkouts: { 'team/test': state }, entireCommand: process.execPath },
    functions: [{ id: 'review', title: '查资料' }],
    agents: [['copy-agent', 'product', 'COPY_ONLY'], ['wrap-agent', 'engineer', 'WRAP_ONLY']].map(([id, owner, marker]) => ({
      id, title: id, owner, kind: 'specialist', function: 'review', projects: id === 'copy-agent' ? ['store', 'private-pilot'] : ['store'], capability: '核对资料',
      active: true, engine: 'command', execution: { kind: 'test', provider: 'fixture' }, skill: 'CODE_TEMPLATE_ONLY 修改测试代码',
      command: [process.execPath, worker, marker, '{prompt}'],
    })),
    feishu: { profile: 'fixture', appId: 'app', botId: 'ou_bot', allowedGroups: ['oc_test'] },
  });
  const replies: { root?: string; user?: string; text: string; ref: string }[] = [];
  const updates: string[] = [];
  const work = await openCollaboration(config, auth, async () => 'sent', {
    async send(target, _key, text) {
      const ref = 'om_card_' + replies.length;
      replies.push({ root: 'message' in target ? target.message : undefined, user: 'user' in target ? target.user : undefined, text, ref });
      return { ref, chat: 'oc_test' };
    },
    async update(_ref, text) { updates.push(text); },
  });
  t.after(async () => { await work.close(); await rm(state, { recursive: true, force: true }); });
  const material: string[] = [];
  for (const [title, body] of [['现行文案口径', 'COPY_ONLY'], ['已验收的小屏规则', 'WRAP_ONLY']]) {
    const id = work.addKnowledge('product', 'store', { title, body, conditions: '门店试点', kind: 'decision', visibility: 'project' });
    const entry = work.browse('product', 'store', '').find(row => row.id === id);
    assert.ok(entry && 'revision' in entry);
    if (entry.state === 'candidate') await work.publish('product', id, entry.revision);
    material.push(id);
  }
  config.projects[0]!.consultations = [{ topic: 'recommendation', feishu: true,
    agents: [{ agent: 'copy-agent', material: [material[0]!] }, { agent: 'wrap-agent', material: [material[1]!] }] }];
  const group = config.projects[0]!.resources.find(ref => ref.source === 'feishu')!;
  group.shareConsultationResults = true;
  assert.ok(settingsSchema.safeParse(config).success);
  const unauthorizedShare = structuredClone(config);
  unauthorizedShare.feishu!.allowedGroups = [];
  assert.equal(settingsSchema.safeParse(unauthorizedShare).success, false);
  const input = { topic: 'recommendation', text: '帮我核对文案和小屏，需要改代码先说明', nonce: randomUUID() };
  const trigger = feishuTrigger({ message_id: 'om_consult', chat_id: 'oc_test', chat_type: 'group', sender_id: 'ou_product',
    sender_type: 'user', content: '/咨询 ' + input.text, create_time: String(Date.now()), mentions: [] }, 'ou_bot', 'app') as Trigger;
  const identity = { provider: 'feishu' as const, namespace: 'app', id: 'ou_product', label: 'product' };
  await assert.rejects(work.consultTopic('product', 'store', input, trigger), { status: 403 });
  assert.ok(work.proveAccount(work.accountProof('product', 'feishu').command.split(' ')[1]!, identity));
  work.confirmAccount('product', 'feishu', identity);
  trigger.at = new Date().toISOString();
  const batch = await work.consultTopic('product', 'store', input, trigger);
  assert.equal(new Set(batch.tickets).size, 2);
  assert.deepEqual(await work.consultTopic('product', 'store', input, trigger), batch);
  assert.ok(work.channelEventSeen(trigger.id));
  await assert.rejects(work.consultTopic('outsider', 'store', input), { status: 404 });
  await assert.rejects(work.consultTopic('product', 'store', { ...input, topic: 'other' }), { status: 409 });
  const web = { ...input, nonce: randomUUID(), agents: ['copy-agent'] };
  const webBatch = await work.consultTopic('product', 'store', web);
  assert.deepEqual(await work.consultTopic('product', 'store', web), webBatch);
  await assert.rejects(work.consultTopic('product', 'store', { ...web, text: '变更后的内容' }), { status: 409 });
  for (let step = 0; step < 65 && (replies.length < 2 || !work.detail('product', webBatch.tickets[0]!).result); step++) await delay(250);
  const conversation = work.conversation('engineer', 'store', { topic: input.topic });
  assert.equal(conversation.length, 2);
  assert.equal(conversation.find(row => row.id === batch.id)?.channel, 'feishu');
  assert.equal(conversation.find(row => row.id === webBatch.id)?.channel, 'web');
  const answers = conversation.find(row => row.id === batch.id)?.consultations;
  assert.deepEqual(answers?.map(item => [item.speaker.id, item.status, item.evidence?.map(ref => ref.id)]),
    [['copy-agent', 'answered', [material[0]]], ['wrap-agent', 'answered', [material[1]]]]);
  assert.ok(answers?.every(reply => reply.text && reply.text.length > 500
    && reply.text.endsWith('\n\n- 最后一项验收条件') && !reply.text.includes('[记忆:')));
  assert.equal(replies.length, 2);
  assert.ok(replies.every(reply => reply.root === 'om_consult'));
  assert.ok(replies.every(reply => JSON.parse(reply.text).schema === '2.0'));
  for (const id of batch.tickets) {
    const receipt = work.detail('product', id).channelReturn;
    assert.deepEqual([receipt?.channel, receipt?.state, receipt?.form], ['feishu', 'sent', 'card']);
    assert.ok(receipt?.acknowledgedAt);
  }
  assert.ok(replies.some(reply => /copy-agent[\s\S]*COPY_ONLY[\s\S]*现行文案口径/.test(reply.text) && !reply.text.includes('WRAP_ONLY')));
  assert.ok(replies.some(reply => /wrap-agent[\s\S]*WRAP_ONLY[\s\S]*已验收的小屏规则/.test(reply.text) && !reply.text.includes('COPY_ONLY')));
  for (const reply of answers ?? []) {
    const focused = work.conversation('engineer', 'store', { topic: input.topic, reply: reply.ticket });
    assert.deepEqual(focused.map(item => item.consultations), [[reply]]);
    assert.throws(() => work.conversation('engineer', 'store', { topic: 'other', reply: reply.ticket }), { status: 404 });
    assert.throws(() => work.conversation('outsider', 'store', { topic: input.topic, reply: reply.ticket }), { status: 404 });
  }
  delete group.shareConsultationResults;
  const pickTrigger = feishuTrigger({ message_id: 'om_picker', root_id: 'om_root', chat_id: 'oc_test', chat_type: 'group',
    sender_id: 'ou_product', sender_type: 'user', content: '/咨询 核对小屏', create_time: String(Date.now()) }, 'ou_bot', 'app') as Trigger;
  work.showFeishuConsultation('product', 'store', input.topic, '核对小屏', pickTrigger);
  work.showFeishuConsultation('product', 'store', input.topic, '核对小屏', pickTrigger);
  for (let step = 0; step < 30 && replies.length < 3; step++) await delay(100);
  const pick = replies[2]!;
  assert.equal(pick.root, undefined);
  assert.equal(pick.user, 'ou_product');
  assert.equal(work.conversation('product', 'store', { topic: input.topic }).length, 2);
  const option = JSON.parse(pick.text).body.elements.find((value: { tag: string; elements?: { text?: { content?: string } }[] }) =>
    value.tag === 'interactive_container' && value.elements?.[0]?.text?.content === 'wrap-agent');
  assert.ok(option);
  const click = readCardClick(JSON.stringify({ type: 'card.action.trigger', event_id: 'event-first', operator_id: 'ou_product',
    message_id: pick.ref, chat_id: 'oc_test', action_value: JSON.stringify(option.behaviors[0].value) }));
  await assert.rejects(work.clickFeishuCard({ ...click, operator: 'ou_someone_else' }), { status: 403 });
  await assert.rejects(work.clickFeishuCard({ ...click, ref: 'om_wrong_card' }), { status: 403 });
  assert.deepEqual(await Promise.all([work.clickFeishuCard(click), work.clickFeishuCard({ ...click, nonce: 'event-second' })]),
    [{ changed: true }, { changed: false }]);
  work.showFeishuConsultation('product', 'store', input.topic, '核对小屏', pickTrigger);
  for (let step = 0; step < 60 && replies.length < 4; step++) await delay(150);
  assert.equal(replies.length, 4);
  assert.equal(replies[3]!.root, 'om_picker');
  assert.ok(updates.some(text => text.includes('已交给 wrap-agent') && !text.includes('callback')));
  const newMessage = work.conversation('product', 'store', { topic: input.topic }).find(item => item.text === '核对小屏');
  assert.equal(newMessage?.consultations?.length, 1);
  const pickedReply = newMessage.consultations[0]!;
  assert.equal(pickedReply.speaker.id, 'wrap-agent');
  assert.equal(work.detail('product', pickedReply.ticket).runs.length, 1);
  const link = 'https://collab.example.com/#/store/project/recommendation?tab=chat&reply=' + pickedReply.ticket;
  const buttons = JSON.parse(replies[3]!.text).body.elements.filter((element: { tag: string }) => element.tag === 'button');
  assert.equal(JSON.parse(replies[3]!.text).header.title.content, '咨询已处理');
  assert.equal(JSON.parse(replies[3]!.text).body.elements.length, 1);
  assert.doesNotMatch(replies[3]!.text, /WRAP_ONLY|已验收的小屏规则|第 2 版|PR #|CI/);
  assert.deepEqual(buttons[0].behaviors, [{ type: 'open_url', default_url: link }]);
  for (const ticket of [...batch.tickets, ...webBatch.tickets]) {
    const item = work.detail('product', ticket);
    assert.equal(item.runs.length, 1);
    assert.equal(item.work.development, undefined);
    assert.equal(item.actions.accept, false);
    assert.ok(item.result);
    await assert.rejects(work.accept('product', ticket, item.result.revision, '', ''), { status: 409 });
  }
  assert.equal(work.needsYou('product').some(item => item.kind === 'acceptance'), false);
  for (const [text, summary] of [['仅返回摘要测试', '完整回复'], ['错误引用测试', '资料引用']] as const) {
    const rejected = await work.consultTopic('product', 'store', { ...web, text, nonce: randomUUID() });
    const ticket = rejected.tickets[0]!;
    for (let step = 0; step < 40 && work.detail('product', ticket).report?.state !== 'blocked'; step++) await delay(150);
    const detail = work.detail('product', ticket);
    assert.equal(detail.report?.state, 'blocked');
    assert.ok(detail.report.summary.includes(summary));
    assert.equal(detail.result, undefined);
  }
  const wantsChange = work.start('product', { project: 'store', topic: input.topic, title: '确需修改小屏', priority: 'normal',
    request: '经人决定后再调整小屏', nonce: randomUUID(), material: [], agent: 'wrap-agent',
    target: work.overview('product').projects[0]!.deliveryTargets[0]!.ref }, undefined, true);
  assert.ok(wantsChange.ticket);
  assert.ok(work.needsYou('engineer').some(item => item.ticket === wantsChange.ticket && item.kind === 'development'));
  assert.equal(work.detail('product', wantsChange.ticket).runs.length, 0);
  config.projects[0]!.consultationHistory = { profile: 'reader', appId: 'reader', userOpenId: 'ou_reader', member: 'product' };
  const observedAt = Date.now();
  const root = feishuTrigger({ message_id: 'om_recovery_root', thread_id: 'omt_recovery', chat_id: 'oc_test', chat_type: 'group',
    sender_id: 'ou_product', sender_type: 'user', content: '小屏原话题', create_time: String(observedAt - 120_000) }, 'ou_bot', 'app') as Trigger;
  await work.refreshFeishuHistory(); // Initialize the opt-in cursor before the simulated outage.
  work.trackFeishuThread(root);
  const sentAt = Date.now() + 100;
  const recoveredText = '断线补读时核对小屏';
  const missed = { message_id: 'om_recovery', chat_id: 'oc_test', thread_id: 'omt_recovery', root_id: 'om_recovery_root',
    msg_type: 'text', create_time: String(sentAt), message_position: '-1',
    sender: { id: 'ou_reader', id_type: 'open_id', sender_type: 'user' },
    body: { content: JSON.stringify({ text: '/咨询 @wrap-agent ' + recoveredText }) } };
  await writeFile(historyFixture, JSON.stringify([missed, missed,
    { ...missed, message_id: 'om_recovery_outside', sender: { ...missed.sender, id: 'ou_unbound' } },
    { ...missed, message_id: 'om_recovery_deleted', deleted: true },
    { ...missed, message_id: 'om_recovery_other_thread', root_id: 'om_other' },
  ]));
  const priorCount = work.conversation('product', 'store', { topic: input.topic }).length;
  const clock = t.mock.method(Date, 'now', () => sentAt + 20_000);
  try {
    await work.refreshFeishuHistory();
    await work.refreshFeishuHistory();
    const after = work.conversation('product', 'store', { topic: input.topic });
    assert.equal(after.length, priorCount + 1);
    assert.equal(after.find(row => row.text === recoveredText)?.consultations?.length, 1);
    for (let step = 0; step < 45 && !replies.some(row => row.root === missed.message_id); step++) await delay(150);
  } finally { clock.mock.restore(); }
  const delayedEvent = feishuTrigger({ ...root.meta, message_id: missed.message_id, root_id: missed.root_id, thread_id: missed.thread_id,
    chat_id: 'oc_test', chat_type: 'group', sender_id: 'ou_product', sender_type: 'user',
    content: '/咨询 @wrap-agent ' + recoveredText, create_time: String(sentAt) }, 'ou_bot', 'app') as Trigger;
  await work.receiveFeishuConsultation(config.projects[0]!, delayedEvent, { text: recoveredText, agents: ['wrap-agent'] });
  const after = work.conversation('product', 'store', { topic: input.topic });
  assert.equal(after.length, priorCount + 1);
  const recovered = after.find(row => row.text === recoveredText)?.consultations;
  assert.equal(recovered?.length, 1);
  const recoveredTicket = recovered![0]!.ticket;
  assert.equal(replies.filter(row => row.root === missed.message_id).length, 1);
  assert.doesNotMatch(replies.find(row => row.root === missed.message_id)!.text, /WRAP_ONLY|已验收的小屏规则/);
  assert.equal(work.detail('product', recoveredTicket).runs.length, 1);
  assert.equal(work.conversation('engineer', 'store', { topic: input.topic, reply: recoveredTicket })[0]?.consultations?.[0]?.status, 'answered');
  assert.throws(() => work.conversation('outsider', 'store', { topic: input.topic, reply: recoveredTicket }), { status: 404 });
  config.feishu!.decisionCards = true;
  const picker = { ...missed, message_id: 'om_recovery_picker',
    body: { content: JSON.stringify({ text: '/咨询 只选择小屏' }) } };
  await writeFile(historyFixture, JSON.stringify([picker, picker]));
  const pickerClock = t.mock.method(Date, 'now', () => sentAt + 20_010);
  try {
    await work.refreshFeishuHistory();
    await work.refreshFeishuHistory();
  } finally { pickerClock.mock.restore(); }
  for (let step = 0; step < 30 && !replies.some(row => row.text.includes('只选择小屏')); step++) await delay(100);
  const recoveredPickers = replies.filter(row => row.text.includes('只选择小屏'));
  assert.equal(recoveredPickers.length, 1);
  assert.equal(recoveredPickers[0]!.user, 'ou_product');
  assert.equal(recoveredPickers[0]!.root, undefined);
  assert.match(recoveredPickers[0]!.text, /选择咨询 Agent/);
  assert.equal(work.conversation('product', 'store', { topic: input.topic }).length, priorCount + 1);
  const inbox = recoveredPickers[0]!;
  assert.match(inbox.text, /Contractor · 待处理/);
  assert.match(inbox.text, /公司项目 \/ 内部项目线 \/ 门店 \/ 推荐理由/);
  group.feishuTopicRoots = { recommendation: 'om_store_topic', other: 'om_other_topic' };
  assert.equal(work.feishuTopic(config.projects[0]!, 'oc_test', 'om_other_topic'), 'other');
  const withTwoTopics = structuredClone(config);
  withTwoTopics.projects[0]!.consultations!.push({ topic: 'other', feishu: true, agents: [{ agent: 'wrap-agent', material: [material[1]!] }] });
  assert.ok(settingsSchema.safeParse(withTwoTopics).success);
  delete withTwoTopics.projects[0]!.resources[0]!.feishuTopicRoots!.other;
  assert.equal(settingsSchema.safeParse(withTwoTopics).success, false);
  const standard = feishuTrigger({ message_id: 'om_question_outside_root', chat_id: 'oc_test', chat_type: 'group',
    sender_id: 'ou_product', sender_type: 'user', content: '/咨询 另一条小屏待办', create_time: String(Date.now()) }, 'ou_bot', 'app') as Trigger;
  await work.receiveFeishuConsultation(config.projects[0]!, standard, { text: '另一条小屏待办' });
  await work.receiveFeishuConsultation(config.projects[0]!, standard, { text: '另一条小屏待办' });
  const hasBoth = (text: string) => text.includes('另一条小屏待办') && text.includes('只选择小屏');
  for (let step = 0; step < 30 && !updates.some(hasBoth); step++) await delay(100);
  const combined = updates.find(hasBoth)!;
  assert.ok(combined);
  assert.match(combined, /门店 \/ 推荐理由/);
  assert.match(combined, /另一条小屏待办/);
  assert.match(combined, /只选择小屏/);
  assert.equal(replies.filter(row => row.user === 'ou_product' && row.text.includes('Contractor · 待处理')).length, 1);
  const newAction = JSON.parse(combined).body.elements.find((el: { tag: string; elements?: { text?: { content: string } }[] }) =>
    el.tag === 'interactive_container' && el.elements?.[0]?.text?.content === 'wrap-agent');
  const viaInbox = readCardClick(JSON.stringify({ type: 'card.action.trigger', event_id: 'inbox-choice',
    operator_id: 'ou_product', message_id: inbox.ref, chat_id: 'oc_test', action_value: JSON.stringify(newAction.behaviors[0].value) }));
  await assert.rejects(work.clickFeishuCard({ ...viaInbox, operator: 'ou_other' }), { status: 403 });
  assert.deepEqual(await work.clickFeishuCard(viaInbox), { changed: true });
  assert.deepEqual(await work.clickFeishuCard(viaInbox), { changed: false });
  for (let step = 0; step < 45 && !replies.some(row => row.root === 'om_store_topic'); step++) await delay(150);
  assert.equal(replies.filter(row => row.root === 'om_store_topic').length, 1);
  assert.equal(replies.some(row => row.root === 'om_question_outside_root'), false);
  assert.doesNotMatch(replies.find(row => row.root === 'om_store_topic')!.text, /WRAP_ONLY|已验收的小屏规则/);
  const shared = feishuTrigger({ message_id: 'om_work_under_topic', root_id: 'om_store_topic', parent_id: 'om_store_topic',
    chat_id: 'oc_test', chat_type: 'group', sender_id: 'ou_product', sender_type: 'user',
    content: '在同一主题另提一件事', create_time: String(Date.now()) }, 'ou_bot', 'app') as Trigger;
  const { discussionInput } = await import('../src/workbench/discussion-intake.ts');
  const sharedInput = discussionInput(shared, 'app');
  assert.equal(work.receiveFeishuReply(sharedInput, 'store'), false);
  const detached = work.receiveChannel({ ...sharedInput, project: 'store', agent: 'auto', request: shared.text });
  assert.equal(detached.status, 'pending');
  assert.equal(work.channelTicket(sharedInput.origin), undefined);
  const engineer = { provider: 'feishu' as const, namespace: 'app', id: 'ou_engineer', label: 'engineer' };
  assert.ok(work.proveAccount(work.accountProof('engineer', 'feishu').command.split(' ')[1]!, engineer));
  work.confirmAccount('engineer', 'feishu', engineer);
  const child = work.start('product', { project: 'store', topic: 'other', parent: wantsChange.ticket, title: '子单小屏验证', priority: 'normal',
    request: '单独核对更窄视口', nonce: randomUUID(), material: [], agent: 'wrap-agent',
    target: work.overview('product').projects[0]!.deliveryTargets[0]!.ref }, undefined, true);
  assert.ok(child.ticket);
  for (let step = 0; step < 30 && !replies.some(row => row.user === engineer.id); step++) await delay(100);
  const childInbox = replies.find(row => row.user === engineer.id)!.text;
  assert.match(childInbox, /门店 \/ 推荐理由 \/ 其他/);
  assert.match(childInbox, /确需修改小屏 \/ 子单小屏验证/);
  assert.doesNotMatch(childInbox, /内部项目线|公司项目/);
  assert.ok(childInbox.includes('/#/store/work/' + child.ticket));
  group.feishuSubprojectRoots = { om_private_root: { project: 'private-pilot', topic: 'private-review',
    recovery: { thread: 'omt_private', reader: config.projects[0]!.consultationHistory! } } };
  assert.ok(settingsSchema.safeParse(config).success);
  const duplicateRoot = structuredClone(config);
  duplicateRoot.projects[0]!.resources[0]!.feishuSubprojectRoots!.om_store_topic = { project: 'private-pilot', topic: 'private-review' };
  assert.equal(settingsSchema.safeParse(duplicateRoot).success, false);
  assert.equal(work.feishuProject('oc_test', 'om_private_root')?.id, 'private-pilot');
  assert.equal(work.feishuProject('oc_test', 'om_store_topic')?.id, 'store');
  assert.equal(work.feishuTopic(config.projects[0]!, 'oc_test', 'om_private_root'), undefined);
  const privateTrigger = feishuTrigger({ message_id: 'om_parent_member', root_id: 'om_private_root', parent_id: 'om_private_root',
    chat_id: 'oc_test', chat_type: 'group', sender_id: engineer.id, sender_type: 'user',
    content: '只有上级项目权限的成员', create_time: String(Date.now()) }, 'ou_bot', 'app') as Trigger;
  const privateInput = discussionInput(privateTrigger, 'app');
  assert.equal(work.receiveChannel({ ...privateInput, project: 'private-pilot', agent: 'auto', request: privateTrigger.text }).status, 'unbound');
  assert.equal(work.receiveChannel({ ...privateInput, project: 'store', agent: 'auto', request: privateTrigger.text }).status, 'denied');
  assert.equal(work.channelEventSeen(privateTrigger.id), false);
  assert.throws(() => work.conversation('engineer', 'private-pilot', { topic: 'private-review' }), { status: 404 });
  const sourceTrigger = feishuTrigger({ ...privateTrigger.meta, message_id: 'om_private_open', root_id: 'om_private_root',
    parent_id: 'om_private_root', thread_id: 'omt_private', chat_id: 'oc_test', chat_type: 'group',
    sender_id: 'ou_product', sender_type: 'user', content: '子项目开单联调', create_time: String(Date.now()) }, 'ou_bot', 'app') as Trigger;
  const sourceInput = discussionInput(sourceTrigger, 'app');
  assert.equal(work.receiveChannel({ ...sourceInput, project: 'private-pilot', agent: 'copy-agent', request: sourceTrigger.text }).status, 'pending');
  const privateMaterial = work.addKnowledge('product', 'private-pilot', { title: '受限资料', body: '联调样例', conditions: '只用作测试',
    kind: 'reference', visibility: 'restricted' });
  const privateTicket = work.resolveChannel('product', sourceTrigger.id, { action: 'create', agent: 'copy-agent', material: [privateMaterial] }).ticket!;
  await writeFile(historyFixture, '[]');
  await work.refreshFeishuHistory();
  const privateSentAt = Date.now() + 100;
  const quote = { ...missed, message_id: 'om_private_quote', thread_id: 'omt_private', root_id: 'om_private_root', parent_id: 'om_private_open',
    create_time: String(privateSentAt), body: { content: JSON.stringify({ text: '补读的子单引用回复' }) } };
  await writeFile(historyFixture, JSON.stringify([quote, quote,
    { ...quote, message_id: 'om_private_foreign', sender: { ...quote.sender, id: 'ou_foreign' } },
    { ...quote, message_id: 'om_private_unquoted', parent_id: 'om_private_root' },
    { ...quote, message_id: 'om_private_command', body: { content: JSON.stringify({ text: '/协作 copy-agent 补读不能派工' }) } },
  ]));
  const scopedClock = t.mock.method(Date, 'now', () => privateSentAt + 20_000);
  try { await work.refreshFeishuHistory(); } finally { scopedClock.mock.restore(); }
  const { feishuTriggerId } = await import('../src/upstream.ts');
  assert.equal(work.channelTicket({ key: 'channel-message:' + feishuTriggerId('om_private_quote'), label: '原消息' }), privateTicket);
  for (const skipped of ['om_private_foreign', 'om_private_unquoted', 'om_private_command'])
    assert.ok(!work.channelEventSeen(feishuTriggerId(skipped)));
  assert.equal(work.detail('product', privateTicket).runs.length, 0);
  const original = work.browse('product', 'store', '').find(entry => entry.id === material[1]);
  assert.ok(original && 'revision' in original);
  work.invalidateKnowledge('product', original.id, original.revision, '规则失效');
  const withdrawn = work.conversation('engineer', 'store', { topic: input.topic })[0]?.consultations?.find(reply => reply.speaker.id === 'wrap-agent');
  assert.equal(withdrawn?.status, 'unavailable');
  assert.equal(withdrawn?.text, undefined);
});
