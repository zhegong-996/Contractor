// Speaker attribution adapted from TencentCloud/Octop (MIT), bf134dbd379036ce7545c7df1a1da7e381ece9ff, dashboard/src/pages/Chat/components/MessageBubble.tsx.
import type { ConversationMessage } from '../api.ts';
import { AcceptedEvidence } from '../accepted-evidence.tsx';
import { routeFor, runRoute, withConversationOrigin, type PageProps } from '../navigation.ts';
import { Markdown } from '../markdown.tsx';
import { Avatar, date, Pill, recoveryLabel, short } from '../ui.tsx';

type Reply = NonNullable<ConversationMessage['consultations']>[number];
const statuses: Record<string, string> = {
  answered: '已回复', unavailable: '资料当前不可读', stopped: '已结束',
  running: '执行中', queued: '排队中', review: '待核对', blocked: '执行受阻', answer: '待答复', failed: '执行失败',
};

export function SignedTopicReply({ reply, origin }: { reply: Reply; origin: PageProps['route'] }) {
  const { project } = origin;
  const { speaker } = reply;
  const status = reply.recovery && recoveryLabel(reply.recovery) || statuses[reply.status] || '等待执行';
  const work = withConversationOrigin(routeFor(project, 'work', reply.ticket), origin);
  const run = reply.run && withConversationOrigin(runRoute(project, reply.ticket, reply.run, reply.attempt), origin);
  return <article className="timeline-entry topic-reply" aria-label={speaker.name + '的咨询进度'}>
    <Avatar value={speaker.name} kind="agent" /><div className="message">
      <div className="message-meta"><a href={routeFor(project, 'agents', speaker.id)}><strong>{speaker.name}</strong></a>
        <Pill tone={reply.status === 'answered' ? 'green' : reply.recovery ? 'amber' : reply.status === 'running' ? 'blue' : 'neutral'}>{status}</Pill>
        {reply.device && <span>{reply.device}</span>}
        {reply.at && <time>{date(reply.at)}</time>}
        <a href={work}>工单 {short(reply.ticket)}</a>
        {run && <a href={run}>执行 #{reply.run}</a>}
      </div>
      {reply.text && <Markdown text={reply.text} />}
      {!!reply.evidence?.length && <details className="minor-disclosure" open><summary>查询依据</summary>
        {reply.evidence.map(ref => <div className="revision-note" key={ref.id + ':' + ref.revision}>
          <a href={routeFor(project, 'knowledge', ref.id)}>{ref.title}</a> <code>{short(ref.revision, 12)}</code>
          {ref.acceptedSource && <AcceptedEvidence source={ref.acceptedSource} project={project} />}
          {ref.acceptedSource && reply.revision && ref.canContinue
            && <a className="text-button" href={withConversationOrigin(routeFor(project, 'work', ref.acceptedSource.ticket, 'delivery')
              + '&consultation=' + encodeURIComponent(reply.ticket + '.' + reply.revision), origin)}>按此咨询开启原单下一版</a>}
        </div>)}
      </details>}
    </div>
  </article>;
}
