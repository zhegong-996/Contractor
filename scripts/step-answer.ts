/**
 * P-6 / P-9 · 真人在原会话回答人工问题的入口（npm run step:answer）。
 *
 * 用法：COLLAB_HUMAN_ACTOR='发起人' npm run step:answer -- <问题编号> <选项> [备注]
 * 台账：COLLAB_HITL_LEDGER 可指向隔离文件；默认 .runtime/step-hitl/events.jsonl。
 *
 * 本入口做两件事，两件都不等于验收：
 *   1. 把 `human_response` 追加进成对台账（P-6 原有行为）；
 *   2. 把答案桥接成一条**回流建议** `resume_proposal`，落到同一隔离目录下的
 *      独立 append-only 台账（P-9 新增，见 src/collaboration-loop.ts）。
 *
 * 回流建议明确 `autoExecute:false / requiresHumanApproval:true / notAcceptance:true`：
 * 它只回答「下一步该由谁、在原会话做什么」，**不会**自动把后续步骤排进队列、
 * 不会修改任务状态、不会自行放行 human-gate。最终「确认验收 任务编号」仍由
 * 原发起人在原会话完成。执行进程（step:once）没有这个入口。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtime } from '../src/config.ts';
import {
  answerHuman, assertHitlRedLines, foldHitl, resolveHitlSink, hitlSummary,
} from '../src/step-hitl.ts';
import { bridgeAnswerToResume, assertResumeProposal } from '../src/collaboration-loop.ts';

/** 回流建议与 HITL 台账同目录，隔离真跑不会污染 .runtime。 */
export function resumeProposalFile(): string {
  const custom = process.env.COLLAB_HITL_LEDGER;
  return custom
    ? path.join(path.dirname(path.resolve(custom)), 'resume-proposals.jsonl')
    : runtime('step-hitl', 'resume-proposals.jsonl');
}

export function answerQuestion(argv: string[] = process.argv.slice(2)): Record<string, unknown> {
  const [questionId, choice, note] = argv;
  const actor = String(process.env.COLLAB_HUMAN_ACTOR ?? '').trim();
  if (!questionId || !choice) throw new Error('用法：step:answer <问题编号> <选项> [备注]');
  if (!actor) throw new Error('必须设置 COLLAB_HUMAN_ACTOR 为真人身份：执行进程不得冒充真人回答');
  const sink = resolveHitlSink();
  const events = sink.read();
  const question = events.find(event => event.id === questionId && event.type === 'human_question');
  if (!question) throw new Error(`台账里找不到问题编号 ${questionId}`);
  if (actor === String(question.payload.asker ?? ''))
    throw new Error('回答人不得等于提问者本人身份，避免执行进程冒充真人');
  const projection = foldHitl(events);
  const existing = projection.pairs.find(pair => pair.question.id === questionId);
  if (existing?.response) throw new Error('这个问题已经有回答，历史不得回溯改写');
  const response = answerHuman({ question, choice, actor, note });
  sink.append(response);
  const after = assertHitlRedLines(sink.read());
  const pair = after.pairs.find(item => item.question.id === questionId)!;

  // P-9：答案不再「送回提问者就消失」，而是产出一条可持久化的回流建议。
  const proposal = assertResumeProposal(bridgeAnswerToResume({
    question, response: { id: response.id, actor, payload: response.payload },
    at: Date.now(),
  }));
  let proposalPersisted = false;
  let proposalError: string | null = null;
  try {
    const file = resumeProposalFile();
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    appendFileSync(file, JSON.stringify(proposal) + '\n', { mode: 0o600 });
    proposalPersisted = true;
  } catch (error) {
    proposalError = String(error instanceof Error ? error.message : error).slice(0, 200);
  }

  return {
    ok: true,
    questionId,
    choice,
    actor,
    responseId: response.id,
    paired: Boolean(pair.response),
    pending: after.pending.length,
    summary: hitlSummary(sink.read()),
    resumeProposal: proposal,
    proposalPersisted,
    ...(proposalError ? { proposalError } : {}),
    note: '回答已成对留痕并产出回流建议；建议只标明「原发起人在原会话接续」，不排后续步骤、不修改任务状态、更不等于验收',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(answerQuestion(), null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error instanceof Error ? error.message : error) }, null, 2));
    process.exitCode = 1;
  }
}
