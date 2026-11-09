// 内容密封契约：篡改能查、易变字段可排除、键顺序不影响哈希。
import test from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, seal, sealDiff, verifySeal } from '../src/content-seal.ts';

test('键顺序不影响哈希：同内容不同顺序得到同一个哈希', () => {
  assert.equal(
    contentHash({ a: 1, b: 2 }),
    contentHash({ b: 2, a: 1 }),
  );
});

test('改一个字段哈希就变，能查出篡改', () => {
  const original = { role: 'role-product', members: 3, owner: 'ou_a' };
  const stamped = seal(original);
  assert.equal(verifySeal(original, stamped), true);
  assert.equal(verifySeal({ ...original, members: 4 }, stamped), false);
});

test('排除易变字段后，时间戳/端口变了不算篡改', () => {
  const stamp = seal({ phase: 'running', at: '2026-11-09T00:00:00Z', port: 9999 }, { excluded: ['at', 'port'] });
  assert.equal(verifySeal({ phase: 'running', at: '2099-01-01T00:00:00Z', port: 1 }, stamp), true);
  // 但真正的状态变了还是能查出来。
  assert.equal(verifySeal({ phase: 'review', at: '2099-01-01T00:00:00Z', port: 1 }, stamp), false);
});

test('sealDiff 找出改了哪些键，供审计文案用', () => {
  const diff = sealDiff({ a: 1, b: 2, at: 'x' }, { a: 1, b: 3, at: 'y' }, ['at']);
  assert.deepEqual(diff.changedKeys, ['b']);
  assert.notEqual(diff.beforeHash, diff.afterHash);
});
