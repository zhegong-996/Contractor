import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { z } from 'zod';
import { loadConfig, runtime, secrets, type Config } from './config.ts';
import { Paperclip } from './paperclip.ts';
import { Store, type Task } from './store.ts';
import { KnowledgeService, knowledgeInput, reusable, parseKnowledge, renderKnowledge } from './knowledge.ts';
import { contextHash, deliveryEvidence, goalEvidence, discussionEvidence, type InputRef } from './context.ts';
import { FeishuSources, FeishuUnavailable, feishuReference, type FeishuReference } from './feishu-sources.ts';

export const domains = ['product', 'growth', 'sales', 'operations'] as const;
export type Domain = string;
export const domainNames: Record<Domain, string> = { product: '产研', growth: '增长', sales: '销售', operations: '职能' };
// These four names are legacy seed examples, never an organization or permission enum.
export const collaborationReviewPolicy = { reviewPolicy: 'human_only', executionPolicy: { stages: [{ type: 'review', participants: [{ type: 'user', userId: 'local-board' }] }] } };
export function collaborationOwnerMatches(issue: any, expected: string[], completed = false) {
  if (expected.includes(issue.assigneeAgentId)) return true;
  const run = issue.executionState, stage = issue.executionPolicy?.stages?.find((s: any) => s.id === run?.currentStageId);
  return Boolean(issue.reviewPolicy === 'human_only' && !issue.assigneeAgentId && issue.assigneeUserId === 'local-board'
    && run?.returnAssignee?.type === 'agent' && expected.includes(run.returnAssignee.agentId)
    && (stage?.type === 'review' && run.currentStageType === 'review' && run.currentParticipant?.type === 'user' && run.currentParticipant.userId === 'local-board'
      && stage.participants.some((p: any) => p.type === 'user' && p.userId === 'local-board')
      || completed && issue.status === 'done' && issue.executionPolicy.stages.some((s: any) => s.type === 'review' && s.participants.some((p: any) => p.type === 'user' && p.userId === 'local-board'))));
}
export type Catalog = { companyId: string; coordinationProject: string; vaultProject: string; participants?: string[]; modelRegistryIssueId?: string; ontologyIssues?: Record<string, string>; serviceRegistryIssueId?: string;
  feishuConnection?: Pick<FeishuReference, 'profile' | 'appId' | 'userOpenId'>;
  spaces: Record<string, { projectId: string; agent: string; name?: string; members?: string[]; description?: string }>;
  sources: { id: string; title: string; domain: string; ref: { taskId: string; key: string }; external?: FeishuReference }[] };
export type State = { version: 1; sources: string[]; requests: string[]; snapshots: Snapshot[]; outcomes: Snapshot[]; history: { at: string; event: string; detail: unknown }[];
  imBinding?: { senderId: string; chatId: string };
  delegation?: { enabled: boolean; mode: 'prepare' | 'advance'; jobId?: string; lastBasis?: string; instruction?: string; nonce?: string; eventCursor?: number; recheckCount?: number; recheck?: { at: string; reason: string; kind: 'context' | 'delivery' } };
  context?: { service?: { id: string; version: string; ownerUserId: string; name: string; responsibilities: string; offer: string }; autoDiscover: boolean; linkedTasks: string[]; requirements: string[]; fullSources: string[]; excludedSources?: string[]; knowledgeSpace?: string };
  fence?: { agent: string; lease?: string; runId?: string; generation: number };
  pendingHandoff?: { previous: string; next: string; generation: number }; proof?: string };
type Snapshot = { id: string; title: string; domain: Domain; sources: string[]; key: string; grants: { agent: string; id: string }[]; published?: boolean; publicationId?: string; receiptId?: string; systemEvidence?: boolean; inputManifest?: InputRef[] };
type Access = { id: string; taskId: string; sourceId: string; agent: string; purpose: string; expiresAt: string;
  state: 'pending' | 'approved' | 'denied' | 'revoking' | 'revoked' | 'expired'; grantId?: string; approvalId?: string; requestedBy: string; reviewedBy?: string; reason?: string; revokeOutcome?: 'expired' | 'revoked'; remainingNativeAccess?: boolean; proof?: string };
export type WorkspaceActor = { userId?: string; admin: boolean; agent?: string; automation?: string };
const requestSchema = z.object({ taskId: z.string(), sourceId: z.string(), agent: z.string().optional(),
  purpose: z.string().trim().min(1).max(1000), hours: z.number().min(1 / 60).max(168).default(8), requestKey: z.string().min(1).max(120) }).strict();
const taskSchema = z.object({ title: z.string().trim().min(1).max(120), goal: z.string().trim().min(1).max(5000),
  agent: z.string(), sources: z.array(z.string()).max(8), requestKey: z.string().min(1).max(120),
  autoDiscover: z.boolean().default(true), knowledgeSpace: z.string().optional(), requirements: z.array(z.string().max(500)).max(12).default([]) }).strict();
export function requestIsCurrent(r: Pick<Access, 'state' | 'expiresAt'>, now = Date.now()) { return r.state === 'approved' && Date.parse(r.expiresAt) > now; }
const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 28);
export function contractProof(kind: string, id: string, value: object, key: string) {
  const { proof: ignored, ...content } = value as Record<string, unknown>;
  const canonical = JSON.stringify(content, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
  return createHmac('sha256', key).update('suitme-workspace-v1:' + kind + ':' + id + ':' + canonical).digest('hex');
}

// A workflow adapter over native private projects, issues, grants and versioned documents.
// No independent task, permission, approval or scheduling database.
export class Workspaces {
  readonly pc: Paperclip;
  readonly knowledge: KnowledgeService;
  readonly feishu = new FeishuSources();
  constructor(readonly config: Config, readonly store: Store) {
    this.pc = new Paperclip(config.paperclipUrl);
    this.knowledge = new KnowledgeService(config, store, this.pc, secrets().jwtSecret);
  }
  catalog(): Catalog {
    if (!existsSync(runtime('knowledge-workspaces.json'))) throw new Error('先运行 npm run setup:workspaces');
    const c: Catalog = JSON.parse(readFileSync(runtime('knowledge-workspaces.json'), 'utf8'));
    if (c.companyId !== this.config.companyId) throw new Error('Workspace company mismatch');
    return c;
  }
  manager(actor: WorkspaceActor) { if (!actor.admin) throw new Error('Unauthorized: only the local human operator can authorize or publish'); }
  saveCatalog(c: Catalog) {
    const file = runtime('knowledge-workspaces.json'); writeFileSync(file + '.tmp', JSON.stringify(c, null, 2), { mode: 0o600 }); renameSync(file + '.tmp', file);
  }
  agent(key: string) {
    const a = this.config.agents[key];
    if (!a?.enabled || !a.paperclipId || !secrets().paperclipTokens?.[key]) throw new Error('执行身份未配置');
    return a;
  }
  reader(key: string) { this.agent(key); return new Paperclip(this.config.paperclipUrl, secrets().paperclipTokens![key]); }
  spaceName(id: string) { return this.catalog().spaces[id]?.name ?? domainNames[id] ?? id; }
  members(id: string) { const space = this.catalog().spaces[id]; return space?.members ?? (space ? [space.agent] : []); }
  participantKeys() { return this.catalog().participants ?? [...new Set(Object.keys(this.catalog().spaces).flatMap(id => this.members(id)))]; }
  participant(key: string) { if (!this.participantKeys().includes(key)) throw new Error('请选择已配置的协作参与者'); return this.agent(key); }
  domain(key: string): Domain {
    this.participant(key);
    const found = Object.keys(this.catalog().spaces).find(d => this.members(d).includes(key)) ?? Object.keys(this.catalog().spaces)[0];
    if (!found) throw new Error('请先配置知识空间'); return found;
  }
  targetSpace(task: Task, state: State) { return state.context?.knowledgeSpace ?? this.domain(task.agent); }
  async issue(id: string) {
    const issue = await this.pc.get('/issues/' + id);
    if (issue.companyId !== this.config.companyId) throw new Error('Unauthorized: company boundary');
    return issue;
  }
  async state(task: Task): Promise<State> {
    if (task.kind !== 'collaboration') throw new Error('这不是跨岗位协作任务');
    const issue = await this.issue(task.id);
    const value: State = JSON.parse((await this.pc.get('/issues/' + task.id + '/documents/collaboration')).body);
    if (value.proof !== contractProof('task', task.id, value, secrets().jwtSecret)) throw new Error('协作合同被外部修改，先核对修订；不能据此变更权限');
    const expected = value.pendingHandoff ? [value.pendingHandoff.previous, value.pendingHandoff.next] : [task.agent];
    if (!collaborationOwnerMatches(issue, expected.map(key => this.config.agents[key]?.paperclipId).filter((id): id is string => Boolean(id)), task.phase === 'accepted' && value.history.some(h => h.event === 'completed'))) throw new Error('原生负责人已改变，请先核对协作合同');
    return value;
  }
  async save(task: Task, state: State, event: string, detail: unknown) {
    state.history.push({ at: new Date().toISOString(), event, detail });
    state.proof = contractProof('task', task.id, state, secrets().jwtSecret);
    await this.pc.document(task.id, 'collaboration', '授权与协作记录', JSON.stringify(state, null, 2));
    this.store.save(task); this.store.audit('workspace.' + event, task.id, detail);
  }
  async access(id: string): Promise<Access> {
    await this.issue(id);
    const r: Access = JSON.parse((await this.pc.get('/issues/' + id + '/documents/access-contract')).body);
    if (r.proof !== contractProof('request', id, r, secrets().jwtSecret)) throw new Error('访问合同被外部修改，不能据此授予权限');
    if (r.id !== id) throw new Error('访问申请绑定错误');
    const task = this.store.get(r.taskId);
    if (!(await this.state(task)).requests.includes(id)) throw new Error('访问申请不属于此任务');
    this.source(r.sourceId); this.domain(r.agent);
    return r;
  }
  async saveAccess(r: Access) {
    r.proof = contractProof('request', r.id, r, secrets().jwtSecret);
    await this.pc.document(r.id, 'access-contract', '资料访问申请', JSON.stringify(r, null, 2));
  }
  source(id: string) {
    const s = this.catalog().sources.find(s => s.id === id); if (!s) throw new Error('资料未在公开目录登记'); return s;
  }
  async readMaterial(id: string, agent?: string): Promise<any> {
    const source = this.source(id);
    if (!source.external) return this.knowledge.read(source.ref, agent ? this.reader(agent) : this.pc);
    await (agent ? this.reader(agent) : this.pc).get('/issues/' + source.ref.taskId);
    const record = await this.feishu.read(source.external);
    return { ...record, ref: source.ref };
  }
  async configureSpace(input: unknown, actor: WorkspaceActor) {
    this.manager(actor);
    const data = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), name: z.string().trim().min(1).max(80),
      agent: z.string(), description: z.string().max(1000).default('') }).strict().parse(input);
    this.agent(data.agent); const catalog = this.catalog(), prior = catalog.spaces[data.id];
    const project = prior ? await this.pc.get('/projects/' + prior.projectId) : await this.pc.post('/companies/' + this.config.companyId + '/projects', {
      name: data.name, visibility: 'private', status: 'in_progress', idempotencyKey: 'configured-space:' + data.id });
    if (project.companyId !== this.config.companyId || project.visibility !== 'private') throw new Error('原生空间边界已变化');
    catalog.spaces[data.id] = { ...prior, projectId: project.id, name: data.name, agent: data.agent,
      description: data.description, members: prior ? this.members(data.id) : [] };
    catalog.participants = [...new Set([...(catalog.participants ?? this.participantKeys()), data.agent])];
    this.saveCatalog(catalog); return { domain: data.id, ...catalog.spaces[data.id], grantsCreated: 0 };
  }
  async configureParticipants(keys: string[], actor: WorkspaceActor) {
    this.manager(actor); if (!keys.length || keys.length > 50) throw new Error('请选择1到50个执行身份');
    for (const key of keys) this.agent(key);
    for (const task of this.store.list().filter(t => t.kind === 'collaboration' && t.phase !== 'accepted'))
      if (!keys.includes(task.agent)) throw new Error('先完成或交接正在由该身份负责的任务');
    const catalog = this.catalog(); catalog.participants = [...new Set(keys)]; this.saveCatalog(catalog);
    return { participants: catalog.participants, note: '执行身份列表不授予或撤销资料权限；资源成员与任务授权独立管理' };
  }
  async registerExternal(space: string, input: unknown, actor: WorkspaceActor) {
    this.manager(actor); const ref = feishuReference.parse(input), catalog = this.catalog();
    if (!catalog.spaces[space]) throw new Error('知识空间不存在');
    // Validate the operator's source before registering a reference. Never duplicate
    // raw Feishu bodies into a department project or auto-confirm them as knowledge.
    await this.feishu.read(ref);
    if (!catalog.feishuConnection) { catalog.feishuConnection = { profile: ref.profile, appId: ref.appId, userOpenId: ref.userOpenId }; this.saveCatalog(catalog); }
    const key = digest(JSON.stringify(ref)), existing = catalog.sources.find(s => s.external && digest(JSON.stringify(s.external)) === key);
    if (existing) return existing;
    const issue = await this.pc.post('/companies/' + this.config.companyId + '/issues', { allowDuplicate: true,
      idempotencyKey: 'external:' + key, projectId: catalog.vaultProject, visibility: 'private', title: ref.title, status: 'backlog' });
    await this.pc.document(issue.id, 'external-reference', '飞书来源引用', JSON.stringify({ provider: 'feishu', kind: ref.kind, url: ref.url,
      rule: '原始正文按任务委托与飞书当前可读状态实时获取；空间分类不授予访问' }, null, 2));
    this.store.save({ id: issue.id, identifier: issue.identifier, triggerId: 'external:' + key, chatId: 'local-workspace', messageId: 'local-workspace',
      senderId: 'local-operator', agent: catalog.spaces[space].agent, workspace: '', branch: '', context: '{}', generation: 1, phase: 'knowledge', kind: 'knowledge' });
    const source = { id: issue.id, title: ref.title, domain: space, ref: { taskId: issue.id, key: 'external-reference' }, external: ref };
    catalog.sources.push(source); this.saveCatalog(catalog); return source;
  }
  async syncSpaceMembers(spaceId: string, actor: WorkspaceActor) {
    this.manager(actor); const catalog = this.catalog(), space = catalog.spaces[spaceId]; if (!space) throw new Error('知识空间不存在');
    const rows = await this.pc.get<any[]>('/projects/' + space.projectId + '/access-members');
    space.members = Object.entries(this.config.agents).filter(([, a]) => rows.some(r => r.subjectType === 'agent' && r.subjectId === a.paperclipId)).map(([key]) => key);
    this.saveCatalog(catalog); return { members: space.members, nativePermissionsChanged: false };
  }
  async attachFeishuDocument(space: string, input: string, actor: WorkspaceActor) {
    this.manager(actor); const connection = this.catalog().feishuConnection; if (!connection) throw new Error('先配置并验证飞书用户连接');
    const url = new URL(input), match = /^\/docx\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.feishu.cn') || !match) throw new Error('当前支持飞书 docx 文档链接；其他类型请先明确实际来源');
    const reference = feishuReference.parse({ ...connection, provider: 'feishu', kind: 'docx', token: match[1], messageIds: [], title: '飞书文档', url: url.origin + url.pathname });
    return this.registerExternal(space, reference, actor);
  }
  async createSource(domain: Domain, input: unknown, actor: WorkspaceActor) {
    this.manager(actor); if (!this.catalog().spaces[domain]) throw new Error('知识空间不存在');
    const data = knowledgeInput.parse(input), c = this.catalog();
    const issue = await this.pc.post('/companies/' + this.config.companyId + '/issues', { allowDuplicate: true, idempotencyKey: 'source:' + randomUUID(),
      projectId: c.spaces[domain].projectId, visibility: 'private', title: data.title, status: 'backlog' });
    const sourceTask: Task = { id: issue.id, identifier: issue.identifier, triggerId: 'source:' + issue.id, chatId: 'local-workspace', messageId: 'local-workspace',
      senderId: 'local-operator', agent: c.spaces[domain].agent, workspace: '', branch: '', context: '{}', generation: 1, phase: 'knowledge', kind: 'knowledge' };
    this.store.save(sourceTask); const record = await this.knowledge.propose(sourceTask, data, 'local-operator');
    const source = { id: issue.id, title: data.title, domain, ref: { taskId: issue.id, key: data.key } };
    c.sources.push(source); this.saveCatalog(c); return { source, record };
  }
  async reviewSource(id: string, state: 'confirmed' | 'withdrawn', revision: string, actor: WorkspaceActor) {
    if (this.source(id).external) throw new Error('飞书原始证据不能直接确认成知识，请在任务内提出并审阅结论');
    this.manager(actor); return this.knowledge.review(this.source(id).ref, state, revision, 'local-operator');
  }
  async updateSource(id: string, input: unknown, revision: string, actor: WorkspaceActor) {
    this.manager(actor); const source = this.source(id);
    if (source.external) throw new Error('飞书原始资料在飞书编辑；本系统只保存引用');
    const current = await this.knowledge.read(source.ref), data = knowledgeInput.parse(input);
    if (!revision || current.revision !== revision) throw new Error('内容已变化，请重新读取当前版本');
    if (data.key !== source.ref.key || JSON.stringify(data.domains) !== JSON.stringify(current.value.domains)) throw new Error('编辑内容不能改变资料身份或共享范围');
    const { confirmedBy, confirmedAt, confirmation, expiresAt, ...previous } = current.value;
    const value = { ...previous, ...data, state: 'candidate' as const, proposedBy: 'local-operator', updatedAt: new Date().toISOString() };
    await this.pc.request('PUT', '/issues/' + source.ref.taskId + '/documents/' + source.ref.key,
      { title: value.title, format: 'markdown', body: renderKnowledge(value), baseRevisionId: revision });
    await this.pc.patch('/issues/' + id, { title: value.title });
    const catalog = this.catalog(); catalog.sources.find(s => s.id === id)!.title = value.title; this.saveCatalog(catalog);
    this.store.audit('knowledge.content-updated', id, { previousRevision: revision, state: 'candidate' });
    return this.knowledge.read(source.ref);
  }
  async allowed(task: Task, sourceId: string, agent: string, state?: State) {
    const s = this.source(sourceId); this.domain(agent);
    if (s.external) {
      const current = state ?? await this.state(task);
      if (!current.sources.includes(sourceId)) return false;
      const requests = await Promise.all(current.requests.map(id => this.access(id)));
      if (!requests.some(r => r.agent === agent && r.sourceId === sourceId && requestIsCurrent(r))) return false;
      try { await this.reader(agent).get('/issues/' + s.ref.taskId); await this.feishu.read(s.external); return true; } catch { return false; }
    }
    // Native ACL is always re-evaluated, including when another explicit grant remains.
    try { const record = await this.knowledge.read(s.ref, this.reader(agent));
      if (!reusable(record.value, this.config, secrets().jwtSecret)) return false;
    } catch { return false; }
    if (this.members(s.domain).includes(agent)) return true;
    for (const id of (state ?? await this.state(task)).requests) {
      const r = await this.access(id);
      if (r.agent === agent && r.sourceId === sourceId && requestIsCurrent(r)) return true;
    }
    return false;
  }
  async requireSources(task: Task, agent: string, state?: State) {
    const current = state ?? await this.state(task), missing = [];
    for (const id of current.sources) if (!await this.allowed(task, id, agent, current)) missing.push(this.source(id).title);
    if (missing.length) throw new Error('需要为' + this.agent(agent).name + '申请或恢复访问：' + missing.join('、'));
  }
  async sourceStatus(task: Task, sourceId: string, agent: string, state?: State) {
    if (await this.allowed(task, sourceId, agent, state)) return { sourceId, allowed: true, reason: 'current' };
    if (this.source(sourceId).external) return { sourceId, allowed: false, reason: 'permission' };
    try {
      const record = await this.readMaterial(sourceId, agent);
      if (!reusable(record.value, this.config, secrets().jwtSecret)) return { sourceId, allowed: false, reason: 'version' };
    } catch {}
    return { sourceId, allowed: false, reason: 'permission' };
  }
  async nativeGrant(issueId: string, agent: string) {
    return this.pc.post('/issues/' + issueId + '/access-grants', { subjectType: 'agent', subjectId: this.agent(agent).paperclipId });
  }
  async revokeGrant(issueId: string, grantId: string) {
    const grants = await this.pc.get<any[]>('/issues/' + issueId + '/access-grants');
    if (grants.some(g => g.id === grantId && !g.revokedAt)) await this.pc.post('/issues/' + issueId + '/access-grants/' + grantId + '/revoke', {});
  }
  async createTask(input: unknown, actor: WorkspaceActor) {
    this.manager(actor); const data = taskSchema.parse(input); this.domain(data.agent); data.sources.forEach(s => this.source(s));
    if (data.knowledgeSpace && !this.catalog().spaces[data.knowledgeSpace]) throw new Error('知识空间不存在');
    const trigger = 'workspace:' + digest(data.requestKey);
    const prior = this.store.byTrigger(trigger); if (prior) return prior;
    const issue = await this.pc.post('/companies/' + this.config.companyId + '/issues', { idempotencyKey: trigger, allowDuplicate: true,
      projectId: this.catalog().coordinationProject, visibility: 'private', title: data.title, description: data.goal,
      assigneeAgentId: this.agent(data.agent).paperclipId, status: 'backlog', ...collaborationReviewPolicy });
    const task: Task = { id: issue.id, identifier: issue.identifier, triggerId: trigger, chatId: 'local-workspace', messageId: 'local-workspace',
      senderId: 'local-operator', agent: data.agent, workspace: '', branch: '', context: JSON.stringify({ request: data.goal, source: 'workspace-ui' }),
      generation: 1, phase: 'ready', kind: 'collaboration' };
    const state: State = { version: 1, sources: [...new Set(data.sources)], requests: [], snapshots: [], outcomes: [], history: [],
      context: { autoDiscover: data.autoDiscover, requirements: data.requirements, linkedTasks: [], fullSources: [], knowledgeSpace: data.knowledgeSpace } };
    await this.save(task, state, 'task-created', { agent: data.agent });
    return task;
  }
  async request(input: unknown, actor: WorkspaceActor) {
    const data = requestSchema.parse(input), task = this.store.get(data.taskId), state = await this.state(task);
    if (task.phase === 'accepted') throw new Error('任务已完成，不能新增访问申请');
    const agent = actor.admin ? data.agent ?? task.agent : actor.agent!;
    if (!actor.admin && (task.agent !== agent || data.agent && data.agent !== agent)) throw new Error('Unauthorized: requester identity');
    this.domain(agent); const source = this.source(data.sourceId);
    if (!state.sources.includes(source.id)) throw new Error('资料不在本任务范围内');
    const key = 'access-' + digest(task.id + source.id + agent + data.requestKey);
    for (const id of state.requests) { const r = await this.access(id); if ((r as Access & { key?: string }).key === key) return this.ensureApproval(r); }
    const issue = await this.pc.post('/companies/' + this.config.companyId + '/issues', { idempotencyKey: key, allowDuplicate: true,
      projectId: this.catalog().coordinationProject, visibility: 'private', title: this.spaceName(source.domain) + '资料访问申请',
      description: '用途：' + data.purpose, status: 'backlog', assigneeAgentId: this.agent(this.catalog().spaces[source.domain].agent).paperclipId });
    const r = { id: issue.id, taskId: task.id, sourceId: source.id, agent, key, purpose: data.purpose,
      expiresAt: new Date(Date.now() + data.hours * 3600000).toISOString(), state: 'pending' as const, requestedBy: actor.admin ? 'local-operator' : agent };
    await this.saveAccess(r); await this.nativeGrant(issue.id, agent);
    state.requests.push(issue.id); await this.save(task, state, 'access-requested', { id: issue.id, sourceId: source.id, agent });
    return this.ensureApproval(r);
  }
  async ensureApproval(r: Access) {
    if (r.approvalId || r.state !== 'pending') return r;
    const approvals = await this.pc.get<any[]>('/companies/' + this.config.companyId + '/approvals');
    let approval = approvals.find(a => a.payload?.accessRequestId === r.id);
    if (!approval) approval = await this.pc.post('/companies/' + this.config.companyId + '/approvals', {
      type: 'request_board_approval', requestedByAgentId: this.agent(r.agent).paperclipId, issueIds: [r.id],
      payload: { title: '申请访问：' + this.source(r.sourceId).title, accessRequestId: r.id, taskId: r.taskId, sourceId: r.sourceId, agent: r.agent, expiresAt: r.expiresAt, purpose: r.purpose },
    });
    r.approvalId = approval.id; await this.saveAccess(r); return r;
  }
  async decide(id: string, decision: 'approved' | 'denied', reason: string, actor: WorkspaceActor) {
    this.manager(actor); const r = await this.access(id);
    if (r.state === decision) return r;
    if (r.state !== 'pending' || Date.parse(r.expiresAt) <= Date.now()) throw new Error('申请已经处理或过期，请重新申请');
    if (!reason.trim()) throw new Error('请填写授权或拒绝的依据');
    if (!r.approvalId) throw new Error('原生审批尚未创建，不能授予访问');
    let approval = await this.pc.get('/approvals/' + r.approvalId);
    if (approval.companyId !== this.config.companyId || approval.payload?.accessRequestId !== r.id
      || approval.payload?.agent !== r.agent || approval.payload?.sourceId !== r.sourceId || approval.payload?.expiresAt !== r.expiresAt) throw new Error('原生审批内容与申请不一致');
    const wanted = decision === 'approved' ? 'approved' : 'rejected';
    if (approval.status === 'pending') {
      await this.pc.post('/approvals/' + r.approvalId + (decision === 'approved' ? '/approve' : '/reject'), { decisionNote: reason });
      approval = await this.pc.get('/approvals/' + r.approvalId);
    }
    if (approval.status !== wanted) throw new Error('原生审批状态不允许这次操作');
    if (decision === 'approved') r.grantId = (await this.nativeGrant(this.source(r.sourceId).ref.taskId, r.agent)).id;
    r.state = decision; r.reviewedBy = 'local-operator'; r.reason = reason;
    await this.saveAccess(r); await this.pc.patch('/issues/' + r.id, { status: 'done' });
    const task = this.store.get(r.taskId), state = await this.state(task);
    if (decision === 'approved' && task.phase === 'access_blocked') {
      try { await this.requireSources(task, task.agent, state); task.phase = 'ready'; await this.pc.patch('/issues/' + task.id, { status: 'todo' }); } catch {}
    }
    await this.save(task, state, 'access-' + decision, { id, agent: r.agent, sourceId: r.sourceId }); return r;
  }
  async readSource(taskId: string, sourceId: string, actor: WorkspaceActor) {
    const task = this.store.get(taskId); await this.state(task);
    if (!actor.admin && (actor.agent !== task.agent || !await this.allowed(task, sourceId, actor.agent!))) throw new Error('Unauthorized: source access');
    if (!(await this.state(task)).sources.includes(sourceId)) throw new Error('资料不在本任务范围内');
    return this.readMaterial(sourceId, actor.admin ? undefined : actor.agent);
  }
  async guard(task: Task, agent = task.agent) {
    const state = await this.state(task); if (state.pendingHandoff) throw new Error('交接尚未完成，暂停领取执行');
    await this.requireSources(task, agent, state);
  }
  async checkpoint(taskId: string, text: string, actor: WorkspaceActor, lease?: string, receiptId?: string, inputManifest?: InputRef[]) {
    const task = this.store.get(taskId), state = await this.state(task);
    if (task.phase === 'accepted') throw new Error('任务已完成，不能继续执行');
    if (state.pendingHandoff) throw new Error('交接尚未完成，暂停提交检查点');
    if (!actor.admin && actor.agent !== task.agent) throw new Error('Unauthorized');
    if (actor.admin && task.phase === 'running') throw new Error('请由当前执行端提交检查点，确认停止后再交接');
    const key = receiptId ?? 'checkpoint:' + task.generation + ':' + digest(text);
    const old = state.snapshots.find(s => s.receiptId === key); if (old) return old;
    if (!actor.admin && (actor.agent !== task.agent || !lease || task.lease !== lease || task.phase !== 'running')) throw new Error('Stale or foreign execution receipt');
    if (!text.trim() || text.length > 30000) throw new Error('请填写有效检查点');
    await this.requireSources(task, task.agent, state);
    if (inputManifest) await this.assertManifest(task, inputManifest);
    const snap = await this.snapshot(task, 'checkpoint', '工作检查点', text, state.sources, key); snap.receiptId = key;
    snap.inputManifest = inputManifest;
    state.snapshots.push(snap); task.lastMessage = undefined; task.session = undefined; delete task.lease; task.phase = 'waiting';
    await this.pc.patch('/issues/' + task.id, { status: 'in_review' });
    await this.save(task, state, 'checkpoint', { id: snap.id, generation: task.generation, authoredBy: actor.automation ?? actor.agent ?? 'local-operator' });
    return snap;
  }
  async snapshot(task: Task, key: string, title: string, body: string, sources: string[], operation: string = randomUUID()): Promise<Snapshot> {
    const issue = await this.pc.post('/companies/' + this.config.companyId + '/issues', { idempotencyKey: 'snapshot:' + digest(task.id + ':' + key + ':' + operation),
      allowDuplicate: true, projectId: this.catalog().vaultProject, visibility: 'private', title, status: 'backlog' });
    if (body) await this.pc.document(issue.id, key, title, body);
    const grant = await this.nativeGrant(issue.id, task.agent);
    return { id: issue.id, key, title, domain: this.targetSpace(task, await this.state(task)), sources: [...sources], grants: [{ agent: task.agent, id: grant.id }] };
  }
  async handoff(taskId: string, next: string, actor: WorkspaceActor) {
    this.manager(actor); const task = this.store.get(taskId), state = await this.state(task), issue = await this.issue(task.id); this.domain(next);
    if (task.phase === 'accepted') throw new Error('任务已完成，不能交接');
    if (next === task.agent && !state.pendingHandoff) return task;
    if (state.pendingHandoff && state.pendingHandoff.next !== next) throw new Error('先恢复原交接，不能同时交接到另一个岗位');
    if (task.phase === 'running' || task.phase === 'unknown' || issue.executionRunId || issue.checkoutRunId || task.lease) throw new Error('先结束或核对原执行，再交接');
    await this.requireSources(task, next, state);
    const previous = state.pendingHandoff?.previous ?? task.agent;
    if (!state.pendingHandoff) {
      state.pendingHandoff = { previous, next, generation: task.generation + 1 }; task.phase = 'handoff_pending';
      await this.save(task, state, 'handoff-started', state.pendingHandoff);
    }
    for (const snap of state.snapshots) {
      if (!snap.grants.some(g => g.agent === next)) snap.grants.push({ agent: next, id: (await this.nativeGrant(snap.id, next)).id });
    }
    await this.pc.patch('/issues/' + task.id, { assigneeAgentId: this.agent(next).paperclipId, assigneeUserId: null, status: 'backlog' });
    // Task-scoped notes without source dependencies must end with the old executor too.
    for (const snap of [...state.snapshots, ...state.outcomes]) {
      for (const grant of snap.grants.filter(g => g.agent === previous)) await this.revokeGrant(snap.id, grant.id);
      snap.grants = snap.grants.filter(g => g.agent !== previous);
    }
    // Assignment grants intentionally persist upstream; explicitly end the old executor's task grant here.
    const grants = await this.pc.get<any[]>('/issues/' + task.id + '/access-grants');
    for (const g of grants.filter(g => !g.revokedAt && g.subjectId === this.config.agents[previous]?.paperclipId && !g.inherited)) await this.revokeGrant(task.id, g.id);
    task.agent = next; task.generation = state.pendingHandoff.generation; task.phase = 'handoff_pending'; delete task.lease; delete task.session; delete task.lastMessage;
    await this.save(task, state, 'handoff-assigned', { previous, next, generation: task.generation });
    // End the old task-specific material grants after a successful transfer.
    for (const id of state.requests) { const r = await this.access(id); if (r.agent === previous && requestIsCurrent(r)) await this.revoke(id, '交接完成，结束原执行者授权', actor); }
    const current = this.store.get(task.id), currentState = await this.state(current);
    delete currentState.pendingHandoff; current.phase = 'ready';
    await this.save(current, currentState, 'handoff', { previous, next, generation: current.generation });
    return current;
  }
  async revoke(id: string, reason: string, actor: WorkspaceActor, expired = false) {
    this.manager(actor); const r = await this.access(id);
    if (['revoked', 'expired', 'denied'].includes(r.state)) return r;
    if (!['approved', 'revoking'].includes(r.state)) throw new Error('只能撤销已批准申请');
    if (r.state !== 'revoking') { r.revokeOutcome = expired ? 'expired' : 'revoked'; r.reason = reason; }
    r.state = 'revoking'; await this.saveAccess(r); // Fail closed during partial revocation.
    const task = this.store.get(r.taskId), state = await this.state(task), source = this.source(r.sourceId);
    let sharedGrant = false;
    for (const t of this.store.list().filter(t => t.kind === 'collaboration')) {
      for (const otherId of (await this.state(t)).requests) {
        if (otherId === id) continue;
        const other = await this.access(otherId);
        if (other.agent === r.agent && other.sourceId === r.sourceId && requestIsCurrent(other)) sharedGrant = true;
      }
    }
    if (r.grantId && !sharedGrant) await this.revokeGrant(source.ref.taskId, r.grantId);
    try { await this.reader(r.agent).get('/issues/' + source.ref.taskId); r.remainingNativeAccess = true; } catch { r.remainingNativeAccess = false; }
    const stillAllowedForTask = await this.allowed(task, source.id, r.agent, state);
    // Every derived document is in a private vault with no role/project membership.
    // Remove only this principal's grant; other currently authorized principals keep their own access.
    for (const snap of [...state.snapshots, ...state.outcomes].filter(s => !stillAllowedForTask && !s.published && s.sources.includes(source.id))) {
      for (const g of snap.grants.filter(g => g.agent === r.agent)) await this.revokeGrant(snap.id, g.id);
      snap.grants = snap.grants.filter(g => g.agent !== r.agent);
    }
    if (task.agent === r.agent && !stillAllowedForTask) {
      const issue = await this.issue(task.id);
      const wasRunning = task.phase === 'running' || Boolean(task.lease);
      if (wasRunning || issue.executionRunId) state.fence = { agent: task.agent, lease: task.lease, runId: issue.executionRunId ?? undefined, generation: task.generation };
      if (issue.executionRunId) {
        await this.pc.post('/heartbeat-runs/' + issue.executionRunId + '/cancel', {});
        // Do not certify a stopped process or start replacement work here.
        task.phase = 'unknown';
      } else task.phase = wasRunning || state.fence ? 'unknown' : 'access_blocked';
      delete task.lease; delete task.session; delete task.lastMessage; task.generation++;
      await this.pc.patch('/issues/' + task.id, { status: 'blocked', unblockDescriptor: { owner: 'board', action: '核对执行已经结束，并为当前执行者重新授权所需资料' } });
    }
    r.state = r.revokeOutcome ?? (expired ? 'expired' : 'revoked'); await this.saveAccess(r);
    await this.save(task, state, 'access-' + r.state, { id, sourceId: source.id, agent: r.agent, sharedNativeGrantRemains: sharedGrant });
    return r;
  }
  async propose(taskId: string, input: unknown, actor: WorkspaceActor, operation?: string, inputManifest?: InputRef[]) {
    const task = this.store.get(taskId), state = await this.state(task);
    if (task.phase === 'accepted') throw new Error('任务已完成，请在专业空间新建知识');
    if (!actor.admin && task.agent !== actor.agent) throw new Error('Unauthorized');
    await this.requireSources(task, task.agent, state);
    const prior = operation && state.outcomes.find(s => s.receiptId === operation); if (prior) return prior;
    const record = knowledgeInput.parse(input);
    if (inputManifest) await this.assertManifest(task, inputManifest);
    const snap = await this.snapshot(task, record.key, record.title, '', state.sources, operation); snap.receiptId = operation;
    snap.inputManifest = inputManifest;
    const sourceTask: Task = { ...task, id: snap.id, identifier: (await this.issue(snap.id)).identifier,
      triggerId: 'knowledge:' + snap.id, phase: 'knowledge', kind: 'knowledge', knowledgeRefs: [] };
    this.store.save(sourceTask);
    await this.knowledge.propose(sourceTask, record, actor.automation ?? (actor.admin ? 'local-operator' : actor.agent!));
    state.outcomes.push(snap); await this.save(task, state, 'knowledge-proposed', { id: snap.id }); return snap;
  }
  async review(taskId: string, outcomeId: string, stateName: 'confirmed' | 'withdrawn', revision: string, actor: WorkspaceActor) {
    this.manager(actor); const task = this.store.get(taskId), state = await this.state(task);
    const snap = state.outcomes.find(s => s.id === outcomeId); if (!snap) throw new Error('结论不属于此任务');
    if (stateName === 'confirmed' && snap.inputManifest) await this.assertManifest(task, snap.inputManifest);
    await this.knowledge.review({ taskId: snap.id, key: snap.key }, stateName, revision, 'local-operator');
    await this.save(task, state, 'knowledge-' + stateName, { id: outcomeId }); return snap;
  }
  async publish(taskId: string, outcomeId: string, revision: string, reason: string, actor: WorkspaceActor) {
    this.manager(actor); if (!reason.trim()) throw new Error('共享需要说明采用依据与共享范围');
    const task = this.store.get(taskId), state = await this.state(task), snap = state.outcomes.find(s => s.id === outcomeId);
    if (!snap) throw new Error('结论不属于此任务');
    if (snap.inputManifest) await this.assertManifest(task, snap.inputManifest);
    const record = await this.knowledge.read({ taskId: snap.id, key: snap.key });
    if (record.revision !== revision || !reusable(record.value, this.config, secrets().jwtSecret)) throw new Error('先确认当前结论版本再发布');
    if (snap.publicationId) return { id: snap.publicationId, domain: snap.domain, title: snap.title };
    // Explicit human release creates a separate professional publication; restricted snapshots remain protected.
    const issue = await this.pc.post('/companies/' + this.config.companyId + '/issues', { idempotencyKey: 'release:' + outcomeId + ':' + revision,
      allowDuplicate: true, projectId: this.catalog().spaces[snap.domain].projectId, visibility: 'private', title: record.value.title, status: 'done' });
    const sourceTask: Task = { ...task, id: issue.id, identifier: issue.identifier, triggerId: 'published:' + issue.id, phase: 'knowledge', kind: 'knowledge', knowledgeRefs: [] };
    this.store.save(sourceTask);
    const data = knowledgeInput.parse(Object.fromEntries(Object.entries(record.value).filter(([key]) => key in knowledgeInput.shape)));
    const proposed = await this.knowledge.propose(sourceTask, data, 'local-operator');
    await this.knowledge.review(proposed.ref, 'confirmed', proposed.revision, 'local-operator');
    await this.pc.document(issue.id, 'provenance', '知识采用记录', JSON.stringify({ sourceTask: task.id, sourceOutcome: outcomeId,
      sourceRevision: revision, sources: snap.sources, releasedBy: 'local-operator', reason, releasedAt: new Date().toISOString(),
      audience: this.spaceName(snap.domain) + '知识空间成员', facts: record.value.facts }, null, 2));
    // The released document is separately scoped, never a public Wiki copy.
    snap.publicationId = issue.id;
    const catalog = this.catalog();
    if (!catalog.sources.some(s => s.id === issue.id)) {
      catalog.sources.push({ id: issue.id, title: snap.title, domain: snap.domain, ref: { taskId: issue.id, key: snap.key } }); this.saveCatalog(catalog);
    }
    await this.save(task, state, 'knowledge-published', { id: issue.id, sourceOutcome: outcomeId, domain: snap.domain });
    return { id: issue.id, domain: snap.domain, title: record.value.title };
  }
  async view(actor: WorkspaceActor) {
    const c = this.catalog(), tasks = [];
    for (const task of this.store.list().filter(t => t.kind === 'collaboration' && (actor.admin || t.agent === actor.agent))) {
      try {
      const state = await this.state(task), requests = [];
      for (const id of state.requests) { const r = await this.access(id); if (actor.admin || r.agent === actor.agent) requests.push(r); }
      const snapshots = [];
      for (const snap of [...state.snapshots, ...state.outcomes]) {
        try {
          if (!actor.admin) for (const source of snap.sources) if (!await this.allowed(task, source, actor.agent!, state)) throw new Error('denied');
          const doc = await (actor.admin ? this.pc : this.reader(actor.agent!)).get('/issues/' + snap.id + '/documents/' + snap.key);
          const value = snap.key.startsWith('knowledge-') ? parseKnowledge(doc.body) : undefined;
          const knowledgeState = !value ? undefined : value.state === 'confirmed' && !reusable(value, this.config, secrets().jwtSecret) ? 'candidate' : value.state;
          let contextState = snap.inputManifest ? 'current' : 'legacy';
          if (snap.inputManifest) try { await this.assertManifest(task, snap.inputManifest); } catch { contextState = 'historical'; }
          snapshots.push({ ...snap, body: value?.body ?? doc.body, record: value, revision: doc.latestRevisionId, knowledgeState, contextState });
        } catch { snapshots.push({ id: snap.id, title: '受限资料', restricted: true }); }
      }
      const issue = await this.issue(task.id);
      const sourceAccess = [];
      for (const sourceId of state.sources) sourceAccess.push(await this.sourceStatus(task, sourceId, task.agent, state));
      tasks.push({ id: task.id, identifier: task.identifier, title: issue.title, goal: issue.description, agent: task.agent, phase: task.phase, sourceAccess,
        generation: task.generation, state, requests, snapshots });
      } catch (error) {
        tasks.push({ id: task.id, identifier: task.identifier, title: '协作记录待核对', agent: task.agent, phase: 'unknown', generation: task.generation,
          state: { version: 1, sources: [], requests: [], snapshots: [], outcomes: [], history: [] } as State,
          requests: [], snapshots: [], error: String(error).slice(0, 300) });
      }
    }
    const sources = [];
    for (const source of c.sources) {
      if (!actor.admin && !this.members(source.domain).includes(actor.agent!) && !tasks.some(t => t.state.sources.includes(source.id))) continue;
      let record;
      try { if (!source.external && (actor.admin || this.members(source.domain).includes(actor.agent!))) record = await this.knowledge.read(source.ref, actor.admin ? this.pc : this.reader(actor.agent!)); } catch {}
      const knowledgeState = source.external ? 'source' : record?.value.state === 'confirmed' && !reusable(record.value, this.config, secrets().jwtSecret) ? 'candidate' : record?.value.state;
      sources.push({ ...source, ref: undefined, external: source.external ? { kind: source.external.kind, url: source.external.url } : undefined, record, restricted: !record, knowledgeState });
    }
    return { spaces: Object.entries(c.spaces).map(([id, s]) => ({ ...s, domain: id, name: this.spaceName(id), members: this.members(id) })), sources, tasks,
      feishuConnected: actor.admin && Boolean(c.feishuConnection), configurableAgents: actor.admin ? Object.entries(this.config.agents).filter(([key, a]) => a.enabled && key !== this.config.assistant?.agentKey && secrets().paperclipTokens?.[key]).map(([key, a]) => ({ key, name: a.name })) : [],
      actors: this.participantKeys().filter(key => this.config.agents[key]?.enabled).map(key => ({ key, name: this.config.agents[key]!.name })), operator: actor.admin ? '本机管理员' : actor.agent };
  }
  async complete(taskId: string, actor: WorkspaceActor, input: unknown = {}) {
    this.manager(actor); const task = this.store.get(taskId), state = await this.state(task), issue = await this.issue(taskId);
    const review = z.object({ reason: z.string().trim().max(2000).optional(), noKnowledge: z.boolean().default(false),
      checkpoint: z.object({ id: z.string(), revision: z.string() }).strict().optional() }).strict().parse(input);
    const notify = () => {
      if (task.messageId.startsWith('om_')) this.store.notify('workspace-completed:' + taskId, taskId,
        `${task.identifier} 的交付记录已由负责人确认，本任务临时访问已全部结束。具体验收范围与工作稿见协作台。\n${this.config.paperclipUrl}/SUI/knowledge-workspaces`);
    };
    if (task.phase === 'accepted' && issue.status === 'done') { notify(); return task; }
    if (task.phase === 'running' || task.phase === 'unknown' || issue.executionRunId || issue.checkoutRunId || task.lease) throw new Error('先核对执行已经结束');
    if (review.checkpoint) {
      const snapshot = state.snapshots.find(s => s.id === review.checkpoint!.id && s.key === 'checkpoint');
      if (!snapshot || (await this.pc.get('/issues/' + snapshot.id + '/documents/' + snapshot.key)).latestRevisionId !== review.checkpoint.revision) throw new Error('工作稿版本已变化，请审阅当前版本再验收');
    }
    if (!state.outcomes.some(s => s.publicationId) && !(review.noKnowledge && review.reason && review.checkpoint)) throw new Error('请明确采用知识，或按已审阅工作稿记录本次暂不采用知识的验收依据');
    for (const id of state.requests) {
      const r = await this.access(id);
      if (r.state === 'pending') {
        if (Date.parse(r.expiresAt) <= Date.now()) await this.expirePending(r);
        else await this.decide(id, 'denied', '任务结束，关闭未处理申请', actor);
      }
      else if (requestIsCurrent(r)) await this.revoke(id, '任务完成，结束临时授权', actor);
    }
    const current = this.store.get(taskId), currentState = await this.state(current);
    for (const snap of [...currentState.snapshots, ...currentState.outcomes]) {
      for (const grant of snap.grants) await this.revokeGrant(snap.id, grant.id);
      snap.grants = [];
    }
    const decision = { status: 'done', comment: review.reason || '负责人已审阅并验收本任务交付与采用记录，结束临时访问。' };
    let native = await this.pc.patch('/issues/' + taskId, decision);
    // Native completion can first enter the configured human review stage.
    // Apply this same human decision there; never advance a different reviewer.
    if (native.status === 'in_review' && native.executionState?.status === 'pending'
      && native.executionState.currentParticipant?.type === 'user' && native.executionState.currentParticipant.userId === 'local-board'
      && collaborationOwnerMatches(native, [this.agent(current.agent).paperclipId!])) native = await this.pc.patch('/issues/' + taskId, decision);
    if (native.status !== 'done') throw new Error('原生人工审阅尚未完成；临时访问已结束，不能提前记录验收完成');
    current.phase = 'accepted';
    await this.save(current, currentState, 'completed', { adoptedKnowledge: currentState.outcomes.map(s => s.publicationId).filter(Boolean), review, temporaryAccessEnded: true });
    notify();
    return current;
  }
  async prepareHandoff(taskId: string, agent: string, actor: WorkspaceActor) {
    this.manager(actor); this.domain(agent);
    const task = this.store.get(taskId), state = await this.state(task);
    if (['accepted', 'running', 'unknown', 'handoff_pending'].includes(task.phase)) throw new Error('先核对当前执行状态，再准备交接');
    const requests = [];
    for (const sourceId of state.sources) {
      if (await this.allowed(task, sourceId, agent, state)) continue;
      const existing = await Promise.all(state.requests.map(id => this.access(id)));
      const pending = existing.find(r => r.agent === agent && r.sourceId === sourceId && r.state === 'pending' && Date.parse(r.expiresAt) > Date.now());
      requests.push(pending ?? await this.request({ taskId, sourceId, agent, purpose: '接续任务 ' + task.identifier + '，仅用于本次跨岗位交接', hours: 8,
        requestKey: 'handoff:' + task.generation + ':' + agent + ':' + state.requests.length }, actor));
    }
    return { ready: requests.length === 0, requests };
  }
  async adopt(taskId: string, outcomeId: string, revision: string, reason: string, actor: WorkspaceActor) {
    this.manager(actor); if (!reason.trim()) throw new Error('请说明采用依据和共享范围');
    const task = this.store.get(taskId), state = await this.state(task), snap = state.outcomes.find(s => s.id === outcomeId);
    if (!snap) throw new Error('结论不属于此任务');
    let record = await this.knowledge.read({ taskId: snap.id, key: snap.key });
    if (record.revision !== revision) throw new Error('知识版本已变化，请查看当前版本后再采用');
    if (!reusable(record.value, this.config, secrets().jwtSecret)) {
      await this.review(taskId, outcomeId, 'confirmed', revision, actor);
      record = await this.knowledge.read({ taskId: snap.id, key: snap.key });
    }
    return this.publish(taskId, outcomeId, record.revision, reason, actor);
  }
  async assertManifest(task: Task, manifest: InputRef[], seen = new Set<string>()) {
    const state = await this.state(task);
    for (const ref of manifest) {
      let revision: string, hash: string;
      if (ref.kind === 'goal') { const value = contextHash(goalEvidence(await this.issue(task.id), state)); revision = hash = value; }
      else if (ref.kind === 'knowledge') {
        if (!state.sources.includes(ref.id)) throw new Error('来源不再属于本任务');
        const record = await this.readMaterial(ref.id);
        if (!this.source(ref.id).external && !reusable(record.value, this.config, secrets().jwtSecret)) throw new Error('来源版本待重新确认'); revision = record.revision; hash = record.hash;
      } else if (ref.kind === 'conversation') {
        if (ref.id !== task.id && !state.context?.linkedTasks.includes(ref.id)) throw new Error('讨论来源不属于本任务上下文');
        const value = contextHash(discussionEvidence(await this.pc.get('/issues/' + ref.id + '/comments'))); revision = hash = value;
      } else if (ref.kind === 'delivery') {
        if (!state.context?.linkedTasks.includes(ref.id)) throw new Error('研发上下文关联已变化');
        const other = this.store.get(ref.id), value = contextHash(deliveryEvidence(other, await this.reader(task.agent).get('/issues/' + other.id))); revision = hash = value;
      } else {
        const snapshot = state.snapshots.find(s => s.id === ref.id && s.key === ref.key);
        if (!snapshot) throw new Error('上下文记录不属于此任务');
        if (snapshot.inputManifest) {
          if (seen.has(snapshot.id)) throw new Error('上下文依赖出现循环，请重新整理来源');
          const next = new Set(seen); next.add(snapshot.id); await this.assertManifest(task, snapshot.inputManifest, next);
        }
        const doc = await this.pc.get('/issues/' + ref.id + '/documents/' + ref.key); revision = doc.latestRevisionId; hash = contextHash(doc.body);
      }
      if (revision !== ref.revision || hash !== ref.hash) throw new Error('生成所用上下文已经变化，请重新整理并审阅当前版本');
    }
  }
  async stopped(taskId: string, lease: string | undefined, note: string, confirmed: boolean, actor: WorkspaceActor) {
    const task = this.store.get(taskId), state = await this.state(task), issue = await this.issue(taskId);
    if (task.phase !== 'unknown' || !state.fence) throw new Error('没有待核对的执行');
    if (issue.executionRunId || issue.checkoutRunId) throw new Error('原生执行仍未释放，不能确认停止');
    if (!actor.admin && (actor.agent !== state.fence.agent || !lease || lease !== state.fence.lease)) throw new Error('Unauthorized: original executor required');
    if (!confirmed || !note.trim()) throw new Error('请明确记录原执行已停止的核对依据');
    if (state.fence.runId) {
      const run = await this.pc.get('/heartbeat-runs/' + state.fence.runId);
      if (!['failed', 'succeeded', 'cancelled'].includes(run.status)) throw new Error('原生运行尚未结束');
    }
    const fence = state.fence; delete state.fence; task.phase = 'access_blocked';
    await this.save(task, state, 'execution-stop-confirmed', { agent: fence.agent, runId: fence.runId, note, attestedBy: actor.admin ? 'local-operator' : actor.agent,
      evidenceType: actor.admin ? 'operator-attestation' : 'original-executor-acknowledgement' });
    return task;
  }
  async tick() {
    if (!existsSync(runtime('knowledge-workspaces.json'))) return;
    for (const task of this.store.list().filter(t => t.kind === 'collaboration')) {
      try {
      const state = await this.state(task);
      if (state.pendingHandoff) await this.handoff(task.id, state.pendingHandoff.next, { admin: true });
      const currentTask = this.store.get(task.id);
      for (const id of (await this.state(currentTask)).requests) {
        let r = await this.access(id);
        if (requestIsCurrent(r) && this.source(r.sourceId).external) {
          try { await this.feishu.read(this.source(r.sourceId).external!); }
          catch (error) { if (error instanceof FeishuUnavailable && error.permanent) { await this.revoke(id, '飞书来源访问已失效，结束本任务委托；恢复后需重新确认', { admin: true }); continue; } }
        }
        if (r.state === 'pending' && Date.parse(r.expiresAt) <= Date.now()) { await this.expirePending(r); continue; }
        if (r.state === 'pending' && !r.approvalId) r = await this.ensureApproval(r);
        if (r.state === 'revoking' || r.state === 'approved' && Date.parse(r.expiresAt) <= Date.now()) await this.revoke(id, '授权到期或恢复未完成的撤权', { admin: true }, Date.parse(r.expiresAt) <= Date.now());
        if (r.state === 'pending' && r.approvalId) {
          const approval = await this.pc.get('/approvals/' + r.approvalId);
          if (['approved', 'rejected'].includes(approval.status)) await this.decide(id, approval.status === 'approved' ? 'approved' : 'denied', approval.decisionNote ?? '在原生审批页面处理', { admin: true });
        }
      }
      } catch (error) { this.store.audit('workspace.reconciliation-blocked', task.id, { error: String(error).slice(0, 300) }); }
    }
  }
  async expirePending(r: Access) {
    r.state = 'expired'; r.reason = '申请过期，未授予资料权限'; await this.saveAccess(r);
    if (r.approvalId) {
      const approval = await this.pc.get('/approvals/' + r.approvalId);
      if (approval.status === 'pending') await this.pc.post('/approvals/' + r.approvalId + '/reject', { decisionNote: r.reason });
    }
    await this.pc.patch('/issues/' + r.id, { status: 'cancelled' });
  }
  async dispatch(action: string, data: any, actor: WorkspaceActor) {
    if (action === 'configure-space') return this.configureSpace(data, actor);
    if (action === 'configure-participants') return this.configureParticipants(z.array(z.string()).parse(data.keys), actor);
    if (action === 'sync-space-members') return this.syncSpaceMembers(z.string().parse(data.space), actor);
    if (action === 'register-feishu-source') return this.registerExternal(data.space, data.reference, actor);
    if (action === 'attach-feishu-document') return this.attachFeishuDocument(z.string().parse(data.space), z.string().parse(data.url), actor);
    if (action === 'view') return this.view(actor);
    if (action === 'create-source') return this.createSource(z.string().parse(data.domain), data.record, actor);
    if (action === 'review-source') return this.reviewSource(data.id, z.enum(['confirmed', 'withdrawn']).parse(data.state), data.revision, actor);
    if (action === 'update-source') return this.updateSource(z.string().parse(data.id), data.record, z.string().parse(data.revision), actor);
    if (action === 'create-task') return this.createTask(data, actor);
    if (action === 'request') return this.request(data, actor);
    if (action === 'decide') return this.decide(data.id, z.enum(['approved', 'denied']).parse(data.decision), data.reason ?? '', actor);
    if (action === 'revoke') return this.revoke(data.id, data.reason ?? '负责人撤销', actor);
    if (action === 'read-source') return this.readSource(data.taskId, data.sourceId, actor);
    if (action === 'checkpoint') return this.checkpoint(data.taskId, data.text, actor, data.lease, data.receiptId);
    if (action === 'handoff') return this.handoff(data.taskId, data.agent, actor);
    if (action === 'prepare-handoff') return this.prepareHandoff(data.taskId, data.agent, actor);
    if (action === 'propose') return this.propose(data.taskId, data.record, actor);
    if (action === 'review') return this.review(data.taskId, data.outcomeId, z.enum(['confirmed', 'withdrawn']).parse(data.state), data.revision, actor);
    if (action === 'publish') return this.publish(data.taskId, data.outcomeId, data.revision, data.reason ?? '', actor);
    if (action === 'adopt') return this.adopt(data.taskId, data.outcomeId, data.revision, data.reason ?? '', actor);
    if (action === 'complete') { const { taskId, ...review } = data; return this.complete(taskId, actor, review); }
    if (action === 'stopped') return this.stopped(data.taskId, data.lease, data.note ?? '', data.confirmed === true, actor);
    throw new Error('Unknown workspace action');
  }
}
