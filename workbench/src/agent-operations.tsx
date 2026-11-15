import { useState } from 'react';
import { ArrowLeft, ArrowRight, Cpu, Plus, ReceiptText } from 'lucide-react';
import { api, useData, type BudgetRow, type DeviceRow, type MemoryRow } from './api.ts';
import { routeFor, type PageProps } from './navigation.ts';
import { Button } from './paperclip/button.tsx';
import { Input } from './paperclip/input.tsx';
import { date, Empty, Failure, Field, Loading, Modal, Pill, Section, useActions } from './ui.tsx';

export function AgentOperations(props: PageProps & { page: 'devices' | 'budgets' }) {
  const { page, project } = props;
  const Icon = page === 'devices' ? Cpu : ReceiptText;
  return <div className="page-scroll"><div className="project-page">
    <header className="object-header">
      <div className="object-emblem"><Icon size={24} /></div>
      <div><h1>{page === 'devices' ? '执行端' : '额度管理'}</h1><p className="muted-text">{project.title}</p></div>
      <a className="text-button object-action" href={routeFor(project.id, 'agents')}><ArrowLeft size={16} />Agent</a>
    </header>
    <div className="detail-stack">{page === 'devices' ? <DevicePane {...props} /> : <BudgetPane project={project.id} />}</div>
  </div></div>;
}

function DevicePane({ workspace, project }: PageProps) {
  const data = useData<DeviceRow[]>('project/' + project.id + '/devices', 2200);
  const canPair = project.mayStart && workspace.agents.some(agent => agent.owner === workspace.actor
    && agent.active && agent.engine === 'codex' && agent.projects.includes(project.id));
  const [pair, show] = useState(false);
  const { run, busy } = useActions();
  return <Section title="项目执行端" action={canPair && <Button size="sm" onClick={() => show(true)}><Plus />连接本机</Button>}>
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading />
      : data.data.length ? data.data.map(device => <div className="resource-row" key={device.id}>
        <span className="heading-icon"><Cpu size={17} /></span>
        <div className="min-w-0"><strong>{device.name}</strong><p className="muted-text">
          {workspace.agents.find(agent => agent.id === device.agent)?.title ?? device.agent} · {device.owner}
          {device.lastSeen && ' · ' + date(new Date(device.lastSeen).toISOString())}
        </p></div>
        <div className="actions">
          <Pill tone={device.online && device.eligible ? 'green' : 'neutral'}>
            {!device.active ? '已暂停' : !device.eligible ? '授权已变化' : device.online ? '在线' : '离线'}
          </Pill>
          {device.mayManage && <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void run(() => api('device/' + device.id, { active: !device.active }),
              device.active ? '已暂停执行端接单' : '已恢复执行端接单')}>{device.active ? '暂停接单' : '恢复接单'}</Button>}
        </div>
      </div>) : <Empty title="此项目尚无执行端" icon={<Cpu />} />}
    {pair && <DevicePair project={project} workspace={workspace} close={() => show(false)} />}
  </Section>;
}

function DevicePair({ project, workspace, close }: Pick<PageProps, 'project' | 'workspace'> & { close: () => void }) {
  const options = workspace.agents.filter(agent => agent.owner === workspace.actor && agent.active && agent.engine === 'codex' && agent.projects.includes(project.id));
  const [issued, setIssued] = useState<{ code: string; expires: number }>();
  const { run, busy } = useActions();
  return <Modal title="连接本机执行端" close={close}>
    {issued ? <div className="form">
      <p>在工作台所在设备的项目目录，使用同一工作台数据目录运行以下命令。按提示把配对码输入终端。</p>
      <code>npm run runner -- pair {location.port || '4280'} "研发本机"</code>
      <div className="record-row"><strong>一次性配对码</strong><code>{issued.code}</code><span>{date(new Date(issued.expires).toISOString())} 失效</span></div>
      <p className="muted-text">用终端返回的启动命令连接后，这台设备会显示在线。</p>
    </div> : <form className="form" onSubmit={async event => {
      event.preventDefault();
      const agent = new FormData(event.currentTarget).get('agent');
      const issued = await run(() => api<{ code: string; expires: number }>('device/pair', { project: project.id, agent }));
      if (issued) setIssued(issued);
    }}><Field label="绑定我的 Agent"><select name="agent" required>{options.map(agent => <option value={agent.id} key={agent.id}>{agent.title}</option>)}</select></Field>
      <div className="form-actions"><Button type="submit" disabled={busy || !options.length}>生成配对码</Button></div>
    </form>}
  </Modal>;
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
