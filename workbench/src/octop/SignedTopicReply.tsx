// Speaker attribution adapted from TencentCloud/Octop MessageBubble.tsx at bf134db. License in THIRD_PARTY_NOTICES.md.
import type { ConversationMessage } from '../api.ts';
import { AcceptedEvidence } from '../accepted-evidence.tsx';
import { routeFor } from '../navigation.ts';
import { Avatar, date, Markdown, Pill, short } from '../ui.tsx';

type Reply = NonNullable<ConversationMessage['consultations']>[number];
const statuses: Record<string, string> = {
  answered: '已回复', unavailable: '资料已不可用', stopped: '已结束',
  running: '查询中', queued: '已分派', blocked: '执行受阻', answer: '待答复', failed: '执行失败',
};

export function SignedTopicReply({ reply, project, canContinue }: { reply: Reply; project: string;
  canContinue: (ticket: string, revision: string) => boolean }) {
  const { speaker } = reply;
  return <article className="timeline-entry topic-reply">
    <Avatar value={speaker.name} kind="agent" /><div className="message">
      <div className="message-meta"><a href={routeFor(project, 'agents', speaker.id)}><strong>{speaker.name}</strong></a>
        <Pill tone={reply.status === 'answered' ? 'green' : 'neutral'}>{statuses[reply.status] ?? '等待执行'}</Pill>
        {reply.at && <time>{date(reply.at)}</time>}
        <a href={routeFor(project, 'work', reply.ticket)}>执行记录</a>
      </div>
      {reply.text && <Markdown text={reply.text} />}
      {!!reply.evidence?.length && <details className="minor-disclosure" open><summary>查询依据</summary>
        {reply.evidence.map(ref => <div className="revision-note" key={ref.id + ':' + ref.revision}>
          <a href={routeFor(project, 'knowledge', ref.id)}>{ref.title}</a> <code>{short(ref.revision, 12)}</code>
          {ref.acceptedSource && <AcceptedEvidence source={ref.acceptedSource} project={project} />}
          {ref.acceptedSource && reply.revision && canContinue(ref.acceptedSource.ticket, ref.acceptedSource.revision)
            && <a className="text-button" href={routeFor(project, 'work', ref.acceptedSource.ticket, 'delivery')
              + '&consultation=' + encodeURIComponent(reply.ticket + '.' + reply.revision)}>按此咨询开启原单下一版</a>}
        </div>)}
      </details>}
    </div>
  </article>;
}
