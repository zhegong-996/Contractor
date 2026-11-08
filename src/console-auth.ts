/**
 * 第三十轮 P-12 · RBAC 判定接入开源 casbin；新增用户级配置。
 *
 * 用户 2026-11-08 19:28 指令：「涉及到权限管控 rbac 相关，直接找开源项目代码
 * 复用」——权限判定（authz）改走 Apache casbin（npm `casbin` 5.51.1，
 * Apache-2.0）：RBAC model + 策略文件（.runtime/console/rbac_policy.csv），
 * keyMatch 通配；角色绑定以 accounts.json 为唯一权威，启动与账号变更时同步。
 *
 * 用户同轮指令：「每个用户都可以配置自己的部分，管理员可以看到所有的」——
 * 新增 per-user settings（.runtime/console/users/<name>/settings.json，0600）：
 * 本人读写自己的配置；管理员可总览全部用户的配置；管理员本身也是用户，
 * 正常使用业务功能与自己的配置。
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runtime } from './config.ts';
import { initRbac, rebindHuman, bindHuman, syncHumans, rbacEnforce, rbacPolicyText, RBAC_HUMAN_ROLES, ROLE_PERMISSIONS as RBAC_ROLE_PERMISSIONS } from './rbac.ts';

export const CONSOLE_ROLES = RBAC_HUMAN_ROLES;
export type ConsoleRole = typeof CONSOLE_ROLES[number];

export const ROLE_LABELS: Record<ConsoleRole, string> = {
  owner: '所有者', admin: '管理员', operator: '运营', viewer: '只读',
};

/** 权威定义在 src/rbac.ts（人与 agent 共用 casbin 策略文件）；此处 re-export 供前端与既有调用方。 */
export const ROLE_PERMISSIONS = RBAC_ROLE_PERMISSIONS as Record<ConsoleRole, readonly string[]>;

export const PERMISSION_LABELS: Record<string, string> = {
  read: '查看', 'knowledge-review': '知识审核', 'task-control': '任务接续/暂停',
  'services-control': '服务管理', 'audit-view': '审计日志', 'feishu-auth': '飞书授权',
  'accounts-manage': '账号与角色',
  'knowledge-write-team': '写团队知识', 'knowledge-write-org': '写组织知识', 'knowledge-delete-org': '删组织知识',
  'users-settings-view': '用户配置总览',
};

export type ConsoleAccount = {
  username: string;
  passwordHash: string;
  salt: string;
  role: ConsoleRole;
  feishuOpenId?: string;
  disabled?: boolean;
  createdAt: string;
  createdBy: string;
};

export type ConsoleSession = { username: string; role: ConsoleRole; exp: number };

// ---------------------------------------------------------------------------
// 用户级配置：每个用户可配置自己的模块偏好；管理员可总览全部。
// ---------------------------------------------------------------------------

export type ConsoleUserSettings = {
  /** 登录后默认落在哪个视图 */
  defaultView: string;
  /** 界面主题 */
  theme: 'light' | 'dark';
  /** 列表自动刷新间隔（秒） */
  refreshSeconds: number;
  /** 通知偏好：任务状态变化 / 有问题待回答 / 回执就绪 */
  notify: { taskPhaseChange: boolean; hitlWaiting: boolean; receiptReady: boolean };
  /** 模型偏好：后续可配置自己的模型端点与密钥（现在留空走系统默认） */
  model: { label: string; endpoint: string; apiKey: string };
};

export const DEFAULT_USER_SETTINGS: ConsoleUserSettings = {
  defaultView: 'overview',
  theme: 'light',
  refreshSeconds: 30,
  notify: { taskPhaseChange: true, hitlWaiting: true, receiptReady: true },
  model: { label: '', endpoint: '', apiKey: '' },
};

const SETTING_VIEWS = ['overview', 'collaboration', 'knowledge', 'acceptance', 'services', 'settings', 'admin'];

/** 对外返回时给 API Key 打码；前端据此显示「已设置」而不回显明文。 */
function maskSettings(s: ConsoleUserSettings): ConsoleUserSettings & { model: { apiKeySet: boolean } & Pick<ConsoleUserSettings['model'], 'label' | 'endpoint'> } {
  return {
    ...s,
    model: { label: s.model.label, endpoint: s.model.endpoint, apiKey: '', apiKeySet: Boolean(s.model.apiKey) },
  };
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const COOKIE_NAME = 'suitme_console';
const dir = () => { const d = runtime('console'); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
const accountsFile = () => path.join(dir(), 'accounts.json');
const auditFile = () => path.join(dir(), 'console-audit.jsonl');
const usersDir = () => { const d = path.join(dir(), 'users'); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
const settingsFile = (username: string) => path.join(usersDir(), username, 'settings.json');

function signingKey(): string {
  // 与主服务共用 jwtSecret：签名密钥只在服务端，浏览器永远拿不到。
  const secrets = JSON.parse(readFileSync(path.join(path.dirname(accountsFile()), '..', 'secrets.json'), 'utf8'));
  return String(secrets.jwtSecret);
}

export class ConsoleAuth {
  private sessions = new Map<string, ConsoleSession>();
  private failures = new Map<string, { count: number; lockedUntil: number }>();

  /** 初始化 casbin enforcer（幂等，见 src/rbac.ts）并同步账号绑定。 */
  async ready(): Promise<void> {
    await initRbac();
    await syncHumans(this.listAccounts().map(a => ({ username: a.username, role: a.role })));
  }

  /** 策略文件当前内容（管理员可在后台查看角色 -> 权限矩阵来源）。 */
  policyText(): string {
    return rbacPolicyText();
  }

  listAccounts(): ConsoleAccount[] {
    if (!existsSync(accountsFile())) return [];
    return JSON.parse(readFileSync(accountsFile(), 'utf8')) as ConsoleAccount[];
  }

  private saveAccounts(accounts: ConsoleAccount[]) {
    writeFileSync(accountsFile(), JSON.stringify(accounts, null, 2), { mode: 0o600 });
  }

  audit(action: string, actor: string, detail: Record<string, unknown>) {
    appendFileSync(auditFile(), JSON.stringify({ at: new Date().toISOString(), action, actor, ...detail }) + '\n',
      { mode: 0o600 });
  }

  readAudit(limit = 100): unknown[] {
    if (!existsSync(auditFile())) return [];
    return readFileSync(auditFile(), 'utf8').split('\n').filter(Boolean).slice(-limit)
      .flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  }

  /** 引导创建第一个 owner；已存在任何账号时拒绝（只能由 owner 在后台加人）。 */
  async bootstrapOwner(username: string, password: string): Promise<ConsoleAccount> {
    if (this.listAccounts().length) throw new Error('已存在账号；初始引导只能执行一次，之后由所有者在后台管理');
    const account = await this.createAccount(username, password, 'owner', 'bootstrap');
    this.audit('account.bootstrap-owner', username, { role: 'owner' });
    return account;
  }

  async createAccount(username: string, password: string, role: ConsoleRole, createdBy: string,
    feishuOpenId?: string): Promise<ConsoleAccount> {
    const name = String(username ?? '').trim();
    if (!/^[a-zA-Z0-9_-]{2,32}$/.test(name)) throw new Error('用户名只允许 2-32 位字母 / 数字 / 下划线 / 连字符');
    if (String(password ?? '').length < 8) throw new Error('口令至少 8 位');
    if (!CONSOLE_ROLES.includes(role)) throw new Error('未知角色');
    const accounts = this.listAccounts();
    if (accounts.some(a => a.username === name)) throw new Error('用户名已存在');
    const salt = randomBytes(16).toString('hex');
    const account: ConsoleAccount = {
      username: name, salt, passwordHash: scryptSync(password, salt, 32).toString('hex'),
      role, createdAt: new Date().toISOString(), createdBy,
      ...(feishuOpenId ? { feishuOpenId } : {}),
    };
    accounts.push(account);
    this.saveAccounts(accounts);
    await bindHuman(name, role);
    this.audit('account.created', createdBy, { username: name, role });
    return account;
  }

  async setRole(operator: string, username: string, role: ConsoleRole) {
    const accounts = this.listAccounts();
    const account = accounts.find(a => a.username === username);
    if (!account) throw new Error('账号不存在');
    if (account.role === 'owner' && role !== 'owner') {
      const owners = accounts.filter(a => a.role === 'owner' && !a.disabled);
      if (owners.length <= 1) throw new Error('系统至少要保留一名在岗所有者，不能降级最后一个 owner');
    }
    account.role = role;
    this.saveAccounts(accounts);
    await rebindHuman(username, role);
    for (const [token, session] of this.sessions) if (session.username === username) this.sessions.delete(token);
    this.audit('account.role-changed', operator, { username, role });
  }

  async setDisabled(operator: string, username: string, disabled: boolean) {
    const accounts = this.listAccounts();
    const account = accounts.find(a => a.username === username);
    if (!account) throw new Error('账号不存在');
    if (account.role === 'owner' && disabled) {
      const owners = accounts.filter(a => a.role === 'owner' && !a.disabled);
      if (owners.length <= 1) throw new Error('系统至少要保留一名在岗所有者，不能禁用最后一个 owner');
    }
    account.disabled = disabled;
    this.saveAccounts(accounts);
    await syncHumans(this.listAccounts().map(a => ({ username: a.username, role: a.role })));
    if (disabled) for (const [token, session] of this.sessions) if (session.username === username) this.sessions.delete(token);
    this.audit(disabled ? 'account.disabled' : 'account.enabled', operator, { username });
  }

  changePassword(username: string, newPassword: string) {
    if (String(newPassword ?? '').length < 8) throw new Error('口令至少 8 位');
    const accounts = this.listAccounts();
    const account = accounts.find(a => a.username === username);
    if (!account) throw new Error('账号不存在');
    account.salt = randomBytes(16).toString('hex');
    account.passwordHash = scryptSync(newPassword, account.salt, 32).toString('hex');
    this.saveAccounts(accounts);
    this.audit('account.password-changed', username, {});
  }

  login(username: string, password: string): { cookie: string; session: ConsoleSession } {
    const name = String(username ?? '').trim();
    const fail = this.failures.get(name);
    if (fail && fail.lockedUntil > Date.now())
      throw new Error(`连续失败次数过多，已锁定到 ${new Date(fail.lockedUntil).toLocaleTimeString('zh-CN')}`);
    const account = this.listAccounts().find(a => a.username === name);
    const ok = Boolean(account) && !account!.disabled
      && timingSafeEqual(Buffer.from(account!.passwordHash, 'hex'),
        scryptSync(String(password ?? ''), account!.salt, 32));
    if (!ok) {
      const entry = fail ?? { count: 0, lockedUntil: 0 };
      entry.count += 1;
      if (entry.count >= 5) { entry.lockedUntil = Date.now() + 10 * 60 * 1000; entry.count = 0; }
      this.failures.set(name, entry);
      this.audit('login.failed', name, {});
      throw new Error(account?.disabled ? '账号已被禁用' : '用户名或口令不正确');
    }
    this.failures.delete(name);
    const token = randomBytes(24).toString('base64url');
    const session: ConsoleSession = { username: name, role: account!.role, exp: Date.now() + SESSION_TTL_MS };
    this.sessions.set(token, session);
    this.audit('login.ok', name, { role: account!.role });
    return { cookie: `${COOKIE_NAME}=${token}.${this.sign(token)}`, session };
  }

  logout(cookieHeader: string | undefined) {
    const token = this.tokenFromCookie(cookieHeader);
    if (token && this.sessions.has(token)) {
      this.audit('logout', this.sessions.get(token)!.username, {});
      this.sessions.delete(token);
    }
  }

  private sign(token: string): string {
    return createHmac('sha256', signingKey()).update(token).digest('base64url');
  }

  private tokenFromCookie(header: string | undefined): string | null {
    const match = header?.split(';').map(part => part.trim())
      .find(part => part.startsWith(COOKIE_NAME + '='));
    if (!match) return null;
    const value = match.slice(COOKIE_NAME.length + 1);
    const dot = value.lastIndexOf('.');
    if (dot <= 0) return null;
    const token = value.slice(0, dot), signature = value.slice(dot + 1);
    const expect = this.sign(token);
    return signature.length === expect.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expect))
      ? token : null;
  }

  sessionFromRequest(cookieHeader: string | undefined): ConsoleSession | null {
    const token = this.tokenFromCookie(cookieHeader);
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.exp < Date.now()) { this.sessions.delete(token); return null; }
    return session;
  }

  sessionCount(): number { return this.sessions.size; }

  // -------------------------------------------------------------------------
  // 用户级配置：本人读写；管理员总览。管理员自己也是用户，走同一套。
  // -------------------------------------------------------------------------

  /** 读某用户的配置（未设置过给默认值）；返回给前端的形态里 API Key 打码。 */
  getUserSettings(username: string) {
    const file = settingsFile(username);
    let stored: Partial<ConsoleUserSettings> = {};
    if (existsSync(file)) {
      try { stored = JSON.parse(readFileSync(file, 'utf8')); } catch { stored = {}; }
    }
    const merged: ConsoleUserSettings = {
      defaultView: SETTING_VIEWS.includes(String(stored.defaultView)) ? stored.defaultView! : DEFAULT_USER_SETTINGS.defaultView,
      theme: stored.theme === 'dark' ? 'dark' : 'light',
      refreshSeconds: Number.isFinite(stored.refreshSeconds) && Number(stored.refreshSeconds) >= 10 && Number(stored.refreshSeconds) <= 600
        ? Number(stored.refreshSeconds) : DEFAULT_USER_SETTINGS.refreshSeconds,
      notify: { ...DEFAULT_USER_SETTINGS.notify, ...(typeof stored.notify === 'object' && stored.notify ? stored.notify : {}) },
      model: { ...DEFAULT_USER_SETTINGS.model, ...(typeof stored.model === 'object' && stored.model ? stored.model : {}) },
    };
    return maskSettings(merged);
  }

  /** 本人更新自己的配置；打码形态的 apiKey（含 *）表示保留原值。 */
  setUserSettings(operator: string, username: string, patch: Record<string, unknown>) {
    if (!this.listAccounts().some(a => a.username === username)) throw new Error('账号不存在');
    if (operator !== username) throw new Error('只能修改自己的配置；管理员可以查看所有人的配置，但修改仍限本人');
    const file = settingsFile(username);
    let stored: ConsoleUserSettings = JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS));
    if (existsSync(file)) { try { stored = { ...stored, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* 坏文件按默认重建 */ } }

    if (Object.prototype.hasOwnProperty.call(patch, 'defaultView')) {
      if (!SETTING_VIEWS.includes(String(patch.defaultView))) throw new Error('未知视图');
      stored.defaultView = String(patch.defaultView);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'theme')) stored.theme = patch.theme === 'dark' ? 'dark' : 'light';
    if (Object.prototype.hasOwnProperty.call(patch, 'refreshSeconds')) {
      const n = Number(patch.refreshSeconds);
      if (!Number.isFinite(n) || n < 10 || n > 600) throw new Error('刷新间隔需在 10-600 秒之间');
      stored.refreshSeconds = n;
    }
    const notify = patch.notify as Record<string, unknown> | undefined;
    if (notify && typeof notify === 'object') {
      for (const key of ['taskPhaseChange', 'hitlWaiting', 'receiptReady'] as const)
        if (typeof notify[key] === 'boolean') stored.notify[key] = notify[key] as boolean;
    }
    const model = patch.model as Record<string, unknown> | undefined;
    if (model && typeof model === 'object') {
      if (typeof model.label === 'string') stored.model.label = model.label.slice(0, 60);
      if (typeof model.endpoint === 'string') stored.model.endpoint = model.endpoint.slice(0, 300);
      if (typeof model.apiKey === 'string' && model.apiKey && !model.apiKey.includes('*')) stored.model.apiKey = model.apiKey.slice(0, 200);
    }

    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
    this.audit('settings.changed', username, { keys: Object.keys(patch) });
    return maskSettings(stored);
  }

  /** 管理员总览：全部账号 + 各自配置（打码）。 */
  listUserSettingsOverview() {
    return this.listAccounts().map(account => {
      const file = settingsFile(account.username);
      let updatedAt: string | null = null;
      try { updatedAt = existsSync(file) ? statSync(file).mtime.toISOString() : null; } catch { updatedAt = null; }
      return {
        username: account.username, role: account.role, disabled: Boolean(account.disabled),
        settings: this.getUserSettings(account.username), updatedAt,
      };
    });
  }
}

export function can(session: ConsoleSession | null, permission: string): boolean {
  // casbin 判定（fail-closed）：sub 统一 user:<username>，见 src/rbac.ts。
  if (!session) return false;
  return rbacEnforce('user:' + session.username, permission);
}
