// 决策点（DecisionPoint）契约：统一「谁有资格判」，跨域不放行，审计可回放。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  canDecide, decide, delegateDecision, decisionRecord, openDecision, pendingDecisions,
  persistDecision, listDecisions, REQUIRED_CAPABILITY, DECISION_KINDS,
} from '../src/decision-point.ts';

const dir = () => mkdtempSync(path.join(tmpdir(), 'dp-'));

test('六类决策都有资格要求，且验收/会签必须独立评审', () => {
  assert.deepEqual(DECISION_KINDS.length, 7);
  assert.equal(REQUIRED_CAPABILITY.acceptance, 'independent-reviewer');
  assert.equal(REQUIRED_CAPABILITY.countersign, 'independent-reviewer');
  assert.equal(REQUIRED_CAPABILITY.authorization, 'domain-owner');
  assert.equal(REQUIRED_CAPABILITY['cross-domain'], 'domain-expert');
  assert.equal(REQUIRED_CAPABILITY.admission, 'human');
});

test('admin 在本域能拍，但跨域决策不放行——判断权必须委派', () => {
  const dp = openDecision({ subject: 'task:1', kind: 'cross-domain', domain: 'growth' });
  const growthExpert = { userId: 'expert-g', domain: 'growth', capabilities: ['domain-expert'] as const };
  const productAdmin = { userId: 'admin-p', domain: 'product', admin: true };

  assert.equal(canDecide(growthExpert, dp).ok, true);
  const denied = canDecide(productAdmin, dp);
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /跨域决策/);
  assert.match(denied.reason, /growth/);
});

test('缺资格就是缺资格，admin 也不能替验收拍板', () => {
  const dp = openDecision({ subject: 'task:1', kind: 'acceptance', domain: 'product' });
  const admin = { userId: 'admin', domain: 'product', admin: true };
  const gate = canDecide(admin, dp);
  assert.equal(gate.ok, false, '验收要独立评审者，admin 直通也过不了');
  assert.match(gate.reason, /独立评审|independent-reviewer/);
});

test('decide 过资格才拍板；委派把状态改 delegated 并留痕', () => {
  const dp = openDecision({ subject: 'task:1', kind: 'authorization', domain: 'growth' });
  const owner = { userId: 'owner-g', domain: 'growth', capabilities: ['domain-owner'] as const };
  const decided = decide(dp, { actor: owner, outcome: 'allow', reason: '授权访问口径' });
  assert.equal(decided.ok, true);
  assert.equal(decided.point.status, 'decided');
  assert.equal(decided.point.decidedBy, 'owner-g');

  const stranger = { userId: 'product-admin', domain: 'product', admin: true };
  const blocked = decide(dp, { actor: stranger, outcome: 'allow' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error!, /跨域/);

  const delegated = delegateDecision(dp, { targetDomain: 'growth', targetOwner: 'expert-g', by: 'product-admin' });
  assert.equal(delegated.status, 'delegated');
  assert.match(delegated.reason!, /expert-g/);
});

test('决策点追加式落盘，能列出悬而未决的', () => {
  const base = dir();
  const p1 = openDecision({ subject: 'task:1', kind: 'admission', domain: 'product' });
  const p2 = openDecision({ subject: 'task:2', kind: 'cross-domain', domain: 'growth' });
  persistDecision(base, p1);
  persistDecision(base, p2);
  const resolved = decide(p1, { actor: { userId: 'human', capabilities: ['human'] }, outcome: 'allow' });
  persistDecision(base, resolved.point);

  assert.equal(listDecisions(base).length, 2);
  assert.equal(pendingDecisions(base).length, 1);
  assert.equal(pendingDecisions(base)[0]!.id, p2.id);
  assert.equal(listDecisions(base, { domain: 'growth' }).length, 1);
});

test('decisionRecord 把已发生的决策转成可聚合的审计记录', () => {
  const record = decisionRecord({ kind: 'transfer', subject: 't1', decidedBy: 'ou_owner',
    outcome: 'transfer', reason: 'role-growth → role-product' });
  assert.equal(record.kind, 'transfer');
  assert.equal(record.domain, 'default');
  assert.equal(record.decidedBy, 'ou_owner');
  assert.match(record.reason, /role-product/);
});
