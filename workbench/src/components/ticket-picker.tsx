import { useState } from 'react';
import { useTickets, type TicketRow } from '../api.ts';
import { Button } from './button.tsx';
import { Input } from './input.tsx';

export function TicketPicker({ projects, value, onChange, label = '选择工单', allow = () => true, purpose = 'work' }: {
  projects: readonly { id: string; title: string }[];
  value: string;
  onChange: (id: string, project?: string) => void;
  label?: string;
  allow?: (row: TicketRow) => boolean;
  purpose?: 'work' | 'all';
}) {
  const [project, setProject] = useState(projects[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [selected, select] = useState<TicketRow>();
  const filter = projects.some(item => item.id === project) ? project : projects[0]?.id;
  const tickets = useTickets({ project: filter, purpose, limit: 20, q: query.trim() }, !!filter);
  const rows = tickets.rows.filter(allow);
  return <div className="detail-stack">
    {projects.length > 1 && <select aria-label="工单所属项目" value={filter ?? ''} onChange={event => {
      setProject(event.target.value); select(undefined); onChange('');
    }}>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
    <Input aria-label="搜索可选工单" value={query} placeholder="搜索工单" maxLength={240} onChange={event => setQuery(event.target.value)} />
    <select aria-label={label} required value={value} onChange={event => {
      const row = rows.find(item => item.id === event.target.value);
      select(row);
      onChange(event.target.value, row?.work.project);
    }}>
      <option value="">{label}</option>
      {value && !rows.some(row => row.id === value) && <option value={value}>{selected?.title ?? value}</option>}
      {rows.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
    </select>
    {tickets.error && <Button type="button" size="sm" variant="ghost" onClick={() => void tickets.refetch()}>重试读取工单</Button>}
    {tickets.hasNextPage && <Button type="button" size="sm" variant="ghost" disabled={tickets.isFetching} onClick={() => void tickets.fetchNextPage()}>加载更多</Button>}
  </div>;
}
