import { useState } from 'react';
import { api, useData } from './api.ts';
import type { Collaboration } from '../../src/workbench/collaboration.ts';
import { routeFor } from './navigation.ts';
import { Button } from './components/button.tsx';
import { TextArea } from './components/input.tsx';
import { Failure, Field, Loading, Section, short, useActions, useStored } from './ui.tsx';

type Settings = ReturnType<Collaboration['workerHarness']>;
type Skill = Settings['versions'][number];
const skillKey = (row: Pick<Skill, 'id' | 'revision'>) => row.id + '@' + row.revision;

export function WorkerHarness({ project, agent }: { project: string; agent: string }) {
  const path = 'project/' + project + '/worker-harness/' + agent;
  const data = useData<Settings>(path);
  return <Section title="执行提示词与技能"
    action={<a className="text-button" href={routeFor(project, 'agents', undefined, 'library')}>项目技能库</a>}>
    {data.error ? <Failure error={data.error} retry={() => void data.refetch()} />
      : data.data ? <WorkerSettings settings={data.data} path={path} /> : <Loading />}
  </Section>;
}

function WorkerSettings({ settings, path }: { settings: Settings; path: string }) {
  const { versions, ...current } = settings;
  const [saved, remember] = useStored<typeof current | undefined>('worker-harness-draft:' + path, undefined);
  const [picked, pick] = useState('');
  const { busy, run } = useActions();
  const draft = saved ?? current;
  const conflict = current.revision !== draft.revision;
  const dirty = JSON.stringify(current) !== JSON.stringify(draft);
  const options = versions.filter(row => draft.skills.every(mounted => skillKey(mounted) !== skillKey(row)));
  const candidate = options.find(row => skillKey(row) === picked);
  const mayMount = candidate && (draft.skills.length < 4 || draft.skills.some(row => row.id === candidate.id));

  return <form className="form" onSubmit={async event => {
    event.preventDefault();
    if (!dirty || conflict) return;
    if (await run(() => api(path, draft), '本项目的执行配置已保存')) remember(undefined);
  }}>
    <Field label="项目执行提示词"><TextArea aria-label="项目执行提示词" rows={4} maxLength={4000} value={draft.instructions}
      onChange={event => remember({ ...draft, instructions: event.target.value })} /></Field>
    {draft.skills.map(ref => <div className="record-row" key={ref.id}>
      <strong>{versions.find(row => skillKey(row) === skillKey(ref))?.title ?? '技能当前不可用'}</strong><code>{short(ref.revision, 8)}</code>
      <Button size="sm" variant="ghost" onClick={() => remember({ ...draft, skills: draft.skills.filter(row => row.id !== ref.id) })}>移除</Button>
    </div>)}
    <div className="inline-form">
      <Field label="技能版本"><select aria-label="技能版本" value={picked} onChange={event => pick(event.target.value)}>
        <option value="">{versions.length ? '选择技能与版本' : '暂无可用技能'}</option>
        {options.map(row => <option key={skillKey(row)} value={skillKey(row)}>{row.title} · {short(row.revision, 8)}</option>)}
      </select></Field>
      <Button variant="outline" disabled={!mayMount} onClick={() => {
        if (!candidate || !mayMount) return;
        remember({ ...draft, skills: [...draft.skills.filter(row => row.id !== candidate.id), { id: candidate.id, revision: candidate.revision }] });
        pick('');
      }}>{candidate && draft.skills.some(row => row.id === candidate.id) ? '切换版本' : '挂载技能'}</Button>
    </div>
    <div className="form-actions">
      {conflict && <><span role="status">配置已由其他成员更新。</span><Button variant="ghost" onClick={() => remember(undefined)}>加载现行配置</Button></>}
      <Button type="submit" disabled={busy || conflict || !dirty}>保存执行配置</Button>
    </div>
  </form>;
}
