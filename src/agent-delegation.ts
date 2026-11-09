// AI 原生协作核心：Agent 委托 Agent 的分层协作。
//
// 对齐三个上游（借概念，非代码照搬）：
// - dsh-superagent（MIT）：ticket → assignment → executor，Mandate 授权范围不可变；
// - lobehub/acceptance（Apache-2.0）：coordinator / runner / checker 三角色，各用 lighter 模型，
//   acquire-once-then-handoff（事实只由一个 owner 获取一次，下游收 handoff，路径本身不是复用）；
// - KKKKhazix/agent-autoloop（MIT）：深度熔断（复用本仓 hop-fuse MAX_HOPS）+ 预算。
//
// 本模块是「编排层」：把本仓已有的准入 / 决策点 / 会签 / 跳数熔断串成一条委托链，
// 不另起炉灶、不接管任务状态。

export type DelegationRole = 'coordinator' | 'worker' | 'checker';

/** 每个角色用哪档模型 + 多少预算（对齐 LobeHub「coordinator 用 builder 模型、worker/checker 用 lighter 模型」）。 */
export interface RoleSpec {
  role: DelegationRole;
  modelTier: 'fast' | 'standard' | 'code';
  budget: Budget;
}

export interface Budget {
  maxContextChars: number;
  maxToolCalls: number;
  maxDurationMs: number;
}

/** 授权范围（对齐 dsh Mandate）：消息/子委托都改不了它。 */
export interface Mandate {
  /** 允许触碰的资源前缀；空数组 = 只读。 */
  scope: readonly string[];
  grant: 'read' | 'edit' | 'full';
}

/** acquire-once 的交接单：事实内容 + 溯源，下游不再重读源。 */
export interface Handoff {
  from: string;
  facts: string;
  provenance: string;
  validForRevision: string;
}

export interface Assignment {
  id: string;
  role: DelegationRole;
  agentId: string | null;
  task: string;
  parentId: string | null;
  depth: number;
  mandate: Mandate;
  budget: Budget;
  state: 'pending' | 'running' | 'done' | 'handed-back' | 'fused';
  handoffs: Handoff[];
}

/** 三角色默认规格（coordinator 管范围与决策，worker 干活，checker 评审；模型逐级更轻）。 */
export const ROLE_SPECS: Record<DelegationRole, RoleSpec> = {
  coordinator: { role: 'coordinator', modelTier: 'standard',
    budget: { maxContextChars: 24000, maxToolCalls: 60, maxDurationMs: 30 * 60_000 } },
  worker: { role: 'worker', modelTier: 'code',
    budget: { maxContextChars: 24000, maxToolCalls: 40, maxDurationMs: 30 * 60_000 } },
  checker: { role: 'checker', modelTier: 'fast',
    budget: { maxContextChars: 12000, maxToolCalls: 20, maxDurationMs: 10 * 60_000 } },
};

/** 授权范围不可变：子委托范围必须是父的子集，grant 不得高于父。 */
export function narrowMandate(parent: Mandate, child: Mandate): { ok: boolean; reason: string } {
  const rank = { read: 1, edit: 2, full: 3 } as const;
  if (rank[child.grant] > rank[parent.grant]) {
    return { ok: false, reason: `子委托 grant=${child.grant} 超过父 ${parent.grant}，不得越权` };
  }
  if (parent.scope.length > 0 && !child.scope.every(s => parent.scope.includes(s))) {
    return { ok: false, reason: '子委托范围超出父授权范围' };
  }
  return { ok: true, reason: '' };
}

/** 预算只减不增：子委托预算不得超过父。 */
export function narrowBudget(parent: Budget, child: Budget): { ok: boolean; reason: string } {
  if (child.maxContextChars > parent.maxContextChars) return { ok: false, reason: '子委托上下文预算超过父' };
  if (child.maxToolCalls > parent.maxToolCalls) return { ok: false, reason: '子委托工具调用预算超过父' };
  if (child.maxDurationMs > parent.maxDurationMs) return { ok: false, reason: '子委托时长预算超过父' };
  return { ok: true, reason: '' };
}

export interface DelegateInput {
  task: string;
  parent?: Assignment;
  role: DelegationRole;
  mandate: Mandate;
  budget: Budget;
  /** 深度上限（默认取 hop-fuse 的 MAX_HOPS）。 */
  maxDepth?: number;
}

export type DelegateResult =
  | { ok: true; assignment: Assignment }
  | { ok: false; reason: string; state: 'fused' | 'blocked' };

/**
 * 一次委托：coordinator 拆解任务 → 生成一个子 assignment。
 * 三道闸：授权范围不可变、预算只减、深度熔断（超过上限只记录不派活）。
 */
export function delegate(input: DelegateInput, makeId: () => string, maxDepth = 8): DelegateResult {
  const parent = input.parent;
  const depth = (parent?.depth ?? 0) + 1;
  if (depth > maxDepth) {
    return { ok: false, state: 'fused',
      reason: `委托链已到第 ${depth} 层，超过上限 ${maxDepth}，只记录不再向下委托（防 Agent 无限套娃）` };
  }
  if (parent) {
    const mandate = narrowMandate(parent.mandate, input.mandate);
    if (!mandate.ok) return { ok: false, state: 'blocked', reason: mandate.reason };
    const budget = narrowBudget(parent.budget, input.budget);
    if (!budget.ok) return { ok: false, state: 'blocked', reason: budget.reason };
  }
  const assignment: Assignment = {
    id: makeId(), role: input.role, agentId: null, task: input.task,
    parentId: parent?.id ?? null, depth,
    mandate: input.mandate, budget: input.budget,
    state: 'pending', handoffs: [],
  };
  return { ok: true, assignment };
}

/**
 * acquire-once handoff：把一个角色获取的事实交接给下游。
 * 下游用 facts + provenance，不重读源——路径本身不是复用（LobeHub delegation 原话）。
 */
export function makeHandoff(from: string, facts: string, provenance: string, validForRevision: string): Handoff {
  return { from, facts, provenance, validForRevision };
}

/** 判断一份 handoff 是否仍有效（修订变了即失效，需要重新获取）。 */
export function handoffValid(handoff: Handoff, currentRevision: string): boolean {
  return handoff.validForRevision === currentRevision;
}

/** 委托链的深度（复用 hop-fuse 语义：超过上限即熔断）。 */
export function chainDepth(assignment: Pick<Assignment, 'depth'>): number {
  return assignment.depth;
}
