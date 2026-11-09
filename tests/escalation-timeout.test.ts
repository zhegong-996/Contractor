// V5 超时升级：挂够时限升级给域 owner，没 owner 就明说，不静默挂着。
import test from 'node:test';
import assert from 'node:assert/strict';
import { timeoutEscalation, DEFAULT_TIMEOUT_MS } from '../src/escalation.ts';

test('未超时继续等，超时升级给域 owner', () => {
  const pendingSince = '2026-11-09T00:00:00Z';
  const now = '2026-11-09T12:00:00Z'; // 12 小时，小于默认 24h
  assert.equal(timeoutEscalation({ domain: 'growth', domainOwner: 'ou_owner', pendingSince, now }).escalated, false);

  const later = '2026-11-10T12:00:00Z'; // 36 小时，超时
  const result = timeoutEscalation({ domain: 'growth', domainOwner: 'ou_owner', pendingSince, now: later });
  assert.equal(result.escalated, true);
  assert.equal(result.to, 'ou_owner');
  assert.match(result.reason, /升级给 growth 域 owner ou_owner/);
});

test('域没有 owner 就明说需要人指定，而不是假装升级成功', () => {
  const result = timeoutEscalation({ domain: 'growth', domainOwner: '', pendingSince: '2026-11-08T00:00:00Z', now: '2026-11-10T00:00:00Z' });
  assert.equal(result.escalated, true);
  assert.equal(result.to, '');
  assert.match(result.reason, /没有 owner/);
  assert.match(result.reason, /需要人指定/);
});

test('时限可配', () => {
  const result = timeoutEscalation({ domain: 'p', domainOwner: 'o', pendingSince: '2026-11-09T00:00:00Z', now: '2026-11-09T02:00:00Z', timeoutMs: 3600000 });
  assert.equal(result.escalated, true, '1 小时超时，2 小时应升级');
});
