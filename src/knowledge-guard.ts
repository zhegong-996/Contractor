// P-8 补缺：把 P-7 的记忆分层守门从「只跑在合成数据上」接到真实数据。
//
// 背景：第二十五轮交付的 src/memory-hierarchy.ts 只有自己的冒烟脚本引用，
// 生产链路一次都没调用过。本模块补上这个接缝，但刻意选择**只读 advisory**：
//   * 不改 KnowledgeService.propose 的签名、不做既有文档迁移、不改任何写入链；
//   * 不因体检结果拦截交付、不改任务状态、不改授权、不替代人签；
//   * 真实 Knowledge 记录目前没有 evidenceEventIds，因此体检**必然如实报缺口**，
//     绝不把「有缺口」包装成「已通过」，也绝不为了跑绿而给记录编造事件 id。
//
// 与 Trace / 记忆主干写入一致：advisory 结果失败不影响业务结果。
// 待拍板项仍见 HANDOFF/08 第 13 条（写入链改造、wiki 落盘、注入索引分工）。
import { createHash } from 'node:crypto';
import type { MemoryEvent } from './architecture-contracts.ts';
import {
  assertGroundedNotes, wikiReport, buildInjectedIndex, assertInjectedIndex,
  INJECTED_MAX_BYTES, INJECTED_MAX_LINES,
  type MemoryNote, type TranscriptEvent, type WikiPage,
} from './memory-hierarchy.ts';

/** 真实 Knowledge 文档里与本体检相关的字段（其余字段一律不读、不入库）。 */
export type KnowledgeRecordLike = {
  key: string;
  title: string;
  state: 'candidate' | 'confirmed' | 'withdrawn';
  confirmedBy?: string;
  /** 第 13 条待拍板后才能由 propose 写入；当前真实记录缺省。 */
  evidenceEventIds?: string[];
  sourceRefs?: string[];
  body?: string;
  /** 真人批准提升到注入顶层；缺省 false，守门不会替人放行。 */
  injected?: boolean;
};

export type GuardFinding = {
  code: 'missing-evidence' | 'dangling-evidence' | 'revoked-evidence' | 'unsigned-confirmation'
    | 'duplicate-evidence' | 'wiki-dangling-link' | 'wiki-no-link' | 'wiki-ungrounded'
    | 'wiki-bloated' | 'injected-over-budget' | 'injected-mixed-body';
  severity: 'gap' | 'warning';
  target: string;
  message: string;
};

export type KnowledgeGuardReport = {
  schemaVersion: 1;
  /** 只读建议：调用方不得据此拦截交付、改状态或放宽人签。 */
  advisory: true;
  blocking: false;
  modelCalls: 0;
  knowledgeRecords: number;
  activeRecords: number;
  transcriptEvents: number;
  groundedRecords: number;
  gapRecords: number;
  injectedEligible: number;
  injectedBytes: number;
  injectedLines: number;
  /** 顶层预算装不下、被截断下移的候选条数；如实报出，不静默吞掉。 */
  injectedOmitted: number;
  /** 记录索引字段的稳定摘要（不含正文），保证输入变化即变签名。 */
  recordFingerprint: string;
  wiki: { pages: number; links: number; bytes: number; corpusBytes: number; bloated: boolean };
  findings: GuardFinding[];
  /** 如实说明哪些能力还没接入生产链，避免把「守门可跑」误读成「已接管」。 */
  unwired: string[];
  signature: string;
};

const REVOKED_KINDS = new Set(['source-revoked', 'grant-revoked', 'edge-invalidated']);

/** 把 append-only 真实事件流归一化成守门需要的 transcript；不修改事件。 */
export function collectTranscript(events: MemoryEvent[]): TranscriptEvent[] {
  return events.map(event => ({
    id: event.id, at: event.at, kind: event.kind,
    ...(REVOKED_KINDS.has(event.kind) ? { revoked: true } : {}),
  }));
}

/** 真实记录 → MemoryNote；缺 evidenceEventIds 时如实留空，让守门报出缺口。 */
export function toMemoryNotes(records: KnowledgeRecordLike[]): MemoryNote[] {
  return records.map(record => ({
    id: record.key, title: record.title,
    statement: record.body ?? '', category: 'fact' as const,
    status: record.state,
    evidenceEventIds: [...(record.evidenceEventIds ?? [])],
    ...(record.confirmedBy ? { confirmedBy: record.confirmedBy } : {}),
    ...(record.sourceRefs ? { sourceRefs: [...record.sourceRefs] } : {}),
    ...(record.injected === true ? { injected: true } : {}),
  }));
}

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

/**
 * 只读体检：逐条跑 P-7 的挂靠校验，把异常转成 finding 而不是让整个体检失败。
 * 同一输入永远同一输出（不取当前时间、不读环境、不调模型）。
 */
export function guardKnowledge(input: {
  records: KnowledgeRecordLike[];
  transcript: TranscriptEvent[];
  pages?: WikiPage[];
  corpusBytes?: number;
  maxLines?: number;
  maxBytes?: number;
}): KnowledgeGuardReport {
  const notes = toMemoryNotes(input.records);
  const transcript = input.transcript;
  const findings: GuardFinding[] = [];
  let groundedRecords = 0;

  for (const note of notes) {
    if (note.status === 'withdrawn') continue;
    try {
      assertGroundedNotes({ notes: [note], transcript });
      groundedRecords++;
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      const code: GuardFinding['code'] = /未挂靠/.test(message) ? 'missing-evidence'
        : /悬空/.test(message) ? 'dangling-evidence'
          : /撤回/.test(message) ? 'revoked-evidence'
            : /不得自动采用|真人签字/.test(message) ? 'unsigned-confirmation'
              : 'duplicate-evidence';
      findings.push({ code, severity: 'gap', target: note.id, message });
    }
  }

  const pages = input.pages ?? [];
  const wiki = wikiReport({ pages, transcript, corpusBytes: input.corpusBytes ?? 0 });
  for (const link of wiki.danglingLinks)
    findings.push({ code: 'wiki-dangling-link', severity: 'gap', target: `${link.from}->${link.to}`,
      message: '知识地图链接指向不存在的主题页' });
  for (const page of wiki.noLinkPages)
    findings.push({ code: 'wiki-no-link', severity: 'warning', target: page,
      message: '孤立页面没有出链也没有入链' });
  for (const claim of wiki.ungroundedClaims)
    findings.push({ code: 'wiki-ungrounded', severity: 'gap', target: claim.page,
      message: `断言查不回原始事件 ${claim.eventId}` });
  if (wiki.bloated)
    findings.push({ code: 'wiki-bloated', severity: 'gap', target: 'wiki',
      message: `知识地图 ${wiki.bytes} 字节超过原始语料 ${wiki.corpusBytes} 字节` });

  const injected = buildInjectedIndex(notes, {
    ...(input.maxLines !== undefined ? { maxLines: input.maxLines } : {}),
    ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
  });
  const maxLines = input.maxLines ?? INJECTED_MAX_LINES;
  const maxBytes = input.maxBytes ?? INJECTED_MAX_BYTES;
  try { assertInjectedIndex(injected, { maxLines, maxBytes }); }
  catch (error) {
    findings.push({ code: 'injected-over-budget', severity: 'gap', target: 'injected',
      message: String(error instanceof Error ? error.message : error) });
  }
  // 截断本身说明顶层装不下全部候选：必须报出来，否则「跑绿」只是把内容丢了。
  if (injected.omitted > 0)
    findings.push({ code: 'injected-over-budget', severity: 'warning', target: 'injected',
      message: `${injected.omitted} 条已批准提升的候选超出顶层预算，被截断下移；须人审裁剪或扩容` });

  // 注入层只允许索引与指针：任何记录正文被塞进顶层都要报出来。
  if (injected.entries.some(entry => Object.keys(entry).some(key => !['id', 'title', 'pointer'].includes(key))))
    findings.push({ code: 'injected-mixed-body', severity: 'gap', target: 'injected',
      message: '注入顶层混入了条目录正文' });

  const unwired = [
    'KnowledgeService.propose 尚未写入 evidenceEventIds：真实知识记录无法回到原始事件校验',
    '知识表示层（wiki）落盘位置未定，当前体检只检查调用方传入的页面',
    '注入索引尚未与 192,000 字节一次性 Context Pack 明确分工',
    '离线整理建议尚未接入 C-6 候选改进闸门，仍只产出待真人复核的建议',
  ];

  const activeRecords = notes.filter(note => note.status !== 'withdrawn').length;
  const recordFingerprint = digest(notes.map(note => ({
    id: note.id, title: note.title, status: note.status,
    evidenceEventIds: note.evidenceEventIds, sourceRefs: note.sourceRefs ?? [],
    confirmedBy: note.confirmedBy ?? '', injected: note.injected ?? false,
  })));
  const core = {
    knowledgeRecords: notes.length, activeRecords, transcriptEvents: transcript.length,
    groundedRecords, gapRecords: activeRecords - groundedRecords,
    injectedEligible: injected.detailDemoted, injectedBytes: injected.bytes,
    injectedLines: injected.lines, injectedOmitted: injected.omitted, recordFingerprint,
    wiki: { pages: wiki.pages, links: wiki.links, bytes: wiki.bytes,
      corpusBytes: wiki.corpusBytes, bloated: wiki.bloated },
    findings, unwired,
  };
  return { schemaVersion: 1, advisory: true, blocking: false, modelCalls: 0,
    ...core, signature: digest(core) };
}

/** 只读接线辅助：确认报告绝不携带业务正文、身份或密钥字段。 */
export function assertGuardIsAdvisory(report: KnowledgeGuardReport): {
  advisory: true; blocking: false;
} {
  if (report.advisory !== true || report.blocking !== false || report.modelCalls !== 0)
    throw new Error('守门体检必须是只读 advisory，不得拦截业务或引入模型调用');
  const serialized = JSON.stringify(report);
  if (serialized.includes('open_id') || /Bearer [A-Za-z0-9]/.test(serialized))
    throw new Error('守门体检不得携带真实身份或凭据');
  return { advisory: true, blocking: false };
}
