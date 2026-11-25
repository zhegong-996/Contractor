import { TextArea } from './components/input.tsx';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bot, Send } from 'lucide-react';
import { api, uid, useData, useMessages, type Agent, type ConversationMessage, type ProjectChannels, type Ticket } from './api.ts';
import { Markdown } from './markdown.tsx';
import { Avatar, date, Ext, Failure, Field, Loading, short, Source, sourceName, useActions, useSessionScroll, useStored } from './ui.tsx';
import { Button } from './components/button.tsx';
import { routeFor, type PageProps } from './navigation.ts';
import { selectedRosterIds } from './octop/TopicMemberPicker.tsx';
import { MentionChips, MentionPopover } from './octop/AgentMention.tsx';
import { SignedTopicReply } from './octop/SignedTopicReply.tsx';
import { executionTargetState, useExecutionTargets, deviceLabelOf } from './execution-target.tsx';

type ConversationDraft = { text: string; nonce: string; consultants: string[]; devices?: { agent: string; device: string }[] };

type DiscussionMessage = Omit<ConversationMessage, 'channel' | 'sourceUrl'> & {
  channel: string; sourceUrl?: string;
  questionTitle?: string; url?: string; linkLabel?: string; inline?: boolean; commit?: string; revisions?: Ticket['channelHistory'][number]['revisions'];
};

function ticketDiscussion(ticket: Ticket, messages: ConversationMessage[]): DiscussionMessage[] {
  const rows = new Map<string, DiscussionMessage>();
  rows.set(ticket.origin, { id: ticket.origin, actor: ticket.work.requester, text: ticket.request, at: ticket.createdAt,
    channel: ticket.work.source, consultations: undefined });
  for (const item of ticket.history) {
    if (!rows.has(item.id)) rows.set(item.id, { ...item, channel: 'web', consultations: undefined });
  }
  for (const item of messages) rows.set(item.id, { ...rows.get(item.id), ...item });
  for (const item of ticket.channelHistory) rows.set(item.id, {
    ...rows.get(item.id), id: item.id, actor: item.member, text: item.text, at: item.at, channel: item.source, url: item.url,
    linkLabel: item.linkLabel, revisions: item.revisions, inline: item.github?.kind === 'inline', commit: item.github?.commit, consultations: undefined,
  });
  return [...rows.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function Conversation({ project, workspace, openTask, ticket, topic, route, desk = false }: PageProps & {
  ticket?: Ticket; topic?: string; desk?: boolean;
}) {
  const base = 'project/' + project.id + '/messages';
  const filter = ticket ? '?ticket=' + encodeURIComponent(ticket.id) : topic ? '?topic=' + encodeURIComponent(topic) : '';
  const reply = !ticket && route.reply;
  const data = useMessages(base + filter + (reply ? (filter ? '&' : '?') + 'reply=' + encodeURIComponent(reply) : ''));
  const activeTopic = ticket?.work.topic ?? topic;
  const connection = useData<ProjectChannels>(activeTopic ? 'project/' + project.id + '/channels?topic=' + encodeURIComponent(activeTopic) : '');
  const [publication, choosePublication] = useState('');
  const [draft, setDraft] = useStored<ConversationDraft>('conversation:' + base + filter, { text: '', nonce: uid(), consultants: [] });
  const [source, setChannel] = useStored('conversation-source:' + base + filter + (reply ? ':' + reply : ''), '');
  const [agent, setAgent] = useState('');
  const [mention, setMention] = useState<{ open: boolean; query: string; index: number }>({ open: false, query: '', index: 0 });
  const { run, busy, scrollPositions } = useActions();
  const agents: Agent[] = workspace.agents.filter(item => item.active && item.projects.includes(project.id));
  const registered = project.topics.find(item => item.id === topic)?.consultants ?? [];
  const consultants = ticket ? [] : agents.filter(item => registered.includes(item.id));
  const selected = selectedRosterIds(draft.consultants ?? [], consultants);
  const participants = selected.length ? selected.flatMap(id => consultants.filter(row => row.id === id)) : agents.filter(row => row.id === agent);
  const targets = useExecutionTargets(!reply && project.mayStart && participants.length ? project.id : undefined);
  const placements = participants.map(participant => {
    const device = draft.devices?.find(row => row.agent === participant.id)?.device ?? '';
    return { participant, device, target: executionTargetState(targets, participant, device) };
  });
  const needsDevice = placements.some(({ device, target }) => device ? !target.selected : target.needsChoice);
  const mentions = placements.map(({ participant, device, target }) => ({
    participant, device,
    choices: [{ id: '', label: device ? target.summary : (target.needsChoice ? '请选择执行设备' : target.summary) },
      ...target.choices.map(row => ({ id: row.id, label: deviceLabelOf(row) }))],
  }));
  const preferred = route.participant && consultants.some(item => item.id === route.participant) ? route.participant : undefined;
  useEffect(() => {
    if (preferred) setDraft({ ...draft, consultants: [preferred] });
  }, [preferred]);
  const messages: DiscussionMessage[] | undefined = ticket ? ticketDiscussion(ticket, data.error ? [] : data.rows ?? [])
    : data.rows?.map(row => ({ ...row, revisions: 'sourceRevisions' in row ? row.sourceRevisions : undefined }));
  const channels = [...new Set(messages?.map(item => item.channel) ?? [])];
  const filterable = desk || !!ticket;
  const channel = channels.includes(source) ? source : '';
  const answerRef = useRef<HTMLDetailsElement>(null);
  const originalReply = ticket && route.reply ? messages?.find(item => item.id === route.reply && item.questionTitle) : undefined;
  useLayoutEffect(() => {
    if (!originalReply || !answerRef.current) return;
    answerRef.current.open = true;
    answerRef.current.querySelector('summary')?.focus();
  }, [originalReply?.id]);
  const visible = messages?.filter(item => !filterable || !channel || item.channel === channel || item === originalReply);
  const members = new Map(project.members.map(member => [member.name, member]));
  const scrollKey = JSON.stringify(['messages', base, filter, reply, channel]);
  const scroll = useSessionScroll(scrollKey, { ready: desk && !!data.data, preserveInitial: true });
  const tail = useRef({ key: '', follow: false });
  const last = visible?.at(-1);
  const lastChange = last?.id + ':' + (last?.consultations?.map(row => [row.status, row.recovery, row.revision].join(':')).join('|') ?? '');
  useLayoutEffect(() => {
    const pane = scroll.ref.current;
    if (!desk || !data.data || !pane) return;
    if (tail.current.key !== scrollKey) tail.current = { key: scrollKey, follow: !scrollPositions.has(scrollKey) };
    if (tail.current.follow) pane.scrollTop = pane.scrollHeight;
  }, [desk, !!data.data, scrollKey, lastChange, scrollPositions]);
  const messageLabel = '发送给项目成员';
  const messageInput = <TextArea rows={3} maxLength={3500} value={draft.text} required
    aria-label="留言" placeholder="输入留言…"
    onChange={event => setDraft({ ...draft, text: event.target.value })} />;
  const sourceFilter = filterable && channels.length > 1 && <select aria-label="筛选消息来源" value={channel}
    onChange={event => setChannel(event.target.value)}><option value="">全部来源</option>{channels.map(item =>
      <option value={item} key={item}>{sourceName(item)}</option>)}</select>;
  const publishable = !!(ticket ? ticket.canReplyInFeishu : connection.data?.feishuReply) && !agent && !selected.length;
  const destinations = !agent && !selected.length && (!ticket || ticket.imPublications.length)
    ? connection.data?.imTopics.filter(row => !row.available && row.topic === activeTopic && row.canPublish) ?? [] : [];
  const pickMention = (picked: Agent) => {
    const next = selected.length < 4 && !selected.includes(picked.id) ? [...selected, picked.id] : selected;
    const at = draft.text.lastIndexOf('@');
    const text = (at >= 0 ? draft.text.slice(0, at) : draft.text) + '@' + picked.title + ' ';
    setDraft({ ...draft, text, consultants: next });
    setMention({ open: false, query: '', index: 0 });
  };
  const changeText = (text: string) => {
    setDraft({ ...draft, text });
    const match = text.match(/(?:^|[\s，。！？、])@([^\s@]*)$/);
    if (match) setMention(prev => prev.open && prev.query === match[1] ? prev : { open: true, query: match[1], index: 0 });
    else if (mention.open) setMention(prev => ({ ...prev, open: false }));
  };
  const mentionMatches = consultants.filter(agent => {
    const filter = mention.query.trim().toLowerCase();
    return !filter || agent.title.toLowerCase().includes(filter) || agent.owner.toLowerCase().includes(filter);
  }).slice(0, 8);
  const delegate = selected.length === 1 && placements[0] ? (() => {
    const text = draft.text.trim();
    if (!text || busy || needsDevice) return;
    openTask({ topic, parent: ticket?.id, agent: placements[0].participant.id, device: placements[0].device || undefined, request: text });
  }) : undefined;
  const submit = async (publish?: string) => {
    const text = draft.text.trim();
    const feishu = publish === 'feishu';
    if (!text || busy || needsDevice || (feishu && !publishable) || (publish && !feishu && !destinations.some(row => row.id === publish))) return;
    if (!consultants.length && agent) { openTask({ topic, parent: ticket?.id, agent, device: placements[0]?.device || undefined, request: text }); return; }
    const devices = placements.flatMap(({ participant, device }) => device ? [{ agent: participant.id, device }] : []);
    tail.current = { key: scrollKey, follow: true };
    if (await run(() => selected.length
      ? api('project/' + project.id + '/consult', { text, nonce: draft.nonce, topic, agents: selected, ...(devices.length && { devices }) })
      : api(base, { text, nonce: draft.nonce, ticket: ticket?.id, topic, ...(feishu ? { feishu: true } : publish ? { im: publish } : {}) }),
    selected.length ? '已发送，Agent 回复会出现在这里' : publish ? '已记录，等待渠道送达' : ticket ? '已在工单内留言' : '消息已发送')) {
      setDraft({ text: '', nonce: uid(), consultants: [] });
      setChannel('');
      setMention({ open: false, query: '', index: 0 });
      await data.refetch();
    }
  };
  return <section className={desk ? 'conversation-desk' : 'detail-stack'} aria-label={ticket ? '工单讨论' : undefined}>
    {ticket && <header className="ticket-discussion-heading"><h2>工单讨论</h2>{sourceFilter}</header>}
    {desk && sourceFilter && <div className="conversation-filter">{sourceFilter}</div>}
    <div className={desk ? 'conversation-scroll' : undefined} ref={desk ? scroll.ref : undefined} onScroll={desk ? event => {
      const panel = event.currentTarget;
      tail.current = { key: scrollKey, follow: panel.scrollHeight - panel.clientHeight - panel.scrollTop < 48 };
      scroll.onScroll(event);
    } : undefined}>
    {reply && <a className="text-button" href={routeFor(project.id, 'chat', topic)}>返回主题讨论</a>}
    {data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
    {filterable && data.isPending && <Loading />}
    {data.hasNextPage && <Button size="sm" variant="ghost" disabled={data.isFetching} onClick={async () => {
      const pane = scroll.ref.current;
      const height = pane?.scrollHeight ?? 0, top = pane?.scrollTop ?? 0;
      tail.current = { key: scrollKey, follow: false };
      await data.fetchNextPage();
      if (pane) requestAnimationFrame(() => { pane.scrollTop = top + pane.scrollHeight - height; });
    }}>加载更早消息</Button>}
    {desk && visible?.length === 0 && <p className="conversation-empty">{channel ? '此来源暂无消息'
      : '还没有消息。输入 @ 提及一位 Agent，直接在这里布置任务，回复会出现在这个群里。'}</p>}
    {(!data.error || ticket) && !!visible?.length && <div className="timeline" aria-label="成员讨论">
      {visible.map(item => <Fragment key={item.id}><article className="timeline-entry member-message">
        <Avatar avatar={members.get(item.actor)?.avatar} value={item.actor} /><div className="message">
          <div className="message-meta"><strong title={item.actor}>{members.get(item.actor)?.displayName ?? item.actor}</strong><Source channel={item.channel} /><time>{date(item.at)}</time>
            {item.inline && <span>行内评论 {short(item.commit)}</span>}
            {(item.url || item.sourceUrl) && <Ext href={item.url ?? item.sourceUrl}>{item.linkLabel ?? '原消息'}</Ext>}
            {item.feishuDelivery && <span className="discussion-receipt" data-state={item.feishuDelivery}>
              {({ sent: '已公开到飞书', pending: '待送达飞书', dropped: '飞书未送达' })[item.feishuDelivery]}
            </span>}
            {item.mirrorDelivery && <span className="discussion-receipt" data-state={item.mirrorDelivery.state}>
              {sourceName(item.mirrorDelivery.channel)} · {({ sent: '已送达', pending: '待送达', dropped: '待核对回执' })[item.mirrorDelivery.state]}
            </span>}
          </div>
          {item.questionTitle ? <details className="minor-disclosure" ref={item === originalReply ? answerRef : undefined}>
            <summary>{item.questionTitle} · 已处理 · 查看原答复</summary>
            <Markdown text={item.text} />
          </details> : <Markdown text={item.text} />}
          {item.revisions && item.revisions.length > 1 && <details className="minor-disclosure">
            <summary>消息修订 · {item.revisions.length}</summary>
            {item.revisions.map(revision => <div className="revision-note" key={revision.revision}><time>{date(revision.at)}</time><p>{revision.text || '原消息已撤回'}</p></div>)}
          </details>}
        </div>
      </article>{item.consultations?.map(reply => <SignedTopicReply key={reply.ticket} origin={route} reply={reply} />)}</Fragment>)}
    </div>}
    </div>
    {!reply && project.mayStart && <form className={desk ? 'form conversation-composer' : 'form ticket-composer'} onSubmit={event => {
      event.preventDefault();
      void submit();
    }}>
      {desk ? <><div className="mention-anchor">
        <TextArea rows={2} maxLength={3500} value={draft.text} required
          aria-label="群聊输入" placeholder={selected.length ? '补充要求，或直接发送…' : '输入消息，@ 可以提及 Agent…'}
          onChange={event => changeText(event.target.value)}
          onKeyDown={event => {
            if (!mention.open || !consultants.length) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); setMention({ ...mention, index: (mention.index + 1) % Math.max(1, mentionMatches.length) }); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setMention({ ...mention, index: Math.max(0, mention.index - 1) }); }
            else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              if (mentionMatches[mention.index]) { event.preventDefault(); pickMention(mentionMatches[mention.index]); }
            } else if (event.key === 'Escape') setMention({ ...mention, open: false });
          }}
          onBlur={() => setMention(prev => ({ ...prev, open: false }))} />
        {mention.open && !!consultants.length && <MentionPopover agents={consultants} query={mention.query} index={mention.index}
          disabled={selected.length >= 4} onPick={pickMention}
          onIndex={index => setMention({ ...mention, index })} />}
      </div>
      {!!selected.length && <MentionChips entries={mentions.map(({ participant, device, choices }) => ({
        participant, selected: device, choices,
      }))} onRemove={id => setDraft({ ...draft, consultants: draft.consultants.filter(row => row !== id) })}
        onDevice={(id, device) => setDraft({ ...draft, devices: [
          ...(draft.devices ?? []).filter(row => row.agent !== id),
          ...(device ? [{ agent: id, device }] : []),
        ] })} />}
      </> : <Field label={ticket ? '留言' : messageLabel}>{messageInput}</Field>}
      <div className="form-actions">
        {desk && !!consultants.length && !selected.length && <span className="mention-hint">@ 提及一位或多位 Agent，发送后他们会在群里回复</span>}
        {delegate && <Button size="sm" variant="outline" type="button" disabled={busy || needsDevice || !draft.text.trim()}
          onClick={delegate}><Bot />委托 {placements[0].participant.title} 执行</Button>}
        {!desk && !consultants.length && !!agents.length && <select aria-label="委托 Agent" value={agent} onChange={event => {
          setAgent(event.target.value);
        }}>
          <option value="">仅发消息</option>
          {agents.map(item => <option key={item.id} value={item.id}>交给 {item.title}</option>)}
        </select>}
        {desk && selected.length > 0 && needsDevice && <span className="mention-hint" role="status">请先为未定设备的 Agent 选择执行设备</span>}
        {publishable && <Button size="sm" type="button" variant="outline" disabled={busy || !draft.text.trim()}
          onClick={() => void submit('feishu')}>公开回复到飞书</Button>}
        {!!destinations.length && <><select aria-label="选择公开回复的会话" value={publication} onChange={event => choosePublication(event.target.value)}>
          <option value="">选择其他 IM 会话</option>{destinations.map(row => <option value={row.id} key={row.id}>
            {sourceName(row.kind)} · {row.label}{row.tag ? ' / ' + row.tag : ''}</option>)}
        </select><Button size="sm" type="button" variant="outline" disabled={busy || !draft.text.trim() || !destinations.some(row => row.id === publication)}
          onClick={() => void submit(publication)}>公开到选定会话</Button></>}
        <Button size="sm" type="submit" disabled={busy || needsDevice || !draft.text.trim()}>{desk && <Send />}
          {desk ? '发送' : agent ? '确认委托' : ticket ? '仅在工单内留言' : '发送'}</Button>
      </div>
    </form>}
  </section>;
}
