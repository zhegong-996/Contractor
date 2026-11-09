// 会签与分歧仲裁契约：一票否决、分歧升级仲裁、同一人重复投票只算一次。
import test from 'node:test';
import assert from 'node:assert/strict';
import { arbitrate, tallyVerdicts } from '../src/countersign.ts';

test('会签：达到人数且全票 allow 才通过', () => {
  const result = tallyVerdicts([
    { by: 'reviewer-a', outcome: 'allow', reason: '清单逐项对上' },
    { by: 'reviewer-b', outcome: 'allow', reason: '证据充分' },
  ], { quorum: 2 });
  assert.equal(result.verdict, 'allow');
  assert.equal(result.collected, 2);
});

test('一票否决：有 deny 就 deny，多数票洗不白', () => {
  const result = tallyVerdicts([
    { by: 'a', outcome: 'allow', reason: 'ok' },
    { by: 'b', outcome: 'allow', reason: 'ok' },
    { by: 'c', outcome: 'deny', reason: '必做项 E2 没有证据' },
  ], { quorum: 3 });
  assert.equal(result.verdict, 'deny');
  assert.deepEqual(result.reasons, ['必做项 E2 没有证据']);
});

test('同一判断者重复投票只算一次', () => {
  const result = tallyVerdicts([
    { by: 'a', outcome: 'allow', reason: 'ok' },
    { by: 'a', outcome: 'deny', reason: '再看发现不对' },
  ], { quorum: 1 });
  assert.equal(result.collected, 1);
  assert.equal(result.verdict, 'deny');
});

test('人数不够或要求全票却有人缺席 → deadlock，不猜', () => {
  assert.equal(tallyVerdicts([{ by: 'a', outcome: 'allow', reason: 'ok' }], { quorum: 2 }).verdict, 'deadlock');
  assert.equal(tallyVerdicts([
    { by: 'a', outcome: 'allow', reason: 'ok' },
    { by: 'b', outcome: 'allow', reason: 'ok' },
  ], { quorum: 2, unanimous: true }).verdict, 'allow');
});

test('分歧只能仲裁解决，仲裁结果单独标记、不和会签通过混淆', () => {
  const deadlock = tallyVerdicts([
    { by: 'a', outcome: 'allow', reason: 'ok' },
    { by: 'b', outcome: 'deny', reason: '口径冲突' },
  ], { quorum: 2, disagree: 'arbitrate' });
  assert.equal(deadlock.verdict, 'deadlock');

  const resolved = arbitrate(deadlock, { by: 'independent-reviewer', outcome: 'allow', reason: '以增长域口径为准' });
  assert.equal(resolved.verdict, 'allow');
  assert.equal(resolved.arbitrated, true);
  assert.equal(resolved.reviewer, 'independent-reviewer');
  assert.match(resolved.deadlockReason, /1 票反对/);

  // 没卡住就不能仲裁。
  const passed = tallyVerdicts([{ by: 'a', outcome: 'allow', reason: 'ok' }], { quorum: 1 });
  assert.throws(() => arbitrate(passed, { by: 'x', outcome: 'deny', reason: '' }), /没有卡住/);
});
