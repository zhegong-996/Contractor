import { useState } from 'react';
import { api, uid, useData, type Agent } from './api.ts';
import { Avatar, date, Failure, Field, Markdown, useActions, useStored } from './ui.tsx';
import { Button } from './paperclip/button.tsx';
import type { PageProps } from './navigation.ts';

type Message = { id: string; actor: string; text: string; at: string };

export function Conversation({ project, workspace, openTask, ticket, topic, canReplyInFeishu }: PageProps & { ticket?: string; topic?: string; canReplyInFeishu?: boolean }) {
  const base = 'project/' + project.id + '/messages';
  const filter = ticket ? '?ticket=' + encodeURIComponent(ticket) : topic ? '?topic=' + encodeURIComponent(topic) : '';
  const data = useData<Message[]>(base + filter, 2000);
  const [draft, setDraft] = useStored('conversation:' + base + filter, { text: '', nonce: uid() });
  const [agent, setAgent] = useState('');
  const [feishu, setFeishu] = useState(false);
  const { run, busy } = useActions();
  const agents: Agent[] = workspace.agents.filter(item => item.active && item.projects.includes(project.id));
  return <div className="detail-stack">
    {data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
    {!!data.data?.length && <div className="timeline" aria-label="成员讨论">
      {data.data.map(item => <article className="timeline-entry" key={item.id}>
        <Avatar value={item.actor} /><div className="message">
          <div className="message-meta"><strong>{item.actor}</strong><time>{date(item.at)}</time></div>
          <Markdown text={item.text} />
        </div>
      </article>)}
    </div>}
    {project.mayStart && <form className="form" onSubmit={async event => {
      event.preventDefault();
      const text = draft.text.trim();
      if (!text) return;
      if (agent) { openTask({ topic, parent: ticket, agent, request: text }); return; }
      if (await run(() => api(base, { text, nonce: draft.nonce, ticket, topic, feishu: canReplyInFeishu && feishu }),
        feishu ? '消息已记录，准备同步到飞书' : '消息已发送')) {
        setDraft({ text: '', nonce: uid() });
        setFeishu(false);
      }
    }}>
      <Field label="发送给项目成员"><textarea rows={3} maxLength={3500} value={draft.text} required
        onChange={event => setDraft({ ...draft, text: event.target.value })} /></Field>
      {canReplyInFeishu && !agent && <label className="check-row">
        <input type="checkbox" checked={feishu} onChange={event => setFeishu(event.target.checked)} />同时回复飞书原话题
      </label>}
      <div className="form-actions">
        {!!agents.length && <select aria-label="委托 Agent" value={agent} onChange={event => setAgent(event.target.value)}>
          <option value="">仅发消息</option>
          {agents.map(item => <option key={item.id} value={item.id}>交给 {item.title}</option>)}
        </select>}
        <Button size="sm" type="submit" disabled={busy || !draft.text.trim()}>{agent ? '确认委托' : '发送'}</Button>
      </div>
    </form>}
  </div>;
}
