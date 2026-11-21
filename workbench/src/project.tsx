import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Clipboard, FolderKanban, GitBranch, Link2, MessageSquare, Plus, Plug2 } from 'lucide-react';
import { ProjectPermissions } from './access-settings.tsx';
import { roleLabel } from './platform-access.tsx';
import { api, useData, useTickets, type Channels, type Discussion, type FigmaSourceStatus, type GitHubConnection, type Imported, type ProjectChannels, type Resource } from './api.ts';
import { TicketPicker } from './components/ticket-picker.tsx';
import { go, projectWorkRoute, routeFor, type PageProps } from './navigation.ts';
import { AgentOptions } from './creation.tsx';
import { Receipts } from './agents.tsx';
import { ProjectRoutingPanel } from './operations-settings.tsx';
import { ProjectRegression } from './project-regression.tsx';
import { Button } from './components/button.tsx';
import { Input } from './components/input.tsx';
import { TabsContent } from './components/page-tabs.tsx';
import { Markdown } from './markdown.tsx';
import { Avatar, date, Empty, Ext, Failure, Field, Loading, MaterialIcon, Modal, PageTabs, Pill, Section, short, Source,
  TicketStatus, TopicOptions, topicName, useActions, useStored, Version } from './ui.tsx';

const tabs = [['structure', '项目结构'], ['sources', '资料与连接'], ['discussion', '群反馈'], ['regression', '回归评估'], ['usage', '用量'],
  ['settings', '项目设置'], ['routing', '职责与路由']] as const;
export function ProjectPage(props: PageProps) {
  const { project, route } = props;
  const shown = tabs.filter(([id]) => (id !== 'discussion' || !!project.discussion) && (!['settings', 'routing'].includes(id) || project.maintain));
  const tab = shown.find(([id]) => id === route.tab)?.[0] ?? 'structure';
  return <div className="page-scroll"><div className="project-page">
    <header className="object-header"><div className="object-emblem"><FolderKanban size={25} /></div>
      <div className="min-w-0"><h1>{project.title}</h1><div className="object-meta"><span>{project.members.length} 位成员</span>
        <span>{project.topics.length} 个主题</span><span>{project.resources.filter(r => r.state === 'bound').length} 个来源</span></div></div>
      <div className="actions object-action">
        <a className="text-button" href={routeFor(project.id, 'chat', undefined, 'project')}><MessageSquare size={16} />项目讨论</a>
      </div>
    </header>
    {['settings', 'routing'].includes(route.tab ?? '') && !project.maintain && <Failure error={new Error('当前账号没有项目设置权限。')} />}
    <PageTabs label="项目详情" value={tab} items={shown} onChange={value => go(project.id, 'project', undefined, value)}>
      <TabsContent value="structure" className="detail-stack"><Structure {...props} /></TabsContent>
      <TabsContent value="sources" className="detail-stack"><Sources {...props} /></TabsContent>
      {project.discussion && <TabsContent value="discussion" className="detail-stack"><GroupFeedback {...props} /></TabsContent>}
      <TabsContent value="regression" className="detail-stack"><ProjectRegression project={project} /></TabsContent>
      <TabsContent value="usage" className="detail-stack"><Receipts project={project.id} /></TabsContent>
      {project.maintain && <TabsContent value="settings" className="detail-stack"><ProjectPermissions project={project.id} actor={props.workspace.actor}
        afterTransfer={() => go(project.id, 'project', undefined, 'structure')} /></TabsContent>}
      {project.maintain && <TabsContent value="routing" className="detail-stack"><ProjectRoutingPanel project={project.id} /></TabsContent>}
    </PageTabs>
  </div></div>;
}

function Structure({ workspace, project, openTask }: PageProps) {
  const related = workspace.projects.filter(p => p.parent === project.id || project.relatedProjects.includes(p.id) || p.id === project.parent);
  const [open, show] = useState(false);
  const [agentForm, setAgentForm] = useState(false);
  const own = workspace.ownAgents.filter(item => !item.projects.includes(project.id));
  const projectAgents = workspace.agents.filter(item => item.projects.includes(project.id));
  const { busy, run } = useActions();
  const work = useTickets({ project: project.id, purpose: 'work', limit: 6 }, true, 4000);
  return <>
    {!!related.length && <Section title="项目关系">{related.map(p => <a className="record-row" key={p.id} href={routeFor(p.id, 'project')}>
      <GitBranch size={16} /><strong>{p.title}</strong><span>{p.parent === project.id ? '子项目' : p.id === project.parent ? '上级项目' : '关联项目'}</span><ArrowRight size={15} />
    </a>)}</Section>}
    <Section title="主题" action={project.maintain ? <Button variant="outline" size="sm" onClick={() => show(true)}><Plus />新建主题</Button> : undefined}>
      {project.topics.length ? project.topics.map(topic => <div className="topic-row" key={topic.id} data-child={!!topic.parent}>
        <MessageSquare size={16} /><a href={routeFor(project.id, 'chat', topic.id)}><strong>{topic.title}</strong></a>{topic.parent && <small>{topicName(project, topic.parent)}</small>}
        <a className="text-button" href={projectWorkRoute(project.id, topic.id)}>查看工单<ArrowRight size={14} /></a>
        {project.mayStart && <Button size="sm" variant="ghost" onClick={() => openTask({ topic: topic.id })}>发起</Button>}
      </div>) : <p className="muted-text">暂无主题。</p>}
    </Section>
    <Section title="项目工单" action={<a className="text-button" href={projectWorkRoute(project.id)}>全部工单 <ArrowRight size={15} /></a>}>
      {work.error ? <Failure error={work.error} retry={() => void work.refetch()} /> : work.isPending ? <Loading />
        : work.rows.length ? work.rows.map(item => <a className="project-ticket-row" href={routeFor(project.id, 'work', item.id)} key={item.id}>
          <code title={item.id}>{short(item.id)}</code><strong>{item.title}</strong>
          {item.work.version && <Version version={item.work.version} />}<TicketStatus ticket={item} />
        </a>) : <p className="muted-text">暂无工单。</p>}
    </Section>
    <Section title="项目成员">
      <div className="member-grid">{project.members.map(m => <div className="member" key={m.name}><Avatar avatar={m.avatar} value={m.name} />
        <div><strong title={m.name}>{m.displayName ?? m.name}</strong><small>{roleLabel[m.maintain ? 'maintainer' : m.mayCollaborate ? 'collaborator' : 'reader']}
          {m.responsibilities.length > 0 && ' · ' + m.responsibilities.map(r => workspace.functions.find(f => f.id === r)?.title ?? r).join('、')}</small>
          {m.bio && <p className="profile-bio">{m.bio}</p>}</div>
      </div>)}</div>
    </Section>
    <Section title="项目 Agent" action={project.mayStart && own.length ? <Button variant="outline" size="sm" onClick={() => setAgentForm(true)}><Plus />加入我的 Agent</Button> : undefined}>
      {projectAgents.map(agent => <div className="record-row" key={agent.id}><strong>{agent.title}</strong><span>{agent.owner}</span></div>)}
      {!projectAgents.length && <p className="muted-text">暂无已加入的 Agent。</p>}
    </Section>
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
  const github = useData<GitHubConnection[]>('project/' + project.id + '/github-connections', 5000);
  const channels = useData<ProjectChannels>('project/' + project.id + '/channels', 5000);
  const figma = useData<FigmaSourceStatus[]>(project.importableSources.some(ref => ref.source === 'figma')
    ? 'project/' + project.id + '/figma-sources' : '', 5000);
  return <><Section title="项目来源" action={project.maintain ? <div className="actions">
    {!!workspace.feishuGroups.length && <Button size="sm" variant="outline" onClick={() => setGroup(true)}>绑定飞书群</Button>}
    <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus />关联资料</Button></div> : undefined}>
    {github.error && <Failure error={github.error} retry={() => void github.refetch()} />}
    {figma.error && <Failure error={figma.error} retry={() => void figma.refetch()} />}
    {project.resources.length ? project.resources.map(ref => <ResourceRow refInfo={ref} key={ref.ref} project={project}
      connection={ref.source === 'github' ? github.data?.find(repo => repo.repository === ref.externalId.toLowerCase()) : undefined}
      figma={figma.data?.find(status => status.resource === ref.ref)}
      feishu={ref.source === 'feishu' && ref.state === 'bound' && channels.data ? { online: channels.data.feishuReady,
        history: channels.data.feishuHistory.find(history => history.resource === ref.ref) } : undefined} />)
      : <Empty title="暂无项目来源" icon={<Link2 />} />}
    {channels.data?.im.map(item => <div className="resource-row" key={item.connector}>
      <MaterialIcon /><div><strong><Source channel={item.kind} /></strong><div className="inline-meta">{item.topics.map(topic =>
        <a href={routeFor(project.id, 'chat', topic)} key={topic}>{topicName(project, topic)}</a>)}</div></div>
      <Pill tone={item.ready ? 'green' : 'amber'}>{item.ready ? '在线' : '未就绪'}</Pill>
    </div>)}
    {channels.error && <Failure error={channels.error} retry={() => void channels.refetch()} />}
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

function ResourceRow({ refInfo, project, connection, figma, feishu }: { refInfo: Resource; project: PageProps['project']; connection?: GitHubConnection;
  figma?: FigmaSourceStatus; feishu?: { online: boolean; history?: ProjectChannels['feishuHistory'][number] } }) {
  const { run, busy } = useActions();
  const reason = connection?.failure?.reason;
  return <div className="resource-row"><MaterialIcon /><div>
    <strong><Ext href={refInfo.url}>{refInfo.label}</Ext></strong>
    <div className="inline-meta"><Source channel={refInfo.source} />
      <span>{({ discussion: '讨论入口', reference: '参考资料', delivery: '交付仓库' })[refInfo.purpose]}</span>{refInfo.revision && <code>{short(refInfo.revision, 12)}</code>}</div>
    {connection && <div className="inline-meta">
      <Pill tone={connection.state === 'ready' ? 'green' : connection.state === 'unavailable' ? 'amber' : 'neutral'}>
        {({ ready: '同步正常', connecting: '等待首次同步', disabled: '未启用同步', unavailable: '同步异常' })[connection.state]}
      </Pill>
      {reason && <span>{({ network: '网络连接失败', 'rate-limit': 'GitHub 限流', access: '仓库访问失败', sync: '数据同步未完成' })[reason]}</span>}
      {connection.lastSuccessAt && <span>上次成功 {date(connection.lastSuccessAt, true)}</span>}
    </div>}
    {feishu && <div className="inline-meta"><Pill tone={feishu.online ? 'green' : 'amber'}>{feishu.online ? '飞书入口在线' : '飞书入口未就绪'}</Pill>
      {feishu.history && <><span>{feishu.history.state ? ({ ready: '补读已核对', partial: '补读尚有缺口',
        failed: '补读失败', unauthorized: '补读授权失效' })[feishu.history.state] : '等待首次补读'}</span>
        {feishu.history.at && <time>{date(new Date(feishu.history.at).toISOString(), true)}</time>}</>}
    </div>}
    {figma && <div className="inline-meta"><Pill tone={figma.state === 'verified' ? 'green' : 'amber'}>
      {({ verified: '源站权限已核对', unverified: '等待核对源站权限', unavailable: '源站资料不可用' })[figma.state]}</Pill>
      {figma.revision && <code title={figma.revision}>源版本 {short(figma.revision, 12)}</code>}
      {figma.checkedAt && <time>{date(new Date(figma.checkedAt).toISOString(), true)}</time>}
      {figma.candidate && <a href={routeFor(project.id, 'knowledge', figma.candidate, figma.knowledgeState === 'candidate' ? 'review' : 'current')}>
        {figma.knowledgeState === 'candidate' ? '查看知识候选' : '查看关联知识'}</a>}
      {project.importableSources.some(source => source.ref === refInfo.ref) && <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
        const result = await run(() => api<Imported>('project/' + project.id + '/knowledge-import', { resource: refInfo.ref }), '已核对来源版本');
        if (result) go(project.id, 'knowledge', result.id, result.state === 'published' ? 'current' : 'review');
      }}>核对源版本</Button>}
    </div>}
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
    {item.ticket && <a className="text-button" href={routeFor(project.id, 'work', item.ticket)}>
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
        {draft.action === 'link' && <Field label="已有工单"><TicketPicker projects={[project]} value={draft.ticket} onChange={ticket => set({ ...draft, ticket })} /></Field>}
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

export function AccountsPage({ workspace, embedded = false }: Pick<PageProps, 'workspace'> & { embedded?: boolean }) {
  const enabled = workspace.crossChannel || workspace.imAccountBinding;
  const channels = useData<Channels>(enabled ? 'channels' : '', 3200);
  const [proofs, save] = useStored<Partial<Record<'feishu' | 'github' | 'octop', string>>>('account-proof', {});
  const [unlink, setUnlink] = useState<Channels['accounts'][number]>();
  const { busy, run } = useActions();
  const content = <>
    {!enabled ? <Empty title="跨渠道账号绑定尚未启用" icon={<Plug2 />} />
      : channels.error ? <Failure error={channels.error} retry={() => void channels.refetch()} /> : !channels.data ? <Loading />
      : <div className="detail-stack">{(['feishu','github','octop'] as const).filter(provider => provider === 'octop'
        ? workspace.imAccountBinding || channels.data!.accounts.some(account => account.provider === 'octop') : workspace.crossChannel).map(provider => {
        const accounts = channels.data!.accounts.filter(a => a.provider === provider);
        const proof = channels.data!.proofs.find(p => p.provider === provider);
        return <Section key={provider} title={provider === 'feishu' ? '飞书账号' : provider === 'github' ? 'GitHub 账号' : '其他 IM 账号'}
          action={(provider !== 'octop' || workspace.imAccountBinding) && <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
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
              <p>{provider === 'feishu' ? '把这条命令发给飞书机器人单聊。' : provider === 'github'
                ? '在项目已接入的 GitHub 仓库 Issue 下评论这条命令。' : '把这条命令发给已开启绑定的 IM 机器人单聊。'}</p>
              <code>{proofs[provider]}</code><Button size="sm" variant="ghost" onClick={() => void run(async () => {
                await navigator.clipboard.writeText(proofs[provider]!); return true;
              }, '已复制验证命令')}><Clipboard />复制</Button>
            </div> : null}
        </Section>;
      })}</div>}
    <div className="form-actions">
      <a className="muted-text text-sm" href="/licenses/components" target="_blank" rel="noopener noreferrer">组件许可</a>
      <a className="muted-text text-sm" href="/licenses/browser-dependencies" target="_blank" rel="noopener noreferrer">浏览器依赖许可</a>
    </div>
  {unlink && <Modal title="解除账号绑定" close={() => setUnlink(undefined)}><div className="form"><p>解除 {unlink.label} 后，此账号的新消息将无法以你的身份发起协作。</p>
    <div className="form-actions"><Button variant="destructive" disabled={busy} onClick={async () => {
      if (await run(() => api('channels/unlink', { provider: unlink.provider, namespace: unlink.namespace, id: unlink.id }), '账号绑定已解除')) setUnlink(undefined);
    }}>解除绑定</Button></div>
  </div></Modal>}
  </>;
  return embedded ? content : <div className="page-scroll"><div className="project-page">
    <header className="object-header"><div className="object-emblem"><Plug2 size={24} /></div><div><h1>连接与账号</h1></div></header>
    {content}
  </div></div>;
}
