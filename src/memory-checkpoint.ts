// 方案 B2-4 · 投影 checkpoint 与增量应用。
//
// 背景：append-only 主干变长后，每次只读重放都要从头扫描所有事件。这里把
// 「已处理事件 + 四类投影 + checksum」存成 checkpoint，新事件只增量应用。
//
// 正确性优先于性能：
//   * 撤权 / 边作废 / 乱序 / 重复 id / 已失效祖先 / 命中已撤回来源，
//     任何会回溯改变历史投影的情况，一律回退全量重放；
//   * 即使走了增量快速路径，也会与「全量重放」的 checksum 逐字节对照，
//     不一致立即回退全量，绝不返回口径漂移的投影。
//   * checksum 语义不变：增量与全量得到的是同一个 MemoryProjectionBundle。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runtime } from './config.ts';
import type { MemoryEvent } from './architecture-contracts.ts';
import {
  replayMemory, normalizeEvents, projectionChecksum, projectionStateFromBundle,
  applyProjectionEvents, assembleBundle, type MemoryProjectionBundle,
} from './memory-projections.ts';

export type MemoryCheckpoint = {
  schemaVersion: 1;
  /** 原始事件（含跨进程重复），append-only 前缀，不参与投影但保证全量口径一致。 */
  raw: MemoryEvent[];
  logErrors: string[];
  bundle: MemoryProjectionBundle;
  checksum: string;
};

export type CheckpointApplyResult = {
  checkpoint: MemoryCheckpoint;
  incremental: boolean;
  fallback: string | null;
  applied: number;
  checksumEqual: boolean;
  fullChecksum: string;
};

export const memoryCheckpointPath = (dir?: string) => path.join(dir ?? runtime('memory'), 'checkpoint.json');

export function createCheckpoint(events: MemoryEvent[], logErrors: string[] = []): MemoryCheckpoint {
  const bundle = replayMemory(events, logErrors);
  return { schemaVersion: 1, raw: [...events], logErrors: [...logErrors],
    bundle, checksum: projectionChecksum(bundle) };
}

/** 读回即校验：checksum 不符或结构损坏时返回 null，由调用方全量重建。 */
export function readCheckpoint(file = memoryCheckpointPath()): MemoryCheckpoint | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as MemoryCheckpoint;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.raw) || !parsed.bundle) return null;
    if (projectionChecksum(parsed.bundle) !== parsed.checksum) return null;
    return parsed;
  } catch { return null; }
}

export function writeCheckpoint(checkpoint: MemoryCheckpoint, file = memoryCheckpointPath()): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(checkpoint), { mode: 0o600 });
}

const RETROACTIVE = new Set(['source-revoked', 'grant-revoked', 'edge-invalidated']);

/** 判断新增事件是否会让历史投影发生回溯变化；返回原因字符串表示必须全量。 */
export function incrementalUnsafeReason(cp: MemoryCheckpoint, added: MemoryEvent[]): string | null {
  if (!added.length) return null;
  // append-only 日志允许跨进程把同一业务动作再写一次。重放按 id 去重并
  // 保留首次出现的事件：只要新行时间不早于 checkpoint 末尾，重复行就不会
  // 进入四类投影（只计入 events 与 integrity.duplicateIds），可安全走增量。
  // 乱序检查在下面，保证「首次」不会被一条更早的重复行抢走。
  if (added.some(event => RETROACTIVE.has(event.kind))) return 'retroactive-event';
  if (added.some(event => event.at < cp.bundle.at)) return 'out-of-order';
  if (added.some(event => event.causedBy && cp.bundle.invalidatedEventIds.includes(event.causedBy))) return 'invalid-ancestor';
  const revokedIds = new Set(cp.bundle.revokedSourceIds);
  const revokedKeys = new Set(cp.bundle.revokedSources);
  if (added.some(event => event.sourceRef && (revokedIds.has(event.sourceRef.sourceId)
    || revokedKeys.has(`${event.sourceRef.sourceId}@${event.sourceRef.revision}`)))) return 'revoked-source';
  return null;
}

/**
 * 把 append-only 新增事件应用到 checkpoint。返回的新 checkpoint 始终与
 * 「同一份事件流全量重放」的 checksum 一致；不一致时自动回退全量。
 */
export function applyMemoryEvents(
  cp: MemoryCheckpoint,
  newEvents: MemoryEvent[],
  logErrors: string[] = [],
): CheckpointApplyResult {
  const all = [...cp.raw, ...newEvents];
  const allErrors = [...cp.logErrors, ...logErrors];
  const full = replayMemory(all, allErrors);
  const fullChecksum = projectionChecksum(full);

  const unsafe = incrementalUnsafeReason(cp, newEvents);
  let bundle = full, incremental = false;
  if (!unsafe) {
    const historical = normalizeEvents(cp.raw).orderedUnique;
    const rawIds = new Set(cp.raw.map(event => event.id));
    // 与全量 normalizeEvents(all) 口径一致：重复 id 按稳定排序如实记录，
    // 但只有首次出现的事件进入投影。
    const seenIds = new Set(historical.map(event => event.id));
    const appendedDuplicates: string[] = [];
    for (const event of [...newEvents].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
      if (seenIds.has(event.id)) appendedDuplicates.push(event.id);
      else seenIds.add(event.id);
    }
    const added = normalizeEvents(newEvents).orderedUnique.filter(event => !rawIds.has(event.id));
    const state = projectionStateFromBundle(cp.bundle);
    applyProjectionEvents(state, added, new Set());
    const allIds = new Set([...rawIds, ...added.map(event => event.id)]);
    const dangling = added.filter(event => event.causedBy && !allIds.has(event.causedBy)).map(event => event.id);
    const candidate = assembleBundle(state, {
      rawCount: all.length,
      orderedUnique: [...historical, ...added],
      revokedSources: new Set(cp.bundle.revokedSources),
      revokedSourceIds: new Set(cp.bundle.revokedSourceIds),
      sourceRevocations: new Set(cp.bundle.sourceRevocations),
      principalRevocations: cp.bundle.principalRevocations,
      invalidatedEventIds: cp.bundle.invalidatedEventIds,
      integrity: {
        duplicateIds: [...cp.bundle.integrity.duplicateIds, ...appendedDuplicates],
        danglingCausedBy: [...cp.bundle.integrity.danglingCausedBy, ...dangling],
        logErrors: allErrors,
      },
    });
    if (projectionChecksum(candidate) === fullChecksum) { bundle = candidate; incremental = true; }
  }
  const checksum = projectionChecksum(bundle);
  return {
    checkpoint: { schemaVersion: 1, raw: all, logErrors: allErrors, bundle, checksum },
    incremental,
    fallback: unsafe ?? (incremental ? null : 'checksum-mismatch'),
    applied: newEvents.length,
    checksumEqual: checksum === fullChecksum,
    fullChecksum,
  };
}
