import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { z } from 'zod';
import { loadConfig, runtime, secrets, type Config } from './config.ts';
import { Paperclip } from './paperclip.ts';
import { Store, type Task } from './store.ts';
import { KnowledgeService, knowledgeInput, reusable, parseKnowledge } from './knowledge.ts';
import { contextHash, deliveryEvidence, goalEvidence, discussionEvidence, type InputRef } from './context.ts';

export const domains = ['product', 'growth', 'sales', 'operations'] as const;
export type Domain = typeof domains[number];
export const domainNames: Record<Domain, string> = { product: '产研', growth: '增长', sales: '销售', operations: '职能' };
export type Catalog = { companyId: string; coordinationProject: string; vaultProject: string; spaces: Record<Domain, { projectId: string; agent: string }>;
  sources: { id: string; title: string; domain: Domain; ref: { taskId: string; key: string } }[] };
export type State = { version: 1; sources: string[]; requests: string[]; snapshots: Snapshot[]; outcomes: Snapshot[]; history: { at: string; event: string; detail: unknown }[];
  delegation?: { enabled: boolean; mode: 'prepare' | 'advance'; jobId?: string; lastBasis?: string; instruction?: string; nonce?: string };
  context?: { autoDiscover: boolean; linkedTasks: string[]; requirements: string[]; fullSources: string[]; excludedSources?: string[] };
  fence?: { agent: string; lease?: string; runId?: string; generation: number };
  pendingHandoff?: { previous: string; next: string; generation: number }; proof?: string };
type Snapshot = { id: string; title: string; domain: Domain; sources: string[]; key: string; grants: { agent: string; id: string }[]; published?: boolean; publicationId?: string; receiptId?: string; inputManifest?: InputRef[] };
type Access = { id: string; taskId: string; sourceId: string; agent: string; purpose: string; expiresAt: string;
  state: 'pending' | 'approved' | 'denied' | 'revoking' | 'revoked' | 'expired'; grantId?: string; approvalId?: string; requestedBy: string; reviewedBy?: string; reason?: string; revokeOutcome?: 'expired' | 'revoked'; remainingNativeAccess?: boolean; proof?: string };
export type WorkspaceActor = { admin: boolean; agent?: string; automation?: string };
const requestSchema = z.object({ taskId: z.string(), sourceId: z.string(), agent: z.string().optional(),
  purpose: z.string().trim().min(1).max(1000), hours: z.number().min(1 / 60).max(168).default(8), requestKey: z.string().min(1).max(120) }).strict();
const taskSchema = z.object({ title: z.string().trim().min(1).max(120), goal: z.string().trim().min(1).max(5000),
  agent: z.string(), sources: z.array(z.string()).max(8), requestKey: z.string().min(1).max(120),
  autoDiscover: z.boolean().default(true), requirements: z.array(z.string().max(500)).max(12).default([]) }).strict();
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
  domain(key: string): Domain {
    const found = domains.find(d => this.catalog().spaces[d].agent === key);
    if (!found) throw new Error('请选择一个已配置的专业岗位'); return found;
  }
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
    if (!expected.some(key => this.config.agents[key]?.paperclipId === issue.assigneeAgentId)) throw new Error('原生负责人已改变，请先核对协作合同');
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
  async createSource(domain: Domain, input: unknown, actor: WorkspaceActor) {
    this.manager(actor); if (!domains.includes(domain)) throw new Error('Invalid professional space');
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
    this.manager(actor); return this.knowledge.review(this.source(id).ref, state, revision, 'local-operator');
  }
  async allowed(task: Task, sourceId: string, agent: string, state?: State) {
    const s = this.source(sourceId); this.domain(agent);
    // Native ACL is always re-evaluated, including when another explicit grant remains.
    try { const record = await this.knowledge.read(s.ref, this.reader(agent));
      if (!reusable(record.value, this.config, secrets().jwtSecret)) return false;
    } catch { return false; }
    if (this.catalog().spaces[s.domain].agent === agent) return true;
    for (const id of (state ?? await this.state(task)).requests) {
      const r = await this.access(id);
      if (r.agent === agent && r.sourceId === sourceId && requestIsCurrent(r)) return true;
    }
    return false;
  }
  async requireSources(task: Task, agent: string, state?: State) {
    const current = state ?? await this.state(task), missing = [];
    for (const id of current.sources) if (!await this.allowed(task, id, agent, current)) missing.push(this.source(id).title);
    if (missing.length) throw new Error('需要为' + domainNames[this.domain(agent)] + '执行者申请或恢复访问：' + missing.join('、'));
  }
  async sourceStatus(task: Task, sourceId: string, agent: string, state?: State) {
    if (await this.allowed(task, sourceId, agent, state)) return { sourceId, allowed: true, reason: 'current' };
    try {
      const record = await this.knowledge.read(this.source(sourceId).ref, this.reader(agent));
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
    const trigger = 'workspace:' + digest(data.requestKey);
    const prior = this.store.byTrigger(trigger); if (prior) return prior;
    const issue = await this.pc.post('/companies/' + this.config.companyId + '/issues', { idempotencyKey: trigger, allowDuplicate: true,
      projectId: this.catalog().coordinationProject, visibility: 'private', title: data.title, description: data.goal,
      assigneeAgentId: this.agent(data.agent).paperclipId, status: 'backlog' });
    const task: Task = { id: issue.id, identifier: issue.identifier, triggerId: trigger, chatId: 'local-workspace', messageId: 'local-workspace',
      senderId: 'local-operator', agent: data.agent, workspace: '', branch: '', context: JSON.stringify({ request: data.goal, source: 'workspace-ui' }),
      generation: 1, phase: 'ready', kind: 'collaboration' };
    const state: State = { version: 1, sources: [...new Set(data.sources)], requests: [], snapshots: [], outcomes: [], history: [],
      context: { autoDiscover: data.autoDiscover, requirements: data.requirements, linkedTasks: [], fullSources: [] } };
    await this.save(task, state, 'task-created', { agent: data.agent });
    await this.pc.patch('/issues/' + task.id, { status: 'todo' }); return task;
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
      projectId: this.catalog().coordinationProject, visibility: 'private', title: domainNames[source.domain] + '资料访问申请',
      description: '用途：' + data.purpose, status: 'todo', assigneeAgentId: this.agent(this.catalog().spaces[source.domain].agent).paperclipId });
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
    return this.knowledge.read(this.source(sourceId).ref, actor.admin ? this.pc : this.reader(actor.agent!));
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
    return { id: issue.id, key, title, domain: this.domain(task.agent), sources: [...sources], grants: [{ agent: task.agent, id: grant.id }] };
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
    await this.pc.patch('/issues/' + task.id, { assigneeAgentId: this.agent(next).paperclipId, status: 'todo' });
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
      audience: domainNames[snap.domain] + '知识空间成员', facts: record.value.facts }, null, 2));
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
      if (!actor.admin && c.spaces[source.domain].agent !== actor.agent && !tasks.some(t => t.state.sources.includes(source.id))) continue;
      let record;
      try { if (actor.admin || c.spaces[source.domain].agent === actor.agent) record = await this.knowledge.read(source.ref, actor.admin ? this.pc : this.reader(actor.agent!)); } catch {}
      const knowledgeState = record?.value.state === 'confirmed' && !reusable(record.value, this.config, secrets().jwtSecret) ? 'candidate' : record?.value.state;
      sources.push({ ...source, ref: undefined, record, restricted: !record, knowledgeState });
    }
    return { spaces: domains.map(d => ({ domain: d, name: domainNames[d], ...c.spaces[d] })), sources, tasks,
      actors: domains.map(d => ({ key: c.spaces[d].agent, name: domainNames[d] })), operator: actor.admin ? '本机管理员' : actor.agent };
  }
  async complete(taskId: string, actor: WorkspaceActor) {
    this.manager(actor); const task = this.store.get(taskId), state = await this.state(task), issue = await this.issue(taskId);
    if (task.phase === 'accepted') return task;
    if (task.phase === 'running' || task.phase === 'unknown' || issue.executionRunId || issue.checkoutRunId || task.lease) throw new Error('先核对执行已经结束');
    if (!state.outcomes.some(s => s.publicationId)) throw new Error('先完成知识确认与专业空间采用');
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
    current.phase = 'accepted'; await this.pc.patch('/issues/' + taskId, { status: 'done' });
    await this.save(current, currentState, 'completed', { adoptedKnowledge: currentState.outcomes.map(s => s.publicationId).filter(Boolean), temporaryAccessEnded: true });
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
  async assertManifest(task: Task, manifest: InputRef[]) {
    const state = await this.state(task);
    for (const ref of manifest) {
      let revision: string, hash: string;
      if (ref.kind === 'goal') { const value = contextHash(goalEvidence(await this.issue(task.id), state)); revision = hash = value; }
      else if (ref.kind === 'knowledge') {
        if (!state.sources.includes(ref.id)) throw new Error('来源不再属于本任务');
        const record = await this.knowledge.read(this.source(ref.id).ref);
        if (!reusable(record.value, this.config, secrets().jwtSecret)) throw new Error('来源版本待重新确认'); revision = record.revision; hash = record.hash;
      } else if (ref.kind === 'conversation') {
        if (ref.id !== task.id && !state.context?.linkedTasks.includes(ref.id)) throw new Error('讨论来源不属于本任务上下文');
        const value = contextHash(discussionEvidence(await this.pc.get('/issues/' + ref.id + '/comments'))); revision = hash = value;
      } else if (ref.kind === 'delivery') {
        if (!state.context?.linkedTasks.includes(ref.id)) throw new Error('研发上下文关联已变化');
        const other = this.store.get(ref.id), value = contextHash(deliveryEvidence(other, await this.issue(other.id))); revision = hash = value;
      } else {
        if (!state.snapshots.some(s => s.id === ref.id && s.key === ref.key)) throw new Error('上下文记录不属于此任务');
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
    if (action === 'view') return this.view(actor);
    if (action === 'create-source') return this.createSource(z.enum(domains).parse(data.domain), data.record, actor);
    if (action === 'review-source') return this.reviewSource(data.id, z.enum(['confirmed', 'withdrawn']).parse(data.state), data.revision, actor);
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
    if (action === 'complete') return this.complete(data.taskId, actor);
    if (action === 'stopped') return this.stopped(data.taskId, data.lease, data.note ?? '', data.confirmed === true, actor);
    throw new Error('Unknown workspace action');
  }
}
