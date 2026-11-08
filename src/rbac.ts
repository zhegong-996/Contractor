/**
 * 第三十轮 P-12/P-13 · 统一的 casbin RBAC 封装（开源复用：npm casbin）。
 *
 * 人（console 用户）与 agent 共用同一份策略文件
 * （.runtime/console/rbac_policy.csv）：角色 -> 权限（act 统一 use，keyMatch
 * 通配）。绑定方式分两轨：
 *   - 人：启动与账号变更时把 user:<username> 绑到角色（g 段只在内存）；
 *   - agent：档位来自 agent registry 的职责（supervisor / worker / personal），
 *     运行时动态以档位角色判定，registry 变化即时生效，无需预绑定。
 *
 * fail-closed：未初始化（未 await initRbac）时一切判定返回 false。
 */
import { newEnforcer, newModel, FileAdapter, type Enforcer } from 'casbin';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runtime } from './config.ts';

/** 人的四级角色 + agent 的三个档位（与 agent registry 职责对应）。 */
export const RBAC_HUMAN_ROLES = ['owner', 'admin', 'operator', 'viewer'] as const;
export const RBAC_AGENT_TIERS = ['agent-supervisor', 'agent-worker', 'agent-personal'] as const;

/**
 * 权限矩阵种子：首次生成策略文件的依据；文件落地后以文件为准（可手工扩展，
 * 重启生效；删除文件即重置）。knowledge-* 是 P-13 知识写入链的分区权限。
 */
export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: ['read', 'knowledge-review', 'task-control', 'services-control', 'audit-view', 'feishu-auth', 'accounts-manage',
    'users-settings-view', 'knowledge-write-team', 'knowledge-write-org', 'knowledge-delete-org'],
  admin: ['read', 'knowledge-review', 'task-control', 'services-control', 'audit-view', 'feishu-auth',
    'users-settings-view', 'knowledge-write-team', 'knowledge-write-org', 'knowledge-delete-org'],
  operator: ['read', 'knowledge-review', 'task-control', 'knowledge-write-team'],
  viewer: ['read'],
  'agent-supervisor': ['read', 'knowledge-write-team', 'knowledge-write-org', 'knowledge-delete-org'],
  'agent-worker': ['read', 'knowledge-write-team'],
  'agent-personal': ['read'],
};

const RBAC_MODEL = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = (g(r.sub, p.sub) || r.sub == p.sub) && keyMatch(r.obj, p.obj) && r.act == p.act
`;

const policyPath = () => path.join(runtime('console'), 'rbac_policy.csv');

function seedPolicy(): string {
  const lines = [
    '# casbin RBAC 策略（角色 -> 权限，act 统一 use；keyMatch 支持 * 通配）',
    '# 首次由 ROLE_PERMISSIONS 种子生成；可手工扩展（加角色/加权限），重启生效；',
    '# 删除本文件即重置为种子。人与用户的绑定（g 段）不落文件：人以 accounts.json',
    '# 为准，agent 档位来自 agent registry 职责，运行时动态判定。',
  ];
  for (const role of [...RBAC_HUMAN_ROLES, ...RBAC_AGENT_TIERS])
    for (const perm of ROLE_PERMISSIONS[role] ?? []) lines.push(`p, ${role}, ${perm}, use`);
  return lines.join('\n') + '\n';
}

let sharedEnforcer: Enforcer | null = null;
let readyPromise: Promise<void> | null = null;

/** 初始化 enforcer（幂等）。两个进程（bridge / console）各调各的，读同一文件。 */
export async function initRbac(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (!existsSync(policyPath())) writeFileSync(policyPath(), seedPolicy(), { mode: 0o600 });
      sharedEnforcer = await newEnforcer(newModel(RBAC_MODEL), new FileAdapter(policyPath()));
    })().catch(error => { readyPromise = null; throw error; });
  }
  return readyPromise;
}

/** 同步判定；未初始化一律拒绝（fail-closed）。 */
export function rbacEnforce(sub: string, permission: string): boolean {
  if (!sharedEnforcer) return false;
  try { return sharedEnforcer.enforceSync(sub, permission, 'use'); } catch { return false; }
}

/** 人的绑定：g, user:<name>, <role>（内存，不落文件）。 */
export async function bindHuman(username: string, role: string): Promise<void> {
  if (!sharedEnforcer) return;
  await sharedEnforcer.addRoleForUser('user:' + username, role);
}

/** 清掉某人的全部绑定后重绑（账号角色变更时）。 */
export async function rebindHuman(username: string, role: string): Promise<void> {
  if (!sharedEnforcer) return;
  const sub = 'user:' + username;
  for (const r of await sharedEnforcer.getRolesForUser(sub)) await sharedEnforcer.deleteRoleForUser(sub, r);
  await sharedEnforcer.addRoleForUser(sub, role);
}

/**
 * 判定前自愈：bridge / console 是两个进程，bridge 的绑定是启动快照；
 * 新建或改角色的账号在 bridge 判定前按 accounts.json 现绑（带缓存）。
 */
const knownHumans = new Set<string>();
export async function ensureHumanBound(username: string): Promise<void> {
  if (!sharedEnforcer || knownHumans.has(username)) return;
  const { ConsoleAuth } = await import('./console-auth.ts');
  const account = new ConsoleAuth().listAccounts().find(a => a.username === username);
  if (account) { await rebindHuman(username, account.role); knownHumans.add(username); }
}

/** 把账号文件的现状同步进内存绑定（启动时）。 */
export async function syncHumans(accounts: Array<{ username: string; role: string }>): Promise<void> {
  if (!sharedEnforcer) return;
  for (const rule of await sharedEnforcer.getGroupingPolicy()) await sharedEnforcer.removeGroupingPolicy(...rule);
  for (const a of accounts) await sharedEnforcer.addRoleForUser('user:' + a.username, a.role);
}

/** 策略文件当前内容（管理后台展示用）。 */
export function rbacPolicyText(): string {
  return existsSync(policyPath()) ? readFileSync(policyPath(), 'utf8') : seedPolicy();
}
