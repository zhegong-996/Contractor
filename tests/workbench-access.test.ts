import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { OutboundMessage } from '../upstream/superagent/src/core/index.ts';

const runtime = await mkdtemp(path.join(os.tmpdir(), 'suitme-access-flow-'));
process.env.COLLAB_STATE_DIR = runtime;
const [{ ProjectKnowledge, digest }, { openSuperAgentStore }] = await Promise.all([
  import('../src/workbench/knowledge.ts'), import('../src/superagent-ports.ts'),
]);

test('资料授权按 Agent 及所有者隔离，撤权和到期重申保留独立轮次，旧票据不可再批准', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'suitme-access-'));
  const store = await openSuperAgentStore(path.join(dir, 'store.sqlite'));
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  // Existing pilot databases have ticket-only grants. Preserve their audit history but fail closed.
  store.db.exec(`CREATE TABLE workbench_access (id TEXT PRIMARY KEY,ticket TEXT NOT NULL,entry TEXT NOT NULL,
    revision TEXT NOT NULL,requester TEXT NOT NULL,reason TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER,
    UNIQUE(ticket,entry,revision))`);
  const entryInput = { project: 'store', owner: 'owner', title: '门店反馈样本', kind: 'document', body: '受限内容',
    conditions: '试点门店', visibility: 'restricted' as const, state: 'published' as const, sources: [] };
  store.db.prepare('INSERT INTO workbench_access VALUES (?,?,?,?,?,?,?,?)')
    .run('legacy', 'ticket', 'store-reference', digest({ ...entryInput, id: 'store-reference' }), 'maker', '', 'granted', Date.now() + 60000);
  const knowledge = new ProjectKnowledge(store);
  const entry = knowledge.save(entryInput, 'store-reference');
  assert.equal(knowledge.requests('ticket')[0]?.id, 'legacy');
  assert.equal(knowledge.requests('ticket')[0]?.readerAgent, '');
  const reader = { agent: 'review', owner: 'maker' };
  assert.equal(knowledge.usable('ticket', entry, reader), false);
  const first = knowledge.request('ticket', entry, 'maker', '核对门店问题', reader);
  assert.equal(knowledge.request('ticket', entry, 'maker', '重复请求', reader).id, first.id);
  knowledge.change(first, 'granted');
  assert.equal(knowledge.usable('ticket', entry, reader), true);
  assert.equal(knowledge.usable('ticket', entry, { ...reader, agent: 'other' }), false);
  assert.equal(knowledge.usable('ticket', entry, { ...reader, owner: 'other' }), false);
  assert.equal(knowledge.usable('other-ticket', entry, reader), false);
  assert.equal(knowledge.usable('ticket', entry), false);
  knowledge.change(knowledge.requests('ticket').find(r => r.id === first.id)!, 'revoked');
  const second = knowledge.request('ticket', entry, 'maker', '需要重新核对', reader);
  assert.notEqual(second.id, first.id);
  assert.equal(second.generation, 2);
  assert.equal(knowledge.request('ticket', entry, 'maker', '重复请求', reader).id, second.id);
  assert.throws(() => knowledge.change(first, 'granted'), /状态已变化/);
  knowledge.change(second, 'granted');
  store.db.prepare('UPDATE workbench_access SET expires=0 WHERE id=?').run(second.id);
  assert.equal(knowledge.usable('ticket', entry, reader), false);
  const third = knowledge.request('ticket', entry, 'maker', '到期重申', reader);
  assert.equal(third.generation, 3);
  assert.notEqual(third.id, second.id);
  assert.deepEqual(knowledge.requests('ticket').filter(r => r.readerAgent).map(r => r.state), ['revoked', 'expired', 'requested']);
  knowledge.change(third, 'granted');
  assert.equal(knowledge.usable('ticket', entry, reader, second.id), false, '新批准不能恢复旧执行的授权代次');
  assert.equal(knowledge.usable('ticket', entry, reader, third.id), true);
});

test('原生执行交接先停旧进程，再等新读取方授权；撤权重申重新推送同一资料负责人', { timeout: 25000 }, async t => {
  const dir = runtime;
  await mkdir(path.join(dir, 'console'));
  const fixture = path.join(dir, 'agent.mjs');
  const marks = path.join(dir, 'marks');
  await writeFile(fixture, [
    "import {appendFileSync,readFileSync} from 'node:fs';",
    'const [marks, mode] = process.argv.slice(2);',
    "const context = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT, 'utf8'));",
    "if (!context.events.some(e => e.type === 'knowledge.source' && e.detail.includes('仅限试点门店'))) process.exit(5);",
    "const mark = text => appendFileSync(marks, text + '\\n');",
    "if (mode === 'old') { process.on('SIGTERM', () => {mark('old-stopping');setTimeout(() => {mark('old-stopped');process.exit(0)}, 1000)});mark('old-started');setInterval(() => {}, 200); }",
    'else if (mode === "ask" && context.answers.length < 2) console.log("```agent-autoloop\\n" + JSON.stringify({ask:[{title:"核对门店范围",text:"是否只做试点门店？",options:["是","否"],key:"scope"},{title:"核对验收口径",text:"是否按两行说明验收？",options:["是","否"],key:"acceptance"}]}) + "\\n```");',
    "else { if(mode !== 'ask') mark('new-started');console.log('门店推荐理由核对完成'); }",
  ].join('\n'));
  process.env.COLLAB_STATE_DIR = dir;
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('owner', 'only-for-unit-test');
  for (const user of ['requester', 'maker', 'replacement']) await auth.createAccount(user, 'only-for-unit-test', 'operator', 'owner');
  const agent = (id: string, owner: string, mode: string) => ({ id, title: id, owner, projects: ['store'], kind: 'personal',
    execution: { kind: 'test', provider: 'fixture' }, engine: 'command', command: [process.execPath, fixture, marks, mode], function: 'verification', active: true,
    capability: '门店推荐理由核对', skill: '核对授权资料' });
  const config = settingsSchema.parse({ feishu: { appId: 'app', botId: 'bot', profile: 'test' }, crossChannel: {},
    projects: [{ id: 'store', title: '门店推荐理由', members: ['owner', 'requester', 'maker', 'replacement'], maintainers: ['owner'],
      dispatch: [{ function: 'verification', agent: 'old-reader' }] }],
    functions: [{ id: 'verification', title: '问题核对' }],
    agents: [agent('old-reader', 'maker', 'old'), agent('new-reader', 'replacement', 'new'), agent('ask-reader', 'maker', 'ask')] });
  const messages: OutboundMessage[] = [];
  const work = await openCollaboration(config, auth, async message => { messages.push(message); return 'sent'; });
  t.after(async () => { await work.close(); await rm(dir, { recursive: true, force: true }); });
  const account = { provider: 'feishu' as const, namespace: 'app', id: 'ou_owner', label: 'owner' };
  work.proveAccount(work.accountProof('owner', 'feishu').command.split(' ')[1]!, account);
  work.confirmAccount('owner', 'feishu', account);
  const wait = async <T>(fn: () => T | undefined | Promise<T | undefined>) => {
    for (let i = 0; i < 150; i++) { const value = await fn(); if (value) return value; await delay(100); }
    assert.fail('等待授权或执行状态超时');
  };
  const record = () => readFile(marks, 'utf8').catch(() => '');
  const entry = work.addKnowledge('owner', 'store', { title: '门店反馈样本', kind: 'document', body: '仅限试点门店',
    conditions: '不能跨项目传播', visibility: 'restricted' });
  const started = work.start('requester', { project: 'store', agent: 'old-reader', title: '核对推荐理由', request: '按样本核对',
    nonce: randomUUID(), material: [entry], priority: 'normal' });
  const ticket = await wait(() => work.resolveStart('requester', started.trigger) ?? undefined);
  const first = await wait(() => work.needsYou('owner').find(d => d.kind === 'access' && d.notification === 'sent'));
  assert.equal((await record()), '');
  const original = work.detail('owner', ticket).requests.find(r => r.id === first.subject)!;
  assert.equal(original.readerAgent, 'old-reader');
  assert.equal(original.readerOwner, 'maker');
  assert.throws(() => work.changeAccess('requester', ticket, original.id, 'granted'), { status: 403 });
  work.changeAccess('owner', ticket, original.id, 'granted');
  // Revoke synchronously before the worker receives the newly released assignment.
  work.changeAccess('owner', ticket, original.id, 'revoked');
  work.request('requester', ticket, entry, '补充确认后再次申请');
  work.request('requester', ticket, entry, '同轮请求重试');
  const renewed = await wait(() => work.needsYou('owner').find(d => d.kind === 'access' && d.id !== first.id && d.notification === 'sent'));
  assert.equal(work.needsYou('owner').filter(d => d.kind === 'access').length, 1);
  assert.throws(() => work.changeAccess('owner', ticket, original.id, 'granted'), { status: 409 });
  assert.equal(messages.filter(m => m.channel.address.decision === renewed.id).length, 1);
  work.changeAccess('owner', ticket, renewed.subject, 'granted');
  await wait(async () => (await record()).includes('old-started') || undefined);
  work.changeAccess('owner', ticket, renewed.subject, 'revoked');
  work.request('requester', ticket, entry, '运行中撤权后的重新申请');
  const runningRenewal = work.needsYou('owner').find(d => d.kind === 'access')!;
  assert.ok(runningRenewal);
  work.changeAccess('owner', ticket, runningRenewal.subject, 'granted');
  assert.equal((await record()).match(/old-started/g)?.length, 1, '立即重新批准也必须等旧进程退出');
  await wait(async () => (await record()).match(/old-started/g)?.length === 2 || undefined);
  assert.deepEqual((await record()).trim().split('\n'), ['old-started', 'old-stopping', 'old-stopped', 'old-started']);
  const database = new DatabaseSync(path.join(dir, 'orchestrator.sqlite'), { readOnly: true });
  const manifests = database.prepare('SELECT value FROM workbench_manifest ORDER BY run').all().map(r => JSON.parse(String(r.value)));
  database.close();
  assert.equal(manifests[0].sources[0].access, renewed.subject);
  assert.equal(manifests[1].sources[0].access, runningRenewal.subject);
  assert.equal(work.detail('requester', ticket).runs[0]?.state, 'cancelled');
  assert.equal(work.detail('requester', ticket).result, undefined, '旧代次回执不能变成成果');
  work.handoff('owner', ticket, { agent: 'new-reader', reason: '由另一个成员接续核对' });
  await wait(async () => (await record()).match(/old-stopping/g)?.length === 2 || undefined);
  assert.equal(work.needsYou('owner').filter(d => d.kind === 'access').length, 0);
  const replacement = await wait(() => work.needsYou('owner').find(d => d.kind === 'access' && d.notification === 'sent'));
  assert.ok((await record()).includes('old-stopped'));
  assert.ok(!(await record()).includes('new-started'));
  const newRequest = work.detail('owner', ticket).requests.find(r => r.id === replacement.subject)!;
  assert.equal(newRequest.readerAgent, 'new-reader');
  assert.equal(newRequest.readerOwner, 'replacement');
  assert.equal(work.detail('requester', ticket).work.agent, 'old-reader');
  work.changeAccess('owner', ticket, newRequest.id, 'granted');
  await wait(() => work.detail('requester', ticket).result);
  assert.deepEqual((await record()).trim().split('\n'), ['old-started', 'old-stopping', 'old-stopped', 'old-started', 'old-stopping', 'old-stopped', 'new-started']);
  assert.equal(work.detail('requester', ticket).work.agent, 'new-reader');

  const askStart = work.start('requester', { project: 'store', agent: 'ask-reader', title: '确认门店验收范围', request: '确认门店和口径',
    nonce: randomUUID(), material: [entry], priority: 'normal' });
  const asking = await wait(() => work.resolveStart('requester', askStart.trigger) ?? undefined);
  const askAccess = work.detail('owner', asking).requests.find(r => r.state === 'requested')!;
  work.changeAccess('owner', asking, askAccess.id, 'granted');
  const questions = await wait(() => {
    const questions = work.detail('requester', asking).questions;
    return questions.length === 2 ? questions : undefined;
  });
  assert.ok(!JSON.stringify(work.detail('replacement', asking)).includes(questions[0]!.title),
    '受限问题的标题也不能从 Report.question 向其他项目成员泄露');
  work.changeAccess('owner', asking, askAccess.id, 'revoked');
  assert.ok(!JSON.stringify(work.detail('requester', asking)).includes(questions[0]!.title),
    '撤权后报告中的旧问题也要隐藏');
  work.request('requester', asking, entry, '保持未答问题重新申请');
  const askRenewal = work.detail('owner', asking).requests.find(r => r.state === 'requested')!;
  work.changeAccess('owner', asking, askRenewal.id, 'granted');
  await wait(() => work.detail('requester', asking).work.handoff?.completedAt);
  assert.deepEqual(work.detail('requester', asking).questions.map(q => q.id), questions.map(q => q.id), '重新授权不关闭或替换原必答问题');
  work.reply('requester', asking, { card: questions[0]!.id, choice: 0, nonce: 'scope' });
  await wait(() => work.detail('requester', asking).questions.length === 1 || undefined);
  await delay(1400);
  assert.equal(work.detail('requester', asking).runs.filter(run => run.state === 'done').length, 1);
  assert.equal(work.detail('requester', asking).result, undefined);
  work.reply('requester', asking, { card: questions[1]!.id, choice: 0, nonce: 'acceptance' });
  await wait(() => work.detail('requester', asking).result);
  assert.equal(work.detail('requester', asking).runs.filter(run => run.state === 'done').length, 2);

  // Restoring one document must not mask a second document whose grant expired meanwhile.
  const makerAccount = { ...account, id: 'ou_maker', label: 'maker' };
  work.proveAccount(work.accountProof('maker', 'feishu').command.split(' ')[1]!, makerAccount);
  work.confirmAccount('maker', 'feishu', makerAccount);
  const secondEntry = work.addKnowledge('maker', 'store', { title: '推荐理由验收口径', kind: 'document',
    body: '仅限试点门店，两行说明', conditions: '与门店样本分别授权', visibility: 'restricted' });
  const dualStart = work.start('requester', { project: 'store', agent: 'ask-reader', title: '双资料恢复', request: '分别核对样本与口径',
    nonce: randomUUID(), material: [entry, secondEntry], priority: 'normal' });
  const dual = await wait(() => work.resolveStart('requester', dualStart.trigger) ?? undefined);
  const dualRequests = work.detail('requester', dual).requests;
  const sampleRequest = dualRequests.find(r => r.entry === entry)!;
  const criteriaRequest = dualRequests.find(r => r.entry === secondEntry)!;
  work.changeAccess('owner', dual, sampleRequest.id, 'granted');
  work.changeAccess('maker', dual, criteriaRequest.id, 'granted');
  const dualQuestions = await wait(() => work.detail('requester', dual).questions.length === 2
    ? work.detail('requester', dual).questions : undefined);
  work.changeAccess('owner', dual, sampleRequest.id, 'revoked');
  assert.deepEqual(work.detail('requester', dual).work.handoff?.accessRequests, { [entry]: sampleRequest.id },
    '恢复计划只记录实际触发撤权的资料，不能拿一张申请代表全部资料');
  const expiry = new DatabaseSync(path.join(dir, 'orchestrator.sqlite'));
  expiry.prepare('UPDATE workbench_access SET expires=0 WHERE id=?').run(criteriaRequest.id);
  expiry.close();
  work.request('requester', dual, entry, '重新核对样本');
  const sampleRenewal = await wait(() => work.needsYou('owner').find(d => d.ticket === dual && d.kind === 'access' && d.notification === 'sent'));
  work.changeAccess('owner', dual, sampleRenewal.subject, 'granted');
  const criteriaRenewal = await wait(() => work.needsYou('maker').find(d => d.ticket === dual && d.kind === 'access' && d.notification === 'sent'));
  assert.notEqual(criteriaRenewal.subject, sampleRenewal.subject);
  assert.notEqual(criteriaRenewal.subject, criteriaRequest.id);
  const newCriteria = work.detail('maker', dual).requests.find(r => r.id === criteriaRenewal.subject)!;
  assert.equal(newCriteria.entry, secondEntry);
  assert.equal(newCriteria.generation, 2);
  assert.equal(newCriteria.readerAgent, 'ask-reader');
  assert.equal(work.detail('requester', dual).work.handoff?.completedAt, undefined,
    '只批准第一份资料不能恢复需要两份资料的执行');
  work.request('requester', dual, secondEntry, '重复申请第二份资料');
  work.request('requester', dual, secondEntry, '再次重试第二份资料');
  await delay(600);
  assert.equal(messages.filter(m => m.channel.address.decision === criteriaRenewal.id).length, 1);
  assert.throws(() => work.changeAccess('owner', dual, criteriaRenewal.subject, 'granted'), { status: 403 });
  work.changeAccess('maker', dual, criteriaRenewal.subject, 'granted');
  await wait(() => work.detail('requester', dual).work.handoff?.completedAt);
  assert.deepEqual(work.detail('requester', dual).work.handoff?.accessRequests,
    { [entry]: sampleRenewal.subject, [secondEntry]: criteriaRenewal.subject });
  assert.deepEqual(work.detail('requester', dual).questions.map(q => q.id), dualQuestions.map(q => q.id));
  work.reply('requester', dual, { card: dualQuestions[0]!.id, choice: 0, nonce: 'dual-scope' });
  work.reply('requester', dual, { card: dualQuestions[1]!.id, choice: 0, nonce: 'dual-acceptance' });
  await wait(() => work.detail('requester', dual).result);
  assert.equal(work.detail('requester', dual).runs.filter(run => run.state === 'done').length, 2);
});
