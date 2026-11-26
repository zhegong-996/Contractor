import { writeStoredValue } from './drafts.ts';
import { WorkspaceSearch } from './workspace-search.tsx';
import { Provider as MotionProvider } from '@rc-component/motion';
import { Component, type ReactNode, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Breadcrumb, ConfigProvider, Drawer, Layout, Menu as NavigationMenu, Tabs, type ConfigProviderProps } from 'antd';
import zhCN from 'antd/es/locale/zh_CN.js';
import { ArrowRight, BookOpen, Bot, ChevronDown, ChevronRight, CircleCheck, FileUp, FolderKanban, Inbox, ListChecks, LogOut, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { api, mayKeepStale, uid, useData, type Overview, type ProjectTemplate, type Session } from './api.ts';
import { ActionContext, Avatar, Empty, Failure, Field, IconButton, Loading, Logo, Modal, useActions, useMediaQuery, useStored } from './ui.tsx';
import { Button } from './components/button.tsx';
import { Input } from './components/input.tsx';
import { preference, savePreference, WorkspaceSidebar } from './components/workspace-sidebar.tsx';
import { go, personalChatRoute, routeFor, settingsRoute, titles, useRoute, type PageProps, type TaskPreset } from './navigation.ts';
import { Composer } from './creation.tsx';
import { forest, type Branch } from './hierarchy.ts';
import { workbenchTheme } from './components/theme.ts';
import { IMLoginEntry, imNames, useIMNotice } from './im-login.tsx';
import 'virtual:workbench-antd.css';
import './style.css';
import './saas.css';

const WorkPage = lazy(() => import('./work.tsx').then(page => ({ default: page.WorkPage })));
const InboxPage = lazy(() => import('./inbox.tsx').then(page => ({ default: page.InboxPage })));
const ChatPage = lazy(() => import('./chat.tsx').then(page => ({ default: page.ChatPage })));
const PersonalChatPage = lazy(() => import('./personal-chat.tsx').then(page => ({ default: page.PersonalChatPage })));
const KnowledgePage = lazy(() => import('./knowledge.tsx').then(page => ({ default: page.KnowledgePage })));
const AgentsPage = lazy(() => import('./agents.tsx').then(page => ({ default: page.AgentsPage })));
const ProjectPage = lazy(() => import('./project.tsx').then(page => ({ default: page.ProjectPage })));
const AccountsPage = lazy(() => import('./project.tsx').then(page => ({ default: page.AccountsPage })));
const GlobalSettings = lazy(() => import('./access-settings.tsx').then(page => ({ default: page.GlobalSettings })));
const HomePage = lazy(() => import('./home.tsx').then(page => ({ default: page.HomePage })));

const nav = [
  { key: 'inbox', icon: Inbox }, { key: 'work', icon: ListChecks },
  { key: 'chat', icon: MessageSquare },
  { key: 'agents', icon: Bot }, { key: 'knowledge', icon: BookOpen },
] as const;

function Login({ session }: { session?: Session }) {
  const { busy, run, error } = useActions();
  const query = useQueryClient();
  const [recovering, setRecovering] = useState(false);
  const notice = useIMNotice();
  const { recoveryUrl, imLogin } = session ?? {};
  const [method, setMethod] = useState(imLogin?.ready ? 'enterprise' : 'account');
  const usePassword = imLogin?.legacyPassword !== false;
  const pending = notice.status === 'pending';
  const passwordAllowed = usePassword && !['pending', 'denied', 'blocked', 'conflict'].includes(notice.status ?? '');
  const passwordForm = <form className="form login-password" aria-label="口令登录" onSubmit={async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api('login', { username: String(form.get('username')).trim(), password: form.get('password') });
      query.setQueryData<Session>(['session'], { ...session, signedIn: true });
      return true;
    });
  }}>
    <Field label="工作台账号"><Input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={32} /></Field>
    <Field label="口令"><Input name="password" autoComplete="current-password" type="password" required maxLength={300} /></Field>
    {error && <Failure error={new Error(error)} />}
    <Button type="submit" loading={busy}>登录 <ArrowRight size={17} aria-hidden="true" /></Button>
    {recoveryUrl && <div className="actions">
      <Button type="button" variant="ghost" size="sm" onClick={() => setRecovering(true)}>找回口令</Button>
    </div>}
  </form>;
  const enterprise = imLogin?.provider && (imLogin.ready ? <IMLoginEntry login={imLogin} status={notice.status} active={!passwordAllowed || method === 'enterprise'} />
    : <p className="login-notice" role="status">{imNames[imLogin.provider]}登录暂不可用，请联系平台管理员。</p>);
  return <main className="login-wrap">
    <section className="login-sheet" aria-labelledby="login-title">
      <div className="login-brand"><Logo /><span>Contractor</span>{session?.org && <small className="login-org">{session.org.name}</small>}</div>
      <h1 id="login-title">{pending ? '等待开通' : '登录工作台'}</h1>
      {notice.text && <p className="login-notice" role={pending ? 'status' : 'alert'}>{notice.text}</p>}
      {enterprise && passwordAllowed ? <Tabs className="login-modes" aria-label="登录方式" activeKey={method} onChange={setMethod} items={[
        { key: 'enterprise', label: imLogin?.embeddedQr && imLogin.onTeamAddress ? '二维码登录' : '企业授权', children: enterprise },
        { key: 'account', label: '账号登录', children: passwordForm },
      ]} /> : enterprise || (passwordAllowed && passwordForm)}
    </section>
    {recoveryUrl && recovering && <RecoveryDialog url={recoveryUrl} close={() => setRecovering(false)} />}
  </main>;
}

function RecoveryDialog({ url, close }: { url: string; close: () => void }) {
  const { run, busy, clearError } = useActions();
  const [challenge, setChallenge] = useState<{ code: string; token: string; command: string }>();
  return <Modal title="找回口令" close={close}>
    <form className="form" onSubmit={async event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      if (!challenge) {
        const result = await run(() => api<NonNullable<typeof challenge>>('account/recovery/start', { username: String(values.get('name')).trim() }));
        if (result) setChallenge(result);
      } else if (await run(() => api('account/recovery/complete', {
        code: challenge.code, token: challenge.token, password: values.get('password'),
      }), '口令已更新，请重新登录')) close();
    }}>
      {!challenge ? <Field label="工作台账号"><Input name="name" autoComplete="username" required maxLength={32} autoFocus /></Field> : <>
        <p>用已绑定的飞书账号私聊机器人，发送以下命令。请在 10 分钟内回到这里设置新口令。</p>
        <code>{challenge.command}</code>
        <div className="actions">
          <Button type="button" variant="outline" onClick={() => void run(() => navigator.clipboard.writeText(challenge.command), '已复制命令')}>复制命令</Button>
          <a className="text-button" href={url} target="_blank" rel="noreferrer">打开飞书机器人</a>
        </div>
        <Field label="新口令"><Input type="password" name="password" required minLength={8} maxLength={300} autoComplete="new-password" /></Field>
      </>}
      <div className="form-actions">
        {challenge && <Button type="button" variant="ghost" disabled={busy} onClick={() => { clearError(); setChallenge(undefined); }}>重新发起</Button>}
        <Button type="submit" disabled={busy}>{challenge ? '完成找回' : '生成验证命令'}</Button>
      </div>
    </form>
  </Modal>;
}


function Navigation({ workspace, project, route, close, newProject }: PageProps & { close?: () => void; newProject: () => void }) {
  const signOut = useSignOut();
  const [expanded, setExpanded] = useState(true);
  const [profile, setProfile] = useState(false);
  const current = route.view;
  return <div className="sidebar-content">
    <a className="brand" href={routeFor(project.id, 'inbox')} onClick={close} aria-label="Contractor"><Logo /><span>Contractor</span></a>
    <nav className="sidebar-nav" aria-label="工作入口">
      <NavigationMenu mode="inline" selectedKeys={[current]} className="primary-navigation"
        items={nav.map(({ key, icon: Icon }) => ({ key, icon: <Icon size={17} />, title: titles[key],
          label: <a href={key === 'chat' ? personalChatRoute(undefined, project.id) : routeFor(project.id, key)} aria-current={current === key ? 'page' : undefined}>
            {titles[key]}{key === 'inbox' && workspace.needsYou.length > 0 && <span className="nav-count">{workspace.needsYou.length}</span>}
          </a> }))}
        onClick={({ key, domEvent }) => {
          if (domEvent.ctrlKey || domEvent.metaKey || domEvent.shiftKey || domEvent.altKey) return;
          domEvent.preventDefault();
          if (key === 'chat') window.location.hash = personalChatRoute(undefined, project.id);
          else go(project.id, key as (typeof nav)[number]['key']);
          close?.();
        }} />
    </nav>
    <div className="project-nav">
      <div className="project-nav-heading">
        <button className="group-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          <span>项目</span><ChevronDown size={14} className={expanded ? '' : '-rotate-90'} />
        </button>
        {workspace.canCreateProject && <IconButton label="新建项目" className="project-create" onClick={() => { close?.(); newProject(); }}><Plus /></IconButton>}
      </div>
      {expanded && <nav aria-label="可访问项目">{forest(workspace.projects, item => item.parent).map(branch =>
        <ProjectBranch key={branch.item.id} branch={branch} current={project.id} route={route.view} close={close} />)}</nav>}
    </div>
    <div className="sidebar-footer">
      {(workspace.canManageAccounts || workspace.canManagePointPolicy || workspace.canManageServices) &&
        <a className="nav-row" href={settingsRoute('platform', undefined, window.location.hash, project.id)} onClick={close}><ShieldCheck size={17} /><span>平台管理</span></a>}
      <a className="nav-row" href={settingsRoute('account', undefined, window.location.hash, project.id)} onClick={close}><UserRound size={17} /><span>个人设置</span></a>
      {profile && <div className="profile-menu">
        <Button variant="ghost" type="button" onClick={signOut}><LogOut />退出登录</Button>
      </div>}
      <button className="profile" aria-expanded={profile} type="button" onClick={() => setProfile(value => !value)} title={workspace.actor}>
        <Avatar avatar={workspace.actorProfile?.avatar} value={workspace.actor} />
        <span>{workspace.actorProfile?.displayName ?? workspace.actor}</span><ChevronDown size={14} />
      </button>
    </div>
  </div>;
}

function useSignOut() {
  const { run } = useActions();
  return () => void run(async () => {
    try { await api('logout', {}); }
    finally { window.dispatchEvent(new Event('contractor-session-expired')); }
  });
}

function ProjectBranch({ branch, current, route, close }: { branch: Branch<PageProps['project']>; current: string; route: PageProps['route']['view']; close?: () => void }) {
  const { item, children } = branch;
  const [expanded, setExpanded] = useStored('project-branch:' + item.id, true);
  return <div className="project-tree-branch">
    <div className="project-tree-row">
      {children.length > 0 && <button type="button" className="tree-toggle" aria-expanded={expanded}
        aria-label={(expanded ? '收起' : '展开') + item.title + '的子项目'} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>}
      <a className="nav-row project-row" href={routeFor(item.id, 'project')}
        aria-current={item.id === current && route === 'project' ? 'page' : undefined}
        data-selected={item.id === current || undefined} onClick={close}>
        <FolderKanban size={16} /><span title={item.title}>{item.title}</span>{item.id === current && <i className="selection-dot" />}
      </a>
    </div>
    {expanded && children.length > 0 && <div className="project-tree-children">{children.map(child =>
      <ProjectBranch key={child.item.id} branch={child} current={current} route={route} close={close} />)}</div>}
  </div>;
}

function NewProject({ workspace, close }: { workspace: Overview; close: () => void }) {
  const { run, busy } = useActions();
  const [nonce] = useState(uid);
  const [template, setTemplate] = useState<ProjectTemplate>();
  const [templateName, setTemplateName] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [reading, setReading] = useState(false);
  const uploadVersion = useRef(0);
  const upload = useRef<HTMLInputElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  async function readTemplate(file?: File) {
    const version = ++uploadVersion.current;
    setTemplate(undefined);
    setTemplateError('');
    setTemplateName(file?.name ?? '');
    setReading(!!file);
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as ProjectTemplate;
      if (parsed?.kind !== 'contractor-project-template' || parsed.version !== 1)
        throw new Error();
      if (version === uploadVersion.current) setTemplate(parsed);
    } catch {
      if (version === uploadVersion.current) setTemplateError('无法导入，请选择 Contractor 导出的项目模板。');
    } finally {
      if (version === uploadVersion.current) setReading(false);
    }
  }
  const parents = workspace.projects.filter(project => project.maintain);
  return <Modal title="新建项目" close={close}><form className="form" onSubmit={async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (busy || reading || templateError) return;
    const result = await run(() => api<{ id: string }>('project', {
      nonce, title: String(form.get('title')).trim(), parent: form.get('parent') || undefined,
      firstTopic: String(form.get('firstTopic')).trim() || undefined,
      ...(template ? { template } : {}),
    }), '项目已创建');
    if (result) { go(result.id, 'project', undefined, 'structure'); close(); }
  }}><fieldset className="form dispatch-fields" disabled={busy}>
    <Field label="项目名称"><Input name="title" autoFocus maxLength={100} required /></Field>
    <Field label="首个主题（选填）"><Input name="firstTopic" maxLength={100} /></Field>
    <div className="field"><span>项目模板（选填）</span>
      <div className="actions">
        <input hidden ref={upload} type="file" aria-label="项目模板" accept="application/json,.json" disabled={busy}
          onChange={event => void readTemplate(event.target.files?.[0])} />
        <button ref={browse} type="button" className="upload-row" onClick={() => upload.current?.click()}><FileUp size={15} /><span>{reading ? '正在读取…' : templateName || '选择模板文件'}</span></button>
      {templateName && <Button variant="ghost" size="sm" disabled={busy} onClick={() => {
        if (upload.current) upload.current.value = '';
        void readTemplate();
        browse.current?.focus();
      }}>移除模板</Button>}</div>
      {templateError && <p className="form-error" role="alert">{templateError}</p>}
    </div>
    {!!parents.length && <Field label="上级项目"><select name="parent" required={!workspace.canCreateRootProject}>
      {workspace.canCreateRootProject && <option value="">独立项目</option>}
      {parents.map(project => <option value={project.id} key={project.id}>{project.title}</option>)}
    </select></Field>}
    <div className="form-actions"><Button loading={busy} disabled={busy || reading || !!templateError} type="submit">创建</Button></div>
  </fieldset></form></Modal>;
}

function Workspace({ retrySession }: { retrySession?: () => void }) {
  const overview = useData<Overview>('overview?catalog=1', 2600);
  const requested = useRoute();
  const signOut = useSignOut();
  const [collapsed, setCollapsed] = useState(() => preference('contractor-sidebar-collapsed') === 'true');
  const narrow = useMediaQuery('(max-width: 760px)');
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { if (!narrow) setDrawer(false); }, [narrow]);
  const [composer, setComposer] = useState<TaskPreset | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const { error, clearError } = useActions();
  useEffect(() => { clearError(); }, [requested.project, requested.view, requested.item, requested.global, requested.tab]);
  const workspace = overview.data;
  if (overview.error && (!workspace || !mayKeepStale(overview.error)))
    return <div className="app-placeholder"><Failure error={overview.error} retry={() => void overview.refetch()} /></div>;
  if (!workspace) return <Loading />;
  const reconnect = (overview.error || retrySession) && <div className="toolbar-error"><Failure error={new Error('工作台暂时无法刷新，编辑内容已保留。')}
    retry={retrySession ?? (() => void overview.refetch())} /></div>;
  if (requested.global) return <Suspense fallback={<Loading />}>
    <GlobalSettings view={requested.global} tab={requested.tab} fromProject={requested.project} returnTo={requested.returnTo} status={reconnect} workspace={workspace} logout={signOut}
      connections={requested.global === 'account' ? <AccountsPage workspace={workspace} embedded /> : undefined} />
  </Suspense>;
  const targetProject = workspace.projects.find(p => p.id === requested.project);
  if (!requested.personalChat && (requested.project || requested.reply) && !targetProject && requested.view !== 'home') return <div className="app-placeholder">
    <Failure error={new Error(requested.reply ? '当前账号无权打开这条主题回复。' : '当前账号无权打开此项目。')} />
    <a className="text-button" href="#/">返回工作台</a>
  </div>;
  const project = targetProject ?? workspace.projects[0];
  const newProject = () => setCreatingProject(true);
  const projectModal = creatingProject && <NewProject workspace={workspace} close={() => setCreatingProject(false)} />;
  if (!project && requested.personalChat) return <div className="standalone-chat">
    <header className="toolbar"><a href="#/">返回工作台</a><strong>会话</strong></header>
    <Suspense fallback={<Loading />}><PersonalChatPage workspace={workspace} conversation={requested.item} /></Suspense>
  </div>;
  if (!project) return <div className="app-placeholder">
    <Empty icon={<FolderKanban />} title={workspace.canCreateProject ? '创建第一个项目' : '暂无可访问项目'}
      description={workspace.canCreateProject ? '项目用来组织主题、工单、成员、Agent 和执行设备。'
        : '请联系项目维护人添加成员权限，或由平台管理员分配项目。'}
      action={<div className="actions">
        {workspace.canCreateProject && <Button onClick={newProject}><Plus />新建项目</Button>}
        {(workspace.canManageAccounts || workspace.canManagePointPolicy || workspace.canManageServices) && <a className="text-button" href="#/platform">平台管理</a>}
        <a className="text-button" href={personalChatRoute()}>会话</a><a className="text-button" href="#/account">个人设置</a>
        <Button variant="ghost" onClick={signOut}>退出登录</Button>
      </div>} />
    {projectModal}
  </div>;
  const route = { ...requested, project: project.id, item: requested.item };
  const props = { workspace, project, route, openTask: (preset: TaskPreset = {}) => { clearError(); setComposer(preset); } };
  const Page = { home: HomePage, chat: ChatPage, inbox: InboxPage, work: WorkPage, knowledge: KnowledgePage, agents: AgentsPage, project: ProjectPage, accounts: AccountsPage }[route.view];
  const chat = route.view === 'chat';
  const page = <Suspense fallback={<Loading />}>{route.personalChat
    ? <PersonalChatPage workspace={workspace} project={project.id} conversation={route.item} />
    : <Page key={project.id + ':' + route.view} {...props} />}</Suspense>;
  return <Layout className="shell" hasSider={!narrow} data-collapsed={collapsed || undefined}>
    {!narrow && <WorkspaceSidebar collapsed={collapsed}><Navigation {...props} newProject={newProject} /></WorkspaceSidebar>}
    {narrow && <Drawer className="mobile-workspace-nav" placement="left" title="导航" size={280} open={drawer}
      onClose={() => setDrawer(false)} destroyOnHidden>
      <Navigation {...props} newProject={newProject} close={() => setDrawer(false)} />
    </Drawer>}
    <Layout className="workspace">
      <Layout.Header className="toolbar">
        <IconButton label={narrow ? '打开导航' : collapsed ? '展开侧栏' : '收起侧栏'} className="sidebar-toggle"
          onClick={() => {
            if (narrow) setDrawer(true);
            else { savePreference('contractor-sidebar-collapsed', String(!collapsed)); setCollapsed(!collapsed); }
          }}>{narrow ? <Menu /> : collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</IconButton>
        <Breadcrumb aria-label="当前位置" className="toolbar-path" items={[
          { title: <a href={routeFor(project.id, 'project')}><FolderKanban size={14} /><span>{project.title}</span></a> },
          ...(route.view === 'project' ? [] : [{ title: titles[route.view] }]),
        ]} />
        <WorkspaceSearch workspace={workspace} />
        {project.mayStart && !route.personalChat && !(chat && (route.item || route.tab === 'project')) && !(route.view === 'work' && !route.item) &&
          <Button size="sm" type="button" className="create-button" onClick={() => props.openTask()}><Plus />发起协作</Button>}
      </Layout.Header>
      {reconnect}
      {error && !composer && <div className="toolbar-error"><Failure error={new Error(error)} dismiss={clearError} /></div>}
      <Layout.Content className={'main-view' + (chat ? ' task-center' : '')} id="main-content">
        {chat && <nav className="task-center-tabs" aria-label="会话范围">
          <a href={personalChatRoute(undefined, project.id)} aria-current={route.personalChat ? 'page' : undefined}>个人会话</a>
          <a href={routeFor(project.id, 'chat', undefined, 'project')} aria-current={!route.personalChat ? 'page' : undefined}>项目会话</a>
        </nav>}
        {chat ? <div className="task-center-content">{page}</div> : page}
      </Layout.Content>
    </Layout>
    {composer && <Composer {...props} preset={composer} close={() => setComposer(null)} />}
    {projectModal}
  </Layout>;
}

function App() {
  const client = useQueryClient();
  const session = useData<Session>('session');
  const busyRef = useRef(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [closingNotice, setClosingNotice] = useState(false);
  const [stored, setStored] = useState<Record<string, unknown>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('contractor-drafts') ?? '{}') as unknown;
      return saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
    } catch { return {}; }
  });
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem('contractor-drafts', JSON.stringify(stored));
      setStorageFailed(false);
    } catch { setStorageFailed(Object.keys(stored).length > 0); }
  }, [stored]);
  const [scrollPositions] = useState(() => new Map<string, { top: number; left: number }>());
  useEffect(() => {
    const expired = () => {
      const prior = client.getQueryData<Session>(['session']);
      client.clear();
      client.setQueryData<Session>(['session'], { ...prior, signedIn: false });
      setStored({});
      try { localStorage.removeItem('contractor-drafts'); } catch { /* 忽略存储不可用 */ }
      scrollPositions.clear();
      setNotice('');
    };
    window.addEventListener('contractor-session-expired', expired);
    return () => window.removeEventListener('contractor-session-expired', expired);
  }, [client, scrollPositions]);
  useEffect(() => {
    setClosingNotice(false);
    if (!notice) return;
    const leave = window.setTimeout(() => setClosingNotice(true), 3360);
    const clear = window.setTimeout(() => setNotice(''), 3500);
    return () => { window.clearTimeout(leave); window.clearTimeout(clear); };
  }, [notice]);
  useEffect(() => {
    const remember = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return;
      const target = event.target instanceof Element ? event.target : null;
      const trigger = target?.closest<HTMLElement>('button, a[href], [role="button"]');
      if (trigger && !trigger.closest('[role="dialog"]')) dialogTrigger.current = trigger;
    };
    document.addEventListener('pointerdown', remember, true);
    document.addEventListener('keydown', remember, true);
    return () => {
      document.removeEventListener('pointerdown', remember, true);
      document.removeEventListener('keydown', remember, true);
    };
  }, []);
  async function run<T>(task: () => Promise<T>, message?: string | ((result: T) => string)) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await task();
      await client.invalidateQueries();
      if (message) setNotice(typeof message === 'function' ? message(result) : message);
      return result;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作暂未完成，请重试。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return <ActionContext.Provider value={{ busy, run, error, clearError: () => setError(''), stored, scrollPositions, dialogTrigger,
    store: (key, value, expected) => setStored(previous => writeStoredValue(previous, key, value, expected)) }}>
    {session.error && !(session.data?.signedIn && mayKeepStale(session.error)) ? <div className="app-placeholder"><Failure error={session.error} retry={() => void session.refetch()} /></div>
      : session.isPending ? <Loading /> : session.data?.signedIn ? <Workspace retrySession={session.error ? () => void session.refetch() : undefined} /> : <Login session={session.data} />}
    {storageFailed && <div className="draft-warning" role="status">草稿仅保留在当前页面，刷新前请复制未提交的内容。</div>}
    {notice && <div className="toast" role="status" data-closing={closingNotice}><CircleCheck size={17} />{notice}</div>}
  </ActionContext.Provider>;
}

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 0, refetchOnWindowFocus: 'always' } } });
const styleNonce = document.querySelector<HTMLMetaElement>('meta[name="workbench-style-nonce"]')?.content;
class PageRecovery extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="app-placeholder">
      <p role="alert">当前页面未能打开。</p>
      <Button onClick={() => window.location.reload()}>重新加载当前页</Button>
    </main>;
    return this.props.children;
  }
}

function WorkbenchApp() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  return <ConfigProvider locale={zhCN as unknown as ConfigProviderProps['locale']} wave={{ disabled: true }}
    button={{ autoInsertSpace: false }} csp={{ nonce: styleNonce }}
    theme={{ ...workbenchTheme, zeroRuntime: true }}>
    {/* Keep the provider mounted so a live OS setting change preserves the active editor. */}
    <MotionProvider motion={!reduced}><QueryClientProvider client={client}><PageRecovery><App /></PageRecovery></QueryClientProvider></MotionProvider>
  </ConfigProvider>;
}
createRoot(document.getElementById('app')!).render(<WorkbenchApp />);
