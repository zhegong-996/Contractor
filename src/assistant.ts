import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { secrets } from './config.ts';
import { Workspaces, contractProof, domainNames, type WorkspaceActor } from './workspaces.ts';
import type { Task } from './store.ts';
import { verifyEvidenceQuotes, projectHistoricalEvidence } from './evidence.ts';
import { TaskContext, type InputRef } from './context.ts';

export const assistantOutput = z.object({
  summary: z.string().trim().min(1).max(2500),
  evidenceQuotes: z.array(z.object({ sourceId: z.string(), quote: z.string().min(4).max(1000) }).strict()).max(8),
  contextGaps: z.array(z.object({ question: z.string().min(1).max(600), kind: z.enum(['fact', 'goal', 'constraint', 'permission', 'version', 'coverage']), sourceIds: z.array(z.string()).max(8) }).strict()).max(8),
  workProducts: z.array(z.object({ title: z.string().min(1).max(120), kind: z.enum(['template', 'checklist', 'brief']), body: z.string().min(1).max(5000) }).strict()).max(3),
  nextSteps: z.array(z.object({ text: z.string().min(1).max(600), owner: z.enum(['agent', 'human']),
    kind: z.enum(['work', 'clarify', 'authorize', 'handoff', 'adopt', 'accept']), sourceIds: z.array(z.string()).max(8) }).strict()).max(12),
  handoff: z.string().max(6000), checkpoint: z.string().max(12000),
  knowledge: z.object({ title: z.string().min(1).max(120), appliesTo: z.string().min(1).max(1000),
    facts: z.array(z.object({ name: z.string().min(1).max(100), value: z.string().max(2000) }).strict()).max(16), body: z.string().min(1).max(12000) }).strict().nullable(),
}).strict();
export type AssistantOutput = z.infer<typeof assistantOutput>;
export const assistantOutputSchema = z.toJSONSchema(assistantOutput);
type Job = { version: 1; id: string; taskId: string; agent: string; basis: string; createdAt: string; mode: 'prepare' | 'advance'; evidenceSources?: { id: string; revision: string; title?: string }[]; inputManifest?: InputRef[]; inputCoverage?: unknown;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cancelling' | 'stale'; runId?: string;
  error?: string; output?: AssistantOutput; applied?: { checkpoint?: string; knowledge?: string }; usage?: unknown; inputRevision?: string; proof?: string };
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateAssistantOutput(value: unknown, sourceIds: string[]) {
  const output = assistantOutput.parse(value);
  for (const step of [...output.nextSteps, ...output.contextGaps]) if (step.sourceIds.some(id => !sourceIds.includes(id))) throw new Error('Agent 引用了任务以外的资料');
  return output;
}

// Native Paperclip child tasks and runs own execution. This service only assembles scoped context
// and applies explicitly delegated, reversible preparation; it never authorizes or accepts work.
export class WorkspaceAssistant {
  private cancellations = new Map<string, Promise<unknown>>();
  readonly taskContext: TaskContext;
  constructor(readonly workspaces: Workspaces) { this.taskContext = new TaskContext(workspaces); }
  get config() { return this.workspaces.config; }
  get pc() { return this.workspaces.pc; }
  get store() { return this.workspaces.store; }
  get key() { return this.config.assistant?.agentKey ?? 'workspace-assistant'; }
  available() { return Boolean(this.config.assistant?.enabled && this.config.assistant.projectId && this.config.agents[this.key]?.paperclipId); }
  async job(id: string): Promise<Job> {
    const issue = await this.workspaces.issue(id);
    if (issue.projectId !== this.config.assistant?.projectId || issue.assigneeAgentId !== this.config.agents[this.key]?.paperclipId) throw new Error('Unauthorized: assistant job boundary');
    const job: Job = JSON.parse((await this.pc.get('/issues/' + id + '/documents/assistant-job')).body);
    if (job.id !== id || job.proof !== contractProof('assistant', id, job, secrets().jwtSecret)) throw new Error('Agent 运行记录已改变，先核对原生修订');
    return job;
  }
  async save(job: Job) { job.proof = contractProof('assistant', job.id, job, secrets().jwtSecret);
    await this.pc.document(job.id, 'assistant-job', 'Agent 整理记录', JSON.stringify(job, null, 2)); }
  async bundle(task: Task, job?: Pick<Job, 'id'>) {
    const state = await this.workspaces.state(task), pack = await this.taskContext.collect(task, job ? 'assistant:' + job.id : undefined);
    const { sources, checkpoints, missing, requests, decisions, goal } = pack.layers;
    const basis = hash({ id: task.id, generation: task.generation, agent: task.agent, manifest: pack.manifest,
      selection: [...sources, ...checkpoints].map(s => ({ id: s.id, range: s.range })), missing, requests,
      delegation: { mode: state.delegation?.mode, nonce: state.delegation?.nonce, instruction: state.delegation?.instruction } });
    return { basis, manifest: pack.manifest, context: { task: { id: task.id, identifier: task.identifier, title: goal.title, goal: goal.goal,
      requirements: goal.requirements, origin: goal.origin, professionalRole: domainNames[this.workspaces.domain(task.agent)] },
      instruction: state.delegation?.instruction ?? '', sources, missing, requests, checkpoints, decisions, coverage: pack.coverage } };
  }
  async delegate(taskId: string, enabled: boolean, mode: 'prepare' | 'advance', instruction: string, actor: WorkspaceActor, nonce?: string) {
    this.workspaces.manager(actor);
    if (!this.available()) throw new Error('协作 Agent 尚未配置，请运行 npm run setup:assistant');
    const task = this.store.get(taskId), state = await this.workspaces.state(task);
    if (task.phase === 'accepted') throw new Error('任务已完成，请新建协作任务');
    state.delegation = { ...state.delegation, enabled, mode, instruction: instruction.slice(0, 5000), nonce: nonce ?? state.delegation?.nonce };
    await this.workspaces.save(task, state, enabled ? 'assistant-delegated' : 'assistant-paused', { mode, enabled, delegatedBy: 'local-operator' });
    if (!enabled && state.delegation.jobId) await this.cancel(taskId, actor);
    return enabled ? this.advance(taskId) : { paused: true };
  }
  async advance(taskId: string) {
    if (!this.available()) return;
    let task = this.store.get(taskId), state = await this.workspaces.state(task);
    if (!state.delegation?.enabled || ['accepted', 'running', 'unknown', 'handoff_pending'].includes(task.phase)) return;
    let previous: Job | undefined;
    if (state.delegation.jobId) {
      previous = await this.reconcile(state.delegation.jobId);
      if (['queued', 'running', 'cancelling'].includes(previous.status)) return previous;
    }
    await this.taskContext.enrich(task.id, { admin: false, agent: task.agent }, true);
    state = await this.workspaces.state(this.store.get(task.id));
    if (state.delegation!.mode === 'advance') {
      for (const sourceId of state.sources) {
        const status = await this.workspaces.sourceStatus(task, sourceId, task.agent, state);
        if (status.allowed || status.reason === 'version') continue;
        const requests = await Promise.all(state.requests.map(id => this.workspaces.access(id)));
        // A refusal or withdrawal is a human decision. Do not keep recreating the same application.
        if (requests.some(r => r.sourceId === sourceId && r.agent === task.agent)) continue;
        await this.workspaces.request({ taskId, sourceId, purpose: '为任务 ' + task.identifier + ' 整理资料并准备交付；仅本任务使用', hours: 8,
          requestKey: 'assistant:' + task.generation + ':' + sourceId }, { admin: false, agent: task.agent });
        state = await this.workspaces.state(this.store.get(taskId));
      }
    }
    task = this.store.get(taskId); state = await this.workspaces.state(task);
    if (previous && state.delegation?.lastBasis === (await this.bundle(task, previous)).basis) return;
    const bundle = await this.bundle(task);
    if (!previous && state.delegation?.lastBasis === bundle.basis) return;
    const issue = await this.pc.post('/companies/' + this.config.companyId + '/issues', { allowDuplicate: true,
      idempotencyKey: 'assistant:' + task.id + ':' + bundle.basis, projectId: this.config.assistant!.projectId, visibility: 'private',
      parentId: task.id, title: task.identifier + ' · Agent 整理', status: 'backlog', assigneeAgentId: this.config.agents[this.key]!.paperclipId });
    const job: Job = { version: 1, id: issue.id, taskId, agent: task.agent, basis: bundle.basis, mode: state.delegation!.mode,
      createdAt: new Date().toISOString(), status: 'queued', inputManifest: bundle.manifest, inputCoverage: bundle.context.coverage,
      evidenceSources: bundle.context.sources.map(s => ({ id: s.id, revision: s.revision, title: s.title })) };
    await this.save(job);
    state.delegation!.jobId = issue.id; state.delegation!.lastBasis = bundle.basis;
    await this.workspaces.save(task, state, 'assistant-queued', { jobId: issue.id, engine: this.config.assistant!.engine });
    await this.pc.patch('/issues/' + issue.id, { status: 'todo' });
    await this.pc.post('/agents/' + this.config.agents[this.key]!.paperclipId + '/wakeup', { source: 'on_demand', triggerDetail: 'manual',
      reason: 'workspace_preparation', payload: { issueId: issue.id }, idempotencyKey: 'assistant-wake:' + issue.id });
    return job;
  }
  async owned(jobId: string, runId: string, actor: WorkspaceActor) {
    if (actor.admin || actor.agent !== this.key) throw new Error('Unauthorized: assistant executor required');
    const job = await this.job(jobId), run = await this.pc.get('/heartbeat-runs/' + runId), issue = await this.workspaces.issue(jobId);
    if (run.agentId !== this.config.agents[this.key]?.paperclipId || run.contextSnapshot?.issueId !== jobId || run.status !== 'running'
      || issue.executionRunId !== runId || job.runId && job.runId !== runId) throw new Error('Unauthorized: native run does not own preparation');
    return job;
  }
  async context(jobId: string, runId: string, actor: WorkspaceActor) {
    const job = await this.owned(jobId, runId, actor), task = this.store.get(job.taskId), state = await this.workspaces.state(task), bundle = await this.bundle(task, job);
    if (!['queued', 'running'].includes(job.status) || !state.delegation?.enabled || state.delegation.jobId !== job.id || bundle.basis !== job.basis
      || ['running', 'unknown', 'handoff_pending', 'accepted'].includes(task.phase)) throw new Error('上下文或委托已改变，停止本次整理');
    await this.pc.document(job.id, 'assistant-input', '本轮实际上下文与覆盖范围', JSON.stringify({ promptVersion: 'workspace-context-v2', manifest: bundle.manifest, context: bundle.context }, null, 2));
    job.inputRevision = (await this.pc.get('/issues/' + job.id + '/documents/assistant-input')).latestRevisionId;
    if ((await this.bundle(task, job)).basis !== job.basis) throw new Error('装配期间上下文发生变化，停止本次整理');
    job.status = 'running'; job.runId = runId; await this.save(job);
    return { context: bundle.context, engine: this.config.assistant!.engine, model: this.config.assistant?.model,
      effort: this.config.assistant?.effort, schema: assistantOutputSchema };
  }
  async result(jobId: string, runId: string, value: unknown, usage: unknown, actor: WorkspaceActor) {
    let job = await this.owned(jobId, runId, actor);
    if (job.status === 'completed') return job;
    const task = this.store.get(job.taskId), state = await this.workspaces.state(task), bundle = await this.bundle(task, job);
    if (job.status !== 'running' || !state.delegation?.enabled || state.delegation.jobId !== job.id || bundle.basis !== job.basis
      || ['running', 'unknown', 'handoff_pending', 'accepted'].includes(task.phase)) {
      if (job.status !== 'cancelling') job.status = 'stale'; delete job.output; await this.save(job); return { stale: true };
    }
    const output = validateAssistantOutput(value, [...bundle.context.sources, ...bundle.context.checkpoints, ...bundle.context.missing].map(s => s.id));
    verifyEvidenceQuotes(output.evidenceQuotes, [...bundle.context.sources, ...bundle.context.checkpoints]);
    if (output.knowledge && !output.evidenceQuotes.length) throw new Error('没有核验的资料引用，不能生成知识候选');
    const full = state.context?.fullSources ?? [];
    const expansion = output.contextGaps.filter(g => g.kind === 'coverage').flatMap(g => g.sourceIds)
      .filter(id => !full.includes(id) && [...bundle.context.sources, ...bundle.context.checkpoints].some(s => s.id === id && (s.truncated || s.truncatedMessages) && ['knowledge', 'note', 'conversation', 'checkpoint'].includes(s.kind)));
    if (job.mode === 'advance' && full.length < 2 && expansion.length) {
      for (const id of [...new Set(expansion)].slice(0, 2 - full.length)) await this.taskContext.expand(task.id, id, { admin: false, agent: task.agent });
      job.status = 'stale'; await this.save(job); await this.pc.patch('/issues/' + job.id, { status: 'done' });
      return { expandedContext: true, morePreparationQueuedByNativeScheduler: true };
    }
    job.output = output; job.usage = usage; job.applied ??= {}; await this.save(job);
    // Missing sources allow a brief only. Prepared drafts never turn into approval or publication.
    if (job.mode === 'advance' && !bundle.context.missing.length) {
      const automated = { admin: true, automation: 'workspace-assistant:' + job.id };
      if ((output.checkpoint.trim() || output.workProducts.length) && !job.applied.checkpoint) {
        const text = [output.checkpoint, ...output.workProducts.map(p => '## ' + p.title + '\n\n' + p.body)].filter(Boolean).join('\n\n');
        job.applied.checkpoint = (await this.workspaces.checkpoint(task.id, text, automated, undefined, 'assistant:' + job.id, bundle.manifest)).id; await this.save(job);
      }
      if (output.knowledge && !job.applied.knowledge) {
        const k = output.knowledge;
        job.applied.knowledge = (await this.workspaces.propose(task.id, { key: 'knowledge-agent-' + job.id.replaceAll('-', '').slice(0, 22), title: k.title,
          domains: [this.workspaces.domain(task.agent)], kind: 'procedure', appliesTo: k.appliesTo,
          facts: Object.fromEntries(k.facts.map(f => [f.name, f.value])), body: k.body,
          sources: [...new Set(output.evidenceQuotes.map(q => { const s = [...bundle.context.sources, ...bundle.context.checkpoints].find(s => s.id === q.sourceId)!;
            return this.config.paperclipUrl + '/SUI/issues/' + (s.nativeIssueId ?? s.id); }))] }, automated, 'assistant:' + job.id, bundle.manifest)).id;
        await this.save(job);
      }
    }
    job.status = 'completed'; await this.save(job);
    await this.pc.patch('/issues/' + job.id, { status: 'done' });
    await this.workspaces.save(this.store.get(task.id), await this.workspaces.state(this.store.get(task.id)), 'assistant-prepared', { jobId, preparedBy: this.key, mode: job.mode });
    return { completed: true, applied: job.applied };
  }
  async fail(jobId: string, runId: string, error: string, actor: WorkspaceActor) {
    const job = await this.owned(jobId, runId, actor);
    if (['completed', 'cancelled', 'stale'].includes(job.status)) return;
    job.status = 'failed'; job.error = error.slice(0, 600); await this.save(job);
    await this.pc.patch('/issues/' + job.id, { status: 'blocked' });
  }
  async cancel(taskId: string, actor: WorkspaceActor) {
    this.workspaces.manager(actor); const state = await this.workspaces.state(this.store.get(taskId));
    if (!state.delegation?.jobId) return;
    const job = await this.job(state.delegation.jobId), issue = await this.workspaces.issue(job.id);
    if (!['queued', 'running', 'cancelling'].includes(job.status)) return job;
    job.status = issue.executionRunId ? 'cancelling' : 'cancelled'; delete job.output; await this.save(job);
    if (issue.executionRunId && !this.cancellations.has(issue.executionRunId)) {
      // Keep API responses and the receipt lane available while the native scheduler
      // stops its child. The durable 'cancelling' job is retried after connection loss.
      const id = issue.executionRunId;
      const pending = this.pc.post('/heartbeat-runs/' + id + '/cancel', {})
        .catch(error => this.store.audit('assistant.cancel-pending', job.taskId, { jobId: job.id, error: String(error).slice(0, 300) }))
        .finally(() => this.cancellations.delete(id));
      this.cancellations.set(id, pending);
    }
    else await this.pc.patch('/issues/' + job.id, { status: 'cancelled' });
    return job;
  }
  async reconcile(jobId: string) {
    const job = await this.job(jobId);
    if (!['queued', 'running', 'cancelling'].includes(job.status)) return job;
    const issue = await this.workspaces.issue(job.id);
    if (issue.executionRunId) return job;
    const runs = await this.pc.get<any[]>('/companies/' + this.config.companyId + '/heartbeat-runs?agentId=' + this.config.agents[this.key]!.paperclipId + '&limit=100');
    const relevant = runs.filter(r => r.contextSnapshot?.issueId === job.id);
    if (relevant.some(r => !terminal.has(r.status))) return job;
    if (relevant.length) {
      job.status = job.status === 'cancelling' ? 'cancelled' : 'failed'; job.error = job.status === 'failed' ? '原生运行已结束，未留下可采用结果；可以重新整理' : undefined; await this.save(job);
    }
    return job;
  }
  async view(task: Task, actor: WorkspaceActor) {
    const state = await this.workspaces.state(task);
    if (!actor.admin && actor.agent !== task.agent) throw new Error('Unauthorized');
    if (!state.delegation?.jobId) return { enabled: state.delegation?.enabled ?? false, mode: state.delegation?.mode ?? 'advance', status: 'idle', engine: this.config.assistant?.engine ?? 'codex' };
    const job = await this.job(state.delegation.jobId), bundle = await this.bundle(task, job);
    const current = bundle.basis === job.basis && !['accepted', 'unknown', 'handoff_pending'].includes(task.phase);
    // Even a local human sees the result only with its current source dependencies. Native archive remains auditable.
    return { enabled: state.delegation.enabled, mode: state.delegation.mode, status: !current && job.status === 'completed' ? 'stale' : job.status,
      engine: this.config.assistant?.engine ?? 'codex', jobId: job.id, runId: job.runId, createdAt: job.createdAt,
      output: current && job.status === 'completed' ? job.output : undefined, applied: job.applied, error: job.error,
      evidenceSources: projectHistoricalEvidence(job.evidenceSources ?? [], bundle.context.sources), inputManifest: job.inputManifest, inputCoverage: job.inputCoverage };
  }
  async tick() {
    if (!this.available()) return;
    for (const task of this.store.list().filter(t => t.kind === 'collaboration')) {
      try {
        const state = await this.workspaces.state(task);
        if (!state.delegation?.jobId && !state.delegation?.enabled) continue;
        if (state.delegation?.jobId) {
          const job = await this.reconcile(state.delegation.jobId);
          if (job.status === 'cancelling' || ['queued', 'running'].includes(job.status) && (['accepted', 'unknown', 'handoff_pending'].includes(task.phase) || (await this.bundle(task, job)).basis !== job.basis)) await this.cancel(task.id, { admin: true });
        }
        await this.advance(task.id);
      } catch (error) { this.store.audit('assistant.reconciliation-blocked', task.id, { error: String(error).slice(0, 300) }); }
    }
  }
}
