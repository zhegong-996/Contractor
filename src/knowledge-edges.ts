// v0.6 FR-06 / FR-07 / FR-08 / FR-09 / FR-14 — knowledge edge states.
//
// IMPORTANT (ADAPTATION C1): the existing Cognee evidence graph is physically
// isolated per sha256(sourceId@revision). That boundary is a verified security
// property and stays UNTOUCHED. This module is the L2 organisation graph: it
// stores only cross-source edges with product-level state. Nodes reference L1
// evidence; they never duplicate the source corpus.
//
// Cognee accumulates facts; it does not expire them. Edge state, validity and
// invalidation are therefore product semantics, not engine features.
import { z } from 'zod';

export const EDGE_KINDS = ['belongs_to_role', 'participated_in', 'verified_by', 'responsible_for', 'reused_by'] as const;
export type EdgeKind = typeof EDGE_KINDS[number];
export const EDGE_STATES = ['draft', 'accepted', 'reusable'] as const;
export type EdgeState = typeof EDGE_STATES[number];

export const visibilitySchema = z.object({
  space: z.string().min(1),                 // Workspace / 数据域
  classification: z.enum(['public', 'internal', 'confidential', 'restricted']).default('internal'),
  roleId: z.string().optional(),            // 能力标签
  validUntil: z.string().optional(),        // 时效
}).strict();
export type Visibility = z.infer<typeof visibilitySchema>;

export const knowledgeEdgeSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  kind: z.enum(EDGE_KINDS),
  from: z.string().min(1),                  // L2 node id (person / artifact / task / concept)
  to: z.string().min(1),
  state: z.enum(EDGE_STATES).default('draft'),
  /** Evidence references point back to L1 source@revision; an inferred edge has none. */
  evidenceRefs: z.array(z.object({ sourceId: z.string().min(1), revision: z.string().min(1), excerpt: z.string().optional() })).default([]),
  inferredBy: z.string().optional(),        // model/agent that proposed the relation
  visibility: visibilitySchema,
  validFrom: z.string(),
  invalidAt: z.string().optional(),
  invalidReason: z.string().optional(),
  acceptedBy: z.string().optional(),        // human acceptance only (R4)
  acceptedAt: z.string().optional(),
}).strict();
export type KnowledgeEdge = z.infer<typeof knowledgeEdgeSchema>;

export const isActive = (e: KnowledgeEdge, at = new Date().toISOString()): boolean =>
  !e.invalidAt && Date.parse(e.validFrom) <= Date.parse(at)
  && (!e.visibility.validUntil || Date.parse(e.visibility.validUntil) > Date.parse(at));

/** FR-09: only human-accepted edges may be used as an Agent's basis. */
export function eligibleForContextPack(edges: KnowledgeEdge[], at?: string): KnowledgeEdge[] {
  return edges.filter(e => isActive(e, at) && e.state !== 'draft' && e.evidenceRefs.length > 0);
}

/** An inferred relation without evidence can never become a basis. */
export function assertUsable(edge: KnowledgeEdge, at?: string): void {
  if (!isActive(edge, at)) throw new Error(`边 ${edge.id} 已失效或过期，不能作为依据`);
  if (edge.state === 'draft') throw new Error('未验收的推断关系标注为「不可作依据」');
  if (!edge.evidenceRefs.length) throw new Error('缺少 L1 原文证据引用，不能作为依据');
}

export function acceptEdge(edge: KnowledgeEdge, humanUserId: string, at = new Date().toISOString()): KnowledgeEdge {
  if (!edge.evidenceRefs.length) throw new Error('没有证据引用的推断关系不能由人验收为可复用');
  return knowledgeEdgeSchema.parse({ ...edge, state: 'accepted', acceptedBy: humanUserId, acceptedAt: at });
}

export function markReusable(edge: KnowledgeEdge, at = new Date().toISOString()): KnowledgeEdge {
  if (edge.state !== 'accepted' || !edge.acceptedBy) throw new Error('只有人验收过的边才能升为可复用');
  return { ...edge, state: 'reusable', acceptedAt: edge.acceptedAt ?? at };
}

/** FR-09: invalidation is a state write, never a physical delete. */
export function invalidateEdges(edges: KnowledgeEdge[], reason: string, at: string, predicate: (e: KnowledgeEdge) => boolean): KnowledgeEdge[] {
  return edges.map(e => isActive(e, at) && predicate(e)
    ? { ...e, invalidAt: at, invalidReason: reason }
    : e);
}

/** FR-14: walk reuse edges forward to find everything a bad edge influenced.
 *  Lineage is a historical fact, so it is NOT filtered by valid-from time or
 *  by invalidation — a circuit breaker must still see the affected artefacts. */
export function impactOf(edges: KnowledgeEdge[], edgeId: string): string[] {
  const target = edges.find(e => e.id === edgeId);
  if (!target) return [];
  const seen = new Set<string>();
  const queue = [target.from, target.to];
  while (queue.length) {
    const node = queue.shift()!;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const e of edges) if (e.kind === 'reused_by' && (e.from === node || e.to === node)) queue.push(e.from === node ? e.to : e.from);
  }
  return [...seen].filter(n => n !== target.from);
}

// ---------------------------------------------------------------------------
// FR-07 Context Pack — a one-shot projection, NOT the knowledge base.
// ---------------------------------------------------------------------------
export interface ContextPack {
  schemaVersion: 1;
  taskId: string;
  createdAt: string;
  expiresAt: string;
  registryVersion: number;
  refs: { sourceId: string; revision: string; edgeIds: string[]; excerpt?: string }[];
  labels: Visibility[];
  /** Read-only: a later permission change or source revision invalidates it. */
  invalidatedAt?: string;
  invalidReason?: string;
}

export function buildContextPack(input: {
  taskId: string; edges: KnowledgeEdge[]; registryVersion: number;
  visibilityFilter: (v: Visibility) => boolean;
  at?: string; ttlHours?: number;
}): ContextPack {
  const at = input.at ?? new Date().toISOString();
  const eligible = eligibleForContextPack(input.edges, at).filter(e => input.visibilityFilter(e.visibility));
  for (const e of eligible) assertUsable(e, at);
  const refs = new Map<string, ContextPack['refs'][number]>();
  for (const e of eligible) for (const ref of e.evidenceRefs) {
    const key = `${ref.sourceId}@${ref.revision}`;
    const found = refs.get(key) ?? { sourceId: ref.sourceId, revision: ref.revision, edgeIds: [] };
    if (!found.edgeIds.includes(e.id)) found.edgeIds.push(e.id);
    if (ref.excerpt && !found.excerpt) found.excerpt = ref.excerpt;
    refs.set(key, found);
  }
  return { schemaVersion: 1, taskId: input.taskId, createdAt: at,
    expiresAt: new Date(Date.parse(at) + (input.ttlHours ?? 24) * 3600_000).toISOString(),
    registryVersion: input.registryVersion, refs: [...refs.values()],
    labels: [...new Map(eligible.map(e => [JSON.stringify(e.visibility), e.visibility])).values()] };
}

export function invalidatePack(pack: ContextPack, reason: string, at: string): ContextPack {
  return { ...pack, invalidatedAt: at, invalidReason: reason };
}

/** FR-06: one label scheme for structured / unstructured / graph data. */
export function assertLabelAccess(input: {
  data: Visibility; capability: { space: string; roleId?: string; classification: string; at: string };
  grant?: { space: string; allowedRefs?: string[]; readonly: boolean; expiresAt: string } | null;
}): { allowed: true; reason: string } {
  const rank: Record<string, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };
  if ((rank[input.data.classification] ?? 9) > (rank[input.capability.classification] ?? 0)) throw new Error('数据密级超出能力标签，双向校验拒绝');
  if (input.data.roleId && input.data.roleId !== input.capability.roleId) throw new Error('数据职能标签与能力标签不匹配');
  if (input.data.space !== input.capability.space) {
    if (!input.grant || input.grant.space !== input.data.space) throw new Error('跨 Workspace 默认不继承权限，需先申请授权');
    if (!input.grant.readonly) throw new Error('跨空间授权默认只读，写权需单独审批');
    if (Date.parse(input.grant.expiresAt) <= Date.parse(input.capability.at)) throw new Error('跨空间授权已过期');
  }
  if (input.data.validUntil && Date.parse(input.data.validUntil) <= Date.parse(input.capability.at)) throw new Error('数据时效已过');
  return { allowed: true, reason: input.data.space === input.capability.space ? '空间内最小权限子集校验通过' : '按目标空间 owner 授权的最小可见子集放行' };
}
