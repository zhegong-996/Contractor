// 「要不要引入 LobeHub 三层（Personal / Supervisor / Worker）」的可执行判断。
//
// 只参考 LobeHub 的产品思想（三层汇报、Workspace + Task），不复制任何代码：
// 主仓库是 Community License，衍生分发需商业授权。判断依据来自真实路由
// Trace，不是文档印象；每次跑都给出可执行的前置条件清单。
//
// 反面依据：玉伯 OPT 访谈中人是「监工」、同时管 5 个 Agent 已达带宽上限、
// 「暂无法实现 Agent 自主管理 Agent」。因此三层不是默认答案，必须满足前置条件。
import { replayRouting, readRoutingEvents, type RoutingProjection } from './routing-trace.ts';
import { decisionOf } from './routing-decision.ts';
import type { MemoryEvent } from './architecture-contracts.ts';

export const THREE_TIER_STAGES = ['intake', 'admission', 'dispatch', 'delegation', 'transfer'] as const;

export type Prerequisite = { id: string; label: string; satisfied: boolean; evidence: string };
export type ThreeTierAssessment = {
  recommended: boolean;
  verdict: string;
  coverage: number;
  prerequisites: Prerequisite[];
  observed: {
    decisions: number;
    stagesCovered: string[];
    intakeFromPersonal: number;
    supervisorDispatches: number;
    humanSignatureRate: number;
    singleRouterEntry: boolean;
  };
  reasons: string[];
};

export function assessThreeTier(events: MemoryEvent[], projection: RoutingProjection = replayRouting(events),
  logErrors: string[] = []): ThreeTierAssessment {
  const decisions = events.map(decisionOf).filter(d => d !== null);
  const stagesCovered = THREE_TIER_STAGES.filter(s => (projection.byStage[s] ?? 0) > 0);
  const intakeFromPersonal = decisions.filter(d => d.stage === 'intake' && d.caller.role === 'personal').length;
  const supervisorDispatches = decisions.filter(d => d.caller.role === 'supervisor').length;
  const signatureRate = decisions.length ? decisions.filter(d => d.requiresHumanSignature).length / decisions.length : 0;
  const signatureReasonsComplete = decisions.filter(d => d.requiresHumanSignature).every(d => Boolean(d.signatureReason));
  // 现状：五个调用点各自直接写 Trace，没有单一 Router 入口。这个前置条件恒为 false，
  // 直到 C 阶段把入口收敛；不靠配置变量假装已经满足。
  const singleRouterEntry = false;
  const prerequisites: Prerequisite[] = [
    { id: 'p1-routing-coverage', label: '五个派活阶段都有统一决策记录',
      satisfied: stagesCovered.length === THREE_TIER_STAGES.length,
      evidence: `已覆盖 ${stagesCovered.length}/${THREE_TIER_STAGES.length}：${stagesCovered.join(', ') || '无'}` },
    { id: 'p2-memory-replay', label: 'B 阶段记忆事件可重放且日志无坏行',
      satisfied: projection.events > 0 && projection.decisions > 0
        && projection.uniqueDecisions === projection.decisions && logErrors.length === 0,
      evidence: `events=${projection.events}, 去重后决策=${projection.decisions}, 坏行=${logErrors.length}` },
    { id: 'p3-personal-entry', label: '存在 Personal Agent 作为唯一人机入口',
      satisfied: intakeFromPersonal > 0,
      evidence: `intake 且 caller.role=personal 的决策 ${intakeFromPersonal} 条` },
    { id: 'p4-supervisor-dispatch', label: '主管 Agent 已承担派活与交接',
      satisfied: supervisorDispatches > 0, evidence: `supervisor 作为调用方 ${supervisorDispatches} 条` },
    { id: 'p5-human-signature', label: '高风险动作全部保留人签字与理由',
      satisfied: signatureRate > 0 && signatureReasonsComplete,
      evidence: `人签比例 ${(signatureRate * 100).toFixed(1)}%，理由完整=${signatureReasonsComplete}` },
    { id: 'p6-single-router', label: '入口已收敛为单一 Router（C 阶段）',
      satisfied: singleRouterEntry, evidence: '当前五个调用点各自构造决策，尚未有统一 Router 类' },
    { id: 'p7-license', label: 'LobeHub 仅借思想、不复制代码',
      satisfied: true, evidence: 'Community License：衍生分发需商业授权；本项目零代码引用' },
  ];
  const coverage = prerequisites.filter(p => p.satisfied).length / prerequisites.length;
  const recommended = prerequisites.every(p => p.satisfied);
  const reasons = recommended
    ? ['全部前置条件满足，可在 C 阶段以 A2A handoff 实现三层汇报。']
    : [
      '现在不引入三层：先把 5 个派活点统一到一份 RoutingDecision 与一份 Trace，避免三层各写一套记忆接口把混乱放大三倍。',
      'LobeHub 主仓库为 Community License，只能参考三层汇报的产品思想，不复制代码。',
      '玉伯 OPT 访谈：人是「监工」，同时管 5 个 Agent 已达带宽上限，且「暂无法实现 Agent 自主管理 Agent」；必须保留人工插手与高风险签字。',
      '当前入口是人经飞书 IM 直达 Bridge，没有 Personal Agent 实体；supervisor 派活还没有真实链路。',
      '方案 B 的 append-only 事件主干尚未通过重放验收；C 必须建立在 B 的统一契约上。',
    ];
  return {
    recommended, coverage, prerequisites, reasons,
    verdict: recommended ? '可引入三层（进入 C 阶段实现）' : '暂不引入三层：继续 A 的契约收敛并先完成 B',
    observed: { decisions: decisions.length, stagesCovered: [...stagesCovered],
      intakeFromPersonal, supervisorDispatches, humanSignatureRate: signatureRate, singleRouterEntry },
  };
}

/** CLI / 设置页入口：直接读当前真实 Trace 做判断。 */
export function assessCurrentRouting(file?: string): ThreeTierAssessment & { logErrors: string[] } {
  const { events, errors } = readRoutingEvents(file);
  return { ...assessThreeTier(events, replayRouting(events), errors), logErrors: errors };
}
