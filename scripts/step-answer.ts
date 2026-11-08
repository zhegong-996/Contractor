/**
 * P-6 / P-9 / P-10 / P-11 · 真人在原会话回答人工问题的 CLI 入口（npm run step:answer）。
 *
 * 用法：COLLAB_HUMAN_ACTOR='发起人' npm run step:answer -- <问题编号> <选项> [备注]
 * 台账：COLLAB_HITL_LEDGER 可指向隔离文件；默认 .runtime/step-hitl/events.jsonl。
 *
 * 本入口做三件事，全部都不等于验收：
 *   1. 把 `human_response` 追加进成对台账（P-6 原有行为）；
 *   2. 把答案桥接成一条**回流建议** `resume_proposal`（P-9，见 collaboration-loop.ts）；
 *   3. P-11 起按用户 2026-11-08 的拍板（AUTO_RESUME_MANDATE）把「续跑闸」排回
 *      同一 run 的步进队列——闸执行时会**重新验证**台账里的成对回答才放行接续步。
 *      仅 step 模式（local-pg 队列）生效；loop 模式本就由 delegate 唤醒下一轮。
 *
 * 红线不变：确认验收 / 核可 / 放行不在这条链上；隐式回答不路由；
 * 执行进程（step:once）没有这个入口。
 */
import { pathToFileURL } from 'node:url';
import { assertHitlRedLines, FileHitlSink, hitlSummary, resolveHitlSink } from '../src/step-hitl.ts';
import { persistHitlAnswer, routeAnswerToHitl } from '../src/hitl-bridge.ts';
import { autoResumeAfterAnswer, AUTO_RESUME_MANDATE } from '../src/auto-resume.ts';
import { loadConfig } from '../src/config.ts';
import { PgStepQueue } from '../src/step-execution.ts';

export async function answerQuestion(argv: string[] = process.argv.slice(2)): Promise<Record<string, unknown>> {
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
  const question = pair.question;

  // P-11：回答落地后自动排续跑闸（仅 step 模式；失败如实上报，不静默吞）。
  // COLLAB_AUTO_RESUME=0 供隔离冒烟关闭此行为，避免真跑配置变化影响隔离口径。
  let autoResume: Record<string, unknown> | null = null;
  const config = loadConfig();
  if (config.execution.mode === 'step' && process.env.COLLAB_AUTO_RESUME !== '0') {
    const queue = PgStepQueue.fromConfig(config);
    try {
      const resumed = await autoResumeAfterAnswer({ routed, question,
        enqueue: (runId, specs) => queue.enqueueReadySteps(runId, specs) });
      autoResume = resumed.ok
        ? { ok: true, runId: resumed.runId, enqueued: resumed.enqueued,
          questionId: resumed.questionId, responseId: resumed.responseId,
          mandate: resumed.mandate,
          note: '续跑闸已排回队列；闸执行时会重新验证台账回答，回答不等于验收' }
        : { ok: false, reason: resumed.reason };
    } catch (error) {
      autoResume = { ok: false, reason: String(error instanceof Error ? error.message : error).slice(0, 200) };
    } finally { await queue.close(); }
  }

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
    autoResume,
    mandate: AUTO_RESUME_MANDATE,
    note: '回答已成对留痕并产出回流建议；step 模式下已按 2026-11-08 授权自动排续跑闸（闸执行时重新验证回答）。回答不等于验收，最终核可仍在原会话',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await answerQuestion(), null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error instanceof Error ? error.message : error) }, null, 2));
    process.exitCode = 1;
  }
}
