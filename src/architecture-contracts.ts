import { z } from 'zod';

export const MEMORY_PROJECTIONS = ['l1-evidence', 'l2-organization', 'bm25-vector', 'context-pack'] as const;
export type MemoryProjection = typeof MEMORY_PROJECTIONS[number];

export const MEMORY_EVENT_KINDS = [
  'source-ingested', 'fact-extracted', 'edge-drafted', 'edge-accepted',
  'edge-invalidated', 'context-packed', 'acceptance-recorded',
  'routing-decided',
  'source-revoked', 'grant-revoked', 'memory-indexed', 'projection-rebuilt',
] as const;
export type MemoryEventKind = typeof MEMORY_EVENT_KINDS[number];

/** 溯源字段是强制的：没有 actor / at / sourceRef 的事件不能成为记忆主干的真源。 */
export const memoryEventSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(MEMORY_EVENT_KINDS),
  actor: z.string().min(1),
  at: z.string().min(1),
  /** 派生自哪条事件；撤权沿这条链向前传播失效。 */
  causedBy: z.string().optional(),
  sourceRef: z.object({ sourceId: z.string().min(1), revision: z.string().min(1) }).optional(),
  policyVersion: z.string().optional(),
  /** 本次事件调用外部模型的次数；确定性链路必须为 0。 */
  modelCalls: z.number().int().nonnegative().optional(),
  /** 事件归属的投影（用于快速分组，不参与重放判定）。 */
  projection: z.enum(MEMORY_PROJECTIONS).optional(),
  /** 资料可见性标签，召回时按当前身份重评。 */
  visibility: z.enum(['private', 'space', 'shared']).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type MemoryEvent = z.infer<typeof memoryEventSchema>;
