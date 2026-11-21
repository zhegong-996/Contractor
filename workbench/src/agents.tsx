import { AlertTriangle, ArrowLeft, Bot, ChevronRight, Cpu, Laptop, Layers, ListChecks, MessageSquare, Play, ReceiptText, Route as Routing, ShieldCheck } from 'lucide-react';
import { api, useData, useTickets, type Agent, type Usage } from './api.ts';
import { agentSettingsRoute, go, routeFor, type PageProps } from './navigation.ts';
import { TabsContent } from './components/page-tabs.tsx';
import { Button } from './components/button.tsx';
import { Avatar, date, Empty, Failure, Loading, PageTabs, Pill, SearchBox, Section, Segments, TicketStatus, useActions, useStored } from './ui.tsx';
import { AgentMemory, AgentOperations } from './agent-operations.tsx';
import { AgentLibrary } from './agent-library.tsx';
import { WorkerHarness } from './worker-harness.tsx';

const agentTabs = [['profile', '职责与委托'], ['memory', '项目知识'], ['receipts', '执行与费用']] as const;
export function AgentsPage(props: PageProps) {
  const { workspace, project, route } = props;
  const tab = route.item ? undefined : route.tab;
  const library = tab === 'library' && workspace.octopEnabled;
  const catalogue = tab !== 'devices' && tab !== 'budgets' && !library;
  return <div className="agent-workspace">
    <nav className="agent-navigation" aria-label="Agent 配置入口">
      <a className="text-button" href={routeFor(project.id, 'agents')} aria-current={catalogue ? 'page' : undefined}><Bot size={16} />项目 Agent</a>
      <a className="text-button" href={agentSettingsRoute('agent', project.id)}><Bot size={16} />个人 Agent</a>
      {workspace.canManageServices && <a className="text-button" href={agentSettingsRoute('router', project.id)}><Routing size={16} />平台 Router</a>}
      <a className="text-button" href={agentSettingsRoute('workers', project.id)}><Laptop size={16} />我的 Worker</a>
    </nav>
    {tab === 'devices' || tab === 'budgets' ? <AgentOperations {...props} page={tab} />
      : library ? <AgentLibrary {...props} />
      : <ProjectAgentCatalog {...props} />}
  </div>;
}

function ProjectAgentCatalog(props: PageProps) {
  const { workspace, project, route } = props;
  const [query, search] = useStored('agents-search:' + project.id, '');
  const [scope, setScope] = useStored('agents-scope:' + project.id, 'all');
  const all = workspace.agents.filter(agent => agent.projects.includes(project.id));
  const shown = all.filter(a => (scope === 'all' || a.owner === workspace.actor)
    && (a.title + a.owner + a.capability).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = route.item ? all.find(agent => agent.id === route.item) : undefined;
  return <div className="split" data-has-detail={!!route.item}>
    <aside className="split-list" aria-label="项目 Agent 列表">
      <div className="list-header"><div className="actions">
        {workspace.octopEnabled && <a className="text-button" href={routeFor(project.id, 'agents', undefined, 'library')}><Layers size={15} />专家与技能</a>}
        <a className="text-button" href={routeFor(project.id, 'agents', undefined, 'devices')}><Cpu size={15} />项目设备</a>
        <a className="text-button" href={routeFor(project.id, 'agents', undefined, 'budgets')}><ReceiptText size={15} />额度管理</a>
      </div><Segments label="Agent 范围" items={[[ 'all', '项目 Agent' ], [ 'mine', '我负责的' ]]} value={scope} onChange={setScope} />
      <SearchBox label="搜索 Agent 或负责人" value={query} onChange={search} /></div>
      <div className="list-scroll">
        {shown.map(agent => <a className="list-item entry-item" href={routeFor(project.id, 'agents', agent.id)} key={agent.id}
          aria-current={selected?.id === agent.id ? 'page' : undefined}>
          <Avatar value={agent.title} kind="agent" /><div><strong>{agent.title}</strong>
            <div className="list-item-meta"><span>{agent.owner}</span><Pill tone={agent.active ? 'green' : 'neutral'}>{agent.active ? '在岗' : '未启用'}</Pill></div></div>
        </a>)}
        {!shown.length && <Empty title={all.length ? '没有匹配的 Agent' : '此项目暂无 Agent'} icon={<Bot />} />}
      </div>
    </aside>
    <div className="split-detail">
      {route.item && <a className="mobile-back" href={routeFor(project.id, 'agents')}><ArrowLeft size={16} />Agent 列表</a>}
      {selected ? <AgentDetail key={selected.id} agent={selected} {...props} />
        : <div className="agent-overview"><div className="object-header"><div className="object-emblem"><Bot size={25} /></div><div><h1>项目 Agent</h1>
          <p className="muted-text">{all.filter(a => a.active).length} 位在岗 · {all.length} 位已登记</p></div></div>
          <div className="agent-roles">
            <div><ShieldCheck size={18} /><div><strong>平台 Router</strong><p>管理员配置。负责路由建议与知识提炼，不在具体设备上执行。</p></div></div>
            <div><Bot size={18} /><div><strong>个人 Agent</strong><p>你自己配置。处理个人代办、沉淀个人经验，在「我的会话」与你对话。</p></div></div>
            <div><Cpu size={18} /><div><strong>Worker 设备</strong><p>设备主人接入。项目里的执行 Agent 通过设备真正干活，可随时插拔。</p></div></div>
          </div>
          {shown.length ? <div className="agent-cards">{shown.map(agent => <a key={agent.id} className="agent-card" href={routeFor(project.id, 'agents', agent.id)}>
            <div className="agent-card-top"><Avatar value={agent.title} kind="agent" /><Pill tone={agent.active ? 'green' : 'neutral'}>{agent.active ? '在岗' : '未启用'}</Pill></div>
            <h2>{agent.title}</h2><p>{agent.capability}</p><div className="agent-card-foot"><span>{agent.owner} · {engineName(agent.engine)}</span><ChevronRight size={16} /></div>
          </a>)}</div> : <Empty title={all.length ? '没有匹配的 Agent' : '等待项目配置执行成员'} icon={<Bot />} />}
        </div>}
    </div>
  </div>;
}

function engineName(engine: string) {
  return ({ codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', acp: 'ACP', command: '命令行', octop: 'Octop 只读专家' } as Record<string,string>)[engine] ?? engine;
}
function AgentDetail({ agent, project, workspace, route, openTask }: PageProps & { agent: Agent }) {
  const { run, busy } = useActions();
  const active = route.tab === 'receipts' || route.tab === 'memory' ? route.tab : 'profile';
  const mine = agent.kind === 'personal' && agent.owner === workspace.actor;
  const role = workspace.functions.find(f => f.id === agent.function);
  const duties = project.dispatch.filter(rule => rule.agent === agent.id);
  const assigned = useTickets({ project: project.id, agent: agent.id, limit: 12 }, active === 'profile', 5000).rows;
  const topics = project.topics.filter(topic => topic.consultants.includes(agent.id));
  return <div className="agent-detail">
    <header className="object-header"><div className="object-emblem"><Bot size={26} /></div>
      <div className="min-w-0"><h1>{agent.title}</h1><div className="object-meta">
        <Pill tone={agent.active ? 'green' : 'neutral'}>{agent.active ? '在岗' : '未启用'}</Pill>
        <span>{agent.kind === 'personal' ? '成员执行 Agent' : '专项 Agent'}</span><span>所有者 {agent.owner}</span>
      </div></div>
      {project.mayStart && agent.active && <Button size="sm" className="object-action" onClick={() => openTask({ agent: agent.id, personal: mine })}>
        <Play />{mine ? '发起只读代办' : '发起委托'}</Button>}
    </header>
    <PageTabs label="Agent 详情" items={agentTabs} value={active} onChange={tab => go(project.id, 'agents', agent.id, tab)}>
      <TabsContent value="profile" className="detail-stack reading">
        <Section title="职责"><p>{agent.capability}</p>
          <dl className="facts"><dt>项目职责</dt><dd>{role?.title ?? agent.function}</dd></dl>
          {duties.map(rule => <div className="record-row" key={(rule.topic ?? '') + rule.function}>
            <span>{project.topics.find(topic => topic.id === rule.topic)?.title ?? '项目默认牵头'}</span>
            {rule.decider && <small>决策人 {rule.decider}</small>}
          </div>)}
          {agent.canManage && <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void run(() => api('agent/' + agent.id, { active: !agent.active }), agent.active ? 'Agent 已停用' : 'Agent 已启用')}>
            <ShieldCheck />{agent.active ? '暂停接单' : '启用接单'}
          </Button>}
        </Section>
        <Section title="运行与模型">
          <dl className="facts">
            <dt>运行引擎</dt><dd>{engineName(agent.engine)}</dd>
            <dt>默认模型</dt><dd>{agent.model ?? '未配置'}</dd>
            <dt>执行位置</dt><dd>{agent.executionCapabilities.remote
              ? <a className="text-button" href={routeFor(project.id, 'agents', undefined, 'devices')}>查看项目执行设备</a>
              : agent.executionCapabilities.available ? '工作台运行时' : agent.executionCapabilities.reason}</dd>
          </dl>
          {project.maintain && <a className="text-button" href={routeFor(project.id, 'project', undefined, 'routing')}>配置本项目的职责、主备模型与设备</a>}
        </Section>
        {project.mayStart && (project.maintain || agent.owner === workspace.actor) && ['codex', 'claude'].includes(agent.engine)
          && <WorkerHarness project={project.id} agent={agent.id} />}
        {!!topics.length && <Section title="主题咨询">{topics.map(topic => <div className="record-row" key={topic.id}>
          <a className="text-button" href={routeFor(project.id, 'chat', topic.id) + '?agent=' + encodeURIComponent(agent.id)}><MessageSquare size={15} />{topic.title}</a>
        </div>)}</Section>}
        <Section title="项目工单" action={<a className="text-button" href={routeFor(project.id, 'work')}><ListChecks size={15} />全部工单</a>}>
          {assigned.length ? assigned.slice(0, 12).map(t => <div className="record-row" key={t.id}>
            <a href={routeFor(project.id, 'work', t.id)}>{t.title}</a><TicketStatus ticket={t} /><span className="muted-text">第 {t.work.version ?? 1} 版</span>
          </div>) : <p className="muted-text">当前没有分配给该 Agent 的工单。</p>}
        </Section>
      </TabsContent>
      <TabsContent value="memory" className="detail-stack reading"><AgentMemory project={project.id} agent={agent.id} /></TabsContent>
      <TabsContent value="receipts" className="detail-stack reading"><Receipts project={project.id} agent={agent.id} /></TabsContent>
    </PageTabs>
  </div>;
}

export function Receipts({ project, agent }: { project: string; agent?: string }) {
  const data = useData<Usage>('project/' + project + '/usage', 4000);
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  const facts = data.data;
  const rows = facts.attempts.filter(r => !agent || r.agent === agent).slice().reverse();
  const measured = agent ? rows.reduce((sum, r) => sum + (r.usage?.input ?? 0) + (r.usage?.output ?? 0), 0) : facts.input + facts.output;
  const unknown = agent ? rows.filter(r => r.billing?.status !== 'reported').length : facts.unpriced;
  const amount = agent ? rows.reduce((sum, r) => sum + (r.billing?.amount ?? 0), 0) : facts.billing.knownAmount;
  return <Section title="用量回执">
    {!!facts.alerts?.length && <div className="detail-stack">
      {facts.alerts.slice(0, 8).map(alert => <div className="info-callout" key={alert.key}>
        <AlertTriangle size={16} /> <span><strong>{alert.level === 'critical' ? '额度严重不足' : '额度提醒'} · {date(alert.at)}</strong><br />{alert.detail}</span>
      </div>)}
    </div>}
    <div className="receipt-stats">
      <div><small>已记录 Token</small><strong>{measured.toLocaleString('zh-CN')}</strong></div>
      <div><small>{unknown ? '已知金额小计' : '已回报金额'}</small><strong>{unknown && amount === 0 ? '未回报' : '$' + Number(amount.toFixed(6)).toLocaleString('en-US')}</strong></div>
      <div><small>缺少金额的尝试</small><strong>{unknown}</strong></div>
    </div>
    {unknown > 0 && <p className="muted-text">部分执行未返回金额，总费用暂不可核对。</p>}
    {rows.length ? <div className="receipts-table"><table><thead><tr><th>执行</th><th>委托与所有者</th><th>模型</th><th>用量</th><th>金额 USD</th></tr></thead>
      <tbody>{rows.map(r => {
        const reported = r.modelReceipt && 'reported' in r.modelReceipt ? r.modelReceipt.reported : undefined;
        return <tr key={r.run + ':' + r.attempt}>
        <td>#{r.run} / {r.attempt}<small>{({ done: '完成', failed: '失败', cancelled: '取消', nothing: '已完成' } as Record<string,string>)[r.outcome] ?? r.outcome}</small></td>
        <td>{r.delegatedBy} → {r.owner}</td>
        <td>{reported ?? r.model ?? '未知'}<small>{reported ? 'CLI 回报' : '配置记录'}</small></td>
        <td>{r.usage ? ((r.usage.input ?? 0) + (r.usage.output ?? 0)).toLocaleString('zh-CN') : '未回报'}</td>
        <td>{r.billing?.amount ?? '未回报'}</td>
      </tr>; })}</tbody></table></div> : <Empty title="暂无执行回执" icon={<ReceiptText />} />}
  </Section>;
}
