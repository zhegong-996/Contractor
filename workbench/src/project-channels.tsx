import { useState } from 'react';
import { Link2, Plus } from 'lucide-react';
import { api, useData, type Project, type ProjectChannels, type Ticket, type TopicContacts } from './api.ts';
import { Button } from './components/button.tsx';
import { Input } from './components/input.tsx';
import { routeFor } from './navigation.ts';
import { Ext, Failure, Field, Loading, Modal, Pill, Section, Source, sourceName, topicName, TopicOptions, useActions } from './ui.tsx';

export function FeishuTopics({ project, channels }: { project: Project; channels: ProjectChannels }) {
  const [mode, setMode] = useState<'link' | 'publish'>();
  const { busy, run } = useActions();
  const { groups, mappings, enabled, publishAvailable } = channels.feishuTopics;
  const admin = project.maintain && enabled && groups.length > 0;
  if (!enabled && !mappings.length) return null;
  return <Section title="飞书话题" action={admin && project.topics.length > 0 ? <div className="actions">
    <Button variant="outline" size="sm" onClick={() => setMode('link')}><Link2 />关联已有话题</Button>
    {publishAvailable && <Button variant="outline" size="sm" onClick={() => setMode('publish')}><Plus />在飞书创建话题</Button>}
  </div> : undefined}>
    {mappings.map(row => <div className="record-row" key={row.chat + '/' + row.root}>
      <a href={routeFor(project.id, 'chat', row.topic)}>{topicName(project, row.topic)}</a>
      <span>{project.resources.find(ref => ref.source === 'feishu' && ref.externalId === row.chat)?.label ?? row.chat}</span>
      <Ext href={row.url}>飞书原话题</Ext>
    </div>)}
    {!mappings.length && <p className="muted-text">{!project.topics.length ? '先在项目结构中新建主题。'
      : admin ? '为项目主题关联一个飞书话题。共享群按具体话题接收消息。' : '暂无关联的飞书话题。'}</p>}
    {mode && <Modal title={mode === 'link' ? '关联已有飞书话题' : '在飞书创建话题'} close={() => setMode(undefined)}>
      <form className="form" onSubmit={async event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        if (await run(() => api('project/' + project.id + '/feishu-topic', { chat: form.get('chat'), topic: form.get('topic'),
          ...(mode === 'link' ? { source: form.get('source') } : { label: form.get('label') }) }),
        mode === 'link' ? '话题已关联' : '飞书话题已创建并关联')) setMode(undefined);
      }}>
        <Field label="项目主题"><select name="topic" required><TopicOptions project={project} empty="选择主题" /></select></Field>
        <Field label="飞书群"><select name="chat" required>{groups.map(chat => <option key={chat} value={chat}>
          {project.resources.find(ref => ref.source === 'feishu' && ref.externalId === chat)?.label ?? chat}</option>)}</select></Field>
        {mode === 'link' ? <Field label="飞书原话题链接或根消息 ID"><Input name="source" maxLength={600} required /></Field>
          : <Field label="群内公开标题" hint="群内可见此标题和工作台入口。正文权限由工作台控制。"><Input name="label" maxLength={100} required /></Field>}
        <div className="form-actions"><Button disabled={busy} type="submit">{mode === 'link' ? '关联' : '在群里发布'}</Button></div>
      </form>
    </Modal>}
  </Section>;
}

export function ChannelWorkLink({ project, ticket, actor }: { project: Project; ticket: Ticket; actor: string }) {
  const canShare = project.mayStart && (ticket.work.requester === actor || project.maintain) && !!ticket.work.topic
    && !ticket.work.consultation && !ticket.work.personal;
  const connected = useData<ProjectChannels>(canShare ? 'project/' + project.id + '/channels' : '');
  const mappings = connected.data?.feishuTopics.publishAvailable ? connected.data.feishuTopics.mappings.filter(row => row.topic === ticket.work.topic) : [];
  const alternatives = ticket.imPublications;
  const options = [...mappings.map(row => ({ id: 'feishu:' + row.chat, label: '飞书 · ' + (project.resources.find(ref => ref.externalId === row.chat)?.label ?? row.chat) })),
    ...alternatives.map(row => ({ id: row.destination, label: sourceName(row.kind) + ' · ' + row.label + (row.tag ? ' / ' + row.tag : '') }))];
  const [open, show] = useState(false);
  const [published, setPublished] = useState<string>();
  const { busy, run } = useActions();
  if (!canShare || !options.length) return null;
  return <><Button size="sm" variant="outline" onClick={() => show(true)}><Link2 />同步工单入口</Button>
    {open && <Modal title="同步工单入口" close={() => show(false)}><form className="form" onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const value = String(form.get('destination'));
      const path = 'ticket/' + ticket.id + '/';
      const isFeishu = value.startsWith('feishu:');
      const result = await run(() => api<{ url?: string }>(path + (isFeishu ? 'publish-feishu' : 'publish-im'),
        isFeishu ? { chat: value.slice(7) } : { destination: value }), isFeishu ? '工单入口已同步' : '工单入口已进入发送队列');
      if (result) setPublished(result.url);
    }}><Field label="发布到已关联会话" hint="会话里可见工作台入口，工单正文按项目权限查看。">
      <select name="destination" required>{options.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></Field>
      {published && <div className="inline-meta"><Pill tone="green">已同步</Pill><Ext href={published}>查看飞书原消息</Ext></div>}
      {alternatives.filter(row => row.state).map(row => <div className="record-row" key={row.destination}><Source channel={row.kind} /><span>{row.label}</span>
        <Pill tone={row.state === 'sent' ? 'green' : 'amber'}>{row.state === 'sent' ? '已送达' : row.state === 'pending' ? '等待送达' : '待人工核对回执'}</Pill></div>)}
      <div className="form-actions"><Button disabled={busy} type="submit">发布入口</Button></div>
    </form></Modal>}
  </>;
}

export function IMTopics({ project, channels }: { project: Project; channels: ProjectChannels }) {
  const [open, show] = useState(false);
  const { busy, run } = useActions();
  const options = channels.imTopics.filter(row => row.available);
  if (!channels.imTopics.length) return null;
  return <Section title="其他 IM 会话" action={options.length && project.topics.length ?
    <Button variant="outline" size="sm" onClick={() => show(true)}>关联会话</Button> : undefined}>
    {channels.imTopics.filter(row => !row.available).map(row => <div className="record-row" key={row.id}>
      <Source channel={row.kind} /><span>{row.label}</span><a href={routeFor(project.id, 'chat', row.topic)}>{topicName(project, row.topic)}</a>
      {row.tag && <code>[主题:{row.tag}]</code>}
      <Pill tone={channels.im.find(item => item.connector === row.connector)?.ready ? 'green' : 'amber'}>
        {channels.im.find(item => item.connector === row.connector)?.ready ? '已连接' : '连接待就绪'}</Pill>
    </div>)}
    {open && <Modal title="关联 IM 会话" close={() => show(false)}><form className="form" onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const location = options.find(row => row.id === form.get('route'));
      if (location && await run(() => api('project/' + project.id + '/im-topic', { connector: location.connector, chat: location.chat,
        thread: location.thread, topic: form.get('topic'), tag: String(form.get('tag')).trim() || undefined }), '会话已关联')) show(false);
    }}><Field label="接入会话"><select name="route" required>{options.map(row =>
      <option key={row.id} value={row.id}>{sourceName(row.kind)} · {row.label}</option>)}</select></Field>
      <Field label="项目主题"><select name="topic" required><TopicOptions project={project} empty="选择主题" /></select></Field>
      <Field label="共享会话的主题标识（选填）" hint="例如 mobile。多人共用一群时，在消息开头写 [主题:mobile]，再输入正文。">
        <Input name="tag" maxLength={32} pattern="[a-z][a-z0-9\-]{0,31}" placeholder="例如 mobile" /></Field>
      <div className="form-actions"><Button type="submit" disabled={busy}>关联</Button></div>
    </form></Modal>}
  </Section>;
}

export function TopicContactSettings({ project, topic, close }: { project: Project; topic: string; close: () => void }) {
  const route = 'project/' + project.id + '/topic-contacts/' + topic;
  const data = useData<TopicContacts>(route);
  const { run, busy } = useActions();
  return <Modal title="配置主题的只读 Agent" close={close}>
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : !data.data ? <Loading /> : data.data.provisioned
      ? <p className="muted-text">此主题的 Agent 和资料范围由部署者配置。</p>
      : <form className="form" onSubmit={async event => {
        event.preventDefault(); const agents = new FormData(event.currentTarget).getAll('agent');
        if (agents.length <= 4 && await run(() => api(route, { agents }), '只读 Agent 已保存')) close();
      }}><fieldset className="selection"><legend>选择最多四个已加入项目的 Agent</legend>
        {data.data.agents.map(agent => <label key={agent.id} className="check-row">
          <input type="checkbox" name="agent" value={agent.id} defaultChecked={data.data!.chosen.includes(agent.id)} />
          <span>{agent.title} · {agent.owner}</span>
        </label>)}
        {!data.data.agents.length && <p className="muted-text">请先让 Agent 所有者把 Agent 加入项目。</p>}
      </fieldset><div className="form-actions"><Button type="submit" disabled={busy}>保存</Button></div></form>}
  </Modal>;
}
