import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

test('远端重领沿用本轮租约，换端只在匹配的停机回执后派出', { timeout: 20000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-remote-runner-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'));
  const fixture = path.join(state, 'output.mjs');
  await writeFile(fixture, 'console.log("建议在推荐理由中写具体穿着场景。");\n');
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'fixture-password-only');
  for (const name of ['engineering', 'outsider']) await auth.createAccount(name, 'fixture-password-only', 'operator', 'product');
  const config = settingsSchema.parse({
    executionRuntime: process.env.CONTRACTOR_TEST_EXECUTION === 'contractor' ? 'contractor' : 'autoloop',
    remoteRunnerPort: 4339,
    projects: [{
      id: 'store', title: '门店推荐理由', members: ['product', 'engineering'], maintainers: ['product'],
      dispatch: [{ function: 'review', agent: 'claude' }],
    }, { id: 'other', title: '别的项目', members: ['outsider'], maintainers: ['outsider'] }],
    functions: [{ id: 'review', title: '核对推荐理由' }],
    agents: [{
      id: 'claude', owner: 'engineering', projects: ['store'], title: '研发 Claude', kind: 'personal', function: 'review',
      engine: 'claude', model: 'claude-model', execution: { kind: 'remote', provider: 'ollama' },
      active: true, capability: '核对推荐理由', skill: '读取工单认可的资料。',
    }, {
      id: 'replacement', owner: 'product', projects: ['store'], title: '接续 Agent', kind: 'specialist', function: 'review',
      engine: 'command', command: [process.execPath, fixture], execution: { kind: 'test', provider: 'fixture' },
      active: true, capability: '核对推荐理由', skill: '读取工单认可的资料。',
    }],
  });
  const work = await openCollaboration(config, auth);
  t.after(async () => {
    await work.close();
    await rm(state, { recursive: true, force: true });
  });
  async function wait<T>(read: () => T | undefined | Promise<T | undefined>, condition: string) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const value = await read();
      if (value !== undefined) return value;
      await delay(60);
    }
    assert.fail(condition);
  }
  assert.throws(() => work.issueDevicePair('product', 'store', 'claude', true), { status: 403 });
  assert.throws(() => work.projectDevices('outsider', 'store'), { status: 404 });
  const issue = () => work.issueDevicePair('engineering', 'store', 'claude', true).code;
  const code = issue();
  assert.throws(() => work.pairDevice(code, '错误通道'), { status: 403 });
  const remote = work.pairDevice(code, '研发笔记本', true);
  const other = work.pairDevice(issue(), '备用远程端', true);
  assert.throws(() => work.pairDevice(code, '重复配对', true), { status: 403 });
  const poll = (running: number[] = []) => ({ claim: randomUUID(), capacity: !running.length, wait: 0, running });
  await assert.rejects(work.deviceWork(remote.token, poll()), { status: 403 });
  await work.deviceWork(remote.token, poll(), true);
  work.setBudget('product', { kind: 'execution', subject: 'store' }, 'day', 2);
  const started = work.start('product', { project: 'store', title: '门店推荐理由', request: '核对穿着场景', agent: 'auto',
    nonce: randomUUID(), material: [], priority: 'normal' });
  const id = await wait(() => work.resolveStart('product', started.trigger) ?? undefined, '平台按规则建立工单');
  const old = await wait(async () => (await work.deviceWork(remote.token, poll(), true)).job ?? undefined, '远端接单');
  assert.equal(old.agent.id, 'claude');
  assert.equal(old.agent.command, undefined);
  assert.equal(old.rule.cwd, '.');
  assert.equal(old.session, null);
  assert.ok(old.remote?.authority);
  assert.ok(JSON.stringify((await work.deviceWork(remote.token, poll(), true)).job) === JSON.stringify(old),
    '换领活请求 ID 仍领回原租约');
  assert.equal((await work.deviceWork(other.token, poll(), true)).job, undefined);

  work.handoff('product', id, { agent: 'replacement', reason: '远端失联，由原工单恢复' });
  work.transitionDevice('engineering', remote.id, 'lost');
  assert.equal(work.projectDevices('engineering', 'store').find(d => d.id === remote.id)?.state, 'lost');
  assert.ok(work.needsYou('engineering').some(d => d.kind === 'blocked' && d.ticket === id), '失联端所有者收到恢复决定');
  assert.throws(() => work.transitionDevice('product', remote.id, 'active'), { status: 403 });
  const stopping = await wait(async () => {
    const response = await work.deviceWork(remote.token, poll([old.run]), true);
    return response.cancel?.includes(old.run) ? response : undefined;
  }, '旧端收到取消');
  assert.equal(stopping.job, undefined);
  assert.equal(work.detail('product', id).work.handoff?.completedAt, undefined);
  assert.equal(work.detail('product', id).runs.length, 1);
  const receipt = { outcome: 'cancelled', summary: '已退出', usage: { input: 19, output: 1 } };
  const stop = { attempt: old.attempt, state: 'exited' } as const;
  await assert.rejects(work.deviceResult(remote.token, old.run, old.token, receipt, true), { status: 409 });
  await assert.rejects(work.deviceResult(remote.token, old.run, old.token, receipt, true, { ...stop, usageCoverage: 'partial' }), { status: 403 });
  await assert.rejects(work.deviceResult(other.token, old.run, old.token, receipt, true, stop), { status: 403 });
  await assert.rejects(work.deviceResult(remote.token, old.run, 'wrong-lease', receipt, true, stop), { status: 403 });
  assert.equal(work.detail('product', id).work.handoff?.completedAt, undefined);
  const db = new DatabaseSync(path.join(state, 'orchestrator.sqlite'));
  try {
    db.exec('CREATE TRIGGER fail_settlement BEFORE UPDATE ON workbench_budget_charge WHEN OLD.run=' + old.run
      + " BEGIN SELECT RAISE(ABORT, 'test receipt interruption'); END");
    await assert.rejects(work.deviceResult(remote.token, old.run, old.token, receipt, true, stop), /test receipt interruption/);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_settlement');
    db.close();
  }
  assert.equal(work.budgetPools('product', 'store').find(pool => pool.kind === 'execution')?.pending, 1);
  await work.deviceResult(remote.token, old.run, old.token, receipt, true, stop);
  await work.deviceResult(remote.token, old.run, old.token, receipt, true, stop);
  await assert.rejects(work.deviceResult(remote.token, old.run, old.token, { ...receipt, summary: '篡改' }, true, stop), { status: 403 });
  const output = await wait(() => work.detail('product', id).result, '接替 Agent 成果');
  const after = work.detail('product', id);
  assert.notEqual(output.run, old.run);
  assert.equal(after.work.agent, 'replacement');
  assert.equal(after.runs.length, 2);
  assert.equal(after.runs.find(run => run.id === old.run)?.state, 'cancelled');
  assert.ok(after.work.handoff?.completedAt);
  const balance = work.budgetPools('product', 'store').find(pool => pool.kind === 'execution');
  assert.equal(balance?.used, 2);
  assert.equal(balance?.pending, 0);
  assert.equal(balance?.tokens, 20);

  work.transitionDevice('engineering', remote.id, 'active');
  work.setBudget('product', { kind: 'execution', subject: 'store' }, 'day', 5);
  const followup = work.start('product', { project: 'store', title: '核对门店小屏验收', request: '列出三档视口和验收依据', agent: 'auto',
    nonce: randomUUID(), material: [], priority: 'normal', device: remote.id });
  const readonly = await wait(() => work.resolveStart('product', followup.trigger) ?? undefined, '只读工单已建立');
  const job = await wait(async () => (await work.deviceWork(remote.token, poll(), true)).job ?? undefined, '只读工单已派出');
  assert.match(job.rule.prompt!, /contractor\.work-result/);
  const body = '## 验收条件\n- 280px、320px、360px 均无横向溢出。\n- [验收出处](https://example.com/check)';
  const complete = { outcome: 'done', summary: '已核对', events: [{ id: 'work-result', type: 'contractor.work-result', detail: body }] };
  const completed = { attempt: job.attempt, state: 'exited' } as const;
  await work.deviceResult(remote.token, job.run, job.token, complete, true, completed);
  await work.deviceResult(remote.token, job.run, job.token, complete, true, completed);
  const full = await wait(() => work.detail('product', readonly).result, '完整正文已入工单');
  assert.equal(full.text, body);
  assert.equal(work.detail('product', readonly).runs.length, 1);

  const missing = work.start('product', { project: 'store', title: '核对换行正文', request: '请逐项说明换行结果', agent: 'auto',
    nonce: randomUUID(), material: [], priority: 'normal', device: remote.id });
  const missingId = await wait(() => work.resolveStart('product', missing.trigger) ?? undefined, '待恢复的只读工单已建立');
  const short = await wait(async () => (await work.deviceWork(remote.token, poll(), true)).job ?? undefined, '待恢复工单已派出');
  await work.deviceResult(remote.token, short.run, short.token, { outcome: 'done', summary: '只有概括' }, true,
    { attempt: short.attempt, state: 'exited' });
  await wait(() => work.detail('product', missingId).recovery?.kind === 'result-incomplete' ? true : undefined, '缺正文时应可恢复');
  assert.equal(work.detail('product', missingId).result, undefined);

  const current = work.projectDeviceRoutes('product', 'store').find(row => row.agent === 'claude')!;
  const route = { agent: 'claude', revision: current.revision, primary: remote.id, fallback: other.id };
  assert.throws(() => work.setProjectDeviceRoute('engineering', 'store', route), { status: 403 });
  assert.throws(() => work.setProjectDeviceRoute('outsider', 'store', route), { status: 404 });
  assert.throws(() => work.setProjectDeviceRoute('product', 'store', { ...route, agent: 'replacement' }), { status: 409 });
  work.setProjectDeviceRoute('product', 'store', route);
  assert.throws(() => work.setProjectDeviceRoute('product', 'store', route), { status: 409 });
  await work.deviceWork(remote.token, poll(), true);
  assert.equal(work.projectDeviceRoutes('product', 'store')[0]?.selected, remote.id);
  work.transitionDevice('engineering', remote.id, 'retired');
  assert.throws(() => work.setDevice('engineering', remote.id, true), { status: 409 });
  assert.equal((await work.deviceWork(remote.token, poll(), true)).job, undefined, '退役令牌只能结清旧执行，不能领取新工作');
  await work.deviceWork(other.token, poll(), true);
  const delegated = { project: 'store', title: '门店推荐理由后续核对', request: '沿用小屏规则',
    agent: 'auto', nonce: randomUUID(), material: [], priority: 'normal' as const };
  assert.throws(() => work.start('product', { ...delegated, device: remote.id }), { status: 409 });
  const next = work.start('product', delegated);
  const nextId = await wait(() => work.resolveStart('product', next.trigger) ?? undefined, '已建立下一张工单');
  const picked = await wait(async () => (await work.deviceWork(other.token, poll(), true)).job ?? undefined, '备用执行端领到新单');
  assert.equal(work.detail('product', nextId).work.device, other.id);
  assert.equal(work.detail('product', readonly).work.device, remote.id);
  await work.deviceResult(other.token, picked.run, picked.token, complete, true, { attempt: picked.attempt, state: 'exited' });
  assert.equal((await wait(() => work.detail('product', nextId).result, '备用执行端回传成果')).text, body);
});
