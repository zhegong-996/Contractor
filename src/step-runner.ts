// 生产项 P-1 · 一次进程只跑一步的真实入口（npm run step:once [runId]）。
//
// 它证明「每一步（一次模型或工具调用）拆成一次单独调用」不是纸面契约：
// 进程启动 → 从状态外置队列领一步（带 runToken）→ 按当前主体重评权限 →
// 跑一次工具 → 结果与会话快照连同下一棒在同一完成动作里写回 → 进程退出。
// 下一棒可以由另一台机器上的另一个进程领走，会话状态不留在旧进程里。
//
// 没有外部模型端点时，model-call 步明确拒绝，绝不编造模型调用；human-gate
// 只由执行进程提出一条带编号的人工问题并留痕，回答由真人在原会话用
// `npm run step:answer` 完成，独立执行进程不得自行放行。
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.ts';
import { PgStepQueue, executeOneStep, type StepHandler } from './step-execution.ts';
import { askHuman, HitlRefusal, resolveHitlSink, type HitlSink } from './step-hitl.ts';
import { verifyResumeGate } from './auto-resume.ts';

/** 本机允许的工具白名单；未登记的工具一律拒绝，不静默执行。 */
export const STEP_RUNNER_TOOLS = ['sha256'] as const;

export function stepRunnerHandlers(hitl: HitlSink = resolveHitlSink()): Record<string, StepHandler> {
  return {
    'tool-call': (step, ctx) => {
      const tool = String(step.payload?.tool ?? '');
      if (!(STEP_RUNNER_TOOLS as readonly string[]).includes(tool))
        throw new Error(`工具 ${tool || '未指定'} 不在本机工具白名单内`);
      const input = String(step.payload?.input ?? '');
      if (!input) throw new Error('工具调用缺少输入内容，拒绝执行空步骤');
      const digest = createHash('sha256').update(input).digest('hex');
      const counter = Number(ctx.previousCheckpoint.counter ?? 0) + 1;
      const remaining = Math.max(0, Number(step.payload?.remaining ?? 0));
      return {
        result: { tool, digest, counter,
          previousEnvironment: ctx.previousCheckpoint.lastEnvironment ?? null },
        checkpoint: { counter, lastTool: tool, lastEnvironment: ctx.environment },
        ...(remaining > 0 ? { next: { kind: 'tool-call',
          payload: { tool, input, remaining: remaining - 1 } } } : {}),
        modelCalls: 0,
      };
    },
    'model-call': () => { throw new Error('未配置外部模型端点与凭据：本机不编造模型调用'); },
    // P-6：执行进程仍不得自行放行，但不再「只拒绝、无证据」——先生成一条
    // `human_question`（id 即问题编号、因果放 payload），由 executeOneStep
    // 落到注入的成对台账；真人回答走 npm run step:answer，不在这个进程里发生。
    // P-11：回答落地后按用户授权自动排回的「续跑闸」也走这个 handler——
    // 带 resumeOf 的闸在执行期重新验证台账里的成对回答，通过才放行接续步。
    'human-gate': (step, ctx) => {
      const resumeOf = typeof step.payload?.resumeOf === 'string' ? step.payload.resumeOf : null;
      if (resumeOf) {
        const verified = verifyResumeGate({ sink: hitl, resumeOf,
          expectResponseId: typeof step.payload?.responseId === 'string' ? step.payload.responseId : undefined });
        if (!verified.ok) {
          // 不硬闯：重新提问（新的问题编号），让回答链路重新成对。
          const reask = askHuman({ runId: ctx.runId, stepNo: step.stepNo,
            asker: ctx.principal || 'step-runner',
            prompt: `自动续跑验证未通过（${verified.reason}），需要真人重新确认`,
            choices: ['继续', '暂停'],
            triggeredBy: resumeOf });
          throw new HitlRefusal(reask);
        }
        const nextSpec = step.payload?.resume_next && typeof step.payload.resume_next === 'object'
          ? step.payload.resume_next as { kind: string; payload?: Record<string, unknown> }
          : undefined;
        return {
          result: { gate: 'passed', questionId: resumeOf, responseId: verified.response.id,
            choice: String(verified.response.payload?.choice ?? ''),
            via: String(verified.response.payload?.via ?? ''),
            mandate: step.payload?.mandate ?? null,
            notAcceptance: true },
          checkpoint: { ...ctx.previousCheckpoint, gatePassed: resumeOf,
            gateChoice: String(verified.response.payload?.choice ?? '') },
          ...(nextSpec ? { next: nextSpec } : {}),
          modelCalls: 0,
        };
      }
      const prompt = String(step.payload?.question ?? '').trim() || '这一步需要真人确认后才能继续';
      const declared = Array.isArray(step.payload?.choices) ? step.payload!.choices as unknown[] : [];
      const choices = declared.length >= 2 ? declared.map(String) : ['继续', '暂停'];
      const question = askHuman({ runId: ctx.runId, stepNo: step.stepNo,
        asker: ctx.principal || 'step-runner', prompt, choices,
        triggeredBy: typeof step.payload?.triggeredBy === 'string' ? String(step.payload.triggeredBy) : null,
        // 闸通过后要接续的工作步随问题留痕；自动续跑从这里取回。
        resumeNext: step.payload?.next && typeof step.payload.next === 'object'
          ? step.payload.next as Record<string, unknown> : null });
      throw new HitlRefusal(question);
    },
    'worker-tick': () => { throw new Error('worker.tick 只能由宿主入口的单步泵执行，独立进程不得伪造'); },
  };
}

export async function runSingleStep(argv: string[] = process.argv.slice(2)): Promise<Record<string, unknown>> {
  const config = loadConfig();
  if (config.execution.mode !== 'step') {
    return { ok: true, claimed: false, mode: 'loop',
      note: '当前仍是默认常驻循环；把 config.execution.mode 设为 step 且 host.provider 设为 local-pg 后，本入口才领步' };
  }
  const runId = argv[0] || process.env.COLLAB_STEP_RUN_ID || null;
  const principal = process.env.COLLAB_STEP_PRINCIPAL || '';
  const scope = process.env.COLLAB_STEP_SCOPE || null;
  const workerId = process.env.COLLAB_STEP_WORKER || 'step-once-' + process.pid;
  const environment = process.env.COLLAB_STEP_ENVIRONMENT || '本机执行环境';
  const queue = PgStepQueue.fromConfig(config);
  try {
    const result = await executeOneStep({ queue, handlers: stepRunnerHandlers(),
      workerId, principal, environment, scope, ...(runId ? { runId } : {}),
      maxAttempts: 1, hitl: resolveHitlSink() });
    return { ...result, mode: 'step', queue: queue.id() };
  } finally {
    await queue.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleStep().then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.failed) process.exitCode = 1;
  }).catch(error => {
    console.log(JSON.stringify({ ok: false, error: String(error instanceof Error ? error.message : error) }, null, 2));
    process.exitCode = 1;
  });
}
