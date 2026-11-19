import type { ticketStage, Ticket } from '../../upstream/superagent/src/core/index.ts';
import type { CodeDeliveryState } from './work-types.ts';

export const ticketListStates = ['queued', 'running', 'waiting', 'review', 'done', 'closed'] as const;

export function ticketListState({ work, stage, recoveryKind, ...ticket }: {
  work: { accepted?: unknown; consultation: boolean; development: boolean; developmentResponse: boolean;
    approvalRequired: boolean; developmentApproval: boolean };
  stage: ReturnType<typeof ticketStage>;
  recoveryKind?: string;
  endReason?: NonNullable<Ticket['ended']>['outcome'];
  deliveryStatus?: Pick<CodeDeliveryState, 'state'>;
  result: boolean;
  productChecksPending: boolean;
  waitingAccess: boolean;
  materialHidden: boolean;
  blocked: boolean;
  runState?: string;
}) {
  if (work.accepted || work.consultation && ticket.result) return 'done';
  if (ticket.endReason && ticket.endReason !== 'completed') return 'closed';
  if (recoveryKind === 'acceptance' && !ticket.productChecksPending) return 'review';
  if (recoveryKind || ticket.waitingAccess || ticket.materialHidden || work.developmentResponse || ticket.blocked
    || ticket.productChecksPending || ticket.deliveryStatus && ticket.deliveryStatus.state !== 'ready'
    || work.approvalRequired && !work.developmentApproval && stage.stage !== 'ended') return 'waiting';
  if (ticket.result && (!work.development || ticket.deliveryStatus?.state === 'ready')) return 'review';
  if (stage.stage === 'ended') return 'closed';
  if (stage.stage === 'person') return 'waiting';
  if (ticket.runState === 'queued') return 'queued';
  return stage.stage === 'working' && stage.action !== 'queued' ? 'running' : 'queued';
}

export type TicketListFilters = {
  project?: string; mine?: boolean; q?: string; topic?: string; agent?: string;
  state?: (typeof ticketListStates)[number]; limit?: number; after?: string;
  purpose?: 'work' | 'all';
};

export function topicWithin(topics: { id: string; parent?: string }[], candidate: string | undefined, root: string) {
  const seen = new Set<string>();
  for (let id = candidate; id && !seen.has(id); id = topics.find(topic => topic.id === id)?.parent) {
    if (id === root) return true;
    seen.add(id);
  }
  return false;
}
