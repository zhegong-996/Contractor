// 验收成本闸（对齐 lobehub/acceptance 的 resource-guard + delegation budget，Apache-2.0 借概念）。
//
// 视觉评审按量计费、长验收跑会越跑越重：不设上限，一次 run 能把额度绕光、把机器拖到 swap。
// 这里只做「纯判定」：green 继续、yellow 预警回收、red 只留证不 pass（未执行的检查标 blocked，绝不标 passed）。

export interface AcceptanceBudget {
  /** 视觉评审最多审几张截图。 */
  maxImages: number;
  /** 最多花多少 token（含 reasoning）。 */
  maxTokens: number;
  /** 最多跑多久（毫秒）。 */
  maxDurationMs: number;
}

export interface BudgetUsage {
  images: number;
  tokens: number;
  durationMs: number;
}

export type BudgetTier = 'green' | 'yellow' | 'red';

export interface BudgetStatus {
  tier: BudgetTier;
  used: BudgetUsage;
  /** red 时 true：只留证不 pass，未执行的检查标 blocked。 */
  blocked: boolean;
  reason: string;
}

/** yellow 阈值：达到预算的 80% 即预警。 */
const YELLOW_RATIO = 0.8;

export function budgetStatus(used: BudgetUsage, budget: AcceptanceBudget): BudgetStatus {
  const over = {
    images: used.images > budget.maxImages,
    tokens: used.tokens > budget.maxTokens,
    durationMs: used.durationMs > budget.maxDurationMs,
  };
  if (over.images || over.tokens || over.durationMs) {
    const which = [over.images && '图片', over.tokens && 'token', over.durationMs && '时长'].filter(Boolean).join('/');
    return { tier: 'red', used, blocked: true,
      reason: `超出预算（${which}）：已用 ${used.images} 图 / ${used.tokens} token / ${Math.round(used.durationMs / 1000)}s，只保留已得证据，未执行的检查标 blocked，不得标通过` };
  }
  const near = used.images >= budget.maxImages * YELLOW_RATIO
    || used.tokens >= budget.maxTokens * YELLOW_RATIO
    || used.durationMs >= budget.maxDurationMs * YELLOW_RATIO;
  if (near) {
    return { tier: 'yellow', used, blocked: false,
      reason: '接近预算上限，应回收（关闭空闲会话、丢弃最旧帧）后再继续' };
  }
  return { tier: 'green', used, blocked: false, reason: '' };
}

/** 预算内继续；red 时拒绝继续，返回原因（不静默跳过）。 */
export function withinBudget(used: BudgetUsage, budget: AcceptanceBudget): { ok: boolean; reason: string } {
  const status = budgetStatus(used, budget);
  return status.blocked ? { ok: false, reason: status.reason } : { ok: true, reason: '' };
}

export const DEFAULT_ACCEPTANCE_BUDGET: AcceptanceBudget = {
  maxImages: 20,
  maxTokens: 200_000,
  maxDurationMs: 30 * 60_000,
};
