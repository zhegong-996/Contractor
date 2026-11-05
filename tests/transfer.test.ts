// FR-11/12/13 + FR-16: responsibility moves by an explicit act, never by an @.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransfer, assertDispatchAllowed, assertCounterSign, responsibilityChain, toTransferCard,
  evaluateWidening, evaluateTightening, defaultGrantPolicy, dispatchReceipt, HIGH_RISK_ACTIONS } from '../src/transfer.ts';
import { createPlan, assertStandardExternalised } from '../src/acceptance-plan.ts';
import { renderForChannel, PLAIN_TEXT } from '../src/channels.ts';

const at = '2026-11-06T08:00:00.000Z';
const base = {
  taskId: 'SUI-200', identifier: 'SUI-200', grantorUserId: 'pd-owner', granteeUserId: 'li',
  fromRoleId: 'engineering', toRoleId: 'product', toRoleOwnerUserId: 'pd-owner',
  capabilityBasis: ['参与过 3 次需求评审：T-1/T-2/T-3'], standardDraftedBy: 'pd-owner', at,
};
const active = () => ({ ...createTransfer(base), standardLocked: true });

test('L0 is the default: scope is exactly this Task', () => {
  const t = createTransfer(base);
  assert.equal(t.level, 'L0');
  assert.equal(t.scope.kind, 'task');
  assert.equal(t.scope.taskId, 'SUI-200');
  assert.equal(t.executionOwnerUserId, 'li');
  assert.equal(t.fallbackOwnerUserId, 'pd-owner');
  assert.equal(t.grantBatchId, 'batch:SUI-200');
});

test('the doer cannot authorise themselves, and the standard must be externalised', () => {
  assert.throws(() => createTransfer({ ...base, grantorUserId: 'li' }), /承接人不能自提授权|目标职能 owner/);
  assert.throws(() => createTransfer({ ...base, standardDraftedBy: 'li' }), /标准必须由目标职能起草/);
  assert.throws(() => createTransfer({ ...base, capabilityBasis: [] }), /能力依据/);
  assert.throws(() => createTransfer({ ...base, grantorUserId: 'someone-else' }), /只能由目标职能 owner 发起/);
  const plan = createPlan({ taskId: 'SUI-200', names: ['客户可见文案'], lockedBy: 'pd-owner', draftedBy: 'pd-owner', lockedAt: at });
  assert.doesNotThrow(() => assertStandardExternalised(plan, { targetRoleOwner: 'pd-owner', granteeUserId: 'li', standardDraftedBy: 'pd-owner' }));
  assert.throws(() => assertStandardExternalised(plan, { targetRoleOwner: 'pd-owner', granteeUserId: 'li', standardDraftedBy: 'li' }), /承接人不得起草/);
  assert.throws(() => assertStandardExternalised({ ...plan, draftedBy: 'li' }, { targetRoleOwner: 'pd-owner', granteeUserId: 'li', standardDraftedBy: 'pd-owner' }), /起草方与 Transfer 记录不一致/);
});

test('consultation-only calls are explicitly marked and do not move responsibility', () => {
  const t = createTransfer({ ...base, consultationOnly: true, grantorUserId: 'li', standardDraftedBy: 'li' });
  assert.equal(t.consultationOnly, true);
  const guard = assertDispatchAllowed({ taskId: 'SUI-200', fromRoleId: 'engineering', toRoleId: 'product', consultationOnly: true });
  assert.match(guard.reason, /仅咨询 \/ 不主责/);
  assert.equal(guard.requiresCounterSign, false);
  assert.throws(() => assertDispatchAllowed({ taskId: 'SUI-200', fromRoleId: 'engineering', toRoleId: 'product', transfer: t }), /仅咨询记录不能用于正式派单/);
});

test('cross-function formal dispatch without an active Transfer is rejected', () => {
  const params = { taskId: 'SUI-200', fromRoleId: 'engineering', toRoleId: 'product' };
  assert.throws(() => assertDispatchAllowed(params), /必须生成 Responsibility Transfer/);
  assert.throws(() => assertDispatchAllowed({ ...params, transfer: { ...active(), state: 'revoked' } }), /已 revoked/);
  assert.throws(() => assertDispatchAllowed({ ...params, transfer: createTransfer(base) }), /验收标准尚未由目标职能锁定/);
  const locked = active();
  assert.equal(assertDispatchAllowed({ ...params, transfer: locked }).requiresCounterSign, true);
  assert.equal(assertDispatchAllowed({ taskId: 'SUI-200', fromRoleId: 'product', toRoleId: 'product' }).requiresCounterSign, false);
  assert.throws(() => assertDispatchAllowed({ ...params, taskId: 'SUI-201', transfer: locked }), /与任务不匹配/);
});

test('dual-segment responsibility chain and high-risk counter-signature', () => {
  const t = active();
  const chain = responsibilityChain(t);
  assert.equal(chain.execution.userId, 'li');
  assert.equal(chain.fallback.userId, 'pd-owner');
  assert.ok(chain.fallback.duties.includes('兜底责任'));
  assert.ok(HIGH_RISK_ACTIONS.includes('external_publish'));
  assert.doesNotThrow(() => assertCounterSign(t, 'external_publish', ['pd-owner']));
  assert.doesNotThrow(() => assertCounterSign(t, 'internal_note', []));
  assert.throws(() => assertCounterSign(t, 'funds', ['li']), /必须由目标职能 owner 联签/);
});

test('wider grants relax only per-task approval; any incident immediately falls back to L0', () => {
  const policy = defaultGrantPolicy();
  assert.equal(policy.level, 'L0');
  const good = { consecutiveL0Passed: 5, reworkRate: 0.1, revocationRate: 0, counterSignVetoRate: 0 };
  assert.equal(evaluateWidening(policy, good).level, 'L1');
  assert.equal(evaluateWidening(policy, { ...good, consecutiveL0Passed: 2 }).level, 'L0');
  assert.equal(evaluateWidening(policy, { ...good, reworkRate: 0.5 }).level, 'L0');
  assert.equal(evaluateWidening(policy, { ...good, unauthorizedAccess: 1 }).level, 'L0');
  assert.throws(() => createTransfer({ ...base, level: 'L1' }), /必须限定同类任务白名单或时间窗/);
  const l1 = createTransfer({ ...base, level: 'L1', scopeTaskClass: 'customer-proposal', maxUses: 3 });
  assert.equal(l1.scope.kind, 'task-class');
  assert.equal(dispatchReceipt(l1, at).grantBatchId, l1.grantBatchId, 'every dispatch still references the batch');
  const tightened = evaluateTightening({ ...policy, level: 'L2' }, { ...good, p1Incident: 1 }, at);
  assert.equal(tightened.level, 'L0');
  assert.match(String(tightened.tightenedReason), /P1 事故/);
  assert.equal(evaluateTightening({ ...policy, level: 'L2' }, good, at).level, 'L2');
});

test('the Transfer card keeps every responsibility field in plain-text Feishu', () => {
  const t = active();
  const rendered = renderForChannel(toTransferCard(t), { capabilities: PLAIN_TEXT, workbenchUrl: 'http://127.0.0.1:4180' });
  for (const field of ['授权人：pd-owner', '承接人：li', '参与过 3 次需求评审', '仅本 Task', '验收标准起草方：pd-owner', '联签人：pd-owner']) {
    assert.ok(rendered.text.includes(field), `missing ${field}`);
  }
  assert.match(rendered.text, /工作台（完整记录与签字）/);
  assert.equal(rendered.degraded, true);
});
