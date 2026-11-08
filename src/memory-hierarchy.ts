// 组织内沉淀知识 = 记忆；而「哪些沉淀算数」必须是一条规则。
//
// 思想来源（仅借架构，不复制正文 / 代码、不引入依赖）：
//   "The components of agent memory" · Anthropic Engineering · Published Nov 6, 2026
//   Written by Lance Martin · https://www.anthropic.com/research/components-of-agent-memory
//   © 2026 Anthropic PBC，网页内容、无开源许可证 → 只作思想参考，登记在
//   sources.lock.json 的 conceptReferences，不是 submodule、不是第 8 个上游。
//
// 本仓库已有的等价物，不重复建设：
//   transcripts        ↔ .runtime/memory/events.jsonl + routing trace（append-only 事实源）
//   memory notes       ↔ Knowledge（candidate → confirmed/withdrawn + HMAC + 撤权 lineage）
//   projections        ↔ memory-projections.ts 四类投影 + memory-checkpoint.ts 增量重放
//   context injection  ↔ TaskContext.collect / buildContextPack（有预算的一次性 Pack）
//
// 本模块补的是文章里最值得参考、而本仓库确实没有的「规则」：
//   1) 任何候选知识必须挂靠原始事件 id，才能回到 transcript 校验（ground truth）；
//   2) wiki 表示层必须有链接、声明必须能查回来源、且不得比原始语料还大；
//   3) 注入顶层必须小、只放索引与指针，细节下移；
//   4) 离线整理（Dreaming）只产出待真人复核的建议，绝不改主干 / 自动采用；
//   5) 「我们参考的材料」本身也按候选沉淀，且不得自动生效。
//
// 全部为纯函数：无 IO、无网络、无时钟依赖（时间由调用方传入）、modelCalls 恒为 0。

export const MEMORY_LAYERS = ['transcript', 'note', 'representation', 'injected'] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

/** 追加写主干里的一条留痕；revoked 是状态写入，不是物理删除。 */
export type TranscriptEvent = {
  id: string;
  at: string;
  kind: string;
  revoked?: boolean;
};

export type MemoryNoteStatus = 'candidate' | 'confirmed' | 'withdrawn';
export type MemoryNoteCategory = 'rule' | 'fact' | 'reference' | 'plan';

/** 一条组织知识 / 规则 / 参考。evidenceEventIds 是它回到事实源的唯一凭据。 */
export type MemoryNote = {
  id: string;
  title: string;
  statement: string;
  category: MemoryNoteCategory;
  status: MemoryNoteStatus;
  evidenceEventIds: string[];
  sourceRefs?: string[];
  confirmedBy?: string;
  /** 「怎么知道它为真」——规则沉淀不可省，避免只留结论不留依据。 */
  howKnown?: string;
  /** 陷阱警告：把踩过的坑随规则一起带走。 */
  traps?: string[];
  /** 是否已被真人批准提升到注入顶层。缺省 false：提升只能走离线建议 + 人审。 */
  injected?: boolean;
};

export type GroundingReport = {
  notes: number;
  activeNotes: number;
  evidenceRefs: number;
  withdrawnNotes: number;
  confirmedNotes: number;
};

/**
 * 规则 1：知识必须可回到原始事件校验。文章里「用 transcript 当 ground truth
 * 纠正错误 note」之所以成立，前提是每条 note 都挂得住事实源。
 * 悬空证据 / 已撤回证据 / 重复引用 / 无真人签字却标 confirmed 一律显式抛错。
 */
export function assertGroundedNotes(input: {
  notes: MemoryNote[];
  transcript: TranscriptEvent[];
  invalidatedEventIds?: readonly string[];
}): GroundingReport {
  const byId = new Map(input.transcript.map(event => [event.id, event]));
  const invalidated = new Set(input.invalidatedEventIds ?? []);
  let activeNotes = 0, evidenceRefs = 0, withdrawnNotes = 0, confirmedNotes = 0;
  for (const note of input.notes) {
    if (note.status === 'withdrawn') { withdrawnNotes++; continue; }
    activeNotes++;
    if (note.status === 'confirmed') {
      confirmedNotes++;
      if (!note.confirmedBy) throw new Error(`知识 ${note.id} 标为已确认却没有真人签字：不得自动采用`);
    }
    if (!note.evidenceEventIds.length)
      throw new Error(`知识 ${note.id} 未挂靠原始事件留痕：无法回到 transcript 校验`);
    const seen = new Set<string>();
    for (const id of note.evidenceEventIds) {
      if (seen.has(id)) throw new Error(`知识 ${note.id} 重复引用事件 ${id}`);
      seen.add(id);
      const event = byId.get(id);
      if (!event) throw new Error(`知识 ${note.id} 引用了不存在的事件 ${id}（悬空证据）`);
      if (event.revoked || invalidated.has(id))
        throw new Error(`知识 ${note.id} 引用了已撤回 / 失效的事件 ${id}`);
      evidenceRefs++;
    }
  }
  return { notes: input.notes.length, activeNotes, evidenceRefs, withdrawnNotes, confirmedNotes };
}

/** 规则沉淀：一条规则必须同时带「依据」和「怎么知道它为真」，且只能是候选。 */
export function validatedRule(input: {
  id: string; title: string; statement: string; evidenceEventIds: string[];
  howKnown: string; traps?: string[];
}): MemoryNote {
  if (!input.statement.trim()) throw new Error('规则正文不能为空');
  if (!input.howKnown.trim()) throw new Error('规则必须写明「如何知道它为真」');
  if (!input.evidenceEventIds.length) throw new Error('规则必须挂靠原始事件留痕');
  return {
    id: input.id, title: input.title, statement: input.statement,
    category: 'rule', status: 'candidate',
    evidenceEventIds: [...input.evidenceEventIds], howKnown: input.howKnown,
    traps: [...(input.traps ?? [])],
  };
}

export const REFERENCE_TRAPS = [
  '外部参考只借思想，不复制正文或代码',
  '候选知识必须经真人采用才生效，不得自动确认',
  '不得据此放宽人签红线或启用外部模型调用',
] as const;

/**
 * 规则 5：用户说「我们参考的，其实也可以理解为是一种记忆」。
 * 于是外部材料与本项目产出的知识走同一条候选链，而不是散落在文档里就算沉淀完。
 */
export function referenceAsMemory(input: {
  id: string; title: string; statement: string; sourceUrl: string;
  evidenceEventIds: string[]; howKnown?: string; traps?: string[];
}): MemoryNote {
  if (!/^https?:\/\/\S+$/.test(input.sourceUrl)) throw new Error('参考来源必须是可核对的 http(s) 地址');
  if (!input.statement.trim()) throw new Error('参考结论不能为空');
  if (!input.evidenceEventIds.length) throw new Error('参考必须挂靠阅读 / 对照过程的原始事件留痕');
  return {
    id: input.id, title: input.title, statement: input.statement,
    category: 'reference', status: 'candidate',
    evidenceEventIds: [...input.evidenceEventIds], sourceRefs: [input.sourceUrl],
    howKnown: input.howKnown ?? '外部材料已完整阅读并逐域对照本仓库现状；结论仍须真人采用',
    traps: [...REFERENCE_TRAPS, ...(input.traps ?? [])],
  };
}

/** 把「参考本身是记忆 + 规则」焊死：只能是候选、必须有事实源、必须带红线警告。 */
export function assertReferenceSedimentation(note: MemoryNote): {
  candidate: true; evidenceRefs: number; traps: number;
} {
  if (note.category !== 'reference') throw new Error('参考沉淀的类别必须是 reference');
  if (note.status !== 'candidate') throw new Error('参考沉淀只能是候选，不得直接标为已确认');
  if (note.confirmedBy) throw new Error('参考沉淀不得带真人签字字段：采用是后续独立动作');
  if (!note.evidenceEventIds.length) throw new Error('参考沉淀缺少原始事件留痕');
  if (!note.sourceRefs?.length) throw new Error('参考沉淀缺少可核对的来源地址');
  if (!note.traps?.length) throw new Error('参考沉淀缺少红线 / 陷阱警告');
  return { candidate: true, evidenceRefs: note.evidenceEventIds.length, traps: note.traps.length };
}

// ---------------------------------------------------------------------------
// 表示层（wiki）：文章里最有价值的「组织内知识沉淀」形态，也是最容易失控的形态。
// ---------------------------------------------------------------------------

export type WikiPage = {
  id: string;
  title: string;
  body: string;
  /** 指向其它 page id 的链接，构成 knowledge map。 */
  links: string[];
  /** 本页每条断言能查回的 transcript 事件 id。 */
  claimEventIds?: string[];
};

export type WikiReport = {
  pages: number;
  links: number;
  bytes: number;
  corpusBytes: number;
  danglingLinks: { from: string; to: string }[];
  noLinkPages: string[];
  duplicateTitles: string[];
  ungroundedClaims: { page: string; eventId: string }[];
  /** 知识地图比原始语料还大 —— 文章里「和帝国一样大的地图」失败案例。 */
  bloated: boolean;
};

const byteLength = (value: string) => Buffer.byteLength(value, 'utf8');

/** 只读体检：不修改任何 page，全部问题如实列出。 */
export function wikiReport(input: {
  pages: WikiPage[]; corpusBytes: number; transcript: TranscriptEvent[]; maxRatio?: number;
}): WikiReport {
  const ids = new Set(input.pages.map(page => page.id));
  const eventIds = new Set(input.transcript.map(event => event.id));
  const inbound = new Map<string, number>();
  const titleCount = new Map<string, number>();
  const danglingLinks: WikiReport['danglingLinks'] = [];
  const ungroundedClaims: WikiReport['ungroundedClaims'] = [];
  let links = 0, bytes = 0;
  for (const page of input.pages) {
    bytes += byteLength(page.title + page.body + page.links.join(''));
    links += page.links.length;
    titleCount.set(page.title, (titleCount.get(page.title) ?? 0) + 1);
    for (const to of page.links) {
      if (!ids.has(to)) danglingLinks.push({ from: page.id, to });
      else inbound.set(to, (inbound.get(to) ?? 0) + 1);
    }
    if (byteLength(page.body.trim())) {
      const claims = page.claimEventIds ?? [];
      if (!claims.length) ungroundedClaims.push({ page: page.id, eventId: '(none)' });
      for (const id of claims) if (!eventIds.has(id)) ungroundedClaims.push({ page: page.id, eventId: id });
    }
  }
  const noLinkPages = input.pages
    .filter(page => !page.links.length && !(inbound.get(page.id) ?? 0))
    .map(page => page.id).sort();
  const duplicateTitles = [...titleCount.entries()].filter(([, count]) => count > 1)
    .map(([title]) => title).sort();
  const maxRatio = input.maxRatio ?? 1;
  const bloated = input.corpusBytes > 0 && bytes > input.corpusBytes * maxRatio;
  danglingLinks.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
  return { pages: input.pages.length, links, bytes, corpusBytes: input.corpusBytes,
    danglingLinks, noLinkPages, duplicateTitles, ungroundedClaims, bloated };
}

/** 规则 2：可交付的知识地图必须链接完整、断言有出处、无重复、不膨胀。 */
export function assertWikiRepresentation(report: WikiReport): {
  pages: number; links: number; bytes: number; corpusBytes: number;
} {
  if (report.bloated)
    throw new Error(`知识地图 ${report.bytes} 字节超过原始语料 ${report.corpusBytes} 字节：抽象为零，必须先裁剪`);
  if (report.danglingLinks.length)
    throw new Error(`知识地图有 ${report.danglingLinks.length} 个悬空链接，离线整理须先补齐 / 改指`);
  if (report.noLinkPages.length)
    throw new Error(`知识地图有孤立页面（无出链也无入链）：${report.noLinkPages.join(', ')}`);
  if (report.duplicateTitles.length)
    throw new Error(`知识地图有重复主题页，须先合并：${report.duplicateTitles.join(', ')}`);
  if (report.ungroundedClaims.length)
    throw new Error(`知识地图有 ${report.ungroundedClaims.length} 条断言查不回原始事件，须回到 transcript 核对`);
  return { pages: report.pages, links: report.links, bytes: report.bytes, corpusBytes: report.corpusBytes };
}

// ---------------------------------------------------------------------------
// 注入顶层：文章强调「顶层必须小」，Claude Code 只加载 MEMORY.md 的前 200 行 / 25KB。
// ---------------------------------------------------------------------------

export const INJECTED_MAX_LINES = 200;
export const INJECTED_MAX_BYTES = 25 * 1024;

export type InjectedEntry = { id: string; title: string; pointer: string };
export type InjectedIndex = {
  schemaVersion: 1;
  entries: InjectedEntry[];
  lines: number;
  bytes: number;
  /** 细节一律下移到 note / representation 层，这里只留指针。 */
  detailDemoted: number;
  omitted: number;
};

/**
 * 规则 3：只把「已真人签字 + 挂得住事实源 + 真人批准提升」的条目标题放进顶层，
 * 正文一律下移。第三项是刻意的：Dreaming 只能提出提升建议，不能替人放行。
 */
export function buildInjectedIndex(notes: MemoryNote[], options: {
  maxLines?: number; maxBytes?: number;
} = {}): InjectedIndex {
  const maxLines = options.maxLines ?? INJECTED_MAX_LINES;
  const maxBytes = options.maxBytes ?? INJECTED_MAX_BYTES;
  const eligible = notes
    .filter(note => note.status === 'confirmed' && Boolean(note.confirmedBy)
      && note.evidenceEventIds.length && note.injected === true)
    .sort((a, b) => a.id.localeCompare(b.id));
  const entries: InjectedEntry[] = [];
  let lines = 0, bytes = 0, omitted = 0;
  for (const note of eligible) {
    const entry: InjectedEntry = { id: note.id, title: note.title, pointer: `note:${note.id}` };
    const size = byteLength(JSON.stringify(entry));
    if (lines + 1 > maxLines || bytes + size > maxBytes) { omitted++; continue; }
    entries.push(entry); lines += 1; bytes += size;
  }
  return { schemaVersion: 1, entries, lines, bytes, detailDemoted: eligible.length, omitted };
}

export function assertInjectedIndex(index: InjectedIndex, options: {
  maxLines?: number; maxBytes?: number;
} = {}): { entries: number; bytes: number; lines: number } {
  const maxLines = options.maxLines ?? INJECTED_MAX_LINES;
  const maxBytes = options.maxBytes ?? INJECTED_MAX_BYTES;
  if (index.lines > maxLines || index.bytes > maxBytes)
    throw new Error(`注入顶层超出预算（${index.lines} 行 / ${index.bytes} 字节）：把细节下移并只留指针`);
  for (const entry of index.entries) {
    if (Object.keys(entry).sort().join(',') !== 'id,pointer,title')
      throw new Error(`注入条目 ${entry.id} 混入了正文或额外字段：顶层只能是索引`);
    if (!entry.pointer.startsWith('note:'))
      throw new Error(`注入条目 ${entry.id} 缺少指向下层的指针`);
  }
  return { entries: index.entries.length, bytes: index.bytes, lines: index.lines };
}

// ---------------------------------------------------------------------------
// 离线整理（Dreaming）：文章的六个方向里，能在确定性工程层落地的只有「提建议」。
// ---------------------------------------------------------------------------

export const DREAM_PROPOSAL_KINDS = [
  'correct-note', 'repoint-link', 'merge-duplicate', 'prune-page',
  'demote-injected', 'promote-note', 'fill-gap',
] as const;
export type DreamProposalKind = (typeof DREAM_PROPOSAL_KINDS)[number];

/** 明确禁止出现在离线整理产物里的动作：它们都属于人签 / 主干完整性红线。 */
export const FORBIDDEN_DREAM_KINDS = [
  'confirm-note', 'accept-acceptance', 'delete-event', 'rewrite-transcript',
] as const;

export type DreamProposal = {
  kind: DreamProposalKind;
  target: string;
  reason: string;
  requiresHumanReview: true;
  modelCalls: 0;
};

/**
 * 规则 4：跨 session 回看事实源，产出确定性、只读、待真人复核的整理建议。
 * 不写主干、不改知识状态、不自动采用、不调用模型；同一输入永远同一输出。
 */
export function dreamProposals(input: {
  notes: MemoryNote[];
  pages: WikiPage[];
  transcript: TranscriptEvent[];
  corpusBytes?: number;
  injected?: InjectedIndex;
  maxLines?: number;
  maxBytes?: number;
}): DreamProposal[] {
  const out: DreamProposal[] = [];
  const byId = new Map(input.transcript.map(event => [event.id, event]));
  const propose = (kind: DreamProposalKind, target: string, reason: string) =>
    out.push({ kind, target, reason, requiresHumanReview: true, modelCalls: 0 });

  for (const note of input.notes) {
    if (note.status === 'withdrawn') continue;
    const bad = note.evidenceEventIds.filter(id => !byId.has(id) || byId.get(id)?.revoked);
    if (!note.evidenceEventIds.length || bad.length)
      propose('correct-note', note.id, '回到原始事件校验：证据缺失、悬空或已撤回，须纠正后重新提交候选');
  }

  const wiki = wikiReport({ pages: input.pages, transcript: input.transcript,
    corpusBytes: input.corpusBytes ?? 0 });
  for (const link of wiki.danglingLinks)
    propose('repoint-link', `${link.from}->${link.to}`, '链接指向不存在的主题页，须改指或补齐');
  for (const title of wiki.duplicateTitles)
    propose('merge-duplicate', title, '重复主题页须合并，避免口径分叉');
  if (wiki.bloated)
    propose('prune-page', 'wiki', '知识地图已超过原始语料规模，抽象为零，须裁剪并保留指针');
  for (const page of wiki.noLinkPages)
    propose('fill-gap', page, '孤立页面没有出链也没有入链，须接入索引');

  const injected = input.injected ?? buildInjectedIndex(input.notes,
    { ...(input.maxLines !== undefined ? { maxLines: input.maxLines } : {}),
      ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}) });
  if (injected.omitted > 0 || injected.lines > (input.maxLines ?? INJECTED_MAX_LINES)
      || injected.bytes > (input.maxBytes ?? INJECTED_MAX_BYTES))
    propose('demote-injected', 'injected', '注入顶层超出预算，细节下移，只保留索引与指针');
  else {
    const indexed = new Set(injected.entries.map(entry => entry.id));
    for (const note of input.notes)
      if (note.status === 'confirmed' && note.evidenceEventIds.length && !indexed.has(note.id))
        propose('promote-note', note.id, '已签字且证据完整的条目可提请提升到索引层，仍须真人复核');
  }

  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target));
}

export function assertDreamProposals(proposals: DreamProposal[]): {
  count: number; modelCalls: 0;
} {
  for (const proposal of proposals) {
    if (proposal.requiresHumanReview !== true)
      throw new Error(`离线整理产物 ${proposal.kind} 未标记待真人复核`);
    if (proposal.modelCalls !== 0)
      throw new Error('离线整理不得引入模型调用');
    if ((FORBIDDEN_DREAM_KINDS as readonly string[]).includes(proposal.kind))
      throw new Error(`离线整理产物 ${proposal.kind} 触碰人签 / 主干完整性红线`);
    if (!(DREAM_PROPOSAL_KINDS as readonly string[]).includes(proposal.kind))
      throw new Error(`离线整理产物 ${proposal.kind} 不在允许清单内`);
  }
  return { count: proposals.length, modelCalls: 0 };
}

/** append-only 主干只能追加：离线整理不得回溯改写或截断任何一条历史留痕。 */
export function assertNoTranscriptRewrite(before: TranscriptEvent[], after: TranscriptEvent[]): {
  appended: number;
} {
  if (after.length < before.length) throw new Error('append-only 主干不得截断');
  for (let index = 0; index < before.length; index++)
    if (JSON.stringify(before[index]) !== JSON.stringify(after[index]))
      throw new Error(`第 ${index + 1} 条历史留痕被回溯改写`);
  return { appended: after.length - before.length };
}

/** 只读汇总，供冒烟与控制台核对；不写任何状态。 */
export function memoryHierarchyView(input: {
  notes: MemoryNote[]; pages: WikiPage[]; transcript: TranscriptEvent[];
  corpusBytes: number; injected?: InjectedIndex;
}) {
  const grounding = assertGroundedNotes({ notes: input.notes, transcript: input.transcript });
  const wiki = wikiReport({ pages: input.pages, corpusBytes: input.corpusBytes, transcript: input.transcript });
  const injected = input.injected ?? buildInjectedIndex(input.notes);
  const proposals = dreamProposals({ notes: input.notes, pages: input.pages,
    transcript: input.transcript, corpusBytes: input.corpusBytes, injected });
  return { layers: [...MEMORY_LAYERS], grounding, wiki, injected,
    proposals, modelCalls: 0 as const, deterministic: true as const };
}
