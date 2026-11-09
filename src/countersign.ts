/**
 * 会签与分歧仲裁（G5 的一部分）：多 Agent 独立判断，一致才通过，分歧升级给独立评审者。
 *
 * 出处：验收层已有「独立评审者」「会签」的雏形，这里把它们从验收域抽象到通用决策域。
 * 核心约束：
 * - 会签是「多份独立判断」，不是「一个答案被抄 N 遍」——同一判断者重复投票只算一次。
 * - 一票否决：只要有一份 deny（在 required 项上），整体即 deny，不靠多数票洗白。
 * - 分歧（deadlock）必须升级仲裁，不猜、不取平均。
 * - 仲裁只有独立评审者能做，且只解决「卡住的这一票」，不替代会签本身。
 */
export type VerdictOutcome = 'allow' | 'deny';
export interface Verdict {
  by: string;
  outcome: VerdictOutcome;
  reason: string;
  at?: string;
}

export interface CountersignResult {
  quorum: number;
  collected: number;
  allows: number;
  denies: number;
  verdict: 'allow' | 'deny' | 'deadlock';
  /** 反对意见原文，deadlock/deny 时给人看。 */
  reasons: string[];
  /** 判断者名单（去重后）。 */
  reviewers: string[];
}

const byId = (judgements: readonly Verdict[]): Verdict[] => {
  const seen = new Map<string, Verdict>();
  for (const judgement of judgements) {
    if (!judgement.by) continue;
    seen.set(judgement.by, judgement);          // 同一判断者重复投票，只算最后一次
  }
  return [...seen.values()];
};

/**
 * 会签计票。
 * @param quorum 达到这个判断者数量才构成有效会签。
 * @param unanimous 是否要求全票 allow。
 * @param disagree 有反对票时的处理：`veto`（默认，一票否决）或 `arbitrate`（分歧升级仲裁）。
 */
export function tallyVerdicts(judgements: readonly Verdict[], options: {
  quorum?: number; unanimous?: boolean; disagree?: 'veto' | 'arbitrate';
} = {}): CountersignResult {
  const distinct = byId(judgements);
  const quorum = options.quorum ?? 1;
  const allows = distinct.filter(item => item.outcome === 'allow').length;
  const denies = distinct.filter(item => item.outcome === 'deny').length;
  const reasons = distinct.filter(item => item.outcome === 'deny').map(item => item.reason);
  const reviewers = distinct.map(item => item.by);

  let verdict: CountersignResult['verdict'];
  if (distinct.length < quorum) verdict = 'deadlock';                 // 人数不够，等
  else if (denies > 0) {
    verdict = options.disagree === 'arbitrate' && allows > 0 ? 'deadlock' : 'deny';
  } else if (options.unanimous && allows < distinct.length) verdict = 'deadlock';
  else verdict = 'allow';

  return { quorum, collected: distinct.length, allows, denies, verdict, reasons, reviewers };
}

export interface ArbitrationResult {
  verdict: 'allow' | 'deny';
  /** 是仲裁（independent-reviewer 定），不是会签一致通过。 */
  arbitrated: boolean;
  reviewer: string;
  reason: string;
  /** 会签阶段卡在哪。 */
  deadlockReason: string;
}

/**
 * 分歧仲裁：只有会签 deadlock 时才能调用；仲裁者必须是独立评审者（调用方保证）。
 * 仲裁解决的是「卡住的这一票」，结果单独标记 arbitrated，不与会签通过混淆。
 */
export function arbitrate(deadlock: CountersignResult, reviewer: Verdict): ArbitrationResult {
  if (deadlock.verdict !== 'deadlock') {
    throw new Error('会签没有卡住，不能启动仲裁');
  }
  return {
    verdict: reviewer.outcome,
    arbitrated: true,
    reviewer: reviewer.by,
    reason: reviewer.reason,
    deadlockReason: `会签 ${deadlock.collected}/${deadlock.quorum} 人，`
      + (deadlock.denies > 0 ? `${deadlock.denies} 票反对` : '未达人数或未全票一致'),
  };
}
