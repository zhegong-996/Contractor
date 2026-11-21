import { useState } from 'react';
import { CalendarClock, Check, Flag, Plus, Trash2 } from 'lucide-react';
import { api, useData, type ProjectPlansView } from './api.ts';
import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { date, Empty, Failure, Field, Loading, Pill, Section, useActions, useStored } from './ui.tsx';

type Plans = { revision: string; goals: { id: string; title: string; done: boolean }[];
  routines: { id: string; title: string; cron: string; actor: string;
    action: { kind: 'ticket'; title: string; request: string; topic?: string; agent?: string }
      | { kind: 'consultation'; topic: string; text: string; agent: string }
      | { kind: 'next-version'; ticket: string; reason: string } }[] };

export function ProjectPlansPanel({ project, maintain }: { project: string; maintain?: boolean }) {
  const data = useData<ProjectPlansView>('project/' + project + '/plans');
  const [draft, setDraft] = useStored<Plans | undefined>('plans:' + project, undefined);
  const [title, setTitle] = useState('');
  const [routineTitle, setRoutineTitle] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [actor, setActor] = useState('');
  const [kind, setKind] = useState<'ticket' | 'consultation' | 'next-version'>('ticket');
  const [ticketTitle, setTicketTitle] = useState('');
  const [request, setRequest] = useState('');
  const [topic, setTopic] = useState('');
  const [agent, setAgent] = useState('');
  const [consultText, setConsultText] = useState('');
  const [ticketRef, setTicketRef] = useState('');
  const [reason, setReason] = useState('');
  const { run, busy } = useActions();
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  const current: Plans = draft ?? { revision: data.data.revision, goals: data.data.goals, routines: data.data.routines };
  const set = (next: Plans) => setDraft(next);
  const dirty = draft !== undefined;
  const save = async () => {
    if (!await run(() => api('project/' + project + '/plans', { revision: current.revision,
      goals: current.goals, routines: current.routines }), '目标与例行任务已保存')) return;
    setDraft(undefined);
    await data.refetch();
  };
  const addGoal = () => {
    const value = title.trim();
    if (!value) return;
    set({ ...current, goals: [...current.goals, { id: 'goal-' + Math.random().toString(36).slice(2, 10), title: value, done: false }] });
    setTitle('');
  };
  const addRoutine = () => {
    if (!routineTitle.trim() || !cron.trim() || !actor) return;
    const action = kind === 'ticket' ? { kind: 'ticket' as const, title: ticketTitle.trim(), request: request.trim(), ...(topic ? { topic } : {}), ...(agent ? { agent } : {}) }
      : kind === 'consultation' ? { kind: 'consultation' as const, topic, text: consultText.trim(), agent }
        : { kind: 'next-version' as const, ticket: ticketRef.trim(), reason: reason.trim() };
    if (action.kind !== 'next-version' && !topic) return;
    set({ ...current, routines: [...current.routines, { id: 'routine-' + Math.random().toString(36).slice(2, 10),
      title: routineTitle.trim(), cron: cron.trim(), actor, action }] });
    setRoutineTitle(''); setTicketTitle(''); setRequest(''); setConsultText(''); setTicketRef(''); setReason('');
  };
  return <div className="detail-stack">
    <Section title="项目目标" action={<span className="muted-text">{current.goals.filter(goal => goal.done).length}/{current.goals.length} 已完成</span>}>
      {current.goals.length ? current.goals.map(goal => <div className="record-row" key={goal.id}>
        <button type="button" className={'goal-toggle' + (goal.done ? ' done' : '')} aria-pressed={goal.done}
          onClick={() => set({ ...current, goals: current.goals.map(item => item.id === goal.id ? { ...item, done: !item.done } : item) })}>
          <Check size={14} /></button>
        <strong>{goal.title}</strong><Pill tone={goal.done ? 'green' : 'neutral'}>{goal.done ? '已完成' : '进行中'}</Pill>
        <Button size="sm" variant="ghost" onClick={() => set({ ...current, goals: current.goals.filter(item => item.id !== goal.id) })}><Trash2 size={14} /></Button>
      </div>) : <Empty title="暂无目标" icon={<Flag />} />}
      <div className="actions"><Input aria-label="新目标" placeholder="例如：小屏验收全覆盖" value={title} maxLength={100}
        onChange={e => setTitle(e.target.value)} /><Button size="sm" onClick={addGoal}><Plus />添加目标</Button></div>
    </Section>
    <Section title="例行任务" action={<span className="muted-text">{current.routines.length} 条</span>}>
      {current.routines.length ? current.routines.map(routine => {
        const run = data.data.runs.find(row => row.routine === routine.id);
        return <div className="revision-note" key={routine.id}><div className="section-heading"><h3>{routine.title}</h3>
          <div className="actions"><code className="connect-command">{routine.cron}</code>
            <Button size="sm" variant="ghost" onClick={() => set({ ...current, routines: current.routines.filter(item => item.id !== routine.id) })}><Trash2 size={14} /></Button></div></div>
          <p className="muted-text">由 {routine.actor} 执行 · {({ ticket: '新建工单', consultation: '主题咨询', 'next-version': '开启下一版' })[routine.action.kind]}
            {run ? ' · 上次 ' + date(run.at, true) : ' · 尚未执行'}</p>
        </div>;
      }) : <Empty title="暂无例行任务" icon={<CalendarClock />} />}
      <div className="form-grid">
        <Field label="名称"><Input value={routineTitle} onChange={e => setRoutineTitle(e.target.value)} maxLength={100} placeholder="例如：每周一复核" /></Field>
        <Field label="Cron"><Input value={cron} onChange={e => setCron(e.target.value)} maxLength={80} /></Field>
        <Field label="执行成员"><select value={actor} onChange={e => setActor(e.target.value)}><option value="">选择成员</option>
          {data.data.members.map(member => <option key={member} value={member}>{member}</option>)}</select></Field>
        <Field label="任务类型"><select value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
          <option value="ticket">新建工单</option><option value="consultation">主题咨询</option><option value="next-version">开启下一版</option></select></Field>
      </div>
      <Field label="所属主题"><select value={topic} onChange={e => setTopic(e.target.value)}><option value="">选择主题</option>
        {data.data.topics.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
      {kind === 'ticket' && <><div className="form-grid">
        <Field label="工单标题"><Input value={ticketTitle} onChange={e => setTicketTitle(e.target.value)} maxLength={100} /></Field>
        <Field label="执行 Agent（选填）"><Input value={agent} onChange={e => setAgent(e.target.value)} maxLength={80} placeholder="留空按项目职责" /></Field>
      </div><Field label="任务说明"><TextArea rows={3} value={request} onChange={e => setRequest(e.target.value)} maxLength={3000} /></Field></>}
      {kind === 'consultation' && <><Field label="咨询 Agent"><select value={agent} onChange={e => setAgent(e.target.value)}><option value="">选择 Agent</option>
        {data.data.consultations.find(item => item.topic === topic)?.agents.map(row => <option key={row.agent} value={row.agent}>{row.agent}</option>)}</select></Field>
        <Field label="咨询内容"><TextArea rows={3} value={consultText} onChange={e => setConsultText(e.target.value)} maxLength={3000} /></Field></>}
      {kind === 'next-version' && <><div className="form-grid">
        <Field label="原工单"><Input value={ticketRef} onChange={e => setTicketRef(e.target.value)} maxLength={80} /></Field>
        <Field label="原因"><Input value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} /></Field></div></>}
      <div className="actions"><Button size="sm" onClick={addRoutine}><Plus />添加例行任务</Button></div>
    </Section>
    {maintain && <div className="form-actions"><Button disabled={busy || !dirty} onClick={() => void save()}>保存目标与例行任务</Button></div>}
  </div>;
}
