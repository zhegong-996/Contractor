import type { DatabaseSync } from 'node:sqlite';
import type { Rejected, Result, Usage } from './execution/protocol.ts';
import type { RemoteStop } from './devices.ts';
import type { Proposal } from './discussion.ts';
import type { modelReceipt } from './isolation.ts';
import { digest } from './knowledge.ts';

export type ReceiptDraft = {
  run: number; attempt: number; lane: string; issued: number;
  outcome: Result; usage?: Usage; model: Awaited<ReturnType<typeof modelReceipt>>;
  stop?: Pick<RemoteStop, 'usageCoverage' | 'state'>;
  rejected?: Rejected[];
  discussion?: { project: string; slot: number; state: 'done' | 'failed' | 'cancelled'; detail?: string; proposals?: Proposal[] };
};

export class ReceiptJournal {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS workbench_receipt_journal (
      run INTEGER NOT NULL, attempt INTEGER NOT NULL, lane TEXT NOT NULL, lease_hash TEXT NOT NULL,
      request_hash TEXT NOT NULL, draft TEXT, answer TEXT,
      PRIMARY KEY(run,attempt), UNIQUE(run,lease_hash)
    );
    CREATE INDEX IF NOT EXISTS workbench_receipt_pending ON workbench_receipt_journal(lane) WHERE draft IS NOT NULL;`);
  }

  prepare(draft: ReceiptDraft, lease: string, result: Result) {
    this.db.prepare('INSERT INTO workbench_receipt_journal VALUES (?,?,?,?,?,?,NULL)')
      .run(draft.run, draft.attempt, draft.lane, digest(lease), digest(result), JSON.stringify(draft));
  }

  replay(run: number, lease: string) {
    const row = this.db.prepare('SELECT request_hash,draft,answer FROM workbench_receipt_journal WHERE run=? AND lease_hash=?')
      .get(run, digest(lease));
    return row && { requestHash: String(row.request_hash), draft: row.draft ? JSON.parse(String(row.draft)) as ReceiptDraft : undefined,
      answer: row.answer ? JSON.parse(String(row.answer)) as Rejected[] : undefined };
  }

  pending(): ReceiptDraft[] {
    return this.db.prepare('SELECT draft FROM workbench_receipt_journal WHERE draft IS NOT NULL ORDER BY rowid').all()
      .map(row => JSON.parse(String(row.draft)));
  }

  pendingLanes() {
    return new Set(this.db.prepare('SELECT DISTINCT lane FROM workbench_receipt_journal WHERE draft IS NOT NULL').all().map(row => String(row.lane)));
  }

  pendingCount() {
    return Number(this.db.prepare('SELECT COUNT(*) AS count FROM workbench_receipt_journal WHERE draft IS NOT NULL').get()!.count);
  }

  isPending(run: number) {
    return !!this.db.prepare('SELECT 1 FROM workbench_receipt_journal WHERE run=? AND draft IS NOT NULL').get(run);
  }

  change(draft: ReceiptDraft) {
    this.db.prepare('UPDATE workbench_receipt_journal SET draft=? WHERE run=? AND attempt=? AND draft IS NOT NULL')
      .run(JSON.stringify(draft), draft.run, draft.attempt);
  }

  complete(draft: ReceiptDraft, answer: Rejected[]) {
    this.db.prepare('UPDATE workbench_receipt_journal SET draft=NULL,answer=? WHERE run=? AND attempt=? AND draft IS NOT NULL')
      .run(JSON.stringify(answer), draft.run, draft.attempt);
  }
}
