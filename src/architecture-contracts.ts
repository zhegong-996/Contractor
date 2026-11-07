// 方案 A · 统一架构契约（v0.7）。
//
// 目的：把此前散在 org-ontology.ts / ontology.ts / memory-contract.ts 里的
// 「节点类型、边族、Agent 角色、记忆事件与投影」收敛到单一来源，供
// B（记忆主干）与 C（三层 router）复用。本文件只定义契约与常量，
// 不含 IO、不调用任何上游，因此是所有层都可以安全依赖的最底层。
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. 组织本体 TBox：节点类型、边族与 domain/range 约束
//    （原定义在 src/org-ontology.ts，现升为共享契约，org-ontology.ts 再导出保持兼容）
// ---------------------------------------------------------------------------

export const NODE_KINDS = [
  'person', 'role', 'workspace', 'project', 'task', 'thread', 'message',
  'context-pack', 'source', 'source-fragment', 'artifact', 'evidence',
  'acceptance-plan', 'acceptance-round', 'transfer', 'signal',
] as const;
export type NodeKind = typeof NODE_KINDS[number];

export const EDGE_FAMILIES = ['belongs_to_role', 'participated_in', 'verified_by', 'responsible_for', 'reused_by'] as const;
export type EdgeFamily = typeof EDGE_FAMILIES[number];

export const EDGE_RULES: Record<EdgeFamily, { from: NodeKind[]; to: NodeKind[]; purpose: string }> = {
  belongs_to_role: { from: ['person', 'transfer'], to: ['role'], purpose: '归属职责：主职能与责任锚点' },
  participated_in: { from: ['person', 'role'], to: ['task', 'project', 'thread', 'source'], purpose: '参与派生：领域与邻接能力从真实参与长出' },
  verified_by: { from: ['artifact', 'acceptance-plan', 'acceptance-round'], to: ['evidence', 'source-fragment', 'source'], purpose: '验收证据：制品依据哪条证据' },
  responsible_for: { from: ['person', 'role', 'transfer'], to: ['task', 'artifact', 'acceptance-plan'], purpose: '责任链：执行责任与兜底责任' },
  reused_by: { from: ['artifact', 'source', 'source-fragment', 'context-pack'], to: ['task', 'artifact', 'context-pack'], purpose: '复用影响：熔断时反查影响面' },
};

// ---------------------------------------------------------------------------
// 2. ontology 三层分工：避免把「空间字典」「组织本体」「Cognee 图模型」混为一谈
// ---------------------------------------------------------------------------

export const ONTOLOGY_LAYERS = [
  { id: 'space-dictionary', owner: 'src/ontology.ts', purpose: '单个知识空间的概念 / 字段 / 关系字典，序列化为 Cognee graph_schema' },
  { id: 'organization-graph', owner: 'src/org-ontology.ts', purpose: '跨来源组织事实：责任、参与、证据、复用的轻量 TBox' },
  { id: 'cognee-graph-model', owner: 'upstream/cognee', purpose: 'DataPoint / GraphSchema / OWL grounding，管抽取结构与词汇归一' },
] as const;
export type OntologyLayerId = typeof ONTOLOGY_LAYERS[number]['id'];

// ---------------------------------------------------------------------------
// 3. Agent 角色（方案 C 三层 router 的地基；A 阶段只定义，不启用）
// ---------------------------------------------------------------------------

export const AGENT_ROLES = ['personal', 'supervisor', 'worker'] as const;
export type AgentRole = typeof AGENT_ROLES[number];
export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  personal: 'Personal Agent · 1:1 过滤信息，人只与它对话',
  supervisor: '项目主管 Agent · 派活、跟进与预验收',
  worker: '执行 Agent · Autoloop / Codex / Claude Code',
};

/** 四套已接入上游在运行时中的职责边界，禁止再各写一套角色模型。 */
export const AGENT_RUNTIME_SOURCES = [
  { id: 'superagent', role: 'trigger', detail: '飞书触发解析、线程键、settingsPolicy / assessmentOutcome' },
  { id: 'deepseek-harness', role: 'composition', detail: 'persona / scope / 工具管线 / 输入保留' },
  { id: 'autoloop', role: 'execution', detail: 'worker 契约、进程执行、回执恢复' },
  { id: 'a2a-sdk', role: 'delegation', detail: '服务 Agent 委派与 task 交接' },
] as const;

// ---------------------------------------------------------------------------
// 4. 共享记忆（方案 B 的地基）：append-only 事件 + 多投影
// ---------------------------------------------------------------------------

export const MEMORY_PROJECTIONS = ['l1-evidence', 'l2-organization', 'bm25-vector', 'context-pack'] as const;
export type MemoryProjection = typeof MEMORY_PROJECTIONS[number];

export const MEMORY_EVENT_KINDS = [
  'source-ingested', 'fact-extracted', 'edge-drafted', 'edge-accepted',
  'edge-invalidated', 'context-packed', 'acceptance-recorded',
  // 方案 B 的事件主干同时承载「谁把任务交给谁」：RoutingDecision 通过
  // toMemoryEvent() 变成 append-only 事件，B 阶段重放时不必另造一套日志。
  'routing-decided',
] as const;
export type MemoryEventKind = typeof MEMORY_EVENT_KINDS[number];

/** 溯源字段是强制的：没有 actor / at / sourceRef 的事件不能成为记忆主干的真源。 */
export const memoryEventSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(MEMORY_EVENT_KINDS),
  actor: z.string().min(1),
  at: z.string().min(1),
  causedBy: z.string().optional(),
  sourceRef: z.object({ sourceId: z.string().min(1), revision: z.string().min(1) }).optional(),
  policyVersion: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type MemoryEvent = z.infer<typeof memoryEventSchema>;

/** 契约摘要：供设置页、文档与测试核对版本，避免各层口径漂移。 */
export function architectureContractSummary() {
  return {
    schemaVersion: 1 as const,
    nodeKinds: NODE_KINDS.length,
    edgeFamilies: EDGE_FAMILIES.length,
    ontologyLayers: ONTOLOGY_LAYERS.map(layer => layer.id),
    agentRoles: AGENT_ROLES,
    memoryProjections: MEMORY_PROJECTIONS,
    memoryEventKinds: MEMORY_EVENT_KINDS.length,
  };
}
