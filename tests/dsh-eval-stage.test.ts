// 对齐 dsh-superagent 的纯函数：accept mode、工单阶段、失败退避、授权重校验。
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessmentOutcome } from '../src/eval-mode.ts';
import { deriveStage, isPersonStage, isTerminalReport } from '../src/ticket-stage.ts';
import { backoffMs, isTransientFailure, retryDecision, evalUnavailable } from '../src/retry-backoff.ts';
import { revalidateMandate } from '../src/revalidate.ts';

test('accept mode：observe 模式把 inferred 的 accept 记成 would-accept，不真接', () => {
  const inferred = assessmentOutcome({
    strength: 'inferred', acceptMode: 'observe',
    enabledRuleIds: ['r1'],
    rules: [{ ruleId: 'r1', matched: true, direction: 'accept', evidence: '卡片明确要求接单' }],
  });
  assert.equal(inferred.decision, 'ignore');
  assert.equal(inferred.wouldAccept, true);
  assert.match(inferred.reason, /观察模式/);

  const auto = assessmentOutcome({
    strength: 'inferred', acceptMode: 'auto',
    enabledRuleIds: ['r1'],
    rules: [{ ruleId: 'r1', matched: true, direction: 'accept', evidence: '明确' }],
  });
  assert.equal(auto.decision, 'accept');
});

test('accept mode：显式请求任何模式都接，off 模式不接 inferred', () => {
  const explicit = assessmentOutcome({
    strength: 'explicit', acceptMode: 'off',
    enabledRuleIds: ['r1'],
    rules: [{ ruleId: 'r1', matched: true, direction: 'accept', evidence: '明确' }],
  });
  assert.equal(explicit.decision, 'accept');

  const off = assessmentOutcome({
    strength: 'inferred', acceptMode: 'off',
    enabledRuleIds: ['r1'],
    rules: [{ ruleId: 'r1', matched: true, direction: 'accept', evidence: '明确' }],
  });
  assert.equal(off.decision, 'ignore');
  assert.equal(off.wouldAccept, false);
});

test('assessment：缺任一条启用规则的判定 → unavailable，不硬猜', () => {
  const result = assessmentOutcome({
    strength: 'inferred', acceptMode: 'auto',
    enabledRuleIds: ['r1', 'r2'],
    rules: [{ ruleId: 'r1', matched: true, direction: 'accept', evidence: '明确' }],
  });
  assert.equal(result.decision, 'unavailable');
});

test('工单阶段：从上到下第一个匹配胜出', () => {
  assert.equal(deriveStage({ report: 'ready' }), 'person/review');
  assert.equal(deriveStage({ report: 'blocked' }), 'person/blocked');
  assert.equal(deriveStage({ report: 'blocked', hasPersonMessageSince: true }), 'working');
  assert.equal(deriveStage({ hasAttention: true, report: 'waiting' }), 'person/answer');
  assert.equal(deriveStage({ report: 'waiting' }), 'idle');
  assert.equal(deriveStage({ report: 'dropped' }), 'idle');
  assert.equal(deriveStage({ deliveryFailed: true }), 'person/delivery');
  assert.equal(deriveStage({ hasPendingAssignment: true, report: undefined }), 'working/queued');
  assert.ok(isPersonStage('person/review'));
  assert.ok(!isPersonStage('working'));
  assert.ok(isTerminalReport('ready'));
});

test('失败退避：瞬时失败 3 次内重试、封顶 60s，硬失败直接 unavailable', () => {
  assert.ok(isTransientFailure({ code: 429 }));
  assert.ok(isTransientFailure({ message: 'ECONNREFUSED' }));
  assert.ok(!isTransientFailure({ code: 403 }));
  assert.equal(backoffMs(1), 2000);
  assert.equal(backoffMs(4), 16000);
  assert.equal(backoffMs(10), 60000);
  assert.equal(retryDecision({ attempt: 1, transient: true }).retry, true);
  assert.equal(retryDecision({ attempt: 4, transient: true }).unavailable, true);
  assert.equal(retryDecision({ attempt: 1, transient: false }).retry, false);
  assert.equal(evalUnavailable(3).unavailable, true);
  assert.equal(evalUnavailable(2).unavailable, false);
});

test('授权重校验：显式跟进直接过，inferred 要 auto + 规则启用', () => {
  assert.equal(revalidateMandate({ basis: 'explicit-followup', matchedRuleIds: [], rulesStillEnabled: () => false, acceptMode: 'off' }).valid, true);
  assert.equal(revalidateMandate({ basis: 'inferred', matchedRuleIds: ['r1'], rulesStillEnabled: () => true, acceptMode: 'observe' }).valid, false);
  assert.equal(revalidateMandate({ basis: 'inferred', matchedRuleIds: ['r1'], rulesStillEnabled: () => true, acceptMode: 'auto' }).valid, true);
  assert.equal(revalidateMandate({ basis: 'inferred', matchedRuleIds: ['r1'], rulesStillEnabled: () => false, acceptMode: 'auto' }).valid, false);
});

test('表准入 / 机器人重校验', () => {
  assert.equal(revalidateMandate({ basis: 'table-cell', matchedRuleIds: [], rulesStillEnabled: () => true, acceptMode: 'auto', senderStillListed: false }).valid, false);
  assert.equal(revalidateMandate({ basis: 'table-cell', matchedRuleIds: [], rulesStillEnabled: () => true, acceptMode: 'auto', senderStillListed: true, cellStrengthHeld: true }).valid, true);
  assert.equal(revalidateMandate({ basis: 'bot', matchedRuleIds: ['r1'], rulesStillEnabled: () => true, acceptMode: 'auto', botStillListed: false }).valid, false);
  assert.equal(revalidateMandate({ basis: 'bot', matchedRuleIds: ['r1'], rulesStillEnabled: () => true, acceptMode: 'auto', botStillListed: true }).valid, true);
});
