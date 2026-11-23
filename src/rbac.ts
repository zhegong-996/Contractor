import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { protocolMatches } from './workbench/compatibility.ts';
import { runtime } from './config.ts';

/** 人的四级角色 + agent 的三个档位（与 agent registry 职责对应）。 */
export const RBAC_HUMAN_ROLES = ['owner', 'admin', 'operator', 'viewer'] as const;
export const RBAC_AGENT_TIERS = ['agent-supervisor', 'agent-worker', 'agent-personal'] as const;
const workbenchPolicyRevision = '# contractor-platform-capabilities-v1';
const workbenchMembersRevision = '# contractor-platform-capabilities-v2';

/**
 * 权限矩阵种子：首次生成策略文件的依据；文件落地后以文件为准（可手工扩展，
 * 重启生效；删除文件即重置）。knowledge-* 是 P-13 知识写入链的分区权限。
 */
export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: ['read', 'knowledge-review', 'task-control', 'services-control', 'audit-view', 'feishu-auth', 'accounts-manage',
    'users-settings-view', 'knowledge-write-team', 'knowledge-write-org', 'knowledge-delete-org', 'project-create', 'platform-quota-admin'],
  admin: ['read', 'knowledge-review', 'task-control', 'services-control', 'audit-view', 'feishu-auth',
    'users-settings-view', 'knowledge-write-team', 'knowledge-write-org', 'knowledge-delete-org', 'project-create', 'platform-quota-admin', 'workspace-members-admin'],
  operator: ['read', 'knowledge-review', 'task-control', 'knowledge-write-team'],
  viewer: ['read'],
  'agent-supervisor': ['read', 'knowledge-write-team', 'knowledge-write-org', 'knowledge-delete-org'],
  'agent-worker': ['read', 'knowledge-write-team'],
  'agent-personal': ['read'],
};

const policyPath = () => path.join(runtime('console'), 'rbac_policy.csv');

function seedPolicy(): string {
  const lines = [
    workbenchPolicyRevision,
    workbenchMembersRevision,
    '# Contractor 权限策略。p, 角色, 权限, use。权限可用 * 匹配前缀。',
    '# 文件从默认矩阵初始化，修改后重启生效。成员角色以 accounts.json 为准。',
  ];
  for (const role of [...RBAC_HUMAN_ROLES, ...RBAC_AGENT_TIERS])
    for (const perm of ROLE_PERMISSIONS[role] ?? []) lines.push(`p, ${role}, ${perm}, use`);
  return lines.join('\n') + '\n';
}

let permissions: Map<string, Set<string>> | undefined;
const humanRoles = new Map<string, string>();
let readyPromise: Promise<void> | null = null;

function csvFields(line: string) {
  const fields = line.split(',').map(field => field.trim());
  return fields.map(field => field.startsWith('"') && field.endsWith('"') ? field.slice(1, -1) : field);
}

function readPolicy(content: string) {
  const policies = new Map<string, Set<string>>();
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [kind, subject, permission, action, ...extra] = csvFields(line);
    // Earlier deployments also rebuilt grouping rules from accounts at startup.
    if (kind === 'g') continue;
    if (kind !== 'p' || !subject || !permission || !action || extra.length)
      throw new Error('权限策略第 ' + (index + 1) + ' 行无效，请使用 p, 角色, 权限, use。');
    if (action !== 'use') continue;
    const allowed = policies.get(subject) ?? new Set<string>();
    allowed.add(permission);
    policies.set(subject, allowed);
  }
  return policies;
}

function migrateWorkbenchPolicy(file: string) {
  const current = readFileSync(file, 'utf8');
  const lines = current.split(/\r?\n/).map(line => line.trim());
  const hasFirst = lines.some(line => protocolMatches(line, workbenchPolicyRevision));
  const hasSecond = lines.some(line => protocolMatches(line, workbenchMembersRevision));
  if (hasFirst && hasSecond) return;
  const rules = current.split(/\r?\n/).map(csvFields);
  const has = (role: string, permission: string) => rules.some(([kind, subject, object, act]) =>
    kind === 'p' && subject === role && object === permission && act === 'use');
  const additions = hasFirst ? [] : ['owner', 'admin'].flatMap(role => {
    if (!has(role, 'services-control')) return [];
    return [
      ...(!has(role, 'project-create') && has(role, 'task-control') ? [`p, ${role}, project-create, use`] : []),
      ...(!has(role, 'platform-quota-admin') ? [`p, ${role}, platform-quota-admin, use`] : []),
    ];
  });
  if (!hasSecond && has('admin', 'services-control') && !has('admin', 'workspace-members-admin'))
    additions.push('p, admin, workspace-members-admin, use');
  const temporary = file + '.migration-' + process.pid;
  writeFileSync(temporary, [current.trimEnd(), ...(!hasFirst ? [workbenchPolicyRevision] : []),
    ...(!hasSecond ? [workbenchMembersRevision] : []), ...additions, ''].join('\n'), { mode: 0o600 });
  renameSync(temporary, file);
}

/** Load the platform policy once. Project membership and data grants are checked separately. */
export async function initRbac(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const file = policyPath();
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      if (!existsSync(file)) writeFileSync(file, seedPolicy(), { mode: 0o600 });
      else migrateWorkbenchPolicy(file);
      permissions = readPolicy(readFileSync(file, 'utf8'));
    })().catch(error => { readyPromise = null; throw error; });
  }
  return readyPromise;
}

/** 同步判定；未初始化一律拒绝（fail-closed）。 */
export function rbacEnforce(sub: string, permission: string): boolean {
  const loaded = permissions;
  if (!loaded) return false;
  const granted = (subject: string) => {
    const rules = loaded.get(subject);
    if (rules?.has(permission)) return true;
    return !!rules && [...rules].some(rule => {
      const wildcard = rule.indexOf('*');
      return wildcard >= 0 && permission.startsWith(rule.slice(0, wildcard));
    });
  };
  const role = humanRoles.get(sub);
  if (sub.startsWith('user:') && !role) return false;
  return granted(sub) || !!role && granted(role);
}

export function bindHuman(username: string, role: string) {
  if (permissions) humanRoles.set('user:' + username, role);
}

export function syncHumans(accounts: Array<{ username: string; role: string; disabled?: boolean }>) {
  humanRoles.clear();
  for (const account of accounts) if (!account.disabled) bindHuman(account.username, account.role);
}

/** 策略文件当前内容（管理后台展示用）。 */
export function rbacPolicyText(): string {
  return existsSync(policyPath()) ? readFileSync(policyPath(), 'utf8') : seedPolicy();
}
