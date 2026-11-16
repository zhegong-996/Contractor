import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Bot, ChevronDown, CircleCheck, FolderKanban, Inbox, ListChecks, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plug2, Plus } from 'lucide-react';
import { api, uid, useData, type Overview } from './api.ts';
import { ActionContext, Avatar, Failure, Field, IconButton, Loading, Logo, Modal, useActions } from './ui.tsx';
import { Button } from './paperclip/button.tsx';
import { Input } from './paperclip/input.tsx';
import { SidebarShell } from './paperclip/SidebarShell.tsx';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from './paperclip/breadcrumb.tsx';
import { go, routeFor, titles, useRoute, type PageProps, type TaskPreset } from './navigation.ts';
import { Composer } from './creation.tsx';
import { InboxPage } from './inbox.tsx';
import './style.css';

const WorkPage = lazy(() => import('./work.tsx').then(page => ({ default: page.WorkPage })));
const KnowledgePage = lazy(() => import('./knowledge.tsx').then(page => ({ default: page.KnowledgePage })));
const AgentsPage = lazy(() => import('./agents.tsx').then(page => ({ default: page.AgentsPage })));
const ProjectPage = lazy(() => import('./project.tsx').then(page => ({ default: page.ProjectPage })));
const AccountsPage = lazy(() => import('./project.tsx').then(page => ({ default: page.AccountsPage })));

const nav = [
  { key: 'inbox', icon: Inbox }, { key: 'work', icon: ListChecks }, { key: 'knowledge', icon: BookOpen }, { key: 'agents', icon: Bot },
] as const;

function Login() {
  const { busy, run, error } = useActions();
  const query = useQueryClient();
  return <div className="login-wrap">
    <div className="login-sheet">
      <div className="brand"><Logo /><span>SuitMe 协作台</span></div>
      <h1>登录工作台</h1>
      <form className="form" onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await run(async () => {
          await api('login', { username: String(form.get('username')).trim(), password: form.get('password') });
          query.setQueryData(['session'], { signedIn: true });
          return true;
        });
      }}>
        <Field label="账号"><Input name="username" autoComplete="username" required autoFocus /></Field>
        <Field label="口令"><Input name="password" autoComplete="current-password" type="password" required /></Field>
        {error && <Failure error={new Error(error)} />}
        <Button type="submit" disabled={busy}>登录 <ArrowRight /></Button>
      </form>
    </div>
  </div>;
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
  const { run } = useActions();
  const query = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [profile, setProfile] = useState(false);
  return <div className="sidebar-content">
    <a className="brand" href={routeFor(project.id, 'inbox')} onClick={close}><Logo /><span>SuitMe <small>协作台</small></span></a>
    <nav className="sidebar-nav" aria-label="工作入口">
      {nav.map(({ key, icon: Icon }) => <a key={key} href={routeFor(project.id, key)} onClick={close}
        className="nav-row" aria-current={route.view === key ? 'page' : undefined}>
        <Icon size={17} /><span>{titles[key]}</span>
        {key === 'inbox' && workspace.needsYou.length > 0 && <span className="nav-count">{workspace.needsYou.length}</span>}
      </a>)}
    </nav>
    <div className="project-nav">
      <button className="group-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <span>项目</span><ChevronDown size={15} className={expanded ? '' : '-rotate-90'} />
      </button>
      {workspace.canCreateProject && <button className="nav-row" type="button" onClick={() => { close?.(); newProject(); }}><Plus size={16} />新建项目</button>}
      {expanded && <nav aria-label="可访问项目">{workspace.projects.map(item => <a className={'nav-row project-row' + (item.parent ? ' project-child' : '')}
        key={item.id} href={routeFor(item.id, 'project')} aria-current={item.id === project.id && route.view === 'project' ? 'page' : undefined}
        data-selected={item.id === project.id || undefined} onClick={close}>
        <FolderKanban size={16} /><span title={item.title}>{item.title}</span>{item.id === project.id && <i className="selection-dot" />}
      </a>)}</nav>}
    </div>
    <div className="sidebar-footer">
      <a className="nav-row" href={routeFor(project.id, 'accounts')} onClick={close} aria-current={route.view === 'accounts' ? 'page' : undefined}>
        <Plug2 size={17} /><span>连接与账号</span>
      </a>
      {profile && <div className="profile-menu">
        <Button variant="ghost" type="button" onClick={() => void run(async () => {
          await api('logout', {});
          query.clear();
          query.setQueryData(['session'], { signedIn: false });
          window.dispatchEvent(new Event('suitme-session-expired'));
          return true;
        })}><LogOut />退出登录</Button>
      </div>}
      <button className="profile" aria-expanded={profile} type="button" onClick={() => setProfile(value => !value)} title={workspace.actor}>
        <Avatar value={workspace.actor} /><span>{workspace.actor}</span><ChevronDown size={14} />
      </button>
    </div>
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
    {!!parents.length && <Field label="上级项目"><select name="parent"><option value="">独立项目</option>
      {parents.map(project => <option value={project.id} key={project.id}>{project.title}</option>)}
    </select></Field>}
    <div className="form-actions"><Button disabled={busy} type="submit">创建</Button></div>
  </form></Modal>;
}

function Workspace() {
  const overview = useData<Overview>('overview', 2600);
  const requested = useRoute();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('suitme-sidebar-collapsed') === 'true');
  const narrow = useNarrow();
  const [drawer, setDrawer] = useState(false);
  const [composer, setComposer] = useState<TaskPreset | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const { error, clearError } = useActions();
  useEffect(() => { clearError(); }, [requested.project, requested.view, requested.item]);
  const workspace = overview.data;
  if (overview.error) return <div className="app-placeholder"><Failure error={overview.error} retry={() => void overview.refetch()} /></div>;
  if (!workspace) return <Loading />;
  const targetProject = workspace.projects.find(p => p.id === requested.project);
  if (requested.reply && !targetProject) return <div className="app-placeholder">
    <Failure error={new Error('当前账号无权打开这条主题回复。')} /><a href="#/">返回工作台</a>
  </div>;
  const project = targetProject ?? workspace.projects[0];
  const newProject = () => setCreatingProject(true);
  const projectModal = creatingProject && <NewProject workspace={workspace} close={() => setCreatingProject(false)} />;
  if (!project) return <div className="app-placeholder">
    <Failure error={new Error('当前账号尚未加入项目。')} />
    {workspace.canCreateProject && <Button onClick={newProject}>新建项目</Button>}{projectModal}
  </div>;
  const route = { ...requested, project: project.id, item: requested.project && requested.project !== project.id ? undefined : requested.item };
  const props = { workspace, project, route, openTask: (preset: TaskPreset = {}) => { clearError(); setComposer(preset); } };
  const Page = { inbox: InboxPage, work: WorkPage, knowledge: KnowledgePage, agents: AgentsPage, project: ProjectPage, accounts: AccountsPage }[route.view];
  return <div className="shell" data-collapsed={collapsed || undefined}>
    {!narrow && <SidebarShell open collapsed={collapsed} resizable storageKey="suitme.sidebar.width" className="suitme-sidebar"><Navigation {...props} newProject={newProject} /></SidebarShell>}
    {narrow && drawer && <Modal title="工作台导航" close={() => setDrawer(false)}><Navigation {...props} newProject={newProject} close={() => setDrawer(false)} /></Modal>}
    <div className="workspace">
      <header className="toolbar">
        <IconButton label={narrow ? '打开导航' : collapsed ? '展开侧栏' : '收起侧栏'} className="sidebar-toggle"
          onClick={() => {
            if (narrow) setDrawer(true);
            else { localStorage.setItem('suitme-sidebar-collapsed', String(!collapsed)); setCollapsed(!collapsed); }
          }}>{narrow ? <Menu /> : collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</IconButton>
        <Breadcrumb aria-label="当前位置" className="toolbar-path"><BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href={routeFor(project.id, 'project')}><FolderKanban size={14} />{project.title}</BreadcrumbLink></BreadcrumbItem>
          {route.view !== 'project' && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{titles[route.view]}</BreadcrumbPage></BreadcrumbItem></>}
        </BreadcrumbList></Breadcrumb>
        {project.mayStart && <Button size="sm" type="button" className="create-button" onClick={() => props.openTask()}><Plus />发起协作</Button>}
      </header>
      {error && !composer && <div className="toolbar-error"><Failure error={new Error(error)} retry={clearError} /></div>}
      <main className="main-view" id="main-content">
        <Suspense fallback={<Loading />}><Page key={project.id + ':' + route.view} {...props} /></Suspense>
      </main>
    </div>
    {composer && <Composer {...props} preset={composer} close={() => setComposer(null)} />}
    {projectModal}
  </div>;
}

function App() {
  const client = useQueryClient();
  const session = useData<{ signedIn: boolean }>('session');
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stored, setStored] = useState<Record<string, unknown>>({});
  useEffect(() => {
    const expired = () => {
      client.clear();
      client.setQueryData(['session'], { signedIn: false });
      setStored({});
      setNotice('');
    };
    window.addEventListener('suitme-session-expired', expired);
    return () => window.removeEventListener('suitme-session-expired', expired);
  }, [client]);
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
  return <ActionContext.Provider value={{ busy, run, error, clearError: () => setError(''), stored,
    store: (key, value) => setStored(previous => ({ ...previous, [key]: value })) }}>
    {session.error ? <div className="app-placeholder"><Failure error={session.error} retry={() => void session.refetch()} /></div>
      : session.isPending ? <Loading /> : session.data?.signedIn ? <Workspace /> : <Login />}
    {notice && <div className="toast" role="status"><CircleCheck size={17} />{notice}</div>}
  </ActionContext.Provider>;
}

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 0, refetchOnWindowFocus: 'always' } } });
createRoot(document.getElementById('app')!).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
