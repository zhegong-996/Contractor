import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { memoryEventSchema, type MemoryEvent } from '../src/architecture-contracts.ts';
import { replayMemory, projectionChecksum, recallMemory, assertDeterministic,
  memoryReplayReport, tokenize } from '../src/memory-projections.ts';

function memoryEvent({ idempotencyKey, ...input }: Pick<MemoryEvent, 'kind' | 'actor'>
  & Partial<Omit<MemoryEvent, 'id'>> & { idempotencyKey?: string }): MemoryEvent {
  const at = input.at ?? '2026-11-07T00:00:00.000Z';
  const id = createHash('sha256').update(idempotencyKey ?? JSON.stringify({ ...input, at })).digest('hex').slice(0, 32);
  return memoryEventSchema.parse({ ...input, at, id });
}

const sourceKey = (sourceId: string, revision: string) => `${sourceId}@${revision}`;
const sourceEventId = (sourceId: string, revision: string) => createHash('sha256')
  .update('source:' + sourceKey(sourceId, revision)).digest('hex').slice(0, 32);

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

test('红线：资料本身撤回后，索引 / 边 / Context Pack 等派生记忆全部不可召回', () => {
  const a = sourceEvent(), b = indexedEvent(a.id);
  const edge = memoryEvent({ kind: 'edge-drafted', actor: 'l2', sourceRef: ref, causedBy: a.id, modelCalls: 0,
    payload: { edges: [{ id: 'e1', kind: 'verified_by', from: 'x', to: 'y' }] }, idempotencyKey: 'edge-e1' });
  const pack = memoryEvent({ kind: 'context-packed', actor: 'organization', sourceRef: ref, causedBy: b.id,
    payload: { taskId: 'T1', refs: [sourceKey(SRC, REV)] }, idempotencyKey: 'pack-1' });
  const base = [a, b, edge, pack];
  assert.ok(recallMemory(replayMemory(base), '验收 知识').hits.length > 0, '撤权前可召回');
  const revoked = replayMemory([...base, revocationEvent('source-revoked')]);
  assert.deepEqual(revoked.revokedSourceIds, [SRC]);
  assert.deepEqual(revoked.sourceRevocations, [SRC]);
  for (const id of [b.id, edge.id, pack.id])
    assert.ok(revoked.invalidatedEventIds.includes(id), `资料撤回必须使派生事件 ${id} 失效`);
  const recall = recallMemory(revoked, '验收 知识', { principal: 'any-agent' });
  assert.equal(recall.hits.length, 0, '资料撤回对任何主体都不得召回派生记忆');
  assert.ok(recall.excludedByRevocation > 0);
  assert.equal(recall.modelCalls, 0);
  assert.equal(revoked.contextPacks.length, 0);
  assert.equal(revoked.bm25Vector.length, 0);
});

test('B2 红线：单主体授权撤销只影响该主体，A 撤权不影响 B 的同源记忆', () => {
  const a = sourceEvent(), b = indexedEvent(a.id);
  const grantA = memoryEvent({ kind: 'grant-revoked', actor: 'owner', sourceRef: ref,
    payload: { sourceId: SRC, revision: REV, agent: 'agent-A', accessId: 'acc-1', reason: 'A 退出' },
    idempotencyKey: 'grant-A' });
  const bundle = replayMemory([a, b, grantA]);
  assert.deepEqual(bundle.sourceRevocations, [], '授权撤销不是资料撤回');
  assert.deepEqual(bundle.revokedSourceIds, [], '不得放大成全局 lineage 阻断');
  assert.equal(bundle.principalRevocations.length, 1);
  assert.equal(bundle.principalRevocations[0]!.principal, 'agent-A');
  assert.equal(bundle.principalRevocations[0]!.accessId, 'acc-1');
  assert.equal(bundle.bm25Vector.length, 1, '投影仍保留该来源的派生记忆');
  assert.equal(recallMemory(bundle, '验收 知识', { principal: 'agent-B' }).hits.length, 1, 'B 仍能召回同源记忆');
  const forA = recallMemory(bundle, '验收 知识', { principal: 'agent-A' });
  assert.equal(forA.hits.length, 0, 'A 已撤权，不得召回');
  assert.ok(forA.excludedByRevocation > 0);
  assert.equal(recallMemory(bundle, '验收 知识').hits.length, 0, '未指定主体时 fail-closed');
  const fully = replayMemory([a, b, grantA, revocationEvent('source-revoked')]);
  assert.deepEqual(fully.revokedSourceIds, [SRC], '资料本身撤回仍全局阻断');
  assert.equal(recallMemory(fully, '验收 知识', { principal: 'agent-B' }).hits.length, 0);
  assert.equal(fully.bm25Vector.length, 0);
});

test('B2 收尾：确认使 revision 前进后，派生事件仍挂在真实来源事件上', () => {
  // 真实链路：createSource 写 r0（candidate），knowledge.review() 把文档推进到 r1，
  // memory-index / l2-extract / context-pack 都以 r1 为 lineage 锚点。
  // 若 reviewSource 仍用评审前的 r0，确认事件会与 createSource 的幂等键相撞被去重，
  // 主干里就没有 r1 的锚点事件，真实日志会出现悬空 causedBy。
  const candidate = memoryEvent({ kind: 'source-ingested', actor: 'owner',
    sourceRef: { sourceId: SRC, revision: 'r0' },
    payload: { sourceId: SRC, revision: 'r0', state: 'candidate' },
    idempotencyKey: 'source:' + sourceKey(SRC, 'r0') });
  const confirmed = memoryEvent({ kind: 'source-ingested', actor: 'owner',
    sourceRef: { sourceId: SRC, revision: 'r1' },
    payload: { sourceId: SRC, revision: 'r1', state: 'confirmed' },
    idempotencyKey: 'source:' + sourceKey(SRC, 'r1') });
  assert.notEqual(candidate.id, confirmed.id, '确认事件不能被幂等去重掉');
  assert.equal(confirmed.id, sourceEventId(SRC, 'r1'));
  const derived = memoryEvent({ kind: 'memory-indexed', actor: 'indexer',
    sourceRef: { sourceId: SRC, revision: 'r1' }, causedBy: sourceEventId(SRC, 'r1'),
    projection: 'bm25-vector', modelCalls: 0,
    payload: { sourceId: SRC, revision: 'r1', title: '验收清单', chunks: 1, concepts: 1,
      chunkTexts: [{ id: 'c1', text: '验收清单与知识来源' }] },
    idempotencyKey: 'index:' + sourceKey(SRC, 'r1') });
  const clean = replayMemory([candidate, confirmed, derived]);
  assert.deepEqual(clean.integrity.danglingCausedBy, [], '真实链路不得出现悬空 lineage');
  const withdrawn = memoryEvent({ kind: 'source-revoked', actor: 'owner',
    sourceRef: { sourceId: SRC, revision: 'r2' },
    payload: { sourceId: SRC, revision: 'r2', state: 'withdrawn' },
    idempotencyKey: 'source-revoked:' + sourceKey(SRC, 'r2') });
  const revoked = replayMemory([candidate, confirmed, derived, withdrawn]);
  assert.ok(revoked.invalidatedEventIds.includes(derived.id), '派生事件仍被撤权阻断');
  assert.equal(recallMemory(revoked, '验收 知识', { principal: 'any-agent' }).hits.length, 0);
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

test('撤权分层：严格集合只含资料撤回，授权撤销单列主体记录', () => {
  const a = sourceEvent();
  const onlyGrant = replayMemory([a, revocationEvent('grant-revoked')]);
  assert.deepEqual(onlyGrant.sourceRevocations, [], '单主体授权撤销不得全局屏蔽来源');
  assert.deepEqual(onlyGrant.revokedSourceIds, [], '重放层不再按授权撤销阻断 lineage');
  assert.equal(onlyGrant.principalRevocations.length, 1);
  const both = replayMemory([a, revocationEvent('source-revoked'), revocationEvent('grant-revoked')]);
  assert.deepEqual(both.sourceRevocations, [SRC]);
  assert.deepEqual(both.revokedSourceIds, [SRC]);
  assert.equal(both.principalRevocations.length, 1);
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
