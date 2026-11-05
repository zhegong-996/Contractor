// v0.6 FR-11 / FR-12 / FR-13 — Responsibility Transfer (M11, D12).
//
// 「责任不随能力走，随派单动作显式转移」(P4): an @ is NOT a transfer. A
// cross-function formal assignment must produce a Transfer record with a
// complete responsibility chain. Consultation-only calls are explicitly
// marked "仅咨询 / 不主责" and never move responsibility.
//
// Default is L0 (this Task only). Widening to L1/L2 is driven by observed
// data and can only relax the per-task human approval — never the five
// guardrails (standard externalisation, counter-sign, fallback ownership,
// per-dispatch trace, revocability).
import { z } from 'zod';
import type { SemanticObject } from './channels.ts';
import type { V06Store } from './v06-store.ts';
import { roleIdSchema } from './roles.ts';

export const HIGH_RISK_ACTIONS = ['external_publish', 'funds', 'customer_visible', 'publish', 'merge', 'database_change', 'permission_change'] as const;
export type HighRiskAction = typeof HIGH_RISK_ACTIONS[number];
export const counterSignRequired = (action: string): boolean => (HIGH_RISK_ACTIONS as readonly string[]).includes(action);

export const grantLevelSchema = z.enum(['L0', 'L1', 'L2']);
export type GrantLevel = z.infer<typeof grantLevelSchema>;

export const transferSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  taskId: z.string().min(1),
  identifier: z.string().optional(),
  grantorUserId: z.string().min(1),          // 目标职能 owner 发起，承接人不能自提
  granteeUserId: z.string().min(1),
  fromRoleId: roleIdSchema,                 // 承接人的主职能（快照）
  fromRoleSnapshot: z.object({ name: z.string(), registryVersion: z.number().int().min(0) }).optional(),
  toRoleId: roleIdSchema,                   // 任务归属的目标职能
  toRoleOwnerUserId: z.string().min(1),     // 兜底责任 / 联签 / 标准起草
  capabilityBasis: z.array(z.string()).min(1),  // 参与过的 Task / 产出，不得凭自述
  capabilityBasisWeight: z.number().min(0).max(1).optional(),
  consultationOnly: z.boolean().default(false),
  level: grantLevelSchema.default('L0'),
  scope: z.object({ kind: z.enum(['task', 'task-class', 'window']), taskId: z.string().min(1),
    taskClass: z.string().optional(), validUntil: z.string().optional(), maxUses: z.number().int().min(1).optional() }).strict(),
  standardDraftedBy: z.string().min(1),     // 必须由目标职能起草并锁定
  standardLocked: z.boolean().default(false),
  planHash: z.string().optional(),
  counterSigners: z.array(z.string()),
  executionOwnerUserId: z.string().min(1),  // 执行责任
  fallbackOwnerUserId: z.string().min(1),   // 职能兜底责任
  grantBatchId: z.string().min(1),          // L1/L2 下每次派单仍引用批次
  state: z.enum(['active', 'consumed', 'revoked', 'expired']).default('active'),
  createdAt: z.string(),
  revokedAt: z.string().optional(),
  revokeReason: z.string().optional(),
}).strict();
export type Transfer = z.infer<typeof transferSchema>;

export interface CreateTransferInput {
  taskId: string; identifier?: string; grantorUserId: string; granteeUserId: string;
  fromRoleId: string; toRoleId: string; toRoleOwnerUserId: string;
  capabilityBasis: string[]; standardDraftedBy: string; standardLocked?: boolean; planHash?: string;
  level?: GrantLevel; scopeTaskClass?: string; validUntil?: string; maxUses?: number;
  consultationOnly?: boolean; counterSigners?: string[]; at?: string;
}

/** Pure construction + invariant checks. No I/O, so the rules are directly testable. */
export function createTransfer(input: CreateTransferInput): Transfer {
  const at = input.at ?? new Date().toISOString();
  const crossFunction = input.fromRoleId !== input.toRoleId;
  if (crossFunction && !input.consultationOnly) {
    if (input.grantorUserId === input.granteeUserId) throw new Error('承接人不能自提授权：Transfer 必须由目标职能 owner 发起');
    if (!input.capabilityBasis.length) throw new Error('能力依据必须来自参与过的 Task / 产出过的制品，不得凭自述');
    if (input.standardDraftedBy !== input.toRoleOwnerUserId) throw new Error('验收标准必须由目标职能起草锁定，承接人不得自定标准');
    if (input.grantorUserId !== input.toRoleOwnerUserId) throw new Error('跨职能授权只能由目标职能 owner 发起');
  }
  const level = input.level ?? 'L0';
  const scope = level === 'L0'
    ? { kind: 'task' as const, taskId: input.taskId }
    : level === 'L1'
      ? { kind: 'task-class' as const, taskId: input.taskId, ...(input.scopeTaskClass ? { taskClass: input.scopeTaskClass } : {}), ...(input.maxUses ? { maxUses: input.maxUses } : {}) }
      : { kind: 'window' as const, taskId: input.taskId, ...(input.validUntil ? { validUntil: input.validUntil } : {}), ...(input.maxUses ? { maxUses: input.maxUses } : {}) };
  if (level !== 'L0' && !input.scopeTaskClass && !input.validUntil) throw new Error('宽授权必须限定同类任务白名单或时间窗');
  const signers = [...new Set([...(input.counterSigners ?? []), ...(crossFunction ? [input.toRoleOwnerUserId] : [])])];
  const transfer: Transfer = transferSchema.parse({
    schemaVersion: 1, id: `transfer:${input.taskId}:${input.granteeUserId}`,
    taskId: input.taskId, ...(input.identifier ? { identifier: input.identifier } : {}),
    grantorUserId: input.grantorUserId, granteeUserId: input.granteeUserId,
    fromRoleId: input.fromRoleId, toRoleId: input.toRoleId, toRoleOwnerUserId: input.toRoleOwnerUserId,
    capabilityBasis: input.capabilityBasis, consultationOnly: input.consultationOnly ?? false,
    level, scope, standardDraftedBy: input.standardDraftedBy, standardLocked: input.standardLocked ?? false,
    ...(input.planHash ? { planHash: input.planHash } : {}),
    counterSigners: signers,
    executionOwnerUserId: input.granteeUserId, fallbackOwnerUserId: input.toRoleOwnerUserId,
    grantBatchId: level === 'L0' ? `batch:${input.taskId}` : `grant:${input.toRoleId}:${input.grantorUserId}:${input.granteeUserId}`,
    state: 'active', createdAt: at,
  });
  return transfer;
}

/** Dual-segment responsibility chain: execution and fallback can be queried separately. */
export function responsibilityChain(t: Transfer) {
  return { execution: { userId: t.executionOwnerUserId, roleId: t.fromRoleId, scope: t.scope.kind },
    fallback: { userId: t.fallbackOwnerUserId, roleId: t.toRoleId, duties: ['兜底责任', '标准起草', '高风险联签'] },
    counterSigners: t.counterSigners };
}

/** FR-11: a formal cross-function dispatch without a Transfer is rejected. */
export function assertDispatchAllowed(input: {
  taskId: string; fromRoleId: string; toRoleId: string; consultationOnly?: boolean; transfer?: Transfer | null; at?: string;
}): { allowed: true; reason: string; requiresCounterSign: boolean } {
  if (input.fromRoleId === input.toRoleId) return { allowed: true, reason: '同职能派单，责任锚在主职能，无需 Transfer', requiresCounterSign: false };
  if (input.consultationOnly) return { allowed: true, reason: '仅咨询 / 不主责：显式标注，责任不转移', requiresCounterSign: false };
  const t = input.transfer;
  if (!t) throw new Error('跨职能正式派单必须生成 Responsibility Transfer（默认仅本 Task）');
  if (t.state !== 'active') throw new Error(`Transfer 已 ${t.state}，不能继续派单`);
  if (t.taskId !== input.taskId) throw new Error('Transfer 与任务不匹配');
  if (t.consultationOnly) throw new Error('仅咨询记录不能用于正式派单');
  if (t.toRoleId !== input.toRoleId || t.fromRoleId !== input.fromRoleId) throw new Error('Transfer 的职能组合已变化，需重新授权');
  if (!t.standardLocked) throw new Error('验收标准尚未由目标职能锁定，不能开工');
  if (t.scope.validUntil && Date.parse(t.scope.validUntil) <= Date.parse(input.at ?? new Date().toISOString())) throw new Error('授权已过期');
  return { allowed: true, reason: `Transfer ${t.id} / ${t.level}，双段责任链生效`, requiresCounterSign: t.counterSigners.length > 0 };
}

/** FR-12: high-risk actions always need the target function owner's counter-signature. */
export function assertCounterSign(t: Transfer, action: string, signers: string[]): void {
  if (!counterSignRequired(action)) return;
  if (!signers.includes(t.fallbackOwnerUserId)) throw new Error(`高风险动作 ${action} 必须由目标职能 owner 联签`);
}

export function toTransferCard(t: Transfer): SemanticObject {
  return { kind: 'transfer-card', taskId: t.taskId, identifier: t.identifier,
    grantor: t.grantorUserId, grantee: t.granteeUserId,
    capability: t.capabilityBasis.join('、'), scope: t.scope.kind === 'task' ? '仅本 Task' : t.scope.taskClass ?? t.scope.validUntil ?? t.scope.kind,
    standardOwner: t.standardDraftedBy, counterSigner: t.counterSigners.join('、') || undefined,
    expiresAt: t.scope.validUntil };
}

// ---------------------------------------------------------------------------
// FR-13 Grant Policy: widen by observed data, tighten automatically.
// ---------------------------------------------------------------------------
export const grantPolicySchema = z.object({
  schemaVersion: z.literal(1),
  level: grantLevelSchema.default('L0'),
  widening: z.object({
    consecutiveL0Passed: z.number().int().min(1).default(5),
    maxReworkRate: z.number().min(0).max(1).default(0.2),
    maxRevocationRate: z.number().min(0).max(1).default(0.1),
    maxCounterSignVetoRate: z.number().min(0).max(1).default(0.1),
    allowLevel2: z.boolean().default(false),
  }).default({ consecutiveL0Passed: 5, maxReworkRate: 0.2, maxRevocationRate: 0.1, maxCounterSignVetoRate: 0.1, allowLevel2: false }),
  tightenedAt: z.string().optional(),
  tightenedReason: z.string().optional(),
}).strict();
export type TransferGrantPolicy = z.infer<typeof grantPolicySchema>;

export const defaultGrantPolicy = (): TransferGrantPolicy => grantPolicySchema.parse({ schemaVersion: 1, level: 'L0' });

export interface GrantMetrics {
  consecutiveL0Passed: number; reworkRate: number; revocationRate: number; counterSignVetoRate: number;
  unauthorizedAccess?: number; p1Incident?: number; counterSignVeto?: boolean; granteeRoleChanged?: boolean;
}

export function evaluateWidening(policy: TransferGrantPolicy, m: GrantMetrics): { level: GrantLevel; reasons: string[] } {
  const w = policy.widening;
  const blockers: string[] = [];
  if (m.consecutiveL0Passed < w.consecutiveL0Passed) blockers.push(`连续达标 L0 仅 ${m.consecutiveL0Passed}/${w.consecutiveL0Passed}`);
  if (m.reworkRate > w.maxReworkRate) blockers.push(`返工率 ${m.reworkRate} 超过 ${w.maxReworkRate}`);
  if (m.revocationRate > w.maxRevocationRate) blockers.push(`撤销率 ${m.revocationRate} 超过 ${w.maxRevocationRate}`);
  if (m.counterSignVetoRate > w.maxCounterSignVetoRate) blockers.push(`联签否决率 ${m.counterSignVetoRate} 超过 ${w.maxCounterSignVetoRate}`);
  if (m.unauthorizedAccess) blockers.push('存在越权记录');
  if (m.p1Incident) blockers.push('存在 P1 事故');
  if (blockers.length) return { level: 'L0', reasons: blockers };
  const level: GrantLevel = w.allowLevel2 && m.consecutiveL0Passed >= w.consecutiveL0Passed * 2 ? 'L2' : 'L1';
  return { level, reasons: ['连续达标且返工/撤销/联签否决均在阈值内', `建议放宽到 ${level}（仅免逐次人工审批，不免留痕与责任）`] };
}

/** Any one of these immediately falls back to L0 — no human decision needed. */
export function evaluateTightening(policy: TransferGrantPolicy, m: GrantMetrics, at = new Date().toISOString()): TransferGrantPolicy {
  const hit = m.unauthorizedAccess ? '出现越权' : m.p1Incident ? '出现 P1 事故' : m.counterSignVeto ? '联签被否决'
    : m.granteeRoleChanged ? '承接人主职能变更' : undefined;
  if (!hit) return policy;
  return { ...policy, level: 'L0', tightenedAt: at, tightenedReason: hit };
}

/** Lightweight per-dispatch record under L1/L2: still references the grant batch. */
export function dispatchReceipt(t: Transfer, at = new Date().toISOString()) {
  return { id: `dispatch:${t.taskId}:${at}`, taskId: t.taskId, grantBatchId: t.grantBatchId,
    grantee: t.executionOwnerUserId, fallback: t.fallbackOwnerUserId, level: t.level,
    consultationOnly: t.consultationOnly, at };
}

export class TransferService {
  constructor(private readonly store: V06Store,
    private readonly audit: (action: string, taskId: string, detail: unknown) => void = () => {}) {}
  async create(input: CreateTransferInput) {
    const transfer = createTransfer(input);
    const revision = await this.store.writeTaskDoc(transfer.taskId, 'responsibility-transfer', transfer);
    this.audit('transfer.created', transfer.taskId, { id: transfer.id, level: transfer.level, from: transfer.fromRoleId, to: transfer.toRoleId });
    return { transfer, revision };
  }
  async read(taskId: string) { return (await this.store.readTaskDoc<Transfer>(taskId, 'responsibility-transfer'))?.value ?? null; }
  async revoke(taskId: string, reason: string, at = new Date().toISOString()) {
    const stored = await this.store.readTaskDoc<Transfer>(taskId, 'responsibility-transfer');
    if (!stored) throw new Error('未找到 Transfer');
    const next: Transfer = { ...stored.value, state: 'revoked', revokedAt: at, revokeReason: reason };
    const revision = await this.store.writeTaskDoc(taskId, 'responsibility-transfer', next);
    this.audit('transfer.revoked', taskId, { id: next.id, reason });
    return { transfer: next, revision };
  }
  async readPolicy(): Promise<{ policy: TransferGrantPolicy; revision: string | null }> {
    const stored = await this.store.readConfig<TransferGrantPolicy>('transfer-grant-policy');
    return { policy: stored?.value ?? defaultGrantPolicy(), revision: stored?.revision ?? null };
  }
  async savePolicy(value: unknown, expectedRevision: string | null, at = new Date().toISOString()) {
    const current = await this.readPolicy();
    if (current.revision !== expectedRevision) throw new Error('授权策略已变化，请刷新后再保存');
    const parsed = grantPolicySchema.parse(value);
    const next = evaluateTightening(parsed, { consecutiveL0Passed: 0, reworkRate: 0, revocationRate: 0, counterSignVetoRate: 0 }, at);
    const revision = await this.store.writeConfig('transfer-grant-policy', next, expectedRevision);
    this.audit('transfer.policy-changed', 'organization', { level: next.level, at });
    return { policy: next, revision };
  }
}
