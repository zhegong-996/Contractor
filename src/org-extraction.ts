// v0.6 FR-06/08/09 — L2 organisation-graph auto-extraction from the pinned
// Cognee L1 evidence graph.
//
// IMPORTANT BOUNDARIES (ADAPTATION C1 / KNOWLEDGE-ENGINE.md):
// * L1 stays physically isolated per sha256(sourceId@revision). This module
//   only READS one projection; it never projects, never writes to L1 and never
//   enables Cognee's LLM/embedding/cognify pipeline. modelCalls stays 0.
// * L2 never duplicates the source corpus. Each drafted edge carries a
//   verbatim excerpt plus { sourceId, revision }, and starts in `draft`.
//   Only a human can accept it (knowledge-edges.acceptEdge / R4).
// * Extraction is model-agnostic. The default adapter is deterministic and
//   fully testable without any model service. A model adapter can be plugged
//   into the SAME proposal shape later; every proposal — model or rule based —
//   goes through the same verbatim-evidence + ontology validation.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EDGE_FAMILIES, EDGE_RULES, orgEdgeSchema, orgNodeSchema, validateOrgGraph,
  type EdgeFamily, type NodeKind, type OrgEdge, type OrgGraph, type OrgNode } from './org-ontology.ts';
import { knowledgeEdgeSchema, type KnowledgeEdge } from './knowledge-edges.ts';

// ---------------------------------------------------------------------------
// L1 projection: the JSON returned by scripts/cognee-graph.py (op=read).
// ---------------------------------------------------------------------------
export const l1NodeSchema = z.object({ id: z.string().min(1), type: z.string().optional() }).passthrough();
export const l1EdgeSchema = z.object({ source: z.string().min(1), target: z.string().min(1), relation: z.string().min(1) }).passthrough();
export type L1Node = z.infer<typeof l1NodeSchema>;
export type L1Edge = z.infer<typeof l1EdgeSchema>;

export interface L1Projection {
  sourceId: string;
  revision: string;
  title: string;
  /** Full source body, used only to verify verbatim excerpts. */
  body: string;
  modelCalls: number;
  nodes: L1Node[];
  edges: L1Edge[];
}

export interface L1Reader {
  readonly id: string;
  read(input: { sourceId: string; revision: string }): Promise<L1Projection>;
}

/** The L1 physical-isolation key. Cross-revision leakage is rejected outright. */
export function isolationKey(sourceId: string, revision: string): string {
  return createHash('sha256').update(`${sourceId}@${revision}`).digest('hex');
}

export function assertL1Isolated(projection: L1Projection, sourceId: string, revision: string): void {
  if (projection.sourceId !== sourceId || projection.revision !== revision)
    throw new Error('L1 投影与请求的来源版本不一致，拒绝抽取');
  const mismatched = [
    ...projection.nodes.filter(n => (n.source_id && n.source_id !== sourceId) || (n.source_revision && n.source_revision !== revision)).map(n => n.id),
    ...projection.edges.filter(e => e.source_revision && e.source_revision !== revision).map(e => `${e.source}->${e.target}`),
  ];
  if (mismatched.length) throw new Error(`L1 图混入了其他来源版本的节点/边（${mismatched.length} 处），拒绝跨来源抽取`);
}

/** Every drafted edge must quote something that actually exists in this L1 projection. */
function corpusOf(projection: L1Projection): string[] {
  const texts: string[] = [projection.body, projection.title];
  for (const node of projection.nodes) for (const key of ['body', 'text', 'evidence', 'value_json', 'name', 'value'])
    if (typeof node[key] === 'string' && node[key]) texts.push(node[key] as string);
  for (const edge of projection.edges) for (const key of ['evidence', 'quote'])
    if (typeof edge[key] === 'string' && edge[key]) texts.push(edge[key] as string);
  return texts;
}
function verbatim(corpus: string[], excerpt: string): boolean {
  const value = excerpt.trim();
  return value.length >= 2 && corpus.some(text => text.includes(value));
}
/** Find a short, verbatim excerpt that contains `value` anywhere in the L1 corpus. */
function quoteFor(corpus: string[], value: string): string | null {
  const needle = String(value ?? '').trim();
  if (needle.length < 2) return null;
  const hit = corpus.find(text => text.includes(needle));
  if (!hit) return null;
  const start = Math.max(0, hit.indexOf(needle) - 60);
  return hit.slice(start, start + 240);
}

// ---------------------------------------------------------------------------
// Adapters — same proposal shape, deterministic by default.
// ---------------------------------------------------------------------------
export interface ProposedEdge {
  family: EdgeFamily;
  from: OrgNode;
  to: OrgNode;
  /** Verbatim excerpt from the L1 corpus. Never a model-authored "fact". */
  excerpt: string;
  rationale: string;
}

export interface ExtractionAdapter {
  readonly id: string;
  /** How many model calls this adapter performs. 0 for the deterministic one. */
  readonly modelCalls: number;
  extract(input: { projection: L1Projection; sourceId: string; revision: string; taskId: string; at: string }): Promise<ProposedEdge[]>;
}

const FAMILY_PATTERNS: [RegExp, EdgeFamily][] = [
  [/responsible|负责|owner|责任|归属人/i, 'responsible_for'],
  [/verify|verified|依据|验收|证据|引用|佐证/i, 'verified_by'],
  [/participat|参与|加入|协作|协同/i, 'participated_in'],
  [/reuse|复用|沿用|参考|引用来源/i, 'reused_by'],
  [/belong|归属|职能|角色|role/i, 'belongs_to_role'],
];
const familyFor = (predicate: string): EdgeFamily | null =>
  FAMILY_PATTERNS.find(([pattern]) => pattern.test(predicate))?.[1] ?? null;
const personLike = (type: string): boolean => /person|member|people|role|负责人|成员|人员|角色/i.test(type ?? '');

/** Deterministic, zero-model extraction over the pinned Cognee projection. */
export class DeterministicExtractionAdapter implements ExtractionAdapter {
  readonly id = 'deterministic-l1-projection';
  readonly modelCalls = 0;
  async extract(input: { projection: L1Projection; sourceId: string; revision: string; taskId: string; at: string }): Promise<ProposedEdge[]> {
    const { projection, sourceId, revision, taskId, at } = input;
    const key = isolationKey(sourceId, revision).slice(0, 12);
    const node = (kind: NodeKind, label: string): OrgNode => orgNodeSchema.parse({
      id: `l2:${key}:${kind}:${createHash('sha256').update(label).digest('hex').slice(0, 12)}`,
      kind, label: String(label).slice(0, 160), sourceRef: { sourceId, revision }, at,
    });
    const corpus = corpusOf(projection);
    const byId = new Map(projection.nodes.map(n => [n.id, n]));
    const sourceNode = node('source', projection.title || sourceId);
    const taskNode = node('task', taskId);
    const artifactNode = node('artifact', `交付物 · ${taskId}`);
    const proposals: ProposedEdge[] = [];
    const add = (family: EdgeFamily, from: OrgNode, to: OrgNode, excerpt: string | null, rationale: string) => {
      if (!excerpt || !verbatim(corpus, excerpt)) return;
      proposals.push({ family, from, to, excerpt: excerpt.trim().slice(0, 240), rationale });
    };

    for (const edge of projection.edges) {
      const target = byId.get(edge.target);
      const source = byId.get(edge.source);
      // 1. Structured facts (has_field) become evidence fragments for the
      //    deliverable; owner-like fields additionally become responsibility.
      if (edge.relation === 'has_field' && target) {
        const name = String(target.name ?? '').trim();
        const raw = String(target.value_json ?? target.value ?? '').trim();
        const value = (() => { try { return JSON.parse(raw); } catch { return raw; } })();
        const fragment = node('source-fragment', `${name}=${String(value)}`);
        add('verified_by', artifactNode, fragment, quoteFor(corpus, String(value)) ?? quoteFor(corpus, name), '结构化字段投影为 L2 证据引用');
        if (/owner|负责人|responsible|责任|职能|role/i.test(name)) {
          const person = node('person', String(value));
          const quote = quoteFor(corpus, String(value));
          add('responsible_for', person, taskNode, quote, '责任人字段投影为 L2 责任链');
          add('belongs_to_role', person, node('role', name), quote, '责任人字段投影为 L2 职能归属');
        }
        continue;
      }
      // 2. Human-reviewed concept mentions become evidence + participation.
      if (edge.relation === 'mentions' && target) {
        const conceptName = String(target.name ?? '').trim();
        const concept = node('source-fragment', conceptName);
        const quote = typeof edge.evidence === 'string' ? edge.evidence : quoteFor(corpus, conceptName);
        add('verified_by', artifactNode, concept, quote, '已人审概念投影为 L2 证据引用');
        if (personLike(String(target.concept_type ?? '')))
          add('participated_in', node('person', conceptName), sourceNode, quote, '人员类概念投影为 L2 参与派生');
        continue;
      }
      // 3. Chunks are the quote corpus, NOT organisation facts. Never draft.
      if (edge.relation === 'has_chunk') continue;
      // 4. Custom predicates only map through an explicit dictionary. An
      //    unmapped predicate is skipped, never guessed into a relation.
      const family = familyFor(edge.relation);
      if (!family) continue;
      const fromName = String(source?.name ?? edge.source).trim();
      const toName = String(target?.name ?? edge.target).trim();
      const quote = typeof edge.evidence === 'string' ? edge.evidence : quoteFor(corpus, fromName) ?? quoteFor(corpus, toName);
      const pairs: Record<EdgeFamily, [OrgNode, OrgNode]> = {
        responsible_for: [node('person', fromName), taskNode],
        participated_in: [node('person', fromName), sourceNode],
        verified_by: [artifactNode, node('source-fragment', toName)],
        reused_by: [sourceNode, taskNode],
        belongs_to_role: [node('person', fromName), node('role', toName)],
      };
      add(family, ...pairs[family], quote, `L1 谓词「${edge.relation}」按本体字典映射到 ${family}`);
    }
    return proposals;
  }
}

/**
 * Optional model adapter. The `judge` function is injected (HTTP client,
 * local model process, test double), so this repo does NOT start a model
 * service. Every returned proposal is still validated verbatim before use.
 */
export const modelProposalSchema = z.object({
  family: z.enum(EDGE_FAMILIES), fromLabel: z.string().min(1).max(160), toLabel: z.string().min(1).max(160),
  excerpt: z.string().min(2).max(240), rationale: z.string().min(1).max(300),
}).strict();
export type ModelProposal = z.infer<typeof modelProposalSchema>;

export class ModelExtractionAdapter implements ExtractionAdapter {
  readonly id: string;
  readonly modelCalls = 1;
  constructor(private readonly judge: (input: { projection: L1Projection; taskId: string }) => Promise<unknown>, id = 'pluggable-model-adapter') {
    this.id = id;
  }
  async extract(input: { projection: L1Projection; sourceId: string; revision: string; taskId: string; at: string }): Promise<ProposedEdge[]> {
    const raw = await this.judge({ projection: input.projection, taskId: input.taskId });
    const list = z.array(modelProposalSchema).max(60).parse(raw);
    const key = isolationKey(input.sourceId, input.revision).slice(0, 12);
    const node = (family: EdgeFamily, side: 'from' | 'to', label: string): OrgNode => {
      const kinds = EDGE_RULES[family][side];
      return orgNodeSchema.parse({
        id: `l2:${key}:${kinds[0]}:${createHash('sha256').update(label).digest('hex').slice(0, 12)}`,
        kind: kinds[0]!, label, sourceRef: { sourceId: input.sourceId, revision: input.revision }, at: input.at,
      });
    };
    return list.map(p => ({ family: p.family, from: node(p.family, 'from', p.fromLabel), to: node(p.family, 'to', p.toLabel),
      excerpt: p.excerpt, rationale: p.rationale }));
  }
}

// ---------------------------------------------------------------------------
// Pipeline: read -> validate evidence -> draft edges -> merge
// ---------------------------------------------------------------------------
export interface RejectedProposal { reason: string; proposal?: ProposedEdge }

export interface OrgExtractionResult {
  sourceId: string;
  revision: string;
  taskId: string;
  isolationKey: string;
  adapterId: string;
  modelCalls: number;
  at: string;
  /** New draft edges only; existing human-accepted edges are never returned. */
  edges: KnowledgeEdge[];
  orgNodes: OrgNode[];
  orgEdges: OrgEdge[];
  rejected: RejectedProposal[];
  skippedExisting: number;
  l1: { nodes: number; edges: number; modelCalls: number };
}

export interface OrgExtractionInput {
  projection: L1Projection;
  sourceId: string;
  revision: string;
  taskId: string;
  space: string;
  classification?: 'public' | 'internal' | 'confidential' | 'restricted';
  actor: string;
  at?: string;
  adapter?: ExtractionAdapter;
  existingEdges?: KnowledgeEdge[];
  existingGraph?: OrgGraph;
  maxEdges?: number;
}

export async function runOrgExtraction(input: OrgExtractionInput): Promise<OrgExtractionResult> {
  assertL1Isolated(input.projection, input.sourceId, input.revision);
  const at = input.at ?? new Date().toISOString();
  const adapter = input.adapter ?? new DeterministicExtractionAdapter();
  const corpus = corpusOf(input.projection);
  const key = isolationKey(input.sourceId, input.revision);
  const existingEdges = input.existingEdges ?? [];
  const existingGraph = input.existingGraph ?? { schemaVersion: 1 as const, nodes: [], edges: [] };
  const knownEdgeIds = new Set(existingEdges.map(e => e.id));
  const knownOrgEdgeIds = new Set(existingGraph.edges.map(e => e.id));
  const knownNodeIds = new Set(existingGraph.nodes.map(n => n.id));
  const max = input.maxEdges ?? 60;
  const proposals = await adapter.extract({ projection: input.projection, sourceId: input.sourceId,
    revision: input.revision, taskId: input.taskId, at });
  const rejected: RejectedProposal[] = [];
  const edges: KnowledgeEdge[] = [];
  const orgEdges: OrgEdge[] = [];
  const orgNodes: OrgNode[] = [];
  let skippedExisting = 0;

  for (const proposal of proposals) {
    const rule = EDGE_RULES[proposal.family];
    if (!rule.from.includes(proposal.from.kind) || !rule.to.includes(proposal.to.kind)) {
      rejected.push({ reason: `${proposal.from.kind} → ${proposal.to.kind} 不符合 ${proposal.family} 的本体规则`, proposal }); continue;
    }
    if (!verbatim(corpus, proposal.excerpt)) {
      rejected.push({ reason: '证据片段不来自该来源版本的 L1 原文，拒绝生成无依据关系', proposal }); continue;
    }
    if (edges.length >= max) {
      rejected.push({ reason: `超过单次抽取上限 ${max}`, proposal }); continue;
    }
    const digest = createHash('sha256').update(`${proposal.family}|${proposal.from.id}|${proposal.to.id}|${proposal.excerpt}`).digest('hex').slice(0, 20);
    const id = `l2:${key.slice(0, 12)}:${digest}`;
    if (knownEdgeIds.has(id) || knownOrgEdgeIds.has(id)) { skippedExisting++; continue; }
    knownEdgeIds.add(id); knownOrgEdgeIds.add(id);
    const evidenceRef = { sourceId: input.sourceId, revision: input.revision, excerpt: proposal.excerpt };
    try {
      edges.push(knowledgeEdgeSchema.parse({
        schemaVersion: 1, id, kind: proposal.family, from: proposal.from.id, to: proposal.to.id,
        state: 'draft', evidenceRefs: [evidenceRef], inferredBy: adapter.id,
        visibility: { space: input.space, classification: input.classification ?? 'internal' }, validFrom: at,
      }));
      orgEdges.push(orgEdgeSchema.parse({
        id, family: proposal.family, from: proposal.from.id, to: proposal.to.id,
        state: 'draft', evidenceRefs: [evidenceRef], actor: 'l2-extraction', at,
      }));
    } catch (error) {
      rejected.push({ reason: `草稿边结构校验失败：${String((error as Error).message ?? error)}`, proposal }); continue;
    }
    for (const n of [proposal.from, proposal.to]) if (!knownNodeIds.has(n.id)) {
      knownNodeIds.add(n.id); orgNodes.push(n);
    }
  }

  // Validate the merged graph, not just the drafts: an invalid existing graph
  // must never be silently "repaired" by an extraction run.
  validateOrgGraph({ schemaVersion: 1,
    nodes: [...existingGraph.nodes, ...orgNodes], edges: [...existingGraph.edges, ...orgEdges] });
  return {
    sourceId: input.sourceId, revision: input.revision, taskId: input.taskId,
    isolationKey: key, adapterId: adapter.id, modelCalls: adapter.modelCalls + input.projection.modelCalls,
    at, edges, orgNodes, orgEdges, rejected, skippedExisting,
    l1: { nodes: input.projection.nodes.length, edges: input.projection.edges.length, modelCalls: input.projection.modelCalls },
  };
}
