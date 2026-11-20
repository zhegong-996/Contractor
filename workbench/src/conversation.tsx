import { TextArea } from './components/input.tsx';
import { Fragment, useEffect, useState } from 'react';
import { Bot, Send } from 'lucide-react';
import { api, uid, useMessages, type Agent } from './api.ts';
import { Markdown } from './markdown.tsx';
import { Avatar, date, Failure, Field, Loading, Source, sourceName, useActions, useSessionScroll, useStored } from './ui.tsx';
import { Button } from './components/button.tsx';
import { routeFor, type PageProps } from './navigation.ts';
import { selectedRosterIds, TopicMemberPicker } from './octop/TopicMemberPicker.tsx';
import { SignedTopicReply } from './octop/SignedTopicReply.tsx';
import { ExecutionEnvironment, executionTargetState, useExecutionTargets } from './execution-target.tsx';

type ConversationDraft = { text: string; nonce: string; consultants: string[]; device?: { agent: string; id: string } };

export function Conversation({ project, workspace, openTask, ticket, topic, canReplyInFeishu, route, desk = false }: PageProps & {
  ticket?: string; topic?: string; canReplyInFeishu?: boolean; desk?: boolean;
}) {
  const base = 'project/' + project.id + '/messages';
  const filter = ticket ? '?ticket=' + encodeURIComponent(ticket) : topic ? '?topic=' + encodeURIComponent(topic) : '';
  const reply = !ticket && route.reply;
  const data = useMessages(base + filter + (reply ? (filter ? '&' : '?') + 'reply=' + encodeURIComponent(reply) : ''));
  const [draft, setDraft] = useStored<ConversationDraft>('conversation:' + base + filter, { text: '', nonce: uid(), consultants: [] });
  const [agent, setAgent] = useState('');
  const [feishu, setFeishu] = useState(false);
  const [source, setChannel] = useStored('conversation-source:' + base + filter + (reply ? ':' + reply : ''), '');
  const [showRoster, setShowRoster] = useState(false);
  const { run, busy } = useActions();
  const agents: Agent[] = workspace.agents.filter(item => item.active && item.projects.includes(project.id));
  const registered = project.topics.find(item => item.id === topic)?.consultants ?? [];
  const consultants = ticket ? [] : agents.filter(item => registered.includes(item.id));
  const selected = selectedRosterIds(draft.consultants ?? [], consultants);
  const runnerAgent = selected.length === 1 ? consultants.find(item => item.id === selected[0])
    : consultants.length === 0 ? agents.find(item => item.id === agent) : undefined;
  const device = runnerAgent && draft.device?.agent === runnerAgent.id ? draft.device.id : '';
  const targets = useExecutionTargets(!reply && project.mayStart && runnerAgent ? project.id : undefined);
  const targetState = runnerAgent && executionTargetState(targets, runnerAgent, device);
  const needsDevice = !!targetState && (device ? targetState.ready && !targetState.selected : targetState.needsChoice);
  const preferred = route.participant && consultants.some(item => item.id === route.participant) ? route.participant : undefined;
  useEffect(() => {
    if (preferred) setDraft({ ...draft, consultants: [preferred], device: draft.device?.agent === preferred ? draft.device : undefined });
  }, [preferred]);
  const channels = [...new Set(data.rows?.map(item => item.channel) ?? [])];
  const channel = channels.includes(source) ? source : '';
  const visible = data.rows?.filter(item => !desk || !channel || item.channel === channel);
  const members = new Map(project.members.map(member => [member.name, member]));
  const scroll = useSessionScroll(JSON.stringify(['messages', base, filter, reply, channel]), { ready: desk && !!data.data });
  const messageLabel = selected.length ? '只读咨询' : '发送给项目成员';
  const messageInput = <TextArea rows={desk ? 2 : 3} maxLength={3500} value={draft.text} required
    aria-label={desk ? messageLabel : undefined}
    placeholder={desk ? (selected.length ? '向所选 Agent 提问…' : '输入消息…') : undefined}
    onChange={event => setDraft({ ...draft, text: event.target.value })} />;
  return <div className={desk ? 'conversation-desk' : 'detail-stack'}>
    {desk && channels.length > 0 && <div className="conversation-filter"><select aria-label="筛选消息来源" value={channel}
      onChange={event => setChannel(event.target.value)}><option value="">全部来源</option>{channels.map(item =>
        <option value={item} key={item}>{sourceName(item)}</option>)}</select></div>}
    <div className={desk ? 'conversation-scroll' : undefined} {...(desk && scroll)}>
    {reply && <a className="text-button" href={desk ? routeFor(project.id, 'chat', topic) : routeFor(project.id, 'project', topic, 'chat')}>返回主题讨论</a>}
    {data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
    {desk && data.isPending && <Loading />}
    {data.hasNextPage && <Button size="sm" variant="ghost" disabled={data.isFetching} onClick={() => void data.fetchNextPage()}>加载更早消息</Button>}
    {desk && visible?.length === 0 && <p className="conversation-empty">{channel ? '此来源暂无消息' : '还没有消息，可以在这里发起讨论。'}</p>}
    {!data.error && !!visible?.length && <div className="timeline" aria-label="成员讨论">
      {visible.map(item => <Fragment key={item.id}><article className="timeline-entry member-message">
        <Avatar avatar={members.get(item.actor)?.avatar} value={item.actor} /><div className="message">
          <div className="message-meta"><strong title={item.actor}>{members.get(item.actor)?.displayName ?? item.actor}</strong><Source channel={item.channel} /><time>{date(item.at)}</time></div>
          <Markdown text={item.text} />
        </div>
      </article>{item.consultations?.map(reply => <SignedTopicReply key={reply.ticket} project={project.id} reply={reply} />)}</Fragment>)}
    </div>}
    </div>
    {!reply && project.mayStart && <form className={desk ? 'form conversation-composer' : 'form'} onSubmit={async event => {
      event.preventDefault();
      const text = draft.text.trim();
      if (!text || needsDevice) return;
      if (!consultants.length && agent) { openTask({ topic, parent: ticket, agent, device: device || undefined, request: text }); return; }
      if (await run(() => selected.length
        ? api('project/' + project.id + '/consult', { text, nonce: draft.nonce, topic, agents: selected, device: device || undefined })
        : api(base, { text, nonce: draft.nonce, ticket, topic, feishu: canReplyInFeishu && feishu }),
        selected.length ? '咨询已交给所选 Agent' : feishu ? '消息已记录，准备同步到飞书' : '消息已发送')) {
        setDraft({ text: '', nonce: uid(), consultants: [] });
        setFeishu(false);
        setChannel('');
        await data.refetch();
      }
    }}>
      {desk ? messageInput : <Field label={messageLabel}>{messageInput}</Field>}
      {canReplyInFeishu && !agent && <label className="check-row">
        <input type="checkbox" checked={feishu} onChange={event => setFeishu(event.target.checked)} />同时回复飞书原话题
      </label>}
      {!!consultants.length && (!desk || showRoster) && <TopicMemberPicker agents={consultants} value={draft.consultants ?? []}
        onChange={consultants => setDraft({ ...draft, consultants,
          device: consultants.length === 1 && draft.device?.agent === consultants[0] ? draft.device : undefined })} />}
      {runnerAgent && <ExecutionEnvironment project={project.id} agent={runnerAgent} targets={targets} value={device}
        connectUrl={runnerAgent.owner === workspace.actor && runnerAgent.executionCapabilities.remote ? workspace.runnerConnectUrl : undefined}
        onChange={id => setDraft({ ...draft, device: id ? { id, agent: runnerAgent.id } : undefined })} />}
      <div className="form-actions">
        {desk && !!consultants.length && <Button size="sm" variant="ghost" className="consultant-picker" aria-expanded={showRoster} type="button"
          onClick={() => setShowRoster(!showRoster)}>
          <Bot />{showRoster ? '收起 Agent 列表' : selected.length ? '已选 ' + selected.length + ' 位 Agent' : '选择咨询 Agent'}
        </Button>}
        {!consultants.length && !!agents.length && <select aria-label="委托 Agent" value={agent} onChange={event => {
          setAgent(event.target.value);
          if (draft.device) setDraft({ ...draft, device: undefined });
        }}>
          <option value="">仅发消息</option>
          {agents.map(item => <option key={item.id} value={item.id}>交给 {item.title}</option>)}
        </select>}
        <Button size="sm" type="submit" disabled={busy || needsDevice || !draft.text.trim()}>{desk && <Send />}
          {selected.length ? '发起只读咨询' : agent ? '确认委托' : '发送'}</Button>
      </div>
    </form>}
  </div>;
}
