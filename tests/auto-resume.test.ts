// 第二十九轮 P-11 契约：回答后自动排后续步骤（用户 2026-11-08 18:05 拍板）。
//
// 覆盖：授权事实入库、续跑闸构造与入队、执行期重新验证（不盲信入参）、
// 核可语义拒收、无回答不放行、接续步取回、隔离开关。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planAutoResume, verifyResumeGate, autoResumeAfterAnswer,
  AUTO_RESUME_MANDATE, AUTO_RESUME_RED_LINES,
} from '../src/auto-resume.ts';
import {
  MemoryHitlSink, askHuman, answerHuman, HitlRefusal, foldHitl,
} from '../src/step-hitl.ts';
import { routeAnswerToHitl } from '../src/hitl-bridge.ts';
import { InMemoryStepQueue, executeOneStep } from '../src/step-execution.ts';
import { stepRunnerHandlers } from '../src/step-runner.ts';

const question = askHuman({ runId: 'RUN-P11', stepNo: 1, asker: 'step-runner',
  prompt: '发布窗口选哪个？', choices: ['周五低峰发布', '立即发布'],
  resumeNext: { kind: 'tool-call', payload: { tool: 'sha256', input: '发布清单', remaining: 0 } } });

function routedWith(sink: MemoryHitlSink) {
  sink.append(question);
  const routed = routeAnswerToHitl({
    inbound: { accepted: true, questionId: question.id, choice: '周五低峰发布' },
    actor: 'ou_owner', events: sink.read(), at: Date.parse('2026-11-08T10:30:00.000Z'), via: 'feishu-im',
  });
  assert.equal(routed.ok, true);
  return routed as Extract<typeof routed, { ok: true }>;
}

test('P-11 授权事实逐字入库： mandate 保留用户原话与边界', () => {
  assert.equal(AUTO_RESUME_MANDATE.instruction, '我回答问题后，系统自动干没问题的');
  assert.equal(AUTO_RESUME_MANDATE.notAcceptance, true);
  assert.match(AUTO_RESUME_MANDATE.scope, /不含验收、核可、放行/);
  assert.equal(AUTO_RESUME_RED_LINES.length, 3);
});

test('P-11 回答落地后自动排续跑闸：带 mandate、resumeOf 指向问题编号、接续步取回', async () => {
  const sink = new MemoryHitlSink();
  const routed = routedWith(sink);
  sink.append(routed.response);
  const queue = new InMemoryStepQueue();
  const resumed = await autoResumeAfterAnswer({ routed, question,
    enqueue: (runId, specs) => queue.enqueueReadySteps(runId, specs) });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.runId, 'RUN-P11');
  assert.equal(resumed.questionId, question.id);
  assert.equal(resumed.responseId, routed.response.id);
  assert.equal(resumed.resumeStep.kind, 'human-gate');
  const gatePayload = resumed.resumeStep.payload as Record<string, any>;
  assert.equal(gatePayload.resumeOf, question.id);
  assert.equal(gatePayload.mandate.instruction, AUTO_RESUME_MANDATE.instruction);
  assert.deepEqual(resumed.nextStep, { kind: 'tool-call',
    payload: { tool: 'sha256', input: '发布清单', remaining: 0 } });
  // 队列里真的多了一道 ready 的续跑闸。
  const states = await queue.runState('RUN-P11');
  assert.equal(states.length, 1);
  assert.equal(states[0]!.status, 'ready');
  assert.equal(states[0]!.kind, 'human-gate');
});

test('P-11 续跑闸执行期重新验证台账：回答在才放行，并把接续步排回队列', async () => {
  const sink = new MemoryHitlSink();
  const routed = routedWith(sink);
  sink.append(routed.response);
  const queue = new InMemoryStepQueue();
  const resumed = await autoResumeAfterAnswer({ routed, question,
    enqueue: (runId, specs) => queue.enqueueReadySteps(runId, specs) });
  assert.equal(resumed.ok, true);
  const handlers = stepRunnerHandlers(sink);
  const outcome = await executeOneStep({ queue, handlers, workerId: 'resume-worker',
    principal: 'step-runner', environment: '本机执行环境', runId: 'RUN-P11', maxAttempts: 1 });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.failed, false);
  // 闸通过后接续步已激活。
  const states = await queue.runState('RUN-P11');
  assert.equal(states[0]!.status, 'done');
  assert.equal((states[0]!.result as any).gate, 'passed');
  assert.equal((states[0]!.result as any).notAcceptance, true);
  assert.equal(states[1]!.kind, 'tool-call');
  assert.equal(states[1]!.status, 'ready');
});

test('P-11 台账里没有回答时，续跑闸不放行而是重新提问', async () => {
  const sink = new MemoryHitlSink(); // 只有问题，没有回答
  sink.append(question);
  const queue = new InMemoryStepQueue();
  await queue.enqueueSteps('RUN-P11', [{ kind: 'human-gate', payload: {
    question: '发布窗口选哪个？', choices: ['周五低峰发布', '立即发布'],
    resumeOf: question.id, responseId: 'hr-missing', mandate: { ...AUTO_RESUME_MANDATE },
    resume_next: { kind: 'tool-call', payload: { tool: 'sha256', input: '发布清单', remaining: 0 } } } }]);
  const handlers = stepRunnerHandlers(sink);
  const outcome = await executeOneStep({ queue, handlers, workerId: 'resume-worker',
    principal: 'step-runner', environment: '本机执行环境', runId: 'RUN-P11', hitl: sink, maxAttempts: 1 });
  assert.equal(outcome.failed, true);
  assert.match(outcome.reason ?? '', /不得自行放行|重新确认/);
  // 重新提问落进台账（成对链路重新开始），而不是硬闯。
  const asked = sink.read().filter(e => e.type === 'human_question');
  assert.equal(asked.length, 2);
  assert.notEqual(asked[1]!.id, question.id);
  assert.equal((asked[1]!.payload as any).triggered_by, question.id);
});

test('P-11 核可语义的回答进不了自动续跑', () => {
  const sink = new MemoryHitlSink();
  sink.append(question);
  const acceptQuestion = { ...question, payload: { ...question.payload,
    choices: ['确认验收 RUN-P11', '暂停'] } };
  // answerHuman / bridgeAnswerToResume 侧就拒收核可选项：路由入口直接抛错。
  assert.throws(() => routeAnswerToHitl({
    inbound: { accepted: true, questionId: question.id, choice: '确认验收 RUN-P11' },
    actor: 'ou_owner', events: [acceptQuestion as any], at: 5, via: 'cli',
  }), /确认验收|验收/);
  const forged = planAutoResume({
    routed: { ok: true, response: { id: 'hr-x', kind: 'signal', type: 'human_response',
      from: 'human', to: 'step-runner', at: '2026-11-08T10:31:00.000Z',
      payload: { question_id: question.id, choice: '确认验收 RUN-P11', acceptance: false } },
      proposal: {} as any, pending: 0 } as any,
    question, enqueue: async () => ({ runId: 'RUN-P11', enqueued: 1, ready: 1 }) });
  assert.equal(forged.ok, false);
  assert.match((forged as { reason: string }).reason, /核可|验收/);
});

test('P-11 verifyResumeGate 单独校验：responseId 不一致时拒绝', () => {
  const sink = new MemoryHitlSink();
  const routed = routedWith(sink);
  sink.append(routed.response);
  const ok = verifyResumeGate({ sink, resumeOf: question.id,
    expectResponseId: routed.response.id });
  assert.equal(ok.ok, true);
  const mismatch = verifyResumeGate({ sink, resumeOf: question.id, expectResponseId: 'hr-other' });
  assert.equal(mismatch.ok, false);
  const missing = verifyResumeGate({ sink, resumeOf: 'hq-not-exist' });
  assert.equal(missing.ok, false);
});

test('P-11 无 resume_next 的闸通过后 run 自然收敛（不虚构接续步）', async () => {
  const bare = askHuman({ runId: 'RUN-P11-BARE', stepNo: 1, asker: 'step-runner',
    prompt: '确认继续吗？', choices: ['继续', '暂停'] });
  const sink = new MemoryHitlSink();
  sink.append(bare);
  const routed = routeAnswerToHitl({ inbound: { accepted: true, questionId: bare.id, choice: '继续' },
    actor: 'ou_owner', events: sink.read(), at: 6, via: 'cli' });
  assert.equal(routed.ok, true);
  if (!routed.ok) return;
  sink.append(routed.response);
  const plan = planAutoResume({ routed, question: bare,
    enqueue: async () => ({ runId: 'RUN-P11-BARE', enqueued: 1, ready: 1 }) });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.nextStep, null);
  assert.equal('resume_next' in (plan.resumeStep.payload ?? {}), false);
});

test('P-11 成对链路完整走一遍：提问 → 回答 → 续跑闸 → 闸通过，台账无核可', async () => {
  const sink = new MemoryHitlSink();
  const queue = new InMemoryStepQueue();
  // 1. 原始闸：执行进程提问（HitlRefusal）。
  await queue.enqueueSteps('RUN-E2E', [{ kind: 'human-gate', payload: {
    question: '用哪个数据源？', choices: ['A 源', 'B 源'],
    next: { kind: 'tool-call', payload: { tool: 'sha256', input: '数据源确认', remaining: 0 } } } }]);
  const handlers = stepRunnerHandlers(sink);
  const gate = await executeOneStep({ queue, handlers, workerId: 'w1',
    principal: 'step-runner', environment: '本机执行环境', runId: 'RUN-E2E', hitl: sink, maxAttempts: 1 });
  assert.equal(gate.failed, true);
  assert.ok(gate.hitlQuestionId);
  const asked = sink.read().find(e => e.id === gate.hitlQuestionId)!;
  assert.deepEqual((asked.payload as any).resume_next,
    { kind: 'tool-call', payload: { tool: 'sha256', input: '数据源确认', remaining: 0 } });
  // 2. 真人回答（显式编号）。
  const routed = routeAnswerToHitl({ inbound: { accepted: true,
    questionId: gate.hitlQuestionId!, choice: 'A 源' },
    actor: 'ou_owner', events: sink.read(), at: 7, via: 'feishu-im' });
  assert.equal(routed.ok, true);
  if (!routed.ok) return;
  sink.append(routed.response);
  // 3. 自动续跑排闸。
  const resumed = await autoResumeAfterAnswer({ routed, question: asked,
    enqueue: (runId, specs) => queue.enqueueReadySteps(runId, specs) });
  assert.equal(resumed.ok, true);
  // 4. 闸执行期验证台账并放行接续步。
  const resume = await executeOneStep({ queue, handlers, workerId: 'w2',
    principal: 'step-runner', environment: '本机执行环境', runId: 'RUN-E2E' });
  assert.equal(resume.ok, true);
  const states = await queue.runState('RUN-E2E');
  const kinds = states.map(s => [s.kind, s.status]);
  assert.deepEqual(kinds, [['human-gate', 'failed'], ['human-gate', 'done'], ['tool-call', 'ready']]);
  // 5. 台账健康：一问一答成对（续跑闸验证通过、没有重新提问）、无核可尝试。
  const projection = foldHitl(sink.read());
  assert.equal(projection.pairs.filter(p => p.response).length, 1);
  assert.equal(projection.pending.length, 0);
  assert.equal(projection.acceptanceAttempts.length, 0);
});
