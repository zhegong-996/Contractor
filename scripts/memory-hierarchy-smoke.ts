// P-7 真跑：把「组织内沉淀知识 = 记忆 + 规则」在隔离的确定性数据上跑一遍。
//
// 只借 Anthropic "The components of agent memory" 的分层思想，未复制正文 / 代码，
// 未调用任何外部模型；不写真实 .runtime/memory/events.jsonl 或治理台账。
// 报告落在 .runtime/memory-hierarchy-smoke.json。
// 用法：npm run memory:hierarchy
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runtime, root } from '../src/config.ts';
import path from 'node:path';
import {
  MEMORY_LAYERS, INJECTED_MAX_LINES, INJECTED_MAX_BYTES,
  assertGroundedNotes, validatedRule, referenceAsMemory, assertReferenceSedimentation,
  wikiReport, assertWikiRepresentation, buildInjectedIndex, assertInjectedIndex,
  dreamProposals, assertDreamProposals, assertNoTranscriptRewrite, memoryHierarchyView,
  type MemoryNote, type TranscriptEvent, type WikiPage,
} from '../src/memory-hierarchy.ts';

type Check = { name: string; ok: boolean; detail: Record<string, unknown> };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: Record<string, unknown> = {}) =>
  checks.push({ name, ok, detail });
const rejects = (fn: () => unknown, pattern: RegExp): boolean => {
  try { fn(); return false; } catch (error) { return pattern.test(String(error)); }
};
const lineCount = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
const realMemoryLog = path.join(root, '.runtime/memory/events.jsonl');
const memoryBefore = lineCount(realMemoryLog);

const transcript: TranscriptEvent[] = [
  { id: 't001', at: '2026-11-06T09:00:00Z', kind: 'source-added' },
  { id: 't002', at: '2026-11-06T09:05:00Z', kind: 'knowledge-proposed' },
  { id: 't003', at: '2026-11-06T09:10:00Z', kind: 'knowledge-confirmed' },
  { id: 't004', at: '2026-11-06T09:15:00Z', kind: 'source-revoked', revoked: true },
];
const transcriptBefore = structuredClone(transcript);

check('A1 四层分层固定，注入层最上、预算 200 行 / 25KB',
  MEMORY_LAYERS.join(',') === 'transcript,note,representation,injected'
    && INJECTED_MAX_LINES === 200 && INJECTED_MAX_BYTES === 25 * 1024,
  { layers: [...MEMORY_LAYERS], maxLines: INJECTED_MAX_LINES, maxBytes: INJECTED_MAX_BYTES });

const rule = validatedRule({ id: 'rule-1', title: '候选知识必须挂靠原始事件',
  statement: '每条组织知识都要能回到 append-only 留痕校验', evidenceEventIds: ['t001', 't002'],
  howKnown: '重放四类投影与 checkpoint 后签名一致', traps: ['撤权是状态写入，不是物理删除'] });
const reference = referenceAsMemory({ id: 'ref-anthropic-memory', title: 'agent memory 分层',
  statement: '表示层应有链接与索引、注入层只放索引、离线整理只提建议',
  sourceUrl: 'https://www.anthropic.com/research/components-of-agent-memory',
  evidenceEventIds: ['t001', 't002'] });
const adopted: MemoryNote = { id: 'note-adopted', title: '已采用的组织规则', statement: '正文只留在下层',
  category: 'fact', status: 'confirmed', confirmedBy: '职能 owner', injected: true,
  evidenceEventIds: ['t003'] };
const notes = [rule, reference, adopted];

check('A2 规则沉淀带依据、恒为候选、未被自动采用',
  rule.status === 'candidate' && Boolean(rule.howKnown) && !rule.confirmedBy && (rule.traps?.length ?? 0) > 0);
check('A3 外部参考本身按候选沉淀，带来源与三条红线',
  reference.status === 'candidate' && reference.category === 'reference'
    && reference.sourceRefs?.length === 1 && (reference.traps?.length ?? 0) >= 3
    && assertReferenceSedimentation(reference).candidate === true,
  { source: reference.sourceRefs?.[0], traps: reference.traps?.length });

const grounding = assertGroundedNotes({ notes, transcript });
check('B1 三条候选 / 已签字知识全部挂得住事实源',
  grounding.activeNotes === 3 && grounding.evidenceRefs === 5 && grounding.confirmedNotes === 1, grounding);
check('B2 无留痕 / 悬空 / 已撤回 / 无签字却确认一律拒绝',
  rejects(() => assertGroundedNotes({ notes: [{ ...rule, evidenceEventIds: [] }], transcript }), /未挂靠/)
    && rejects(() => assertGroundedNotes({ notes: [{ ...rule, evidenceEventIds: ['ghost'] }], transcript }), /悬空/)
    && rejects(() => assertGroundedNotes({ notes: [{ ...rule, evidenceEventIds: ['t004'] }], transcript }), /撤回/)
    && rejects(() => assertGroundedNotes({ notes: [{ ...adopted, confirmedBy: undefined }], transcript }), /不得自动采用/));

const healthyPages: WikiPage[] = [
  { id: 'p-index', title: '索引', body: '列出全部主题页', links: ['p-a', 'p-b'], claimEventIds: ['t001'] },
  { id: 'p-a', title: '主题 A', body: 'A 的结论', links: ['p-index'], claimEventIds: ['t002'] },
  { id: 'p-b', title: '主题 B', body: 'B 的结论', links: ['p-a'], claimEventIds: ['t003'] },
];
const healthy = wikiReport({ pages: healthyPages, corpusBytes: 40000, transcript });
check('C1 健康知识地图：链接完整、断言有出处、不膨胀',
  !healthy.bloated && healthy.danglingLinks.length === 0 && healthy.ungroundedClaims.length === 0
    && healthy.noLinkPages.length === 0 && assertWikiRepresentation(healthy).pages === 3,
  { pages: healthy.pages, links: healthy.links, bytes: healthy.bytes, corpusBytes: healthy.corpusBytes });

// 复现文章里「地图和帝国一样大」的失败：10 份文档 115KB，wiki 203KB = 1.77 倍。
const corpusBytes = 115 * 1024;
const bloated = wikiReport({ pages: [
  { id: 'p-big', title: '超大地图', body: 'x'.repeat(204 * 1024), links: [], claimEventIds: ['t001'] },
], corpusBytes, transcript });
check('C2 知识地图超过原始语料（约 1.77 倍）被判膨胀并拒绝',
  bloated.bloated && bloated.bytes > corpusBytes * 1.7
    && rejects(() => assertWikiRepresentation({ ...bloated, danglingLinks: [], noLinkPages: [],
      duplicateTitles: [], ungroundedClaims: [] }), /抽象为零/),
  { wikiBytes: bloated.bytes, corpusBytes, ratio: Number((bloated.bytes / corpusBytes).toFixed(2)) });

const broken = wikiReport({ pages: [
  { id: 'p-x', title: '主题 X', body: 'X', links: ['p-missing'], claimEventIds: ['t001'] },
  { id: 'p-y', title: '主题 X', body: 'Y', links: [], claimEventIds: ['t999'] },
], corpusBytes, transcript });
check('C3 悬空链接 / 重复主题 / 孤立页 / 无出处断言如实列出',
  broken.danglingLinks.length === 1 && broken.duplicateTitles.length === 1
    && broken.noLinkPages.includes('p-y') && broken.ungroundedClaims.length >= 1,
  { dangling: broken.danglingLinks, duplicate: broken.duplicateTitles, noLink: broken.noLinkPages });

const injected = buildInjectedIndex(notes);
check('D1 注入顶层只有已签字且真人批准提升的条目，正文下移',
  injected.entries.length === 1 && injected.entries[0]?.id === 'note-adopted'
    && injected.detailDemoted === 1 && !JSON.stringify(injected).includes(adopted.statement)
    && assertInjectedIndex(injected).entries === 1,
  { lines: injected.lines, bytes: injected.bytes, pointer: injected.entries[0]?.pointer });
const packed = buildInjectedIndex(Array.from({ length: 40 }, (_, i) => ({
  ...adopted, id: 'n-' + String(i).padStart(2, '0'),
})), { maxLines: 2 });
check('D2 超出 200 行 / 25KB 预算即截断并触发下移建议',
  packed.entries.length === 2 && packed.omitted === 38
    && rejects(() => assertInjectedIndex(packed, { maxLines: 1 }), /超出预算/));

const pagesBefore = structuredClone(healthyPages);
const args = { notes, pages: healthyPages, transcript, corpusBytes: 40000 };
const first = dreamProposals(args), second = dreamProposals(args);
const proposalsOk = assertDreamProposals(first);
check('E1 离线整理确定性、只读、待真人复核、modelCalls=0',
  JSON.stringify(first) === JSON.stringify(second) && JSON.stringify(healthyPages) === JSON.stringify(pagesBefore)
    && proposalsOk.modelCalls === 0
    && first.every(p => p.requiresHumanReview === true && p.modelCalls === 0)
    && !first.some(p => ['confirm-note', 'delete-event', 'accept-acceptance', 'rewrite-transcript'].includes(p.kind)),
  { count: proposalsOk.count, kinds: [...new Set(first.map(p => p.kind))] });
const pendingPromotion: MemoryNote = { ...adopted, id: 'note-pending', injected: false };
const withPending = [...notes, pendingPromotion];
const promotion = dreamProposals({ ...args, notes: withPending });
check('E2 未提升的已签字条目只产出「提请提升」建议，不自动注入',
  promotion.some(p => p.kind === 'promote-note' && p.target === 'note-pending')
    && buildInjectedIndex(withPending).entries.length === 1
    && !buildInjectedIndex(withPending).entries.some(e => e.id === 'note-pending'));

const drifted = dreamProposals({ notes: [{ ...rule, evidenceEventIds: ['ghost'] }],
  pages: [{ id: 'p-1', title: '地图', body: 'y'.repeat(1000), links: ['p-missing'], claimEventIds: ['t001'] }],
  transcript, corpusBytes: 10,
  injected: { schemaVersion: 1, entries: [], lines: 0, bytes: 0, detailDemoted: 0, omitted: 5 } });
const driftKinds = new Set(drifted.map(p => p.kind));
check('E3 证据漂移 / 悬空链接 / 膨胀 / 超预算各触发纠偏建议',
  ['correct-note', 'repoint-link', 'prune-page', 'demote-injected'].every(k => driftKinds.has(k as never)),
  { kinds: [...driftKinds].sort() });

const transcriptAfterDream = [...transcript, { id: 't005', at: '2026-11-06T09:20:00Z', kind: 'dream-proposed' }];
check('F1 离线整理后 append-only 主干只能追加，历史逐条未变',
  assertNoTranscriptRewrite(transcriptBefore, transcriptAfterDream).appended === 1
    && rejects(() => assertNoTranscriptRewrite(transcriptBefore, transcriptBefore.slice(0, 2)), /不得截断/)
    && rejects(() => assertNoTranscriptRewrite(transcriptBefore,
      [{ ...transcriptBefore[0]!, kind: 'changed' }, ...transcriptBefore.slice(1)]), /回溯改写/));

const view = memoryHierarchyView({ notes, pages: healthyPages, transcript, corpusBytes: 40000 });
check('F2 只读汇总四层齐备且确定性、零模型调用',
  view.layers.length === 4 && view.modelCalls === 0 && view.deterministic === true
    && view.grounding.evidenceRefs === 5 && !view.wiki.bloated);

const memoryAfter = lineCount(realMemoryLog);
check('F3 真跑未写任何真实 B1 记忆主干 / 治理台账', memoryBefore === memoryAfter,
  { memoryBefore, memoryAfter });

const failed = checks.filter(c => !c.ok).map(c => c.name);
const report = {
  ok: failed.length === 0,
  note: '隔离确定性数据真跑，仅借 Anthropic agent memory 分层思想；未复制正文 / 代码、未引入依赖或第 8 个上游、未调用外部模型、未写真实 .runtime/memory/events.jsonl；离线整理只产出待真人复核的建议',
  checks: checks.length, failed, details: checks,
  realLogs: { memoryBefore, memoryAfter },
};
mkdirSync(runtime(), { recursive: true, mode: 0o700 });
const out = path.join(runtime(), 'memory-hierarchy-smoke.json');
writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failed,
  report: path.relative(root, out) }, null, 2));
if (failed.length) process.exitCode = 1;
