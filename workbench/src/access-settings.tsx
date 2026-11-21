import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowLeft, Coins, Cpu, KeyRound, ListChecks, Plus, Route, ShieldCheck, UsersRound } from 'lucide-react';
import { api, part, useData, type Overview, type PlatformAudit, type ProjectAccess, type Session } from './api.ts';
import { PointsPane } from './agent-operations.tsx';
import { routeFor, settingsRoute, type GlobalView } from './navigation.ts';
import { Button } from './components/button.tsx';
import { Input } from './components/input.tsx';
import { Avatar, date, Empty, Failure, Field, Loading, Modal, Pill, SearchBox, Section, useActions, useSessionScroll, useStored } from './ui.tsx';
import { ModelServices, ServiceStatus } from './operations-settings.tsx';
import { LoginChannelSettings, MyIMLogin } from './im-login.tsx';
import { AccountManagement, PlatformRoles, roleLabel } from './platform-access.tsx';
import { PlatformQuota } from './platform-quota.tsx';
import { PersonalProfileSettings } from './personal-profile.tsx';
import { MyWorkers, PersonalAgentSettings, PlatformAssistantSettings } from './agent-settings.tsx';

const actions = {
  'project.member-added': '添加成员', 'project.member-removed': '移除成员',
  'project.member-role-changed': '调整项目权限', 'project.maintainer-transferred': '交接维护权限',
  'project.routing-changed': '调整项目职责与路由',
  'knowledge.access-policy-changed': '调整资料授权有效期',
  'account.created': '创建账号', 'account.activation-approved': '批准账号开通', 'account.activated': '本人激活账号',
  'account.role-changed': '调整平台角色', 'account.password-changed': '修改口令',
  'account.sessions-revoked': '撤销会话',
  'account.im-login-linked': '绑定登录渠道', 'account.im-login-policy-changed': '调整主登录渠道',
  'account.im-registration-approved': '批准渠道开通', 'account.im-registration-rejected': '拒绝渠道开通',
  'account.enabled': '启用账号', 'account.disabled': '停用账号', 'account.bootstrap-owner': '初始化所有者',
} as Record<string, string>;

type ProjectMember = ProjectAccess['roles'][number];
type ProjectDialog = { kind: 'add' } | { kind: 'transfer' } | { kind: 'role' | 'remove'; member: ProjectMember };

export function ProjectPermissions({ project, actor, afterTransfer }: { project: string; actor: string; afterTransfer: () => void }) {
  const data = useData<ProjectAccess>('project/' + part(project) + '/access');
  const [dialog, open] = useState<ProjectDialog>();
  const [editingHours, editHours] = useState(false);
  const { run, busy } = useActions();
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  const { roles, available, changes, knowledgeAccessHours: hours } = data.data;
  return <>
    <Section title="成员与权限" action={<div className="actions">
      {roles.some(row => row.canTransferTo) && <Button size="sm" variant="outline" onClick={() => open({ kind: 'transfer' })}>交接维护权限</Button>}
      <Button size="sm" disabled={!available.length} onClick={() => open({ kind: 'add' })}><Plus />添加成员</Button>
    </div>}>
      {roles.map(row => <div className="access-row record-row" key={row.name}><Avatar avatar={row.avatar} value={row.name} />
        <div className="access-identity"><strong>{row.displayName ?? row.name}</strong>{row.name === actor && <small> 我</small>}
          <div className="inline-meta"><Pill>{roleLabel[row.effective]}</Pill>{!row.enabled && <Pill tone="amber">账号停用</Pill>}</div>
        </div>
        {!row.maintainer && <div className="actions">
          {row.enabled && !row.platformReadOnly && <Button variant="ghost" size="sm" onClick={() => open({ kind: 'role', member: row })}>调整权限</Button>}
          <Button variant="ghost" size="sm" onClick={() => open({ kind: 'remove', member: row })}>移除</Button>
        </div>}
      </div>)}
    </Section>
    <Section title="资料授权" action={<Button size="sm" variant="outline" onClick={() => editHours(true)}>设置有效期</Button>}>
      <div className="record-row"><span>新授权有效期</span><strong>{hours} 小时</strong></div>
    </Section>
    <PointsPane project={project} />
    <Section title="权限变更">
      <Changes rows={changes.map(row => ({ ...row, action: row.kind, username: row.member ?? row.to }))} />
    </Section>
    {dialog && <ProjectAccessDialog project={project} dialog={dialog} data={data.data} close={() => open(undefined)} afterTransfer={afterTransfer} />}
    {editingHours && <Modal title="资料授权有效期" close={() => editHours(false)}>
      <form className="form" onSubmit={async event => {
        event.preventDefault();
        const hours = Number(new FormData(event.currentTarget).get('hours'));
        if (await run(() => api('project/' + part(project) + '/knowledge-access', { hours }), '有效期已更新')) editHours(false);
      }}>
        <Field label="小时"><Input name="hours" type="number" min={1} max={168} step={1} defaultValue={hours} required /></Field>
        <p className="muted-text">新授权使用此有效期，已发出的授权按原时间到期。</p>
        <div className="form-actions"><Button type="submit" disabled={busy}>保存</Button></div>
      </form>
    </Modal>}
  </>;
}

function ProjectAccessDialog({ project, dialog, data, close, afterTransfer }: { project: string; dialog: ProjectDialog;
  data: ProjectAccess; close: () => void; afterTransfer: () => void }) {
  const { run, busy } = useActions();
  const [name, setName] = useState(data.available[0]?.name ?? '');
  const [role, setRole] = useState(dialog.kind === 'role' ? dialog.member.role : 'collaborator');
  const labels = { add: '添加项目成员', role: '调整项目权限', remove: '移除项目成员', transfer: '交接维护权限' };
  const platformReadOnly = dialog.kind === 'add' && data.available.find(row => row.name === name)?.platformReadOnly;
  return <Modal title={labels[dialog.kind]} close={close}>
    <form className="form" onSubmit={async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const root = 'project/' + part(project);
      const result = await run(() => {
        if (dialog.kind === 'add') return api(root + '/member', { member: name, role: platformReadOnly ? 'reader' : role });
        if (dialog.kind === 'transfer') return api(root + '/maintainer/transfer', { to: form.get('to') });
        if (dialog.kind === 'remove') return api(root + '/member/remove', { member: dialog.member.name });
        return api(root + '/member/role', { member: dialog.member.name, role });
      }, '项目权限已更新');
      if (result) {
        close();
        if (dialog.kind === 'transfer') afterTransfer();
      }
    }}>
      {dialog.kind === 'add' && <Field label="平台账号"><select required value={name} onChange={event => setName(event.target.value)}>
        {data.available.map(row => <option key={row.name} value={row.name}>{row.displayName ? row.displayName + ' · ' + row.name : row.name}</option>)}
      </select></Field>}
      {dialog.kind === 'role' && <p>{dialog.member.name}</p>}
      {(dialog.kind === 'add' || dialog.kind === 'role') && <Field label="项目权限"><select value={platformReadOnly ? 'reader' : role}
        disabled={platformReadOnly} onChange={event => setRole(event.target.value as 'collaborator' | 'reader')}>
        <option value="collaborator">协作</option><option value="reader">只读</option>
      </select></Field>}
      {dialog.kind === 'role' && role === 'reader' && <p>该成员仍可阅读项目；相关委托、执行及资料授权会撤回。</p>}
      {dialog.kind === 'transfer' && <>
        <Field label="接任成员"><select name="to" required>{data.roles.filter(row => row.canTransferTo)
          .map(row => <option key={row.name} value={row.name}>{row.displayName ? row.displayName + ' · ' + row.name : row.name}</option>)}</select></Field>
        <p>交接后，你成为协作者，待确认的项目管理事项由接任成员处理。</p>
      </>}
      {dialog.kind === 'remove' && <p>{dialog.member.name} 的项目访问立即失效，相关执行停止，资料授权撤回。</p>}
      <div className="form-actions"><Button disabled={busy} type="submit" variant={dialog.kind === 'remove' ? 'destructive' : 'default'}>
        {dialog.kind === 'remove' ? '确认移除' : dialog.kind === 'transfer' ? '确认交接' : '保存'}
      </Button></div>
    </form>
  </Modal>;
}

function Changes({ rows }: { rows: (PlatformAudit[number] & { hours?: number })[] }) {
  return rows.length ? rows.map((row, i) => <div className="record-row" key={row.at + ':' + i}>
    <strong>{actions[row.action] ?? row.action}</strong><span>{row.actor}{row.username ? ' → ' + row.username : ''}</span>
    {row.role && <Pill>{roleLabel[row.role as keyof typeof roleLabel] ?? row.role}</Pill>}{row.hours !== undefined && <span>{row.hours} 小时</span>}
    <time>{date(row.at)}</time>
  </div>) : <p className="muted-text">暂无权限变更</p>;
}

function PlatformChanges() {
  const data = useData<PlatformAudit>('admin/access-audit');
  const [query, setQuery] = useStored('platform-audit-filter', '');
  const entries = data.data?.filter(row =>
    [row.actor, row.username, actions[row.action] ?? row.action, row.role && roleLabel[row.role as keyof typeof roleLabel]]
      .some(value => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return <Section title="最近的权限变更" action={<div className="admin-toolbar-search">
    <SearchBox label="搜索操作、账号或角色" value={query} onChange={setQuery} />
  </div>}>
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !entries ? <Loading />
      : !entries.length ? <Empty title={query ? '没有匹配的权限记录' : '暂无权限变更'} />
        : <div className="workbench-table-scroll" tabIndex={0} role="region" aria-label="平台权限变更记录">
          <table className="workbench-table admin-data-table">
            <thead><tr><th scope="col">操作</th><th scope="col">操作人</th><th scope="col">影响账号</th><th scope="col">涉及角色</th><th scope="col">时间</th></tr></thead>
            <tbody>{entries.map((row, index) => <tr key={row.at + ':' + index}>
              <th scope="row">{actions[row.action] ?? row.action}</th><td>{row.actor}</td><td>{row.username ?? '—'}</td>
              <td>{row.role ? roleLabel[row.role as keyof typeof roleLabel] ?? row.role : '—'}</td><td><time>{date(row.at, true)}</time></td>
            </tr>)}</tbody>
          </table>
        </div>}
  </Section>;
}

function PersonalLogin({ workspace }: { workspace: Overview }) {
  const [editing, setEditing] = useState(false);
  const { run, busy } = useActions();
  const session = useData<Session>('session');
  const login = session.data?.imLogin;
  const mayEditPassword = !!login?.hasPassword && login.legacyPassword;
  return <Section title="登录安全" action={mayEditPassword && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><KeyRound />修改口令</Button>}>
    <div className="record-row"><span>{mayEditPassword ? '口令账号' : '成员'}</span>
      <strong>{mayEditPassword ? workspace.actor : workspace.actorProfile?.displayName ?? workspace.actor}</strong>
      {workspace.platformRole && <Pill>{roleLabel[workspace.platformRole]}</Pill>}</div>
    {login?.provider && <MyIMLogin login={login} />}
    {editing && mayEditPassword && <Modal title="修改口令" close={() => setEditing(false)}><form className="form" onSubmit={async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const result = await run(() => api('account/password', { current: form.get('current'), password: form.get('password') }), '口令已更新');
      if (result) window.dispatchEvent(new Event('contractor-session-expired'));
    }}>
      <Field label="当前口令"><Input type="password" name="current" autoComplete="current-password" required autoFocus maxLength={300} /></Field>
      <Field label="新口令"><Input type="password" name="password" autoComplete="new-password" required minLength={8} maxLength={300} /></Field>
      <p className="muted-text">保存后请用新口令重新登录。</p>
      <div className="form-actions"><Button disabled={busy} type="submit">保存</Button></div>
    </form></Modal>}
  </Section>;
}

export function GlobalSettings({ view, tab, fromProject, returnTo, status, workspace, logout, connections }: {
  view: GlobalView; tab?: string; fromProject?: string; returnTo?: string; status?: ReactNode;
  workspace: Overview; logout: () => void; connections?: ReactNode;
}) {
  const origin = workspace.projects.find(project => project.id === fromProject);
  const back = returnTo && (returnTo.startsWith('#/personal-chat') || workspace.projects.some(p => returnTo.startsWith('#/' + p.id + '/'))) ? returnTo
    : origin ? routeFor(origin.id, 'agents') : workspace.projects[0] ? routeFor(workspace.projects[0].id, 'inbox') : '#/';
  const header = <header className="toolbar settings-toolbar">
    <a className="text-button" href={back}><ArrowLeft size={16} />返回工作台</a>
    <span className="settings-location">{view === 'platform' ? '平台管理' : '个人设置'}</span>
    {view === 'platform' && <a className="text-button ml-auto" href={settingsRoute('account', undefined, returnTo, origin?.id)}>个人设置</a>}
    <Button variant="ghost" size="sm" onClick={logout}>退出登录</Button>
  </header>;
  if (view === 'account') return <div className="global-settings page-scroll">{header}{status}
    <main className="project-page personal-settings">
      <header className="object-header"><div className="object-emblem"><ShieldCheck size={24} /></div><div><h1>个人设置</h1></div></header>
      <nav className="actions account-settings-nav" aria-label="个人设置">
        {([['profile', '资料与登录'], ['agent', '个人 Agent'], ['workers', '我的 Worker']] as const).map(([key, label]) =>
          <a className="text-button" key={key} href={settingsRoute('account', key, returnTo, origin?.id)}
            aria-current={(tab ?? 'profile') === key ? 'page' : undefined}>{label}</a>)}
      </nav>
      <div className="detail-stack">{tab === 'agent' ? <PersonalAgentSettings project={origin?.id} /> : tab === 'workers' ? <MyWorkers workspace={workspace} />
        : <><PersonalProfileSettings /><PersonalLogin workspace={workspace} />{connections}</>}</div>
    </main>
  </div>;
  return <div className="platform-shell">{header}{status}<PlatformDesk workspace={workspace} tab={tab} returnTo={returnTo} project={origin?.id} /></div>;
}

function PlatformDesk({ workspace, tab, returnTo, project }: { workspace: Overview; tab?: string; returnTo?: string; project?: string }) {
  const groups = [
    { title: '访问控制', items: [
      { key: 'members', title: '成员与角色', caption: '管理平台账号、审批开通申请和调整角色。', icon: UsersRound, allowed: workspace.canManageAccounts },
      { key: 'roles', title: '角色权限', caption: '核对每个角色可操作的范围。', icon: ShieldCheck, allowed: workspace.canManageAccounts },
      { key: 'login', title: '登录渠道', caption: '选择团队主登录渠道和成员登录方式。', icon: KeyRound, allowed: workspace.canManageLogin },
      { key: 'audit', title: '权限记录', caption: '追溯账号、角色和登录设置的变更。', icon: ListChecks, allowed: workspace.canManageAccounts },
    ] },
    { title: 'Agent 运行', items: [
      { key: 'router', title: '平台 Router', caption: '为路由建议和知识提炼分别配置提示词与技能。', icon: Route, allowed: workspace.canManageServices },
      { key: 'models', title: '模型服务', caption: '管理各供应商的可用模型和平台执行策略。', icon: Cpu, allowed: workspace.canManageServices },
      { key: 'quota', title: '积分与额度', caption: '设置各模型如何折算积分，以及平台和个人的用量上限。', icon: Coins, allowed: workspace.canManagePointPolicy },
      { key: 'services', title: '服务状态', caption: '查看入站、检索和执行回执的运行情况。', icon: Activity, allowed: workspace.canManageServices },
    ] },
  ];
  const available = groups.flatMap(group => group.items.filter(item => item.allowed));
  const active = tab ? available.find(item => item.key === tab) : available[0];
  const scroll = useSessionScroll('platform-scroll:' + (active?.key ?? 'denied'));
  const currentLink = useRef<HTMLAnchorElement>(null);
  useLayoutEffect(() => { currentLink.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active?.key]);
  const panes: Record<string, ReactNode> = {
    members: <AccountManagement actor={workspace.actor} />, roles: <PlatformRoles />, login: <LoginChannelSettings />,
    audit: <PlatformChanges />, router: <PlatformAssistantSettings />, models: <ModelServices />,
    quota: <PlatformQuota mayViewModels={workspace.canManageServices} />, services: <ServiceStatus />,
  };
  return <div className="platform-workspace">
    {available.length > 0 && <aside className="platform-nav">
      <nav aria-label="平台管理导航">{groups.map(group => {
        const pages = group.items.filter(item => item.allowed);
        if (!pages.length) return null;
        return <section key={group.title}><h2>{group.title}</h2>
          {pages.map(item => <a key={item.key} href={settingsRoute('platform', item.key, returnTo, project)} ref={active?.key === item.key ? currentLink : undefined}
            aria-current={active?.key === item.key ? 'page' : undefined}>
            <item.icon size={17} aria-hidden="true" /><span>{item.title}</span>
          </a>)}
        </section>;
      })}</nav>
      {workspace.platformRole && <div className="admin-sidebar-identity"><Avatar avatar={workspace.actorProfile?.avatar} value={workspace.actor} />
        <div><strong>{workspace.actorProfile?.displayName ?? workspace.actor}</strong><span>{roleLabel[workspace.platformRole]}</span></div></div>}
    </aside>}
    <div className="platform-scroll" {...scroll}><main className="platform-content" id="platform-main">
      {active ? <><header className="platform-heading"><h1>{active.title}</h1><p>{active.caption}</p></header>
        <div className="admin-content" key={active.key}>{panes[active.key]}</div></>
        : <Empty title="当前账号无权访问此平台管理页面" icon={<ShieldCheck />} />}
    </main></div>
  </div>;
}
