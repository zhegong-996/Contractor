import { Fragment, useState } from 'react';
import { api, uid, useData, type Agent, type ConversationMessage } from './api.ts';
import { Avatar, date, Failure, Field, Markdown, useActions, useStored } from './ui.tsx';
import { Button } from './paperclip/button.tsx';
import { routeFor, type PageProps } from './navigation.ts';
import { selectedRosterIds, TopicMemberPicker } from './octop/TopicMemberPicker.tsx';
import { SignedTopicReply } from './octop/SignedTopicReply.tsx';

export function Conversation({ project, workspace, openTask, ticket, topic, canReplyInFeishu, route }: PageProps & { ticket?: string; topic?: string; canReplyInFeishu?: boolean }) {
  const base = 'project/' + project.id + '/messages';
  const filter = ticket ? '?ticket=' + encodeURIComponent(ticket) : topic ? '?topic=' + encodeURIComponent(topic) : '';
  const reply = !ticket && route.reply;
  const data = useData<ConversationMessage[]>(base + filter + (reply ? (filter ? '&' : '?') + 'reply=' + encodeURIComponent(reply) : ''), 2000);
  const [draft, setDraft] = useStored('conversation:' + base + filter, { text: '', nonce: uid(), consultants: [] as string[] });
  const [agent, setAgent] = useState('');
  const [feishu, setFeishu] = useState(false);
  const { run, busy } = useActions();
  const agents: Agent[] = workspace.agents.filter(item => item.active && item.projects.includes(project.id));
  const registered = project.topics.find(item => item.id === topic)?.consultants ?? [];
  const consultants = ticket ? [] : agents.filter(item => registered.includes(item.id));
  const selected = selectedRosterIds(draft.consultants ?? [], consultants);
  return <div className="detail-stack">
    {reply && <a className="text-button" href={routeFor(project.id, 'project', topic, 'chat')}>返回主题讨论</a>}
    {data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
    {!!data.data?.length && <div className="timeline" aria-label="成员讨论">
      {data.data.map(item => <Fragment key={item.id}><article className="timeline-entry">
        <Avatar value={item.actor} /><div className="message">
          <div className="message-meta"><strong>{item.actor}</strong><time>{date(item.at)}</time></div>
          <Markdown text={item.text} />
        </div>
      </article>{item.consultations?.map(reply => <SignedTopicReply key={reply.ticket} project={project.id} reply={reply}
        canContinue={(id, revision) => project.mayStart && workspace.tickets.some(ticket => ticket.id === id
          && ticket.work.requester === workspace.actor && ticket.work.accepted?.revision === revision && !!ticket.work.development)} />)}</Fragment>)}
    </div>}
    {!reply && project.mayStart && <form className="form" onSubmit={async event => {
      event.preventDefault();
      const text = draft.text.trim();
      if (!text) return;
      if (!consultants.length && agent) { openTask({ topic, parent: ticket, agent, request: text }); return; }
      if (await run(() => selected.length
        ? api('project/' + project.id + '/consult', { text, nonce: draft.nonce, topic, agents: selected })
        : api(base, { text, nonce: draft.nonce, ticket, topic, feishu: canReplyInFeishu && feishu }),
        selected.length ? '咨询已交给所选 Agent' : feishu ? '消息已记录，准备同步到飞书' : '消息已发送')) {
        setDraft({ text: '', nonce: uid(), consultants: [] });
        setFeishu(false);
        await data.refetch();
      }
    }}>
      <Field label={selected.length ? '只读咨询' : '发送给项目成员'}><textarea rows={3} maxLength={3500} value={draft.text} required
        onChange={event => setDraft({ ...draft, text: event.target.value })} /></Field>
      {canReplyInFeishu && !agent && <label className="check-row">
        <input type="checkbox" checked={feishu} onChange={event => setFeishu(event.target.checked)} />同时回复飞书原话题
      </label>}
      {!!consultants.length && <TopicMemberPicker agents={consultants} value={draft.consultants ?? []}
        onChange={consultants => setDraft({ ...draft, consultants })} />}
      <div className="form-actions">
        {!consultants.length && !!agents.length && <select aria-label="委托 Agent" value={agent} onChange={event => setAgent(event.target.value)}>
          <option value="">仅发消息</option>
          {agents.map(item => <option key={item.id} value={item.id}>交给 {item.title}</option>)}
        </select>}
        <Button size="sm" type="submit" disabled={busy || !draft.text.trim()}>{selected.length ? '发起只读咨询' : agent ? '确认委托' : '发送'}</Button>
      </div>
    </form>}
  </div>;
}
