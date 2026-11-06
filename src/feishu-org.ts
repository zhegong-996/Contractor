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
import { z } from 'zod';
import { roleIdSchema } from './roles.ts';

const execute = promisify(execFile);

/** 管理员补齐通讯录/部门读取范围的一次性授权命令（需本人在飞书确认）。 */
export const ORG_AUTH_HINT =
  'lark-cli auth login --scope "contact:contact.base:readonly contact:department.organize:readonly" --no-wait --json';

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
  authorizationHint: string;
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
  constructor(private readonly command: (args: string[]) => Promise<any> = defaultCommand) {}

  /** 只读预览：不写注册表、不改派单。失败也返回结构化草案，不把工作台打挂。 */
  async preview(includeChatted = true): Promise<OrgMappingDraft> {
    const generatedAt = new Date().toISOString();
    let appId: string | null = null;
    try {
      const status = await this.command(['auth', 'status', '--json', '--verify']);
      appId = String(status?.appId ?? '') || null;
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

    const list = [...members.values()];
    const departmentScopeMissing = list.length > 0 && list.every(member => !member.department);
    return {
      schemaVersion: 1, generatedAt, available: list.length > 0,
      ...(list.length === 0 && lastFailure ? { reason: lastFailure } : {}),
      source: 'lark-cli contact +search-user（当前已授权的 user 身份，最小可见范围）',
      appId, departmentScopeMissing,
      authorizationHint: departmentScopeMissing ? ORG_AUTH_HINT : '',
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
