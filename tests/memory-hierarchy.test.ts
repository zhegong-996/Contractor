import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_LAYERS, INJECTED_MAX_LINES, INJECTED_MAX_BYTES, REFERENCE_TRAPS,
  assertGroundedNotes, validatedRule, referenceAsMemory, assertReferenceSedimentation,
  wikiReport, assertWikiRepresentation, buildInjectedIndex, assertInjectedIndex,
  dreamProposals, assertDreamProposals, assertNoTranscriptRewrite, memoryHierarchyView,
  type MemoryNote, type TranscriptEvent, type WikiPage,
} from '../src/memory-hierarchy.ts';

const transcript: TranscriptEvent[] = [
  { id: 'e001', at: '2026-11-06T09:00:00Z', kind: 'source-added' },
  { id: 'e002', at: '2026-11-06T09:05:00Z', kind: 'knowledge-proposed' },
  { id: 'e003', at: '2026-11-06T09:10:00Z', kind: 'knowledge-confirmed' },
  { id: 'e004', at: '2026-11-06T09:15:00Z', kind: 'source-revoked', revoked: true },
];

const note = (patch: Partial<MemoryNote> = {}): MemoryNote => ({
  id: 'n-1', title: '知识必须挂靠事实源', statement: '候选知识引用原始事件 id',
  category: 'rule', status: 'candidate', evidenceEventIds: ['e001', 'e002'],
  ...patch,
});

const healthyPages = (): WikiPage[] => [
  { id: 'p-index', title: '索引', body: '本页列出全部主题页', links: ['p-a', 'p-b'], claimEventIds: ['e001'] },
  { id: 'p-a', title: '主题 A', body: 'A 的结论', links: ['p-index'], claimEventIds: ['e002'] },
  { id: 'p-b', title: '主题 B', body: 'B 的结论', links: ['p-a'], claimEventIds: ['e003'] },
];

test('P-7 四层分层顺序固定，注入层在最上', () => {
  assert.deepEqual(MEMORY_LAYERS, ['transcript', 'note', 'representation', 'injected']);
  assert.equal(INJECTED_MAX_LINES, 200);
  assert.equal(INJECTED_MAX_BYTES, 25 * 1024);
});

test('P-7 挂靠事实源的候选通过，并如实计数', () => {
  const report = assertGroundedNotes({ notes: [note(), note({ id: 'n-2', status: 'withdrawn', evidenceEventIds: [] })], transcript });
  assert.deepEqual(report, { notes: 2, activeNotes: 1, evidenceRefs: 2, withdrawnNotes: 1, confirmedNotes: 0 });
});

test('P-7 无原始事件留痕的知识被拒（无法回到 transcript 校验）', () => {
  assert.throws(() => assertGroundedNotes({ notes: [note({ evidenceEventIds: [] })], transcript }),
    /未挂靠原始事件留痕/);
});

test('P-7 悬空证据、重复引用、已撤回证据分别被拒', () => {
  assert.throws(() => assertGroundedNotes({ notes: [note({ evidenceEventIds: ['missing'] })], transcript }), /悬空证据/);
  assert.throws(() => assertGroundedNotes({ notes: [note({ evidenceEventIds: ['e001', 'e001'] })], transcript }), /重复引用/);
  assert.throws(() => assertGroundedNotes({ notes: [note({ evidenceEventIds: ['e004'] })], transcript }), /已撤回/);
  assert.throws(() => assertGroundedNotes({
    notes: [note({ evidenceEventIds: ['e004'] })], transcript, invalidatedEventIds: ['e001'],
  }), /已撤回/);
  assert.throws(() => assertGroundedNotes({
    notes: [note({ evidenceEventIds: ['e001'] })], transcript, invalidatedEventIds: ['e001'],
  }), /已撤回/);
});

test('P-7 标为已确认却无真人签字的知识被拒：不得自动采用', () => {
  assert.throws(() => assertGroundedNotes({ notes: [note({ status: 'confirmed' })], transcript }), /不得自动采用/);
  const report = assertGroundedNotes({ notes: [note({ status: 'confirmed', confirmedBy: '职能 owner' })], transcript });
  assert.equal(report.confirmedNotes, 1);
});

test('P-7 规则沉淀必须带「如何知道它为真」，且恒为候选', () => {
  const rule = validatedRule({ id: 'r-1', title: '连续安静 30 秒才收敛', statement: '状态由任务事实派生',
    evidenceEventIds: ['e001'], howKnown: '重放 40 项真跑后签名一致' });
  assert.equal(rule.category, 'rule');
  assert.equal(rule.status, 'candidate');
  assert.equal(rule.confirmedBy, undefined);
  assert.equal(rule.howKnown, '重放 40 项真跑后签名一致');
  assert.throws(() => validatedRule({ id: 'r-2', title: 'x', statement: 'x', evidenceEventIds: ['e001'], howKnown: '' }),
    /如何知道它为真/);
  assert.throws(() => validatedRule({ id: 'r-3', title: 'x', statement: 'x', evidenceEventIds: [], howKnown: '依据' }),
    /挂靠原始事件/);
});

test('P-7 规则随陷阱警告一起沉淀，不留下无依据的结论', () => {
  const rule = validatedRule({ id: 'r-4', title: 'x', statement: 'x', evidenceEventIds: ['e001'],
    howKnown: '依据', traps: ['不要把可见就当作可验收'] });
  assert.deepEqual(rule.traps, ['不要把可见就当作可验收']);
});

test('P-7 外部参考本身按候选沉淀，并带齐红线警告', () => {
  const reference = referenceAsMemory({ id: 'ref-anthropic', title: 'agent memory 分层',
    statement: '知识表示层应有链接与索引，且不得比原始语料大',
    sourceUrl: 'https://www.anthropic.com/research/components-of-agent-memory',
    evidenceEventIds: ['e001', 'e002'] });
  assert.equal(reference.category, 'reference');
  assert.equal(reference.status, 'candidate');
  assert.equal(reference.confirmedBy, undefined);
  assert.deepEqual(reference.traps?.slice(0, 3), [...REFERENCE_TRAPS]);
  assert.deepEqual(assertReferenceSedimentation(reference), { candidate: true, evidenceRefs: 2, traps: 3 });
});

test('P-7 参考沉淀拒绝无来源、无事件、已确认或非 reference 类别', () => {
  const base = { id: 'ref', title: 'x', statement: 'x',
    sourceUrl: 'https://example.com/a', evidenceEventIds: ['e001'] };
  assert.throws(() => referenceAsMemory({ ...base, sourceUrl: 'not-a-url' }), /http\(s\) 地址/);
  assert.throws(() => referenceAsMemory({ ...base, evidenceEventIds: [] }), /原始事件留痕/);
  assert.throws(() => assertReferenceSedimentation({ ...referenceAsMemory(base), status: 'confirmed' }), /只能是候选/);
  assert.throws(() => assertReferenceSedimentation({ ...referenceAsMemory(base), confirmedBy: '某人' }), /采用是后续独立动作/);
  assert.throws(() => assertReferenceSedimentation({ ...referenceAsMemory(base), category: 'fact' }), /必须是 reference/);
  assert.throws(() => assertReferenceSedimentation({ ...referenceAsMemory(base), traps: [] }), /红线 \/ 陷阱警告/);
});

test('P-7 健康知识地图通过体检：链接完整、断言有出处、不膨胀', () => {
  const report = wikiReport({ pages: healthyPages(), corpusBytes: 40000, transcript });
  assert.equal(report.pages, 3);
  assert.equal(report.links, 4);
  assert.equal(report.bloated, false);
  assert.deepEqual(report.danglingLinks, []);
  assert.deepEqual(report.noLinkPages, []);
  assert.deepEqual(report.duplicateTitles, []);
  assert.deepEqual(report.ungroundedClaims, []);
  assert.deepEqual(assertWikiRepresentation(report),
    { pages: 3, links: 4, bytes: report.bytes, corpusBytes: 40000 });
});

test('P-7 悬空链接、孤立页、重复主题、无出处断言逐一被发现', () => {
  const broken = wikiReport({ pages: [
    { id: 'p-x', title: '主题 X', body: 'X', links: ['p-missing'], claimEventIds: ['e001'] },
    { id: 'p-y', title: '主题 X', body: 'Y', links: [], claimEventIds: ['e999'] },
    { id: 'p-z', title: '孤立 Z', body: 'Z', links: [] },
  ], corpusBytes: 100000, transcript });
  assert.deepEqual(broken.danglingLinks, [{ from: 'p-x', to: 'p-missing' }]);
  assert.deepEqual(broken.noLinkPages, ['p-y', 'p-z']);
  assert.deepEqual(broken.duplicateTitles, ['主题 X']);
  assert.equal(broken.ungroundedClaims.length, 2);
  assert.throws(() => assertWikiRepresentation(broken), /悬空链接/);
});

test('P-7 知识地图比原始语料还大即「抽象为零」，明确拒绝', () => {
  const bloated = wikiReport({ pages: [
    { id: 'p-1', title: '地图', body: 'x'.repeat(300000), links: [], claimEventIds: ['e001'] },
  ], corpusBytes: 115000, transcript });
  assert.equal(bloated.bloated, true);
  assert.ok(bloated.bytes > bloated.corpusBytes * 1.7);
  assert.throws(() => assertWikiRepresentation({ ...bloated, danglingLinks: [], noLinkPages: [],
    duplicateTitles: [], ungroundedClaims: [] }), /抽象为零/);
});

test('P-7 注入顶层只放索引与指针，不含正文', () => {
  const notes = [note({ id: 'n-a', status: 'confirmed', confirmedBy: 'owner', injected: true }),
    note({ id: 'n-b', status: 'confirmed', confirmedBy: 'owner', injected: true }), note({ id: 'n-c' })];
  const index = buildInjectedIndex(notes);
  assert.deepEqual(index.entries.map(e => e.id), ['n-a', 'n-b']);
  assert.equal(index.detailDemoted, 2);
  assert.equal(index.omitted, 0);
  assert.ok(index.entries.every(e => e.pointer.startsWith('note:')));
  assert.ok(!JSON.stringify(index).includes('候选知识引用原始事件 id'));
  assert.deepEqual(assertInjectedIndex(index), { entries: 2, bytes: index.bytes, lines: 2 });
});

test('P-7 注入顶层超预算或混入正文均被拒', () => {
  const many = Array.from({ length: 40 }, (_, i) => note({
    id: 'n-' + String(i).padStart(2, '0'), status: 'confirmed', confirmedBy: 'owner', injected: true,
  }));
  const index = buildInjectedIndex(many, { maxLines: 2 });
  assert.equal(index.entries.length, 2);
  assert.equal(index.omitted, 38);
  assert.throws(() => assertInjectedIndex(index, { maxLines: 1 }), /超出预算/);
  const polluted = { ...index, entries: [{ id: 'x', title: 'x', pointer: 'note:x', statement: '正文' }] };
  assert.throws(() => assertInjectedIndex(polluted), /只能是索引/);
  assert.throws(() => assertInjectedIndex({ ...index, entries: [{ id: 'x', title: 'x', pointer: 'bad:x' }] }),
    /指向下层的指针/);
});

test('P-7 离线整理产出确定性、只读、待真人复核的建议', () => {
  const pages = healthyPages();
  const before = structuredClone(pages);
  const args = { notes: [note()], pages, transcript, corpusBytes: 40000 };
  const a = dreamProposals(args), b = dreamProposals(args);
  assert.deepEqual(a, b);
  assert.deepEqual(pages, before);
  assert.deepEqual(assertDreamProposals(a), { count: a.length, modelCalls: 0 });
  assert.ok(a.every(p => p.requiresHumanReview === true && p.modelCalls === 0));
  assert.ok(!a.some(p => ['confirm-note', 'delete-event', 'accept-acceptance', 'rewrite-transcript'].includes(p.kind)));
});

test('P-7 错误证据、悬空链接、膨胀与超预算各触发对应建议', () => {
  const proposals = dreamProposals({
    notes: [note({ evidenceEventIds: ['ghost'] })],
    pages: [
      { id: 'p-1', title: '地图', body: 'x'.repeat(1000), links: ['p-missing'], claimEventIds: ['e001'] },
      { id: 'p-2', title: '地图', body: 'y', links: ['p-1'] },
      { id: 'p-3', title: '孤立', body: 'z', links: [] },
    ],
    transcript, corpusBytes: 10,
    injected: { schemaVersion: 1, entries: [], lines: 0, bytes: 0, detailDemoted: 0, omitted: 5 },
  });
  const kinds = new Set(proposals.map(p => p.kind));
  for (const kind of ['correct-note', 'repoint-link', 'merge-duplicate', 'prune-page', 'demote-injected', 'fill-gap'])
    assert.ok(kinds.has(kind as never), '缺少建议类型 ' + kind);
});

test('P-7 已签字且证据完整的条目可提请提升，但仍需真人复核', () => {
  const proposals = dreamProposals({ notes: [note({ status: 'confirmed', confirmedBy: 'owner' })],
    pages: healthyPages(), transcript, corpusBytes: 40000 });
  assert.ok(proposals.some(p => p.kind === 'promote-note' && p.target === 'n-1'));
  assert.ok(proposals.every(p => p.requiresHumanReview === true));
});

test('P-7 离线整理不得回溯改写或截断 append-only 主干', () => {
  const before = transcript.slice(0, 3);
  assert.deepEqual(assertNoTranscriptRewrite(before, [...before, { id: 'e005', at: 'x', kind: 'note' }]), { appended: 1 });
  assert.throws(() => assertNoTranscriptRewrite(before, before.slice(0, 2)), /不得截断/);
  assert.throws(() => assertNoTranscriptRewrite(before,
    [{ ...before[0]!, kind: 'changed' }, before[1]!, before[2]!]), /回溯改写/);
});

test('P-7 只读汇总四层齐备，且 modelCalls 恒为 0', () => {
  const view = memoryHierarchyView({ notes: [note()], pages: healthyPages(), transcript, corpusBytes: 40000 });
  assert.deepEqual(view.layers, ['transcript', 'note', 'representation', 'injected']);
  assert.equal(view.grounding.evidenceRefs, 2);
  assert.equal(view.wiki.bloated, false);
  assert.equal(view.injected.entries.length, 0);
  assert.equal(view.modelCalls, 0);
  assert.equal(view.deterministic, true);
});

test('P-7 不改动既有四条投影与知识链：本模块无副作用、无 IO', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/memory-hierarchy.ts', import.meta.url), 'utf8'));
  assert.ok(!/readFileSync|writeFileSync|fetch\(|appendFileSync/.test(source));
  assert.ok(!/process\.env/.test(source));
});
