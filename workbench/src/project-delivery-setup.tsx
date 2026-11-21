import { useState } from 'react';
import { GitPullRequest } from 'lucide-react';
import { api, useData, type Project, type ProjectDeliverySetup } from './api.ts';
import { Button } from './components/button.tsx';
import { Ext, Failure, Field, Loading, Modal, Pill, Section, short, useActions } from './ui.tsx';

const states = { ready: '本地基线已核对', unconfigured: '尚未登记执行工作区', mismatch: '工作区来源不匹配', unavailable: '基线或本地工作区不可用' };

export function DeliverySetup({ project }: { project: Project }) {
  const data = useData<ProjectDeliverySetup>('project/' + project.id + '/delivery-setup');
  const [open, setOpen] = useState(false);
  const [choice, choose] = useState('');
  const { run, busy } = useActions();
  const setup = data.data;
  const selected = choice ? setup?.options[Number(choice)] : undefined;
  return <Section title="代码交付配置" action={!!setup?.options.length && <Button size="sm" variant="outline" onClick={() => {
    choose(''); setOpen(true);
  }}><GitPullRequest />接入交付仓库</Button>}>
    {data.error && <Failure error={data.error} retry={() => void data.refetch()} />}
    {data.isPending && <Loading />}
    {setup && !setup.targets.length && <p className="muted-text">{setup.options.length ? '请选择已登记的交付仓库和有资格的研发。'
      : '暂无交付仓库。需要部署者登记仓库、工作区、写入范围和验收规则。'}</p>}
    {setup?.targets.map(target => <div className="revision-note" key={target.ref}>
      <div className="record-row"><strong><Ext href={target.url ?? 'https://github.com/' + target.externalId}>{target.label}</Ext></strong>
        <Pill tone={target.checkout.state === 'ready' ? 'green' : 'amber'}>{states[target.checkout.state]}</Pill></div>
      <dl className="facts"><dt>Git 基线</dt><dd>{target.base ?? '待登记'} {'head' in target.checkout && <code title={target.checkout.head}>{short(target.checkout.head, 12)}</code>}</dd>
        <dt>允许改动</dt><dd>{target.paths.join('、') || '待登记'}</dd>
        <dt>研发交付人</dt><dd>{target.contributors.map(person => project.members.find(member => member.name === person)?.displayName ?? person).join('、') || '暂无具备资格的成员'}</dd>
        <dt>预设验收</dt><dd>{[target.template, ...target.checks, target.deployment].filter(Boolean).join(' · ') || '使用工单验收项'}</dd>
      </dl>
    </div>)}
    {open && setup && <Modal title="接入交付仓库" close={() => setOpen(false)}>
      <form className="form" onSubmit={async event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        if (!selected) return;
        if (await run(() => api('project/' + project.id + '/delivery-setup', { source: selected.source, repository: selected.repository,
          contributors: form.getAll('contributors') }), '交付仓库已接入')) setOpen(false);
      }}>
        <Field label="可信交付配置"><select required value={choice} onChange={e => choose(e.target.value)}><option value="">选择仓库配置</option>
          {setup.options.map((row, i) => <option key={row.source + ':' + row.repository} value={i}>{row.project} · {row.repository}</option>)}</select></Field>
        {selected && <fieldset key={choice} className="selection"><legend>研发交付人</legend>{selected.contributors.map(person =>
          <label className="check-row" key={person}><input type="checkbox" name="contributors" value={person} defaultChecked={selected.contributors.length === 1} />
            {project.members.find(member => member.name === person)?.displayName ?? person}</label>)}</fieldset>}
        <div className="form-actions"><Button disabled={busy || !selected} type="submit">接入仓库</Button></div>
      </form>
    </Modal>}
  </Section>;
}
