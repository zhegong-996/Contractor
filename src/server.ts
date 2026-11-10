import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { loadConfig, runtime, secrets } from './config.ts';
import{Development}from'./development.ts';
import { Github } from './github.ts';
import { LocalGitDelivery } from './local-git.ts';
import { Store } from './store.ts';
import { Controller } from './controller.ts';
import { command } from './commands.ts';
import { sendFeishu } from './upstream.ts';
import { fromAssistantTurn } from './event-stream.ts';
import { KnowledgeService } from './knowledge.ts';
import { Paperclip } from './paperclip.ts';
import { Workspaces } from './workspaces.ts';
import { WorkspaceAssistant } from './assistant.ts';
import { z } from 'zod';
import { withFeishuReads } from './feishu-sources.ts';
import { cogneeNativeStatus, runCogneeNative, loadPersistedCogneeEnvIntoProcess } from './cognee-native.ts';
import { CollaborationIntake } from './collaboration-intake.ts';
// 第三十六轮 · 自动化四件套（用户拍板「这几个也都要做」）：定时调度器 +
// 定时唤醒复查（scheduler）、GitHub 监听（github-watch）、钉钉/企微通道（im-outbound）。
import { Scheduler, automationTrigger } from './scheduler.ts';
import { EventInbox } from './event-inbox.ts';
import { readRetryHealth } from './retry-health.ts';
import { buildChannelHealth } from './channel-health.ts';
import { GithubWatcher } from './github-watch.ts';
import { sendDingtalk, sendWecom, dingtalkEndpoint, wecomEndpoint, dingtalkToTrigger, wecomPlainXmlToTrigger, wecomIsEncrypted, type ImSendResult } from './im-outbound.ts';
import { ModelSettingsService } from './model-settings.ts';
import { KnowledgeGraph, CogneeL1Reader, cogneeCommit } from './graph.ts';
import { createIndependentReviewer } from './visual-review.ts';
import { ServiceNetwork } from './service-network.ts';
import { TeamMemory } from './team-memory.ts';
import { TeamMembers } from './members.ts';
// P-8：把 P-7 的记忆分层守门以只读 advisory 接进真实数据（不改写入链）。
import { guardKnowledge, collectTranscript, assertGuardIsAdvisory } from './knowledge-guard.ts';
// P-13：知识写入链的分区权限判定（人与 agent 共用 casbin，见 src/rbac.ts）。
import { canWriteKnowledge, canCreateKnowledge, canReadKnowledge, type KnowledgeActor } from './knowledge-authz.ts';
import { initRbac, syncHumans, ensureHumanBound } from './rbac.ts';
// P-9：双向协作回路的一等契约；三个执行链节点把真实事件留痕后，由只读体检汇总。
import {
  loopReport, attachImplicitReplies, fromHitlLedger, loopSignature, dedupeLoopEvents,
  type LoopEvent, type HitlEventLike,
} from './collaboration-loop.ts';
import { AgentServices } from './agent-services.ts';
import { OntologyService } from './ontology.ts';
import { V06Services } from './v06.ts';
import { RuntimeGuardBridge } from './runtime-bridge.ts';
import { collectServiceStatus, type ServiceStatusReport } from './service-status.ts';
import { getRoutingTrace, readRoutingEvents, replayRouting } from './routing-trace.ts';
import { assessThreeTier, shapeOptions } from './three-tier-assessment.ts';
import { configureRouter, getRouter, planCoverage } from './router.ts';
import { configureAgentRegistry, getAgentRegistry } from './agent-registry.ts';
import { getMemoryLog, readBridgedEvents } from './memory-log.ts';
import { memoryReplayReport } from './memory-projections.ts';
// 13a（第 13 条写入链改造落地）：知识表示层投影 / 注入索引 / 离线整理建议。
import { knowledgeWikiView, writeWikiProjection, writeInjectedIndex } from './knowledge-representation.ts';
import { dreamFromKnowledge, registerDreamProposals } from './dreaming.ts';
import { EvolutionService, defaultEvolutionDeps } from './evolution.ts';
// P-5：控制台只读摘要（服务端分页 / 字段裁剪），原 view 逐字保留。
import { buildWorkspaceSummary, parseViewSummaryPage, visibleTasksFor, type HostTitle } from './workspace-summary.ts';
import { buildOrganizationView } from './organization-view.ts';

// 第三十四轮（key 持久化）：启动时把 .runtime/cognee-env.json（gitignored、0600）
// 里的凭据装载进进程环境；已设的进程环境变量优先，不会被覆盖。装载失败（文件
// 缺失 / 损坏）静默跳过——原生管线状态接口会如实报「未就绪」。
loadPersistedCogneeEnvIntoProcess();
const config = loadConfig(); const credentials = secrets();
// C-3：用组织形态配置装配单一 Router；五个派活点此后都经它写同一份 Trace。
// C-4：同时装配组织级 Agent 注册表，Router 才校验主管是否真实在岗 / 职责匹配 / 范围覆盖；
// 默认空注册表 = 扁平小团队，不硬造管理层。A2A 交接与验收编组共用同一份注册表单例。
configureAgentRegistry(config.agentRegistry);
configureRouter(config.router, undefined, getAgentRegistry());

/** 只读探测本机代码交付台；没有连接时返回 ok:false，前端不给空入口。 */
function deliveryStatus(): Promise<{ ok: boolean; url: string; git: string | null; provider: string }> {
  const port = config.delivery.port, url = `http://127.0.0.1:${port}/`;
  return new Promise(resolve => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: '/health', method: 'GET', timeout: 1200 }, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const health = JSON.parse(body);
          // 只认本机交付台自己的健康响应：端口被别的服务占用时不能误判为「已接通」，
          // 否则前端会渲染一个指向错误服务的可点入口。
          const ok = health.ok === true && health.scope === 'loopback-only'
            && health.provider === 'local-git' && health.port === port;
          resolve({ ok, url, git: ok ? (String(health.git ?? '') || null) : null,
            provider: String(health.provider ?? 'local-git') });
        }
        catch { resolve({ ok: false, url, git: null, provider: 'local-git' }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ ok: false, url, git: null, provider: 'local-git' }));
    req.end();
  });
}

/**
 * 「国内服务」清单的唯一数据源：并发实时探测本机服务，未接通项由
 * service-status 模块统一给出原因与可照做的步骤，绝不带可点入口。
 */
function serviceStatus(feishuState: string): Promise<ServiceStatusReport> {
  let paperclipPort = 3100;
  try { paperclipPort = Number(new URL(config.paperclipUrl).port) || 3100; } catch { /* 保持默认 */ }
  return collectServiceStatus({
    paperclipPort,
    deliveryPort: config.delivery.port,
    gitPort: config.delivery.gitPort,
    visionPort: 4190, reportPort: 4192, // 与 vision-server / acceptance-report 的固定 loopback 端口一致
    acceptanceMode: config.acceptance?.mode ?? 'legacy',
    visualReviewerMode: config.acceptance?.visualReviewer?.mode ?? 'structural',
    feishuState,
  });
}
const store = new Store(runtime('bridge.sqlite'));
// 统一路由 Trace：五个派活点共用单例，审计表作为第二份只读投影在此挂一次。
getRoutingTrace().attachAudit((action, issueId, value) => store.audit(action, issueId, value));
// 方案 B：共享记忆事件主干同样投影一份到 SQLite audit，便于工作台过程流水核对。
getMemoryLog().attachAudit((action, issueId, value) => store.audit(action, issueId, value));
// 国内环境默认走本机 Git 交付；已有部署可显式配置 delivery.provider=github 回退。
const deliveryAdapter = config.delivery.provider === 'local' ? new LocalGitDelivery(config) : new Github(config);
const control = new Controller(config, store, deliveryAdapter);
const knowledge = new KnowledgeService(config, store, control.pc, credentials.jwtSecret);
const workspaces = new Workspaces(config, store);
const assistant = new WorkspaceAssistant(workspaces);
const development=new Development(workspaces,control,assistant);
const agentServices = new AgentServices(workspaces);
const teamMembers = new TeamMembers(workspaces);
const serviceNetwork = new ServiceNetwork(workspaces, assistant);
const teamMemory = new TeamMemory(workspaces);
const collaborationIntake = new CollaborationIntake(workspaces, assistant, agentServices);
// 第三十六轮 · 自动化四件套实例：调度器 / GitHub 监听挂进主循环 tick（见下方
// tick()），出站镜像挂进 deliver()；入站端点见 /github/webhook 与 /im/*。
// 第三十八轮 · 事件收件箱：GitLab / 任意业务系统 POST 进来的事实先落这里，
// 再由 scheduler 的 `when` 规则决定「要不要开工单、合并成几条」。
const eventInbox = new EventInbox(store, config.eventInbox);
const scheduler = new Scheduler(workspaces, assistant, config, () => new Date(), eventInbox);

const githubWatcher = new GithubWatcher(workspaces, assistant, config);
const modelSettings = new ModelSettingsService(workspaces);
const graph = new KnowledgeGraph(workspaces);
const ontology = new OntologyService(workspaces);
// v0.6 functional layer: Paperclip native documents for task facts, local
// config for organisation policy, SQLite for audit only.
const v06 = new V06Services(store, workspaces.pc, undefined,
  createIndependentReviewer(config), new CogneeL1Reader(graph))
  .setEvolution(V06Services.evolutionWithConfig(config));
control.v06 = v06;
// Auto-extraction hook: after a verified L1 projection is indexed, read that
// exact revision and draft L2 organisation edges. Best-effort, audited.
workspaces.onSourceIndexed = async (sourceId, revision) => {
  if (config.orgExtraction.enabled === false) return;
  await v06.l2Extract({ sourceId, revision, actor: 'l2-auto-index', space: 'default' });
};
// Enforced by default; human-required notifications are always delivered.
const guard = new RuntimeGuardBridge(store, async space => {
  const [attention, watchdog] = await Promise.all([v06.attentionPolicy(space), v06.watchdogPolicy(space)]);
  return { attention: attention.policy, watchdog: watchdog.policy };
}, config.runtimeGuard.enforce, config.runtimeGuard.protectHumanNotifications);
// 第二十九轮 P-11 修复：协作 intake「没接住」的消息（routed:false，例如绑定
// 聊天里发「任务 …」建新单、或对非协作任务发「确认验收 …」）此前被真值返回
// 吞掉，Controller 永远收不到——新任务建不出来、验收指令无响应。现在这类
// 消息显式落回 Controller 的中文指令链；协作 intake 抛错（Unauthorized 等）
// 仍然原样上抛，不静默改道。
const ingest = async (input: unknown) => {
  const collab = await collaborationIntake.ingest(input);
  if (collab !== undefined && collab !== null && (collab as { routed?: boolean }).routed !== false) return collab;
  return control.ingest(input);
};
let feishuState = config.feishu.enabled ? 'connecting' : 'disabled';
let tail: Promise<unknown> = Promise.resolve();
const serialize = <T>(job: () => Promise<T>): Promise<T> => { const work = () => withFeishuReads(job); const next = tail.then(work, work); tail = next.catch(() => {}); return next; };
function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function identity(req: IncomingMessage): { admin: boolean; agent?: string; userId?: string } {
  const credentials=secrets();
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  // authenticated 模式下，adminToken 代表 board owner（龚哲）：
  // 带上真实 userId，飞书配对、职能登记等「要落到具体人」的动作才有着落。
  if (equal(token, credentials.adminToken)) return { admin: true, userId: credentials.adminUserId };
  const agent = Object.entries(credentials.agentTokens).find(([, value]) => equal(token, value))?.[0];
  if (!agent || !config.agents[agent]?.enabled) throw new Error('Unauthorized'); return { admin: false, agent };
}
async function body(req: IncomingMessage): Promise<any> { let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 512000) throw new Error('Request too large'); } return data ? JSON.parse(data) : {}; }
/** webhook / 通道回调需要原始字节（HMAC 验签按原文算），不能走 JSON.parse 通道。 */
async function readRawBody(req: IncomingMessage): Promise<string> { let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 512000) throw new Error('Request too large'); } return data; }
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.bridgePort}`);
    if (url.pathname === '/health') { res.end(JSON.stringify({ status: 'ok', paperclip: config.paperclipUrl, feishu: feishuState, agents: Object.entries(config.agents).filter(([, a]) => a.enabled).map(([key, a]) => ({ key, mode: a.mode })) })); return; }
    if (req.method === 'GET' && url.pathname.startsWith('/preview/')) {
      const match = /^\/preview\/([a-f0-9-]+)\/([a-f0-9]{40})\/(index\.html|version\.json)$/.exec(url.pathname);
      if (!match) throw new Error('Invalid preview path');
      const task = store.get(match[1]!);
      if (task.delivery?.deployedSha !== match[2]) throw new Error('Preview is not the current verified delivery');
      const file = path.join(runtime('previews'), match[1]!, match[2]!, match[3]!);
      res.setHeader('Content-Type', match[3] === 'index.html' ? 'text/html; charset=utf-8' : 'application/json');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'");
      res.end(await readFile(file)); return;
    }
    // 第三十六轮 · GitHub webhook（可选入站；HMAC 验签，密钥在环境变量
    // GITHUB_WEBHOOK_SECRET）。bridge 只绑 127.0.0.1，公网暴露需自行反代。
    if (req.method === 'POST' && url.pathname === '/github/webhook') {
      const raw = await readRawBody(req);
      const header = (name: string): string | undefined => {
        const value = req.headers[name];
        return Array.isArray(value) ? value[0] : value;
      };
      // 第三十九轮 · 一条通道只有一个入口：一旦有人把 github 登记进
      // eventInbox.sources，webhook 就交给收件箱，由 `when` 规则决定开不开单、
      // 要不要合并成一轮；否则仍走既有即时通道（收到就建单），行为不变。
      if (eventInbox.claims('github')) {
        const result = eventInbox.accept('github', raw, {
          'x-hub-signature-256': header('x-hub-signature-256'),
          'x-signature-256': header('x-signature-256'),
          'x-github-event': header('x-github-event'),
        });
        res.statusCode = result.ok ? 202 : 400;
        res.end(JSON.stringify({ ...result, routed: 'inbox' })); return;
      }
      const result = await serialize(() => githubWatcher.handleWebhook(raw,
        req.headers['x-hub-signature-256'] as string | undefined,
        req.headers['x-github-event'] as string | undefined));
      // 已验签但未走到建单的事实（duplicate / ignored / no-target / 未监听类型）
      // 在收件箱留一条 mirrored 痕迹：不参与分流，只为让「这个仓库投过什么」
      // 只看一张表就能回答。验签失败不留痕 —— 那本来就不是我们的事实。
      if (!['not-enabled', 'webhook-secret-not-configured', 'bad-signature', 'bad-json'].includes(String(result?.reason))) {
        eventInbox.mirror('github', raw, {
          'x-hub-signature-256': header('x-hub-signature-256'),
          'x-github-event': header('x-github-event'),
        }, 'github-watch', 'github');
      }
      res.end(JSON.stringify(result)); return;
    }
    // 第三十八轮 · 通用入站事件源（GitLab / 任意业务系统）。只把事实写进收件箱
    // （events 表 inbox:* 记录），不开工单；要不要开、合并成几条，由 scheduler
    // 的 when 规则决定。每来源一把独立密钥，没有密钥的形态在这里直接拒收。
    if (req.method === 'POST' && url.pathname.startsWith('/events/')) {
      const source = decodeURIComponent(url.pathname.slice('/events/'.length)) || '';
      const raw = await readRawBody(req);
      const header = (name: string): string | undefined => {
        const value = req.headers[name];
        return Array.isArray(value) ? value[0] : value;
      };
      const result = eventInbox.accept(source, raw, {
        'x-signature-256': header('x-signature-256'),
        'x-hub-signature-256': header('x-hub-signature-256'),
        'x-gitlab-token': header('x-gitlab-token'),
        'x-gitlab-event': header('x-gitlab-event'),
        'x-github-event': header('x-github-event'),
        authorization: header('authorization'),
      });
      // 202 = 已收下待分流（含重复投递）；400 = 拒收，原因写在 reason 里。
      res.statusCode = result.ok ? 202 : 400;
      res.end(JSON.stringify(result)); return;
    }
    // 第三十六轮 · 钉钉 / 企微入站端点（可选；需公网回调，本地经反代可达）。
    // 消息转 NativeTrigger 走与飞书相同的 ingestTrigger 链；白名单按通道
    // 独立配置（allowedSenders，默认空 = 拒绝所有）。
    if (url.pathname === '/im/dingtalk' && req.method === 'POST') {
      let parsed: Record<string, unknown> | undefined; try { parsed = JSON.parse(await readRawBody(req)) as Record<string, unknown>; } catch { parsed = undefined; }
      const trigger = parsed ? dingtalkToTrigger(parsed) : undefined;
      if (!trigger) { res.statusCode = 400; res.end(JSON.stringify({ error: '无法解析钉钉回调（需要明文 JSON，含 conversationId / senderStaffId / text.content / msgId）' })); return; }
      const result = await serialize(() => collaborationIntake.ingestTrigger(automationTrigger(trigger)));
      res.end(JSON.stringify({ ok: true, result })); return;
    }
    if (url.pathname === '/im/wecom') {
      if (req.method === 'GET') {
        // 企微回调 URL 验证（明文模式）：原样回显 echostr。
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(url.searchParams.get('echostr') ?? ''); return;
      }
      if (req.method === 'POST') {
        const raw = await readRawBody(req);
        if (wecomIsEncrypted(raw)) { res.statusCode = 400; res.end(JSON.stringify({ error: '企微加密模式（EncodingAESKey）尚未支持，请配置明文模式' })); return; }
        const trigger = wecomPlainXmlToTrigger(raw);
        if (!trigger) { res.statusCode = 400; res.end(JSON.stringify({ error: '无法解析企微明文回调（需要 <xml> 包裹的 text 消息）' })); return; }
        const result = await serialize(() => collaborationIntake.ingestTrigger(automationTrigger(trigger)));
        res.end(JSON.stringify({ ok: true, result })); return;
      }
    }
    if (req.headers.origin) throw new Error('Browser mutations are not accepted by this local bridge');
    if (req.method === 'POST' && url.pathname.startsWith('/workspace/')) {
      const data = await body(req), token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      let workspaceActor: import('./workspaces.ts').WorkspaceActor;
      if (credentials.workspacePluginToken && equal(token, credentials.workspacePluginToken)) {
        const host = data.hostActor;
        if (host?.companyId !== config.companyId) throw new Error('Unauthorized: company boundary');
        if (host.type === 'user') workspaceActor = await teamMembers.resolve(host.userId);
        else if (host.type === 'agent') {
          const key = Object.entries(config.agents).find(([, value]) => value.enabled && value.paperclipId === host.agentId)?.[0];
          if (!key) throw new Error('Unauthorized'); workspaceActor = { admin: false, agent: key };
        } else throw new Error('Unauthorized: this installation has no multi-user operator binding');
      } else workspaceActor = identity(req);
      const payload = data.payload ?? data;
      const action = url.pathname.slice('/workspace/'.length);
      // Reads recheck their own scope and revisions. They need not wait behind
      // indexing or native process reconciliation; mutations keep the single lane.
      const v06Reads=['roles-view','role-route','role-hints','role-snapshot','transfer-view','transfer-policy','dispatch-guard','grant-widen','grant-check','edges-view','edge-impact','label-check','policy-view','verification-level','topology-advice','inflight-policy','signals','review-readiness','ontology-meta','ontology-view','ontology-query','attention-policy','attention-filter','watchdog-policy','watchdog-inspect','plan-view','round-view','acceptance-workbench','acceptance-discussion-list','acceptance-export','acceptance-report-view','reconcile-run','topic-list','topic-view','artifact-list','artifact-view','org-overview','org-mapping-view','context-pack','l2-status','l2-edges-view','l2-graph-view','agent-registry-view','acceptance-crew','evolution-view','execution-view'];
      const readOnly=['view','view-summary','team-members','agent-services','agent-build','development-view','delivery-status','service-status','routing-status','organization-view','channel-health','memory-replay','memory-guard','loop-guard','network-view','memory-status','memory-search','memory-annotations','context-pack','context-record','context-search','ontology-view','model-settings','system-status','trace-view','knowledge-list','knowledge-get','knowledge-wiki','cognee-search','scheduler-status','event-inbox-status','retry-health','wake-list','github-watch-status'].includes(action)||action==='knowledge-graph'&&payload.project!==true||action.startsWith('v06-')&&v06Reads.includes(action.slice(4));
      const runWorkspace=readOnly?<T>(job:()=>Promise<T>)=>withFeishuReads(job):serialize;
      res.end(JSON.stringify(await runWorkspace(async () => {
        workspaceActor = await teamMembers.gate(action, payload, workspaceActor);
        // P-5：view-summary 与 view 同为高频只读快照，同样不逐次写成员审计，避免切一次视图多一条噪声。
        if(workspaceActor.userId&&action!=='view'&&action!=='view-summary')store.audit('member.action',payload.taskId??config.companyId!,{userId:workspaceActor.userId,action});
        // v0.6: all new semantic objects reach the human through the same
        // channel renderer (conversation text + workbench link + optional card).
        if(action.startsWith('v06-'))return v06.dispatch(action.slice(4),payload,workspaceActor,{workbenchUrl:config.paperclipUrl,channel:'workspace',actorUserId:workspaceActor.userId??'local-operator'});
        if(action==='development-view')return development.view(payload.taskId,workspaceActor);
        if(action==='delivery-status')return deliveryStatus();
        if(action==='service-status')return serviceStatus(feishuState);
        if(action==='memory-replay'){
          const {events,errors,routingEvents}=readBridgedEvents();
          return {...memoryReplayReport(events,errors),bridgedRoutingEvents:routingEvents};
        }
        if(action==='memory-guard'){
          // 只读 advisory：P-7 五条守门跑在真实 B1 事件与本地知识任务索引上。
          // 不读宿主文档正文、不写任何状态、不因缺口拦截业务；真实记录缺
          // evidenceEventIds 时如实报缺口，绝不编造事件 id 把体检跑绿。
          const {events}=readBridgedEvents();
          // 第二十八轮修复：真实 knowledge 任务的 context 是 '{}'（真值），旧写法
          // `t.context||t.identifier` 会让 22 条记录的 title 全变成 '{}'；空对象
          // 必须回退到 identifier，其余字段保持「如实报缺口、不编造」的原口径。
          const records=store.list().filter(t=>t.kind==='knowledge').map(t=>({
            key:t.identifier, title:t.context&&t.context!=='{}'?t.context:t.identifier, state:'candidate' as const,
          }));
          const report=guardKnowledge({records,transcript:collectTranscript(events)});
          assertGuardIsAdvisory(report);
          return {...report,source:'local-store',documentBodiesNotRead:true,
            note:'只读体检：不读宿主知识正文、不改任务状态/授权/验收。新 propose/revise 已按 13a 挂靠证据锚点；存量旧记录缺 evidenceEventIds 时如实报缺口，不回填、不编造事件 id'};
        }
        if(action==='loop-guard'){
          // P-9 只读体检：汇总三个真实执行链节点的留痕，判「两条相反方向的移动」
          // 是否真的闭合。不读宿主正文、不改任务状态/授权/验收、不拦截业务；
          // 真实链路尚无留痕时如实报 bidirectional:false，绝不编造事件跑绿。
          const rows=store.db.prepare("SELECT id,at,action,issue_id,value FROM audit WHERE action IN ('loop.upstream','loop.downstream') ORDER BY id").all() as {id:number;at:string;action:string;issue_id:string|null;value:string}[];
          const collected:LoopEvent[]=[];let upstreamRows=0,downstreamRows=0;
          for(const row of rows){
            let value:any;try{value=JSON.parse(row.value);}catch{continue;}
            const at=Date.parse(row.at)||0,taskId=row.issue_id??'';
            if(row.action==='loop.upstream'){
              upstreamRows++;
              for(const event of (Array.isArray(value.events)?value.events:[]))collected.push(event as LoopEvent);
            }else{
              downstreamRows++;
              collected.push({id:'down:'+String(value.eventId??row.id),direction:'downstream',
                kind:value.kind==='answer'?'answer':'supplement',at,taskId,
                actor:String(value.actor??'originator'),acceptance:false,
                ...(value.inReplyTo?{inReplyTo:String(value.inReplyTo)}:{})});
            }
          }
          // 第二十八轮修复：台账坏行不再被静默丢弃，badLines 如实报出。
          const readLedger=(file:string):{rows:Record<string,unknown>[];badLines:number}=>{
            if(!existsSync(file))return{rows:[],badLines:0};
            let badLines=0;
            const out=readFileSync(file,'utf8').split('\n').filter(Boolean).flatMap(line=>{
              try{return[JSON.parse(line) as Record<string,unknown>];}catch{badLines+=1;return[];}
            });
            return{rows:out,badLines};
          };
          const hitlFile=runtime('step-hitl','events.jsonl');
          const hitlRead=readLedger(hitlFile);
          const hitl=hitlRead.rows as unknown as HitlEventLike[];
          collected.push(...fromHitlLedger({events:hitl}));
          const proposalFile=runtime('step-hitl','resume-proposals.jsonl');
          const proposals=readLedger(proposalFile).rows
            .filter(p=>p&&typeof p.id==='string'&&typeof p.responseId==='string')
            .map(p=>({id:String(p.id),inReplyTo:String(p.responseId)}));
          // 第二十八轮修复：同一条 IM 消息可能被 reply() 与 ingest() 双留痕（或审计行
          // 重复），按 id 去重后不再双计下行；去掉的条数与撞号如实报出，不静默吞掉。
          const deduped=dedupeLoopEvents(collected);
          const events=attachImplicitReplies(deduped.events);
          const report=loopReport({events,humanOwners:config.feishu.allowedSenders,resumeProposals:proposals});
          return {...report,signature:loopSignature(report),advisory:true,blocking:false,modelCalls:0,
            couplingPoints:{receiptRows:upstreamRows,replyRows:downstreamRows,
              hitlEvents:hitl.length,resumeProposals:proposals.length},
            ledgerHealth:{hitlBadLines:hitlRead.badLines,dedupedLoopEvents:deduped.duplicates,
              ...(deduped.duplicateIds.length?{duplicateIds:deduped.duplicateIds.slice(0,20)}:{})},
            source:'local-audit + step-hitl ledger',documentBodiesNotRead:true,
            note:'只读回路体检：上行（回执/提问/请示）与下行（发起/回答/接续/核可）必须成对；回执≠验收、回答≠放行，续跑建议仍待真人在原会话确认'};
        }
        if(action==='routing-status'){
          const {events,errors}=readRoutingEvents();const projection=replayRouting(events);
          return {ok:true,log:'.runtime/routing/events.jsonl',eventCount:events.length,logErrors:errors,
            projection,threeTier:assessThreeTier(events,projection,errors,
              shapeOptions(getRouter(),getAgentRegistry())),
            router:getRouter().status(),routerCoverage:planCoverage(events)};
        }
        if(action==='organization-view'){
          // 只读聚合：团队共有的上下文底座 + 当前组织形态与编制 + 可见任务分布。
          // 不派单、不写编制、不因空编制硬造主管；层是配置不是骨架。
          const catalog=workspaces.catalog();
          const {events}=readBridgedEvents();
          const router=getRouter().status();
          return buildOrganizationView({
            shape:{mode:router.mode,maxHops:router.maxHops,domains:router.domains.map(domain=>domain.id)},
            registry:getAgentRegistry(),
            tasks:visibleTasksFor(workspaceActor,store.list()),
            events:events.length,sources:catalog.sources.length,spaces:Object.keys(catalog.spaces).length,
          });
        }
        if(action==='development-start')return development.start(payload,workspaceActor);
        if(action==='development-accept')return development.accept(payload,workspaceActor);
        if (action === 'network-route') return serviceNetwork.route(payload, workspaceActor);
        if (action === 'network-delegate') return serviceNetwork.start(payload.taskId,payload.serviceId,workspaceActor);
        if (action === 'network-view') return serviceNetwork.view(payload.taskId,workspaceActor);
        if (action === 'network-answer') return serviceNetwork.answer(payload.taskId,payload.childId,payload.text,workspaceActor);
        if (action === 'network-cancel') return serviceNetwork.cancel(payload.taskId,payload.childId,workspaceActor);
        if (action === 'memory-annotations') return teamMemory.inspect(payload.sourceId,workspaceActor,payload.taskId);
        if (action === 'memory-status') return teamMemory.status(workspaceActor);
        if (action === 'memory-search') return teamMemory.search(payload.taskId,payload.query,workspaceActor);
        if (action === 'memory-propose') return teamMemory.propose(payload.annotation,workspaceActor,payload.taskId);
        if (action === 'memory-review') return teamMemory.review(payload.sourceId,payload.revision,payload.documentRevision,payload.confirmed===true,workspaceActor);
        if (action === 'memory-index') return teamMemory.index(payload.sourceId,workspaceActor);
        if (action === 'member-pair-code') return teamMembers.pairCode(workspaceActor);
        if (action === 'team-members') return teamMembers.view(workspaceActor);
        if (action === 'bind-member-agent') return teamMembers.bind(payload, workspaceActor);
        if (action === 'provision-member-agent') return teamMembers.provision(payload, workspaceActor);
        if (action === 'agent-services') return agentServices.view(workspaceActor);
        if (action === 'agent-build') return agentServices.build(payload.profile,workspaceActor);
        if (action === 'save-agent-services') return agentServices.save(payload.profiles, payload.revision ?? null, workspaceActor);
        if (action === 'invoke-agent-service') return agentServices.start(payload, workspaceActor, assistant);
        if (action === 'rebind-agent-service') return agentServices.rebind(payload.taskId, payload.version, workspaceActor, assistant);
        if (action === 'model-settings') return modelSettings.read(workspaceActor);
        // ---- P-13 知识写入链：人（console 注入 actorUser）与 agent 的分区 CRUD ----
        // 读通道同样按真实登录用户判定分区（第三十一轮补 P-13 的读边界）：
        // console 代理虽是 bridge admin，actorUser 由可信端注入后按本人判，
        // 个人区条目仅归属者与管理员可见，冒充他人只会降权不会提权。
        const knowledgeReadActor = (): KnowledgeActor => typeof payload.actorUser === 'string' && /^[a-zA-Z0-9_-]{2,32}$/.test(payload.actorUser)
          ? { kind: 'human', username: payload.actorUser }
          : workspaceActor.agent
            ? { kind: 'agent', key: workspaceActor.agent, agent: getAgentRegistry().agents.find(a => a.key === workspaceActor.agent) }
            : { kind: 'human', username: workspaceActor.userId ?? 'local-operator' };
        // 读判定同样先自愈跨进程绑定（fail-closed 方向：宁可多拒不可越权）。
        if (action === 'knowledge-list' || action === 'knowledge-get') {
          const pre = knowledgeReadActor();
          if (pre.kind === 'human') await ensureHumanBound(pre.username);
        }
        /**
         * 第四十一轮 · 读方业务域：agent 取 registry 生效范围；人取其实名个人
         * Agent 所在的知识空间域（与写链 `members(domain)` 用同一事实源，不另造
         * 一套「可读域」配置）。拿不到就返回 undefined，由 canReadKnowledge 按
         * 档位兜底——不退回「全域放行」。
         */
        const knowledgeReadDomains = (actor: KnowledgeActor): readonly string[] | undefined => {
          if (actor.kind === 'agent') return actor.agent?.domains;
          const catalog: any = workspaces.catalog?.() ?? {};
          const agentKey = catalog.memberAgents?.[actor.username];
          if (!agentKey) return undefined;
          const domains = Object.entries(catalog.spaces ?? {})
            .filter(([, space]: [string, any]) => Array.isArray(space?.members) && space.members.includes(agentKey))
            .map(([id]) => id);
          return domains.length ? domains : undefined;
        };
        if (action === 'knowledge-list') {
          // 宽松列举：任务文档里 knowledge-* 但非结构化条目的（如 knowledge-context
          // 引用文件）如实跳过，不让一条坏行挡住整个列表。
          const readerActor = knowledgeReadActor();
          const readerDomains = knowledgeReadDomains(readerActor);
          const records = [];
          for (const task of store.list()) {
            const docs = await control.pc.get<any[]>(`/issues/${task.id}/documents`).catch(() => []);
            for (const doc of (docs ?? []).filter(d => /^knowledge-[a-z0-9-]{1,36}$/.test(d.key ?? ''))) {
              try {
                const record = await knowledge.read({ taskId: task.id, key: doc.key });
                if (canReadKnowledge(readerActor, record.value, undefined, { readerDomains }).allowed) records.push(record);
              } catch { /* 非条目文档跳过 */ }
            }
          }
          return { items: records.map(r => ({ taskId: r.ref.taskId, key: r.ref.key, revision: r.revision,
            title: r.value.title, kind: r.value.kind, state: r.value.state, domains: r.value.domains,
            visibility: r.value.visibility ?? 'org', owner: r.value.owner ?? '', proposedBy: r.value.proposedBy,
            updatedAt: r.value.updatedAt })) };
        }
        if (action === 'knowledge-get') {
          const record = await knowledge.read({ taskId: String(payload.taskId ?? ''), key: String(payload.key ?? '') });
          const readerActor = knowledgeReadActor();
          const gate = canReadKnowledge(readerActor, record.value, undefined, { readerDomains: knowledgeReadDomains(readerActor) });
          if (!gate.allowed) throw new Error('未授权：' + gate.reason);
          return { value: record.value, revision: record.revision };
        }
        if (action === 'knowledge-wiki') {
          // 13a ②③ 只读体检 + 投影落盘：wiki 与注入索引都是 canonical 知识文档
          // 的投影（可重建、不是第二事实源）；体检只读不改，缺口如实报出。
          // 第四十一轮：按读方可读范围过滤；一旦过滤就不写盘，避免把某个人的
          // 可读视角变成全组织共享投影。
          const wikiActor = knowledgeReadActor();
          const wikiDomains = knowledgeReadDomains(wikiActor);
          const view = await knowledgeWikiView(knowledge, {
            readable: record => canReadKnowledge(wikiActor, record as any, undefined, { readerDomains: wikiDomains }).allowed,
          });
          if (view.filtered) return { ...view, note: view.note + '；本视图已按你的可读范围过滤，共享投影未写盘（过滤后的视角不能当全量投影）' };
          writeWikiProjection(view.pages);
          writeInjectedIndex(view.injected);
          return view;
        }
        if (action === 'dreaming-run') {
          // 13a ④：离线整理建议 → C-6 候选改进闸门。登记（proposed）不越权：
          // 工程闸门 / 真人批准 / 灰度全部走既有治理台账；重复跑按 candidateId
          // 查重，不堆重复候选。恒 modelCalls=0。
          const { records: listed, skipped: skippedDocs } = await knowledge.listLenient();
          const records = listed.map(entry => entry.value);
          const { events } = readBridgedEvents();
          const proposals = dreamFromKnowledge(records, events);
          const evolution = new EvolutionService(defaultEvolutionDeps(config));
          const actor = workspaceActor.userId ? 'user:' + workspaceActor.userId : workspaceActor.agent ? 'agent:' + workspaceActor.agent : 'local-operator';
          const result = registerDreamProposals(
            ({ title, reason }) => evolution.propose({ title, reason, sourceTaskId: 'dreaming', sourceRound: 0, targets: [], actor }),
            evolution.view().candidates.map(candidate => candidate.id),
            proposals);
          store.audit('dreaming.run', payload.taskId ?? config.companyId ?? 'organization',
            { actor, proposals: proposals.length, registered: result.registered.length, skippedDuplicates: result.skippedDuplicates, skippedDocuments: skippedDocs });
          return { ...result, skippedDocuments: skippedDocs,
            note: '离线整理只提建议（恒待人复核）；提升 / 修正的执行仍走人审确认与知识审核，不自动采用' };
        }
        if (action === 'knowledge-create' || action === 'knowledge-update' || action === 'knowledge-delete') {
          // actorUser 由可信端（console）注入：/workspace 全程已鉴权（插件/管理
          // token），冒充他人只会降权不会提权。agent 调用则按其 registry 档位判。
          const actor: KnowledgeActor = typeof payload.actorUser === 'string' && /^[a-zA-Z0-9_-]{2,32}$/.test(payload.actorUser)
            ? { kind: 'human', username: payload.actorUser }
            : workspaceActor.agent
              ? { kind: 'agent', key: workspaceActor.agent, agent: getAgentRegistry().agents.find(a => a.key === workspaceActor.agent) }
              : { kind: 'human', username: workspaceActor.userId ?? 'local-operator' };
          const sub = actor.kind === 'human' ? 'user:' + actor.username : 'agent:' + actor.key;
          // 判定前自愈绑定（跨进程快照漂移：新建/改角色账号按 accounts.json 现绑）。
          if (actor.kind === 'human') await ensureHumanBound(actor.username);
          if (action === 'knowledge-create') {
            const task = store.get(String(payload.taskId ?? ''));
            if (!task || task.kind === 'collaboration') throw new Error('创建知识需要一个本项目内非协作的挂靠任务');
            const visibility = (['personal', 'team', 'org'].includes(String(payload.visibility)) ? payload.visibility : 'org') as 'personal' | 'team' | 'org';
            // 第四十轮：新建也要按条目自己的业务域校验 agent 范围（与改已有条目一致）。
            const gate = canCreateKnowledge(actor, visibility,
              { domains: Array.isArray(payload.domains) ? payload.domains.map(String) : undefined });
            if (!gate.allowed) throw new Error('未授权：' + gate.reason);
            const { actorUser: _a, taskId: _t, ...input } = payload; // visibility 留在 input（knowledgeInput 校验归属分区）
            const created = await knowledge.propose(task, input, sub);
            store.audit('knowledge.crud-create', task.id, { key: created.ref.key, actor: sub, visibility });
            return { ok: true, key: created.ref.key, revision: created.revision, visibility };
          }
          const ref = { taskId: String(payload.taskId ?? ''), key: String(payload.key ?? '') };
          const record = await knowledge.read(ref);
          if (action === 'knowledge-update') {
            const gate = canWriteKnowledge(actor, record.value, 'update');
            if (!gate.allowed) throw new Error('未授权：' + gate.reason);
            if (payload.visibility && String(payload.visibility) !== (record.value.visibility ?? 'org')) {
              const reGate = canCreateKnowledge(actor, String(payload.visibility) as 'personal' | 'team' | 'org',
                { domains: Array.isArray(payload.domains) ? payload.domains.map(String) : record.value.domains });
              if (!reGate.allowed) throw new Error('未授权变更归属域：' + reGate.reason);
            }
            const { actorUser: _a, taskId: _t, ...input } = payload; // key 留在 input（revise 校验与条目一致）
            const updated = await knowledge.revise(ref, input, sub, { keepOwner: true });
            store.audit('knowledge.crud-update', ref.taskId, { key: ref.key, actor: sub });
            return { ok: true, key: ref.key, revision: updated.revision };
          }
          const gate = canWriteKnowledge(actor, record.value, 'delete');
          if (!gate.allowed) throw new Error('未授权：' + gate.reason);
          await knowledge.review(ref, 'withdrawn', record.revision, sub);
          store.audit('knowledge.crud-delete', ref.taskId, { key: ref.key, actor: sub });
          return { ok: true, key: ref.key, state: 'withdrawn' };
        }
        if (action === 'knowledge-graph') return graph.run(payload.sourceId, payload.revision, payload.project === true, workspaceActor, payload.taskId);
        // 第三十四轮：原生知识检索（管理后台「知识检索」页）。管理员专用——cognified
        // 数据集是跨来源共享的，成员级权限无法按条目收口，因此不开放给成员。
        if (action === 'cognee-search') {
          workspaces.manager(workspaceActor);
          const query = String(payload.query ?? '').trim();
          if (!query) throw new Error('cognee-search 需要非空 query');
          return runCogneeNative(config, 'search', { query,
            dataset: String(payload.dataset ?? '') || config.knowledge.cogneeNative.dataset,
            topK: Math.min(Math.max(Number(payload.topK) || 10, 1), 20) }, process.env, { timeoutMs: 180000 });
        }
        if (action === 'ontology-view') return ontology.read(payload.space, workspaceActor);
        if (action === 'ontology-save') return ontology.save(payload.space, payload.schema, payload.revision ?? null, workspaceActor);
        // 第三十六轮 · 自动化四件套的 bridge 动作（写操作走 serialize 单车道）。
        if (action === 'scheduler-status') { workspaces.manager(workspaceActor); return scheduler.status(); }
        // 第三十八轮 · 事件面只读状态：哪些来源登记了、收了多少条、待分流几条。
        // 不含事件正文的写入口，控制台仍然只有读。
        if (action === 'event-inbox-status') { workspaces.manager(workspaceActor); return eventInbox.status(); }
        // 第三十八轮 · 出站重试健康：outbox 状态机 + 近 24h 投递失败的只读汇总。
        if (action === 'retry-health') { workspaces.manager(workspaceActor); return readRetryHealth(store); }
        // 第三十九轮 · 通道体检：只读配置与本地台账，不发外部请求。
        // 「还没有真实工单」从此是一条可查的事实（哪条通道缺什么），而不是一句猜测。
        if (action === 'channel-health') {
          workspaces.manager(workspaceActor);
          const tasks = store.list();
          const real = tasks.filter(task => (task.chatId ?? '').startsWith('oc_') || (task.senderId ?? '').startsWith('ou_'));
          const last = real[real.length - 1];
          const lastAt = last
            ? (store.db.prepare('SELECT max(at) AS at FROM audit WHERE issue_id=?').get(last.id) as { at: string | null } | undefined)?.at ?? undefined
            : undefined;
          return buildChannelHealth({
            feishu: {
              enabled: config.feishu.enabled, appId: config.feishu.appId,
              state: feishuState === 'ready' ? 'ready' : feishuState === 'disconnected' ? 'disconnected'
                : feishuState === 'disabled' ? 'disabled' : 'connecting',
              allowedSenders: config.feishu.allowedSenders.length, allowedChats: config.feishu.allowedChats.length,
            },
            github: { ...githubWatcher.status() },
            im: {
              dingtalkConfigured: Boolean(process.env.DINGTALK_WEBHOOK || process.env.DINGTALK_TOKEN),
              wecomConfigured: Boolean(process.env.WECOM_WEBHOOK || process.env.WECOM_KEY),
            },
            inbox: (() => { const status = eventInbox.status(); return { enabled: status.enabled, claimed: status.claimed, pending: status.pending, mirrored: status.mirrored }; })(),
            realStories: { total: real.length, ...(lastAt ? { lastAt } : {}), ...(last ? { lastIdentifier: last.identifier } : {}) },
          });
        }
        if (action === 'wake-list') { workspaces.manager(workspaceActor); return scheduler.listWakes(); }
        if (action === 'wake-schedule') { workspaces.manager(workspaceActor); return scheduler.scheduleWake(payload); }
        if (action === 'wake-cancel') { workspaces.manager(workspaceActor); return scheduler.cancelWakes(String(payload.taskId ?? '')); }
        if (action === 'github-watch-status') { workspaces.manager(workspaceActor); return githubWatcher.status(); }
        if (action === 'save-model-settings') return modelSettings.save(payload.settings, payload.revision ?? null, workspaceActor);
        if (action === 'system-status') {
          workspaces.manager(workspaceActor);
          const health = await workspaces.pc.get('/health');
          const cogneeNative = cogneeNativeStatus(config);
          return { services: { paperclip: health.status, bridge: 'ok', feishu: feishuState }, deploymentMode: health.deploymentMode,
            storage: { primary: 'PostgreSQL（本机持久化）', events: 'SQLite', configuration: '本机配置文件', wiki: '本机 Markdown 目录',
              databaseBackup: health.databaseBackup?.status ?? 'unknown', offsiteRestoreVerified: false },
            records: Object.fromEntries(['tasks', 'events', 'outbox', 'audit'].map(table => [table, store.db.prepare('SELECT COUNT(*) n FROM ' + table).get()!.n])),
            integrations: { modelApi: cogneeNative.configured, embedding: cogneeNative.embeddingLocal
                ? 'Apple NL 设备端词向量（本机）+ Cognee 原生 fastembed 本机 embedding（不出本机）'
                : 'Apple NL 设备端词向量（本机）+ Cognee 原生 embedding（外部模型服务）',
              vectorSearch: config.knowledge.semanticRecall.enabled,
              vectorSearchNote: '设备端词向量 + 本机 BM25；降级与否取决于运行时，此值来自配置而非实时探测',
              visionReviewer: config.acceptance?.mode === 'independent'
                ? (config.acceptance?.visualReviewer?.mode === 'model' ? '已配置 Apple Vision 本机端点（独立评审链；端点是否在线见实时探测）' : '结构式证据核对（独立评审链，不判断图像内容）')
                : '未挂接（当前为 legacy 验收链）',
              visionEndpointNote: '端点是否在线见「国内服务」清单的实时探测',
              objectStorage: false, multiUserSso: false },
            knowledgeEngine: { name: 'Cognee', commit: cogneeCommit, storage: 'Ladybug', installed: existsSync(runtime('cognee-venv', 'bin', 'python')),
              sourceRevisionGraphs: existsSync(runtime('knowledge-graph')) ? readdirSync(runtime('knowledge-graph')).filter(name => /^[a-f0-9]{64}$/.test(name) && existsSync(runtime('knowledge-graph', name, 'ready.json'))).length : 0,
              automaticExtraction: config.orgExtraction.enabled && config.orgExtraction.autoRunOnIndex,
              automaticExtractionNote: '指资料入库时的 L2 组织图谱确定性抽取（零模型）；Cognee 原生 LLM 实体抽取由 cogneeNative 单独控制——凭据就绪且 autoCognify 打开时，图谱投影成功后会自动把该来源正文外发给所配置的模型服务 cognify，两条链路并存',
              cogneeNative,
              semanticRecall: config.knowledge.semanticRecall.enabled,
              semanticEngine: 'Apple NaturalLanguage 设备端中英文词向量 + Cognee BM25 混合（降级：本地字符二元组哈希向量）',
              externalLlmCalls: 0,
              externalLlmCallsNote: '仅统计适配层自身调用；Cognee 原生管线的外部模型调用尚未接入成本账本，不能据此宣称「没有调用外部模型」',
              lexicalRecall: true, reviewedConceptRelations: true, automaticConfirmedKnowledgeIndexing:true,
              runtimeGuardEnforced: config.runtimeGuard.enforce,
              l2OrganisationExtraction: { enabled: config.orgExtraction.enabled, mode: config.orgExtraction.mode,
                autoRunOnIndex: config.orgExtraction.autoRunOnIndex, modelCalls: 0 } },
            upstream: { name: 'Paperclip', version: health.version, commit: health.commit },
            automation: { // 第三十六轮 · 自动化四件套
              scheduler: { enabled: config.scheduler?.enabled === true, routines: config.scheduler?.routines?.length ?? 0,
                wake: config.scheduler?.wake?.enabled !== false },
              githubWatch: githubWatcher.status(),
              imChannels: { dingtalk: dingtalkEndpoint(config).enabled ? '已接通（webhook 出站）' : (config.dingtalk?.enabled ? '已启用但缺 webhook 环境变量' : '未启用'),
                wecom: wecomEndpoint(config).enabled ? '已接通（webhook 出站）' : (config.wecom?.enabled ? '已启用但缺 webhook 环境变量' : '未启用') },
              note: '定时任务 / GitHub 事件 / 钉钉企微入站都只产生任务与通知；验收、核可、放行仍由原发起人在原会话确认' } };
        }
        if (action === 'enable-collaboration-im') return collaborationIntake.enable(payload.taskId, workspaceActor);
        if (action === 'assistant-tool') return assistant.tool(payload.jobId, payload.runId, payload.callId, payload.input, workspaceActor);
        if (action === 'assistant-receipt') {
          const result: any = await assistant.receipt(payload.jobId, payload.runId, payload.receipt, workspaceActor);
          if (result?.taskId) {
            try { await guard.observe({ taskId: result.taskId, runId: payload.runId, actorId: workspaceActor.userId ?? 'worker',
              summary: '执行端回执', at: new Date().toISOString(), kind: 'delegation', status: 'running' }); }
            catch { /* observation only */ }
          }
          return result;
        }
        if (action === 'assistant-context') return assistant.context(payload.jobId, payload.runId, workspaceActor);
        if (action === 'acceptance-review') return control.runIndependentReview(payload.taskId, payload.visualArtifacts ?? []);
        if (action === 'trace-view') {
          const task = store.get(payload.taskId);
          assistant.taskContext.authorize(task, workspaceActor);
          return control.trace.view(task.id);
        }
        if (action === 'context-pack') return assistant.taskContext.inspect(payload.taskId, workspaceActor);
        if (action === 'context-record') return assistant.taskContext.readRecord(payload.taskId, payload.recordId, workspaceActor);
        if (action === 'context-search') {
          const task = store.get(payload.taskId); assistant.taskContext.authorize(task, workspaceActor);
          return assistant.taskContext.search(task, String(payload.query ?? '').slice(0, 5000));
        }
        if (['context-note', 'context-discover', 'context-link', 'context-expand', 'context-include', 'context-exclude'].includes(action)) {
          const result = action === 'context-note' ? await assistant.taskContext.note(payload.taskId, String(payload.text ?? ''), workspaceActor)
            : action === 'context-discover' ? await assistant.taskContext.enrich(payload.taskId, workspaceActor)
            : action === 'context-link' ? await assistant.taskContext.link(payload.taskId, payload.linkedId, workspaceActor)
            : action === 'context-include' ? await assistant.taskContext.include(payload.taskId, payload.sourceId, workspaceActor)
            : action === 'context-exclude' ? await assistant.taskContext.exclude(payload.taskId, payload.sourceId, workspaceActor)
            : await assistant.taskContext.expand(payload.taskId, payload.sourceId, workspaceActor);
          await serviceNetwork.tick(); await assistant.tick(); return result;
        }
        if (action === 'assistant-result') {
          const job: any = await assistant.result(payload.jobId, payload.runId, payload.output, payload.usage, workspaceActor);
          // v0.6: the assistant turn is the model-invocation evidence source.
          // Best-effort: a trace failure never changes the assistant result.
          if (job?.taskId) await control.trace.append(job.taskId, fromAssistantTurn({
            taskId: job.taskId, jobId: payload.jobId, runId: payload.runId,
            engine: config.assistant?.engine ?? 'codex', model: config.assistant?.model,
            usage: payload.usage as Record<string, any> | undefined,
            at: new Date().toISOString(), outcome: String(job.status ?? 'completed'),
          }));
          // v0.6 P3: evaluate attention budget + heartbeat for this turn.
          // Best-effort and observation-only: never changes the assistant result.
          try {
            await guard.observe({ taskId: job.taskId, runId: payload.runId, actorId: workspaceActor.userId ?? job.agent ?? 'assistant',
              summary: `模型调用回执 · ${String(job.status ?? 'completed')}`, at: new Date().toISOString(),
              status: String(job.status ?? '') === 'waiting' ? 'waiting-human' : 'running' });
          } catch { /* observation must not break a verified execution path */ }
          return job;
        }
        if (action === 'assistant-failed') { await assistant.fail(payload.jobId, payload.runId, payload.error ?? '运行失败', workspaceActor); return { recorded: true }; }
        if (action === 'assistant-delegate') return (await assistant.delegate(payload.taskId, payload.enabled === true, z.enum(['prepare', 'advance']).parse(payload.mode),
          String(payload.instruction ?? ''), workspaceActor, payload.nonce)) ?? { unchanged: true };
        if (action === 'start-development') {
          workspaces.manager(workspaceActor);
          const request = z.object({ text: z.string().min(1).max(5000), agent: z.string(), requestKey: z.string().min(1).max(120) }).strict().parse(payload);
          return control.createTask({ triggerId: 'workspace-development:' + request.requestKey, chatId: 'local-workspace', messageId: 'local-workspace', senderId: 'local-operator', agent: request.agent, text: request.text });
        }
        if (action === 'start-collaboration') {
          const task = await workspaces.createTask(payload.task, workspaceActor);
          if (payload.delegate && assistant.available()) await assistant.delegate(task.id, true, z.enum(['prepare', 'advance']).parse(payload.mode ?? 'advance'), '', workspaceActor, payload.task.requestKey);
          return task;
        }
        // P-5：控制台摘要。只从本机任务索引 + 工作区目录组装分页白名单，不读任何
        // 工作稿正文、不逐条跑授权重评 / 服务网络 / 助手实时详情（这些正是原 view
        // 415KB / 10~12 秒的来源）。原 view 逐字保留给插件工作台，随时可回退。
        if (action === 'view-summary') {
          const page = parseViewSummaryPage(payload);
          const catalog = workspaces.catalog();
          const visible = visibleTasksFor(workspaceActor, store.list());
          const slice = visible.slice(page.offset, page.offset + page.limit);
          const hostTitles: Record<string, HostTitle | undefined> = {};
          await Promise.all(slice.map(async item => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              // 标题只是展示增强：单个宿主请求超时 / 失败就降级到本地任务索引，
              // 不改变任务列表、统计或任何验收相关状态。
              const issue: any = await Promise.race([
                workspaces.pc.get('/issues/' + item.id),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('宿主标题读取超时')), 2000); }),
              ]);
              if (issue?.companyId !== config.companyId) return;
              hostTitles[item.id] = { title: String(issue.title ?? ''), goal: String(issue.description ?? '') };
            } catch { /* advisory：缺一条标题也照常返回摘要 */ }
            finally { if (timer) clearTimeout(timer); }
          }));
          return buildWorkspaceSummary({
            tasks: visible, actor: workspaceActor,
            spaceCount: Object.keys(catalog.spaces).length, sourceCount: catalog.sources.length,
            feishuConnected: workspaceActor.admin && Boolean(catalog.feishuConnection),
            assistantAvailable: assistant.available(),
            configurableAgents: workspaceActor.admin
              ? Object.entries(config.agents).filter(([key, a]) => a.enabled && key !== config.assistant?.agentKey && secrets().paperclipTokens?.[key]).length
              : 0,
            limit: page.limit, offset: page.offset, hostTitles,
          });
        }
        // 第五十六轮 · 任务时间线：把某任务的审计事件翻译成「人 / Agent / 系统」三类。
        if (action === 'task-timeline') {
          const taskId = String(payload?.taskId ?? '');
          const task = store.list().find(t => t.id === taskId || t.identifier?.toLowerCase() === taskId.toLowerCase());
          if (!task) return { entries: [], error: '任务不存在' };
          const { buildTaskTimeline } = await import('./task-timeline.ts');
          let request = '';
          try { const c = JSON.parse(String(task.context ?? '{}')); if (c && typeof c.request === 'string') request = c.request.trim(); } catch { /* ignore */ }
          const entries = buildTaskTimeline({ audit: store.auditList(task.id, 100), request,
            lastMessage: task.lastMessage ?? null, delivery: task.delivery ?? null });
          // Agent 回执（receipts 表）作为额外的 agent 条目，插在「最后一句话」之前，
          // 让「Agent 回了什么」有实际内容可看。
          const receipts = store.receipts(task.id, 10);
          const receiptEntries = receipts.map(r => ({ at: '', kind: 'agent' as const,
            label: r.outcome === 'done' ? '完成回执' : '回执', detail: r.summary || r.outcome }));
          if (receiptEntries.length) entries.splice(1, 0, ...receiptEntries);
          return { identifier: task.identifier, phase: task.phase, agent: task.agent, entries };
        }
        const result = await workspaces.dispatch(action, payload, workspaceActor);
        if (action === 'view') {
          const view = result as Awaited<ReturnType<Workspaces['view']>>;
          const offered=await agentServices.resources();for(const s of offered)if(!view.sources.some(v=>v.id===s.id))view.sources.push({...s,restricted:true,knowledgeState:undefined} as any);
          return { ...view,sourceRequests:await teamMembers.inbox(workspaceActor), assistantAvailable: assistant.available(), assistantEngine: config.assistant?.engine ?? 'codex',
            tasks: await Promise.all(view.tasks.map(async t => {
              try {const network=await serviceNetwork.view(t.id,workspaceActor).catch(()=>[{status:{state:0},metadata:{blockedBy:'unknown'}}]);return { ...t,requests:t.requests.map(r=>({...r,canReview:workspaceActor.admin||!!workspaceActor.userId&&workspaceActor.humanRole!=='viewer'&&workspaces.members(workspaces.source(r.sourceId).domain).includes(workspaceActor.agent!)})),networkCount:network.length,networkAttention:network.some(n=>[0,4,7,8].includes(n.status?.state??0)),networkPending:network.some(n=>![3,4,5,7].includes(n.status?.state??0)), assistant: await assistant.view(store.get(t.id), workspaceActor) }; }
              catch { return { ...t, assistant: { status: 'unavailable', error: 'Agent 记录待核对' } }; }
            })) };
        }
        await serviceNetwork.tick(); await assistant.tick();
        return result;
      }))); return;
    }
    const actor = identity(req);
    if(actor.agent)await teamMembers.checkAgentOwner(actor.agent);
    if(req.method==='POST'&&url.pathname.startsWith('/a2a/')){
      const match=/^\/a2a\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/.exec(url.pathname);if(!match)throw new Error('Invalid A2A task path');const request=await body(req);
      res.end(JSON.stringify(await serialize(()=>serviceNetwork.rpc(match[1]!,match[2]!,request,actor))));return;
    }
    const reader = actor.agent ? new Paperclip(config.paperclipUrl, credentials.paperclipTokens?.[actor.agent] ?? 'unconfigured-identity') : control.pc;
    if (url.pathname === '/knowledge') {
      if (!actor.admin || req.method !== 'GET') throw new Error('Unauthorized');
      res.end(JSON.stringify(await serialize(() => knowledge.list()))); return;
    }
    if (req.method === 'GET' && url.pathname === '/tasks') {
      const tasks = store.list().filter(t => actor.admin || t.agent === actor.agent).map(({ lease, context, ...t }) => t);
      res.end(JSON.stringify(tasks)); return;
    }
    if (url.pathname === '/ingest' && req.method === 'POST') {
      if (!actor.admin) throw new Error('Unauthorized'); const data = await body(req);
      res.end(JSON.stringify(await serialize(() => ingest(data)))); return;
    }
    const match = /^\/tasks\/([^/]+)(?:\/(claim|receipt|publish|sync|preview|accept|handoff|reply|reconcile|review|trace|knowledge-propose|knowledge-review|knowledge-attach))?$/.exec(url.pathname);
    if (!match) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' })); return; }
    const task = store.get(match[1]!);
    if (!actor.admin && task.agent !== actor.agent) throw new Error('Task belongs to another agent');
    if (req.method === 'GET' && !match[2]) { const { lease, ...safe } = task; res.end(JSON.stringify({ ...safe, knowledge: await knowledge.resolve(task, reader) })); return; }
    if (req.method !== 'POST') throw new Error('Method not allowed');
    const data = await body(req); const action = match[2];
    const result = await serialize(async () => {
      // v0.6 FR-16~19: run the registered independent reviewer against the
      // sealed plan and the real trace. This only writes a per-item evidence
      // report; the final approval stays with the originator's /accept.
      if (action === 'review') {
        if (!actor.admin) throw new Error('Unauthorized: 独立评审只由本地 owner 触发');
        const artifacts = Array.isArray(data.visualArtifacts) ? data.visualArtifacts : [];
        return control.runIndependentReview(task.id, artifacts);
      }
      // Trusted execution endpoints (CLI / harness) may append a captured
      // event to the read-only trace projection. The task identity comes from
      // the URL, never from the payload; invalid fields are rejected instead
      // of being silently normalised into evidence.
      if (action === 'trace') {
        if (!actor.admin) throw new Error('Unauthorized: 只有本地 owner 可登记捕获事件');
        const { capture } = await import('./event-stream.ts');
        const event = capture({ ...(data.event ?? data), taskId: task.id }).event;
        if (!event) throw new Error('事件字段不完整，未写入过程流水');
        return control.recordTraceEvent(task.id, event);
      }
      if (action === 'knowledge-propose') {
        if (task.kind === 'collaboration') return workspaces.propose(task.id, data, actor);
        // P-13：agent 提出知识同样走分区判定（本地 owner 直调保留全权）。
        if (!actor.admin) {
          const agentActor: KnowledgeActor = { kind: 'agent', key: actor.agent ?? 'local-operator',
            agent: getAgentRegistry().agents.find(a => a.key === actor.agent) };
          const visibility = (['personal', 'team', 'org'].includes(String(data.visibility)) ? data.visibility : 'org') as 'personal' | 'team' | 'org';
          const gate = canCreateKnowledge(agentActor, visibility,
            { domains: Array.isArray(data.domains) ? data.domains.map(String) : undefined });
          if (!gate.allowed) throw new Error('未授权：' + gate.reason);
        }
        return knowledge.propose(store.get(task.id), data, actor.agent ?? 'local-operator', reader);
      }
      if (action === 'knowledge-review' || action === 'knowledge-attach') {
        if (task.kind === 'collaboration') throw new Error('请通过知识协作入口处理来源依赖与确认');
        if (!actor.admin) throw new Error('Unauthorized');
        if (action === 'knowledge-attach') return knowledge.attach(store.get(task.id), data.refs);
        if (!['confirmed', 'withdrawn'].includes(data.state)) throw new Error('Invalid review state');
        // 13a ③：确认时可由真人显式选择「同步提升到注入索引」；提升只能发生
        // 在人审确认这一刻（console 全程已鉴权后传 inject，agent 链路无此位）。
        return knowledge.review({ taskId: task.id, key: data.key }, data.state, data.revision,
          typeof data.actorUser === 'string' && data.actorUser ? data.actorUser : 'local-operator',
          { inject: data.inject === true });
      }
      if (action === 'claim') {
        const agent = actor.agent ?? data.agent;
        if (!config.agents[agent]?.enabled) throw new Error('Agent unavailable');
        if (task.kind === 'knowledge') throw new Error('知识条目不能作为执行任务领取');
        if (task.kind === 'collaboration') await workspaces.guard(task, agent);
        const sourceReader = new Paperclip(config.paperclipUrl, credentials.paperclipTokens?.[agent] ?? 'unconfigured-identity');
        if ((await knowledge.resolve(store.get(task.id), sourceReader)).excluded.length) throw new Error('Knowledge access changed; review the source grants and previous checkpoint before resuming');
        const issue = await control.pc.get(`/issues/${task.id}`);
        if (data.runId) {
          const run = await control.pc.get(`/heartbeat-runs/${data.runId}`);
          if (run.agentId !== config.agents[agent]!.paperclipId || run.contextSnapshot?.issueId !== task.id || run.status !== 'running'
            || issue.executionRunId !== data.runId) throw new Error('Run does not own this task');
        } else {
          if (config.agents[agent]!.mode === 'managed') throw new Error('Managed agents must claim with their Paperclip run');
          await control.pc.post(`/issues/${task.id}/checkout`, { agentId: config.agents[agent]!.paperclipId, expectedStatuses: ['todo', 'in_progress', 'blocked'] });
        }
        const claimed = store.claim(task.id, agent, data.lease ?? randomUUID());
        if (data.runId) { claimed.runId = data.runId; store.save(claimed); }
        return claimed;
      }
      if (action === 'receipt') {
        if (!actor.admin && data.agent !== actor.agent) throw new Error('Unauthorized');
        if (task.kind === 'collaboration') return { outcome: 'done', checkpoint: await workspaces.checkpoint(task.id, data.text, actor, data.lease, data.receiptId) };
        return control.receipt(task.id, data);
      }
      if (action === 'publish') { if (task.kind === 'collaboration') throw new Error('跨岗位任务通过知识采用交付，不推送代码'); return control.publish(task.id); }
      if (action === 'sync') return control.sync(task.id);
      if (action === 'preview') return control.preview(task.id);
      if (!actor.admin) throw new Error('This action requires the human task owner');
      if (action === 'reconcile') return control.reconcile(task.id);
      if (action === 'accept') return control.accept(task.id, data.sha, data.cases, data.actor ?? 'local-operator', data.eventId ?? randomUUID());
      if (action === 'handoff') return task.kind === 'collaboration' ? workspaces.handoff(task.id, data.agent, actor) : control.handoff(task.id, data.agent);
      if (action === 'reply') { if (task.kind === 'collaboration') throw new Error('请使用受限检查点记录后续工作'); return control.reply(task.id, data.text, data.eventId ?? randomUUID()); }
      throw new Error('Unknown action');
    });
    res.end(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.statusCode = message.includes('Unauthorized') || message.includes('another agent') ? 403 : message.includes('not found') ? 404 : 409;
    res.end(JSON.stringify({ error: message }));
  }
});

/**
 * 第三十六轮 · 钉钉 / 企微镜像送达：与飞书共享 v0.6 注意力预算（只有过了
 * 护栏、人类必须知晓的通知才镜像），单通道失败不影响其它通道，全部留审计。
 */
async function mirrorToImChannels(row: { id: string; text: string }, task: { id: string; identifier?: string }): Promise<boolean> {
  const results: ImSendResult[] = [];
  const ding = dingtalkEndpoint(config), wec = wecomEndpoint(config);
  const title = `任务 ${task.identifier ?? task.id}`;
  if (ding.enabled && ding.webhook) results.push(await sendDingtalk({ webhook: ding.webhook, secret: ding.secret, title, text: row.text }));
  if (wec.enabled && wec.webhook) results.push(await sendWecom({ webhook: wec.webhook, title, text: row.text }));
  for (const r of results) store.audit('im-outbound.' + (r.ok ? 'sent' : 'failed'), task.id,
    { channel: r.channel, notificationId: row.id, ...(r.error ? { error: r.error } : {}) });
  return results.some(r => r.ok);
}

async function deliver() {
  const rows = store.db.prepare("SELECT * FROM outbox WHERE state='pending'").all() as { id: string; issue_id: string; text: string }[];
  const mirrorOn = dingtalkEndpoint(config).enabled || wecomEndpoint(config).enabled;
  if (!config.feishu.enabled && !mirrorOn) return;
  for (const row of rows) {
    const task = store.get(row.issue_id);
    const feishuReachable = config.feishu.enabled && task.messageId.startsWith('om_');
    // v0.6 FR-22: attention budget is enforced on the real IM outbox. Human
    // questions / acceptance / grant requests always bypass the filter.
    let gate: Awaited<ReturnType<typeof guard.gateNotification>>;
    try {
      gate = await guard.gateNotification({ taskId: row.issue_id, notificationId: row.id, summary: row.text });
    } catch { gate = { deliver: true, reason: '护栏不可用，安全起见照常发送', mustDeliver: true } as any; }
    if (!gate.deliver && (feishuReachable || mirrorOn)) {
      store.db.prepare("UPDATE outbox SET state='suppressed' WHERE id=?").run(row.id);
      store.audit('v06.notification-suppressed', row.issue_id, { notificationId: row.id, reason: gate.reason });
      continue;
    }
    // 钉钉 / 企微补充送达（同一预算；飞书不可达时作为人类必达消息的兜底）。
    let mirrored = false;
    if (mirrorOn && gate.deliver) {
      try { mirrored = await mirrorToImChannels(row, task); } catch { /* 镜像失败不阻断主通道 */ }
    }
    if (!feishuReachable) {
      // 飞书关停时保持原「堆积等恢复」语义：只有镜像已达才离开 pending；
      // 飞书开着但消息没有 om_ 地址（本地任务）维持 local_only 口径。
      if (config.feishu.enabled) store.db.prepare("UPDATE outbox SET state=? WHERE id=?").run(mirrored ? 'mirrored' : 'local_only', row.id);
      else if (mirrored) store.db.prepare("UPDATE outbox SET state='mirrored' WHERE id=?").run(row.id);
      continue;
    }
    await sendFeishu({ commands: { lark: async (args: string[]) => {
      const result = JSON.parse(await command('lark-cli', ['--profile', config.feishu.profile, ...args, '--as', 'bot', '--format', 'json']));
      if (!result.ok) throw new Error(result.error?.message ?? 'Feishu reply failed'); return result.data;
    } } } as any, { id: row.id, text: row.text, channel: { address: { messageId: task.messageId } } } as any);
    store.db.prepare("UPDATE outbox SET state='sent' WHERE id=?").run(row.id);
  }
}
let stopping = false;
/**
 * 第三十七轮复盘修复：此前所有阶段串在一个 try 里，任何一个已交付任务在
 * Paperclip 侧不存在（本机重置 / 上游清库后残留的 delivered 记录）都会让
 * control.sync 抛错，整块 serialize 中断 —— 后果是 deliver、workspaces、
 * scheduler、githubWatcher 全部不跑，而且每 pollMs 刷一条同样的错误。
 * 现在：逐任务、逐阶段隔离；同一 (任务, 错误) 只写一条审计，避免刷屏。
 */
const reportedTickFailures = new Set<string>();
async function tickStage(name: string, job: () => Promise<unknown>): Promise<void> {
  try { await job(); }
  catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 300);
    const key = `${name}:${message}`;
    if (!reportedTickFailures.has(key)) {
      reportedTickFailures.add(key);
      store.audit('tick.stage-failed', null, { stage: name, error: message });
      console.error(`Background check (${name}):`, message);
    }
  }
}
async function tick() {
  if (stopping) return;
  try {
    await serialize(async () => {
      for (const task of store.list().filter(t => t.phase === 'delivered')) {
        await tickStage(`sync:${task.id}`, async () => {
          await control.sync(task.id);
          const fresh = store.get(task.id);
          if (fresh.delivery?.ci === 'passed' && !fresh.delivery.deployedSha) {
            try { await control.preview(task.id); } catch (error) { store.audit('preview.pending', task.id, { error: String(error).slice(0, 400) }); }
          }
        });
      }
      await tickStage('deliver', deliver);
      await tickStage('workspaces', () => workspaces.tick());
      await tickStage('team-memory', () => teamMemory.tick());
      await tickStage('service-network', () => serviceNetwork.tick());
      await tickStage('assistant', () => assistant.tick());
      // 第三十六轮 · 自动化四件套：定时调度器（例行任务 + 到点唤醒复查）与
      // GitHub 监听轮询。失败只写审计，不阻断主循环。
      await tickStage('scheduler', () => scheduler.tick());
      await tickStage('github-watch', () => githubWatcher.tick());
    });
  } catch (error) { console.error('Background check:', String(error).slice(0, 500)); }
  if (!stopping) setTimeout(tick, config.pollMs).unref();
}
let consumer: ReturnType<typeof spawn> | undefined;
if (config.feishu.enabled) {
  if (!config.feishu.allowedSenders.length || !config.feishu.botId) throw new Error('Feishu admission must be configured before listening');
  consumer = spawn('lark-cli', ['--profile', config.feishu.profile, 'event', 'consume', 'im.message.receive_v1', '--as', 'bot'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let ready = false;
  readline.createInterface({ input: consumer.stderr! }).on('line', line => {
    if (line.includes('[event] ready event_key=')) { ready = true; feishuState = 'ready'; console.log('Feishu message listener ready'); }
    else console.error(line);
  });
  readline.createInterface({ input: consumer.stdout! }).on('line', line => {
    if (!ready) return;
    try { const event = JSON.parse(line); void serialize(() => ingest(event)).catch(error => console.error('IM intake:', String(error).slice(0, 500))); }
    catch { console.error('Invalid Feishu event JSON'); }
  });
  consumer.on('error', error => { feishuState = 'disconnected'; console.error('Feishu listener:', error.message); });
  consumer.on('exit', code => { ready = false; feishuState = 'disconnected'; if (!stopping) console.error(`Feishu listener exited (${code}); restart after restoring the connection`); });
}
// P-12/P-13：casbin RBAC（人与 agent 共用策略文件）；启动时绑定 console 账号。
void (async () => {
  try {
    await initRbac();
    const { ConsoleAuth } = await import('./console-auth.ts');
    await syncHumans(new ConsoleAuth().listAccounts().map(a => ({ username: a.username, role: a.role })));
  } catch (error) { console.error('RBAC init:', String(error).slice(0, 300)); }
})();
server.listen(config.bridgePort, '127.0.0.1', () => { console.log(`SuitMe bridge: http://127.0.0.1:${config.bridgePort}`); void tick(); });
async function shutdown(code = 0) {
  if (stopping) return; stopping = true; consumer?.stdin?.end(); consumer?.kill('SIGTERM');
  await tail; server.close(() => { store.close(); process.exit(code); });
}
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
