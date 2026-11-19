import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Trigger } from '../upstream/superagent/src/core/index.ts';
import { feishuInboxCard, type CardTransport } from '../src/workbench/feishu-cards.ts';

test('同一主题两项验收直接在按钮标记工单，回调仍绑定各自的版本', () => {
  const content = feishuInboxCard(['a1000001', 'a1000002'].map((ref, index) => ({
    scope: 'store:reasons', group: '门店 / 推荐理由', title: '待验收', link: 'https://suite.example/#/store/inbox',
    work: { label: '工单 ' + ref, url: 'https://suite.example/#/store/work/' + ref, ref },
    action: { id: 10 + index, decision: ref, title: '待验收', text: '第 1 版', options: ['验收当前版本'], revision: String(index) },
  })));
  const actions = JSON.parse(content).body.elements.filter((element: { tag: string }) => element.tag === 'interactive_container');
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.map((action: { elements: Array<{ text: { content: string } }> }) => action.elements[0]!.text.content),
    ['验收当前版本 · a1000001', '验收当前版本 · a1000002']);
  assert.deepEqual(actions.map((action: { behaviors: Array<{ value: unknown }> }) => action.behaviors[0]!.value),
    [{ card: 10, choice: 0 }, { card: 11, choice: 0 }]);
});

test('新项目的成员、主题和两个 Agent 隔离，飞书原卡只允许指定账号处理一次', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'contractor-feishu-collaboration-'));
  process.env.COLLAB_STATE_DIR = dir;
  await mkdir(path.join(dir, 'console'));
  const worker = path.join(dir, 'worker.mjs');
  const trace = path.join(dir, 'trace.ndjson');
  await writeFile(worker, [
    "import {appendFileSync,readFileSync} from 'node:fs';",
    "const context=JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT,'utf8'));",
    "const request=context.events.find(e=>e.type==='task.request');",
    "appendFileSync(process.argv[2],JSON.stringify({agent:process.argv[3],ticket:request.subject,events:context.events})+'\\n');",
    "if(context.answers.length) console.log('已按确认口径完成');",
    "else console.log('待确认验收范围\\n```agent-autoloop\\n'+JSON.stringify({ask:[{key:'confirm',title:'确认验收范围',text:'是否按本话题要求验收？',options:['确认','补资料']}]})+'\\n```');",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { feishuTrigger }, { discussionInput }, { readCardClick }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
    import('../src/upstream.ts'), import('../src/workbench/discussion-intake.ts'), import('../src/workbench/feishu-cards.ts'),
  ]);
  const auth = new ConsoleAuth(); await auth.ready(); await auth.bootstrapOwner('product', 'test-only-password');
  for (const person of ['design', 'engineering', 'outsider']) await auth.createAccount(person, 'test-only-password', 'operator', 'product');
  const config = settingsSchema.parse({ feishu: { profile: 'fixture', appId: 'app', botId: 'ou_bot', allowedGroups: ['oc_store'], decisionCards: true },
    crossChannel: {}, projects: [{ id: 'starter', title: '已配置项目', members: ['product','design','engineering'], maintainers: ['product'] }],
    functions: [{ id: 'review', title: '专业核对' }],
    agents: [['copy-agent', 'design'], ['wrap-agent', 'engineering']].map(([id, owner]) => ({
      id, owner, title: id, kind: 'personal', function: 'review', projects: ['starter'], capability: '核对推荐理由', skill: '本单内执行',
      active: true, engine: 'command', command: [process.execPath, worker, trace, id], execution: { kind: 'test', provider: 'fixture' },
    })),
  });
  const deliveries: { target: { message: string } | { user: string }; ref: string; card: any }[] = [];
  const updated: string[] = [];
  let cardsAvailable = false;
  const transport: CardTransport = {
    available: () => cardsAvailable,
    async send(target, _key, content) {
      const ref = 'om_card' + deliveries.length;
      deliveries.push({ target, ref, card: JSON.parse(content) });
      return { ref, chat: 'oc_store' };
    },
    async update(ref, content) {
      assert.equal(JSON.parse(content).body.elements.some((item: { behaviors?: unknown }) => item.behaviors), false);
      updated.push(ref);
    },
  };
  const replies: { id: string; message?: string; text: string }[] = [];
  const send = async (message: import('../upstream/superagent/src/core/index.ts').OutboundMessage) => {
    replies.push({ id: message.id, message: message.channel.address.messageId, text: message.text });
    return 'sent' as const;
  };
  const work = await openCollaboration(config, auth, send, transport);
  let stopped = false;
  t.after(async () => { if (!stopped) await work.close(); await rm(dir, { recursive: true, force: true }); });
  const nonce = randomUUID();
  const { id: project } = work.createProject('product', { nonce, title: '门店推荐理由' });
  assert.equal(work.createProject('product', { nonce, title: '门店推荐理由' }).id, project);
  assert.throws(() => work.createProject('product', { nonce, title: '另一项目' }), { status: 409 });
  for (const actor of ['design', 'engineering']) work.addProjectMember('product', project, actor);
  assert.throws(() => work.addProjectMember('design', project, 'outsider'), { status: 403 });
  assert.throws(() => work.addProjectAgent('product', project, 'copy-agent'), { status: 403 });
  work.addProjectAgent('design', project, 'copy-agent');
  work.addProjectAgent('engineering', project, 'wrap-agent');
  work.createTopic('product', project, { id: 'reasons', title: '推荐理由' });
  work.bindFeishuGroup('product', project, { chat: 'oc_store', label: '试点门店测试群', topic: 'reasons' });
  for (const actor of ['product', 'design', 'engineering']) {
    const identity = { provider: 'feishu' as const, namespace: 'app', id: 'ou_' + actor, label: actor };
    assert.ok(work.proveAccount(work.accountProof(actor, 'feishu').command.split(' ')[1]!, identity));
    work.confirmAccount(actor, 'feishu', identity);
  }
  const normalize = (actor: string, message: string, text: string, root?: string) => {
    const trigger = feishuTrigger({ message_id: message, root_id: root, parent_id: root, chat_id: 'oc_store',
      chat_type: 'group', sender_id: 'ou_' + actor, sender_type: 'user', content: text,
      create_time: String(Date.now()), mentions: [] }, 'ou_bot', 'app') as Trigger;
    return discussionInput(trigger, 'app');
  };
  const open = (actor: string, message: string, topic: string, agent: string) => {
    const event = normalize(actor, message, topic);
    const result = work.receiveChannel({ ...event, project, agent, topic: 'reasons', request: topic });
    assert.equal(result.status, 'pending');
    const ticket = work.resolveChannel('product', event.trigger.id, { action: 'create', agent }).ticket;
    assert.ok(ticket);
    return ticket;
  };
  const copy = open('product', 'om_copy', '推荐理由文案', 'copy-agent');
  const wrap = open('engineering', 'om_wrap', '推荐理由小屏换行', 'wrap-agent');
  assert.notEqual(copy, wrap);
  assert.equal(work.detail('product', copy).work.topic, 'reasons');
  assert.equal(work.detail('engineering', wrap).work.topic, 'reasons');
  assert.throws(() => work.conversation('outsider', project, { ticket: copy }), { status: 404 });
  const web = { nonce: randomUUID(), ticket: copy, text: '文案单内部补充', feishu: true };
  work.postConversation('design', project, web);
  work.postConversation('design', project, web);
  assert.equal(work.conversation('product', project, { ticket: copy }).length, 1);
  assert.equal(work.conversation('product', project, { ticket: wrap }).length, 0);
  const groupCopy = normalize('design', 'om_copy_note', '文案的话题补充', 'om_copy');
  const groupWrap = normalize('product', 'om_wrap_note', '小屏的话题补充', 'om_wrap');
  assert.equal(work.receiveFeishuReply(groupCopy, project), true);
  assert.equal(work.receiveFeishuReply(groupCopy, project), true);
  assert.equal(work.detail('design', copy).channelHistory.filter(item => item.text === '文案的话题补充').length, 1);
  assert.equal(work.receiveFeishuReply(groupWrap, project), true);
  assert.ok(work.detail('design', copy).channelHistory.some(item => item.text === '文案的话题补充'));
  assert.ok(work.detail('design', wrap).channelHistory.some(item => item.text === '小屏的话题补充'));

  async function wait<T>(lookup: () => T | undefined): Promise<T> {
    for (let i = 0; i < 150; i++) {
      const found = lookup();
      if (found) return found;
      await delay(100);
    }
    assert.fail('等待飞书卡片或执行状态超时');
  }
  type Sent = (typeof deliveries)[number];
  const forPerson = (person: string) => deliveries.find(item => 'user' in item.target && item.target.user === 'ou_' + person
    && item.card.header.title.content === 'Agent 等待你答复一项执行问题');
  await wait(() => work.detail('product', copy).questions.length && work.detail('engineering', wrap).questions.length || undefined);
  assert.equal(forPerson('product'), undefined);
  assert.equal(forPerson('engineering'), undefined);
  assert.ok(!replies.some(item => item.text.includes('Agent 等待你答复一项执行问题')));
  cardsAvailable = true;
  const copyCard = await wait(() => forPerson('product'));
  const wrapCard = await wait(() => forPerson('engineering'));
  assert.ok(!deliveries.some(item => 'message' in item.target));
  assert.deepEqual(replies.filter(item => item.text.includes(web.text)).map(item => item.message), ['om_copy']);
  const click = (item: Sent, actor: string, ref = item.ref) => readCardClick(JSON.stringify({
    type: 'card.action.trigger', event_id: randomUUID(), operator_id: 'ou_' + actor, message_id: ref, chat_id: 'oc_store',
    action_value: JSON.stringify(item.card.body.elements.find((entry: any) => entry.behaviors).behaviors[0].value),
  }));
  await assert.rejects(work.clickFeishuCard(click(copyCard, 'design')), { status: 403 });
  await assert.rejects(work.clickFeishuCard(click(copyCard, 'product', wrapCard.ref)), { status: 403 });
  const result = await Promise.all([work.clickFeishuCard(click(copyCard, 'product')), work.clickFeishuCard(click(copyCard, 'product'))]);
  assert.equal(result.filter(item => item.changed).length, 1);
  await wait(() => work.detail('product', copy).result);
  assert.equal(work.detail('engineering', wrap).questions.length, 1);
  assert.equal(work.detail('engineering', wrap).runs.length, 1);
  assert.equal((await work.clickFeishuCard(click(wrapCard, 'engineering'))).changed, true);
  await wait(() => work.detail('engineering', wrap).result);
  await wait(() => updated.includes(copyCard.ref) && updated.includes(wrapCard.ref) || undefined);
  const runs = (await readFile(trace,'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const copyRuns = runs.filter(run => run.ticket === copy);
  const wrapRuns = runs.filter(run => run.ticket === wrap);
  assert.equal(copyRuns.length, 2);
  assert.equal(wrapRuns.length, 2);
  assert.ok(copyRuns.every(run => run.agent === 'copy-agent'));
  assert.ok(wrapRuns.every(run => run.agent === 'wrap-agent'));
  assert.match(JSON.stringify(copyRuns.at(-1)), /文案单内部补充|文案的话题补充/);
  assert.doesNotMatch(JSON.stringify(copyRuns), /小屏的话题补充/);
  assert.match(JSON.stringify(wrapRuns.at(-1)), /小屏的话题补充/);
  assert.doesNotMatch(JSON.stringify(wrapRuns), /文案的话题补充|文案单内部补充/);
  await work.close();
  stopped = true;
  execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { openCollaboration } from './src/workbench/collaboration.ts';
    import { ConsoleAuth } from './src/console-auth.ts';
    const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
    const { config, project, copy, click } = JSON.parse(Buffer.concat(chunks));
    const auth = new ConsoleAuth(); await auth.ready();
    const work = await openCollaboration(config, auth);
    assert.equal(work.boundProject('feishu', 'oc_store')?.id, project);
    assert.equal(work.overview('design').agents.find(agent => agent.id === 'copy-agent')?.projects.includes(project), true);
    assert.equal(work.conversation('engineering', project, { ticket: copy }).length, 1);
    assert.equal((await work.clickFeishuCard(click)).changed, false);
    await work.close();
  `], { input: JSON.stringify({ config, project, copy, click: click(copyCard, 'product') }), timeout: 10000 });
});
