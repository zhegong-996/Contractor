import { useState } from 'react';
import { ArrowRight, GitPullRequest } from 'lucide-react';
import { api, uid, useData, type Overview, type Project, type Ticket } from './api.ts';
import type { Collaboration } from '../../src/workbench/collaboration.ts';
import { projectWorkRoute, routeFor, runRoute } from './navigation.ts';
import { Button } from './components/button.tsx';
import { TextArea } from './components/input.tsx';
import { Failure, Field, Loading, Modal, Section, useActions, Version } from './ui.tsx';

export function EngineeringReview({ ticket, project }: { ticket: Ticket; project: Project }) {
  const review = ticket.engineeringReview;
  const name = (id: string) => project.members.find(member => member.name === id)?.displayName ?? id;
  const { busy, run } = useActions();
  const [editor, setEditor] = useState<{ direction: 'escalate' | 'handover' | 'answer'; nonce: string; id?: string;
    version: number; sha: string | null; to?: string; takingOver?: boolean }>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = editor && JSON.stringify([ticket.id, editor.version, editor.sha, editor.direction, editor.id, editor.to]);
  const text = draftKey ? drafts[draftKey] ?? '' : '';
  const edit = (direction: 'escalate' | 'handover' | 'answer', to?: string, id?: string, takingOver?: boolean) => {
    setEditor({ direction, to, id, takingOver, nonce: uid(), version: ticket.work.version ?? 1, sha: ticket.work.delivery?.headSha ?? null });
  };
  const send = (data: unknown, message: string) => run(() => api('ticket/' + ticket.id + '/engineering-decision', data), message);
  if (!editor && !review.records.length && !review.escalateTo && !review.handoverTo) return null;
  const renderRecord = (row: typeof review.records[number]) => {
    const handover = row.direction === 'handover';
    const status = { open: '等 ' + (row.recipient ? name(row.recipient) : '项目负责人重新指定') + (handover ? ' 接手' : ' 答复'),
      answered: '等 ' + name(row.actor) + (handover ? ' 确认交接' : ' 接回'), received: handover ? '开发者已接手' : '已接回处理', withdrawn: '已撤回' };
    return <article key={row.id} className="engineering-record">
      <div className="inline-meta"><Version version={row.version} />{row.sha && <code>{row.sha.slice(0, 8)}</code>}
        <strong>{row.stale ? '已失效' : status[row.state]}</strong></div>
      <p>{name(row.actor)} · {row.question}</p>
      {row.answer && <p><strong>{row.answeredBy && name(row.answeredBy)}</strong> · {row.answer}</p>}
      {ticket.runs.filter(run => run.engineeringDecisions?.includes(row.id)).map(run =>
        <a className="text-button" key={run.id} href={runRoute(ticket.project, ticket.id, run.id)}>已装入执行 #{run.id}</a>)}
      <div className="actions">{row.canAnswer && <Button size="sm" onClick={() => edit('answer', handover ? row.recipient : row.actor, row.id, handover)}>{handover ? '填写接手说明' : '答复并回传'}</Button>}
        {row.canReceive && <Button size="sm" disabled={busy} onClick={() => void send({ action: 'received', id: row.id }, handover ? '已确认本版交接' : '已接回本版工单')}>{handover ? '确认交接' : '接回处理'}</Button>}
        {row.canReceive && ticket.actions.resume && !ticket.endReason && ticket.recovery && <Button size="sm" variant="outline" disabled={busy}
          onClick={() => void send({ action: 'received', id: row.id, resume: true }, '接续状态见执行记录')}>{handover ? '确认交接并请求接续' : '接回并请求接续'}</Button>}
        {row.canWithdraw && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send({ action: 'withdraw', id: row.id }, '已撤回请求')}>撤回请求</Button>}</div>
    </article>;
  };
  const [latest, ...history] = review.records;
  return <div data-decision-focus="engineering" tabIndex={-1}><Section title="研发决策" action={<div className="actions">
    {review.escalateTo && <Button variant="outline" size="sm" onClick={() => edit('escalate', review.escalateTo)}>请求项目决策</Button>}
    {review.handoverTo && <Button variant="outline" size="sm" onClick={() => edit('handover', review.handoverTo)}>请开发者接手</Button>}
  </div>}>
    {latest && renderRecord(latest)}
    {!!history.length && <details className="form-disclosure"><summary>历史请求 · {history.length}</summary>{history.map(renderRecord)}</details>}
  </Section>
    {editor && <Modal title={editor.takingOver ? '开发者接手' : editor.direction === 'answer' ? '答复研发请求' : editor.direction === 'escalate' ? '请求项目决策' : '请开发者接手'} close={() => setEditor(undefined)}>
      <form className="form" onSubmit={async e => {
        e.preventDefault();
        const result = await send(editor.direction === 'answer' ? { action: 'answer', id: editor.id, text: text.trim() }
          : { action: 'open', direction: editor.direction, version: editor.version, sha: editor.sha, nonce: editor.nonce, text: text.trim() }, '已更新研发决策');
        if (result) {
          if (draftKey) setDrafts(previous => { const next = { ...previous }; delete next[draftKey]; return next; });
          setEditor(undefined);
        }
      }}>
        <div className="inline-meta"><Version version={editor.version} />{editor.takingOver ? '接手人' : '接收人'} {editor.to && name(editor.to)}</div>
        <Field label={editor.takingOver ? '接手说明与下一步' : editor.direction === 'answer' ? '决定与下一步' : '需要对方处理什么'}
          hint={ticket.endReason ? '本版已结束。修改已交付成果需开启下一版。' : editor.takingOver || editor.direction === 'handover' ? '开发者接手后，排队中的 Worker 会按本版说明继续。' : '接回后，问题和答复可进入本版后续执行的上下文。'}>
          <TextArea autoFocus required maxLength={1600} rows={4} value={text} onChange={e => {
            const value = e.target.value;
            if (draftKey) setDrafts(previous => ({ ...previous, [draftKey]: value }));
          }} /></Field>
        <footer className="form-actions"><Button type="submit" disabled={busy || !text.trim()}>{editor.takingOver ? '确认接手' : '发送'}</Button></footer>
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
