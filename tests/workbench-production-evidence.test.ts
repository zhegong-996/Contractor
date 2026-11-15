import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { unpricedAttempts } from '../src/workbench/execution-evidence.ts';

test('重试尚未装配时，上一尝试丢失的费用回执仍算未知', () => {
  assert.equal(unpricedAttempts([1], [], 2), 1);
  assert.equal(unpricedAttempts([1, 2], [], 2), 1);
  assert.equal(unpricedAttempts([1, 2], [{ attempt: 2, usage: { cost: 0.25 } }]), 1,
    '新一轮报价不能补齐上一轮丢失的回执');
  assert.equal(unpricedAttempts([1, 2], [{ attempt: 1, usage: { input: 10 } }], 2), 1);
  assert.equal(unpricedAttempts([1], [], 1), 0, '当前正在执行的一轮在未返回前不虚记为历史缺价');
});

test('装配可复核、决策知识先审后用、撤权隐藏快照和候选、取消计费与预算缺价阻断', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'suitme-production-evidence-'));
  process.env.COLLAB_STATE_DIR = dir;
  await mkdir(path.join(dir, 'console'));
  const fixture = path.join(dir, 'agent.mjs'), trace = path.join(dir, 'trace.jsonl'), meter = path.join(dir, 'meter.json');
  await writeFile(meter, JSON.stringify({ input: 7, output: 3, cost: 0.25 }));
  await writeFile(fixture, [
    "import { readFileSync,appendFileSync } from 'node:fs';",
    "const context=JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT,'utf8'));",
    "appendFileSync(process.argv[2],JSON.stringify(context)+'\\n');",
    "const text=context.events.find(e=>e.type==='task.request').detail;",
    "if(text.includes('等待停止')) {console.log('受控测试已启动');process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},100)}",
    "else if(text.includes('确认口径')&&!context.answers.length) console.log('需要确认\\n```agent-autoloop\\n'+JSON.stringify({ask:[{key:'criteria',title:'推荐理由先写什么？',text:'门店反馈需要明确两句的顺序。',options:['先场景后事实','先事实后场景']}]})+'\\n```');",
    "else console.log('门店推荐理由按两句表达，先写通勤场景，再写现场试穿事实。');",
  ].join('\n'));
  // A trusted test adapter supplies usage; it is not a real provider's price report.
  const plugin = path.join(dir, 'autoloop/plugins/command'); await mkdir(plugin, { recursive: true });
  const upstream = pathToFileURL(path.resolve('upstream/autoloop/plugins/command/agent.ts')).href;
  await writeFile(path.join(plugin, 'agent.ts'), `import base from ${JSON.stringify(upstream)};
    import {readFileSync} from 'node:fs';
    export default {...base,read(stdout,code,stderr){return {...base.read(stdout,code,stderr),
      ...(!stdout?{}:{usage:JSON.parse(readFileSync(${JSON.stringify(meter)},'utf8'))})}}};`);
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { digest }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'), import('../src/workbench/knowledge.ts'),
  ]);
  const auth = new ConsoleAuth(); await auth.ready(); await auth.bootstrapOwner('product', 'test-only-password');
  for (const person of ['engineering', 'observer', 'source-owner', 'outsider'])
    await auth.createAccount(person, 'test-only-password', 'operator', 'product');
  const config = settingsSchema.parse({ projects: ['store', 'unpriced', 'cancelled'].map(id => ({ id, title: id,
    members: ['product', 'engineering', 'observer', 'source-owner'], maintainers: ['product'], budget: id === 'unpriced' ? 10 : 1 })),
    functions: [{ id: 'review', title: '核对' }], agents: [{ id: 'reviewer', title: '研发的核对 Agent', kind: 'personal',
      owner: 'engineering', projects: ['store', 'unpriced', 'cancelled'], function: 'review', engine: 'command',
      command: [process.execPath, fixture, trace], model: 'configured-test-model', capability: '核对门店推荐理由', skill: '只核对已授权的门店资料', active: true }] });
  const work = await openCollaboration(config, auth);
  const db = new DatabaseSync(path.join(dir, 'orchestrator.sqlite'));
  t.after(async () => { db.close(); await work.close(); await rm(dir, { recursive: true, force: true }); });
  async function wait<T>(read: () => T | undefined | Promise<T | undefined>): Promise<T> {
    for (let i = 0; i < 180; i++) { const value = await read(); if (value) return value; await delay(100); }
    assert.fail('等待生产能力回归状态超时');
  }
  const start = async (project: string, request: string, material: string[] = []) => {
    const result = work.start('product', { project, request, title: request, material, nonce: randomUUID(), agent: 'reviewer', priority: 'normal' });
    return wait(() => work.resolveStart('product', result.trigger) ?? undefined);
  };
  const id = await start('store', '确认口径后整理门店推荐理由');
  const question = await wait(() => work.detail('product', id).questions[0]);
  work.reply('product', id, { card: question.id, choice: 0, nonce: randomUUID() });
  const output = await wait(() => work.detail('product', id).result);
  const snapshot = work.executionSnapshot('product', id, output.run);
  assert.equal(snapshot.recorded, true); assert.equal(snapshot.readable, true);
  assert.ok(snapshot.policyVersion);
  assert.equal(digest(snapshot.contents!.context), snapshot.assembly!.context);
  const recorded = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1);
  assert.deepEqual(snapshot.contents!.context, recorded, '快照必须是 worker 实际收到的装配上下文');
  assert.equal(snapshot.contents!.runtime.model, 'configured-test-model');
  assert.equal('command' in snapshot.contents!.runtime, false, '命令参数不向查询者暴露');
  const skill = config.agents[0]!.skill; config.agents[0]!.skill = '本机配置已变';
  assert.ok(work.executionSnapshot('product', id, output.run).contents!.skill.prompt.startsWith(skill));
  config.agents[0]!.skill = skill;
  assert.throws(() => work.executionSnapshot('outsider', id, output.run), { status: 404 });
  const packed = db.prepare('SELECT value FROM workbench_execution_pack WHERE hash=?').get(snapshot.assembly!.context)!;
  db.prepare('UPDATE workbench_execution_pack SET value=? WHERE hash=?').run('{}', snapshot.assembly!.context);
  assert.throws(() => work.executionSnapshot('product', id, output.run), /校验失败/);
  db.prepare('UPDATE workbench_execution_pack SET value=? WHERE hash=?').run(packed.value!, snapshot.assembly!.context);
  await work.accept('product', id, output.revision, '', '');
  const candidateId = work.detail('product', id).candidate!;
  const candidate = work.browse('product', 'store', '').find(item => item.id === candidateId)!;
  assert.ok('revision' in candidate && 'draft' in candidate);
  assert.equal(candidate.draft?.needsReview, true);
  assert.equal(candidate.canPublish, false);
  assert.ok(candidate.body!.includes('先场景后事实'));
  assert.deepEqual(candidate.draft?.cards, [question.id]);
  assert.ok(!work.browse('engineering', 'store', '先场景后事实').some(item => item.id === candidateId));
  assert.throws(() => work.publish('product', candidateId, candidate.revision!), { status: 409 });
  assert.throws(() => work.reviewKnowledge('engineering', candidateId,
    { revision: candidate.revision!, body: '越权改写', conditions: '任意场景' }), { status: 403 });
  const reviewed = work.reviewKnowledge('product', candidateId, { revision: candidate.revision!, body: '先场景后事实，第二句提供试穿事实。',
    conditions: '仅用于本次测试门店的两句推荐理由，其他类型需重新核对。' });
  assert.notEqual(reviewed.revision, candidate.revision);
  assert.throws(() => work.publish('product', candidateId, candidate.revision!), { status: 409 });
  work.publish('product', candidateId, reviewed.revision);
  assert.ok(work.browse('engineering', 'store', '先场景后事实').some(item => item.id === candidateId));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workbench_knowledge_revision WHERE entry=?').get(candidateId)!.n, 2);
  const usage = work.projectUsage('product', 'store');
  assert.equal(usage.cost, 0.5); assert.equal(usage.unpriced, 0); assert.equal(usage.attempts.length, 2);
  assert.ok(usage.attempts.every(receipt => receipt.owner === 'engineering' && receipt.delegatedBy === 'product' && receipt.function === 'review'));

  const entry = work.addKnowledge('source-owner', 'store', { title: '受限门店样本', kind: 'reference', body: '只有门店试点可见的事实',
    conditions: '试点限定', visibility: 'restricted' });
  const restricted = await start('store', '核对受限门店资料', [entry]);
  const grant = work.detail('source-owner', restricted).requests[0]!;
  work.changeAccess('source-owner', restricted, grant.id, 'granted');
  const result = await wait(() => work.detail('product', restricted).result);
  assert.equal(work.executionSnapshot('observer', restricted, result.run).contents, undefined);
  assert.equal(work.executionSnapshot('product', restricted, result.run).readable, true);
  await work.accept('product', restricted, result.revision, '', '');
  const secretCandidate = work.detail('product', restricted).candidate!;
  const secretDraft = work.browse('product', 'store', '').find(item => item.id === secretCandidate)!;
  assert.ok('revision' in secretDraft);
  const secretReviewed = work.reviewKnowledge('product', secretCandidate, { revision: secretDraft.revision!, body: '确认过的门店判断', conditions: '只在该门店复用' });
  work.publish('product', secretCandidate, secretReviewed.revision);
  work.changeAccess('source-owner', restricted, grant.id, 'revoked');
  assert.equal(work.executionSnapshot('product', restricted, result.run).contents, undefined);
  assert.ok(!work.browse('product', 'store', '').some(item => item.id === secretCandidate));
  assert.throws(() => work.start('product', { project: 'store', title: '拒绝引用撤权知识', request: '检查',
    nonce: randomUUID(), material: [secretCandidate], priority: 'normal', agent: 'reviewer' }), /资料已失效/);

  const cancelled = await start('cancelled', '等待停止，验证取消也计量');
  await wait(() => work.detail('product', cancelled).runs.some(run => run.state === 'claimed') || undefined);
  await wait(async () => (await readFile(trace, 'utf8')).includes('等待停止') || undefined);
  work.stop('product', cancelled);
  await wait(() => work.detail('product', cancelled).runs.every(run => run.state === 'cancelled') || undefined);
  assert.equal(work.projectUsage('product', 'cancelled').cost, 0.25, '取消后已发生的消耗必须保留');
  assert.equal(work.projectUsage('product', 'cancelled').attempts.length, 1);

  await writeFile(meter, JSON.stringify({ input: 7, output: 3 }));
  const unpriced = await start('unpriced', '未报价的推荐理由核对');
  await wait(() => work.detail('product', unpriced).result);
  assert.equal(work.projectUsage('product', 'unpriced').unpriced, 1);
  const held = await start('unpriced', '费用不明时不能继续执行');
  await wait(() => work.detail('product', held).report?.state === 'blocked' || undefined);
  assert.match(work.detail('product', held).report!.summary, /费用/);
  assert.ok(!(await readFile(trace, 'utf8')).includes('费用不明时不能继续执行'));
  assert.equal(work.projectUsage('product', 'unpriced').attempts.length, 1, '预检阻断不伪造费用回执');
  assert.ok(work.needsYou('product').some(item => item.ticket === held && item.kind === 'blocked'));
});
