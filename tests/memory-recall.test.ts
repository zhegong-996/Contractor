// B2-1 验收：共享记忆投影作为第三路召回信号，且不得绕过权限/版本重评。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRecallHits, fuseProjectionHits, type ProjectionHit } from '../src/memory-recall.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const hit = (chunkId: string, sourceId: string, revision: string): ProjectionHit => ({
  chunkId, sourceId, revision, text: '验收清单与知识来源', score: 1.5, eventId: 'ev-' + chunkId, viaProjection: true,
});
const recall = (hits: ProjectionHit[]) => ({ hits, excludedByRevocation: 2, modelCalls: 0 as const });

test('投影命中只保留已授权的确切来源修订，未授权一律丢弃', () => {
  const hits = [hit('c1', 'src-1', 'r1'), hit('c2', 'src-1', 'r0'), hit('c3', 'src-2', 'r1')];
  const result = projectRecallHits(recall(hits), [{ sourceId: 'src-1', revision: 'r1' }], 8);
  assert.deepEqual(result.hits.map(h => h.chunkId), ['c1']);
  assert.equal(result.droppedUnauthorized, 2, '旧修订与未授权来源都要丢弃');
  assert.equal(result.excludedByRevocation, 2, '重放层与召回层的撤权计数不可丢');
  assert.equal(result.modelCalls, 0);
  assert.equal(result.hits[0]!.viaProjection, true);
  assert.deepEqual(projectRecallHits(recall(hits), [], 8).hits, [], '无授权来源时不得召回');
  assert.equal(projectRecallHits(recall(hits), [{ sourceId: 'src-1', revision: 'r1' }], 1).hits.length, 1);
});

test('三路融合：投影命中提升同源排序，独有命中可进入结果，原分数不被覆盖', () => {
  const base: Record<string, unknown>[] = [
    { chunkId: 'a', score: 3, engine: 'cognee' },
    { chunkId: 'b', score: 2, engine: 'cognee' },
  ];
  const projection = [hit('b', 'src-1', 'r1'), hit('new', 'src-1', 'r1')];
  // 默认权重只作为增益；显式提高第三路权重时可以真正翻转排序，
  // 两种行为都要可验证，避免把某一路信号写死成唯一答案。
  const fused = fuseProjectionHits(base, projection, 8, 0.6);
  assert.equal(fused.length, 3);
  assert.equal(fused[0]!.chunkId, 'b', '第三路权重足够时，被投影再次命中的条目可升到前面');
  const defaultFused = fuseProjectionHits(base, projection, 8);
  assert.equal(defaultFused[0]!.chunkId, 'a', '默认权重下既有强词法命中不被轻易压过');
  assert.ok((defaultFused.find(h => h.chunkId === 'b')!).projectionScore > 0);
  assert.equal(fused[0]!.score, 2, '原分数保持原样，不被融合分覆盖');
  assert.ok(fused[0]!.projectionScore > 0);
  assert.equal((fused.find(h => h.chunkId === 'a')!).projectionScore, 0);
  const fresh = fused.find(h => h.chunkId === 'new')!;
  assert.equal(fresh.via, 'projection');
  assert.ok(fresh.projectionScore > 0);
  assert.equal((fused.find(h => h.chunkId === 'b')! as Record<string, unknown>).projectionEventId,
    'ev-b', '同源命中要能追溯到主干事件');
  assert.ok(fused.every(item => typeof item.fusedScore === 'number'));
  assert.equal(fuseProjectionHits(base, projection, 2).length, 2, 'limit 生效');
  assert.deepEqual(fuseProjectionHits(base, [], 8).map(h => h.chunkId), ['a', 'b'], '无投影命中时保持原顺序');
});

test('接线：search 在权限与版本重评之后才消费投影，且投影只读、零模型调用', () => {
  const search = read('src/team-memory.ts');
  const recheck = search.indexOf('检索期间来源、版本、字典或权限变化');
  const projectionCall = search.indexOf('projectionRecall({');
  assert.ok(recheck > 0, '权限/版本重评必须在');
  assert.ok(projectionCall > recheck, '投影召回必须在重评之后，不能成为新的权限来源');
  assert.match(search, /projectionRecall\(|fuseProjectionHits\(/);
  assert.match(search, /memory\.projection-recall-degraded/, '失败必须 advisory 降级');
  const bridge = read('src/memory-recall.ts');
  assert.match(bridge, /permitted\.has\(/);
  assert.match(bridge, /readBridgedEvents\(/);
  assert.match(bridge, /modelCalls: 0/);
  const projections = read('src/memory-projections.ts');
  assert.match(projections, /principalRevocations/);
  assert.match(projections, /grant-revoked = 某一个主体的授权被撤销/);
});

test('精确撤权：投影召回传入当前主体，资料撤回仍对所有主体阻断', () => {
  const source = read('src/team-memory.ts');
  assert.match(source, /principal:task\?\.agent/, '检索必须按当前 principal 传递撤权上下文');
  const replay = read('src/memory-projections.ts');
  assert.match(replay, /options\.principal \|\| item\.principal === options\.principal/);
  assert.match(replay, /if \(!options\.principal/, '未指定主体时 fail-closed');
});
