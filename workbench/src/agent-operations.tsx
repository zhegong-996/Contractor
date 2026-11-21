import { useState } from 'react';
import { ArrowLeft, ArrowRight, Cpu, Plus, ReceiptText } from 'lucide-react';
import { api, useData, type BudgetRow, type DeviceRow, type MemoryRow, type PointPool, type Usage } from './api.ts';
import { routeFor, type PageProps } from './navigation.ts';
import { Button } from './components/button.tsx';
import { Input } from './components/input.tsx';
import { SettingsDrawer } from './components/settings-drawer.tsx';
import { date, Empty, Failure, Field, Loading, Modal, Pill, Section, useActions } from './ui.tsx';
import { LocalWorkerPair, RunnerConnectInstructions } from './execution-target.tsx';

export function AgentOperations(props: PageProps & { page: 'devices' | 'budgets' }) {
  const { page, project } = props;
  const Icon = page === 'devices' ? Cpu : ReceiptText;
  return <div className="page-scroll"><div className="project-page">
    <header className="object-header">
      <div className="object-emblem"><Icon size={24} /></div>
      <div><h1>{page === 'devices' ? '项目设备' : '额度管理'}</h1><p className="muted-text">{project.title}</p></div>
      <a className="text-button object-action" href={routeFor(project.id, 'agents')}><ArrowLeft size={16} />Agent</a>
    </header>
    <div className="detail-stack">{page === 'devices' ? <DevicePane {...props} />
      : <><PointsPane project={project.id} />
        <details className="minor-disclosure"><summary>执行次数与时限</summary><BudgetPane project={project.id} /></details></>}</div>
  </div></div>;
}

function DevicePane({ workspace, project }: PageProps) {
  const data = useData<DeviceRow[]>('project/' + project.id + '/devices', 2200);
  const remote = project.mayStart && workspace.agents.some(agent => agent.owner === workspace.actor
    && agent.active && agent.projects.includes(project.id) && agent.executionCapabilities.remote) ? workspace.runnerConnectUrl : undefined;
  const canPair = project.mayStart && workspace.agents.some(agent => agent.owner === workspace.actor
    && agent.active && agent.projects.includes(project.id) && agent.executionCapabilities.local);
  const [pair, show] = useState(false);
  const [change, setChange] = useState<{ device: DeviceRow; state: 'lost' | 'retired' | 'active' }>();
  const { run, busy } = useActions();
  return <Section title="可用设备" action={<div className="actions">
    {project.maintain && <a className="text-button" href={routeFor(project.id, 'project', undefined, 'routing')}>主备设备配置</a>}
    {workspace.executionRuntime !== 'contractor' && (remote || canPair)
      && <Button size="sm" onClick={() => show(true)}><Plus />连接设备</Button>}
  </div>}>
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading />
      : data.data.length ? data.data.map(device => <div className="resource-row" key={device.id}>
        <span className="heading-icon"><Cpu size={17} /></span>
        <div className="min-w-0"><strong>{device.name}</strong><p className="muted-text">
          {device.eligibleAgents.map(id => workspace.agents.find(agent => agent.id === id)?.title ?? id).join('、')
            || '暂无可用 Agent'} · {device.owner}
          {device.remote ? ' · 远程接入' : ' · 工作台主机'}
          {device.lastSeen && ' · ' + date(new Date(device.lastSeen).toISOString())}
        </p></div>
        <div className="actions">
          <Pill tone={device.state === 'lost' ? 'amber' : device.online && device.eligible ? 'green' : 'neutral'}>
            {device.state === 'retired' ? '已退役' : device.state === 'lost' ? '已丢失'
              : device.state === 'suspended' ? '已暂停' : !device.eligible ? '授权已变化' : device.online ? '在线'
                : device.claimsPaused ? '暂不接单' : '离线'}
          </Pill>
          {device.mayManage && device.state !== 'retired' && <>
            {device.state === 'lost' ? device.eligible && <Button size="sm" variant="outline" onClick={() => setChange({ device, state: 'active' })}>确认找回</Button>
              : <Button size="sm" variant="outline" disabled={busy || (!device.active && !device.eligible)}
                onClick={() => void run(() => api('device/' + device.id, { state: device.active ? 'suspended' : 'active' }),
                  device.active ? '已暂停执行端接单' : '已恢复执行端接单')}>{device.active ? '暂停接单' : '恢复接单'}</Button>}
            {device.state !== 'lost' && <Button size="sm" variant="ghost" onClick={() => setChange({ device, state: 'lost' })}>标记丢失</Button>}
            <Button size="sm" variant="ghost" onClick={() => setChange({ device, state: 'retired' })}>退役</Button>
          </>}
        </div>
      </div>) : <Empty title="此项目尚无执行设备" icon={<Cpu />} />}
    {change && <Modal title={change.state === 'retired' ? '退役执行端' : change.state === 'lost' ? '标记执行端丢失' : '确认找回执行端'} close={() => setChange(undefined)}>
      <div className="form"><strong>{change.device.name}</strong>
        <p>{change.state === 'active' ? '确认设备仍由你控制后恢复接单。' : change.state === 'retired'
          ? '该登记将永久停止接单。再次使用这台设备需要重新配对。' : '暂停新任务。已有执行须回报停止后才能交接。'}</p>
        <div className="form-actions"><Button disabled={busy} variant={change.state === 'active' ? 'default' : 'destructive'} onClick={async () => {
          if (await run(() => api('device/' + change.device.id, { state: change.state }), '执行端状态已更新')) setChange(undefined);
        }}>确认</Button></div>
      </div>
    </Modal>}
    {pair && (remote ? <Modal title="连接设备" close={() => show(false)}>
      <RunnerConnectInstructions url={remote} legacy={workspace.executionRuntime !== 'contractor'} />
    </Modal> : <LocalWorkerPair project={project.id} workspace={workspace} close={() => show(false)} />)}
  </Section>;
}

export function PointsPane({ project }: { project: string }) {
  const status = useData<{ enabled: boolean }>('budget/points-status');
  const pools = useData<PointPool[]>('project/' + project + '/point-budgets', 3000);
  const usage = useData<Usage>('project/' + project + '/usage', 3000);
  const [pool, setPool] = useState<PointPool>();
  return <>
    <Section title="积分额度" action={status.data && <Pill tone={status.data.enabled ? 'green' : 'neutral'}>
      {status.data.enabled ? '已启用' : '未启用'}</Pill>}>
      {status.error && <Failure error={status.error} retry={() => void status.refetch()} />}
      {pools.error ? <Failure error={pools.error} retry={() => void pools.refetch()} /> : !pools.data ? <Loading /> : pools.data.map(item =>
        <div className="revision-note" key={item.kind + ':' + item.subject}>
          <div className="section-heading"><h3>{item.label}</h3><div className="actions">
            {item.blocked && <Pill tone="amber">暂停新执行</Pill>}
            {item.mayManage && <Button variant="outline" size="sm" onClick={() => setPool(item)}>调整积分</Button>}
          </div></div>
          <div className="receipt-stats">
            <div><small>{item.period === 'day' ? '每日' : '每月'}上限</small><strong>{item.limit ?? '不限'}</strong></div>
            <div><small>已用 / 预留</small><strong>{item.used} / {item.reserved}</strong></div>
            <div><small>可用</small><strong>{item.remaining ?? '不限'}</strong></div>
          </div>
          <p className="muted-text">{item.tokens.toLocaleString()} Token
            {item.overLimit > 0 && ' · 超上限 ' + item.overLimit + ' 分'}
            {item.incomplete > 0 && ' · ' + item.incomplete + ' 轮用量待完整回报'}</p>
        </div>)}
    </Section>
    <Section title={usage.data?.scope === 'project' ? '本项目积分回执' : '我的积分回执'}>
      {usage.error ? <Failure error={usage.error} retry={() => void usage.refetch()} /> : !usage.data ? <Loading />
        : !usage.data.pointAttempts.length ? <p className="muted-text">暂无积分回执</p>
        : usage.data.pointAttempts.slice(-20).reverse().map(row => <div className="record-row" key={row.run + ':' + row.attempt}>
          <span>#{row.run} · 尝试 {row.attempt}</span><strong>{row.model}</strong><span>{row.multiplier}×</span>
          <span>{row.tokens === null ? 'Token 待回报' : row.tokens.toLocaleString() + ' Token'}</span>
          <span>{row.charged === null ? '积分待结算' : row.charged + ' 分'}</span>
          {!!row.overReservation && <Pill tone="amber">超预留 {row.overReservation} 分</Pill>}
        </div>)}
    </Section>
    {pool && <PointPoolEditor pool={pool} close={() => setPool(undefined)} />}
  </>;
}

export function PointPoolEditor({ pool, close }: { pool: PointPool; close: () => void }) {
  const { run } = useActions();
  const [baseline, setBaseline] = useState(pool);
  const [limited, setLimited] = useState(pool.limit !== null);
  const [period, setPeriod] = useState(pool.period);
  const [limit, setLimit] = useState(String(pool.limit ?? ''));
  const nextLimit = limited ? Number(limit) : null;
  const changed = baseline.limit !== nextLimit || (limited && baseline.period !== period);
  return <SettingsDrawer title={'调整额度 · ' + pool.label} close={close}
    submit={{ form: 'point-pool', label: '保存额度', disabled: !changed || (limited && limit === '') }}>
    <form className="form" id="point-pool" onSubmit={async event => {
      event.preventDefault();
      if (changed && await run(() => api('budget/points-limit', { kind: pool.kind, subject: pool.subject, period,
        limit: nextLimit, revision: baseline.revision }), '积分池额度已更新')) close();
    }}>
      <div className="admin-drawer-details"><strong>当前周期</strong>
        <p>上限 {baseline.limit ?? '不限'} · 已用 {baseline.used.toLocaleString()} 分 · 预留 {baseline.reserved.toLocaleString()} 分</p>
        <Button type="button" variant="ghost" size="sm" onClick={async () => {
          const current = await run(() => api<Omit<PointPool, 'label' | 'mayManage'>>('budget/points-limit?' + new URLSearchParams({ kind: pool.kind, subject: pool.subject })));
          if (current) setBaseline({ ...pool, ...current });
        }}>读取当前额度</Button>
      </div>
      <Field label="额度模式"><select value={limited ? 'limited' : 'unlimited'} onChange={event => setLimited(event.target.value === 'limited')}>
        <option value="unlimited">不限</option><option value="limited">设置上限</option>
      </select></Field>
      {limited && <div className="form-grid">
        <Field label="额度周期"><select value={period} onChange={event => setPeriod(event.target.value as PointPool['period'])}>
          <option value="day">每日</option><option value="month">每月</option>
        </select></Field>
        <Field label="积分上限" hint="0 分暂停新执行。"><Input type="number" min={0} max={1000000000} step={0.001} required
          value={limit} onChange={event => setLimit(event.target.value)} /></Field>
      </div>}
    </form>
  </SettingsDrawer>;
}

export function BudgetPane({ project }: { project: string }) {
  const data = useData<BudgetRow[]>('project/' + project + '/budgets', 2800);
  const [editing, setEditing] = useState<BudgetRow>();
  return <Section title="当前周期" action={<span className="muted-text">按派出的执行尝试计次</span>}>
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading /> : data.data.map(pool =>
      <article className="revision-note" key={pool.kind + pool.subject}>
        <div className="section-heading"><h3>{pool.label}</h3>
          {pool.mayManage && <Button variant="outline" size="sm" onClick={() => setEditing(pool)}>调整额度</Button>}
        </div>
        <div className="receipt-stats">
          <div><small>已分配</small><strong>{pool.limit ?? '不限'}</strong></div>
          <div><small>已派出 / 在途</small><strong>{pool.used} / {pool.pending}</strong></div>
          <div><small>可用</small><strong>{pool.remaining ?? '不限'}</strong></div>
        </div>
        <p className="muted-text">{pool.period === 'day' ? '每日' : '每月'} · 单次最多 {pool.maxMinutes ?? 8} 分钟
          {' · '}{pool.tokenReceipts ? pool.tokens.toLocaleString() + ' Token 已回报' : 'Token 未回报'}
          {' · '}{pool.unpriced ? '已知金额 $' + Number(pool.knownAmount.toFixed(6)) + '，' + pool.unpriced + ' 次未报价'
            : pool.used - pool.pending > 0 ? '已回报 $' + Number(pool.knownAmount.toFixed(6)) : '暂无费用回执'}</p>
      </article>)}
    {editing && <BudgetEditor pool={editing} close={() => setEditing(undefined)} />}
  </Section>;
}

function BudgetEditor({ pool, close }: { pool: BudgetRow; close: () => void }) {
  const { run, busy } = useActions();
  return <Modal title={'调整' + pool.label + '额度'} close={close}><form className="form" onSubmit={async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (await run(() => api('budget', { kind: pool.kind, subject: pool.subject, period: form.get('period'),
      limit: form.get('limit') === '' ? null : Number(form.get('limit')),
      maxMinutes: form.get('minutes') === '' ? undefined : Number(form.get('minutes')) }), '已更新额度')) close();
  }}>
    <Field label="周期"><select name="period" defaultValue={pool.period}><option value="day">每日</option><option value="month">每月</option></select></Field>
    <Field label="执行尝试上限" hint="留空取消本额度限制。填 0 暂停新执行。">
      <Input name="limit" type="number" min={0} max={100000} step={1} defaultValue={pool.limit ?? ''} />
    </Field>
    <Field label="单次执行分钟数" hint="设定尝试上限时，可同时缩短原生执行端的默认 8 分钟时限。">
      <Input name="minutes" type="number" min={1} max={8} step={1} defaultValue={pool.maxMinutes ?? ''} />
    </Field>
    <div className="form-actions"><Button type="submit" disabled={busy}>保存</Button></div>
  </form></Modal>;
}

export function AgentMemory({ project, agent }: { project: string; agent: string }) {
  const data = useData<MemoryRow[]>('project/' + project + '/memory?agent=' + encodeURIComponent(agent), 3500);
  return <Section title="项目记忆使用记录">
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading />
      : data.data.length ? data.data.map(entry => <div className="record-row" key={entry.id}>
        <a className="text-button" href={routeFor(project, 'knowledge', entry.id, entry.retirement ? 'history' : 'current')}>{entry.title}<ArrowRight size={14} /></a>
        <Pill tone={entry.cited ? 'green' : 'neutral'}>{entry.cited ? '成果已引用' : '已装配'}</Pill>
        <a href={routeFor(project, 'work', entry.ticket, 'context')}>{entry.ticketTitle}</a>
      </div>) : <p className="muted-text">暂无可查看的记忆使用记录。</p>}
  </Section>;
}
