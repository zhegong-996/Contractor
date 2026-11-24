import { useState } from 'react';
import { Select } from 'antd';
import { Boxes, Cloud, Cpu } from 'lucide-react';
import type { CapabilityProvider } from '../../src/workbench/capabilities.ts';
import { api, part, useData, type DeviceRoute, type DeviceRow, type ModelService, type ProjectRouting } from './api.ts';
import { Button } from './components/button.tsx';
import { SettingsDrawer } from './components/settings-drawer.tsx';
import { Input } from './components/input.tsx';
import { date, Failure, Field, Loading, Modal, Pill, Section, useActions, useStored } from './ui.tsx';

const modelProviders = {
  openai: { name: 'OpenAI', engine: 'Codex', icon: Cloud },
  deepseek: { name: 'DeepSeek', engine: 'Claude Code / Octop', icon: Boxes },
  ollama: { name: 'Ollama', engine: 'Claude Code', icon: Cpu },
};
const validModelId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u;

export function ModelServices() {
  const data = useData<ModelService[]>('admin/model-services', 8000);
  const [editing, setEditing] = useState<ModelService>();
  const [connecting, setConnecting] = useState<ModelService>();
  const [removal, setRemoval] = useState<{ row: ModelService; kind: 'policy' | 'connection' }>();
  const { run, busy } = useActions();
  const current = data.data?.find(row => row.provider === editing?.provider);
  return <>
    {data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
    {!data.data && !data.error && <Loading />}
    {data.data && <div className="admin-provider-grid">{data.data.map(row => {
      const provider = modelProviders[row.provider];
      return <article className="admin-provider" key={row.provider}>
        <header><span className="admin-glyph"><provider.icon size={21} aria-hidden="true" /></span>
          <Pill tone={row.enabled ? 'green' : 'amber'}>{row.enabled ? '允许执行' : '已暂停'}</Pill></header>
        <div><h2>{provider.name}</h2><p>{provider.engine}</p></div>
        <dl>
          <div><dt>平台服务配置</dt><dd>{row.registered ? '已保存' : row.removed ? '已删除' : '使用默认策略'}</dd></div>
          <div><dt>部署或连接登记</dt><dd>{row.configured ? '已登记' : '尚未登记'}</dd></div>
          <div><dt>模型范围</dt><dd>{row.models.length ? '限定 ' + row.models.length + ' 个模型' : '沿用 Agent 授权'}</dd></div>
          <div><dt>在线可接单 Worker</dt><dd>{row.runtime.onlineWorkers} 台</dd></div>
          {!!row.runtime.localProfiles && <div><dt>本机凭据文件</dt><dd>{row.runtime.localCredentialsReady} / {row.runtime.localProfiles} 可读取</dd></div>}
          {row.connection && <div><dt>工作台对话连接</dt><dd>{row.connection.disconnected ? '已断开' : row.connection.models?.join('、') || row.connection.model || (row.connection.environmentKey ? '已有部署凭据，待验证' : '待连接')}</dd></div>}
        </dl>
        <p className="muted-text">运行条件核对于 {date(row.runtime.checkedAt, true)}。具体模型和额度在派工前另核对。</p>
        <div className="admin-model-tags" aria-label="平台许可模型">
          {row.models.slice(0, 3).map(model => <code key={model} title={model}>{model}</code>)}
          {row.models.length > 3 && <span>另有 {row.models.length - 3} 个</span>}
        </div>
        {row.connection?.model && <p><a href="#/account?tab=agent">配置个人 Agent</a> · <a href="#/platform?tab=router">配置 Router</a></p>}
        <footer>{row.connection && <Button size="sm" onClick={() => setConnecting(row)}>{row.connection.model ? '编辑模型连接' : '连接 DeepSeek'}</Button>}
          <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
            {row.registered ? '编辑服务配置' : '新增服务配置'}
          </Button>
          {row.registered && <Button size="sm" variant="ghost" onClick={() => setRemoval({ row, kind: 'policy' })}>删除服务配置</Button>}
          {row.connection?.model && <Button size="sm" variant="ghost" onClick={() => setRemoval({ row, kind: 'connection' })}>断开模型连接</Button>}
        </footer>
      </article>;
    })}</div>}
    {removal && <Modal title={removal.kind === 'connection' ? '断开工作台模型连接' : '删除服务配置'} close={() => setRemoval(undefined)}>
      <p>{removal.kind === 'connection' ? '将清除工作台保存的 DeepSeek 连接，使用它的个人会话、Router 和知识提炼需要重新连接。'
        : '删除 ' + modelProviders[removal.row.provider].name + ' 的平台许可策略并暂停该服务的新调用。可通过新增配置重新启用。'}</p>
      <Button variant="destructive" disabled={busy} onClick={async () => {
        const connection = removal.kind === 'connection';
        if (await run(() => api('admin/model-services/' + removal.row.provider + (connection ? '/disconnect' : '/remove'), {
          revision: connection ? removal.row.connection!.revision : removal.row.revision }), connection ? '模型连接已断开' : '服务配置已删除')) setRemoval(undefined);
      }}>{removal.kind === 'connection' ? '确认断开' : '确认删除配置'}</Button>
    </Modal>}
    {connecting?.connection && <DeepSeekConnection service={connecting} close={() => setConnecting(undefined)} />}
    {editing && <ModelServiceDialog key={editing.provider + ':' + editing.revision} service={editing}
      current={current} reload={() => { if (current) setEditing(current); }} refresh={() => data.refetch()}
      close={() => setEditing(undefined)} />}
  </>;
}

function DeepSeekConnection({ service, close }: { service: ModelService; close: () => void }) {
  const { run } = useActions();
  const connection = service.connection!;
  const [model, setModel] = useState(connection.model ?? service.deploymentModels?.[0] ?? 'deepseek-flash');
  const [others, setOthers] = useState<string[]>(connection.models?.slice(1) ?? []);
  const [key, setKey] = useState('');
  const [catalog, setCatalog] = useState<string[]>();
  const suggested = catalog ?? service.deploymentModels;
  const models = [model, ...others].map(id => id.trim());
  const invalid = models.some(id => !validModelId.test(id)) || new Set(models).size !== models.length;
  return <SettingsDrawer title="连接 DeepSeek" close={close} submit={{ form: 'deepseek-connect', label: '验证并保存', disabled: invalid }}>
    <form id="deepseek-connect" className="form" onSubmit={async event => {
      event.preventDefault();
      if (await run(() => api('admin/model-services/deepseek/connect', { model: models[0], models, key: key.trim() || undefined,
        revision: connection.revision }), '模型目录已验证，请为个人 Agent 或平台 Router 选择模型。')) close();
    }}>
      <p>用于工作台上的个人对话、路由建议和知识提炼。执行工单的 Worker 使用设备自己的凭据。</p>
      {connection.environmentKey ? <p>使用部署环境已设置的 API Key。</p> : <Field label="DeepSeek API Key">
        <Input type="password" autoComplete="off" required={!connection.model} value={key} onChange={e => { setKey(e.target.value); setCatalog(undefined); }}
          placeholder={connection.model ? '留空沿用已保存的凭据' : '输入平台使用的 API Key'} /></Field>}
      <Button type="button" variant="outline" onClick={async () => {
        const ids = await run(() => api<string[]>('admin/model-services/deepseek/catalog', { key: key.trim() || undefined }));
        if (ids) {
          setCatalog(ids);
          if (ids.length && !ids.includes(model)) setModel(ids[0]!);
        }
      }}>读取可选模型</Button>
      {service.deploymentModels && <p className="muted-text">部署允许的工作台模型：{service.deploymentModels.join('、')}</p>}
      {catalog && !catalog.length && <p role="status">当前凭据与平台许可下没有可选模型，请核对密钥、部署范围和服务配置。</p>}
      <Field label="模型 ID">{suggested?.length ? <select aria-label="模型 ID" value={model} onChange={e => setModel(e.target.value)}>
        {[...new Set([model, ...suggested])].map(id => <option key={id}>{id}</option>)}</select>
        : <Input required value={model} maxLength={100} onChange={e => setModel(e.target.value)} />}</Field>
      {others.map((id, index) => <div className="actions" key={index}><Field label={'模型 ID ' + (index + 2)}>
        {suggested?.length ? <select aria-label={'模型 ID ' + (index + 2)} required value={id} onChange={e =>
          setOthers(others.map((value, i) => i === index ? e.target.value : value))}><option value="">请选择</option>
          {[...new Set([id, ...suggested])].filter(Boolean).map(option => <option key={option}>{option}</option>)}</select>
          : <Input aria-label={'模型 ID ' + (index + 2)} required maxLength={100} value={id}
          onChange={event => setOthers(others.map((value, i) => i === index ? event.target.value : value))} />}</Field>
        <Button type="button" variant="ghost" onClick={() => setOthers(others.filter((_, i) => i !== index))}>移除模型</Button></div>)}
      {others.length < 19 && <Button type="button" variant="outline" onClick={() => setOthers([...others, ''])}>添加模型</Button>}
      {models.every(Boolean) && invalid && <p role="alert">请填写有效且不重复的模型 ID。</p>}
    </form>
  </SettingsDrawer>;
}

function ModelServiceDialog({ service, current, reload, refresh, close }: {
  service: ModelService; current: ModelService | undefined; reload: () => void; refresh: () => Promise<unknown>; close: () => void;
}) {
  const { run, busy, clearError } = useActions();
  const [enabled, setEnabled] = useState(service.enabled);
  const [restricted, setRestricted] = useState(!!service.models.length);
  const [selection, setSelection] = useState(service.models);
  const models = restricted ? selection : [];
  const known = current?.availableModels ?? service.availableModels;
  const invalid = restricted && (!models.length || models.length > 48 || models.some(model => !validModelId.test(model)));
  const changed = !service.registered || enabled !== service.enabled || models.length !== service.models.length || models.some(model => !service.models.includes(model));
  const stale = !!current && service.revision !== current.revision;
  const provider = modelProviders[service.provider];
  return <SettingsDrawer title={provider.name + ' 模型设置'} close={close}
    submit={{ form: 'model-service', label: '保存模型设置', disabled: stale || invalid || !changed }}>
    <form className="form" id="model-service" onSubmit={async event => {
      event.preventDefault();
      if (!stale && !invalid && changed) {
        if (await run(() => api('admin/model-services/' + service.provider, { revision: service.revision, enabled, models }), '模型服务已更新')) close();
        else await refresh();
      }
    }}>
      {stale && <div className="admin-impact" role="status">模型设置已有新版本。
        <Button size="sm" variant="outline" disabled={busy} onClick={() => { clearError(); reload(); }}>载入当前设置</Button>
      </div>}
      <label className="admin-setting-toggle"><div><strong>允许此供应商执行</strong><small>作用于使用 {provider.name} 的项目和 Agent。</small></div>
        <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
      </label>
      <fieldset className="admin-fieldset">
        <legend>模型范围</legend>
        <div className="admin-radio-list">
          <label><input type="radio" name="model-scope" checked={!restricted} onChange={() => setRestricted(false)} />沿用 Agent 授权</label>
          <label><input type="radio" name="model-scope" checked={restricted} onChange={() => setRestricted(true)} />限定平台许可模型</label>
        </div>
      </fieldset>
      {restricted && <div className="field"><label htmlFor="allowed-models">许可模型</label>
        <Select id="allowed-models" mode="tags" maxCount={48} value={selection} tokenSeparators={[',', '，']}
          options={known.map(model => ({ value: model, label: model }))}
          onChange={values => setSelection([...new Set(values.map(value => value.trim()).filter(Boolean))])}
          placeholder="选择已配置模型，或输入模型 ID" status={selection.length && invalid ? 'error' : undefined}
          aria-describedby="allowed-models-help" />
        <small id="allowed-models-help">输入模型 ID 后按回车。平台许可与 Agent 授权共同生效。</small>
        {!!selection.length && invalid && <p className="field-error" role="alert">模型 ID 必须以字母或数字开头，可包含点、短横线和下划线。</p>}
      </div>}
      <div className="admin-drawer-details">
        <strong>执行端已配置的模型</strong>
        {known.length ? <div className="admin-model-tags">{known.map(model => <code key={model} title={model}>{model}</code>)}</div>
          : <p>暂无可用模型。凭据与模型连接在执行端配置。</p>}
      </div>
    </form>
  </SettingsDrawer>;
}

type ServiceStatusView = {
  feishu: string; cards: string; knowledge: { state: string; mode: string; checkedAt: number };
  inbox?: { pending: number; overdue: number; oldest: number | null }; pendingReceipts: number; notificationsPaused: boolean;
  plugins?: CapabilityProvider[];
  im?: { id: string; ready: boolean; inbox: { pending: number; overdue: number } }[];
  github?: { repository: string; state: string }[];
  storage?: { state: string }; executor?: 'autoloop' | 'contractor';
};
const states: Record<string, string> = { ready: '就绪', connecting: '连接中', reconnecting: '重连中',
  unavailable: '异常', disabled: '未启用', stopped: '已停止' };
const pluginTitles: Record<CapabilityProvider['capability'], string> = {
  delivery: '交付证据', sources: '资料读取', memory: '知识检索', expert: '只读专家', gateway: '渠道标准化', assistant: '模型整理',
  assistantHarness: 'Agent 上下文与技能',
};
const providerTitles: Record<string, string> = {
  'github-actions': 'GitHub Actions', 'project-sources': 'GitHub、飞书、Figma',
  'octop-index': 'Octop Memory', 'native-search': 'Contractor 内置检索',
  'deepseek-readonly': 'DeepSeek 只读适配器', 'octop-feishu': 'Octop Gateway', 'native-feishu': '飞书原生入口',
  'scoped-assistant-context': 'Contractor Agent Harness', 'text-completions': '模型接口',
};

export function ServiceStatus() {
  const status = useData<ServiceStatusView>('admin/service-status', 5000);
  if (status.error) return <Failure error={status.error} retry={() => void status.refetch()} />;
  if (!status.data) return <Loading />;
  const { feishu, cards, knowledge, inbox, pendingReceipts, notificationsPaused, plugins, im, github, executor, storage } = status.data;
  return <>
    <div className="admin-provider-grid">
    {([['飞书消息', feishu], ['飞书卡片回调', cards], ['知识索引', knowledge.state]] as const).map(([label, state]) =>
      <article className="admin-health-card" key={label}><header><h2>{label}</h2>
        <Pill tone={state === 'ready' ? 'green' : state === 'disabled' ? 'neutral' : 'amber'}>{states[state] ?? '未知'}</Pill></header>
        {label === '知识索引' && knowledge.checkedAt > 0 && <time>上次检查 {date(new Date(knowledge.checkedAt).toISOString(), true)}</time>}
      </article>)}
    </div>
    <Section title="待处理与通知">
      {inbox && <div className="record-row"><strong>飞书入站事件</strong><span>{inbox.pending} 条待处理</span>
        {!!inbox.overdue && <Pill tone="amber">{inbox.overdue} 条滞留</Pill>}{inbox.oldest && <time>最早 {date(new Date(inbox.oldest).toISOString(), true)}</time>}</div>}
      {im?.map(channel => <div className="record-row" key={channel.id}><strong>{channel.id}</strong>
        <Pill tone={channel.ready ? 'green' : 'amber'}>{channel.ready ? '就绪' : '未就绪'}</Pill><span>{channel.inbox.pending} 条待处理</span>
        {!!channel.inbox.overdue && <Pill tone="amber">{channel.inbox.overdue} 条滞留</Pill>}</div>)}
      {github?.map(repository => <div className="record-row" key={repository.repository}><strong>{repository.repository}</strong>
        <Pill tone={repository.state === 'ready' ? 'green' : 'amber'}>{states[repository.state] ?? repository.state}</Pill></div>)}
      <div className="record-row"><strong>{executor === 'autoloop' ? 'AutoLoop' : 'Contractor'} 执行回执待补写</strong><span>{pendingReceipts} 条</span></div>
      {storage && <div className="record-row"><strong>运行数据</strong><Pill tone={storage.state === 'temporary' ? 'amber' : 'neutral'}>
        {storage.state === 'temporary' ? '位于临时目录，需迁至持久存储' : '使用独立运行目录'}</Pill></div>}
      <div className="record-row"><strong>通知外发</strong><Pill tone={notificationsPaused ? 'amber' : 'green'}>{notificationsPaused ? '已暂停' : '可发送'}</Pill></div>
    </Section>
    {!!plugins?.length && <Section title="当前插件">
      <div className="workbench-table-scroll" tabIndex={0} role="region" aria-label="运行插件表格">
        <table className="workbench-table admin-data-table">
          <thead><tr><th scope="col">能力</th><th scope="col">实现</th><th scope="col">接口版本</th></tr></thead>
          <tbody>{plugins.map(plugin => <tr key={plugin.capability}>
            <th scope="row">{pluginTitles[plugin.capability]}</th><td>{providerTitles[plugin.id] ?? plugin.id}</td><td>v{plugin.api}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </Section>}
  </>;
}

const purposeNames = { summary: '群整理', personal: '个人代办', execution: '项目执行' } as const;
const sections = { responsibilities: '成员职责', dispatch: '牵头与决定人', modelRoutes: '主备模型' } as const;
type RoutingSection = keyof typeof sections;
type Editor = { section: RoutingSection; index?: number; base: ProjectRouting };

export function ProjectRoutingPanel({ project }: { project: string }) {
  const path = 'project/' + part(project) + '/routing';
  const data = useData<ProjectRouting>(path, 8000);
  const [editor, setEditor] = useState<Editor>();
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  const view = data.data;
  const duty = (id: string) => view.duties.find(row => row.id === id)?.title ?? id;
  const name = (id: string) => view.agents.find(row => row.id === id)?.title ?? id;
  const open = (section: RoutingSection, index?: number) => setEditor({ section, index, base: view });
  function rows(section: RoutingSection, entries: string[][]) {
    return <Section title={sections[section]} action={<Button size="sm" variant="outline" onClick={() => open(section)}>添加</Button>}>
      {!entries.length && <p className="muted-text">暂未配置。</p>}
      {entries.map(([label, ...notes], index) => <div className="record-row access-row" key={JSON.stringify([label, ...notes])}>
        <div className="access-identity"><strong>{label}</strong><div className="inline-meta">{notes.join(' · ')}</div></div>
        <Button size="sm" variant="ghost" onClick={() => open(section, index)}>编辑</Button>
      </div>)}
      {section === 'modelRoutes' && view.summaryUsesFixedModel && <p className="muted-text">群整理优先使用此处的主备模型。移除该规则后恢复部署默认值。</p>}
    </Section>;
  }
  return <>
    {rows('responsibilities', view.responsibilities.map(row => [duty(row.function), row.member]))}
    {rows('dispatch', view.dispatch.map(row => [duty(row.function), row.topic ? view.topics.find(topic => topic.id === row.topic)?.title ?? row.topic : '项目默认',
      name(row.agent), row.decider ? '决定人 ' + row.decider : '按项目规则选择决定人']))}
    {rows('modelRoutes', view.modelRoutes.map(row => [purposeNames[row.purpose], name(row.agent), row.models.join(' → ')]))}
    <ProjectDeviceRouting project={project} />
    {editor && <RoutingDialog endpoint={path} editor={editor} close={() => setEditor(undefined)} />}
  </>;
}

function ProjectDeviceRouting({ project }: { project: string }) {
  const base = 'project/' + part(project);
  const routes = useData<DeviceRoute[]>(base + '/device-routes', 3500);
  const devices = useData<DeviceRow[]>(base + '/devices', 3500);
  const [selected, select] = useState<DeviceRoute>();
  const name = (id: string) => {
    const item = devices.data?.find(row => row.id === id);
    return item ? item.name + (item.active && item.eligible ? item.online ? '' : '（离线）' : '（不可用）') : '已失去授权';
  };
  return <Section title="执行端路由">
    {routes.error && <Failure error={routes.error} retry={() => void routes.refetch()} />}
    {devices.error && <Failure error={devices.error} retry={() => void devices.refetch()} />}
    {!routes.data && !routes.error && <Loading />}
    {routes.data?.length === 0 && <p className="muted-text">先在执行机连接此项目的 Agent。</p>}
    {routes.data?.map(row => <article className="record-row access-row" key={row.agent}><div className="access-identity">
      <strong>{row.title}</strong><div className="inline-meta">
        <span>{row.primary ? '默认 · ' + name(row.primary) : '按现有执行端配置'}</span>
        {row.fallback && <span>备用 · {name(row.fallback)}</span>}
      </div></div>
      <Button type="button" size="sm" variant="outline" disabled={!devices.data} onClick={() => select(row)}>设置</Button>
    </article>)}
    {selected && <DeviceRouteDialog endpoint={base + '/device-routes'} route={selected}
      devices={devices.data?.filter(row => row.eligibleAgents.includes(selected.agent) && row.active) ?? []}
      close={() => select(undefined)} />}
  </Section>;
}

function DeviceRouteDialog({ endpoint, route, devices, close }: { endpoint: string; route: DeviceRoute; devices: DeviceRow[]; close: () => void }) {
  const [primary, setPrimary] = useState(route.primary ?? '');
  const [fallback, setFallback] = useState(route.fallback ?? '');
  const { busy, run } = useActions();
  const options = (current: string, exclude: string) => <>
    {current && !devices.some(row => row.id === current) && <option value={current} disabled>已失去授权或暂停</option>}
    {devices.filter(row => row.id !== exclude).map(row => <option key={row.id} value={row.id}>
      {row.name}{row.online ? '' : '（离线）'}</option>)}
  </>;
  return <Modal title={route.title + ' · 执行端'} close={close}><form className="form" onSubmit={async event => {
    event.preventDefault();
    if (await run(() => api(endpoint, { agent: route.agent, revision: route.revision, primary: primary || null, fallback: fallback || null }),
      '执行端路由已保存')) close();
  }}>
    <Field label="默认执行端"><select value={primary} onChange={event => {
      setPrimary(event.target.value);
      if (!event.target.value) setFallback('');
    }}><option value="">使用原执行配置</option>{options(primary, fallback)}</select></Field>
    <Field label="备用执行端" hint="用于新派工。已启动的执行按原单恢复或交接。">
      <select value={fallback} disabled={!primary} onChange={event => setFallback(event.target.value)}>
        <option value="">不配置</option>{options(fallback, primary)}
      </select>
    </Field>
    <div className="form-actions"><Button type="submit" disabled={busy
      || !!primary && !devices.some(row => row.id === primary) || !!fallback && !devices.some(row => row.id === fallback)}>保存</Button></div>
  </form></Modal>;
}

function RoutingDialog({ endpoint, editor, close }: { endpoint: string; editor: Editor; close: () => void }) {
  const { base, index, section } = editor;
  const prior = index === undefined ? undefined : base[section][index];
  const [role, setRole] = useState(prior && 'function' in prior ? prior.function : '');
  const [agent, setAgent] = useState(prior && 'agent' in prior ? prior.agent : '');
  const [purpose, setPurpose] = useState<keyof typeof purposeNames>(prior && 'purpose' in prior ? prior.purpose : 'execution');
  const [models, setModels] = useState(prior && 'models' in prior ? prior.models : []);
  const { run, busy } = useActions();
  const modelAgents = base.agents.filter(row => row.models.length && (purpose !== 'personal' || row.kind === 'personal')
    && (purpose !== 'summary' || row.canSummarize));
  const allowed = modelAgents.find(row => row.id === agent)?.models ?? [];
  const dutyOptions = (selected: string) => <><option value="">选择职责</option>
    {selected && !base.duties.some(row => row.id === selected) && <option value={selected} disabled>{selected}（不可用）</option>}
    {base.duties.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</>;
  const agentOptions = (rows: typeof base.agents) => <><option value="">选择 Agent</option>
    {agent && !rows.some(row => row.id === agent) && <option value={agent} disabled>{agent}（不可用）</option>}
    {rows.map(row => <option key={row.id} value={row.id}>{row.title} · {row.owner}</option>)}</>;
  const memberOptions = base.members.map(name => <option key={name} value={name}>{name}</option>);
  async function save(values?: FormData) {
    const update = { revision: base.revision, responsibilities: [...base.responsibilities], dispatch: [...base.dispatch], modelRoutes: [...base.modelRoutes] };
    const apply = <T,>(list: T[], value?: T) => {
      if (index === undefined && value) list.push(value);
      else if (index !== undefined) list.splice(index, 1, ...(value ? [value] : []));
    };
    if (section === 'responsibilities') apply(update.responsibilities, values && { member: String(values.get('member')), function: role });
    if (section === 'dispatch') apply(update.dispatch, values && { topic: String(values.get('topic') || '') || undefined,
      function: role, agent, decider: String(values.get('decider') || '') || undefined });
    if (section === 'modelRoutes') apply(update.modelRoutes, values && { purpose, agent, models: models.filter(Boolean) });
    if (await run(() => api(endpoint, update), '项目配置已更新')) close();
  }
  const member = prior && 'member' in prior ? prior.member : undefined;
  const rule = prior && 'topic' in prior ? prior : undefined;
  return <Modal title={sections[section]} close={close}><form className="form" onSubmit={event => {
    event.preventDefault(); void save(new FormData(event.currentTarget));
  }}>
    {section !== 'modelRoutes' && <Field label="职责"><select aria-label="职责" required value={role} onChange={event => { setRole(event.target.value); setAgent(''); }}>
      {dutyOptions(role)}</select></Field>}
    {section === 'responsibilities' && <Field label="成员"><select name="member" aria-label="成员" defaultValue={member ?? ''} required><option value="">选择成员</option>
      {member && !base.members.includes(member) && <option value={member} disabled>{member}（不可用）</option>}{memberOptions}</select></Field>}
    {section === 'dispatch' && <>
      <Field label="适用主题"><select name="topic" aria-label="适用主题" defaultValue={rule?.topic ?? ''}><option value="">项目默认</option>
        {base.topics.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></Field>
      <Field label="牵头 Agent"><select aria-label="牵头 Agent" required value={agent} onChange={event => setAgent(event.target.value)}>{agentOptions(base.agents.filter(row => row.function === role))}</select></Field>
      <Field label="执行决定人"><select name="decider" aria-label="执行决定人" defaultValue={prior && 'decider' in prior ? prior.decider ?? '' : ''}>
        <option value="">按项目规则</option>{memberOptions}</select></Field>
    </>}
    {section === 'modelRoutes' && <>
      <Field label="用途"><select aria-label="用途" value={purpose} onChange={event => { setPurpose(event.target.value as keyof typeof purposeNames); setAgent(''); setModels([]); }}>
        {Object.entries(purposeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Agent"><select aria-label="Agent" required value={agent} onChange={event => { setAgent(event.target.value); setModels([]); }}>{agentOptions(modelAgents)}</select></Field>
      {modelAgents.length === 0 && <p className="muted-text">这个用途暂无已配置且获准的 Agent 模型。</p>}
      {[0, 1, 2, 3].map(i => (i === 0 || models[i - 1]) && <Field key={i} label={i ? '备选模型 ' + i : '主模型'}>
        <select aria-label={i ? '备选模型 ' + i : '主模型'} value={models[i] ?? ''} required={!i} disabled={!allowed.length} onChange={event => {
          const next = models.slice(0, event.target.value ? Math.max(models.length, i + 1) : i);
          if (event.target.value) next[i] = event.target.value;
          setModels(next);
        }}><option value="">{i ? '不配置' : '选择主模型'}</option>
          {models[i] && !allowed.includes(models[i]!) && <option disabled value={models[i]}>{models[i]}（未授权）</option>}
          {allowed.filter(model => model === models[i] || !models.includes(model)).map(model => <option key={model} value={model}>{model}</option>)}</select>
      </Field>)}
    </>}
    <div className="form-actions">
      {index !== undefined && <Button disabled={busy} type="button" variant="ghost" onClick={() => void save()}>移除规则</Button>}
      <Button disabled={busy || section === 'modelRoutes' && (!models[0] || models.some(model => !allowed.includes(model)))} type="submit">保存</Button>
    </div>
  </form></Modal>;
}

type ProjectTriggerView = {
  revision: string; keywords: string[]; sensitivity: 'strict' | 'balanced' | 'open';
  silenceMinutes: number; mentionAlways: boolean;
  wakes: { project: string; chat: string; at: string; message: string; text: string; keyword: string; member?: string }[];
};
const sensitivityNames: Record<ProjectTriggerView['sensitivity'], string> = {
  strict: '只收关键词与点名', balanced: '过滤闲聊与无关消息', open: '全部接收（仍过滤敏感信息）',
};
export function ProjectTriggerPanel({ project }: { project: string }) {
  const data = useData<ProjectTriggerView>('project/' + part(project) + '/trigger');
  const [draft, setDraft] = useStored<ProjectTriggerView | undefined>('trigger:' + project, undefined);
  const [keyword, setKeyword] = useState('');
  const { run, busy } = useActions();
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  const current = draft ?? data.data;
  const set = (patch: Partial<ProjectTriggerView>) => setDraft({ ...current, ...patch });
  const dirty = draft !== undefined;
  const save = async () => {
    if (!await run(() => api('project/' + part(project) + '/trigger', {
      revision: current.revision, keywords: current.keywords, sensitivity: current.sensitivity,
      silenceMinutes: current.silenceMinutes, mentionAlways: current.mentionAlways,
    }), '唤醒策略已保存')) return;
    setDraft(undefined);
    await data.refetch();
  };
  const addKeyword = () => {
    const value = keyword.trim();
    if (!value || current.keywords.includes(value)) return;
    set({ keywords: [...current.keywords, value] });
    setKeyword('');
  };
  return <div className="detail-stack">
    <Section title="唤醒关键词" action={<span className="muted-text">{current.keywords.length} 条</span>}>
      {current.keywords.length ? <div className="workbench-table-scroll" role="region" aria-label="唤醒关键词">
        <table className="workbench-table admin-data-table"><thead><tr><th scope="col">关键词</th><th scope="col">命中行为</th><th scope="col" /></tr></thead>
          <tbody>{current.keywords.map(term => <tr key={term}><td><code>{term}</code></td><td>命中即保留并记录一次唤醒</td>
            <td><Button size="sm" variant="ghost" onClick={() => set({ keywords: current.keywords.filter(row => row !== term) })}>移除</Button></td></tr>)}
          </tbody></table>
      </div> : <p className="muted-text">未配置关键词时按灵敏度接收。</p>}
      <div className="actions"><Field label="新增关键词"><Input aria-label="新增唤醒关键词" value={keyword} maxLength={60}
        onChange={event => setKeyword(event.target.value)} placeholder="例如：紧急、上线、验收" /></Field>
        <Button size="sm" type="button" onClick={addKeyword} disabled={!keyword.trim()}>添加</Button></div>
    </Section>
    <Section title="接收策略">
      <Field label="灵敏度" hint={sensitivityNames[current.sensitivity]}><select aria-label="灵敏度" value={current.sensitivity}
        onChange={event => set({ sensitivity: event.target.value as ProjectTriggerView['sensitivity'] })}>
        {(Object.keys(sensitivityNames) as ProjectTriggerView['sensitivity'][]).map(value => <option key={value} value={value}>{sensitivityNames[value]}</option>)}
      </select></Field>
      <Field label="唤醒后沉默期（分钟）" hint="唤醒后这段时间内的非关键词消息不再触发整理，0 表示不沉默。">
        <Input type="number" min={0} max={10080} aria-label="唤醒后沉默期" value={current.silenceMinutes}
          onChange={event => set({ silenceMinutes: Math.max(0, Math.min(10080, Number(event.target.value) || 0)) })} /></Field>
      <label className="check-row"><input type="checkbox" checked={current.mentionAlways}
        onChange={event => set({ mentionAlways: event.target.checked })} />严格模式下被点名的消息仍然接收</label>
      <div className="form-actions"><Button type="button" onClick={() => void save()} disabled={busy || !dirty}>保存策略</Button></div>
    </Section>
    <Section title="唤醒记录" action={<span className="muted-text">{data.data.wakes.length} 条</span>}>
      {data.data.wakes.length ? data.data.wakes.slice(0, 30).map(row => <div className="revision-note" key={row.message}>
        <div className="inline-meta"><Pill tone="green">{row.keyword}</Pill><span>{row.member ?? '未绑定成员'}</span>
          <time>{date(new Date(row.at).toISOString(), true)}</time></div>
        <p>{row.text}</p>
      </div>) : <p className="muted-text">尚无唤醒记录。命中关键词的群消息会出现在这里，整理过程可按原消息回放。</p>}
    </Section>
  </div>;
}
