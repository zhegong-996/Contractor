import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { ChannelRequest, PlatformActor } from '../src/workbench/channel-links.ts';
import type { OutboundMessage } from '../upstream/superagent/src/core/index.ts';

test('通用路由推送接单和执行决策，权限分离且旧进程退出后才重派原工单', { timeout: 25000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'suitme-routing-'));
  const fixture = path.join(directory, 'agent.mjs');
  const markers = path.join(directory, 'markers');
  await mkdir(path.join(directory, 'console'));
  await writeFile(fixture, [
    "import {appendFileSync,readFileSync} from 'node:fs';",
    'const [markers, mode] = process.argv.slice(2);',
    "const context = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT, 'utf8'));",
    'const mark = (text) => appendFileSync(markers, text + "\\n");',
    "const task = context.events.find(item => item.type === 'task.request');",
    "if (mode === 'lead' && task.detail.includes('需交接')) {",
    "  process.on('SIGTERM', () => {mark('old-cancelling'); setTimeout(() => { mark('old-exiting'); process.exit(0); }, 1800);});",
    "  mark('old-start'); setInterval(() => {}, 300);",
    "} else if (mode === 'new') {",
    "  mark(context.events.some(item => item.type === 'task.handoff') ? 'new-with-handoff' : 'new-unrelated');",
    "  console.log('接续完成');",
    "} else if (task.detail.includes('要确认') && context.answers.length === 0) {",
    "  console.log('待确认产品口径');",
    '  console.log("```agent-autoloop\\n" + JSON.stringify({ask:[{title:"是否按 360px 验收？",text:"请确认试点屏宽。",options:["按 360px","需要新稿"],key:"width"}]}) + "\\n```");',
    "} else {",
    "  if (context.events.some(item => item.type === 'task.followup')) console.log('已结合已挂接的渠道补充');",
    "  else console.log('已按验收口径处理');",
    "}",
  ].join('\n'));
  process.env.COLLAB_STATE_DIR = directory;
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { key }, { messageRef }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'),
    import('../src/console-auth.ts'), import('../upstream/superagent/src/core/index.ts'), import('../src/workbench/channel-links.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('owner', 'only-for-unit-test');
  for (const person of ['maker', 'decider', 'peer']) await auth.createAccount(person, 'only-for-unit-test', 'operator', 'owner');
  const agent = (id: string, owner: string, projects: string[], mode: string) => ({ id, title: id, owner, projects,
    kind: 'personal', engine: 'command', command: [process.execPath, fixture, markers, mode], function: 'verification',
    active: true, capability: '验证门店推荐理由', skill: '按当前委托核对验收口径' });
  const config = settingsSchema.parse({
    feishu: { appId: 'app', botId: 'bot', profile: 'test' },
    crossChannel: {},
    projects: [
      { id: 'store', title: '门店推荐理由', members: ['owner', 'maker', 'decider'], maintainers: ['owner'], decisionOwner: 'owner',
        relatedProjects: ['related'], topics: [{ id: 'reason', title: '推荐理由' }, { id: 'width', parent: 'reason', title: '验收屏宽' }],
        dispatch: [{ topic: 'reason', function: 'verification', agent: 'lead', decider: 'decider' }] },
      { id: 'private', parent: 'store', title: '门店接入', members: ['owner', 'peer'], maintainers: ['owner'],
        dispatch: [{ function: 'verification', agent: 'private-review' }] },
      { id: 'related', title: '体验优化', members: ['owner', 'maker', 'peer'], maintainers: ['owner'],
        dispatch: [{ function: 'verification', agent: 'related-review' }] },
    ],
    functions: [{ id: 'verification', title: '验收核对' }],
    agents: [agent('lead', 'maker', ['store'], 'lead'), agent('replacement', 'decider', ['store'], 'new'),
      agent('private-review', 'peer', ['private'], 'other'), agent('related-review', 'maker', ['related'], 'other')],
  });
  const pushed: OutboundMessage[] = [];
  const work = await openCollaboration(config, auth, async message => { pushed.push(message); return 'sent'; });
  const db = new DatabaseSync(path.join(directory, 'orchestrator.sqlite'), { readOnly: true });
  t.after(async () => { db.close(); await work.close(); await rm(directory, { recursive: true, force: true }); });
  for (const member of ['owner', 'maker', 'decider']) {
    const account: PlatformActor = { provider: 'feishu', namespace: 'app', id: 'ou_' + member, label: member };
    assert.ok(work.proveAccount(work.accountProof(member, 'feishu').command.split(' ')[1]!, account));
    work.confirmAccount(member, 'feishu', account);
  }
  const github: PlatformActor = { provider: 'github', namespace: 'github.com', id: '42', label: 'maker' };
  assert.ok(work.proveAccount(work.accountProof('maker', 'github').command.split(' ')[1]!, github));
  work.confirmAccount('maker', 'github', github);
  const event = (tag: string, project = 'store', sender: PlatformActor = github): ChannelRequest => ({
    sender, project, origin: { key: sender.provider + ':' + tag, label: '联调来源' }, agent: 'auto',
    request: tag, topic: project === 'store' ? 'width' : undefined,
    trigger: { id: key('routing-test', tag), source: sender.provider, actor: { source: sender.provider, id: sender.id },
      human: true, addressed: 'direct', at: new Date().toISOString(), threads: [{ source: sender.provider, id: tag }], text: tag, meta: {} },
  });
  const wait = async <T>(fn: () => T | undefined | Promise<T | undefined>) => {
    for (let i = 0; i < 150; i++) {
      const result = await fn();
      if (result) return result;
      await delay(100);
    }
    assert.fail('等待预期状态超时');
  };
  const start = async (actor: string, project: string, title: string) => {
    const { trigger } = work.start(actor, { project, title, request: title, nonce: randomUUID(), priority: 'normal', material: [] });
    return await wait(() => work.resolveStart(actor, trigger) ?? undefined);
  };
  const assignmentCount = (id: string) => Number(db.prepare("SELECT json_array_length(value,'$.assignments') AS n FROM ticket WHERE id=?").get(id)?.n);
  const record = () => readFile(markers, 'utf8').catch(() => '');

  const first = event('门店推荐理由要确认');
  assert.equal(work.receiveChannel(first).status, 'pending');
  const sameRoot = { ...event('同一话题的下一条委托'), origin: first.origin };
  assert.equal(work.receiveChannel(sameRoot).status, 'pending');
  await wait(() => work.needsYou('owner').find(decision => decision.subject === first.trigger.id && decision.notification === 'sent'));
  assert.equal(work.needsYou('maker').length, 0);
  assert.throws(() => work.resolveChannel('maker', first.trigger.id, { action: 'create' }), { status: 403 });
  const { ticket: original } = work.resolveChannel('owner', first.trigger.id, { action: 'create' });
  assert.ok(original);
  assert.equal(work.resolveChannel('owner', sameRoot.trigger.id, { action: 'create' }).ticket, original);
  assert.equal(work.detail('maker', original).work.agent, 'lead');
  assert.equal(work.detail('maker', original).topicTitle, '验收屏宽');
  assert.equal(work.receiveChannel(first).status, 'duplicate');
  const answer = await wait(() => work.needsYou('decider').find(decision => decision.ticket === original && decision.notification === 'sent'));
  assert.equal(answer.question?.title, '是否按 360px 验收？');
  assert.equal(work.detail('maker', original).questions.length, 0);
  assert.throws(() => work.reply('maker', original, { card: answer.card!, choice: 0, nonce: 'draft' }), { status: 403 });
  const continuation = event('同一工单补充样例', 'store', { provider: 'feishu', namespace: 'app', id: 'ou_maker', label: 'maker' });
  assert.equal(work.receiveChannel(continuation, first.origin).status, 'linked');
  assert.equal(work.detail('maker', original).runs.length, 1);
  assert.equal(assignmentCount(original), 1);
  assert.deepEqual(work.detail('maker', original).channelHistory.map(row => row.member), ['maker', 'maker', 'maker']);
  work.answerDecision('decider', answer.id, '1', event('选一').trigger);
  const result = await wait(() => work.detail('maker', original).result);
  assert.equal(result.text, '已结合已挂接的渠道补充');
  assert.equal(assignmentCount(original), 1);
  assert.equal(work.detail('maker', original).runs.length, 2);
  assert.equal(work.needsYou('decider').length, 0);
  assert.equal(pushed[0]?.channel.address.userId, 'ou_owner');
  assert.equal(pushed.find(message => message.channel.address.decision === answer.id)?.channel.address.userId, 'ou_decider');

  const privateTicket = await start('owner', 'private', '子项目独立工单');
  const visibleTicket = await start('maker', 'related', '关联项目独立工单');
  const denied = event('误引子项目');
  assert.equal(work.receiveChannel(denied, privateTicket).status, 'pending');
  assert.throws(() => work.detail('maker', privateTicket), { status: 404 });
  assert.throws(() => work.resolveChannel('owner', denied.trigger.id, { action: 'link', ticket: privateTicket }), { status: 409 });
  assert.equal(work.channelTicket(messageRef(denied.trigger.id)), undefined);
  const safe = event('关联项目引用');
  assert.equal(work.receiveChannel(safe, visibleTicket).status, 'linked');
  assert.equal(work.channelTicket(safe.origin), undefined);
  assert.equal(work.detail('maker', visibleTicket).channelHistory.at(-1)?.id, safe.trigger.id);
  assert.ok(!JSON.stringify(work.detail('peer', visibleTicket)).includes(safe.request));
  const routed = event('待确认的可共享需求');
  assert.equal(work.receiveChannel(routed).status, 'pending');
  assert.throws(() => work.resolveChannel('owner', routed.trigger.id, { action: 'create', project: 'private' }), { status: 403 });
  assert.throws(() => work.resolveChannel('owner', routed.trigger.id, { action: 'create', project: 'related' }), { status: 409 });
  const { ticket: shared } = work.resolveChannel('owner', routed.trigger.id, {
    action: 'create', project: 'related', brief: '检查窄屏文字位置',
  });
  assert.ok(shared);
  const sharedWork = work.detail('peer', shared);
  assert.equal(sharedWork.work.agent, 'related-review');
  assert.equal(sharedWork.request, '检查窄屏文字位置');
  assert.ok(!JSON.stringify(sharedWork).includes(routed.request));
  const archive = event('仅归档的小屏观察');
  assert.equal(work.receiveChannel(archive).status, 'pending');
  work.resolveChannel('owner', archive.trigger.id, { action: 'topic', topic: 'width' });
  assert.equal(work.channelView('maker').archived.find(item => item.id === archive.trigger.id)?.topic, 'width');
  assert.equal(work.channelTicket(archive.origin), undefined);
  const manual = work.start('maker', { project: 'store', title: '无明确职责的委托', request: '请先确认由谁处理',
    nonce: randomUUID(), priority: 'normal', material: [] });
  assert.ok(manual.pending);
  await wait(() => work.needsYou('owner').find(item => item.kind === 'intake' && item.subject === manual.trigger));
  assert.equal(work.resolveIntake('owner', manual.trigger, { action: 'dismiss' }).ticket, undefined);
  assert.equal(work.resolveStart('maker', manual.trigger), null);

  const held = event('门店推荐理由需交接');
  assert.equal(work.receiveChannel(held).status, 'pending');
  const { ticket: transfer } = work.resolveChannel('owner', held.trigger.id, { action: 'create' });
  assert.ok(transfer);
  await wait(async () => (await record()).includes('old-start') || undefined);
  assert.throws(() => work.handoff('maker', transfer, { agent: 'replacement', reason: '接续' }), { status: 403 });
  const plan = work.handoff('owner', transfer, { agent: 'replacement', reason: '接续，按当前已核对的要求完成' });
  assert.equal(plan.runs.length, 1);
  await wait(async () => (await record()).includes('old-cancelling') || undefined);
  assert.equal(assignmentCount(transfer), 1);
  assert.equal(work.detail('maker', transfer).work.agent, 'lead');
  assert.ok(!(await record()).includes('new-with-handoff'));
  await wait(() => work.detail('maker', transfer).result);
  assert.equal(work.detail('maker', transfer).work.agent, 'replacement');
  assert.deepEqual((await record()).trim().split('\n'), ['old-start', 'old-cancelling', 'old-exiting', 'new-with-handoff']);
  assert.equal(assignmentCount(transfer), 2);
  assert.deepEqual(work.detail('maker', transfer).runs.map(run => run.state), ['cancelled', 'done']);
  assert.deepEqual(db.prepare("SELECT kind FROM workbench_audit WHERE ticket=? AND kind LIKE 'handoff.%' ORDER BY id").all(transfer)
    .map(row => row.kind), ['handoff.requested', 'handoff.old-exited', 'handoff.completed']);
  assert.equal(work.handoff('owner', transfer, { agent: 'replacement', reason: '接续，按当前已核对的要求完成' }).to, 'replacement');
  assert.equal(assignmentCount(transfer), 2);
});
