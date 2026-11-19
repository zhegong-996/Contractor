import type { Trigger } from '../../upstream/superagent/src/core/index.ts';
import { sensitiveFeishuText } from '../feishu-sources.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import { messageRef, type ChannelLinks, type ChannelRef, type ChannelRequest, type PendingRequest } from './channel-links.ts';
import type { Project } from './config.ts';
import { requireValue, WorkbenchError } from './errors.ts';
import { digest } from './knowledge.ts';
import type { ProjectTopic } from './project-resources.ts';
import type { IntakeDecision, Start, Work } from './work-types.ts';

type ChannelPorts = {
  projectById: ReadonlyMap<string, Project>;
  workOf: (id: string) => Work | undefined;
  projectFor: (id: string, actor: string) => Project;
  member: (project: Project, actor: string) => boolean;
  mayStart: (project: Project, actor: string) => boolean;
  maintain: (project: Project, actor: string) => boolean;
  relatedProjects: (from: Project, to: Project) => boolean;
  topicsFor: (project: Project) => ProjectTopic[];
  feishuScope: (chat: string, root: unknown) => { project?: Project };
  routeFeishuInput: (project: Project, event: ChannelRequest) => { origin: ChannelRef };
  feishuTopic: (project: Project, chat: string, root: unknown) => string | undefined;
  isFeishuTopicRoot: (project: Project, chat: string, root: unknown) => boolean;
  discussionSources: (project: Project) => { externalId: string }[];
  executionDecider: (project: Project, work: Work) => string | undefined;
  routingMatch: (project: Project, actor: string, refs: ChannelRef[], explicit?: string) => { ticket?: string; reason?: string };
  mayLinkWork: (project: Project, actor: string, id: string) => boolean;
  linkOrigin: (reference: ChannelRef, ticket: string) => void;
  start: (actor: string, input: Start, event: Trigger, immediate: true) => { ticket?: string };
  selectAgent: (project: Project, topic: string | undefined, agent: string) => unknown;
  reply: (actor: string, id: string, input: { card: number; nonce: string; choice?: number; text?: string }, source?: Trigger) => void;
  askHuman: (project: Project, input: { kind: 'channel'; subject: string; title: string; detail: string }) => unknown;
  closeDecision: (kind: 'channel', subject: string) => void;
  audit: (id: string, kind: string, data: object) => void;
};

export function openChannelWorkflow(store: Pick<SuperAgentStore, 'atomic'>, links: ChannelLinks, ports: ChannelPorts) {
  const { projectById, workOf, projectFor, member, mayStart, maintain, relatedProjects, topicsFor, feishuScope, routeFeishuInput,
    feishuTopic, isFeishuTopicRoot, discussionSources, executionDecider, routingMatch, mayLinkWork, linkOrigin, start, selectAgent,
    reply, askHuman, closeDecision, audit } = ports;

  function openChannelTicket(event: ChannelRequest, actor: string, refs: ChannelRef[], confirmedBy?: string, topic?: string,
    parent?: string, material: string[] = [], target?: string) {
    const channelActor = event.sender;
    // Channel messages stay at their original addresses. An Engine thread is owned only by this case.
    const trigger = { ...event.trigger, human: true, addressed: 'direct' as const,
      threads: [{ source: 'workbench-case', id: event.trigger.id }],
      meta: confirmedBy && !event.trigger.channel ? { channelActor, confirmedBy }
        : { ...event.trigger.meta, channelActor, confirmedBy } };
    const { ticket } = start(actor, {
      project: event.project, agent: event.agent, request: event.request, title: event.request.slice(0, 100),
      nonce: trigger.id, material, priority: 'normal', topic: topic ?? event.topic, parent, target,
    }, trigger, true);
    if (!ticket) throw new WorkbenchError('委托未获准。', 409);
    for (const ref of refs) linkOrigin(ref, ticket);
    return ticket;
  }

  function receiveChannel(event: ChannelRequest, reference?: ChannelRef | string | null) {
    return store.atomic(() => {
      if (links.seen(event.trigger.id)) return { status: 'duplicate' as const };
      const actor = links.member(event.sender, event.trigger.at);
      const project = projectById.get(event.project);
      if (!actor || !project || !member(project, actor)) return { status: 'unbound' as const };
      if (!event.trigger.human || !mayStart(project, actor)) return { status: 'denied' as const };
      if (event.sender.provider === 'feishu') {
        const chat = String(event.trigger.meta.chatId);
        const root = event.trigger.meta.rootId ?? event.trigger.meta.messageId;
        const target = feishuScope(chat, root).project;
        if (!event.trigger.meta.direct && target && target.id !== project.id) return { status: 'denied' as const };
        const origin = routeFeishuInput(project, event).origin;
        const parent = event.trigger.meta.parentId ?? event.trigger.meta.rootId;
        event = { ...event, origin, topic: feishuTopic(project, chat, root) ?? event.topic,
          parentMessage: isFeishuTopicRoot(project, chat, parent) ? undefined : event.parentMessage };
      }
      const record = (outcome: { ticket: string } | { reason: string }) => {
        links.record({ ...event, reference: reference ?? undefined }, actor, outcome);
        if (event.revision) links.revise(event.trigger.id, event.revision, event.trigger.text, false);
      };
      const pending = (reason: string) => {
        record({ reason });
        askHuman(project, { kind: 'channel', subject: event.trigger.id, title: '有一条跨渠道请求需要确认归属', detail: reason });
        return { status: 'pending' as const };
      };
      if (event.recovered) return pending('飞书补读找回原命令，请核对原话题后确认。');
      if (reference === null) return pending('引用无法核对，需由项目维护人确认。');
      const refs = [event.origin, ...(event.parentMessage ? [event.parentMessage] : []), ...(reference && typeof reference !== 'string' ? [reference] : [])];
      const matched = routingMatch(project, actor, refs, typeof reference === 'string' ? reference : undefined);
      if (matched.reason) return pending(matched.reason);
      const existing = matched.ticket;
      const message = messageRef(event.trigger.id, event.trigger.url ?? event.origin.url);
      if (existing) {
        const target = workOf(existing)!;
        linkOrigin(target.project === project.id ? message : messageRef(event.trigger.id), existing);
        if (target.project === project.id) {
          for (const ref of refs) if (!ref.project || ref.project === project.id) linkOrigin(ref, existing);
        }
        record({ ticket: existing });
        // Cross-project links carry a reference only. A target project's members never inherit the source conversation.
        audit(existing, 'channel.input-linked', { actor, event: event.trigger.id, channelActor: event.sender,
          project: target.project, topic: target.topic, crossed: target.project !== project.id });
        return { status: 'linked' as const, ticket: existing };
      }
      if (typeof reference !== 'object' || reference.project && reference.project !== project.id)
        return pending('需要确认工单归属。已有项目或主题的讨论也可继续归档。');
      if (!selectAgent(project, event.topic, event.agent))
        return pending('该主题没有唯一且在岗的执行 Agent，请确认由谁牵头。');
      const ticket = openChannelTicket(event, actor, [...refs, message]);
      record({ ticket });
      return { status: 'created' as const, ticket };
    });
  }

  function mayReviewChannel(project: Project, actor: string, pending: PendingRequest) {
    const recovered = pending.request.recovered;
    if (recovered) {
      const history = project.discussion?.history;
      if (!history || !maintain(project, history.member) || history.appId !== pending.request.sender.namespace
        || !discussionSources(project).some(ref => ref.externalId === pending.request.trigger.meta.chatId)
        || links.member(pending.request.sender, pending.request.trigger.at) !== pending.member || !mayStart(project, pending.member)) return false;
    }
    if (recovered?.kind !== 'answer') return maintain(project, actor);
    const work = workOf(recovered.ticket);
    return pending.member === actor && !!work && work.project === project.id && executionDecider(project, work) === actor
      && mayStart(project, actor);
  }

  function resolveChannel(actor: string, id: string, decision: IntakeDecision, verified?: ChannelRequest) {
    return store.atomic(() => {
      const pending = requireValue(links.getPending(id), '这条消息已处理，请刷新。', 409);
      const event = pending.request;
      const project = projectFor(event.project, actor);
      if (!mayReviewChannel(project, actor, pending)) throw new WorkbenchError('当前没有处理该命令的权限。', 403);
      if (event.recovered && decision.action !== 'dismiss' && digest(event) !== digest(verified))
        throw new WorkbenchError('请先重新核对飞书原消息。', 409);
      if (decision.action === 'dismiss') {
        if (event.recovered) links.redactPending(id);
        else links.settle(id);
        closeDecision('channel', id);
        audit(project.id, 'channel.dismissed', { actor, event: id });
        return {};
      }
      if (links.member(event.sender, event.trigger.at) !== pending.member || !mayStart(project, pending.member))
        throw new WorkbenchError('原发言人的账号绑定或项目权限已变化，请重新提交。', 409);
      if (event.recovered?.kind === 'answer') {
        const { ticket, card } = event.recovered;
        if (decision.action !== 'link' || decision.ticket !== ticket)
          throw new WorkbenchError('补读的答复只可用于原工单和原问题。', 409);
        reply(actor, ticket, { card, nonce: id, ...(/^\d+$/.test(event.request)
          ? { choice: Number(event.request) - 1 } : { text: event.request }) }, event.trigger);
        links.redactPending(id, ticket);
        closeDecision('channel', id);
        audit(ticket, 'channel.recovered-answer', { actor, event: id, card });
        return { ticket };
      }
      if (decision.action === 'project' || decision.action === 'topic') {
        const topic = decision.action === 'topic' ? decision.topic : undefined;
        if (topic && !topicsFor(project).some(item => item.id === topic)) throw new WorkbenchError('请选择当前项目的主题。');
        links.archive(id, topic);
        closeDecision('channel', id);
        audit(project.id, 'channel.archived', { actor, member: pending.member, event: id, topic });
        return {};
      }
      const explicit = typeof event.reference === 'object' ? event.reference : undefined;
      const originalRefs = [event.origin, ...(event.parentMessage ? [event.parentMessage] : []), ...(explicit ? [explicit] : [])];
      const matched = routingMatch(project, pending.member, originalRefs, typeof event.reference === 'string' ? event.reference : undefined);
      const ticket = decision.action === 'link' ? decision.ticket
        : !decision.separate && (!decision.project || decision.project === project.id) ? matched.ticket : undefined;
      if (ticket && decision.action === 'create' && decision.target)
        throw new WorkbenchError('已匹配原工单，请续原单或明确另开代码工单。', 409);
      if (ticket && (!mayLinkWork(project, actor, ticket) || !mayLinkWork(project, pending.member, ticket)))
        throw new WorkbenchError('请选择双方有权限且已关联的项目工单。', 409);
      const decisionTopic = decision.action === 'create' ? decision.topic : undefined;
      const sourceTicket = links.ticket(event.origin);
      const ref = messageRef(id, event.trigger.url ?? event.origin.url);
      const citedTicket = typeof event.reference === 'string' ? event.reference : explicit && links.ticket(explicit);
      const destination = decision.action === 'create' && decision.project ? projectFor(decision.project, actor) : project;
      if (!relatedProjects(project, destination) || !mayStart(destination, pending.member) || !maintain(destination, actor))
        throw new WorkbenchError('双方须有目标项目的权限，且确认人须维护目标项目。', 403);
      const crossed = destination.id !== project.id;
      if (crossed && (decision.action !== 'create' || !decision.brief || sensitiveFeishuText.test(decision.brief)))
        throw new WorkbenchError('请为目标项目填写可共享的任务说明。', 409);
      const chosen = decision.action === 'create' ? { ...event, project: destination.id, agent: decision.agent ?? (crossed ? 'auto' : event.agent),
        request: crossed ? decision.brief! : event.request,
        ...(crossed ? { topic: undefined, trigger: { ...event.trigger, channel: undefined, url: undefined } } : {}) } : event;
      const target = ticket ?? openChannelTicket(chosen, pending.member, [crossed ? messageRef(id) : ref], actor,
        decisionTopic, decision.action === 'create' ? decision.parent : undefined, decision.action === 'create' ? decision.material : undefined,
        decision.action === 'create' ? decision.target : undefined);
      const sameProject = workOf(target)?.project === project.id;
      linkOrigin(sameProject ? ref : messageRef(id), target);
      const parentTicket = event.parentMessage && links.ticket(event.parentMessage);
      if (sameProject && [sourceTicket, citedTicket, parentTicket].every(candidate => !candidate || candidate === target)) {
        linkOrigin(event.origin, target);
        if (explicit && (!explicit.project || explicit.project === project.id)) linkOrigin(explicit, target);
      }
      links.settle(id, target);
      closeDecision('channel', id);
      audit(target, 'channel.confirmed', { actor, member: pending.member, event: id, sourceProject: project.id });
      return { ticket: target };
    });
  }

  return { receiveChannel, mayReviewChannel, resolveChannel };
}
