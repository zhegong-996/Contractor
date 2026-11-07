import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.ts';
import { runtime } from './config.ts';
import { Paperclip } from './paperclip.ts';
import { Store, type Task } from './store.ts';
import { Github, type DeliveryAdapter, parsePr } from './github.ts';
import { feishuTrigger, readMessage, resultFrom } from './upstream.ts';
import{collaborationReviewPolicyFor}from'./workspaces.ts';
import{planForTask,lockPlan,readPlan,type VerificationLevel}from'./acceptance-plan.ts';
import{verifyAcceptanceGate,evaluateRound,writeRound,readRound,toAcceptanceCases,type ItemEvidence}from'./acceptance-round.ts';
import{USER_HELP,CONFIRM_ACCEPT,parseUserCommand}from'./user-language.ts';
import{fromWorkerJournal,fromDelivery,capture}from'./event-stream.ts';
import{TraceBridge,type TraceInput}from'./trace-bridge.ts';
import{acceptanceChainEnabled,reviewerIdFor,type VisualArtifact}from'./visual-review.ts';
import{assertReviewerCapable}from'./independent-review.ts';
import { getRouter } from './router.ts';
import { recordMemory } from './memory-log.ts';
import type { V06Services } from './v06.ts';

/**
 * Business acceptance items are declared in the originating IM message as
 * `验收：A；B`. Chinese messages commonly attach it to the previous sentence
 * with no whitespace (`…方案。验收：…`), which the old `\s` guard missed and
 * silently replaced with the generic "符合任务要求" item. Keep the extraction
 * in one pure function so the sealed plan always reflects what the human asked.
 */
export function businessAcceptanceFrom(text: string): string[] {
  const line = /(?:^|[\s。；;，,、])验收[:：]\s*(.+)$/m.exec(text)?.[1];
  const items = line ? line.split(/[；;]/).map(s => s.trim()).filter(Boolean).slice(0, 12) : [];
  return items.length ? items : ['符合任务要求'];
}

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
  readonly github: DeliveryAdapter;
  readonly trace: TraceBridge;
  /** v0.6 functional layer, injected by the server after construction. */
  v06?: V06Services;
  constructor(readonly config: Config, readonly store: Store, delivery: DeliveryAdapter = new Github(config)) {
    this.pc = new Paperclip(config.paperclipUrl); this.github = delivery;
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
    const parsed = parseUserCommand(text);
    let result: unknown; let routedTaskId: string | undefined;
    if (!parsed) return { ignored: true, help: USER_HELP };
    if (parsed.action === 'task') {
      if (!parsed.detail) return { ignored: true, help: USER_HELP };
      const task = await this.createTask({ triggerId: trigger.id, chatId, messageId: String(trigger.meta.messageId), senderId: trigger.actor.id,
        agent: parsed.agent ?? this.config.defaultAgent, text: parsed.detail }); result = { task }; routedTaskId = task.id;
    } else {
      if (!parsed.taskId) return { ignored: true, help: USER_HELP };
      const task = this.store.get(parsed.taskId);
      routedTaskId = task.id;
      if (task.senderId !== trigger.actor.id || task.chatId !== chatId) throw new Error('只有原发起人在原会话可以操作这个任务');
      const detail = parsed.detail;
      this.store.audit('user.command', task.id, { action: parsed.action, legacySyntax: parsed.fromLegacySyntax });
      if (parsed.action === 'reply') result = await this.reply(task.id, detail, trigger.id);
      else if (parsed.action === 'handoff') result = await this.handoff(task.id, detail.trim());
      else if (parsed.action === 'accept') {
        // 开工前锁了清单 + 独立评审已通过 → 按清单逐项确认（本版产品化路径）；
        // 否则沿用已验证的「代码交付 + 发起人核可」流程，红线不变。
        let sealed: Awaited<ReturnType<typeof readPlan>> = null;
        try { sealed = await readPlan(this.pc, task.id); } catch { sealed = null; }
        if (sealed && acceptanceChainEnabled(this.config)) {
          result = await this.confirmAcceptance(task.id, trigger.actor.id, trigger.id);
        } else {
          const [sha] = detail.split(/\s+/);
          // 中文指令不能把用户丢给一句英文底层校验错误：旧流程仍要核对
          // CI 与部署版本，所以缺交付提交号时给出可照做的中文指引。
          if (!sha) throw new Error('这是代码交付类任务，请附上交付提交号后再确认验收：「确认验收 任务编号 交付提交号」。系统需要核对 CI 与部署版本；按开工前锁定清单逐项评审的任务不需要提交号。');
          const required: string[] = JSON.parse(task.context).businessAcceptance ?? ['符合任务要求'];
          result = await this.accept(task.id, sha, required.map(name => ({ name, passed: true })), trigger.actor.id, trigger.id);
        }
      } else if (parsed.action === 'reject') {
        if (!detail.trim()) throw new Error('请写明验收不通过的原因，便于只退回未通过的检查项');
        result = await this.reply(task.id, `验收不通过：${detail}`, trigger.id);
      } else { await this.sync(task.id); result = this.store.get(task.id); }
    }
    // 入口路由决策与其它四个派活点写同一份 Trace；记录失败不改变任何业务结果。
    if (routedTaskId) getRouter().route({
      taskId: routedTaskId, stage: 'intake',
      caller: { actor: trigger.actor.id, role: 'personal', source: 'superagent-trigger' },
      target: { role: 'worker', ...(parsed.action === 'task' ? { agentKey: parsed.agent ?? this.config.defaultAgent } : {}) },
      basis: { kind: 'user-command', evidence: [trigger.id, parsed.action], policyVersion: 'user-language-v1' },
      scope: { visibility: 'private' },
      ...(parsed.action === 'accept' ? { requiresHumanSignature: true, signatureReason: '最终业务验收只能由原发起人在原会话确认' } : {}),
      causedBy: trigger.id, idempotencyKey: 'intake:' + trigger.id,
    });
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
    const businessAcceptance = businessAcceptanceFrom(input.text);
    const context = JSON.stringify({ schemaVersion: 1, taskId: issue.id, identifier: issue.identifier, request: input.text,
      repository: this.config.repository, baseSha: prepared.baseSha, allowedPaths: this.config.allowedPaths,requesterUserId:input.requesterUserId,
      businessAcceptance, systemAcceptance: ['指定提交 CI 通过', '预览版本与交付提交一致'],
      source: { system: input.messageId.startsWith('om_') ? 'feishu' : 'local-api-test', messageId: input.messageId }, checkpoints: [], decisions: [] }, null, 2);
    const task: Task = { id: issue.id, identifier: issue.identifier, triggerId: input.triggerId, chatId: input.chatId,
      messageId: input.messageId, senderId: input.senderId, agent: input.agent, workspace: prepared.workspace, branch: prepared.branch,
      generation: 1, phase: 'ready', context };
    this.store.save(task);
    await this.pc.document(task.id, 'handoff', '任务交接包', `版本：1\n\n\`\`\`json\n${context}\n\`\`\``);
    // v0.6 P3: the FR-16~19 chain is opt-in via acceptance.mode=independent
    // (or the old sealPlanOnCreate switch). An independent vision-capable
    // reviewer is registered in that mode, and /accept auto-runs the review,
    // so sealing a plan never leaves the originator with an impossible /accept.
    if (acceptanceChainEnabled(this.config)) {
      try { await this.sealAcceptancePlan(task.id, input.requesterUserId ?? input.senderId ?? 'local-board'); }
      catch (error) { this.store.audit('acceptance.plan-lock-failed', task.id, { reason: String(error) }); }
    }
    await mkdir(runtime('tasks', task.id), { recursive: true });
    await writeFile(runtime('tasks', task.id, 'context.json'), context, { mode: 0o600 });
    this.store.notify(`intake:${task.id}`, task.id, `已接单：${task.identifier}，交给${agent.name}。\n[任务](${this.config.paperclipUrl}/${task.identifier.split('-')[0]}/issues/${task.identifier})`);
    await this.pc.patch(`/issues/${task.id}`, { status: 'todo' });
    this.store.audit('task.created', task.id, { agent: input.agent, baseSha: prepared.baseSha });
    getRouter().route({
      taskId: task.id, stage: 'dispatch',
      caller: { actor: input.senderId, role: 'personal', source: input.messageId.startsWith('om_') ? 'superagent-trigger' : 'human' },
      target: { role: 'worker', agentKey: input.agent },
      basis: { kind: 'user-command', evidence: ['message:' + input.messageId, `${businessAcceptance.length} 条业务验收项`] },
      scope: { allowedPaths: this.config.allowedPaths, visibility: 'private' },
      causedBy: input.triggerId, idempotencyKey: 'dispatch:' + input.triggerId,
    });
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
    getRouter().route({
      taskId: task.id, stage: 'transfer',
      caller: { actor: task.senderId, role: 'personal', source: 'human' },
      target: { role: 'worker', agentKey: next },
      basis: { kind: 'transfer', evidence: ['generation:' + task.generation,
        'prior:' + ((JSON.parse(checkpoint) as { priorAgent?: string }).priorAgent ?? 'unknown')], policyVersion: 'handoff-v1' },
      scope: { allowedPaths: this.config.allowedPaths, visibility: 'private' },
      causedBy: task.id + ':g' + task.generation,
    });
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
    await this.pc.document(task.id, 'delivery', '代码交付（本机 Git）', JSON.stringify(task.delivery, null, 2));
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
    if (JSON.stringify(old) !== JSON.stringify(task.delivery)) await this.pc.document(task.id, 'delivery', '代码交付（本机 Git）', JSON.stringify(task.delivery, null, 2));
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
    // v0.6: when the independent chain is on, produce the per-item review
    // automatically if it is missing. It is evidence for the human, never an
    // approval; a blocked round still stops /accept with a concrete reason.
    if (acceptanceChainEnabled(this.config)) {
      let existing: unknown = null;
      try { existing = await readRound(this.pc, id); } catch { existing = null; }
      if (!existing) {
        try { await this.runIndependentReview(id); }
        catch (error) { this.store.audit('acceptance.auto-review-failed', id, { reason: String(error).slice(0, 300) }); }
      }
    }
    const gate = await verifyAcceptanceGate({ pc: this.pc, taskId: id, cases });
    const receipt = { acceptedAt: new Date().toISOString(), actor, commit: sha, environment: current.delivery!.environment, cases,
      evidenceReview: gate.status === 'verified'
        ? { status: 'verified', level: gate.plan?.level, round: gate.round?.round, gaps: gate.gaps }
        : { status: 'waived', reason: gate.reason } };
    await this.pc.document(task.id, 'acceptance', '逐项验收', JSON.stringify(receipt, null, 2));
    await this.pc.document(task.id, 'decisions', '已采用结论', `本任务在 ${receipt.environment} 的 ${sha} 版本通过所列验收。\n\n仅适用于本任务及所列用例；不代表生产发布或其他功能通过。`);
    await this.pc.patch(`/issues/${task.id}`, { status: 'done' });
    current.phase = 'accepted'; this.store.save(current); this.store.audit('task.accepted', task.id, receipt);
    recordMemory({ kind: 'acceptance-recorded', actor,
      payload: { taskId: id, mode: 'code-delivery', sha, cases: cases.map(c => c.name) },
      idempotencyKey: 'accept:' + id + ':' + sha });
    await this.trace.flush(id, current.agent);
    await this.trace.append(id, capture({
      taskId: id, at: new Date().toISOString(), kind: 'acceptance', actor,
      provenance: 'originator', evidenceKind: 'authored', checkpoint: sha,
      outcome: 'accepted', refs: cases.map(c => c.name),
    }));
    this.store.notify(`accept:${eventId}`, task.id, `${task.identifier} 已记录验收通过，版本和验收证据已归档。`);
    return receipt;
  }
  /**
   * 产品化的最终核可：按「开工前锁定的清单 + 独立逐项评审报告」确认验收。
   * 与代码交付验收（accept）并列，不要求 CI / commit，也绝不冒充部署环境。
   * 身份必须是原发起人；清单版本、评审者、逐项判定由 verifyAcceptanceGate 复核。
   */
  async confirmAcceptance(id: string, actor: string, eventId: string) {
    const task = this.store.get(id);
    const context = JSON.parse(task.context);
    if (context.requesterUserId && context.requesterUserId !== actor) throw new Error('只有原发起人可以确认验收');
    const sealed = await readPlan(this.pc, id);
    if (!sealed) throw new Error('本任务没有开工前锁定的验收清单，不能按清单确认验收');
    const round = await readRound(this.pc, id);
    if (!round) throw new Error('尚未完成独立逐项评审，不能确认验收');
    const cases = toAcceptanceCases(round, sealed.plan);
    const gate = await verifyAcceptanceGate({ pc: this.pc, taskId: id, cases });
    if (gate.status !== 'verified') throw new Error(`验收闸门未通过：${gate.reason ?? '证据不足'}`);
    const receipt = {
      confirmedAt: new Date().toISOString(), actor, mode: 'sealed-plan',
      planHash: sealed.plan.hash, planRevision: sealed.revision,
      reviewer: round.reviewer.model, round: round.round, cases,
      evidenceReview: { status: gate.status, level: gate.plan?.level, gaps: gate.gaps },
      environment: '工作台逐项评审（不是代码部署环境）',
      note: '本次核可由原发起人完成；独立评审报告只提供证据，不代替人签字',
    };
    await this.pc.document(task.id, 'acceptance', '逐项验收', JSON.stringify(receipt, null, 2));
    await this.pc.document(task.id, 'decisions', '已采用结论',
      `本任务由原发起人于 ${receipt.confirmedAt} 按开工前锁定清单确认验收。\n\n只适用于本任务所列检查项；不代表生产发布、其他功能或后续版本通过。\n\n证据缺口：${(gate.gaps ?? []).join('；') || '无'}`);
    await this.pc.patch(`/issues/${task.id}`, { status: 'done' });
    const current = this.store.get(id);
    current.phase = 'accepted'; this.store.save(current);
    this.store.audit('task.confirm-accepted', id, receipt);
    recordMemory({ kind: 'acceptance-recorded', actor,
      payload: { taskId: id, mode: 'sealed-plan', planHash: sealed.plan.hash, cases: cases.map(c => c.name) },
      idempotencyKey: 'confirm:' + id + ':' + sealed.plan.hash });
    await this.trace.append(id, capture({
      taskId: id, at: receipt.confirmedAt, kind: 'acceptance', actor,
      provenance: 'originator', evidenceKind: 'authored', checkpoint: CONFIRM_ACCEPT,
      outcome: 'accepted', refs: cases.map(c => c.name),
    }));
    this.store.notify(`confirm:${eventId}`, task.id,
      `${task.identifier} 已由原发起人${CONFIRM_ACCEPT}，逐项报告与证据已归档；未通过的检查项不会被算作通过。`);
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
      reviewerModel: reviewerIdFor(this.config),
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
  /**
   * v0.6 FR-16~19: run the registered independent reviewer against the sealed
   * plan and the real trace, then write the per-item round. The round is
   * evidence for the originator; only /accept closes the task.
   */
  async runIndependentReview(id: string, visualArtifacts: VisualArtifact[] = []) {
    const sealed = await readPlan(this.pc, id);
    if (!sealed) throw new Error('先锁定开工前验收清单，才能进行独立评审');
    const reviewer = this.v06?.reviewer;
    if (!reviewer) throw new Error('未注册独立评审者，不能生成逐项评审报告');
    const producerModel = sealed.plan.producerModel ?? '';
    assertReviewerCapable(reviewer, { producerModel, visualEvidenceRequired: true });
    if (reviewer.id !== sealed.plan.reviewer.model)
      throw new Error('注册的评审者与开工前锁定的清单不一致，本轮评审作废');
    const { events } = await this.trace.view(id);
    const result = await reviewer.review({ plan: sealed.plan, producerModel, events,
      visualArtifacts, visualEvidenceRequired: true });
    const report = evaluateRound({ plan: sealed.plan, reviewerModel: reviewer.id, producerModel,
      evidence: result.evidence, events, planRevision: sealed.revision });
    await writeRound(this.pc, report);
    // 打回原因沉淀为下次自查标准；只落本机 .runtime/v06，不改写已锁定的清单。
    try {
      const { recordSelfCheck } = await import('./acceptance-report.ts');
      recordSelfCheck(runtime('v06'), report, id);
    } catch (error) {
      this.store.audit('acceptance.self-check-failed', id, { reason: String(error).slice(0, 300) });
    }
    this.store.audit('acceptance.independent-review', id, { reviewer: reviewer.id,
      semanticJudgement: reviewer.capabilities.semanticJudgement ?? false,
      round: report.round, overall: report.overall, limitations: result.limitations });
    return { report, reviewer: reviewer.id, capabilities: result.capabilities, limitations: result.limitations,
      note: `报告只提供证据与逐项判定；最终核可仍由原发起人在原会话${CONFIRM_ACCEPT}` };
  }
  /** v0.6: best-effort append to the read-only trace projection. */
  async recordTraceEvent(id: string, event: TraceInput) { return this.trace.append(id, event); }
  /** v0.6: read-only trace view consumed by the existing workbench task detail. */
  async traceView(id: string) { return this.trace.view(id); }
}
export function stableUuid(value: string) {
  const h = createHash('sha256').update(value).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
