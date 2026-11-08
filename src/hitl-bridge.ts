/**
 * 第二十八轮 · 把「人回答人工问题」从本机 CLI 单入口扩成 CLI + 飞书 IM 双入口。
 *
 * 背景（docs/REFERENCE-capability-comparison.md 第 3 节差距 #3 / 第 7 节）：
 * P-6 的成对 HITL 台账只有 `npm run step:answer` 一个本机入口，「飞书回答写入
 * 该台账的通道未接通」是登记在案的真实功能缺陷。本轮按用户「完整修复功能缺陷、
 * 参考其他几个开源项目」的指示接通，参考对象：
 *   - Runner（MIT @ a42d1331，protocolReferences）：`human_response` 把答案送回提问者；
 *   - OpenMausBot（Apache-2.0 @ 3f81576，conceptReferences）：question 卡片的人侧回写；
 *   - Autoloop（已入库上游）：`ask` 卡片 + `answerers` 身份核验的思想。
 *
 * 红线（不因接通放宽，见 HANDOFF/07）：
 *   1. 回答 ≠ 验收：只留痕 + 产出 advisory 回流建议；「确认验收 / 核可 / 放行」
 *      不在这条链上（第二十九轮 P-11 起 step 模式允许自动排**续跑闸**——闸执行
 *      时重新验证台账回答，见 src/auto-resume.ts 的 AUTO_RESUME_MANDATE）；
 *   2. 只有显式格式「回答 <问题编号> <选项>」才路由进台账——隐式一句话无法唯一
 *      确定指向哪个问题，宁可少路由也不猜；
 *   3. 回答人必须是已通过 IM 绑定校验的真人（调用方在 ingest 里已验），且不得是
 *      提问者本人（answerHuman 内置拒绝）；
 *   4. 同一问题只允许一次回答（append-only，不回溯改写）；
 *   5. 「确认验收」类文本永远进不了台账（mapFollowupToAnswer 已拒收）。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { runtime } from './config.ts';
import {
  answerHuman, foldHitl, type HitlEvent, type HitlSink, resolveHitlSink,
} from './step-hitl.ts';
import { bridgeAnswerToResume, assertResumeProposal, type ResumeProposal } from './collaboration-loop.ts';

/** 回流建议与 HITL 台账同目录，隔离真跑不会污染 .runtime。 */
export function resumeProposalFile(): string {
  const custom = process.env.COLLAB_HITL_LEDGER;
  return custom
    ? path.join(path.dirname(path.resolve(custom)), 'resume-proposals.jsonl')
    : runtime('step-hitl', 'resume-proposals.jsonl');
}

export type HitlRoutingOk = {
  ok: true;
  response: HitlEvent;
  proposal: ResumeProposal;
  /** 回答落账后仍待真人回答的问题数。 */
  pending: number;
};

export type HitlRoutingRefused = { ok: false; reason: string };

export type HitlRoutingResult = HitlRoutingOk | HitlRoutingRefused;

/**
 * 纯函数路由：把一条已通过 `mapFollowupToAnswer` 归一化的入站消息路由进成对台账。
 * 不读文件、不写文件、不取当前时间（at 由调用方注入），失败给出明确 reason。
 * CLI（scripts/step-answer.ts）与飞书入站（collaboration-intake.ts）共用这一份判据，
 * 保证两条入口的校验口径逐字节一致。
 */
export function routeAnswerToHitl(input: {
  /** mapFollowupToAnswer 的返回值；questionId 为 null 表示隐式回答，不路由。 */
  inbound: { accepted: boolean; questionId: string | null; choice: string | null };
  actor: string;
  /** 当前台账全部事件（append-only，读快照）。 */
  events: readonly HitlEvent[];
  at: number;
  via?: string;
  note?: string;
}): HitlRoutingResult {
  const { inbound, actor, events } = input;
  if (!inbound.accepted) return { ok: false, reason: '入站消息不是有效回答（空文本 / 指令 / 核可短语）' };
  if (!inbound.questionId)
    return { ok: false, reason: '隐式回答不路由：没有问题编号就无法唯一确定指向，宁可不猜' };
  if (!String(actor ?? '').trim())
    return { ok: false, reason: '回答必须登记真人身份，执行进程不得冒充' };
  const question = events.find(event =>
    event?.type === 'human_question' && event.id === inbound.questionId);
  if (!question) return { ok: false, reason: `台账里找不到问题编号 ${inbound.questionId}` };
  if (String(actor).trim() === String(question.payload?.asker ?? ''))
    return { ok: false, reason: '回答人不得等于提问者本人身份，避免执行进程冒充真人' };
  const projection = foldHitl(events);
  const existing = projection.pairs.find(pair => pair.question.id === inbound.questionId);
  if (existing?.response) return { ok: false, reason: '这个问题已经有回答，历史不得回溯改写' };
  let response: HitlEvent;
  try {
    response = answerHuman({
      question, choice: String(inbound.choice ?? ''), actor,
      note: input.note, via: input.via,
      at: new Date(input.at).toISOString(),
    });
  } catch (error) {
    return { ok: false, reason: String(error instanceof Error ? error.message : error) };
  }
  const proposal = (() => {
    try {
      return assertResumeProposal(bridgeAnswerToResume({
        question, response: { id: response.id, actor, payload: response.payload },
        at: input.at,
      }));
    } catch (error) {
      throw new Error(String(error instanceof Error ? error.message : error));
    }
  })();
  const after = foldHitl([...events, response]);
  return { ok: true, response, proposal, pending: after.pending.length };
}

export type PersistResult = {
  proposalFile: string;
  proposalPersisted: boolean;
  proposalError?: string;
};

/** 持久化路由结果：回答进台账、回流建议进独立 append-only 文件。失败如实上报。 */
export function persistHitlAnswer(routed: HitlRoutingOk,
  sink: HitlSink = resolveHitlSink()): PersistResult {
  sink.append(routed.response);
  const file = resumeProposalFile();
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    appendFileSync(file, JSON.stringify(routed.proposal) + '\n', { mode: 0o600 });
    return { proposalFile: file, proposalPersisted: true };
  } catch (error) {
    return { proposalFile: file, proposalPersisted: false,
      proposalError: String(error instanceof Error ? error.message : error).slice(0, 200) };
  }
}
