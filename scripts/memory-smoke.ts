// B 阶段真跑冒烟：临时目录里完整走「写入 → 四类投影重放 → 撤权 → 派生记忆不可召回」。
// 不写 .runtime/memory/events.jsonl（真实业务日志），用完即弃。
// 用法：npm run memory:smoke
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryLog, FileMemorySink, readMemoryEvents, sourceKey, sourceEventId } from '../src/memory-log.ts';
import { memoryReplayReport, recallMemory, assertDeterministic } from '../src/memory-projections.ts';

const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'suitme-memory-smoke-')), 'events.jsonl');
const log = new MemoryLog([new FileMemorySink(file)]);
const sourceId = 'smoke-source', revision = 'r1', ref = { sourceId, revision };

const seed = log.append({ kind: 'source-ingested', actor: 'owner', sourceRef: ref,
  payload: { sourceId, revision, state: 'confirmed' },
  idempotencyKey: 'source:' + sourceKey(sourceId, revision) });
const index = log.append({ kind: 'memory-indexed', actor: 'indexer', sourceRef: ref,
  causedBy: seed.event!.id, projection: 'bm25-vector', modelCalls: 0,
  payload: { sourceId, revision, title: '验收清单', chunks: 2, concepts: 1,
    chunkTexts: [{ id: 'c1', text: '验收清单与知识来源' }, { id: 'c2', text: '逐项评审与证据引用' }] },
  idempotencyKey: 'index:' + sourceKey(sourceId, revision) });
log.append({ kind: 'edge-drafted', actor: 'l2', sourceRef: ref, causedBy: seed.event!.id,
  projection: 'l2-organization', modelCalls: 0,
  payload: { sourceId, revision, edges: [{ id: 'e1', kind: 'verified_by', from: 'artifact-1', to: 'evidence-1' }] },
  idempotencyKey: 'edge:e1' });
log.append({ kind: 'context-packed', actor: 'organization', sourceRef: ref, causedBy: index.event!.id,
  projection: 'context-pack',
  payload: { taskId: 'SMOKE-1', refs: [sourceKey(sourceId, revision)] }, idempotencyKey: 'pack:1' });
log.append({ kind: 'acceptance-recorded', actor: 'originator',
  payload: { taskId: 'SMOKE-1', mode: 'sealed-plan' }, idempotencyKey: 'accept:1' });

const before = memoryReplayReport(readMemoryEvents(file).events);
const beforeRecall = recallMemory(before.bundle, '验收 知识');
assertDeterministic(before.bundle);

log.append({ kind: 'source-revoked', actor: 'owner', sourceRef: ref,
  payload: { sourceId, revision, reason: '资料负责人撤回' },
  idempotencyKey: 'source-revoked:' + sourceKey(sourceId, revision) });
const after = memoryReplayReport(readMemoryEvents(file).events);
const afterRecall = recallMemory(after.bundle, '验收 知识');

const checks = {
  lineageIdStable: seed.event!.id === sourceEventId(sourceId, revision),
  replayTwiceEqualBefore: before.replayTwiceEqual,
  replayTwiceEqualAfter: after.replayTwiceEqual,
  fourProjectionsBefore: before.projections.l1Evidence === 1 && before.projections.l2Organization === 1
    && before.projections.bm25Vector === 2 && before.projections.contextPacks === 1,
  deterministic: before.deterministic && after.deterministic && before.modelCalls === 0,
  recallableBefore: beforeRecall.hits.length > 0,
  unrecallableAfter: afterRecall.hits.length === 0,
  derivedProjectionsSuppressed: after.projections.bm25Vector === 0 && after.projections.contextPacks === 0
    && after.projections.l2Organization === 0,
  revocationCounted: after.revocation.suppressedByRevocation > 0 && afterRecall.excludedByRevocation > 0,
  logErrors: after.integrity.logErrors.length === 0,
};
const ok = Object.values(checks).every(value => value === true);
console.log(JSON.stringify({ ok, tempLog: file, checks,
  before: { eventCount: before.eventCount, checksum: before.checksum, projections: before.projections,
    recallHits: beforeRecall.hits.length, modelCalls: before.modelCalls },
  after: { eventCount: after.eventCount, checksum: after.checksum, projections: after.projections,
    recallHits: afterRecall.hits.length, excludedByRevocation: afterRecall.excludedByRevocation,
    revocation: after.revocation } }, null, 2));
if (!ok) process.exitCode = 1;
