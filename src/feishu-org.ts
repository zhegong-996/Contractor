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
import { loadConfig, runtime } from './config.ts';

const execute = promisify(execFile);

/**
 * 补齐通讯录/部门读取范围的做法。
 * 不要写成裸的 `lark-cli auth login --scope "…"`：飞书重新登录会把 scope 集合
 * 整体替换成这次传入的值，只传两个新 scope 会清空已有权限。走脚本才会带上全量。
 */
export const ORG_AUTH_HINT =
  'npm run org:auth（带当前已授权的全部 scope，避免整体替换）';

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

/** 部门树节点；根部门不在此列（根用 id '0' 单独读）。 */
export interface DepartmentNode {
  id: string;
  name: string;
  parentId: string | null;
}

export type DepartmentStructure = 'tree' | 'flat' | 'unknown';

export interface OrgMappingDraft {
  schemaVersion: 1;
  generatedAt: string;
  available: boolean;
  reason?: string;
  source: string;
  /** 这次读组织用的应用（lark-cli 的 profile 决定）。 */
  appId: string | null;
  /** 真正收消息、发派单的机器人应用。 */
  botAppId?: string | null;
  /**
   * 读组织的应用 ≠ 收消息的机器人应用时为 true。
   * 两个应用的 open_id 不通用：这种情况下草案里的人「在册但派单时匹配不上」，
   * 必须先把机器人应用的通讯录权限补齐再重读，不能直接导入。
   */
  idScopeMismatch?: boolean;
  idScopeNote?: string;
  /**
   * 只在「确实缺部门读取 scope 且一个人都读不到部门」时为 true。
   * 空部门不等于缺权限：租户可以根本没建子部门，成员都挂根部门下。
   * 两种情况必须分开报，否则会推着管理员去重复授权一个已经到位的权限。
   */
  departmentScopeMissing: boolean;
  /** 部门结构实况：tree 有子部门、flat 全员挂根、unknown 读不到（含失败原因）。 */
  departmentStructure?: DepartmentStructure;
  /** 对 departmentStructure 的中文解释，给工作台直接显示。 */
  departmentNote?: string;
  /** 简短提示，保持既有调用方兼容；真正可执行的全量命令见 authorizationCommand。 */
  authorizationHint: string;
  /** 飞书开放平台的权限申请页：把缺的 scope 直接填好，省得人翻权限列表。 */
  authorizationUrl?: string;
  /** 携带当前全部已授权 scope + 缺失 scope 的登录命令，不会冲掉已有权限。 */
  authorizationCommand?: string;
  grantedScopes?: string[];
  missingScopes?: string[];
  /** owner 已确认不在组织内、被本轮草案主动排除的成员。 */
  excludedByOwner?: OwnerExclusion[];
  members: FeishuOrgMember[];
  note: string;
}

/**
 * open_id 只在签发它的应用内有效。读组织用的应用（lark-cli 的 profile）
 * 必须与收消息的机器人应用是同一个，否则 id 到了派单环节匹配不上。
 */
export function idScopeVerdict(appId: string | null, botAppId: string | null):
  { mismatch: boolean; note: string } {
  if (!appId || !botAppId || appId === botAppId) return { mismatch: false, note: '' };
  return {
    mismatch: true,
    note: `读组织用的是应用 ${appId}，而收消息的机器人是 ${botAppId}。`
      + 'open_id 按应用隔离，同一个人在两个应用下的 open_id 不同；'
      + '直接导入会得到「人在册、派单匹配不上」的结果。需先给机器人应用补齐通讯录权限，再用它的身份重读。',
  };
}

function botAppIdOf(): string | null {
  try { return loadConfig().feishu?.appId || null; } catch { return null; }
}

/** lark-cli 的 profile 决定用哪个应用的身份；必须显式带上，否则会落到默认 profile 的另一个应用。 */
export function larkArgs(profile: string | null | undefined, args: string[]): string[] {
  return profile ? ['--profile', profile, ...args] : [...args];
}

function profileOf(): string | null {
  try { return loadConfig().feishu?.profile || null; } catch { return null; }
}

/** 飞书开放平台的权限申请页，直接把缺的 scope 填进去，省得人去翻权限列表。 */
export function scopeApplyUrl(appId: string | null, scopes: readonly string[]): string {
  if (!appId || scopes.length === 0) return '';
  return `https://open.feishu.cn/page/scope-apply?clientID=${appId}&scopes=${encodeURIComponent(scopes.join(','))}`;
}

async function defaultCommand(args: string[]): Promise<any> {
  const { stdout } = await execute('lark-cli', larkArgs(profileOf(), args), {
    timeout: 25000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
  });
  return JSON.parse(stdout);
}

/** lark-cli 在 API 报错时会以非零码退出，把整段 stderr 抛出来；这里只取里面的错误正文。 */
export function conciseCliError(raw: unknown): string {
  const text = String((raw as Error)?.message ?? raw ?? '');
  const match = text.match(/"message"\s*:\s*"([^"]+)"/);
  if (match) return match[1]!;
  const first = text.split('\n').map(line => line.trim()).filter(Boolean)[0] ?? '';
  return first.slice(0, 160) || '通讯录读取失败';
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
    const botAppId = botAppIdOf();
    const scopeVerdict = idScopeVerdict(appId, botAppId);

    const calls: string[][] = [
      ['contact', '+search-user', '--as', 'user', '--user-ids', 'me', '--format', 'json'],
    ];
    if (includeChatted) calls.push(
      ['contact', '+search-user', '--as', 'user', '--has-chatted', '--page-size', '30', '--format', 'json']);

    const members = new Map<string, FeishuOrgMember>();
    let lastFailure = '';
    /** 后写入的同一个人不覆盖已有部门名：部门接口比聊天记录更权威。 */
    const remember = (openId: string, name: string, activated: boolean, department: string | null) => {
      const previous = members.get(openId);
      members.set(openId, {
        openId, name, activated,
        department: department ?? previous?.department ?? null,
        idScope: 'app-open-id', appId,
      });
    };
    for (const args of calls) {
      try {
        const response = await this.command(args);
        if (response?.ok !== true) { lastFailure = String(response?.error?.message ?? '飞书成员读取失败'); continue; }
        for (const user of response?.data?.users ?? []) {
          if (!user?.open_id || user.is_cross_tenant) continue;
          remember(String(user.open_id), String(user.localized_name || user.open_id),
            user.is_activated !== false, user.department ? String(user.department) : null);
        }
      } catch (error) { lastFailure = String((error as Error).message ?? error); }
    }

    // 部门接口比「聊过天的人」更全：拿到部门 scope 后，通讯录里没聊过的同事也能读到。
    // 读不到不算失败——没有部门权限时这条路本来就该空着，由下面的判据如实说明。
    const tree = await this.readDepartments();
    const structures: DepartmentStructure = !tree.ok
      ? 'unknown' : tree.nodes.length === 0 ? 'flat' : 'tree';
    if (tree.ok) {
      for (const node of tree.nodes) {
        for (const person of await this.readDepartmentMembers(node.id)) {
          if (person.crossTenant) continue;
          remember(person.openId, person.name, person.activated, node.name);
        }
      }
      // 根部门直属成员（扁平租户的全部成员都在这里），部门名留空而不是编一个。
      for (const person of await this.readDepartmentMembers('0')) {
        if (person.crossTenant) continue;
        remember(person.openId, person.name, person.activated, null);
      }
    }
    if (!tree.ok && tree.error) lastFailure ||= tree.error;

    // 组织 owner 已确认不在组织内的成员（例如已离职）不再出现在草案里，
    // 否则 --has-chatted 会把历史会话里的人反复带回来。
    const excluded = this.decisions()?.excluded ?? [];
    const matchesExclusion = (member: FeishuOrgMember) => excluded.some(item =>
      (item.openId && item.openId === member.openId) || item.name === member.name);
    const all = [...members.values()];
    const list = all.filter(member => !matchesExclusion(member));
    const excludedByOwner = excluded.filter(item => all.some(member =>
      (item.openId && item.openId === member.openId) || item.name === member.name));
    const scopeMissing = missingOrgScopes(grantedScopes);
    /**
     * 空部门有两种原因，不能混为一谈：
     * - 缺 scope：确实没权限，给授权命令；
     * - 权限齐了但租户没建子部门：全员挂根部门，这是组织事实，不该催人重复授权。
     */
    const nobodyHasDepartment = list.length > 0 && list.every(member => !member.department);
    /** 部门树读不到 + 确实缺 scope，才判定缺权限；租户扁平不算。 */
    const departmentScopeMissing = scopeMissing.length > 0 && (!tree.ok || nobodyHasDepartment);
    /** 部门树压根读不到：多半是应用侧没开通讯录权限，直接给开放平台的申请页。 */
    const needsScopeGrant = !tree.ok || scopeMissing.length > 0;
    const authorizationUrl = needsScopeGrant
      ? scopeApplyUrl(botAppId ?? appId, scopeMissing.length > 0 ? scopeMissing : [...ORG_SCOPE_ADDITIONS])
      : '';
    return {
      schemaVersion: 1, generatedAt, available: list.length > 0,
      ...(list.length === 0 && lastFailure ? { reason: lastFailure } : {}),
      source: 'lark-cli contact（通讯录部门树 + 聊过的人，当前已授权的 user 身份，最小可见范围）',
      appId, departmentScopeMissing,
      botAppId,
      ...(scopeVerdict.mismatch ? { idScopeMismatch: true, idScopeNote: scopeVerdict.note } : {}),
      departmentStructure: structures,
      departmentNote: departmentNoteOf(structures, tree.nodes.length, tree.error),
      authorizationHint: departmentScopeMissing || !tree.ok ? ORG_AUTH_HINT : '',
      ...(authorizationUrl ? { authorizationUrl } : {}),
      authorizationCommand: orgAuthCommand(grantedScopes),
      grantedScopes,
      missingScopes: scopeMissing,
      ...(excludedByOwner.length ? { excludedByOwner } : {}),
      members: list,
      note: '只读取当前授权范围可见的成员；open_id 按应用隔离，跨应用需管理员按姓名/工号确认后再绑定。草案不参与派单，必须人工确认才写入职能注册表；成员映射不等于真人登录。',
    };
  }

/**
 * 通讯录读取的身份顺序：先用机器人应用自己的身份，失败再退到 user 身份。
   * 机器人身份不需要有人扫码登录，而且拿到的 open_id 与收消息时是同一个应用，
   * 可以直接用于派单匹配 —— 这正是之前缺的那一环。
   */
  private async contactRead(path: string, params: Record<string, unknown>): Promise<any> {
    let last: any = null;
    for (const identity of ['bot', 'user']) {
      try {
        const response = await this.command(['api', 'GET', path, '--params', JSON.stringify(params),
          '--as', identity, '--format', 'json']);
        if (response?.ok === true) return response;
        last = response;
      } catch (error) { last ??= { ok: false, error: { message: conciseCliError(error) } }; }
    }
    return last ?? { ok: false, error: { message: '通讯录读取失败' } };
  }

  /** 部门树（不含根部门）。失败不抛出：返回 ok:false 与原因，由调用方如实写进草案。 */
  private async readDepartments(): Promise<{ ok: boolean; nodes: DepartmentNode[]; error: string }> {
    try {
      const response = await this.contactRead('/open-apis/contact/v3/departments',
        { parent_department_id: '0', fetch_child: true, page_size: 50,
          department_id_type: 'open_department_id', user_id_type: 'open_id' });
      if (response?.ok !== true)
        return { ok: false, nodes: [], error: String(response?.error?.message ?? '部门树读取失败') };
      const nodes = (response?.data?.items ?? [])
        .filter((item: any) => item?.open_department_id)
        .map((item: any) => ({
          id: String(item.open_department_id),
          name: String(item.name ?? item.open_department_id),
          parentId: item.parent_department_id ? String(item.parent_department_id) : null,
        }));
      return { ok: true, nodes, error: '' };
    } catch (error) {
      return { ok: false, nodes: [], error: conciseCliError(error) };
    }
  }

  /** 某部门的直属成员；'0' 是根部门。读失败返回空数组，不阻断其它来源。 */
  private async readDepartmentMembers(departmentId: string): Promise<{
    openId: string; name: string; activated: boolean; crossTenant: boolean;
  }[]> {
    try {
      const response = await this.contactRead('/open-apis/contact/v3/users/find_by_department',
        { department_id: departmentId, department_id_type: 'open_department_id',
          user_id_type: 'open_id', page_size: 50 });
      if (response?.ok !== true) return [];
      return (response?.data?.items ?? [])
        .filter((item: any) => item?.open_id)
        .map((item: any) => ({
          openId: String(item.open_id),
          name: String(item.name ?? item.open_id),
          activated: item.is_activated !== false,
          crossTenant: item.is_cross_tenant === true,
        }));
    } catch { return []; }
  }
}

/** 部门结构的中文说明：把「没权限」和「没建部门」说成两句不同的话。 */
export function departmentNoteOf(
  structure: DepartmentStructure, nodeCount: number, error: string,
): string {
  if (structure === 'tree') return `读到 ${nodeCount} 个部门，成员按部门归位。`;
  if (structure === 'flat') return '这个租户没有建子部门，所有成员都挂在根部门下；部门字段为空是组织现状，不是权限缺失。';
  return error
    ? `部门树读不到：${error}；成员按其它来源读取，部门字段留空。`
    : '部门树读不到；成员按其它来源读取，部门字段留空。';
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
