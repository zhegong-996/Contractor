import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import type { Collaboration } from '../src/workbench/collaboration.ts';
import type { permissionAdmin } from '../src/workbench/permission-admin.ts';

test('门店推荐理由 HTTP 权限、交接、项目撤权和账本范围在重启后仍生效', { timeout: 45000 }, async t => {
  const state = await mkdtemp(path.join(tmpdir(), 'contractor-project-permissions-'));
  const oldState = process.env.COLLAB_STATE_DIR;
  process.env.COLLAB_STATE_DIR = state;
  let service: ChildProcess | undefined;
  const stop = async () => {
    if (!service || service.exitCode !== null || service.signalCode !== null) return;
    const exited = once(service, 'exit');
    service.kill('SIGTERM');
    await exited;
  };
  t.after(async () => {
    await stop();
    if (oldState === undefined) delete process.env.COLLAB_STATE_DIR;
    else process.env.COLLAB_STATE_DIR = oldState;
    await rm(state, { recursive: true, force: true });
  });

  const consolePath = path.join(state, 'console');
  await mkdir(consolePath);
  const password = randomUUID();
  const { ConsoleAuth } = await import('../src/console-auth.ts');
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('owner', password);
  for (const [name, role] of [['admin', 'admin'], ['product', 'operator'], ['engineer', 'operator'],
    ['retail', 'operator'], ['reader', 'viewer']] as const) await auth.createAccount(name, password, role, 'owner');

  // Simulate an installation with the old RBAC rules and the original additive membership table.
  const policyFile = path.join(consolePath, 'rbac_policy.csv');
  const policy = await readFile(policyFile, 'utf8');
  await writeFile(policyFile, policy.split('\n').filter(line => !/contractor-platform-capabilities|project-create|platform-quota-admin|workspace-members-admin/.test(line)).join('\n'));
  const db = new DatabaseSync(path.join(state, 'orchestrator.sqlite'));
  db.exec(`CREATE TABLE workbench_project_member (project TEXT NOT NULL, member TEXT NOT NULL, PRIMARY KEY(project,member));
    INSERT INTO workbench_project_member VALUES ('store','reader');`);
  db.close();
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const port = address.port;
  const origin = 'http://127.0.0.1:' + port;
  const cli = path.join(state, 'agent.mjs');
  const bin = path.join(state, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'lark-cli'), `#!/usr/bin/env node
    const args = process.argv.slice(2);
    if (!args.includes('+get-user') || args[args.indexOf('--as') + 1] !== 'bot') process.exit(1);
    const id = args[args.indexOf('--user-id') + 1];
    if (!['ou_member','ou_external'].includes(id)) process.exit(1);
    console.log(JSON.stringify({ok:true,identity:'bot',data:{user:{open_id:id,name:'门店测试成员',is_cross_tenant:id==='ou_external'}}}));`, { mode: 0o700 });
  await writeFile(cli, `import { readFileSync } from 'node:fs';
    const events = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT,'utf8')).events;
    if (events.find(e => e.type === 'task.request').detail.includes('等待停止')) {
      console.log('受控执行已经开始'); setInterval(() => {}, 100);
    } else console.log('先写通勤场景，再给出能核实的试穿建议。');`);
  const adapter = path.join(state, 'autoloop/plugins/command');
  await mkdir(adapter, { recursive: true });
  const upstream = pathToFileURL(path.resolve('upstream/autoloop/plugins/command/agent.ts')).href;
  await writeFile(path.join(adapter, 'agent.ts'), `import base from ${JSON.stringify(upstream)};
    export default {...base,read(stdout,code,stderr) {
      return {...base.read(stdout,code,stderr), usage:{input:70,output:30,cost:0.01}};
    }};`);
  await writeFile(path.join(state, 'workbench.json'), JSON.stringify({
    port, crossChannel: {}, feishu: { profile: 'fixture', appId: 'cli_fixture', botId: 'ou_bot', separateIngress: true }, projects: [
      { id: 'store', title: '门店推荐理由', members: ['product','engineer','retail'], maintainers: ['product'],
        topics: [{ id: 'reason', title: '推荐理由' }, { id: 'routing-fixture', title: '模型路由测试' }] },
      { id: 'child', parent: 'store', title: '独立小屏子项目', members: ['product','retail'], maintainers: ['product'] },
    ], functions: [{ id: 'review', title: '核对' }],
    agents: [{ id: 'discuss', title: '门店核对', kind: 'personal', owner: 'engineer', function: 'review',
      capability: '核对门店推荐理由', skill: '只读核对资料', engine: 'command', command: [process.execPath, cli],
      model: 'fixture-model', execution: { kind: 'test', provider: 'fixture' }, projects: ['store'], active: true },
    { id: 'route-codex', title: '模型配置测试端', owner: 'engineer', kind: 'personal', function: 'review',
      capability: '仅用来核对配置', skill: '只读', engine: 'codex', model: 'primary', allowedModels: ['primary', 'fallback'],
      execution: { kind: 'sandbox', provider: 'openai', credential: 'fixture-only' }, projects: ['store'], active: true }],
  }));

  const cookies = new Map<string, string>();
  async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
    for (let i = 0; i < 160; i++) {
      const value = await read();
      if (value !== undefined) return value;
      await delay(80);
    }
    assert.fail('未达到预期状态');
  }
  async function launch() {
    service = spawn(process.execPath, ['--import', 'tsx', 'src/workbench/server.ts'], {
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, COLLAB_STATE_DIR: state, CONTRACTOR_PAUSE_NOTIFICATIONS: '1' },
      stdio: 'ignore',
    });
    await waitFor(async () => {
      assert.equal(service!.exitCode, null, '隔离工作台提前退出');
      const health = await fetch(origin + '/health').then(r => r.json()).catch(() => undefined);
      return health?.workbenchReady ? true : undefined;
    });
    for (const actor of ['owner', 'admin', 'product', 'engineer', 'retail', 'reader']) await login(actor);
  }
  async function login(actor: string, word = password, status = 200) {
    const response = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: actor, password: word }) });
    assert.equal(response.status, status);
    if (response.ok) cookies.set(actor, response.headers.get('set-cookie')!.split(';')[0]!);
  }
  async function request<T = unknown>(actor: string, route: string, status: number, body?: object): Promise<T> {
    const response = await fetch(origin + '/api/' + route, {
      headers: { cookie: cookies.get(actor) ?? '', 'content-type': 'application/json' },
      ...(body && { method: 'POST', body: JSON.stringify(body) }),
    });
    const value = await response.json();
    assert.equal(response.status, status, actor + ' ' + route + ' ' + JSON.stringify(value).slice(0, 250));
    return value as T;
  }
  type Overview = ReturnType<Collaboration['overview']>;
  type Ticket = ReturnType<Collaboration['detail']>;
  type Usage = ReturnType<Collaboration['projectUsage']>;
  const create = (parent?: string) => ({ title: '临时项目', parent, nonce: randomUUID() });
  const mandate = (input: string) => ({ project: 'store', topic: 'reason', title: input, request: input, nonce: randomUUID() });
  const actions = {
    remove: 'project/store/member/remove',
    transfer: 'project/store/maintainer/transfer',
  };
  async function start(actor: string, input: string, extra: object = {}) {
    const { trigger } = await request<{ trigger: string }>(actor, 'ticket', 200, { ...mandate(input), agent: 'discuss', ...extra });
    const id = await waitFor(async () => (await request<{ ticket: string | null }>(actor, 'request/' + trigger, 200)).ticket ?? undefined);
    return { id, trigger };
  }

  await launch();
  type Service = ReturnType<Collaboration['modelServices']>[number];
  type Routing = ReturnType<Collaboration['projectRouting']>;
  const available = await request<Service[]>('admin', 'admin/model-services', 200);
  assert.doesNotMatch(JSON.stringify(available), /credential|fixture-only|engineer/);
  const openai = available.find(item => item.provider === 'openai')!;
  const modelService = 'admin/model-services/openai';
  const routing = 'project/store/routing';
  const platformUpdate = { enabled: true, models: ['primary', 'fallback'], revision: openai.revision };
  await request('retail', 'admin/model-services', 403);
  await request('retail', modelService, 403, platformUpdate);
  await request('retail', 'admin/service-status', 403);
  await request('admin', 'admin/service-status', 200);
  await request('admin', routing, 404);
  await request('retail', routing, 403);
  const initial = await request<Routing>('product', routing, 200);
  const routingUpdate = {
    revision: initial.revision,
    responsibilities: [{ member: 'engineer', function: 'review' }],
    dispatch: [{ topic: 'routing-fixture', agent: 'route-codex', function: 'review', decider: 'product' }],
    modelRoutes: [{ purpose: 'execution', agent: 'route-codex', models: ['primary', 'fallback'] }],
  };
  await request('retail', routing, 403, routingUpdate);
  await request('admin', routing, 404, routingUpdate);
  await request('product', 'project/child/routing', 409, {
    ...routingUpdate, revision: (await request<Routing>('product', 'project/child/routing', 200)).revision,
  });
  await request('product', routing, 409, { ...routingUpdate, dispatch: [...routingUpdate.dispatch, ...routingUpdate.dispatch] });
  await request('product', routing, 409, { ...routingUpdate, modelRoutes: [{ ...routingUpdate.modelRoutes[0], models: ['unauthorized'] }] });
  await request('admin', modelService, 400, { ...platformUpdate, apiKey: 'fixture-should-be-rejected' });
  const platformSaved = await request<Service>('admin', modelService, 200, platformUpdate);
  await request('admin', modelService, 409, platformUpdate);
  await request('product', routing, 200, routingUpdate);
  await request('product', routing, 409, routingUpdate);
  assert.equal((await request<Overview>('retail', 'overview', 200)).canManageServices, false);
  assert.doesNotMatch(JSON.stringify(await request<Overview>('retail', 'overview', 200)), /modelRoutes|allowedModels/);
  const suspended = await request<Service>('admin', modelService, 200, { revision: platformSaved.revision, enabled: false, models: platformSaved.models });
  const deniedModel = await start('retail', '暂停模型服务时拦住新的模型调用', { agent: 'auto', topic: 'routing-fixture' });
  await waitFor(async () => {
    const detail = await request<Ticket>('retail', 'ticket/' + deniedModel.id, 200);
    return detail.work.agent === 'route-codex' && detail.recovery?.kind === 'model-authorization' ? true : undefined;
  });
  await request('admin', modelService, 200, { revision: suspended.revision, enabled: true, models: suspended.models });
  await request('retail', 'admin/members', 403);
  await request('admin', 'admin/point-budgets', 200);
  const platform = await request<ReturnType<ReturnType<typeof permissionAdmin>['list']>>('admin', 'admin/members', 200);
  assert.deepEqual(platform.roles.map(role => role.id), ['operator', 'viewer']);
  assert.equal(platform.rows.find(row => row.name === 'owner')?.mayManage, false);
  assert.deepEqual(platform.rolePermissions.map(({ id, capabilities: { privilegedAccounts, manageModels, manageQuotas, collaborate } }) =>
    [id, privilegedAccounts, manageModels, manageQuotas, collaborate]), [
    ['owner', true, true, true, true], ['admin', false, true, true, true],
    ['operator', false, false, false, true], ['viewer', false, false, false, false],
  ]);
  assert.equal((await request<Overview>('owner', 'overview', 200)).canManageLogin, true);
  assert.equal((await request<Overview>('admin', 'overview', 200)).canManageLogin, false);
  await request('admin', 'admin/im-login', 403);
  assert.doesNotMatch(JSON.stringify(platform), /passwordHash|feishuOpenId|"salt"/);
  await request('admin', 'admin/members', 404, { username: 'other-owner', password, role: 'owner' });
  await request('admin', 'admin/members/owner/sessions', 403, {});
  await request('owner', 'admin/members/admin/role', 200, { role: 'admin' });
  await request('admin', 'admin/members/product/status', 409, { enabled: false });
  // Inject normalized private messages through the independent ingress inbox, without sending messages on Feishu.
  const { openFeishuInbox } = await import('../src/workbench/feishu-inbox.ts');
  const inbox = openFeishuInbox('cli_fixture');
  const ingressOwner = randomUUID();
  assert.ok(inbox.claim(ingressOwner, Date.now()));
  t.after(() => inbox.close());
  async function feishuMessage(content: string, sender: string, chatType: 'p2p' | 'group') {
    const now = Date.now();
    assert.ok(inbox.pulse(ingressOwner, now, { messages: {
      state: 'connecting', attempt: 1, checkedAt: now, readyAt: undefined, disconnectedAt: undefined, busHealth: 'unknown', lostEvents: 0,
    } }));
    const message = { message_id: 'om_' + randomUUID(), content, chat_id: 'oc_fixture', chat_type: chatType,
      sender_id: sender, sender_type: 'user', create_time: String(now) };
    inbox.put(ingressOwner, 'message', message.chat_id, JSON.stringify(message), now);
    await waitFor(async () => inbox.backlog(Date.now()).pending === 0 ? true : undefined);
  }
  await request('', 'account/activation/start', 410, { username: 'new-staff' });
  // Preserve approvals already in progress when the old opening form is removed.
  const { AccountActivation } = await import('../src/workbench/account-activation.ts');
  const activationDb = new DatabaseSync(path.join(state, 'orchestrator.sqlite'));
  const opening = new AccountActivation(activationDb).begin('new-staff');
  activationDb.close();
  const proof = { id: opening.id, token: opening.token };
  const pendingActivations = () => request<{ pending: { id: string; username: string }[] }>('admin', 'admin/members', 200);
  const stateOf = () => request<{ state: string }>('', 'account/activation/status', 200, proof);
  const approve = 'admin/activation/' + opening.id;
  await request('', 'account/activation/complete', 409, { ...proof, password });
  await request('admin', approve, 409, { role: 'operator' });
  await feishuMessage(opening.command, 'ou_member', 'group');
  await feishuMessage(opening.command, 'ou_external', 'p2p');
  assert.equal((await stateOf()).state, 'waiting');
  assert.deepEqual((await pendingActivations()).pending, []);
  await feishuMessage(opening.command, 'ou_member', 'p2p');
  assert.equal((await stateOf()).state, 'verified');
  assert.equal((await pendingActivations()).pending[0]?.username, 'new-staff');
  assert.doesNotMatch(JSON.stringify(await pendingActivations()), /token|verifier|password|ou_member/);
  await request('retail', approve, 403, { role: 'operator' });
  await request('admin', approve, 403, { role: 'owner' });
  await request('admin', approve, 200, { role: 'operator' });
  await request('admin', approve, 409, { role: 'operator' });
  assert.equal((await stateOf()).state, 'approved');
  await login('new-staff', password, 401);
  await request('', 'account/activation/complete', 409, { ...proof, token: '0'.repeat(64), password });
  await stop();
  await launch();
  assert.deepEqual((await request<Service[]>('admin', 'admin/model-services', 200)).find(row => row.provider === 'openai')?.models, platformUpdate.models);
  assert.deepEqual((await request<Routing>('product', routing, 200)).modelRoutes, routingUpdate.modelRoutes);
  assert.equal((await stateOf()).state, 'approved', '重启保留已批准的本人开通');
  await request('', 'account/activation/complete', 200, { ...proof, password });
  await request('', 'account/activation/complete', 409, { ...proof, password });
  await login('new-staff');
  await request('new-staff', 'project/store/access', 404);
  await request('retail', 'project/store/access', 403);
  await request('product', 'project/store/member', 200, { member: 'new-staff', role: 'reader' });
  await request('new-staff', 'project/store/messages', 200);
  await request('new-staff', 'ticket', 403, mandate('只读项目内发起委托'));
  await request('product', 'project/store/member/role', 200, { member: 'new-staff', role: 'collaborator' });
  await request('new-staff', 'project/store/messages', 200, { text: '可在本项目协作', nonce: randomUUID() });
  await request('product', 'project/store/member/role', 200, { member: 'new-staff', role: 'reader' });
  await request('new-staff', 'project/store/messages', 403, { text: '旧会话不能继续写入', nonce: randomUUID() });
  await request('admin', 'admin/members/new-staff/role', 200, { role: 'viewer' });
  await request('new-staff', 'overview', 401);
  await login('new-staff');
  await request('product', 'project/store/member/role', 409, { member: 'new-staff', role: 'collaborator' });
  await request('admin', 'admin/members/new-staff/password', 404, { password: randomUUID() });
  await request('admin', 'admin/members/new-staff/sessions', 200, {});
  await request('new-staff', 'overview', 401);
  await login('new-staff');
  const rotated = randomUUID();
  await request('new-staff', 'account/password', 403, { current: randomUUID(), password: rotated });
  await request('new-staff', 'account/password', 200, { current: password, password: rotated });
  await request('new-staff', 'overview', 401);
  await login('new-staff', rotated);
  await request('admin', 'admin/members/new-staff/status', 200, { enabled: false });
  await request('new-staff', 'overview', 401);
  await login('new-staff', rotated, 401);
  await request('admin', 'admin/members/new-staff/status', 200, { enabled: true });
  await login('new-staff', rotated);
  await request('new-staff', 'project/store/messages', 403, { text: '重新启用后仍只读', nonce: randomUUID() });

  const recovered = randomUUID();
  try {
    const challenge = await request<{ code: string; token: string; command: string }>('', 'account/recovery/start', 200, { username: 'new-staff' });
    const complete = { code: challenge.code, token: challenge.token, password: recovered };
    await feishuMessage(challenge.command, 'ou_other', 'p2p');
    await request('', 'account/recovery/complete', 409, complete);
    await feishuMessage(challenge.command, 'ou_member', 'group');
    await request('', 'account/recovery/complete', 409, complete);
    await feishuMessage(challenge.command, 'ou_member', 'p2p');
    await request('', 'account/recovery/complete', 409, { ...complete, token: '0'.repeat(64) });
    await request('', 'account/recovery/complete', 200, complete);
    await request('', 'account/recovery/complete', 409, complete);
    await request('new-staff', 'overview', 401);
    await login('new-staff', recovered);
  } finally {
    inbox.release(ingressOwner);
  }
  const member = await request<Overview>('retail', 'overview', 200);
  assert.equal(member.canCreateRootProject, false);
  assert.equal(member.projects.find(p => p.id === 'store')?.mayStart, true);
  assert.equal((await request<Overview>('admin', 'overview', 200)).platformRole, 'admin');
  await request('retail', 'project', 403, create());
  await request('retail', 'project', 403, create('store'));
  await request('product', 'project', 200, create('store'));
  await request('admin', 'project', 200, create());
  await request('admin', 'project/store/messages', 404);
  await request('owner', 'project/store/point-budgets', 404);
  await request('reader', 'ticket', 403, mandate('只读账号发起'));
  await request('reader', 'budget/points-policy', 403);
  await request('product', 'budget/points-policy', 403);
  type PointPolicy = ReturnType<Collaboration['pointPolicy']>;
  const previousPoints = await request<PointPolicy>('admin', 'budget/points-policy', 200);
  const savedPoints = await request<PointPolicy>('admin', 'budget/points-policy', 200, { revision: previousPoints.revision, enabled: true, tokensPerPoint: 1000,
    rates: [{ provider: 'fixture', model: 'fixture-model', multiplier: 1, reserveTokens: 1000 }] });
  assert.notEqual(savedPoints.revision, previousPoints.revision);
  await request('admin', 'budget/points-policy', 409, { ...previousPoints, tokensPerPoint: 500 });
  assert.deepEqual(await request<PointPolicy>('admin', 'budget/points-policy', 200), savedPoints);
  await request('product', 'budget/points-limit', 200, { kind: 'project', subject: 'store', period: 'day', limit: 10 });
  await request('retail', 'budget/points-limit', 403, { kind: 'project', subject: 'store', period: 'day', limit: null });
  await request('admin', 'budget/points-limit', 404, { kind: 'project', subject: 'store', period: 'day', limit: null });

  const accessPolicy = (project: string) => 'project/' + project + '/knowledge-access';
  await request('retail', accessPolicy('store'), 403, { hours: 2 });
  await request('admin', accessPolicy('store'), 404, { hours: 2 });
  await request('product', accessPolicy('store'), 400, { hours: 169 });
  await request('product', accessPolicy('store'), 200, { hours: 2 });
  assert.equal((await request<ReturnType<Collaboration['projectAccess']>>('product', 'project/child/access', 200)).knowledgeAccessHours, 8);

  type Catalog = ReturnType<Collaboration['browse']>;
  const catalog = (actor: string, query = '') => request<Catalog>(actor, 'knowledge/store' + query, 200);
  const original = await request<{ id: string }>('retail', 'knowledge/store', 200, {
    title: '待确认的门店内部方案', body: '仅资料所有者可读的正文', conditions: '本次核对', kind: 'reference',
    visibility: 'restricted', directory: 'hidden',
  });
  const privateEntry = (await catalog('retail')).find(row => row.id === original.id);
  assert.ok(privateEntry && 'revision' in privateEntry);
  for (const actor of ['product', 'engineer', 'reader']) {
    assert.ok(!(await catalog(actor)).some(row => row.id === original.id));
    assert.ok(!(await catalog(actor, '?history=1')).some(row => row.id === original.id));
    assert.ok(!(await catalog(actor, '?q=' + encodeURIComponent(privateEntry.title))).some(row => row.id === original.id));
  }
  await request('engineer', 'ticket', 409, { ...mandate('外部引用'), agent: 'discuss', material: [original.id] });
  const directoryPath = 'knowledge/' + original.id + '/directory';
  await request('product', directoryPath, 404, { revision: privateEntry.revision, directory: 'requestable' });
  await request('retail', directoryPath, 200, { revision: privateEntry.revision, directory: 'requestable' });
  const teaser = (await catalog('reader')).find(row => row.id === original.id);
  assert.equal(teaser?.title, privateEntry.title);
  for (const key of ['body', 'conditions', 'source', 'revision']) assert.ok(teaser && !Object.hasOwn(teaser, key));
  await request('product', directoryPath, 403, { revision: privateEntry.revision, directory: 'hidden' });
  await request('retail', directoryPath, 200, { revision: privateEntry.revision, directory: 'hidden' });
  const replacement = await request<{ id: string }>('retail', 'knowledge/store', 200, {
    title: '门店内部方案新版', body: '新版正文', conditions: '本次核对', kind: 'reference', visibility: 'restricted',
    replaces: { id: original.id, revision: privateEntry.revision },
  });
  const next = (await catalog('retail')).find(row => row.id === replacement.id);
  assert.ok(next && 'revision' in next);
  await request('retail', 'knowledge/' + replacement.id + '/publish', 200, { revision: next.revision });
  assert.ok(!(await catalog('reader')).some(row => [original.id, replacement.id].includes(row.id)));

  const restricted = await request<{ id: string }>('retail', 'knowledge/store', 200, {
    title: '门店受限反馈', body: '合成受限资料', conditions: '本次核对', kind: 'reference', visibility: 'restricted',
  });
  const shared = await start('retail', '核对门店推荐理由', { material: [restricted.id] });
  const grant = await waitFor(async () => (await request<Ticket>('retail', 'ticket/' + shared.id, 200)).requests[0]);
  const allowed = await request<ReturnType<Collaboration['projectKnowledgeAccess']>>('retail', 'project/store/knowledge-access', 200);
  assert.equal(allowed[0]?.id, grant.id);
  assert.equal(allowed[0]?.canGrant, true);
  assert.equal(allowed[0]?.hours, 2);
  assert.deepEqual(await request('product', 'project/store/knowledge-access', 200), [], '维护人不能管理他人的资料');
  await request('product', 'ticket/' + shared.id + '/access/' + grant.id, 403, { state: 'granted' });
  await request('retail', 'ticket/' + shared.id + '/access/' + grant.id, 409, { state: 'granted', hours: 8 });
  await request('retail', 'ticket/' + shared.id + '/access/' + grant.id, 200, { state: 'granted', hours: 2 });
  const expiry = (await request<ReturnType<Collaboration['projectKnowledgeAccess']>>('retail', accessPolicy('store'), 200))[0]?.expires;
  assert.ok(expiry && Math.abs(expiry - Date.now() - 2 * 3600_000) < 10_000);
  await request('product', accessPolicy('store'), 200, { hours: 3 });
  assert.equal((await request<ReturnType<Collaboration['projectKnowledgeAccess']>>('retail', accessPolicy('store'), 200))[0]?.expires, expiry);
  const personal = await start('engineer', '我的小屏代办', { personal: true });
  for (const id of [shared.id, personal.id])
    await waitFor(async () => (await request<Ticket>('engineer', 'ticket/' + id, 200)).result);

  const ledger = async (actor: string, scope: string, attempts: number) => {
    const usage = await request<Usage>(actor, 'project/store/usage', 200);
    assert.equal(usage.scope, scope);
    assert.equal(usage.attempts.length, attempts, actor);
    assert.deepEqual(usage.pointAttempts.map(row => row.charged), Array(attempts).fill(0.1));
    assert.equal(usage.input + usage.output, 100 * attempts);
    assert.ok(usage.attempts.every(row => !Object.hasOwn(row, 'isolation')));
  };
  await ledger('product', 'project', 1);
  await ledger('retail', 'mine', 1);
  await ledger('engineer', 'mine', 2);
  await ledger('reader', 'mine', 0);
  await request('admin', 'ticket/' + shared.id, 404);
  await request('admin', actions.transfer, 404, { to: 'admin' });
  await request('reader', 'project/store/agent-budgets', 200).then(rows => assert.deepEqual(rows, []));
  const pools = await request<ReturnType<Collaboration['projectPointBudgets']>>('reader', 'project/store/point-budgets', 200);
  assert.deepEqual(pools.map(pool => [pool.kind, pool.subject]), [['personal', 'reader']]);
  const view = await request<Ticket>('reader', 'ticket/' + shared.id, 200);
  assert.ok(view.runs.every(row => !Object.hasOwn(row, 'usage')));

  const intake = await request<{ trigger: string; pending: boolean }>('engineer', 'ticket', 200, mandate('请负责人确定派工'));
  assert.equal(intake.pending, true);
  const pending = (await request<Overview>('product', 'overview', 200)).needsYou.find(row => row.subject === intake.trigger);
  assert.ok(pending);
  await request('engineer', actions.remove, 403, { member: 'retail' });
  await request('product', actions.remove, 409, { member: 'product' });
  await request('product', actions.transfer, 409, { to: 'reader' });
  await request('product', actions.transfer, 200, { to: 'engineer' });
  const successor = (await request<Overview>('engineer', 'overview', 200)).needsYou.filter(row => row.subject === intake.trigger);
  assert.equal(successor.length, 1);
  assert.notEqual(successor[0]?.id, pending.id);
  assert.ok(!(await request<Overview>('product', 'overview', 200)).needsYou.some(row => row.subject === intake.trigger));
  await request('product', 'intake/' + intake.trigger + '/resolve', 403, { action: 'dismiss' });
  await request('engineer', 'intake/' + intake.trigger + '/resolve', 200, { action: 'dismiss' });
  await ledger('product', 'mine', 0);
  await request('product', actions.remove, 403, { member: 'retail' });

  const running = await start('retail', '等待停止的门店测试');
  const abandoned = await request<{ trigger: string; pending: boolean }>('retail', 'ticket', 200, mandate('离项前未确认的派工'));
  assert.equal(abandoned.pending, true);
  await waitFor(async () => (await request<Ticket>('engineer', 'ticket/' + running.id, 200)).runs.find(run => run.state === 'claimed'));
  await request('engineer', actions.remove, 200, { member: 'retail' });
  await request('engineer', actions.remove, 200, { member: 'retail' });
  for (const route of ['project/store/usage', 'project/store/messages', 'knowledge/store', 'ticket/' + shared.id])
    await request('retail', route, 404);
  await request('retail', 'project/child/messages', 200);
  assert.deepEqual(await request('retail', 'request/' + running.trigger, 200), { ticket: null });
  await waitFor(async () => {
    const ticket = await request<Ticket>('engineer', 'ticket/' + running.id, 200);
    return ticket.runs.every(run => run.state === 'cancelled') && !ticket.result ? true : undefined;
  });

  await stop();
  await launch();
  assert.equal((await request<ReturnType<Collaboration['projectAccess']>>('engineer', 'project/store/access', 200)).knowledgeAccessHours, 3);
  assert.ok(!(await catalog('reader')).some(row => row.id === replacement.id));
  await request('retail', 'ticket/' + shared.id, 404);
  await login('new-staff', recovered);
  await request('new-staff', 'ticket', 403, mandate('重启后仍只读'));
  await request('product', 'project/store/member', 403, { member: 'retail' });
  await request('engineer', 'project/store/member', 200, { member: 'retail' });
  assert.ok(!(await request<Overview>('engineer', 'overview', 200)).needsYou.some(row => row.subject === abandoned.trigger));
  const restored = await request<Ticket>('retail', 'ticket/' + shared.id, 200);
  assert.equal(restored.requests.find(item => item.id === grant.id)?.state, 'revoked');
  assert.equal(restored.result, undefined);
  await request('retail', 'ticket/' + shared.id + '/access/' + grant.id, 409, { state: 'granted' });
  assert.match(await readFile(policyFile, 'utf8'), /contractor-platform-capabilities-v1/);
});
