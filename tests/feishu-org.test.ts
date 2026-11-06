// 飞书组织映射：能读多少读多少、缺 scope 如实说、草案不参与派单、
// 必须人工确认并携带注册表修订号才写入职能注册表。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Store } from '../src/store.ts';
import { root } from '../src/config.ts';
import { V06Services } from '../src/v06.ts';
import { MemoryV06Store } from '../src/v06-store.ts';
import { FeishuOrgService, parseOrgTable, ORG_AUTH_HINT } from '../src/feishu-org.ts';
import { registrySchema } from '../src/roles.ts';

const at = '2026-11-06T10:00:00.000Z';
const opts = { workbenchUrl: 'http://127.0.0.1:4180', channel: 'workspace' as const, actorUserId: 'org-owner' };
const admin = { admin: true, userId: 'org-owner' };
const member = { admin: false, userId: 'someone' };
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

function stubReader(users: any[] = [], fail = false) {
  return new FeishuOrgService(async (args: string[]) => {
    if (fail) throw new Error('scope missing');
    if (args[0] === 'auth') return { appId: 'cli_test' };
    return { ok: true, data: { users: args.includes('me') ? users.slice(0, 1) : users } };
  });
}

function setup(reader = stubReader()) {
  const memory = new MemoryV06Store();
  const audits: string[] = [];
  const localStore = { audit: (action: string) => audits.push(action), notify: () => {} } as unknown as Store;
  const service = new V06Services(localStore, undefined, memory);
  service.setOrgReader(reader);
  return { service, memory, audits };
}

async function seed(service: V06Services) {
  const registry = registrySchema.parse({ schemaVersion: 1, version: 0, updatedAt: at,
    roles: [
      { id: 'role-growth', name: '增长', ownerUserId: 'org-owner', active: true },
      { id: 'role-product', name: '产研', ownerUserId: 'org-owner', active: true },
    ],
    members: [{ userId: 'ou-existing', roleId: 'role-growth',
      domains: [{ tag: '门店反馈', weight: 0.6, evidence: ['T-1'] }], adjacency: [] }],
    thresholds: { minMembersPerRole: 2, crossRoleRatioWarn: 0.3, overlapWarn: 0.5 } });
  await service.dispatch('roles-save', { registry, revision: null }, admin, opts);
  return (await service.dispatch('roles-view', {}, admin, opts)) as any;
}

test('只读预览去重、排除外部租户、部门缺 scope 时给出授权命令', async () => {
  const reader = stubReader([
    { open_id: 'ou_me', localized_name: '本人', is_activated: true, is_cross_tenant: false, department: '' },
    { open_id: 'ou_a', localized_name: '同事甲', is_activated: true, is_cross_tenant: false, department: '' },
    { open_id: 'ou_x', localized_name: '外部', is_activated: true, is_cross_tenant: true, department: '外部公司' },
  ]);
  const draft = await reader.preview();
  assert.equal(draft.available, true);
  assert.equal(draft.appId, 'cli_test');
  assert.deepEqual(draft.members.map(m => m.name), ['本人', '同事甲']);
  assert.equal(draft.departmentScopeMissing, true);
  assert.equal(draft.authorizationHint, ORG_AUTH_HINT);
  assert.match(draft.note, /不等于真人登录/);
});

test('部门字段可用时不报缺 scope；读取失败时返回结构化空草案而不是抛出', async () => {
  const ok = await stubReader([
    { open_id: 'ou_me', localized_name: '本人', is_activated: true, is_cross_tenant: false, department: '产品部' },
  ]).preview();
  assert.equal(ok.departmentScopeMissing, false);
  assert.equal(ok.authorizationHint, '');
  const failed = await stubReader([], true).preview();
  assert.equal(failed.available, false);
  assert.match(failed.reason ?? '', /scope missing/);
  assert.deepEqual(failed.members, []);
});

test('组织表严格校验：重复成员、非法职能 ID 都拒绝', () => {
  const entry = { userId: 'ou-1', name: '甲', roleId: 'role-growth', department: '增长部' };
  assert.equal(parseOrgTable([entry]).length, 1);
  assert.throws(() => parseOrgTable([entry, { ...entry, name: '乙' }]), /重复/);
  assert.throws(() => parseOrgTable([{ ...entry, roleId: 'BAD ID' }]));
  assert.throws(() => parseOrgTable([]));
});

test('草案不写注册表；导入需 admin、正确修订号、已存在的职能', async () => {
  const { service, audits } = setup(stubReader([
    { open_id: 'ou_me', localized_name: '本人', is_activated: true, is_cross_tenant: false, department: '' },
  ]));
  const before = await seed(service);

  const preview = await service.dispatch('org-mapping-preview', {}, admin, opts) as any;
  assert.equal(preview.draft.members.length, 1);
  assert.equal((await service.dispatch('roles-view', {}, admin, opts) as any).registry.version, before.registry.version);
  assert.ok(audits.includes('v06.org-mapping-preview'));

  const view = await service.dispatch('org-mapping-view', {}, admin, opts) as any;
  assert.equal(view.draft.members, 1);
  assert.equal(view.registeredMembers, 1);
  assert.match(view.note, /原生成员目录/);

  const entries = [
    { userId: 'ou-existing', name: '老成员', roleId: 'role-growth', department: '增长部' },
    { userId: 'ou-new', name: '新成员', roleId: 'role-product', department: '产研部', domains: ['客户方案'] },
  ];
  await assert.rejects(() => service.dispatch('org-mapping-apply', { entries, registryRevision: before.revision }, member, opts),
    /组织级 owner/);
  await assert.rejects(() => service.dispatch('org-mapping-apply', { entries, registryRevision: 'stale' }, admin, opts),
    /已变化/);
  await assert.rejects(() => service.dispatch('org-mapping-apply',
    { entries: [{ ...entries[1], roleId: 'role-missing' }], registryRevision: before.revision }, admin, opts),
    /不存在或已停用/);

  const applied = await service.dispatch('org-mapping-apply', { entries, registryRevision: before.revision }, admin, opts) as any;
  assert.equal(applied.registry.members, 2); // 原有 1 人 + 新增 1 人，已有成员不重复写入
  assert.equal(applied.record.source, 'feishu-org-table');
  const after = (await service.dispatch('roles-view', {}, admin, opts)) as any;
  assert.equal(after.registry.version, before.registry.version + 1);
  // 已有成员的派生领域与邻接能力不被组织表覆盖
  assert.deepEqual(after.registry.members.find((m: any) => m.userId === 'ou-existing').domains[0].tag, '门店反馈');
  assert.equal(after.registry.members.find((m: any) => m.userId === 'ou-new').roleId, 'role-product');
  assert.ok(audits.includes('v06.org-mapping-applied'));
});

test('组织映射 action 已登记到编排、只读白名单与工作台面板', () => {
  const v06 = read('src/v06.ts');
  const server = read('src/server.ts');
  const panels = read('plugins/knowledge-workspaces/src/ui/v06-panels.tsx');
  for (const action of ['org-mapping-preview', 'org-mapping-view', 'org-mapping-apply']) {
    assert.match(v06, new RegExp(`case '${action}'`));
  }
  assert.match(v06, /'org-mapping-apply', 'org-mapping-preview'/);
  assert.match(server, /'org-overview','org-mapping-view'/);
  assert.match(panels, /feishuOrg: '飞书组织映射'/);
});
