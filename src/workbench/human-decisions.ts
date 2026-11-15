import type { DatabaseSync } from 'node:sqlite';
import { key } from '../../upstream/superagent/src/core/index.ts';

export type HumanDecisionKind = 'channel' | 'discussion' | 'intake' | 'answer' | 'access' | 'acceptance' | 'blocked'
  | 'development' | 'development-returned' | 'delivery';
export type HumanDecision = {
  id: string;
  project: string;
  member: string;
  kind: HumanDecisionKind;
  subject: string;
  title: string;
  detail?: string;
  ticket?: string;
  card?: number;
  openedAt: string;
  closedAt?: string;
};
type DecisionInput = Omit<HumanDecision, 'id' | 'openedAt' | 'closedAt'>;

export class HumanDecisions {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_human_decision (
        id TEXT PRIMARY KEY, member TEXT NOT NULL, project TEXT NOT NULL, kind TEXT NOT NULL,
        subject TEXT NOT NULL, value TEXT NOT NULL, closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS workbench_human_inbox ON workbench_human_decision(member,closed_at);
      CREATE INDEX IF NOT EXISTS workbench_human_subject ON workbench_human_decision(kind,subject,closed_at);
    `);
  }

  get(id: string): HumanDecision | undefined {
    const row = this.db.prepare('SELECT value FROM workbench_human_decision WHERE id=?').get(id);
    return row && JSON.parse(String(row.value));
  }

  open(input: DecisionInput) {
    const record = { ...input, id: key('human-decision', input.kind, input.subject, input.member), openedAt: new Date().toISOString() };
    this.db.prepare('INSERT OR IGNORE INTO workbench_human_decision VALUES (?,?,?,?,?,?,NULL)')
      .run(record.id, record.member, record.project, record.kind, record.subject, JSON.stringify(record));
    return this.get(record.id)!;
  }

  pending(member: string): HumanDecision[] {
    return this.db.prepare('SELECT value FROM workbench_human_decision WHERE member=? AND closed_at IS NULL ORDER BY rowid DESC')
      .all(member).map(row => JSON.parse(String(row.value)));
  }

  subject(kind: HumanDecisionKind, subject: string): HumanDecision[] {
    return this.db.prepare('SELECT value FROM workbench_human_decision WHERE kind=? AND subject=? AND closed_at IS NULL ORDER BY rowid')
      .all(kind, subject).map(row => JSON.parse(String(row.value)));
  }

  close(record: HumanDecision) {
    const closedAt = new Date().toISOString();
    this.db.prepare('UPDATE workbench_human_decision SET value=?, closed_at=? WHERE id=? AND closed_at IS NULL')
      .run(JSON.stringify({ ...record, closedAt }), closedAt, record.id);
  }
}
