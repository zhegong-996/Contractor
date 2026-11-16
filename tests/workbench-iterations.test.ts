import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('原生工单带口径交接、阻塞接续、多版验收、成果重授权与研发接单隔离', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'suitme-iterations-'));
  process.env.COLLAB_STATE_DIR = dir;
  await mkdir(path.join(dir, 'console'));
  const fixture = path.join(dir, 'agent.mjs'), trace = path.join(dir, 'trace.jsonl');
  await writeFile(fixture, [
    "import {readFileSync,appendFileSync,existsSync,writeFileSync} from 'node:fs';",
    "const [trace,mode]=process.argv.slice(2);const c=JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT,'utf8'));",
    "const mark=event=>appendFileSync(trace,JSON.stringify({event,mode,context:c})+'\\n');mark('start');",
    "const confirmed=c.events.filter(e=>e.type==='task.confirmation');",
    "if(mode==='old'&&!confirmed.length) console.log('```agent-autoloop\\n'+JSON.stringify({ask:[{key:'criteria',title:'确认推荐理由口径',text:'是否按两句、先场景后事实？',options:['确认两句，先场景后事实','另行说明']}]})+'\\n```');",
    "else if(mode==='old') {process.on('SIGTERM',()=>{mark('stopping');setTimeout(()=>{mark('stopped');process.exit(0)},400)});mark('holding');setInterval(()=>{},100)}",
    "else if(mode==='new') {if(!confirmed.some(e=>JSON.parse(e.detail).answer==='确认两句，先场景后事实'))process.exit(8);console.log('交接后沿用已确认口径。')}",
    "else if(mode==='fail'&&!existsSync(trace+'.once')) {writeFileSync(trace+'.once','failed');process.exit(2)}",
    "else console.log('门店推荐理由：周五通勤可以试这件薄外套。门店有样衣。'+(c.events.find(e=>e.type==='task.continuation')?.detail??''));",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth(); await auth.ready(); await auth.bootstrapOwner('product', 'test-only-password');
  for (const name of ['engineering', 'replacement', 'resource']) await auth.createAccount(name, 'test-only-password', 'operator', 'product');
  const agent = (id: string, owner: string, mode: string) => ({ id, owner, title: id, function: 'review', projects: ['store'],
    kind: 'personal', execution: { kind: 'test', provider: 'fixture' }, engine: 'command', command: [process.execPath, fixture, trace, mode], capability: '核对门店理由', skill: '核对', active: true });
  const config = settingsSchema.parse({ projects: [{ id: 'store', title: '门店推荐理由',
    members: ['product', 'engineering', 'replacement', 'resource'], maintainers: ['product'],
    resources: [{ source: 'github', externalId: 'team/test', state: 'bound', contributors: ['engineering'],
      execution: { base: 'main', paths: ['collab-pilot/'] } }] }], functions: [{ id: 'review', title: '核对' }],
    attribution: { entireCommand: '/bin/true', checkouts: { 'team/test': '/not-launched-in-this-unit-test' } },
    agents: [agent('review', 'engineering', 'review'), agent('old', 'engineering', 'old'),
      agent('new', 'replacement', 'new'), agent('failure', 'engineering', 'fail'),
      { id: 'coder', title: '研发 Agent', owner: 'engineering', function: 'review', projects: ['store'], kind: 'personal',
        execution: { kind: 'test', provider: 'fixture' }, engine: 'codex', capability: '门店页面', skill: '仅测试路径', active: true }] });
  const work = await openCollaboration(config, auth);
  const db = new DatabaseSync(path.join(dir, 'orchestrator.sqlite'));
  t.after(async () => { db.close(); await work.close(); await rm(dir, { recursive: true, force: true }); });
  async function wait<T>(get: () => T | undefined | Promise<T | undefined>): Promise<T> {
    for (let i = 0; i < 160; i++) { const value = await get(); if (value) return value; await delay(100); }
    assert.fail('等待原生工单状态超时');
  }
  const detail = (id: string) => work.detail('product', id);
  const start = async (agent: string, material: string[] = []) => {
    const result = work.start('product', { project: 'store', agent, title: '门店推荐理由', request: '核对门店推荐理由',
      nonce: randomUUID(), material, priority: 'normal' });
    return wait(() => work.resolveStart('product', result.trigger) ?? undefined);
  };
  const assignments = (id: string) => JSON.parse(String(db.prepare('SELECT value FROM ticket WHERE id=?').get(id)!.value)).assignments.length;
  const traces = async () => (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));

  const handoff = await start('old');
  const question = await wait(() => detail(handoff).questions[0]);
  assert.throws(() => work.resume('product', handoff, { nonce: randomUUID(), version: 1, reason: '不能跳过问题' }), /必答/);
  work.reply('product', handoff, { card: question.id, choice: 0, nonce: 'criteria' });
  await wait(async () => (await traces()).find(row => row.event === 'holding'));
  work.handoff('product', handoff, { agent: 'new', reason: '另一个成员接续' });
  work.handoff('product', handoff, { agent: 'new', reason: '重试同一次交接' });
  await wait(() => detail(handoff).result);
  assert.equal(assignments(handoff), 2);
  const rows = await traces();
  assert.ok(rows.findIndex(row => row.event === 'stopped') < rows.findIndex(row => row.mode === 'new'));
  const confirmation = rows.find(row => row.mode === 'new').context.events.find((e: { type: string }) => e.type === 'task.confirmation');
  assert.equal(JSON.parse(confirmation.detail).by, 'product');
  assert.equal(JSON.parse(confirmation.detail).answer, '确认两句，先场景后事实');

  const blocked = await start('failure');
  const executionDb = new DatabaseSync(path.join(dir, 'autoloop/hub.db'), { readOnly: true });
  await wait(() => executionDb.prepare("SELECT id FROM runs WHERE lane=? AND state='queued' AND attempts>0").get(blocked));
  executionDb.close();
  const resume = { nonce: randomUUID(), version: 1, reason: '外部阻塞已排除，继续同一版' };
  work.resume('engineering', blocked, resume); work.resume('engineering', blocked, resume);
  await wait(() => detail(blocked).result);
  work.resume('engineering', blocked, resume);
  assert.equal(assignments(blocked), 2);
  assert.equal(detail(blocked).work.version, 1);

  const ticket = await start('review');
  const v1 = await wait(() => detail(ticket).result);
  // A source conversation can be subscribed by several tickets; rejecting one must not wake its neighbour.
  const shared = db.prepare("SELECT key,value FROM thread WHERE EXISTS (SELECT 1 FROM json_each(thread.value,'$.subscriptions') ref WHERE ref.value=?)").get(ticket)!;
  const sharedValue = JSON.parse(String(shared.value)); sharedValue.subscriptions.push(blocked);
  db.prepare('UPDATE thread SET value=? WHERE key=?').run(JSON.stringify(sharedValue), shared.key!);
  assert.throws(() => work.revise('engineering', ticket, { revision: v1.revision, reason: '越权打回' }), { status: 403 });
  assert.deepEqual(work.revise('product', ticket, { revision: v1.revision, reason: '第二句必须补充现场试穿' }), { version: 2 });
  assert.deepEqual(work.revise('product', ticket, { revision: v1.revision, reason: '重复打回' }), { version: 2 });
  await assert.rejects(work.accept('product', ticket, v1.revision, '', ''), { status: 409 });
  const v2 = await wait(() => detail(ticket).result?.version === 2 ? detail(ticket).result : undefined);
  assert.equal(assignments(ticket), 2);
  assert.equal(assignments(blocked), 2, '打回限定在指定工单，不能唤醒同话题的其他工单');
  assert.equal(detail(ticket).versions[0]!.reviews[0]!.kind, 'rejected');
  assert.equal(detail(ticket).versions[0]!.reviews[0]!.reason, '第二句必须补充现场试穿');
  await work.accept('product', ticket, v2.revision, '门店试点', '两句推荐理由');
  const candidate = detail(ticket).candidate!;
  const entry = work.browse('product', 'store', '').find(e => e.id === candidate)!;
  assert.ok('revision' in entry); work.publish('product', candidate, entry.revision!);
  assert.throws(() => work.revise('product', ticket, { revision: v2.revision, reason: '已验收不能打回' }), { status: 409 });
  work.revise('product', ticket, { revision: v2.revision, kind: 'continued', reason: '上线后反馈继续改进表达' });
  const v3 = await wait(() => detail(ticket).result?.version === 3 ? detail(ticket).result : undefined);
  assert.notEqual(v3.revision, v2.revision);
  assert.equal(detail(ticket).work.accepted, undefined);
  assert.ok(detail(ticket).versions.find(v => v.version === 2)!.reviews.some(r => r.kind === 'accepted'));
  assert.ok(work.browse('product', 'store', '').find(e => e.id === candidate), '已采用知识仍绑定第二版，不误指第三版');
  const context = (await traces()).findLast(row => row.context.events.some((e: { type: string; detail: string }) =>
    e.type === 'task.continuation' && e.detail.includes('上线后反馈'))).context;
  assert.ok(context.events.some((e: { type: string; detail: string }) => e.type === 'task.previous-output' && e.detail === v2.text));

  const restricted = work.addKnowledge('resource', 'store', { title: '受限门店样本', kind: 'document', body: '测试门店规则',
    conditions: '仅用于本次门店核对', visibility: 'restricted' });
  const expired = await start('review', [restricted]);
  const access = detail(expired).requests[0]!;
  work.changeAccess('resource', expired, access.id, 'granted');
  const old = await wait(() => detail(expired).result);
  // Time-bound expiry is a local clock fixture; live integration separately performs actual revoke/reapply.
  db.prepare('UPDATE workbench_access SET expires=0 WHERE id=?').run(access.id);
  assert.equal(detail(expired).result, undefined);
  assert.deepEqual(work.resume('product', expired, { nonce: randomUUID(), version: 1, reason: '继续查阅本版交付' }),
    { version: 1, waiting: 'review-access' });
  const review = detail(expired).requests.find(r => r.state === 'requested')!;
  assert.equal(review.purpose, 'review'); assert.equal(review.output, old.revision);
  assert.throws(() => work.changeAccess('engineering', expired, review.id, 'granted'), { status: 403 });
  work.changeAccess('resource', expired, review.id, 'granted');
  assert.equal(detail(expired).result?.revision, old.revision);
  assert.equal(detail(expired).runs.length, 1, '仅查阅旧成果不启动执行');
  const privateReason = '受限门店专用修订口径';
  work.revise('product', expired, { revision: old.revision, reason: privateReason });
  assert.equal(detail(expired).work.continuation?.reason, privateReason);
  assert.ok(detail(expired).history.some(item => item.text === privateReason));
  const unrelated = work.detail('replacement', expired);
  assert.equal(unrelated.work.continuation?.reason, undefined);
  assert.ok(!JSON.stringify(unrelated).includes(privateReason));
  assert.ok(!JSON.stringify(work.overview('replacement').tickets.find(item => item.id === expired)).includes(privateReason));
  await delay(1500);
  assert.equal(detail(expired).runs.filter(r => r.state !== 'queued').length, 1, '查阅许可不能作为执行许可');
  work.request('product', expired, restricted, '申请第二版执行权限');
  const execution = detail(expired).requests.find(r => r.state === 'requested' && r.purpose === 'execute')!;
  assert.ok(execution); assert.notEqual(execution.id, review.id);
  work.changeAccess('resource', expired, execution.id, 'granted');
  await wait(() => detail(expired).result?.version === 2 ? detail(expired).result : undefined);
  assert.equal(assignments(expired), 2);
  work.changeAccess('resource', expired, review.id, 'revoked');
  assert.equal(detail(expired).versions[0]!.text, undefined, '新执行批准不复活旧成果的读取许可');
  assert.equal(detail(expired).work.continuation?.reason, undefined);
  assert.ok(!detail(expired).history.some(item => item.text === privateReason));

  const target = work.overview('product').projects[0]!.deliveryTargets[0]!.ref;
  const sender = { provider: 'feishu' as const, namespace: 'app', id: 'ou_product', label: '产品' };
  assert.ok(work.proveAccount(work.accountProof('product', 'feishu').command.split(' ')[1]!, sender));
  work.confirmAccount('product', 'feishu', sender);
  const sourceId = randomUUID();
  const request = '委托研发修改门店页';
  const channel = { project: 'store', agent: 'coder', request, sender, origin: { key: 'feishu:' + sourceId, label: '产品原话题' },
    trigger: { id: sourceId, source: 'feishu' as const, actor: { source: 'feishu' as const, id: sender.id }, human: true,
      addressed: 'direct' as const, at: new Date().toISOString(), threads: [{ source: 'feishu' as const, id: sourceId }], text: request, meta: {} } };
  assert.equal(work.receiveChannel(channel).status, 'pending');
  assert.throws(() => work.resolveChannel('product', sourceId, { action: 'create', agent: 'coder', target: 'unknown' }), { status: 403 });
  const { ticket: code } = work.resolveChannel('product', sourceId, { action: 'create', agent: 'coder', target });
  assert.ok(code);
  assert.equal(work.receiveChannel(channel).status, 'duplicate');
  assert.equal(detail(code).work.development?.repository, 'team/test');
  assert.equal(detail(code).channelHistory[0]?.id, sourceId);
  const offer = work.needsYou('engineering').find(d => d.kind === 'development' && d.ticket === code)!;
  assert.ok(offer);
  assert.throws(() => work.approveDevelopment('product', code), { status: 403 });
  assert.equal(detail(code).runs.length, 0);
  await assert.rejects(work.linkDelivery('product', code, 'https://github.com/team/test/pull/1'), { status: 403 });
  await assert.rejects(work.linkBranch('product', code, 'https://github.com/team/test/tree/main'), { status: 403 });
  const declined = { offer: offer.id, response: 'decline' as const, reason: '本轮研发排期已满' };
  assert.throws(() => work.respondDevelopment('product', code, declined), { status: 403 });
  assert.deepEqual(work.respondDevelopment('engineering', code, declined), work.respondDevelopment('engineering', code, declined));
  assert.equal(work.needsYou('product').filter(d => d.kind === 'development-returned' && d.ticket === code).length, 1);
  assert.throws(() => work.approveDevelopment('engineering', code, offer.id), { status: 409 });
  assert.throws(() => work.resume('engineering', code, { nonce: randomUUID(), version: 1, reason: '尝试绕过退回状态' }), { status: 409 });
  assert.equal(assignments(code), 1);
  assert.equal(detail(code).runs.length, 0);

  const reoffer = { offer: offer.id, agent: 'coder', reason: '时间已协调，仍只改门店页' };
  assert.throws(() => work.reofferDevelopment('engineering', code, reoffer), { status: 403 });
  work.reofferDevelopment('product', code, reoffer);
  work.reofferDevelopment('product', code, reoffer);
  const second = work.needsYou('engineering').find(d => d.kind === 'development' && d.ticket === code)!;
  assert.notEqual(second.id, offer.id);
  assert.throws(() => work.approveDevelopment('engineering', code, offer.id), { status: 409 });
  const returned = { offer: second.id, response: 'return' as const, reason: '请明确试穿提示口径' };
  work.respondDevelopment('engineering', code, returned);
  assert.match(work.needsYou('product').find(d => d.kind === 'development-returned' && d.ticket === code)!.title, /退回/);
  work.reofferDevelopment('product', code, { ...reoffer, offer: second.id, reason: '只改两句推荐理由' });
  const third = work.needsYou('engineering').find(d => d.kind === 'development' && d.ticket === code)!;
  work.approveDevelopment('engineering', code, third.id);
  work.approveDevelopment('engineering', code, third.id);
  assert.equal(detail(code).report?.state, 'progress');
  // Never launch the real CLI in this unit fixture; real Codex delivery is exercised separately.
  work.setAgent('engineering', 'coder', false);
  assert.equal(detail(code).work.developmentApproval?.actor, 'engineering');
  assert.equal(detail(code).work.requester, 'product');
  assert.equal(assignments(code), 1);
  assert.ok(!work.needsYou('engineering').some(d => d.kind === 'development' && d.ticket === code));
});
