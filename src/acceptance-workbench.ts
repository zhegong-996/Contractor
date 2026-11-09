/**
 * 验收工作台（只读聚合）。
 *
 * 控制台的「验收 / 审查」视图需要一次拿到四类数据：开工前锁定的清单、
 * 逐项判定与证据、审查 Agent 编组、本机报告与沉淀标准。这里只做聚合与
 * 展示口径统一，不产生任何新的验收结论，也不改写清单或人签状态。
 *
 * 三条红线（与控制台只读边界一致）：
 *   - 逐项报告只是证据，不替代原发起人在原会话「确认验收」；
 *   - 独立评审者不得等于产出方；没有合格 Agent 时如实降级，不硬造；
 *   - 未锁定清单的任务不在这里伪造清单，沿用原发起人核可。
 */
import type { AcceptancePlan } from './acceptance-plan.ts';
import type { AcceptanceRound, JudgementStatus } from './acceptance-round.ts';
import type { ReviewCrew } from './agent-registry.ts';

export type WorkbenchItem = {
  id: string;
  name: string;
  criteria: string;
  required: boolean;
  evidenceKind: string;
  status: JudgementStatus | 'pending';
  reason: string;
  evidenceRefs: string[];
  regions: { x: number; y: number; width: number; height: number; note?: string }[];
};

export type AcceptanceWorkbenchInput = {
  taskId: string;
  plan: { plan: AcceptancePlan; revision: string } | null;
  round: AcceptanceRound | null;
  crew: ReviewCrew;
  report: {
    available: boolean;
    verdict: string | null;
    cases: number;
    createdAt: string | null;
    archivedRounds: number;
    selfCheckStandards: string[];
    reportUrl: string;
    note: string;
  } | null;
};

export type AcceptanceWorkbench = {
  schemaVersion: 1;
  taskId: string;
  plan: {
    locked: true;
    level: string;
    hash: string;
    revision: string;
    lockedAt: string;
    lockedBy: string;
    draftedBy: string | null;
    producerModel: string | null;
    reviewer: { model: string; differsFromProducer: boolean; requiresVision: boolean };
  } | null;
  items: WorkbenchItem[];
  round: {
    round: number;
    overall: string;
    createdAt: string;
    reviewer: { model: string; producerModel: string; requiresVision: boolean };
    rejected: { recheckItems: string[]; keepItems: string[]; closeTask: false };
  } | null;
  report: AcceptanceWorkbenchInput['report'];
  crew: {
    configured: boolean;
    degraded: string | null;
    reviewer: ReviewCrew['reviewer'];
    standardDrafter: ReviewCrew['standardDrafter'];
    inspector: ReviewCrew['inspector'];
    collaborators: ReviewCrew['collaborators'];
    redLines: string[];
    modelCalls: 0;
  };
  readiness: { ready: boolean; gaps: string[]; note: string };
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    pending: number;
  };
  selfCheckStandards: string[];
  notes: string[];
};

function standardsOf(round: AcceptanceRound | null): string[] {
  if (!round) return [];
  return [...new Set(round.judgements
    .filter(item => item.status !== 'passed' && item.reason)
    .map(item => `${item.name}：${item.reason}`))];
}

function readinessOf(input: AcceptanceWorkbenchInput): { ready: boolean; gaps: string[]; note: string } {
  const gaps: string[] = [];
  if (!input.plan) gaps.push('该任务没有开工前锁定的验收清单，沿用原发起人核可');
  if (!input.round) gaps.push('尚未完成独立逐项评审');
  if (input.plan && input.round) {
    if (input.round.planHash !== input.plan.plan.hash) gaps.push('验收清单已变更，本轮评审作废');
    if (input.round.overall !== 'passed') gaps.push('存在未通过或受阻项，不能生成通过用例');
    if (input.round.reviewer.model === input.round.reviewer.producerModel) gaps.push('评审者与产出方相同，本轮不成立');
    if (!input.round.reviewer.requiresVision) gaps.push('评审者不支持视觉输入，不满足独立评审要求');
  }
  return {
    ready: gaps.length === 0,
    gaps,
    note: gaps.length === 0
      ? '证据链已齐；最终核可仍由原发起人在原会话完成'
      : '未就绪项如实列出，不放宽、不用报告代替人签',
  };
}

export function buildAcceptanceWorkbench(input: AcceptanceWorkbenchInput): AcceptanceWorkbench {
  const plan = input.plan;
  const round = input.round;
  const byItem = new Map((round?.judgements ?? []).map(item => [item.itemId, item]));
  const items: WorkbenchItem[] = (plan?.plan.items ?? []).map(item => {
    const judgement = byItem.get(item.id);
    return {
      id: item.id,
      name: item.name,
      criteria: item.criteria,
      required: item.required,
      evidenceKind: String(item.evidenceKind),
      status: judgement?.status ?? 'pending',
      reason: judgement?.reason ?? '尚未评审',
      evidenceRefs: [...(judgement?.evidenceRefs ?? [])],
      regions: (judgement?.regions ?? []).map(region => ({
        x: region.x, y: region.y, width: region.width, height: region.height,
        ...(region.note ? { note: region.note } : {}),
      })),
    };
  });
  const count = (status: WorkbenchItem['status']) => items.filter(item => item.status === status).length;
  const summary = {
    total: items.length,
    passed: count('passed'),
    failed: count('failed'),
    blocked: count('blocked'),
    pending: count('pending'),
  };
  return {
    schemaVersion: 1,
    taskId: input.taskId,
    plan: plan ? {
      locked: true,
      level: plan.plan.level,
      hash: plan.plan.hash,
      revision: plan.revision,
      lockedAt: plan.plan.lockedAt,
      lockedBy: plan.plan.lockedBy,
      draftedBy: plan.plan.draftedBy ?? null,
      producerModel: plan.plan.producerModel ?? null,
      reviewer: { ...plan.plan.reviewer },
    } : null,
    items,
    round: round ? {
      round: round.round,
      overall: round.overall,
      createdAt: round.createdAt,
      reviewer: { ...round.reviewer },
      rejected: {
        recheckItems: round.judgements.filter(item => item.status !== 'passed').map(item => item.itemId),
        keepItems: round.judgements.filter(item => item.status === 'passed').map(item => item.itemId),
        closeTask: false,
      },
    } : null,
    report: input.report ? {
      ...input.report,
      selfCheckStandards: [...input.report.selfCheckStandards],
    } : null,
    crew: {
      configured: input.crew.configured,
      degraded: input.crew.degraded,
      reviewer: input.crew.reviewer,
      standardDrafter: input.crew.standardDrafter,
      inspector: input.crew.inspector,
      collaborators: input.crew.collaborators,
      redLines: [...input.crew.redLines],
      modelCalls: 0,
    },
    readiness: readinessOf(input),
    summary,
    selfCheckStandards: [...new Set([
      ...standardsOf(round),
      ...(input.report?.selfCheckStandards ?? []),
    ])].slice(0, 20),
    notes: [
      '本页只读：逐项报告是证据，不替代原发起人在原会话「确认验收」',
      '审查 Agent 按当前编制解析；空编制如实降级到既有服务式验收，不硬造',
      '证据区域是截图坐标与说明，便于下一轮从同一位置复看',
    ],
  };
}
