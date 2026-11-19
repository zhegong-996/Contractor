import type { Agent, Project } from './config.ts';
import type { Destination, Proposal } from './discussion.ts';

type Dispatch = Project['dispatch'];

export function matchWorkReferences(references: Iterable<string>, mayLink: (ticket: string) => boolean) {
  const candidates = [...new Set(references)];
  if (candidates.some(ticket => !mayLink(ticket))) return { reason: '引用无法在当前权限下确认，请核对归属。' };
  if (candidates.length > 1) return { reason: '不同引用指向不同工单，需由项目维护人核对。' };
  return { ticket: candidates[0] };
}

export function confirmedDiscussionDestination(proposal: Proposal, matched?: { id: string; topic?: string }): Destination {
  if (proposal.action === 'dismiss') return { action: 'dismiss' };
  if (matched && proposal.action !== 'review') return { action: 'link', ticket: matched.id, topic: matched.topic };
  return { action: proposal.action, ticket: proposal.action === 'review' ? proposal.ticket : undefined, topic: proposal.topic };
}

export function routeDiscussion(proposal: Proposal, evidence: { matched: string | null | undefined; current?: string;
  conflict: boolean; unverified: boolean; suggested?: string; matchedTopic?: string }): Destination {
  const { matched, current, conflict, unverified, suggested, matchedTopic } = evidence;
  if (matched === null || unverified || conflict || current !== (matched ?? undefined)
    || (proposal.action === 'link' && (!matched || matched !== suggested)))
    return { action: 'review', ticket: suggested, topic: proposal.topic };
  return confirmedDiscussionDestination({ ...proposal, ticket: suggested }, matched ? { id: matched, topic: matchedTopic } : undefined);
}

function topicScopes(topic?: string, parent?: string) {
  return new Set([topic ?? parent, parent, undefined]);
}

export function selectProjectAgent(dispatch: Dispatch, request: { topic?: string; parent?: string; explicit?: string; function?: string; legacyLead?: string },
  activeAgent: (id: string) => Agent | undefined): Agent | undefined {
  if (request.explicit && request.explicit !== 'auto') {
    const agent = activeAgent(request.explicit);
    return agent && (!request.function || request.function === agent.function) ? agent : undefined;
  }
  const candidates = dispatch.filter(rule => !request.function || rule.function === request.function);
  for (const scope of topicScopes(request.topic, request.parent)) {
    const rules = candidates.filter(rule => rule.topic === scope);
    if (!rules.length) continue;
    // More than one configured lead needs a human decision, even if only one is currently on duty.
    return rules.length === 1 ? activeAgent(rules[0]!.agent) : undefined;
  }
  if (!dispatch.length && request.legacyLead) return activeAgent(request.legacyLead);
}

export function selectExecutionDecider(dispatch: Dispatch, request: { requester: string; function: string; topic?: string; parent?: string; restricted: boolean },
  canDecide: (actor: string) => boolean, projectOwner: () => string | undefined) {
  if (request.restricted) return canDecide(request.requester) ? request.requester : undefined;
  for (const scope of topicScopes(request.topic, request.parent)) {
    const rule = dispatch.find(rule => rule.topic === scope && rule.function === request.function);
    if (rule?.decider && canDecide(rule.decider)) return rule.decider;
  }
  return canDecide(request.requester) ? request.requester : projectOwner();
}
