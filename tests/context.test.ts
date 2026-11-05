import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { primeQueryTerms, primeDigestQueryTerms } from '../src/vendor/prime-query.ts';
const dir = mkdtempSync(path.join(tmpdir(), 'suitme-context-'));
process.env.COLLAB_STATE_DIR = dir;
writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ jwtSecret: 'context-test-key' }));
const { TaskContext, selectPassage, retainFacts, contextHash } = await import('../src/context.ts');
const { discussionEvidence } = await import('../src/context.ts');
const { confirmation } = await import('../src/knowledge.ts');
const { Workspaces } = await import('../src/workspaces.ts');
test.after(() => rmSync(dir, { recursive: true, force: true }));
test('ported Prime Agent query terms match the pinned original Python implementation', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/prime-context-terms.json', import.meta.url), 'utf8'));
  for (const c of fixture.cases) assert.deepEqual(primeQueryTerms(c.query), c.terms, c.query);
  const weighted = primeDigestQueryTerms('门店试用目标', ['新增合同约束', '旧背景']);
  assert.equal(weighted.get('门店'), 3); assert.equal(weighted.get('合同'), 2); assert.equal(weighted.get('背景'), 1.5);
});
test('native repair notices and model replies do not impersonate human discussion or trigger re-summarization', () => {
  const human = { id: 'human', body: '请核对验收口径', authorUserId: 'local-board' };
  const system = { id: 'repair', body: 'Automatic review repair finished', authorUserId: null, authorAgentId: null };
  const agent = { id: 'agent', body: '已处理', authorAgentId: 'executor' };
  assert.deepEqual(discussionEvidence([human, system, agent]), discussionEvidence([human]));
  assert.notDeepEqual(discussionEvidence([{ ...human, body: '人工新要求' }]), discussionEvidence([human]));
});
test('upstream DeepSeek retention preserves UTF8, discloses omissions and selects a relevant distant passage', () => {
  const body = '不相关的前言。'.repeat(100) + '目标证据：门店试用转化，需要清晰解释。' + '背景。'.repeat(100);
  const result = selectPassage(body, '门店试用转化', 180);
  assert.ok(result.truncated); assert.ok(result.body.includes('门店试用')); assert.ok(result.includedBytes <= 180);
  assert.equal(result.body, body.slice(result.range.start, result.range.end)); assert.ok(!result.body.includes('\uFFFD'));
  const emoji = selectPassage('😀😀😀中文', '中文', 7); assert.ok(emoji.includedBytes <= 7); assert.ok(!emoji.body.includes('\uFFFD'));
  assert.equal(selectPassage(body, '', 0).body, '');
  const facts = retainFacts({ large: '很长'.repeat(200), second: 2, third: true }, 80);
  assert.ok(facts.truncated); assert.ok(Buffer.byteLength(JSON.stringify(facts.facts)) <= 80);
});
function fixture() {
  const task: any = { id: 'task', identifier: 'SUI-T', kind: 'collaboration', agent: 'role-product', generation: 1, phase: 'ready', messageId: 'local' };
  const state: any = { sources: ['source'], snapshots: [], requests: [], outcomes: [], history: [], context: { autoDiscover: true, linkedTasks: [], requirements: [], fullSources: [] } };
  const config: any = { companyId: 'company' };
  const k: any = { state: 'confirmed', confirmedBy: 'human', companyId: 'company', body: '门店试用说明需要标注依据和适用范围。', facts: {}, appliesTo: '合成联调', title: '门店试用规范' };
  k.confirmation = confirmation(k, 'context-test-key');
  let record: any = { value: k, revision: 'v1', hash: 'hash-v1' }, reads = 0;
  const w: any = { config, store: { get: () => task }, state: async () => state, issue: async () => ({ id: task.id, companyId: 'company', title: '门店试用方案', description: '根据既有依据整理说明' }),
    source: (id: string) => ({ id, title: '门店试用规范', domain: 'product', ref: { taskId: id, key: 'knowledge-source' } }),
    sourceStatus: async () => ({ allowed: true, reason: 'current' }), knowledge: { read: async () => { reads++; return record; } },
    reader: () => ({ get: async (route: string) => ({ body: '人工新约束', latestRevisionId: route.includes('note-new') ? 'note-v2' : 'note-v1' }) }),
    catalog: () => ({ sources: [], spaces: { product: { agent: task.agent } } }) };
  return { task, state, w, context: new TaskContext(w), setRecord(value: any) { record = value; }, reads: () => reads };
}
test('the actual record is revalidated after permission lookup; an unconfirmed revision is not sent to the model', async () => {
  const f = fixture(); f.setRecord({ value: { state: 'candidate', body: '未确认的新内容' }, revision: 'v2', hash: 'v2' });
  const pack = await f.context.collect(f.task);
  assert.equal(pack.layers.sources.length, 0); assert.equal(pack.layers.missing[0]!.reason, 'version');
});
test('manual notes and native revisions change the manifest; only this run own generated checkpoint is excluded', async () => {
  const f = fixture(), original = await f.context.collect(f.task, 'assistant:current');
  f.state.snapshots.push({ id: 'note-new', key: 'context-note', title: '背景', sources: [], receiptId: 'user-note' });
  const changed = await f.context.collect(f.task, 'assistant:current');
  assert.notEqual(contextHash(original.manifest), contextHash(changed.manifest));
  assert.equal(changed.manifest.find(r => r.id === 'note-new')?.revision, 'note-v2');
  f.state.snapshots.push({ id: 'own-result', key: 'checkpoint', title: '当前运行结果', sources: [], receiptId: 'assistant:current' });
  assert.deepEqual((await f.context.collect(f.task, 'assistant:current')).manifest, changed.manifest);
  assert.ok((await f.context.collect(f.task)).manifest.some(r => r.id === 'own-result'));
});
test('discovery does not read another profession private body even if the platform knows its catalog', async () => {
  const f = fixture(); f.w.catalog = () => ({ sources: [{ id: 'private-sales', domain: 'sales' }], spaces: { sales: { agent: 'role-sales' } } });
  const result = await f.context.search(f.task, '门店试用'); assert.equal(result.length, 0); assert.equal(f.reads(), 0);
});
test('adoption rechecks the exact input versions and blocks historical knowledge', async () => {
  const f = fixture();
  f.w.readMaterial = async () => f.w.knowledge.read();
  await Workspaces.prototype.assertManifest.call(f.w, f.task, [{ kind: 'knowledge', id: 'source', revision: 'v1', hash: 'hash-v1' }]);
  await assert.rejects(Workspaces.prototype.assertManifest.call(f.w, f.task, [{ kind: 'knowledge', id: 'source', revision: 'older', hash: 'old' }]), /上下文已经变化/);
});
test('adding a new source reference invalidates the old generation manifest before human adoption', async () => {
  const f = fixture(), pack = await f.context.collect(f.task);
  f.state.sources.push('new-source');
  await assert.rejects(Workspaces.prototype.assertManifest.call(f.w, f.task, pack.manifest), /上下文已经变化/);
});
test('automatic discovery excludes knowledge published by this task, so adoption cannot feed its own refinement loop', async () => {
  const f = fixture(); f.state.outcomes = [{ publicationId: 'own-publication' }];
  f.w.catalog = () => ({ sources: [{ id: 'own-publication', title: '门店试用规范', domain: 'product', ref: { taskId: 'own-publication' } }], spaces: { product: { agent: f.task.agent } } });
  assert.deepEqual(await f.context.search(f.task, '门店试用规范'), []); assert.equal(f.reads(), 0);
});
test('a historical draft cannot reintroduce changed source evidence into a fresh model context', async () => {
  const f = fixture(); f.state.snapshots.push({ id: 'old-draft', key: 'checkpoint', title: '旧稿', sources: ['source'], inputManifest: [{ kind: 'knowledge', id: 'source', revision: 'old', hash: 'old' }] });
  f.w.assertManifest = async () => { throw new Error('changed source'); };
  const pack = await f.context.collect(f.task);
  assert.equal(pack.layers.checkpoints.length, 0); assert.equal(pack.layers.excludedCheckpoints[0].id, 'old-draft');
  assert.ok(!pack.manifest.some(r => r.id === 'old-draft')); assert.equal(pack.layers.missing.length, 0);
});
test('provenance validation follows draft dependencies instead of only checking the latest draft text', async () => {
  const f = fixture(); f.w.readMaterial = async () => f.w.knowledge.read();
  f.state.snapshots.push({ id: 'prior-draft', key: 'checkpoint', inputManifest: [{ kind: 'knowledge', id: 'source', revision: 'old', hash: 'old' }] });
  f.w.pc = f.w.reader(); f.w.assertManifest = (...args: any[]) => Workspaces.prototype.assertManifest.call(f.w, ...args as [any, any]);
  await assert.rejects(f.w.assertManifest(f.task, [{ kind: 'checkpoint', id: 'prior-draft', key: 'checkpoint', revision: 'note-v1', hash: contextHash('人工新约束') }]), /上下文已经变化/);
});
