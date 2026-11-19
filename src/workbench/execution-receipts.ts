import { parseResult, type Rejected, type Result } from './execution/protocol.ts';
import type { ExecutionHub } from './execution/contract.ts';
import { WorkbenchError } from './errors.ts';
import { digest } from './knowledge.ts';
import type { ReceiptDraft, ReceiptJournal } from './receipt-journal.ts';

type Acknowledgement = { rejected: Rejected[] };

/** Correlate the native acknowledgement with a durable Contractor draft for the same run and lease. */
export function executionReceipts(journal: ReceiptJournal, runtime: Pick<ExecutionHub, 'finish' | 'runLease'>,
  apply: (draft: ReceiptDraft, answer: Rejected[]) => void, stillAuthorized: (draft: ReceiptDraft) => boolean) {
  function acknowledged(draft: ReceiptDraft): Acknowledgement | undefined {
    const native = runtime.runLease(draft.run);
    if (native?.last_issued !== draft.issued) return;
    if (native.last_result !== digest(draft.outcome)) throw new Error('原生回执内容与待结算记录不一致');
    return { rejected: JSON.parse(native.last_answer ?? '[]') };
  }

  function complete(draft: ReceiptDraft, acknowledgement: Acknowledgement) {
    const rejected = [...acknowledgement.rejected, ...(draft.rejected ?? [])];
    apply(draft, rejected);
    return { rejected };
  }

  const recoveryErrors = new Set<number>();
  return {
    submit(draft: ReceiptDraft, token: string, result: Result) {
      if (runtime.runLease(draft.run)?.issued !== draft.issued) throw new Error('回执已不属于当前原生尝试');
      parseResult(draft.outcome);
      journal.prepare(draft, token, result);
      return complete(draft, runtime.finish(draft.run, token, draft.outcome));
    },
    replay(run: number, token: string, result: Result) {
      const receipt = journal.replay(run, token);
      if (!receipt) return;
      if (receipt.requestHash !== digest(result)) throw new WorkbenchError('同一执行回执的内容已变化。', 409);
      const draft = receipt.draft;
      if (!draft) return { rejected: receipt.answer ?? [] };
      const prior = acknowledged(draft);
      if (prior) return complete(draft, prior);
      if (draft.outcome.outcome !== 'cancelled' && !stillAuthorized(draft)) {
        const reason = '回执重试时授权已变化';
        draft.outcome = { outcome: 'cancelled', summary: reason, usage: draft.usage };
        if (draft.discussion) draft.discussion = { ...draft.discussion, state: 'cancelled', detail: reason, proposals: undefined };
        journal.change(draft);
      }
      return complete(draft, runtime.finish(run, token, draft.outcome));
    },
    recover() {
      for (const draft of journal.pending()) {
        try {
          const prior = acknowledged(draft);
          if (prior) complete(draft, prior);
          recoveryErrors.delete(draft.run);
        } catch (error) {
          if (!recoveryErrors.has(draft.run)) console.error('Contractor 待补写回执 #' + draft.run + '：', (error as Error).name);
          recoveryErrors.add(draft.run);
        }
      }
    },
  };
}
