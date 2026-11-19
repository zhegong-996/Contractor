import { key, type Trigger } from '../../upstream/superagent/src/core/index.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import { messageRef, type ChannelRef } from './channel-links.ts';
import type { Agent, Project } from './config.ts';
import { observationVersion, type Destination, type DigestItem, type DigestScope, type Discussions, type Observation, type Proposal } from './discussion.ts';
import { requireValue, WorkbenchError } from './errors.ts';
import type { ProjectTopic } from './project-resources.ts';
import type { Start, Work } from './work-types.ts';

type DiscussionPorts = {
  audit: (id: string, kind: string, data: object) => void;
  projectFor: (id: string, actor: string) => Project;
  maintain: (project: Project, actor: string) => boolean;
  topicsFor: (project: Project) => ProjectTopic[];
  ticketFor: (id: string, actor: string) => { ticket: { id: string }; project: Project };
  mayLinkWork: (project: Project, actor: string | undefined, id: string) => boolean;
  stillObserved: (project: Project, message: Observation) => boolean;
  workOf: (id: string) => Pick<Work, 'project' | 'topic'> | undefined;
  discussionDestination: (project: Project, scope: DigestScope, decision: Proposal, message: Observation) => Destination;
  askHuman: (project: Project, input: { kind: 'discussion'; subject: string; title: string; detail: string }) => void;
  closeDecision: (kind: 'discussion', subject: string) => void;
  linkOrigin: (reference: ChannelRef, ticket: string) => void;
  selectAgent: (project: Project, topic?: string, explicit?: string) => Pick<Agent, 'id'> | undefined;
  start: (actor: string, input: Start, trigger: Trigger, immediate: true) => { ticket?: string };
};

export function openDiscussionWorkflow(store: Pick<SuperAgentStore, 'atomic'>, discussions: Discussions, ports: DiscussionPorts) {
  const { audit, projectFor, maintain, topicsFor, ticketFor, mayLinkWork, stillObserved, workOf,
    discussionDestination, askHuman, closeDecision, linkOrigin, selectAgent, start } = ports;

  function recordSuggestions(project: Project, scope: DigestScope, proposed: Proposal[], detail: string | undefined, id: number) {
    for (const suggestion of proposed) {
      const snapshot = scope.groups?.[suggestion.message];
      const eligible = (snapshot ? Object.entries(snapshot).flatMap(([message, version]) => {
        const source = discussions.pendingMessage(message, scope.slot);
        return source && observationVersion(source) === version ? [source] : [];
      }) : discussions.messageGroupFor(suggestion.message, scope.slot)).filter(message => stillObserved(project, message));
      const original = eligible[0];
      if (!original) continue;
      const destination = discussionDestination(project, scope, suggestion, original);
      if (destination.action === 'dismiss') {
        for (const message of eligible) discussions.settle(message.id);
        continue;
      }
      const itemId = key('discussion-item', project.id, String(scope.slot), suggestion.message, observationVersion(original));
      const automatic = ['project', 'topic', 'link'].includes(destination.action);
      const item: DigestItem = { id: itemId, project: project.id, slot: scope.slot,
        title: suggestion.action === 'dismiss' ? '群消息需要确认归属' : suggestion.title,
        reason: suggestion.action === 'dismiss' ? '整理期间来源归属变化，请查看原消息。' : suggestion.reason,
        destination, status: automatic ? 'applied' : destination.action === 'create' ? 'suggested' : 'pending',
        topic: destination.topic ?? (destination.action === 'link' ? workOf(destination.ticket!)?.topic : undefined),
        ticket: destination.action === 'link' ? destination.ticket : undefined, messageRefs: eligible.map(message => message.id),
        evidence: [...eligible.map(message => discussions.sourceEvidence(message)),
          ...scope.facts.filter(fact => !fact.messages || fact.messages.includes(suggestion.message)).slice(0, 12)
            .map(({ kind, title, url, revision }) => ({ kind, title, url, revision }))],
      };
      discussions.saveItem(item);
      if (!automatic) askHuman(project, { kind: 'discussion', subject: itemId, title: '群消息整理有一项需要确认',
        detail: destination.action === 'create' ? '请决定是否投入新工作，并确认负责的主题与 Agent。' : '请核对冲突引用，决定归档、续单或另建工单。' });
      if (destination.action === 'link' && item.ticket) for (const message of eligible) linkDiscussionMessage(item.ticket, message);
      for (const message of eligible) discussions.settle(message.id, itemId, !automatic);
    }
    discussions.saveRun(id, scope.project, scope.slot, 'done', detail);
    audit(scope.project, 'discussion.digest', { slot: scope.slot, count: proposed.length, run: id });
  }

  function resolveDiscussion(actor: string, id: string, decision: Destination & { message?: string }) {
    return store.atomic(() => {
      const { message, ...destination } = decision;
      const portionId = message ? key('discussion-message-decision', id, message) : id;
      const portion = message ? discussions.item(portionId) : undefined;
      let item = requireValue(portion ?? discussions.item(id), '找不到这条整理建议。');
      const project = projectFor(item.project, actor);
      if (!maintain(project, actor)) throw new WorkbenchError('由项目维护人确认整理建议。', 403);
      if (item.status === 'applied') {
        if (destination.action === item.destination.action && destination.ticket === item.destination.ticket && destination.topic === item.destination.topic
          && destination.agent === item.destination.agent) return { ticket: item.ticket };
        throw new WorkbenchError('这条整理建议已处理。', 409);
      }
      const messages = discussions.messageRefs(item.id).filter(source => (!message || source.id === message) && stillObserved(project, source));
      if (!project.discussion || !messages.length) throw new WorkbenchError('原消息或授权已变化，请查看来源。', 409);
      if (destination.topic && !topicsFor(project).some(topic => topic.id === destination.topic)) throw new WorkbenchError('请选择当前项目的主题。');
      if (message && !portion) item = discussions.extract(item, message, portionId);
      if (destination.action === 'dismiss') {
        discussions.dismiss(item.id);
        closeDecision('discussion', item.id);
        if (message && !discussions.messageRefs(id).length) closeDecision('discussion', id);
        audit(project.id, 'discussion.dismissed', { actor, id });
        return {};
      }
      let ticket: string | undefined;
      if (destination.action === 'link') {
        const target = ticketFor(destination.ticket ?? '', actor);
        if (!mayLinkWork(project, actor, target.ticket.id)
          || messages.some(source => !mayLinkWork(project, source.member, target.ticket.id)))
          throw new WorkbenchError('请选择发言人与负责人都有权限关联的项目工单。', 409);
        ticket = target.ticket.id;
        for (const source of messages) linkDiscussionMessage(ticket, source, target.project.id === project.id);
      } else if (destination.action === 'create') {
        const agent = selectAgent(project, destination.topic ?? item.topic, destination.agent);
        if (!agent) throw new WorkbenchError('请确认项目内的牵头 Agent。', 409);
        const primary = messages[0]!;
        const trace: Trigger = { id: key('discussion-create', item.id), source: 'web', human: true, addressed: 'direct',
          actor: { source: 'web', id: actor }, threads: [{ source: 'workbench-case', id: item.id }], at: new Date().toISOString(), text: item.title,
          meta: { discussion: { id: item.id, sourceMessage: primary.id, originalMember: primary.member, confirmedBy: actor } } };
        ticket = start(actor, { project: project.id, agent: agent.id, title: item.title,
          request: [item.reason, '飞书反馈：' + primary.text].join('\n').slice(0, 3500), nonce: trace.id,
          material: [], priority: 'normal', topic: destination.topic ?? item.topic }, trace, true).ticket;
        for (const source of messages) linkDiscussionMessage(ticket!, source);
      } else if (destination.action === 'review' || (destination.action === 'topic' && !destination.topic)) {
        throw new WorkbenchError('请确认这条反馈的去向。');
      }
      discussions.saveItem({ ...item, destination, status: 'applied', decidedBy: actor,
        topic: destination.topic ?? (ticket && workOf(ticket)?.project === project.id ? workOf(ticket)?.topic : undefined), ticket });
      for (const message of messages) discussions.settle(message.id, item.id, false);
      closeDecision('discussion', item.id);
      if (message && !discussions.messageRefs(id).length) closeDecision('discussion', id);
      audit(project.id, 'discussion.confirmed', { actor, id: item.id, message, action: destination.action, ticket });
      return { ticket };
    });
  }

  function linkDiscussionMessage(ticket: string, message: Observation, includeSource = true) {
    linkOrigin(messageRef(message.id, includeSource ? message.origin.url : undefined), ticket);
  }

  return { recordSuggestions, resolveDiscussion };
}
