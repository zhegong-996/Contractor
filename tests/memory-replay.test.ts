// B 阶段验收：append-only 记忆主干、四类投影重放、撤权 lineage 阻断、确定性链路。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryEventSchema } from '../src/architecture-contracts.ts';
import { MemoryLog, FileMemorySink, InMemorySink, memoryEvent, readMemoryEvents,
  bridgeRoutingEvent, sourceKey, sourceEventId } from '../src/memory-log.ts';
import { replayMemory, projectionChecksum, recallMemory, assertDeterministic,
  memoryReplayReport, tokenize } from '../src/memory-projections.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const tmp = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'suitme-memory-')), 'events.jsonl');

const SRC = 'src-1', REV = 'r1';
const ref = { sourceId: SRC, revision: REV };
const sourceEvent = () => memoryEvent({ kind: 'source-ingested', actor: 'owner', sourceRef: ref,
  payload: { sourceId: SRC, revision: REV, state: 'confirmed' },
  idempotencyKey: 'source:' + sourceKey(SRC, REV) });
const indexedEvent = (causedBy: string) => memoryEvent({ kind: 'memory-indexed', actor: 'indexer',
  sourceRef: ref, causedBy, projection: 'bm25-vector', modelCalls: 0,
  payload: { sourceId: SRC, revision: REV, title: '验收清单', chunks: 1, concepts: 1,
    chunkTexts: [{ id: 'c1', text: '验收清单与知识来源' }] },
  idempotencyKey: 'index:' + sourceKey(SRC, REV) });
const revocationEvent = (kind: 'source-revoked' | 'grant-revoked' = 'source-revoked') => memoryEvent({
  kind, actor: 'owner', sourceRef: ref,
  payload: { sourceId: SRC, revision: REV, reason: '资料负责人撤回' },
  idempotencyKey: kind + ':' + sourceKey(SRC, REV) });

test('记忆事件契约：溯源字段强制，modelCalls 只能是非负整数，来源 id 稳定', () => {
  const event = sourceEvent();
  assert.doesNotThrow(() => memoryEventSchema.parse(event));
  assert.equal(event.id, sourceEventId(SRC, REV), '派生事件可用稳定 id 作 causedBy');
  assert.throws(() => memoryEventSchema.parse({ ...event, actor: '' }));
  assert.throws(() => memoryEventSchema.parse({ ...event, modelCalls: -1 }));
  assert.throws(() => memoryEventSchema.parse({ ...event, modelCalls: 1.5 }));
  assert.throws(() => memoryEventSchema.parse({ ...event, invented: true }));
  assert.equal(sourceEvent().id, event.id, '带 idempotencyKey 时不受时间影响');
  const another = memoryEvent({ kind: 'fact-extracted', actor: 'a', at: '2026-11-07T00:00:00.000Z', payload: { x: 1 } });
  const later = memoryEvent({ kind: 'fact-extracted', actor: 'a', at: '2026-11-07T00:00:01.000Z', payload: { x: 1 } });
  assert.notEqual(another.id, later.id);
  assert.deepEqual(tokenize('验收 知识'), ['验', '收', '知', '识', '验收', '知识']);
});

test('主干落盘 → 读回 → 幂等，坏行如实报错', () => {
  const file = tmp(), sink = new InMemorySink();
  const log = new MemoryLog([new FileMemorySink(file), sink]);
  const first = log.append({ kind: 'source-ingested', actor: 'u', sourceRef: ref, idempotencyKey: 'same' });
  const again = log.append({ kind: 'source-ingested', actor: 'u', sourceRef: ref, idempotencyKey: 'same' });
  assert.equal(first.written, true);
  assert.equal(again.duplicate, true);
  assert.equal(sink.lines.length, 1);
  const { events, errors } = readMemoryEvents(file);
  assert.equal(events.length, 1);
  assert.deepEqual(errors, []);
  appendFileSync(file, '{broken\n');
  assert.equal(readMemoryEvents(file).errors.length, 1);
  const broken = new MemoryLog([{ write: () => { throw new Error('disk full'); } }]);
  assert.equal(broken.append({ kind: 'fact-extracted', actor: 'u' }).written, false);
});

test('重放可复现：两次 checksum 一致，基准时间取事件流而非 Date.now()', () => {
  const a = sourceEvent(), b = indexedEvent(a.id);
  const events = [b, a]; // 故意乱序
  const one = replayMemory(events), two = replayMemory(events);
  assert.equal(projectionChecksum(one), projectionChecksum(two));
  assert.deepEqual(memoryReplayReport(events).bundle, memoryReplayReport(events).bundle);
  assert.equal(one.at, a.at >= b.at ? a.at : b.at);
  assert.equal(one.at.startsWith('20'), true);
  assert.notEqual(one.at, new Date().toISOString(), '不得用当前时间做重放基准');
  assert.equal(one.events, 2);
});

test('四类投影都有内容：L1 证据图 / L2 组织图 / BM25 向量 / Context Pack', () => {
  const a = sourceEvent(), b = indexedEvent(a.id);
  const edge = memoryEvent({ kind: 'edge-drafted', actor: 'l2', sourceRef: ref, causedBy: a.id, modelCalls: 0,
    payload: { edges: [{ id: 'e1', kind: 'verified_by', from: 'artifact-1', to: 'evidence-1' }] },
    idempotencyKey: 'edge-e1' });
  const pack = memoryEvent({ kind: 'context-packed', actor: 'organization', sourceRef: ref, causedBy: b.id,
    payload: { taskId: 'T1', refs: [sourceKey(SRC, REV)], expiresAt: '2026-11-08T00:00:00.000Z' },
    idempotencyKey: 'pack-1' });
  const acceptance = memoryEvent({ kind: 'acceptance-recorded', actor: 'originator',
    payload: { taskId: 'T1', mode: 'sealed-plan' }, idempotencyKey: 'accept-1' });
  const bundle = replayMemory([a, b, edge, pack, acceptance]);
  assert.equal(bundle.l1Evidence.length, 1);
  assert.equal(bundle.l1Evidence[0]!.chunks, 1);
  assert.equal(bundle.l2Organization.length, 1);
  assert.equal(bundle.l2Organization[0]!.state, 'draft');
  assert.equal(bundle.bm25Vector.length, 1);
  assert.equal(bundle.contextPacks.length, 1);
  assert.equal(bundle.acceptance.length, 1);
  assert.equal(bundle.deterministic, true);
  assert.equal(bundle.modelCalls, 0);
  assert.doesNotThrow(() => assertDeterministic(bundle));
  assert.ok(recallMemory(bundle, '验收 知识').hits.length > 0);
});

test('红线：来源撤权后，索引 / 边 / Context Pack 等派生记忆全部不可召回', () => {
  const a = sourceEvent(), b = indexedEvent(a.id);
  const edge = memoryEvent({ kind: 'edge-drafted', actor: 'l2', sourceRef: ref, causedBy: a.id, modelCalls: 0,
    payload: { edges: [{ id: 'e1', kind: 'verified_by', from: 'x', to: 'y' }] }, idempotencyKey: 'edge-e1' });
  const pack = memoryEvent({ kind: 'context-packed', actor: 'organization', sourceRef: ref, causedBy: b.id,
    payload: { taskId: 'T1', refs: [sourceKey(SRC, REV)] }, idempotencyKey: 'pack-1' });
  const base = [a, b, edge, pack];
  assert.ok(recallMemory(replayMemory(base), '验收 知识').hits.length > 0, '撤权前可召回');
  for (const kind of ['source-revoked', 'grant-revoked'] as const) {
    const revoked = replayMemory([...base, revocationEvent(kind)]);
    assert.deepEqual(revoked.revokedSourceIds, [SRC]);
    for (const id of [b.id, edge.id, pack.id])
      assert.ok(revoked.invalidatedEventIds.includes(id), `${kind} 必须使派生事件 ${id} 失效`);
    const recall = recallMemory(revoked, '验收 知识');
    assert.equal(recall.hits.length, 0, `${kind} 后不得召回派生记忆`);
    assert.ok(recall.excludedByRevocation > 0);
    assert.equal(recall.modelCalls, 0);
    assert.equal(revoked.contextPacks.length, 0);
    assert.equal(revoked.bm25Vector.length, 0);
  }
});

test('红线：多级 lineage 派生（自身无 sourceRef）也被撤权阻断', () => {
  const a = sourceEvent();
  const b = memoryEvent({ kind: 'fact-extracted', actor: 'a', sourceRef: ref, causedBy: a.id,
    payload: { facts: ['事实一'] }, idempotencyKey: 'f1' });
  const c = memoryEvent({ kind: 'fact-extracted', actor: 'a', causedBy: b.id,
    payload: { facts: ['事实二'] }, idempotencyKey: 'f2' });
  const d = memoryEvent({ kind: 'context-packed', actor: 'a', causedBy: c.id,
    payload: { taskId: 'T2', refs: [] }, idempotencyKey: 'p2' });
  const clean = replayMemory([a, b, c, d]);
  assert.equal(clean.invalidatedEventIds.length, 0);
  assert.equal(clean.contextPacks.length, 1);
  const revoked = replayMemory([a, b, c, d, revocationEvent()]);
  for (const id of [b.id, c.id, d.id]) assert.ok(revoked.invalidatedEventIds.includes(id), `派生 ${id} 应沿链失效`);
  assert.equal(revoked.contextPacks.length, 0);
});

test('红线：确定性链路 modelCalls 必须为 0，非零明确拒绝', () => {
  const clean = memoryEvent({ kind: 'edge-drafted', actor: 'l2', modelCalls: 0, payload: {}, idempotencyKey: 'det-0' });
  assert.equal(replayMemory([clean]).deterministic, true);
  const model = memoryEvent({ kind: 'edge-drafted', actor: 'l2', modelCalls: 3, payload: {}, idempotencyKey: 'det-3' });
  const bundle = replayMemory([clean, model]);
  assert.equal(bundle.modelCalls, 3);
  assert.equal(bundle.deterministic, false);
  assert.throws(() => assertDeterministic(bundle), /确定性链路被破坏/);
});

test('完整性：重复 id、悬空 causedBy、缺 sourceRef 都如实记录而不静默吞掉', () => {
  const a = sourceEvent();
  const duplicate = { ...a };
  const dangling = memoryEvent({ kind: 'fact-extracted', actor: 'a', causedBy: 'missing-parent',
    payload: { facts: ['x'] }, idempotencyKey: 'dangling' });
  const noRef = memoryEvent({ kind: 'memory-indexed', actor: 'a', payload: {}, idempotencyKey: 'no-ref' });
  const bundle = replayMemory([a, duplicate, dangling, noRef], ['line 9: broken']);
  assert.deepEqual(bundle.integrity.duplicateIds, [a.id]);
  assert.deepEqual(bundle.integrity.danglingCausedBy, [dangling.id]);
  assert.ok(bundle.integrity.invalidRows.some(row => row.includes('memory-indexed 缺 sourceRef')));
  assert.deepEqual(bundle.integrity.logErrors, ['line 9: broken']);
  assert.equal(bundle.events, 4);
  assert.equal(bundle.invalidatedEventIds.includes(dangling.id), false, '悬空 lineage 不误伤正常链路');
});

test('撤权分层：严格集合含授权撤销，运行时集合只含资料本身撤回', () => {
  const a = sourceEvent();
  const onlyGrant = replayMemory([a, revocationEvent('grant-revoked')]);
  assert.deepEqual(onlyGrant.sourceRevocations, [], '单主体授权撤销不得全局屏蔽来源');
  assert.deepEqual(onlyGrant.revokedSourceIds, [SRC], '重放层仍按严格集合阻断 lineage');
  const both = replayMemory([a, revocationEvent('source-revoked'), revocationEvent('grant-revoked')]);
  assert.deepEqual(both.sourceRevocations, [SRC]);
  assert.deepEqual(both.revokedSourceIds, [SRC]);
});

test('桥接路由事件：业务 causedBy 归一化到 payload，不制造悬空 lineage', () => {
  const routing = memoryEvent({ kind: 'routing-decided', actor: 'owner', causedBy: 'trigger:om_1',
    payload: { decision: { taskId: 'T1' } }, idempotencyKey: 'routing-bridge' });
  const bridged = bridgeRoutingEvent(routing);
  assert.equal(bridged.causedBy, undefined);
  assert.equal((bridged.payload as Record<string, unknown>).routingCausedBy, 'trigger:om_1');
  assert.equal(bridged.id, routing.id);
  assert.deepEqual(replayMemory([bridged]).integrity.danglingCausedBy, []);
  assert.deepEqual(replayMemory([routing]).integrity.danglingCausedBy, [routing.id]);
});

test('RoutingDecision 事件可并入主干重放，不参与四类知识投影、不破坏确定性', () => {
  const routing = memoryEvent({ kind: 'routing-decided', actor: 'owner',
    payload: { decision: { taskId: 'T1', stage: 'dispatch' } }, idempotencyKey: 'routing-1' });
  const indexed = indexedEvent(sourceEvent().id);
  const bundle = replayMemory([routing, indexed]);
  assert.equal(bundle.events, 2);
  assert.equal(bundle.bm25Vector.length, 1);
  assert.equal(bundle.l2Organization.length, 0);
  assert.equal(bundle.deterministic, true);
  assert.equal(memoryReplayReport([routing, indexed]).replayTwiceEqual, true);
});

test('真实写入点全部接到同一份记忆主干，测试进程与真实业务日志隔离', () => {
  const targets = ['src/workspaces.ts', 'src/v06.ts', 'src/team-memory.ts', 'src/controller.ts'];
  for (const file of targets) {
    const source = read(file);
    assert.match(source, /from '\.\/memory-log\.ts'/, `${file} 未引入主干`);
    assert.match(source, /recordMemory\(/, `${file} 没有写入事件`);
  }
  const server = read('src/server.ts');
  assert.match(server, /getMemoryLog\(\)\.attachAudit/);
  assert.match(server, /memory-replay/);
  assert.match(read('src/members.ts'), /'memory-replay'/);
  assert.match(read('scripts/test.ts'), /COLLAB_TEST_MEMORY: 'memory'/);
  assert.match(read('scripts/memory-replay.ts'), /replayTwiceEqual/);
  assert.match(read('src/memory-log.ts'), /readBridgedEvents/);
  assert.match(read('src/v06.ts'), /v06\.memory-lineage-filtered/);
  assert.match(read('src/v06.ts'), /sourceRevocations/, 'Context Pack 运行时必须按资料撤回过滤');
  assert.match(read('src/server.ts'), /bridgedRoutingEvents/);
  assert.match(read('src/architecture-contracts.ts'), /'source-revoked', 'grant-revoked', 'memory-indexed', 'projection-rebuilt'/);
});
