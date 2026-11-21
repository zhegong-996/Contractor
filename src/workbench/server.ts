import { codeDeltaSchema } from './code-bundle.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { root, runtime } from '../config.ts';
import { ConsoleAuth, CONSOLE_ROLES, consoleCookieName } from '../console-auth.ts';
import { command } from '../commands.ts';
import { sendFeishu } from '../upstream.ts';
import { loadSettings, title } from './config.ts';
import { openCollaboration } from './collaboration.ts';
import { WorkbenchError } from './errors.ts';
import { measureSchema, observationSchema } from './learning.ts';
import type { PlatformActor } from './channel-links.ts';
import { commitSha, deploymentSelectionSchema } from './github-delivery.ts';
import { referenceSchema, resourceSource, topicInputSchema } from './project-resources.ts';
import { feishuCardTransport } from './feishu-cards.ts';
import { openIntake } from './intake.ts';
import { watchFigmaKnowledge } from './knowledge-sources.ts';
import { localDeviceKey } from './devices.ts';
import { runnerConnectInput, runnerRequestId, runnerSecret } from './runner-connection.ts';
import { runnerConnectPage } from './runner-connect-page.ts';
import { pointLimitInput, pointPolicyUpdate } from './token-points.ts';
import { octopIMNativeId } from './octop-im-contract.ts';
import { acquireStateLease } from './state-lease.ts';
import { notificationGuard } from './notification-guard.ts';
import { permissionAdmin } from './permission-admin.ts';
import { AccountRecovery } from './account-recovery.ts';
import { feishuActivationName } from './account-activation.ts';
import { modelProvider, modelServiceUpdate, projectRoutingUpdate } from './operations-settings.ts';
import { assistantUpdate } from './platform-assistant.ts';
import { personalAgentInput } from './personal-agent.ts';
import { imLoginCookie, imReturnPath, withIMStatus } from './im-login.ts';
import { imAvatarOrigins, imProvider, imProviderNames } from './im-login-providers.ts';
import { profileUpdate } from './member-profile.ts';
import { humanCheckInput, manualCasesInput } from './product-verification.ts';
import { regressionCaseInput, regressionCompareInput } from './regression-review.ts';
import { deviceRouteInput } from './device-routing.ts';
import { configuredEnv, formerName } from './compatibility.ts';
import { PluginHost } from './capabilities.ts';
import { platformPlugins } from './platform-plugins.ts';
import { ticketListStates } from './ticket-list-state.ts';

const stateDir = process.env.COLLAB_STATE_DIR;
if (!stateDir || !path.isAbsolute(stateDir)) throw new Error('请提供独立工作台的 COLLAB_STATE_DIR 绝对路径。');

const auth = new ConsoleAuth();
await mkdir(runtime(), { recursive: true, mode: 0o700 });
async function prepareAuth() {
  await mkdir(runtime('console'), { recursive: true, mode: 0o700 });
  await writeFile(runtime('secrets.json'), JSON.stringify({ jwtSecret: randomBytes(32).toString('hex') }),
    { mode: 0o600, flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await auth.ready();
}
const nonce = z.string().uuid();
const id = z.string().min(1).max(80);
const username = z.string().regex(/^[a-zA-Z0-9_-]{2,32}$/);
const newPassword = z.string().min(8).max(300);
const projectMemberRole = z.enum(['collaborator', 'reader']);
const prose = z.string().trim().min(1).max(3500);
const provider = z.enum(['feishu', 'github', 'octop']);
const accountRef = z.object({ provider, namespace: z.string().min(1).max(180), id: octopIMNativeId });
const githubUrl = z.url({ protocol: /^https$/, hostname: /^github\.com$/ });
const knowledgeRevision = z.string().regex(/^[a-f0-9]{64}$/);
const knowledgeRef = z.object({ id, revision: knowledgeRevision }).strict();
const octopSlug = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const octopExpertSpec = z.object({ title, capability: z.string().trim().min(1).max(400), function: octopSlug,
  instructions: z.string().trim().min(1).max(5000) }).strict();
const materials = z.array(id).max(8);
const budgetLimit = z.object({ period: z.enum(['day', 'month']), limit: z.number().int().min(0).max(100000).nullable(),
  maxMinutes: z.number().int().min(1).max(8).optional() });
const channelDecision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link'), ticket: id }),
  z.object({ action: z.literal('create'), project: id.optional(), topic: id.optional(), agent: id.optional(), parent: id.optional(),
    brief: prose.optional(), separate: z.boolean().optional(), material: materials.optional(), target: z.string().max(180).optional() }),
  z.object({ action: z.literal('project') }),
  z.object({ action: z.literal('topic'), topic: id }),
  z.object({ action: z.literal('dismiss') }),
]);
const selectedMessage = { message: id.optional() };
const discussionDecision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('project'), ...selectedMessage }).strict(),
  z.object({ action: z.literal('topic'), topic: id, ...selectedMessage }).strict(),
  z.object({ action: z.literal('link'), ticket: id, ...selectedMessage }).strict(),
  z.object({ action: z.literal('create'), agent: id.optional(), topic: id.optional(), ...selectedMessage }).strict(),
  z.object({ action: z.literal('dismiss'), ...selectedMessage }).strict(),
]);
const settingsRoutes = {
  start: z.object({ project: id, title, request: prose, nonce, material: materials.default([]),
    resources: z.array(z.string().max(180)).max(12).default([]), target: z.string().max(180).optional(), topic: id.optional(),
    priority: z.enum(['normal', 'urgent']).default('normal'), agent: id.optional(), function: id.optional(), parent: id.optional(), measure: measureSchema.optional(), reusedLesson: id.optional(),
    recall: z.boolean().optional(), personal: z.boolean().optional(), device: z.uuid().optional(),
    reuseAcceptance: z.boolean().optional(), productCases: manualCasesInput.optional() }).strict(),
  answer: z.object({ card: z.number().int().positive(), choice: z.number().int().nonnegative().optional(), text: prose.optional(), nonce }).strict(),
  accept: z.object({ revision: z.string().length(64), commit: z.string().regex(/^[a-f0-9]{40}$/).optional(), deployment: deploymentSelectionSchema.optional(),
    body: z.string().trim().max(16000).default(''), conditions: z.string().trim().max(600).default('') }).strict(),
  add: z.object({ title, body: z.string().trim().min(1).max(16000), conditions: z.string().trim().max(600).default(''),
    kind: z.enum(['reference', 'procedure', 'decision']), visibility: z.enum(['project', 'restricted']), replaces: knowledgeRef.optional(),
    directory: z.enum(['requestable', 'hidden']).optional() }).strict(),
  access: z.object({ entry: id, reason: prose }).strict(),
  changeAccess: z.object({ state: z.enum(['granted', 'revoked']), hours: z.number().int().min(1).max(168).optional() }).strict(),
  publish: z.object({ revision: knowledgeRevision, replaces: knowledgeRef.optional() }).strict(),
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function browserCookie(value: string, origin: string, scope = '/') {
  return value + '; HttpOnly; SameSite=Lax; Path=' + scope + (origin.startsWith('https://') ? '; Secure' : '');
}

function sessionCookies(cookie: string | undefined, origin: string) {
  const empty = consoleCookieName + '=';
  return [cookie ? browserCookie(cookie, origin) : browserCookie(empty, origin) + '; Max-Age=0',
    browserCookie(empty, origin, '/runner/connect/') + '; Max-Age=0'];
}

function cookieValue(req: IncomingMessage, name: string) {
  return req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1);
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { location }).end();
}

function replyError(res: ServerResponse, error: unknown) {
  if (error instanceof WorkbenchError) json(res, error.status, { error: error.message });
  else if (error instanceof z.ZodError || error instanceof SyntaxError) json(res, 400, { error: '请检查输入的格式与长度。' });
  else { console.error('Contractor请求失败：', String(error)); json(res, 500, { error: '操作暂未完成，请刷新状态后重试。' }); }
}

async function serve(release: () => void) {
  const config = await loadSettings();
  const capabilities = platformPlugins(config);
  const checkKnowledge = async () => {
    try { return await capabilities.use('memory').health(); }
    catch { return { state: 'unavailable' as const, mode: 'local' as const, checkedAt: Date.now() }; }
  };
  const plugins = new PluginHost();
  const outbound = notificationGuard(configuredEnv('CONTRACTOR_PAUSE_NOTIFICATIONS') === '1',
    configuredEnv('CONTRACTOR_TEST_DINGTALK_CONNECTOR'), configuredEnv('CONTRACTOR_TEST_FEISHU_REPLY'));
  const deviceKey = Buffer.from(await localDeviceKey(), 'hex');
  const feishu = config.feishu;
  const recoveryUrl = feishu && config.crossChannel ? 'https://applink.feishu.cn/client/bot/open?appId=' + encodeURIComponent(feishu.appId) : undefined;
  const verifyActivation = !config.imLogin && recoveryUrl && feishu ? (sender: PlatformActor) => feishuActivationName(feishu.profile, sender) : undefined;
  const recoveryCode = z.string().regex(/^[a-f0-9]{32}$/);
  const activationRequest = z.object({ id: recoveryCode, token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
  let work: Awaited<ReturnType<typeof openCollaboration>> | undefined;
  const recovery = new AccountRecovery((sender, at) => work?.channelMember(sender, at),
    name => auth.listAccounts().some(row => !row.disabled && row.username === name && !!row.passwordHash));
  let accessAdmin: ReturnType<typeof permissionAdmin> | undefined;
  let intake: Awaited<ReturnType<typeof openIntake>> | undefined;
  const channelAccounts = config.crossChannel || config.octop?.channels?.length;
  let available = false;
  const connectionUrl = config.runnerConnectUrl && new URL(config.runnerConnectUrl);
  const publicWorkbench = config.workbenchPublicUrl ? new URL(config.workbenchPublicUrl) : undefined;
  const sessionFor = (req: IncomingMessage) => auth.sessionFromRequest(req.headers.cookie, work?.imLogin.allowsSession);
  const staticRoot = configuredEnv('CONTRACTOR_UI_DIR') ?? path.join(root, 'dist', 'workbench');
  if (!path.isAbsolute(staticRoot)) throw new Error('CONTRACTOR_UI_DIR 须为前端构建产物的绝对路径。');
  const assets = new Map([
    ['/', [path.join(staticRoot, 'index.html'), 'text/html'] ],
    ['/licenses/components', [path.join(staticRoot, 'component-licenses.txt'), 'text/plain']],
    ['/licenses/browser-dependencies', [path.join(staticRoot, 'browser-dependency-licenses.txt'), 'text/plain']],
  ]);

  async function runnerRequest(req: IncomingMessage, res: ServerResponse, action: string, remote = false) {
    if (!work) throw new WorkbenchError('工作台正在启动。', 503);
    const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (action === 'protocol') {
      if (!remote) throw new WorkbenchError('找不到执行端操作。', 404);
      if (!token) throw new WorkbenchError('请使用已配对的执行端。', 401);
      const { id } = z.object({ id: runnerRequestId }).strict().parse(await body(req, 4096));
      const state = work.deviceProtocol(token);
      if (id !== state.id) throw new WorkbenchError('执行端身份与配对记录不符。', 403);
      json(res, 200, { ...state, driver: config.executionRuntime });
      return;
    }
    if (action !== 'pair' && (req.headers['x-contractor-execution'] ?? 'autoloop') !== config.executionRuntime)
      throw new WorkbenchError('执行端协议和工作台调度器不一致。', 409);
    const driver = config.executionRuntime === 'contractor' ? { driver: 'contractor' } : {};
    if (action !== 'pair') {
      if (!token) throw new WorkbenchError('请使用已配对的执行端。', 401);
      work.authenticateDevice(token, remote);
    }
    const native = await body(req, action === 'result' ? 12 * 1024 * 1024 : 65000);
    if (action === 'pair') {
      const input = z.object({ code: z.string().regex(/^[a-f0-9]{24}$/), name: title,
        host: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(native);
      if (remote ? !!input.host : !input.host || !timingSafeEqual(deviceKey, Buffer.from(input.host, 'hex')))
        throw new WorkbenchError('请通过配对码对应的执行端入口。', 403);
      json(res, 200, { ...work.pairDevice(input.code, input.name, remote), ...driver });
      return;
    }
    if (!token) throw new WorkbenchError('请使用已配对的执行端。', 401);
    if (action === 'work') {
      const input = z.object({ claim: nonce, wait: z.number().min(0).max(50), capacity: z.boolean(),
        running: z.array(z.number().int().positive()).max(1), engines: z.array(z.enum(['codex', 'claude'])).max(2).optional() }).strict().parse(native);
      json(res, 200, await work.deviceWork(token, input, remote));
    } else if (action === 'started' || action === 'result') {
      const input = z.object({ run: z.number().int().positive(), lease: z.string().min(1).max(500), value: z.unknown(),
        stop: z.object({ attempt: z.number().int().positive(), state: z.enum(['exited', 'not-launched']),
          model: title.optional(), code: codeDeltaSchema.optional(), usageCoverage: z.literal('partial').optional() }).strict().optional() }).strict().parse(native);
      const value = action === 'started'
        ? work.deviceStarted(token, input.run, input.lease, z.object({ session: z.string().min(1).max(240), link: z.string().max(1000).optional() }).strict().parse(input.value), remote)
        : await work.deviceResult(token, input.run, input.lease, input.value as Parameters<typeof work.deviceResult>[3], remote, input.stop);
      json(res, 200, value ?? { ok: true });
    } else if (action === 'offline') {
      work.deviceOffline(token, remote);
      json(res, 200, { ok: true });
    } else throw new WorkbenchError('找不到执行端操作。', 404);
  }

  // Forward only this listener through an authenticated tunnel or TLS proxy.
  const remoteServer = config.remoteRunnerPort && createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    try {
      const route = /^\/api\/runner\/(pair|work|started|result|offline|enroll|enroll-status|protocol)$/.exec(req.url ?? '');
      if (req.method !== 'POST' || !route) throw new WorkbenchError('未找到。', 404);
      if (req.headers.origin || req.headers.cookie) throw new WorkbenchError('请使用配对的执行端连接。', 403);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new WorkbenchError('请求格式无效。', 415);
      if (route[1] === 'enroll' || route[1] === 'enroll-status') {
        if (!connectionUrl || !work) throw new WorkbenchError('团队尚未启用浏览器连接。', 404);
        const secret = runnerSecret.safeParse(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]);
        if (!secret.success) throw new WorkbenchError('缺少此执行端的连接凭据。', 401);
        const input = await body(req, 4096);
        if (route[1] === 'enroll') {
          json(res, 200, work.beginDeviceEnrollment(runnerConnectInput.parse(input), secret.data));
        } else {
          const accepted = work.finishDeviceEnrollment(z.object({ id: runnerRequestId }).strict().parse(input).id, secret.data);
          json(res, 200, 'pending' in accepted || config.executionRuntime !== 'contractor' ? accepted : { ...accepted, driver: 'contractor' });
        }
        return;
      }
      await runnerRequest(req, res, route[1]!, true);
    } catch (error) { replyError(res, error); }
  });

  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const confirmation = /^\/runner\/connect\/([a-f0-9-]+)$/.exec(url.pathname);
      const runnerOrigin = connectionUrl && (config.imLogin && publicWorkbench && req.headers.host === publicWorkbench.host
        ? publicWorkbench : req.headers.host === connectionUrl.host ? connectionUrl : undefined);
      if (confirmation && runnerOrigin) {
        if (!work) throw new WorkbenchError('工作台正在启动。', 503);
        res.setHeader('referrer-policy', 'same-origin');
        const requestId = runnerRequestId.parse(confirmation[1]);
        const login = work.imLogin.browser(runnerOrigin.origin);
        const oauth = login.ready && login.origin && login.provider ? { label: imProviderNames[login.provider],
          url: login.origin + '/api/auth/im/start?next=' + encodeURIComponent(url.pathname) } : undefined;
        const page = (status: number, view?: ReturnType<NonNullable<typeof work>['deviceEnrollment']>, error?: string) => {
          const nonce = randomBytes(18).toString('base64');
          res.setHeader('content-security-policy', "default-src 'none'; style-src 'nonce-" + nonce + "'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
          res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(runnerConnectPage(nonce, view, error, {
            oauth, password: login.legacyPassword, workbench: publicWorkbench?.href ?? runnerOrigin.href,
            expired: status === 404,
          }));
        };
        const signedIn = sessionFor(req)?.username;
        const actor = signedIn && auth.listAccounts().some(item => item.username === signedIn && !item.disabled) ? signedIn : undefined;
        let enrollment;
        try {
          enrollment = work.deviceEnrollment(actor, requestId);
        } catch (error) {
          if (!(error instanceof WorkbenchError) || error.status !== 404) throw error;
          page(404, undefined, error.message);
          return;
        }
        if (req.method === 'GET') {
          const status = url.searchParams.get('im');
          const notice = status === 'pending' ? '已提交开通申请。获批后，请回到此链接重新授权登录。'
            : status ? '授权未完成，请重新登录或联系平台管理员。' : undefined;
          page(200, actor ? enrollment : undefined, actor ? undefined : notice);
          return;
        }
        if (req.method !== 'POST' || req.headers.origin !== runnerOrigin.origin
          || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))
          throw new WorkbenchError('请在设备确认页面操作。', 403);
        const form = new URLSearchParams(await requestText(req, 4096));
        if (form.get('action') === 'login') {
          if (!login.legacyPassword) throw new WorkbenchError('请使用工作台配置的企业登录方式。', 403);
          const username = id.parse(form.get('username'));
          const password = z.string().max(300).parse(form.get('password'));
          try {
            const { cookie } = auth.login(username, password);
            auth.logout(req.headers.cookie);
            res.setHeader('set-cookie', sessionCookies(cookie, runnerOrigin.origin));
            redirect(res, url.pathname);
          } catch { page(401, undefined, '登录失败，请核对账号和密码。'); }
          return;
        }
        if (!actor || form.get('action') !== 'approve') throw new WorkbenchError('请先登录。', 401);
        if (enrollment.worker) work.approveDeviceEnrollment(actor, requestId);
        else {
          const selected = z.tuple([id, id]).parse(form.get('selection')?.split('/'));
          work.approveDeviceEnrollment(actor, requestId, ...selected);
        }
        res.writeHead(303, { location: url.pathname }).end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health/live') {
        json(res, 200, { alive: true });
        return;
      }
      if (req.method === 'GET' && ['/health', '/health/integrations'].includes(url.pathname)) {
        const subscription = feishu && (intake?.messages() ?? { state: 'connecting' });
        const knowledge = await checkKnowledge();
        const github = intake?.github() ?? [];
        const cardStatus = intake?.cards();
        const im = intake?.imStatus() ?? [];
        const transportReady = (status: { state: string; busHealth?: string } | undefined) => status?.state === 'ready' && status.busHealth !== 'unavailable';
        const integrationsReady = available && knowledge.state !== 'unavailable' && github.every(repo => repo.state === 'ready')
          && (!feishu || transportReady(subscription)) && (!feishu?.decisionCards || transportReady(cardStatus))
          && im.every(channel => channel.ready && !channel.inbox.overdue) && !intake?.backlog()?.overdue;
        const ready = url.pathname.endsWith('/integrations') ? integrationsReady : available;
        json(res, ready ? 200 : 503, { ready, workbenchReady: available, integrationsReady, knowledge, github: github.map(({ state }) => ({ state })),
          notificationsPaused: outbound.paused, release: configuredEnv('CONTRACTOR_RELEASE_ID'),
          engine: 'superagent', executor: config.executionRuntime, feishu: subscription, feishuCards: cardStatus, feishuInbox: intake?.backlog(),
          im: im.map(({ ready, inbox }) => ({ ready, inbox })) });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      const bundled = /^\/assets\/([\w-]+\.(js|css))$/.exec(url.pathname);
      const file = req.method === 'GET' && (assets.get(url.pathname) ?? (bundled
        ? [path.join(staticRoot, 'assets', bundled[1]!), bundled[2] === 'js' ? 'text/javascript' : 'text/css'] : undefined));
      if (file) {
        const bytes = await readFile(file[0]!).catch(error => {
          if (error.code !== 'ENOENT') throw error;
          throw new WorkbenchError(url.pathname === '/' ? '工作台前端尚未构建，请运行 npm run build:ui。' : '未找到资源。', url.pathname === '/' ? 503 : 404);
        });
        if (url.pathname === '/') {
          const nonce = randomBytes(18).toString('base64');
          // Allow Ant Design's per-component theme variables only for this document.
          res.setHeader('content-security-policy', `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; img-src 'self' blob: ${imAvatarOrigins.join(' ')}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            .end(bytes.toString('utf8').replace('content="WORKBENCH_STYLE_NONCE"', `content="${nonce}"`));
        } else res.writeHead(200, { 'content-type': file[1] + '; charset=utf-8' }).end(bytes);
        return;
      }
      if (!url.pathname.startsWith('/api/')) throw new WorkbenchError('未找到。', 404);
      const local = req.headers.host === '127.0.0.1:' + config.port || req.headers.host === 'localhost:' + config.port;
      const browserOrigin = local ? 'http://' + req.headers.host : publicWorkbench && req.headers.host === publicWorkbench.host ? publicWorkbench.origin : undefined;
      if (!browserOrigin) throw new WorkbenchError('请使用已配置的工作台地址。', 403);
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && origin !== browserOrigin) throw new WorkbenchError('请在工作台内操作。', 403);
        if (!req.headers['content-type']?.startsWith('application/json')) throw new WorkbenchError('请求格式无效。', 415);
      }
      if (!work) throw new WorkbenchError('工作台正在启动。', 503);
      const parts = url.pathname.slice('/api/'.length).split('/').map(decodeURIComponent);
      const [view, item = '', action, reference] = parts;
      const post = req.method === 'POST';
      const get = req.method === 'GET';
      if (get && view === 'auth' && item === 'im' && action === 'start' && !reference) {
        const login = work.imLogin.browser(browserOrigin);
        const next = url.searchParams.get('next');
        if (!login.ready || !login.origin) throw new WorkbenchError('当前工作台尚未启用企业登录。', 409);
        if (!login.onTeamAddress) {
          const destination = new URL(url.pathname, login.origin);
          if (next) destination.searchParams.set('next', next.slice(0, 751));
          redirect(res, destination.href);
          return;
        }
        if (sessionFor(req)) {
          redirect(res, imReturnPath(next));
          return;
        }
        const start = work.imLogin.begin(next, /wxwork/i.test(req.headers['user-agent'] ?? ''));
        res.setHeader('set-cookie', browserCookie(imLoginCookie + '=' + start.proof, browserOrigin, '/api/auth/im/callback') + '; Max-Age=' + start.maxAge);
        redirect(res, start.location);
        return;
      }
      if (get && view === 'auth' && item === 'im' && action === 'callback' && !reference) {
        if (!publicWorkbench || browserOrigin !== publicWorkbench.origin) throw new WorkbenchError('请使用企业登录配置的回调地址。', 403);
        const origin = publicWorkbench.origin;
        const result = await work.imLogin.finish(url.searchParams, cookieValue(req, imLoginCookie) ?? cookieValue(req, formerName(imLoginCookie)), link =>
          sessionFor(req)?.username === link.member && auth.sessionBinding(req.headers.cookie) === link.fingerprint
        ).catch(() => ({ status: 'expired', to: '/' }) as const);
        const cookies = [browserCookie(imLoginCookie + '=', origin, '/api/auth/im/callback') + '; Max-Age=0'];
        let status: string;
        if ('status' in result) status = result.status;
        else {
          const { identity, link } = result;
          const binding = identity.channel && work.loginChannelBinding(identity.channel);
          const existing = auth.externalOwner(identity);
          const channelMember = binding?.member;
          if (binding?.conflict || existing && channelMember && existing.username !== channelMember) status = 'conflict';
          else if (link) {
            if (channelMember && channelMember !== link.member || !auth.linkExternalAccount(link.member, identity)) status = 'conflict';
            else {
              if (identity.channel) work.bindActivation(link.member, identity.channel);
              work.imLogin.dropRegistration(identity.subject);
              status = 'linked';
            }
          } else {
            const account = existing ?? (channelMember ? auth.listAccounts().find(row => row.username === channelMember) : undefined);
            if (!account && !channelMember) status = work.imLogin.requestRegistration(result.provider, identity);
            else if (!account || account.disabled) status = 'blocked';
            else if (!existing && !auth.linkExternalAccount(account.username, identity)) status = 'conflict';
            else {
              const session = auth.loginExternal(identity);
              if (session) {
                work.imLogin.dropRegistration(identity.subject);
                auth.logout(req.headers.cookie);
                cookies.push(...sessionCookies(session.cookie, origin));
                res.setHeader('set-cookie', cookies);
                redirect(res, result.to);
                return;
              }
              status = 'blocked';
            }
          }
        }
        res.setHeader('set-cookie', cookies);
        redirect(res, withIMStatus(result.to, status));
        return;
      }
      if (post && view === 'login') {
        if (!work.imLogin.legacyPassword()) throw new WorkbenchError('请使用工作台配置的企业登录方式。', 403);
        const input = z.object({ username: id, password: z.string().max(300) }).parse(await body(req));
        try {
          const { cookie, session } = auth.login(input.username, input.password);
          auth.logout(req.headers.cookie);
          res.setHeader('set-cookie', sessionCookies(cookie, browserOrigin));
          json(res, 200, { username: session.username });
        } catch (error) { throw new WorkbenchError((error as Error).message, 401); }
        return;
      }
      if (post && view === 'runner') {
        if (!local) throw new WorkbenchError('请使用执行端监听地址。', 403);
        await runnerRequest(req, res, item);
        return;
      }
      if (post && view === 'account' && item === 'recovery' && recoveryUrl && work.imLogin.legacyPassword()) {
        if (action === 'start') {
          const input = z.object({ username }).strict().parse(await body(req));
          json(res, 200, recovery.begin(input.username));
          return;
        }
        if (action === 'complete') {
          const { code, token, password } = z.object({ code: recoveryCode, token: z.string().regex(/^[a-f0-9]{64}$/),
            password: newPassword }).strict().parse(await body(req));
          recovery.complete(code, token, name => auth.changePassword(name, password));
          json(res, 200, { ok: true });
          return;
        }
      }
      if (post && view === 'account' && item === 'activation' && action === 'start' && !reference)
        throw new WorkbenchError('新成员请通过团队主登录渠道开通。', 410);
      if (post && view === 'account' && item === 'activation' && verifyActivation) {
        if (action === 'status') {
          const input = activationRequest.parse(await body(req));
          json(res, 200, work.activation.status(input.id, input.token));
          return;
        }
        if (action === 'complete') {
          const input = activationRequest.extend({ password: newPassword }).parse(await body(req));
          await accessAdmin!.completeActivation(input.id, input.token, input.password);
          json(res, 200, { ok: true });
          return;
        }
      }
      const session = sessionFor(req);
      const actor = session?.username;
      const account = actor ? auth.listAccounts().find(a => a.username === actor && !a.disabled) : undefined;
      if (get && view === 'session') {
        json(res, 200, { signedIn: !!account, recoveryUrl: work.imLogin.legacyPassword() ? recoveryUrl : undefined,
          imLogin: work.imLogin.browser(browserOrigin, account) });
        return;
      }
      if (!actor || !account) throw new WorkbenchError('请先登录。', 401);
      let output: unknown;
      if (post && view === 'logout') {
        auth.logout(req.headers.cookie);
        res.setHeader('set-cookie', sessionCookies(undefined, browserOrigin));
      }
      else if (post && view === 'account' && item === 'im-link' && !action) {
        const fingerprint = auth.sessionBinding(req.headers.cookie);
        if (!fingerprint || req.headers.origin !== browserOrigin || browserOrigin !== publicWorkbench?.origin)
          throw new WorkbenchError('请在团队工作台的个人设置中绑定。', 403);
        const { provider } = z.object({ provider: imProvider.optional() }).strict().parse(await body(req));
        const start = work.imLogin.begin('#/account', /wxwork/i.test(req.headers['user-agent'] ?? ''), { member: actor, fingerprint, provider });
        res.setHeader('set-cookie', browserCookie(imLoginCookie + '=' + start.proof, browserOrigin, '/api/auth/im/callback') + '; Max-Age=' + start.maxAge);
        output = { location: start.location };
      } else if (get && view === 'account' && item === 'profile' && !action) output = work.profiles.own(account);
      else if (get && view === 'account' && item === 'workers' && !action) output = work.myWorkers(actor);
      else if (get && view === 'account' && item === 'personal-agent' && !action) output = work.personalAgent(actor);
      else if (post && view === 'account' && item === 'personal-agent' && !action)
        output = work.setPersonalAgent(actor, personalAgentInput.parse(await body(req)));
      else if (post && view === 'account' && item === 'personal-agent' && action === 'ask')
        output = await work.askPersonalAgent(actor, z.object({ question: z.string().trim().min(1).max(3000) }).strict().parse(await body(req)).question);
      else if (post && view === 'device' && item && action === 'projects')
        output = work.setWorkerProjects(actor, z.uuid().parse(item), z.object({
          revision: knowledgeRevision, projects: z.array(id).max(100),
        }).strict().parse(await body(req)));
      else if (post && view === 'account' && item === 'profile' && !action)
        output = work.profiles.save(account, profileUpdate.parse(await body(req)));
      else if (get && view === 'member-avatar' && item && action && !reference) {
        const bytes = work.memberAvatar(actor, username.parse(item), knowledgeRevision.parse(action));
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.byteLength });
        res.end(bytes);
        return;
      } else if (get && view === 'admin' && item === 'im-login' && !action) output = accessAdmin!.loginPolicy(actor);
      else if (post && view === 'admin' && item === 'im-login' && !action) {
        const input = z.object({ primary: imProvider, legacyPassword: z.boolean() }).strict().parse(await body(req));
        output = await accessAdmin!.setLoginPolicy(actor, input.primary, input.legacyPassword);
      } else if (post && view === 'admin' && item === 'im-registration' && action && !reference) {
        const input = z.discriminatedUnion('action', [
          z.object({ action: z.literal('approve'), role: z.enum(CONSOLE_ROLES) }).strict(),
          z.object({ action: z.literal('reject') }).strict(),
        ]).parse(await body(req));
        const request = knowledgeRevision.parse(action);
        if (input.action === 'approve') await accessAdmin!.approveIMRegistration(actor, request, input.role);
        else await accessAdmin!.rejectIMRegistration(actor, request);
      } else if (get && view === 'admin' && item === 'members' && !action) output = accessAdmin!.list(actor);
      else if (get && view === 'admin' && item === 'access-audit' && !action) output = accessAdmin!.changes(actor);
      else if (get && view === 'admin' && item === 'point-budgets' && !action) output = work.platformPointBudgets(actor);
      else if (get && view === 'admin' && item === 'model-services' && !action) output = work.modelServices(actor);
      else if (get && view === 'admin' && item === 'platform-assistant' && !action) output = work.platformAssistant(actor);
      else if (post && view === 'admin' && item === 'platform-assistant' && !action)
        output = work.setPlatformAssistant(actor, assistantUpdate.parse(await body(req)));
      else if (post && view === 'admin' && item === 'model-services' && action && !reference)
        output = work.setModelService(actor, modelProvider.parse(action), modelServiceUpdate.parse(await body(req)));
      else if (get && view === 'admin' && item === 'service-status' && !action) {
        work.assertServices(actor);
        const messages = intake?.messages();
        const cards = intake?.cards();
        output = { feishu: feishu ? messages && 'busHealth' in messages && messages.busHealth === 'unavailable' ? 'unavailable' : messages?.state ?? 'connecting' : 'disabled',
          cards: feishu?.decisionCards ? cards && 'busHealth' in cards && cards.busHealth === 'unavailable' ? 'unavailable' : cards?.state ?? 'connecting' : 'disabled',
          inbox: intake?.backlog(), knowledge: await checkKnowledge(), pendingReceipts: work.pendingExecutionReceipts(),
          plugins: work.loadedPlugins(), im: intake?.imStatus() ?? [], github: intake?.github() ?? [],
          notificationsPaused: outbound.paused };
      }
      else if (post && view === 'admin' && item === 'activation' && action && !reference) {
        const { role } = z.object({ role: z.enum(CONSOLE_ROLES) }).strict().parse(await body(req));
        await accessAdmin!.approveActivation(actor, recoveryCode.parse(action), role);
      } else if (post && view === 'admin' && item === 'members' && action && reference === 'role') {
        const { role } = z.object({ role: z.enum(CONSOLE_ROLES) }).strict().parse(await body(req));
        await accessAdmin!.changeRole(actor, username.parse(action), role);
      } else if (post && view === 'admin' && item === 'members' && action && reference === 'status') {
        const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(await body(req));
        await accessAdmin!.setEnabled(actor, username.parse(action), enabled);
      } else if (post && view === 'admin' && item === 'members' && action && reference === 'sessions') {
        z.object({}).strict().parse(await body(req));
        await accessAdmin!.endSessions(actor, username.parse(action));
      } else if (post && view === 'account' && item === 'password' && !action) {
        if (!work.imLogin.legacyPassword()) throw new WorkbenchError('该工作台已使用渠道账号登录。', 403);
        const { current, password } = z.object({ current: z.string().min(1).max(300), password: newPassword }).strict().parse(await body(req));
        await accessAdmin!.changePassword(actor, current, password);
      }
      else if (get && view === 'overview') output = work.overview(actor, url.searchParams.get('catalog') !== '1');
      else if (get && view === 'tickets' && !item) {
        const params = z.object({ project: id.optional(), mine: z.literal('1').optional(), q: z.string().max(240).optional(),
          topic: id.optional(), agent: id.optional(), state: z.enum(ticketListStates).optional(), purpose: z.enum(['work', 'all']).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(), after: z.string().max(300).regex(/^[\w-]+$/).optional() })
          .strict().parse(Object.fromEntries(url.searchParams));
        output = work.ticketPage(actor, { ...params, mine: params.mine === '1' });
      }
      else if (get && view === 'conversations' && !item) {
        const params = z.object({ project: id.optional(), q: z.string().max(240).optional(), archived: z.literal('1').optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(), after: z.string().max(400).regex(/^[\w-]+$/).optional() })
          .strict().parse(Object.fromEntries(url.searchParams));
        output = work.conversationIndex(actor, { ...params, archived: params.archived === '1' });
      }
      else if (post && view === 'conversations' && item && action === 'archive' && !reference) {
        const target = z.object({ topic: id.optional(), ticket: id.optional(), archived: z.boolean() }).strict()
          .refine(value => !value.topic || !value.ticket).parse(await body(req));
        output = work.archiveConversation(actor, id.parse(item), target);
      }
      else if (get && view === 'needs-you') output = work.needsYou(actor);
      else if (post && view === 'intake' && item && action === 'draft') output = await work.draftIntake(actor, item);
      else if (post && view === 'intake' && item && action === 'resolve') {
        const input = z.discriminatedUnion('action', [
          z.object({ action: z.literal('create'), agent: id.optional() }).strict(),
          z.object({ action: z.literal('dismiss') }).strict(),
        ]).parse(await body(req));
        output = work.resolveIntake(actor, item, input);
      }
      else if (get && view === 'discussion' && item && action === 'revisions' && reference)
        output = await work.discussionRevisions(actor, item, reference);
      else if (get && view === 'discussion' && item) output = work.discussionView(actor, item);
      else if (post && view === 'discussion' && item && action === 'resolve')
        output = work.resolveDiscussion(actor, item, discussionDecision.parse(await body(req)));
      else if (channelAccounts && get && view === 'channels') output = work.channelView(actor);
      else if (channelAccounts && post && view === 'channels' && item === 'proof') {
        const input = z.object({ provider }).parse(await body(req));
        output = work.accountProof(actor, input.provider);
      } else if (channelAccounts && post && view === 'channels' && item === 'confirm') {
        const input = accountRef.parse(await body(req));
        work.confirmAccount(actor, input.provider, input);
      } else if (channelAccounts && post && view === 'channels' && item === 'unlink') {
        const input = accountRef.parse(await body(req));
        work.revokeAccount(actor, input.provider, input.namespace, input.id);
      } else if (config.crossChannel && post && view === 'channels' && action === 'resolve') {
        output = await work.resolveChannelFromHttp(actor, item, channelDecision.parse(await body(req)));
      }
      else if (get && view === 'ticket' && item && action === 'topic-context' && !reference) output = work.ticketTopicContext(actor, item);
      else if (get && view === 'ticket' && item && action === 'runs' && reference)
        output = work.executionSnapshot(actor, item, z.coerce.number().int().positive().parse(reference),
          url.searchParams.has('attempt') ? z.coerce.number().int().positive().parse(url.searchParams.get('attempt')) : undefined);
      else if (view === 'regression' && item && get && !action)
        output = work.regressionList(actor, id.parse(item));
      else if (view === 'regression' && item && post && action === 'case' && !reference)
        output = work.createRegressionCase(actor, id.parse(item), regressionCaseInput.parse(await body(req)));
      else if (view === 'regression' && item && post && action === 'compare' && !reference)
        output = work.compareRegression(actor, id.parse(item), regressionCompareInput.parse(await body(req)));
      else if (get && view === 'ticket' && item) output = work.detail(actor, item);
      else if (get && view === 'request' && item) output = { ticket: work.resolveStart(actor, item) };
      else if (view === 'octop' && item && get && !action) output = work.octopCatalog(actor, item);
      else if (view === 'octop' && item && get && action === 'recall') output = await work.octopRecall(actor, item, (url.searchParams.get('q') ?? '').slice(0, 240));
      else if (view === 'octop' && item && post && action === 'skill') output = work.publishOctopSkill(actor, item,
        z.object({ slug: octopSlug, title, markdown: z.string().trim().min(1).max(6000) }).strict().parse(await body(req)));
      else if (view === 'octop' && item && post && action === 'share') output = work.shareOctop(actor, item,
        z.object({ id, member: id, active: z.boolean() }).strict().parse(await body(req)));
      else if (view === 'octop' && item && post && action === 'mount') {
        const input = z.object({ agent: id, skill: knowledgeRef, active: z.boolean() }).strict().parse(await body(req));
        output = work.mountOctop(actor, item, input.agent, input.skill, input.active);
      } else if (view === 'octop' && item && post && action === 'expert') {
        const input = z.object({ nonce, spec: octopExpertSpec }).strict().parse(await body(req));
        output = work.createOctop(actor, item, input.nonce, input.spec);
      } else if (view === 'octop' && item && post && action === 'template') {
        const input = z.object({ agent: id, spec: octopExpertSpec.optional(), kind: z.enum(['expert', 'subagent']) }).strict().parse(await body(req));
        output = work.publishOctopTemplate(actor, item, input.agent, input.spec, input.kind);
      } else if (view === 'octop' && item && post && action === 'clone') {
        const input = z.object({ nonce, title, agent: id, revision: knowledgeRevision }).strict().parse(await body(req));
        output = work.cloneOctop(actor, item, input);
      } else if (get && view === 'project' && item && action === 'usage') output = work.projectUsage(actor, item);
      else if (get && view === 'project' && item && action === 'channels') {
        const im = work.projectChannels(actor, item).map(channel => ({ ...channel, ready: !!intake?.octopConnected(channel.connector) }));
        const feishuStatus = intake?.messages();
        output = { im, feishuReady: feishuStatus?.state === 'ready' && feishuStatus.busHealth !== 'unavailable',
          feishuHistory: work.feishuSourceStatus(actor, item) };
      }
      else if (get && view === 'project' && item && action === 'routing' && !reference) output = work.projectRouting(actor, item);
      else if (get && view === 'project' && item && action === 'topic-rules' && reference) output = work.topicRules(actor, item, reference);
      else if (post && view === 'project' && item && action === 'routing' && !reference)
        output = work.setProjectRouting(actor, item, projectRoutingUpdate.parse(await body(req)));
      else if (get && view === 'project' && item && action === 'github-connections') {
        const repositories = work.projectGitHubRepositories(actor, item);
        output = intake?.github(repositories) ?? [];
      }
      else if (get && view === 'project' && item && action === 'point-budgets') output = work.projectPointBudgets(actor, item);
      else if (get && view === 'project' && item && action === 'memory')
        output = work.memoryHome(actor, item, url.searchParams.has('agent') ? id.parse(url.searchParams.get('agent')) : undefined);
      else if (get && view === 'project' && item && action === 'knowledge-graph') output = work.projectKnowledgeGraph(actor, item);
      else if (get && view === 'project' && item && action === 'figma-sources') output = work.figmaSourceStatus(actor, item);
      else if (get && view === 'project' && item && action === 'recall') output = await work.recallMemory(actor, item, url.searchParams.get('q') ?? '');
      else if (get && view === 'project' && item && action === 'devices') output = work.projectDevices(actor, item);
      else if (get && view === 'project' && item && action === 'device-routes' && !reference) output = work.projectDeviceRoutes(actor, item);
      else if (post && view === 'project' && item && action === 'device-routes' && !reference)
        output = work.setProjectDeviceRoute(actor, item, deviceRouteInput.parse(await body(req)));
      else if (get && view === 'project' && item && action === 'budgets') output = work.budgetPools(actor, item);
      else if (get && view === 'project' && item && action === 'agent-budgets') output = work.agentBudgets(actor, item);
      else if (post && view === 'project' && item && action === 'agent-budgets' && reference) {
        const input = budgetLimit.strict().parse(await body(req));
        output = work.setAgentBudget(actor, item, id.parse(reference), input.period, input.limit, input.maxMinutes);
      }
      else if (get && view === 'knowledge' && item && action === 'uses') output = work.memoryUses(actor, item);
      else if (get && view === 'knowledge' && item && action === 'preview') {
        const revision = z.string().regex(/^[a-f0-9]{64}$/).parse(url.searchParams.get('revision'));
        const bytes = await work.knowledgePreview(actor, item, revision);
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.byteLength });
        res.end(bytes);
        return;
      }
      else if (post && view === 'knowledge' && item && action === 'pin')
        work.setMemoryPin(actor, item, z.object({ pinned: z.boolean() }).strict().parse(await body(req)).pinned);
      else if (get && view === 'budget' && item === 'points-policy') output = work.pointPolicy(actor);
      else if (get && view === 'budget' && item === 'points-status') output = work.pointControl();
      else if (post && view === 'budget' && item === 'points-policy') {
        const { revision, ...policy } = pointPolicyUpdate.parse(await body(req));
        output = work.setPointPolicy(actor, policy, revision);
      }
      else if (post && view === 'budget' && item === 'points-limit') output = work.setPointLimit(actor, pointLimitInput.parse(await body(req)));
      else if (post && view === 'budget') {
        const input = budgetLimit.extend({ kind: z.enum(['platform', 'personal', 'execution']), subject: id }).strict().parse(await body(req));
        work.setBudget(actor, { kind: input.kind, subject: input.subject }, input.period, input.limit, input.maxMinutes);
      } else if (post && view === 'device' && item === 'pair') {
        const input = z.object({ project: id, agent: id, remote: z.boolean().default(false) }).strict().parse(await body(req));
        output = work.issueDevicePair(actor, input.project, input.agent, input.remote);
      } else if (post && view === 'device' && item) {
        const input = z.union([
          z.object({ active: z.boolean() }).strict(),
          z.object({ state: z.enum(['active', 'suspended', 'lost', 'retired']) }).strict(),
        ]).parse(await body(req));
        work.transitionDevice(actor, z.uuid().parse(item), 'state' in input ? input.state : input.active ? 'active' : 'suspended');
      }
      else if (post && view === 'project' && !item) {
        output = work.createProject(actor, z.object({ nonce, title, parent: id.optional() }).strict().parse(await body(req)));
      } else if (get && view === 'project' && item && action === 'access' && !reference) {
        output = work.projectAccess(actor, item);
      } else if (get && view === 'project' && item && action === 'knowledge-access' && !reference) {
        output = work.projectKnowledgeAccess(actor, item);
      } else if (post && view === 'project' && item && action === 'knowledge-access' && !reference) {
        work.setProjectKnowledgeAccess(actor, item, z.object({ hours: z.number().int().min(1).max(168) }).strict().parse(await body(req)).hours);
      } else if (post && view === 'project' && action === 'member' && reference === 'role') {
        const input = z.object({ member: username, role: projectMemberRole }).strict().parse(await body(req));
        work.setProjectMemberRole(actor, item, input.member, input.role);
      } else if (post && view === 'project' && action === 'member' && reference === 'remove') {
        work.removeProjectMember(actor, item, z.object({ member: username }).strict().parse(await body(req)).member);
      } else if (post && view === 'project' && action === 'member' && !reference) {
        const input = z.object({ member: username, role: projectMemberRole.optional() }).strict().parse(await body(req));
        work.addProjectMember(actor, item, input.member, input.role);
      } else if (post && view === 'project' && action === 'maintainer' && reference === 'transfer') {
        work.transferProjectMaintainer(actor, item, z.object({ to: username }).strict().parse(await body(req)).to);
      } else if (post && view === 'project' && action === 'agent') {
        work.addProjectAgent(actor, item, z.object({ agent: id }).strict().parse(await body(req)).agent);
      } else if (get && view === 'project' && action === 'messages') {
        const target = {
          topic: url.searchParams.has('topic') ? id.parse(url.searchParams.get('topic')) : undefined,
          ticket: url.searchParams.has('ticket') ? id.parse(url.searchParams.get('ticket')) : undefined,
          reply: url.searchParams.has('reply') ? id.parse(url.searchParams.get('reply')) : undefined,
        };
        const page = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).optional() })
          .parse(Object.fromEntries(url.searchParams));
        output = url.searchParams.has('paged') || page.before || page.limit
          ? work.conversationPage(actor, item, target, page) : work.conversation(actor, item, target);
      } else if (post && view === 'project' && action === 'messages') {
        output = work.postConversation(actor, item, z.object({ nonce, text: prose, topic: id.optional(), ticket: id.optional(),
          feishu: z.boolean().optional() }).strict().parse(await body(req)));
      } else if (post && view === 'project' && action === 'consult') {
        output = await work.consultTopic(actor, item, z.object({ nonce, text: prose, topic: id, agents: z.array(id).min(1).max(4),
          knowledge: knowledgeRef.optional(), device: z.uuid().optional() })
          .strict().parse(await body(req)));
      } else if (post && view === 'project' && action === 'feishu-group') {
        work.bindFeishuGroup(actor, item, z.object({ chat: z.string().regex(/^oc_[a-zA-Z0-9_-]+$/), label: title, topic: id.optional() }).strict().parse(await body(req)));
      } else if (post && view === 'project' && item && action === 'bind') {
        const value = z.object({ source: resourceSource, externalId: z.string().min(1).max(200) }).parse(await body(req));
        work.bindResource(actor, item, value.source, value.externalId);
      } else if (post && view === 'project' && item && action === 'reference') {
        output = work.addReference(actor, item, referenceSchema.parse(await body(req)));
      } else if (post && view === 'project' && item && action === 'knowledge-import') {
        output = await work.importKnowledge(actor, item, z.object({ resource: z.string().min(1).max(180),
          path: z.string().min(1).max(240).optional() }).strict().parse(await body(req)));
      } else if (post && view === 'project' && item && action === 'topic') {
        work.createTopic(actor, item, topicInputSchema.parse(await body(req)));
      } else if (post && view === 'agent' && item) work.setAgent(actor, item, z.object({ active: z.boolean() }).parse(await body(req)).active);
      else if (post && view === 'ticket' && !item) output = work.start(actor, settingsRoutes.start.parse(await body(req)));
      else if (post && view === 'ticket' && action === 'answer') work.reply(actor, item, settingsRoutes.answer.parse(await body(req)));
      else if (post && view === 'ticket' && action === 'stop') work.stop(actor, item);
      else if (post && view === 'ticket' && action === 'handoff')
        output = work.handoff(actor, item, z.object({ agent: id, reason: prose, device: z.uuid().optional() }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'resume')
        output = work.resume(actor, item, z.object({ nonce, reason: prose, version: z.number().int().positive(),
          baseSha: z.string().regex(/^[a-f0-9]{40}$/).optional(), device: z.uuid().nullable().optional() }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'revise')
        output = work.revise(actor, item, z.object({ revision: z.string().length(64), reason: prose,
          kind: z.enum(['rejected', 'continued', 'rechecked']).optional(), material: materials.optional(), device: z.uuid().optional(),
          knowledge: z.object({ id, revision: knowledgeRevision }).strict().optional(),
          consultation: z.object({ ticket: id, revision: knowledgeRevision }).strict().optional(),
          productCases: manualCasesInput.optional() }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'retry-local-code')
        output = await work.retryUnpublishedCode(actor, item, z.object({ revision: knowledgeRevision, reason: prose }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'approve-development')
        work.approveDevelopment(actor, item, z.object({ offer: id.optional() }).strict().parse(await body(req)).offer);
      else if (post && view === 'ticket' && action === 'respond-development')
        output = work.respondDevelopment(actor, item, z.object({ offer: id, response: z.enum(['decline', 'return']), reason: prose }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'reoffer-development')
        output = work.reofferDevelopment(actor, item, z.object({ offer: id, agent: id, reason: prose }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'topic') work.setTopic(actor, item, z.object({ topic: id.optional() }).parse(await body(req)).topic);
      else if (post && view === 'ticket' && action === 'topic-context' && !reference)
        output = work.setTicketTopicBasis(actor, item, z.object({ id, source: z.enum(['web', 'feishu']), revision: id,
          confirmed: z.boolean() }).strict().parse(await body(req)));
      else if (post && view === 'ticket' && action === 'related') work.relateWork(actor, item, z.object({ ticket: id }).parse(await body(req)).ticket);
      else if (post && view === 'ticket' && action === 'branch') {
        const value = z.object({ url: githubUrl }).parse(await body(req));
        await work.linkBranch(actor, item, value.url);
      }
      else if (post && view === 'ticket' && action === 'delivery') {
        const value = z.object({ url: githubUrl }).parse(await body(req));
        await work.linkDelivery(actor, item, value.url);
      } else if (post && view === 'ticket' && action === 'recheck-delivery') {
        output = await work.recheckDelivery(actor, item, z.object({ revision: knowledgeRevision, head: commitSha }).strict().parse(await body(req)));
      } else if (post && view === 'ticket' && item && action === 'product-check' && !reference) {
        output = work.recordProductCheck(actor, item, humanCheckInput.parse(await body(req)));
      } else if (post && view === 'ticket' && action === 'accept') {
        const value = settingsRoutes.accept.parse(await body(req));
        if (value.body && !value.conditions) throw new WorkbenchError('请填写这条结论的适用条件。');
        await work.accept(actor, item, value.revision, value.conditions, value.body, value.commit, value.deployment);
      } else if (post && view === 'ticket' && action === 'observation') {
        output = work.recordObservation(actor, item, observationSchema.parse(await body(req)));
      } else if (post && view === 'ticket' && action === 'access' && !reference) {
        const input = settingsRoutes.access.parse(await body(req));
        work.request(actor, item, input.entry, input.reason);
      } else if (post && view === 'ticket' && action === 'access' && reference) {
        const input = settingsRoutes.changeAccess.parse(await body(req));
        work.changeAccess(actor, item, reference, input.state, input.hours);
      }
      else if (get && view === 'knowledge' && item) output = work.browse(actor, item, (url.searchParams.get('q') ?? '').slice(0, 300),
        url.searchParams.get('history') === '1');
      else if (post && view === 'knowledge' && action === 'publish') {
        const input = settingsRoutes.publish.parse(await body(req));
        await work.publish(actor, item, input.revision, input.replaces);
      } else if (post && view === 'knowledge' && action === 'invalidate') {
        const input = z.object({ revision: knowledgeRevision, reason: prose }).strict().parse(await body(req));
        work.invalidateKnowledge(actor, item, input.revision, input.reason);
      } else if (post && view === 'knowledge' && action === 'directory') {
        const input = z.object({ revision: knowledgeRevision, directory: z.enum(['requestable', 'hidden']) }).strict().parse(await body(req));
        work.setKnowledgeDirectory(actor, item, input.revision, input.directory);
      }
      else if (post && view === 'knowledge' && item && action === 'draft') output = await work.draftKnowledge(actor, item,
        z.object({ revision: knowledgeRevision }).strict().parse(await body(req)).revision);
      else if (post && view === 'knowledge' && action === 'review') output = work.reviewKnowledge(actor, item,
        z.object({ revision: z.string().length(64), title: title.optional(), body: z.string().trim().min(1).max(16000),
          conditions: z.string().trim().min(1).max(600) }).strict().parse(await body(req)));
      else if (post && view === 'knowledge' && item && !action) output = { id: work.addKnowledge(actor, item, settingsRoutes.add.parse(await body(req))) };
      else throw new WorkbenchError('未找到。', 404);
      json(res, 200, output ?? { ok: true });
    } catch (error) {
      replyError(res, error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });
  try {
    if (remoteServer && config.remoteRunnerPort) await new Promise<void>((resolve, reject) => {
      remoteServer.once('error', reject);
      remoteServer.listen(config.remoteRunnerPort, '127.0.0.1', resolve);
    });
    await prepareAuth();
    const cards = feishu?.decisionCards ? feishuCardTransport(feishu.profile) : undefined;
    const collaboration = await openCollaboration(config, auth, feishu && (message => outbound.deliver(async () => {
      const lark = (args: string[]) => command('lark-cli', ['--profile', feishu.profile, ...args, '--as', 'bot']);
      const userId = message.channel.address.userId;
      if (!userId) return sendFeishu({ commands: { lark } }, message);
      await lark(['im', '+messages-send', '--user-id', userId, '--text', message.text, '--idempotency-key', message.id]);
      return 'sent';
    }, undefined, message)), cards ? { ...cards,
      send: (target, key, content) => outbound.deliver(() => cards.send(target, key, content)),
      update: (ref, content) => outbound.deliver(() => cards.update(ref, content)),
      available: () => {
      const status = intake?.cards();
      return !outbound.paused && status?.state === 'ready' && status.busHealth !== 'unavailable';
    } } : undefined, config.octop?.channels?.length ? {
      ready: address => outbound.permits(address) && intake?.octopReady(address) === true,
      send: (address, text, card, delivery) => outbound.deliver(async () => {
        if (!intake) throw new Error('消息接入模块未就绪');
        return intake.sendOctop(address, text, card, delivery);
      }, address),
    } : undefined, capabilities);
    accessAdmin = permissionAdmin(auth, collaboration, verifyActivation);
    work = collaboration;
    intake = await plugins.mount('channel-ingress', async () => {
      const value = await openIntake(config, collaboration, auth, {
        verifyActivation, verifyRecovery: (code, sender, at, direct) => {
          if (recoveryUrl) recovery.verify(code, sender, at, direct);
        },
      });
      return { value, close: value.close };
    });
    await plugins.mount('figma-revisions', () => ({ value: undefined, close: watchFigmaKnowledge(collaboration.refreshFigma) }));
    available = true;
    console.log('Contractor http://127.0.0.1:' + config.port);
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      available = false;
      const drained = [server, ...(remoteServer ? [remoteServer] : [])].map(listener =>
        new Promise<void>(resolve => listener.close(() => resolve())));
      void Promise.allSettled([...drained, plugins.close()]).then(async settled => {
        await collaboration.close();
        const failed = settled.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      }).catch(error => {
          process.exitCode = 1;
          console.error(error);
      }).finally(release);
    };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
  } catch (error) {
    server.close();
    if (remoteServer) remoteServer.close();
    await plugins.close().catch(() => undefined);
    await work?.close();
    throw error;
  }
}

async function requestText(req: IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) throw new WorkbenchError('请求内容过长。', 413);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function body(req: IncomingMessage, limit = 65000) {
  return JSON.parse(await requestText(req, limit) || '{}');
}

const argv = process.argv.slice(2);
const release = acquireStateLease(stateDir, 'workbench');
try {
  if (argv[0] === 'init-owner' || argv[0] === 'add-member') {
    await prepareAuth();
    const password = readFileSync(0, 'utf8').trimEnd();
    if (argv[0] === 'init-owner') await auth.bootstrapOwner(argv[1] ?? '', password);
    else {
      const owner = auth.listAccounts().find(a => a.role === 'owner' && !a.disabled);
      if (!owner) throw new Error('请先初始化工作台所有者。');
      const role = z.enum(CONSOLE_ROLES).parse(argv[2]);
      if (argv[3] && !/^ou_[A-Za-z0-9]+$/.test(argv[3])) throw new Error('飞书成员标识无效。');
      if (argv[3] && auth.listAccounts().some(a => a.feishuOpenId === argv[3])) throw new Error('该飞书身份已绑定。');
      await auth.createAccount(argv[1] ?? '', password, role, owner.username, argv[3]);
    }
    console.log('本机工作台账号已保存。');
    release();
  } else {
    await serve(release);
  }
} catch (error) {
  release();
  throw error;
}
