import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, ChevronRight, CircleCheck, FileCheck2, GitBranch, GitPullRequest, History, Link2, ListChecks, LockKeyhole, PanelRightClose, PanelRightOpen, Plus, ShieldCheck } from 'lucide-react';
import { api, uid, useData, type DeviceRow, type Knowledge, type Snapshot, type Ticket } from './api.ts';
import { AgentOptions, MaterialPicker } from './creation.tsx';
import { Conversation } from './conversation.tsx';
import { go, routeFor, type PageProps } from './navigation.ts';
import { Button } from './paperclip/button.tsx';
import { Input } from './paperclip/input.tsx';
import { TabsContent } from './paperclip/tabs.tsx';
import { Avatar, date, Empty, Ext, Failure, Field, IconButton, Loading, Markdown, Modal, PageTabs, Pill, SearchBox, Section, short, Source,
  TicketStatus, TopicOptions, topicName, useActions, useStored, Version } from './ui.tsx';

const workTabs = [['activity', '协作动态'], ['delivery', '交付与验收'], ['context', '上下文']] as const;
type WorkTab = (typeof workTabs)[number][0];
const runStates: Record<string, string> = { queued: '排队中', claimed: '执行中', done: '执行完成', nothing: '无进一步动作',
  cancelled: '已停止', failed: '执行失败', unknown: '等待执行端回执' };
const accessStates: Record<string, string> = { requested: '待授权', granted: '本工单已授权', revoked: '已撤回', expired: '已到期' };
const pullStates: Record<string, string> = { open: '开启', draft: '草稿', closed: '已关闭', merged: '已合并' };
const reviewStates: Record<string, string> = { APPROVED: '已通过', CHANGES_REQUESTED: '要求修改', COMMENTED: '已评论', DISMISSED: '已撤销', PENDING: '待提交' };

function githubActor(identity: { login: string; member?: string } | null | undefined) {
  if (!identity) return '—';
  return identity.member && identity.member !== identity.login ? identity.member + ' (@' + identity.login + ')' : '@' + identity.login;
}

export function WorkPage(props: PageProps) {
  const { project, route, workspace, openTask } = props;
  const [filters, setFilters] = useStored('work:' + project.id, { query: '', topic: '', status: 'all' });
  const savedScroll = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (listRef.current) listRef.current.scrollTop = savedScroll.current; }, [route.item]);
  const inProject = workspace.tickets.filter(item => item.work.project === project.id);
  const shown = inProject.filter(item => {
    const matching = !filters.topic || item.work.topic === filters.topic || project.topics.some(t => t.id === item.work.topic && t.parent === filters.topic);
    const query = filters.query.trim().toLocaleLowerCase();
    const target = workspace.agents.find(a => a.id === item.work.agent)?.title;
    const status = filters.status === 'all' || (filters.status === 'active' && !item.work.accepted && item.stage.stage !== 'ended')
      || (filters.status === 'acceptance' && item.result && !item.work.accepted) || (filters.status === 'accepted' && !!item.work.accepted);
    return matching && status && (!query || [item.title, topicName(project, item.work.topic), item.work.requester, target]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(query));
  });
  const tab: WorkTab = workTabs.find(([id]) => id === route.tab)?.[0] ?? 'activity';
  const data = useData<Ticket>(route.item ? 'ticket/' + route.item : '', 2200);
  return <div className="split" data-has-detail={!!route.item}>
    <aside className="split-list" aria-label="项目工单列表">
      <div className="list-header">
        <div className="list-title"><h1>协作工单</h1>{project.mayStart && <IconButton label="新建工单" onClick={() => openTask({ topic: filters.topic || undefined })}><Plus /></IconButton>}</div>
        <SearchBox label="搜索工单" value={filters.query} onChange={query => setFilters({ ...filters, query })} />
        <div className="filters">
          <select aria-label="筛选主题" value={filters.topic} onChange={e => setFilters({ ...filters, topic: e.target.value })}><TopicOptions project={project} empty="全部主题" /></select>
          <select aria-label="筛选状态" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="all">全部状态</option><option value="active">执行中</option><option value="acceptance">待验收</option><option value="accepted">已验收</option>
          </select>
        </div>
      </div>
      <div className="list-scroll" ref={listRef} onScroll={e => { savedScroll.current = e.currentTarget.scrollTop; }}>
        {shown.map(item => <a className="list-item" key={item.id} href={routeFor(project.id, 'work', item.id)}
          aria-current={route.item === item.id ? 'page' : undefined}>
          <div className="list-item-top"><strong>{item.title}</strong><time>{date(item.updatedAt)}</time></div>
          <div className="list-item-meta"><Source channel={item.work.source} /><span>{topicName(project, item.work.topic) ?? '项目工单'}</span></div>
          <TicketStatus ticket={item} />
        </a>)}
        {!shown.length && <Empty title={inProject.length ? '没有匹配的工单' : '暂无工单'} icon={<ListChecks />} />}
      </div>
    </aside>
    <div className="split-detail">
      {route.item && <a className="mobile-back" href={routeFor(project.id, 'work')}><ArrowLeft size={16} />工单列表</a>}
      {!route.item ? <Empty title="选择一张工单" icon={<ListChecks />} description="查看讨论、当前交付和引用资料。" />
        : data.error ? <Failure error={data.error} retry={() => void data.refetch()} />
        : !data.data || data.data.project !== project.id ? (data.data ? <Empty title="请选择当前项目的工单" /> : <Loading />)
        : <TicketDetail key={data.data.id} {...props} ticket={data.data} tab={tab} />}
    </div>
  </div>;
}

function TicketDetail(props: PageProps & { ticket: Ticket; tab: WorkTab }) {
  const { ticket, tab, workspace, project } = props;
  const [side, setSide] = useStored('ticket-inspector', true);
  const [dialog, setDialog] = useState('');
  const { busy, run } = useActions();
  const agent = workspace.agents.find(a => a.id === ticket.work.agent);
  const decision = workspace.needsYou.find(d => d.ticket === ticket.id && (d.kind === 'development' || d.kind === 'development-returned'));
  const status = ticket.work.handoff && !ticket.work.handoff.completedAt && !ticket.work.handoff.cancelledAt;
  const agentChoices = workspace.agents.filter(a => a.active && a.projects.includes(project.id)
    && (!ticket.work.development || ['codex', 'cursor'].includes(a.engine)));
  const actions = ticket.actions;
  const deviceWaiting = !!ticket.device && !ticket.device.online && !ticket.endReason;
  const canResume = actions.resume && !status && (deviceWaiting || ticket.materialHidden || ticket.report?.state === 'blocked' || ticket.report?.state === 'failed'
    || ticket.requests.some(r => r.state === 'revoked' || r.state === 'expired') || ticket.stage.stage === 'idle');
  const send = (action: string, data: unknown, message: string) => run(() => api('ticket/' + ticket.id + '/' + action, data), message);
  const upcoming = ticket.work.version ?? 1;
  return <div className="ticket-shell">
    <div className="ticket-top">
      <div className="ticket-title-line">
        <h1>{ticket.title}</h1>
        <div className="ticket-top-actions">
          <IconButton label={side ? '隐藏工单信息' : '显示工单信息'} className="desktop-inspector" onClick={() => setSide(!side)}>
            {side ? <PanelRightClose /> : <PanelRightOpen />}</IconButton>
          {project.mayStart && <IconButton label="新建子工单" onClick={() => props.openTask({ parent: ticket.id, topic: ticket.work.topic })}><Plus /></IconButton>}
        </div>
      </div>
      <div className="ticket-head-meta"><TicketStatus ticket={ticket} /><Version version={ticket.work.version} /><Source channel={ticket.work.source} />
        <span>{agent ? agent.title : ticket.work.agent}</span>
        {ticket.device && <span>{ticket.device.name}{deviceWaiting ? ' · 离线' : ''}</span>}</div>
    </div>
    <div className="ticket-frame" data-inspector={side && tab !== 'context'}>
      <PageTabs value={tab} onChange={value => go(project.id, 'work', ticket.id, value)} items={workTabs} label="工单详情">
        <TabsContent className="ticket-tab" value="activity">
          {status && <div className="info-callout"><History size={17} /><span>正在确认旧执行停止及接续权限。{ticket.report?.summary}</span></div>}
          {deviceWaiting && !status && <div className="info-callout"><Bot size={17} />{ticket.device?.name} 当前离线，等待连接或确认接续。</div>}
          {decision && <section className="decision-box">
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
          <Timeline {...props} ticket={ticket} />
          <Conversation {...props} ticket={ticket.id} topic={ticket.work.topic} canReplyInFeishu={ticket.canReplyInFeishu} />
          {ticket.report && !ticket.result && !ticket.questions.length && !status && <div className="info-callout"><Bot size={17} /><span>{ticket.report.summary}</span></div>}
          {(canResume || actions.handoff || actions.stop) && <div className="actions context-actions">
            {canResume && <Button variant="outline" size="sm" onClick={() => setDialog('resume')}>{ticket.materialHidden ? '重新申请查阅' : '接续执行'}</Button>}
            {actions.handoff && agentChoices.some(a => a.id !== ticket.work.agent) && <Button variant="outline" size="sm" onClick={() => setDialog('handoff')}>交接 Agent</Button>}
            {actions.stop && <Button variant="ghost" size="sm" onClick={() => setDialog('stop')}>停止工单</Button>}
          </div>}
        </TabsContent>
        <TabsContent className="ticket-tab" value="delivery"><Delivery {...props} ticket={ticket} /></TabsContent>
        <TabsContent className="ticket-tab" value="context"><ContextPanel {...props} ticket={ticket} /></TabsContent>
      </PageTabs>
      {side && tab !== 'context' && <aside className="inspector" aria-label="工单信息">
        <h2>工单信息</h2>
        <dl className="facts">
          <dt>发起人</dt><dd>{ticket.work.requester}</dd>
          <dt>Agent 所有者</dt><dd>{agent?.owner ?? '—'}</dd>
          <dt>主题</dt><dd>{ticket.topicTitle ?? '未归入主题'}</dd>
          <dt>优先级</dt><dd>{ticket.work.priority === 'urgent' ? '紧急' : '普通'}</dd>
          <dt>创建时间</dt><dd>{date(ticket.createdAt)}</dd>
        </dl>
        <a className="inspector-link" href={routeFor(project.id, 'work', ticket.id, 'context')}><LockKeyhole size={16} /><span>引用与授权</span><ChevronRight size={15} /></a>
        <a className="inspector-link" href={routeFor(project.id, 'work', ticket.id, 'delivery')}><FileCheck2 size={16} /><span>查看验收依据</span><ChevronRight size={15} /></a>
        {ticket.work.parent && <a className="inspector-link" href={routeFor(project.id, 'work', ticket.work.parent)}><Link2 size={16} />上游工单</a>}
      </aside>}
    </div>
    {dialog && <TicketCommand {...props} name={dialog} close={() => setDialog('')} nextVersion={upcoming} />}
  </div>;
}

function Timeline({ ticket, project }: PageProps & { ticket: Ticket }) {
  const rows: { id: string; label: string; text: string; at: string; channel: string; url?: string; inline?: boolean; commit?: string;
    revisions?: Ticket['channelHistory'][number]['revisions'] }[] = [
    ...(!ticket.channelHistory.some(item => item.id === ticket.origin) ? [{ id: ticket.origin, label: ticket.work.requester, text: ticket.request, at: ticket.createdAt, channel: ticket.work.source }] : []),
    ...ticket.channelHistory.map(item => ({ id: item.id, label: item.member, text: item.text, at: item.at, channel: item.source, url: item.url,
      revisions: item.revisions, inline: item.github?.kind === 'inline', commit: item.github?.commit })),
    ...ticket.history.filter(item => item.id !== ticket.origin && !ticket.channelHistory.some(c => c.id === item.id))
      .map(item => ({ id: item.id, label: item.actor, text: item.text, at: item.at, channel: 'web' })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return <div className="timeline">
    {rows.map(item => <article key={item.id} className="timeline-entry">
      <Avatar value={item.label} /><div className="message">
        <div className="message-meta"><strong>{item.label}</strong><Source channel={item.channel} /><time>{date(item.at)}</time>
          {item.inline && <span>行内评论 {short(item.commit)}</span>}
          {item.url && <Ext href={item.url}>原消息</Ext>}</div>
        <Markdown text={item.text} />
        {item.revisions && item.revisions.length > 1 && <details className="minor-disclosure">
          <summary>消息修订 · {item.revisions.length}</summary>
          {item.revisions.map(revision => <div className="revision-note" key={revision.revision}><time>{date(revision.at)}</time><p>{revision.text || '原消息已撤回'}</p></div>)}
        </details>}
      </div>
    </article>)}
    {ticket.discussionNotes.map(item => <article className="timeline-entry" key={item.id}>
      <Avatar value="群" kind="agent" /><div className="message">
        <div className="message-meta"><strong>群反馈整理</strong><Source channel="feishu" /></div>
        <p><strong>{item.title}</strong> {item.reason}</p>
        <div className="actions">{item.evidence.filter(e => e.url).map((e, index) => <Ext key={index} href={e.url}>{e.title}</Ext>)}</div>
      </div>
    </article>)}
    {ticket.result && <article className="timeline-entry">
      <Avatar value="AI" kind="agent" /><div className="message result-message">
        <div className="message-meta"><strong>Agent 交付</strong><Version version={ticket.result.version} /><time>{date(ticket.result.at)}</time></div>
        <Markdown text={ticket.result.text} />
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
  return <article className="decision-box">
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

function TicketCommand({ name, ticket, close, project, workspace, nextVersion }: PageProps & {
  name: string; ticket: Ticket; close: () => void; nextVersion: number;
}) {
  const { busy, run } = useActions();
  const devices = useData<DeviceRow[]>(name === 'resume' ? 'project/' + project.id + '/devices' : '', 2500);
  const eligible = devices.data?.filter(device => device.agent === ticket.work.agent && device.active && device.eligible) ?? [];
  const options = workspace.agents.filter(a => a.active && a.projects.includes(project.id)
    && (name !== 'handoff' || a.id !== ticket.work.agent) && (!ticket.work.development || ['codex','cursor'].includes(a.engine)));
  const offer = workspace.needsYou.find(d => d.ticket === ticket.id && d.kind === (name === 'respond' ? 'development' : 'development-returned'));
  const settings: Record<string, [string, string]> = {
    respond: ['处理研发委托', '确认提交'], reoffer: ['重新安排研发', '重新发出委托'], stop: ['停止工单', '停止工单'],
    resume: [ticket.materialHidden ? '重新申请查阅' : '接续原工单', '确认接续'], handoff: ['交接 Agent', '发起交接'],
  };
  const [title, submit] = settings[name]!;
  return <Modal title={title} close={close}><form className="form" onSubmit={async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const reason = String(form.get('reason') ?? '').trim();
    const target = form.get('device');
    const agent = String(form.get('agent') ?? '');
    const commands: Record<string, [string, unknown]> = {
      stop: ['stop', {}], handoff: ['handoff', { agent, reason }],
      resume: ['resume', { version: nextVersion, nonce: uid(), reason, baseSha: form.get('baseSha') || undefined,
        device: target === 'workbench' ? null : target || undefined }],
      respond: ['respond-development', { offer: offer?.id, response: form.get('response'), reason }],
      reoffer: ['reoffer-development', { offer: offer?.subject, agent, reason }],
    };
    const [action, payload] = commands[name]!;
    if (await run(() => api('ticket/' + ticket.id + '/' + action, payload), '操作已提交')) close();
  }}>
    {name === 'stop' && <p>停止将结束本次委托。已记录的执行、提交与验收证据会保留。</p>}
    {name === 'handoff' && <p>工作台会先等待旧执行退出，再请新执行人确认所需资料。</p>}
    {['handoff','reoffer'].includes(name) && <Field label="接续 Agent"><select name="agent" required defaultValue=""><AgentOptions agents={options} /></select></Field>}
    {name === 'respond' && <Field label="处理方式"><select name="response"><option value="return">退回给负责人</option><option value="decline">拒接</option></select></Field>}
    {name !== 'stop' && <Field label="原因"><textarea name="reason" rows={4} maxLength={3500} required /></Field>}
    {name === 'resume' && !ticket.materialHidden && (ticket.device || eligible.length > 0) && <Field label="接续执行端"><select name="device" defaultValue="">
      <option value="">沿用当前执行端</option><option value="workbench">工作台执行端</option>
      {eligible.map(device => <option key={device.id} value={device.id}>{device.name}{device.online ? '' : ' · 离线'}</option>)}
    </select></Field>}
    {name === 'resume' && ticket.actions.baseline && !ticket.materialHidden && <Field label="新 Git 基线（选填）"><Input name="baseSha" pattern="[a-f0-9]{40}" maxLength={40} /></Field>}
    <div className="form-actions"><Button type="submit" variant={name === 'stop' ? 'destructive' : 'default'} disabled={busy}>{submit}</Button></div>
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
  return <div className="detail-stack">
    <Section title="当前成果" action={<Version version={ticket.work.version} />}>
      {ticket.materialHidden ? <div className="info-callout"><LockKeyhole size={16} />
        <span>{ticket.requests.some(r => r.state === 'revoked') ? '资料授权已收回。' : '此成果当前受限。'}{accepted ? '验收记录仍可查阅。' : ''}</span></div>
        : result ? <><Markdown text={result.text} /><div className="inline-meta">成果修订 <code>{short(result.revision, 12)}</code>
          <span>已装配 {result.sources.length} 份资料</span><span>成果引用 {result.cited?.length ?? 0} 条记忆</span></div></>
        : <p className="muted-text">尚未提交本版成果。</p>}
      {accepted && <div className="acceptance-line"><CircleCheck size={17} /><span>{accepted.actor} 已验收 · {date(accepted.at, true)}</span>
        {accepted.commit && <code>{short(accepted.commit, 12)}</code>}</div>}
      {ticket.candidate && <a className="text-button" href={routeFor(project.id, 'knowledge', ticket.candidate, ticket.candidateTab)}>
        {ticket.candidateTab === 'review' ? '查看知识候选' : '查看关联知识'} <ArrowRight size={15} /></a>}
    </Section>
    {(scope || delivery || ticket.mayLinkDelivery || ticket.githubIssues.length > 0 || ticket.work.branches?.length) && <Section title="GitHub 交付"
      action={ticket.mayLinkDelivery ? <Button variant="outline" size="sm" onClick={() => setAction('pull')}><GitPullRequest />{delivery ? '更新 PR 关联' : '关联 PR'}</Button> : undefined}>
      {scope && <dl className="facts">
        <dt>委托仓库</dt><dd>{scope.repository}</dd><dt>基线分支</dt><dd>{scope.base}</dd><dt>获准路径</dt><dd>{scope.paths.join('、')}</dd>
      </dl>}
      {delivery && <div className="delivery-summary">
        <Ext href={delivery.url}><GitPullRequest size={16} />PR #{delivery.pr}</Ext><code title={delivery.headSha}>{short(delivery.headSha, 12)}</code>
        {delivery.state && <span>{pullStates[delivery.state]}</span>}
        <Pill tone={delivery.ci === 'passed' ? 'green' : delivery.ci === 'failed' ? 'red' : 'amber'}>{({ passed: 'CI 通过', pending: 'CI 待完成', failed: 'CI 失败' })[delivery.ci]}</Pill>
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
    </Section>}
    {result && !accepted && (ticket.actions.accept || ticket.actions.revise || ticket.work.requester === workspace.actor) && <Section title="本版验收">
      {ticket.actions.accept ? <form className="form" onSubmit={async e => {
        e.preventDefault();
        await run(() => api('ticket/' + ticket.id + '/accept', { revision: result.revision, commit: delivery?.headSha,
          body: acceptDraft.body.trim(), conditions: acceptDraft.conditions.trim() }), '已验收此版本');
      }}>
        <details className="form-disclosure"><summary>填写可复用结论（选填）</summary>
          <Field label="结论"><textarea rows={3} maxLength={16000} value={acceptDraft.body} onChange={e => saveDraft({ ...acceptDraft, body: e.target.value })} /></Field>
          {acceptDraft.body.trim() && <Field label="适用条件"><Input maxLength={600} required value={acceptDraft.conditions}
            onChange={e => saveDraft({ ...acceptDraft, conditions: e.target.value })} /></Field>}
        </details>
        <div className="actions"><Button type="submit" disabled={busy}><Check />验收第 {result.version ?? 1} 版</Button>
          {ticket.actions.revise && <Button type="button" variant="outline" onClick={() => setAction('revision')}>打回修改</Button>}</div>
      </form> : <div className="actions"><span className="muted-text">{ticket.deliveryStatus?.detail ?? '等待本版达到验收条件。'}</span>
        {ticket.actions.revise && <Button variant="outline" size="sm" onClick={() => setAction('revision')}>打回修改</Button>}</div>}
    </Section>}
    {accepted && ticket.actions.revise && <Button variant="outline" className="self-start" onClick={() => setAction('revision')}>在原单开启下一版 <ArrowRight /></Button>}
    {ticket.versions.length > 0 && <Section title="版本历史">
      {ticket.versions.slice().reverse().map(version => <details className="version-record" key={version.revision}>
        <summary><Version version={version.version} /><code>{short(version.revision, 12)}</code><time>{date(version.at)}</time>
          {version.reviews.some(r => r.kind === 'accepted') && <Pill tone="green">已验收</Pill>}</summary>
        {version.text ? <Markdown text={version.text} /> : <p className="muted-text">此版本正文当前受限。</p>}
        {version.reviews.map(review => <div className="record-row" key={review.kind + review.at}>
          <strong>{({ accepted: '验收', rejected: '打回', continued: '开启下一版' })[review.kind]}</strong><span>{review.actor}</span>
          <time>{date(review.at)}</time>{review.reason && <span>{review.reason}</span>}
        </div>)}
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
    {action === 'revision' && result && <Revise ticket={ticket} project={project} close={() => setAction('')} />}
  </div>;
}

function Revise({ ticket, project, close }: { ticket: Ticket; project: PageProps['project']; close: () => void }) {
  const catalog = useData<Knowledge[]>('knowledge/' + project.id);
  const [selected, select] = useState<string[] | undefined>();
  const { busy, run } = useActions();
  return <Modal title={ticket.work.accepted ? '开启原单下一版' : '打回修改'} close={close}>
    <form className="form" onSubmit={async e => {
      e.preventDefault();
      const reason = String(new FormData(e.currentTarget).get('reason') ?? '').trim();
      if (await run(() => api('ticket/' + ticket.id + '/revise', { revision: ticket.result?.revision, reason,
        kind: ticket.work.accepted ? 'continued' : 'rejected', ...(selected ? { material: selected } : {}) }), '已开启下一版')) close();
    }}>
      <Field label="修改要求"><textarea name="reason" rows={4} required maxLength={3500} /></Field>
      <details className="form-disclosure"><summary>本版资料</summary>
        <p className="muted-text">沿用原单引用的现行版本，可另行选择。</p>
        <MaterialPicker entries={catalog.data ?? []} values={selected ?? ticket.work.material} onChange={select} />
      </details>
      <div className="form-actions"><Button type="submit" disabled={busy}>提交下一版</Button></div>
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
      <Field label="观测依据"><textarea name="evidence" rows={3} maxLength={3500} required /></Field>
      <details className="form-disclosure"><summary>可复用经验（选填）</summary><Field label="经验"><textarea name="body" rows={3} maxLength={3500} /></Field>
        <Field label="适用条件"><Input name="conditions" maxLength={600} /></Field></details>
      <div className="form-actions"><Button type="submit" disabled={busy}>保存</Button></div>
    </form></Modal>}
  </Section>;
}

function ContextPanel({ ticket, project, workspace, route }: PageProps & { ticket: Ticket }) {
  const [selected, select] = useStored('runs:' + ticket.id, 0);
  const [access, setAccess] = useState<{ request: Ticket['requests'][number]; action: 'request' | 'revoke' }>();
  const { run, busy } = useActions();
  const relatedProjects = new Set([project.id, project.parent, ...project.relatedProjects, ...workspace.projects.filter(p => p.parent === project.id).map(p => p.id)]);
  const [related, setRelated] = useState('');
  const editable = ticket.work.requester === workspace.actor || project.maintain;
  const runId = route.run ?? selected;
  const info = runId ? ticket.runs.find(r => r.id === runId) : ticket.runs.at(-1);
  const handoff = ticket.work.handoff;
  const agentTitle = (id: string) => workspace.agents.find(agent => agent.id === id)?.title ?? id;
  return <div className="detail-stack">
    <Section title="资料与授权">
      {(ticket.work.resources ?? []).map(ref => <div className="record-row" key={ref.ref}><Source channel={ref.source} /><Ext href={ref.url}>{ref.label}</Ext>
        {ref.revision && <code>{ref.revision}</code>}</div>)}
      {!ticket.requests.length && !ticket.work.resources?.length && <p className="muted-text">{ticket.work.material.length ? '引用资料已记录在执行快照中。' : '没有单独的资料授权。'}</p>}
      {ticket.requests.map(request => <article className="grant" key={request.id}>
        <div><strong>{request.title}</strong><p>{request.readerOwner || '原执行者'} · {request.purpose === 'review' ? '仅查阅本版成果' : '仅本工单执行'} · 版本 {short(request.revision)}</p></div>
        <Pill tone={request.state === 'granted' ? 'green' : request.state === 'requested' ? 'amber' : 'neutral'}>{accessStates[request.state] ?? request.state}</Pill>
        <div className="actions">
          {request.canManage && request.state === 'requested' && <Button size="sm" disabled={busy}
            onClick={() => void run(() => api('ticket/' + ticket.id + '/access/' + request.id, { state: 'granted' }), '已授权本工单，有效期 8 小时')}>授权 8 小时</Button>}
          {request.canManage && request.state === 'granted' && <Button size="sm" variant="outline" onClick={() => setAccess({ request, action: 'revoke' })}>撤权</Button>}
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
    <Section title="执行快照" action={ticket.runs.length > 0 ? <select aria-label="选择执行轮次" value={info?.id ?? ''} onChange={e => {
      select(Number(e.target.value));
      if (route.run) go(project.id, 'work', ticket.id, 'context');
    }}>
      {ticket.runs.slice().reverse().map(r => <option key={r.id} value={r.id}>执行 #{r.id} · {runStates[r.state] ?? r.state}</option>)}
    </select> : undefined}>
      {ticket.timers[0] && <p className="muted-text">下次复查 {date(ticket.timers[0].at)}</p>}
      {info ? <><div className="inline-meta"><Bot size={16} /><span>{info.attribution?.agent ?? 'Agent'} · {info.attribution?.owner ?? '—'}</span>
        {info.attribution && <span>委托 {info.attribution.delegatedBy}</span>}{info.resumed && <span>接续会话</span>}</div>
        {info.assembly ? <SnapshotBody ticket={ticket.id} id={info.id} attempt={route.run === info.id ? route.attempt : undefined}
          project={project.id} /> : <p className="muted-text">此轮暂未保存装配快照。</p>}</>
        : <p className="muted-text">等待首轮执行。</p>}
    </Section>
    {(ticket.children.length > 0 || ticket.related.length > 0 || ticket.work.parent || editable) && <Section title="关联工单">
      {ticket.work.parent && <a className="text-button" href={routeFor(project.id, 'work', ticket.work.parent)}>上游工单 <ArrowRight size={15} /></a>}
      {ticket.children.map(child => <div className="record-row" key={child.id}><span>子工单</span><a href={routeFor(project.id, 'work', child.id)}>{child.title}</a></div>)}
      {ticket.related.map(item => <div className="record-row" key={item.id}><span>关联</span><a href={routeFor(item.project, 'work', item.id)}>{item.title}</a></div>)}
      {editable && <form className="inline-form" onSubmit={async e => {
        e.preventDefault();
        if (await run(() => api('ticket/' + ticket.id + '/related', { ticket: related }), '已关联工单')) setRelated('');
      }}><select aria-label="选择有关联的工单" value={related} onChange={e => setRelated(e.target.value)} required>
        <option value="">选择已有工单</option>{workspace.tickets.filter(t => t.id !== ticket.id && relatedProjects.has(t.work.project)
          && !ticket.related.some(r => r.id === t.id)).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
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
          : <Field label="申请原因"><textarea name="reason" rows={4} maxLength={3500} required /></Field>}
        <div className="form-actions"><Button type="submit" disabled={busy} variant={access.action === 'revoke' ? 'destructive' : 'default'}>
          {access.action === 'revoke' ? '确认撤权' : '发送申请'}</Button></div>
      </form>
    </Modal>}
  </div>;
}

function SnapshotBody({ id, attempt, ticket, project }: { id: number; attempt?: number; ticket: string; project: string }) {
  const data = useData<Snapshot>('ticket/' + ticket + '/runs/' + id + (attempt ? '?attempt=' + attempt : ''), 2300);
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  const snap = data.data;
  if (!snap.readable || !snap.contents) return <div className="info-callout"><LockKeyhole size={16} />此执行快照的资料正文当前不可读。</div>;
  const material = snap.materials ?? [];
  const context = snap.contents.context;
  const evidence = context.events.filter(e => e.type === 'knowledge.source' || e.type === 'task.confirmation' || e.type === 'project.reference');
  return <>
    <div className="inline-meta">尝试 {snap.attempt} · {snap.contents.runtime.model ?? '历史记录未提供模型'}
      {snap.isolation && <span>成员隔离 · {snap.isolation.owner}</span>}</div>
    {material.map(ref => <div className="record-row" key={ref.id}>
      <a href={routeFor(project, 'knowledge', ref.id, 'history')}>{ref.title ?? evidence.find(e => e.id === ref.id)?.summary ?? '资料'}</a>
      <code>{short(ref.revision, 12)}</code>{ref.sourceRevision && <Ext href={ref.url}>源版本 {short(ref.sourceRevision, 12)}</Ext>}
      <Pill tone="neutral">{ref.recalled ? '按任务检索' : '随工单引用'}</Pill>
    </div>)}
    {evidence.length > 0 && <details className="minor-disclosure"><summary>查看实际装配内容</summary>
      {evidence.map(event => <article className="revision-note" key={event.id}><h3>{event.summary}</h3><Markdown text={event.detail} /></article>)}
    </details>}
  </>;
}
