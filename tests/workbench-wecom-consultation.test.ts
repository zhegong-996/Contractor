import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Trigger } from '../upstream/superagent/src/core/index.ts';
import type { OctopIMAddress } from '../src/workbench/octop-im-contract.ts';

test('飞书和企业微信识别同一成员，原会话各回一次，统一阻断撤权资料及派生知识', { timeout: 25000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-wecom-consultation-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'));
  const worker = path.join(state, 'worker.mjs');
  await writeFile(worker, [
    "import {readFileSync} from 'node:fs';",
    "const context=JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT,'utf8'));",
    "const citation=context.events.find(e=>e.type==='knowledge.source')?.detail.match(/\\[记忆:[^\\]]+\\]/)?.[0];",
    "const detail='280px、320px 和 360px 下核对连续长词换行。 '+citation;",
    "console.log('核对小屏验收条件\\n```agent-autoloop\\n'+JSON.stringify({events:[{id:'reply',type:'contractor.consultation-reply',detail}]})+'\\n```');",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { feishuTrigger }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'), import('../src/upstream.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'test-only-password');
  const config = settingsSchema.parse({
    projects: [{ id: 'store', title: '门店推荐理由', members: ['product'], maintainers: ['product'],
      topics: [{ id: 'screen', title: '小屏' }], consultations: [{ topic: 'screen', feishu: true, agents: [{ agent: 'screen-agent', material: ['pending'] }] }],
      resources: [{ source: 'feishu', externalId: 'oc_store', state: 'bound', purpose: 'discussion', topic: 'screen', feishuTopicRoots: { screen: 'om_root' } }] }],
    functions: [{ id: 'review', title: '核对' }],
    agents: [{ id: 'screen-agent', title: '门店专家', owner: 'product', kind: 'specialist', function: 'review', projects: ['store'],
      active: true, capability: '核对门店小屏', engine: 'command', execution: { kind: 'test', provider: 'fixture' }, skill: '只读', command: [process.execPath, worker] }],
    feishu: { profile: 'test', appId: 'cli_test', botId: 'ou_bot', allowedGroups: ['oc_store'] },
    octop: { python: '/unused', profiles: [], channels: [{ id: 'wecom-store', kind: 'wecom', credential: 'wecom-store',
      allowAccountBinding: true, routes: [{ chat: 'wecom-group', project: 'store', topic: 'screen' }] }] },
  });
  const replies: { via: string; conversation: string; text: string }[] = [];
  const work = await openCollaboration(config, auth, async item => {
    replies.push({ via: 'feishu', conversation: item.channel.address.messageId!, text: item.text });
    return 'sent';
  }, undefined, { ready: () => true, async send(address, text) {
    replies.push({ via: address.kind, conversation: address.chat, text });
  } });
  t.after(async () => { await work.close(); await rm(state, { recursive: true, force: true }); });
  const source = work.addKnowledge('product', 'store', { title: '小屏长文本验收', body: '三个视口都测试长词换行。', conditions: '门店', kind: 'reference', visibility: 'project' });
  const derived = work.start('product', { project: 'store', topic: 'screen', agent: 'screen-agent', material: [source],
    priority: 'normal', title: '小屏验收派生规则', request: '根据门店原资料复核小屏条件。', nonce: randomUUID() }, undefined, true).ticket!;
  async function until<T>(check: () => T | undefined) {
    for (let round = 0; round < 60; round++) {
      const value = check();
      if (value !== undefined) return value;
      await delay(150);
    }
    assert.fail('等待 AutoLoop 执行或回传超时');
  }
  const accepted = await until(() => work.detail('product', derived).result);
  await work.accept('product', derived, accepted.revision, '门店测试项目', '三个视口连续长词均必须换行。');
  const candidate = work.browse('product', 'store', '').find(row => row.id === derived);
  assert.ok(candidate && 'revision' in candidate);
  await work.publish('product', derived, candidate.revision);
  config.projects[0]!.consultations![0]!.agents[0]!.material = [source, derived];

  const text = '门店推荐理由小屏怎么验收？';
  const address: OctopIMAddress = { connector: 'wecom-store', kind: 'wecom', chat: 'wecom-group', sender: 'wecom-user', message: 'msg-1', direct: false };
  const sendWecom = (incoming: OctopIMAddress, content = '/咨询 ' + text) => work.receiveOctopIM({ address: incoming, text: content, at: new Date().toISOString() });
  const sendFeishu = (message: string) => work.receiveFeishuConsultation(config.projects[0]!, feishuTrigger({
    chat_id: 'oc_store', chat_type: 'group', root_id: 'om_root', message_id: message, sender_id: 'ou_product',
    sender_type: 'user', content: '/咨询 ' + text, create_time: String(Date.now()),
  }, 'ou_bot', 'cli_test') as Trigger, { text });
  assert.equal(sendWecom(address), undefined);
  assert.equal(await sendFeishu('om_first'), undefined);
  const feishu = { provider: 'feishu', namespace: 'cli_test', id: 'ou_product', label: 'product' } as const;
  assert.ok(work.proveAccount(work.accountProof('product', 'feishu').command.split(' ')[1]!, feishu));
  work.confirmAccount('product', 'feishu', feishu);
  const proof = work.accountProof('product', 'octop');
  assert.equal(sendWecom(address, proof.command), undefined);
  assert.equal(sendWecom({ ...address, chat: address.sender, direct: true }, proof.command), true);
  work.confirmAccount('product', 'octop', { namespace: address.connector, id: address.sender });
  const first = await sendFeishu('om_first');
  const second = await sendWecom(address);
  assert.ok(first && second && typeof second === 'object');
  assert.equal(await sendFeishu('om_first'), undefined);
  assert.equal(sendWecom(address), undefined);
  await until(() => replies.length === 2 ? true : undefined);
  const results = [...first.tickets, ...second.tickets].map(id => work.detail('product', id));
  assert.deepEqual(results.map(row => [row.work.requester, row.project, row.work.topic, row.work.source, row.runs.length]),
    [['product', 'store', 'screen', 'feishu', 1], ['product', 'store', 'screen', 'octop', 1]]);
  assert.deepEqual(work.conversation('product', 'store', { topic: 'screen' }).map(row => row.channel), ['feishu', 'wecom']);
  assert.deepEqual(work.projectChannels('product', 'store'), [{ connector: address.connector, kind: 'wecom', topics: ['screen'] }]);
  assert.throws(() => work.projectChannels('outsider', 'store'), { status: 404 });
  assert.ok(results.every(row => row.result?.sources.some(item => item.id === derived)));
  assert.deepEqual(replies.map(row => [row.via, row.conversation]).sort(), [['feishu', 'om_root'], ['wecom', 'wecom-group']]);
  assert.ok(replies.every(row => !row.text.includes('280px')));

  const version = work.browse('product', 'store', '').find(row => row.id === source);
  assert.ok(version && 'revision' in version);
  work.invalidateKnowledge('product', source, version.revision, '联调撤回原资料');
  assert.ok(work.browse('product', 'store', '', true).some(row => row.id === source));
  assert.ok(!work.browse('product', 'store', '').some(row => row.id === derived));
  await assert.rejects(sendFeishu('om_after_revoke'), { status: 409 });
  await assert.rejects(Promise.resolve(sendWecom({ ...address, message: 'msg-2' })), { status: 409 });
  assert.equal(work.projectUsage('product', 'store').attempts.length, 3);
  assert.equal(replies.length, 2);
});
