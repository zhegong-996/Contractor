import type { ReactNode } from 'react';
import { Activity, ArrowRight, Bot, LockKeyhole } from 'lucide-react';
import { useData, type Snapshot, type Ticket } from './api.ts';
import { Markdown } from './markdown.tsx';
import { deliveryVersionRoute, routeFor, runRoute, type PageProps } from './navigation.ts';
import { date, Empty, Ext, Failure, Loading, Pill, Section, short, Version } from './ui.tsx';

const runStates: Record<string, [string, string]> = {
  queued: ['排队中', 'neutral'], claimed: ['执行中', 'blue'], done: ['执行完成', 'green'], nothing: ['已结束', 'neutral'],
  cancelled: ['已停止', 'neutral'], failed: ['执行失败', 'red'], unknown: ['等待执行端回执', 'amber'],
};

export function RunHistory({ ticket, workspace, project, route, actions }: PageProps & { ticket: Ticket; actions: ReactNode }) {
  const runs = ticket.runs.slice().reverse();
  const selected = route.run ? runs.find(run => run.id === route.run) : runs[0];
  const attributions = new Map(workspace.agents.map(agent => [agent.id, agent.title]));
  return <div className="detail-stack">
    {actions}
    {ticket.timers[0] && <div className="inline-meta">下次复查 <time dateTime={ticket.timers[0].at}>{date(ticket.timers[0].at, true)}</time></div>}
    {!runs.length ? <Empty icon={<Activity />} title="尚无执行记录" /> : <div className="run-history">
      <nav className="run-history-list" aria-label="执行轮次">
        {runs.map(run => {
          const [label, tone] = run.stopping ? ['停止确认中', 'amber'] : runStates[run.state] ?? ['状态待同步', 'neutral'];
          const timestamp = run.finishedAt ?? run.startedAt;
          return <a className="run-history-item" key={run.id} href={runRoute(project.id, ticket.id, run.id)}
            aria-current={selected?.id === run.id ? 'page' : undefined}>
            <span className="run-history-line"><strong>执行 #{run.id}</strong><Pill tone={tone}>{label}</Pill></span>
            <span className="run-history-line"><span>{run.version ? '第 ' + run.version + ' 版' : '待装配'}</span>
              {timestamp && <time dateTime={timestamp}>{date(timestamp)}</time>}</span>
            {run.attribution && <span className="run-history-line run-agent"><Bot size={14} aria-hidden="true" />
              <span>{attributions.get(run.attribution.agent) ?? run.attribution.agent}</span></span>}
          </a>;
        })}
      </nav>
      {!selected ? <Empty title="这次执行不在当前工单中" /> : <div className="detail-stack run-history-detail">
        <Section title={'执行 #' + selected.id} action={<Version version={selected.version} />}>
          {selected.attribution && <dl className="facts run-facts">
            <dt>执行 Agent</dt><dd>{attributions.get(selected.attribution.agent) ?? selected.attribution.agent}</dd>
            <dt>委托人</dt><dd>{selected.attribution.delegatedBy}</dd>
            <dt>Agent 所有者</dt><dd>{selected.attribution.owner}</dd>
          </dl>}
          {selected.assembly ? <SnapshotBody ticket={ticket.id} id={selected.id} attempt={route.attempt} project={project.id} />
            : <p className="muted-text">此轮没有已保存的执行快照。</p>}
        </Section>
        <Section title="本轮成果">
          {ticket.versions.filter(version => version.run === selected.id).map(version => <div className="record-row" key={version.revision}>
            <Version version={version.version} />
            {typeof version.text === 'string' ? <a className="text-button" href={deliveryVersionRoute(project.id, ticket.id, version.revision)}>查看交付与验收 <ArrowRight size={15} /></a>
              : <Pill tone="neutral">成果受限</Pill>}
            <time dateTime={version.at}>{date(version.at, true)}</time>
          </div>)}
          {!ticket.versions.some(version => version.run === selected.id) && <p className="muted-text">此轮尚无交付成果。</p>}
        </Section>
      </div>}
    </div>}
  </div>;
}

function SnapshotBody({ id, attempt, ticket, project }: { id: number; attempt?: number; ticket: string; project: string }) {
  const data = useData<Snapshot>('ticket/' + ticket + '/runs/' + id + (attempt ? '?attempt=' + attempt : ''), 2300);
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  const snap = data.data;
  return <>
    <div className="run-attempt">
      {snap.attempts.length > 1 ? <label>执行尝试 <select value={snap.attempt} onChange={event => {
        window.location.hash = runRoute(project, ticket, id, Number(event.target.value));
      }}>{snap.attempts.map(number => <option key={number} value={number}>第 {number} 次</option>)}</select></label>
        : <span>第 {snap.attempt} 次尝试</span>}
      <a className="text-button" href={runRoute(project, ticket, id, snap.attempt)}>本次记录链接</a>
    </div>
    {!snap.readable ? <div className="info-callout"><LockKeyhole size={16} />此执行快照的资料正文当前不可读。</div>
      : snap.contents ? <SnapshotContents snapshot={snap} project={project} />
        : <p className="muted-text">此轮没有已保存的装配内容。</p>}
  </>;
}

function SnapshotContents({ snapshot: snap, project }: { snapshot: Snapshot; project: string }) {
  const context = snap.contents!.context;
  const evidence = context.events.filter(event => ['knowledge.source', 'task.confirmation', 'project.reference'].includes(event.type));
  return <>
    <dl className="facts run-facts">
      <dt>执行端</dt><dd>{snap.device?.name ?? '未记录设备名'}{snap.device?.remote && ' · 远程'}</dd>
      <dt>选用模型</dt><dd>{snap.contents!.runtime.model ?? '未记录'}</dd>
      {snap.isolation && <><dt>成员隔离</dt><dd>{snap.isolation.owner}</dd></>}
      {snap.contents!.runtime.resumed && <><dt>会话</dt><dd>接续上轮</dd></>}
    </dl>
    {snap.materials?.map(ref => <div className="record-row" key={ref.id}>
      <a href={routeFor(project, 'knowledge', ref.id, 'history')}>{ref.title ?? evidence.find(event => event.id === ref.id)?.summary ?? '资料'}</a>
      <code>{short(ref.revision, 12)}</code>{ref.sourceRevision && <Ext href={ref.url}>源版本 {short(ref.sourceRevision, 12)}</Ext>}
      <Pill tone="neutral">{ref.recalled ? '按任务检索' : '随工单引用'}</Pill>
    </div>)}
    {!!evidence.length && <details className="minor-disclosure"><summary>查看实际装配内容</summary>
      {evidence.map(event => <article className="revision-note" key={event.id}><h3>{event.summary}</h3><Markdown text={event.detail} /></article>)}
    </details>}
  </>;
}
