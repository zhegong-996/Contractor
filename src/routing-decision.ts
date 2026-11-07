// 统一「谁把任务交给谁」契约（v0.7 · B 阶段前置）。
//
// 背景：派活判断此前散在 controller / coordination / assistant /
// service-network / v06 五个文件，各写一套「能不能交、交给谁、依据什么」，
// 也没有共同的 Trace。本文件只定义契约与纯函数，不做 IO、不改任何既有判断：
// 五个调用点各自构造同一份 RoutingDecision，经 routing-trace.ts 落到同一份
// append-only Trace。B 阶段的记忆事件日志直接用 toMemoryEvent() 复用它。
//
// 上游复用口径：
//   - Super Agent policy：basis.policyVersion / ruleId 与 assessmentOutcome 对齐；
//   - DeepSeek Harness：scope 的隔离语义参考 createScope（harness-composition.ts）；
//   - Agent Autoloop：causedBy 绑定 jobId / runId / nonce；
//   - A2A SDK：service-network 的 Link 字段原样映射到 target / scope；
//   - LobeHub：只参考三层汇报的角色命名（AGENT_ROLES），不复制任何代码。
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AGENT_ROLES, type MemoryEvent } from './architecture-contracts.ts';

export const ROUTING_STAGES = ['intake', 'admission', 'dispatch', 'delegation', 'transfer'] as const;
export type RoutingStage = typeof ROUTING_STAGES[number];

/** 判断来自哪里，用于状态来源标注；不表示代码依赖强度。 */
export const ROUTING_SOURCES = [
  'human', 'superagent-trigger', 'superagent-policy', 'autoloop',
  'a2a-sdk', 'deepseek-harness', 'role-registry', 'local-operator',
] as const;
export type RoutingSource = typeof ROUTING_SOURCES[number];

export const ROUTING_BASIS_KINDS = [
  'user-command', 'policy', 'registry', 'service-route', 'transfer',
  'assistant-schedule', 'acceptance-chain',
] as const;
export type RoutingBasisKind = typeof ROUTING_BASIS_KINDS[number];

/** 人签字规则是产品红线，集中在这里，禁止各调用点自行放宽。 */
export const HUMAN_SIGNATURE_RULES = [
  { action: 'business-acceptance', reason: '最终业务验收只能由原发起人在原会话确认' },
  { action: 'publish-release', reason: '发布到业务仓库需要真人签字' },
  { action: 'grant-approve', reason: '跨空间资料授权由数据归属方审批' },
  { action: 'knowledge-adopt', reason: '知识采用与撤回由资料负责人决定' },
  { action: 'formal-transfer', reason: '正式跨职能派单需职能 owner 与联签' },
] as const;
export type SignatureAction = typeof HUMAN_SIGNATURE_RULES[number]['action'];

export const routingDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  /** 稳定标识：带 idempotencyKey 时不含时间，重试同一动作不会造成重复事件。 */
  decisionId: z.string().min(1),
  at: z.string().datetime(),
  taskId: z.string().min(1),
  stage: z.enum(ROUTING_STAGES),
  /** 调用方：人或 agent 的身份、角色、判断来源。 */
  caller: z.object({
    actor: z.string().min(1),
    role: z.enum(AGENT_ROLES),
    source: z.enum(ROUTING_SOURCES),
  }).strict(),
  /** 目标角色：三层角色 + 具体承接标识（agent / 服务 / 职能三选一或并列）。 */
  target: z.object({
    role: z.enum(AGENT_ROLES),
    agentKey: z.string().optional(),
    serviceId: z.string().optional(),
    roleId: z.string().optional(),
  }).strict(),
  /** 依据：为什么可以交，证据必须可回溯。 */
  basis: z.object({
    kind: z.enum(ROUTING_BASIS_KINDS),
    evidence: z.array(z.string().max(500)).max(12).default([]),
    policyVersion: z.string().optional(),
    ruleId: z.string().optional(),
  }).strict(),
  /** 资料范围：交接方只能在这个范围内工作。 */
  scope: z.object({
    sourceIds: z.array(z.string().max(200)).max(16).default([]),
    allowedPaths: z.array(z.string().max(200)).max(16).default([]),
    visibility: z.enum(['private', 'space', 'shared']).default('private'),
    expiresAt: z.string().optional(),
  }).strict(),
  /** 是否需要人签字；红线动作恒为 true。 */
  requiresHumanSignature: z.boolean(),
  signatureReason: z.string().max(300).optional(),
  outcome: z.enum(['committed', 'rejected', 'pending']).default('committed'),
  /** 上游可追溯标识：triggerId / jobId / runId / transferId / link.childId。 */
  causedBy: z.string().max(200).optional(),
}).strict();
export type RoutingDecision = z.infer<typeof routingDecisionSchema>;

export type RoutingDecisionInput = {
  taskId: string;
  stage: RoutingStage;
  caller: RoutingDecision['caller'];
  target: RoutingDecision['target'];
  basis: RoutingDecision['basis'];
  scope?: Partial<RoutingDecision['scope']>;
  outcome?: RoutingDecision['outcome'];
  causedBy?: string;
  idempotencyKey?: string;
  at?: string;
  requiresHumanSignature?: boolean;
  signatureReason?: string;
};

const stable = (v: unknown) => JSON.stringify(v);

/** 构造一条经过校验的决策；校验失败是调用方的 bug，必须显式暴露。 */
export function routingDecision(input: RoutingDecisionInput): RoutingDecision {
  const at = input.at ?? new Date().toISOString();
  const scope = {
    sourceIds: input.scope?.sourceIds ?? [],
    allowedPaths: input.scope?.allowedPaths ?? [],
    visibility: input.scope?.visibility ?? 'private' as const,
    ...(input.scope?.expiresAt ? { expiresAt: input.scope.expiresAt } : {}),
  };
  const signature = input.requiresHumanSignature === true || input.signatureReason
    ? { requiresHumanSignature: true as const, ...(input.signatureReason ? { signatureReason: input.signatureReason } : {}) }
    : { requiresHumanSignature: false as const };
  const identity = input.idempotencyKey ?? [
    input.taskId, input.stage, input.caller.actor, input.caller.source,
    stable(input.target), input.basis.kind, stable(scope), input.outcome ?? 'committed', at,
  ].join('|');
  const decisionId = createHash('sha256').update(identity).digest('hex').slice(0, 32);
  return routingDecisionSchema.parse({
    schemaVersion: 1, decisionId, at, taskId: input.taskId, stage: input.stage,
    caller: input.caller, target: input.target, basis: input.basis, scope,
    ...signature, outcome: input.outcome ?? 'committed',
    ...(input.causedBy ? { causedBy: input.causedBy } : {}),
  });
}

/** 红线动作一律要求人签字；调用点不得用此函数把红线改成 false。 */
export function signatureFor(action: SignatureAction): { requiresHumanSignature: true; signatureReason: string } {
  const rule = HUMAN_SIGNATURE_RULES.find(r => r.action === action)!;
  return { requiresHumanSignature: true, signatureReason: rule.reason };
}

/** B 阶段复用点：决策本身就是一条 append-only 记忆事件，不需要第二套日志格式。 */
export function toMemoryEvent(decision: RoutingDecision): MemoryEvent {
  return {
    id: 'routing:' + decision.decisionId,
    kind: 'routing-decided',
    actor: decision.caller.actor,
    at: decision.at,
    ...(decision.causedBy ? { causedBy: decision.causedBy } : {}),
    ...(decision.scope.sourceIds.length
      ? { sourceRef: { sourceId: decision.scope.sourceIds[0]!, revision: 'routing-decision' } } : {}),
    ...(decision.basis.policyVersion ? { policyVersion: decision.basis.policyVersion } : {}),
    payload: { decision },
  };
}

export function decisionOf(event: MemoryEvent): RoutingDecision | null {
  if (event.kind !== 'routing-decided') return null;
  const parsed = routingDecisionSchema.safeParse((event.payload as { decision?: unknown })?.decision);
  return parsed.success ? parsed.data : null;
}
