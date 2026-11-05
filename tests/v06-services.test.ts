// FR-18/25 + the orchestration layer: does the new semantic object reach the
// human in the conversation, leave a workbench record, and name its signer?
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Store } from '../src/store.ts';
import { V06Services } from '../src/v06.ts';
import { MemoryV06Store } from '../src/v06-store.ts';
import { TraceEvidenceReviewer, acceptanceChainReady, assertReviewerCapable } from '../src/independent-review.ts';
import { createPlan } from '../src/acceptance-plan.ts';
import { capture } from '../src/event-stream.ts';
import { registrySchema } from '../src/roles.ts';

const at = '2026-11-06T08:00:00.000Z';
const opts = { workbenchUrl: 'http://127.0.0.1:4180', channel: 'workspace' as const, actorUserId: 'pd-owner' };
const admin = { admin: true, userId: 'pd-owner' };
const member = { admin: false, userId: 'li' };

function setup(reviewer = new TraceEvidenceReviewer()) {
  const store = new MemoryV06Store();
  const audits: { action: string; issueId: string }[] = [];
  const notifications: string[] = [];
  const localStore = { audit: (action: string, issueId: string) => audits.push({ action, issueId }),
    notify: (_id: string, _issueId: string, text: string) => notifications.push(text) } as unknown as Store;
  const service = new V06Services(localStore, undefined, store, reviewer);
  return { service, store, audits, notifications };
}

function registry() {
  return registrySchema.parse({ schemaVersion: 1, version: 1, updatedAt: at,
    roles: [
      { id: 'engineering', name: '研发', ownerUserId: 'eng-owner', active: true },
      { id: 'product', name: '产品', ownerUserId: 'pd-owner', active: true },
    ],
    members: [
      { userId: 'li', roleId: 'engineering', domains: [{ tag: 'payment', weight: 0.5, evidence: ['T-1'] }],
        adjacency: [{ roleId: 'product', weight: 0.2, evidence: ['T-3'] }] },
      { userId: 'wang', roleId: 'product', domains: [], adjacency: [] },
    ] });
}

test('independent reviewer refuses to claim a visual judgement it cannot make', async () => {
  const reviewer = new TraceEvidenceReviewer();
  assert.equal(reviewer.capabilities.vision, false);
  assert.equal(reviewer.capabilities.externalModelEnabled, false);
  assert.doesNotThrow(() => assertReviewerCapable(reviewer, { producerModel: 'gpt-prod', visualEvidenceRequired: false }));
  assert.throws(() => assertReviewerCapable(reviewer, { producerModel: 'gpt-prod', visualEvidenceRequired: true }), /不得宣称 FR-18 已完成/);
  assert.throws(() => assertReviewerCapable(reviewer, { producerModel: reviewer.id, visualEvidenceRequired: false }), /不得与产出模型相同/);
  assert.equal(acceptanceChainReady({ traceReady: true, reviewer, visualEvidenceRequired: true }).ready, false);
  assert.equal(acceptanceChainReady({ traceReady: true, reviewer: null, visualEvidenceRequired: false }).ready, false);
  assert.equal(acceptanceChainReady({ traceReady: false, reviewer, visualEvidenceRequired: false }).ready, false);
});

test('evidence binder only binds captured/imported trace events, never authored output', async () => {
  const reviewer = new TraceEvidenceReviewer();
  const plan = createPlan({ taskId: 'T-1', names: ['报价版本正确', '客户可见文案'], lockedBy: 'pd-owner', lockedAt: at });
  const captured = capture({ taskId: 'T-1', at, kind: 'ci', actor: 'ci', provenance: 'quote@v3', evidenceKind: 'captured', checkpoint: 'sha1' });
  const authored = capture({ taskId: 'T-1', at, kind: 'model', actor: 'agent', provenance: 'model-output', evidenceKind: 'authored' });
  const result = await reviewer.review({ plan, producerModel: 'gpt-prod', events: [captured.event!, authored.event!] });
  assert.ok(result.evidence['item-1']!.refs.includes('ci:T-1:quote@v3:sha1:captured') === false || result.evidence['item-1']!.refs.length === 1);
  assert.equal(result.evidence['item-1']!.refs.length, 1, 'authored model output is excluded');
  assert.equal(result.evidence['item-1']!.sourceRefs![0]!.id, 'quote@v3');
  assert.equal(result.limitations.length, 2);
});

test('org-level config writes require the org owner; ordinary members cannot widen grants', async () => {
  const { service } = setup();
  await assert.rejects(() => service.dispatch('roles-save', { registry: registry(), revision: null }, member, opts), /组织级 owner/);
  const saved: any = await service.dispatch('roles-save', { registry: registry(), revision: null }, admin, opts);
  assert.equal(saved.registry.roles.length, 2);
  await assert.rejects(() => service.dispatch('policy-save', { space: 'space-a', policy: {} }, member, opts), /组织级 owner/);
});

test('end-to-end: registry → Transfer card → standard lock → counter-sign → grant → edges → signals', async () => {
  const { service, audits, notifications } = setup();
  await service.dispatch('roles-save', { registry: registry(), revision: null }, admin, opts);
  const route: any = await service.dispatch('role-route', { roleId: 'product', domain: 'payment' }, member, opts);
  assert.equal(route.roleOwnerUserId, 'pd-owner');

  const created: any = await service.dispatch('transfer-create', {
    taskId: 'SUI-300', grantorUserId: 'pd-owner', granteeUserId: 'li',
    fromRoleId: 'engineering', toRoleId: 'product', toRoleOwnerUserId: 'pd-owner',
    capabilityBasis: ['T-3 需求评审'], standardDraftedBy: 'pd-owner',
  }, admin, opts);
  assert.equal(created.transfer.level, 'L0');
  assert.equal(created.message.degraded, false, 'workbench channel supports cards');
  assert.match(created.message.text, /验收标准起草方：pd-owner/);
  assert.equal(created.responsibility.fallback.userId, 'pd-owner');
  await assert.rejects(() => service.dispatch('dispatch-guard', { taskId: 'SUI-300', fromRoleId: 'engineering', toRoleId: 'product' }, member, opts), /验收标准尚未由目标职能锁定/);

  const plan = createPlan({ taskId: 'SUI-300', names: ['客户可见文案'], lockedBy: 'pd-owner', draftedBy: 'pd-owner', lockedAt: at });
  const locked: any = await service.dispatch('standard-lock', { taskId: 'SUI-300', plan }, admin, opts);
  assert.equal(locked.standardLocked, true);
  assert.equal(locked.planHash, plan.hash);
  const guard: any = await service.dispatch('dispatch-guard', { taskId: 'SUI-300', fromRoleId: 'engineering', toRoleId: 'product' }, member, opts);
  assert.equal(guard.allowed, true);
  await assert.rejects(() => service.dispatch('counter-sign', { taskId: 'SUI-300', riskAction: 'external_publish', signers: ['li'] }, member, opts), /联签/);
  assert.ok(await service.dispatch('counter-sign', { taskId: 'SUI-300', riskAction: 'external_publish', signers: ['pd-owner'] }, member, opts));

  const grant: any = await service.dispatch('grant-request', {
    taskId: 'SUI-300', sourceSpace: 'space-b', targetSpace: 'space-a', requesterUserId: 'li',
    approverUserId: 'owner-of-b', purpose: '按历史报价改方案', refs: ['quote:v3#L12'], at,
  }, member, opts);
  assert.match(grant.message.text, /目标空间 owner/);
  await assert.rejects(() => service.dispatch('grant-decide', { taskId: 'SUI-300', decision: 'approved' }, { ...member, userId: 'li' }, opts), /目标 Workspace owner/);
  const approved: any = await service.dispatch('grant-decide', { taskId: 'SUI-300', decision: 'approved' }, { ...member, userId: 'owner-of-b' }, opts);
  assert.equal(approved.state, 'approved');

  const edges = [{ schemaVersion: 1, id: 'e1', kind: 'verified_by', from: 'a', to: 'q',
    state: 'draft', evidenceRefs: [{ sourceId: 'quote', revision: 'v3' }],
    visibility: { space: 'space-a', classification: 'internal' }, validFrom: at }];
  await service.dispatch('edges-save', { taskId: 'SUI-300', edges }, admin, opts);
  const accepted: any = await service.dispatch('edge-accept', { taskId: 'SUI-300', edgeId: 'e1' }, member, { ...opts, actorUserId: 'human-1' });
  assert.equal(accepted[0].state, 'accepted');
  const pack: any = await service.dispatch('context-pack', { taskId: 'SUI-300', registryVersion: 1, at }, member, opts);
  assert.equal(pack.refs.length, 1);

  const signals: any = await service.dispatch('signals', { readings: { 'cross-function-dispatch-ratio': 0.5 }, at }, member, opts);
  assert.equal(signals.blocking, false);
  assert.equal(signals.signals.length, 1);
  assert.ok(audits.some(a => a.action === 'v06.transfer-rendered'));
  assert.ok(audits.some(a => a.action === 'v06.context-pack-built'));
  assert.ok(audits.some(a => a.action === 'v06.standard-locked'));
  assert.ok(notifications.some(text => text.includes('跨职能授权（Transfer）') && text.includes('验收标准起草方：pd-owner')),
    'Transfer card must reach the conversation through the existing outbox');
  assert.ok(notifications.some(text => text.includes('跨空间资料授权')));
});

test('without a registry the existing flat dispatch is preserved, never broken', async () => {
  const { service } = setup();
  const guard: any = await service.dispatch('dispatch-guard', { taskId: 'OLD-1', fromRoleId: 'engineering', toRoleId: 'product' }, member, opts);
  assert.equal(guard.skipped, true);
  assert.equal(guard.allowed, true);
});
