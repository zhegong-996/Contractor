// 13a ④（第 13 条写入链改造）：把离线整理（Dreaming）建议接进 C-6 候选改进闸门。
//
// 链路：真实知识文档 + 共享记忆主干 → dreamProposals()（确定性纯函数，复用
// memory-hierarchy，不引入第二套判据）→ 每条建议登记为 C-6 候选改进
// （improvement-proposed）→ 工程闸门（gate）→ 真人批准（review）→ 灰度生效
// （rollout），全走既有治理台账，不新开一条「绕开人审」的通道。
//
// 红线不变：
//   * Dreaming 只提建议（恒 requiresHumanReview），绝不改主干 / 知识状态 /
//     注入索引；
//   * 「promote-note 提升到注入索引」被批准后，执行仍是人审确认动作
//     （knowledge.review 的 inject），不是 Dreaming 直接改字段；
//   * FORBIDDEN_DREAM_KINDS（confirm-note / accept-acceptance / delete-event /
//     rewrite-transcript）由 assertDreamProposals 焊死，登记前先断言。
import { dreamProposals, assertDreamProposals, type DreamProposal, type MemoryNote, type WikiPage } from './memory-hierarchy.ts';
import { knowledgeToWikiPages, toTranscriptEvents, type KnowledgeRecordLike } from './knowledge-representation.ts';
import type { MemoryEvent } from './architecture-contracts.ts';
import { candidateId } from './evolution-ledger.ts';

export const DREAM_KIND_TITLES: Record<DreamProposal['kind'], string> = {
  'correct-note': '纠正知识证据挂靠',
  'repoint-link': '修正知识地图链接',
  'merge-duplicate': '合并重复主题页',
  'prune-page': '裁剪膨胀的知识地图',
  'demote-injected': '注入索引瘦身（细节下移）',
  'promote-note': '提请提升知识到注入索引',
  'fill-gap': '补齐知识地图孤立页',
};

/** canonical 知识记录 → 体检用 MemoryNote（只读映射，不回写）。 */
export function knowledgeToMemoryNotes(records: KnowledgeRecordLike[]): MemoryNote[] {
  return records.map(record => ({
    id: `${record.sourceTaskId}/${record.key}`,
    title: record.title,
    statement: record.appliesTo,
    category: 'fact' as const,
    status: record.state,
    evidenceEventIds: [...(record.evidenceEventIds ?? [])],
    ...(record.state === 'confirmed' && record.confirmedBy ? { confirmedBy: record.confirmedBy } : {}),
  }));
}

/** 真实数据 → Dreaming 建议（确定性：同一输入永远同一输出，modelCalls 恒 0）。 */
export function dreamFromKnowledge(records: KnowledgeRecordLike[], events: MemoryEvent[]): DreamProposal[] {
  const notes = knowledgeToMemoryNotes(records);
  const pages: WikiPage[] = knowledgeToWikiPages(records);
  const transcript = toTranscriptEvents(events);
  const corpusBytes = records.reduce((n, record) => n + Buffer.byteLength(record.body, 'utf8'), 0);
  return dreamProposals({ notes, pages, transcript, corpusBytes });
}

export type DreamRegistration = {
  proposals: DreamProposal[];
  registered: { id: string; title: string }[];
  skippedDuplicates: number;
  modelCalls: 0;
};

/**
 * 登记进 C-6 台账的薄封装：先 assertDreamProposals（红线焊死），再按
 * candidateId 查重——重复跑离线整理不会在台账里堆重复候选（append-only
 * 主干不回溯改写，查重发生在登记之前）。propose 回调由调用方绑定到
 * EvolutionService.propose（sourceTaskId='dreaming'），本模块不依赖具体服务类。
 */
export function registerDreamProposals(
  propose: (input: { id: string; title: string; reason: string }) => void,
  existingCandidateIds: readonly string[],
  proposals: DreamProposal[],
): DreamRegistration {
  assertDreamProposals(proposals);
  const known = new Set(existingCandidateIds);
  const registered: { id: string; title: string }[] = [];
  let skippedDuplicates = 0;
  for (const proposal of proposals) {
    // candidateId 必须按「建议类型 + 对象」唯一：同一类型的建议（如多条
    // promote-note）reason 相同，缺了对象会互相撞号被误判重复。
    const uniqueReason = `${proposal.reason}（对象：${proposal.target}）`;
    const id = candidateId('dreaming', 0, uniqueReason);
    if (known.has(id)) { skippedDuplicates++; continue; }
    const title = `【离线整理】${DREAM_KIND_TITLES[proposal.kind]}：${proposal.target}`;
    propose({ id, title, reason: uniqueReason });
    known.add(id);
    registered.push({ id, title });
  }
  return { proposals, registered, skippedDuplicates, modelCalls: 0 };
}
