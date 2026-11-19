import { key, type Engine, type Ticket } from '../../upstream/superagent/src/core/index.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import type { Agent, Project } from './config.ts';
import { WorkbenchError } from './errors.ts';
import type { Iterations } from './iterations.ts';
import type { AccessReader, KnowledgeEntry, KnowledgeRef, ProjectKnowledge } from './knowledge.ts';
import type { Assembled, Output, Work } from './work-types.ts';
import type { DevelopmentTarget } from './development.ts';
import { verifyDeliveryTopic, type DeliveryTemplate } from './delivery-template.ts';
import { freezeManualCases, type ProductVerification } from './product-verification.ts';
import type { DeliveryStages } from './delivery-stages.ts';

type RevisionPorts = {
  ticketFor: (id: string, actor: string) => { ticket: Ticket; work: Work; project: Project };
  mayStart: (project: Project, actor: string) => boolean;
  readAgent: (id: string) => Agent | undefined;
  readableOutput: (id: string) => Output | undefined;
  outputFor: (id: string) => Output | undefined;
  outputUsable: (id: string, output: Output) => boolean;
  currentConsultationKnowledge: (project: Project, ref: KnowledgeRef) => KnowledgeEntry | undefined;
  consultationAgents: (project: Project, topic: string, actor: string) => { agent: string }[];
  consultationEvidence: (project: Project, sources: Output['sources'], cited?: KnowledgeRef[]) =>
    { acceptedSource?: { ticket: string; revision: string } }[] | undefined;
  mandateCurrent: (ticket: Ticket) => boolean;
  isActive: (agent: Agent | undefined, project: Project) => agent is Agent;
  runsFor: (id: string) => { state: string }[];
  version: (agent: Agent) => string;
  selectDevice: (project: Project, agent: Agent, device: string) => string | undefined;
  manifestFor: (run: number) => Assembled | undefined;
  freezeTemplate?: (project: string, target: DevelopmentTarget) => DeliveryTemplate | undefined;
  product: ProductVerification['state'];
  stages: (ticket: Ticket, work: Work, output: Output, product: ReturnType<ProductVerification['state']>) => DeliveryStages | undefined;
  selectMaterials: (project: string, actor: string, ids: string[], preceding: Work) => string[];
  replacesRevokedSource: (project: Project, before: KnowledgeEntry, after: KnowledgeEntry) => boolean;
  saveWork: (id: string, work: Work) => unknown;
  closeAcceptance: (id: string) => void;
  closeDeliveryIssues: (id: string, output: Output) => void;
  accessReader: (work: Work) => AccessReader | undefined;
  requestAccess: (id: string, work: Work, entry: KnowledgeEntry, actor: string, reason: string) => unknown;
  askDevelopment: (id: string, work: Work) => unknown;
  audit: (id: string, kind: string, data: object) => void;
};

export function openTicketRevisions(store: Pick<SuperAgentStore, 'atomic' | 'tickets'>,
  engine: Pick<Engine, 'receive' | 'attach'>, iterations: Iterations,
  knowledge: Pick<ProjectKnowledge, 'current' | 'get' | 'usable'>, ports: RevisionPorts) {
  const { ticketFor, mayStart, readAgent, readableOutput, outputFor, outputUsable, currentConsultationKnowledge, consultationAgents,
    consultationEvidence, mandateCurrent, isActive, runsFor, version, selectDevice, manifestFor, freezeTemplate, selectMaterials, saveWork,
    replacesRevokedSource, closeAcceptance, closeDeliveryIssues, accessReader, requestAccess, askDevelopment, audit, product } = ports;

  function rechecksRevokedOutput(project: Project, actor: string, work: Work, prior: Output, ids: string[]) {
    const selected = selectMaterials(project.id, actor, ids, work);
    if (selected.length !== prior.sources.length) return false;
    const replacements = new Set(selected);
    let rotated = false;
    for (const ref of prior.sources) {
      const before = knowledge.get(ref.id, ref.revision);
      if (!before) return false;
      const next = [...replacements].find(id => {
        const after = knowledge.get(id);
        return !!after && (after.id === before.id && after.revision === before.revision
          || replacesRevokedSource(project, before, after));
      });
      if (!next) return false;
      replacements.delete(next);
      rotated ||= next !== before.id;
    }
    return rotated;
  }

  function revise(actor: string, id: string, input: { revision: string; reason: string; kind?: 'rejected' | 'continued' | 'rechecked'; material?: string[]; device?: string;
    consultation?: NonNullable<NonNullable<Work['continuation']>['consultation']>; knowledge?: KnowledgeRef;
    productCases?: { title: string; expectation: string }[] }) {
    const { ticket, work, project } = ticketFor(id, actor);
    if (actor !== work.requester || !mayStart(project, actor)) throw new WorkbenchError('由原发起人决定打回或开启下一版。', 403);
    const kind = input.kind ?? 'rejected';
    if (work.consultation) {
      if (!input.knowledge || work.consultation.private || work.consultation.feishu || work.consultation.octopIM || work.source !== 'web'
        || readAgent(work.agent)?.engine !== 'octop' || input.material || input.device || input.consultation || input.productCases || kind !== 'rejected')
        throw new WorkbenchError('工作台只读咨询修正必须指定一条知识，沿用原 Agent。', 409);
    } else if (input.knowledge) {
      throw new WorkbenchError('指定知识修正仅用于工作台只读咨询。', 409);
    }
    const existing = iterations.get(id, input.revision, kind);
    if (existing) return { version: existing.version + 1 };
    const readable = readableOutput(id);
    const recheck = kind === 'rechecked';
    const stored = recheck && !readable && !work.accepted && !work.development && !work.consultation && !input.consultation
      && !input.device && input.material?.length ? outputFor(id) : undefined;
    // Renewing source credentials does not make a prior result readable. Only its frozen source IDs are used for this decision.
    const output = recheck ? (stored?.revision === input.revision && ticket.ended?.outcome === 'completed'
      && rechecksRevokedOutput(project, actor, work, stored, input.material!) ? stored : undefined) : readable;
    if (!output || output.revision !== input.revision || ticket.ended?.outcome !== 'completed'
      || kind === 'rejected' && work.accepted || kind === 'continued' && !work.accepted)
      throw new WorkbenchError('请核对当前可读取的交付版本；已通过的版本应选择后续迭代。', 409);
    const requiredKnowledge = input.knowledge;
    if (requiredKnowledge && (!currentConsultationKnowledge(project, requiredKnowledge)
      || !output.sources.some(ref => ref.id === requiredKnowledge.id && ref.revision === requiredKnowledge.revision)
      || !work.topic || !consultationAgents(project, work.topic, actor).some(row => row.agent === work.agent)))
      throw new WorkbenchError('请选择本次咨询已经检索到且仍有效的项目知识。', 409);
    if (input.consultation) {
      const source = ticketFor(input.consultation.ticket, actor).work;
      const result = outputFor(input.consultation.ticket);
      if (!work.topic || !source.consultation || source.project !== project.id || source.topic !== work.topic
        || !result || !outputUsable(input.consultation.ticket, result)
        || source.octop && actor !== source.requester && actor !== readAgent(source.agent)?.owner
        || result.revision !== input.consultation.revision || !consultationEvidence(project, result.sources, result.cited)
          ?.some(ref => ref.acceptedSource?.ticket === id && ref.acceptedSource.revision === input.revision))
        throw new WorkbenchError('请选择引用本工单当前验收版本的同主题咨询。', 409);
    }
    const assigned = readAgent(work.agent);
    if (!mandateCurrent(ticket) || !isActive(assigned, project))
      throw new WorkbenchError('原委托或 Agent 已失效，请重新确认接单。', 409);
    if (runsFor(id).some(run => ['queued', 'claimed', 'unknown'].includes(run.state)))
      throw new WorkbenchError('须先确认旧执行停止。', 409);
    const agentVersion = version(assigned);
    let device = work.device;
    if (input.device) {
      if (work.development || assigned.owner !== actor || assigned.function !== work.function || manifestFor(output.run)?.actor?.owner !== actor)
        throw new WorkbenchError('仅原发起人自己的只读 Agent 可以在开下一版时选择新执行端。', 403);
      device = selectDevice(project, assigned, input.device);
    } else if (work.agentVersion !== agentVersion) {
      throw new WorkbenchError('Agent 配置已变化，请核对后选择本版的执行端。', 409);
    }
    const material = selectMaterials(work.project, actor, requiredKnowledge ? [requiredKnowledge.id] : input.material ?? work.material, work);
    return store.atomic(() => {
      const currentVersion = work.version ?? 1;
      if (work.accepted && !iterations.get(id, work.accepted.revision, 'accepted'))
        iterations.record(id, { version: currentVersion, ...work.accepted, kind: 'accepted', delivery: work.delivery, template: work.deliveryTemplate });
      const checks = product(id, output.revision, work, work.development ? work.delivery : undefined);
      iterations.record(id, { version: currentVersion, revision: output.revision, kind, actor, at: new Date().toISOString(),
        reason: input.reason, delivery: work.delivery, commit: work.delivery?.headSha, template: work.deliveryTemplate,
        product: checks, stages: readable && ports.stages(ticket, work, output, checks), topic: work.topic });
      const { accepted: _accepted, delivery: _delivery, handoff: _handoff, developmentOffer: _offer, developmentResponse: _response,
        localRetry: _retry, ...rest } = work;
      const marker = key('work-revision', id, output.revision);
      const recall = work.recall?.flatMap(ref => {
        const entry = knowledge.current(ref);
        return entry && material.includes(entry.id) ? [entry.id] : [];
      });
      const next: Work = { ...rest, material, recall, device, agentVersion, version: currentVersion + 1, continuation: { id: marker, reason: input.reason, actor,
        at: new Date().toISOString(), previous: output.revision, consultation: input.consultation,
        ...(recheck && { recheck: true as const }) },
        ...(work.consultation && requiredKnowledge && { consultation: { ...work.consultation, requiredKnowledge } }),
        ...(work.development && { approvalRequired: true, developmentApproval: undefined,
          deliveryTemplate: freezeTemplate?.(work.project, work.development) ?? work.deliveryTemplate }),
        ...(input.productCases && { productCases: freezeManualCases(input.productCases) }),
        reusedAcceptance: work.reusedAcceptance && material.includes(work.reusedAcceptance.id)
          && knowledge.current(work.reusedAcceptance.id)?.revision === work.reusedAcceptance.revision ? work.reusedAcceptance : undefined };
      verifyDeliveryTopic(next.deliveryTemplate, next.topic);
      saveWork(id, next);
      closeAcceptance(id);
      closeDeliveryIssues(id, output);
      for (const ref of next.material) {
        const entry = knowledge.get(ref);
        if (entry?.visibility === 'restricted' && !knowledge.usable(id, entry, accessReader(next)))
          requestAccess(id, next, entry, actor, '原发起人要求第 ' + next.version + (recheck ? ' 版重新核对' : ' 版修改') + '，请核对本版执行访问');
      }
      // Attach through the native Engine to exactly this ticket. Reusing a shared IM thread
      // would fan the rejection out to other tickets subscribed to the same conversation.
      engine.receive({ id: marker, source: 'web', actor: { source: 'web', id: actor }, human: true, addressed: 'direct',
        threads: [{ source: 'web', id: marker }], at: next.continuation!.at, text: input.reason, meta: { project: work.project } });
      engine.attach(id, marker, '本工单下一版');
      const resumed = store.tickets.get(id)!;
      if (resumed.ended) throw new WorkbenchError('原工单未能接续。', 409);
      saveWork(id, { ...next, lane: id + ':' + resumed.assignments.at(-1)!.id });
      if (next.development) askDevelopment(id, next);
      audit(id, 'version.opened', { actor, version: currentVersion + 1, previous: output.revision, kind, reason: input.reason, consultation: input.consultation });
      return { version: currentVersion + 1 };
    });
  }

  return revise;
}
