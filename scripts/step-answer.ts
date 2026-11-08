/**
 * P-6 / P-9 / P-10 · 真人在原会话回答人工问题的 CLI 入口（npm run step:answer）。
 *
 * 用法：COLLAB_HUMAN_ACTOR='发起人' npm run step:answer -- <问题编号> <选项> [备注]
 * 台账：COLLAB_HITL_LEDGER 可指向隔离文件；默认 .runtime/step-hitl/events.jsonl。
 *
 * 本入口做两件事，两件都不等于验收：
 *   1. 把 `human_response` 追加进成对台账（P-6 原有行为）；
 *   2. 把答案桥接成一条**回流建议** `resume_proposal`，落到同一隔离目录下的
 *      独立 append-only 台账（P-9 新增，见 src/collaboration-loop.ts）。
 *
 * 第二十八轮起判据与持久化收敛到 `src/hitl-bridge.ts`，与飞书 IM 入站
 * （collaboration-intake.ts）共用同一份校验口径；本文件只剩 CLI 装配。
 *
 * 回流建议明确 `autoExecute:false / requiresHumanApproval:true / notAcceptance:true`：
 * 它只回答「下一步该由谁、在原会话做什么」，**不会**自动把后续步骤排进队列、
 * 不会修改任务状态、不会自行放行 human-gate。最终「确认验收 任务编号」仍由
 * 原发起人在原会话完成。执行进程（step:once）没有这个入口。
 */
import { pathToFileURL } from 'node:url';
import { assertHitlRedLines, FileHitlSink, hitlSummary, resolveHitlSink } from '../src/step-hitl.ts';
import { persistHitlAnswer, routeAnswerToHitl } from '../src/hitl-bridge.ts';

export function answerQuestion(argv: string[] = process.argv.slice(2)): Record<string, unknown> {
  const [questionId, choice, note] = argv;
  const actor = String(process.env.COLLAB_HUMAN_ACTOR ?? '').trim();
  if (!questionId || !choice) throw new Error('用法：step:answer <问题编号> <选项> [备注]');
  if (!actor) throw new Error('必须设置 COLLAB_HUMAN_ACTOR 为真人身份：执行进程不得冒充真人回答');
  const sink = resolveHitlSink();
  // 坏行如实报数：台账损坏不能被静默吞掉（第二十八轮修复）。
  const health = sink instanceof FileHitlSink
    ? sink.readWithHealth() : { events: sink.read(), badLines: 0 };
  const events = health.events;
  const routed = routeAnswerToHitl({
    inbound: { accepted: true, questionId, choice },
    actor, events, at: Date.now(), via: 'cli', note,
  });
  if (!routed.ok) throw new Error(routed.reason);
  const persisted = persistHitlAnswer(routed, sink);
  const after = assertHitlRedLines(sink.read());
  const pair = after.pairs.find(item => item.question.id === questionId)!;

  return {
    ok: true,
    questionId,
    choice,
    actor,
    responseId: routed.response.id,
    paired: Boolean(pair.response),
    pending: after.pending.length,
    ledgerBadLines: health.badLines,
    summary: hitlSummary(sink.read()),
    resumeProposal: routed.proposal,
    proposalPersisted: persisted.proposalPersisted,
    ...(persisted.proposalError ? { proposalError: persisted.proposalError } : {}),
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
