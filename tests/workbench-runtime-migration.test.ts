import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Collaboration } from '../src/workbench/collaboration.ts';
import { migrateRuntime } from '../src/workbench/runtime-migration.ts';
import type { DeviceJob } from '../src/workbench/devices.ts';
import type { ExecutionDriver } from '../src/workbench/execution/contract.ts';
import type { Result } from '../src/workbench/execution/protocol.ts';

async function freePort() {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  const closed = once(socket, 'close');
  socket.close();
  await closed;
  return address.port;
}

test('门店推荐理由离线切换两次，原工单必答、会话、历史回执和积分跨调度器接续', { timeout: 95000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contractor-runtime-transfer-'));
  const original = path.join(root, 'before');
  const native = path.join(root, 'contractor');
  const rollback = path.join(root, 'rollback');
  const [port, remoteRunnerPort] = await Promise.all([freePort(), freePort()]);
  const address = `http://127.0.0.1:${port}`;
  const runnerAddress = `http://127.0.0.1:${remoteRunnerPort}`;
  const topic = 'recommendation';
  const password = randomUUID();
  const model = 'migration-fixture';
  await mkdir(original);
  await writeFile(path.join(original, 'workbench.json'), JSON.stringify({
    port, remoteRunnerPort,
    projects: [{ id: 'store', title: '门店推荐理由', members: ['product'], maintainers: ['product'], topics: [{ id: topic, title: '小屏推荐卡' }] }],
    functions: [{ id: 'review', title: '核对验收' }],
    agents: [{ id: 'reviewer', title: '推荐卡核对', owner: 'product', projects: ['store'], kind: 'personal', function: 'review',
      execution: { kind: 'remote', provider: 'deepseek' }, engine: 'claude', model, active: true,
      skill: '核对小屏长文本布局', capability: '逐条核对验收建议' }],
  }));
  let server: ChildProcess | undefined;
  let log = '';
  let cookie = '';
  let driver: ExecutionDriver = 'autoloop';
  const args = ['--import', 'tsx', 'src/workbench/server.ts'];
  const env = (directory: string) => ({ ...process.env, COLLAB_STATE_DIR: directory, CONTRACTOR_PAUSE_NOTIFICATIONS: '1' });
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const closed = once(server, 'exit');
    server.kill('SIGTERM');
    assert.deepEqual(await closed, [0, null], log);
  }
  t.after(async () => {
    await stop();
    await rm(root, { recursive: true, force: true });
  });
  async function waitFor<T>(label: string, read: () => Promise<T | undefined | false | null>): Promise<T> {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const value = await read();
      if (value) return value;
      await delay(80, undefined, { signal: t.signal });
    }
    assert.fail(label + '\n' + log);
  }
  async function start(directory: string, expected: ExecutionDriver) {
    driver = expected;
    server = spawn(process.execPath, args, { env: env(directory), stdio: ['ignore', 'pipe', 'pipe'] });
    log = '';
    for (const pipe of [server.stdout!, server.stderr!]) pipe.on('data', data => { log += data; });
    const health = await waitFor('启动工作台', async () => {
      assert.equal(server!.exitCode, null, log);
      const value = await fetch(address + '/health').then(r => r.json()).catch(() => undefined);
      return value?.workbenchReady && value;
    });
    assert.equal(health.executor, expected);
    await api('login', { username: 'product', password });
  }
  async function api<T = unknown>(route: string, body?: unknown, status = 200): Promise<T> {
    const response = await fetch(address + '/api/' + route, { headers: { cookie, 'content-type': 'application/json' },
      ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    if (route === 'login') cookie = response.headers.getSetCookie()[0]!.split(';')[0]!;
    const value = await response.json();
    assert.equal(response.status, status, route + ' ' + JSON.stringify(value));
    return value as T;
  }
  function database(directory: string, sql: string) {
    const db = new DatabaseSync(path.join(directory, 'orchestrator.sqlite'));
    try { db.exec(sql); } finally { db.close(); }
  }
  const init = spawn(process.execPath, [...args, 'init-owner', 'product'], { env: env(original), stdio: ['pipe', 'ignore', 'pipe'] });
  const initialized = once(init, 'exit');
  init.stdin!.end(password);
  assert.deepEqual(await initialized, [0, null]);
  await start(original, 'autoloop');
  await assert.rejects(migrateRuntime(original, native), /正在写入/);
  await api('budget/points-policy', { enabled: true, tokensPerPoint: 1000, rates: [{ provider: 'deepseek', model, multiplier: 1, reserveTokens: 1000 }] });
  const paired = await api<{ code: string }>('device/pair', { project: 'store', agent: 'reviewer', remote: true });
  const response = await fetch(runnerAddress + '/api/runner/pair', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: paired.code, name: '联调执行机' }) });
  assert.equal(response.status, 200);
  const device = await response.json() as { id: string; token: string };
  async function runner<T = unknown>(action: string, body: unknown, status = 200, protocol = driver): Promise<T> {
    const res = await fetch(runnerAddress + '/api/runner/' + action, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + device.token, 'x-contractor-execution': protocol }, body: JSON.stringify(body) });
    assert.equal(res.status, status);
    return res.json() as Promise<T>;
  }
  const claim = (id = randomUUID()) => runner<{ job?: DeviceJob }>('work', { claim: id, wait: 0, capacity: true, running: [] });
  const next = () => waitFor('执行端领取', async () => (await claim()).job);
  const receipt = (job: DeviceJob, value: Result) => ({ run: job.run, lease: job.token, value, stop: { state: 'exited', attempt: job.attempt, model } });
  const firstTitle = '按 320px 和 360px 核对吗？';
  const secondTitle = '连续长词也纳入验收吗？';
  const lastTitle = '280px 也需要纳入吗？';
  const topicMessage = { text: '本主题记录门店推荐理由的小屏要求。', topic, nonce: randomUUID() };
  await api('project/store/messages', topicMessage);
  const { trigger } = await api<{ trigger: string }>('ticket', { title: '核对门店推荐理由小屏长文本', request: '确认使用真实视口逐项验收',
    project: 'store', topic, agent: 'reviewer', device: device.id, nonce: randomUUID() });
  const ticket = await waitFor('工单立项', async () => (await api<{ ticket?: string }>('request/' + trigger)).ticket);
  const detail = () => api<ReturnType<Collaboration['detail']>>('ticket/' + ticket);
  const messages = () => api<ReturnType<Collaboration['conversation']>>('project/store/messages?topic=' + topic);
  const needs = () => api<ReturnType<Collaboration['needsYou']>>('needs-you');
  const topicHistory = await messages();
  assert.ok(JSON.stringify(topicHistory).includes(topicMessage.text));

  const first = await next();
  const firstSession = randomUUID();
  await runner('started', { run: first.run, lease: first.token, value: { session: firstSession } });
  await stop();
  await assert.rejects(migrateRuntime(original, native), /未确认停止的租约/);
  await start(original, 'autoloop');
  assert.deepEqual(await next(), first, '旧调度器恢复原执行和租约');
  const ask = (title: string, key: string) => ({ title, text: title, options: ['确认', '调整'], key });
  const asked = receipt(first, { outcome: 'done', summary: '请确认两项验收范围', session: firstSession, usage: { input: 80, output: 20 },
    ask: [ask(firstTitle, 'viewport'), ask(secondTitle, 'long-word')] });
  database(original, `CREATE TRIGGER test_ledger_error BEFORE UPDATE ON workbench_point_charge
    BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END`);
  await runner('result', asked, 500);
  await stop();
  await assert.rejects(migrateRuntime(original, native), /未结算的回执/);
  database(original, 'DROP TRIGGER test_ledger_error');
  await start(original, 'autoloop');
  const oldQuestions = await waitFor('原回执恢复两个必答', async () => {
    const pending = (await detail()).questions;
    return pending.length === 2 && pending;
  });
  assert.deepEqual(await runner('result', asked), { rejected: [] });
  const answer = (card: number) => ({ card, choice: 0, nonce: randomUUID() });
  const answerPath = 'ticket/' + ticket + '/answer';
  const firstAnswer = answer(oldQuestions.find(q => q.title === firstTitle)!.id);
  await api(answerPath, firstAnswer);
  const secondQuestion = oldQuestions.find(q => q.title === secondTitle)!;
  await waitFor('原单剩一个必答', async () => (await detail()).questions.length === 1);
  const todo = (await needs()).find(row => row.card === secondQuestion.id);
  assert.ok(todo);
  const retainedRun = (await detail()).runs.find(run => run.state === 'queued')?.id;
  assert.ok(retainedRun);
  await stop();
  await migrateRuntime(original, native);
  await assert.rejects(migrateRuntime(original, native), /已存在/);
  await start(native, 'contractor');

  const moved = await detail();
  assert.deepEqual(moved.questions.map(row => row.id), [secondQuestion.id]);
  assert.deepEqual(moved.runs.map(row => row.id), [first.run, retainedRun]);
  assert.equal((await needs()).find(row => row.card === secondQuestion.id)?.id, todo.id);
  assert.deepEqual(await messages(), topicHistory);
  await runner('result', asked, 409, 'autoloop');
  assert.deepEqual(await runner('result', asked), { rejected: [] });
  await runner('result', { ...asked, value: { ...asked.value, summary: '改变原回执' } }, 403);
  await api(answerPath, firstAnswer, 409);
  assert.equal((await claim()).job, undefined, '未答完仍由原工单等候');
  const secondAnswer = answer(secondQuestion.id);
  await api(answerPath, secondAnswer);
  const second = await next();
  await api(answerPath, secondAnswer, 409);
  assert.equal(second.run, retainedRun);
  assert.notEqual(second.token, first.token);
  assert.ok(second.context.answers.some(row => row.title === firstTitle));
  assert.ok(second.context.answers.some(row => row.title === secondTitle));
  assert.deepEqual(await next(), second);
  const nativeAsked = receipt(second, { outcome: 'done', summary: '确认增加一档视口', session: randomUUID(),
    usage: { input: 95, output: 25 }, ask: [ask(lastTitle, 'add-narrow-screen')] });
  await runner('result', nativeAsked);
  await runner('result', nativeAsked);
  const lastQuestion = await waitFor('Contractor 新待办', async () => (await detail()).questions.find(q => q.title === lastTitle));
  const nativeTodo = (await needs()).find(row => row.card === lastQuestion.id);
  assert.ok(nativeTodo);
  async function checkUsage(expected: number[], tokens: number) {
    const usage = await api<ReturnType<Collaboration['projectUsage']>>('project/store/usage');
    assert.deepEqual(usage.attempts.map(row => row.run).sort((a, b) => a - b), expected);
    assert.equal(usage.input + usage.output, tokens);
    assert.equal(usage.pointAttempts.reduce((sum, row) => sum + (row.charged ?? 0), 0).toFixed(3), (tokens / 1000).toFixed(3));
  }
  await checkUsage([first.run, second.run], 220);
  await stop();
  await migrateRuntime(native, rollback);
  await start(rollback, 'autoloop');
  assert.equal((await detail()).questions[0]?.id, lastQuestion.id);
  assert.equal((await needs()).find(row => row.card === lastQuestion.id)?.id, nativeTodo.id);
  assert.deepEqual(await messages(), topicHistory);
  await runner('result', nativeAsked, 409, 'contractor');
  assert.deepEqual(await runner('result', nativeAsked), { rejected: [] });
  const lastAnswer = answer(lastQuestion.id);
  await api(answerPath, lastAnswer);
  const last = await next();
  await api(answerPath, lastAnswer, 409);
  assert.ok(last.run > retainedRun, '回滚后新运行编号不能覆盖已迁移尝试');
  assert.ok(last.context.answers.some(row => row.title === lastTitle));
  const finalText = '280px、320px、360px 下，连续长词可以换行且页面没有横向溢出。';
  const finished = receipt(last, { outcome: 'done', summary: '已核对小屏验收条件', usage: { input: 70, output: 10 },
    events: [{ id: 'work-result', type: 'contractor.work-result', detail: finalText, subject: '', summary: '', link: '', hops: 0 }] });
  await runner('result', finished);
  await runner('result', finished);
  const result = await waitFor('回到原单的完整成果', async () => (await detail()).result);
  assert.equal(result.text, finalText);
  await api('ticket/' + ticket + '/accept', { revision: result.revision });
  assert.ok((await detail()).work.accepted);
  await checkUsage([first.run, second.run, last.run], 300);
  assert.equal((await claim()).job, undefined);
  assert.equal((await detail()).runs.length, 3);
  await stop();
  const source = new DatabaseSync(path.join(original, 'autoloop', 'hub.db'), { readOnly: true });
  const db = new DatabaseSync(path.join(rollback, 'autoloop', 'hub.db'), { readOnly: true });
  try {
    assert.equal(source.prepare('SELECT state FROM runs WHERE id=?').get(retainedRun)?.state, 'queued');
    assert.equal(db.prepare('SELECT session FROM runs WHERE id=?').get(first.run)?.session, firstSession);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM facts WHERE json_extract(fact,'$.type')='contractor.migration'").get()?.n, 1);
  } finally { source.close(); db.close(); }
});
