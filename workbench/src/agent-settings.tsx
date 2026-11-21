import { useState } from 'react';
import { Bot, Laptop, Settings2 } from 'lucide-react';
import type { Collaboration } from '../../src/workbench/collaboration.ts';
import { api, useData, type Overview } from './api.ts';
import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { RunnerConnectInstructions } from './execution-target.tsx';
import { Markdown } from './markdown.tsx';
import { date, Empty, Failure, Field, Loading, Modal, Pill, Section, useActions } from './ui.tsx';

type Assistant = ReturnType<Collaboration['platformAssistant']>;
type Agent = ReturnType<Collaboration['personalAgent']>;
type Workers = ReturnType<Collaboration['myWorkers']>;
type Model = NonNullable<Assistant['selection']>;
const modelKey = (model: Model | null) => model ? model.provider + '/' + model.model : '';
const modelLabel = (model: Model) => (model.provider === 'ollama' ? 'Ollama' : 'DeepSeek') + ' · ' + model.model;

function ModelPicker({ choices, selection, onChange }: {
  choices: Assistant['choices']; selection: Model | null; onChange: (value: Model | null) => void;
}) {
  const value = modelKey(selection);
  return <select value={value} onChange={event => {
    const choice = choices.find(row => modelKey(row) === event.target.value);
    onChange(choice ? { provider: choice.provider, model: choice.model } : null);
  }}>
    <option value="">未启用</option>
    {selection && !choices.some(row => modelKey(row) === value) && <option value={value} disabled>{modelLabel(selection)}（已移除）</option>}
    {choices.map(row => <option key={modelKey(row)} value={modelKey(row)} disabled={!row.available}>
      {modelLabel(row)}{row.available ? '' : '（不可用）'}
    </option>)}
  </select>;
}

export function PlatformAssistantSettings() {
  const data = useData<Assistant>('admin/platform-assistant');
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  return <RouterSettings key={data.data.revision} current={data.data} />;
}

function RouterSettings({ current }: { current: Assistant }) {
  const [selection, choose] = useState(current.selection);
  const [dailyLimit, setLimit] = useState(String(current.dailyLimit));
  const { run, busy } = useActions();
  return <>
    <Section title="平台整理模型" action={<Pill tone={current.enabled ? 'green' : 'neutral'}>{current.enabled ? '已启用' : '未启用'}</Pill>}>
      <form className="form" onSubmit={event => {
        event.preventDefault();
        void run(() => api('admin/platform-assistant', { revision: current.revision, selection, dailyLimit: Number(dailyLimit) }), '平台模型已保存');
      }}>
        <div className="form-grid">
          <Field label="路由建议与知识提炼"><ModelPicker choices={current.choices} selection={selection} onChange={choose} /></Field>
          <Field label="每日调用上限"><Input type="number" min={1} max={1000} required value={dailyLimit} onChange={e => setLimit(e.target.value)} /></Field>
        </div>
        {!current.choices.length && <p className="muted-text">部署时先登记可用模型，登记后可在此启用。</p>}
        <div className="form-actions"><Button type="submit" disabled={busy}>保存</Button></div>
      </form>
    </Section>
    <Section title="最近调用" action={<span className="muted-text">今日 {Number(current.today?.calls ?? 0)} 次 · {Number(current.today?.tokens ?? 0).toLocaleString()} Token</span>}>
      {current.recent.length ? <div className="detail-stack">{current.recent.map((call, index) =>
        <div className="record-row" key={call.opened + ':' + index}>
          <strong>{call.purpose === 'router' ? '路由建议' : '知识提炼'}</strong>
          <span>{call.model}</span><span>{call.tokens === null ? '用量未知' : call.tokens.toLocaleString() + ' Token'}</span>
          <span className="muted-text">{date(new Date(call.opened).toISOString(), true)}</span>
          <Pill tone={call.state === 'completed' ? 'green' : 'neutral'}>{call.state === 'completed' ? '已完成' : call.state === 'failed'
            ? '失败' : call.state === 'unknown' ? '用量待核对' : '进行中'}</Pill>
      </div>)}</div> : <p className="muted-text">暂无调用</p>}
    </Section>
  </>;
}

export function PersonalAgentSettings() {
  const data = useData<Agent>('account/personal-agent');
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  return <PersonalAgentForm key={data.data.revision} current={data.data} />;
}

function PersonalAgentForm({ current }: { current: Agent }) {
  const { title: name, instructions, experience, selection } = current;
  const [draft, setDraft] = useState({ title: name, instructions, experience, selection });
  const [question, ask] = useState('');
  const [reply, setReply] = useState<{ text: string; model: Model }>();
  const { run, busy } = useActions();
  return <div className="detail-stack">
    <Section title="个人 Agent" action={<Pill tone="blue">仅本人</Pill>}>
      <form className="form" onSubmit={event => {
        event.preventDefault();
        void run(() => api('account/personal-agent', { ...draft, revision: current.revision }), '个人 Agent 已保存');
      }}>
        <div className="form-grid">
          <Field label="名称"><Input required maxLength={80} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label="轻量模型"><ModelPicker choices={current.choices} selection={draft.selection} onChange={selection => setDraft({ ...draft, selection })} /></Field>
        </div>
        <Field label="工作指引"><TextArea rows={3} maxLength={2000} value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></Field>
        <Field label="本人确认的经验"><TextArea rows={5} maxLength={4000} value={draft.experience} onChange={e => setDraft({ ...draft, experience: e.target.value })} /></Field>
        <div className="form-actions"><Button type="submit" disabled={busy}>保存</Button></div>
      </form>
    </Section>
    <Section title="个人咨询" action={<Bot size={17} aria-hidden="true" />}>
      <form className="form" onSubmit={async event => {
        event.preventDefault();
        const result = await run(() => api<Awaited<ReturnType<Collaboration['askPersonalAgent']>>>('account/personal-agent/ask', { question }));
        if (result) setReply({ text: result.value.answer, model: result.model });
      }}>
        <Field label="问题" hint={current.enabled ? '使用已保存的个人指引与经验，计入个人额度。' : '保存可用的轻量模型后即可咨询。'}>
          <TextArea rows={3} required maxLength={3000} value={question} onChange={e => ask(e.target.value)} />
        </Field>
        <div className="form-actions"><Button type="submit" disabled={busy || !current.enabled || !question.trim()}>咨询我的 Agent</Button></div>
      </form>
      {reply && <div className="context-preview" aria-live="polite"><Pill>{modelLabel(reply.model)}</Pill><Markdown text={reply.text} /></div>}
    </Section>
  </div>;
}

export function MyWorkers({ workspace }: { workspace: Overview }) {
  const data = useData<Workers>('account/workers', 4000);
  const [edit, setEdit] = useState<Workers['devices'][number]>();
  const [selected, setSelected] = useState<string[]>([]);
  const { run, busy } = useActions();
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  const { projects, devices, connectUrl } = data.data;
  return <>
    <Section title="我的执行设备">
      {connectUrl ? <details className="minor-disclosure" open={!devices.length}>
        <summary>连接电脑或云服务器</summary>
        <RunnerConnectInstructions url={connectUrl} legacy={workspace.executionRuntime !== 'contractor'} />
      </details> : <p className="muted-text">团队尚未设置执行端连接地址。</p>}
      {devices.length ? <div className="detail-stack">{devices.map(device =>
        <div className="record-row" key={device.id}><Laptop size={18} aria-hidden="true" /><strong>{device.name}</strong>
          <Pill tone={device.online ? 'green' : 'neutral'}>{device.state === 'retired' ? '已退役' : device.state === 'lost' ? '已丢失'
            : device.state === 'suspended' || device.claimsPaused ? '暂停接单' : device.online ? '在线' : '离线'}</Pill>
          <span>{device.engines.map(engine => engine === 'codex' ? 'Codex' : 'Claude Code').join('、') || device.agent}</span>
          {device.independent && device.online && device.readyEngines.length < device.engines.length
            && <Pill tone="amber">部分引擎待就绪</Pill>}
          <span className="muted-text">{projects.filter(row => device.projects.includes(row.id)).map(row => row.title).join('、') || '尚未授权项目'}</span>
          {device.independent && device.state !== 'retired' && <Button size="sm" variant="outline" onClick={() => {
            setEdit(device); setSelected(device.projects);
          }}><Settings2 size={14} />项目授权</Button>}
          {device.state === 'active' || device.state === 'suspended' ? <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => void run(() => api('device/' + device.id, { state: device.state === 'active' ? 'suspended' : 'active' }), '设备状态已更新')}>
            {device.state === 'active' ? '暂停接单' : '恢复接单'}</Button> : null}
        </div>)}</div> : <Empty title="暂无执行设备" icon={<Laptop />} />}
    </Section>
    {edit && <Modal title={'接单范围 · ' + edit.name} close={() => setEdit(undefined)}>
      <form className="form" onSubmit={async event => {
        event.preventDefault();
        const done = await run(() => api('device/' + edit.id + '/projects', { revision: edit.revision, projects: selected }), '接单范围已保存');
        if (done) setEdit(undefined);
      }}>
        <fieldset className="admin-fieldset"><legend>允许接单的项目</legend>
          {projects.length ? projects.map(project => <label className="record-row" key={project.id}>
            <input type="checkbox" checked={selected.includes(project.id)} onChange={event => setSelected(event.target.checked
              ? [...selected, project.id] : selected.filter(id => id !== project.id))} />{project.title}
          </label>) : <p className="muted-text">暂无可授权的项目</p>}
        </fieldset>
        <p className="muted-text">取消某个项目后，设备将停止该项目上正在运行的任务。</p>
        <div className="form-actions"><Button type="submit" disabled={busy}>保存</Button></div>
      </form>
    </Modal>}
  </>;
}
