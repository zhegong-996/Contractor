import { useState } from 'react';
import { ArrowUpRight, ClipboardCheck } from 'lucide-react';
import { api, part, type Ticket } from './api.ts';
import { Button } from './components/button.tsx';
import { TextArea } from './components/input.tsx';
import { date, Empty, Ext, Field, Modal, Pill, Section, short, useActions } from './ui.tsx';
import { RecheckDelivery } from './work-evidence.tsx';

type Report = NonNullable<Ticket['productVerification']>;
type Proof = NonNullable<Report['execution']>['history'][number];
type Check = Report['cases'][number];
type ManualCheck = Extract<Check, { kind: 'manual' }>;
type Filter = 'all' | Check['state'];

const filters = [['all', '全部'], ['failed', '未通过'], ['pending', '待核对'], ['passed', '通过']] as const;
const kinds = { browser: '浏览器检查', manual: '人工核对' };
const checkKey = (row: Check) => row.kind + ':' + row.id;

function commitHref(proof: Proof) {
  const repository = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/actions\/runs\/\d+\/attempts\/\d+$/.exec(proof.url)?.[1];
  return repository && 'https://github.com/' + repository + '/commit/' + proof.head;
}

function captureHref(ticket: string, revision: string, proof: Proof, id: string, kind: 'screenshot' | 'recording') {
  return window.location.origin + '/api/ticket/' + part(ticket) + '/product-capture?'
    + new URLSearchParams({ revision, check: String(proof.checkId), case: id, kind });
}

function CheckState({ state }: { state: Check['state'] }) {
  const label = { passed: '通过', failed: '未通过', pending: '待核对' }[state];
  return <Pill tone={state === 'passed' ? 'green' : state === 'failed' ? 'red' : 'amber'}>{label}</Pill>;
}

export const hasVerification = (ticket: Ticket) => !!(ticket.productVerification || ticket.work.deliveryTemplate?.product
  || ticket.productCases.length || ticket.versions.some(version => version.reviews.some(review => review.product)));

function plannedChecks(ticket: Ticket): Check[] {
  const product = ticket.work.deliveryTemplate?.product;
  return [
    ...(product?.browser?.cases ?? []).map(row => ({ ...row, kind: 'browser' as const, state: 'pending' as const, detail: undefined })),
    ...[...(product?.manual ?? []), ...ticket.productCases].map(row => ({ ...row, kind: 'manual' as const, state: 'pending' as const, result: undefined })),
  ];
}

type VerificationProps = {
  ticket: Ticket; revision?: string; deliveryHref: string;
  selectVersion: (revision?: string) => void; onRework?: (reason: string) => void;
};

export function WorkVerification({ ticket, revision, deliveryHref, selectVersion, onRework }: VerificationProps) {
  const current = !revision || revision === ticket.result?.revision;
  const version = revision && !current ? ticket.versions.find(row => row.revision === revision) : undefined;
  const versionNumber = version?.version ?? ticket.work.version ?? 1;
  const accepted = version?.reviews.find(row => row.kind === 'accepted');
  const report = current ? ticket.productVerification : accepted?.product ?? version?.reviews.findLast(row => row.product)?.product;
  const hidden = current ? ticket.materialHidden : version?.text === undefined;
  const checks = hidden ? [] : report?.cases ?? (current && !ticket.result ? plannedChecks(ticket) : []);
  const mayRecord = current && !hidden && ticket.productVerification?.mayRecord ? ticket.result?.revision : undefined;
  const deliveredVersion = current ? ticket.versions.find(row => row.revision === ticket.result?.revision) : version;
  const delivery = deliveredVersion?.acceptedSource?.delivery;
  const pull = report?.head && (delivery?.commit === report.head ? delivery
    : current && ticket.work.delivery?.headSha === report.head ? ticket.work.delivery : undefined);
  const older = ticket.versions.filter(row => row.revision !== ticket.result?.revision).slice().reverse();
  const acceptedBy = current ? ticket.work.accepted : accepted;
  return <div className="detail-stack verification-page">
    <Section title="测试报告" action={older.length > 0 && <label className="verification-version">
      <span>测试版本</span><select aria-label="测试版本" value={current ? '' : revision} onChange={event => selectVersion(event.target.value || undefined)}>
        <option value="">当前 · 第 {ticket.work.version ?? 1} 版</option>
        {older.map(row => <option value={row.revision} key={row.revision}>
          第 {row.version} 版 · {short(row.revision, 8)}{row.reviews.some(review => review.kind === 'accepted') ? ' · 已验收' : ''}
        </option>)}
      </select>
    </label>}>
      <div className="verification-context">
        <span>第 {versionNumber} 版</span>
        {acceptedBy && <><Pill tone="green">已验收</Pill><span>{acceptedBy.actor} · {date(acceptedBy.at, true)}</span></>}
        {pull && <Ext href={pull.url}>PR #{pull.pr}</Ext>}
        {report?.head && (report.execution?.proof ? <Ext href={commitHref(report.execution.proof)}>
          <code title={report.head}>{short(report.head, 12)}</code></Ext> : <code title={report.head}>{short(report.head, 12)}</code>)}
        <a className="text-button" href={deliveryHref}>查看交付 <ArrowUpRight size={14} /></a>
        {current && !hidden && ticket.result && report?.execution && ticket.deliveryVerification?.mayRecheck &&
          <RecheckDelivery ticket={ticket.id} revision={ticket.result.revision} head={ticket.deliveryVerification.head} />}
      </div>
      {checks.length ? <CheckList key={revision ?? ticket.result?.revision ?? 'plan'} ticket={ticket.id} checks={checks}
        report={report} reportRevision={current ? ticket.result?.revision : version?.revision}
        recordRevision={mayRecord} onRework={current ? onRework : undefined} />
        : <Empty icon={<ClipboardCheck />} title={!current && !version ? '找不到指定版本'
          : hidden ? '此版本的测试证据当前受限' : current ? '本单没有逐项测试记录' : '此版本没有逐项测试记录'}
          description={current && !hidden && !acceptedBy ? '可在发起工单时添加人工核对项。自动检查使用项目交付模板。' : undefined} />}
    </Section>
  </div>;
}

function CheckList({ ticket, report, checks, reportRevision, recordRevision, onRework }: {
  ticket: string; report: Omit<Report, 'mayRecord'> | undefined; checks: Check[]; reportRevision?: string; recordRevision?: string;
  onRework?: (reason: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string>();
  const [editing, edit] = useState<{ row: ManualCheck; revision: string; head: Report['head'] }>();
  const { busy, run } = useActions();
  const counts = { all: checks.length, failed: 0, pending: 0, passed: 0 };
  for (const row of checks) counts[row.state]++;
  const shown = checks.filter(row => filter === 'all' || row.state === filter);
  const check = shown.find(row => checkKey(row) === selected)
    ?? shown.find(row => row.state === 'failed') ?? shown.find(row => row.state === 'pending') ?? shown[0];
  const execution = report?.execution;

  return <>
    <div className="verification-toolbar" role="group" aria-label="测试状态筛选">
      {filters.map(([key, label]) => <Button key={key} variant={filter === key ? 'outline' : 'ghost'} size="sm" aria-pressed={filter === key}
        type="button" onClick={() => setFilter(key)}>{label} <span className="verification-count">{counts[key]}</span></Button>)}
    </div>
    {!report && <p className="verification-notice" role="status">等待本版交付。以下为已配置的检查项。</p>}
    {report && !report.ready && !counts.pending && !counts.failed && <p className="verification-notice" role="status">
      逐项检查已通过，仍需核对本版 GitHub 检查结论。</p>}
    {check ? <div className="verification-grid">
      <div className="verification-list" role="group" aria-label="核对项">
        {shown.map(row => <button key={checkKey(row)} type="button" className="verification-item"
          aria-pressed={checkKey(row) === checkKey(check)} onClick={() => setSelected(checkKey(row))}>
          <span className="verification-item-title"><strong>{row.title}</strong><small>{kinds[row.kind]}</small></span>
          <CheckState state={row.state} />
        </button>)}
      </div>
      <article className="verification-check" aria-label="检查详情">
        <header><h3>{check.title}</h3><CheckState state={check.state} /></header>
        <dl>
          <dt>通过条件</dt><dd>{check.expectation}</dd>
          <dt>{check.kind === 'browser' ? '实际结果' : '实际观察'}</dt>
          <dd>{check.kind === 'browser' ? check.detail ?? '等待对应提交的浏览器报告' : check.result?.note ?? '等待人工核对'}</dd>
        </dl>
        {check.kind === 'browser' && execution && <div className="verification-source">
          <strong>{execution.target} · {execution.check}</strong>
          {execution.proof && <div className="record-row">
            <Ext href={execution.proof.url}>查看报告产物 · 第 {execution.proof.attempt} 次</Ext>
            <small>Chromium {execution.proof.browser}</small>
            {!!execution.proof.labels?.length && <small>{execution.proof.labels.join(' · ')}</small>}
          </div>}
        </div>}
        {check.kind === 'browser' && reportRevision && execution?.proof?.captures &&
          <CaseCapture key={checkKey(check) + ':' + execution.proof.checkId} ticket={ticket} revision={reportRevision}
            proof={execution.proof} check={check} />}
        {check.kind === 'manual' && check.result && <div className="verification-source">
          {check.result.actor} · {date(check.result.at, true)}
        </div>}
        <CheckHistory key={checkKey(check)} check={check} report={report} ticket={ticket} revision={reportRevision} />
        {(recordRevision && check.kind === 'manual' || onRework && check.state === 'failed') && <div className="actions verification-actions">
          {recordRevision && check.kind === 'manual' && <Button type="button" size="sm" variant="outline"
            onClick={() => edit({ row: check, revision: recordRevision, head: report?.head })}>
            {check.result ? '更新人工核对' : '记录人工核对'}</Button>}
          {onRework && check.state === 'failed' && <Button type="button" size="sm" variant="outline" onClick={() => onRework(
            `${check.title}未通过。\n通过条件：${check.expectation}\n实际结果：${check.kind === 'browser' ? check.detail : check.result?.note}`
          )}>按此项打回</Button>}
        </div>}
      </article>
    </div> : <Empty title="没有该状态的检查项" />}
    {editing && recordRevision === editing.revision && <Modal title={editing.row.title} close={() => edit(undefined)}>
      <form className="form" onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (await run(() => api('ticket/' + part(ticket) + '/product-check', {
          revision: editing.revision, head: editing.head, case: editing.row.id, previous: editing.row.result?.sequence ?? 0,
          passed: form.get('outcome') === 'pass', note: form.get('note'),
        }), '人工核对已记录')) edit(undefined);
      }}>
        <p>{editing.row.expectation}</p>
        <Field label="核对结果"><select aria-label="核对结果" name="outcome" required defaultValue={editing.row.result ? editing.row.result.passed ? 'pass' : 'fail' : ''}>
          <option value="">选择结果</option><option value="pass">通过</option><option value="fail">未通过</option>
        </select></Field>
        <Field label="实际观察"><TextArea aria-label="实际观察" name="note" rows={3} required maxLength={700} defaultValue={editing.row.result?.note} /></Field>
        <div className="form-actions"><Button disabled={busy} type="submit">保存</Button></div>
      </form>
    </Modal>}
  </>;
}

function CaseCapture({ ticket, revision, proof, check }: { ticket: string; revision: string; proof: Proof; check: Check }) {
  const [kind, setKind] = useState<'screenshot' | 'recording'>('screenshot');
  const href = captureHref(ticket, revision, proof, check.id, kind);
  return <div className="verification-capture">
    <div className="verification-toolbar" role="group" aria-label="检查附件">
      <Button size="sm" variant={kind === 'screenshot' ? 'outline' : 'ghost'} aria-pressed={kind === 'screenshot'}
        type="button" onClick={() => setKind('screenshot')}>截图</Button>
      <Button size="sm" variant={kind === 'recording' ? 'outline' : 'ghost'} aria-pressed={kind === 'recording'}
        type="button" onClick={() => setKind('recording')}>录像</Button>
      <Ext href={href}>{kind === 'screenshot' ? '打开原图' : '打开录像'}</Ext>
    </div>
    <CapturePreview key={href} href={href} title={check.title} kind={kind} />
  </div>;
}

function CapturePreview({ href, title, kind }: { href: string; title: string; kind: 'screenshot' | 'recording' }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const src = attempt ? href + '&retry=' + attempt : href;
  if (failed) return <div role="status" className="record-row">
    <span>{kind === 'screenshot' ? '截图' : '录像'}暂时无法读取。</span>
    <Button type="button" size="sm" variant="outline" onClick={() => { setAttempt(attempt + 1); setFailed(false); }}>重试附件</Button>
  </div>;
  return kind === 'screenshot' ? <img src={src} alt={title + '的实测截图'} loading="lazy" onError={() => setFailed(true)} />
    : <video src={src} controls preload="metadata" playsInline aria-label={title + '的实测录像'} onError={() => setFailed(true)} />;
}

function CheckHistory({ check, report, ticket, revision }: {
  check: Check; report?: Omit<Report, 'mayRecord'>; ticket: string; revision?: string;
}) {
  const proof = report?.execution?.proof;
  const browser = check.kind === 'browser' ? report?.execution?.history?.flatMap(attempt => {
    const result = attempt.cases.find(row => row.id === check.id);
    return result && attempt.checkId !== proof?.checkId ? [{ attempt, result }] : [];
  }) : undefined;
  const manual = check.kind === 'manual' ? report?.manualHistory?.filter(row => row.id === check.id && row.sequence !== check.result?.sequence) : undefined;
  if (!browser?.length && !manual?.length) return null;
  return <details className="minor-disclosure verification-history">
    <summary>历史核对</summary>
    {browser && browser.map(({ attempt, result }) => <div key={attempt.checkId} className="verification-history-entry">
      <div className="record-row"><Ext href={attempt.url}>第 {attempt.attempt} 次运行</Ext>
        <Ext href={commitHref(attempt)}><code title={attempt.head}>{short(attempt.head, 12)}</code></Ext>
        <CheckState state={result.passed ? 'passed' : 'failed'} /></div>
      <p>{result.detail}</p>
      {revision && attempt.captures && <div className="record-row">
        <Ext href={captureHref(ticket, revision, attempt, check.id, 'screenshot')}>该次截图</Ext>
        <Ext href={captureHref(ticket, revision, attempt, check.id, 'recording')}>该次录像</Ext>
      </div>}
    </div>)}
    {manual && manual.slice().reverse().map(row => <div key={row.sequence} className="verification-history-entry">
      <div className="record-row"><span>{row.actor}</span><time dateTime={row.at}>{date(row.at, true)}</time>
        <CheckState state={row.passed ? 'passed' : 'failed'} /></div>
      <p>{row.note}</p>
    </div>)}
  </details>;
}
