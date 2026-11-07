// 方案 B2 · 读取链切换：把 append-only 记忆主干重放出的投影召回，融合进检索结果。
//
// 设计约束（对应 HANDOFF/06 第 2 节 B2-1）：
//   1. 投影只是「第三路召回信号」，不是新的权限来源。所有结果必须先经过
//      TeamMemory.search 的 reusable() / allowed() / 版本 hash 重评，再按
//      sourceId@revision 白名单过滤；未授权来源的投影命中一律丢弃。
//   2. 读日志、重放、召回失败都是 advisory：只降级，不改变既有检索结果，
//      也不改变任务、回执与验收结论。
//   3. 不调用任何模型，modelCalls 恒为 0；撤权由 recallMemory 处理，
//      这里不另写一套撤权判断。
import { readBridgedEvents } from './memory-log.ts';
import { replayMemory, recallMemory, type RecallHit } from './memory-projections.ts';

export type AllowedSourceRef = { sourceId: string; revision: string };
export type ProjectionHit = RecallHit & { viaProjection: true };

export type ProjectionRecallInput = {
  query: string;
  /** 已经通过权限与版本重评的来源，投影命中只允许来自这些确切修订。 */
  allowed: AllowedSourceRef[];
  /** 当前检索主体；授权撤销只影响该主体的派生记忆。 */
  principal?: string;
  limit?: number;
};

export type ProjectionRecallResult = {
  hits: ProjectionHit[];
  excludedByRevocation: number;
  droppedUnauthorized: number;
  logErrors: number;
  events: number;
  deterministic: boolean;
  modelCalls: 0;
};

/**
 * 纯函数：把重放召回结果按「当前已授权的确切来源修订」裁剪。
 * 权限判定不在这里做——调用方必须先完成重评，这里只做白名单收口，
 * 因此不可能因为读了一份旧投影而绕过资料授权。
 */
export function projectRecallHits(
  recall: { hits: RecallHit[]; excludedByRevocation: number; modelCalls: 0 },
  allowed: AllowedSourceRef[],
  limit = 8,
): Pick<ProjectionRecallResult, 'hits' | 'excludedByRevocation' | 'droppedUnauthorized' | 'modelCalls'> {
  const permitted = new Set(allowed.map(ref => `${ref.sourceId}@${ref.revision}`));
  let droppedUnauthorized = 0;
  const hits: ProjectionHit[] = [];
  for (const hit of recall.hits) {
    if (!permitted.has(`${hit.sourceId}@${hit.revision}`)) { droppedUnauthorized++; continue; }
    hits.push({ ...hit, viaProjection: true });
    if (hits.length >= limit) break;
  }
  return { hits, excludedByRevocation: recall.excludedByRevocation, droppedUnauthorized, modelCalls: 0 };
}

/** 读真实事件主干 → 重放 → 投影召回。抛错由调用方按 advisory 降级。 */
export function projectionRecall(input: ProjectionRecallInput): ProjectionRecallResult {
  const { events, errors } = readBridgedEvents();
  const bundle = replayMemory(events, errors);
  const limit = input.limit ?? 8;
  // 多召回一些再按白名单裁剪，避免授权来源排在末尾时命中过少。
  const recall = recallMemory(bundle, input.query, {
    limit: Math.max(limit * 3, 24),
    ...(input.principal ? { principal: input.principal } : {}),
  });
  return {
    ...projectRecallHits(recall, input.allowed, limit),
    logErrors: errors.length,
    events: bundle.events,
    deterministic: bundle.deterministic,
    modelCalls: 0,
  };
}

/**
 * 两路融合：既有结果（Cognee BM25 / 语义混合）保留原分数与字段，
 * 投影命中按 RRF 提供额外排序权重。附加字段只用于排序说明，
 * 不覆盖原有 score / lexicalScore / semanticScore，避免破坏调用方语义。
 */
export function fuseProjectionHits<T extends Record<string, unknown>>(
  base: T[],
  projection: ProjectionHit[],
  limit = 8,
  projectionWeight = 0.35,
): Array<T & { projectionScore: number; fusedScore: number }> {
  const weight = Math.min(1, Math.max(0, projectionWeight));
  const entries = new Map<string, { payload: Record<string, unknown>; fused: number; projection: number }>();
  const maxBase = Math.max(...base.map(hit => Number(hit.score ?? 0)), 0);
  const normaliser = maxBase > 0 ? maxBase : 1;
  base.forEach((hit, rank) => {
    const key = String(hit.chunkId ?? hit.id ?? rank);
    const normalized = Math.max(0, Number(hit.score ?? 0)) / normaliser;
    // 原分数与既有排名各占一半，避免不同引擎的分数量级不可比。
    const fused = 0.5 * normalized + 0.5 / (1 + rank);
    entries.set(key, { payload: { ...hit }, fused, projection: 0 });
  });
  projection.forEach((hit, rank) => {
    const key = hit.chunkId;
    const bonus = weight / (1 + rank);
    const existing = entries.get(key);
    if (existing) {
      existing.fused += bonus;
      existing.projection += bonus;
      // 同源命中同时出现在两路时，标明它来自共享记忆主干，便于追溯。
      existing.payload.projectionEventId = hit.eventId;
    } else {
      entries.set(key, { payload: { ...hit, via: 'projection' }, fused: bonus, projection: bonus });
    }
  });
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return [...entries.values()]
    .sort((a, b) => b.fused - a.fused || String(a.payload.chunkId).localeCompare(String(b.payload.chunkId)))
    .slice(0, limit)
    .map(entry => ({ ...(entry.payload as T), projectionScore: round(entry.projection), fusedScore: round(entry.fused) }));
}
