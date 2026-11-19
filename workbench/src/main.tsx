import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Breadcrumb, ConfigProvider, Drawer, Layout, Menu as NavigationMenu, type ConfigProviderProps } from 'antd';
import zhCN from 'antd/es/locale/zh_CN.js';
import { ArrowRight, BookOpen, Bot, ChevronDown, ChevronRight, CircleCheck, FolderKanban, Inbox, ListChecks, LogOut, Menu, MessagesSquare, PanelLeftClose, PanelLeftOpen, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { api, uid, useData, type Overview, type Session } from './api.ts';
import { ActionContext, Avatar, Failure, Field, IconButton, Loading, Logo, Modal, useActions, useStored } from './ui.tsx';
import { Button } from './components/button.tsx';
import { Input } from './components/input.tsx';
import { preference, WorkspaceSidebar } from './components/workspace-sidebar.tsx';
import { go, routeFor, titles, useRoute, type PageProps, type TaskPreset } from './navigation.ts';
import { Composer } from './creation.tsx';
import { forest, type Branch } from './hierarchy.ts';
import { workbenchTheme } from './components/theme.ts';
import { IMLoginButton, useIMNotice } from './im-login.tsx';
import 'virtual:workbench-antd.css';
import './style.css';

const WorkPage = lazy(() => import('./work.tsx').then(page => ({ default: page.WorkPage })));
const InboxPage = lazy(() => import('./inbox.tsx').then(page => ({ default: page.InboxPage })));
const ChatPage = lazy(() => import('./chat.tsx').then(page => ({ default: page.ChatPage })));
const KnowledgePage = lazy(() => import('./knowledge.tsx').then(page => ({ default: page.KnowledgePage })));
const AgentsPage = lazy(() => import('./agents.tsx').then(page => ({ default: page.AgentsPage })));
const ProjectPage = lazy(() => import('./project.tsx').then(page => ({ default: page.ProjectPage })));
const AccountsPage = lazy(() => import('./project.tsx').then(page => ({ default: page.AccountsPage })));
const GlobalSettings = lazy(() => import('./access-settings.tsx').then(page => ({ default: page.GlobalSettings })));

const nav = [
  { key: 'chat', icon: MessagesSquare }, { key: 'inbox', icon: Inbox }, { key: 'work', icon: ListChecks },
  { key: 'agents', icon: Bot }, { key: 'knowledge', icon: BookOpen },
] as const;

function Login({ session }: { session?: Session }) {
  const { busy, run, error } = useActions();
  const query = useQueryClient();
  const [accountAction, setAccountAction] = useState<'recovery' | 'activation'>();
  const notice = useIMNotice();
  const { recoveryUrl, imLogin } = session ?? {};
  const usePassword = imLogin?.legacyPassword !== false;
  const passwordForm = <form className="form" onSubmit={async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api('login', { username: String(form.get('username')).trim(), password: form.get('password') });
      query.setQueryData<Session>(['session'], { ...session, signedIn: true });
      return true;
    });
  }}>
    <Field label="账号"><Input name="username" autoComplete="username" required autoFocus={!imLogin?.ready} /></Field>
    <Field label="口令"><Input name="password" autoComplete="current-password" type="password" required /></Field>
    {error && <Failure error={new Error(error)} />}
    <Button type="submit" disabled={busy}>登录 <ArrowRight /></Button>
    {recoveryUrl && <div className="actions">
      {session?.legacyActivation && <Button type="button" variant="ghost" size="sm" onClick={() => setAccountAction('activation')}>开通账号</Button>}
      <Button type="button" variant="ghost" size="sm" onClick={() => setAccountAction('recovery')}>找回口令</Button>
    </div>}
  </form>;
  return <div className="login-wrap">
    <div className="login-sheet">
      <div className="brand"><Logo /><span>Contractor</span></div>
      <h1>登录工作台</h1>
      {notice.text && <p className="login-notice" role={notice.status === 'pending' ? 'status' : 'alert'}>{notice.text}</p>}
      <IMLoginButton login={imLogin} />
      {imLogin?.provider && !imLogin.ready && <p className="login-notice" role="status">主登录渠道暂未就绪，请联系平台管理员。</p>}
      {usePassword && (imLogin?.ready ? <details className="login-alternative" open={notice.status === 'existing' || undefined}>
        <summary>使用原账号口令</summary>{passwordForm}
      </details> : passwordForm)}
    </div>
    {recoveryUrl && accountAction === 'recovery' && <RecoveryDialog url={recoveryUrl} close={() => setAccountAction(undefined)} />}
    {recoveryUrl && session?.legacyActivation && accountAction === 'activation' && <ActivationDialog url={recoveryUrl} close={() => setAccountAction(undefined)} />}
  </div>;
}

type ActivationChallenge = { id: string; token: string; command: string; expires: number };
type ActivationStatus = { state: 'waiting' | 'verified' | 'approved'; expires: number; feishuName?: string };
function ActivationDialog({ url, close }: { url: string; close: () => void }) {
  const { run, busy, clearError } = useActions();
  const [challenge, setChallenge] = useStored<ActivationChallenge | undefined>('account-activation', undefined);
  const [status, setStatus] = useState<ActivationStatus>();
  const approved = status?.state === 'approved';
  const verified = status?.state === 'verified';
  function reset() { clearError(); setChallenge(undefined); setStatus(undefined); }
  return <Modal title="开通工作台账号" close={close}>
    <form className="form" onSubmit={async event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      if (!challenge) {
        const result = await run(() => api<ActivationChallenge>('account/activation/start', { username: String(values.get('name')).trim() }));
        if (result) setChallenge(result);
        return;
      }
      const proof = { id: challenge.id, token: challenge.token };
      if (approved) {
        if (await run(() => api('account/activation/complete', { ...proof, password: values.get('password') }), '账号已开通，请登录')) {
          reset();
          close();
        }
        return;
      }
      const result = await run(() => api<ActivationStatus>('account/activation/status', proof));
      if (result) setStatus(result);
    }}>
      {!challenge ? <Field label="拟用账号名"><Input name="name" autoComplete="username" minLength={2} maxLength={32} required autoFocus /></Field>
        : approved ? <>
          <p>{status.feishuName} 的账号已批准。</p>
          <Field label="设置口令"><Input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={300} required autoFocus /></Field>
        </>
        : verified ? <p>已验证飞书账号 {status.feishuName}。请等待平台管理员批准，再回到此处设置口令。</p>
        : <>
          <p>请用企内飞书私聊机器人，在 10 分钟内发送这条命令。验证后需由平台管理员批准账号和角色。</p>
          <code>{challenge.command}</code>
          <div className="actions">
            <Button type="button" variant="outline" onClick={() => void run(() => navigator.clipboard.writeText(challenge.command), '已复制命令')}>复制命令</Button>
            <a className="text-button" href={url} target="_blank" rel="noreferrer">打开飞书机器人</a>
          </div>
          {status?.state === 'waiting' && <p className="muted-text" role="status">正在等待企内飞书验证。</p>}
        </>}
      <div className="form-actions">
        {challenge && <Button type="button" variant="ghost" disabled={busy} onClick={reset}>重新发起</Button>}
        <Button type="submit" disabled={busy}>{!challenge ? '生成验证命令' : approved ? '开通账号' : '查看开通状态'}</Button>
      </div>
    </form>
  </Modal>;
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

function useNarrow() {
  const match = '(max-width: 760px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(match).matches);
  useEffect(() => {
    const media = window.matchMedia(match);
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return narrow;
}

function Navigation({ workspace, project, route, close, newProject }: PageProps & { close?: () => void; newProject: () => void }) {
  const signOut = useSignOut();
  const [expanded, setExpanded] = useState(true);
  const [profile, setProfile] = useState(false);
  return <div className="sidebar-content">
    <a className="brand" href={routeFor(project.id, 'inbox')} onClick={close} aria-label="Contractor"><Logo /><span>Contractor</span></a>
    <nav className="sidebar-nav" aria-label="工作入口">
      <NavigationMenu mode="inline" selectedKeys={[route.view]} className="primary-navigation"
        items={nav.map(({ key, icon: Icon }) => ({ key, icon: <Icon size={17} />, title: titles[key],
          label: <a href={routeFor(project.id, key)} aria-current={route.view === key ? 'page' : undefined}>
            {titles[key]}{key === 'inbox' && workspace.needsYou.length > 0 && <span className="nav-count">{workspace.needsYou.length}</span>}
          </a> }))}
        onClick={({ key, domEvent }) => {
          if (domEvent.ctrlKey || domEvent.metaKey || domEvent.shiftKey || domEvent.altKey) return;
          domEvent.preventDefault();
          go(project.id, key as (typeof nav)[number]['key']);
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
        <a className="nav-row" href="#/platform" onClick={close}><ShieldCheck size={17} /><span>平台管理</span></a>}
      <a className="nav-row" href="#/account" onClick={close}><UserRound size={17} /><span>个人设置</span></a>
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
  const parents = workspace.projects.filter(project => project.maintain);
  return <Modal title="新建项目" close={close}><form className="form" onSubmit={async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await run(() => api<{ id: string }>('project', {
      nonce, title: String(form.get('title')).trim(), parent: form.get('parent') || undefined,
    }), '项目已创建');
    if (result) { go(result.id, 'project', undefined, 'structure'); close(); }
  }}>
    <Field label="项目名称"><Input name="title" autoFocus maxLength={100} required /></Field>
    {!!parents.length && <Field label="上级项目"><select name="parent" required={!workspace.canCreateRootProject}>
      {workspace.canCreateRootProject && <option value="">独立项目</option>}
      {parents.map(project => <option value={project.id} key={project.id}>{project.title}</option>)}
    </select></Field>}
    <div className="form-actions"><Button disabled={busy} type="submit">创建</Button></div>
  </form></Modal>;
}

function Workspace() {
  const overview = useData<Overview>('overview?catalog=1', 2600);
  const requested = useRoute();
  const signOut = useSignOut();
  const [collapsed, setCollapsed] = useState(() => preference('contractor-sidebar-collapsed') === 'true');
  const narrow = useNarrow();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { if (!narrow) setDrawer(false); }, [narrow]);
  const [composer, setComposer] = useState<TaskPreset | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const { error, clearError } = useActions();
  useEffect(() => { clearError(); }, [requested.project, requested.view, requested.item, requested.global, requested.tab]);
  const workspace = overview.data;
  if (overview.error) return <div className="app-placeholder"><Failure error={overview.error} retry={() => void overview.refetch()} /></div>;
  if (!workspace) return <Loading />;
  if (requested.global) return <Suspense fallback={<Loading />}>
    <GlobalSettings view={requested.global} tab={requested.tab} workspace={workspace} logout={signOut}
      connections={requested.global === 'account' ? <AccountsPage workspace={workspace} embedded /> : undefined} />
  </Suspense>;
  const targetProject = workspace.projects.find(p => p.id === requested.project);
  if ((requested.project || requested.reply) && !targetProject) return <div className="app-placeholder">
    <Failure error={new Error(requested.reply ? '当前账号无权打开这条主题回复。' : '当前账号无权打开此项目。')} />
    <a className="text-button" href="#/">返回工作台</a>
  </div>;
  const project = targetProject ?? workspace.projects[0];
  const newProject = () => setCreatingProject(true);
  const projectModal = creatingProject && <NewProject workspace={workspace} close={() => setCreatingProject(false)} />;
  if (!project) return <div className="app-placeholder">
    <Failure error={new Error('当前账号尚未加入项目。')} />
    <div className="actions mt-4">{workspace.canCreateProject && <Button onClick={newProject}>新建项目</Button>}
      {(workspace.canManageAccounts || workspace.canManagePointPolicy || workspace.canManageServices) && <a className="text-button" href="#/platform">平台管理</a>}
      <a className="text-button" href="#/account">个人设置</a><Button variant="ghost" onClick={signOut}>退出登录</Button></div>{projectModal}
  </div>;
  const route = { ...requested, project: project.id, item: requested.project && requested.project !== project.id ? undefined : requested.item };
  const props = { workspace, project, route, openTask: (preset: TaskPreset = {}) => { clearError(); setComposer(preset); } };
  const Page = { chat: ChatPage, inbox: InboxPage, work: WorkPage, knowledge: KnowledgePage, agents: AgentsPage, project: ProjectPage, accounts: AccountsPage }[route.view];
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
            else { localStorage.setItem('contractor-sidebar-collapsed', String(!collapsed)); setCollapsed(!collapsed); }
          }}>{narrow ? <Menu /> : collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</IconButton>
        <Breadcrumb aria-label="当前位置" className="toolbar-path" items={[
          { title: <a href={routeFor(project.id, 'project')}><FolderKanban size={14} /><span>{project.title}</span></a> },
          ...(route.view === 'project' ? [] : [{ title: titles[route.view] }]),
        ]} />
        {project.mayStart && !(route.view === 'chat' && (route.item || route.tab === 'project')) && !(route.view === 'work' && !route.item) &&
          <Button size="sm" type="button" className="create-button" onClick={() => props.openTask()}><Plus />发起协作</Button>}
      </Layout.Header>
      {error && !composer && <div className="toolbar-error"><Failure error={new Error(error)} retry={clearError} /></div>}
      <Layout.Content className="main-view" id="main-content">
        <Suspense fallback={<Loading />}><Page key={project.id + ':' + route.view} {...props} /></Suspense>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stored, setStored] = useState<Record<string, unknown>>({});
  const [scrollPositions] = useState(() => new Map<string, { top: number; left: number }>());
  useEffect(() => {
    const expired = () => {
      const prior = client.getQueryData<Session>(['session']);
      client.clear();
      client.setQueryData<Session>(['session'], { ...prior, signedIn: false });
      setStored({});
      scrollPositions.clear();
      setNotice('');
    };
    window.addEventListener('contractor-session-expired', expired);
    return () => window.removeEventListener('contractor-session-expired', expired);
  }, [client, scrollPositions]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  async function run<T>(task: () => Promise<T>, message?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await task();
      await client.invalidateQueries();
      if (message) setNotice(message);
      return result;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作暂未完成，请重试。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return <ActionContext.Provider value={{ busy, run, error, clearError: () => setError(''), stored, scrollPositions,
    store: (key, value) => setStored(previous => ({ ...previous, [key]: value })) }}>
    {session.error ? <div className="app-placeholder"><Failure error={session.error} retry={() => void session.refetch()} /></div>
      : session.isPending ? <Loading /> : session.data?.signedIn ? <Workspace /> : <Login session={session.data} />}
    {notice && <div className="toast" role="status"><CircleCheck size={17} />{notice}</div>}
  </ActionContext.Provider>;
}

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 0, refetchOnWindowFocus: 'always' } } });
const styleNonce = document.querySelector<HTMLMetaElement>('meta[name="workbench-style-nonce"]')?.content;
createRoot(document.getElementById('app')!).render(<ConfigProvider locale={zhCN as unknown as ConfigProviderProps['locale']} wave={{ disabled: true }}
  button={{ autoInsertSpace: false }} csp={{ nonce: styleNonce }}
  theme={{ ...workbenchTheme, zeroRuntime: true }}>
  <QueryClientProvider client={client}><App /></QueryClientProvider>
</ConfigProvider>);
