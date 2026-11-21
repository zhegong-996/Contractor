import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Usage } from './execution/protocol.ts';
import { budgetCycle, type BudgetPeriod } from './agent-budget.ts';

const scale = 1000;
const scopeKind = z.enum(['project', 'platform', 'personal', 'execution', 'agent']);
const name = z.string().trim().min(1).max(100);
const points = z.number().min(0).max(1_000_000_000).multipleOf(0.001);
const basis = z.object({
  provider: name, model: name, multiplier: z.number().min(0.001).max(100).multipleOf(0.001),
  reserveTokens: z.number().int().min(1).max(10_000_000),
}).strict();
export const pointPolicyInput = z.object({ enabled: z.boolean().optional(), tokensPerPoint: z.number().int().min(1).max(10_000_000), rates: z.array(basis).max(200) }).strict()
  .refine(({ rates }) => new Set(rates.map(r => JSON.stringify([r.provider, r.model]))).size === rates.length, '同一供应商的同一模型只能配置一个倍率');
export const pointPolicyUpdate = pointPolicyInput.safeExtend({ revision: z.string().regex(/^[a-f0-9]{64}$/).optional() });
export const pointScopeInput = z.object({ kind: scopeKind, subject: name }).strict();
export const pointLimitInput = pointScopeInput.extend({ period: z.enum(['day', 'month']), limit: points.nullable(),
  revision: z.number().int().nonnegative() }).strict();
export type PointPolicy = z.infer<typeof pointPolicyInput>;
export type PointLimit = Omit<z.infer<typeof pointLimitInput>, 'revision'> & { revision?: number };
export type PointScope = Pick<PointLimit, 'kind' | 'subject'>;
type Rate = z.infer<typeof basis> & { tokensPerPoint: number };
export type PointQuote = Rate & { reserved: number };
type ChargeState = 'reserved' | 'metered' | 'partial' | 'unreported' | 'not-launched';

const measure = (tokens: number, rate: Rate) => {
  const numerator = BigInt(tokens) * BigInt(Math.round(rate.multiplier * scale));
  const denominator = BigInt(rate.tokensPerPoint);
  return Number((numerator + denominator - 1n) / denominator);
};

/** Reserve and settle in the same transactions as the existing AutoLoop attempt ledger. */
export class TokenPoints {
  constructor(private readonly db: DatabaseSync, private readonly now = Date.now) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_point_policy (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workbench_point_limit (
        kind TEXT NOT NULL, subject TEXT NOT NULL, period TEXT NOT NULL, units INTEGER NOT NULL, PRIMARY KEY(kind,subject)
      );
      CREATE TABLE IF NOT EXISTS workbench_point_limit_revision (
        kind TEXT NOT NULL, subject TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(kind,subject)
      );
      CREATE TABLE IF NOT EXISTS workbench_point_charge (
        run INTEGER NOT NULL, attempt INTEGER NOT NULL, quote TEXT NOT NULL, reserved INTEGER NOT NULL, billed INTEGER,
        tokens INTEGER, state TEXT NOT NULL DEFAULT 'reserved', PRIMARY KEY(run,attempt)
      );
    `);
  }

  policy(): PointPolicy {
    const row = this.db.prepare('SELECT value FROM workbench_point_policy WHERE id=1').get();
    const policy: PointPolicy = row ? JSON.parse(String(row.value)) : { tokensPerPoint: 1000, rates: [] };
    // Preserve already configured installations without charging any historical attempts.
    return { ...policy, enabled: policy.enabled ?? policy.rates.length > 0 };
  }

  status() {
    return { enabled: this.policy().enabled === true, settlement: 'receipt' as const,
      overrunPolicy: 'record-actual-block-next' as const, historicalBackcharge: false,
      hardTokenStop: false };
  }

  setPolicy(policy: PointPolicy) {
    const exists = this.db.prepare('SELECT 1 FROM workbench_point_policy WHERE id=1').get();
    const enabled = policy.enabled ?? (exists ? this.policy().enabled : policy.rates.length > 0);
    this.db.prepare('INSERT OR REPLACE INTO workbench_point_policy VALUES (1,?)').run(JSON.stringify({ ...policy, enabled }));
  }

  revision({ kind, subject }: PointScope) {
    return Number(this.db.prepare('SELECT revision FROM workbench_point_limit_revision WHERE kind=? AND subject=?').get(kind, subject)?.revision ?? 0);
  }

  setLimit({ kind, subject, period, limit }: PointLimit) {
    if (limit === null) this.db.prepare('DELETE FROM workbench_point_limit WHERE kind=? AND subject=?').run(kind, subject);
    else this.db.prepare('INSERT OR REPLACE INTO workbench_point_limit VALUES (?,?,?,?)').run(kind, subject, period, Math.round(limit * scale));
    this.db.prepare(`INSERT INTO workbench_point_limit_revision VALUES (?,?,1)
      ON CONFLICT(kind,subject) DO UPDATE SET revision=revision+1`).run(kind, subject);
  }

  view(scope: PointScope) {
    const policy = this.db.prepare('SELECT period,units FROM workbench_point_limit WHERE kind=? AND subject=?').get(scope.kind, scope.subject);
    const period: BudgetPeriod = policy?.period === 'day' ? 'day' : 'month';
    const since = budgetCycle(period, this.now());
    const [filter, args] = scope.kind === 'project' ? ['c.project=?', [scope.subject]]
      : scope.kind === 'agent' ? ['c.project=? AND c.agent=?', scope.subject.split('/')]
      : ['c.kind=? AND c.subject=?', [scope.kind, scope.subject]];
    const row = this.db.prepare(`SELECT COALESCE(SUM(p.billed),0) AS billed, COALESCE(SUM(p.reserved),0) AS reserved,
      COALESCE(SUM(p.tokens),0) AS tokens, COUNT(*) FILTER (WHERE p.state IN ('partial','unreported')) AS incomplete
      FROM workbench_point_charge p JOIN workbench_budget_charge c ON c.run=p.run AND c.attempt=p.attempt
      WHERE ${filter} AND c.opened>=?`).get(...args, since)!;
    const limit = policy ? Number(policy.units) : null;
    const billed = Number(row.billed), reserved = Number(row.reserved);
    const enabled = this.policy().enabled === true;
    return { ...scope, revision: this.revision(scope), enabled, enforced: enabled && limit !== null, period, since, limit: limit === null ? null : limit / scale, used: billed / scale,
      reserved: reserved / scale, tokens: Number(row.tokens), incomplete: Number(row.incomplete),
      overLimit: limit === null ? 0 : Math.max(0, billed - limit) / scale,
      blocked: enabled && limit !== null && billed + reserved >= limit,
      remaining: limit === null ? null : Math.max(0, limit - billed - reserved) / scale };
  }

  quote(provider: string | undefined, model: string | undefined): PointQuote | undefined {
    const policy = this.policy();
    if (!policy.enabled) return;
    const rate = policy.rates.find(item => item.provider === provider && item.model === model);
    if (!rate) return;
    const exact = { ...rate, tokensPerPoint: policy.tokensPerPoint };
    return { ...exact, reserved: measure(rate.reserveTokens, exact) };
  }

  estimate(quote: PointQuote | undefined) {
    return quote ? quote.reserved / scale : undefined;
  }

  admit(scopes: PointScope[], quote?: PointQuote, checkQuote = false) {
    if (!this.policy().enabled) return;
    if (checkQuote && !quote) return '实际选用的模型尚未配置 Token 积分倍率';
    for (const scope of scopes) {
      const budget = this.view(scope);
      if (budget.remaining === null) continue;
      const label = { project: '项目总积分', platform: '平台整理积分', personal: '个人代办积分', execution: '项目执行积分', agent: '当前 Agent 积分' }[scope.kind];
      if (budget.remaining === 0) return label + '已用尽或已全部预留';
      if (quote && Math.round(budget.remaining * scale) < quote.reserved) return label + '余额不足，无法预留此模型所需积分';
    }
  }

  reserve(run: number, attempt: number, quote?: PointQuote) {
    if (quote) this.db.prepare('INSERT OR IGNORE INTO workbench_point_charge (run,attempt,quote,reserved) VALUES (?,?,?,?)')
      .run(run, attempt, JSON.stringify(quote), quote.reserved);
  }

  settle(run: number, attempt: number, engine: string, usage?: Usage, partial = false, notLaunched = false) {
    const row = this.db.prepare("SELECT quote FROM workbench_point_charge WHERE run=? AND attempt=? AND state='reserved'").get(run, attempt);
    if (!row) return;
    const quote: PointQuote = JSON.parse(String(row.quote));
    // Codex input already includes cache reads. Claude's adapter emits cache as a separate input count.
    const raw = usage ? (usage.input ?? 0) + (usage.output ?? 0) + (engine === 'claude' ? usage.cached ?? 0 : 0) : 0;
    const measured = Number.isSafeInteger(raw) && raw >= 0 && raw <= 1_000_000_000
      && (usage?.input !== undefined || usage?.output !== undefined);
    const tokens = notLaunched ? 0 : measured ? raw : null;
    const billed = tokens === null ? null : measure(tokens, quote);
    const state: ChargeState = notLaunched ? 'not-launched' : !measured ? 'unreported'
      : partial || usage?.input === undefined || usage?.output === undefined ? 'partial' : 'metered';
    const reserved = state === 'partial' || state === 'unreported' ? Math.max(0, quote.reserved - (billed ?? 0)) : 0;
    this.db.prepare('UPDATE workbench_point_charge SET state=?,reserved=?,billed=?,tokens=? WHERE run=? AND attempt=?')
      .run(state, reserved, billed, tokens, run, attempt);
  }

  receipts(project: string) {
    return this.db.prepare(`SELECT p.* FROM workbench_point_charge p JOIN workbench_budget_charge c ON c.run=p.run AND c.attempt=p.attempt
      WHERE c.project=? ORDER BY p.run,p.attempt`).all(project).map(row => {
        const { reserved: original, ...rate }: PointQuote = JSON.parse(String(row.quote));
        return { run: Number(row.run), attempt: Number(row.attempt), ...rate, state: row.state as ChargeState,
          initialReservation: original / scale, outstanding: Number(row.reserved) / scale, tokens: row.tokens as number | null,
          overReservation: row.billed === null ? null : Math.max(0, Number(row.billed) - original) / scale,
          charged: row.billed === null ? null : Number(row.billed) / scale };
      });
  }
}
