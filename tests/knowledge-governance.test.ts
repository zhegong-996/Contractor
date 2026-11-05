// FR-06/07/09/10/14/26: edge state is product semantics; Cognee's physical
// per-revision isolation stays untouched. Only human-accepted edges are usable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleForContextPack, assertUsable, acceptEdge, markReusable, invalidateEdges, impactOf,
  buildContextPack, invalidatePack, assertLabelAccess, knowledgeEdgeSchema, type KnowledgeEdge } from '../src/knowledge-edges.ts';
import { requestGrant, approveGrant, denyGrant, revokeGrant, separateApproval, assertGrantUsable, toContextGrantCard } from '../src/context-grant.ts';
import { renderForChannel, PLAIN_TEXT } from '../src/channels.ts';

const at = '2026-11-06T08:00:00.000Z';
const visibility = { space: 'space-a', classification: 'internal' as const, validUntil: '2027-01-01T00:00:00.000Z' };
const edge = (id: string, extra: Partial<KnowledgeEdge> = {}): KnowledgeEdge => knowledgeEdgeSchema.parse({
  schemaVersion: 1, id, kind: 'verified_by', from: 'artifact-1', to: 'quote-v3',
  state: 'draft', evidenceRefs: [{ sourceId: 'quote', revision: 'v3', excerpt: '报价 3.0' }],
  visibility, validFrom: at, ...extra,
});

test('inferred edges without human acceptance cannot be used as a basis', () => {
  const inferred = edge('e1', { evidenceRefs: [], inferredBy: 'model-x' });
  assert.equal(eligibleForContextPack([inferred], at).length, 0);
  assert.throws(() => assertUsable(inferred, at), /不可作依据/);
  assert.throws(() => acceptEdge(inferred, 'human', at), /没有证据引用/);
  const accepted = acceptEdge(edge('e2'), 'human-1', at);
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.acceptedBy, 'human-1');
  assert.equal(eligibleForContextPack([accepted], at).length, 1);
  assert.throws(() => markReusable(edge('e3')), /只有人验收过的边/);
  assert.equal(markReusable(accepted).state, 'reusable');
});

test('invalidation is a state write with a timestamp and reason, never a physical delete', () => {
  const accepted = acceptEdge(edge('e-accepted'), 'human', at);
  const invalidated = invalidateEdges([accepted], '报价换成 v4', '2026-11-07T08:00:00.000Z', e => e.evidenceRefs.some(r => r.revision === 'v3'));
  assert.equal(invalidated.length, 1);
  assert.equal(invalidated[0]!.invalidAt, '2026-11-07T08:00:00.000Z');
  assert.match(String(invalidated[0]!.invalidReason), /报价换成 v4/);
  assert.equal(eligibleForContextPack(invalidated, '2026-11-08T08:00:00.000Z').length, 0);
  assert.throws(() => assertUsable(invalidated[0]!, '2026-11-08T08:00:00.000Z'), /已失效或过期/);
  const untouched = invalidateEdges([accepted], '撤权', '2026-11-07T08:00:00.000Z', e => e.visibility.space === 'other');
  assert.equal(untouched[0]!.invalidAt, undefined);
});

test('reuse lineage can be walked backwards to find the blast radius', () => {
  const edges = [
    edge('e0', { kind: 'reused_by', from: 'artifact-1', to: 'artifact-2', state: 'accepted', acceptedBy: 'human' }),
    edge('e1', { kind: 'reused_by', from: 'artifact-2', to: 'artifact-3', state: 'accepted', acceptedBy: 'human' }),
    edge('e2', { kind: 'reused_by', from: 'artifact-3', to: 'artifact-4', state: 'accepted', acceptedBy: 'human' }),
  ];
  assert.deepEqual(impactOf(edges, 'e0'), ['artifact-2', 'artifact-3', 'artifact-4']);
  assert.deepEqual(impactOf(edges, 'missing'), []);
});

test('Context Pack is a one-shot projection with version, labels and expiry', () => {
  const edges = [acceptEdge(edge('e1'), 'human', at), edge('e2', { evidenceRefs: [] })];
  const pack = buildContextPack({ taskId: 'T-1', edges, registryVersion: 3, visibilityFilter: () => true, at, ttlHours: 12 });
  assert.equal(pack.refs.length, 1);
  assert.equal(pack.refs[0]!.sourceId, 'quote');
  assert.equal(pack.refs[0]!.revision, 'v3');
  assert.deepEqual(pack.refs[0]!.edgeIds, ['e1']);
  assert.equal(pack.registryVersion, 3);
  assert.equal(pack.expiresAt, '2026-11-06T20:00:00.000Z');
  const dead = invalidatePack(pack, '权限变更', '2026-11-06T10:00:00.000Z');
  assert.match(String(dead.invalidReason), /权限变更/);
  assert.equal(buildContextPack({ taskId: 'T-1', edges, registryVersion: 3, visibilityFilter: () => false, at }).refs.length, 0);
});

test('label x capability double check: cross-space defaults to isolation, grant is read-only and minimal', () => {
  const data = { space: 'space-b', classification: 'confidential' as const, roleId: 'product' };
  const capability = { space: 'space-a', roleId: 'product', classification: 'confidential', at };
  assert.throws(() => assertLabelAccess({ data, capability }), /跨 Workspace 默认不继承/);
  assert.throws(() => assertLabelAccess({ data, capability, grant: { space: 'space-b', readonly: false, expiresAt: '2027-01-01T00:00:00.000Z' } }), /默认只读/);
  assert.equal(assertLabelAccess({ data, capability, grant: { space: 'space-b', readonly: true, expiresAt: '2027-01-01T00:00:00.000Z' } }).allowed, true);
  assert.throws(() => assertLabelAccess({ data: { ...data, space: 'space-a', roleId: 'engineering' }, capability }), /职能标签与能力标签不匹配/);
  assert.throws(() => assertLabelAccess({ data: { ...data, space: 'space-a', roleId: 'product', classification: 'restricted' }, capability }), /密级超出能力标签/);
});

test('cross-space grant: approved by the TARGET owner, read-only, revocable, minimal subset', () => {
  const input = { taskId: 'T-2', sourceSpace: 'space-b', targetSpace: 'space-a', requesterUserId: 'li',
    approverUserId: 'owner-of-b', purpose: '按历史报价改方案', refs: ['quote:v3#L12-L20'], at };
  const grant = requestGrant(input);
  assert.equal(grant.state, 'pending');
  assert.equal(grant.granularity, 'redacted-summary');
  assert.equal(grant.readonly, true);
  assert.throws(() => requestGrant({ ...input, refs: [] }), /最小可见子集/);
  assert.throws(() => requestGrant({ ...input, requesterUserId: 'owner-of-b', approverUserId: 'owner-of-b' }), /不能自批/);
  assert.throws(() => approveGrant(grant, 'li', at), /只有目标 Workspace owner/);
  const approved = approveGrant(grant, 'owner-of-b', at);
  assert.equal(approved.state, 'approved');
  assert.throws(() => assertGrantUsable(denyGrant(grant, 'owner-of-b', '不批', at), at), /授权状态为 denied/);
  assert.doesNotThrow(() => assertGrantUsable(approved, at));
  assert.throws(() => assertGrantUsable(approved, '2027-01-01T00:00:00.000Z'), /已过期/);
  assert.equal(separateApproval(approved, 'write', 'owner-of-b').writeApproval, true);
  assert.equal(separateApproval(approved, 'reflow', 'owner-of-b').reflowApproval, true);
  assert.throws(() => separateApproval(approved, 'write', 'li'), /单独审批/);
  assert.equal(revokeGrant(approved, '项目结束', at).state, 'revoked');
  const text = renderForChannel(toContextGrantCard(approved), { capabilities: PLAIN_TEXT, workbenchUrl: 'http://127.0.0.1:4180' }).text;
  assert.match(text, /审批人：owner-of-b（目标空间 owner）/);
  assert.match(text, /只读/);
});
