import { ArrowRight, Bot, ClipboardCheck, CircleDot, FolderKanban, Inbox, ListChecks } from 'lucide-react';
import { ticketListState } from '../../src/workbench/ticket-list-state.ts';
import type { Decision } from './api.ts';
import { decisionVisual } from './inbox.tsx';
import { personalChatRoute, projectWorkRoute, routeFor, workFromInbox, type PageProps } from './navigation.ts';
import { date, Section, short, TicketStatus, Version } from './ui.tsx';

function decisionRoute(d: Decision) {
  if (d.kind === 'intake' || d.kind === 'channel') return;
  if (d.ticket) {
    const tab = d.kind === 'access' ? 'context' : d.kind === 'acceptance' ? 'verification' : d.kind === 'delivery' ? 'delivery' : 'activity';
    return workFromInbox(routeFor(d.project, 'work', d.ticket, tab), d.project, d.id, d.acceptanceRevision);
  }
  if (d.kind === 'discussion') return routeFor(d.project, 'project', d.subject, 'discussion');
  if (d.kind === 'budget') return routeFor(d.project, 'project', undefined, 'usage');
}

export function HomePage({ workspace }: PageProps) {
  const needsYou = workspace.needsYou;
  const states = workspace.tickets.map(ticket => ticketListState(ticket));
  const running = workspace.tickets.filter((ticket, index) => states[index] === 'running' || states[index] === 'queued');
  const review = workspace.tickets.filter((ticket, index) => states[index] === 'review');
  const recent = [...workspace.tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const display = workspace.actorProfile?.displayName ?? workspace.actor;
  const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  const home = (ticketId: string, project: string) => routeFor(project, 'work', ticketId);
  return <div className="page-scroll"><div className="dashboard">
    <div className="dashboard-heading"><div className="heading-icon"><FolderKanban size={23} /></div>
      <div><h1>工作台概览</h1><p>{today} · {display}，今天有 {needsYou.length} 项需要你决定</p></div>
    </div>
    <div className="dashboard-grid">
      <div className="dashboard-main">
        <Section title="待我处理" action={<span className="muted-text">{needsYou.length} 项</span>}>
          {needsYou.length ? needsYou.slice(0, 6).map(d => {
            const [Icon, kind] = decisionVisual[d.kind] ?? [ListChecks, d.kind];
            const href = decisionRoute(d);
            const contents = <><span className="inbox-icon"><Icon size={18} /></span><div className="inbox-item-body">
              <div className="inbox-item-meta"><span className="category-label">{kind}</span>
                <span>{workspace.projects.find(p => p.id === d.project)?.title}</span>
                {d.ticket && <code title={d.ticket}>{short(d.ticket)}</code>}{d.version && <Version version={d.version} />}</div>
              <strong>{d.ticketTitle ?? d.title}</strong>
            </div><span className="inbox-item-end"><time>{date(d.openedAt)}</time></span></>;
            return href ? <a key={d.id} className="inbox-row" href={href}>{contents}</a>
              : <div key={d.id} className="inbox-row">{contents}</div>;
          }) : <p className="muted-text">没有待你决定的事项。</p>}
        </Section>
        <Section title="正在执行" action={<span className="muted-text">{running.length} 张</span>}>
          {running.length ? running.slice(0, 6).map(item => <a className="recent-row" key={item.id} href={home(item.id, item.work.project)}>
            <CircleDot size={17} /><div><strong>{item.title}</strong><small>{item.progress?.device ?? workspace.agents.find(a => a.id === item.work.agent)?.title ?? item.work.agent}
              {item.progress?.summary ? ' · ' + item.progress.summary : ''}</small></div><TicketStatus ticket={item} />
          </a>) : <p className="muted-text">当前没有正在执行的任务。</p>}
        </Section>
        <Section title="待验收" action={<span className="muted-text">{review.length} 张</span>}>
          {review.length ? review.slice(0, 6).map(item => <a className="recent-row" key={item.id} href={home(item.id, item.work.project)}>
            <ClipboardCheck size={17} /><div><strong>{item.title}</strong><small>{workspace.projects.find(p => p.id === item.work.project)?.title}</small></div>
            <TicketStatus ticket={item} />
          </a>) : <p className="muted-text">没有待验收的任务。</p>}
        </Section>
        <Section title="最近更新" action={<span className="muted-text">全部项目</span>}>
          {recent.map(item => <a className="recent-row" key={item.id} href={home(item.id, item.work.project)}>
            <ListChecks size={17} /><div><strong>{item.title}</strong><small>{workspace.projects.find(p => p.id === item.work.project)?.title} · {date(item.updatedAt)}</small></div>
            <TicketStatus ticket={item} />
          </a>)}
        </Section>
      </div>
      <aside className="dashboard-side">
        <Section title="项目">
          {workspace.projects.map(project => <a className="project-shortcut" key={project.id} href={routeFor(project.id, 'project')}>
            <span className="project-shortcut-icon"><FolderKanban size={20} /></span><strong>{project.title}</strong><ArrowRight size={16} /></a>)}
        </Section>
        <Section title="入口">
          <a className="inspector-link" href={'#/inbox'}><Inbox size={16} /><span>待我处理</span></a>
          <a className="inspector-link" href={personalChatRoute()}><Bot size={16} /><span>与我的 Agent 对话</span></a>
          <a className="inspector-link" href={projectWorkRoute(workspace.projects[0]?.id ?? '')}><ListChecks size={16} /><span>任务中心</span></a>
        </Section>
      </aside>
    </div>
  </div></div>;
}
