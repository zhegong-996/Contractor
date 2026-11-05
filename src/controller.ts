import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { runtime } from './config.ts';
import { Paperclip } from './paperclip.ts';
import { Store, type Task } from './store.ts';
import { Github, parsePr } from './github.ts';
import { feishuTrigger, readMessage, resultFrom } from './upstream.ts';
import{collaborationReviewPolicyFor}from'./workspaces.ts';
import{planForTask,lockPlan,readPlan,type VerificationLevel}from'./acceptance-plan.ts';
import{verifyAcceptanceGate,evaluateRound,writeRound,type ItemEvidence}from'./acceptance-round.ts';
import{fromWorkerJournal,fromDelivery,capture}from'./event-stream.ts';
import{TraceBridge,type TraceInput}from'./trace-bridge.ts';
import type { V06Services } from './v06.ts';

export function validateAcceptance(task: Task, sha: string, cases: { name: string; passed: boolean }[]) {
  const d = task.delivery;
  if (!d || d.ci !== 'passed' || !d.deployedSha || sha !== d.headSha || sha !== d.deployedSha) throw new Error('Acceptance must target the deployed, CI-verified commit');
  if (!cases.length || cases.some(c => !c.name.trim() || c.passed !== true)) throw new Error('Every acceptance case must pass');
  const required: string[] = JSON.parse(task.context).businessAcceptance ?? ['符合任务要求'];
  if (new Set(cases.map(c => c.name)).size !== cases.length || required.some(name => !cases.some(c => c.name === name))) throw new Error('Every required business acceptance case must be recorded');
  if (!d.environment) throw new Error('Acceptance environment is missing');
}

export class Controller {
  readonly pc: Paperclip;
  readonly github: Github;
  readonly trace: TraceBridge;
  /** v0.6 functional layer, injected by the server after construction. */
  v06?: V06Services;
  constructor(readonly config: Config, readonly store: Store) {
    this.pc = new Paperclip(config.paperclipUrl); this.github = new Github(config);
    this.trace = new TraceBridge(this.pc, config, store);
  }
  async ingest(input: unknown) {
    const trigger = feishuTrigger(input, this.config.feishu.botId, this.config.feishu.appId);
    if (!trigger || !trigger.human || !trigger.addressed) return { ignored: true };
    if (!this.config.feishu.allowedSenders.includes(trigger.actor.id)) throw new Error('Sender is not authorized');
    const chatId = String(trigger.meta.chatId);
    if (this.config.feishu.allowedChats.length && !this.config.feishu.allowedChats.includes(chatId)) throw new Error('Chat is not authorized');
    const known = this.store.byTrigger(trigger.id); if (known) return { task: known, duplicate: true };
    const seen = this.store.db.prepare('SELECT state FROM events WHERE id=?').get(trigger.id) as { state: string } | undefined;
    if (seen?.state === 'done') return { duplicate: true };
    this.store.db.prepare('INSERT OR IGNORE INTO events(id,state,value) VALUES(?,?,?)').run(trigger.id, 'pending', JSON.stringify(input));
    const text = trigger.text.replace(/@[^\s]+\s*/g, '').trim();
    const match = /^(?:\/task|任务)\s+(?:\[([a-z][a-z0-9-]*)\]\s*)?([\s\S]+)$/.exec(text);
    let result: unknown;
    if (match) {
      const task = await this.createTask({ triggerId: trigger.id, chatId, messageId: String(trigger.meta.messageId), senderId: trigger.actor.id,
        agent: match[1] ?? this.config.defaultAgent, text: match[2]! }); result = { task };
    } else {
      const action = /^\/(status|reply|accept|reject|handoff)\s+(\S+)(?:\s+([\s\S]+))?$/.exec(text);
      if (!action) return { ignored: true, help: '发送 /task [codex] 任务内容；已有任务使用 /status、/reply、/accept、/reject、/handoff' };
      const task = this.store.get(action[2]!);
      if (task.senderId !== trigger.actor.id || task.chatId !== chatId) throw new Error('Only the task originator in its original chat can control it');
      const detail = action[3] ?? '';
      if (action[1] === 'reply') result = await this.reply(task.id, detail, trigger.id);
      else if (action[1] === 'handoff') result = await this.handoff(task.id, detail.trim());
      else if (action[1] === 'accept') {
        const [sha, ...note] = detail.split(/\s+/);
        const required: string[] = JSON.parse(task.context).businessAcceptance ?? ['符合任务要求'];
        result = await this.accept(task.id, sha ?? '', required.map(name => ({ name, passed: true })), trigger.actor.id, trigger.id);
      } else if (action[1] === 'reject') {
        if (!detail.trim()) throw new Error('Please describe the failed acceptance case');
        result = await this.reply(task.id, `验收未通过：${detail}`, trigger.id);
      } else { await this.sync(task.id); result = this.store.get(task.id); }
    }
    this.store.db.prepare('UPDATE events SET state=? WHERE id=?').run('done', trigger.id);
    return result;
  }
  async createTask(input: { triggerId: string; chatId: string; messageId: string; senderId: string; agent: string; text: string;requesterUserId?:string }) {
    const known = this.store.byTrigger(input.triggerId); if (known) return known;
    const agent = this.config.agents[input.agent];
    if (!agent?.enabled || !agent.paperclipId) throw new Error('Agent is not configured or enabled');
    if (!this.config.companyId || !this.config.projectId) throw new Error('Run setup first');
    const issue = await this.pc.post(`/companies/${this.config.companyId}/issues`, {
      idempotencyKey: input.triggerId, allowDuplicate: true, projectId: this.config.projectId, title: input.text.split('\n')[0]!.slice(0, 120),
      description: `${input.text}\n\n来源：${input.messageId.startsWith('om_') ? '飞书任务' : '本地 API 联调'}。Agent 回执、代码交付、部署和业务验收分别记录。`,
      status: 'backlog', assigneeAgentId: agent.paperclipId,...input.requesterUserId?collaborationReviewPolicyFor(input.requesterUserId):{},
    });
    const linked = this.store.list().find(t => t.id === issue.id);
    if (linked && linked.triggerId !== input.triggerId) throw new Error('Paperclip returned a task linked to a different source event');
    const prepared = await this.github.prepare(issue.id);
    const acceptanceLine = /(?:^|\s)验收[:：]\s*(.+)$/m.exec(input.text)?.[1];
    const businessAcceptance = acceptanceLine ? acceptanceLine.split(/[；;]/).map(s => s.trim()).filter(Boolean).slice(0, 12) : ['符合任务要求'];
    const context = JSON.stringify({ schemaVersion: 1, taskId: issue.id, identifier: issue.identifier, request: input.text,
      repository: this.config.repository, baseSha: prepared.baseSha, allowedPaths: this.config.allowedPaths,requesterUserId:input.requesterUserId,
      businessAcceptance, systemAcceptance: ['指定提交 CI 通过', '预览版本与交付提交一致'],
      source: { system: input.messageId.startsWith('om_') ? 'feishu' : 'local-api-test', messageId: input.messageId }, checkpoints: [], decisions: [] }, null, 2);
    const task: Task = { id: issue.id, identifier: issue.identifier, triggerId: input.triggerId, chatId: input.chatId,
      messageId: input.messageId, senderId: input.senderId, agent: input.agent, workspace: prepared.workspace, branch: prepared.branch,
      generation: 1, phase: 'ready', context };
    this.store.save(task);
    await this.pc.document(task.id, 'handoff', '任务交接包', `版本：1\n\n\`\`\`json\n${context}\n\`\`\``);
    // v0.6 P0: opt-in. Without an independent reviewer wired in, sealing a plan
    // here would make the originator's /accept impossible to satisfy.
    if (this.config.acceptance?.sealPlanOnCreate) {
      try { await this.sealAcceptancePlan(task.id, input.requesterUserId ?? input.senderId ?? 'local-board'); }
      catch (error) { this.store.audit('acceptance.plan-lock-failed', task.id, { reason: String(error) }); }
    }
    await mkdir(runtime('tasks', task.id), { recursive: true });
    await writeFile(runtime('tasks', task.id, 'context.json'), context, { mode: 0o600 });
    this.store.notify(`intake:${task.id}`, task.id, `已接单：${task.identifier}，交给${agent.name}。\n[任务](${this.config.paperclipUrl}/${task.identifier.split('-')[0]}/issues/${task.identifier})`);
    await this.pc.patch(`/issues/${task.id}`, { status: 'todo' });
    this.store.audit('task.created', task.id, { agent: input.agent, baseSha: prepared.baseSha });
    return task;
  }
  async reply(id: string, text: string, eventId: string) {
    if (!text.trim()) throw new Error('Reply is empty');
    const task = this.store.get(id);
    await this.pc.post(`/issues/${task.id}/comments`, { body: text, clientRequestId: stableUuid(eventId), resume: false });
    if (task.phase === 'running') return { appended: true };
    if (task.phase === 'unknown') throw new Error('Previous run must be reconciled before resuming');
    task.phase = 'ready'; delete task.lease; this.store.save(task);
    await this.pc.patch(`/issues/${task.id}`, { status: 'todo', assigneeAgentId: this.config.agents[task.agent]!.paperclipId, assigneeUserId: null });
    if (this.config.agents[task.agent]?.mode === 'managed') {
      const previous = task.runId ? await this.pc.get(`/heartbeat-runs/${task.runId}`) : null;
      if (previous && ['failed', 'cancelled'].includes(previous.status)) {
        await this.pc.post(`/issues/${task.id}/retry`, { idempotencyKey: stableUuid(eventId + ':retry'), observedRunId: task.runId });
      } else await this.pc.post(`/agents/${this.config.agents[task.agent]!.paperclipId}/wakeup`, {
        source: 'on_demand', triggerDetail: 'manual', reason: 'human_followup', payload: { issueId: task.id }, idempotencyKey: eventId,
      });
    }
    return { resumed: true };
  }
  async handoff(id: string, next: string) {
    const task = this.store.get(id); const agent = this.config.agents[next];
    if (!agent?.enabled || !agent.paperclipId) throw new Error('Target agent is unavailable');
    const issue = await this.pc.get(`/issues/${task.id}`);
    if (task.phase === 'running' || issue.executionRunId || issue.checkoutRunId || task.phase === 'unknown') throw new Error('Stop and reconcile the active execution before handoff');
    const checkpoint = JSON.stringify({ ...JSON.parse(task.context), priorAgent: task.agent, lastMessage: task.lastMessage,
      lastSession: task.session, branch: task.branch, generation: task.generation + 1 }, null, 2);
    await this.pc.document(task.id, 'handoff', '任务交接包', `\`\`\`json\n${checkpoint}\n\`\`\``);
    task.agent = next; task.generation++; task.context = checkpoint; task.phase = 'ready'; delete task.lease; delete task.session;
    this.store.save(task);
    await this.pc.patch(`/issues/${task.id}`, { assigneeAgentId: agent.paperclipId, assigneeUserId: null, status: 'todo' });
    this.store.audit('task.handoff', task.id, { next, generation: task.generation });
    return task;
  }
  async reconcile(id: string) {
    const task = this.store.get(id);
    if (!task.runId) throw new Error('No managed execution to reconcile');
    const run = await this.pc.get(`/heartbeat-runs/${task.runId}`);
    if (!['failed', 'cancelled', 'succeeded'].includes(run.status)) throw new Error('Execution has not terminated');
    let journal: { runtime?: string; round?: number; attempt?: number; pid?: number; session?: string; finished?: boolean; text?: string; cancelled?: boolean } | undefined;
    try { journal = JSON.parse(await readFile(runtime('tasks', task.id, `process-${task.runId}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (journal?.runtime === 'autoloop-worker' && !journal.finished) {
      try {
        const entry = JSON.parse(await readFile(runtime('autoloop-development', task.id, 'worker', 'runs', `${journal.round}-${journal.attempt}`, 'entry.json'), 'utf8'));
        journal.pid = entry.pid; journal.session = entry.session;
      } catch (error) { throw new Error('Autoloop execution outcome is unknown; inspect the retained worker journal before resuming'); }
      if (!journal.pid) throw new Error('Autoloop launch outcome is unknown; inspect before resuming');
    }
    if (journal?.pid) {
      let alive = false; try { process.kill(process.platform === 'win32' ? journal.pid : -journal.pid, 0); alive = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      if (alive) throw new Error('The previous Agent process may still be writing');
      if (!journal.session && !journal.finished) throw new Error('Execution outcome is unknown; inspect the retained workspace before resuming');
      task.session = journal.session ?? task.session;
      if (journal.text) task.lastMessage = journal.text;
    }
    if (!journal) throw new Error('No execution journal: inspect and resolve the original Paperclip recovery before resuming');
    const recovery = await this.pc.get(`/issues/${task.id}/recovery-actions`);
    for (const action of recovery.actions ?? []) {
      if (action.evidence?.runId !== task.runId || action.evidence?.automaticRecovery?.replay !== 'blocked') continue;
      await this.pc.post(`/issues/${task.id}/recovery-actions/resolve`, {
        actionId: action.id, outcome: 'restored', sourceIssueStatus: 'todo',
        resolutionNote: '已核对原执行终止、进程组退出，工作树和会话检查点保留；只允许从现有检查点继续。',
        executionReconciliation: { runId: task.runId, providerStopped: true, actionOutcome: 'mixed',
          outcomeEvidence: `Run ${task.runId} is ${run.status}; owned process group ${journal.pid} is absent. The saved session ${journal.session ?? 'none'} and task worktree are retained. No previous external action is replayed by reconciliation.` },
      });
    }
    delete task.lease; task.phase = 'waiting'; this.store.save(task);
    this.store.audit('run.reconciled', task.id, { runId: task.runId, state: run.status, processJournal: Boolean(journal) });
    return task;
  }
  async receipt(id: string, input: { receiptId: string; agent: string; lease: string; text: string; session?: string; runToken?: string }) {
    const task = this.store.get(id);
    const existing = this.store.db.prepare('SELECT issue_id,value FROM receipts WHERE id=?').get(input.receiptId) as { issue_id: string; value: string } | undefined;
    if (existing) { if (existing.issue_id !== task.id) throw new Error('Receipt belongs to another task'); return JSON.parse(existing.value); }
    if (task.agent !== input.agent || task.lease !== input.lease || task.phase !== 'running') throw new Error('Stale or foreign execution receipt');
    const actorPc = input.runToken ? new Paperclip(this.config.paperclipUrl, input.runToken, task.runId) : this.pc;
    if (this.config.agents[input.agent]?.mode === 'managed') {
      if (!input.runToken || !task.runId) throw new Error('Managed receipts require their run-scoped identity');
      const actor = await actorPc.get('/agents/me');
      if (actor.id !== this.config.agents[input.agent]!.paperclipId) throw new Error('Run identity does not match the assigned agent');
    }
    const reading = readMessage(input.text) as Record<string, any> | undefined;
    const parsed = resultFrom(reading, { session: input.session });
    if (parsed.problem) throw new Error(`Invalid upstream receipt: ${parsed.problem}`);
    if (parsed.result.events?.length || parsed.result.resolve?.length) throw new Error('This project does not grant arbitrary event emission or cross-task resolution');
    const nextPhase = parsed.result.ask?.length ? 'waiting' : parsed.result.outcome === 'failed' ? 'failed' : 'executed';
    await actorPc.post(`/issues/${task.id}/comments`, { body: input.text, clientRequestId: stableUuid(input.receiptId), resume: false });
    await actorPc.document(task.id, 'checkpoint', '执行检查点', `执行端：${task.agent}\n\n${input.text}`);
    if (parsed.result.ask?.length) {
      await actorPc.post(`/issues/${task.id}/interactions`, {
        kind: 'ask_user_questions', idempotencyKey: `autoloop-ask:${input.receiptId}`,
        title: parsed.result.ask[0]!.title, continuationPolicy: 'wake_assignee',
        payload: { version: 1, supersedeOnUserComment: true, questions: parsed.result.ask.map((question, index) => ({
          id: `q${index}`, prompt: question.title, helpText: question.text,
          selectionMode: 'single', required: true, allowOther: true,
          options: question.options.map((label, option) => ({ id: `o${option}`, label })),
        })) },
      });
    }
    await actorPc.patch(`/issues/${task.id}`, { status: nextPhase === 'waiting' || nextPhase === 'failed' ? 'blocked' : 'in_review',
      ...(nextPhase === 'executed' ? { assigneeAgentId: null, assigneeUserId: JSON.parse(task.context).requesterUserId??'local-board' } : {}),
      ...(nextPhase === 'failed' ? { unblockDescriptor: { owner: this.config.agents[input.agent]?.paperclipId ? { agentId: this.config.agents[input.agent]!.paperclipId } : 'board',
        action: parsed.result.error ?? '核对执行失败原因后恢复剩余步骤' } } : {}) });
    this.store.atomic(() => {
      task.session = input.session; task.lastMessage = input.text; task.phase = nextPhase; delete task.lease; this.store.save(task);
      if (parsed.result.ask?.length) this.store.notify(`ask:${input.receiptId}`, task.id, parsed.result.ask.map(q => `${q.title}\n${q.text}\n${q.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`).join('\n'));
      if (parsed.result.later?.length) this.store.audit('receipt.deferred-check', task.id, parsed.result.later);
      this.store.db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(input.receiptId, task.id, JSON.stringify(parsed.result));
    });
    await this.trace.append(task.id, fromWorkerJournal({
      taskId: task.id, agent: input.agent, session: input.session,
      usage: reading?.usage ?? reading?.sessionUsage, outcome: nextPhase,
      at: new Date().toISOString(),
    }));
    return parsed.result;
  }
  async publish(id: string) {
    const task = this.store.get(id); if (task.phase !== 'executed' && task.phase !== 'delivered') throw new Error('Task has no completed execution');
    task.delivery = await this.github.publish(task); task.phase = 'delivered'; this.store.save(task);
    await this.pc.document(task.id, 'delivery', 'GitHub 交付', JSON.stringify(task.delivery, null, 2));
    this.store.notify(`pr:${task.delivery.pr}:${task.delivery.headSha}`, task.id, `${task.identifier} 已提交，等待 CI。\n[查看 PR](${task.delivery.url})`);
    await this.trace.append(task.id, fromDelivery({
      taskId: task.id, sha: task.delivery.headSha, ci: task.delivery.ci ?? 'pending',
      pr: task.delivery.pr, environment: task.delivery.environment, at: new Date().toISOString(),
    }));
    return task.delivery;
  }
  async sync(id: string) {
    const task = this.store.get(id); if (!task.delivery) return task;
    const old = task.delivery; const current = await this.github.inspect(old.pr);
    task.delivery = current.headSha === old.headSha ? { ...old, ...current } : current;
    if (current.headSha !== old.headSha) { task.phase = 'delivered'; await this.pc.patch(`/issues/${task.id}`, { status: 'in_review' }); }
    this.store.save(task);
    if (current.headSha !== old.headSha) this.store.audit('delivery.changed', task.id, { previous: old.headSha, current: current.headSha });
    if (JSON.stringify(old) !== JSON.stringify(task.delivery)) await this.pc.document(task.id, 'delivery', 'GitHub 交付', JSON.stringify(task.delivery, null, 2));
    return task;
  }
  async preview(id: string) {
    const task = this.store.get(id); task.delivery = await this.github.preview(task); this.store.save(task);
    await this.pc.document(task.id, 'deployment', '预览部署版本', JSON.stringify(task.delivery, null, 2));
    this.store.notify(`preview:${task.delivery.deployedSha}`, task.id, `${task.identifier} 的 CI 已通过，可验收。\n[预览](${task.delivery.previewUrl})\n验收时请注明此版本：${task.delivery.deployedSha}`);
    await this.trace.append(task.id, fromDelivery({
      taskId: task.id, sha: task.delivery.deployedSha ?? task.delivery.headSha, ci: 'passed',
      pr: task.delivery.pr, environment: task.delivery.environment, at: new Date().toISOString(),
    }));
    return task.delivery;
  }
  async accept(id: string, sha: string, cases: { name: string; passed: boolean }[], actor: string, eventId: string) {
    const task = this.store.get(id);if(JSON.parse(task.context).requesterUserId&&JSON.parse(task.context).requesterUserId!==actor)throw new Error('Unauthorized: only the real requester can accept this delivery');
    // v0.6: only tasks carrying a cross-function Transfer get the extra check;
    // the previously verified originator-only journeys are untouched.
    const consistency = await this.v06?.acceptanceConsistency(id);
    if (consistency?.checked) this.store.audit('v06.acceptance-consistency-passed', id, consistency);
    await this.sync(id); const current = this.store.get(id);
    validateAcceptance(current, sha, cases);
    const gate = await verifyAcceptanceGate({ pc: this.pc, taskId: id, cases });
    const receipt = { acceptedAt: new Date().toISOString(), actor, commit: sha, environment: current.delivery!.environment, cases,
      evidenceReview: gate.status === 'verified'
        ? { status: 'verified', level: gate.plan?.level, round: gate.round?.round, gaps: gate.gaps }
        : { status: 'waived', reason: gate.reason } };
    await this.pc.document(task.id, 'acceptance', '逐项验收', JSON.stringify(receipt, null, 2));
    await this.pc.document(task.id, 'decisions', '已采用结论', `本任务在 ${receipt.environment} 的 ${sha} 版本通过所列验收。\n\n仅适用于本任务及所列用例；不代表生产发布或其他功能通过。`);
    await this.pc.patch(`/issues/${task.id}`, { status: 'done' });
    current.phase = 'accepted'; this.store.save(current); this.store.audit('task.accepted', task.id, receipt);
    await this.trace.flush(id, current.agent);
    await this.trace.append(id, capture({
      taskId: id, at: new Date().toISOString(), kind: 'acceptance', actor,
      provenance: 'originator', evidenceKind: 'authored', checkpoint: sha,
      outcome: 'accepted', refs: cases.map(c => c.name),
    }));
    this.store.notify(`accept:${eventId}`, task.id, `${task.identifier} 已记录验收通过，版本和验收证据已归档。`);
    return receipt;
  }
  /** v0.6: seal the acceptance criteria before execution starts. */
  async sealAcceptancePlan(id: string, lockedBy: string, level?: VerificationLevel) {
    const task = this.store.get(id);
    // FR-12: when a cross-function Transfer exists, the criteria must be
    // drafted by the target function owner, never by the grantee.
    const transfer = await this.v06?.transferView(id);
    const plan = planForTask(task, lockedBy, {
      level: level ?? this.config.acceptance?.level ?? 'L3',
      producerModel: this.config.agents[task.agent]?.model,
      reviewerModel: this.config.acceptance?.reviewerModel,
      ...(transfer && !transfer.consultationOnly ? { draftedBy: transfer.standardDraftedBy } : {}),
    });
    const revision = await lockPlan(this.pc, plan);
    if (transfer && !transfer.consultationOnly) await this.v06?.lockStandardForTransfer(id, plan);
    this.store.audit('acceptance.plan-locked', task.id, { hash: plan.hash, level: plan.level, items: plan.items.length, revision,
      ...(transfer ? { standardDraftedBy: transfer.standardDraftedBy } : {}) });
    return { plan, revision };
  }
  /** v0.6: an independent per-item review. Evidence for the originator, never an approval. */
  async recordAcceptanceRound(id: string, input: { reviewerModel: string; producerModel: string; evidence: Record<string, ItemEvidence>; round?: number }) {
    const task = this.store.get(id);
    const sealed = await readPlan(this.pc, task.id);
    if (!sealed) throw new Error('先锁定开工前验收清单');
    const { events } = await this.trace.view(task.id);
    const report = evaluateRound({
      plan: sealed.plan, reviewerModel: input.reviewerModel, producerModel: input.producerModel,
      evidence: input.evidence, events, round: input.round, planRevision: sealed.revision,
    });
    await writeRound(this.pc, report);
    this.store.audit('acceptance.round-recorded', task.id, { round: report.round, overall: report.overall,
      unresolved: report.judgements.filter(item => item.status !== 'passed').length });
    return report;
  }
  /** v0.6: best-effort append to the read-only trace projection. */
  async recordTraceEvent(id: string, event: TraceInput) { return this.trace.append(id, event); }
  /** v0.6: read-only trace view consumed by the existing workbench task detail. */
  async traceView(id: string) { return this.trace.view(id); }
}
export function stableUuid(value: string) {
  const h = createHash('sha256').update(value).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
