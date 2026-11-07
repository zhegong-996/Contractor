// B2-4 验收：checkpoint + 增量应用，checksum 语义与全量重放完全一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memoryEvent, sourceKey } from '../src/memory-log.ts';
import { replayMemory, projectionChecksum } from '../src/memory-projections.ts';
import { createCheckpoint, applyMemoryEvents, readCheckpoint, writeCheckpoint,
  incrementalUnsafeReason } from '../src/memory-checkpoint.ts';

const SRC = 'src-cp', REV = 'r1', ref = { sourceId: SRC, revision: REV };
const at = (hour: number) => `2026-11-07T0${hour}:00:00.000Z`;
const tmp = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'suitme-checkpoint-')), 'checkpoint.json');

const source = () => memoryEvent({ kind: 'source-ingested', actor: 'owner', at: at(0), sourceRef: ref,
  payload: { sourceId: SRC, revision: REV, state: 'confirmed' }, idempotencyKey: 'source:' + sourceKey(SRC, REV) });
const indexed = () => memoryEvent({ kind: 'memory-indexed', actor: 'indexer', at: at(1), sourceRef: ref,
  causedBy: source().id, projection: 'bm25-vector', modelCalls: 0,
  payload: { sourceId: SRC, revision: REV, title: '验收清单', chunks: 1, concepts: 0,
    chunkTexts: [{ id: 'c1', text: '验收清单与知识来源' }] },
  idempotencyKey: 'index:' + sourceKey(SRC, REV) });
const packed = (hour: number, suffix: string, causedBy = indexed().id) => memoryEvent({
  kind: 'context-packed', actor: 'organization', at: at(hour), sourceRef: ref, causedBy,
  payload: { taskId: 'T-' + suffix, refs: [sourceKey(SRC, REV)] }, idempotencyKey: 'pack-' + suffix });
const revoked = (hour = 8) => memoryEvent({ kind: 'source-revoked', actor: 'owner', at: at(hour), sourceRef: ref,
  payload: { sourceId: SRC, revision: REV, reason: '资料负责人撤回' },
  idempotencyKey: 'source-revoked:' + sourceKey(SRC, REV) });

const base = () => [source(), indexed(), packed(2, 'a')];

test('checkpoint 初始 checksum 等于全量重放，且可读写往返', () => {
  const events = base();
  const cp = createCheckpoint(events);
  assert.equal(cp.checksum, projectionChecksum(replayMemory(events)));
  const file = tmp();
  writeCheckpoint(cp, file);
  assert.deepEqual(readCheckpoint(file), cp);
  const tampered = JSON.parse(readFileSync(file, 'utf8'));
  tampered.checksum = 'deadbeef';
  writeFileSync(file, JSON.stringify(tampered));
  assert.equal(readCheckpoint(file), null, 'checksum 不符的 checkpoint 不得被信任');
});

test('增量应用普通事件：只处理新事件，checksum 与全量逐字节一致', () => {
  const events = base();
  const cp = createCheckpoint(events);
  const added = [packed(3, 'b'), packed(4, 'c')];
  const result = applyMemoryEvents(cp, added);
  assert.equal(result.incremental, true);
  assert.equal(result.fallback, null);
  assert.equal(result.applied, 2);
  assert.equal(result.checksumEqual, true);
  const full = replayMemory([...events, ...added]);
  assert.equal(result.checkpoint.checksum, projectionChecksum(full));
  assert.deepEqual(result.checkpoint.bundle, full, '增量与全量必须得到同一个 bundle');
  assert.equal(result.checkpoint.bundle.contextPacks.length, 3);
});

test('会回溯的新事件一律回退全量：撤权 / 乱序 / 重复 id / 已撤回来源', () => {
  const cp = createCheckpoint(base());
  const cases: [string, ReturnType<typeof packed>[], string][] = [
    ['撤权', [revoked()], 'retroactive-event'],
    ['乱序', [memoryEvent({ kind: 'fact-extracted', actor: 'a', at: at(0), sourceRef: ref,
      payload: { facts: ['旧事实'] }, idempotencyKey: 'old-fact' })], 'out-of-order'],
    ['乱序重复行', [indexed()], 'out-of-order'],
  ];
  for (const [label, added, reason] of cases) {
    const result = applyMemoryEvents(cp, added);
    assert.equal(result.incremental, false, label + ' 不得走增量');
    assert.equal(result.fallback, reason, label + ' 的回退原因');
    assert.equal(result.checksumEqual, true, label + ' 回退后仍须与全量一致');
    assert.deepEqual(result.checkpoint.bundle, replayMemory([...cp.raw, ...added]));
  }
  const afterRevocation = createCheckpoint([...base(), revoked()]);
  const late = memoryEvent({ kind: 'fact-extracted', actor: 'a', at: at(9), sourceRef: ref,
    payload: { facts: ['新事实'] }, idempotencyKey: 'late-fact' });
  const orphan = memoryEvent({ kind: 'fact-extracted', actor: 'a', at: at(9), causedBy: indexed().id,
    payload: { facts: ['派生事实'] }, idempotencyKey: 'orphan-fact' });
  assert.equal(incrementalUnsafeReason(afterRevocation, [late]), 'revoked-source');
  assert.equal(incrementalUnsafeReason(afterRevocation, [orphan]), 'invalid-ancestor');
});

test('分三批增量与一次全量 checksum 一致；跨批撤权能正确让派生投影归零', () => {
  let cp = createCheckpoint(base());
  for (const hour of [3, 4, 5]) {
    const result = applyMemoryEvents(cp, [packed(hour, 'batch-' + hour)]);
    assert.equal(result.incremental, true);
    assert.equal(result.checksumEqual, true);
    cp = result.checkpoint;
  }
  const all = [...base(), ...[3, 4, 5].map(hour => packed(hour, 'batch-' + hour))];
  assert.equal(cp.checksum, projectionChecksum(replayMemory(all)));
  assert.equal(cp.bundle.contextPacks.length, 4);
  const after = applyMemoryEvents(cp, [revoked(9)]);
  assert.equal(after.checksumEqual, true);
  assert.equal(after.checkpoint.bundle.bm25Vector.length, 0);
  assert.equal(after.checkpoint.bundle.contextPacks.length, 0);
  assert.equal(after.checkpoint.bundle.l1Evidence.length, 0);
  assert.deepEqual(after.checkpoint.bundle, replayMemory([...all, revoked(9)]));
});

test('append-only 跨进程重写同一事件：重复如实记录，投影不重复计算', () => {
  const cp = createCheckpoint(base());
  const rewritten = memoryEvent({ kind: 'memory-indexed', actor: 'indexer', at: at(5), sourceRef: ref,
    causedBy: source().id, projection: 'bm25-vector', modelCalls: 0,
    payload: { sourceId: SRC, revision: REV, title: '验收清单', chunks: 1, concepts: 0,
      chunkTexts: [{ id: 'c1', text: '验收清单与知识来源' }] },
    idempotencyKey: 'index:' + sourceKey(SRC, REV) });
  assert.equal(rewritten.id, indexed().id, 'idempotencyKey 保证同一业务动作 id 稳定');
  const result = applyMemoryEvents(cp, [rewritten]);
  assert.equal(result.incremental, true, '时间靠后的重复行可以安全走增量');
  assert.equal(result.checksumEqual, true);
  assert.deepEqual(result.checkpoint.bundle, replayMemory([...cp.raw, rewritten]));
  assert.ok(result.checkpoint.bundle.integrity.duplicateIds.includes(rewritten.id), '重复不得被静默吞掉');
  assert.equal(result.checkpoint.bundle.events, base().length + 1);
  assert.equal(result.checkpoint.bundle.bm25Vector.length, 1, '重复索引不得再产生一份 chunk');
});

test('确定性链路不被 checkpoint 改写：modelCalls 恒 0，坏行如实累积', () => {
  const cp = createCheckpoint(base(), ['line 1: broken']);
  const result = applyMemoryEvents(cp, [packed(3, 'd')], ['line 9: broken']);
  assert.equal(result.checkpoint.bundle.deterministic, true);
  assert.equal(result.checkpoint.bundle.modelCalls, 0);
  assert.deepEqual(result.checkpoint.bundle.integrity.logErrors, ['line 1: broken', 'line 9: broken']);
  assert.equal(result.checksumEqual, true);
});
