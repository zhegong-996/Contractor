import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { Collaboration } from '../../src/workbench/collaboration.ts';
import { api, type Overview } from './api.ts';
import { Button } from './components/button.tsx';
import { routeFor } from './navigation.ts';
import { Failure, IconButton, Modal, SearchBox } from './ui.tsx';

const groups = { project: '项目', topic: '主题', ticket: '工单', knowledge: '知识' } as const;
type Page = ReturnType<Collaboration['workspaceSearch']>;

function Results({ workspace, close }: { workspace: Overview; close: () => void }) {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const current = input.trim();
  useEffect(() => {
    const timer = setTimeout(() => setTerm(current), 150);
    return () => clearTimeout(timer);
  }, [current]);
  const data = useInfiniteQuery({
    queryKey: ['workspace-search', workspace.actor, term], enabled: !!term && term === current,
    initialPageParam: 0, gcTime: 0, retry: false, refetchInterval: 5000,
    queryFn: ({ pageParam, signal }) => api<Page>('search?' + new URLSearchParams({ q: term, offset: String(pageParam) }), undefined, signal),
    getNextPageParam: last => last.next,
  });
  const rows = current === term && !data.error ? data.data?.pages.flatMap(page => page.rows) : undefined;
  return <Modal title="搜索工作台" close={close}>
    <SearchBox autoFocus label="搜索项目、主题、工单号、PR 或知识" value={input} onChange={value => setInput(value.slice(0, 160))} />
    <div className="workspace-results" aria-live="polite">
      {current && (!rows && !data.error ? <p>正在查找…</p> : rows?.length === 0 && <p>没有匹配结果</p>)}
      {current === term && data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
      {(Object.keys(groups) as (keyof typeof groups)[]).map(kind => {
        const items = rows?.filter(row => row.kind === kind);
        return items?.length ? <section key={kind}><h3>{groups[kind]}</h3>{items.map(row => <a key={row.project + '/' + row.id}
          href={routeFor(row.project, ({ project: 'project', topic: 'chat', ticket: 'work', knowledge: 'knowledge' } as const)[kind], kind === 'project' ? undefined : row.id)}
          onClick={close}><strong>{row.title}</strong>{kind !== 'project' && <small>{workspace.projects.find(p => p.id === row.project)?.title}{kind === 'ticket' && ' · ' + row.id.slice(0, 8)}</small>}</a>)}</section> : null;
      })}
      {rows && data.hasNextPage && <Button variant="ghost" disabled={data.isFetching} onClick={() => void data.fetchNextPage()}>加载更多</Button>}
    </div>
  </Modal>;
}

export function WorkspaceSearch({ workspace }: { workspace: Overview }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || e.isComposing) return;
      if (!open && document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setOpen(value => !value);
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open]);
  return <><IconButton label="搜索工作台" onClick={() => setOpen(true)}><Search /></IconButton>
    {open && <Results workspace={workspace} close={() => setOpen(false)} />}</>;
}
