import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const delegationProposal = z.object({
  function: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  title: z.string().trim().min(1).max(100), request: z.string().trim().min(1).max(3000),
}).strict();
export type Delegation = { id: string; parent: string; version: number; run: number; attempt: number;
  agent: string; owner: string; requester: string; policy: string; sources: { id: string; revision: string }[];
  proposal: z.infer<typeof delegationProposal>; state: 'proposed' | 'assigned' | 'completed' | 'dismissed';
  child?: string; decidedBy?: string; outcome?: string; at: string };

/** Relationship ledger only. Super-agent owns child tickets; AutoLoop owns all executions. */
export class Delegations {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS workbench_delegation (
      id TEXT PRIMARY KEY, parent TEXT NOT NULL, value TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS workbench_delegation_parent ON workbench_delegation(parent);`);
  }
  get(id: string): Delegation | undefined {
    const row = this.db.prepare('SELECT value FROM workbench_delegation WHERE id=?').get(id);
    return row && JSON.parse(String(row.value));
  }
  list(parent?: string): Delegation[] {
    const rows = parent ? this.db.prepare('SELECT value FROM workbench_delegation WHERE parent=?').all(parent)
      : this.db.prepare('SELECT value FROM workbench_delegation').all();
    return rows.map(row => JSON.parse(String(row.value)));
  }
  pending(parent: string) { return this.list(parent).some(row => row.state === 'proposed' || row.state === 'assigned'); }
  save(row: Delegation) {
    this.db.prepare('INSERT INTO workbench_delegation VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(row.id, row.parent, JSON.stringify(row));
  }
}
