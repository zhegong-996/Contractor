// FR-01/02/03/28: the division of functions is configuration; the invariants
// and the responsibility anchor are structural facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyRegistry, assertRegistry, snapshotFor, routeFor, deriveCapabilities, granularityHints,
  RoleRegistryService, registrySchema, type RoleRegistry } from '../src/roles.ts';
import { MemoryV06Store } from '../src/v06-store.ts';

const at = '2026-11-06T08:00:00.000Z';

function registry(): RoleRegistry {
  return registrySchema.parse({
    schemaVersion: 1, version: 1, updatedAt: at,
    roles: [
      { id: 'engineering', name: '研发', ownerUserId: 'eng-owner', active: true },
      { id: 'product', name: '产品', ownerUserId: 'pd-owner', active: true },
    ],
    members: [
      { userId: 'li', roleId: 'engineering', domains: [{ tag: 'payment', weight: 0.6, evidence: ['T-1'] }], adjacency: [{ roleId: 'product', weight: 0.2, evidence: ['T-3'] }] },
      { userId: 'wang', roleId: 'product', domains: [{ tag: 'payment', weight: 0.3, evidence: ['T-2'] }], adjacency: [] },
    ],
  });
}

test('no preset organisation list: an empty registry is valid and deletable samples do not affect it', () => {
  assert.deepEqual(emptyRegistry(at).roles, []);
  assert.doesNotThrow(() => assertRegistry(emptyRegistry(at)));
});

test('each member has exactly one primary function; blank, duplicate and unknown roles are rejected', () => {
  const r = registry();
  assert.doesNotThrow(() => assertRegistry(r));
  assert.throws(() => assertRegistry({ ...r, members: [...r.members, { ...r.members[0]! }] }), /主职能必须唯一/);
  assert.throws(() => assertRegistry({ ...r, members: [{ ...r.members[0]!, roleId: '' as any }] }), /主职能不能留空|职能 ID/);
  assert.throws(() => assertRegistry({ ...r, members: [{ ...r.members[0]!, roleId: 'ghost' }] }), /不存在或已停用/);
  assert.throws(() => assertRegistry({ ...r, roles: [{ ...r.roles[0]!, ownerUserId: '' }, r.roles[1]!] }), /必须有 owner/);
  assert.throws(() => assertRegistry({ ...r, members: [{ ...r.members[0]!, adjacency: [{ roleId: 'engineering', weight: 0.2, evidence: ['T'] }] }] }), /不能指向自己的主职能/);
  assert.throws(() => assertRegistry({ ...r, members: [{ ...r.members[0]!, adjacency: [{ roleId: 'product', weight: 0.8, evidence: ['T'] }] }] }), /权重须低于主职能/);
});

test('three-stage routing: primary function fixes the group, domain finds the person, adjacency is only backup', () => {
  const r = registry();
  const routed = routeFor(r, { roleId: 'engineering', domain: 'payment' });
  assert.equal(routed.primary, 'li');
  assert.equal(routed.domainRank[0]?.userId, 'li');
  assert.match(routed.basis, /主职能定组=engineering → 领域定人=payment\(命中\)/);
  const product = routeFor(r, { roleId: 'product', domain: 'payment' });
  assert.equal(product.primary, 'wang');
  assert.deepEqual(product.adjacency, []);
  const backup = routeFor(r, { roleId: 'product', prefer: 'adjacency' });
  assert.deepEqual(backup.adjacency, ['li']);
  assert.equal(backup.primary, 'wang', 'adjacency never replaces the primary anchor');
});

test('domain and adjacency are derived from real participation, never hand-maintained as the anchor', () => {
  const r = deriveCapabilities(registry(), [{ userId: 'li', taskId: 'T-9', roleId: 'engineering', domainTags: ['mobile'], accepted: false }]);
  assert.ok(r.members[0]!.domains.some(d => d.tag === 'mobile' && d.evidence.includes('T-9')));
  assert.equal(r.members[0]!.roleId, 'engineering', 'doing mobile work does not change the primary function');
  const withAccepted = deriveCapabilities(registry(), [{ userId: 'li', taskId: 'T-10', roleId: 'product', accepted: true }]);
  assert.ok(withAccepted.members[0]!.adjacency.some(a => a.roleId === 'product' && a.evidence.includes('T-10')));
  const withUnaccepted = deriveCapabilities(registry(), [{ userId: 'wang', taskId: 'T-11', roleId: 'engineering', accepted: false }]);
  assert.deepEqual(withUnaccepted.members[1]!.adjacency, [], 'unaccepted work does not create adjacency');
});

test('granularity self-check only hints; it never blocks dispatch', () => {
  const hints = granularityHints(registry(), { crossRoleRatio: 0.5, transfers: { product: 8, engineering: 1 } });
  assert.ok(hints.length >= 2);
  assert.ok(hints.some(h => /跨职能派单占比/.test(h)));
  assert.ok(hints.some(h => /可能长期缺人/.test(h)));
});

test('registry changes are versioned and audited; historical snapshots are never rewritten', async () => {
  const store = new MemoryV06Store();
  const audits: string[] = [];
  const service = new RoleRegistryService(store, (action, detail) => audits.push(`${action}:${(detail as any).version}`));
  const initial = await service.read();
  assert.equal(initial.revision, null);
  const saved = await service.save(registry(), null, 'org-owner', at);
  assert.equal(saved.registry.version, 1);
  assert.ok(saved.registry.members.every(m => m.roleSnapshot));
  const before = snapshotFor(saved.registry, 'li');
  assert.deepEqual(before, { roleId: 'engineering', name: '研发', ownerUserId: 'eng-owner', registryVersion: 1 });
  await assert.rejects(() => service.save(registry(), null, 'org-owner', at), /职能注册表已变化/);

  const renamed = await service.save({ ...saved.registry, roles: saved.registry.roles.map(r => r.id === 'engineering' ? { ...r, name: '研发工程' } : r) }, saved.revision, 'org-owner', at);
  assert.equal(renamed.registry.version, 2);
  assert.equal(snapshotFor(renamed.registry, 'li').roleId, 'engineering', 'stable ID survives a rename');
  assert.equal(before.name, '研发', 'the old snapshot still reads the old name');
  assert.ok(audits.includes('role-registry.changed:1'));

  const stale = await service.read();
  await assert.rejects(() => service.save(registry(), 'stale-revision', 'org-owner', at), /职能注册表已变化|配置已变化/);
  assert.equal(stale.registry.version, 2);
});
