import type { ReadableKnowledge } from './api.ts';
import { deliveryVersionRoute } from './navigation.ts';
import { Ext, short } from './ui.tsx';

type AcceptedSource = NonNullable<ReadableKnowledge['acceptedSource']>;

export function AcceptedEvidence({ source, project, linkVersion = true }: {
  source: AcceptedSource; project: string; linkVersion?: boolean;
}) {
  const { delivery } = source;
  return <div className="record-row">
    {linkVersion && <a className="text-button" href={deliveryVersionRoute(project, source.ticket, source.revision)}>
      查看原工单 · 第 {source.version} 版</a>}
    {delivery && <><Ext href={delivery.url}>PR #{delivery.pr}</Ext>
      <code title={delivery.commit}>{short(delivery.commit, 12)}</code>
      {delivery.checks.map(check => <Ext key={check.id} href={check.url}>CI · {check.name}</Ext>)}
    </>}
  </div>;
}
