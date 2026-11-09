// 13a ②③（第 13 条写入链改造）：知识表示层（wiki）与注入索引的落盘位置与分工。
//
// 落盘决策（本轮落地）：
//   * wiki 是**投影**，不是第二事实源：canonical 知识仍在 Paperclip 任务文档
//     （`knowledge-*` documents）。投影文件（`.runtime/memory/wiki-pages.json`）
//     可随时从 canonical 重建，损坏 / 删除不丢数据，不参与重放契约。
//   * 注入索引（InjectedIndex）是**持久的小指针层**（≤200 行 / 25KB），只收录
//     「confirmed + 人签 + 挂得住证据 + 人审批准提升（injected=true）」的条目
//     标题与指针，正文一律下移。
//   * 与 192,000 字节一次性 Context Pack（`TaskContext.collect`）的分工：
//     索引回答「组织当前确认了哪些知识」（常驻、可核对），Pack 回答「本任务
//     这一轮实际读什么」（运行时一次性组装、有预算、逐条 selectionReason）。
//     collect 只携带索引指针，不携带索引条目正文，不挤占 Pack 预算。
//
// 红线不变：模型不判 salience、不自动提升、不自动确认、不改写主干。
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { runtime } from './config.ts';
import type { Knowledge, KnowledgeService } from './knowledge.ts';
import { readBridgedEvents } from './memory-log.ts';
import type { MemoryEvent } from './architecture-contracts.ts';
import {
  buildInjectedIndex, wikiReport, type InjectedIndex, type TranscriptEvent, type WikiPage, type WikiReport,
} from './memory-hierarchy.ts';

export type KnowledgeRecordLike = Pick<Knowledge, 'key' | 'title' | 'domains' | 'appliesTo' | 'body' | 'state'
  | 'evidenceEventIds'> & { sourceTaskId: string; confirmedBy?: string; injected?: boolean };

export const wikiProjectionFile = (dir?: string) => path.join(dir ?? runtime('memory'), 'wiki-pages.json');
export const injectedIndexFile = (dir?: string) => path.join(dir ?? runtime('memory'), 'injected-index.json');

const pageId = (record: { sourceTaskId: string; key: string }) => `${record.sourceTaskId}/${record.key}`;

/**
 * 纯函数：从 canonical 知识记录派生 wiki 页投影。每条非 withdrawn 记录一页，
 * 同业务域的页面互链（只链真实存在的页，不产生悬空链接），每页断言挂靠
 * 该记录的 evidenceEventIds。 withdrawn 的记录不进知识地图（撤回不是物理删除，
 * 主干里仍有完整痕迹）。
 */
export function knowledgeToWikiPages(records: KnowledgeRecordLike[]): WikiPage[] {
  const active = records.filter(record => record.state !== 'withdrawn');
  const ids = new Set(active.map(pageId));
  return active.map(record => {
    const id = pageId(record);
    const own = new Set(record.domains);
    const links = [...new Set(active.filter(other => other !== record
      && other.domains.some((domain: string) => own.has(domain)))
      .map(pageId))]
      .filter(link => ids.has(link) && link !== id)
      .sort();
    return { id, title: record.title, links,
      // 正文是派生摘要：适用范围 + 关键断言指针，不超过原始记录（防膨胀）。
      body: `${record.appliesTo}\n[来源条目] ${record.key}（任务 ${record.sourceTaskId}）`,
      claimEventIds: [...record.evidenceEventIds] };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/** MemoryEvent → TranscriptEvent（只读映射；revoked 类事件按 kind 如实标注）。 */
export function toTranscriptEvents(events: MemoryEvent[]): TranscriptEvent[] {
  return events.map(event => ({
    id: event.id, at: event.at, kind: event.kind,
    revoked: ['source-revoked', 'grant-revoked', 'edge-invalidated'].includes(event.kind) || undefined,
  }));
}

/**
 * 13a ③：注入索引只收「confirmed + 人签 + 有证据 + 人审批准提升」的条目。
 * 构建纯函数复用 memory-hierarchy 的 buildInjectedIndex（预算、条目形状、
 * detailDemoted 口径全部一致，不造第二套判据）。
 */
export function buildKnowledgeInjectedIndex(records: KnowledgeRecordLike[]): InjectedIndex {
  const notes = records.map(record => ({
    id: pageId(record), title: record.title, statement: record.appliesTo,
    category: 'fact' as const, status: record.state,
    evidenceEventIds: record.evidenceEventIds ?? [],
    ...(record.confirmedBy ? { confirmedBy: record.confirmedBy } : {}),
    ...(record.injected === true ? { injected: true as const } : {}),
  }));
  return buildInjectedIndex(notes as any[]);
}

export function writeWikiProjection(pages: WikiPage[], file = wikiProjectionFile()): string {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, generatedFrom: 'canonical knowledge documents', pages }, null, 2), { mode: 0o600 });
  return file;
}
export function readWikiProjection(file = wikiProjectionFile()): { schemaVersion: 1; pages: WikiPage[] } {
  if (!existsSync(file)) return { schemaVersion: 1, pages: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return { schemaVersion: 1, pages: Array.isArray(parsed?.pages) ? parsed.pages : [] };
}

export function writeInjectedIndex(index: InjectedIndex, file = injectedIndexFile()): string {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ ...index, note: '持久指针层：只收人审批准提升的已确认知识标题；正文下移，运行时由 Context Pack 按任务组装' }, null, 2), { mode: 0o600 });
  return file;
}
export function readInjectedIndex(file = injectedIndexFile()): (InjectedIndex & { note?: string }) | null {
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return { schemaVersion: 1, entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
    lines: Number(parsed?.lines ?? 0), bytes: Number(parsed?.bytes ?? 0),
    detailDemoted: Number(parsed?.detailDemoted ?? 0), omitted: Number(parsed?.omitted ?? 0) };
}

export type KnowledgeWikiView = {
  modelCalls: 0;
  wiki: WikiReport;
  injected: InjectedIndex;
  pages: WikiPage[];
  records: number;
  /** knowledge-* 前缀下非结构化文档（如引用文件）的跳过数：如实报出，不静默吞。 */
  skippedDocuments: number;
  transcriptEvents: number;
  corpusBytes: number;
  wikiProjectionFile: string;
  injectedIndexFile: string;
  note: string;
};

/**
 * 只读体检 + 投影落盘：读 canonical 知识文档（宽松列举，坏行如实跳过计数），
 * 派生 wiki 投影与注入索引，用共享记忆主干做证据体检，并把两份投影写盘
 * （可重建的缓存，不是事实源）。不改任何 canonical 记录、不拦截业务、不替代人审。
 *
 * 第四十一轮：支持传入 `readable` 按读方权限过滤。过滤后的视角**不写盘**——
 * 共享投影必须是按 canonical 全量生成的可重建缓存，不能把某个人的可读范围
 * 变成全组织的索引。这一点用 `filtered` 明确返回，处理方据此决定是否落盘。
 */
export async function knowledgeWikiView(knowledge: KnowledgeService,
  options: { readable?: (record: Record<string, unknown>) => boolean } = {}
): Promise<KnowledgeWikiView & { filtered: boolean; hiddenByPermission: number }> {
  const { records, skipped } = await knowledge.listLenient();
  const all = records.map(entry => entry.value);
  const visible = options.readable ? all.filter(record => options.readable!(record as unknown as Record<string, unknown>)) : all;
  const filtered = visible.length !== all.length;
  return {
    ...knowledgeWikiViewFrom(visible, undefined, skipped),
    filtered,
    hiddenByPermission: all.length - visible.length,
  };
}

/** 纯计算部分单列，测试与冒烟不碰 Paperclip 也能跑同一份判据。 */
export function knowledgeWikiViewFrom(records: KnowledgeRecordLike[], events?: MemoryEvent[],
  skippedDocuments = 0): KnowledgeWikiView {
  const pages = knowledgeToWikiPages(records);
  const transcript = toTranscriptEvents(events ?? readBridgedEvents().events);
  const corpusBytes = records.reduce((n, record) => n + Buffer.byteLength(record.body, 'utf8'), 0);
  const wiki = wikiReport({ pages, transcript, corpusBytes });
  const injected = buildKnowledgeInjectedIndex(records);
  return { modelCalls: 0, wiki, injected, pages, records: records.length, skippedDocuments,
    transcriptEvents: transcript.length, corpusBytes,
    wikiProjectionFile: wikiProjectionFile(), injectedIndexFile: injectedIndexFile(),
    note: '知识地图与注入索引都是 canonical 知识文档的投影（可重建，不是第二事实源）；体检只读不改，缺口如实报出，提升只能走人审确认' };
}
