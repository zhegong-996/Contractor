// L2 organisation-graph auto-extraction from the pinned Cognee L1 projection.
// No model service: the default adapter is deterministic and modelCalls=0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { V06Services } from '../src/v06.ts';
import { MemoryV06Store } from '../src/v06-store.ts';
import type { Store } from '../src/store.ts';
import { assertL1Isolated, isolationKey, runOrgExtraction, ModelExtractionAdapter,
  type L1Projection, type L1Reader } from '../src/org-extraction.ts';
import { validateOrgGraph } from '../src/org-ontology.ts';
import { acceptEdge, type KnowledgeEdge } from '../src/knowledge-edges.ts';

const at = '2026-11-06T08:00:00.000Z';
const sourceId = 'source-42', revision = 'rev-7';
const body = '报价 3.0 由负责人李工确认，验收证据为截图。';
const root = 'node-root', field = 'node-field', chunk = 'node-chunk', concept = 'node-concept';
const projection: L1Projection = {
  sourceId, revision, title: '报价记录', body, modelCalls: 0,
  nodes: [
    { id: root, type: 'SourceDocument', name: '报价记录', body, source_id: sourceId, source_revision: revision },
    { id: field, type: 'KnowledgeField', name: 'owner', value_json: '"李工"', data_type: 'string', source_id: sourceId, source_revision: revision },
    { id: chunk, type: 'MemoryChunk', name: '报价记录', text: body + '\n{"owner":"李工"}', source_id: sourceId, source_revision: revision },
    { id: concept, type: 'KnowledgeConcept', name: '验收截图', concept_type: 'Evidence', evidence: '验收证据为截图', source_id: sourceId, source_revision: revision },
  ],
  edges: [
    { source: root, target: field, relation: 'has_field', source_revision: revision },
    { source: root, target: chunk, relation: 'has_chunk', source_revision: revision },
    { source: root, target: concept, relation: 'mentions', evidence: '验收证据为截图', source_revision: revision },
    { source: concept, target: field, relation: '负责', evidence: '由负责人李工确认', source_revision: revision },
  ],
};
const fixtureReader: L1Reader = { id: 'fixture-l1', async read() { return projection; } };
const opts = { workbenchUrl: 'http://127.0.0.1:4180', channel: 'workspace' as const, actorUserId: 'pd-owner' };
const admin = { admin: true, userId: 'pd-owner' };
function setup(reader: L1Reader = fixtureReader) {
  const localStore = { audit: () => {}, notify: () => {} } as unknown as Store;
  return new V06Services(localStore, undefined, new MemoryV06Store(), undefined, reader);
}

test('L1 隔离：混入其他来源版本时直接拒绝抽取', async () => {
  assert.equal(isolationKey(sourceId, revision), createHash('sha256').update(`${sourceId}@${revision}`).digest('hex'));
  assertL1Isolated(projection, sourceId, revision);
  const leaked = structuredClone(projection);
  leaked.nodes.push({ id: 'other', type: 'MemoryChunk', source_id: 'another-source', source_revision: revision });
  assert.throws(() => assertL1Isolated(leaked, sourceId, revision), /其他来源版本/);
  await assert.rejects(() => runOrgExtraction({ projection: leaked, sourceId, revision, taskId: 'T-1', space: 'default', actor: 'a', at }), /其他来源版本/);
});

test('确定性抽取：生成草稿边、逐条带 L1 原文证据、零模型调用，且不改 L1', async () => {
  const result = await runOrgExtraction({ projection, sourceId, revision, taskId: 'T-1', space: 'default', actor: 'l2', at });
  assert.equal(result.adapterId, 'deterministic-l1-projection');
  assert.equal(result.modelCalls, 0);
  assert.ok(result.edges.length >= 4);
  assert.ok(result.edges.every(e => e.state === 'draft' && e.inferredBy === 'deterministic-l1-projection'));
  assert.ok(result.edges.every(e => e.evidenceRefs.length === 1
    && e.evidenceRefs[0]!.sourceId === sourceId && e.evidenceRefs[0]!.revision === revision));
  // Every excerpt must be verbatim from the L1 corpus; chunks alone never became edges.
  assert.ok(result.edges.every(e => projection.nodes.some(n => Object.values(n).some(v => typeof v === 'string' && v.includes(e.evidenceRefs[0]!.excerpt!)))
    || projection.body.includes(e.evidenceRefs[0]!.excerpt!)));
  assert.ok(!result.edges.some(e => e.evidenceRefs[0]!.excerpt!.includes('has_chunk')));
  validateOrgGraph({ schemaVersion: 1, nodes: result.orgNodes, edges: result.orgEdges });
  assert.equal(result.l1.modelCalls, 0);
});

test('抽取是幂等的：重复运行不新增草稿，已由人验收的边不会被重置', async () => {
  const first = await runOrgExtraction({ projection, sourceId, revision, taskId: 'T-1', space: 'default', actor: 'l2', at });
  const accepted: KnowledgeEdge = acceptEdge(first.edges[0]!, 'human-1', at);
  const existingEdges = [accepted, ...first.edges.slice(1)];
  const existingGraph = { schemaVersion: 1 as const, nodes: first.orgNodes, edges: first.orgEdges.map((e, i) => i === 0 ? { ...e, state: 'accepted' as const } : e) };
  const second = await runOrgExtraction({ projection, sourceId, revision, taskId: 'T-1', space: 'default', actor: 'l2', at,
    existingEdges, existingGraph });
  assert.equal(second.edges.length, 0);
  assert.equal(second.skippedExisting, first.edges.length);
  assert.equal(existingEdges[0]!.state, 'accepted');
  assert.equal(existingEdges[0]!.acceptedBy, 'human-1');
});

test('模型适配器也必须逐字举证：编造的证据被拒绝，合法提案按同一规则入库', async () => {
  const adapter = new ModelExtractionAdapter(async () => [
    { family: 'verified_by', fromLabel: '交付物', toLabel: '截图', excerpt: '模型编造的证据', rationale: '幻觉' },
    { family: 'participated_in', fromLabel: '李工', toLabel: '报价记录', excerpt: '由负责人李工确认', rationale: '来自原文' },
  ]);
  const result = await runOrgExtraction({ projection, sourceId, revision, taskId: 'T-2', space: 'default', actor: 'l2', at, adapter });
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0]!.kind, 'participated_in');
  assert.equal(result.modelCalls, 1);
  assert.ok(result.rejected.some(r => /不来自该来源版本/.test(r.reason)));
});

test('V06Services：抽取写入全局 L2 图与任务镜像，状态可查，未接 reader 时明确报错', async () => {
  const service = setup();
  const result: any = await service.dispatch('l2-extract', { sourceId, revision, taskId: 'T-9' }, admin, opts);
  assert.ok(result.drafted > 0);
  assert.equal(result.modelCalls, 0);
  assert.equal((await service.l2EdgesGlobal()).length, result.drafted);
  assert.equal((await service.edgesView('T-9')).length, result.drafted);
  const graph = await service.l2GraphGlobal();
  validateOrgGraph(graph);
  assert.ok(graph.nodes.length > 0);
  const taskGraph = await service.ontologyView('T-9');
  validateOrgGraph(taskGraph);
  const status: any = await service.dispatch('l2-status', {}, admin, opts);
  assert.equal(status.connected, true);
  assert.equal(status.mode, 'deterministic');
  assert.equal((status.lastRun as any)?.sourceId, sourceId);
  const again: any = await service.dispatch('l2-extract', { sourceId, revision, taskId: 'T-9' }, admin, opts);
  assert.equal(again.drafted, 0);
  assert.ok(again.skippedExisting > 0);
  const noReader = setup({ id: 'none', async read() { return projection; } });
  (noReader as any).l1Reader = undefined;
  await assert.rejects(() => noReader.l2Extract({ sourceId, revision, actor: 'x' }), /未连接 Cognee L1 读取器/);
});

test('抽取不触碰 L1：reader 只收到 sourceId@revision，从不请求 project/cognify', async () => {
  const calls: any[] = [];
  const reader: L1Reader = { id: 'spy', async read(input) { calls.push(input); return projection; } };
  const service = setup(reader);
  await service.dispatch('l2-extract', { sourceId, revision }, admin, opts);
  assert.deepEqual(calls, [{ sourceId, revision }]);
  assert.equal((await service.l2Status()).l1Isolation.includes('只读'), true);
});
