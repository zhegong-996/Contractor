import { key, type Engine, type Ticket } from '../../upstream/superagent/src/core/index.ts';
import type { Job } from './execution/protocol.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import type { ExecutionHub, Run } from './execution/contract.ts';
import type { Agent, Project } from './config.ts';
import type { Delegations } from './delegations.ts';
import type { DevelopmentTarget } from './development.ts';
import type { Device, Devices } from './devices.ts';
import { requireValue, WorkbenchError } from './errors.ts';
import { executionCapabilities } from './execution-capabilities.ts';
import type { HumanDecision } from './human-decisions.ts';
import { digest, type AccessReader, type KnowledgeEntry, type ProjectKnowledge } from './knowledge.ts';
import type { OctopResources } from './octop-resources.ts';
import type { ReceiptJournal } from './receipt-journal.ts';
import type { Assembled, ExecutionBlockKind, Output, Work } from './work-types.ts';

export const handingOff = (work: Work | undefined) => !!work?.handoff && !work.handoff.completedAt && !work.handoff.cancelledAt;

type HandoffPorts = {
  workOf: (id: string) => Work | undefined;
  saveWork: (id: string, work: Work) => unknown;
  ticketFor: (id: string, actor: string) => { ticket: Ticket; work: Work; project: Project };
  audit: (id: string, kind: string, data: object) => void;
  runsFor: (id: string) => (Run & { attempts: number })[];
  activeLane: (id: string) => string;
  cardsFor: (id: string) => { state: string }[];
  isActive: (agent: Agent | undefined, project: Project) => agent is Agent;
  version: (agent: Agent) => string;
  mayTakeDuty: (work: Work, agent: Agent) => boolean;
  selectAgent: (project: Project, topic: string | undefined, explicit: string) => Agent | undefined;
  selectDevice: (project: Project, agent: Agent, requested?: string, development?: boolean) => string | undefined;
  deviceAllowed: (device: Device, project: Project, agent: string) => boolean;
  maintain: (project: Project, actor: string) => boolean;
  mayStart: (project: Project, actor: string) => boolean;
  mandateCurrent: (ticket: Ticket) => boolean;
  developmentAuthorized: (work: Work, agent?: string) => boolean;
  authorizesDevelopment: (project: Project, target: DevelopmentTarget, actor: string) => boolean;
  askDevelopment: (id: string, work: Work, agent: string) => unknown;
  requestAccess: (id: string, work: Work, entry: KnowledgeEntry, actor: string, reason: string) => { id: string };
  needed: (id: string, work: Work) => boolean;
  accessReader: (work: Work) => AccessReader | undefined;
  ingest: (ticket: Ticket, work: Work, event: string, detail: string) => void;
  askHuman: (project: Project, input: Omit<HumanDecision, 'id' | 'member' | 'project' | 'openedAt' | 'closedAt'>) => unknown;
  clearExecutionDecisions: (id: string) => void;
  reportBlocked: (id: string, work: Work, reason: string, kind: ExecutionBlockKind) => void;
  outputFor: (ticket: string) => Output | undefined;
  readableOutput: (ticket: string) => Output | undefined;
  manifestFor: (run: number, attempt?: number) => Assembled | undefined;
  childResultsUsable: (manifest?: Assembled) => boolean;
  recoverDelegations: (ticket: Ticket, work: Work, project: Project, summary: Output, actor: string, request: string, reason: string) =>
    { version: number; waiting: string };
  requestReviewAccess: (actor: string, id: string, work: Work, output: Output, entry: KnowledgeEntry, reason: string) => unknown;
};

export function openHandoffs(deps: {
  store: Pick<SuperAgentStore, 'db' | 'tickets' | 'atomic'>;
  engine: Pick<Engine, 'report' | 'retryTicket'>;
  hub: Pick<ExecutionHub, 'cancel' | 'finish'>;
  devices: Pick<Devices, 'get'>;
  knowledge: Pick<ProjectKnowledge, 'get' | 'requests' | 'granted' | 'usable'>;
  octop: Pick<OctopResources, 'expert'>;
  receiptJournal: Pick<ReceiptJournal, 'isPending' | 'pendingLanes'>;
  delegations: Pick<Delegations, 'pending'>;
  projectById: ReadonlyMap<string, Project>;
  agentById: ReadonlyMap<string, Agent>;
}, ports: HandoffPorts) {
  const { store, engine, hub, devices, knowledge, octop, receiptJournal, delegations, projectById, agentById } = deps;
  const { workOf, saveWork, ticketFor, audit, runsFor, activeLane, cardsFor, isActive, version, selectAgent, selectDevice, deviceAllowed,
    maintain, mayStart, mandateCurrent, developmentAuthorized, authorizesDevelopment, askDevelopment, requestAccess, needed, accessReader,
    ingest, askHuman, clearExecutionDecisions, reportBlocked, outputFor, readableOutput, manifestFor, childResultsUsable,
    recoverDelegations, requestReviewAccess } = ports;

  function renewExecutionAccess(id: string, ticket: Ticket, work: Work, request: string) {
    if (ticket.ended || handingOff(work) || !runsFor(id).some(run => run.lane === activeLane(id))) return;
    const assignment = ticket.assignments.at(-1)!;
    const affected = knowledge.requests(id).find(item => item.id === request);
    const plan = { from: work.agent, to: work.agent, by: work.requester, reason: '资料访问已变化，等待停止旧执行并重新授权',
      assignment: assignment.id, cause: 'access' as const,
      runs: runsFor(id).filter(run => run.lane === activeLane(id) && ['claimed', 'unknown'].includes(run.state)).map(run => run.id),
      requestedAt: new Date().toISOString(), accessRequests: affected ? { [affected.entry]: request } : {} };
    saveWork(id, { ...work, handoff: plan });
    store.db.prepare('INSERT OR IGNORE INTO workbench_handoff VALUES (?)').run(id);
    audit(id, 'access.recovery-requested', { request, ...plan });
  }

  function confirmOldStop(id: string, run: number, evidence: 'worker' | 'not-launched' | 'remote-runner') {
    const work = workOf(id);
    if (!handingOff(work) || !work!.handoff!.runs.includes(run)) return;
    const seen = store.db.prepare("SELECT 1 FROM workbench_audit WHERE ticket=? AND kind='handoff.old-exited' AND value ->> '$.run'=?").get(id, run);
    if (!seen) audit(id, 'handoff.old-exited', { run, evidence });
  }

  function cancelUnstarted(job: Job, id: string, summary: string) {
    confirmOldStop(id, job.run, 'not-launched');
    hub.finish(job.run, job.token, { outcome: 'cancelled', summary });
  }

  function advanceHandoff(id: string) {
    const ticket = store.tickets.get(id);
    const work = workOf(id);
    const plan = work?.handoff;
    if (!ticket || !work || !plan || !handingOff(work) || work.developmentResponse) return;
    if (plan.runs.some(run => receiptJournal.isPending(run))) return;
    const oldRuns = runsFor(id).filter(run => run.lane === activeLane(id));
    for (const run of oldRuns)
      if (run.state === 'queued' || run.state === 'claimed' && !run.cancel_at) hub.cancel(run.id);
    const proofs = new Set(store.db.prepare("SELECT value ->> '$.run' AS run FROM workbench_audit WHERE ticket=? AND kind='handoff.old-exited'")
      .all(id).map(row => Number(row.run)));
    if (oldRuns.some(run => ['claimed', 'unknown'].includes(run.state))
      || plan.runs.some(id => !proofs.has(id) || !oldRuns.some(run => run.id === id && run.state === 'cancelled'))) {
      if (oldRuns.some(run => run.state === 'unknown'))
        askHuman(projectById.get(work.project)!, { kind: 'blocked', subject: id + ':' + plan.runs[0],
          title: '交接等待旧执行端恢复连接', detail: '请检查旧执行端。收到停止回执后才会安排接续。', ticket: id });
      return;
    }
    if (ticket.ended) {
      store.atomic(() => {
        saveWork(id, { ...work, handoff: { ...plan, cancelledAt: new Date().toISOString() } });
        store.db.prepare('DELETE FROM workbench_handoff WHERE ticket=?').run(id);
      });
      return;
    }
    const project = projectById.get(work.project)!;
    const replacement = agentById.get(plan.to);
    const canResume = mayStart(project, plan.by)
      && (plan.by === work.requester || maintain(project, plan.by) || agentById.get(work.agent)?.owner === plan.by);
    if (!(plan.cause === 'resume' ? canResume : plan.cause === 'access' ? mayStart(project, plan.by) : maintain(project, plan.by))
      || !mandateCurrent(ticket) || !isActive(replacement, project) || !ports.mayTakeDuty(work, replacement)
      || work.development && (!authorizesDevelopment(project, work.development, replacement.owner) || !executionCapabilities(replacement).code)) {
      const reason = '交接条件已变化，请维护人核对资料授权和接续 Agent。';
      if (ticket.assignments.at(-1)?.report?.summary !== reason) reportBlocked(id, work, reason, 'authority-changed');
      return;
    }
    const chosenDevice = plan.device !== undefined ? plan.device ?? undefined : plan.from === plan.to ? work.device : undefined;
    const replacementDevice = chosenDevice && devices.get(chosenDevice);
    if (replacement.execution?.kind === 'remote' && (!replacementDevice || !replacementDevice.active
      || !deviceAllowed(replacementDevice, project, replacement.id))) {
      const reason = '接续的远程执行端已失效，请重新选择。';
      if (ticket.assignments.at(-1)?.report?.summary !== reason) reportBlocked(id, work, reason, 'execution-endpoint');
      return;
    }
    if (!developmentAuthorized(work, replacement.id)) {
      askDevelopment(id, work, replacement.id);
      engine.report(id, { state: 'waiting', summary: '旧执行已停止，等待接替研发确认代码委托' });
      return;
    }
    const replacementWork = { ...work, agent: replacement.id, agentVersion: version(replacement), function: replacement.function };
    if (needed(id, replacementWork)) {
      const accessRequests = { ...plan.accessRequests };
      const reader = accessReader(replacementWork)!;
      const requests = knowledge.requests(id);
      for (const ref of work.material) {
        const entry = knowledge.get(ref);
        const existing = requests.find(request => request.id === accessRequests[ref]);
        // A request for another document, version or reader cannot stand in for this one.
        // Preserve a matching revoked request until the requester explicitly reapplies.
        const matches = existing && existing.entry === ref && existing.revision === entry?.revision
          && existing.readerAgent === reader.agent && existing.readerOwner === reader.owner;
        if (entry?.visibility === 'restricted' && !matches && !knowledge.usable(id, entry, reader))
          accessRequests[ref] = requestAccess(id, replacementWork, entry, plan.by, '原执行端已停止，交接至新的 Agent 前重新申请资料访问').id;
      }
      if (digest(accessRequests) !== digest(plan.accessRequests ?? {}))
        saveWork(id, { ...work, handoff: { ...plan, accessRequests } });
      const reason = '旧执行端已停止，等待资料负责人授权接续 Agent';
      if (ticket.assignments.at(-1)?.report?.summary !== reason)
        engine.report(id, { state: 'waiting', summary: reason, question: null });
      return;
    }
    if (plan.cause === 'access') {
      store.atomic(() => {
        const accessRequests = Object.fromEntries(work.material.flatMap(ref => {
          const entry = knowledge.get(ref);
          const grant = entry && knowledge.granted(id, entry, accessReader(replacementWork));
          return grant ? [[ref, grant.id]] : [];
        }));
        const restored = { ...work, handoff: { ...plan, accessRequests, completedAt: new Date().toISOString() } };
        saveWork(id, restored);
        // Retain unanswered cards in the native lane; the next run gets a fresh CLI session.
        ingest(ticket, restored, key('access-restored', id, plan.requestedAt), '资料已重新授权，按原委托接续。');
        engine.report(id, { state: cardsFor(id).some(card => card.state === 'open') ? 'waiting' : 'progress',
          summary: cardsFor(id).some(card => card.state === 'open') ? '资料已重新授权，继续等待必答事项' : '资料已重新授权，准备接续' });
        audit(id, 'access.recovery-completed', { request: accessRequests, stoppedRuns: plan.runs });
        store.db.prepare('DELETE FROM workbench_handoff WHERE ticket=?').run(id);
      });
      return;
    }
    if (cardsFor(id).some(card => card.state === 'open')) {
      // Older persisted handoff plans may predate the intake check below.
      saveWork(id, { ...work, handoff: { ...plan, cancelledAt: new Date().toISOString() } });
      store.db.prepare('DELETE FROM workbench_handoff WHERE ticket=?').run(id);
      engine.report(id, { state: 'waiting', summary: '仍有必答事项，请答复后重新申请交接' });
      return;
    }
    clearExecutionDecisions(id);
    store.atomic(() => {
      engine.report(id, { state: 'blocked', summary: '旧执行端已停止，准备在原单接续', question: null });
      const next = engine.retryTicket(id).assignments.at(-1)!;
      const completedAt = new Date().toISOString();
      saveWork(id, { ...work, agent: replacement.id, agentVersion: version(replacement), function: replacement.function, device: chosenDevice,
        lane: id + ':' + next.id, handoff: { ...plan, completedAt } });
      audit(id, 'handoff.completed', { from: plan.from, to: plan.to, stoppedRuns: plan.runs, previousAssignment: plan.assignment, assignment: next.id });
      store.db.prepare('DELETE FROM workbench_handoff WHERE ticket=?').run(id);
    });
  }

  function handoff(actor: string, id: string, input: { agent: string; reason: string; device?: string }) {
    const { ticket, work, project } = ticketFor(id, actor);
    if (receiptJournal.pendingLanes().has(activeLane(id))) throw new WorkbenchError('本轮回执正在补写，结清后才能交接。', 409);
    if (work.agent !== input.agent && (octop.expert(work.agent) || octop.expert(input.agent)))
      throw new WorkbenchError('Octop 共享专家需要以本人的新委托确认技能范围。', 409);
    if (work.consultation) throw new WorkbenchError('咨询按主题中指定的 Agent 执行。', 409);
    if (!maintain(project, actor)) throw new WorkbenchError('由项目维护人决定执行交接。', 403);
    if (work.handoff?.completedAt && work.handoff.to === input.agent && work.handoff.reason === input.reason) return work.handoff;
    if (ticket.ended) throw new WorkbenchError('该工单的执行已结束。', 409);
    if (work.developmentResponse) throw new WorkbenchError('请先处理已退回的研发委托。', 409);
    if (cardsFor(id).some(card => card.state === 'open'))
      throw new WorkbenchError('仍有必答事项，请先由执行决策人答复，再交接 Agent。', 409);
    if (handingOff(work)) {
      if (work.handoff!.to === input.agent) return work.handoff!;
      const replacement = agentById.get(work.handoff!.to);
      if (isActive(replacement, project)) throw new WorkbenchError('正在等待旧执行的停止回执。', 409);
    }
    const replacement = selectAgent(project, work.topic, input.agent);
    if (replacement && !ports.mayTakeDuty(work, replacement))
      throw new WorkbenchError('请选原委托职责下、具备当前项目授权的 Agent。', 409);
    if (work.personal && (replacement?.kind !== 'personal' || replacement.owner !== work.requester))
      throw new WorkbenchError('个人代办仅由自己的个人 Agent 接续。', 403);
    if (!replacement || replacement.id === work.agent || input.agent === 'auto') throw new WorkbenchError('请选择本项目内另一位在岗 Agent。', 409);
    if (work.development && !executionCapabilities(replacement).code) throw new WorkbenchError('该工单需要支持代码执行的 Agent。', 409);
    const device = selectDevice(project, replacement, input.device, !!work.development);
    const assignment = ticket.assignments.at(-1)!;
    const runs = handingOff(work) ? work.handoff!.runs
      : runsFor(id).filter(run => run.lane === activeLane(id) && ['claimed', 'unknown'].includes(run.state)).map(run => run.id);
    const plan = { from: work.agent, to: replacement.id, by: actor, reason: input.reason,
      assignment: assignment.id, runs, requestedAt: new Date().toISOString(), device };
    store.atomic(() => {
      saveWork(id, { ...work, handoff: plan });
      store.db.prepare('INSERT OR IGNORE INTO workbench_handoff VALUES (?)').run(id);
      audit(id, 'handoff.requested', { ...plan });
    });
    return plan;
  }

  function resume(actor: string, id: string, input: { nonce: string; reason: string; version: number; baseSha?: string; device?: string | null }) {
    const { ticket, work, project } = ticketFor(id, actor);
    if (!mayStart(project, actor) || !(actor === work.requester || maintain(project, actor) || agentById.get(work.agent)?.owner === actor))
      throw new WorkbenchError('由发起人、执行 Agent 所有者或项目维护人接续。', 403);
    if (work.developmentResponse) throw new WorkbenchError('请先处理已退回的研发委托。', 409);
    const request = key('resume', id, actor, input.nonce);
    if (work.delegationRecovery?.request === request && work.delegationRecovery.from === input.version)
      return { version: work.version!, waiting: 'child-results' };
    if ((work.version ?? 1) !== input.version) throw new WorkbenchError('交付版本已变化，请刷新。', 409);
    if (delegations.pending(id, work.version ?? 1)) return { version: work.version ?? 1, waiting: 'child-results' };
    if (store.db.prepare("SELECT 1 FROM workbench_audit WHERE ticket=? AND kind='execution.resume-requested' AND value ->> '$.request'=?")
      .get(id, request)) return { version: work.version ?? 1, pending: handingOff(work) };
    if (ticket.ended) {
      const summary = outputFor(id);
      if (summary && ticket.ended.outcome === 'completed' && !work.accepted && !work.development
        && !input.baseSha && input.device === undefined && !childResultsUsable(manifestFor(summary.run, summary.attempt))) {
        if (work.requester !== actor && !maintain(project, actor)) throw new WorkbenchError('由发起人或项目维护人决定重新汇总。', 403);
        return recoverDelegations(ticket, work, project, summary, actor, request, input.reason);
      }
      if (ticket.ended.outcome === 'completed' && !work.accepted && outputFor(id) && !readableOutput(id)) {
        for (const ref of outputFor(id)!.sources) {
          const entry = knowledge.get(ref.id);
          if (entry?.visibility === 'restricted') requestReviewAccess(actor, id, work, outputFor(id)!, entry, input.reason);
        }
        return { version: work.version ?? 1, waiting: 'review-access' };
      }
      throw new WorkbenchError('执行已结束；已交付成果请使用下一版，人工停止的委托须另行立项。', 409);
    }
    if (handingOff(work)) {
      if (work.handoff!.cause === 'access') {
        const pending = { ...work, agent: work.handoff!.to };
        for (const ref of work.material) {
          const entry = knowledge.get(ref);
          if (entry?.visibility === 'restricted' && !knowledge.usable(id, entry, accessReader(pending)))
            requestAccess(id, pending, entry, actor, input.reason);
        }
        return { version: work.version ?? 1, waiting: 'execution-access', pending: true };
      }
      return { version: work.version ?? 1, pending: true };
    }
    if (needed(id, work)) {
      for (const ref of work.material) {
        const entry = knowledge.get(ref);
        if (entry?.visibility === 'restricted' && !knowledge.usable(id, entry, accessReader(work))) {
          const request = requestAccess(id, work, entry, actor, input.reason);
          renewExecutionAccess(id, ticket, workOf(id)!, request.id);
        }
      }
      return { version: work.version ?? 1, waiting: 'execution-access' };
    }
    if (cardsFor(id).some(card => card.state === 'open')) throw new WorkbenchError('请先答完本工单的必答事项。', 409);
    const lane = activeLane(id);
    if (receiptJournal.pendingLanes().has(lane)) return { version: work.version ?? 1, waiting: 'receipt' };
    const active = runsFor(id).filter(run => run.lane === lane);
    const changesExecution = input.baseSha || input.device !== undefined && (input.device ?? undefined) !== work.device;
    if (!changesExecution) {
      if (active.some(run => run.state === 'claimed' || (run.state === 'queued' && run.attempts === 0)))
        return { version: work.version ?? 1, waiting: 'execution' };
      if (work.executionBlock?.kind === 'model-unavailable' && work.executionBlock.lane === lane
        && active.some(run => run.state === 'queued' && run.id === work.executionBlock?.run))
        return { version: work.version ?? 1, waiting: 'model' };
    }
    if (input.baseSha && (!work.development || !authorizesDevelopment(project, work.development, actor)))
      throw new WorkbenchError('只有仓库交付成员可以确认新的 Git 基线。', 403);
    const assigned = requireValue(agentById.get(work.agent), '当前 Agent 已移除。', 409);
    const device = assigned.execution?.kind === 'remote'
      ? selectDevice(project, assigned, input.device === undefined ? work.device : input.device ?? undefined, !!work.development)
      : input.device ? selectDevice(project, assigned, input.device, !!work.development) : input.device;
    const continuation = { id: request, reason: input.reason, actor, at: new Date().toISOString(), ...(input.baseSha ? { baseSha: input.baseSha } : {}) };
    const plan = { from: work.agent, to: work.agent, by: actor, reason: input.reason, cause: 'resume' as const,
      assignment: ticket.assignments.at(-1)!.id, requestedAt: continuation.at, device,
      runs: runsFor(id).filter(run => run.lane === activeLane(id) && ['claimed', 'unknown'].includes(run.state)).map(run => run.id) };
    store.atomic(() => {
      saveWork(id, { ...work, continuation, handoff: plan });
      store.db.prepare('INSERT OR IGNORE INTO workbench_handoff VALUES (?)').run(id);
      audit(id, 'execution.resume-requested', { actor, request, version: work.version ?? 1, reason: input.reason });
    });
    return { version: work.version ?? 1, pending: true };
  }

  function advancePending() {
    for (const row of store.db.prepare('SELECT ticket FROM workbench_handoff ORDER BY rowid').all())
      advanceHandoff(String(row.ticket));
  }
  return { renewExecutionAccess, confirmOldStop, cancelUnstarted, advancePending, handoff, resume };
}
