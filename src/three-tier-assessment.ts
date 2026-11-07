// 「当前组织形态是否按其配置闭环 / 是否可以启用三层」的可执行判断。
//
// 只参考 LobeHub 的产品思想（三层汇报、Workspace + Task），不复制任何代码：
// 主仓库是 Community License，衍生分发需商业授权。判断依据来自真实路由
// Trace 与 C-4 的真实在岗编制，不是文档印象，也不是角色名凑数。
//
// C-5（用户 2026-11-07 拍板）：层是配置，不是产品骨架。P3 / P4 改为按当前
// `config.router.mode` 判定——扁平配置下**不要求出现 supervisor**，否则会逼
// 10 人团队硬造管理层；分层配置下主管派活必须同时是「配置登记」且「真实在岗
// 带 supervisor 职责」的 Agent，合成数据凑不齐。`recommended` 只表示「当前
// 分层配置已被真实证据支撑、可正式启用三层」，绝不等于「建议所有团队升级」。
//
// 反面依据：玉伯 OPT 访谈中人是「监工」、同时管 5 个 Agent 已达带宽上限、
// 「暂无法实现 Agent 自主管理 Agent」。因此三层不是默认答案，必须满足前置条件。
import { replayRouting, readRoutingEvents, type RoutingProjection } from './routing-trace.ts';
import { decisionOf } from './routing-decision.ts';
import { planCoverage, type Router } from './router.ts';
import { onDuty, type AgentRegistry } from './agent-registry.ts';
import type { MemoryEvent } from './architecture-contracts.ts';

export const THREE_TIER_STAGES = ['intake', 'admission', 'dispatch', 'delegation', 'transfer'] as const;

export type OrgShape = 'unspecified' | 'legacy' | 'flat' | 'layered';
export const ORG_SHAPE_LABELS: Record<OrgShape, string> = {
  unspecified: '未声明组织形态（保守口径）',
  legacy: '沿用原有直写',
  flat: '扁平（1 跳）',
  layered: '按业务域分层（最多 2 跳）',
};

export type Prerequisite = { id: string; label: string; satisfied: boolean; evidence: string };
/**
 * 评估口径由调用方从**当前真实配置**传入，不在评估里猜。
 * `routerMode` 未传 = 旧调用（保守的固定三层口径），保持向后兼容。
 */
export type ThreeTierOptions = {
  agentBindings?: number;
  routerMode?: 'legacy' | 'flat' | 'layered';
  configuredDomains?: number;
  /** C-5：真实在岗且带 supervisor 职责的 Agent 主体，用于核对 Trace 里的派活方。 */
  dutySupervisors?: string[];
  /** C-5：Router 配置里登记的业务域主管主体。 */
  configuredSupervisors?: string[];
  /** C-5：真实在岗且带 personal 职责的 Agent 主体。 */
  dutyPersonals?: string[];
};

/** 从当前真实配置 + 在岗编制提取口径，供服务端 / CLI / 真跑共用，避免三处各自拼装漂移。 */
export function shapeOptions(router: Router, registry: AgentRegistry): ThreeTierOptions {
  const status = router.status();
  const duty = onDuty(registry);
  return {
    routerMode: status.mode,
    configuredDomains: status.domains.length,
    agentBindings: duty.length,
    configuredSupervisors: status.domains
      .map(d => d.supervisorAgentKey).filter((k): k is string => typeof k === 'string'),
    dutySupervisors: duty.filter(a => a.responsibilities.includes('supervisor')).map(a => a.key),
    dutyPersonals: duty.filter(a => a.responsibilities.includes('personal')).map(a => a.key),
  };
}

export type ThreeTierAssessment = {
  /** 是否可正式启用三层；只有 layered 且全部前置条件满足才为 true。 */
  recommended: boolean;
  verdict: string;
  coverage: number;
  prerequisites: Prerequisite[];
  /** 当前配置形态与「本形态自己是否闭环」，与「要不要三层」分开表述。 */
  shape: {
    mode: OrgShape;
    label: string;
    ready: boolean;
    applicable: string[];
  };
  observed: {
    decisions: number;
    stagesCovered: string[];
    intakeFromPersonal: number;
    supervisorDispatches: number;
    /** 扁平直达派活（personal → worker），扁平形态的 P4 证据。 */
    directDispatches: number;
    /** 配置登记且真实在岗的主管派活，分层形态的 P4 证据。 */
    boundSupervisorDispatches: number;
    humanSignatureRate: number;
    singleRouterEntry: boolean;
  };
  reasons: string[];
};

export function assessThreeTier(events: MemoryEvent[], projection: RoutingProjection = replayRouting(events),
  logErrors: string[] = [], options: ThreeTierOptions = {}): ThreeTierAssessment {
  const decisions = events.map(decisionOf).filter(d => d !== null);
  const stagesCovered = THREE_TIER_STAGES.filter(s => (projection.byStage[s] ?? 0) > 0);
  const intakeFromPersonal = decisions.filter(d => d.stage === 'intake' && d.caller.role === 'personal').length;
  const supervisorDispatches = decisions.filter(d => d.caller.role === 'supervisor').length;
  const signatureRate = decisions.length ? decisions.filter(d => d.requiresHumanSignature).length / decisions.length : 0;
  const signatureReasonsComplete = decisions.filter(d => d.requiresHumanSignature).every(d => Boolean(d.signatureReason));
  // C-3：入口是否已收敛，按 Trace 里的 Router 配置快照如实判定，不靠开关假装完成。
  // 改造前的历史决策不带快照且不回溯改写，因此含历史日志的真实全量评估仍可能为 false。
  const routerCoverage = planCoverage(events);
  const singleRouterEntry = routerCoverage.singleRouterEntry;

  // ---- C-5：按当前配置判定 -------------------------------------------------
  const shape: OrgShape = options.routerMode ?? 'unspecified';
  const declared = shape !== 'unspecified';
  const layered = shape === 'layered';
  const shapeLabel = ORG_SHAPE_LABELS[shape];
  const dutySupervisors = options.dutySupervisors ?? [];
  const configuredSupervisors = options.configuredSupervisors ?? [];
  const dutyPersonals = options.dutyPersonals ?? [];
  const agentBindings = options.agentBindings ?? 0;
  const configuredDomains = options.configuredDomains ?? 0;

  /** 扁平形态的本质证据：人机入口直接把活交给执行者。 */
  const directDispatches = decisions.filter(d =>
    d.caller.role === 'personal' && d.target.role === 'worker').length;
  /** 分层形态的证据：派活方必须同时是「配置登记的主管」和「真实在岗带主管职责的 Agent」。 */
  const boundSupervisorDispatches = decisions.filter(d =>
    d.caller.role === 'supervisor'
    && dutySupervisors.includes(d.caller.actor)
    && configuredSupervisors.includes(d.caller.actor)).length;

  const p3Satisfied = layered
    ? intakeFromPersonal > 0 && dutyPersonals.length > 0
    : intakeFromPersonal > 0;
  const p3Label = !declared
    ? '存在 Personal Agent 作为唯一人机入口'
    : layered
      ? '按当前分层配置：Personal Agent 已登记在岗并作为唯一人机入口'
      : '按当前扁平配置：人机入口已收敛，不要求独立的 Personal Agent 实体';
  const p3Evidence = !declared
    ? `intake 且 caller.role=personal 的决策 ${intakeFromPersonal} 条`
    : layered
      ? `intake 入口决策 ${intakeFromPersonal} 条；在岗 personal 职责 Agent ${dutyPersonals.length} 个（${dutyPersonals.slice(0, 3).join('、') || '无'}）`
      : `人机入口决策 ${intakeFromPersonal} 条；${shapeLabel}由人或助手直达执行者，不要求 Personal Agent 实体`;

  const p4Satisfied = !declared ? supervisorDispatches > 0
    : layered ? boundSupervisorDispatches > 0 : directDispatches > 0;
  const p4Label = !declared
    ? '主管 Agent 已承担派活与交接'
    : layered
      ? '按当前分层配置：业务域主管已按编制承担派活与交接'
      : '按当前扁平配置：入口直达执行者的派活链路已闭环，不要求主管';
  const p4Evidence = !declared
    ? `supervisor 作为调用方 ${supervisorDispatches} 条`
    : layered
      ? `配置登记且真实在岗的主管派活 ${boundSupervisorDispatches} 条（仅有角色名的 ${supervisorDispatches - boundSupervisorDispatches} 条不计）；登记主管 [${configuredSupervisors.slice(0, 3).join('、')}]，在岗主管 [${dutySupervisors.slice(0, 3).join('、')}]`
      : `扁平直达派活（personal → worker）${directDispatches} 条；按当前${shapeLabel}配置不要求主管，历史 supervisor 角色记录 ${supervisorDispatches} 条不参与本形态判定`;

  const p8Satisfied = agentBindings > 0 && shape === 'layered' && configuredDomains > 0;
  const p8Evidence = p8Satisfied
    ? `已登记 ${agentBindings} 个在岗 Agent 实例、${configuredDomains} 个业务域，当前${shapeLabel}`
    : declared && !layered
      ? `当前是${shapeLabel}，本形态不需要三层；p8 是防跳级闸门而非当前形态的缺口（在岗 ${agentBindings} 个）`
      : '尚未同时满足「真实在岗 Agent + 分层配置 + 已配置业务域」；扁平配置下不要求出现主管，C-3 发现只按角色名判定会被合成数据凑齐';

  const prerequisites: Prerequisite[] = [
    { id: 'p1-routing-coverage', label: '五个派活阶段都有统一决策记录',
      satisfied: stagesCovered.length === THREE_TIER_STAGES.length,
      evidence: `已覆盖 ${stagesCovered.length}/${THREE_TIER_STAGES.length}：${stagesCovered.join(', ') || '无'}` },
    { id: 'p2-memory-replay', label: 'B 阶段记忆事件可重放且日志无坏行',
      satisfied: projection.events > 0 && projection.decisions > 0
        && projection.uniqueDecisions === projection.decisions && logErrors.length === 0,
      evidence: `events=${projection.events}, 去重后决策=${projection.decisions}, 坏行=${logErrors.length}` },
    { id: 'p3-personal-entry', label: p3Label, satisfied: p3Satisfied, evidence: p3Evidence },
    { id: 'p4-supervisor-dispatch', label: p4Label, satisfied: p4Satisfied, evidence: p4Evidence },
    { id: 'p5-human-signature', label: '高风险动作全部保留人签字与理由',
      satisfied: signatureRate > 0 && signatureReasonsComplete,
      evidence: `人签比例 ${(signatureRate * 100).toFixed(1)}%，理由完整=${signatureReasonsComplete}` },
    { id: 'p6-single-router', label: '入口已收敛为单一 Router（C-3）',
      satisfied: singleRouterEntry,
      evidence: singleRouterEntry
        ? `全部 ${routerCoverage.routed} 条决策都带 Router 配置快照`
        : `Trace 中 ${routerCoverage.routed}/${routerCoverage.total} 条决策带 Router 配置快照；改造前的历史决策不回溯改写` },
    { id: 'p7-license', label: 'LobeHub 仅借思想、不复制代码',
      satisfied: true, evidence: 'Community License：衍生分发需商业授权；本项目零代码引用' },
    { id: 'p8-agent-bindings', label: '按当前配置重跑：分层形态的 Agent 实例、职责绑定与业务域已落地（C-4 / C-5）',
      // C-3 发现：只按 Trace 里的角色名判定，合成数据就能凑齐 P3/P4，闸门不够硬。
      // C-5 后仍只在 layered + 真实在岗编制 + 业务域配置下放行，扁平配置永不因此转绿。
      satisfied: p8Satisfied, evidence: p8Evidence },
  ];

  const coverage = prerequisites.filter(p => p.satisfied).length / prerequisites.length;
  const recommended = prerequisites.every(p => p.satisfied);
  // 形态自身是否闭环：扁平 / 原样回退不看 p8（那是「要不要三层」的跳级闸门）；
  // 分层形态则要把 p8 算进去。未声明配置时无法声称闭环。
  const applicable = layered
    ? prerequisites.map(p => p.id)
    : prerequisites.filter(p => p.id !== 'p8-agent-bindings').map(p => p.id);
  const shapeReady = declared && prerequisites.filter(p => applicable.includes(p.id)).every(p => p.satisfied);
  const pendingCount = prerequisites.filter(p => applicable.includes(p.id) && !p.satisfied).length;

  const verdict = recommended
    ? '当前分层配置已被真实 Trace 与在岗编制支撑，可按配置启用三层汇报'
    : !declared
      ? '暂不引入三层作为默认答案：调用方未声明当前组织形态，按最保守口径逐项补齐'
      : shapeReady
        ? `当前${shapeLabel}按配置运行正常；本形态不需要三层，组织扩展到多业务域后再按配置启用`
        : `暂不引入三层：当前${shapeLabel}按配置判定还有 ${pendingCount} 项未齐，逐项判定如实列出，不掩饰缺口`;

  const commonReasons = [
    'LobeHub 主仓库为 Community License，只能参考三层汇报的产品思想，不复制代码。',
    '玉伯 OPT 访谈：人是「监工」，同时管 5 个 Agent 已达带宽上限，且「暂无法实现 Agent 自主管理 Agent」；必须保留人工插手与高风险签字。',
    'B 的 append-only 事件主干与四类投影是三种形态共享的现场，换形态不换底座，不靠摘要转发。',
  ];
  const reasons = recommended
    ? [
      '当前为按业务域分层配置：主管派活已同时核对「配置登记」与「真实在岗职责」，Trace 每步可回放。',
      ...commonReasons,
      '人仍保留目标、边界、高风险联签与最终核可；Agent 可以提出改进，不能自己让改进生效。',
    ]
    : !declared
      ? [
        '暂不把三层当默认答案：调用方未声明当前组织形态（生产入口应传 shapeOptions()），按最保守的固定三层口径判定；层是配置，不是产品骨架。',
        ...commonReasons,
        '当前入口是人经飞书 IM 直达 Bridge；五个派活点已收敛到单一 Router 与一份 Trace（C-3）。',
      ]
      : shapeReady
        ? [
          `当前配置为${shapeLabel}，派活由人机入口直达执行者；不要求出现主管，避免逼小团队硬造管理层。`,
          '三层不是默认答案：只有组织按业务域扩展、且真实在岗 Agent 支撑分层时，才按配置启用。',
          ...commonReasons,
        ]
        : [
          `当前配置为${shapeLabel}，按本形态口径逐项判定；未满足项见 prerequisites，不为凑评估转绿硬造管理层。`,
          `P3 / P4 已按当前配置判定：${layered ? '主管派活必须对应真实在岗编制' : '不要求主管派活，也不因历史 supervisor 角色记录而失败'}。`,
          ...commonReasons,
          '改造前的历史决策不带 Router 配置快照且不回溯改写，含历史日志的全量评估可能仍显示入口未收敛。',
        ];

  return {
    recommended, coverage, prerequisites, reasons, verdict,
    shape: { mode: shape, label: shapeLabel, ready: shapeReady, applicable },
    observed: { decisions: decisions.length, stagesCovered: [...stagesCovered],
      intakeFromPersonal, supervisorDispatches, directDispatches, boundSupervisorDispatches,
      humanSignatureRate: signatureRate, singleRouterEntry },
  };
}

/** CLI / 设置页入口：直接读当前真实 Trace 做判断。 */
export function assessCurrentRouting(file?: string, options: ThreeTierOptions = {}): ThreeTierAssessment & { logErrors: string[] } {
  const { events, errors } = readRoutingEvents(file);
  return { ...assessThreeTier(events, replayRouting(events), errors, options), logErrors: errors };
}
