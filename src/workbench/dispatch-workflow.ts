import { key, type Engine, type Trigger } from '../../upstream/superagent/src/core/index.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import type { Agent, Project } from './config.ts';
import type { Delegation, Delegations } from './delegations.ts';
import type { DevelopmentTarget } from './development.ts';
import type { DeliveryTemplate } from './delivery-template.ts';
import { requireValue, WorkbenchError } from './errors.ts';
import { executionCapabilities } from './execution-capabilities.ts';
import { digest, type KnowledgeRef } from './knowledge.ts';
import { freezeManualCases } from './product-verification.ts';
import type { Measure } from './learning.ts';
import type { Expert, ExpertAuthority, OctopResources } from './octop-resources.ts';
import { projectResourceRef, resourceView, type ProjectResource, type ProjectTopic, type ResourceView } from './project-resources.ts';
import type { Start, Work } from './work-types.ts';

type IntakeChoice = { action: 'create'; agent?: string } | { action: 'dismiss' };
type DispatchPorts = {
  projectFor: (id: string, actor: string) => Project;
  mayStart: (project: Project, actor: string) => boolean;
  maintain: (project: Project, actor: string) => boolean;
  ticketFor: (id: string, actor: string) => { project: Project; work: Work };
  topicsFor: (project: Project) => ProjectTopic[];
  selectAgent: (project: Project, topic?: string, agent?: string, role?: string) => Agent | undefined;
  selectMaterials: (project: string, actor: string, ids: string[]) => string[];
  relatedMemory: (project: Project, query: string, exclude: string[], skipAcceptance: boolean) => { id: string }[];
  views: (project: Project) => ResourceView[];
  deliveryTargets: (project: Project) => ProjectResource[];
  canCheckout: (repository: string) => boolean;
  authorizesDevelopment: (project: Project, development: DevelopmentTarget, actor: string) => boolean;
  freezeTemplate?: (project: string, target: DevelopmentTarget) => DeliveryTemplate | undefined;
  acceptanceMemory: (project: Project, actor: string, topic: string, query: string, template?: DeliveryTemplate) => KnowledgeRef | undefined;
  lessonFor: (project: string, actor: string, id: string) =>
    { entry: { id: string; ticket?: string }; measure: Measure; observation: { actual: number } } | undefined;
  askHuman: (project: Project, input: { kind: 'intake'; subject: string; title: string; detail: string }) => unknown;
  selectDevice: (project: Project, agent: Agent, device: string | undefined, development: boolean) => string | undefined;
  octopAuthority: (expert: Expert, actor: string) => ExpertAuthority | undefined;
  version: (agent: Agent) => string;
  acceptStart: (trigger: Trigger, project: Project, agent: Agent) => { ticketId?: string | null };
  resolveDelegation: (actor: string, delegation: Delegation, decision: IntakeChoice) => { ticket?: string };
  closeDecision: (kind: 'intake', subject: string) => void;
  audit: (id: string, kind: string, data: object) => void;
};

export function openDispatchWorkflow(store: Pick<SuperAgentStore, 'db' | 'atomic' | 'threads' | 'triggers'>,
  engine: Pick<Engine, 'receive' | 'evaluateDue'>, octop: Pick<OctopResources, 'expert'>, delegations: Pick<Delegations, 'get'>,
  ports: DispatchPorts) {
  const { projectFor, mayStart, maintain, ticketFor, topicsFor, selectAgent, selectMaterials, relatedMemory, views, deliveryTargets,
    canCheckout, authorizesDevelopment, lessonFor, freezeTemplate, acceptanceMemory, askHuman, selectDevice, octopAuthority, version, acceptStart,
    resolveDelegation, closeDecision, audit } = ports;
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_intake (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, value TEXT NOT NULL, ticket TEXT, resolved INTEGER NOT NULL DEFAULT 0
    );
  `);

  function start(actor: string, input: Start, external?: Trigger, immediate = false, consultation?: Work['consultation']) {
    const project = projectFor(input.project, actor);
    if (!mayStart(project, actor)) throw new WorkbenchError('当前角色没有项目委托权限。', 403);
    const parent = input.parent ? ticketFor(input.parent, actor) : undefined;
    if (parent?.work.consultation?.private) throw new WorkbenchError('私有咨询不能作为派工来源。', 409);
    if (parent && parent.project.id !== project.id) throw new WorkbenchError('父工单属于其他项目。');
    const topic = input.topic ?? parent?.work.topic;
    if (topic && !topicsFor(project).some(item => item.id === topic)) throw new WorkbenchError('该主题不属于当前项目。', 400);
    const agent = selectAgent(project, topic, input.agent, input.function);
    const material = selectMaterials(project.id, actor, input.material);
    if (input.personal && (!agent || agent.kind !== 'personal' || agent.owner !== actor || input.target))
      throw new WorkbenchError('个人代办请选择自己的个人 Agent，并使用只读任务。', 403);
    if (input.device && !agent) throw new WorkbenchError('先选择 Agent，再选择执行端。', 409);
    const projectViews = views(project);
    const resources = [...new Set(input.resources ?? [])].map(ref =>
      requireValue(projectResourceRef(project.id, ref) && projectViews.find(source => source.ref === ref && source.state === 'bound'),
        '请选择当前项目已关联的资料。', 400));
    const target = input.target && deliveryTargets(project).find(ref =>
      resourceView(project.id, ref).ref === input.target && ref.execution);
    if (input.target && (!target || !target.execution || !canCheckout(target.externalId)
      || agent && !executionCapabilities(agent).code))
      throw new WorkbenchError('请选择已授权的交付仓库和支持代码执行的 Agent。', 403);
    const development = target && target.execution && { repository: target.externalId, base: target.execution.base, paths: target.execution.paths };
    if (development && agent && !authorizesDevelopment(project, development, agent.owner))
      throw new WorkbenchError('请选择有该仓库交付资格的研发 Agent，由其所有者接单。', 403);
    const developmentApproval = development && agent?.owner === actor && authorizesDevelopment(project, development, actor)
      ? { actor, agent: agent.id, scope: digest(development), at: new Date().toISOString() } : undefined;
    const reuse = input.reusedLesson ? lessonFor(project.id, actor, input.reusedLesson) : undefined;
    if (reuse && (input.parent !== reuse.entry.ticket
        || input.measure?.metric !== reuse.measure.metric || input.measure?.unit !== reuse.measure.unit
        || input.measure?.baseline !== reuse.observation.actual))
      throw new WorkbenchError('复用时请保留来源工单、观测指标和基线。', 409);
    const id = external?.id ?? key('workbench', actor, project.id, input.nonce);
    const prior = !external && store.db.prepare('SELECT ticket,resolved FROM workbench_intake WHERE id=? AND actor=?').get(id, actor);
    if (prior) return { trigger: id, ticket: typeof prior.ticket === 'string' ? prior.ticket : undefined, pending: !prior.resolved };
    if (!external && store.triggers.get(id)) return { trigger: id };
    if (!agent) {
      if (external || input.agent && input.agent !== 'auto') throw new WorkbenchError('这个项目没有对应的在岗 Agent。', 409);
      store.atomic(() => {
        store.db.prepare('INSERT OR IGNORE INTO workbench_intake(id,actor,value) VALUES (?,?,?)').run(id, actor, JSON.stringify(input));
        askHuman(project, { kind: 'intake', subject: id, title: '有一项委托需要确认接单职责',
          detail: '没有唯一且在岗的项目牵头 Agent，请确认执行人或归档。' });
      });
      return { trigger: id, pending: true };
    }
    const template = development ? freezeTemplate?.(project.id, development) : undefined;
    const query = input.title + '\n' + input.request;
    const priorRule = topic && !input.personal && !consultation && input.reuseAcceptance !== false && (template?.product || input.recall)
      ? acceptanceMemory(project, actor, topic, query, template) : undefined;
    const reusedAcceptance = priorRule && (material.includes(priorRule.id) || material.length < 8) ? priorRule : undefined;
    if (reusedAcceptance && !material.includes(reusedAcceptance.id)) material.push(reusedAcceptance.id);
    const recalled = input.recall ? relatedMemory(project, query, material, true).slice(0, Math.min(3, 8 - material.length)) : [];
    material.push(...recalled.map(entry => entry.id));
    if (reuse && !material.includes(reuse.entry.id)) throw new WorkbenchError('请在本单保留复用经验的来源资料。', 409);
    const productCases = freezeManualCases(input.productCases);
    const device = selectDevice(project, agent, input.device, !!development);
    const expert = octop.expert(agent.id);
    const octopGrant = expert && octopAuthority(expert, actor);
    if (expert && !octopGrant) throw new WorkbenchError('当前成员缺少共享专家或其技能版本的授权。', 403);
    const origin = external ?? { id, source: 'web', actor: { source: 'web', id: actor }, human: true,
      addressed: 'direct' as const, at: new Date().toISOString(), threads: [{ source: 'web', id }] };
    const ownThread = origin.threads[0]!;
    const thread = store.threads.get(ownThread.source + ':' + ownThread.id);
    if (external && thread?.subscriptions.length && !store.triggers.get(id))
      throw new WorkbenchError('原话题已有工单，请在那里继续。', 409);
    const trigger = { ...origin, actor: { ...origin.actor, id: actor }, text: input.request, meta: {
      ...external?.meta, project: project.id, title: input.title, agent: agent.id,
      agentVersion: version(agent), function: agent.function, material, resources, development, developmentApproval,
      deliveryTemplate: template ?? null, productCases: productCases.length ? productCases : undefined,
      reusedAcceptance, priority: input.priority, parent: input.parent,
      measure: input.measure, reusedLesson: input.reusedLesson, topic, recall: recalled.map(entry => entry.id),
      personal: input.personal, device, consultation, ...(consultation?.account && { channelActor: consultation.account }),
      ...(octopGrant && { octop: octopGrant }),
    } };
    engine.receive(trigger);
    if (immediate) {
      const decision = acceptStart(trigger, project, agent);
      return { trigger: id, ticket: requireValue(decision.ticketId, '委托未获准，请核对范围与授权。', 409) };
    }
    engine.evaluateDue();
    return { trigger: id };
  }

  function resolveIntake(actor: string, id: string, decision: IntakeChoice) {
    return store.atomic(() => {
      const delegation = delegations.get(id);
      if (delegation) return resolveDelegation(actor, delegation, decision);
      const row = requireValue(store.db.prepare('SELECT actor,value,resolved,ticket FROM workbench_intake WHERE id=?').get(id),
        '找不到这条待确认委托。');
      const input: Start = JSON.parse(String(row.value));
      const project = projectFor(input.project, actor);
      if (!maintain(project, actor)) throw new WorkbenchError('由项目维护人确认接单。', 403);
      if (row.resolved) return { ticket: typeof row.ticket === 'string' ? row.ticket : undefined };
      let ticket: string | undefined;
      if (decision.action === 'create') {
        const agent = requireValue(selectAgent(project, input.topic, decision.agent, input.function), '请选择项目内在岗 Agent。', 409);
        const requestor = String(row.actor);
        const trace: Trigger = { id, source: 'web', actor: { source: 'web', id: requestor }, human: true,
          addressed: 'direct', at: new Date().toISOString(), threads: [{ source: 'web', id }], text: input.request,
          meta: { confirmedBy: actor } };
        ticket = start(requestor, { ...input, agent: agent.id }, trace, true).ticket;
      }
      store.db.prepare('UPDATE workbench_intake SET resolved=1,ticket=? WHERE id=?').run(ticket ?? null, id);
      closeDecision('intake', id);
      audit(ticket ?? project.id, 'intake.confirmed', { actor, request: id, action: decision.action });
      return { ticket };
    });
  }

  return { start, resolveIntake };
}
