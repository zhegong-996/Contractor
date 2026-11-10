// 第六十九轮 · 判定沉淀契约：
// 只提炼重复出现的模式（孤例不是知识）；每条候选必须能落满三层（结构化/非结构化/图谱）；
// 缺层如实标注；只产候选，写库必须走人审。
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLayers, sedimentFromLedger, summarizeSediment } from '../src/knowledge-sediment.ts';
import type { LedgerEntry } from '../src/decision-ledger.ts';

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'd1', at: '2026-11-01T00:00:00.000Z', taskId: 'task-1', kind: 'access', action: 'workspace.access-approved',
  actor: 'role-product', actorKind: 'agent', verdict: '批准资料访问：b8d1ccb3',
  reasons: [{ code: 'access:approved', text: '批准' }], basis: 'human', requiresHuman: true, ...over,
});

test('三层体检：缺哪层就扣分，不假装完整', () => {
  const full = scoreLayers({ facts: { a: 1 }, body: 'x'.repeat(100), edges: [{}] });
  assert.deepEqual(full, { structured: true, narrative: true, graph: true, score: 3, gaps: [] });

  const bare = scoreLayers({});
  assert.equal(bare.score, 0);
  assert.deepEqual(bare.gaps, ['facts', 'body', 'edges']);

  const shortBody = scoreLayers({ facts: { a: 1 }, body: '太短了', edges: [{}] });
  assert.equal(shortBody.narrative, false, '正文不到 80 字不算叙事层');
  assert.deepEqual(shortBody.gaps, ['body']);
});

test('孤例不沉淀：出现次数低于阈值一律跳过', () => {
  const single = sedimentFromLedger([entry()], { minOccurrences: 2 });
  assert.equal(single.length, 0, '一条孤例不构成知识');
});

test('同类判定重复出现 → 产出候选，且三层齐备', () => {
  const list = [
    entry({ id: 'a1', at: '2026-11-01T00:00:00.000Z' }),
    entry({ id: 'a2', at: '2026-11-02T00:00:00.000Z', actor: 'role-growth' }),
  ];
  const [candidate] = sedimentFromLedger(list, { minOccurrences: 2 });
  assert.ok(candidate);
  assert.equal(candidate.occurrences, 2);
  assert.equal(candidate.kind, 'procedure');
  assert.deepEqual(candidate.ledgerEntryIds.sort(), ['a1', 'a2']);
  assert.deepEqual(candidate.gaps, [], '三层必须齐备');
  assert.equal(candidate.facts.occurrences, 2);
  assert.equal(candidate.facts.requires_human, true);
  assert.ok(String(candidate.facts.actors).includes('role-product'));
  assert.ok(candidate.body.length >= 80, '叙事层要够长');
  assert.ok(candidate.edges.length >= 1, '图谱层要有草稿边');
  assert.ok(candidate.edges[0].evidenceRefs.length > 0, '边必须带证据引用');
});

test('证据边指回原始判定，且状态默认草稿（只能人验收）', () => {
  const list = [entry({ id: 'a1' }), entry({ id: 'a2' })];
  const [candidate] = sedimentFromLedger(list);
  const edge = candidate.edges[0];
  assert.equal(edge.kind, 'verified_by');
  assert.ok(edge.evidenceRefs.every(ref => ref.sourceId.startsWith('audit:')));
  // SedimentEdgeDraft 没有 state 字段——草稿状态由写入时的 schema 默认值保证。
  assert.equal('state' in edge, false);
});

test('知识类判定不二次沉淀，避免自我循环', () => {
  const list = [
    entry({ id: 'k1', kind: 'knowledge', action: 'knowledge.confirmed', verdict: '采用知识：arch' }),
    entry({ id: 'k2', kind: 'knowledge', action: 'knowledge.confirmed', verdict: '采用知识：arch' }),
  ];
  assert.equal(sedimentFromLedger(list).length, 0);
});

test('不同模式不合并：依据不同就是两类知识', () => {
  const list = [
    entry({ id: 'a1', basis: 'human' }),
    entry({ id: 'a2', basis: 'human' }),
    entry({ id: 'a3', basis: 'policy', requiresHuman: false }),
    entry({ id: 'a4', basis: 'policy', requiresHuman: false }),
  ];
  const candidates = sedimentFromLedger(list);
  assert.equal(candidates.length, 2, 'human 与 policy 依据不同，应各自成条');
  assert.ok(candidates.some(c => c.facts.basis === 'policy'));
  assert.ok(candidates.some(c => c.facts.basis === 'human'));
});

test('系统判定不建 responsible_for 边（没有具体责任人）', () => {
  const list = [
    entry({ id: 's1', actorKind: 'system', actor: 'scoped-preparation', basis: 'policy', requiresHuman: false }),
    entry({ id: 's2', actorKind: 'system', actor: 'scoped-preparation', basis: 'policy', requiresHuman: false }),
  ];
  const [candidate] = sedimentFromLedger(list);
  assert.equal(candidate.edges.length, 1);
  assert.equal(candidate.edges[0].kind, 'verified_by');
});

test('候选按证据强度排序，同分按 id 稳定', () => {
  const strong = [entry({ id: 'x1' }), entry({ id: 'x2' }), entry({ id: 'x3' })];
  const weak = [
    entry({ id: 'y1', kind: 'escalation', action: 'v06.escalated', verdict: '升级处理', basis: 'policy', requiresHuman: true }),
    entry({ id: 'y2', kind: 'escalation', action: 'v06.escalated', verdict: '升级处理', basis: 'policy', requiresHuman: true }),
  ];
  const candidates = sedimentFromLedger([...weak, ...strong]);
  assert.equal(candidates[0].occurrences, 3, '出现次数多的排前面');
});

test('summary：三层齐备数与覆盖判定数', () => {
  const list = [entry({ id: 'a1' }), entry({ id: 'a2' })];
  const candidates = sedimentFromLedger(list);
  const s = summarizeSediment(candidates);
  assert.equal(s.candidates, 1);
  assert.equal(s.complete, 1);
  assert.equal(s.incomplete, 0);
  assert.equal(s.coveredEntries, 2);
});

test('建议 key 符合 knowledge-<slug> 约束且不超长', () => {
  const list = [entry({ id: 'a1' }), entry({ id: 'a2' })];
  const [candidate] = sedimentFromLedger(list);
  assert.match(candidate.suggestedKey, /^knowledge-[a-z0-9-]+$/);
  assert.ok(candidate.suggestedKey.length <= 44, candidate.suggestedKey);
});
