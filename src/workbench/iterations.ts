import type { DatabaseSync } from 'node:sqlite';

// A review snapshot complements the native Ticket/Assignment; it never schedules execution.
// Like upstream acceptance's rounds, reviews are append-only and tied to an exact deliverable.
export type Review = {
  version: number; revision: string; kind: 'accepted' | 'rejected' | 'continued'; actor: string; at: string;
  reason?: string; commit?: string; delivery?: unknown;
};
export class Iterations {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS workbench_review (
      ticket TEXT NOT NULL, revision TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(ticket,revision,kind)
    );`);
  }
  get(ticket: string, revision: string, kind: Review['kind']): Review | undefined {
    const row = this.db.prepare('SELECT value FROM workbench_review WHERE ticket=? AND revision=? AND kind=?').get(ticket, revision, kind);
    return row && JSON.parse(String(row.value));
  }
  record(ticket: string, review: Review) {
    this.db.prepare('INSERT OR IGNORE INTO workbench_review VALUES (?,?,?,?)')
      .run(ticket, review.revision, review.kind, JSON.stringify(review));
  }
  list(ticket: string): Review[] {
    return this.db.prepare('SELECT value FROM workbench_review WHERE ticket=? ORDER BY rowid').all(ticket)
      .map(row => JSON.parse(String(row.value)));
  }
}
