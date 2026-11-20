import { ArrowUpRight, Copy, Laptop, Route, Server } from 'lucide-react';
import { useData, type Agent, type DeviceRoute, type DeviceRow } from './api.ts';
import { routeFor } from './navigation.ts';
import { Button } from './components/button.tsx';
import { Failure, Loading, Pill, useActions } from './ui.tsx';

export function useExecutionTargets(project?: string) {
  const base = project ? 'project/' + project : '';
  const devices = useData<DeviceRow[]>(base && base + '/devices', 3500);
  const routes = useData<DeviceRoute[]>(base && base + '/device-routes', 3500);
  return { devices, routes };
}

export function eligibleExecutionDevices(devices: DeviceRow[] | undefined, agent?: Agent) {
  return devices?.filter(device => device.agent === agent?.id && device.active && device.eligible) ?? [];
}

const deviceStatus = (device: DeviceRow) => device.online ? '在线' : device.claimsPaused ? '暂不接单' : '离线等待';
const deviceLabel = (device: DeviceRow) => device.name + (device.online ? '' : ' · ' + deviceStatus(device));

type ExecutionTargetProps = {
  project: string; agent: Agent; targets: ReturnType<typeof useExecutionTargets>; value: string;
  onChange: (id: string) => void; connectUrl?: string;
};

export function executionTargetState(targets: ReturnType<typeof useExecutionTargets>, agent: Agent, value: string) {
  const { devices, routes } = targets;
  const choices = eligibleExecutionDevices(devices.data, agent);
  const policy = routes.data?.find(route => route.agent === agent.id);
  const actualDefault = choices.find(device => device.id === policy?.selected);
  const available = choices.filter(device => device.online);
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
    <summary><Laptop size={15} aria-hidden="true" />执行环境 · {state.summary}</summary>
    <ExecutionTargetPicker {...props} />
  </details>;
}

export function RunnerConnectInstructions({ url }: { url: string }) {
  const { run, busy } = useActions();
  const command = 'contractor connect ' + url;
  return <div className="runner-connect-instructions">
    <p>在要接单的电脑或云服务器运行这条命令。</p>
    <div className="runner-command-row">
      <code className="connect-command">{command}</code>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(
        () => navigator.clipboard.writeText(command), '命令已复制',
      )}><Copy size={14} />复制命令</Button>
    </div>
    <p>打开终端给出的链接，登录后确认项目和 Agent。重新连接时运行同一条命令。</p>
    <details className="minor-disclosure">
      <summary>首次安装</summary>
      <p>向管理员领取 Contractor Runner 安装包。在执行机准备 Node.js 24 和对应的 Codex 或 Claude Code，再安装 Runner。</p>
      <code className="connect-command">npm install -g --ignore-scripts ./contractor-runner-0.1.0.tgz</code>
    </details>
  </div>;
}

export function ExecutionTargetPicker({ project, agent, targets, value, onChange, connectUrl, mode = 'start', current }: ExecutionTargetProps & {
  mode?: 'start' | 'resume' | 'switch'; current?: { id: string; name: string };
}) {
  const { devices, routes } = targets;
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
    <legend className={mode === 'start' ? 'sr-only' : undefined}>{competing ? '切换到' : '执行环境'}</legend>
    {devices.error || routes.error ? <Failure error={devices.error ?? routes.error} retry={() => { void devices.refetch(); void routes.refetch(); }} />
      : !devices.data || !routes.data ? <Loading /> : <div className="execution-target-options">
        {!competing && (preserve || !needsChoice) && <label className="execution-target" data-selected={value === ''}>
          <input type="radio" name="execution-target" value="" checked={value === ''} onChange={() => onChange('')} />
          <Route size={17} aria-hidden="true" /><span><strong>{defaultTitle}</strong><small>{defaultDetail}</small></span>
          <Pill tone="blue">{preserve ? '当前' : '自动'}</Pill>
        </label>}
        {allowPlatform && <label className="execution-target" data-selected={value === 'workbench'}>
          <input type="radio" name="execution-target" value="workbench" checked={value === 'workbench'} onChange={() => onChange('workbench')} />
          <Server size={17} aria-hidden="true" /><span><strong>工作台运行时</strong><small>在工作台主机的隔离环境中运行</small></span>
        </label>}
        {choices.filter(device => !competing || device.id !== current?.id).map(device => <label className="execution-target" key={device.id} data-selected={device.id === value}>
          <input type="radio" name="execution-target" value={device.id} checked={device.id === value} onChange={() => onChange(device.id)} />
          <Laptop size={17} aria-hidden="true" /><span><strong>{device.name}</strong><small>{device.remote ? '远程设备' : '已登记设备'} · {device.owner}
            {device.id === policy?.primary ? ' · 主用' : device.id === policy?.fallback ? ' · 备用' : ''}</small></span>
          <Pill tone={device.online ? 'green' : 'amber'}>{deviceStatus(device)}</Pill>
        </label>)}
        {competing && !allowPlatform && !choices.some(device => device.id !== current?.id) && <p className="muted-text">暂无可切换的执行端</p>}
        {!competing && !preserve && needsChoice && !choices.length && <p className="muted-text">这个 Agent 暂无可用设备。</p>}
        {value && value !== 'workbench' && !choices.some(device => device.id === value) && <p role="alert" className="muted-text">所选设备已失去授权或停用，请重新选择。</p>}
      </div>}
    {connectUrl && <details className="minor-disclosure">
      <summary>连接新设备</summary>
      <RunnerConnectInstructions url={connectUrl} />
    </details>}
    <a className="text-button execution-target-manage" href={routeFor(project, 'agents', undefined, 'devices')}
      target="_blank" rel="noopener" aria-label="在新标签页管理执行设备">管理设备 <ArrowUpRight size={13} aria-hidden="true" /></a>
  </fieldset>;
}
