import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { api, useData, type Project, type Regression, type Ticket } from './api.ts';
import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { TicketPicker } from './components/ticket-picker.tsx';
import { deliveryVersionRoute, routeFor, runRoute } from './navigation.ts';
import { date, Empty, Failure, Field, Loading, Modal, Pill, Section, short, useActions } from './ui.tsx';

type Case = Regression['cases'][number];
type Evaluation = Regression['comparisons'][number]['candidate'];

export function ProjectRegression({ project }: { project: Project }) {
  const path = 'regression/' + encodeURIComponent(project.id);
  const response = useData<Regression>(path);
  const [creating, setCreating] = useState(false);
  const [comparing, setComparing] = useState<Case>();
  if (response.error) return <Failure error={response.error} retry={() => void response.refetch()} />;
  if (!response.data) return <Loading />;
  const changed = () => { setCreating(false); setComparing(undefined); void response.refetch(); };
  return <>
    <Section title="回归用例" action={project.maintain && <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
      <Plus />添加用例
    </Button>}>
      {response.data.cases.map(item => <div className="regression-case" key={item.id}>
        <div><strong>{item.title}</strong>
          <div className="inline-meta">
            <a href={deliveryVersionRoute(project.id, item.baseline.ticket, item.baseline.revision)}>
              {item.baselineReview.title} · 第 {item.baselineReview.version} 版
            </a>
          </div>
          <p>{item.criterion.kind === 'answer' ? item.criterion.terms.join('、') + (item.criterion.citation ? ' · 需要知识引用' : '')
            : item.criterion.expectation}</p>
        </div>
        {project.maintain && <Button size="sm" variant="outline" onClick={() => setComparing(item)}>对照候选</Button>}
      </div>)}
      {!response.data.cases.length && <Empty title="还没有可读的回归用例" />}
    </Section>
    {!!response.data.comparisons.length && <Section title="对照记录">
      {response.data.comparisons.map(item => <article className="regression-record" key={item.id}>
        <div className="record-row"><strong>{response.data!.cases.find(entry => entry.id === item.case)?.title}</strong>
          <time dateTime={item.at}>{date(item.at, true)}</time>
        </div>
        <div className="regression-versions">
          <EvaluationCard project={project.id} label="基准" value={item.baseline} />
          <EvaluationCard project={project.id} label="候选" value={item.candidate} />
        </div>
      </article>)}
    </Section>}
    {creating && <RegressionForm project={project} path={path} cancel={() => setCreating(false)} changed={changed} />}
    {comparing && <RegressionForm project={project} path={path} testcase={comparing} cancel={() => setComparing(undefined)} changed={changed} />}
  </>;
}

const outcomes = { passed: ['检查通过', 'green'], failed: ['检查未通过', 'red'], unavailable: ['缺少证据', 'amber'] } as const;

function EvaluationCard({ value, label, project }: { value: Evaluation; label: string; project: string }) {
  const [state, tone] = outcomes[value.status];
  const { provenance } = value;
  return <div className="regression-version">
    <div className="record-row"><strong>{label}</strong><Pill tone={tone}>{state}</Pill></div>
    <a href={deliveryVersionRoute(project, value.ticket, value.revision)}>{value.title} · 第 {value.version} 版</a>
    <p>{value.detail}</p>
    <details className="minor-disclosure">
      <summary>执行和配置出处</summary>
      <dl className="facts run-facts">
        <dt>执行</dt><dd><a href={runRoute(project, value.ticket, value.run, value.attempt)}>#{value.run} · 第 {value.attempt} 次</a></dd>
        <dt>Agent</dt><dd>{provenance.agent} · {short(provenance.agentVersion, 12)}</dd>
        <dt>选用模型</dt><dd>{provenance.requestedModel ?? '未记录'}</dd>
        <dt>实际模型</dt><dd>{provenance.reportedModel ?? '执行端未报告'}</dd>
        <dt>指令快照</dt><dd><code>{short(provenance.prompt, 12)}</code></dd>
        {provenance.policyVersion && <><dt>委托规则</dt><dd>{provenance.policyVersion}</dd></>}
        {provenance.template && <><dt>交付模板</dt><dd>{provenance.template.id} · 第 {provenance.template.version} 版</dd></>}
        {!!provenance.skills.length && <><dt>共享技能</dt><dd>{provenance.skills.map(ref =>
          <div key={ref.id}>{ref.id} · {short(ref.revision, 12)}</div>)}</dd></>}
        {!!provenance.sources.length && <><dt>知识依据</dt><dd>{provenance.sources.map(ref =>
          <div key={ref.id}><a href={routeFor(project, 'knowledge', ref.id, 'history')}>{ref.id}</a> · {short(ref.revision, 12)}</div>)}</dd></>}
      </dl>
    </details>
  </div>;
}

function RegressionForm({ project, path, testcase, cancel, changed }: {
  project: Project; path: string; testcase?: Case; cancel(): void; changed(): void;
}) {
  const { run, busy } = useActions();
  const [ticket, setTicket] = useState('');
  const [revision, setRevision] = useState('');
  const [mode, setMode] = useState<'answer' | 'product'>('answer');
  const data = useData<Ticket>(ticket && 'ticket/' + encodeURIComponent(ticket));
  const versions = data.data?.versions.filter(row => row.text !== undefined &&
    !(testcase?.baseline.ticket === ticket && testcase.baseline.revision === row.revision)) ?? [];
  const version = versions.find(row => row.revision === revision);
  const historical = version?.reviews.find(row => row.kind === 'accepted')
    ?? version?.reviews.findLast(row => row.product);
  const verification = historical?.product ?? (revision === data.data?.result?.revision ? data.data?.productVerification : undefined);
  const checks = verification?.cases.filter(row => row.state !== 'pending') ?? [];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!version) return;
    const form = new FormData(event.currentTarget);
    const ref = { ticket, revision };
    if (testcase) {
      if (await run(() => api(path + '/compare', { case: testcase.id, candidate: ref }), '已记录对照')) changed();
      return;
    }
    const check = checks.find(row => form.get('case') === row.kind + ':' + row.id);
    if (mode === 'product' && !check) return;
    const terms = String(form.get('terms') ?? '').split('\n').map(value => value.trim()).filter(Boolean);
    if (await run(() => api(path + '/case', { title: form.get('title'), baseline: ref,
      check: mode === 'product' ? { kind: check!.kind, id: check!.id } : { kind: 'answer', terms, citation: form.has('citation') },
    }), '已添加回归用例')) changed();
  }
  return <Modal title={testcase ? '选择候选成果' : '添加回归用例'} close={cancel}>
    <form className="form" onSubmit={submit}>
      {!testcase && <Field label="用例名称"><Input name="title" required maxLength={140} /></Field>}
      <TicketPicker projects={[project]} purpose="all" value={ticket} onChange={value => { setTicket(value); setRevision(''); }} />
      {data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
      <Field label="成果版本"><select required disabled={!versions.length} value={revision} onChange={event => setRevision(event.target.value)}>
        <option value="">{data.data && !versions.length ? '没有可选的成果版本' : '选择具体版本'}</option>
        {versions.map(row => <option key={row.revision} value={row.revision}>第 {row.version} 版 · {short(row.revision, 8)}</option>)}
      </select></Field>
      {!testcase && <>
        <Field label="检查方式"><select value={mode} onChange={event => setMode(event.target.value === 'product' ? 'product' : 'answer')}>
          <option value="answer">回答内容</option><option value="product">原验收项</option>
        </select></Field>
        {mode === 'answer' ? <>
          <Field label="必须出现的字词"><TextArea name="terms" rows={3} required maxLength={1280} placeholder="每行一项，最多八项" /></Field>
          <label className="checkbox-row"><input type="checkbox" name="citation" />要求有知识引用</label>
        </> : <Field label="已有结果的原验收项"><select name="case" key={revision} required disabled={!checks.length}>
          <option value="">{checks.length ? '选择验收项' : '尚无已记录结果的验收项'}</option>
          {checks.map(row => <option key={row.kind + ':' + row.id} value={row.kind + ':' + row.id}>{row.title}</option>)}
        </select></Field>}
      </>}
      <div className="form-actions"><Button type="submit" disabled={busy || !version || !testcase && mode === 'product' && !checks.length}>
        {testcase ? '记录对照' : '添加'}
      </Button></div>
    </form>
  </Modal>;
}
