import { useState } from 'react';
import { ArrowRight, GitPullRequest } from 'lucide-react';
import { api, uid, useData, type Overview, type Ticket } from './api.ts';
import type { Collaboration } from '../../src/workbench/collaboration.ts';
import { projectWorkRoute, routeFor, runRoute } from './navigation.ts';
import { Button } from './components/button.tsx';
import { TextArea } from './components/input.tsx';
import { Failure, Field, Loading, Modal, Section, useActions, Version } from './ui.tsx';

export function EngineeringReview({ ticket }: { ticket: Ticket }) {
  const review = ticket.engineeringReview;
  const { busy, run } = useActions();
  const [editor, setEditor] = useState<{ direction: 'escalate' | 'handover' | 'answer'; nonce: string; id?: string;
    version: number; sha: string | null; to?: string }>();
  const [text, setText] = useState('');
  const edit = (direction: 'escalate' | 'handover' | 'answer', to?: string, id?: string) => {
    setText(''); setEditor({ direction, to, id, nonce: uid(), version: ticket.work.version ?? 1, sha: ticket.work.delivery?.headSha ?? null });
  };
  const send = (data: unknown, message: string) => run(() => api('ticket/' + ticket.id + '/engineering-decision', data), message);
  if (!editor && !review.records.length && !review.escalateTo && !review.handoverTo) return null;
  const renderRecord = (row: typeof review.records[number]) => <article key={row.id} className="engineering-record">
      <div className="inline-meta"><Version version={row.version} />{row.sha && <code>{row.sha.slice(0, 8)}</code>}
        <strong>{row.stale ? '已失效' : row.state === 'open' ? '等 ' + (row.recipient ?? '项目负责人重新指定') + ' 答复'
          : row.state === 'answered' ? '等 ' + row.actor + ' 接回' : row.state === 'received' ? '已接回处理' : '已撤回'}</strong></div>
      <p>{row.actor} · {row.question}</p>
      {row.answer && <p><strong>{row.answeredBy}</strong> · {row.answer}</p>}
      {ticket.runs.filter(run => run.engineeringDecisions?.includes(row.id)).map(run =>
        <a className="text-button" key={run.id} href={runRoute(ticket.project, ticket.id, run.id)}>已装入执行 #{run.id}</a>)}
      <div className="actions">{row.canAnswer && <Button size="sm" onClick={() => edit('answer', row.actor, row.id)}>答复并回传</Button>}
        {row.canReceive && <Button size="sm" disabled={busy} onClick={() => void send({ action: 'received', id: row.id }, '已接回本版工单')}>接回处理</Button>}
        {row.canReceive && ticket.actions.resume && !ticket.endReason && ticket.recovery && <Button size="sm" variant="outline" disabled={busy}
          onClick={() => void send({ action: 'received', id: row.id, resume: true }, '已接回，接续状态见执行记录')}>接回并请求接续</Button>}
        {row.canWithdraw && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send({ action: 'withdraw', id: row.id }, '已撤回请求')}>撤回请求</Button>}</div>
    </article>;
  const [latest, ...history] = review.records;
  return <div data-decision-focus="engineering" tabIndex={-1}><Section title="研发决策" action={<div className="actions">
    {review.escalateTo && <Button variant="outline" size="sm" onClick={() => edit('escalate', review.escalateTo)}>请求项目决策</Button>}
    {review.handoverTo && <Button variant="outline" size="sm" onClick={() => edit('handover', review.handoverTo)}>请开发者接手</Button>}
  </div>}>
    {latest && renderRecord(latest)}
    {!!history.length && <details className="form-disclosure"><summary>历史请求 · {history.length}</summary>{history.map(renderRecord)}</details>}
  </Section>
    {editor && <Modal title={editor.direction === 'answer' ? '答复研发请求' : editor.direction === 'escalate' ? '请求项目决策' : '请开发者接手'} close={() => setEditor(undefined)}>
      <form className="form" onSubmit={async e => {
        e.preventDefault();
        const result = await send(editor.direction === 'answer' ? { action: 'answer', id: editor.id, text: text.trim() }
          : { action: 'open', direction: editor.direction, version: editor.version, sha: editor.sha, nonce: editor.nonce, text: text.trim() }, '已更新研发决策');
        if (result) setEditor(undefined);
      }}>
        <div className="inline-meta"><Version version={editor.version} />接收人 {editor.to}</div>
        <Field label={editor.direction === 'answer' ? '决定与下一步' : '需要对方处理什么'} hint="接回后，问题和答复可进入本版后续执行的上下文。">
          <TextArea autoFocus required maxLength={1600} rows={4} value={text} onChange={e => setText(e.target.value)} /></Field>
        <footer className="form-actions"><Button type="submit" disabled={busy || !text.trim()}>发送</Button></footer>
      </form>
    </Modal>}
  </div>;
}

export function ProjectHealth({ workspace }: { workspace: Overview }) {
  const enabled = workspace.projects.some(project => project.maintain);
  const data = useData<ReturnType<Collaboration['engineeringHealth']>>(enabled ? 'engineering-health' : '', 15000);
  if (!enabled) return null;
  return <Section title="项目健康">
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} /> : data.isPending ? <Loading /> :
      data.data?.map(row => <div className="engineering-health" key={row.project}>
        <a className="project-shortcut" href={projectWorkRoute(row.project)}><GitPullRequest size={17} /><strong>{row.title}</strong><ArrowRight size={14} /></a>
        <dl className="engineering-metrics">
          <div><dt>执行中 Agent</dt><dd>{row.active}</dd></div>
          <div data-risk={row.blocked > 0}><dt>执行阻塞</dt><dd>{row.blocked}</dd></div>
          <div data-risk={row.decisions > 0}><dt>待研发答复</dt><dd>{row.decisions}</dd></div>
          <div data-risk={row.quotaBlocked}><dt>{row.period === 'day' ? '今日' : '本月'} Token</dt><dd>
            <a href={routeFor(row.project, 'project', undefined, 'usage')}>{row.metered ? row.tokens.toLocaleString() : '未启用'}</a>
          </dd>{row.quotaBlocked && <small>额度已达上限</small>}{!!row.incomplete && <small>有待补用量</small>}</div>
        </dl>
        {row.waiting.map(item => <a className="engineering-issue" key={item.id} href={routeFor(row.project, 'work', item.id, 'activity')}>
          <span>{item.title}</span><ArrowRight size={14} /></a>)}
      </div>)}
  </Section>;
}
