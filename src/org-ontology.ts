// v0.6 FR-08 — organisation graph (L2) built on the shared architecture contract.
//
// This is NOT src/ontology.ts (which validates a Cognee GraphSchema dictionary
// for one knowledge space). It describes cross-source organisation facts:
// who was responsible for what, which evidence a deliverable relied on, and
// which tasks a bad judgement influenced.
//
// 方案 A（v0.7）：节点类型、边族与 domain/range 规则已上移到
// src/architecture-contracts.ts 作为单一来源；本文件保留 L2 图特有的
// schema、校验与查询函数，并再导出常量以兼容既有 import。
import { z } from 'zod';
import { NODE_KINDS, EDGE_FAMILIES, EDGE_RULES } from './architecture-contracts.ts';

export { NODE_KINDS, EDGE_FAMILIES, EDGE_RULES } from './architecture-contracts.ts';
export type { NodeKind, EdgeFamily } from './architecture-contracts.ts';

export const orgNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(NODE_KINDS),
  label: z.string().min(1),
  /** Reference into the L1 evidence graph; L2 never duplicates source text. */
  sourceRef: z.object({ sourceId: z.string(), revision: z.string() }).optional(),
  at: z.string(),
}).strict();
export type OrgNode = z.infer<typeof orgNodeSchema>;

export const orgEdgeSchema = z.object({
  id: z.string().min(1),
  family: z.enum(EDGE_FAMILIES),
  from: z.string().min(1),
  to: z.string().min(1),
  /** Draft relations are inferred and may never be used as a basis. */
  state: z.enum(['draft', 'accepted', 'reusable']).default('draft'),
  evidenceRefs: z.array(z.object({ sourceId: z.string(), revision: z.string(), excerpt: z.string().optional() })).default([]),
  actor: z.string().min(1),
  at: z.string(),
  invalidAt: z.string().optional(),
}).strict();
export type OrgEdge = z.infer<typeof orgEdgeSchema>;

export const orgGraphSchema = z.object({
  schemaVersion: z.literal(1),
  nodes: z.array(orgNodeSchema),
  edges: z.array(orgEdgeSchema),
}).strict();
export type OrgGraph = z.infer<typeof orgGraphSchema>;

export function validateOrgGraph(graph: OrgGraph): void {
  orgGraphSchema.parse(graph);
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  if (nodes.size !== graph.nodes.length) throw new Error('组织图谱节点 ID 重复');
  if (new Set(graph.edges.map(e => e.id)).size !== graph.edges.length) throw new Error('组织图谱边 ID 重复');
  for (const e of graph.edges) {
    const from = nodes.get(e.from), to = nodes.get(e.to);
    if (!from || !to) throw new Error(`边 ${e.id} 指向不存在的节点`);
    const rule = EDGE_RULES[e.family];
    if (!rule.from.includes(from.kind) || !rule.to.includes(to.kind))
      throw new Error(`边 ${e.id} 的 ${from.kind} → ${to.kind} 不符合 ${e.family} 的本体规则`);
    if (e.state !== 'draft' && !e.evidenceRefs.length) throw new Error('已验收 / 可复用的边必须带 L1 原文证据引用');
  }
}

/** The three questions the ontology must answer (PRD FR-08). */
export function responsibilityOf(graph: OrgGraph, nodeId: string) {
  return graph.edges.filter(e => e.family === 'responsible_for' && e.to === nodeId && !e.invalidAt)
    .map(e => ({ actorNode: graph.nodes.find(n => n.id === e.from), edge: e }));
}
export function evidenceOf(graph: OrgGraph, artifactId: string) {
  const ids = graph.edges.filter(e => e.family === 'verified_by' && e.from === artifactId && !e.invalidAt).map(e => e.to);
  const nodes = graph.nodes.filter(n => ids.includes(n.id));
  return { nodes, refs: graph.edges.filter(e => e.family === 'verified_by' && e.from === artifactId).flatMap(e => e.evidenceRefs) };
}
export function influencedBy(graph: OrgGraph, edgeId: string): string[] {
  const origin = graph.edges.find(e => e.id === edgeId);
  if (!origin) return [];
  const seen = new Set<string>([origin.from, origin.to]);
  const queue = [origin.from, origin.to];
  while (queue.length) {
    const node = queue.shift()!;
    for (const e of graph.edges) if (e.family === 'reused_by' && (e.from === node || e.to === node)) {
      const next = e.from === node ? e.to : e.from;
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  seen.delete(origin.from);
  return [...seen];
}

/** Node/edge visibility is the enforcement point for FR-26 + FR-10. */
export function reachableFrom(graph: OrgGraph, startNodeIds: string[], allowedEdgeIds: string[]): Set<string> {
  const allowed = new Set(allowedEdgeIds);
  const seen = new Set<string>(startNodeIds);
  const queue = [...startNodeIds];
  while (queue.length) {
    const node = queue.shift()!;
    for (const e of graph.edges) if (allowed.has(e.id) && !e.invalidAt && (e.from === node || e.to === node)) {
      const next = e.from === node ? e.to : e.from;
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}
