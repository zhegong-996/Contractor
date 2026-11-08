/**
 * P-6 · 真人在原会话回答人工问题的入口（npm run step:answer）。
 *
 * 用法：COLLAB_HUMAN_ACTOR='发起人' npm run step:answer -- <问题编号> <选项> [备注]
 * 台账：COLLAB_HITL_LEDGER 可指向隔离文件；默认 .runtime/step-hitl/events.jsonl。
 *
 * 这个入口只把 `human_response` 追加进成对台账，**不会**自动把后续步骤排进
 * 队列、不会修改任务状态、更不等于验收。是否继续、以及最终「确认验收 任务编号」
 * 仍由原发起人在原会话决定。执行进程（step:once）没有这个入口。
 */
import { pathToFileURL } from 'node:url';
import {
  answerHuman, assertHitlRedLines, foldHitl, resolveHitlSink, hitlSummary,
} from '../src/step-hitl.ts';

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
  return {
    ok: true,
    questionId,
    choice,
    actor,
    responseId: response.id,
    paired: Boolean(pair.response),
    pending: after.pending.length,
    summary: hitlSummary(sink.read()),
    note: '这只是把答案送回提问者，不排后续步骤、不修改任务状态；最终核可仍由原发起人在原会话用中文确认验收',
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
