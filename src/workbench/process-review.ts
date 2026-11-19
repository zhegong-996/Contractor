import type { UsageReceipt } from './execution-evidence.ts';

export function processReview(input: {
  receipt?: UsageReceipt;
  model?: string;
  confirmations: number;
  topicBasis: boolean;
  delivery?: { revision: string; accepted: boolean };
}) {
  const reported = input.receipt?.modelReceipt?.reported;
  const requested = input.model ?? input.receipt?.modelReceipt?.requested;
  return {
    confirmations: input.confirmations,
    topicBasis: input.topicBasis,
    receipt: input.receipt?.outcome,
    model: {
      requested, reported,
      state: requested && reported ? requested === reported ? 'matched' as const : 'different' as const : 'unverified' as const,
    },
    delivery: input.delivery,
  };
}
