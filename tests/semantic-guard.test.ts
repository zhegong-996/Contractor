import test from 'node:test';
import assert from 'node:assert/strict';
import { configSchema } from '../src/config.ts';
import { RuntimeGuardBridge } from '../src/runtime-bridge.ts';
import { embedTexts, cosine, hashedEmbedding, fuseRecall, readSemanticIndex,
  APPLE_EMBEDDING_ENGINE, FALLBACK_EMBEDDING_ENGINE, type SemanticChunk } from '../src/semantic-recall.ts';

const minimalConfig = {
  paperclipUrl: 'http://127.0.0.1:3100', repository: 'acme/demo', checkout: '/tmp/demo',
  allowedPaths: ['demo/'], defaultAgent: 'codex',
  agents: { codex: { name: 'Codex', mode: 'managed', use: 'codex' } },
  feishu: { profile: 'test' },
} as const;

test('仓库默认已开启护栏强制与本地语义检索，但不启用外部模型 API', () => {
  const parsed = configSchema.parse(minimalConfig);
  assert.equal(parsed.runtimeGuard.enforce, true);
  assert.equal(parsed.runtimeGuard.protectHumanNotifications, true);
  assert.equal(parsed.knowledge.semanticRecall.enabled, true);
  assert.equal(configSchema.parse({ ...minimalConfig, acceptance: {} }).acceptance?.mode, 'legacy');
  assert.equal(configSchema.parse({ ...minimalConfig, knowledge: { semanticRecall: { enabled: false } } })
    .knowledge.semanticRecall.enabled, false);
});

test('设备端中英文词向量：语义相近的句子明显比无关句子更接近', { timeout: 120000 }, () => {
  const texts = ['按锁定清单逐项验收并核对责任', '审核责任节点与证据引用', '香蕉与冰淇淋的做法'];
  const embedded = embedTexts(texts);
  assert.equal(embedded.dimension, 600);
  assert.equal(embedded.vectors.length, 3);
  const query = embedTexts(['审核标准与责任验收']).vectors[0]!;
  const related = cosine(query, embedded.vectors[0]!);
  const unrelated = cosine(query, embedded.vectors[2]!);
  assert.ok(related > 0.5, `相关句相似度 ${related}`);
  assert.ok(related - unrelated > 0.4, `语义区分度不足：${related} vs ${unrelated}`);
  if (embedded.engine === APPLE_EMBEDDING_ENGINE) assert.ok(cosine(query, embedded.vectors[1]!) > unrelated);
});

test('无 Apple 词向量时降级为本地哈希向量，仍可完成向量检索', () => {
  const batch = embedTexts(['验收与责任', '香蕉'], { swiftBin: '/nonexistent/swift' });
  assert.equal(batch.engine, FALLBACK_EMBEDDING_ENGINE);
  assert.deepEqual(batch.vectors[0], hashedEmbedding('验收与责任'));
  assert.ok(Math.abs(cosine(hashedEmbedding('验收与责任'), hashedEmbedding('验收与责任')) - 1) < 0.01);
});

test('混合检索：词义相近但字面上 BM25 无命中的片段也能被召回', () => {
  const chunks: SemanticChunk[] = [
    { chunkId: 'c1', text: '审核责任节点与证据引用', title: '知识', concept: null,
      sourceId: 's-1', revision: 'r-1', vector: hashedEmbedding('审核责任节点与证据引用') },
    { chunkId: 'c2', text: '香蕉与冰淇淋', title: '无关', concept: null,
      sourceId: 's-1', revision: 'r-1', vector: hashedEmbedding('香蕉与冰淇淋') },
  ];
  const hits = fuseRecall({ lexicalHits: [], chunks, queryVector: hashedEmbedding('审核责任节点与证据引用'), weight: 0.45 });
  assert.equal(hits[0]!.chunkId, 'c1');
  assert.equal(hits[0]!.via, 'semantic');
  assert.ok(hits[0]!.semanticScore > 0.5);
  const lexicalOnly = fuseRecall({ lexicalHits: [{ chunkId: 'c2', score: 9, text: '香蕉与冰淇淋' }],
    chunks, queryVector: hashedEmbedding('完全不相关的话题'), weight: 0.45 });
  assert.ok(lexicalOnly.some(hit => hit.chunkId === 'c2' && hit.via === 'lexical'));
});

test('坏掉的语义索引文件不会被当成有效向量', () => {
  assert.equal(readSemanticIndex('/nonexistent/semantic-vectors.json'), null);
});

test('护栏强制：自身进度通知被抑制，等待人工的通知必须送达', async () => {
  const audits: any[] = [];
  const bridge = new RuntimeGuardBridge({ audit: (...args: any[]) => audits.push(args) }, undefined, true, true);
  const self = await bridge.gateNotification({ taskId: 'T-1', notificationId: 'assistant-prepared:job-1',
    summary: '模型整理完成', at: '2026-11-06T00:00:00.000Z' });
  assert.equal(self.deliver, false);
  assert.equal(self.observation.attention.wake, false);
  const ask = await bridge.gateNotification({ taskId: 'T-1', notificationId: 'ask:receipt-1',
    summary: '需要你确认验收范围', at: '2026-11-06T00:00:00.000Z' });
  assert.equal(ask.deliver, true);
  assert.equal(ask.mustDeliver, true);
  assert.equal(ask.observation.watchdog.state, 'waiting');
  assert.match(ask.observation.watchdog.reason, /等待人工/);
  const accept = await bridge.gateNotification({ taskId: 'T-1', notificationId: 'accept:ev-1',
    summary: '已记录验收通过', at: '2026-11-06T00:00:00.000Z' });
  assert.equal(accept.deliver, true);
  assert.ok(audits.some(a => a[0] === 'v06.notification-gated' && a[2].deliver === false));
});

test('只观测模式下不拦截任何通知，且审计写明原因', async () => {
  const bridge = new RuntimeGuardBridge({ audit: () => {} }, undefined, false, true);
  const result = await bridge.gateNotification({ taskId: 'T-1', notificationId: 'assistant-prepared:job-2',
    summary: '整理完成', at: '2026-11-06T00:00:00.000Z' });
  assert.equal(result.deliver, true);
  assert.match(result.reason, /只观测/);
  assert.equal(result.observation.enforced, false);
});
