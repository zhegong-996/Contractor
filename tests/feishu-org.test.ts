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
import { FeishuOrgService, parseOrgTable, ORG_AUTH_HINT,
  orgAuthCommand, missingOrgScopes, ORG_SCOPE_ADDITIONS } from '../src/feishu-org.ts';
import { registrySchema } from '../src/roles.ts';

const at = '2026-11-06T10:00:00.000Z';
const opts = { workbenchUrl: 'http://127.0.0.1:4180', channel: 'workspace' as const, actorUserId: 'org-owner' };
const admin = { admin: true, userId: 'org-owner' };
const member = { admin: false, userId: 'someone' };
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
/** 部门权限已补齐时的 scope 集合（既有 + 两个新增）。 */
const scopes = ['contact:user.base:readonly', ...ORG_SCOPE_ADDITIONS];

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

test('部门接口能补全没聊过的同事；部门权限到位后不再误报缺授权', async () => {
  // 真实形态：通讯录里 4 个人，只有 2 个聊过天。只靠 --has-chatted 会漏人。
  const full = new FeishuOrgService(async (args: string[]) => {
    if (args[0] === 'auth') return { appId: 'cli_test', identities: { user: { scope: scopes.join(' ') } } };
    if (args[0] === 'api') {
      const params = JSON.parse(args[4]);
      if (args[2].endsWith('/departments')) return { ok: true, data: { items: [{ open_department_id: 'od_p', name: '产品部' }] } };
      return params.department_id === 'od_p'
        ? { ok: true, data: { items: [{ open_id: 'ou_a', name: '甲' }] } }
        : { ok: true, data: { items: [{ open_id: 'ou_me', name: '我' }] } };
    }
    return { ok: true, data: { users: [{ open_id: 'ou_me', localized_name: '我', is_activated: true, department: '' }] } };
  });
  const draft = await full.preview();
  assert.equal(draft.departmentStructure, 'tree');
  assert.equal(draft.departmentScopeMissing, false);
  assert.equal(draft.authorizationHint, '');
  assert.deepEqual(draft.missingScopes, []);
  // 甲没聊过天，靠部门接口读出来；部门名按树归位。
  assert.deepEqual(draft.members.map(m => m.name).sort(), ['我', '甲']);
  assert.equal(draft.members.find(m => m.openId === 'ou_a')?.department, '产品部');
  // 根部门成员没有子部门，department 保持 null；不能被编造成某个部门。
  assert.equal(draft.members.find(m => m.openId === 'ou_me')?.department, null);
  assert.match(draft.departmentNote ?? '', /2 个部门|1 个部门/);
});

test('租户没建子部门时如实说「组织现状」，不催人重复授权', async () => {
  // 真实形态：scope 齐了，但部门树为空、全员挂根部门。这不是缺权限。
  const flat = new FeishuOrgService(async (args: string[]) => {
    if (args[0] === 'auth') return { appId: 'cli_test', identities: { user: { scope: scopes.join(' ') } } };
    if (args[0] === 'api') {
      const params = JSON.parse(args[4]);
      if (args[2].endsWith('/departments')) return { ok: true, data: { items: [] } };
      return { ok: true, data: { items: [{ open_id: 'ou_a', name: '甲' }, { open_id: 'ou_b', name: '乙' }] } };
    }
    return { ok: true, data: { users: [] } };
  });
  const draft = await flat.preview();
  assert.equal(draft.departmentStructure, 'flat');
  assert.equal(draft.departmentScopeMissing, false, '缺权限和没建部门必须分开报');
  assert.equal(draft.authorizationHint, '');
  assert.match(draft.departmentNote ?? '', /不是权限缺失/);
  assert.deepEqual(draft.members.map(m => m.name), ['甲', '乙']);
  // 部门名留空，不编一个「未分组」之类的假部门。
  assert.ok(draft.members.every(m => m.department === null));
});

test('部门树读不到时如实标 unknown，成员仍按其它来源给出', async () => {
  const broken = new FeishuOrgService(async (args: string[]) => {
    if (args[0] === 'auth') return { appId: 'cli_test', identities: { user: { scope: scopes.join(' ') } } };
    if (args[0] === 'api') return { ok: false, error: { message: 'no permission' } };
    return { ok: true, data: { users: [{ open_id: 'ou_me', localized_name: '我', is_activated: true, department: '' }] } };
  });
  const draft = await broken.preview();
  assert.equal(draft.departmentStructure, 'unknown');
  assert.match(draft.departmentNote ?? '', /no permission/);
  assert.deepEqual(draft.members.map(m => m.name), ['我']);
});

test('补部门权限时携带现有全部 scope，不会把已有授权清空', () => {
  const granted = 'contact:user.base:readonly im:message docs:document.content:read';
  assert.deepEqual(missingOrgScopes(granted), [...ORG_SCOPE_ADDITIONS]);
  const command = orgAuthCommand(granted.split(' '));
  assert.match(command, /contact:user\.base:readonly/);
  assert.match(command, /im:message/);
  assert.match(command, /docs:document\.content:read/);
  for (const scope of ORG_SCOPE_ADDITIONS) assert.match(command, new RegExp(scope.replaceAll('.', '\\.')));
  // 不是「只传两个新 scope」的危险命令。
  assert.notEqual((command.match(/contact:/g) ?? []).length, 2);
  assert.deepEqual(missingOrgScopes([...ORG_SCOPE_ADDITIONS]), []);
});

test('组织 owner 确认已离职的成员不会重新出现在草案里', async () => {
  const reader = new FeishuOrgService(async (args: string[]) => {
    if (args[0] === 'auth') return { appId: 'cli_test', identities: { user: { scope: 'contact:user.base:readonly' } } };
    return { ok: true, data: { users: args.includes('me')
      ? [{ open_id: 'ou_me', localized_name: '本人', is_activated: true, department: '' }]
      : [{ open_id: 'ou_me', localized_name: '本人', is_activated: true, department: '' },
         { open_id: 'ou_gone', localized_name: '已离职', is_activated: true, department: '' }] } };
  }, () => ({ schemaVersion: 1, updatedAt: at, actor: 'org-owner',
    excluded: [{ name: '已离职', openId: 'ou_gone', reason: '组织 owner 确认已不在组织内', at }], note: '' }));
  const draft = await reader.preview();
  assert.deepEqual(draft.members.map(m => m.name), ['本人']);
  assert.deepEqual(draft.excludedByOwner?.map(e => e.name), ['已离职']);
  assert.equal(draft.departmentScopeMissing, true);
  assert.match(draft.authorizationCommand ?? '', /contact:user\.base:readonly/);
  assert.deepEqual(draft.missingScopes, [...ORG_SCOPE_ADDITIONS]);
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
