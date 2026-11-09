/**
 * G2 结果回流的最后一环：把对账结论接进决策上下文。
 *
 * 差距分析 G2 说「结果回流不闭环」——产物登记、巡检、对账各自为政，
 * 对账结论没变成可复用的决策上下文。这里补上那根线：
 * 对账（reconcile）的结论 → 一个 acceptance 决策点的 contextRefs，
 * 让「这次验收对账发现了什么」成为后续决策（验收、转交、跨域）必须看到的东西。
 *
 * 纯函数：只产出决策点所需的字段，落盘由调用方做。
 */
import { openDecision, type DecisionPoint } from './decision-point.ts';
import type { ReconcileResult } from './reconcile.ts';

/** 把对账结论转成一条决策点（kind=acceptance，pending 状态，等独立评审者拍板）。 */
export function openReconcileDecision(input: {
  result: ReconcileResult;
  subject: string;
  domain?: string;
  artifactRef?: string | null;
  at?: string;
}): DecisionPoint {
  const contextRefs: string[] = [];
  contextRefs.push(input.result.conclusion);
  if (input.artifactRef) contextRefs.push(`产物：${input.artifactRef}`);
  for (const finding of input.result.findings) {
    contextRefs.push(`${finding.kind}:${finding.id}「${finding.name}」— ${finding.detail}`);
  }
  if (!input.result.comparable) contextRefs.push('无产物可比对：这不是核对通过');

  const outcome = input.result.comparable && input.result.counts.missing + input.result.counts.extra
    + input.result.counts.unpassed + input.result.counts.pending === 0
    ? 'clean' : 'findings';

  return openDecision({
    subject: input.subject,
    kind: 'acceptance',
    domain: input.domain ?? 'default',
    contextRefs,
    at: input.at,
  });
}

/** 对账结论 → 一行可聚合的决策审计记录（与 decisionRecord 同构）。 */
export function reconcileDecisionRecord(input: {
  result: ReconcileResult;
  subject: string;
  domain?: string;
  decidedBy: string;
}): { kind: 'acceptance'; domain: string; decidedBy: string; outcome: string; reason: string } {
  const outcome = input.result.comparable ? 'findings' : 'not-comparable';
  return {
    kind: 'acceptance',
    domain: input.domain?.trim() || 'default',
    decidedBy: input.decidedBy,
    outcome,
    reason: input.result.conclusion,
  };
}
