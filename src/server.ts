import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
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
import { cogneeNativeStatus } from './cognee-native.ts';
import { CollaborationIntake } from './collaboration-intake.ts';
import { ModelSettingsService } from './model-settings.ts';
import { KnowledgeGraph, CogneeL1Reader, cogneeCommit } from './graph.ts';
import { createIndependentReviewer } from './visual-review.ts';
import { ServiceNetwork } from './service-network.ts';
import { TeamMemory } from './team-memory.ts';
import { TeamMembers } from './members.ts';
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
const modelSettings = new ModelSettingsService(workspaces);
const graph = new KnowledgeGraph(workspaces);
const ontology = new OntologyService(workspaces);
// v0.6 functional layer: Paperclip native documents for task facts, local
// config for organisation policy, SQLite for audit only.
const v06 = new V06Services(store, workspaces.pc, undefined,
  createIndependentReviewer(config), new CogneeL1Reader(graph));
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
const ingest = async (input: unknown) => (await collaborationIntake.ingest(input)) ?? control.ingest(input);
let feishuState = config.feishu.enabled ? 'connecting' : 'disabled';
let tail: Promise<unknown> = Promise.resolve();
const serialize = <T>(job: () => Promise<T>): Promise<T> => { const work = () => withFeishuReads(job); const next = tail.then(work, work); tail = next.catch(() => {}); return next; };
function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function identity(req: IncomingMessage): { admin: boolean; agent?: string } {
  const credentials=secrets();
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  if (equal(token, credentials.adminToken)) return { admin: true };
  const agent = Object.entries(credentials.agentTokens).find(([, value]) => equal(token, value))?.[0];
  if (!agent || !config.agents[agent]?.enabled) throw new Error('Unauthorized'); return { admin: false, agent };
}
async function body(req: IncomingMessage): Promise<any> { let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 512000) throw new Error('Request too large'); } return data ? JSON.parse(data) : {}; }
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
      const v06Reads=['roles-view','role-route','role-hints','role-snapshot','transfer-view','transfer-policy','dispatch-guard','grant-widen','grant-check','edges-view','edge-impact','label-check','policy-view','verification-level','topology-advice','inflight-policy','signals','review-readiness','ontology-meta','ontology-view','ontology-query','attention-policy','attention-filter','watchdog-policy','watchdog-inspect','plan-view','round-view','acceptance-export','acceptance-report-view','org-overview','org-mapping-view','context-pack','l2-status','l2-edges-view','l2-graph-view','agent-registry-view','acceptance-crew'];
      const readOnly=['view','team-members','agent-services','agent-build','development-view','delivery-status','service-status','routing-status','memory-replay','network-view','memory-status','memory-search','memory-annotations','context-pack','context-record','context-search','ontology-view','model-settings','system-status','trace-view'].includes(action)||action==='knowledge-graph'&&payload.project!==true||action.startsWith('v06-')&&v06Reads.includes(action.slice(4));
      const runWorkspace=readOnly?<T>(job:()=>Promise<T>)=>withFeishuReads(job):serialize;
      res.end(JSON.stringify(await runWorkspace(async () => {
        workspaceActor = await teamMembers.gate(action, payload, workspaceActor);
        if(workspaceActor.userId&&action!=='view')store.audit('member.action',payload.taskId??config.companyId!,{userId:workspaceActor.userId,action});
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
        if(action==='routing-status'){
          const {events,errors}=readRoutingEvents();const projection=replayRouting(events);
          return {ok:true,log:'.runtime/routing/events.jsonl',eventCount:events.length,logErrors:errors,
            projection,threeTier:assessThreeTier(events,projection,errors,
              shapeOptions(getRouter(),getAgentRegistry())),
            router:getRouter().status(),routerCoverage:planCoverage(events)};
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
        if (action === 'knowledge-graph') return graph.run(payload.sourceId, payload.revision, payload.project === true, workspaceActor, payload.taskId);
        if (action === 'ontology-view') return ontology.read(payload.space, workspaceActor);
        if (action === 'ontology-save') return ontology.save(payload.space, payload.schema, payload.revision ?? null, workspaceActor);
        if (action === 'save-model-settings') return modelSettings.save(payload.settings, payload.revision ?? null, workspaceActor);
        if (action === 'system-status') {
          workspaces.manager(workspaceActor);
          const health = await workspaces.pc.get('/health');
          const cogneeNative = cogneeNativeStatus(config);
          return { services: { paperclip: health.status, bridge: 'ok', feishu: feishuState }, deploymentMode: health.deploymentMode,
            storage: { primary: 'PostgreSQL（本机持久化）', events: 'SQLite', configuration: '本机配置文件', wiki: '本机 Markdown 目录',
              databaseBackup: health.databaseBackup?.status ?? 'unknown', offsiteRestoreVerified: false },
            records: Object.fromEntries(['tasks', 'events', 'outbox', 'audit'].map(table => [table, store.db.prepare('SELECT COUNT(*) n FROM ' + table).get()!.n])),
            integrations: { modelApi: cogneeNative.configured, embedding: 'Apple NL 设备端词向量（本机）+ Cognee 原生 embedding（外部模型服务）',
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
              automaticExtractionNote: '指资料入库时的 L2 组织图谱确定性抽取；Cognee 原生 LLM 实体抽取由 cogneeNative 单独控制，两条链路并存',
              cogneeNative,
              semanticRecall: config.knowledge.semanticRecall.enabled,
              semanticEngine: 'Apple NaturalLanguage 设备端中英文词向量 + Cognee BM25 混合（降级：本地字符二元组哈希向量）',
              externalLlmCalls: 0,
              externalLlmCallsNote: '仅统计适配层自身调用；Cognee 原生管线的外部模型调用尚未接入成本账本，不能据此宣称「没有调用外部模型」',
              lexicalRecall: true, reviewedConceptRelations: true, automaticConfirmedKnowledgeIndexing:true,
              runtimeGuardEnforced: config.runtimeGuard.enforce,
              l2OrganisationExtraction: { enabled: config.orgExtraction.enabled, mode: config.orgExtraction.mode,
                autoRunOnIndex: config.orgExtraction.autoRunOnIndex, modelCalls: 0 } },
            upstream: { name: 'Paperclip', version: health.version, commit: health.commit } };
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
      if (action === 'knowledge-propose') return task.kind === 'collaboration' ? workspaces.propose(task.id, data, actor) : knowledge.propose(store.get(task.id), data, actor.agent ?? 'local-operator', reader);
      if (action === 'knowledge-review' || action === 'knowledge-attach') {
        if (task.kind === 'collaboration') throw new Error('请通过知识协作入口处理来源依赖与确认');
        if (!actor.admin) throw new Error('Unauthorized');
        if (action === 'knowledge-attach') return knowledge.attach(store.get(task.id), data.refs);
        if (!['confirmed', 'withdrawn'].includes(data.state)) throw new Error('Invalid review state');
        return knowledge.review({ taskId: task.id, key: data.key }, data.state, data.revision, 'local-operator');
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

async function deliver() {
  const rows = store.db.prepare("SELECT * FROM outbox WHERE state='pending'").all() as { id: string; issue_id: string; text: string }[];
  if (!config.feishu.enabled) return;
  for (const row of rows) {
    const task = store.get(row.issue_id);
    if (!task.messageId.startsWith('om_')) { store.db.prepare("UPDATE outbox SET state='local_only' WHERE id=?").run(row.id); continue; }
    // v0.6 FR-22: attention budget is enforced on the real IM outbox. Human
    // questions / acceptance / grant requests always bypass the filter.
    let gate: Awaited<ReturnType<typeof guard.gateNotification>>;
    try {
      gate = await guard.gateNotification({ taskId: row.issue_id, notificationId: row.id, summary: row.text });
    } catch { gate = { deliver: true, reason: '护栏不可用，安全起见照常发送', mustDeliver: true } as any; }
    if (!gate.deliver) {
      store.db.prepare("UPDATE outbox SET state='suppressed' WHERE id=?").run(row.id);
      store.audit('v06.notification-suppressed', row.issue_id, { notificationId: row.id, reason: gate.reason });
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
async function tick() {
  if (stopping) return;
  try {
    await serialize(async () => {
      for (const task of store.list().filter(t => t.phase === 'delivered')) {
        await control.sync(task.id);
        const fresh = store.get(task.id);
        if (fresh.delivery?.ci === 'passed' && !fresh.delivery.deployedSha) {
          try { await control.preview(task.id); } catch (error) { store.audit('preview.pending', task.id, { error: String(error).slice(0, 400) }); }
        }
      }
      await deliver();
      await workspaces.tick();
      await teamMemory.tick();
      await serviceNetwork.tick(); await assistant.tick();
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
server.listen(config.bridgePort, '127.0.0.1', () => { console.log(`SuitMe bridge: http://127.0.0.1:${config.bridgePort}`); void tick(); });
async function shutdown(code = 0) {
  if (stopping) return; stopping = true; consumer?.stdin?.end(); consumer?.kill('SIGTERM');
  await tail; server.close(() => { store.close(); process.exit(code); });
}
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
