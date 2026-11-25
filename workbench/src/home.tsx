import { ProjectHealth } from './engineering-decisions.tsx';
import { ArrowRight, ClipboardCheck, CircleDot, FolderKanban, Inbox, ListChecks } from 'lucide-react';
import { ticketListState } from '../../src/workbench/ticket-list-state.ts';
import { useData, type Decision, type Overview } from './api.ts';
import { decisionTone, decisionVisual } from './inbox.tsx';
import { projectWorkRoute, routeFor, workFromInbox, type PageProps } from './navigation.ts';
import { date, Failure, Loading, Section, short, TicketStatus, Version } from './ui.tsx';

function decisionRoute(d: Decision) {
  if (d.kind === 'intake' || d.kind === 'channel') return;
  if (d.ticket) {
    const tab = d.kind === 'access' ? 'context' : d.kind === 'acceptance' ? 'verification' : d.kind === 'delivery' ? 'delivery' : 'activity';
    return workFromInbox(routeFor(d.project, 'work', d.ticket, tab), d.project, d.id, d.acceptanceRevision);
  }
  if (d.kind === 'discussion') return routeFor(d.project, 'project', d.subject, 'discussion');
  if (d.kind === 'budget') return routeFor(d.project, 'project', undefined, 'usage');
}

function focusSection(id: string) {
  const section = document.getElementById(id);
  section?.focus({ preventScroll: true });
  section?.scrollIntoView({ block: 'start' });
}

export function HomePage({ workspace, project }: PageProps) {
  const needsYou = workspace.needsYou;
  // The shell intentionally loads only its navigation catalog. Home owns the
  // bounded ticket read so a missing ticket list cannot be mistaken for zero.
  const activity = useData<Overview>('overview');
  const tickets = activity.data?.tickets ?? [];
  const states = tickets.map(ticket => ticketListState(ticket));
  const running = tickets.filter((ticket, index) => states[index] === 'running');
  const review = tickets.filter((ticket, index) => states[index] === 'review');
  const recent = [...tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const unavailable = activity.isPending || !!activity.error;
  const count = (items: unknown[]) => unavailable ? '—' : items.length + (tickets.length === 100 ? '+' : '');
  const display = workspace.actorProfile?.displayName ?? workspace.actor;
  const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  const home = (ticketId: string, project: string) => routeFor(project, 'work', ticketId);
  return <div className="page-scroll"><div className="dashboard">
    <div className="dashboard-heading">
      <div><h1>工作台概览</h1><p>{display} · {today}</p></div>
      <div className="actions">
        <a className="text-button" href={routeFor(project.id, 'work') + '?scope=mine'}>我的研发任务 <ArrowRight size={14} /></a>
        {workspace.projects.some(project => project.maintain) && <button type="button" className="text-button" onClick={() => focusSection('project-health')}>项目健康</button>}
      </div>
    </div>
    <div className="home-stats">
      <a className="home-stat" href={'#/inbox'}><Inbox size={18} /><span>{needsYou.length}</span><small>待我处理</small></a>
      <button type="button" className="home-stat" onClick={() => focusSection('home-running')}><CircleDot size={18} /><span>{count(running)}</span><small>正在执行</small></button>
      <button type="button" className="home-stat" onClick={() => focusSection('home-review')}><ClipboardCheck size={18} /><span>{count(review)}</span><small>待验收</small></button>
    </div>
    {tickets.length === 100 && <p className="home-stat-scope">执行与验收数量统计当前可见项目的最近 100 张工单。</p>}
    {activity.error && <div className="home-load-status"><Failure error={activity.error} retry={() => void activity.refetch()} /></div>}
    <div className="dashboard-grid">
      <div className="dashboard-main">
        <Section title="待我处理" action={<a className="text-button" href="#/inbox">全部待办 <ArrowRight size={14} /></a>}>
          {needsYou.length ? needsYou.slice(0, 6).map(d => {
            const [Icon, kind] = decisionVisual[d.kind] ?? [ListChecks, d.kind];
            const href = decisionRoute(d);
            const contents = <><span className="inbox-icon"><Icon size={18} /></span><div className="inbox-item-body">
              <div className="inbox-item-meta"><span className="category-label">{kind}</span>
                <span>{workspace.projects.find(p => p.id === d.project)?.title}</span>
                {d.ticket && <code title={d.ticket}>{short(d.ticket)}</code>}{d.version && <Version version={d.version} />}</div>
              <strong>{d.ticketTitle ?? d.title}</strong>
            </div><span className="inbox-item-end"><time>{date(d.openedAt)}</time></span></>;
            return href ? <a key={d.id} className="inbox-row" data-tone={decisionTone[d.kind] ?? 'blue'} href={href}>{contents}</a>
              : <div key={d.id} className="inbox-row" data-tone={decisionTone[d.kind] ?? 'blue'}>{contents}</div>;
          }) : <p className="muted-text">没有待你决定的事项。</p>}
        </Section>
        {workspace.projects.some(project => project.maintain) && <div id="project-health" tabIndex={-1}><ProjectHealth workspace={workspace} /></div>}
        <div id="home-running" tabIndex={-1}><Section title="正在执行" action={<span className="muted-text">{running.length} 张</span>}>
          {running.length ? running.slice(0, 6).map(item => <a className="recent-row" key={item.id} href={home(item.id, item.work.project)}>
            <CircleDot size={17} /><div><strong>{item.title}</strong><small>{item.progress?.device ?? workspace.agents.find(a => a.id === item.work.agent)?.title ?? item.work.agent}
              {item.progress?.summary ? ' · ' + item.progress.summary : ''}</small></div><TicketStatus ticket={item} />
          </a>) : unavailable ? (activity.isPending && <Loading />) : <p className="muted-text">当前没有正在执行的任务。</p>}
        </Section></div>
        <div id="home-review" tabIndex={-1}><Section title="待验收" action={<span className="muted-text">{review.length} 张</span>}>
          {review.length ? review.slice(0, 6).map(item => <a className="recent-row" key={item.id} href={home(item.id, item.work.project)}>
            <ClipboardCheck size={17} /><div><strong>{item.title}</strong><small>{workspace.projects.find(p => p.id === item.work.project)?.title}</small></div>
            <TicketStatus ticket={item} />
          </a>) : unavailable ? (activity.isPending && <Loading />) : <p className="muted-text">没有待验收的任务。</p>}
        </Section></div>
        <Section title="最近更新" action={<a className="text-button" href={projectWorkRoute(workspace.projects[0]?.id ?? '')}>任务中心 <ArrowRight size={14} /></a>}>
          {activity.isPending && <Loading />}
          {recent.map(item => <a className="recent-row" key={item.id} href={home(item.id, item.work.project)}>
            <ListChecks size={17} /><div><strong>{item.title}</strong><small>{workspace.projects.find(p => p.id === item.work.project)?.title} · {date(item.updatedAt)}</small></div>
            <TicketStatus ticket={item} />
          </a>)}
          {!tickets.length && !unavailable && <p className="muted-text">还没有可见工单，可以从任务中心发起协作。</p>}
        </Section>
      </div>
      {workspace.projects.length > 1 && <aside className="dashboard-side">
        <Section title="项目">
          {workspace.projects.map(project => <a className="project-shortcut" key={project.id} href={routeFor(project.id, 'project')}>
            <span className="project-shortcut-icon"><FolderKanban size={20} /></span><strong>{project.title}</strong><ArrowRight size={16} /></a>)}
        </Section>
      </aside>}
    </div>
  </div></div>;
}
