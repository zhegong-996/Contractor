/**
 * P-10（第二十八轮）· 飞书回答 → HITL 成对台账路由的契约测试。
 *
 * 覆盖 `src/hitl-bridge.ts` 的纯函数判据与 `collaboration-intake.ts` 的接线：
 *   - 只有显式「回答 <问题编号> <选项>」才路由，隐式回答宁可不猜；
 *   - 回答人必须是真人且不得是提问者本人；
 *   - 同一问题只回答一次（append-only，不回溯改写）；
 *   - 回流建议恒 advisory：不排后续步骤、不改任务状态、不等于验收；
 *   - 台账坏行如实报数，不静默丢弃。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { askHuman, FileHitlSink, MemoryHitlSink, foldHitl } from '../src/step-hitl.ts';
import { mapFollowupToAnswer } from '../src/collaboration-loop.ts';
import { routeAnswerToHitl, persistHitlAnswer, resumeProposalFile } from '../src/hitl-bridge.ts';

const question = askHuman({ runId: 'RUN-28', stepNo: 2, asker: 'step-runner',
  prompt: '发布前需要真人选择发布窗口', choices: ['立即发布', '周五低峰发布'],
  at: '2026-11-08T08:00:00.000Z' });

const route = (text: string, actor: string, events = [question],
  at = Date.parse('2026-11-08T09:00:00.000Z')) =>
  routeAnswerToHitl({ inbound: mapFollowupToAnswer(text, actor), actor, events, at, via: 'feishu-im' });

test('P-10 显式「回答 <问题编号> <选项>」路由成功：成对留痕 + advisory 回流建议', () => {
  const routed = route('回答 ' + question.id + ' 立即发布', 'ou_owner');
  assert.equal(routed.ok, true);
  if (!routed.ok) return;
  assert.equal(routed.response.type, 'human_response');
  assert.equal(routed.response.payload.question_id, question.id);
  assert.equal(routed.response.payload.choice, '立即发布');
  assert.equal(routed.response.payload.via, 'feishu-im');
  assert.equal(routed.response.payload.acceptance, false);
  assert.equal(routed.response.to, 'step-runner', '答案必须送回提问者（Runner 语义）');
  assert.equal(routed.proposal.autoExecute, false);
  assert.equal(routed.proposal.requiresHumanApproval, true);
  assert.equal(routed.proposal.notAcceptance, true);
  assert.equal(routed.proposal.responseId, routed.response.id);
  assert.equal(routed.pending, 0);
});

test('P-10 隐式回答不路由：没有问题编号就无法唯一确定指向，宁可不猜', () => {
  const routed = route('立即发布', 'ou_owner');
  assert.equal(routed.ok, false);
  if (routed.ok) return;
  assert.match(routed.reason, /隐式回答不路由/);
});

test('P-10 未知问题编号、越界选项、提问者自答、重复回答全部拒绝', () => {
  assert.equal(route('回答 hq-nope 立即发布', 'ou_owner').ok, false);
  const badChoice = route('回答 ' + question.id + ' 明天再说', 'ou_owner');
  assert.equal(badChoice.ok, false);
  if (!badChoice.ok) assert.match(badChoice.reason, /选项不在/);
  const selfAnswer = route('回答 ' + question.id + ' 立即发布', 'step-runner');
  assert.equal(selfAnswer.ok, false);
  if (!selfAnswer.ok) assert.match(selfAnswer.reason, /提问者本人/);
  const answered = route('回答 ' + question.id + ' 立即发布', 'ou_owner');
  assert.equal(answered.ok, true);
  if (!answered.ok) return;
  const duplicate = route('回答 ' + question.id + ' 周五低峰发布', 'ou_owner',
    [question, answered.response]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.match(duplicate.reason, /已经有回答/);
});

test('P-10 核可短语与空身份进不了台账', () => {
  const acceptance = route('回答 ' + question.id + ' 确认验收 SUI-1', 'ou_owner');
  assert.equal(acceptance.ok, false, '确认验收不是回答，mapFollowupToAnswer 已拒收');
  const noActor = routeAnswerToHitl({
    inbound: { accepted: true, questionId: question.id, choice: '立即发布' },
    actor: '', events: [question], at: 1,
  });
  assert.equal(noActor.ok, false);
  if (!noActor.ok) assert.match(noActor.reason, /真人身份/);
});

test('P-10 persistHitlAnswer：回答进台账、建议进独立文件，坏行如实报数', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-hitl-bridge-'));
  // 隔离建议台账：resumeProposalFile() 读取该环境变量，避免污染 .runtime。
  const previousLedgerEnv = process.env.COLLAB_HITL_LEDGER;
  process.env.COLLAB_HITL_LEDGER = path.join(dir, 'events.jsonl');
  try {
    const ledger = path.join(dir, 'events.jsonl');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(ledger, JSON.stringify(question) + '\nnot-json{{{\n', { mode: 0o600 });
    const sink = new FileHitlSink(ledger);
    const health = sink.readWithHealth();
    assert.equal(health.events.length, 1);
    assert.equal(health.badLines, 1, '坏行必须被数出来，不能静默吞掉');
    const routed = routeAnswerToHitl({
      inbound: { accepted: true, questionId: question.id, choice: '周五低峰发布' },
      actor: 'ou_owner', events: health.events,
      at: Date.parse('2026-11-08T09:30:00.000Z'), via: 'feishu-im',
    });
    assert.equal(routed.ok, true);
    if (!routed.ok) return;
    const persisted = persistHitlAnswer(routed, sink);
    assert.equal(persisted.proposalPersisted, true);
    const after = sink.readWithHealth();
    assert.equal(after.events.length, 2);
    assert.equal(after.badLines, 1, '坏行不会被修复也不会消失');
    const projection = foldHitl(after.events);
    assert.equal(projection.pairs.filter(p => p.response).length, 1);
    assert.deepEqual(projection.errors, []);
    const proposals = readFileSync(persisted.proposalFile, 'utf8').split('\n').filter(Boolean);
    assert.equal(proposals.length, 1);
    assert.equal(JSON.parse(proposals[0]!).id, routed.proposal.id);
  } finally {
    if (previousLedgerEnv === undefined) delete process.env.COLLAB_HITL_LEDGER;
    else process.env.COLLAB_HITL_LEDGER = previousLedgerEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P-10 MemoryHitlSink 注入：飞书入站与 CLI 共用同一份判据', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-hitl-bridge-mem-'));
  const previousLedgerEnv = process.env.COLLAB_HITL_LEDGER;
  process.env.COLLAB_HITL_LEDGER = path.join(dir, 'events.jsonl');
  try {
    const sink = new MemoryHitlSink();
    sink.append(question);
    const routed = routeAnswerToHitl({
      inbound: { accepted: true, questionId: question.id, choice: '立即发布' },
      actor: 'ou_owner', events: sink.read(), at: 5, via: 'feishu-im',
    });
    assert.equal(routed.ok, true);
    if (!routed.ok) return;
    persistHitlAnswer(routed, sink);
    assert.equal(sink.read().length, 2);
    assert.equal(readFileSync(resumeProposalFile(), 'utf8').split('\n').filter(Boolean).length, 1);
  } finally {
    if (previousLedgerEnv === undefined) delete process.env.COLLAB_HITL_LEDGER;
    else process.env.COLLAB_HITL_LEDGER = previousLedgerEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});
