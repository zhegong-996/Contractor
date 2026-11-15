import { useState } from 'react';
import { ArrowRight, Bot, CheckCheck, ChevronRight, ClipboardCheck, GitPullRequest, Inbox, Link2, ListChecks, LockKeyhole, MessageSquare, Workflow } from 'lucide-react';
import { api, useData, type Decision, type Knowledge } from './api.ts';
import { AgentOptions, MaterialPicker } from './creation.tsx';
import { go, routeFor, type PageProps } from './navigation.ts';
import { Button } from './paperclip/button.tsx';
import { date, Empty, Ext, Field, Markdown, Modal, Section, Segments, TicketStatus, TopicOptions, useActions, useStored } from './ui.tsx';

const decisionVisual = {
  channel: [Link2, '确认归属'], intake: [Workflow, '确认分工'], discussion: [MessageSquare, '群反馈'],
  answer: [Bot, 'Agent 提问'], access: [LockKeyhole, '资料授权'], acceptance: [ClipboardCheck, '交付验收'],
  development: [GitPullRequest, '研发委托'], 'development-returned': [GitPullRequest, '研发退回'],
  delivery: [GitPullRequest, '交付证据'], blocked: [Workflow, '执行阻塞'], budget: [Workflow, '费用核对'],
} as const;
const inboxScopes = [['all', '全部项目'], ['project', '当前项目']] as const;

export function InboxPage(props: PageProps) {
  const { project, workspace } = props;
  const [scope, setScope] = useStored<'all' | 'project'>('inbox-scope', 'all');
  const [opened, open] = useState<Decision>();
  const decisions = workspace.needsYou.filter(d => scope === 'all' || d.project === project.id);
  const latest = workspace.tickets.filter(t => t.work.project === project.id).slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 6);
  const memberAgents = workspace.agents.filter(a => a.projects.includes(project.id));
  function decisionRoute(d: Decision) {
    if (d.ticket) {
      const tab = d.kind === 'access' ? 'context' : ['acceptance', 'delivery'].includes(d.kind) ? 'delivery' : 'activity';
      return routeFor(d.project, 'work', d.ticket, tab);
    }
    if (d.kind === 'discussion') return routeFor(d.project, 'project', d.subject, 'discussion');
    if (d.kind === 'budget') return routeFor(d.project, 'project', undefined, 'usage');
  }
  return <div className="page-scroll"><div className="dashboard">
    <div className="dashboard-heading"><div className="heading-icon"><Inbox size={23} /></div>
      <div><h1>待我处理</h1><p>{decisions.length ? decisions.length + ' 项需要你的决定' : '当前没有待你决定的事项'}</p></div>
      <Segments value={scope} onChange={setScope} items={inboxScopes} label="待办范围" />
    </div>
    <div className="dashboard-grid">
      <div className="dashboard-main">
        <section className="inbox-list" aria-label="待办">
          {decisions.length ? decisions.map(d => {
            const [Icon, kind] = decisionVisual[d.kind];
            const href = decisionRoute(d);
            const ticket = workspace.tickets.find(item => item.id === d.ticket);
            const contents = <><span className="inbox-icon"><Icon size={18} /></span><div className="inbox-item-body">
              <div><span className="category-label">{kind}</span>{scope === 'all' && <span> · {workspace.projects.find(p => p.id === d.project)?.title}</span>}</div>
              <strong>{ticket?.title ?? d.title}</strong>
              {(ticket && d.title !== ticket.title || d.request?.text || d.detail) && <p>
                {ticket && d.title !== ticket.title && d.title}
                {ticket && d.title !== ticket.title && (d.request?.text || d.detail) && ' · '}
                {d.request?.text ?? d.detail}
              </p>}
            </div><div className="inbox-item-end"><time>{date(d.openedAt)}</time><ChevronRight size={17} /></div></>;
            return href ? <a key={d.id} className="inbox-row" href={href}>{contents}</a>
              : <button key={d.id} className="inbox-row" type="button" onClick={() => open(d)}>{contents}</button>;
          }) : <Empty title="待办已清空" description="需要你授权、答复或验收的事项会显示在这里。" icon={<CheckCheck />} />}
        </section>
        <Section title="最近协作" action={<a href={routeFor(project.id, 'work')} className="text-button">全部工单 <ArrowRight size={15} /></a>}>
          {latest.length ? latest.map(item => <a className="recent-row" href={routeFor(project.id, 'work', item.id)} key={item.id}>
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
          {project.discussion && <a className="inspector-link" href={routeFor(project.id, 'project', undefined, 'discussion')}>
            <MessageSquare size={16} /><span>群反馈整理</span><ChevronRight size={15} /></a>}
        </Section>
        {!!project.budget && <Section title="项目预算"><p>{project.usage.billing.totalAmount === null ? '总费用待核对' : '已回报 $' + project.usage.billing.totalAmount}
          <span className="muted-text">{' / $' + project.budget}</span></p>
          <a className="text-button" href={routeFor(project.id, 'project', undefined, 'usage')}>查看回执 <ArrowRight size={15} /></a></Section>}
      </aside>
    </div>
  </div>
  {opened && <DecisionModal {...props} decision={opened} close={() => open(undefined)} />}
  </div>;
}

function DecisionModal({ workspace, decision, close }: PageProps & { decision: Decision; close: () => void }) {
  const project = workspace.projects.find(p => p.id === decision.project)!;
  const channel = decision.kind === 'channel';
  const sourceTicket = decision.request && 'sourceTicket' in decision.request && typeof decision.request.sourceTicket === 'string'
    ? decision.request.sourceTicket : '';
  const [draft, set] = useStored('decision:' + decision.id, { action: sourceTicket ? 'link' : 'create',
    ticket: sourceTicket, agent: '', topic: decision.request?.topic ?? '', material: [] as string[],
    project: project.id, brief: '', separate: false });
  const scope = [project, ...workspace.projects.filter(p => p.id !== project.id
    && (p.parent === project.id || p.id === project.parent || project.relatedProjects.includes(p.id))
    && p.members.some(m => m.name === decision.request?.sender))];
  const destinations = scope.filter(p => p.maintain);
  const target = channel && draft.action === 'create' ? destinations.find(p => p.id === draft.project) ?? project : project;
  const crossed = target.id !== project.id;
  const candidates = workspace.tickets.filter(t => scope.some(p => p.id === t.work.project && p.mayStart));
  const agents = workspace.agents.filter(a => a.active && a.projects.includes(target.id));
  const materials = useData<Knowledge[]>(channel && draft.action === 'create' ? 'knowledge/' + target.id : '');
  const { run, busy } = useActions();
  return <Modal title={decision.title} close={close}><form className="form" onSubmit={async e => {
    e.preventDefault();
    const data = draft.action === 'link' ? { action: 'link', ticket: draft.ticket }
      : draft.action === 'create' ? { action: 'create', agent: draft.agent || undefined,
        ...(channel ? { topic: draft.topic || undefined, material: draft.material, separate: draft.separate,
          ...(crossed ? { project: target.id, brief: draft.brief.trim() } : {}) } : {}) }
      : draft.action === 'topic' ? { action: 'topic', topic: draft.topic } : { action: draft.action };
    const result = await run(() => api<{ ticket?: string }>((channel ? 'channels/' : 'intake/') + decision.subject + '/resolve', data), '已处理待办');
    if (result) {
      close();
      if (result.ticket) go(workspace.tickets.find(t => t.id === result.ticket)?.work.project ?? target.id, 'work', result.ticket);
    }
  }}>
    <div className="context-preview"><div className="inline-meta">{decision.request?.sender && <strong>{decision.request.sender}</strong>}
      {decision.request && 'url' in decision.request && typeof decision.request.url === 'string' && <Ext href={decision.request.url}>原消息</Ext>}</div>
      {decision.request?.text && <Markdown text={decision.request.text} />}
      {decision.detail && <p className="muted-text">{decision.detail}</p>}
    </div>
    <Field label="处理方式"><select value={draft.action} onChange={e => set({ ...draft, action: e.target.value })}>
      <option value="create">{channel ? '新建工单' : '确认执行 Agent'}</option>
      {channel && <><option value="link">关联已有工单</option><option value="project">记到项目</option>
        {!!project.topics.length && <option value="topic">记到主题</option>}</>}
      <option value="dismiss">忽略</option>
    </select></Field>
    {draft.action === 'link' && <Field label="关联工单"><select value={draft.ticket} required onChange={e => set({ ...draft, ticket: e.target.value })}>
      <option value="">请选择</option>{candidates.map(t => <option key={t.id} value={t.id}>{t.title}
        {t.work.project !== project.id && ' · ' + scope.find(p => p.id === t.work.project)?.title}</option>)}
    </select></Field>}
    {channel && draft.action === 'create' && destinations.length > 1 && <Field label="工单项目"><select value={target.id}
      onChange={e => set({ ...draft, project: e.target.value, topic: '', agent: '', material: [] })}>
      {destinations.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
    </select></Field>}
    {crossed && <Field label="可共享的委托说明" hint="目标项目按这份说明建立工单。"><textarea rows={3} required maxLength={3500}
      value={draft.brief} onChange={e => set({ ...draft, brief: e.target.value })} /></Field>}
    {draft.action === 'create' && <Field label="执行 Agent"><select required={!channel} value={draft.agent}
      onChange={e => set({ ...draft, agent: e.target.value })}><AgentOptions agents={agents} allLabel={channel ? '沿用请求或项目配置' : '选择 Agent'} /></select></Field>}
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
