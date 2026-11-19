import { useState } from 'react';
import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { api, part, type Ticket } from './api.ts';
import { date, Ext, Field, Modal, Pill, Section, useActions } from './ui.tsx';

type CaseDraft = { title: string; expectation: string };
type Verification = NonNullable<Ticket['productVerification']>;

export function CaseEditor({ value, onChange }: { value: CaseDraft[]; onChange: (cases: CaseDraft[]) => void }) {
  function edit(index: number, key: keyof CaseDraft, text: string) {
    onChange(value.map((item, at) => at === index ? { ...item, [key]: text } : item));
  }
  return <>
    {value.map((item, index) => <fieldset key={index} className="selection">
      <legend>人工核对项 {index + 1}</legend>
      <Field label="核对项"><Input value={item.title} onChange={e => edit(index, 'title', e.target.value)} required maxLength={140} /></Field>
      <Field label="通过条件"><TextArea value={item.expectation} onChange={e => edit(index, 'expectation', e.target.value)}
        rows={2} required maxLength={660} /></Field>
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((_, at) => at !== index))}>移除本项</Button>
    </fieldset>)}
    <Button type="button" variant="outline" size="sm" disabled={value.length >= 8}
      onClick={() => onChange([...value, { title: '', expectation: '' }])}>添加人工核对项</Button>
  </>;
}

export function ProductChecks({ verification, onRecord }: { verification: Omit<Verification, 'mayRecord'>;
  onRecord?: (row: Verification['cases'][number]) => void }) {
  const proof = verification.execution?.proof;
  return <>
    {verification.execution && <div className="record-row">
      <span>浏览器验证 · {verification.execution.target}</span>
      {proof && <Ext href={proof.url}>第 {proof.attempt} 次运行</Ext>}
      {proof?.labels?.length ? <span>{proof.labels.join(' · ')}</span> : null}
      {proof?.browser && <span>Chromium {proof.browser}</span>}
      {!proof && <span className="muted-text">等待对应提交的报告</span>}
    </div>}
    {verification.cases.map(row => <div key={row.kind + ':' + row.id} className="revision-note">
      <div className="record-row">
        <strong>{row.title}</strong>
        <Pill tone={row.state === 'passed' ? 'green' : row.state === 'failed' ? 'red' : 'amber'}>
          {row.state === 'passed' ? '通过' : row.state === 'failed' ? '未通过' : '待核对'}
        </Pill>
        {row.kind === 'manual' && onRecord && <Button variant="outline" type="button" size="sm" onClick={() => onRecord(row)}>
          {row.result ? '更新人工核对' : '记录人工核对'}
        </Button>}
      </div>
      <p>{row.expectation}</p>
      {row.kind === 'manual' ? row.result && <p>{row.result.actor} · {row.result.note}</p>
        : row.detail && <p className="muted-text">{row.detail}</p>}
    </div>)}
    {!!verification.execution?.history?.some(attempt => attempt.checkId !== proof?.checkId) && <details className="minor-disclosure">
      <summary>浏览器核对历史</summary>
      {verification.execution.history.filter(attempt => attempt.checkId !== proof?.checkId).map(attempt => <div className="record-row" key={attempt.checkId}>
        <Ext href={attempt.url}>第 {attempt.attempt} 次运行</Ext>
        <span>{attempt.cases.filter(row => row.passed).length} / {attempt.cases.length} 项通过</span>
      </div>)}
    </details>}
    {!!verification.manualHistory?.some(row => row.sequence > 1) && <details className="minor-disclosure">
      <summary>人工核对历史</summary>
      {verification.manualHistory.map(row => <div className="record-row" key={row.id + ':' + row.sequence}>
        <span>{verification.cases.find(item => item.kind === 'manual' && item.id === row.id)?.title}</span>
        <span>{row.passed ? '通过' : '未通过'} · {row.actor}</span><time>{date(row.at)}</time><span>{row.note}</span>
      </div>)}
    </details>}
  </>;
}

export function ProductVerificationPanel({ ticket, revision, verification }: { ticket: string; revision: string; verification: Verification }) {
  const [selected, select] = useState<Extract<Verification['cases'][number], {kind: 'manual'}>>();
  const { busy, run } = useActions();
  return <Section title="需求验收">
    <ProductChecks verification={verification} onRecord={verification.mayRecord ? row => {
      if (row.kind === 'manual') select(row);
    } : undefined} />
    {selected && <Modal title={selected.title} close={() => select(undefined)}>
      <form className="form" onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (await run(() => api('ticket/' + part(ticket) + '/product-check', {
          revision, head: verification.head, case: selected.id, previous: selected.result?.sequence ?? 0,
          passed: form.get('outcome') === 'pass', note: form.get('note'),
        }), '人工核对已记录')) select(undefined);
      }}>
        <p>{selected.expectation}</p>
        <Field label="核对结果"><select name="outcome" required defaultValue={selected.result ? selected.result.passed ? 'pass' : 'fail' : ''}>
          <option value="">选择结果</option><option value="pass">通过</option><option value="fail">未通过</option>
        </select></Field>
        <Field label="实际观察"><TextArea name="note" rows={3} required maxLength={700} defaultValue={selected.result?.note} /></Field>
        <div className="form-actions"><Button disabled={busy} type="submit">保存</Button></div>
      </form>
    </Modal>}
  </Section>;
}
