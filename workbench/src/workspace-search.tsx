import { useEffect, useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { Collaboration } from '../../src/workbench/collaboration.ts';
import { api, type Overview } from './api.ts';
import { Button } from './components/button.tsx';
import { routeFor } from './navigation.ts';
import { Failure, IconButton, Modal, SearchBox, useActions } from './ui.tsx';

const groups = { ticket: '工单', topic: '主题', project: '项目', knowledge: '知识' } as const;
type Page = ReturnType<Collaboration['workspaceSearch']>;

function Results({ workspace, open, dismiss, close }: { workspace: Overview; open: boolean; dismiss: () => void; close: () => void }) {
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
  const listId = useId();
  const [active, setActive] = useState('');
  const sections = (Object.keys(groups) as (keyof typeof groups)[]).map(kind => ({
    kind, items: (rows ?? []).filter(row => row.kind === kind),
  }));
  const ordered = sections.flatMap(section => section.items);
  const optionId = (row: Page['rows'][number]) => [listId, row.kind, row.project, row.id].join('/');
  const index = ordered.findIndex(row => optionId(row) === active);
  function select(position: number) {
    const row = ordered[position];
    if (!row) return;
    const id = optionId(row);
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
  }
  const loading = !!current && (term !== current || data.isPending);
  return <Modal title="搜索工作台" close={close} visibility={{ open, dismiss }}>
    <SearchBox autoFocus role="combobox" aria-autocomplete="list" aria-expanded={!!current}
      aria-controls={listId} aria-activedescendant={index >= 0 ? active : undefined}
      label="搜索项目、主题、工单号、PR 或知识" value={input}
      onChange={value => { setInput(value.slice(0, 160)); setActive(''); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !ordered.length
          || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          select(event.key === 'ArrowDown' ? Math.min(index + 1, ordered.length - 1)
            : index < 0 ? ordered.length - 1 : Math.max(0, index - 1));
        } else if (event.key === 'Enter' && (!active || index >= 0)) {
          event.preventDefault();
          document.getElementById(optionId(ordered[Math.max(0, index)]!))?.click();
        }
      }} />
    <div className="workspace-results">
      <div role="status">{loading ? '正在查找…' : rows?.length === 0 && '没有匹配结果'}</div>
      {current === term && data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
      <div role="listbox" aria-label="搜索结果" id={listId} hidden={!current}>
        {sections.map(({ kind, items }) => items.length > 0 && <section key={kind} role="group" aria-label={groups[kind]}>
          <h3>{groups[kind]}</h3>{items.map(row => <a key={optionId(row)} id={optionId(row)}
            role="option" tabIndex={-1} aria-selected={optionId(row) === active}
            href={routeFor(row.project, ({ project: 'project', topic: 'chat', ticket: 'work', knowledge: 'knowledge' } as const)[kind], kind === 'project' ? undefined : row.id)}
            onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey) dismiss(); }}>
            <strong>{row.title}</strong>{kind !== 'project' && <small>{workspace.projects.find(p => p.id === row.project)?.title}{kind === 'ticket' && ' · ' + row.id.slice(0, 8)}</small>}</a>)}</section>)}
      </div>
      {rows && data.hasNextPage && <Button variant="ghost" loading={data.isFetchingNextPage} disabled={data.isFetching} onClick={() => void data.fetchNextPage()}>加载更多</Button>}
    </div>
  </Modal>;
}

export function WorkspaceSearch({ workspace }: { workspace: Overview }) {
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const { dialogTrigger } = useActions();
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || e.isComposing || e.repeat) return;
      if (phase === 'closed' && Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .some(dialog => dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== 'hidden')) return;
      if (phase === 'closed' && document.activeElement instanceof HTMLElement) dialogTrigger.current = document.activeElement;
      e.preventDefault();
      setPhase(value => value === 'open' ? 'closing' : 'open');
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [phase, dialogTrigger]);
  return <><IconButton label="搜索工作台" onClick={() => setPhase('open')}><Search /></IconButton>
    {phase !== 'closed' && <Results workspace={workspace} open={phase === 'open'} dismiss={() => setPhase('closing')}
      close={() => setPhase(value => value === 'closing' ? 'closed' : value)} />}</>;
}
