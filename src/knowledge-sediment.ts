// 第六十九轮 · 判定沉淀：把决策账本接回知识库，且必须落满三层。
//
// 我们的知识库本来就是三层结构，这一轮不替换、只打通：
//   结构化   `facts: {key: string|number|boolean}` + kind + appliesTo + domains
//   非结构化 `body`（最长 3 万字正文，讲清楚发生了什么）
//   图谱     `KnowledgeEdge`（belongs_to_role / verified_by / responsible_for …，
//            证据引用非空、状态默认 draft，只有人能 accepted）
//
// DSH 的贡献是「判定要能解释」：账本记的是「谁、凭什么、判了什么」。所以这里
// 提炼的对象不是单条记录，而是**重复出现的判定模式**——一条孤例不构成知识，
// 同一类判定反复发生、依据一致，才值得沉淀成可复用的结论。
//
// 红线：本模块只产**候选**。写进知识库必须走人审（knowledge-propose → review），
// 任何自动采用都是越权。

import { createHash } from 'node:crypto';
import type { EdgeKind } from './knowledge-edges.ts';
import type { LedgerEntry, LedgerKind } from './decision-ledger.ts';

/** 一层都不能少：缺哪层就如实标缺，不假装完整。 */
export type SedimentLayer = 'facts' | 'body' | 'edges';

export type SedimentEdgeDraft = {
  kind: EdgeKind;
  from: string;
  to: string;
  /** 证据引用：指回产生这条边的那条判定。图谱边没有证据就不该存在。 */
  evidenceRefs: { sourceId: string; revision: string; excerpt?: string }[];
};

export type SedimentCandidate = {
  id: string;
  /** 来源判定（账本条目 id），可逐条回查。 */
  ledgerEntryIds: string[];
  kind: 'decision' | 'procedure' | 'experiment' | 'feedback' | 'reference';
  /** 建议的知识 key（符合 knowledge-<slug> 约束）。 */
  suggestedKey: string;
  title: string;
  /** 结构化层。 */
  facts: Record<string, string | number | boolean>;
  /** 非结构化层。 */
  body: string;
  /** 图谱层（草稿边，等人验收）。 */
  edges: SedimentEdgeDraft[];
  /** 建议适用范围。 */
  appliesTo: string;
  domains: string[];
  /** 为什么值得沉淀。 */
  reasons: { code: string; text: string }[];
  /** 缺了哪层。空数组 = 三层齐备。 */
  gaps: SedimentLayer[];
  /** 证据强度：同类判定出现的次数。 */
  occurrences: number;
};

/** 三层体检：单条知识/候选的完整度。 */
export type LayerScore = {
  structured: boolean;
  narrative: boolean;
  graph: boolean;
  /** 0-3，缺一层扣一分。 */
  score: number;
  gaps: SedimentLayer[];
};

export function scoreLayers(input: {
  facts?: Record<string, unknown>;
  body?: string;
  edges?: readonly unknown[];
}): LayerScore {
  const structured = Object.keys(input.facts ?? {}).length > 0;
  const narrative = String(input.body ?? '').trim().length >= 80;
  const graph = (input.edges ?? []).length > 0;
  const gaps: SedimentLayer[] = [];
  if (!structured) gaps.push('facts');
  if (!narrative) gaps.push('body');
  if (!graph) gaps.push('edges');
  return { structured, narrative, graph, score: 3 - gaps.length, gaps };
}

/** 哪些判定值得被提炼：知识类不重复沉淀（否则自我循环），其余按类归组。 */
const SEDIMENTABLE: Record<LedgerKind, SedimentCandidate['kind'] | null> = {
  route: 'procedure',      // 派活模式 → 怎么派
  access: 'procedure',     // 授权模式 → 怎么批
  knowledge: null,         // 已经是知识，不再二次沉淀
  delegation: 'procedure', // 委派模式 → 交给谁
  acceptance: 'decision',  // 验收结论 → 判定标准
  escalation: 'feedback',  // 升级原因 → 反馈
  review: 'feedback',
};

/** 把一条判定压成一个可比较的"模式指纹"，同指纹归为一组。 */
function patternOf(entry: LedgerEntry): string {
  // 只取结构性信息：类别 + 结论骨架 + 依据 + 主客体角色。
  // 刻意不含时间与具体 id，否则同一模式永远不会重复。
  const verdictSkeleton = entry.verdict.replace(/[a-z0-9-]{6,}/gi, '·').replace(/（[^）]*）/g, '');
  return [entry.kind, verdictSkeleton, entry.basis, entry.actorKind, entry.requiresHuman === true ? 'sign' : 'auto'].join('|');
}

const slug = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

function titleOf(entry: LedgerEntry): string {
  const kindText = { route: '派活', access: '授权', knowledge: '知识', delegation: '委派', acceptance: '验收', escalation: '升级', review: '评审' }[entry.kind];
  // 用原始结论做标题（可读），只在过长时截断——不要把 id 打成占位符。
  // 末尾带依据：同一结论按不同依据（policy / human / …）会各自成条，标题必须能区分。
  const short = entry.verdict.length > 32 ? entry.verdict.slice(0, 32) + '…' : entry.verdict;
  return `${kindText}模式：${short} · ${entry.basis}`;
}

/**
 * 从账本提炼沉淀候选。
 *
 * 只提炼**出现次数 ≥ minOccurrences** 的模式：孤例不是知识，重复才是。
 * 每条候选都必须带齐证据（来源判定 id）与三层落点（facts / body / edges），
 * 缺层的信息会进 gaps，由人决定补还是不沉。
 */
export function sedimentFromLedger(
  entries: readonly LedgerEntry[],
  options: { minOccurrences?: number; domains?: string[] } = {},
): SedimentCandidate[] {
  const minOccurrences = Math.max(2, options.minOccurrences ?? 2);
  const domains = (options.domains?.length ? options.domains : ['org']).slice(0, 20);
  const groups = new Map<string, LedgerEntry[]>();

  for (const entry of entries) {
    if (!SEDIMENTABLE[entry.kind]) continue;
    const fingerprint = patternOf(entry);
    const bucket = groups.get(fingerprint);
    if (bucket) bucket.push(entry);
    else groups.set(fingerprint, [entry]);
  }

  const candidates: SedimentCandidate[] = [];
  for (const [fingerprint, bucket] of groups) {
    if (bucket.length < minOccurrences) continue;
    const sample = bucket[0];
    const kind = SEDIMENTABLE[sample.kind];
    if (!kind) continue;

    const actors = [...new Set(bucket.map(e => e.actor))].sort();
    const bases = [...new Set(bucket.map(e => e.basis))].sort();
    const needsHuman = bucket.filter(e => e.requiresHuman === true).length;
    const taskIds = [...new Set(bucket.map(e => e.taskId).filter((id): id is string => Boolean(id)))];

    // 结构化层：可以直接被查询、被校验的事实。
    const facts: Record<string, string | number | boolean> = {
      occurrences: bucket.length,
      basis: bases.join(','),
      actor_kind: sample.actorKind,
      requires_human: needsHuman > 0,
      first_seen: bucket.reduce((min, e) => (e.at < min ? e.at : min), sample.at),
      last_seen: bucket.reduce((max, e) => (e.at > max ? e.at : max), sample.at),
      sample_verdict: sample.verdict.slice(0, 200),
    };
    if (taskIds.length) facts.task_count = taskIds.length;
    if (actors.length) facts.actors = actors.slice(0, 8).join(',');

    // 非结构化层：讲清楚"在什么情形下、按什么标准、重复判了什么"。
    const body = [
      `这一类判定在本工作区出现了 ${bucket.length} 次，最近一次在 ${facts.last_seen}。`,
      `判定主体：${actors.slice(0, 5).join('、')}（${sample.actorKind === 'human' ? '人' : sample.actorKind === 'agent' ? 'Agent' : '系统'}）。依据类型：${bases.join('、')}。`,
      needsHuman > 0
        ? `其中 ${needsHuman} 次需要人签字——这类判定不能全自动。`
        : sample.actorKind === 'human'
          ? '这类判定由人做出，只是不涉及额外签字。'
          : '这类判定由系统或 Agent 完成，不需要人逐次签字。',
      `代表性结论：「${sample.verdict}」。`,
      taskIds.length ? `涉及 ${taskIds.length} 个任务，可按来源逐条回查。` : '',
      `沉淀下来的意义：下次遇到同类情形，可以直接引用这条标准，不必重新推一遍；` +
        `如果哪天依据变了（比如从 policy 改成 human），这条知识应随之失效。`,
    ].filter(Boolean).join('\n\n');

    // 图谱层：草稿边，证据指回产生它的判定。
    const primaryTask = taskIds[0] ?? `pattern:${slug(fingerprint)}`;
    const edges: SedimentEdgeDraft[] = [
      {
        kind: 'verified_by',
        from: primaryTask,
        to: `decision:${sample.id}`,
        evidenceRefs: bucket.slice(0, 5).map(e => ({
          sourceId: `audit:${e.action}:${e.id}`,
          revision: e.at,
          excerpt: e.verdict.slice(0, 120),
        })),
      },
    ];
    if (sample.actorKind !== 'system') {
      edges.push({
        kind: 'responsible_for',
        from: sample.actor,
        to: primaryTask,
        evidenceRefs: bucket.slice(0, 3).map(e => ({
          sourceId: `audit:${e.action}:${e.id}`,
          revision: e.at,
        })),
      });
    }

    const score = scoreLayers({ facts, body, edges });
    const reasons = [
      { code: 'pattern:repeated', text: `同类判定出现 ${bucket.length} 次（阈值 ${minOccurrences}）` },
      { code: `basis:${sample.basis}`, text: `依据一致：${bases.join('、')}` },
      ...(needsHuman > 0 ? [{ code: 'human:required', text: `${needsHuman} 次需人签字，是有边界的行为` }] : []),
      { code: 'trace:linked', text: `可逐条回查到 ${bucket.length} 条原始判定` },
    ];

    candidates.push({
      id: `sediment:${slug(fingerprint)}`,
      ledgerEntryIds: bucket.map(e => e.id),
      kind,
      suggestedKey: `knowledge-${sample.kind}-${createHash('sha256').update(fingerprint).digest('hex').slice(0, 8)}`,
      title: titleOf(sample),
      facts, body, edges,
      appliesTo: `同类${sample.kind === 'route' ? '派活' : sample.kind === 'access' ? '授权' : '判定'}情形；依据为 ${bases.join('、')} 时适用`,
      domains,
      reasons,
      gaps: score.gaps,
      occurrences: bucket.length,
    });
  }

  // 证据强的排前面；同分按 id 稳定排序。
  return candidates.sort((a, b) => (b.occurrences - a.occurrences) || a.id.localeCompare(b.id));
}

export type SedimentSummary = {
  candidates: number;
  /** 三层齐备的候选数。 */
  complete: number;
  /** 缺层的候选数。 */
  incomplete: number;
  /** 被提炼的判定条数（去重后）。 */
  coveredEntries: number;
};

export function summarizeSediment(candidates: readonly SedimentCandidate[]): SedimentSummary {
  const covered = new Set<string>();
  for (const c of candidates) for (const id of c.ledgerEntryIds) covered.add(id);
  const complete = candidates.filter(c => c.gaps.length === 0).length;
  return {
    candidates: candidates.length,
    complete,
    incomplete: candidates.length - complete,
    coveredEntries: covered.size,
  };
}
