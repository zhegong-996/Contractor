import { Input, TextArea } from './components/input.tsx';
import { useState } from 'react';
import { ArrowRight, Bot, CheckCheck, ChevronRight, ClipboardCheck, GitPullRequest, Inbox, Link2, ListChecks, LockKeyhole, MessageSquare, ShieldCheck, Workflow } from 'lucide-react';
import { api, useData, useTickets, type Decision, type Knowledge } from './api.ts';
import { TicketPicker } from './components/ticket-picker.tsx';
import { AgentOptions, MaterialPicker } from './creation.tsx';
import { go, personalChatRoute, projectWorkRoute, routeFor, workFromInbox, type PageProps } from './navigation.ts';
import { Button } from './components/button.tsx';
import { Markdown } from './markdown.tsx';
import { date, Empty, Ext, Field, Modal, Section, Segments, short, TicketStatus, TopicOptions, useActions, useStored, Version } from './ui.tsx';

export const decisionVisual = {
  channel: [Link2, '确认归属'], intake: [Workflow, '确认分工'], discussion: [MessageSquare, '群反馈'],
  answer: [Bot, 'Agent 提问'], access: [LockKeyhole, '资料授权'], acceptance: [ClipboardCheck, '交付验收'],
  development: [GitPullRequest, '研发委托'], 'development-returned': [GitPullRequest, '研发退回'],
  delivery: [GitPullRequest, '交付证据'], blocked: [Workflow, '执行阻塞'], budget: [Workflow, '费用核对'],
  feedback: [Workflow, '反馈改进'],
  approval: [ShieldCheck, '项目审批'],
} as const;
export const decisionTone = {
  channel: 'blue', intake: 'blue', discussion: 'blue', answer: 'blue', development: 'blue',
  acceptance: 'green', delivery: 'green', access: 'amber', approval: 'amber',
  blocked: 'red', budget: 'red', feedback: 'red', 'development-returned': 'red',
} as const;
const inboxScopes = [['all', '全部项目'], ['project', '当前项目']] as const;

export function InboxPage(props: PageProps) {
  const { project, workspace } = props;
  const [scope, setScope] = useStored<'all' | 'project'>('inbox-scope', 'all');
  const [opened, open] = useState<Decision>();
  const decisions = workspace.needsYou.filter(d => scope === 'all' || d.project === project.id);
  const latest = useTickets({ project: project.id, purpose: 'work', limit: 6 }, true, 4000).rows;
  const memberAgents = workspace.agents.filter(a => a.projects.includes(project.id));
  function decisionRoute(d: Decision) {
    if (d.kind === 'intake' || d.kind === 'channel') return;
    if (d.ticket) {
      const tab = d.kind === 'access' ? 'context' : d.kind === 'acceptance' ? 'verification' : d.kind === 'delivery' ? 'delivery' : 'activity';
      return workFromInbox(routeFor(d.project, 'work', d.ticket, tab), project.id, d.id, d.acceptanceRevision);
    }
    if (d.kind === 'discussion') return routeFor(d.project, 'project', d.subject, 'discussion');
    if (d.kind === 'budget') return routeFor(d.project, 'project', undefined, 'usage');
  }
  return <div className="page-scroll"><div className="dashboard">
    <div className="dashboard-heading"><div className="heading-icon"><Inbox size={23} /></div>
      <div><h1>待我处理 {!!decisions.length && <span className="heading-count">{decisions.length}</span>}</h1>
        <p>{decisions.length ? decisions.length + ' 项需要你的决定' : '当前没有待你决定的事项'}</p></div>
      <Segments value={scope} onChange={setScope} items={inboxScopes} label="待办范围" />
    </div>
    <div className="dashboard-grid">
      <div className="dashboard-main">
        <section className="inbox-list" aria-label="待办">
          {decisions.length ? decisions.map(d => {
            const [Icon, kind] = decisionVisual[d.kind];
            const href = decisionRoute(d);
            const ticket = d.ticketTitle;
            const contents = <><span className="inbox-icon"><Icon size={18} /></span><div className="inbox-item-body">
              <div className="inbox-item-meta"><span className="category-label">{kind}</span>
                {scope === 'all' && <span>{workspace.projects.find(p => p.id === d.project)?.title}</span>}
                {d.ticket && <code title={d.ticket}>{short(d.ticket)}</code>}{d.version && <Version version={d.version} />}
              </div>
              <strong>{ticket ?? d.title}</strong>
              {(ticket && d.title !== ticket || d.request?.text || d.detail) && <p>
                {ticket && d.title !== ticket && d.title}
                {ticket && d.title !== ticket && (d.request?.text || d.detail) && ' · '}
                {d.request?.text ?? d.detail}
              </p>}
            </div><div className="inbox-item-end"><time>{date(d.openedAt)}</time><ChevronRight size={17} /></div></>;
            return href ? <a key={d.id} className="inbox-row" data-tone={decisionTone[d.kind] ?? 'blue'} href={href}>{contents}</a>
              : <button key={d.id} className="inbox-row" data-tone={decisionTone[d.kind] ?? 'blue'} type="button" onClick={() => open(d)}>{contents}</button>;
          }) : <Empty title="待办已清空" description="需要你授权、答复或验收的事项会显示在这里。" icon={<CheckCheck />} />}
        </section>
        <Section title="最近协作" action={<a href={projectWorkRoute(project.id)} className="text-button">全部工单 <ArrowRight size={15} /></a>}>
          {latest.length ? latest.map(item => <a className="recent-row" href={workFromInbox(routeFor(project.id, 'work', item.id), project.id)} key={item.id}>
            <ListChecks size={17} /><div><strong>{item.title}</strong><small>{workspace.agents.find(a => a.id === item.work.agent)?.title ?? item.work.agent} · {date(item.updatedAt)}</small></div>
            <TicketStatus ticket={item} /><ChevronRight className="recent-arrow" size={16} />
          </a>) : <p className="muted-text">这个项目还没有工单。</p>}
        </Section>
      </div>
      <aside className="dashboard-side">
        <Section title="当前项目"><a className="project-shortcut" href={routeFor(project.id, 'project')}><span className="project-shortcut-icon"><Workflow size={20} /></span>
          <strong>{project.title}</strong><ArrowRight size={16} /></a>
          <dl className="project-counts"><div><dt>在岗 Agent</dt><dd>{memberAgents.filter(a => a.active).length}</dd></div>
            <div><dt>已接入来源</dt><dd>{project.resources.filter(r => r.state === 'bound').length}</dd></div></dl>
          <a className="inspector-link" href={routeFor(project.id, 'knowledge')}><LockKeyhole size={16} /><span>项目知识</span><ChevronRight size={15} /></a>
          <a className="inspector-link" href={personalChatRoute(undefined, project.id)}><Bot size={16} /><span>与我的 Agent 对话</span><ChevronRight size={15} /></a>
          {project.discussion && <a className="inspector-link" href={routeFor(project.id, 'project', undefined, 'discussion')}>
            <MessageSquare size={16} /><span>群反馈整理</span><ChevronRight size={15} /></a>}
        </Section>
      </aside>
    </div>
  </div>
  {opened && <DecisionModal {...props} decision={opened} close={() => open(undefined)} />}
  </div>;
}

function DecisionModal({ workspace, decision, close }: PageProps & { decision: Decision; close: () => void }) {
  if (decision.kind === 'feedback') return <FeedbackDecision workspace={workspace} decision={decision} close={close} />;
  const project = workspace.projects.find(p => p.id === decision.project)!;
  const channel = decision.kind === 'channel';
  const sourceTicket = decision.request && 'sourceTicket' in decision.request && typeof decision.request.sourceTicket === 'string'
    ? decision.request.sourceTicket : '';
  const [draft, set] = useStored('decision:' + decision.id, { action: sourceTicket ? 'link' : 'create',
    ticket: sourceTicket, agent: '', topic: decision.request?.topic ?? '', material: [] as string[],
    project: project.id, brief: '', separate: false, repository: '' });
  const scope = [project, ...workspace.projects.filter(p => p.id !== project.id
    && (p.parent === project.id || p.id === project.parent || project.relatedProjects.includes(p.id))
    && p.members.some(m => m.name === decision.request?.sender))];
  const destinations = scope.filter(p => p.maintain);
  const target = channel && draft.action === 'create' ? destinations.find(p => p.id === draft.project) ?? project : project;
  const crossed = target.id !== project.id;
  const repositories = target.deliveryTargets.filter(ref => ref.eligibleAgents.length);
  const repository = repositories.find(ref => ref.ref === draft.repository);
  const [linkedProject, setLinkedProject] = useState<string>();
  const [hint, setHint] = useState<{ agent: string | null; summary: string }>();
  const agents = workspace.agents.filter(a => a.active && a.projects.includes(target.id)
    && (!repository || repository.eligibleAgents.includes(a.id)));
  const materials = useData<Knowledge[]>(channel && draft.action === 'create' ? 'knowledge/' + target.id : '');
  const { run, busy } = useActions();
  return <Modal title={decision.title} close={close}><form className="form" onSubmit={async e => {
    e.preventDefault();
    const data = draft.action === 'link' ? { action: 'link', ticket: draft.ticket }
      : draft.action === 'create' ? { action: 'create', agent: draft.agent || undefined,
        ...(channel ? { topic: draft.topic || undefined, material: draft.material, separate: draft.separate,
          target: draft.repository || undefined,
          ...(crossed ? { project: target.id, brief: draft.brief.trim() } : {}) } : {}) }
      : draft.action === 'topic' ? { action: 'topic', topic: draft.topic } : { action: draft.action };
    const result = await run(() => api<{ ticket?: string }>((channel ? 'channels/' : 'intake/') + decision.subject + '/resolve', data), '已处理待办');
    if (result) {
      close();
      if (result.ticket) go((draft.action === 'link' ? linkedProject : target.id) ?? project.id, 'work', result.ticket);
    }
  }}>
    <div className="context-preview"><div className="inline-meta">{decision.request?.sender && <strong>{decision.request.sender}</strong>}
      {decision.request && 'url' in decision.request && typeof decision.request.url === 'string' && <Ext href={decision.request.url}>原消息</Ext>}</div>
      {decision.request?.text && <Markdown text={decision.request.text} />}
      {decision.detail && <p className="muted-text">{decision.detail}</p>}
    </div>
    {!channel && decision.kind === 'intake' && decision.request && project.maintain && workspace.assistantEnabled
      && <div className="detail-stack">
        <div className="actions"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => {
          const result = await run(() => api<{ value: NonNullable<typeof hint> }>('intake/' + decision.subject + '/draft', {}));
          if (result) setHint(result.value);
        }}>生成接单建议</Button></div>
        {hint && <div className="context-preview"><p>{hint.summary}</p>
          {agents.some(agent => agent.id === hint.agent) && <Button type="button" variant="ghost" size="sm"
            onClick={() => set({ ...draft, action: 'create', agent: hint.agent! })}>选择建议的 Agent</Button>}
        </div>}
      </div>}
    <Field label="处理方式"><select value={draft.action} onChange={e => set({ ...draft, action: e.target.value })}>
      <option value="create">{channel ? '新建工单' : '确认执行 Agent'}</option>
      {channel && <><option value="link">关联已有工单</option><option value="project">记到项目</option>
        {!!project.topics.length && <option value="topic">记到主题</option>}</>}
      <option value="dismiss">忽略</option>
    </select></Field>
    {draft.action === 'link' && <Field label="关联工单"><TicketPicker projects={scope.filter(p => p.mayStart)} value={draft.ticket}
      onChange={(ticket, target) => { setLinkedProject(target); set({ ...draft, ticket }); }} /></Field>}
    {channel && draft.action === 'create' && destinations.length > 1 && <Field label="工单项目"><select value={target.id}
      onChange={e => set({ ...draft, project: e.target.value, topic: '', agent: '', material: [], repository: '' })}>
      {destinations.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
    </select></Field>}
    {crossed && <Field label="可共享的委托说明" hint="目标项目按这份说明建立工单。"><TextArea rows={3} required maxLength={3500}
      value={draft.brief} onChange={e => set({ ...draft, brief: e.target.value })} /></Field>}
    {channel && draft.action === 'create' && (repositories.length > 0 || draft.repository) && <Field label="交付仓库"><select value={draft.repository ?? ''}
      onChange={e => {
        const selected = repositories.find(ref => ref.ref === e.target.value);
        set({ ...draft, repository: e.target.value, agent: !selected || selected.eligibleAgents.includes(draft.agent) ? draft.agent : '' });
      }}>
      <option value="">只读协作</option>
      {draft.repository && !repository && <option value={draft.repository} disabled>原交付仓库已不可用</option>}
      {repositories.map(ref => <option key={ref.ref} value={ref.ref}>{ref.label} · {ref.externalId}</option>)}
    </select></Field>}
    {draft.action === 'create' && <Field label="执行 Agent"><select required={!channel || !!repository} value={draft.agent}
      onChange={e => set({ ...draft, agent: e.target.value })}><AgentOptions agents={agents}
        allLabel={repository ? '选择有交付资格的 Agent' : channel ? '沿用请求或项目配置' : '选择 Agent'} /></select></Field>}
    {channel && ['topic', 'create'].includes(draft.action) && <Field label="主题"><select value={draft.topic} required={draft.action === 'topic'}
      onChange={e => set({ ...draft, topic: e.target.value })}><TopicOptions project={target} empty={crossed ? '未归入主题' : '按来源默认'} /></select></Field>}
    {channel && draft.action === 'create' && <details className="form-disclosure"><summary>资料与单独开单</summary>
      <MaterialPicker entries={materials.data ?? []} values={draft.material} onChange={material => set({ ...draft, material })} />
      {!crossed && <label className="check-row">
        <input type="checkbox" checked={draft.separate} onChange={e => set({ ...draft, separate: e.target.checked })} />
        <span>这条消息需要单独开单</span>
      </label>}
    </details>}
    <div className="form-actions"><Button type="submit" disabled={busy}>确认</Button></div>
  </form></Modal>;
}

function FeedbackDecision({ workspace, decision, close }: { workspace: PageProps['workspace']; decision: Decision; close: () => void }) {
  const project = workspace.projects.find(p => p.id === decision.project)!;
  const agents = workspace.agents.filter(a => a.active && a.projects.includes(project.id));
  const [action, setAction] = useState<'ticket' | 'dismiss'>('ticket');
  const [title, setTitle] = useState('反馈改进');
  const [request, setRequest] = useState('');
  const [agent, setAgent] = useState('');
  const { run, busy } = useActions();
  return <Modal title={decision.title} close={close}><form className="form" onSubmit={async event => {
    event.preventDefault();
    const outcome = await run(() => api<{ ticket?: string }>('feedback/' + decision.subject + '/resolve',
      action === 'dismiss' ? { action: 'dismiss' } : { action: 'ticket', title, request: request.trim() || undefined, agent: agent || undefined }),
      '反馈已处理');
    if (outcome) {
      close();
      if (outcome.ticket) go(project.id, 'work', outcome.ticket);
    }
  }}>
    <div className="context-preview"><Markdown text={decision.detail ?? ''} /></div>
    <Field label="处理方式"><select value={action} onChange={event => setAction(event.target.value as 'ticket' | 'dismiss')}>
      <option value="ticket">转为改进工单</option><option value="dismiss">忽略本次反馈</option>
    </select></Field>
    {action === 'ticket' && <>
      <Field label="工单标题"><Input value={title} maxLength={100} onChange={event => setTitle(event.target.value)} /></Field>
      <Field label="改进要求" hint="留空则按差评汇总自动生成。"><TextArea rows={4} maxLength={3500} value={request}
        onChange={event => setRequest(event.target.value)} /></Field>
      <Field label="执行 Agent"><select value={agent} onChange={event => setAgent(event.target.value)}>
        <option value="">按项目职责分派</option>
        {agents.map(row => <option key={row.id} value={row.id}>{row.title} · {row.owner}</option>)}
      </select></Field>
    </>}
    <div className="form-actions"><Button type="submit" disabled={busy}>确认</Button></div>
  </form></Modal>;
}
