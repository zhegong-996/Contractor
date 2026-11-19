import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { imConnections, imLoginSettings } from '../src/workbench/im-login-providers.ts';
import { imReturnPath, openIMLogin } from '../src/workbench/im-login.ts';

const providers = {
  feishu: { appId: 'cli_fixture', tenantKey: 'tenant_fixture', secretEnv: 'CONTRACTOR_FIXTURE_FEISHU' },
  dingtalk: { appId: 'ding_fixture', secretEnv: 'CONTRACTOR_FIXTURE_DINGTALK' },
  wecom: { corpId: 'ww_fixture', agentId: '1000001', secretEnv: 'CONTRACTOR_FIXTURE_WECOM' },
  wechat: { appId: 'wx_fixture', secretEnv: 'CONTRACTOR_FIXTURE_WECHAT' },
};
const env = Object.fromEntries(Object.values(providers).map(row => [row.secretEnv, 'only-fixture-secret']));
const settings = imLoginSettings.parse({ primary: 'feishu', providers });
const team = 'https://contractor-login.invalid';
const callback = team + '/api/auth/im/callback';

test('四个 IM 登录应用用各自的授权和身份接口，企业身份按签发应用核对', async () => {
  let tenant = 'tenant_fixture', memberType = 0, wecomInside = true, wechatIdentity = 'wechat-person';
  const calls: { address: URL; options: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, options) => {
    const address = new URL(String(input));
    calls.push({ address, options });
    switch (address.pathname) {
      case '/open-apis/authen/v2/oauth/token': return Response.json({ access_token: 'feishu-token' });
      case '/open-apis/authen/v1/user_info': return Response.json({ code: 0, data: { tenant_key: tenant, open_id: 'ou_demo', name: '飞书成员' } });
      case '/v1.0/oauth2/userAccessToken': return Response.json({ accessToken: 'ding-user' });
      case '/v1.0/oauth2/accessToken': return Response.json({ accessToken: 'ding-app' });
      case '/v1.0/contact/users/me': return Response.json({ unionId: 'ding-person', nick: '钉钉成员' });
      case '/topapi/user/getbyunionid': return Response.json({ errcode: 0, result: { contact_type: memberType, userid: 'staff-id' } });
      case '/cgi-bin/gettoken': return Response.json({ errcode: 0, access_token: 'wecom-app' });
      case '/cgi-bin/auth/getuserinfo': return Response.json({ errcode: 0, ...(wecomInside ? { userid: 'enterprise-id' } : { openid: 'visitor' }) });
      case '/sns/oauth2/access_token': return Response.json({ access_token: 'wechat-token', openid: 'wechat-person' });
      case '/sns/userinfo': return Response.json({ openid: wechatIdentity, nickname: '微信账号' });
      default: assert.fail('unexpected request ' + address.pathname);
    }
  };
  const connections = imConnections(settings, 'cli_fixture', fetcher, env);
  assert.deepEqual([...connections.keys()], ['feishu', 'dingtalk', 'wecom', 'wechat']);
  assert.equal(imConnections(settings, undefined, fetcher, {}).size, 0);
  const oauth = { redirect: callback, state: 'test-state', verifier: 'fixture-verifier' };
  const feishu = connections.get('feishu')!;
  const request = feishu.authorize(oauth);
  assert.equal(request.origin, 'https://accounts.feishu.cn');
  assert.equal(request.searchParams.get('target_tenant'), tenant);
  assert.equal(request.searchParams.get('code_challenge'), createHash('sha256').update(oauth.verifier).digest('base64url'));
  const verified = await feishu.verify('code', oauth);
  assert.deepEqual(verified.channel, { provider: 'feishu', namespace: 'cli_fixture', id: 'ou_demo', label: '飞书成员' });
  assert.equal(JSON.parse(String(calls[0]?.options?.body)).code_verifier, oauth.verifier);
  assert.equal(calls[0]?.options?.redirect, 'error');
  assert.equal((await imConnections(settings, 'another-app', fetcher, env).get('feishu')!.verify('code', oauth)).channel, undefined);
  tenant = 'another_tenant';
  await assert.rejects(feishu.verify('code', oauth), { status: 403 });
  const ding = connections.get('dingtalk')!;
  assert.equal(ding.authorize(oauth).host, 'login.dingtalk.com');
  assert.equal((await ding.verify('code', oauth)).label, '钉钉成员');
  assert.equal(calls.find(row => row.address.pathname === '/topapi/user/getbyunionid')?.address.searchParams.get('access_token'), 'ding-app');
  memberType = 1;
  await assert.rejects(ding.verify('code', oauth), { status: 403 });
  const enterprise = connections.get('wecom')!;
  assert.equal(enterprise.authorize(oauth).searchParams.get('login_type'), 'CorpApp');
  assert.equal(enterprise.authorize({ ...oauth, inWeCom: true }).searchParams.get('scope'), 'snsapi_base');
  assert.equal((await enterprise.verify('code', oauth)).label, 'enterprise-id');
  wecomInside = false;
  await assert.rejects(enterprise.verify('code', oauth), { status: 403 });
  const wechat = connections.get('wechat')!;
  assert.equal(wechat.authorize(oauth).searchParams.get('scope'), 'snsapi_login');
  assert.equal((await wechat.verify('code', oauth)).label, '微信账号');
  wechatIdentity = 'different-user';
  await assert.rejects(wechat.verify('code', oauth), { status: 403 });
});

test('浏览器授权只消费一次，切换主 IM 作废未完成请求并保留已配置的偏好', async t => {
  const prior = process.env.CONTRACTOR_FIXTURE_FEISHU;
  const priorDing = process.env.CONTRACTOR_FIXTURE_DINGTALK;
  process.env.CONTRACTOR_FIXTURE_FEISHU = env.CONTRACTOR_FIXTURE_FEISHU!;
  process.env.CONTRACTOR_FIXTURE_DINGTALK = env.CONTRACTOR_FIXTURE_DINGTALK!;
  const db = new DatabaseSync(':memory:');
  t.after(() => {
    db.close();
    if (prior === undefined) delete process.env.CONTRACTOR_FIXTURE_FEISHU; else process.env.CONTRACTOR_FIXTURE_FEISHU = prior;
    if (priorDing === undefined) delete process.env.CONTRACTOR_FIXTURE_DINGTALK; else process.env.CONTRACTOR_FIXTURE_DINGTALK = priorDing;
  });
  let calls = 0;
  const fetcher: typeof fetch = async input => {
    calls++;
    return String(input).endsWith('user_info')
      ? Response.json({ code: 0, data: { tenant_key: 'tenant_fixture', open_id: 'ou_demo' } })
      : Response.json({ access_token: 'fixture-token' });
  };
  const login = openIMLogin(db, settings, team, undefined, fetcher);
  const request = login.begin('#/store/work/example');
  const params = new URLSearchParams({ code: 'fixture', state: new URL(request.location).searchParams.get('state')! });
  await assert.rejects(login.finish(params, undefined, () => false), { status: 409 });
  assert.equal(calls, 0);
  const verified = await login.finish(params, request.proof, () => false);
  assert.equal(verified.to, '/#/store/work/example');
  assert.ok('identity' in verified);
  await assert.rejects(login.finish(params, request.proof, () => false), { status: 409 });
  assert.equal(calls, 2);
  assert.equal(login.requestRegistration('feishu', verified.identity), 'pending');
  assert.equal(login.requestRegistration('feishu', verified.identity), 'pending');
  assert.equal(login.registrations().length, 1);
  const pending = login.begin('//example.invalid/');
  params.set('state', new URL(pending.location).searchParams.get('state')!);
  assert.throws(() => login.select({ primary: 'dingtalk', legacyPassword: false }, []), { status: 409 });
  login.select({ primary: 'dingtalk', legacyPassword: true }, []);
  await assert.rejects(login.finish(params, pending.proof, () => false), { status: 409 });
  assert.equal(login.registrations().length, 0);
  assert.equal(openIMLogin(db, settings, team).view().primary, 'dingtalk');
  for (const value of ['//example.invalid/', '#//example.invalid/', 'https://example.invalid', '#/store\\work'])
    assert.equal(imReturnPath(value), '/');
});

test('工作台回调、开通、原账号绑定、项目授权和停止口令登录通过实际 HTTP 链路', { timeout: 30000 }, async t => {
  const state = await mkdtemp(path.join(tmpdir(), 'contractor-im-login-'));
  const oldState = process.env.COLLAB_STATE_DIR;
  process.env.COLLAB_STATE_DIR = state;
  let service: ChildProcess | undefined;
  t.after(async () => {
    if (service && service.exitCode === null && service.signalCode === null) {
      const done = once(service, 'exit'); service.kill('SIGTERM'); await done;
    }
    if (oldState === undefined) delete process.env.COLLAB_STATE_DIR; else process.env.COLLAB_STATE_DIR = oldState;
    await rm(state, { recursive: true, force: true });
  });
  await mkdir(path.join(state, 'console'));
  const password = randomUUID();
  const { ConsoleAuth } = await import('../src/console-auth.ts');
  const auth = new ConsoleAuth(); await auth.ready(); await auth.bootstrapOwner('owner', password);
  await auth.createAccount('admin', password, 'admin', 'owner');
  await auth.createAccount('other', password, 'operator', 'owner');
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  const runnerListener = createServer().listen(0, '127.0.0.1');
  await once(runnerListener, 'listening');
  const runnerAddress = runnerListener.address();
  assert.ok(runnerAddress && typeof runnerAddress !== 'string');
  await new Promise<void>(resolve => runnerListener.close(() => resolve()));
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const origin = 'http://127.0.0.1:' + address.port;
  const runnerOrigin = 'https://contractor-runner.invalid';
  await writeFile(path.join(state, 'workbench.json'), JSON.stringify({
    port: address.port, workbenchPublicUrl: team, remoteRunnerPort: runnerAddress.port, runnerConnectUrl: runnerOrigin, imLogin: settings,
    projects: [{ id: 'store', title: '门店推荐理由', members: ['owner'], maintainers: ['owner'] }],
    functions: [{ id: 'review', title: '核对' }], agents: [],
  }));
  const preload = path.join(state, 'oauth-fixture.mjs');
  await writeFile(preload, `
    const native = globalThis.fetch;
    globalThis.fetch = async (input, opts) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.weixin.qq.com') {
        if (url.pathname === '/sns/oauth2/access_token')
          return Response.json({access_token:'wechat-fixture-token',openid:'wx_'+url.searchParams.get('code')});
        if (url.pathname === '/sns/userinfo')
          return Response.json({openid:url.searchParams.get('openid'),nickname:'微信联调成员'});
      }
      if (url.hostname !== 'open.feishu.cn') return native(input, opts);
      if (url.pathname.endsWith('/oauth/token')) return Response.json({access_token: JSON.parse(opts.body).code});
      if (url.pathname.endsWith('/user_info')) {
        const code=opts.headers.authorization.slice('Bearer '.length);
        const person=code==='newbie-refresh'?'newbie':code;
        return Response.json({code:0,data:{tenant_key:person==='outside'?'wrong_tenant':'tenant_fixture',open_id:'ou_'+person,
          name:code==='newbie-refresh'?'新版飞书名':person,avatar_thumb:'https://s3-imfile.feishucdn.com/avatar/'+code+'.png'}});
      }
      return new Response('', {status:404});
    };
  `);
  service = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(preload).href, 'src/workbench/server.ts'], {
    env: { ...process.env, ...env, COLLAB_STATE_DIR: state, CONTRACTOR_PAUSE_NOTIFICATIONS: '1' }, stdio: 'ignore',
  });
  for (let n = 0; n < 100; n++) {
    assert.equal(service.exitCode, null);
    if (await fetch(origin + '/health').then(response => response.ok).catch(() => false)) break;
    await delay(70);
  }
  const request = (route: string, cookie?: string, body?: object, requestOrigin = team, site = team) => new Promise<Response>((resolve, reject) => {
    const outgoing = httpRequest(origin + route, { method: body ? 'POST' : 'GET',
      headers: { Host: new URL(site).host, ...(cookie && { cookie }),
        ...(body && { Origin: requestOrigin, 'Content-Type': 'application/json' }) } }, async incoming => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const headers = new Headers();
        for (const [index, value] of incoming.rawHeaders.entries())
          if (index % 2 === 1) headers.append(incoming.rawHeaders[index - 1]!, value);
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers }));
      } catch (error) { reject(error); }
    });
    outgoing.on('error', reject);
    outgoing.end(body && JSON.stringify(body));
  });
  const api = (route: string, cookie?: string, body?: object, requestOrigin = team) => request('/api/' + route, cookie, body, requestOrigin);
  const cookie = (response: Response, name: string) => response.headers.getSetCookie().find(value => value.startsWith(name + '='))?.split(';')[0];
  async function passwordLogin(username: string, expected = 200) {
    const response = await api('login', undefined, { username, password });
    assert.equal(response.status, expected, await response.clone().text());
    return cookie(response, 'contractor_console');
  }
  const owner = (await passwordLogin('owner'))!, admin = (await passwordLogin('admin'))!, other = (await passwordLogin('other'))!;
  type Pending = { id: string; displayName: string; provider: string };
  async function pending(): Promise<Pending[]> {
    const { imPending } = await api('admin/members', admin).then(response => response.json());
    return imPending;
  }
  async function begin(next = '#/store/work/example') {
    const response = await api('auth/im/start?next=' + encodeURIComponent(next));
    assert.equal(response.status, 303);
    assert.match(response.headers.getSetCookie()[0]!, /HttpOnly.*SameSite=Lax.*Secure.*Max-Age=/);
    return { state: new URL(response.headers.get('location')!).searchParams.get('state')!,
      proof: cookie(response, 'contractor_im_oauth')! };
  }
  const complete = (code: string, step: { state: string; proof?: string }, session?: string) =>
    api('auth/im/callback?' + new URLSearchParams({ code, state: step.state }), [step.proof, session].filter(Boolean).join('; '));
  const step = await begin();
  const noProof = await complete('newbie', { state: step.state });
  assert.match(noProof.headers.get('location')!, /im=expired/);
  const opening = await complete('newbie', step);
  assert.equal(opening.headers.get('location'), '/?im=pending#/store/work/example');
  assert.equal(cookie(opening, 'contractor_console'), undefined);
  assert.match((await complete('newbie', step)).headers.get('location')!, /im=expired/);
  assert.match((await complete('outside', await begin())).headers.get('location')!, /im=failed/);
  assert.equal((await api('overview')).status, 401);
  await complete('newbie', await begin());
  const applications = await pending();
  assert.equal(applications.length, 1);
  assert.equal(applications[0]?.provider, 'feishu');
  assert.doesNotMatch(JSON.stringify(applications), /ou_newbie|only-fixture-secret/);
  const approve = 'admin/im-registration/' + applications[0]!.id;
  assert.equal((await api(approve, admin, { action: 'approve', username: 'new-staff', role: 'admin' })).status, 403);
  assert.equal((await api(approve, admin, { action: 'approve', username: 'owner', role: 'operator' })).status, 409);
  assert.equal((await api(approve, admin, { action: 'approve', username: 'new-staff', role: 'operator' })).status, 200);
  const entered = await complete('newbie', await begin());
  assert.equal(entered.headers.get('location'), '/#/store/work/example');
  const staff = cookie(entered, 'contractor_console')!;
  const overview = () => api('overview', staff).then(response => response.json());
  assert.deepEqual((await overview()).projects, []);
  assert.equal((await api('admin/members', staff)).status, 403);
  assert.equal((await api('project/store/member', owner, { member: 'new-staff', role: 'reader' })).status, 200);
  assert.equal((await overview()).projects[0]?.mayStart, false);
  const profilePath = 'account/profile';
  const profile = () => api(profilePath, staff).then(response => response.json());
  const source = await profile();
  assert.equal(source.syncedName, 'newbie');
  assert.deepEqual(source.avatar, { kind: 'image', src: 'https://s3-imfile.feishucdn.com/avatar/newbie.png' });
  const custom = { displayName: '门店协作者', bio: '负责推荐理由与小屏验收', avatar: { kind: 'preset', id: 'summit' } };
  assert.equal((await api(profilePath, staff, { ...custom, username: 'owner' })).status, 400);
  assert.equal((await api(profilePath, staff, custom, 'https://wrong.invalid')).status, 403);
  assert.equal((await api(profilePath, staff, custom)).status, 200);
  const refreshed = await complete('newbie-refresh', await begin());
  assert.ok(cookie(refreshed, 'contractor_console'), 'sync retained the same login identity');
  const saved = await profile();
  assert.equal(saved.username, 'new-staff');
  assert.equal(saved.displayName, custom.displayName);
  assert.equal(saved.bio, custom.bio);
  assert.equal(saved.syncedName, '新版飞书名');
  assert.deepEqual(saved.avatar, custom.avatar);
  assert.ok(saved.syncedAvatar.src.endsWith('/newbie-refresh.png'));
  const reset = await api(profilePath, staff, { ...custom, displayName: '', avatar: { kind: 'auto' } }).then(response => response.json());
  assert.equal(reset.displayName, saved.syncedName);
  assert.deepEqual(reset.avatar, saved.syncedAvatar);
  assert.equal((await api(profilePath, staff, { ...custom, avatar: { kind: 'upload', image: 'aGVsbG8=' } })).status, 400);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAApElEQVR4nO3QQQ0AIBDAsFODRFziCQd82aPJBCydtY8ezfeDeIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQD+751rG76Ed96kAAAAASUVORK5CYII=';
  const uploaded = await api(profilePath, staff, { ...custom, avatar: { kind: 'upload', image: png } }).then(response => response.json());
  const asset = uploaded.avatar.src;
  const image = await request(asset, owner);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, 'base64'));
  assert.equal((await request(asset, other)).status, 404);
  assert.equal((await request(asset)).status, 401);
  assert.equal((await api('project/store/member', owner, { member: 'other', role: 'reader' })).status, 200);
  assert.equal((await request(asset, other)).status, 200);
  const roster = (await api('overview', owner).then(response => response.json())).projects[0].members;
  assert.equal(roster.find((row: { name: string }) => row.name === 'new-staff')?.displayName, custom.displayName);
  assert.equal((await api('project/store/member/remove', owner, { member: 'new-staff' })).status, 200);
  assert.deepEqual((await overview()).projects, []);
  assert.equal((await request(asset, other)).status, 404);
  assert.equal((await request(asset, staff)).status, 200, 'the member can still read their own profile');
  await passwordLogin('new-staff', 401);
  assert.equal((await api('admin/im-login', admin, { primary: 'feishu', legacyPassword: false })).status, 403);
  assert.equal((await api('admin/im-login', owner, { primary: 'feishu', legacyPassword: false })).status, 409);
  assert.equal((await api('account/im-link', owner, {}, 'https://wrong.invalid')).status, 403);
  async function link(session = owner, provider?: string) {
    const response = await api('account/im-link', session, { provider });
    assert.equal(response.status, 200);
    const { location } = await response.json();
    return { proof: cookie(response, 'contractor_im_oauth')!, state: new URL(location).searchParams.get('state')! };
  }
  assert.equal((await complete('ownerid', await link(), other)).headers.get('location'), '/?im=expired#/account');
  assert.equal((await complete('newbie', await link(), owner)).headers.get('location'), '/?im=conflict#/account');
  assert.equal((await complete('ownerid', await link(), owner)).headers.get('location'), '/?im=linked#/account');
  assert.equal((await api('admin/im-login', owner, { primary: 'feishu', legacyPassword: false })).status, 200);
  await passwordLogin('owner', 403);
  assert.equal((await api('overview', owner)).status, 401);
  const federatedOwner = cookie(await complete('ownerid', await begin()), 'contractor_console')!;
  assert.equal((await api('overview', federatedOwner).then(response => response.json())).actor, 'owner');
  const device = randomUUID();
  const enrollment = await fetch('http://127.0.0.1:' + runnerAddress.port + '/api/runner/enroll', {
    method: 'POST', headers: { authorization: 'Bearer ' + randomBytes(32).toString('base64url'), 'content-type': 'application/json' },
    body: JSON.stringify({ id: device, name: '隔离配对', engines: ['codex'] }),
  });
  assert.equal(enrollment.status, 200);
  const devicePage = '/runner/connect/' + device;
  const prompt = await request(devicePage, undefined, undefined, runnerOrigin, runnerOrigin).then(response => response.text());
  assert.match(prompt, /使用飞书登录/);
  assert.ok(prompt.includes(team + '/api/auth/im/start?next='));
  assert.doesNotMatch(prompt, /name="password"/);
  const approvedBrowser = await complete('ownerid', await begin(devicePage));
  assert.equal(approvedBrowser.headers.get('location'), devicePage);
  const signedInDevicePage = await request(devicePage, cookie(approvedBrowser, 'contractor_console')).then(response => response.text());
  assert.match(signedInDevicePage, /当前账号没有可连接的项目 Agent/);
  assert.equal((await api('admin/members/new-staff/status', federatedOwner, { enabled: false })).status, 200);
  assert.equal((await api('overview', staff)).status, 401);
  assert.match((await complete('newbie', await begin())).headers.get('location')!, /im=blocked/);
  assert.equal((await complete('ownerid', await link(federatedOwner, 'wechat'), federatedOwner)).headers.get('location'), '/?im=linked#/account');
  assert.equal((await api('admin/im-login', federatedOwner, { primary: 'wechat', legacyPassword: false })).status, 200);
  assert.equal((await api('overview', federatedOwner)).status, 401);
  assert.equal((await api('session').then(response => response.json())).imLogin.provider, 'wechat');
  const migratedOwner = cookie(await complete('ownerid', await begin()), 'contractor_console')!;
  assert.equal((await api('overview', migratedOwner).then(response => response.json())).actor, 'owner');
});
