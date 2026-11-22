import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { Collaboration } from '../src/workbench/collaboration.ts';

test('门店推荐理由的分页、详情、运行和健康检查独立于失效检索，切换新插件无需改工作流', { timeout: 40000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-read-paths-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'), { mode: 0o700 });
  const { ConsoleAuth } = await import('../src/console-auth.ts');
  const auth = new ConsoleAuth();
  const password = randomUUID();
  await auth.ready();
  await auth.bootstrapOwner('product', password);
  await auth.createAccount('engineer', password, 'operator', 'product');
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const origin = 'http://127.0.0.1:' + port;
  const python = path.join(state, 'index-fixture');
  const started = path.join(state, 'index-started');
  const release = path.join(state, 'index-release');
  const cli = path.join(state, 'worker.cjs');
  await writeFile(cli, 'console.log("小屏推荐理由可读且长词能换行。");\n', { mode: 0o600 });
  await writeFile(python, [
    '#!' + process.execPath, "const f = require('node:fs');", "const [, , , operation] = process.argv;",
    `if (operation === 'memory') { f.writeFileSync(${JSON.stringify(started)}, '1');`,
    `  const timer = setInterval(() => { if (f.existsSync(${JSON.stringify(release)})) { clearInterval(timer); process.exit(7); } }, 25);`,
    '  setTimeout(() => process.exit(7), 12000);', '} else process.exit(7);',
  ].join('\n'), { mode: 0o700 });
  const settings = {
    port, octop: { python, profiles: [] },
    functions: [{ id: 'review', title: '核对' }],
    agents: [{ id: 'small-screen', title: '小屏 Agent', owner: 'engineer', kind: 'personal', function: 'review',
      projects: ['store'], capability: '小屏验收', skill: '只读核对', active: true, engine: 'command',
      command: [process.execPath, cli], execution: { kind: 'test', provider: 'fixture' } }],
    projects: [{ id: 'store', title: '门店推荐理由', members: ['product', 'engineer'], maintainers: ['product'],
      topics: [{ id: 'screen', title: '小屏验收' }] },
      { id: 'internal', title: '仅产品可见', members: ['product'], maintainers: ['product'] }],
  };
  let child: ChildProcess | undefined;
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    await exit;
  }
  t.after(async () => { await stop(); await rm(state, { recursive: true, force: true }); });
  async function until<T>(read: () => Promise<T | undefined>) {
    for (let i = 0; i < 120; i++) { const result = await read(); if (result !== undefined) return result; await delay(60); }
    assert.fail('工作台未达到验收状态');
  }
  async function launch(memory: 'octop' | 'weighted-terms') {
    await writeFile(path.join(state, 'workbench.json'), JSON.stringify({ ...settings, plugins: { memory } }), { mode: 0o600 });
    child = spawn(process.execPath, ['--import', 'tsx', 'src/workbench/server.ts'], { stdio: 'ignore',
      env: { ...process.env, COLLAB_STATE_DIR: state, CONTRACTOR_PAUSE_NOTIFICATIONS: '1' } });
    await until(async () => await fetch(origin + '/health').then(r => r.ok || undefined).catch(() => undefined));
  }
  const request = (route: string, cookie?: string, data?: unknown) => fetch(origin + '/api/' + route, {
    ...(data !== undefined && { method: 'POST', body: JSON.stringify(data) }),
    headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
  });
  async function login(actor = 'product') {
    const res = await request('login', undefined, { username: actor, password });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie')!.split(';', 1)[0]!;
  }
  await launch('octop');
  const cookie = await login();
  async function api<T>(route: string, data?: unknown): Promise<T> {
    const response = await request(route, cookie, data);
    const payload = await response.json();
    assert.ok(response.ok, route + ' ' + payload.error);
    return payload as T;
  }
  const base = 'project/store/messages';
  for (let index = 1; index <= 104; index++) await api(base, { text: '第 ' + index + ' 条小屏讨论', topic: 'screen', nonce: randomUUID() });
  type Messages = ReturnType<Collaboration['conversationPage']>;
  const first = await api<Messages>(base + '?topic=screen&paged=1&limit=100');
  const older = await api<Messages>(base + '?topic=screen&paged=1&before=' + first.next);
  assert.deepEqual([older.rows[0]!.text, older.rows.length, first.rows.length], ['第 1 条小屏讨论', 4, 100]);
  assert.equal(new Set([...first.rows, ...older.rows].map(row => row.id)).size, 104);

  const knowledge = await api<{ id: string }>('knowledge/store', { title: '门店推荐理由小屏规则', body: '连续长词应换行且无横向溢出。',
    conditions: '门店', visibility: 'project', kind: 'reference' });
  const tickets = [] as string[];
  for (let index = 0; index < 5; index++) {
    const started = await api<{ trigger: string }>('ticket', { project: 'store', topic: 'screen', agent: 'small-screen',
      title: '小屏验收 ' + index, request: '核对长词换行', nonce: randomUUID(), priority: 'normal', material: [] });
    tickets.push(await until(async () => (await api<{ ticket?: string }>('request/' + started.trigger)).ticket || undefined));
  }
  let finished = false;
  const failingSearch = request('project/store/recall?q=门店推荐理由', cookie).finally(() => { finished = true; });
  await until(() => stat(started).then(() => true).catch(() => undefined));
  assert.equal((await fetch(origin + '/health/integrations')).status, 503);
  assert.equal((await fetch(origin + '/health')).status, 200);
  const catalog = await api<ReturnType<Collaboration['overview']>>('overview?catalog=1');
  assert.deepEqual(catalog.tickets, []);
  assert.equal((await api<ReturnType<Collaboration['overview']>>('overview')).tickets.length, 5,
    '首页在目录请求之外读取真实工单，检索失效不能把工单数误报为零');
  type TicketPage = ReturnType<Collaboration['ticketPage']>;
  const page = await api<TicketPage>('tickets?project=store&limit=2');
  const next = await api<TicketPage>('tickets?project=store&limit=3&after=' + page.next);
  assert.equal(new Set([...page.rows, ...next.rows].map(row => row.id)).size, 5);
  assert.equal(next.next, undefined);
  assert.ok(page.rows.every(row => !('history' in row) && !('runs' in row) && !('material' in row.work)));
  assert.deepEqual((await api<TicketPage>('tickets?project=store&topic=screen&q=小屏验收%200')).rows.map(row => row.id), [tickets[0]]);
  const detail = await api<ReturnType<Collaboration['detail']>>('ticket/' + tickets[0]);
  assert.equal(detail.request, '核对长词换行');
  assert.ok(Array.isArray(detail.history));
  const missingCapture = 'ticket/' + tickets[0] + '/product-capture?revision=' + '0'.repeat(64) + '&check=1&case=viewport-280&kind=screenshot';
  assert.equal((await request(missingCapture, cookie)).status, 404, '附件地址须进入专用路由');
  assert.equal((await request('tickets?project=internal', await login('engineer'))).status, 404);
  assert.equal(finished, false, '列表和详情须在等待索引时可用');
  await writeFile(release, '1');
  assert.equal((await failingSearch).status, 503);

  await stop();
  await launch('weighted-terms');
  const restarted = await login();
  const matches = await request('project/store/recall?q=门店推荐理由小屏规则', restarted).then(r => r.json()) as { id: string }[];
  assert.deepEqual(matches.map(row => row.id), [knowledge.id]);
  const status = await request('admin/service-status', restarted).then(r => r.json());
  assert.ok(status.plugins.some((provider: { id: string; capability: string }) => provider.id === 'weighted-terms' && provider.capability === 'memory'));
});
