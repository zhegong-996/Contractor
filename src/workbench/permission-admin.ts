import { randomBytes } from 'node:crypto';
import { ROLE_LABELS, CONSOLE_ROLES, type ConsoleAuth, type ConsoleRole } from '../console-auth.ts';
import { rbacEnforce } from '../rbac.ts';
import type { Collaboration } from './collaboration.ts';
import { WorkbenchError } from './errors.ts';
import type { PlatformActor } from './channel-links.ts';
import type { IMProvider } from './im-login-providers.ts';

export function permissionAdmin(auth: ConsoleAuth, work: Collaboration, verifyActivation?: (sender: PlatformActor) => Promise<string | undefined>) {
  const activationEnabled = !!verifyActivation;
  let queue = Promise.resolve();
  function serialize<T>(action: () => Promise<T>) {
    const result = queue.then(action);
    queue = result.then(() => {}, () => {});
    return result;
  }
  const privileged = (role: ConsoleRole) => role === 'owner' || role === 'admin';
  function manager(actor: string) {
    if (!work.canManageAccounts(actor)) throw new WorkbenchError('需要平台成员管理权限。', 403);
    const current = auth.listAccounts().find(row => row.username === actor && !row.disabled);
    return current?.role === 'owner' && rbacEnforce('user:' + actor, 'accounts-manage');
  }
  function manageable(actor: string, username: string) {
    const mayManagePrivileged = manager(actor);
    if (actor === username) throw new WorkbenchError('请在个人账号中管理自己的口令与会话。', 409);
    const row = auth.listAccounts().find(person => person.username === username);
    if (!row) throw new WorkbenchError('找不到平台账号。', 404);
    if (!mayManagePrivileged && privileged(row.role)) throw new WorkbenchError('由所有者管理管理员和所有者账号。', 403);
    return row;
  }
  const mayCreate = (actor: string, role: ConsoleRole) => {
    if (!manager(actor) && privileged(role)) throw new WorkbenchError('由所有者授予平台管理角色。', 403);
  };
  function list(actor: string) {
    const mayManagePrivileged = manager(actor);
    const rows = auth.listAccounts().map(row => ({
      name: row.username, ...work.profiles.view(row), role: row.role, enabled: !row.disabled, createdAt: row.createdAt,
      mayManage: row.username !== actor && (mayManagePrivileged || !privileged(row.role)),
    }));
    const pending = activationEnabled && !work.imLogin.view().primary ? work.activation.pending()
      .filter(row => !rows.some(account => account.name === row.username) && work.activationIdentityAvailable(row.sender))
      .map(({ sender, ...row }) => ({ ...row, feishuName: sender.label })) : [];
    const imPending = work.imLogin.registrations()
      .filter(({ identity }) => !auth.externalOwner(identity) && (!identity.channel || !work.loginChannelOwner(identity.channel)))
      .map(({ id, provider, identity, submittedAt }) => ({ id, provider, displayName: identity.label,
        submittedAt: new Date(submittedAt).toISOString() }));
    const rolePermissions = CONSOLE_ROLES.map(id => ({ id, label: ROLE_LABELS[id],
      capabilities: {
        collaborate: rbacEnforce(id, 'task-control'),
        createProject: rbacEnforce(id, 'project-create'),
        manageMembers: rbacEnforce(id, 'accounts-manage') || rbacEnforce(id, 'workspace-members-admin'),
        privilegedAccounts: id === 'owner' && rbacEnforce(id, 'accounts-manage'),
        manageModels: rbacEnforce(id, 'services-control'),
        manageQuotas: rbacEnforce(id, 'platform-quota-admin'),
      },
    }));
    return { rows, pending, imPending, rolePermissions, activationEnabled: activationEnabled && !work.imLogin.view().primary,
      roles: CONSOLE_ROLES.filter(role => mayManagePrivileged || !privileged(role))
      .map(role => ({ id: role, label: ROLE_LABELS[role] })) };
  }
  function changes(actor: string) {
    manager(actor);
    return auth.readAudit(240).flatMap(entry => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as { action?: string; at?: string; actor?: string; username?: string; role?: string };
      if (!row.at || !row.actor || !row.action?.startsWith('account.')) return [];
      return [{ action: row.action, at: row.at, actor: row.actor, username: row.username, role: row.role }];
    }).slice(-30).reverse();
  }
  return {
    list, changes,
    loginPolicy(actor: string) {
      if (!manager(actor)) throw new WorkbenchError('由平台所有者管理主登录渠道。', 403);
      return work.imLogin.view();
    },
    setLoginPolicy(actor: string, primary: IMProvider, legacyPassword: boolean) {
      return serialize(async () => {
        if (!manager(actor)) throw new WorkbenchError('由平台所有者管理主登录渠道。', 403);
        const changed = work.imLogin.select({ primary, legacyPassword }, auth.listAccounts());
        if (changed.provider) auth.revokeLoginMethod('im');
        if (changed.legacyPassword && !legacyPassword) auth.revokeLoginMethod('password');
        if (changed.provider || changed.legacyPassword) auth.audit('account.im-login-policy-changed', actor, { primary, legacyPassword });
        return work.imLogin.view();
      });
    },
    approveIMRegistration(actor: string, id: string, role: ConsoleRole) {
      return serialize(async () => {
        mayCreate(actor, role);
        const request = work.imLogin.registrations().find(item => item.id === id);
        if (!request || auth.externalOwner(request.identity)
          || request.identity.channel && work.loginChannelOwner(request.identity.channel))
          throw new WorkbenchError('申请已失效或该身份已有账号。', 409);
        // The verified channel identity owns login. The internal name only keys platform records.
        const username = 'member-' + randomBytes(12).toString('hex');
        if (auth.listAccounts().some(row => row.username === username))
          throw new WorkbenchError('生成成员编号冲突，请重新批准。', 409);
        const { identity } = request;
        if (identity.channel) work.bindActivation(username, identity.channel);
        try { await auth.createExternalAccount(username, identity, role, actor); }
        catch (error) {
          if (identity.channel && !auth.externalOwner(identity)) work.rollbackActivation(username, identity.channel);
          throw error;
        }
        work.imLogin.dropRegistration(id);
        auth.audit('account.im-registration-approved', actor, { username, role, provider: request.provider });
      });
    },
    rejectIMRegistration(actor: string, id: string) {
      return serialize(async () => {
        manager(actor);
        if (!work.imLogin.registrations().some(item => item.id === id)) throw new WorkbenchError('申请已处理或失效。', 409);
        work.imLogin.rejectRegistration(id);
        auth.audit('account.im-registration-rejected', actor, {});
      });
    },
    approveActivation(actor: string, id: string, role: ConsoleRole) {
      if (!verifyActivation || work.imLogin.view().primary) throw new WorkbenchError('请使用当前工作台的账号开通方式。', 409);
      return serialize(async () => {
        mayCreate(actor, role);
        const request = work.activation.pending().find(row => row.id === id);
        if (!request || !work.activationIdentityAvailable(request.sender) || auth.listAccounts().some(row => row.username === request.username))
          throw new WorkbenchError('此申请已失效，或渠道身份已开通账号。', 409);
        const username = work.activation.approve(id, actor, role);
        auth.audit('account.activation-approved', actor, { username, role });
      });
    },
    completeActivation(id: string, token: string, password: string) {
      if (!verifyActivation || work.imLogin.view().primary) throw new WorkbenchError('请使用当前工作台的账号开通方式。', 409);
      return serialize(async () => {
        const { username, sender, approver, role } = work.activation.approved(id, token);
        mayCreate(approver, role);
        const label = await verifyActivation(sender);
        if (!label) throw new WorkbenchError('暂时无法再次确认企内飞书身份，请稍后重试。', 409);
        work.activation.approved(id, token);
        if (!work.activationIdentityAvailable(sender, username) || auth.listAccounts().some(row => row.username === username))
          throw new WorkbenchError('这个账号名或飞书身份已开通。请登录已有账号。', 409);
        work.bindActivation(username, { ...sender, label });
        try { await auth.createAccount(username, password, role, approver); }
        catch (error) {
          if (!auth.listAccounts().some(row => row.username === username)) work.rollbackActivation(username, sender);
          throw error;
        }
        work.activation.consume(id);
        auth.audit('account.activated', username, { username, role });
      });
    },
    changeRole(actor: string, username: string, role: ConsoleRole) {
      return serialize(async () => {
        const prior = manageable(actor, username);
        if (!manager(actor) && privileged(role)) throw new WorkbenchError('由所有者授予平台管理角色。', 403);
        if (prior.role === role) return;
        if (role === 'viewer') work.guardAccountWithdrawal(username);
        await auth.setRole(actor, username, role);
        if (role === 'viewer') work.withdrawAccountAuthority(username);
      });
    },
    setEnabled(actor: string, username: string, enabled: boolean) {
      return serialize(async () => {
        const prior = manageable(actor, username);
        if ((!prior.disabled) === enabled) return;
        if (!enabled) work.guardAccountWithdrawal(username);
        await auth.setDisabled(actor, username, !enabled);
        if (!enabled) work.withdrawAccountAuthority(username);
      });
    },
    endSessions(actor: string, username: string) {
      return serialize(async () => {
        manageable(actor, username);
        auth.revokeSessions(username);
        auth.audit('account.sessions-revoked', actor, { username });
      });
    },
    changePassword(actor: string, current: string, password: string) {
      return serialize(async () => {
        try { auth.verifyPassword(actor, current); }
        catch (error) { throw new WorkbenchError((error as Error).message, 403); }
        auth.changePassword(actor, password);
      });
    },
  };
}
