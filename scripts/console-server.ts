/**
 * 独立协作台控制台：自研前端外壳的本地承载服务。
 *
 * 设计约束（与 PRD §10A 的 S1–S4 一致）：
 * - 只监听回环地址，不对外暴露业务材料；
 * - 浏览器只拿到只读 action 的结果，密钥永远留在服务端；
 * - 不提供任何「网页发起任务」入口，发起仍在飞书；
 * - 不依赖宿主插件接口，宿主只作为数据层，随时可换。
 *
 * 第二十九轮 P-11：从「匿名只读」升级为「登录 + 分权限管理后台」。
 * 第三十轮 P-12：权限判定改走 casbin（启动时 await auth.ready()）；
 * 新增用户级配置（settings-get / settings-set 本人，admin-users-settings
 * 管理员总览）；前端复用 Vue 3 + Element Plus（本地 vendor，离线可用）。
 */
import { createServer, request as httpRequest, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, secrets, root } from '../src/config.ts';
import { ConsoleAuth, can, ROLE_PERMISSIONS, ROLE_LABELS, PERMISSION_LABELS, type ConsoleRole } from '../src/console-auth.ts';
import { AUX_SERVICES, auxHealth } from './services.ts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consoleDir = path.join(rootDir, 'console');

/** 控制台允许读取的动作；与 bridge 的只读分发保持一致。 */
export const CONSOLE_READ_ACTIONS: readonly string[] = [
  // P-5：控制台改拉服务端分页摘要；view 保留给插件工作台与兼容调用。
  'view', 'view-summary', 'service-status', 'system-status', 'memory-status', 'memory-replay', 'memory-guard', 'loop-guard',
  'routing-status', 'trace-view', 'model-settings', 'v06-org-overview',
  'network-view', 'ontology-view', 'context-pack', 'memory-search',
  'v06-agent-registry-view', 'v06-evolution-view', 'v06-execution-view',
  // 验收模块：清单 / 逐项判定 / 证据区域 / 审查 Agent 编组 / 报告，一次只读聚合。
  'v06-acceptance-workbench',
  // 组织视图：共享上下文底座 + 三层职能 + 可见任务分布（只读聚合）。
  'organization-view',
  // 通道体检：凭据齐备度与上次真实工单（只读，不发外部请求）。
  'channel-health',
  // 第三十八轮 · 运行层两块只读面：出站投递健康（retry-health）与事件收件箱
  // （event-inbox-status）。都只读，写入口仍只在 bridge 的 /events/:source 与
  // 调度器内部。
  'retry-health', 'event-inbox-status',
  'knowledge-list', 'knowledge-get', // P-13：知识条目列表与单条详情（读）
  'knowledge-wiki', // 13a ②③：知识地图投影与注入索引的只读体检
  'conversation-feed', // 第六十三轮：全局协作事件流（「对话」视图，只读投影）
  // 第六十六轮：补齐「后端有、前端没接」的能力（bridge 侧本就支持，这里只放行）
  'v06-artifact-list', // 产物库（全局产物 ref / 修订）
  'team-members', // 成员目录 + Agent 绑定（组织视图）
  'agent-services', // Agent 服务网络
  'scheduler-status', 'wake-list', // 定时调度与唤醒队列（需 manager，viewer 如实 403）
  // 第六十八轮 · 接入台（对标 LobeHub Connect External Agents）：扫描本机执行端 + 单端体检。
  // 只读；enable/register 是写动作，走下面的 WRITE 映射并强制备份。
  'agent-onboarding-probe', 'agent-onboarding-check',
  // 第六十八轮 · 决策账本（对标 DSH Decision）：跨任务或按任务读「判定 + 依据」。
  'decision-ledger',
  // 第六十八轮 · 群组编排（对标 LobeHub GroupOrchestration）：只读预览下一轮决策。
  'group-view',
] as const;

/** P-13 知识写入动作：登录即可调，分区权限由 bridge 端 casbin 统一判定。 */
const KNOWLEDGE_WRITE_ACTIONS: readonly string[] = ['knowledge-create', 'knowledge-update', 'knowledge-delete'] as const;

/** 13a ④：离线整理建议登记进 C-6 候选闸门——登录即可提（与 improvement-propose 同语义），人审在治理台账。 */
const DREAMING_ACTIONS: readonly string[] = ['dreaming-run'] as const;

/** 读通道也要按真实登录用户判分区（个人区仅归属者与管理员可见）。 */
const KNOWLEDGE_READ_ACTOR_ACTIONS: readonly string[] = ['knowledge-list', 'knowledge-get'] as const;

/** 管理动作 → 所需权限（casbin RBAC 按策略放行）。 */
const ADMIN_ACTIONS: Record<string, string> = {
  'admin-accounts': 'accounts-manage',
  'admin-account-create': 'accounts-manage',
  'admin-account-role': 'accounts-manage',
  'admin-account-disable': 'accounts-manage',
  'admin-users-settings': 'users-settings-view', // 管理员总览所有用户的配置（账号管理仍 owner 专属）
  'admin-policy': 'users-settings-view', // 查看 casbin 角色权限策略
  'admin-password-change': 'read', // 本人改自己的口令
  'admin-services': 'services-control',
  'admin-service-control': 'services-control',
  'admin-knowledge-review': 'knowledge-review',
  'admin-task-control': 'task-control',
  'admin-hitl': 'read',
  'admin-hitl-answer': 'read', // 真人回答 Agent 提出的人工问题；登录即可，回答≠验收
  'admin-audit': 'audit-view',
  'admin-feishu-auth': 'feishu-auth',
  // 第六十八轮 · 接入台写动作：改执行端编制会直接影响谁能在本机跑命令，
  // 因此按 operator（services-control）判，不放开给普通登录用户。
  'agent-onboarding-enable': 'services-control',
  'agent-onboarding-register': 'services-control',
};

const STATIC: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
  // P-12：本地化的开源前端库（Vue 3 / Element Plus，MIT），离线可用。
  '/vendor/vue.global.prod.js': { file: 'vendor/vue.global.prod.js', type: 'application/javascript; charset=utf-8' },
  '/vendor/element-plus.full.min.js': { file: 'vendor/element-plus.full.min.js', type: 'application/javascript; charset=utf-8' },
  '/vendor/element-plus.css': { file: 'vendor/element-plus.css', type: 'text/css; charset=utf-8' },
  '/vendor/element-plus.dark.css': { file: 'vendor/element-plus.dark.css', type: 'text/css; charset=utf-8' },
  '/vendor/element-plus-locale-zh-cn.js': { file: 'vendor/element-plus-locale-zh-cn.js', type: 'application/javascript; charset=utf-8' },
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  // Vue 运行时模板编译需要 unsafe-eval（本地回环服务、无第三方脚本，风险可控）。
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
};

function applyHeaders(res: ServerResponse): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 65536) throw new Error('请求体过大');
  }
  return data;
}

function json(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(text);
}

/** 把只读请求转发到本机协作服务的动作分发口；不透传浏览器来源头。 */
function bridgeRequest(method: 'GET' | 'POST', route: string, payload?: unknown): Promise<{ status: number; body: string }> {
  const config = loadConfig();
  const token = secrets().adminToken;
  const data = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: config.bridgePort,
      path: route, method, timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        Authorization: 'Bearer ' + token,
      },
    }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { out += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 502, body: out }));
    });
    req.on('timeout', () => req.destroy(new Error('协作服务响应超时')));
    req.on('error', reject);
    req.end(data);
  });
}

function proxy(action: string, body: string, actorUser?: string, timeoutMs = 20000): Promise<{ status: number; payload: string }> {
  const incoming = body ? JSON.parse(body).payload ?? {} : {};
  // P-13：知识写入动作带上 console 用户身份；bridge 端以 casbin 分区判定。
  const payload = JSON.stringify({ payload: actorUser ? { ...incoming, actorUser } : incoming });
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: loadConfig().bridgePort,
      path: '/workspace/' + action, method: 'POST', timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: 'Bearer ' + secrets().adminToken,
      },
    }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { out += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 502, payload: out }));
    });
    req.on('timeout', () => req.destroy(new Error('协作服务响应超时')));
    req.on('error', reject);
    req.end(payload);
  });
}

/** 受控地跑本仓库脚本（服务管理 / 飞书授权），只允许白名单命令。 */
function runLocalScript(argv: string[], timeoutMs = 60000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath,
      ['--import', path.join(rootDir, 'node_modules/tsx/dist/loader.mjs'), ...argv],
      { cwd: rootDir, env: { ...process.env, NODE_OPTIONS: '' }, timeout: timeoutMs });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 200000) stdout = stdout.slice(-200000); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 50000) stderr = stderr.slice(-50000); });
    child.on('error', error => resolve({ code: null, stdout, stderr: String(error) }));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

const auth = new ConsoleAuth();

async function handleAdmin(action: string, payload: Record<string, unknown>, session: { username: string; role: ConsoleRole }) {
  switch (action) {
    case 'admin-accounts': {
      return { accounts: auth.listAccounts().map(a => ({ username: a.username, role: a.role,
        roleLabel: ROLE_LABELS[a.role], disabled: Boolean(a.disabled), createdAt: a.createdAt,
        createdBy: a.createdBy, feishuBound: Boolean(a.feishuOpenId) })) };
    }
    case 'admin-account-create': {
      await auth.createAccount(String(payload.username ?? ''), String(payload.password ?? ''),
        (String(payload.role ?? 'viewer') as ConsoleRole), session.username,
        payload.feishuOpenId ? String(payload.feishuOpenId) : undefined);
      return { ok: true };
    }
    case 'admin-account-role': {
      await auth.setRole(session.username, String(payload.username ?? ''), String(payload.role ?? '') as ConsoleRole);
      return { ok: true };
    }
    case 'admin-account-disable': {
      await auth.setDisabled(session.username, String(payload.username ?? ''), payload.disabled !== false);
      return { ok: true };
    }
    case 'admin-users-settings': {
      // 管理员总览：所有用户 + 各自配置（API Key 已打码）；修改仍限本人。
      return { users: auth.listUserSettingsOverview() };
    }
    case 'admin-policy': {
      return { policy: auth.policyText(), note: 'casbin RBAC 策略（角色 -> 权限）；可手工扩展，重启生效；删文件即重置为种子。' };
    }
    case 'admin-password-change': {
      auth.changePassword(session.username, String(payload.newPassword ?? ''));
      return { ok: true };
    }
    case 'admin-services': {
      const services = await Promise.all(AUX_SERVICES.map(auxHealth));
      const bridge = await new Promise<boolean>(resolve => {
        const req = httpRequest({ hostname: '127.0.0.1', port: loadConfig().bridgePort, path: '/health', timeout: 2000 },
          res => { res.resume(); resolve(Boolean(res.statusCode && res.statusCode < 500)); });
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
        req.end();
      });
      return { services, bridge, roles: ROLE_PERMISSIONS, roleLabels: ROLE_LABELS };
    }
    case 'admin-service-control': {
      const serviceAction = String(payload.action ?? '');
      if (!['start', 'stop', 'restart', 'status'].includes(serviceAction)) throw new Error('服务动作只能是 start / stop / restart / status');
      const name = payload.name ? String(payload.name) : undefined;
      if (name && !AUX_SERVICES.some(s => s.name === name)) throw new Error('未知服务');
      const result = await runLocalScript(['scripts/services.ts', serviceAction, ...(name ? [name] : [])], 120000);
      auth.audit('services.control', session.username, { action: serviceAction, name: name ?? 'all',
        code: result.code, output: result.stdout.slice(0, 400) });
      return { ok: result.code === 0, output: result.stdout.trim() || result.stderr.trim() };
    }
    case 'admin-knowledge-review': {
      const taskId = String(payload.taskId ?? '');
      const state = String(payload.state ?? '');
      if (!taskId || !['confirmed', 'withdrawn'].includes(state)) throw new Error('需要 taskId 与 state（confirmed / withdrawn）');
      const key = String(payload.key ?? '');
      const revision = String(payload.revision ?? '');
      if (!key || !revision) throw new Error('需要 key 与 revision');
      // 13a ③：确认时可由真人显式选择「同步提升到注入索引」；确认人按真实登录
      // 用户留痕（confirmedBy），不再笼统记 local-operator。
      const inject = payload.inject === true;
      const result = await bridgeRequest('POST', `/tasks/${taskId}/knowledge-review`,
        { key, revision, state, inject, actorUser: session.username });
      auth.audit('knowledge.review', session.username, { taskId, key, state, inject, status: result.status });
      return { ok: result.status === 200, response: safeParse(result.body) };
    }
    case 'admin-task-control': {
      const taskId = String(payload.taskId ?? '');
      const command = String(payload.command ?? '');
      if (!taskId || !['接续', '暂停'].includes(command)) throw new Error('需要 taskId 与 command（接续 / 暂停）');
      const result = await bridgeRequest('POST', `/tasks/${taskId}/reply`, { text: command });
      auth.audit('task.control', session.username, { taskId, command, status: result.status });
      return { ok: result.status === 200, response: safeParse(result.body) };
    }
    // 第六十八轮 · 接入台写动作：转发到 bridge，由 bridge 落盘（强制备份）。
    case 'agent-onboarding-enable': {
      const key = String(payload.key ?? '').trim();
      if (!key) throw new Error('需要 key');
      const result = await proxy('agent-onboarding-enable', JSON.stringify({ payload }), session.username);
      auth.audit('agent.onboarding-enable', session.username, { key, status: result.status });
      return { ok: result.status === 200, response: safeParse(result.payload) };
    }
    case 'agent-onboarding-register': {
      const key = String(payload.key ?? '').trim();
      if (!key) throw new Error('需要 key');
      const result = await proxy('agent-onboarding-register', JSON.stringify({ payload }), session.username);
      auth.audit('agent.onboarding-register', session.username, { key, status: result.status });
      return { ok: result.status === 200, response: safeParse(result.payload) };
    }
    case 'admin-hitl': {
      // 只读：直接读本机 HITL 台账与续跑建议，不经过 bridge（避免新增白名单）。
      const { resolveHitlSink } = await import('../src/step-hitl.ts');
      const { resumeProposalFile } = await import('../src/hitl-bridge.ts');
      const { existsSync, readFileSync: read } = await import('node:fs');
      const sink = resolveHitlSink();
      const health = 'readWithHealth' in sink
        ? (sink as { readWithHealth(): { events: { id: string; type: string; at: string; payload: Record<string, unknown> }[]; badLines: number } }).readWithHealth()
        : { events: sink.read(), badLines: 0 };
      const pending = health.events.filter(e => e.type === 'human_question'
        && !health.events.some(r => r.type === 'human_response' && r.payload?.question_id === e.id));
      const proposalPath = resumeProposalFile();
      const proposals = existsSync(proposalPath)
        ? read(proposalPath, 'utf8').split('\n').filter(Boolean).slice(-20)
          .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }) : [];
      return { pending: pending.map(q => ({ id: q.id, at: q.at, prompt: q.payload?.prompt,
          choices: q.payload?.choices, runId: q.payload?.run_id, asker: q.payload?.asker,
          stepNo: q.payload?.step_no })), badLines: health.badLines,
        proposals: proposals.map(p => ({ id: p.id, questionId: p.questionId, choice: p.choice,
          actor: p.actor, at: p.at, requiresHumanApproval: p.requiresHumanApproval })) };
    }
    case 'admin-hitl-answer': {
      // 第六十轮：真人在协作台网页回答 Agent 提出的人工问题。
      // 与 scripts/step-answer.ts 走同一条判据链（routeAnswerToHitl → persistHitlAnswer
      // → autoResumeAfterAnswer），actor 取当前登录用户，不再依赖 CLI 环境变量。
      const questionId = String(payload.questionId ?? '').trim();
      const choice = String(payload.choice ?? '').trim();
      const note = String(payload.note ?? '').slice(0, 200);
      if (!questionId || !choice) throw new Error('需要 questionId 与 choice');
      const { resolveHitlSink, FileHitlSink } = await import('../src/step-hitl.ts');
      const { routeAnswerToHitl, persistHitlAnswer } = await import('../src/hitl-bridge.ts');
      const { autoResumeAfterAnswer } = await import('../src/auto-resume.ts');
      const sink = resolveHitlSink();
      const health = sink instanceof FileHitlSink
        ? sink.readWithHealth() : { events: sink.read(), badLines: 0 };
      const events = health.events;
      const routed = routeAnswerToHitl({
        inbound: { accepted: true, questionId, choice },
        actor: session.username, events, at: Date.now(), via: 'console', note,
      });
      if (!routed.ok) throw new Error(routed.reason);
      const persisted = persistHitlAnswer(routed, sink);
      // step 模式下按用户授权（AUTO_RESUME_MANDATE）自动排续跑闸；失败如实上报。
      let autoResume: Record<string, unknown> | null = null;
      const config = loadConfig();
      if (config.execution.mode === 'step') {
        const { PgStepQueue } = await import('../src/step-execution.ts');
        const queue = PgStepQueue.fromConfig(config);
        try {
          // routed.ok 已保证该问题存在；非空断言只给类型系统，运行时不会走到 undefined。
          const question = events.find(e => e.type === 'human_question' && e.id === questionId)!;
          const resumed = await autoResumeAfterAnswer({ routed, question,
            enqueue: (runId, specs) => queue.enqueueReadySteps(runId, specs) });
          autoResume = resumed.ok
            ? { ok: true, runId: resumed.runId, enqueued: resumed.enqueued, questionId: resumed.questionId }
            : { ok: false, reason: resumed.reason };
        } catch (error) {
          autoResume = { ok: false, reason: String(error instanceof Error ? error.message : error).slice(0, 200) };
        } finally { await queue.close(); }
      }
      auth.audit('hitl.answer', session.username, { questionId, choice, status: 'ok' });
      return { ok: true, questionId, choice, actor: session.username, responseId: routed.response.id,
        pending: routed.pending, ledgerBadLines: health.badLines,
        proposalPersisted: persisted.proposalPersisted, autoResume,
        note: '回答已成对留痕；回答不等于验收，最终核可仍在原会话' };
    }
    case 'admin-audit': {
      return { entries: auth.readAudit(150).reverse() };
    }
    case 'admin-feishu-auth': {
      // 只生成授权信息与命令；真正登录必须本人在飞书扫码确认。
      if (payload.execute === true) {
        const result = await runLocalScript(['scripts/org-auth.ts', '--execute'], 90000);
        auth.audit('feishu-auth.execute', session.username, { code: result.code,
          output: result.stdout.slice(0, 300) });
        return { ok: result.code === 0, output: (result.stdout + '\n' + result.stderr).trim().slice(0, 4000) };
      }
      const result = await runLocalScript(['scripts/org-auth.ts'], 60000);
      return { ok: result.code === 0, output: result.stdout.trim().slice(0, 4000),
        note: '执行后本人需要在飞书扫码确认；脚本不代替授权，也不会清空已有权限。' };
    }
    default:
      throw new Error('未知管理动作');
  }
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 500) }; }
}

export function createConsoleServer(): Server {
  return createServer(async (req, res) => {
    applyHeaders(res);
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const item = STATIC[url.pathname]!;
        res.writeHead(200, { 'Content-Type': item.type });
        res.end(readFileSync(path.join(consoleDir, item.file)));
        return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const action = url.pathname.slice('/api/'.length);
        const body = await readBody(req);
        const payload = body ? (JSON.parse(body).payload ?? {}) : {};
        // ---- 登录 / 会话（不需要已登录） --------------------------------
        if (action === 'login') {
          try {
            const { cookie, session } = auth.login(String(payload.username ?? ''), String(payload.password ?? ''));
            json(res, 200, { ok: true, session: { username: session.username, role: session.role,
              roleLabel: ROLE_LABELS[session.role], permissions: ROLE_PERMISSIONS[session.role] } },
              { 'Set-Cookie': cookie + '; HttpOnly; SameSite=Strict; Path=/' });
          } catch (error) {
            json(res, 401, { error: String((error as Error).message ?? error) });
          }
          return;
        }
        if (action === 'logout') { auth.logout(req.headers.cookie); json(res, 200, { ok: true }); return; }
        // ---- 以下全部需要会话 -------------------------------------------
        const session = auth.sessionFromRequest(req.headers.cookie);
        if (!session) { json(res, 401, { error: '请先登录', login: true }); return; }
        if (action === 'session') {
          json(res, 200, { username: session.username, role: session.role, roleLabel: ROLE_LABELS[session.role],
            permissions: ROLE_PERMISSIONS[session.role], permissionLabels: PERMISSION_LABELS,
            settings: auth.getUserSettings(session.username) });
          return;
        }
        // ---- 用户级配置：本人读写自己的（管理员也是用户，走同一套） -------
        if (action === 'settings-get') {
          json(res, 200, auth.getUserSettings(session.username));
          return;
        }
        if (action === 'settings-set') {
          try {
            json(res, 200, auth.setUserSettings(session.username, session.username, payload));
          } catch (error) {
            json(res, 400, { error: String((error as Error).message ?? error) });
          }
          return;
        }
        if (CONSOLE_READ_ACTIONS.includes(action)) {
          // 读通道注入真实登录用户（个人区条目按分区过滤，仅归属者与管理员可见）。
          const result = await proxy(action, body, KNOWLEDGE_READ_ACTOR_ACTIONS.includes(action) ? session.username : undefined);
          res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(result.payload);
          return;
        }
        // 第三十四轮：原生知识语义检索（DeepSeek + 本机 embedding）。cognified
        // 数据集跨来源共享，无法按成员分区收口，因此控制台侧只放行所有者与
        // 管理员（bridge 侧本身也是 admin-only），不进通用读白名单。
        if (action === 'cognee-search') {
          if (session.role !== 'owner' && session.role !== 'admin') {
            json(res, 403, { error: '语义检索需要所有者或管理员角色' });
            return;
          }
          // 外部模型检索较慢，放宽到 3 分钟（bridge 侧自身也有 180 秒上限）。
          const result = await proxy(action, body, undefined, 185000);
          res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(result.payload);
          return;
        }
        // P-13：知识写入（登录即可，分区判定在 bridge）。
        if (KNOWLEDGE_WRITE_ACTIONS.includes(action)) {
          const result = await proxy(action, body, session.username);
          res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(result.payload);
          return;
        }
        // 13a ④：离线整理建议 → C-6 候选闸门（登录即可提，人审走治理台账）。
        if (DREAMING_ACTIONS.includes(action)) {
          const result = await proxy(action, body, session.username);
          res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(result.payload);
          return;
        }
        if (action in ADMIN_ACTIONS) {
          if (!can(session, ADMIN_ACTIONS[action]!)) {
            json(res, 403, { error: `当前角色（${ROLE_LABELS[session.role]}）没有这个管理权限` });
            return;
          }
          try {
            json(res, 200, await handleAdmin(action, payload, session));
          } catch (error) {
            json(res, 400, { error: String((error as Error).message ?? error) });
          }
          return;
        }
        json(res, 403, { error: '只允许已登记的动作；发起任务请回到飞书' });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '未找到' }));
    } catch (error) {
      json(res, 502, { error: String((error as Error).message ?? error) });
    }
  });
}

/** 供冒烟脚本在同一进程内启动，避免新增常驻服务。 */
export async function listenConsole(port = 0): Promise<{ server: Server; port: number }> {
  await auth.ready(); // casbin 初始化完成后才提供权限判定（fail-closed）
  return new Promise((resolve, reject) => {
    const server = createConsoleServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : port });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.CONSOLE_PORT ?? 4200);
  const command = process.argv[2];
  // 初始引导：创建第一个所有者账号（只能执行一次）。
  if (command === 'init-owner') {
    const [username, password] = process.argv.slice(3);
    if (!username || !password) { console.log(JSON.stringify({ ok: false, error: '用法：console-server.ts init-owner <用户名> <口令（≥8位）>' })); process.exitCode = 1; }
    else {
      try {
        await auth.ready();
        const account = await auth.bootstrapOwner(username, password);
        console.log(JSON.stringify({ ok: true, username: account.username, role: account.role,
          note: '所有者账号已创建；请在登录后立即在「管理 → 账号」修改口令。' }, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }, null, 2));
        process.exitCode = 1;
      }
    }
  } else {
    listenConsole(port).then(({ port: bound }) => {
      const accounts = auth.listAccounts().length;
      console.log(`SuitMe 协作台已启动：http://127.0.0.1:${bound}/`);
      console.log(accounts
        ? `已登录制：${accounts} 个账号。发起任务请回到飞书。`
        : '尚未创建账号：先运行 npm run console:owner -- <用户名> <口令> 创建所有者。');
    }).catch(error => { console.error(String(error)); process.exitCode = 1; });
  }
}
