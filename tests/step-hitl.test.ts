// P-6 契约：HITL 成对留痕（协议语义移植自 Runner，TS 重写）。
// 红线：执行进程只提问不放行；回答不等于验收；台账不并入 B1 主干。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  askHuman, answerHuman, foldHitl, assertHitlRedLines, hitlSummary,
  MemoryHitlSink, FileHitlSink, HitlRefusal, HITL_RED_LINES, type HitlEvent,
} from '../src/step-hitl.ts';
import { InMemoryStepQueue, executeOneStep } from '../src/step-execution.ts';
import { stepRunnerHandlers } from '../src/step-runner.ts';

const AT = '2026-11-08T03:30:00.000Z';
const ask = (patch: Partial<Parameters<typeof askHuman>[0]> = {}) => askHuman({
  runId: 'run-1', stepNo: 3, asker: 'worker-a', prompt: '评审要求改动，继续还是暂停？',
  choices: ['继续', '暂停'], triggeredBy: 'signal-77', at: AT, ...patch,
});

test('P-6 问题编号就是提问事件自己的 id，因果放 payload 不放 envelope', () => {
  const question = ask();
  assert.equal(question.type, 'human_question');
  assert.equal(question.from, 'router');
  assert.equal(question.id.startsWith('hq-'), true);
  assert.equal(question.payload.triggered_by, 'signal-77');
  assert.equal(question.payload.run_id, 'run-1');
  assert.equal(question.payload.step_no, 3);
  assert.equal('triggered_by' in (question as any) || 'question_id' in (question as any), false,
    '信封层不得放因果');
  assert.equal(HITL_RED_LINES.length, 4);
});

test('P-6 回答按 question_id 关联，明确标注不是验收', () => {
  const question = ask();
  const response = answerHuman({ question, choice: '继续', actor: '发起人', note: '等迁移落地', at: AT });
  assert.equal(response.type, 'human_response');
  assert.equal(response.from, 'human');
  assert.equal(response.to, 'worker-a');
  assert.equal(response.payload.question_id, question.id);
  assert.equal(response.payload.choice, '继续');
  assert.equal(response.payload.acceptance, false);
});

test('P-6 空问题、少于两个选项、缺身份、越界选项一律拒绝', () => {
  assert.throws(() => ask({ prompt: '  ' }), /不能为空/);
  assert.throws(() => ask({ choices: ['只有一个'] }), /两个可选项/);
  assert.throws(() => ask({ asker: '' }), /任务编号与提问者/);
  assert.throws(() => answerHuman({ question: ask(), choice: '直接通过', actor: '发起人' }), /选项不在/);
  assert.throws(() => answerHuman({ question: ask(), choice: '继续', actor: '' }), /真人身份/);
  const bogus = { ...ask(), type: 'human_response' } as unknown as HitlEvent;
  assert.throws(() => answerHuman({ question: bogus, choice: '继续', actor: '发起人' }), /人工提问事件/);
});

test('P-6 折叠投影给出配对、待回答、孤儿回答与重复回答', () => {
  const q1 = ask();
  const q2 = ask({ prompt: '第二个问题', at: '2026-11-08T03:31:00.000Z' });
  const r1 = answerHuman({ question: q1, choice: '继续', actor: '发起人', at: AT });
  const orphan = answerHuman({ question: ask({ prompt: '不存在的问题', at: AT }),
    choice: '继续', actor: '发起人', at: AT });
  const orphanWithBadId: HitlEvent = { ...orphan, payload: { ...orphan.payload, question_id: 'hq-missing' } };
  const duplicate = { ...r1, id: 'hq-dup' };
  const projection = foldHitl([q1, q2, r1, orphanWithBadId, duplicate]);
  assert.equal(projection.questions.length, 2);
  assert.equal(projection.pairs.length, 2);
  assert.equal(projection.pairs[0]!.response?.id, r1.id);
  assert.equal(projection.pending.length, 1);
  assert.equal(projection.orphanResponses.length, 1);
  assert.equal(projection.duplicateAnswers.length, 1);
});

test('P-6 红线：冒充验收、孤儿回答、重复回答、坏行全部阻断', () => {
  const question = ask();
  const accepted: HitlEvent = { ...answerHuman({ question, choice: '继续', actor: '发起人', at: AT }),
    payload: { question_id: question.id, choice: '确认验收', acceptance: true } };
  assert.throws(() => assertHitlRedLines([question, accepted]), /不得冒充/);
  const orphan: HitlEvent = { ...answerHuman({ question, choice: '继续', actor: '发起人', at: AT }),
    payload: { question_id: 'hq-nope', choice: '继续', acceptance: false } };
  assert.throws(() => assertHitlRedLines([question, orphan]), /没有对应提问/);
  const response = answerHuman({ question, choice: '继续', actor: '发起人', at: AT });
  assert.throws(() => assertHitlRedLines([question, response, { ...response, id: 'hq-again' }]), /重复回答/);
  assert.throws(() => assertHitlRedLines([{ id: '', type: 'nope' } as unknown as HitlEvent]), /坏行/);
});

test('P-6 确定性摘要两次逐字节一致，坏行如实计数', () => {
  const question = ask();
  const events = [question, answerHuman({ question, choice: '暂停', actor: '发起人', at: AT })];
  const first = hitlSummary(events);
  const second = hitlSummary([...events]);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.questions, 1);
  assert.equal(first.paired, 1);
  assert.equal(first.pending, 0);
  assert.equal(hitlSummary([{ id: '', type: 'bad' } as unknown as HitlEvent]).errors, 1);
});

test('P-6 台账是 append-only：内存与文件两种 sink 都不改写历史', () => {
  const memory = new MemoryHitlSink();
  const question = ask();
  memory.append(question);
  assert.equal(memory.read().length, 1);
  const dir = mkdtempSync(path.join(tmpdir(), 'collab-hitl-'));
  try {
    const file = path.join(dir, 'events.jsonl');
    const sink = new FileHitlSink(file);
    sink.append(question);
    sink.append(answerHuman({ question, choice: '继续', actor: '发起人', at: AT }));
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    assert.equal(sink.read()[0]!.id, question.id);
    assert.equal(assertHitlRedLines(sink.read()).pairs.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P-6 执行进程只提问不放行：失败但留下问题编号，回答后成对闭环', async () => {
  const sink = new MemoryHitlSink();
  const queue = new InMemoryStepQueue(() => 0);
  await queue.enqueueSteps('hitl-run', [{ kind: 'human-gate',
    payload: { question: '评审要求改动，继续还是暂停？', choices: ['继续', '暂停'], triggeredBy: 'signal-77' } }]);
  const result = await executeOneStep({ queue, handlers: stepRunnerHandlers(),
    workerId: 'w', principal: 'worker-a', environment: '本机执行环境', hitl: sink, maxAttempts: 1 });
  assert.equal(result.failed, true);
  assert.match(result.reason ?? '', /原会话/);
  assert.ok(result.hitlQuestionId, '拒绝也要给出成对证据的起点');
  assert.match(result.reason ?? '', new RegExp(result.hitlQuestionId!));
  const events = sink.read();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, 'human_question');
  assert.equal(events[0]!.payload.triggered_by, 'signal-77');
  const response = answerHuman({ question: events[0]!, choice: '继续', actor: '发起人', at: AT });
  sink.append(response);
  const projection = assertHitlRedLines(sink.read());
  assert.equal(projection.pairs.length, 1);
  assert.equal(projection.pending.length, 0);
  assert.equal(projection.pairs[0]!.response?.payload.question_id, result.hitlQuestionId);
  assert.equal((await queue.runState('hitl-run'))[0]!.status, 'failed', '执行进程不得自行放行');
});

test('P-6 不注入台账时无持久化证据，拒绝结果仍是原有结构', async () => {
  const queue = new InMemoryStepQueue(() => 0);
  await queue.enqueueSteps('hitl-legacy', [{ kind: 'human-gate' }]);
  const result = await executeOneStep({ queue, handlers: stepRunnerHandlers(),
    workerId: 'w', principal: 'worker-a', environment: '本机执行环境', maxAttempts: 1 });
  assert.equal(result.failed, true);
  assert.match(result.reason ?? '', /原会话/);
  assert.equal(result.hitlQuestionId, undefined);
  assert.equal((await queue.runState('hitl-legacy'))[0]!.status, 'failed');
});

test('P-6 HitlRefusal 携带结构化问题，错误文案不丢红线', () => {
  const question = ask();
  const refusal = new HitlRefusal(question);
  assert.equal(refusal.question.id, question.id);
  assert.match(refusal.message, /原会话/);
  assert.match(refusal.message, /不得自行放行/);
});
