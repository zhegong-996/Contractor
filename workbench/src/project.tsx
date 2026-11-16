import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Clipboard, FolderKanban, GitBranch, Link2, MessageSquare, Plus, Plug2 } from 'lucide-react';
import { api, useData, type Channels, type Discussion, type Resource } from './api.ts';
import { go, routeFor, type PageProps } from './navigation.ts';
import { AgentOptions } from './creation.tsx';
import { Receipts } from './agents.tsx';
import { Conversation } from './conversation.tsx';
import { Button } from './paperclip/button.tsx';
import { Input } from './paperclip/input.tsx';
import { TabsContent } from './paperclip/tabs.tsx';
import { Avatar, date, Empty, Ext, Failure, Field, Loading, Markdown, MaterialIcon, Modal, PageTabs, Pill, Section, short, Source,
  TopicOptions, topicName, useActions, useStored } from './ui.tsx';

const tabs = [['chat', '讨论'], ['structure', '项目结构'], ['sources', '资料与连接'], ['discussion', '群反馈'], ['usage', '用量']] as const;
export function ProjectPage(props: PageProps) {
  const { project, route } = props;
  const shown = project.discussion ? tabs : tabs.filter(([id]) => id !== 'discussion');
  const tab = shown.find(([id]) => id === route.tab)?.[0] ?? 'structure';
  return <div className="page-scroll"><div className="project-page">
    <header className="object-header"><div className="object-emblem"><FolderKanban size={25} /></div>
      <div className="min-w-0"><h1>{project.title}</h1><div className="object-meta"><span>{project.members.length} 位成员</span>
        <span>{project.topics.length} 个主题</span><span>{project.resources.filter(r => r.state === 'bound').length} 个来源</span></div></div>
      <a className="text-button object-action" href={routeFor(project.id, 'work')}>项目工单 <ArrowRight size={16} /></a>
    </header>
    <PageTabs label="项目详情" value={tab} items={shown} onChange={value => go(project.id, 'project', undefined, value)}>
      <TabsContent value="chat" className="detail-stack"><ProjectChat {...props} /></TabsContent>
      <TabsContent value="structure" className="detail-stack"><Structure {...props} /></TabsContent>
      <TabsContent value="sources" className="detail-stack"><Sources {...props} /></TabsContent>
      {project.discussion && <TabsContent value="discussion" className="detail-stack"><GroupFeedback {...props} /></TabsContent>}
      <TabsContent value="usage" className="detail-stack"><Receipts project={project.id} /></TabsContent>
    </PageTabs>
  </div></div>;
}

function ProjectChat(props: PageProps) {
  const { project, route, openTask, workspace } = props;
  const topic = project.topics.find(item => item.id === route.item)?.id ?? '';
  const tickets = topic ? workspace.tickets.filter(item => item.work.project === project.id && item.work.topic === topic && !item.work.consultation) : [];
  return <Section title={topicName(project, topic) ?? '项目讨论'} action={<div className="actions">
    {!!project.topics.length && <select aria-label="讨论范围" value={topic} onChange={event => go(project.id, 'project', event.target.value || undefined, 'chat')}>
    <TopicOptions project={project} empty="项目讨论" />
    </select>}
    {topic && project.mayStart && <Button size="sm" variant="outline" onClick={() => openTask({ topic })}>发起工单</Button>}
  </div>}>
    {!!tickets.length && <div className="record-row" aria-label="主题工单">{tickets.map(item =>
      <a key={item.id} href={routeFor(project.id, 'work', item.id)}>{item.title}</a>)}</div>}
    <Conversation {...props} key={topic} topic={topic || undefined} />
  </Section>;
}

function Structure({ workspace, project, openTask }: PageProps) {
  const related = workspace.projects.filter(p => p.parent === project.id || project.relatedProjects.includes(p.id) || p.id === project.parent);
  const [open, show] = useState(false);
  const [memberForm, setMemberForm] = useState(false);
  const [agentForm, setAgentForm] = useState(false);
  const own = workspace.ownAgents.filter(item => !item.projects.includes(project.id));
  const projectAgents = workspace.agents.filter(item => item.projects.includes(project.id));
  const { busy, run, store } = useActions();
  return <>
    {!!related.length && <Section title="项目关系">{related.map(p => <a className="record-row" key={p.id} href={routeFor(p.id, 'project')}>
      <GitBranch size={16} /><strong>{p.title}</strong><span>{p.parent === project.id ? '子项目' : p.id === project.parent ? '上级项目' : '关联项目'}</span><ArrowRight size={15} />
    </a>)}</Section>}
    <Section title="主题" action={project.maintain ? <Button variant="outline" size="sm" onClick={() => show(true)}><Plus />新建主题</Button> : undefined}>
      {project.topics.length ? project.topics.map(topic => <div className="topic-row" key={topic.id} data-child={!!topic.parent}>
        <MessageSquare size={16} /><a href={routeFor(project.id, 'project', topic.id, 'chat')}><strong>{topic.title}</strong></a>{topic.parent && <small>{topicName(project, topic.parent)}</small>}
        <a className="text-button" href={routeFor(project.id, 'work')}
          onClick={() => store('work:' + project.id, { query: '', topic: topic.id, status: 'all' })}>查看工单<ArrowRight size={14} /></a>
        {project.mayStart && <Button size="sm" variant="ghost" onClick={() => openTask({ topic: topic.id })}>发起</Button>}
      </div>) : <p className="muted-text">暂无主题。</p>}
    </Section>
    <Section title="项目成员" action={project.maintain ? <Button variant="outline" size="sm" onClick={() => setMemberForm(true)}><Plus />添加成员</Button> : undefined}>
      <div className="member-grid">{project.members.map(m => <div className="member" key={m.name}><Avatar value={m.name} />
        <div><strong>{m.name}</strong><small>{m.responsibilities.map(r => workspace.functions.find(f => f.id === r)?.title ?? r).join('、') || (m.maintain ? '项目维护人' : '项目成员')}</small></div>
      </div>)}</div>
    </Section>
    <Section title="项目 Agent" action={project.mayStart && own.length ? <Button variant="outline" size="sm" onClick={() => setAgentForm(true)}><Plus />加入我的 Agent</Button> : undefined}>
      {projectAgents.map(agent => <div className="record-row" key={agent.id}><strong>{agent.title}</strong><span>{agent.owner}</span></div>)}
      {!projectAgents.length && <p className="muted-text">暂无已加入的 Agent。</p>}
    </Section>
    {memberForm && <Modal title="添加项目成员" close={() => setMemberForm(false)}><form className="form" onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      if (await run(() => api('project/' + project.id + '/member', { member: String(form.get('member')).trim() }), '成员已添加')) setMemberForm(false);
    }}><Field label="工作台账号"><Input required name="member" autoFocus maxLength={32} /></Field>
      <div className="form-actions"><Button disabled={busy} type="submit">添加</Button></div>
    </form></Modal>}
    {agentForm && <Modal title="加入我的 Agent" close={() => setAgentForm(false)}><form className="form" onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      if (await run(() => api('project/' + project.id + '/agent', { agent: form.get('agent') }), 'Agent 已加入')) setAgentForm(false);
    }}><Field label="我的 Agent"><select name="agent" required>{own.map(agent => <option key={agent.id} value={agent.id}>{agent.title}</option>)}</select></Field>
      <div className="form-actions"><Button disabled={busy} type="submit">加入</Button></div>
    </form></Modal>}
    {open && <Modal title="新建项目主题" close={() => show(false)}><form className="form" onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget);
      if (await run(() => api('project/' + project.id + '/topic', { id: 'topic-' + crypto.randomUUID().slice(0, 8),
        title: form.get('title'), parent: form.get('parent') || undefined }), '已新建主题')) show(false);
    }}><Field label="主题名称"><Input required name="title" maxLength={100} /></Field>
      {!!project.topics.length && <Field label="上级主题"><select name="parent"><TopicOptions project={project} empty="项目一级主题" /></select></Field>}
      <div className="form-actions"><Button type="submit" disabled={busy}>创建</Button></div>
    </form></Modal>}
  </>;
}

function Sources({ project, workspace }: PageProps) {
  const [adding, setAdding] = useState(false);
  const [group, setGroup] = useState(false);
  const { run, busy } = useActions();
  return <><Section title="项目来源" action={project.maintain ? <div className="actions">
    {!!workspace.feishuGroups.length && <Button size="sm" variant="outline" onClick={() => setGroup(true)}>绑定飞书群</Button>}
    <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus />关联资料</Button></div> : undefined}>
    {project.resources.length ? project.resources.map(ref => <ResourceRow refInfo={ref} key={ref.ref} project={project} />)
      : <Empty title="暂无项目来源" icon={<Link2 />} />}
    {project.importableSources.length > 0 && <a className="text-button mt-3" href={routeFor(project.id, 'knowledge')}><BookOpen size={16} />在知识库接入正文 <ArrowRight size={15} /></a>}
    {adding && <Modal title="关联项目资料" close={() => setAdding(false)}><form className="form" onSubmit={async e => {
      e.preventDefault(); const data = new FormData(e.currentTarget);
      if (await run(() => api('project/' + project.id + '/reference', { source: data.get('source'), label: data.get('label'),
        url: data.get('url'), revision: data.get('revision') || undefined }), '项目资料已关联')) setAdding(false);
    }}>
      <Field label="来源类型"><select name="source"><option value="feishu-doc">飞书文档</option><option value="figma">Figma</option><option value="document">外部文档</option></select></Field>
      <Field label="名称"><Input name="label" required maxLength={100} /></Field>
      <Field label="资料链接"><Input name="url" type="url" required placeholder="https://…" /></Field>
      <Field label="源版本（选填）"><Input name="revision" maxLength={120} /></Field>
      <div className="form-actions"><Button type="submit" disabled={busy}>关联</Button></div>
    </form></Modal>}
    {group && <Modal title="绑定飞书群" close={() => setGroup(false)}><form className="form" onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      if (await run(() => api('project/' + project.id + '/feishu-group', {
        chat: form.get('chat'), label: form.get('label'), topic: form.get('topic') || undefined,
      }), '飞书群已绑定')) setGroup(false);
    }}><Field label="已获准接入的群"><select name="chat" required>{workspace.feishuGroups.map(chat => <option key={chat}>{chat}</option>)}</select></Field>
      <Field label="群名称"><Input name="label" required maxLength={100} /></Field>
      {!!project.topics.length && <Field label="默认主题"><select name="topic"><TopicOptions project={project} empty="项目讨论" /></select></Field>}
      <div className="form-actions"><Button type="submit" disabled={busy}>绑定</Button></div>
    </form></Modal>}
  </Section>{workspace.crossChannel && <ChannelArchive project={project} />}</>;
}

function ChannelArchive({ project }: { project: PageProps['project'] }) {
  const data = useData<Channels>('channels', 4200);
  const notes = data.data?.archived.filter(item => item.project === project.id) ?? [];
  if (!notes.length && !data.error) return null;
  return <Section title="渠道归档">{data.error ? <Failure error={data.error} retry={() => void data.refetch()} />
    : notes.map(item => <article className="revision-note" key={item.id}>
      <div className="record-row"><strong>{item.member}</strong><span>{topicName(project, item.topic) ?? '项目记录'}</span>
        {item.url && <Ext href={item.url}>原消息</Ext>}</div><Markdown text={item.text} />
    </article>)}
  </Section>;
}

function ResourceRow({ refInfo, project }: { refInfo: Resource; project: PageProps['project'] }) {
  const { run, busy } = useActions();
  return <div className="resource-row"><MaterialIcon /><div>
    <strong><Ext href={refInfo.url}>{refInfo.label}</Ext></strong>
    <div className="inline-meta"><Source channel={refInfo.source} />
      <span>{({ discussion: '讨论入口', reference: '参考资料', delivery: '交付仓库' })[refInfo.purpose]}</span>{refInfo.revision && <code>{short(refInfo.revision, 12)}</code>}</div>
    </div>
    {project.maintain && refInfo.state === 'observe' && refInfo.purpose !== 'reference' && ['feishu','github'].includes(refInfo.source)
      ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api('project/' + project.id + '/bind',
        { source: refInfo.source, externalId: refInfo.externalId }), '来源已绑定')}>确认绑定</Button>
      : <Pill tone={refInfo.state === 'bound' ? 'green' : 'neutral'}>{refInfo.state === 'bound' ? '已关联' : '仅观察'}</Pill>}
  </div>;
}

const destinations: Record<string,string> = { project: '项目记录', topic: '主题记录', link: '已接续', create: '新工单', review: '待判断', dismiss: '忽略' };
function GroupFeedback(props: PageProps) {
  const { project, route } = props;
  const data = useData<Discussion>('discussion/' + project.id, 4200);
  const [filter, setFilter] = useStored<'all' | 'pending'>('feedback:' + project.id, 'all');
  const items = data.data?.items.filter(i => filter === 'all' || i.status !== 'applied') ?? [];
  const focused = data.data?.items.find(item => item.id === route.item);
  const scroll = focused?.id;
  useEffect(() => { if (scroll) document.getElementById('feedback-' + scroll)?.scrollIntoView({ block: 'nearest' }); }, [scroll]);
  return <Section title="飞书群反馈" action={project.maintain && <select aria-label="筛选群反馈" value={filter} onChange={e => setFilter(e.target.value as 'all'|'pending')}>
    <option value="all">全部反馈</option><option value="pending">待确认</option></select>}>
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading /> : <>
      {data.data.next && <p className="muted-text">下次预计整理 {date(new Date(data.data.next).toISOString())}</p>}
      {items.length ? items.map(item => <Feedback key={item.id} {...props} item={item} />) : <Empty title="暂无符合条件的群反馈" icon={<MessageSquare />} />}
    </>}
  </Section>;
}

type FeedbackItem = Discussion['items'][number];
function Feedback({ item, project, workspace, route }: PageProps & { item: FeedbackItem }) {
  const [open, show] = useState(route.item === item.id);
  const { busy, run } = useActions();
  const [draft, set] = useStored('feedback-edit:' + item.id, { action: item.destination.action === 'review' ? 'project' : item.destination.action,
    ticket: item.destination.ticket ?? '', topic: item.destination.topic ?? '', agent: item.destination.agent ?? '', message: '' });
  const subjects = workspace.tickets.filter(t => t.work.project === project.id);
  return <article className="feedback" id={'feedback-' + item.id}>
    <div className="section-heading"><h3>{item.title}</h3><Pill tone={item.status === 'applied' ? 'neutral' : 'amber'}>{item.status === 'applied'
      ? destinations[item.destination.action] ?? '已归档' : '待确认'}</Pill></div>
    <Markdown text={item.reason} />
    {(item.evidence.length > 0 || item.sources.length > 0) && <details className="minor-disclosure">
      <summary>查看来源</summary>
      {item.evidence.map((entry, index) => <div className="record-row" key={index}><Source channel={entry.kind} />
        <Ext href={entry.url}>{entry.title}</Ext>{entry.revision && <code>{short(entry.revision, 12)}</code>}</div>)}
      {item.sources.map(source => <FeedbackSource key={source.id} source={source} project={project} />)}
    </details>}
    {item.ticket && <a className="text-button" href={routeFor(workspace.tickets.find(t => t.id === item.ticket)?.work.project ?? project.id, 'work', item.ticket)}>
      关联工单 <ArrowRight size={15} /></a>}
    {item.status !== 'applied' && project.maintain && (open
      ? <form className="form feedback-form" onSubmit={async e => {
        e.preventDefault();
        const result = await run(() => api<{ ticket?: string }>('discussion/' + item.id + '/resolve', {
          action: draft.action, message: draft.message || undefined,
          ...(draft.action === 'link' ? { ticket: draft.ticket } : {}),
          ...(['topic','create'].includes(draft.action) ? { topic: draft.topic || undefined } : {}),
          ...(draft.action === 'create' ? { agent: draft.agent || undefined } : {}),
        }), '已处理群反馈');
        if (result) { show(false); if (result.ticket) go(project.id, 'work', result.ticket); }
      }}>
        <div className="form-grid">
          <Field label="去向"><select value={draft.action} onChange={e => set({ ...draft, action: e.target.value as typeof draft.action })}>
            {Object.entries(destinations).filter(([id]) => id !== 'review').map(([id, label]) => <option key={id} value={id}>{id === 'link' ? '接续已有工单' : label}</option>)}
          </select></Field>
          {item.sources.length > 1 && <Field label="处理范围"><select value={draft.message} onChange={e => set({ ...draft, message: e.target.value })}>
            <option value="">此条归纳的全部消息</option>{item.sources.map(s => <option key={s.id} value={s.id}>{s.member ?? '发言人'}{s.at ? ' · ' + date(new Date(s.at).toISOString()) : ''}</option>)}</select></Field>}
        </div>
        {draft.action === 'link' && <Field label="已有工单"><select value={draft.ticket} onChange={e => set({ ...draft, ticket: e.target.value })} required>
          <option value="">选择工单</option>{subjects.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>}
        {['topic','create'].includes(draft.action) && <Field label="主题"><select value={draft.topic} onChange={e => set({ ...draft, topic: e.target.value })}
          required={draft.action === 'topic'}><TopicOptions project={project} empty="当前项目" /></select></Field>}
        {draft.action === 'create' && <Field label="执行 Agent"><select value={draft.agent} onChange={e => set({ ...draft, agent: e.target.value })}>
          <AgentOptions agents={workspace.agents.filter(a => a.active && a.projects.includes(project.id))} allLabel="依据项目分工" /></select></Field>}
        <div className="actions"><Button size="sm" type="submit" disabled={busy}>确认去向</Button><Button size="sm" type="button" variant="ghost" onClick={() => show(false)}>收起</Button></div>
      </form>
      : <Button size="sm" variant="outline" onClick={() => show(true)}>处理反馈</Button>)}
  </article>;
}

function FeedbackSource({ source, project }: { source: FeedbackItem['sources'][number]; project: PageProps['project'] }) {
  const [open, show] = useState(false);
  const data = useData<{ revisions: { revision: string; text?: string; at: string }[] }>(open
    ? 'discussion/' + project.id + '/revisions/' + source.id : '');
  return <div className="revision-note">
    <div className="record-row"><Ext href={source.url}>{source.member ?? '飞书发言'}</Ext>
      {source.currentRevision && <code>{short(source.currentRevision)}</code>}
      {project.maintain && <Button size="sm" variant="ghost" onClick={() => show(!open)}>{open ? '收起原消息' : '原消息修订'}</Button>}</div>
    {open && (data.error ? <Failure error={data.error} /> : !data.data ? <Loading /> : data.data.revisions.map(r =>
      <div className="revision-note" key={r.revision}><time>{date(r.at)}</time><p>{r.text ?? '正文不可读'}</p></div>))}
  </div>;
}

export function AccountsPage({ workspace }: PageProps) {
  const channels = useData<Channels>(workspace.crossChannel ? 'channels' : '', 3200);
  const [proofs, save] = useStored<Partial<Record<'feishu' | 'github', string>>>('account-proof', {});
  const [unlink, setUnlink] = useState<Channels['accounts'][number]>();
  const { busy, run } = useActions();
  return <div className="page-scroll"><div className="project-page">
    <header className="object-header"><div className="object-emblem"><Plug2 size={24} /></div><div><h1>连接与账号</h1></div></header>
    {!workspace.crossChannel ? <Empty title="跨渠道账号绑定尚未启用" icon={<Plug2 />} />
      : channels.error ? <Failure error={channels.error} retry={() => void channels.refetch()} /> : !channels.data ? <Loading />
      : <div className="detail-stack">{(['feishu','github'] as const).map(provider => {
        const accounts = channels.data!.accounts.filter(a => a.provider === provider);
        const proof = channels.data!.proofs.find(p => p.provider === provider);
        return <Section key={provider} title={provider === 'feishu' ? '飞书账号' : 'GitHub 账号'}
          action={<Button variant="outline" size="sm" disabled={busy} onClick={async () => {
            const result = await run(() => api<{ command: string }>('channels/proof', { provider }));
            if (result) save({ ...proofs, [provider]: result.command });
          }}><Link2 />绑定账号</Button>}>
          {accounts.length ? accounts.map(a => <div className="record-row" key={a.namespace + a.id}>
            <Avatar value={a.label} /><strong>{a.label}</strong><Pill tone="green">已验证</Pill>
            <Button size="sm" variant="ghost" onClick={() => setUnlink(a)}>解除绑定</Button>
          </div>) : <p className="muted-text">暂无已绑定账号。</p>}
          {proof?.sender ? <div className="record-row"><span>{proof.sender.label} 已发来验证</span><Ext href={proof.url ?? undefined}>验证消息</Ext>
            <Button size="sm" disabled={busy} onClick={() => void run(() => api('channels/confirm', {
              provider, namespace: proof.sender!.namespace, id: proof.sender!.id,
            }), '账号已绑定')}>确认绑定</Button></div> : proof && proofs[provider] ? <div className="proof-box">
              <p>{provider === 'feishu' ? '把这条命令发给飞书机器人单聊。' : '在项目已接入的 GitHub 仓库 Issue 下评论这条命令。'}</p>
              <code>{proofs[provider]}</code><Button size="sm" variant="ghost" onClick={() => void run(async () => {
                await navigator.clipboard.writeText(proofs[provider]!); return true;
              }, '已复制验证命令')}><Clipboard />复制</Button>
            </div> : null}
        </Section>;
      })}</div>}
    <a className="muted-text text-sm" href="/licenses/paperclip" target="_blank" rel="noopener noreferrer">开源许可</a>
  </div>
  {unlink && <Modal title="解除账号绑定" close={() => setUnlink(undefined)}><div className="form"><p>解除 {unlink.label} 后，此账号的新消息将无法以你的身份发起协作。</p>
    <div className="form-actions"><Button variant="destructive" disabled={busy} onClick={async () => {
      if (await run(() => api('channels/unlink', { provider: unlink.provider, namespace: unlink.namespace, id: unlink.id }), '账号绑定已解除')) setUnlink(undefined);
    }}>解除绑定</Button></div>
  </div></Modal>}
  </div>;
}
