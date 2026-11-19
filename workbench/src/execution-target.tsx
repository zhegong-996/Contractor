import { ArrowUpRight, Laptop, Route, Server } from 'lucide-react';
import { useData, type Agent, type DeviceRoute, type DeviceRow } from './api.ts';
import { routeFor } from './navigation.ts';
import { Failure, Loading, Pill } from './ui.tsx';

export function useExecutionTargets(project?: string) {
  const base = project ? 'project/' + project : '';
  const devices = useData<DeviceRow[]>(base && base + '/devices', 3500);
  const routes = useData<DeviceRoute[]>(base && base + '/device-routes', 3500);
  return { devices, routes };
}

export function eligibleExecutionDevices(devices: DeviceRow[] | undefined, agent?: Agent) {
  return devices?.filter(device => device.agent === agent?.id && device.active && device.eligible) ?? [];
}

export function ExecutionTargetPicker({ project, agent, targets, value, onChange, mode = 'start', current }: {
  project: string; agent: Agent; targets: ReturnType<typeof useExecutionTargets>; value: string;
  onChange: (id: string) => void; mode?: 'start' | 'resume' | 'switch'; current?: { id: string; name: string };
}) {
  const { devices, routes } = targets;
  const choices = eligibleExecutionDevices(devices.data, agent);
  const policy = routes.data?.find(route => route.agent === agent.id);
  const competing = mode === 'switch';
  const preserve = mode === 'resume';
  const actualDefault = choices.find(device => device.id === policy?.selected);
  const available = choices.filter(device => device.online);
  const candidates = available.length ? available : choices;
  const implied = actualDefault ?? (!policy?.primary && agent.executionCapabilities.remote && candidates.length === 1 ? candidates[0] : undefined);
  const allowPlatform = mode !== 'start' && !!current && agent.executionCapabilities.local;
  const defaultTitle = preserve ? current?.name ?? '工作台运行时' : '按项目规则';
  const defaultDetail = preserve ? '沿用当前执行端' : implied
    ? implied.name + (implied.online ? '' : ' · 离线等待') + (implied.id === policy?.fallback ? ' · 备用' : '')
    : policy?.primary ? '当前主备执行端不可用'
      : agent.executionCapabilities.remote ? '请选一台已登记的设备'
        : agent.executionCapabilities.available ? '工作台运行时' : agent.executionCapabilities.reason ?? '执行环境暂不可用';
  return <fieldset className="execution-targets">
    <legend>{competing ? '切换到' : '执行环境'}</legend>
    {devices.error || routes.error ? <Failure error={devices.error ?? routes.error} retry={() => { void devices.refetch(); void routes.refetch(); }} />
      : !devices.data || !routes.data ? <Loading /> : <div className="execution-target-options">
        {!competing && <label className="execution-target" data-selected={value === ''}>
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
          <Pill tone={device.online ? 'green' : 'amber'}>{device.online ? '在线' : '离线等待'}</Pill>
        </label>)}
        {competing && !allowPlatform && !choices.some(device => device.id !== current?.id) && <p className="muted-text">暂无可切换的执行端</p>}
        {value && value !== 'workbench' && !choices.some(device => device.id === value) && <p role="alert" className="muted-text">所选设备已失去授权或停用，请重新选择。</p>}
      </div>}
    <a className="text-button execution-target-manage" href={routeFor(project, 'agents', undefined, 'devices')}
      target="_blank" rel="noopener" aria-label="在新标签页管理执行端">管理执行端 <ArrowUpRight size={13} aria-hidden="true" /></a>
  </fieldset>;
}
