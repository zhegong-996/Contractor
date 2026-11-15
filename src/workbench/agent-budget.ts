import type { DatabaseSync } from 'node:sqlite';
import type { Usage } from '../../upstream/autoloop/protocol/validate.ts';

export type BudgetKind = 'platform' | 'personal' | 'execution';
export type BudgetPeriod = 'day' | 'month';
export type BudgetPool = { kind: BudgetKind; subject: string };
type Charge = BudgetPool & { run: number; attempt: number; project: string; owner: string; ticket?: string; device?: string };

function cycle(period: BudgetPeriod, at: number) {
  const local = new Date(at + 8 * 3600_000).toISOString().slice(0, 10);
  return Date.parse((period === 'day' ? local : local.slice(0, 7) + '-01') + 'T00:00:00+08:00');
}

export class AgentBudgets {
  constructor(private readonly db: DatabaseSync, private readonly now = Date.now) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_budget_pool (
        kind TEXT NOT NULL, subject TEXT NOT NULL, period TEXT NOT NULL, attempts INTEGER NOT NULL,
        by_actor TEXT NOT NULL, changed INTEGER NOT NULL, PRIMARY KEY(kind,subject)
      );
      CREATE TABLE IF NOT EXISTS workbench_budget_charge (
        run INTEGER NOT NULL, attempt INTEGER NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL,
        project TEXT NOT NULL, owner TEXT NOT NULL, ticket TEXT, device TEXT, opened INTEGER NOT NULL,
        settled INTEGER, outcome TEXT, tokens INTEGER, amount REAL, PRIMARY KEY(run,attempt)
      );
      CREATE INDEX IF NOT EXISTS workbench_budget_charge_pool ON workbench_budget_charge(kind,subject,opened);
    `);
    if (!db.prepare('PRAGMA table_info(workbench_budget_pool)').all().some(column => column.name === 'max_minutes'))
      db.exec('ALTER TABLE workbench_budget_pool ADD COLUMN max_minutes INTEGER');
  }

  set(pool: BudgetPool, by: string, period: BudgetPeriod, attempts: number | null, maxMinutes?: number) {
    if (attempts === null) {
      this.db.prepare('DELETE FROM workbench_budget_pool WHERE kind=? AND subject=?').run(pool.kind, pool.subject);
    } else {
      this.db.prepare('INSERT OR REPLACE INTO workbench_budget_pool VALUES (?,?,?,?,?,?,?)')
        .run(pool.kind, pool.subject, period, attempts, by, this.now(), maxMinutes ?? null);
    }
  }

  view(pool: BudgetPool) {
    const policy = this.db.prepare('SELECT period,attempts,max_minutes FROM workbench_budget_pool WHERE kind=? AND subject=?').get(pool.kind, pool.subject);
    const period = policy?.period === 'day' ? 'day' : 'month';
    const since = cycle(period, this.now());
    const row = this.db.prepare(`SELECT COUNT(*) AS calls, COUNT(*)-COUNT(settled) AS pending,
      COALESCE(SUM(tokens),0) AS tokens, COUNT(tokens) AS tokenReceipts, COALESCE(SUM(amount),0) AS amount,
      COUNT(settled)-COUNT(amount) AS unpriced FROM workbench_budget_charge WHERE kind=? AND subject=? AND opened>=?`)
      .get(pool.kind, pool.subject, since)!;
    const used = Number(row.calls);
    const limit = policy ? Number(policy.attempts) : null;
    return { ...pool, period, since, limit, used, remaining: limit === null ? null : Math.max(0, limit - used),
      maxMinutes: typeof policy?.max_minutes === 'number' ? policy.max_minutes : null,
      pending: Number(row.pending), tokens: Number(row.tokens), tokenReceipts: Number(row.tokenReceipts),
      knownAmount: Number(row.amount), unpriced: Number(row.unpriced) };
  }

  boundTimeout(pool: BudgetPool, timeout = 8) {
    const row = this.db.prepare('SELECT max_minutes FROM workbench_budget_pool WHERE kind=? AND subject=?').get(pool.kind, pool.subject);
    return typeof row?.max_minutes === 'number' ? Math.min(row.max_minutes, timeout) : timeout;
  }

  /** The caller uses the same transaction that records the execution snapshot. */
  reserve(charge: Charge): boolean {
    const existing = this.db.prepare('SELECT kind,subject,project,owner,ticket,device FROM workbench_budget_charge WHERE run=? AND attempt=?')
      .get(charge.run, charge.attempt);
    if (existing) return existing.kind === charge.kind && existing.subject === charge.subject && existing.project === charge.project
      && existing.owner === charge.owner && existing.ticket === (charge.ticket ?? null) && existing.device === (charge.device ?? null);
    if (this.view(charge).remaining === 0) return false;
    this.db.prepare(`INSERT INTO workbench_budget_charge(run,attempt,kind,subject,project,owner,ticket,device,opened)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(charge.run, charge.attempt, charge.kind, charge.subject, charge.project,
      charge.owner, charge.ticket ?? null, charge.device ?? null, this.now());
    return true;
  }

  settle(run: number, attempt: number, outcome: string, usage?: Usage) {
    const tokens = usage?.input === undefined && usage?.output === undefined ? null : (usage.input ?? 0) + (usage.output ?? 0);
    this.db.prepare(`UPDATE workbench_budget_charge SET settled=?,outcome=?,tokens=?,amount=?
      WHERE run=? AND attempt=? AND settled IS NULL`).run(this.now(), outcome, tokens, usage?.cost ?? null, run, attempt);
  }
}
