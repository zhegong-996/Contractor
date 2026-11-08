/**
 * P-9 常态契约：每次 npm test 都核对「双向回路」真的接在执行链上，
 * 而不是只在真跑脚本里一次性检查。全部是静态 / 纯函数断言，零 IO、零模型。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  loopReport, bridgeAnswerToResume, assertResumeProposal, fromHitlLedger,
  mapFollowupToAnswer, type LoopEvent,
} from '../src/collaboration-loop.ts';

const source = (relative: string) => readFileSync(new URL('../' + relative, import.meta.url), 'utf8');

test('P-9 只读 action loop-guard 同步三处白名单，且无网页写入入口', () => {
  assert.match(source('src/server.ts'), /action==='loop-guard'/);
  assert.match(source('src/members.ts'), /'loop-guard'/);
  assert.match(source('scripts/console-server.ts'), /'loop-guard'/);
  const server = source('src/server.ts');
  const branch = server.slice(server.indexOf("action==='loop-guard'"), server.indexOf("action==='routing-status'"));
  assert.match(branch, /advisory:true/);
  assert.match(branch, /blocking:false/);
  assert.doesNotMatch(branch, /store\.save\(|insert\(|UPDATE |DELETE /);
});

test('P-9 三个执行链节点确实调用归一化函数（不是孤岛模块）', () => {
  const controller = source('src/controller.ts');
  const intake = source('src/collaboration-intake.ts');
  const answer = source('scripts/step-answer.ts');
  assert.match(controller, /fromAutoloopReceipt\(/);
  assert.match(controller, /loop\.upstream/);
  assert.match(controller, /loop\.downstream/);
  assert.match(controller, /mapFollowupToAnswer\(/);
  assert.match(controller, /resultFrom\(/); // 上游 Autoloop worker/contract.ts 的运行时复用
  assert.match(intake, /mapFollowupToAnswer\(/);
  assert.match(intake, /loop\.downstream/);
  assert.match(intake, /delegate\(/); // 补充说明仍真实唤醒下一轮
  assert.match(answer, /bridgeAnswerToResume\(/);
  assert.match(answer, /assertResumeProposal\(/);
});

test('P-9 回流建议恒为 advisory，绝不自动放行或冒充验收', () => {
  const proposal = bridgeAnswerToResume({
    question: { id: 'q1', payload: { run_id: 'RUN1', step_no: 2 } },
    response: { id: 'a1', actor: '原发起人', payload: { choice: '继续' } },
  });
  assert.doesNotThrow(() => assertResumeProposal(proposal));
  assert.equal(proposal.autoExecute, false);
  assert.equal(proposal.notAcceptance, true);
  const answer = source('scripts/step-answer.ts');
  assert.doesNotMatch(answer, /enqueueSteps\(|completeStep\(|store\.save\(/);
});

test('P-9 半回路判据不被绕过：回答后没有回流就是断路', () => {
  const events: LoopEvent[] = [
    { id: 'q1', direction: 'upstream', kind: 'question', at: 1, taskId: 'T', actor: 'w',
      expectsHumanAction: 'answer' },
    { id: 'a1', direction: 'downstream', kind: 'answer', at: 2, taskId: 'T',
      actor: 'originator', inReplyTo: 'q1' },
  ];
  assert.equal(loopReport({ events }).staleAnswers.length, 1);
  assert.equal(loopReport({ events,
    resumeProposals: [{ id: 'r1', inReplyTo: 'a1' }] }).staleAnswers.length, 0);
});

test('P-9 Runner 台账归一化必须从配对问题继承任务归属', () => {
  const events = fromHitlLedger({ events: [
    { id: 'q1', type: 'human_question', at: 1, payload: { run_id: 'RUN1', asker: 'w' } },
    { id: 'a1', type: 'human_response', at: 2, payload: { question_id: 'q1', choice: '继续' } },
  ] });
  assert.equal(events.length, 2, '回答自身不带 run_id，不能因此丢失下行方向');
  assert.equal(events[1]!.direction, 'downstream');
  assert.equal(events[1]!.taskId, 'RUN1');
});

test('P-9 「确认验收」不是回答，核可权不混入双向回路', () => {
  assert.equal(mapFollowupToAnswer('确认验收 SUI-1', 'ou_owner').accepted, false);
  assert.equal(mapFollowupToAnswer('继续', 'ou_owner').acceptance, false);
  assert.equal(mapFollowupToAnswer('继续', '').accepted, false);
});
