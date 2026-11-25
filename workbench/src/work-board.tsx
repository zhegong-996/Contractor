import type { ReactNode } from 'react';
import { ticketListState } from '../../src/workbench/ticket-list-state.ts';
import { CircleAlert, CircleCheck, CircleDashed, CircleDot, CircleStop, ClipboardCheck, Hourglass } from 'lucide-react';
import type { TicketRow } from './api.ts';
import { Button } from './components/button.tsx';
import { routeFor, type PageProps } from './navigation.ts';
import { Avatar, Pill, short, ticketStatus, topicName, useActions, useSessionScroll, useStored } from './ui.tsx';

export const workStates = [
  { id: 'queued', title: '待开始', tone: 'neutral', icon: CircleDashed },
  { id: 'running', title: '进行中', tone: 'blue', icon: CircleDot },
  { id: 'waiting', title: '待处理', tone: 'amber', icon: Hourglass },
  { id: 'review', title: '待验收', tone: 'blue', icon: ClipboardCheck },
  { id: 'done', title: '已完成', tone: 'green', icon: CircleCheck },
  { id: 'closed', title: '已结束', tone: 'neutral', icon: CircleStop },
] as const;
export type BoardGrouping = 'status' | 'priority';
type BoardOrigin = { project: string; topic?: string; scoped: boolean; mine?: boolean };
const workState = ticketListState;

const priorityGroups = [
  { id: 'urgent', title: '紧急', tone: 'amber', icon: CircleAlert },
  { id: 'normal', title: '普通', tone: 'blue', icon: CircleDot },
] as const;
const boardDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });

function BoardCard({ ticket, home, workspace, mine, group, origin }: { ticket: TicketRow; home: PageProps['project'];
  workspace: PageProps['workspace']; mine: boolean; group: BoardGrouping; origin: BoardOrigin }) {
  const { store } = useActions();
  const state = workStates.find(row => row.id === workState(ticket))!;
  const assigned = workspace.agents.find(agent => agent.id === ticket.work.agent);
  const requester = home.members.find(member => member.name === ticket.work.requester);
  const name = assigned?.title ?? requester?.displayName ?? ticket.work.requester;
  const topic = topicName(home, ticket.work.topic);
  const location = [mine && home.title, topic, ticket.work.parent && '子工单'].filter(Boolean).join(' / ');
  const [label] = ticketStatus(ticket);
  const updated = new Date(ticket.updatedAt);
  return <a className="work-card" data-priority={ticket.work.priority ?? 'normal'} href={routeFor(home.id, 'work', ticket.id)}
    onClick={() => store('board-return:' + ticket.id, origin)}>
    <div className="work-card-meta"><span title={ticket.id}>{short(ticket.id)}</span>
      {ticket.work.version && <span>第 {ticket.work.version} 版</span>}
      {group === 'status' && ticket.work.priority === 'urgent' && <span className="work-card-urgent"><CircleAlert size={13} />紧急</span>}
      {(ticket.attention || workspace.needsYou.some(decision => decision.ticket === ticket.id)) && <span className="work-card-attention">待我处理</span>}
    </div>
    <strong title={ticket.title}>{ticket.title}</strong>
    {(group === 'priority' || state.id === 'waiting') && <div className="work-card-status">
      <Pill tone={state.tone}>{state.id === 'waiting' && label === '待验收' ? state.title : label}</Pill>
    </div>}
    {ticket.engineeringWait && <span className="work-card-location">等 {home.members.find(m => m.name === ticket.engineeringWait?.member)?.displayName ?? ticket.engineeringWait.member ?? '责任人'}
      {' '}{ticket.engineeringWait.direction === 'handover' ? ticket.engineeringWait.reply ? '接手' : '确认交接' : ticket.engineeringWait.reply ? '答复' : '接回处理'}</span>}
    {ticket.pull && <span className="work-card-location">PR #{ticket.pull.number} · {ticket.pull.sha.slice(0, 8)} · CI {{ passed: '通过', failed: '失败', pending: '待完成' }[ticket.pull.ci]}</span>}
    {location && <span className="work-card-location" title={location}>{location}</span>}
    {state.id === 'running' && <span className="work-card-progress" title={[ticket.progress?.device, ticket.progress?.summary].filter(Boolean).join(' · ')}>
      <span className="work-card-activity">正在执行</span>
      {!!ticket.progress?.attempts && ticket.progress.attempts > 1 && <span className="work-card-round">第 {ticket.progress.attempts} 轮</span>}
      <span className="work-card-progress-text">
        {[ticket.progress?.device, ticket.progress?.summary].filter(Boolean).join(' · ') || '等待执行端回报'}</span>
    </span>}
    {state.id === 'waiting' && ticket.progress?.summary && <span className="work-card-progress" title={ticket.progress.summary}>
      <span className="work-card-progress-text">{ticket.progress.device ? ticket.progress.device + ' · ' : ''}{ticket.progress.summary}</span></span>}
    <div className="work-card-footer"><span title={assigned ? 'Agent · ' + assigned.title + ' · ' + assigned.owner : '发起人 · ' + name}>
      <Avatar avatar={requester?.avatar} value={assigned?.title ?? ticket.work.requester} kind={assigned ? 'agent' : 'person'} />
      <span>{name}</span>
    </span><time dateTime={ticket.updatedAt}>{Number.isFinite(updated.valueOf()) ? boardDate.format(updated) : '—'}</time></div>
  </a>;
}

function BoardColumn({ label, tone, items, scrollKey, render, icon: Icon }: {
  label: string; tone: string; items: TicketRow[]; scrollKey: string; render: (ticket: TicketRow) => ReactNode; icon: typeof CircleDot;
}) {
  const scroll = useSessionScroll(scrollKey);
  const [limit, setLimit] = useStored('board-limit:' + scrollKey, 30);
  return <section className="work-column" data-tone={tone} aria-label={label + ' · ' + items.length + ' 张工单'}>
    <header className="work-column-header"><Icon className={'work-state-icon work-state-' + tone} size={17} aria-hidden="true" />
      <h2>{label}</h2><span className="work-column-count">{items.length}</span></header>
    <div className="work-column-items" {...scroll}>
      {items.length ? items.slice(0, limit).map(render) : <span className="work-column-empty"><Icon size={15} aria-hidden="true" />暂无工单</span>}
      {items.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimit(limit + 30)}>显示更多</Button>}
    </div>
  </section>;
}

export function WorkBoard({ tickets, workspace, project, mine, group, scrollKey, origin }: Pick<PageProps, 'workspace' | 'project'> & {
  tickets: TicketRow[]; mine: boolean; group: BoardGrouping; scrollKey: string; origin: BoardOrigin;
}) {
  const scroll = useSessionScroll(scrollKey);
  const columns = group === 'status' ? workStates : priorityGroups;
  const homes = new Map(workspace.projects.map(home => [home.id, home]));
  return <div className="work-board" data-group={group} aria-label="任务看板" role="region" tabIndex={0} {...scroll}>
    {columns.map(column => {
      const items = tickets.filter(row => (group === 'status' ? workState(row) : row.work.priority ?? 'normal') === column.id);
      if (column.id === 'closed' && !items.length) return null;
      return <BoardColumn key={column.id} label={column.title} icon={column.icon} tone={column.tone} items={items} scrollKey={scrollKey + ':' + column.id}
        render={ticket => <BoardCard key={ticket.id} ticket={ticket} home={homes.get(ticket.work.project) ?? project}
          workspace={workspace} mine={mine} group={group} origin={origin} />} />;
    })}
  </div>;
}
