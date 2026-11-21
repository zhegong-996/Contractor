import type { SuperAgentStore } from '../superagent-ports.ts';
import { budgetCycle, type BudgetPeriod } from './agent-budget.ts';

export type BudgetAlert = {
  key: string; project: string; scope: string; level: 'warn' | 'critical'; at: string; detail: string;
};

const warnFraction = 0.2;
const criticalFraction = 0.05;

/**
 * 额度阈值告警：剩余低于 20% 告警、低于 5% 严重告警。同一周期内同一池只告警一次，
 * 键中包含周期起点，新周期自动重新评估。不替代硬停，只把风险提前放到使用页。
 */
export function openBudgetAlerts(store: Pick<SuperAgentStore, 'db'>) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_budget_alert (
      key TEXT PRIMARY KEY, project TEXT NOT NULL, scope TEXT NOT NULL, level TEXT NOT NULL,
      at TEXT NOT NULL, detail TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workbench_budget_alert_project ON workbench_budget_alert(project, at);
  `);
  const consider = (project: string, scope: string, label: string, unit: string, period: BudgetPeriod,
    limit: number | null, used: number, remaining: number | null, now: number): BudgetAlert | undefined => {
    if (limit === null || limit <= 0 || remaining === null) return;
    const fraction = remaining / limit;
    const level = fraction <= criticalFraction ? 'critical' as const : fraction <= warnFraction ? 'warn' as const : undefined;
    if (!level) return;
    const cycle = new Date(budgetCycle(period, now)).toISOString().slice(0, 10);
    const key = [project, scope, cycle, level].join('@');
    if (store.db.prepare('SELECT 1 FROM workbench_budget_alert WHERE key=?').get(key)) return;
    const record: BudgetAlert = { key, project, scope, level, at: new Date(now).toISOString(),
      detail: label + '剩余 ' + remaining.toFixed(remaining >= 100 ? 0 : 1) + ' ' + unit
        + '（已用 ' + used.toFixed(used >= 100 ? 0 : 1) + ' / ' + limit.toFixed(limit >= 100 ? 0 : 1) + '）' };
    store.db.prepare('INSERT OR IGNORE INTO workbench_budget_alert VALUES (?,?,?,?,?,?)')
      .run(record.key, record.project, record.scope, record.level, record.at, record.detail);
    return record;
  };
  const recent = (project: string, limit = 40): BudgetAlert[] => store.db.prepare(
    'SELECT key, project, scope, level, at, detail FROM workbench_budget_alert WHERE project=? ORDER BY at DESC LIMIT ?',
  ).all(project, Math.min(limit, 200)).map(row => ({
    key: String(row.key), project: String(row.project), scope: String(row.scope),
    level: row.level as BudgetAlert['level'], at: String(row.at), detail: String(row.detail),
  }));
  return { consider, recent };
}
