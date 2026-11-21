import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, ChevronRight, CircleCheck, FileCheck2, GitBranch, GitPullRequest, History, Link2, ListChecks, LockKeyhole, MessageSquare, PanelRightClose, PanelRightOpen, Plus, ShieldCheck } from 'lucide-react';
import { api, uid, useData, useTickets, type Knowledge, type Ticket, type TicketRow, type TicketTopicContext } from './api.ts';
import { AgentOptions, MaterialPicker } from './creation.tsx';
import { Conversation } from './conversation.tsx';
import { AcceptedEvidence } from './accepted-evidence.tsx';
import { ChannelReceipt, DeliveryVerification, StageChecks } from './work-evidence.tsx';
import { WorkBoard, workStates, type BoardGrouping } from './work-board.tsx';
import { RunHistory } from './work-execution.tsx';
import { eligibleExecutionDevices, ExecutionTargetPicker, useExecutionTargets } from './execution-target.tsx';
import { CaseEditor, ProductChecks, ProductVerificationPanel } from './product-criteria.tsx';
import { go, projectWorkRoute, routeFor, runRoute, withConversationOrigin, workFromInbox, type PageProps } from './navigation.ts';
import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { TicketPicker } from './components/ticket-picker.tsx';
import { forest, type Branch } from './hierarchy.ts';
import { TabsContent } from './components/page-tabs.tsx';
import { Markdown } from './markdown.tsx';
import { Avatar, date, Empty, Ext, Failure, Field, IconButton, KnowledgeGrantStatus, Loading, Modal, PageTabs, Pill, recoveryLabel, SearchBox, Section, short, Source,
  Segments, TicketStatus, TopicOptions, topicName, useActions, useSessionScroll, useStored, Version } from './ui.tsx';

const workTabs = [['activity', '协作动态'], ['execution', '执行记录'], ['delivery', '交付与验收'], ['context', '上下文']] as const;
type WorkTab = (typeof workTabs)[number][0];
const pullStates: Record<string, string> = { open: '开启', draft: '草稿', closed: '已关闭', merged: '已合并' };
const reviewStates: Record<string, string> = { APPROVED: '已通过', CHANGES_REQUESTED: '要求修改', COMMENTED: '已评论', DISMISSED: '已撤销', PENDING: '待提交' };

const recoveryActions: Record<string, string> = {
  'wait-receipt': '等待原执行的回执补写', 'restore-old-runner': '让原执行端恢复连接并回报停止',
  'authorize-material': '由资料负责人核对并授权', 'confirm-assignment': '由受托研发确认是否接单',
  'answer-required-question': '回答全部必答问题', 'review-returned-assignment': '由负责人重新安排执行',
  'confirm-delegation': '由负责人确认子任务', 'review-required-child': '检查缺失或失效的子任务结果',
  'wait-child-results': '等待必需的子任务结果齐全', 'wait-ci': '等待本版提交的 CI 完成',
  'wait-deployment': '等待本版部署核对', 'check-delivery': '核对本版交付证据',
  'review-current-version': '验收当前版本', 'request-or-check-material': '核对资料或重新申请授权',
  'reconnect-original-runner': '连接原执行端，接续原工单', 'wait-native-retry': '等待调度器自动重试',
  'check-runner': '检查执行端、模型或成员凭据', 'review-mandate': '核对当前委托与权限',
  'fix-and-resume': '处理阻塞后接续原工单', 'wait-handoff': '等待交接完成',
  'confirm-topic-basis': '由发起人或项目维护人确认一条当前主题依据',
  'complete-product-checks': '由发起人完成本版验收条件的逐项核对',
};
function TicketRecovery({ ticket, project, workspace }: PageProps & { ticket: Ticket }) {
  const recovery = ticket.recovery;
  if (!recovery) return null;
  const base = routeFor(project.id, 'work', ticket.id);
  const next = recovery.next;
  return <Section title={recoveryLabel(recovery.kind) ?? '本版待处理'} action={<Version version={recovery.version} />}>
    <p>{recoveryActions[next] ?? '查看当前工单的处理依据'}</p>
    <div className="inline-meta">
      {!!recovery.owners.length && <span>处理人 {recovery.owners.map(owner => owner === workspace.actor ? '我' : owner).join('、')}</span>}
      {recovery.retryAt && <span>预计重试 {date(recovery.retryAt, true)}</span>}
      {recovery.run && <a href={runRoute(project.id, ticket.id, recovery.run)}>执行 #{recovery.run}</a>}
      {!!recovery.decisionIds.length && <a href={routeFor(project.id, 'inbox')}>待我处理</a>}
      {['authorize-material', 'request-or-check-material'].includes(next) && <a href={base + '?tab=context'}>资料与授权</a>}
      {next === 'confirm-topic-basis' && <a href={base + '?tab=context'}>核对主题依据</a>}
      {['wait-ci', 'wait-deployment', 'check-delivery', 'review-current-version', 'complete-product-checks'].includes(next) && <a href={base + '?tab=delivery'}>查看本版交付</a>}
      {['restore-old-runner', 'reconnect-original-runner', 'check-runner'].includes(next) && <a href={routeFor(project.id, 'agents', undefined, 'devices')}>查看执行端</a>}
    </div>
  </Section>;
}

function githubActor(identity: { login: string; member?: string } | null | undefined) {
  if (!identity) return '—';
  return identity.member && identity.member !== identity.login ? identity.member + ' (@' + identity.login + ')' : '@' + identity.login;
}

export function WorkPage(props: PageProps) {
  const { project, route, workspace, openTask } = props;
  const routedTopic = project.topics.find(topic => topic.id === route.workTopic)?.id;
  const [filters, setFilters] = useStored('work:' + project.id + (route.projectWork ? ':project:' + (routedTopic ?? '') : ''),
    { query: '', topic: routedTopic ?? '', status: 'all' });
  const [storedScope, setScope] = useStored('work-scope', 'project');
  const scope = route.projectWork ? 'project' : storedScope;
  const [view, setView] = useStored<'board' | 'list'>('work-view', 'board');
  const [group, setGroup] = useStored<BoardGrouping>('work-board-group', 'status');
  const [origin] = useStored('board-return:' + route.item, { project: project.id, topic: undefined as string | undefined, scoped: false });
  const boardProject = workspace.projects.some(item => item.id === origin.project) ? origin.project : project.id;
  const boardBack = origin.scoped ? projectWorkRoute(boardProject, origin.topic) : routeFor(boardProject, 'work');
  const backToInbox = workspace.projects.some(item => item.id === route.inboxOrigin) ? routeFor(route.inboxOrigin!, 'inbox') : undefined;
  const fromChat = route.conversationOrigin;
  const chatProject = workspace.projects.find(item => item.id === fromChat?.project);
  const chatTopic = chatProject?.topics.find(topic => topic.id === fromChat?.item)?.id;
  const backToChat = chatProject && routeFor(chatProject.id, 'chat', chatTopic, fromChat?.tab === 'project' ? 'project' : undefined);
  const status = ({ active: 'running', acceptance: 'review', accepted: 'done', answered: 'done', ended: 'closed' } as Record<string, string>)[filters.status] ?? filters.status;
  const listScroll = useSessionScroll(JSON.stringify(['work-list', project.id, scope, filters]), { visibleAt: route.item });
  const tickets = useTickets({ ...(scope === 'mine' ? { mine: true } : { project: project.id, topic: filters.topic }),
    purpose: 'work', q: filters.query.trim().slice(0, 240), state: workStates.find(item => item.id === status)?.id }, view === 'list' || !route.item, 4000);
  const shown = tickets.rows;
  const empty = !shown.length && !tickets.isPending && !tickets.hasNextPage && !tickets.error;
  const listState = <>{tickets.error && <Failure error={tickets.error} retry={() => void tickets.refetch()} />}
    {tickets.isPending && <Loading />}
    {tickets.hasNextPage && <Button size="sm" variant="outline" disabled={tickets.isFetching} onClick={() => void tickets.fetchNextPage()}>
      加载更多工单</Button>}</>;
  const tab: WorkTab = route.tab === 'context' && route.run ? 'execution' : workTabs.find(([id]) => id === route.tab)?.[0] ?? 'activity';
  const data = useData<Ticket>(route.item ? 'ticket/' + route.item : '', 2200);
  const detailScroll = useSessionScroll(JSON.stringify(['work-detail', project.id, route.item, tab, route.revision, route.run, route.attempt]), {
    ready: !route.item || data.data?.project === project.id && data.data.id === route.item,
    preserveInitial: !!route.decision || tab === 'delivery' && !!route.revision,
  });
  const scopeFilter = <Segments label="任务范围" items={[[ 'project', '项目任务' ], [ 'mine', '我的任务' ]]} value={scope} onChange={next => {
    setScope(next);
    if (route.projectWork && next === 'mine') go(project.id, 'work');
  }} />;
  const viewFilter = <Segments label="任务视图" items={[[ 'board', '看板' ], [ 'list', '列表' ]]} value={view} onChange={setView} />;
  const taskFilters = <>
    <SearchBox label="搜索工单" value={filters.query} onChange={query => setFilters({ ...filters, query })} />
    <div className="filters">
      {scope !== 'mine' && <select aria-label="筛选主题" value={filters.topic} onChange={e => {
        if (route.projectWork && !route.item) window.location.hash = projectWorkRoute(project.id, e.target.value);
        else setFilters({ ...filters, topic: e.target.value });
      }}><TopicOptions project={project} empty="全部主题" /></select>}
      <select aria-label="筛选状态" value={status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
        <option value="all">全部状态</option>{workStates.map(({ id, title }) => <option value={id} key={id}>{title}</option>)}
      </select>
    </div>
  </>;
  const add = () => openTask({ topic: scope === 'project' && filters.topic || undefined });
  if (view === 'board' && !route.item) return <section className="work-desk" aria-label="任务">
    <header className="work-desk-header">
      <div className="work-desk-title"><h1>任务</h1>
        {project.mayStart && <Button size="sm" onClick={add}><Plus size={16} />新建工单</Button>}</div>
      <div className="work-desk-controls">
        <div className="work-desk-views">{scopeFilter}{viewFilter}</div>
        <div className="work-desk-filters">{taskFilters}
          <select aria-label="看板分组" value={group} onChange={e => setGroup(e.target.value as BoardGrouping)}>
            <option value="status">按状态分组</option><option value="priority">按优先级分组</option>
          </select>
        </div>
      </div>
    </header>
    {shown.length > 0 && <WorkBoard tickets={shown} workspace={workspace} project={project} mine={scope === 'mine'} group={group}
      origin={{ project: project.id, topic: routedTopic, scoped: !!route.projectWork }}
      scrollKey={JSON.stringify(['work-board', project.id, scope, group, filters])} />}
    {empty && <Empty title="没有匹配的工单" icon={<ListChecks />} />}
    {listState}
  </section>;
  return <div className="split" data-has-detail={!!route.item}>
    {view === 'list' && <aside className="split-list" aria-label="项目工单列表">
      <div className="list-header">
        <div className="list-title"><h1>任务</h1>{project.mayStart && <IconButton label="新建工单" onClick={add}><Plus /></IconButton>}</div>
        {scopeFilter}{viewFilter}{taskFilters}
      </div>
      <div className="list-scroll" {...listScroll}>
        {(scope === 'mine' ? workspace.projects : [project]).map(home => {
          const roots = forest(shown.filter(item => item.work.project === home.id), item => item.work.parent);
          return roots.length > 0 && <section key={home.id} aria-label={home.title}>
            {scope === 'mine' && <h2 className="tree-heading">{home.title}</h2>}
            {roots.map(branch => <TaskBranch key={branch.item.id} branch={branch} home={home} current={route.item} />)}
          </section>;
        })}
        {empty && <Empty title="没有匹配的工单" icon={<ListChecks />} />}
        {listState}
      </div>
    </aside>}
    <div className="split-detail" {...detailScroll}>
      {route.item && <a className={backToInbox || backToChat || view === 'board' ? 'work-back' : 'mobile-back'}
        href={backToInbox || backToChat || (view === 'board' ? boardBack : routeFor(project.id, 'work'))}>
        <ArrowLeft size={16} />{backToInbox ? '返回待办' : backToChat ? '返回会话' : view === 'board' ? '返回看板' : '工单列表'}</a>}
      {!route.item ? <div className="desk-overview"><h1>{scope === 'mine' ? '我的任务' : project.title}</h1>
        <div className="status-grid">{workStates.map(({ id, title }) => <button key={id} type="button" aria-pressed={status === id}
          onClick={() => setFilters({ ...filters, status: status === id ? 'all' : id })}>{title}</button>)}</div>
        <Section title="近期更新">{shown.length ? shown.slice(0, 10).map(item => <div className="record-row" key={item.id}>
          <TicketStatus ticket={item} /><a href={routeFor(item.work.project, 'work', item.id)}>{item.title}</a><time>{date(item.updatedAt)}</time>
        </div>) : <p className="muted-text">暂无匹配任务</p>}</Section>
      </div>
        : data.error ? <Failure error={data.error} retry={() => void data.refetch()} />
        : !data.data || data.data.project !== project.id ? (data.data ? <Empty title="请选择当前项目的工单" /> : <Loading />)
        : <TicketDetail key={data.data.id} {...props} ticket={data.data} tab={tab} />}
    </div>
  </div>;
}

function TaskBranch({ branch, home, current }: { branch: Branch<TicketRow>; home: PageProps['project']; current?: string }) {
  const { item, children } = branch;
  const containsCurrent = (node: Branch<TicketRow>): boolean => node.item.id === current || node.children.some(containsCurrent);
  const [expanded, setExpanded] = useStored('task-tree:' + item.id, false);
  const open = expanded || children.some(containsCurrent);
  return <div className="task-tree-branch">
    <a className="list-item" href={routeFor(home.id, 'work', item.id)} aria-current={current === item.id ? 'page' : undefined}>
      <div className="list-item-top"><strong>{item.title}</strong><time>{date(item.updatedAt)}</time></div>
      <div className="list-item-meta"><Source channel={item.work.source} /><TicketStatus ticket={item} /><span>{topicName(home, item.work.topic) ?? '项目工单'}</span></div>
    </a>
    {children.length > 0 && <div className="task-tree-children">
      <button type="button" className="task-tree-trigger" aria-expanded={open} onClick={() => setExpanded(!open)}
        disabled={children.some(containsCurrent)}><ChevronRight size={14} className={open ? 'tree-open' : undefined} />{children.length} 张子工单</button>
      {open && children.map(child => <TaskBranch key={child.item.id} branch={child} home={home} current={current} />)}
    </div>}
  </div>;
}

function TicketDetail(props: PageProps & { ticket: Ticket; tab: WorkTab }) {
  const { ticket, tab, workspace, project, route } = props;
  const [side, setSide] = useState(() => window.matchMedia('(min-width: 1280px)').matches);
  const [dialog, setDialog] = useState('');
  const { busy, run } = useActions();
  const agent = workspace.agents.find(a => a.id === ticket.work.agent);
  const topic = project.topics.find(item => item.id === ticket.work.topic);
  const discussion = topic
    ? { name: topic.title, href: routeFor(project.id, 'chat', topic.id) }
    : !ticket.work.topic ? { name: '项目讨论', href: routeFor(project.id, 'chat', undefined, 'project') } : undefined;
  const decision = workspace.needsYou.find(d => d.ticket === ticket.id && (d.kind === 'development' || d.kind === 'development-returned'));
  const routedDecision = workspace.needsYou.find(d => d.ticket === ticket.id && d.id === route.decision);
  const detailRef = useRef<HTMLDivElement>(null);
  const focus = routedDecision && (routedDecision.kind === 'answer' ? 'answer-' + routedDecision.card
    : routedDecision.kind === 'access' ? 'access-' + routedDecision.subject
    : routedDecision.kind === 'acceptance' ? 'acceptance'
    : routedDecision.kind === 'delivery' ? 'delivery-evidence'
    : routedDecision.kind.startsWith('development') ? 'development' : 'recovery');
  useLayoutEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() => {
      const target = Array.from(detailRef.current?.querySelectorAll<HTMLElement>('[data-decision-focus]') ?? [])
        .find(node => node.dataset.decisionFocus === focus);
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, tab]);
  const status = ticket.work.handoff && !ticket.work.handoff.completedAt && !ticket.work.handoff.cancelledAt;
  const agentChoices = workspace.agents.filter(a => a.active && a.projects.includes(project.id)
    && (!ticket.work.personal || a.kind === 'personal' && a.owner === ticket.work.requester)
    && (!ticket.work.development || project.deliveryTargets.some(ref => ref.externalId === ticket.work.development!.repository
      && ref.eligibleAgents.includes(a.id))));
  const handoffChoices = agentChoices.filter(a => a.id !== ticket.work.agent && a.engine !== 'octop' && agent?.engine !== 'octop');
  const actions = ticket.actions;
  const detailLink = (page: WorkTab) => workFromInbox(
    withConversationOrigin(routeFor(project.id, 'work', ticket.id, page), route.conversationOrigin),
    route.inboxOrigin, route.decision, route.reviewRevision);
  const memberName = (id: string) => project.members.find(item => item.name === id)?.displayName ?? id;
  const deviceWaiting = !!ticket.device && !ticket.device.online && !ticket.endReason;
  const recoveryNext = ticket.recovery?.next;
  const waitingOnRecovery = !!recoveryNext && (recoveryNext.startsWith('wait-') || recoveryNext === 'restore-old-runner');
  const canResume = actions.resume && !status && !waitingOnRecovery && (deviceWaiting || ticket.materialHidden || ticket.report?.state === 'blocked' || ticket.report?.state === 'failed'
    || ticket.requests.some(r => r.state === 'revoked' || r.state === 'expired') || ticket.stage.stage === 'idle');
  const maySwitch = tab === 'execution' && actions.resume && !!agent && !ticket.endReason && !status && !ticket.materialHidden
    && !!ticket.currentRun && ['queued', 'claimed', 'unknown'].includes(ticket.currentRun.state)
    && !ticket.questions.length && !['access', 'source-changed', 'development', 'answer', 'receipt-pending'].includes(ticket.recovery?.kind ?? '');
  const targets = useExecutionTargets(maySwitch ? project.id : undefined);
  const canSwitch = maySwitch && (eligibleExecutionDevices(targets.devices.data, agent).some(device => device.id !== ticket.device?.id)
    || !!ticket.device && agent.executionCapabilities.local);
  const canHandoff = actions.handoff && recoveryNext !== 'wait-receipt' && !!handoffChoices.length;
  const historicalRevision = route.revision ?? (route.reviewRevision !== ticket.result?.revision ? route.reviewRevision : undefined);
  const viewedVersion = tab === 'delivery' && historicalRevision
    ? ticket.versions.find(version => version.revision === historicalRevision) : undefined;
  const versionAccepted = viewedVersion?.reviews.some(review => review.kind === 'accepted');
  const versionAgent = viewedVersion && ticket.runs.find(run => run.id === viewedVersion.run)?.attribution?.agent;
  const send = (action: string, data: unknown, message: string) => run(() => api('ticket/' + ticket.id + '/' + action, data), message);
  const upcoming = ticket.work.version ?? 1;
  const executionActions = (canResume || canHandoff || canSwitch || actions.stop) && <div className="actions context-actions">
    {canResume && <Button variant="outline" size="sm" onClick={() => setDialog('resume')}>{ticket.materialHidden ? '重新申请查阅' : '接续执行'}</Button>}
    {canSwitch && <Button variant="outline" size="sm" onClick={() => setDialog('switch')}>切换执行端</Button>}
    {canHandoff && <Button variant="outline" size="sm" onClick={() => setDialog('handoff')}>交接 Agent</Button>}
    {actions.stop && <Button variant="ghost" size="sm" onClick={() => setDialog('stop')}>停止工单</Button>}
  </div>;
  return <div className="ticket-shell" ref={detailRef}>
    <div className="ticket-top">
      <div className="ticket-title-line">
        <h1>{ticket.title}</h1>
        <div className="ticket-top-actions">
          <IconButton label={side ? '隐藏工单属性' : '显示工单属性'} aria-expanded={side} onClick={() => setSide(!side)}>
            {side ? <PanelRightClose /> : <PanelRightOpen />}</IconButton>
          {project.mayStart && <IconButton label="新建子工单" onClick={() => props.openTask({ parent: ticket.id, topic: ticket.work.topic })}><Plus /></IconButton>}
        </div>
      </div>
      {route.decision && !routedDecision && <span className="ticket-decision-state" role="status">这项待办已处理或已更新</span>}
      <div className="ticket-head-meta">{viewedVersion ? <>
        <Pill tone={versionAccepted ? 'green' : 'neutral'}>{versionAccepted ? '已验收'
          : viewedVersion.reviews.some(review => review.kind === 'withdrawn') ? '交付前撤回' : viewedVersion.reviews.some(review => review.kind === 'rejected') ? '已打回' : '未验收'}</Pill>
        <Version version={viewedVersion.version} />
      </> : <><TicketStatus ticket={ticket} /><Version version={ticket.work.version} /></>}
        <code title={ticket.id}>{short(ticket.id)}</code>
        <Source channel={ticket.work.source} />
        {discussion && <a className="ticket-discussion" href={discussion.href} aria-label={'返回讨论 ' + discussion.name}>
          <MessageSquare size={14} aria-hidden="true" /><span>{discussion.name}</span>
        </a>}
        <span>{versionAgent ? workspace.agents.find(item => item.id === versionAgent)?.title ?? versionAgent : agent?.title ?? ticket.work.agent}</span>
        {!viewedVersion && ticket.device && <span>{ticket.device.name}{ticket.device.state === 'retired' ? ' · 已退役'
          : ticket.device.state === 'lost' ? ' · 已丢失' : ticket.device.state === 'suspended' ? ' · 已暂停'
            : ticket.device.claimsPaused ? ' · 暂不接单' : deviceWaiting ? ' · 离线' : ''}</span>}</div>
    </div>
    <div className="ticket-frame" data-inspector={side}>
      <PageTabs value={tab} onChange={value => { window.location.hash = detailLink(value); }} items={workTabs} label="工单详情">
        <TabsContent className="ticket-tab" value="activity">
          {ticket.recovery && <div className="decision-focus" data-decision-focus="recovery" tabIndex={-1}><TicketRecovery {...props} ticket={ticket} /></div>}
          {status && !ticket.recovery && <div className="info-callout"><History size={17} /><span>正在确认旧执行停止及接续权限。{ticket.report?.summary}</span></div>}
          {deviceWaiting && !status && !ticket.recovery && <div className="info-callout"><Bot size={17} />{ticket.device?.name}
            {ticket.device?.claimsPaused ? ' 暂不接单，请核对执行端。' : ' 当前离线，等待连接或确认接续。'}</div>}
          {decision && <section className="decision-box decision-focus" data-decision-focus="development" tabIndex={-1}>
            <span className="decision-mark"><ShieldCheck size={18} /></span><div>
              <h2>{decision.title}</h2>{decision.detail && <p>{decision.detail}</p>}
              <div className="actions">
                {decision.kind === 'development' ? <>
                  <Button size="sm" type="button" disabled={busy} onClick={() => void send('approve-development', { offer: decision.id }, '已确认接单')}>接单</Button>
                  <Button size="sm" type="button" variant="outline" onClick={() => setDialog('respond')}>拒接或退回</Button>
                </> : <Button size="sm" type="button" onClick={() => setDialog('reoffer')}>重新安排</Button>}
              </div>
            </div>
          </section>}
          {ticket.questions.length > 0 && <section className="question-stack" aria-label="待答问题">
            {ticket.questions.map(question => <Question ticket={ticket.id} key={question.id} question={question} />)}
          </section>}
          {executionActions}
          {actions.accept && <div className="ticket-next-action">
            <span><FileCheck2 size={17} />第 {upcoming} 版待你验收</span><a className="text-button" href={detailLink('delivery')}>核对本版成果 <ArrowRight size={14} /></a>
          </div>}
          <Conversation {...props} ticket={ticket} topic={ticket.work.topic} />
          <TicketOutcomes {...props} ticket={ticket} />
          {ticket.report && !ticket.result && !ticket.questions.length && !status && <div className="info-callout"><Bot size={17} /><span>{ticket.report.summary}</span></div>}
        </TabsContent>
        <TabsContent className="ticket-tab" value="execution">
          <RunHistory {...props} ticket={ticket} actions={<><TicketRecovery {...props} ticket={ticket} />{executionActions}</>} />
        </TabsContent>
        <TabsContent className="ticket-tab" value="delivery">{historicalRevision
          ? <DeliveryVersion {...props} ticket={ticket} revision={historicalRevision} />
          : <Delivery {...props} ticket={ticket} />}</TabsContent>
        <TabsContent className="ticket-tab" value="context"><ContextPanel {...props} ticket={ticket} /></TabsContent>
      </PageTabs>
      {side && <aside className="inspector" aria-label="工单属性">
        <h2>工单属性</h2>
        <dl className="facts">
          <dt>状态</dt><dd><TicketStatus ticket={ticket} /></dd>
          <dt>当前版本</dt><dd><Version version={ticket.work.version ?? 1} /></dd>
          <dt>项目</dt><dd><a href={routeFor(project.id, 'project')}>{project.title}</a></dd>
          <dt>主题</dt><dd>{discussion ? <a href={discussion.href}>{discussion.name}</a> : ticket.topicTitle ?? '未归入主题'}</dd>
          <dt>发起人</dt><dd>{memberName(ticket.work.requester)}</dd>
          <dt>负责 Agent</dt><dd>{agent?.title ?? ticket.work.agent}</dd>
          {agent?.owner && <><dt>Agent 所有者</dt><dd>{memberName(agent.owner)}</dd></>}
          {!!ticket.recovery?.owners.length && <><dt>待处理人</dt><dd>{ticket.recovery.owners.map(memberName).join('、')}</dd></>}
          <dt>优先级</dt><dd>{ticket.work.priority === 'urgent' ? '紧急' : '普通'}</dd>
        </dl>
        {tab !== 'context' && <a className="inspector-link" href={detailLink('context')}><LockKeyhole size={16} /><span>引用与授权</span><ChevronRight size={15} /></a>}
        {tab !== 'delivery' && <a className="inspector-link" href={detailLink('delivery')}><FileCheck2 size={16} /><span>查看验收依据</span><ChevronRight size={15} /></a>}
        {ticket.candidate && <a className="inspector-link" href={routeFor(project.id, 'knowledge', ticket.candidate, ticket.candidateTab)}>
          <FileCheck2 size={16} /><span>{ticket.candidateTab === 'review' ? '核对知识候选' : '查看关联知识'}</span><ChevronRight size={15} /></a>}
        {ticket.work.parent && <a className="inspector-link" href={routeFor(project.id, 'work', ticket.work.parent)}><Link2 size={16} /><span>上游工单</span></a>}
      </aside>}
    </div>
    {dialog && <TicketCommand {...props} name={dialog} agentChoices={dialog === 'handoff' ? handoffChoices : agentChoices}
      close={() => setDialog('')} nextVersion={upcoming} />}
  </div>;
}

function TicketOutcomes({ ticket, project }: PageProps & { ticket: Ticket }) {
  if (!ticket.discussionNotes.length && !ticket.result && !ticket.materialHidden) return null;
  return <div className="timeline">
    {ticket.discussionNotes.map(item => <article className="timeline-entry" key={item.id}>
      <Avatar value="群" kind="agent" /><div className="message">
        <div className="message-meta"><strong>群反馈整理</strong><Source channel="feishu" /></div>
        <p><strong>{item.title}</strong> {item.reason}</p>
        <div className="actions">{item.evidence.filter(e => e.url).map((e, index) => <Ext key={index} href={e.url}>{e.title}</Ext>)}</div>
      </div>
    </article>)}
    {ticket.result && <article className="timeline-entry">
      <Avatar value="AI" kind="agent" /><div className="message result-message">
        <div className="message-meta"><strong>{ticket.work.consultation ? '咨询回复' : 'Agent 交付'}</strong><Version version={ticket.result.version} /><time>{date(ticket.result.at)}</time></div>
        <Markdown text={ticket.result.text} />
        {ticket.channelReturn && <ChannelReceipt receipt={ticket.channelReturn} />}
        <a className="text-button" href={routeFor(project.id, 'work', ticket.id, 'delivery')}>查看交付与验收<ArrowRight size={15} /></a>
      </div>
    </article>}
    {ticket.materialHidden && <div className="info-callout"><LockKeyhole size={16} />当前成果的资料授权已收回。</div>}
  </div>;
}

function Question({ ticket, question }: { ticket: string; question: Ticket['questions'][number] }) {
  const [text, setText] = useStored('answer:' + ticket + ':' + question.id, '');
  const { busy, run } = useActions();
  async function answer(choice?: number) {
    const response = await run(() => api('ticket/' + ticket + '/answer', { card: question.id, nonce: uid(),
      ...(choice === undefined ? { text: text.trim() } : { choice }) }), '答复已提交');
    if (response) setText('');
  }
  return <article className="decision-box decision-focus" data-decision-focus={'answer-' + question.id} tabIndex={-1}>
    <span className="decision-mark"><Bot size={19} /></span><div>
      <h2>{question.title}</h2><p>{question.text}</p>
      {question.options.length > 0 && <div className="actions">
        {question.options.map((value, i) => <Button key={i} size="sm" type="button" variant="outline" disabled={busy} onClick={() => void answer(i)}>{value}</Button>)}
      </div>}
      <form className="reply-form" onSubmit={event => { event.preventDefault(); void answer(); }}>
        <Input aria-label={'答复：' + question.title} placeholder="补充答复" value={text} onChange={e => setText(e.target.value)} maxLength={3500} />
        <Button size="sm" type="submit" disabled={busy || !text.trim()}>答复</Button>
      </form>
    </div>
  </article>;
}

function TicketCommand({ name, ticket, close, project, workspace, nextVersion, agentChoices }: PageProps & {
  name: string; ticket: Ticket; close: () => void; nextVersion: number; agentChoices: PageProps['workspace']['agents'];
}) {
  const { busy, run } = useActions();
  const [agent, setAgent] = useState('');
  const [device, setDevice] = useState('');
  const [nonce] = useState(uid);
  const changesDevice = name === 'switch' || name === 'resume';
  const targetAgent = name === 'handoff' ? agentChoices.find(item => item.id === agent)
    : changesDevice && !ticket.materialHidden && !ticket.endReason ? workspace.agents.find(item => item.id === ticket.work.agent) : undefined;
  const targets = useExecutionTargets(targetAgent ? project.id : undefined);
  const validDevice = device === 'workbench' ? !!targetAgent?.executionCapabilities.local && !!ticket.device
    : !!eligibleExecutionDevices(targets.devices.data, targetAgent).find(item => item.id === device && (name !== 'switch' || item.id !== ticket.device?.id));
  const offer = workspace.needsYou.find(d => d.ticket === ticket.id && d.kind === (name === 'respond' ? 'development' : 'development-returned'));
  const settings: Record<string, [string, string]> = {
    respond: ['处理研发委托', '确认提交'], reoffer: ['重新安排研发', '重新发出委托'], stop: ['停止工单', '停止工单'],
    resume: [ticket.materialHidden ? '重新申请查阅' : '接续原工单', '确认接续'], handoff: ['交接 Agent', '发起交接'],
    switch: ['切换执行端', '提交切换'],
  };
  const [title, submit] = settings[name]!;
  return <Modal title={title} close={close}><form className="form" onSubmit={async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const reason = String(form.get('reason') ?? '').trim();
    const resumePayload = { version: nextVersion, nonce, reason, baseSha: form.get('baseSha') || undefined,
      device: device === 'workbench' ? null : device || undefined };
    const commands: Record<string, [string, unknown]> = {
      stop: ['stop', {}], handoff: ['handoff', { agent, reason, device: device || undefined }],
      resume: ['resume', resumePayload], switch: ['resume', resumePayload],
      respond: ['respond-development', { offer: offer?.id, response: form.get('response'), reason }],
      reoffer: ['reoffer-development', { offer: offer?.subject, agent, reason }],
    };
    const [action, payload] = commands[name]!;
    if (await run(() => api('ticket/' + ticket.id + '/' + action, payload), '操作已提交')) close();
  }}>
    {name === 'stop' && <p>停止将结束本次委托。已记录的执行、提交与验收证据会保留。</p>}
    {name === 'handoff' && <p>工作台会先等待旧执行退出，再请新执行人确认所需资料。</p>}
    {name === 'switch' && <p>当前执行端为 {ticket.device?.name ?? '工作台运行时'}。收到旧执行的停止回执并核对权限后，才会接续原工单。</p>}
    {['handoff','reoffer'].includes(name) && <Field label="接续 Agent"><select name="agent" required value={agent} onChange={event => {
      setAgent(event.target.value); setDevice('');
    }}><AgentOptions agents={agentChoices} /></select></Field>}
    {targetAgent && <ExecutionTargetPicker project={project.id} agent={targetAgent} targets={targets} value={device} onChange={setDevice}
      mode={name === 'switch' ? 'switch' : name === 'resume' ? 'resume' : 'start'} current={ticket.device} />}
    {name === 'respond' && <Field label="处理方式"><select name="response"><option value="return">退回给负责人</option><option value="decline">拒接</option></select></Field>}
    {name !== 'stop' && <Field label="原因"><TextArea name="reason" rows={4} maxLength={3500} required /></Field>}
    {name === 'resume' && ticket.actions.baseline && !ticket.materialHidden && <Field label="新 Git 基线（选填）"><Input name="baseSha" pattern="[a-f0-9]{40}" maxLength={40} /></Field>}
    <div className="form-actions"><Button type="submit" variant={name === 'stop' ? 'destructive' : 'default'}
      disabled={busy || (name === 'switch' || !!device) && !validDevice}>{submit}</Button></div>
  </form></Modal>;
}

function Delivery(props: PageProps & { ticket: Ticket }) {
  const { ticket, project, workspace } = props;
  const { run, busy } = useActions();
  const [action, setAction] = useState('');
  const result = ticket.result;
  const delivery = ticket.work.delivery;
  const accepted = ticket.work.accepted;
  const [acceptDraft, saveDraft] = useStored('accept:' + ticket.id + ':' + result?.revision, { body: '', conditions: '' });
  const scope = ticket.work.development;
  const ci = delivery?.ci;
  const deployment = delivery?.deployed;
  const gate = ticket.deploymentGate;
  return <div className="detail-stack">
    {ticket.stages && <StageChecks project={project.id} ticket={ticket.id} report={ticket.stages} />}
    <Section title="当前成果" action={<Version version={ticket.work.version} />}>
      {ticket.materialHidden ? <div className="info-callout"><LockKeyhole size={16} />
        <span>{ticket.requests.some(r => r.state === 'revoked') ? '资料授权已收回。' : '此成果当前受限。'}{accepted ? '验收记录仍可查阅。' : ''}</span></div>
        : result ? <><Markdown text={result.text} /><div className="inline-meta">成果修订 <code>{short(result.revision, 12)}</code>
          <span>已装配 {result.sources.length} 份资料</span><span>成果引用 {result.cited?.length ?? 0} 条记忆</span></div></>
        : <p className="muted-text">尚未提交本版成果。</p>}
      {accepted && <div className="acceptance-line"><CircleCheck size={17} /><span>{accepted.actor} 已验收 · {date(accepted.at, true)}</span>
        {accepted.commit && <code>{short(accepted.commit, 12)}</code>}</div>}
      {ticket.channelReturn && <ChannelReceipt receipt={ticket.channelReturn} />}
      {ticket.candidate && <a className="text-button" href={routeFor(project.id, 'knowledge', ticket.candidate, ticket.candidateTab)}>
        {ticket.candidateTab === 'review' ? '查看知识候选' : '查看关联知识'} <ArrowRight size={15} /></a>}
    </Section>
    {!!result?.citations.length && <Section title="引用依据">
      {result.citations.map(citation => <article className="revision-note" key={citation.id + ':' + citation.revision}>
        <strong>{citation.title}</strong>
        {citation.acceptedSource && <AcceptedEvidence source={citation.acceptedSource} project={project.id} />}
      </article>)}
    </Section>}
    {(scope || delivery || ticket.mayLinkDelivery || ticket.githubIssues.length > 0 || ticket.work.branches?.length) && <div className="decision-focus" data-decision-focus="delivery-evidence" tabIndex={-1}><Section title="GitHub 交付"
      action={ticket.mayLinkDelivery ? <Button variant="outline" size="sm" onClick={() => setAction('pull')}><GitPullRequest />{delivery ? '更新 PR 关联' : '关联 PR'}</Button> : undefined}>
      {scope && <dl className="facts">
        <dt>委托仓库</dt><dd>{scope.repository}</dd><dt>基线分支</dt><dd>{scope.base}</dd><dt>获准路径</dt><dd>{scope.paths.join('、')}</dd>
      </dl>}
      {delivery && <div className="delivery-summary">
        <Ext href={delivery.url}><GitPullRequest size={16} />PR #{delivery.pr}</Ext><code title={delivery.headSha}>{short(delivery.headSha, 12)}</code>
        {delivery.state && <span>{pullStates[delivery.state]}</span>}
        {ci && <Pill tone={ci === 'passed' ? 'green' : ci === 'failed' ? 'red' : 'amber'}>{({ passed: 'CI 通过', pending: 'CI 待完成', failed: 'CI 失败' })[ci]}</Pill>}
      </div>}
      {!ticket.deliveryVerification && !!delivery?.checks?.length && <div className="record-row">{delivery.checks.map(check =>
        <Ext key={check.id} href={check.html_url ?? undefined}>CI · {check.name}</Ext>)}</div>}
      {result && ticket.deliveryVerification && <DeliveryVerification ticket={ticket.id} revision={result.revision} verification={ticket.deliveryVerification} />}
      {gate && <div className="record-row">
        <span>部署 · {gate.environment}</span>
        {deployment && <><span>部署 #{deployment.id}</span><code title={deployment.sha}>{short(deployment.sha, 12)}</code></>}
        <Pill tone={gate.selection ? 'green' : ticket.deliveryStatus?.state === 'deployment-failed' ? 'red' : 'amber'}>
          {gate.selection ? '部署通过' : ticket.deliveryStatus?.state === 'deployment-failed' ? '部署失败' : '待核对部署'}
        </Pill>
        {gate.selection && deployment?.status?.environment_url && <Ext href={deployment.status.environment_url}>打开部署</Ext>}
      </div>}
      {ticket.deliveryStatus && <p className="muted-text">{ticket.deliveryStatus.detail}</p>}
      {ticket.githubIssues.map(issue => <div className="record-row" key={issue.html_url}>
        <Ext href={issue.html_url}>Issue #{issue.number}</Ext><span>{issue.state === 'open' ? '开启' : '已关闭'}</span>
        {!!issue.labels.length && <span>{issue.labels.map(l => l.name).join('、')}</span>}
        {issue.milestone && <span>里程碑 {issue.milestone.title}</span>}
        {!!issue.assignees.length && <small>指派 {issue.assignees.map(a => a.login).join('、')}</small>}
      </div>)}
      {ticket.deliveryVersions.length > 0 && <details className="minor-disclosure"><summary>PR 与提交记录</summary>
        {ticket.deliveryVersions.map(item => <div className="revision-note" key={item.repository + ':' + item.pr + ':' + item.baseSha + ':' + item.headSha}>
          <Ext href={item.url}>PR #{item.pr}</Ext> <code>{short(item.baseSha)} → {short(item.headSha)}</code>
          <span className="muted-text"> · {pullStates[item.state ?? ''] ?? '状态待核对'}</span>
          <div className="record-row">
            {item.creator && <span>发起 {githubActor(item.creator)}</span>}
            {item.headBranch && <code>{item.headBranch}</code>}
            {item.baseBranch && <span>目标 {item.baseBranch}</span>}
            {item.mergedBy && <span>合并 {githubActor(item.mergedBy)}</span>}
          </div>
          {(!!item.labels?.length || !!item.assignees?.length || item.milestone || !!item.requestedReviewers?.length) && <div className="record-row">
            {!!item.labels?.length && <span>标签 {item.labels.map(label => label.name).join('、')}</span>}
            {item.milestone && <span>里程碑 {item.milestone.title}</span>}
            {!!item.assignees?.length && <span>指派 {item.assignees.map(githubActor).join('、')}</span>}
            {!!item.requestedReviewers?.length && <span>待审 {item.requestedReviewers.map(githubActor).join('、')}</span>}
          </div>}
          {item.reviews?.map(review => <div className="record-row" key={review.id}>
            <Ext href={review.html_url}>审查 {githubActor(review.user)}</Ext>
            <span>{reviewStates[review.state] ?? review.state}</span>
            {review.commit_id && <code>{short(review.commit_id, 12)}</code>}
            {review.submitted_at && <time>{date(review.submitted_at)}</time>}
          </div>)}
          {item.commits?.map(c => <div className="record-row" key={c.sha}><code>{short(c.sha, 12)}</code>
            <span>作者 {githubActor(c.author)}</span><span>提交者 {githubActor(c.committer)}</span>
            <span>推送 {githubActor(c.push?.actor)}</span>
            {c.run && <span>委托 {c.run.actor.delegatedBy} · 执行 {workspace.agents.find(a => a.id === c.run?.actor.agent)?.title ?? c.run.actor.agent}（{c.run.actor.owner}）</span>}
            {c.checkpoint && <span>Entire <code>{short(c.checkpoint, 12)}</code></span>}
          </div>)}
        </div>)}
      </details>}
      {ticket.ciAttempts.length > 0 && <details className="minor-disclosure"><summary>CI 运行记录 · {ticket.ciAttempts.length}</summary>
        {ticket.ciAttempts.map(c => <div className="record-row" key={c.repoId + ':' + c.pr + ':' + c.id}><Ext href={c.html_url ?? undefined}>{c.name} #{c.id}</Ext>
          <span>PR #{c.pr}</span><code>{short(c.head_sha, 12)}</code>
          <span>{({ success: '成功', failure: '失败', cancelled: '已取消', timed_out: '超时', skipped: '已跳过' } as Record<string,string>)[c.conclusion ?? '']
            ?? (c.status === 'completed' ? c.conclusion ?? '已结束' : '等待结果')}</span>
          {c.completed_at && <time>{date(c.completed_at)}</time>}
        </div>)}
      </details>}
      {ticket.work.branches?.map(branch => <div className="record-row" key={branch.repoId + branch.name + branch.sha}>
        <GitBranch size={15} /><Ext href={'https://github.com/' + branch.repository + '/tree/' + branch.name.split('/').map(encodeURIComponent).join('/')}>{branch.name}</Ext>
        <code>{short(branch.sha, 12)}</code><small>{branch.push?.actor?.login}</small>
      </div>)}
      {ticket.mayLinkDelivery && <Button variant="ghost" size="sm" onClick={() => setAction('branch')}><GitBranch />关联分支</Button>}
    </Section></div>}
    {ticket.reusedAcceptance && <Section title="本版沿用的验收知识">
      <a href={routeFor(project.id, 'knowledge', ticket.reusedAcceptance.id, 'current')}>{ticket.reusedAcceptance.title}</a>
      {ticket.reusedAcceptance.source && <AcceptedEvidence source={ticket.reusedAcceptance.source} project={project.id} />}
    </Section>}
    {result && ticket.productVerification && <ProductVerificationPanel key={result.revision} ticket={ticket.id}
      revision={result.revision} verification={ticket.productVerification} />}
    {result && !accepted && (ticket.actions.accept || ticket.actions.revise || ticket.work.requester === workspace.actor) && <div className="decision-focus" data-decision-focus="acceptance" tabIndex={-1}><Section title="本版验收">
      {ticket.actions.accept ? <form className="form" onSubmit={async e => {
        e.preventDefault();
        await run(() => api('ticket/' + ticket.id + '/accept', { revision: result.revision, commit: delivery?.headSha,
          deployment: gate?.selection,
          body: acceptDraft.body.trim(), conditions: acceptDraft.conditions.trim() }), '已验收此版本');
      }}>
        {gate?.selection && <div className="record-row"><span>验收环境 {gate.environment}</span>
          <span>部署 #{gate.selection.id} · 状态 #{gate.selection.statusId}</span></div>}
        <details className="form-disclosure"><summary>填写可复用结论（选填）</summary>
          <Field label="结论"><TextArea rows={3} maxLength={16000} value={acceptDraft.body} onChange={e => saveDraft({ ...acceptDraft, body: e.target.value })} /></Field>
          {acceptDraft.body.trim() && <Field label="适用条件"><Input maxLength={600} required value={acceptDraft.conditions}
            onChange={e => saveDraft({ ...acceptDraft, conditions: e.target.value })} /></Field>}
        </details>
        <div className="actions"><Button type="submit" disabled={busy}><Check />验收第 {result.version ?? 1} 版</Button>
          {ticket.actions.revise && <Button type="button" variant="outline" onClick={() => setAction('revision')}>打回修改</Button>}</div>
      </form> : <div className="actions"><span className="muted-text">{ticket.deliveryStatus?.state === 'ready' || !ticket.deliveryStatus
        ? '等待本版需求验收条件通过。' : ticket.deliveryStatus.detail}</span>
        {ticket.actions.revise && <Button variant="outline" size="sm" onClick={() => setAction('revision')}>打回修改</Button>}</div>}
    </Section></div>}
    {accepted && ticket.actions.revise && <Button variant="outline" className="self-start" onClick={() => setAction('revision')}>
      {props.route.consultation ? '确认咨询对应的改动范围' : '在原单开启下一版'} <ArrowRight /></Button>}
    {ticket.actions.retryUnpublished && result && <Button size="sm" variant="outline" className="self-start" onClick={() => setAction('retry-unpublished')}>
      修正未推送的代码成果</Button>}
    {ticket.versions.length > 0 && <Section title="版本历史">
      {ticket.versions.slice().reverse().map(version => <details className="version-record" key={version.revision}>
        <summary><Version version={version.version} /><code>{short(version.revision, 12)}</code><time>{date(version.at)}</time>
          {version.reviews.some(r => r.kind === 'accepted') && <Pill tone="green">已验收</Pill>}</summary>
        <VersionBody version={version} project={project.id} />
      </details>)}
    </Section>}
    {ticket.work.measure && <ObservationPane {...props} ticket={ticket} />}
    {(action === 'pull' || action === 'branch') && <Modal title={action === 'pull' ? '关联 GitHub PR' : '关联 GitHub 分支'} close={() => setAction('')}>
      <form className="form" onSubmit={async e => {
        e.preventDefault();
        const url = new FormData(e.currentTarget).get('url');
        if (await run(() => api('ticket/' + ticket.id + '/' + (action === 'pull' ? 'delivery' : 'branch'), { url }), '已关联 GitHub 记录')) setAction('');
      }}><Field label="GitHub 链接"><Input name="url" type="url" required placeholder="https://github.com/…" /></Field>
        <div className="form-actions"><Button type="submit" disabled={busy}>关联</Button></div></form>
    </Modal>}
    {action === 'revision' && result && <Revise ticket={ticket} project={project} consultation={props.route.consultation} close={() => setAction('')} />}
    {action === 'retry-unpublished' && result && <Modal title="修正未推送的代码成果" close={() => setAction('')}>
      <form className="form" onSubmit={async event => {
        event.preventDefault();
        const reason = new FormData(event.currentTarget).get('reason');
        if (await run(() => api('ticket/' + ticket.id + '/retry-local-code', { revision: result.revision, reason }), '已接续原工单')) {
          setAction(''); go(project.id, 'work', ticket.id, 'activity');
        }
      }}><p>将重新核对原 PR 和 Git 基线，保留本版撤回记录，并在原工单接续。</p>
        <Field label="修正原因"><TextArea name="reason" rows={3} required maxLength={3500} /></Field>
        <div className="form-actions"><Button disabled={busy} type="submit">确认接续</Button></div>
      </form>
    </Modal>}
  </div>;
}

function DeliveryVersion({ ticket, project, route, revision }: PageProps & { ticket: Ticket; revision: string }) {
  const version = ticket.versions.find(item => item.revision === revision);
  const stages = version?.reviews.findLast(review => review.stages)?.stages;
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    panel.current?.scrollIntoView({ block: 'start' });
    panel.current?.focus({ preventScroll: true });
  }, [revision]);
  const back = <a className="text-button" href={workFromInbox(
    withConversationOrigin(routeFor(project.id, 'work', ticket.id, 'delivery'), route.conversationOrigin), route.inboxOrigin)}>
    <ArrowLeft size={15} />返回交付</a>;
  return <div ref={panel} tabIndex={-1} className="detail-stack">
    {version ? <Section title={'第 ' + version.version + ' 版成果'} action={back}>
      <div className="inline-meta">成果修订 <code title={version.revision}>{short(version.revision, 12)}</code><time>{date(version.at)}</time></div>
      <VersionBody version={version} project={project.id} />
      {stages && <StageChecks project={project.id} report={stages} />}
    </Section> : <Empty title="找不到指定的交付版本" action={back} />}
  </div>;
}

function VersionBody({ version, project }: { version: Ticket['versions'][number]; project: string }) {
  return <>
    {version.text !== undefined ? <Markdown text={version.text} /> : <p className="muted-text">此版本正文当前受限。</p>}
    {version.reviews.map(review => <div key={review.kind + review.at}>
      <div className="record-row">
        <strong>{({ accepted: '验收', rejected: '打回', continued: '开启下一版', withdrawn: '交付前撤回', rechecked: '重新核对' })[review.kind]}</strong><span>{review.actor}</span>
        <time>{date(review.at)}</time>{review.reason && <span>{review.reason}</span>}
      </div>
      {review.product && <details className="minor-disclosure"><summary>本版验收检查</summary><ProductChecks verification={review.product} /></details>}
    </div>)}
    {version.acceptedSource && <AcceptedEvidence source={version.acceptedSource} project={project} linkVersion={false} />}
  </>;
}

function Revise({ ticket, project, consultation, close }: { ticket: Ticket; project: PageProps['project'];
  consultation?: PageProps['route']['consultation']; close: () => void }) {
  const catalog = useData<Knowledge[]>('knowledge/' + project.id);
  const [selected, select] = useState<string[] | undefined>();
  const [productCases, setProductCases] = useState<{ title: string; expectation: string }[]>();
  const { busy, run } = useActions();
  return <Modal title={ticket.work.accepted ? '开启原单下一版' : '打回修改'} close={close}>
    <form className="form" onSubmit={async e => {
      e.preventDefault();
      const reason = String(new FormData(e.currentTarget).get('reason') ?? '').trim();
      if (await run(() => api('ticket/' + ticket.id + '/revise', { revision: ticket.result?.revision, reason,
        kind: ticket.work.accepted ? 'continued' : 'rejected', ...(selected ? { material: selected } : {}), consultation, productCases }),
      ticket.work.development ? '已开启下一版，等待研发接单' : '已开启下一版')) close();
    }}>
      <Field label="修改要求"><TextArea name="reason" rows={4} required maxLength={3500} /></Field>
      <details className="form-disclosure"><summary>本版资料</summary>
        <p className="muted-text">沿用原单引用的现行版本，可另行选择。</p>
        <MaterialPicker entries={catalog.data ?? []} values={selected ?? ticket.work.material} onChange={select} />
      </details>
      <details className="form-disclosure"><summary>本版人工核对项</summary>
        <CaseEditor value={productCases ?? ticket.productCases.map(({ title, expectation }) => ({ title, expectation }))} onChange={setProductCases} />
      </details>
      <div className="form-actions"><Button type="submit" disabled={busy}>{ticket.work.development ? '确认范围并请研发接单' : '提交下一版'}</Button></div>
    </form>
  </Modal>;
}

function ObservationPane({ ticket, project, workspace }: PageProps & { ticket: Ticket }) {
  const [open, setOpen] = useState(false);
  const { busy, run } = useActions();
  const measure = ticket.work.measure!;
  return <Section title="业务观测" action={ticket.result && ticket.work.accepted && ticket.work.requester === workspace.actor
    ? <Button size="sm" variant="outline" onClick={() => setOpen(true)}>记录实际结果</Button> : undefined}>
    <p>{measure.metric}（{measure.unit}）{measure.baseline !== undefined && ' · 基线 ' + measure.baseline}{measure.target !== undefined && ' · 目标 ' + measure.target}</p>
    {ticket.observations.map(record => <article className="revision-note" key={record.id}>
      <div className="message-meta"><strong>{record.actual} {measure.unit}</strong><time>{date(record.at)}</time></div>
      <p>{record.evidence}</p>
      {record.candidate && <a className="text-button" href={routeFor(project.id, 'knowledge', record.candidate, 'review')}>查看经验 <ArrowRight size={14} /></a>}
    </article>)}
    {open && <Modal title="记录实际结果" close={() => setOpen(false)}><form className="form" onSubmit={async e => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      if (await run(() => api('ticket/' + ticket.id + '/observation', {
        revision: ticket.work.accepted?.revision, nonce: uid(), actual: Number(form.get('actual')), evidence: form.get('evidence'),
        ...(String(form.get('body') ?? '').trim() ? { lesson: { body: form.get('body'), conditions: form.get('conditions') } } : {}),
      }), '观测已保存')) setOpen(false);
    }}>
      <Field label={'实际值（' + measure.unit + '）'}><Input name="actual" type="number" step="any" required /></Field>
      <Field label="观测依据"><TextArea name="evidence" rows={3} maxLength={3500} required /></Field>
      <details className="form-disclosure"><summary>可复用经验（选填）</summary><Field label="经验"><TextArea name="body" rows={3} maxLength={3500} /></Field>
        <Field label="适用条件"><Input name="conditions" maxLength={600} /></Field></details>
      <div className="form-actions"><Button type="submit" disabled={busy}>保存</Button></div>
    </form></Modal>}
  </Section>;
}

function ContextPanel({ ticket, project, workspace }: PageProps & { ticket: Ticket }) {
  const [access, setAccess] = useState<{ request: Ticket['requests'][number]; action: 'request' | 'revoke' }>();
  const { run, busy } = useActions();
  const relatedProjects = new Set([project.id, project.parent, ...project.relatedProjects, ...workspace.projects.filter(p => p.parent === project.id).map(p => p.id)]);
  const [related, setRelated] = useState('');
  const editable = ticket.work.requester === workspace.actor || project.maintain;
  const handoff = ticket.work.handoff;
  const agentTitle = (id: string) => workspace.agents.find(agent => agent.id === id)?.title ?? id;
  return <div className="detail-stack">
    {ticket.work.topic && !ticket.work.consultation && !ticket.work.delegatedVia && <TopicBasis ticket={ticket} />}
    <Section title="资料与授权">
      {(ticket.work.resources ?? []).map(ref => <div className="record-row" key={ref.ref}><Source channel={ref.source} /><Ext href={ref.url}>{ref.label}</Ext>
        {ref.revision && <code>{ref.revision}</code>}</div>)}
      {!ticket.requests.length && !ticket.work.resources?.length && <p className="muted-text">{ticket.work.material.length ? '引用资料已记录在执行快照中。' : '没有单独的资料授权。'}</p>}
      {ticket.requests.map(request => <article className="grant decision-focus" key={request.id} data-decision-focus={'access-' + request.id} tabIndex={-1}>
        <div><strong>{request.title}</strong><p>{request.readerOwner || '原执行者'} · {request.purpose === 'review' ? '仅查阅本版成果' : '仅本工单执行'} · 版本 {short(request.revision)}</p></div>
        <KnowledgeGrantStatus {...request} />
        <div className="actions">
          {request.canGrant && <Button size="sm" disabled={busy}
            onClick={() => void run(() => api('ticket/' + ticket.id + '/access/' + request.id, { state: 'granted', hours: request.hours }), '已授权本工单')}>授权 {request.hours} 小时</Button>}
          {request.canRevoke && <Button size="sm" variant="outline" onClick={() => setAccess({ request, action: 'revoke' })}>撤权</Button>}
          {!ticket.work.accepted && ticket.work.requester === workspace.actor && ['revoked','expired'].includes(request.state)
            && ticket.work.material.includes(request.entry) && !ticket.requests.some(r => r.entry === request.entry && r.generation > request.generation)
            && <Button size="sm" variant="outline" onClick={() => setAccess({ request, action: 'request' })}>重新申请</Button>}
        </div>
      </article>)}
    </Section>
    {handoff && <Section title={handoff.from === handoff.to ? '接续记录' : '交接记录'}>
      <div className="record-row">
        <strong>{agentTitle(handoff.from)}{handoff.from !== handoff.to && ' → ' + agentTitle(handoff.to)}</strong>
        <span>{handoff.by} · {date(handoff.requestedAt)}</span>
        <Pill tone={handoff.completedAt ? 'green' : handoff.cancelledAt ? 'neutral' : 'amber'}>
          {handoff.completedAt ? '已完成' : handoff.cancelledAt ? '已取消' : '确认旧执行与资料授权'}
        </Pill>
        {(handoff.completedAt || handoff.cancelledAt) && <time>{date(handoff.completedAt ?? handoff.cancelledAt!)}</time>}
      </div>
    </Section>}
    {(ticket.children.length > 0 || ticket.related.length > 0 || ticket.work.parent || editable) && <Section title="关联工单">
      {ticket.work.parent && <a className="text-button" href={routeFor(project.id, 'work', ticket.work.parent)}>上游工单 <ArrowRight size={15} /></a>}
      {ticket.children.map(child => <div className="record-row" key={child.id}><span>子工单</span><a href={routeFor(project.id, 'work', child.id)}>{child.title}</a></div>)}
      {ticket.related.map(item => <div className="record-row" key={item.id}><span>关联</span><a href={routeFor(item.project, 'work', item.id)}>{item.title}</a></div>)}
      {editable && <form className="inline-form" onSubmit={async e => {
        e.preventDefault();
        if (await run(() => api('ticket/' + ticket.id + '/related', { ticket: related }), '已关联工单')) setRelated('');
      }}><TicketPicker label="选择有关联的工单" value={related} onChange={setRelated}
        projects={[project, ...workspace.projects.filter(item => item.id !== project.id && relatedProjects.has(item.id))]}
        allow={row => row.id !== ticket.id && !ticket.related.some(item => item.id === row.id)} />
        <Button size="sm" variant="outline" type="submit" disabled={busy || !related}>关联</Button></form>}
    </Section>}
    <Section title="归属">
      <div className="record-row"><span>项目</span><a href={routeFor(project.id, 'project')}>{project.title}</a></div>
      <div className="record-row"><span>主题</span>{editable && project.topics.length ? <select aria-label="工单主题" value={ticket.work.topic ?? ''}
        disabled={busy} onChange={e => void run(() => api('ticket/' + ticket.id + '/topic', { topic: e.target.value || undefined }), '工单主题已更新')}>
        <TopicOptions project={project} empty="未归入主题" />
      </select> : <span>{ticket.topicTitle ?? '未归入主题'}</span>}</div>
    </Section>
    {access && <Modal title={access.action === 'revoke' ? '撤回资料授权' : '重新申请资料'} close={() => setAccess(undefined)}>
      <form className="form" onSubmit={async e => {
        e.preventDefault();
        const reason = new FormData(e.currentTarget).get('reason');
        const response = await run(() => access.action === 'revoke'
          ? api('ticket/' + ticket.id + '/access/' + access.request.id, { state: 'revoked' })
          : api('ticket/' + ticket.id + '/access', { entry: access.request.entry, reason }), access.action === 'revoke' ? '已撤权' : '已提交资料申请');
        if (response) setAccess(undefined);
      }}>
        <strong>{access.request.title}</strong>
        {access.action === 'revoke' ? <p>此授权下的资料正文、执行快照和派生知识会停止返回。</p>
          : <Field label="申请原因"><TextArea name="reason" rows={4} maxLength={3500} required /></Field>}
        <div className="form-actions"><Button type="submit" disabled={busy} variant={access.action === 'revoke' ? 'destructive' : 'default'}>
          {access.action === 'revoke' ? '确认撤权' : '发送申请'}</Button></div>
      </form>
    </Modal>}
  </div>;
}

function TopicBasis({ ticket }: { ticket: Ticket }) {
  const path = 'ticket/' + ticket.id + '/topic-context';
  const data = useData<TicketTopicContext>(path, 5000);
  const { run, busy } = useActions();
  const update = async (row: { id: string; source: 'web' | 'feishu'; revision: string }, confirmed: boolean) => {
    if (await run(() => api(path, { id: row.id, source: row.source, revision: row.revision, confirmed }),
      confirmed ? '已确认主题依据' : '已移除本单确认')) await data.refetch();
  };
  return <Section title="主题依据" action={<a className="text-button" href={routeFor(ticket.project, 'chat', ticket.work.topic)}>主题讨论 <ArrowRight size={15} /></a>}>
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading /> : <>
      {!data.data.basis.length && <p className="muted-text">暂无已确认的主题依据。</p>}
      {data.data.basis.map(row => <div className="revision-note" key={row.source + row.id + row.revision}>
        <div className="inline-meta"><Source channel={row.source} /><span>{row.confirmed.actor} · {date(row.confirmed.at)}</span>
          {data.data?.editable && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void update(row, false)}>移除确认</Button>}
          {row.message?.url && <Ext href={row.message.url}>查看原消息</Ext>}
        </div>
        {row.message ? <Markdown text={row.message.text} /> : <span className="muted-text">原消息已变更或不可访问。</span>}
      </div>)}
      {!!data.data.recent.length && <details className="minor-disclosure"><summary>近期主题讨论</summary>
        {data.data.recent.filter(row => !data.data?.basis.some(ref => ref.source === row.source && ref.id === row.id && ref.revision === row.revision))
          .map(row => <div className="revision-note" key={row.source + row.id}><div className="inline-meta">
            <Source channel={row.source} /><span>{row.actor} · {date(row.at)}</span>{row.url && <Ext href={row.url}>原消息</Ext>}
            {data.data?.editable && <Button size="sm" variant="outline" disabled={busy} onClick={() => void update(row, true)}>确认作为依据</Button>}
          </div><Markdown text={row.text} /></div>)}
      </details>}
    </>}
  </Section>;
}
