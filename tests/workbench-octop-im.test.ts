import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { OctopIMAddress } from '../src/workbench/octop-im-contract.ts';

test('多渠道咨询共用已验证成员，原会话回传、丢确认及重启不重复派单', { timeout: 35000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-octop-im-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'));
  const worker = path.join(state, 'worker.mjs');
  await writeFile(worker, [
    "import {readFileSync} from 'node:fs';",
    "const context=JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT,'utf8'));",
    "const material=context.events.find(e=>e.type==='knowledge.source');",
    "const citation=material.detail.match(/\\[记忆:[^\\]]+\\]/)[0];",
    "console.log('咨询已回复\\n```agent-autoloop\\n'+JSON.stringify({events:[{id:'reply',type:'contractor.consultation-reply',detail:'320px 验证连续长词换行 '+citation}]})+'\\n```');",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { channelDeliveryJournal }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
    import('../src/workbench/channel-delivery-journal.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'test-only-password');
  await auth.createAccount('engineer', 'test-only-password', 'operator', 'product');
  const config = settingsSchema.parse({
    workbenchPublicUrl: 'https://collab.example.com',
    projects: [{ id: 'store', title: '门店推荐理由', members: ['product', 'engineer'], maintainers: ['product'],
      topics: [{ id: 'screen', title: '小屏' }], consultations: [{ topic: 'screen', agents: [{ agent: 'screen-agent', material: ['pending'] }] }] },
    { id: 'child', parent: 'store', title: '内部小屏验证', members: ['product'], maintainers: ['product'],
      topics: [{ id: 'screen', title: '小屏' }], consultations: [{ topic: 'screen', agents: [{ agent: 'screen-agent', material: ['pending'] }] }] }],
    functions: [{ id: 'review', title: '核对' }],
    agents: [{ id: 'screen-agent', title: '验收 Agent', owner: 'product', kind: 'specialist', function: 'review', projects: ['store', 'child'],
      active: true, capability: '核对门店小屏', engine: 'command', execution: { kind: 'test', provider: 'fixture' }, skill: '只读', command: [process.execPath, worker] }],
    octop: { python: '/unused', profiles: [], channels: [
      { id: 'telegram-team', kind: 'telegram', credential: 'telegram-team', allowAccountBinding: true, routes: [
        { chat: '-100', thread: '7', project: 'store', topic: 'screen' }, { chat: '-100', thread: '8', project: 'child', topic: 'screen' }] },
      { id: 'discord-team', kind: 'discord', credential: 'discord-team', allowAccountBinding: true, routes: [
        { chat: '100', project: 'store', topic: 'screen' }] },
      { id: 'dingtalk-team', kind: 'dingtalk', credential: 'dingtalk-team', allowAccountBinding: true, routes: [
        { chat: 'ding-group', project: 'store', topic: 'screen' }] },
    ] },
  });
  const duplicate = structuredClone(config);
  duplicate.octop!.channels![0]!.routes.push({ ...duplicate.octop!.channels![0]!.routes[0]!, project: 'child' });
  assert.ok(!settingsSchema.safeParse(duplicate).success);
  const replies: { address: OctopIMAddress; text: string }[] = [];
  const replyCount = () => replies.length;
  let ready = false;
  const transport: import('../src/workbench/octop-im-contract.ts').OctopIMTransport = {
    ready: () => ready,
    async send(address, text, _card, delivery) {
      replies.push({ address, text });
      if (address.kind !== 'dingtalk') return;
      assert.match(delivery ?? '', /^[0-9a-f]{32}$/);
      const ledger = new DatabaseSync(path.join(state, 'feishu-ingress', 'inbox.sqlite'));
      try {
        if (address.message === '40') channelDeliveryJournal(ledger, 'channel_delivery').acknowledge(delivery!, address.connector, 'markdown');
        else ledger.prepare('UPDATE channel_delivery SET started_at=? WHERE id=?')
          .run(new Date(Date.now() - 60000).toISOString(), delivery!);
      } finally { ledger.close(); }
      throw new Error('模拟丢失 Gateway 回执');
    },
  };
  const work = await openCollaboration(config, auth, undefined, undefined, transport);
  let closed = false;
  t.after(async () => { if (!closed) await work.close(); await rm(state, { recursive: true, force: true }); });
  const source = work.addKnowledge('product', 'store', { title: '小屏换行', body: '用连续长词验证 320px', conditions: '门店', kind: 'reference', visibility: 'project' });
  config.projects[0]!.consultations![0]!.agents[0]!.material = [source];
  const say = (address: OctopIMAddress, text = '/consult 门店推荐理由小屏怎么验收？') => work.receiveOctopIM({ address, text, at: new Date().toISOString() });
  const telegram = { connector: 'telegram-team', kind: 'telegram', chat: '-100', thread: '7', message: '40', sender: '12', direct: false } as const;
  const discord = { connector: 'discord-team', kind: 'discord', chat: '100', message: '40', sender: '12', direct: false } as const;
  const dingtalk = { connector: 'dingtalk-team', kind: 'dingtalk', chat: 'ding-group', message: '40', sender: '12', direct: false } as const;
  assert.equal(await say(telegram), undefined);
  for (const address of [telegram, discord, dingtalk]) {
    const proof = work.accountProof('engineer', 'octop');
    assert.equal(await say(address, proof.command), undefined);
    assert.equal(await say({ ...address, direct: true, chat: address.sender, thread: undefined }, proof.command), true);
    work.confirmAccount('engineer', 'octop', { namespace: address.connector, id: address.sender });
  }
  assert.equal(await say({ ...telegram, thread: undefined }), undefined);
  assert.equal(await say({ ...telegram, thread: '9' }), undefined);
  assert.equal(await say({ ...telegram, kind: 'discord' }), undefined);
  await assert.rejects(Promise.resolve(say({ ...telegram, thread: '8' })), { status: 404 });
  assert.equal(await say({ ...telegram, message: 'unrelated-chat' }, '闲聊'), undefined);
  const first = await say(telegram);
  const second = await say(discord);
  const third = await say(dingtalk);
  assert.ok(first && typeof first === 'object' && second && typeof second === 'object' && third && typeof third === 'object');
  assert.notEqual(first.tickets[0], second.tickets[0]);
  assert.equal(await say(telegram), undefined);
  assert.equal(await say(discord), undefined);
  assert.equal(await say(dingtalk), undefined);
  for (let count = 0; count < 60 && !first.tickets.concat(second.tickets, third.tickets).every(id => work.detail('engineer', id).result); count++) await delay(250);
  assert.equal(replyCount(), 0);
  ready = true;
  for (let count = 0; count < 55 && replyCount() !== 3; count++) await delay(250);
  assert.equal(replies.length, 3);
  assert.ok(replies.every(item => item.text.startsWith('咨询已处理。\nhttps://collab.example.com/') && !item.text.includes('320px')));
  assert.deepEqual(replies.map(item => item.address).sort((a, b) => a.kind.localeCompare(b.kind)), [dingtalk, discord, telegram]);
  assert.deepEqual(work.detail('engineer', third.tickets[0]!).channelReturn?.state, 'sent');
  assert.equal(work.detail('engineer', third.tickets[0]!).channelReturn?.form, 'markdown');
  assert.equal(work.detail('product', third.tickets[0]!).channelReturn, undefined);
  assert.equal(work.projectUsage('engineer', 'store').attempts.length, 3);
  const noAck = await say({ ...dingtalk, message: '41' });
  assert.ok(noAck && typeof noAck === 'object');
  for (let count = 0; count < 55 && work.detail('engineer', noAck.tickets[0]!).channelReturn?.state !== 'unconfirmed'; count++) await delay(200);
  assert.equal(work.detail('engineer', noAck.tickets[0]!).channelReturn?.state, 'unconfirmed');
  assert.equal(await say(dingtalk), undefined);
  assert.equal(await say({ ...dingtalk, message: '41' }), undefined);
  assert.equal(work.detail('engineer', third.tickets[0]!).channelReturn?.state, 'sent');
  assert.equal(work.detail('engineer', noAck.tickets[0]!).channelReturn?.state, 'unconfirmed');
  assert.equal(work.projectUsage('engineer', 'store').attempts.length, 4);
  assert.equal(replyCount(), 4);
  work.revokeAccount('engineer', 'octop', telegram.connector, telegram.sender);
  assert.equal(await say({ ...telegram, message: '41' }), undefined);
  assert.equal(work.detail('engineer', first.tickets[0]!).result, undefined);
  assert.match(work.detail('engineer', second.tickets[0]!).result?.text ?? '', /320px/);

  ready = false;
  const restartAddress = { ...dingtalk, message: '42' };
  const pending = await say(restartAddress);
  assert.ok(pending && typeof pending === 'object');
  const restartTicket = pending.tickets[0]!;
  for (let count = 0; count < 55 && work.detail('engineer', restartTicket).channelReturn?.state !== 'waiting'; count++) await delay(200);
  assert.equal(work.detail('engineer', restartTicket).channelReturn?.state, 'waiting');
  await work.close();
  closed = true;
  const ledger = new DatabaseSync(path.join(state, 'orchestrator.sqlite'));
  try {
    const receipt = ledger.prepare("SELECT id,value->>'$.status' status FROM outbox WHERE value->>'$.ticketId'=?").get(restartTicket);
    assert.equal(receipt?.status, 'pending');
    const journal = channelDeliveryJournal(ledger);
    assert.ok(journal.begin(String(receipt?.id), dingtalk.connector));
    journal.acknowledge(String(receipt?.id), dingtalk.connector, 'card');
  } finally { ledger.close(); }
  const settings = path.join(state, 'restart.json');
  const spooledAddress = { ...dingtalk, message: '43' };
  const { channelInbox, openChannelJournal } = await import('../src/workbench/channel-journal.ts');
  const inbox = channelInbox<'message'>(openChannelJournal(), 'octop:' + dingtalk.connector);
  try {
    const wire = JSON.stringify({ address: spooledAddress, text: '/consult 门店推荐理由小屏怎么验收？', at: new Date().toISOString() });
    assert.equal(inbox.put('message', dingtalk.chat, wire, Date.now(), 'durable-stream-id'), true);
    assert.equal(inbox.put('message', dingtalk.chat, wire, Date.now(), 'durable-stream-id'), false);
  } finally { inbox.close(); }
  await writeFile(settings, JSON.stringify({ config, restartAddress, restartTicket, spooledAddress }));
  const recovery = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { DatabaseSync } from 'node:sqlite';
    import { setTimeout as delay } from 'node:timers/promises';
    import { ConsoleAuth } from './src/console-auth.ts';
    import { openCollaboration } from './src/workbench/collaboration.ts';
    import { openIntake } from './src/workbench/intake.ts';
    const { config, restartAddress, restartTicket, spooledAddress } = JSON.parse(readFileSync(process.argv[1], 'utf8'));
    const auth = new ConsoleAuth();
    await auth.ready();
    const sends = [];
    const work = await openCollaboration(config, auth, undefined, undefined, { ready: () => true, async send(address) { sends.push(address); } });
    const ledger = new DatabaseSync(process.env.COLLAB_STATE_DIR + '/orchestrator.sqlite', { readOnly: true });
    const intake = await openIntake(config, work, auth, { verifyRecovery() {} });
    try {
      const status = () => ledger.prepare("SELECT value->>'$.status' status FROM outbox WHERE value->>'$.ticketId'=?").get(restartTicket)?.status;
      for (let count = 0; count < 70 && status() !== 'sent'; count++) await delay(100);
      assert.equal(status(), 'sent');
      assert.equal(work.detail('engineer', restartTicket).channelReturn?.form, 'card');
      const event = { address: restartAddress, text: '/consult 门店推荐理由小屏怎么验收？', at: new Date().toISOString() };
      assert.equal(work.receiveOctopIM(event), undefined);
      assert.equal(work.receiveOctopIM(event), undefined);
      for (let count = 0; count < 90 && sends.length === 0; count++) await delay(100);
      assert.deepEqual(sends, [spooledAddress]);
      assert.equal(work.projectUsage('engineer', 'store').attempts.length, 6);
      assert.equal(intake.imStatus().find(row => row.id === spooledAddress.connector).inbox.pending, 0);
      console.log('recovered-original-receipt');
    } finally { ledger.close(); await intake.close(); await work.close(); }
  `, settings], { timeout: 25000 });
  assert.match(recovery.stdout, /recovered-original-receipt/);
});
