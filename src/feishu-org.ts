/**
 * 飞书组织映射（v0.6 FR-01/02 的组织落地补充）。
 *
 * 产品只规定「怎么划」：每人一个稳定主职能、领域随任务流动、邻接能力低权重。
 * 划几摊、叫什么、谁属于哪摊，由组织自己决定 —— 因此这里不内置部门名单，
 * 而是把飞书真实成员读成一份**草案**，人工确认后才写入职能注册表。
 *
 * 边界（必须保持）：
 * - 只读取当前已授权范围可见的成员；部门字段缺 scope 时如实报告，不编造。
 * - open_id 按应用隔离：机器人应用与用户授权应用的 open_id 不通用，
 *   跨应用绑定必须由管理员按姓名/工号显式确认，不自动合并。
 * - 草案不参与派单；成员映射 ≠ 真人登录，登录仍走原生成员目录与配对。
 * - 真实姓名与 open_id 只写本机 `.runtime/v06/`，不提交仓库。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { roleIdSchema } from './roles.ts';
import { runtime } from './config.ts';

const execute = promisify(execFile);

/** 管理员补齐通讯录/部门读取范围的一次性授权命令（需本人在飞书确认）。 */
export const ORG_AUTH_HINT =
  'lark-cli auth login --scope "contact:contact.base:readonly contact:department.organize:readonly" --no-wait --json';

/** 读取部门字段必须新增的两个 scope。 */
export const ORG_SCOPE_ADDITIONS = [
  'contact:contact.base:readonly', 'contact:department.organize:readonly',
] as const;

/**
 * 飞书 OAuth 重新登录会把 scope 集合整体替换成这次传入的值。
 * 因此补部门权限时必须把当前已授予的全部 scope 一起带上，
 * 否则 ORG_AUTH_HINT 那种「只传两个新 scope」的命令会清空现有 100+ 权限。
 */
export function normaliseScopes(value: string | string[] | undefined): string[] {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/\s+/);
  return [...new Set(parts.map(s => String(s).trim()).filter(Boolean))];
}
export function missingOrgScopes(grantedScopes: string | string[] | undefined): string[] {
  const granted = new Set(normaliseScopes(grantedScopes));
  return ORG_SCOPE_ADDITIONS.filter(scope => !granted.has(scope));
}
export function orgAuthCommand(grantedScopes: string | string[] | undefined): string {
  const scopes = [...normaliseScopes(grantedScopes), ...missingOrgScopes(grantedScopes)];
  return `lark-cli auth login --scope "${scopes.join(' ')}" --no-wait --json`;
}

/** 组织 owner 的人工核对结论（排除已离职成员、跨应用 ID 绑定）只落本机。 */
export interface OwnerExclusion {
  name: string;
  openId?: string;
  reason: string;
  at: string;
}
export interface OwnerDecisions {
  schemaVersion: 1;
  updatedAt: string;
  actor: string;
  excluded: OwnerExclusion[];
  note: string;
}
export function readOwnerDecisions(dir: string = runtime('v06')): OwnerDecisions | null {
  try {
    const file = `${dir}/org-owner-decisions.json`;
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as OwnerDecisions : null;
  } catch { return null; }
}

export interface FeishuOrgMember {
  openId: string;
  name: string;
  activated: boolean;
  department: string | null;
  /** open_id 只在签发它的应用内有效。 */
  idScope: 'app-open-id';
  appId: string | null;
}

export interface OrgMappingDraft {
  schemaVersion: 1;
  generatedAt: string;
  available: boolean;
  reason?: string;
  source: string;
  appId: string | null;
  departmentScopeMissing: boolean;
  /** 简短提示，保持既有调用方兼容；真正可执行的全量命令见 authorizationCommand。 */
  authorizationHint: string;
  /** 携带当前全部已授权 scope + 缺失 scope 的登录命令，不会冲掉已有权限。 */
  authorizationCommand?: string;
  grantedScopes?: string[];
  missingScopes?: string[];
  /** owner 已确认不在组织内、被本轮草案主动排除的成员。 */
  excludedByOwner?: OwnerExclusion[];
  members: FeishuOrgMember[];
  note: string;
}

async function defaultCommand(args: string[]): Promise<any> {
  const { stdout } = await execute('lark-cli', args, {
    timeout: 25000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
  });
  return JSON.parse(stdout);
}

export class FeishuOrgService {
  constructor(
    private readonly command: (args: string[]) => Promise<any> = defaultCommand,
    /** 可注入组织 owner 的人工核对结论，便于在测试里验证离职成员不会被带回草案。 */
    private readonly decisions: () => OwnerDecisions | null = () => readOwnerDecisions(),
  ) {}

  /** 只读预览：不写注册表、不改派单。失败也返回结构化草案，不把工作台打挂。 */
  async preview(includeChatted = true): Promise<OrgMappingDraft> {
    const generatedAt = new Date().toISOString();
    let appId: string | null = null;
    let grantedScopes: string[] = [];
    try {
      const status = await this.command(['auth', 'status', '--json', '--verify']);
      appId = String(status?.appId ?? '') || null;
      grantedScopes = normaliseScopes(status?.identities?.user?.scope ?? status?.scope);
    } catch { /* 身份信息缺失不影响成员读取，草案里如实标 null */ }

    const calls: string[][] = [
      ['contact', '+search-user', '--as', 'user', '--user-ids', 'me', '--format', 'json'],
    ];
    if (includeChatted) calls.push(
      ['contact', '+search-user', '--as', 'user', '--has-chatted', '--page-size', '30', '--format', 'json']);

    const members = new Map<string, FeishuOrgMember>();
    let lastFailure = '';
    for (const args of calls) {
      try {
        const response = await this.command(args);
        if (response?.ok !== true) { lastFailure = String(response?.error?.message ?? '飞书成员读取失败'); continue; }
        for (const user of response?.data?.users ?? []) {
          if (!user?.open_id || user.is_cross_tenant) continue;
          members.set(user.open_id, {
            openId: String(user.open_id), name: String(user.localized_name || user.open_id),
            activated: user.is_activated !== false,
            department: user.department ? String(user.department) : null,
            idScope: 'app-open-id', appId,
          });
        }
      } catch (error) { lastFailure = String((error as Error).message ?? error); }
    }

    // 组织 owner 已确认不在组织内的成员（例如已离职）不再出现在草案里，
    // 否则 --has-chatted 会把历史会话里的人反复带回来。
    const excluded = this.decisions()?.excluded ?? [];
    const matchesExclusion = (member: FeishuOrgMember) => excluded.some(item =>
      (item.openId && item.openId === member.openId) || item.name === member.name);
    const all = [...members.values()];
    const list = all.filter(member => !matchesExclusion(member));
    const excludedByOwner = excluded.filter(item => all.some(member =>
      (item.openId && item.openId === member.openId) || item.name === member.name));
    const departmentScopeMissing = list.length > 0 && list.every(member => !member.department);
    return {
      schemaVersion: 1, generatedAt, available: list.length > 0,
      ...(list.length === 0 && lastFailure ? { reason: lastFailure } : {}),
      source: 'lark-cli contact +search-user（当前已授权的 user 身份，最小可见范围）',
      appId, departmentScopeMissing,
      authorizationHint: departmentScopeMissing ? ORG_AUTH_HINT : '',
      authorizationCommand: orgAuthCommand(grantedScopes),
      grantedScopes,
      missingScopes: missingOrgScopes(grantedScopes),
      ...(excludedByOwner.length ? { excludedByOwner } : {}),
      members: list,
      note: '只读取当前授权范围可见的成员；open_id 按应用隔离，跨应用需管理员按姓名/工号确认后再绑定。草案不参与派单，必须人工确认才写入职能注册表；成员映射不等于真人登录。',
    };
  }
}

/** 管理员导出的组织表：没有通讯录 scope 时的正式离线路径，字段严格校验。 */
export const orgEntrySchema = z.object({
  /** 写入注册表的稳定成员标识；跨应用时由管理员显式指定，不从 open_id 猜测。 */
  userId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
  roleId: roleIdSchema,
  department: z.string().trim().max(120).optional(),
  /** 领域证据只作低权重提示，不覆盖已有派生领域。 */
  domains: z.array(z.string().trim().min(1)).max(12).default([]),
}).strict();
export type OrgEntry = z.infer<typeof orgEntrySchema>;

export function parseOrgTable(input: unknown): OrgEntry[] {
  const parsed = z.array(orgEntrySchema).min(1).max(200).parse(input);
  if (new Set(parsed.map(entry => entry.userId)).size !== parsed.length) throw new Error('组织表中成员标识重复');
  return parsed;
}
