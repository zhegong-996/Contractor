// 方案 B · 从 append-only 事件日志重放四类共享记忆投影（纯函数）。
//
// 验收红线：
//   1. 重放可复现——不使用 Date.now()，排序稳定、去重、checksum 稳定；
//   2. 来源撤权后派生记忆不可召回——source-revoked 沿 causedBy lineage
//      传播失效（投影 + 召回双层过滤）；grant-revoked 只登记主体，由召回层
//      按当前 principal 精确过滤，不放大成全局屏蔽；
//   3. 确定性链路 modelCalls=0——所有事件模型调用数累加，非零即不通过。
//
// 四类投影：L1 证据图 / L2 组织图 / BM25 向量索引 / Context Pack。
// 这里不替代现有 Cognee / Ladybug / SQLite 存储，而是给出可验证的重放口径，
// 让「知识库 = Agent 共享记忆」有唯一真源可核对。
import { createHash } from 'node:crypto';
import type { MemoryEvent } from './architecture-contracts.ts';

// 本地定义，保持本模块零 IO 依赖（重放必须可在任意环境纯函数执行）。
const sourceKey = (sourceId: string, revision: string) => `${sourceId}@${revision}`;

export type L1EvidenceEntry = { key: string; sourceId: string; revision: string; chunks: number; concepts: number; facts: string[]; at: string; eventId: string };
export type L2EdgeEntry = { id: string; kind: string; from: string; to: string; state: string; sourceId?: string; revision?: string; at: string; eventId: string };
export type BM25Chunk = { id: string; sourceId: string; revision: string; text: string; tokens: string[]; visibility: string; at: string; eventId: string };
export type ContextPackEntry = { id: string; taskId: string; refs: string[]; expiresAt?: string; at: string; eventId: string };
/** 单主体授权撤销：只影响该主体对同源派生记忆的读取，不放大成全局屏蔽。 */
export type PrincipalRevocation = {
  principal: string; sourceId: string; revision?: string; accessId?: string; at: string; eventId: string;
};

export type MemoryProjectionBundle = {
  schemaVersion: 2;
  /** 取事件流最后一条时间，绝不取当前时间，保证重放可复现。 */
  at: string;
  events: number;
  l1Evidence: L1EvidenceEntry[];
  l2Organization: L2EdgeEntry[];
  bm25Vector: BM25Chunk[];
  contextPacks: ContextPackEntry[];
  acceptance: { taskId: string; at: string; eventId: string }[];
  revokedSources: string[];
  /** 全局集合：只含「资料本身被撤回」的来源，供重放层 lineage 阻断。 */
  revokedSourceIds: string[];
  /** 仅「资料本身被撤回」的来源：用于运行时读取链路（与 revokedSourceIds 同源，保留独立口径便于核对）。 */
  sourceRevocations: string[];
  /** 单主体授权撤销：重放层不据此全局失效，由召回层按当前 principal 精确过滤。 */
  principalRevocations: PrincipalRevocation[];
  invalidatedEventIds: string[];
  /** 投影阶段因撤权 / lineage 失效而跳过的事件数；与召回层计数相加才是完整拦截量。 */
  suppressedByRevocation: number;
  modelCalls: number;
  deterministic: boolean;
  integrity: { duplicateIds: string[]; danglingCausedBy: string[]; invalidRows: string[]; logErrors: string[] };
};

const REVOCATION_KINDS = new Set(['source-revoked', 'grant-revoked']);

/** 中英混合的确定性分词；无随机、无外部调用。 */
export function tokenize(text: string): string[] {
  const latin = text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  const cjkSegments = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const singles = cjkSegments.flatMap(segment => [...segment].slice(0, 60));
  const bigrams = cjkSegments.flatMap(segment => {
    const out: string[] = [];
    for (let i = 0; i < segment.length - 1; i++) out.push(segment.slice(i, i + 2));
    return out;
  });
  return [...new Set([...latin, ...singles, ...bigrams])];
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(textOf).join(' ');
  return value === undefined || value === null ? '' : String(value);
}
const asString = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const asNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** 稳定序列化：对象键排序，数组保持重放顺序。 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}

const sorted = (events: MemoryEvent[]) => [...events].sort((a, b) =>
  a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

// --- 可续算的投影状态：全量重放与 B2-4 增量应用共用同一段构建逻辑 ---------
// 把事件 -> 投影的循环单独抽出来，增量路径就能只处理新事件，不必再重放历史，
// 也不会出现「两套实现、两个 checksum」的口径漂移。
export type ProjectionState = {
  l1: Map<string, L1EvidenceEntry>;
  l2: L2EdgeEntry[];
  chunks: BM25Chunk[];
  packs: ContextPackEntry[];
  acceptance: MemoryProjectionBundle['acceptance'];
  invalidRows: string[];
  modelCalls: number;
  suppressed: number;
};

export type BundleMeta = {
  rawCount: number;
  orderedUnique: MemoryEvent[];
  revokedSources: Set<string>;
  revokedSourceIds: Set<string>;
  sourceRevocations: Set<string>;
  principalRevocations: PrincipalRevocation[];
  invalidatedEventIds: string[];
  integrity: { duplicateIds: string[]; danglingCausedBy: string[]; logErrors: string[] };
};

export function emptyProjectionState(): ProjectionState {
  return { l1: new Map(), l2: [], chunks: [], packs: [], acceptance: [], invalidRows: [], modelCalls: 0, suppressed: 0 };
}

/** 从已保存的 bundle 恢复可续算状态；全部浅拷贝，避免增量写污染 checkpoint。 */
export function projectionStateFromBundle(bundle: MemoryProjectionBundle): ProjectionState {
  return {
    l1: new Map(bundle.l1Evidence.map(entry => [entry.key, { ...entry }])),
    l2: bundle.l2Organization.map(entry => ({ ...entry })),
    chunks: bundle.bm25Vector.map(chunk => ({ ...chunk })),
    packs: bundle.contextPacks.map(pack => ({ ...pack })),
    acceptance: bundle.acceptance.map(item => ({ ...item })),
    invalidRows: [...bundle.integrity.invalidRows],
    modelCalls: bundle.modelCalls,
    suppressed: bundle.suppressedByRevocation,
  };
}

/** 把一批事件应用到状态上；invalidSet 由调用方按撤权 lineage 预先算好。 */
export function applyProjectionEvents(state: ProjectionState, events: MemoryEvent[], invalidSet: Set<string>): void {
  for (const event of events) {
    state.modelCalls += event.modelCalls ?? 0;
    if (invalidSet.has(event.id)) { state.suppressed++; continue; }
    const payload = event.payload;
    const sourceId = asString(payload.sourceId, event.sourceRef?.sourceId ?? '');
    const revision = asString(payload.revision, event.sourceRef?.revision ?? '');
    const key = sourceId && revision ? sourceKey(sourceId, revision) : '';

    switch (event.kind) {
      case 'memory-indexed': {
        if (!key) { state.invalidRows.push(event.id + ':memory-indexed 缺 sourceRef'); break; }
        const entry = state.l1.get(key) ?? { key, sourceId, revision, chunks: 0, concepts: 0, facts: [], at: event.at, eventId: event.id };
        entry.chunks += asNumber(payload.chunks);
        entry.concepts += asNumber(payload.concepts);
        state.l1.set(key, entry);
        for (const raw of asArray(payload.chunkTexts)) {
          const chunk = raw as { id?: unknown; text?: unknown };
          const text = asString(chunk.text);
          if (!text) continue;
          state.chunks.push({ id: asString(chunk.id, event.id + ':' + state.chunks.length), sourceId, revision, text,
            tokens: tokenize(text), visibility: event.visibility ?? 'private', at: event.at, eventId: event.id });
        }
        if (!asArray(payload.chunkTexts).length) {
          state.chunks.push({ id: event.id + ':index', sourceId, revision,
            text: asString(payload.title, sourceId), tokens: tokenize(asString(payload.title, sourceId)),
            visibility: event.visibility ?? 'private', at: event.at, eventId: event.id });
        }
        break;
      }
      case 'fact-extracted': {
        if (!key) { state.invalidRows.push(event.id + ':fact-extracted 缺 sourceRef'); break; }
        const entry = state.l1.get(key) ?? { key, sourceId, revision, chunks: 0, concepts: 0, facts: [], at: event.at, eventId: event.id };
        const facts = asArray(payload.facts).map(textOf).filter(Boolean);
        entry.facts.push(...facts);
        state.l1.set(key, entry);
        break;
      }
      case 'edge-drafted': case 'edge-accepted': {
        for (const raw of asArray(payload.edges)) {
          const edge = raw as Record<string, unknown>;
          const id = asString(edge.id);
          if (!id) { state.invalidRows.push(event.id + ':edge 缺 id'); continue; }
          const existing = state.l2.findIndex(item => item.id === id);
          const next: L2EdgeEntry = { id, kind: asString(edge.kind), from: asString(edge.from), to: asString(edge.to),
            state: event.kind === 'edge-accepted' ? asString(payload.state, 'accepted') : 'draft',
            ...(sourceId ? { sourceId } : {}), ...(revision ? { revision } : {}), at: event.at, eventId: event.id };
          if (existing >= 0) state.l2[existing] = next; else state.l2.push(next);
        }
        break;
      }
      case 'context-packed': {
        state.packs.push({ id: event.id, taskId: asString(payload.taskId), refs: asArray(payload.refs).map(textOf),
          ...(asString(payload.expiresAt) ? { expiresAt: asString(payload.expiresAt) } : {}),
          at: event.at, eventId: event.id });
        break;
      }
      case 'acceptance-recorded': {
        state.acceptance.push({ taskId: asString(payload.taskId), at: event.at, eventId: event.id });
        break;
      }
      default: break; // routing-decided / source-ingested / projection-rebuilt 不参与四类投影
    }
  }
}

export function assembleBundle(state: ProjectionState, meta: BundleMeta): MemoryProjectionBundle {
  const at = meta.orderedUnique.length
    ? meta.orderedUnique[meta.orderedUnique.length - 1]!.at : '1970-01-01T00:00:00.000Z';
  return {
    schemaVersion: 2, at, events: meta.rawCount,
    l1Evidence: [...state.l1.values()].sort((a, b) => a.key.localeCompare(b.key)),
    l2Organization: [...state.l2].sort((a, b) => a.id.localeCompare(b.id)),
    bm25Vector: state.chunks,
    contextPacks: state.packs,
    acceptance: state.acceptance,
    revokedSources: [...meta.revokedSources].sort(),
    revokedSourceIds: [...meta.revokedSourceIds].sort(),
    sourceRevocations: [...meta.sourceRevocations].sort(),
    principalRevocations: meta.principalRevocations,
    invalidatedEventIds: meta.invalidatedEventIds,
    suppressedByRevocation: state.suppressed,
    modelCalls: state.modelCalls,
    deterministic: state.modelCalls === 0,
    integrity: { duplicateIds: meta.integrity.duplicateIds,
      danglingCausedBy: meta.integrity.danglingCausedBy,
      invalidRows: state.invalidRows, logErrors: meta.integrity.logErrors },
  };
}

/** 规范化事件流：稳定排序 + 按 id 去重（保留首次出现），重复如实记录。 */
export function normalizeEvents(events: MemoryEvent[]): { orderedUnique: MemoryEvent[]; duplicateIds: string[] } {
  const ordered = sorted(events);
  const seen = new Map<string, MemoryEvent>(), duplicateIds: string[] = [];
  for (const event of ordered) {
    if (seen.has(event.id)) duplicateIds.push(event.id);
    else seen.set(event.id, event);
  }
  return { orderedUnique: [...seen.values()], duplicateIds };
}

export function replayMemory(events: MemoryEvent[], logErrors: string[] = []): MemoryProjectionBundle {
  const { orderedUnique: unique, duplicateIds } = normalizeEvents(events);
  const byId = new Map(unique.map(event => [event.id, event]));
  const danglingCausedBy = unique.filter(event => event.causedBy && !byId.has(event.causedBy)).map(event => event.id);

  // --- 1. 撤销事实：状态写入而非物理删除 ---
  // source-revoked = 资料本身被撤回，全局阻断该来源的所有派生记忆；
  // grant-revoked = 某一个主体的授权被撤销，只登记主体，不做全局 lineage 阻断。
  // 后者由 recallMemory 按当前 principal 精确过滤，避免 A 撤权连带屏蔽 B 的同源记忆。
  const revokedSources = new Set<string>(), revokedSourceIds = new Set<string>(), sourceRevocations = new Set<string>();
  const principalRevocations: PrincipalRevocation[] = [];
  for (const event of unique) {
    if (!REVOCATION_KINDS.has(event.kind)) continue;
    const sourceId = asString(event.payload.sourceId, event.sourceRef?.sourceId ?? '');
    const revision = asString(event.payload.revision, event.sourceRef?.revision ?? '');
    if (event.kind === 'grant-revoked') {
      if (sourceId) principalRevocations.push({
        principal: asString(event.payload.agent, asString(event.payload.principal, event.actor)),
        sourceId,
        ...(revision ? { revision } : {}),
        ...(asString(event.payload.accessId) ? { accessId: asString(event.payload.accessId) } : {}),
        at: event.at, eventId: event.id,
      });
      continue;
    }
    if (sourceId) {
      sourceRevocations.add(sourceId);
      revokedSourceIds.add(sourceId);
      if (revision) revokedSources.add(sourceKey(sourceId, revision));
    }
    for (const item of asArray(event.payload.sourceRefs)) {
      const ref = item as { sourceId?: unknown; revision?: unknown };
      const id = asString(ref.sourceId), rev = asString(ref.revision);
      if (id) { revokedSourceIds.add(id); if (rev) revokedSources.add(sourceKey(id, rev)); }
    }
  }
  principalRevocations.sort((a, b) =>
    a.principal.localeCompare(b.principal) || a.sourceId.localeCompare(b.sourceId) || a.eventId.localeCompare(b.eventId));

  // --- 2. lineage 传播：自身命中撤权，或任一祖先命中，即失效 ---
  const invalidCache = new Map<string, boolean>();
  const walking = new Set<string>();
  const isInvalid = (event: MemoryEvent): boolean => {
    if (REVOCATION_KINDS.has(event.kind) || event.kind === 'edge-invalidated') return false;
    if (invalidCache.has(event.id)) return invalidCache.get(event.id)!;
    if (walking.has(event.id)) return true; // 环形 lineage 一律保守失效
    walking.add(event.id);
    const own = event.sourceRef
      && (revokedSourceIds.has(event.sourceRef.sourceId)
        || revokedSources.has(sourceKey(event.sourceRef.sourceId, event.sourceRef.revision)));
    let result = Boolean(own) || event.payload.revoked === true;
    if (!result && event.causedBy) {
      const parent = byId.get(event.causedBy);
      // 悬空 lineage 只记入 integrity.danglingCausedBy，不误伤正常链路；
      // 撤权的主要防线是事件自身 sourceRef 的版本级命中。
      result = parent ? isInvalid(parent) : false;
    }
    walking.delete(event.id);
    invalidCache.set(event.id, result);
    return result;
  };
  const invalidatedEventIds = unique.filter(isInvalid).map(event => event.id).sort();

  // --- 3. 四类投影（只消费未失效事件） ---
  const state = emptyProjectionState();
  applyProjectionEvents(state, unique, new Set(invalidatedEventIds));
  return assembleBundle(state, {
    rawCount: events.length,
    orderedUnique: unique,
    revokedSources, revokedSourceIds, sourceRevocations, principalRevocations,
    invalidatedEventIds,
    integrity: { duplicateIds, danglingCausedBy, logErrors },
  });
}

/** 稳定校验和；两次重放相同日志必须得到相同值。 */
export function projectionChecksum(bundle: MemoryProjectionBundle): string {
  return createHash('sha256').update(canonical(bundle)).digest('hex');
}

export type RecallHit = { chunkId: string; sourceId: string; revision: string; text: string; score: number; eventId: string };

/**
 * 召回：只读投影，不调用任何模型（modelCalls 恒 0）；撤权来源与失效 lineage 双层过滤。
 */
export function recallMemory(bundle: MemoryProjectionBundle, query: string,
  options: { limit?: number; visibility?: string; principal?: string } = {}):
  { hits: RecallHit[]; excludedByRevocation: number; modelCalls: 0; engine: 'replay-bm25' } {
  const invalid = new Set(bundle.invalidatedEventIds);
  const revoked = new Set(bundle.revokedSourceIds);
  // 单主体授权撤销：只阻断该主体。未指定主体时 fail-closed，宁可少召回也不越权。
  const principalBlocked = new Set<string>();
  for (const item of bundle.principalRevocations ?? []) {
    if (!options.principal || item.principal === options.principal) principalBlocked.add(item.sourceId);
  }
  const terms = tokenize(query);
  // 第一层（投影构建）已跳过的失效事件 + 第二层（召回）再过滤的条目。
  let excludedByRevocation = bundle.suppressedByRevocation;
  const hits: RecallHit[] = [];
  for (const chunk of bundle.bm25Vector) {
    if (invalid.has(chunk.eventId) || revoked.has(chunk.sourceId) || principalBlocked.has(chunk.sourceId)) {
      excludedByRevocation++; continue;
    }
    if (options.visibility && chunk.visibility !== options.visibility) continue;
    const bag = chunk.tokens;
    let score = 0;
    for (const term of terms) {
      const frequency = bag.filter(token => token === term).length;
      if (frequency) score += 1 + Math.log(frequency);
    }
    if (score > 0) hits.push({ chunkId: chunk.id, sourceId: chunk.sourceId, revision: chunk.revision,
      text: chunk.text, score: Math.round(score * 1000) / 1000, eventId: chunk.eventId });
  }
  hits.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
  return { hits: hits.slice(0, options.limit ?? 8), excludedByRevocation, modelCalls: 0, engine: 'replay-bm25' };
}

/** 确定性链路红线：一旦出现模型调用，明确拒绝而不是降级。 */
export function assertDeterministic(bundle: MemoryProjectionBundle): void {
  if (!bundle.deterministic) throw new Error(`确定性链路被破坏：事件流累计 modelCalls=${bundle.modelCalls}，应为 0`);
}

/** 只读报告：action / CLI / 测试共用，包含「两次重放一致」的现场验证。 */
export function memoryReplayReport(events: MemoryEvent[], logErrors: string[] = []) {
  const bundle = replayMemory(events, logErrors);
  const again = replayMemory(events, logErrors);
  return {
    ok: true,
    checksum: projectionChecksum(bundle),
    replayTwiceEqual: projectionChecksum(bundle) === projectionChecksum(again),
    deterministic: bundle.deterministic,
    modelCalls: bundle.modelCalls,
    eventCount: bundle.events,
    projections: { l1Evidence: bundle.l1Evidence.length, l2Organization: bundle.l2Organization.length,
      bm25Vector: bundle.bm25Vector.length, contextPacks: bundle.contextPacks.length, acceptance: bundle.acceptance.length },
    revocation: { sources: bundle.revokedSources, sourceIds: bundle.revokedSourceIds,
      sourceRevocations: bundle.sourceRevocations, principalRevocations: bundle.principalRevocations,
      invalidatedEvents: bundle.invalidatedEventIds.length,
      suppressedByRevocation: bundle.suppressedByRevocation },
    integrity: bundle.integrity,
    at: bundle.at,
    bundle,
  };
}
