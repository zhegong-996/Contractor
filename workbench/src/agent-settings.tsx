import { useState } from 'react';
import { Bot, Laptop, Settings2 } from 'lucide-react';
import type { Collaboration } from '../../src/workbench/collaboration.ts';
import { api, mayKeepStale, useData, type Overview } from './api.ts';
import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { TabsContent } from './components/page-tabs.tsx';
import { LocalWorkerPair, RunnerConnectInstructions } from './execution-target.tsx';
import { ContextModules, HarnessCallDetails, HarnessPrompt, HarnessSave, HarnessSkills } from './harness-settings.tsx';
import { personalChatRoute } from './navigation.ts';
import { Avatar, date, Empty, Failure, Field, Loading, Modal, PageTabs, Pill, Section, short, useActions, useStored } from './ui.tsx';

type Assistant = ReturnType<Collaboration['platformAssistant']>;
type Agent = ReturnType<Collaboration['personalAgent']>;
type Workers = ReturnType<Collaboration['myWorkers']>;
type Model = NonNullable<Assistant['selection']>;
const modelKey = (model: Model | null) => model ? model.provider + '/' + model.model : '';
const modelLabel = (model: Model) => (model.provider === 'ollama' ? 'Ollama' : 'DeepSeek') + ' · ' + model.model;

function ModelPicker({ label, choices, selection, onChange }: {
  label: string; choices: Assistant['choices']; selection: Model | null; onChange: (value: Model | null) => void;
}) {
  const value = modelKey(selection);
  return <select aria-label={label} value={value} onChange={event => {
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
  if (data.error && (!data.data || !mayKeepStale(data.error))) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  return <>{data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
    <RouterSettings current={data.data} /></>;
}

function RouterSettings({ current }: { current: Assistant }) {
  const [purpose, setPurpose] = useStored<'router' | 'memory'>('router-settings-purpose', 'router');
  const initial = { selection: current.selection, dailyLimit: String(current.dailyLimit), harness: current.harness, revision: current.revision };
  const [saved, remember] = useStored<typeof initial | undefined>('platform-assistant-draft', undefined);
  const draft = saved ?? initial;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const conflict = draft.revision !== current.revision;
  const { run, busy } = useActions();
  const changeRole = (value: (typeof initial.harness)['router']) => remember({ ...draft, harness: { ...draft.harness, [purpose]: value } });
  const role = draft.harness[purpose];
  return <>
    <form className="detail-stack harness-form" aria-label="平台 Router 配置" onSubmit={async event => {
      event.preventDefault();
      if (conflict || busy || !dirty) return;
      if (await run(() => api('admin/platform-assistant', { ...draft, dailyLimit: Number(draft.dailyLimit) }), '平台 Router 配置已保存')) remember(undefined);
    }}>
      <Section title="模型与额度" action={<Pill tone={current.enabled ? 'green' : 'neutral'}>{current.enabled ? '已启用' : '未启用'}</Pill>}>
        <div className="form-grid">
          <Field label="共用模型"><ModelPicker label="共用模型" choices={current.choices} selection={draft.selection}
            onChange={selection => remember({ ...draft, selection })} /></Field>
          <Field label="每日调用上限"><Input aria-label="每日调用上限" type="number" min={1} max={1000} required
            value={draft.dailyLimit} onChange={e => remember({ ...draft, dailyLimit: e.target.value })} /></Field>
        </div>
        {!current.choices.length && <p className="muted-text">请先到<a href="#/platform?tab=models">模型服务</a>连接 DeepSeek，再选择共用模型。</p>}
      </Section>
      <PageTabs label="Router 能力配置" items={routerTabs} value={purpose} onChange={setPurpose}>
        {routerTabs.map(([key]) => <TabsContent key={key} value={key} className="detail-stack">
          {key === purpose && <>
            <HarnessPrompt value={role.instructions} limit={4000} contract={current.roles[purpose].contract}
              onChange={instructions => changeRole({ ...role, instructions })} />
            <HarnessSkills path="admin/platform-assistant/skills" scope="team" purpose={purpose} bindings={role.bindings}
              mounts={current.roles[purpose].mounts} onChange={bindings => changeRole({ ...role, bindings })} />
            {current.roles[purpose].modules.length > 0 && <Section title="上下文">
              <ContextModules modules={current.roles[purpose].modules} bindings={role.bindings}
                onChange={bindings => changeRole({ ...role, bindings })} />
            </Section>}
          </>}
        </TabsContent>)}
      </PageTabs>
      <HarnessSave conflict={conflict} dirty={dirty} busy={busy} savedAt={'配置版本 ' + short(current.revision, 8)}
        keep={() => remember({ ...draft, revision: current.revision })} refresh={() => remember(undefined)} />
    </form>
    <Section title="最近调用" action={<span className="muted-text">今日 {Number(current.today?.calls ?? 0)} 次 · {Number(current.today?.tokens ?? 0).toLocaleString()} Token</span>}>
      {current.recent.length ? <div className="detail-stack">{current.recent.map((call, index) =>
        <div className="harness-call-row" key={call.id ?? call.opened + ':' + index}><div className="record-row">
          <strong>{call.purpose === 'router' ? '路由建议' : '知识提炼'}</strong>
          <span>{call.model}</span><span>{call.tokens === null ? '用量未知' : call.tokens.toLocaleString() + ' Token'}</span>
          <span className="muted-text">{date(new Date(call.opened).toISOString(), true)}</span>
          <Pill tone={call.state === 'completed' ? 'green' : 'neutral'}>{call.state === 'completed' ? '已完成' : call.state === 'failed'
            ? '失败' : call.state === 'unknown' ? '用量待核对' : '进行中'}</Pill>
        </div>{call.harness && <HarnessCallDetails stamp={call.harness} />}
      </div>)}</div> : <p className="muted-text">暂无调用</p>}
    </Section>
  </>;
}

const routerTabs = [['router', '路由建议'], ['memory', '知识提炼']] as const;

export function PersonalAgentSettings({ project, canConnect }: { project?: string; canConnect: boolean }) {
  const data = useData<Agent>('account/personal-agent');
  if (data.error && (!data.data || !mayKeepStale(data.error))) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  return <>{data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
    <PersonalAgentForm current={data.data} project={project} canConnect={canConnect} /></>;
}

function PersonalAgentForm({ current, project, canConnect }: { current: Agent; project?: string; canConnect: boolean }) {
  const { title, description, instructions, experience, selection, harness, revision } = current;
  const initial = { title, description, instructions, experience, selection, harness, revision };
  const [saved, remember] = useStored<typeof initial | undefined>('personal-agent-draft', undefined);
  const draft = saved ?? initial;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const conflict = draft.revision !== revision;
  const { run, busy } = useActions();
  return <form className="detail-stack harness-form" aria-label="个人 Agent 配置" onSubmit={async event => {
    event.preventDefault();
    if (conflict || busy || !dirty) return;
    if (await run(() => api('account/personal-agent', draft), '个人 Agent 配置已保存')) remember(undefined);
  }}>
    <header className="harness-identity">
      <Avatar value={current.title} kind="agent" size="large" />
      <div><h2>{current.title}</h2>
        {current.description && <p className="muted-text">{current.description}</p>}
        <Pill tone={current.enabled ? 'green' : current.selection ? 'amber' : 'neutral'}>
          {current.enabled ? '模型已配置' : current.selection ? '模型当前不可用' : '待配置模型'}
        </Pill>
      </div>
      <a className="text-button" href={personalChatRoute(undefined, project)}><Bot size={16} />打开我的会话</a>
    </header>
    <Section title="基本信息">
      <div className="form-grid">
        <Field label="名称"><Input aria-label="名称" required maxLength={80} value={draft.title}
          onChange={e => remember({ ...draft, title: e.target.value })} /></Field>
        <Field label="轻量模型"><ModelPicker label="轻量模型" choices={current.choices} selection={draft.selection}
          onChange={selection => remember({ ...draft, selection })} /></Field>
      </div>
      {!current.choices.length && <p className="muted-text">{canConnect ? <a href="#/platform?tab=models">连接团队模型</a> : '请联系平台管理员在「模型服务」连接团队模型。'}</p>}
      <div className="harness-field"><Field label="简介"><Input aria-label="简介" maxLength={240} value={draft.description}
        onChange={e => remember({ ...draft, description: e.target.value })} /></Field></div>
    </Section>
    <HarnessPrompt value={draft.instructions} limit={2000} contract={current.contract}
      onChange={instructions => remember({ ...draft, instructions })} />
    <HarnessSkills path="account/personal-agent/skills" scope="personal" purpose="personal" bindings={draft.harness}
      mounts={current.mounts} onChange={harness => remember({ ...draft, harness })} />
    <Section title="经验与上下文">
      <ContextModules modules={current.modules} bindings={draft.harness} onChange={harness => remember({ ...draft, harness })} />
      <div className="harness-field"><Field label="经验内容"><TextArea aria-label="经验内容" rows={4} maxLength={4000}
        value={draft.experience} onChange={e => remember({ ...draft, experience: e.target.value })} /></Field></div>
    </Section>
    <HarnessSave conflict={conflict} dirty={dirty} busy={busy} savedAt={'配置版本 ' + short(current.revision, 8)}
      keep={() => remember({ ...draft, revision: current.revision })} refresh={() => remember(undefined)} />
  </form>;
}

export function MyWorkers({ workspace }: { workspace: Overview }) {
  const data = useData<Workers>('account/workers', 4000);
  const [edit, setEdit] = useState<Workers['devices'][number]>();
  const [pair, setPair] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const { run, busy } = useActions();
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  const { projects, devices, connectUrl } = data.data;
  const local = workspace.agents.some(agent => agent.owner === workspace.actor && agent.active && agent.executionCapabilities.local
    && projects.some(project => agent.projects.includes(project.id)));
  return <>
    <Section title="我的 Worker" action={!connectUrl && local && <Button size="sm" variant="outline" onClick={() => setPair(true)}>连接工作台主机</Button>}>
      {connectUrl ? <details className="minor-disclosure" open={!devices.length}>
        <summary>连接电脑或云服务器</summary>
        <RunnerConnectInstructions url={connectUrl} legacy={workspace.executionRuntime !== 'contractor'} />
      </details> : <p className="muted-text">团队尚未设置远程接入地址。</p>}
      {devices.length ? <div className="detail-stack">{devices.map(device =>
        <div className="record-row" key={device.id}><Laptop size={18} aria-hidden="true" /><strong>{device.name}</strong>
          <Pill tone={device.online ? 'green' : 'neutral'}>{device.state === 'retired' ? '已退役' : device.state === 'lost' ? '已丢失'
            : device.state === 'suspended' || device.claimsPaused ? '暂停接单' : device.online ? '在线' : '离线'}</Pill>
          <span>{device.engines.map(engine => engine === 'codex' ? 'Codex' : 'Claude Code').join('、')
            || workspace.agents.find(agent => agent.id === device.agent)?.title || device.agent}</span>
          {device.independent && device.online && device.readyEngines.length < device.engines.length
            && <Pill tone="amber">部分引擎待就绪</Pill>}
          <span className="muted-text">{projects.filter(row => device.projects.includes(row.id)).map(row => row.title).join('、') || '尚未授权项目'}</span>
          {device.scopeEditable && device.state !== 'retired' && <Button size="sm" variant="outline" onClick={() => {
            setEdit(device); setSelected(device.projects);
          }}><Settings2 size={14} />项目授权</Button>}
          {device.state === 'active' || device.state === 'suspended' ? <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => void run(() => api('device/' + device.id, { state: device.state === 'active' ? 'suspended' : 'active' }), '设备状态已更新')}>
            {device.state === 'active' ? '暂停接单' : '恢复接单'}</Button> : null}
        </div>)}</div> : <Empty title="暂无执行设备" icon={<Laptop />} />}
    </Section>
    {pair && <LocalWorkerPair workspace={workspace} close={() => setPair(false)} />}
    {edit && <Modal title={'接单范围 · ' + edit.name} close={() => setEdit(undefined)}>
      <form className="form" onSubmit={async event => {
        event.preventDefault();
        const done = await run(() => api('device/' + edit.id + '/projects', { revision: edit.revision, projects: selected }), '接单范围已保存');
        if (done) setEdit(undefined);
      }}>
        <fieldset className="admin-fieldset"><legend>允许接单的项目</legend>
          {edit.scopeProjects.length ? projects.filter(project => edit.scopeProjects.includes(project.id)).map(project => <label className="record-row" key={project.id}>
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
