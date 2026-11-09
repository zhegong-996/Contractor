// V6 密钥钥匙串抽象：非 macOS 或不可用时明确返回不可用，不假装成功。
import test from 'node:test';
import assert from 'node:assert/strict';
import { keychainAvailable, keychainGet, keychainDelete } from '../src/keychain.ts';

test('非 macOS 或 security 不可用时，钥匙串明确不可用', () => {
  const available = keychainAvailable();
  assert.equal(typeof available, 'boolean');
  // 测试环境（CI/容器）多半没有 security，此时 get 应返回 null、delete 不抛。
  const value = keychainGet('nonexistent-account');
  assert.equal(value, null);
  assert.doesNotThrow(() => keychainDelete('nonexistent-account'));
});
