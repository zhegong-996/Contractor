/**
 * 第二十九轮 P-11 · 「回答后自动排后续步骤」的一等契约与授权留痕。
 *
 * 用户 2026-11-08 18:05（WorkBuddy 会话）明确拍板：
 *   「① 我回答问题后，系统自动干没问题的」
 * 这改变的是产品决策（此前回流建议恒 advisory、不排步骤），不改变的红线：
 *   - 回答仍然不是验收：确认验收 / 核可 / 放行不在这条链上，仍走原会话；
 *   - 隐式回答仍然不路由：没有问题编号就无法唯一确定指向，宁可不猜；
 *   - 续跑闸执行时必须**重新验证**成对台账里的回答，不在入队时盲信入参；
 *   - 授权事实本身入库（AUTO_RESUME_MANDATE 逐字保留用户原话），审计可回溯。
 *
 * 设计：回答落地（persistHitlAnswer）后，向同一 run 的步进队列追加一道
 * 「续跑闸」（仍是 human-gate 种类、带 resumeOf 指向问题编号）。任何执行进程
 * 领到这道闸时，从台账重新核对 human_response 存在且 acceptance !== true，
 * 才把问题声明的接续工作步（resume_next）排回队列。验证失败就重新提问，
 * 绝不带着未验证的入参往下走。
 */
import { foldHitl, type HitlEvent, type HitlSink } from './step-hitl.ts';
import type { HitlRoutingOk } from './hitl-bridge.ts';
import type { StepSpec } from './step-execution.ts';

/** 用户授权的逐字记录；引用它的一切自动续跑都能追溯到这次拍板。 */
export const AUTO_RESUME_MANDATE = {
  authorizedBy: '原发起人（WorkBuddy 会话）',
  authorizedAt: '2026-11-08T18:05:03+08:00',
  instruction: '我回答问题后，系统自动干没问题的',
  scope: '仅限人工问题的「回答 → 自动排后续步骤」；不含验收、核可、放行、授权；隐式回答不路由',
  notAcceptance: true,
} as const;

export const AUTO_RESUME_RED_LINES = [
  '回答不是验收：确认验收 / 核可 / 放行仍只在原会话，不进这条链',
  '续跑闸执行时必须重新验证成对台账里的回答，入队的入参不作数',
  '授权事实逐字入库（AUTO_RESUME_MANDATE），每次自动续跑都可回溯到用户拍板',
] as const;

export type AutoResumeInput = {
  /** 已经成功路由并持久化的回答（hitl-bridge 的 HitlRoutingOk）。 */
  routed: HitlRoutingOk;
  /** 提问事件本身（routed.response.payload.question_id 指向它）。 */
  question: HitlEvent;
  /** 入队函数：注入 PgStepQueue / InMemoryStepQueue 的 enqueueSteps。 */
  enqueue: (runId: string, specs: StepSpec[]) => Promise<{ runId: string; enqueued: number; ready: number }>;
  /** 接续工作步；缺省取提问 payload 里声明的 resume_next；都没有则闸通过后自然收敛。 */
  nextSpec?: StepSpec | null;
  /** 覆盖授权记录（测试用）；生产恒用 AUTO_RESUME_MANDATE。 */
  mandate?: typeof AUTO_RESUME_MANDATE;
};

export type AutoResumeOk = {
  ok: true;
  runId: string;
  questionId: string;
  responseId: string;
  choice: string;
  /** 排回队列的续跑闸（kind=human-gate，payload.resumeOf 指向问题编号）。 */
  resumeStep: StepSpec;
  /** 闸通过后要接续的工作步；null 表示闸通过后 run 自然收敛。 */
  nextStep: StepSpec | null;
  mandate: typeof AUTO_RESUME_MANDATE;
};

export type AutoResumeRefused = { ok: false; reason: string };
export type AutoResumeResult = AutoResumeOk | AutoResumeRefused;

/** 纯函数：构造续跑闸。不读文件、不写队列；enqueue 由调用方注入。 */
export function planAutoResume(input: AutoResumeInput): AutoResumeResult {
  const mandate = input.mandate ?? AUTO_RESUME_MANDATE;
  const question = input.question;
  const response = input.routed.response;
  if (question.type !== 'human_question')
    return { ok: false, reason: '自动续跑只能挂在人工提问上' };
  if (String(response.payload?.question_id ?? '') !== question.id)
    return { ok: false, reason: '回答与提问不成对，拒绝续跑' };
  if (response.payload?.acceptance === true
    || /确认验收|accepted|approved/i.test(String(response.payload?.choice ?? '')))
    return { ok: false, reason: '回答疑似核可语义，不进自动续跑；验收只在原会话' };
  const runId = String(question.payload?.run_id ?? '');
  if (!runId) return { ok: false, reason: '提问缺少 run 编号，无法把续跑闸排回队列' };
  const nextStep: StepSpec | null = input.nextSpec
    ?? (question.payload?.resume_next && typeof question.payload.resume_next === 'object'
      ? question.payload.resume_next as StepSpec
      : null);
  const resumeStep: StepSpec = { kind: 'human-gate', payload: {
    question: String(question.payload?.prompt ?? '这一步需要真人确认后才能继续'),
    choices: Array.isArray(question.payload?.choices) ? question.payload!.choices : ['继续', '暂停'],
    resumeOf: question.id,
    responseId: response.id,
    choice: String(response.payload?.choice ?? ''),
    via: String(response.payload?.via ?? 'cli'),
    mandate: { ...mandate },
    ...(nextStep ? { resume_next: nextStep } : {}),
  } };
  return { ok: true, runId, questionId: question.id, responseId: response.id,
    choice: String(response.payload?.choice ?? ''), resumeStep, nextStep, mandate };
}

/** 带副作用的一步：构造闸并把它排进队列；失败如实上报，不静默吞。 */
export async function autoResumeAfterAnswer(input: AutoResumeInput)
  : Promise<AutoResumeOk & { enqueued: number; ready: number } | AutoResumeRefused> {
  const plan = planAutoResume(input);
  if (!plan.ok) return plan;
  const outcome = await input.enqueue(plan.runId, [plan.resumeStep]);
  return { ...plan, enqueued: outcome.enqueued, ready: outcome.ready };
}

/**
 * 续跑闸的执行期验证：从台账重新核对回答（执行进程不得盲信入队时的入参）。
 * 返回通过与否与接续步；不通过时调用方应重新提问而不是硬闯。
 */
export function verifyResumeGate(input: {
  sink: HitlSink;
  resumeOf: string;
  expectResponseId?: string;
}): { ok: true; response: HitlEvent } | { ok: false; reason: string } {
  const projection = foldHitl(input.sink.read());
  const pair = projection.pairs.find(p => p.question.id === input.resumeOf);
  if (!pair) return { ok: false, reason: `台账里找不到问题编号 ${input.resumeOf}` };
  if (!pair.response) return { ok: false, reason: `问题 ${input.resumeOf} 尚无成对回答，续跑闸不放行` };
  if (input.expectResponseId && pair.response.id !== input.expectResponseId)
    return { ok: false, reason: '台账里的回答与续跑闸声明的回答不一致，重新验证后再放行' };
  if (pair.response.payload?.acceptance === true
    || /确认验收|accepted|approved/i.test(String(pair.response.payload?.choice ?? '')))
    return { ok: false, reason: '回答疑似核可语义；验收只在原会话，续跑闸不放行' };
  return { ok: true, response: pair.response };
}
