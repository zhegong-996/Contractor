/**
 * 评估模式（accept mode）+ 研判结果 → 处置（对齐 dsh-superagent `src/policy.ts`，MIT）。
 *
 * dsh 的 Eval 分两层：gate（确定性准入，本仓对应 `admission.ts`）与 assessment（模型研判）。
 * assessment 之外还有一层「accept mode」，决定一个「推断候选」被模型判定为可接之后，到底接不接：
 *
 *   - off      —— 推断候选一律不接（只接显式请求）；
 *   - observe（默认）—— 推断候选照常评估，但结果只记录成「would accept」的 ignore，不真接；
 *   - auto     —— 推断候选评估为可接就真接。
 *
 * 这是「渐进式上线」的关键：先 observe 看系统会怎么判，人工核对无误后再切 auto。
 * 显式请求（explicit）在任何模式下都接，不经过这层闸。
 */

export const ACCEPT_MODES = ['off', 'observe', 'auto'] as const;
export type AcceptMode = (typeof ACCEPT_MODES)[number];

/** 一次研判对单条规则给出的方向。 */
export interface RuleAssessment {
  ruleId: string;
  /** 该规则是否被这张卡片触及（matched）。 */
  matched: boolean;
  /** settled 方向：accept / ignore / stop；没定论就是 null。 */
  direction: 'accept' | 'ignore' | 'stop' | null;
  /** 意图证据：研判凭什么这么判（一句可审计的话）。 */
  evidence?: string;
}

export interface AssessmentInput {
  /** 这批触发里最强的一档：explicit 才有资格被直接接。 */
  strength: 'explicit' | 'inferred';
  acceptMode: AcceptMode;
  /** 每条启用的规则都要有判定，缺一条就是未完成。 */
  rules: readonly RuleAssessment[];
  /** 有哪些规则被启用（rules 必须逐条覆盖它们）。 */
  enabledRuleIds: readonly string[];
}

export type AssessmentOutcome =
  | { decision: 'accept'; wouldAccept: false; reason: string; matchedRules: string[] }
  | { decision: 'ignore'; wouldAccept: true; reason: string; matchedRules: string[] }
  | { decision: 'ignore'; wouldAccept: false; reason: string; matchedRules: string[] }
  | { decision: 'stop'; wouldAccept: false; reason: string; matchedRules: string[] }
  | { decision: 'unavailable'; wouldAccept: false; reason: string; matchedRules: string[] };

/**
 * 把模型的研判结果转成引擎可执行的处置（纯函数）。
 * 对齐 dsh `assessmentOutcome(assessment, settings, strength)`：
 *   - 每条启用规则都要有 settled 判定，缺任何一条 → unavailable；
 *   - 没有方向、或方向里没有 accept → ignore；
 *   - inferred 候选在非 auto 模式下，即便研判为 accept 也只记「would accept」；
 *   - 至少要有一条匹配规则 + 意图证据，才构成「可接」。
 */
export function assessmentOutcome(input: AssessmentInput): AssessmentOutcome {
  const { strength, acceptMode, rules, enabledRuleIds } = input;
  const byRule = new Map(rules.map(rule => [rule.ruleId, rule]));
  const matchedRules: string[] = [];
  let accepted = false;
  let stopped = false;

  // 每条启用的规则都必须有判定（对齐 dsh：assessment 要求每条规则都被判一次）。
  for (const ruleId of enabledRuleIds) {
    const rule = byRule.get(ruleId);
    if (!rule || !rule.direction) {
      return { decision: 'unavailable', wouldAccept: false,
        reason: `规则 ${ruleId} 缺少 settled 研判，本次评估不完整`, matchedRules: [] };
    }
    if (rule.matched) {
      matchedRules.push(ruleId);
      if (rule.direction === 'accept') accepted = true;
      if (rule.direction === 'stop') stopped = true;
    }
  }

  if (stopped) {
    return { decision: 'stop', wouldAccept: false,
      reason: `研判判定停止（规则 ${matchedRules.join(', ')} 命中且方向为 stop）`, matchedRules };
  }

  const noIntent = matchedRules.length === 0 || !rules.some(rule => rule.matched && Boolean(rule.evidence));
  if (!accepted || noIntent) {
    return { decision: 'ignore', wouldAccept: false,
      reason: noIntent ? '没有命中规则或缺少意图证据，忽略' : '没有命中可接的规则，忽略', matchedRules };
  }

  // 显式请求直接接；推断候选受 accept mode 约束。
  if (strength === 'explicit') {
    return { decision: 'accept', wouldAccept: false,
      reason: `显式请求，命中规则 ${matchedRules.join(', ')}`, matchedRules };
  }

  if (acceptMode === 'off') {
    return { decision: 'ignore', wouldAccept: false,
      reason: 'accept mode = off，推断候选不接', matchedRules };
  }
  if (acceptMode === 'observe') {
    return { decision: 'ignore', wouldAccept: true,
      reason: `观察模式：命中规则 ${matchedRules.join(', ')}，本应接单，仅记录不执行`, matchedRules };
  }
  return { decision: 'accept', wouldAccept: false,
    reason: `命中规则 ${matchedRules.join(', ')}，auto 模式接单`, matchedRules };
}

/** 该候选能不能被「直接接」（direct accept 只对 explicit 放行）。 */
export function canDirectAccept(strength: 'explicit' | 'inferred'): boolean {
  return strength === 'explicit';
}
