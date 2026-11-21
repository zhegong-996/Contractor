import { useId, useState } from 'react';
import { ArrowUpRight, Copy, Laptop, Route, Server } from 'lucide-react';
import { api, useData, type Agent, type DeviceRoute, type DeviceRow, type Overview } from './api.ts';
import { routeFor } from './navigation.ts';
import { Button } from './components/button.tsx';
import { date, Failure, Field, Loading, Modal, Pill, useActions } from './ui.tsx';

export function useExecutionTargets(project?: string) {
  const base = project ? 'project/' + project : '';
  const devices = useData<DeviceRow[]>(base && base + '/devices', 3500);
  const routes = useData<DeviceRoute[]>(base && base + '/device-routes', 3500);
  return { devices, routes };
}

export function eligibleExecutionDevices(devices: DeviceRow[] | undefined, agent?: Agent) {
  return devices?.filter(device => agent && device.eligibleAgents.includes(agent.id) && device.active) ?? [];
}

const deviceStatus = (device: DeviceRow) => device.online ? '在线' : device.claimsPaused ? '暂不接单' : '离线等待';
const deviceLabel = (device: DeviceRow) => device.name + (device.online ? '' : ' · ' + deviceStatus(device));

type ExecutionTargetProps = {
  project: string; agent: Agent; targets: ReturnType<typeof useExecutionTargets>; value: string;
  onChange: (id: string) => void; connectUrl?: string; label?: string; hideManagement?: boolean;
};

export function executionTargetState(targets: ReturnType<typeof useExecutionTargets>, agent: Agent, value: string) {
  const { devices, routes } = targets;
  const choices = eligibleExecutionDevices(devices.data, agent);
  const policy = routes.data?.find(route => route.agent === agent.id);
  const actualDefault = choices.find(device => device.id === policy?.selected);
  const available = choices.filter(device => device.readyAgents.includes(agent.id));
  const candidates = available.length ? available : choices;
  const implied = actualDefault ?? (!policy?.primary && agent.executionCapabilities.remote && candidates.length === 1
    ? candidates[0] : undefined);
  const ready = !!devices.data && !!routes.data && !devices.error && !routes.error;
  const needsChoice = !!(ready && (policy?.primary || agent.executionCapabilities.remote) && !implied);
  const selected = choices.find(device => device.id === value);
  const summary = value ? selected ? deviceLabel(selected) : ready ? '所选设备不可用' : '正在核对设备'
    : needsChoice ? '请选择设备' : implied ? '自动 · ' + deviceLabel(implied) : agent.executionCapabilities.remote
      ? '按项目规则' : agent.executionCapabilities.available ? '工作台运行时' : '暂不可运行';
  return { choices, policy, implied, ready, needsChoice, selected, summary };
}

export function ExecutionEnvironment(props: ExecutionTargetProps) {
  const state = executionTargetState(props.targets, props.agent, props.value);
  return <details className="form-disclosure execution-environment">
    <summary><Laptop size={15} aria-hidden="true" />{props.label ?? '执行环境'} · {state.summary}</summary>
    <ExecutionTargetPicker {...props} />
  </details>;
}

export function RunnerConnectInstructions({ url, legacy = false }: { url: string; legacy?: boolean }) {
  const { run, busy } = useActions();
  const command = 'contractor connect ' + url + (legacy ? ' --bind-agent' : '');
  return <div className="runner-connect-instructions">
    <p>在要接单的电脑或云服务器运行这条命令。</p>
    <div className="runner-command-row">
      <code className="connect-command">{command}</code>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(
        () => navigator.clipboard.writeText(command), '命令已复制',
      )}><Copy size={14} />复制命令</Button>
    </div>
    <p>{legacy ? '打开终端给出的链接，登录后确认项目和 Agent。'
      : '打开终端给出的链接确认设备，然后到个人设置授权项目。'}重新连接时运行同一条命令。</p>
    <details className="minor-disclosure">
      <summary>首次安装</summary>
      <p>向管理员领取 Contractor Runner 安装包。在执行机准备 Node.js 24 和对应的 Codex 或 Claude Code，再安装 Runner。</p>
      <code className="connect-command">npm install -g --ignore-scripts ./contractor-runner-0.1.0.tgz</code>
    </details>
  </div>;
}

export function LocalWorkerPair({ workspace, project, close }: { workspace: Overview; project?: string; close: () => void }) {
  const agents = workspace.agents.filter(agent => agent.owner === workspace.actor && agent.active && agent.executionCapabilities.local);
  const projects = workspace.projects.filter(row => row.mayStart && agents.some(agent => agent.projects.includes(row.id)));
  const [selected, setSelected] = useState(project ?? projects[0]?.id ?? '');
  const options = agents.filter(agent => agent.projects.includes(selected));
  const [issued, setIssued] = useState<{ code: string; expires: number; port: number }>();
  const { run, busy } = useActions();
  return <Modal title="连接工作台主机" close={close}>
    {issued ? <div className="form">
      <p>在工作台主机上使用同一数据目录运行命令，并按提示输入配对码。</p>
      <code className="connect-command">npm run runner -- pair {issued.port} "我的执行端"</code>
      <div className="record-row"><strong>一次性配对码</strong><code>{issued.code}</code><span>{date(new Date(issued.expires).toISOString())} 失效</span></div>
    </div> : <form className="form" onSubmit={async event => {
      event.preventDefault();
      const agent = new FormData(event.currentTarget).get('agent');
      const proof = await run(() => api<NonNullable<typeof issued>>('device/pair', { project: selected, agent }));
      if (proof) setIssued(proof);
    }}>
      {!project && <Field label="项目"><select aria-label="项目" value={selected} onChange={event => setSelected(event.target.value)} required>
        {projects.map(row => <option value={row.id} key={row.id}>{row.title}</option>)}
      </select></Field>}
      <Field label="绑定我的 Agent"><select aria-label="绑定我的 Agent" name="agent" key={selected} required>
        {options.map(agent => <option value={agent.id} key={agent.id}>{agent.title}</option>)}
      </select></Field>
      <div className="form-actions"><Button type="submit" disabled={busy || !options.length}>生成配对码</Button></div>
    </form>}
  </Modal>;
}

export function ExecutionTargetPicker({ project, agent, targets, value, onChange, connectUrl, label, hideManagement, mode = 'start', current }: ExecutionTargetProps & {
  mode?: 'start' | 'resume' | 'switch'; current?: { id: string; name: string };
}) {
  const { devices, routes } = targets;
  const group = useId();
  const { choices, policy, implied, needsChoice } = executionTargetState(targets, agent, value);
  const competing = mode === 'switch';
  const preserve = mode === 'resume';
  const allowPlatform = mode !== 'start' && !!current && agent.executionCapabilities.local;
  const defaultTitle = preserve ? current?.name ?? '工作台运行时' : '按项目规则';
  const defaultDetail = preserve ? '沿用当前执行端' : implied
    ? deviceLabel(implied) + (implied.id === policy?.fallback ? ' · 备用' : '')
    : policy?.primary ? '当前主备执行端不可用'
      : agent.executionCapabilities.remote ? '请选一台已登记的设备'
        : agent.executionCapabilities.available ? '工作台运行时' : agent.executionCapabilities.reason ?? '执行环境暂不可用';
  return <fieldset className="execution-targets">
    <legend className={mode === 'start' ? 'sr-only' : undefined}>{label ?? (competing ? '切换到' : '执行环境')}</legend>
    {devices.error || routes.error ? <Failure error={devices.error ?? routes.error} retry={() => { void devices.refetch(); void routes.refetch(); }} />
      : !devices.data || !routes.data ? <Loading /> : <div className="execution-target-options">
        {!competing && (preserve || !needsChoice) && <label className="execution-target" data-selected={value === ''}>
          <input type="radio" name={group} value="" checked={value === ''} onChange={() => onChange('')} />
          <Route size={17} aria-hidden="true" /><span><strong>{defaultTitle}</strong><small>{defaultDetail}</small></span>
          <Pill tone="blue">{preserve ? '当前' : '自动'}</Pill>
        </label>}
        {allowPlatform && <label className="execution-target" data-selected={value === 'workbench'}>
          <input type="radio" name={group} value="workbench" checked={value === 'workbench'} onChange={() => onChange('workbench')} />
          <Server size={17} aria-hidden="true" /><span><strong>工作台运行时</strong><small>在工作台主机的隔离环境中运行</small></span>
        </label>}
        {choices.filter(device => !competing || device.id !== current?.id).map(device => <label className="execution-target" key={device.id} data-selected={device.id === value}>
          <input type="radio" name={group} value={device.id} checked={device.id === value} onChange={() => onChange(device.id)} />
          <Laptop size={17} aria-hidden="true" /><span><strong>{device.name}</strong><small>{device.remote ? '远程设备' : '已登记设备'} · {device.owner}
            {device.id === policy?.primary ? ' · 主用' : device.id === policy?.fallback ? ' · 备用' : ''}</small></span>
          <Pill tone={device.readyAgents.includes(agent.id) ? 'green' : 'amber'}>
            {device.online && !device.readyAgents.includes(agent.id) ? '引擎待就绪' : deviceStatus(device)}</Pill>
        </label>)}
        {competing && !allowPlatform && !choices.some(device => device.id !== current?.id) && <p className="muted-text">暂无可切换的执行端</p>}
        {!competing && !preserve && needsChoice && !choices.length && <p className="muted-text">这个 Agent 暂无可用设备。</p>}
        {value && value !== 'workbench' && !choices.some(device => device.id === value) && <p role="alert" className="muted-text">所选设备已失去授权或停用，请重新选择。</p>}
      </div>}
    {connectUrl && <details className="minor-disclosure">
      <summary>连接新设备</summary>
      <a className="text-button" href="#/account?tab=workers" target="_blank" rel="noopener">打开我的 Worker <ArrowUpRight size={13} /></a>
    </details>}
    {!hideManagement && <a className="text-button execution-target-manage" href={routeFor(project, 'agents', undefined, 'devices')}
      target="_blank" rel="noopener">项目可用设备 <ArrowUpRight size={13} aria-hidden="true" /></a>}
  </fieldset>;
}
