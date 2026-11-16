import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Trigger } from '../upstream/superagent/src/core/index.ts';
import { IM_WORDS, wordCount } from '../upstream/superagent/src/infra/text.ts';

test('主题咨询通过原生执行隔离来源，重放只派一次，且只回原飞书话题', { timeout: 30000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'suitme-topic-consultation-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'));
  const worker = path.join(state, 'worker.mjs');
  await writeFile(worker, [
    "import {readFileSync} from 'node:fs';",
    "const context=JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT,'utf8'));",
    "const scope=JSON.stringify(context);",
    "const marker=process.argv[2]; const other=marker==='COPY_ONLY'?'WRAP_ONLY':'COPY_ONLY';",
    "if(!scope.includes(marker)||scope.includes(other)) process.exit(1);",
    "const citation=context.events.find(e=>e.type==='knowledge.source').detail.match(/\\[记忆:[^\\]]+\\]/)[0];",
    "console.log('查询结论 '+marker+' 文案'.repeat(110)+' '+citation);",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { feishuTrigger }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'), import('../src/upstream.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'test-only-password');
  for (const actor of ['engineer', 'outsider']) await auth.createAccount(actor, 'test-only-password', 'operator', 'product');
  const config = settingsSchema.parse({
    projects: [{ id: 'store', title: '门店', members: ['product', 'engineer'], maintainers: ['product'],
      topics: [{ id: 'recommendation', title: '推荐理由' }, { id: 'other', title: '其他' }],
      resources: [{ source: 'feishu', externalId: 'oc_test', label: '试验群', state: 'bound', topic: 'recommendation' },
        { source: 'github', externalId: 'team/test', label: '试验仓', state: 'bound', contributors: ['engineer'],
          execution: { base: 'main', paths: ['collab-pilot/'] } }] }],
    attribution: { checkouts: { 'team/test': state }, entireCommand: process.execPath },
    functions: [{ id: 'review', title: '查资料' }],
    agents: [['copy-agent', 'product', 'COPY_ONLY'], ['wrap-agent', 'engineer', 'WRAP_ONLY']].map(([id, owner, marker]) => ({
      id, title: id, owner, kind: 'specialist', function: 'review', projects: ['store'], capability: '核对资料',
      active: true, engine: 'command', execution: { kind: 'test', provider: 'fixture' }, skill: '读取本次提供的资料',
      command: [process.execPath, worker, marker],
    })),
    feishu: { profile: 'fixture', appId: 'app', botId: 'ou_bot', allowedGroups: ['oc_test'] },
  });
  const replies: { root?: string; text: string }[] = [];
  const work = await openCollaboration(config, auth, async message => {
    replies.push({ root: message.channel.address.messageId, text: message.text });
    return 'sent';
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
  const input = { topic: 'recommendation', text: '帮我核对文案和小屏，需要改代码先说明', nonce: randomUUID() };
  const trigger = feishuTrigger({ message_id: 'om_consult', chat_id: 'oc_test', chat_type: 'group', sender_id: 'ou_product',
    sender_type: 'user', content: '/咨询 ' + input.text, create_time: String(Date.now()), mentions: [] }, 'ou_bot', 'app') as Trigger;
  const identity = { provider: 'feishu' as const, namespace: 'app', id: 'ou_product', label: 'product' };
  assert.throws(() => work.consultTopic('product', 'store', input, trigger), { status: 403 });
  assert.ok(work.proveAccount(work.accountProof('product', 'feishu').command.split(' ')[1]!, identity));
  work.confirmAccount('product', 'feishu', identity);
  trigger.at = new Date().toISOString();
  const batch = work.consultTopic('product', 'store', input, trigger);
  assert.equal(new Set(batch.tickets).size, 2);
  assert.deepEqual(work.consultTopic('product', 'store', input, trigger), batch);
  assert.ok(work.channelEventSeen(trigger.id));
  assert.throws(() => work.consultTopic('outsider', 'store', input), { status: 404 });
  assert.throws(() => work.consultTopic('product', 'store', { ...input, topic: 'other' }), { status: 409 });
  const web = { ...input, nonce: randomUUID(), agents: ['copy-agent'] };
  const webBatch = work.consultTopic('product', 'store', web);
  assert.deepEqual(work.consultTopic('product', 'store', web), webBatch);
  assert.throws(() => work.consultTopic('product', 'store', { ...web, text: '变更后的内容' }), { status: 409 });
  for (let step = 0; step < 65 && (replies.length < 2 || !work.detail('product', webBatch.tickets[0]!).result); step++) await delay(250);
  const conversation = work.conversation('engineer', 'store', { topic: input.topic });
  assert.equal(conversation.length, 2);
  const answers = conversation.find(row => row.id === batch.id)?.consultations;
  assert.deepEqual(answers?.map(item => [item.speaker.id, item.status, item.evidence?.map(ref => ref.id)]),
    [['copy-agent', 'answered', [material[0]]], ['wrap-agent', 'answered', [material[1]]]]);
  assert.equal(replies.length, 2);
  assert.ok(replies.every(reply => reply.root === 'om_consult'));
  assert.ok(replies.every(reply => wordCount(reply.text) <= IM_WORDS));
  assert.ok(replies.some(reply => /copy-agent[\s\S]*COPY_ONLY[\s\S]*现行文案口径/.test(reply.text) && !reply.text.includes('WRAP_ONLY')));
  assert.ok(replies.some(reply => /wrap-agent[\s\S]*WRAP_ONLY[\s\S]*已验收的小屏规则/.test(reply.text) && !reply.text.includes('COPY_ONLY')));
  for (const ticket of [...batch.tickets, ...webBatch.tickets]) {
    const item = work.detail('product', ticket);
    assert.equal(item.runs.length, 1);
    assert.equal(item.work.development, undefined);
    assert.equal(item.actions.accept, false);
    assert.ok(item.result);
    await assert.rejects(work.accept('product', ticket, item.result.revision, '', ''), { status: 409 });
  }
  assert.equal(work.needsYou('product').some(item => item.kind === 'acceptance'), false);
  const wantsChange = work.start('product', { project: 'store', topic: input.topic, title: '确需修改小屏', priority: 'normal',
    request: '经人决定后再调整小屏', nonce: randomUUID(), material: [], agent: 'wrap-agent',
    target: work.overview('product').projects[0]!.deliveryTargets[0]!.ref }, undefined, true);
  assert.ok(wantsChange.ticket);
  assert.ok(work.needsYou('engineer').some(item => item.ticket === wantsChange.ticket && item.kind === 'development'));
  assert.equal(work.detail('product', wantsChange.ticket).runs.length, 0);
  const original = work.browse('product', 'store', '').find(entry => entry.id === material[1]);
  assert.ok(original && 'revision' in original);
  work.invalidateKnowledge('product', original.id, original.revision, '规则失效');
  const withdrawn = work.conversation('engineer', 'store', { topic: input.topic })[0]?.consultations?.find(reply => reply.speaker.id === 'wrap-agent');
  assert.equal(withdrawn?.status, 'unavailable');
  assert.equal(withdrawn?.text, undefined);
});
