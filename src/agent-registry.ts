// 方案 C-4 · 组织级 Agent 注册表：把「配置里写的一个名字」变成「真正在岗的 Agent」。
//
// C-3 的 Router 读 config.router.domains 决定跳数，但 supervisorAgentKey 只是字符串：
// 系统并不知道这个 Agent 是否存在、有没有资格派活、管哪个业务域、版本换没换。
// C-4 补的就是这层事实：Agent 实例 + 职责绑定 + 生效范围 + 版本快照。
//
// 产品红线（用户 2026-11-07 拍板，PRD §10C C-P1 / C-P2）：
// - 层是配置不是骨架：默认**空注册表**，10 人团队不硬造管理层；上百人团队按业务域加配置。
// - 职责槽位可扩展：内置的 6 个只是预设，配置里可以挂自定义职责（产品 / 技术 / 运营 …）。
// - 允许一个 Agent 兼任多职责，但**同一 Task 禁止自派自验自环**，判定按 Task 责任链，
//   不是在注册表里全局禁止兼任。
// - 配置组织级唯一、项目只引用不覆写；变更留 revision 快照，不回溯改写历史决策。
// - 判断是工程层：`modelCalls=0`、不读时钟、不 IO；AI 层不参与「谁有资格接这一棒」。
//
// 与既有 `agent-services.ts` 的分工：那份是**运行时服务目录**（存在宿主文档里，描述
// 这个 Agent 用什么工具 / 模型 / 能力干活，personal / shared、offers）；本文件是
// **组织形态的真相源**（谁在什么范围担什么职责），纯配置、不依赖宿主、可独立重放。
// 两者不冲突，也不互相覆写。

import { createHash } from 'node:crypto';
import { z } from 'zod';

/** 内置职责槽位只是预设，不是枚举上限：配置里允许挂自定义职责 ID。 */
export const BUILTIN_RESPONSIBILITIES = [
  'personal', 'supervisor', 'worker', 'acceptance', 'standard-drafting', 'inspection',
] as const;
export type BuiltinResponsibility = typeof BUILTIN_RESPONSIBILITIES[number];

const idSchema = z.string().min(1).max(60).regex(/^[a-z][a-z0-9-]*$/,
  '标识只允许小写字母、数字与连字符');
const agentKey = idSchema.max(80);
const domainId = idSchema.max(80);
/** '*' = 组织全域；其余为业务域 / 组织单元 ID。 */
const scopeEntry = z.union([z.literal('*'), domainId]);

export const agentInstanceSchema = z.object({
  key: agentKey,
  label: z.string().trim().min(1).max(80),
  /** 可兼任：一个 Agent 可同时是某人的 Personal Agent 和某个业务域的主管。 */
  responsibilities: z.array(idSchema).min(1).max(12),
  /** 生效范围：业务域 / 组织单元；'*' 全域。项目只引用，不覆写。 */
  domains: z.array(scopeEntry).min(1).max(40).default(['*']),
  enabled: z.boolean().default(true),
  notes: z.string().trim().max(300).optional(),
}).strict().superRefine((agent, ctx) => {
  if (new Set(agent.responsibilities).size !== agent.responsibilities.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['responsibilities'], message: '职责不能重复' });
  }
  if (new Set(agent.domains).size !== agent.domains.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['domains'], message: '生效范围不能重复' });
  }
  if (agent.domains.includes('*') && agent.domains.length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['domains'], message: '全域与具体业务域不能并列，避免范围歧义' });
  }
});

export const agentRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  /** 默认空：没有配置就没有这一层，不是「配了但没启用」。 */
  agents: z.array(agentInstanceSchema).max(200).default([]),
  /** 仅供人阅读；不进 revision，避免只改备注就伪装成配置变更。 */
  updatedAt: z.string().min(1).max(40).optional(),
}).strict().superRefine((registry, ctx) => {
  const keys = registry.agents.map(a => a.key);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['agents'], message: 'Agent 标识不能重复' });
  }
});
export type AgentInstance = z.infer<typeof agentInstanceSchema>;
export type AgentRegistry = z.infer<typeof agentRegistrySchema>;

export function defaultAgentRegistry(): AgentRegistry {
  return agentRegistrySchema.parse({ schemaVersion: 1, agents: [] });
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);

/** 内容哈希：职责 / 范围 / 启停任一变化，版本就变；不读时钟，可重放。 */
export function agentVersion(agent: AgentInstance): string {
  return digest(agentInstanceSchema.parse(agent));
}

/** 组织级配置快照：键序稳定；备注变化不影响 revision。 */
export function registryRevision(registry: AgentRegistry): string {
  const stable = agentRegistrySchema.parse(registry).agents
    .map(a => [a.key, agentVersion(a)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return digest({ schemaVersion: 1, agents: stable });
}

export function scopeCovers(agent: AgentInstance, domain: string | null | undefined): boolean {
  if (agent.domains.includes('*')) return true;
  return Boolean(domain) && agent.domains.includes(domain!);
}

export function onDuty(registry: AgentRegistry): AgentInstance[] {
  return registry.agents.filter(a => a.enabled);
}

/** 确定性工程层：按职责 + 生效范围 + 责任链排除，挑出合格的接棒者。 */
export type AssignmentQuery = {
  taskId: string;
  responsibility: string;
  domain?: string | null;
  /** 同一 Task 责任链上已出现过的主体，用于防自派自验自环。 */
  usedKeys?: readonly string[];
  /** 产出方：独立评审者不得等于产出方。 */
  producedBy?: string | null;
  /** 提供时做版本一致性校验，版本漂移的候选视为不合格。 */
  expectedVersion?: string | null;
};
export type Assignment = {
  agentKey: string | null;
  version: string | null;
  responsibility: string;
  domain: string | null;
  registryRevision: string;
  candidates: string[];
  reason: string;
  /** 工程层判定，零模型调用。 */
  modelCalls: 0;
};

export function resolveAssignment(registry: AgentRegistry, query: AssignmentQuery): Assignment {
  const revision = registryRevision(registry);
  const domain = query.domain ?? null;
  const used = new Set([...(query.usedKeys ?? []), ...(query.producedBy ? [query.producedBy] : [])]);
  const eligible = onDuty(registry).filter(agent =>
    agent.responsibilities.includes(query.responsibility)
    && scopeCovers(agent, domain)
    && !used.has(agent.key)
    && (!query.expectedVersion || agentVersion(agent) === query.expectedVersion));
  const candidates = eligible.map(a => a.key).sort();
  const agentKey = candidates[0] ?? null;
  const reason = agentKey
    ? `按职责 ${query.responsibility}、生效范围 ${domain ?? '组织级'} 与责任链排除后确定`
    : onDuty(registry).length === 0
      ? '组织未配置任何在岗 Agent；扁平小团队不硬造管理层'
      : `没有同时满足「${query.responsibility} 职责 / ${domain ?? '组织级'} 范围 / 不被责任链排除 / 版本一致」的在岗 Agent`;
  return {
    agentKey, version: agentKey ? agentVersion(eligible.find(a => a.key === agentKey)!) : null,
    responsibility: query.responsibility, domain, registryRevision: revision,
    candidates, reason, modelCalls: 0,
  };
}

/** 同一 Task 自派自验自环：把「谁已经在这一单里出现过」作为事实判定，不靠角色名。 */
export function selfReviewConflict(input: {
  taskId: string; candidate: string | null; producer?: string | null; usedKeys?: readonly string[];
}): string | null {
  if (!input.candidate) return null;
  if (input.producer && input.candidate === input.producer) return '承接人与产出方是同一主体，不能自验';
  if ((input.usedKeys ?? []).includes(input.candidate)) return '承接人已在本 Task 责任链上，不能自派自验自环';
  return null;
}
export function assertNoSelfReview(input: Parameters<typeof selfReviewConflict>[0]): void {
  const conflict = selfReviewConflict(input);
  if (conflict) throw new Error('同一 Task 禁止自派自验自环：' + conflict);
}

/** A2A handoff：交接的是「引用与范围」，不是把资料正文搬过去（B 的共享现场）。 */
export type HandoffInput = {
  taskId: string;
  from: string;
  to: string;
  responsibility: string;
  domain?: string | null;
  sourceIds: readonly string[];
  visibility?: string;
  causedBy: string;
  usedKeys?: readonly string[];
  expectedVersion?: string | null;
};
export type HandoffEnvelope = {
  ok: boolean;
  reason: string | null;
  taskId: string;
  from: string;
  to: string;
  responsibility: string;
  domain: string | null;
  agentVersion: string | null;
  registryRevision: string;
  /** 与 A2A Link / RoutingDecision 同构，不新增私有协议字段。 */
  scope: {
    sourceIds: string[]; visibility: string; domain: string | null;
    responsibility: string; agentVersion: string | null; registryRevision: string;
  };
  causedBy: string;
  modelCalls: 0;
};

/** 纯函数：不合格返回 ok:false 与原因，由调用方决定降级还是 fail-closed，绝不静默放行。 */
export function handoffEnvelope(registry: AgentRegistry, input: HandoffInput): HandoffEnvelope {
  const revision = registryRevision(registry);
  const domain = input.domain ?? null;
  const base = {
    taskId: input.taskId, from: input.from, to: input.to,
    responsibility: input.responsibility, domain, registryRevision: revision,
    scope: {
      sourceIds: [...input.sourceIds], visibility: input.visibility ?? 'space', domain,
      responsibility: input.responsibility, agentVersion: null as string | null,
      registryRevision: revision,
    },
    causedBy: input.causedBy, modelCalls: 0 as const,
  };
  const target = onDuty(registry).find(a => a.key === input.to);
  const fail = (reason: string): HandoffEnvelope => ({ ...base, ok: false, reason, agentVersion: null });
  if (input.from === input.to) return fail('交接双方是同一主体，同一 Task 不得自派自验自环');
  if (!target) return fail('目标 Agent 未在组织注册表在岗（或已停用）');
  if (!target.responsibilities.includes(input.responsibility)) return fail(`目标 Agent 未绑定 ${input.responsibility} 职责`);
  if (!scopeCovers(target, domain)) return fail(`目标 Agent 的生效范围不覆盖 ${domain ?? '组织级'}`);
  const version = agentVersion(target);
  if (input.expectedVersion && version !== input.expectedVersion) return fail('目标 Agent 职责版本已变化，须重新核对后交接');
  const conflict = selfReviewConflict({
    taskId: input.taskId, candidate: input.to,
    usedKeys: [...(input.usedKeys ?? []), input.from],
  });
  if (conflict) return fail(conflict);
  return {
    ...base, ok: true, reason: null, agentVersion: version,
    scope: { ...base.scope, agentVersion: version },
  };
}

/** 只读摘要：给 routing-status / 控制台 / 评估闸门用，中文白话，不暴露内部标识以外的东西。 */
export function registrySummary(registry: AgentRegistry) {
  const duty = onDuty(registry);
  const responsibilities = [...new Set([
    ...BUILTIN_RESPONSIBILITIES, ...duty.flatMap(a => a.responsibilities),
  ])].sort().map(id => ({
    id, builtin: (BUILTIN_RESPONSIBILITIES as readonly string[]).includes(id),
    onDuty: duty.filter(a => a.responsibilities.includes(id)).length,
  }));
  return {
    schemaVersion: registry.schemaVersion,
    revision: registryRevision(registry),
    agents: registry.agents.length,
    onDuty: duty.length,
    responsibilities,
    domains: [...new Set(duty.flatMap(a => a.domains))].sort(),
    shape: duty.length === 0
      ? '未配置 Agent（扁平，不硬造管理层）'
      : duty.some(a => a.responsibilities.includes('supervisor'))
        ? '按业务域配置中间决策层'
        : '已配置 Agent，但无中间决策层（扁平）',
  };
}

/**
 * C-4：验收是一等公民 Agent（PRD §10C C-P2）。按配置解析「这一单谁起草标准、
 * 谁逐项判定、谁周期巡检」，并与产品 / 技术 / 运营等自定义职责的 Agent 协作。
 * 纯工程层、零模型调用；没有合格 Agent 时如实降级到既有服务式验收，不硬造。
 */
export const REVIEW_RED_LINES = [
  '独立评审者不得等于产出方（模型或人）',
  '逐项报告只是证据，不替代原发起人在原会话确认验收',
  '已锁定的验收清单不可改写；Agent 不能自己让改进生效',
] as const;
export type ReviewCrewQuery = {
  taskId: string;
  domain?: string | null;
  producedBy?: string | null;
  usedKeys?: readonly string[];
};
export type ReviewCrew = {
  taskId: string;
  domain: string | null;
  configured: boolean;
  registryRevision: string;
  reviewer: Assignment;
  standardDrafter: Assignment;
  inspector: Assignment;
  collaborators: { responsibility: string; assignment: Assignment }[];
  redLines: string[];
  degraded: string | null;
  modelCalls: 0;
};
export function reviewCrew(registry: AgentRegistry, query: ReviewCrewQuery): ReviewCrew {
  const revision = registryRevision(registry);
  const domain = query.domain ?? null;
  const configured = onDuty(registry).length > 0;
  const base = {
    taskId: query.taskId, domain, configured, registryRevision: revision,
    redLines: [...REVIEW_RED_LINES], modelCalls: 0 as const,
  };
  if (!configured) {
    const empty = (responsibility: string): Assignment => ({
      agentKey: null, version: null, responsibility, domain,
      registryRevision: revision, candidates: [], reason: '组织未配置 Agent 编制', modelCalls: 0,
    });
    return { ...base,
      reviewer: empty('acceptance'), standardDrafter: empty('standard-drafting'),
      inspector: empty('inspection'), collaborators: [],
      degraded: '组织未配置 Agent 编制；验收仍走既有的本机服务与逐项报告，不硬造验收 Agent',
    };
  }
  const pick = (responsibility: string, usedKeys: readonly string[]) => resolveAssignment(registry,
    { taskId: query.taskId, responsibility, domain, producedBy: query.producedBy ?? null, usedKeys });
  const used0 = [...(query.usedKeys ?? [])];
  const reviewer = pick('acceptance', used0);
  const used1 = [...used0, ...(reviewer.agentKey ? [reviewer.agentKey] : [])];
  const standardDrafter = pick('standard-drafting', used1);
  const used2 = [...used1, ...(standardDrafter.agentKey ? [standardDrafter.agentKey] : [])];
  const inspector = pick('inspection', used2);
  const used3 = [...used2, ...(inspector.agentKey ? [inspector.agentKey] : [])];
  const builtin = BUILTIN_RESPONSIBILITIES as readonly string[];
  const custom = [...new Set(onDuty(registry).flatMap(a => a.responsibilities))]
    .filter(id => !builtin.includes(id)).sort();
  const collaborators = custom.map(responsibility => ({ responsibility, assignment: pick(responsibility, used3) }));
  return { ...base,
    reviewer, standardDrafter, inspector, collaborators,
    degraded: reviewer.agentKey ? null
      : '没有合格的独立验收 Agent（在岗 / 职责 / 范围 / 不与产出方同一主体都要满足）；验收仍走既有链路',
  };
}

/** 服务端启动时用真实配置装配；不主动 loadConfig，避免测试进程读真实 .runtime/config.json。 */
let current: AgentRegistry | undefined;
export function getAgentRegistry(): AgentRegistry { return current ??= defaultAgentRegistry(); }
export function configureAgentRegistry(registry: AgentRegistry): AgentRegistry {
  return current = agentRegistrySchema.parse(registry);
}
export function setAgentRegistry(registry: AgentRegistry | null): void { current = registry ?? undefined; }
