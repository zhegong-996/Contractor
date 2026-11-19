import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Trigger } from '../upstream/superagent/src/core/index.ts';

test('Octop 临时故障保留飞书补读游标，恢复只派一次，无结果可正常推进', { timeout: 20000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-octop-history-'));
  const history = path.join(state, 'history.json');
  const failure = path.join(state, 'failure');
  const bridge = path.join(state, 'bridge');
  const priorPath = process.env.PATH;
  process.env.COLLAB_STATE_DIR = state;
  process.env.PATH = state + path.delimiter + priorPath;
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await mkdir(path.join(state, 'console'));
  const owner = path.join(state, 'member-credentials', 'product');
  await mkdir(owner, { recursive: true, mode: 0o700 });
  await writeFile(path.join(owner, 'expert.json'), '{"apiKey":"test-only-secret"}', { mode: 0o600 });
  await writeFile(path.join(state, 'lark-cli'), [
    '#!' + process.execPath,
    "const fs=require('node:fs');",
    'const items=JSON.parse(fs.readFileSync(' + JSON.stringify(history) + ',"utf8"));',
    "console.log(JSON.stringify(process.argv.includes('whoami')?{identity:'user',available:true,appId:'reader',onBehalfOf:{openId:'ou_reader'}}:{ok:true,identity:'user',data:{items}}));",
  ].join('\n'), { mode: 0o700 });
  await writeFile(bridge, [
    '#!' + process.execPath,
    "const fs=require('node:fs');const operation=process.argv[3];const data=JSON.parse(fs.readFileSync(0,'utf8'));",
    'if (fs.readFileSync(' + JSON.stringify(failure) + ", 'utf8')===operation) process.exit(1);",
    "if (operation==='gateway') console.log(JSON.stringify(data));",
    "if (operation==='memory') console.log(JSON.stringify(data.query.includes('无匹配')?[]:data.entries.map(row=>row.id)));",
    "if (operation==='execute') {const citation=data.context.match(/\\[记忆:[a-z0-9-]+@[a-f0-9]{64}\\]/)[0];console.log(JSON.stringify({text:'小屏测试 '+citation,model:data.model,session:data.session,stopReason:'end_turn',usage:{input:100,output:20,cached:0}}));}",
  ].join('\n'), { mode: 0o700 });
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { feishuTrigger }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'), import('../src/upstream.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'test-only-password');
  await auth.createAccount('peer', 'test-only-password', 'operator', 'product');
  const config = settingsSchema.parse({
    projects: [{ id: 'store', title: '门店推荐理由', members: ['product', 'peer'], maintainers: ['product'],
      topics: [{ id: 'screen', title: '小屏' }], consultations: [{ topic: 'screen', feishu: true, sharedExperts: true }],
      consultationHistory: { profile: 'reader', appId: 'reader', userOpenId: 'ou_reader', member: 'product' },
      resources: [{ source: 'feishu', externalId: 'oc_store', state: 'bound', purpose: 'discussion', topic: 'screen' }] }],
    agents: [], functions: [{ id: 'review', title: '核对' }], feishu: { profile: 'test', appId: 'app', botId: 'ou_bot' },
    octop: { python: bridge, profiles: [{ owner: 'product', credential: 'expert', model: 'deepseek-test' }], feishuGateway: true },
  });
  const outbound: string[] = [];
  const work = await openCollaboration(config, auth, async item => {
    if (item.channel.address.topicConsultation) outbound.push(item.channel.address.messageId!);
    return 'sent';
  });
  const db = new DatabaseSync(path.join(state, 'orchestrator.sqlite'));
  t.after(async () => { process.env.PATH = priorPath; db.close(); await work.close(); await rm(state, { recursive: true, force: true }); });
  const account = { provider: 'feishu', namespace: 'app', id: 'ou_product', label: 'product' } as const;
  assert.ok(work.proveAccount(work.accountProof('product', 'feishu').command.split(' ')[1]!, account));
  work.confirmAccount('product', 'feishu', account);
  const expert = work.createOctop('product', 'store', randomUUID(), { title: '门店专家', capability: '小屏验收', function: 'review', instructions: '只读' });
  work.addKnowledge('product', 'store', { title: '小屏规则', body: '检查长词换行', kind: 'reference', conditions: '门店', visibility: 'project' });
  const root = feishuTrigger({ chat_type: 'group', chat_id: 'oc_store', message_id: 'om_root', thread_id: 'omt_screen',
    sender_type: 'user', sender_id: account.id, content: '门店原话题', create_time: String(now) }, 'ou_bot', 'app') as Trigger;
  work.trackFeishuThread(root);
  const cursors = () => ['workbench_discussion_chat', 'workbench_discussion_thread'].map(table => db.prepare('SELECT cursor FROM ' + table).get()?.cursor);
  const rows = () => work.conversation('product', 'store', { topic: 'screen' });
  const posted = Date.now() + 1000;
  const missed = { message_id: 'om_missed', chat_id: 'oc_store', thread_id: 'omt_screen', root_id: 'om_root',
    msg_type: 'text', create_time: String(posted), sender: { id: 'ou_reader', id_type: 'open_id', sender_type: 'user' },
    body: { content: JSON.stringify({ text: '/咨询 门店小屏验收' }) } };
  await writeFile(history, JSON.stringify([missed]));
  now = posted + 15_100;
  const before = cursors();
  for (const service of ['gateway', 'memory']) {
    await writeFile(failure, service);
    await work.refreshFeishuHistory();
    assert.deepEqual(cursors(), before, service + ' failed, preserve history cursors');
    assert.equal(rows().length, 0);
    assert.equal(db.prepare('SELECT count(*) AS total FROM workbench_conversation_message').get()?.total, 0);
  }
  await writeFile(failure, '');
  await work.refreshFeishuHistory();
  await work.refreshFeishuHistory();
  assert.equal(rows().length, 1);
  assert.deepEqual(cursors(), [now - 15_000, now - 15_000]);
  for (let count = 0; count < 45 && outbound.length === 0; count++) await delay(150);
  assert.deepEqual(outbound, ['om_missed']);
  assert.equal(rows()[0]?.consultations?.[0]?.status, 'answered');
  assert.equal(work.projectUsage('product', 'store').attempts.length, 1);

  const unmatched = { ...missed, message_id: 'om_unmatched', create_time: String(now), body: { content: JSON.stringify({ text: '/咨询 无匹配' }) } };
  await writeFile(history, JSON.stringify([missed, unmatched]));
  now += 20_000;
  await work.refreshFeishuHistory();
  assert.deepEqual(cursors(), [now - 15_000, now - 15_000]);
  assert.equal(rows().length, 1);

  const id = work.addKnowledge('product', 'store', { title: '受限口径', body: '按本工单授权核对长词',
    kind: 'reference', conditions: '仅试点', visibility: 'restricted' });
  const material = work.browse('product', 'store', '', true).find(row => row.id === id)!;
  assert.ok('revision' in material);
  const input = { topic: 'screen', nonce: randomUUID(), text: '这是私有问题', agents: [expert.id], knowledge: { id, revision: material.revision } };
  const peerCatalog = work.conversationIndex('peer', { project: 'store' });
  await assert.rejects(work.consultTopic('peer', 'store', input), { status: 403 });
  const created = await work.consultTopic('product', 'store', input);
  assert.deepEqual(await work.consultTopic('product', 'store', input), created);
  const [ticket] = created.tickets;
  assert.ok(ticket);
  assert.throws(() => work.detail('peer', ticket), { status: 404 });
  assert.throws(() => work.conversation('peer', 'store', { topic: 'screen', reply: ticket }), { status: 404 });
  assert.ok(!work.conversation('peer', 'store', { topic: 'screen' }).some(row => row.id === created.id));
  assert.ok(!work.overview('peer').tickets.some(row => row.id === ticket));
  assert.deepEqual(work.conversationIndex('peer', { project: 'store' }), peerCatalog);
  assert.ok(!work.conversationIndex('product', { project: 'store' }).rows.some(row => row.ticket === ticket));
  assert.throws(() => work.archiveConversation('product', 'store', { ticket, archived: true }), { status: 404 });
  const access = work.detail('product', ticket).requests[0]!;
  assert.equal(work.detail('product', ticket).runs.length, 0);
  work.changeAccess('product', ticket, access.id, 'granted');
  for (let i = 0; i < 60 && !work.detail('product', ticket).result; i++) await delay(100);
  const result = work.detail('product', ticket).result!;
  assert.equal(result.citations[0]?.id, id);
  const evaluation = work.createRegressionCase('product', 'store', { title: '私有口径回归', baseline: { ticket, revision: result.revision },
    check: { kind: 'answer', terms: ['长词'], citation: true } });
  assert.ok(!work.regressionList('peer', 'store').cases.some(row => row.id === evaluation.id));
  assert.ok(!work.projectUsage('peer', 'store').attempts.some(row => row.run === result.run));
  assert.equal(rows().find(row => row.id === created.id)?.consultations?.[0]?.status, 'answered');
  work.changeAccess('product', ticket, access.id, 'revoked');
  assert.equal(work.detail('product', ticket).result, undefined);
  assert.ok(!work.regressionList('product', 'store').cases.some(row => row.id === evaluation.id));
  assert.equal(rows().find(row => row.id === created.id)?.consultations?.[0]?.status, 'unavailable');
  assert.deepEqual(outbound, ['om_missed']);
});
