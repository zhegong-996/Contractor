import { Archive, ArchiveRestore, ListChecks, MessageSquare } from 'lucide-react';
import { api, part, useConversations } from './api.ts';
import { Button } from './components/button.tsx';
import { routeFor, type PageProps } from './navigation.ts';
import { date, Empty, Failure, IconButton, Loading, SearchBox, Source, useActions, useSessionScroll, useStored } from './ui.tsx';

export function ConversationDirectory({ workspace, project, route }: PageProps) {
  const [filters, setFilters] = useStored('conversation-directory', { project: '', query: '', archived: false });
  const selected = workspace.projects.find(row => row.id === filters.project)?.id;
  const conversations = useConversations({ project: selected, q: filters.query.trim().slice(0, 240), archived: filters.archived });
  const listScroll = useSessionScroll(JSON.stringify(['conversations', filters]), { visibleAt: route.item ?? route.tab });
  const { busy, run } = useActions();
  return <aside className="split-list conversation-directory" aria-label="会话列表">
    <div className="list-header">
      <div className="list-title"><h2>会话</h2>
        <IconButton label={filters.archived ? '查看最近会话' : '查看已归档会话'}
          aria-pressed={filters.archived} onClick={() => setFilters({ ...filters, archived: !filters.archived })}><Archive size={16} /></IconButton>
      </div>
      <SearchBox label="搜索会话" value={filters.query} onChange={query => setFilters({ ...filters, query })} />
      <select aria-label="会话所属项目" value={selected ?? ''} onChange={event => setFilters({ ...filters, project: event.target.value })}>
        <option value="">全部可见项目</option>
        {workspace.projects.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
      </select>
    </div>
    <div className="list-scroll" {...listScroll}>
      {conversations.error && <Failure error={conversations.error} retry={() => void conversations.refetch()} />}
      {conversations.isPending && <Loading />}
      {conversations.rows.map(row => {
        const url = row.ticket ? routeFor(row.project, 'work', row.ticket, 'activity')
          : routeFor(row.project, 'chat', row.topic ?? undefined, row.topic ? undefined : 'project');
        const current = !row.ticket && row.project === project.id && (row.topic ? route.item === row.topic : route.tab === 'project');
        return <div className="conversation-directory-row" key={row.project + ':' + row.scope}>
          <a className="list-item" href={url} aria-current={current ? 'page' : undefined}>
            <div className="list-item-top">{row.ticket ? <ListChecks size={15} /> : <MessageSquare size={15} />}
              <strong>{row.title}</strong></div>
            <div className="list-item-meta"><span>{row.projectTitle}</span>{row.source && <Source channel={row.source} />}
              {row.updatedAt && <time>{date(row.updatedAt)}</time>}</div>
          </a>
          <IconButton label={(row.archived ? '恢复会话 ' : '归档会话 ') + row.title} disabled={busy}
            onClick={() => void run(() => api('conversations/' + part(row.project) + '/archive', {
              topic: row.ticket ? undefined : row.topic ?? undefined, ticket: row.ticket ?? undefined, archived: !row.archived,
            }), row.archived ? '已恢复会话' : '已归档会话')}>
            {row.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </IconButton>
        </div>;
      })}
      {!conversations.error && !conversations.isPending && !conversations.rows.length && <Empty title={filters.archived ? '没有匹配的归档会话' : '没有匹配的会话'} />}
      {conversations.hasNextPage && <Button size="sm" variant="outline" disabled={conversations.isFetchingNextPage}
        onClick={() => void conversations.fetchNextPage()}>加载更多会话</Button>}
    </div>
  </aside>;
}
