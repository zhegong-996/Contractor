import type { Project } from './config.ts';
import type { HumanDecision, HumanDecisionKind, HumanDecisions } from './human-decisions.ts';

type DecisionRequest = Omit<Parameters<HumanDecisions['open']>[0], 'member' | 'project'>;
type Notification = { targeted: boolean; originalThread?: true };

export function openDecisionWorkflow(decisions: HumanDecisions, ports: {
  owner: (project: Project) => string | undefined;
  mayStart: (project: Project, actor: string) => boolean;
  decisionAllowed: (decision: HumanDecision, actor: string) => boolean;
  opened: (project: Project, decision: HumanDecision) => Notification;
  closed: (decision: HumanDecision) => void;
}) {
  function askHuman(project: Project, input: DecisionRequest, recipient = ports.owner(project), previous?: string) {
    if (!recipient || !ports.mayStart(project, recipient)) return;
    const decision = decisions.open({ ...input, project: project.id, member: recipient }, previous);
    return { decision, ...ports.opened(project, decision) };
  }

  function closeHumanDecision(decision: HumanDecision) {
    decisions.close(decision);
    ports.closed(decision);
  }

  function closeDecision(kind: HumanDecisionKind, subject: string) {
    for (const decision of decisions.subject(kind, subject)) closeHumanDecision(decision);
  }

  function reconcileProjectDecisions(project: Project, previous: string, successor = ports.owner(project)) {
    for (const decision of decisions.pending(previous)) {
      if (decision.project !== project.id || ports.decisionAllowed(decision, previous)) continue;
      closeHumanDecision(decision);
      if (!successor || !ports.decisionAllowed({ ...decision, member: successor }, successor)) continue;
      if (decisions.subject(decision.kind, decision.subject).some(item => item.member === successor)) continue;
      const { id, kind, subject, title, detail, ticket, card } = decision;
      askHuman(project, { kind, subject, title, detail, ticket, card }, successor, id);
    }
  }

  return { askHuman, closeHumanDecision, closeDecision, reconcileProjectDecisions };
}
