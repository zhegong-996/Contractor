// v0.6 FR-10 / FR-26 — cross-space Context Grant (M13, D3).
//
// Default isolation. The approver is the TARGET Workspace owner, never the
// requester's manager (P5: permission attaches to data, not identity).
// Grants open the smallest visible subset only; writes and cross-space
// reflow require a separate approval.
//
// Engineering note: DeepSeek Super-agent's "subscription direct routing"
// (same-thread events bypass the Router) is a transport optimisation inside
// one Thread. It is NOT an organisation-level escalation and is unaffected.
import { z } from 'zod';

export const GRANULARITIES = ['redacted-summary', 'document-fragment', 'graph-subgraph', 'row'] as const;
export type GrantGranularity = typeof GRANULARITIES[number];

export const contextGrantSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  taskId: z.string().min(1),
  sourceSpace: z.string().min(1),           // data owner side
  targetSpace: z.string().min(1),           // where the requester wants to use it
  requesterUserId: z.string().min(1),
  approverUserId: z.string().min(1),        // TARGET space owner
  purpose: z.string().trim().min(1),
  granularity: z.enum(GRANULARITIES).default('redacted-summary'),
  refs: z.array(z.string()).min(1),         // exact rows / fragments / subgraph / lines
  readonly: z.literal(true).default(true),
  writeApproval: z.boolean().default(false),
  reflowApproval: z.boolean().default(false),
  expiresAt: z.string(),
  state: z.enum(['pending', 'approved', 'denied', 'revoked', 'expired']).default('pending'),
  requestedAt: z.string(),
  decidedAt: z.string().optional(),
  revokedAt: z.string().optional(),
  reason: z.string().optional(),
}).strict();
export type ContextGrant = z.infer<typeof contextGrantSchema>;

export function requestGrant(input: {
  taskId: string; sourceSpace: string; targetSpace: string; requesterUserId: string;
  approverUserId: string; purpose: string; granularity?: GrantGranularity; refs: string[];
  hours?: number; at?: string;
}): ContextGrant {
  const at = input.at ?? new Date().toISOString();
  if (input.sourceSpace === input.targetSpace) throw new Error('同空间无需申请跨空间授权');
  if (!input.refs.length) throw new Error('授权必须指定最小可见子集，不能整库放行');
  if (input.requesterUserId === input.approverUserId) throw new Error('审批方须为目标空间 owner，不能自批');
  return contextGrantSchema.parse({
    schemaVersion: 1, id: `grant:${input.taskId}:${input.sourceSpace}:${input.targetSpace}`,
    taskId: input.taskId, sourceSpace: input.sourceSpace, targetSpace: input.targetSpace,
    requesterUserId: input.requesterUserId, approverUserId: input.approverUserId,
    purpose: input.purpose, granularity: input.granularity ?? 'redacted-summary', refs: input.refs,
    readonly: true, writeApproval: false, reflowApproval: false,
    expiresAt: new Date(Date.parse(at) + (input.hours ?? 8) * 3600_000).toISOString(),
    state: 'pending', requestedAt: at,
  });
}

export function approveGrant(grant: ContextGrant, actorUserId: string, at = new Date().toISOString()): ContextGrant {
  if (grant.state !== 'pending') throw new Error('授权申请已处理');
  if (actorUserId !== grant.approverUserId) throw new Error('只有目标 Workspace owner 能审批');
  if (Date.parse(grant.expiresAt) <= Date.parse(at)) throw new Error('申请已过期，请重新发起');
  return { ...grant, state: 'approved', decidedAt: at };
}

export function denyGrant(grant: ContextGrant, actorUserId: string, reason: string, at = new Date().toISOString()): ContextGrant {
  if (actorUserId !== grant.approverUserId) throw new Error('只有目标 Workspace owner 能拒绝');
  return { ...grant, state: 'denied', decidedAt: at, reason };
}

export function revokeGrant(grant: ContextGrant, reason: string, at = new Date().toISOString()): ContextGrant {
  return { ...grant, state: 'revoked', revokedAt: at, reason };
}

/** Writes and cross-space reflow are NEVER implied by a read grant. */
export function separateApproval(grant: ContextGrant, kind: 'write' | 'reflow', actorUserId: string): ContextGrant {
  if (grant.state !== 'approved') throw new Error('读授权尚未生效');
  if (actorUserId !== grant.approverUserId) throw new Error('写权 / 回流需目标空间 owner 单独审批');
  return kind === 'write' ? { ...grant, writeApproval: true } : { ...grant, reflowApproval: true };
}

export function assertGrantUsable(grant: ContextGrant, at = new Date().toISOString()): void {
  if (grant.state !== 'approved') throw new Error(`授权状态为 ${grant.state}`);
  if (Date.parse(grant.expiresAt) <= Date.parse(at)) throw new Error('授权已过期');
  if (!grant.readonly) throw new Error('跨空间授权默认只读');
}

export function toContextGrantCard(g: ContextGrant) {
  return { kind: 'context-grant' as const, taskId: g.taskId, space: g.sourceSpace,
    granularity: `${g.granularity}（${g.refs.length} 个最小单元）`, approver: g.approverUserId,
    readonly: g.readonly, expiresAt: g.expiresAt };
}
