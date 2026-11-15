import { useState, type FormEvent } from 'react';
import { Bot, GitPullRequest, Plus } from 'lucide-react';
import { api, readable, uid, useData, type DeviceRow, type Knowledge, type StartResult } from './api.ts';
import { Field, Modal, SearchBox, Source, TopicOptions, useActions, useStored } from './ui.tsx';
import { Button } from './paperclip/button.tsx';
import { Input } from './paperclip/input.tsx';
import { go, type PageProps, type TaskPreset } from './navigation.ts';

export function MaterialPicker({ entries, values, onChange }: {
  entries: Knowledge[]; values: string[]; onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const active = entries.filter(entry => entry.state === 'published' && (!readable(entry) || !entry.retirement));
  const shown = active.filter(e => !query || e.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="selection">
    {active.length > 5 && <SearchBox label="筛选项目资料" value={query} onChange={setQuery} />}
    {shown.length ? <div className="checkbox-list">{shown.map(entry => <label className="check-row" key={entry.id}>
      <input type="checkbox" checked={values.includes(entry.id)} disabled={values.length >= 8 && !values.includes(entry.id)}
        onChange={event => onChange(event.target.checked ? [...values, entry.id] : values.filter(id => id !== entry.id))} />
      <span>{entry.title}</span>{entry.visibility === 'restricted' && <small>需授权</small>}
    </label>)}</div> : <p className="muted-text">{query ? '未找到匹配资料' : '暂无已采用资料'}</p>}
  </div>;
}

type Draft = {
  title: string; request: string; topic: string; agent: string; target: string; material: string[]; resources: string[];
  priority: 'normal' | 'urgent'; nonce: string; metric: string; unit: string; baseline: string; targetValue: string;
  recall: boolean; device: string;
};
function initialDraft(preset: TaskPreset): Draft {
  return { title: preset.lesson ? preset.lesson.title.slice(0, 94) + ' · 复查' : '', request: '', topic: preset.topic ?? '',
    agent: preset.agent ?? '', target: '', material: preset.material ?? (preset.lesson ? [preset.lesson.id] : []), resources: [],
    priority: 'normal', nonce: uid(), metric: preset.lesson?.metric ?? '', unit: preset.lesson?.unit ?? '',
    baseline: preset.lesson ? String(preset.lesson.baseline) : '', targetValue: '', recall: !!preset.personal, device: '' };
}

export function Composer({ project, workspace, preset, close }: PageProps & { preset: TaskPreset; close: () => void }) {
  const defaultDraft = useState(() => initialDraft(preset))[0];
  const key = ['composer', project.id, preset.agent, preset.parent, preset.topic, preset.material?.join(','), preset.lesson?.id, preset.personal].join('/');
  const [draft, setDraft] = useStored(key, defaultDraft);
  const { busy, run } = useActions();
  const catalog = useData<Knowledge[]>('knowledge/' + project.id);
  const devices = useData<DeviceRow[]>('project/' + project.id + '/devices', 3500);
  const change = <K extends keyof Draft>(name: K, value: Draft[K]) => setDraft({ ...draft, [name]: value });
  const options = workspace.agents.filter(a => a.active && a.projects.includes(project.id)
    && (!preset.personal || a.kind === 'personal' && a.owner === workspace.actor));
  const chosenAgent = options.find(a => a.id === draft.agent);
  const attached = devices.data?.filter(device => device.agent === chosenAgent?.id && device.eligible && device.active) ?? [];
  const codeAgents = options.filter(a => ['codex', 'cursor'].includes(a.engine));
  const resources = project.resources.filter(ref => ref.state === 'bound');
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const outcome = await run(async () => {
      if (draft.target && !codeAgents.some(a => a.id === draft.agent)) throw new Error('请选择有交付资格的代码 Agent。');
      const hasMeasure = Boolean(draft.metric || draft.unit || draft.baseline || draft.targetValue);
      if (hasMeasure && (!draft.metric.trim() || !draft.unit.trim())) throw new Error('请填写观测指标和单位。');
      const measure = hasMeasure ? { metric: draft.metric.trim(), unit: draft.unit.trim(),
        ...(draft.baseline !== '' ? { baseline: Number(draft.baseline) } : {}),
        ...(draft.targetValue !== '' ? { target: Number(draft.targetValue) } : {}) } : undefined;
      const started = await api<StartResult>('ticket', {
        project: project.id, title: draft.title.trim(), request: draft.request.trim(), nonce: draft.nonce,
        agent: draft.agent.startsWith('function:') ? undefined : draft.agent || 'auto',
        function: draft.agent.startsWith('function:') ? draft.agent.slice('function:'.length) : undefined,
        topic: draft.topic || undefined, target: draft.target || undefined, material: draft.material, resources: draft.resources,
        priority: draft.priority, parent: preset.lesson?.ticket ?? preset.parent, measure, reusedLesson: preset.lesson?.id,
        personal: preset.personal, recall: draft.recall, device: draft.device || undefined,
      });
      if (started.ticket || started.pending) return started;
      for (let count = 0; count < 15; count++) {
        const found = await api<{ ticket: string | null }>('request/' + started.trigger);
        if (found.ticket) return { ...started, ticket: found.ticket };
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return started;
    }, '委托已提交');
    if (outcome) {
      setDraft(initialDraft(preset));
      close();
      go(project.id, outcome.pending ? 'inbox' : 'work', outcome.ticket);
    }
  };
  return <Modal title={preset.personal ? '交给我的 Agent' : preset.parent ? '新建子工单' : '发起协作'} close={close}>
    <form className="form" onSubmit={handleSubmit}>
      <Field label="工单标题"><Input autoFocus value={draft.title} onChange={e => change('title', e.target.value)} required maxLength={100} /></Field>
      <Field label="要做什么"><textarea rows={5} value={draft.request} onChange={e => change('request', e.target.value)} required maxLength={3500}
        placeholder="描述要解决的问题和验收条件" /></Field>
      <div className="form-grid">
        <Field label="执行 Agent"><select value={draft.agent} required={preset.personal}
          onChange={e => setDraft({ ...draft, agent: e.target.value, target: '', device: '' })}>
          <option value="">{preset.personal ? '选择我的 Agent' : '按项目职责分派'}</option>
          {options.map(agent => <option key={agent.id} value={agent.id}>{agent.title} · {agent.owner}</option>)}
          {!preset.personal && workspace.functions.filter(fn => options.some(agent => agent.function === fn.id)).map(fn => <option key={fn.id} value={'function:' + fn.id}>职责 · {fn.title}</option>)}
        </select></Field>
        <Field label="主题"><select value={draft.topic} onChange={e => change('topic', e.target.value)}><TopicOptions project={project} empty="未归入主题" /></select></Field>
      </div>
      {attached.length > 0 && <Field label="挂载执行端"><select value={draft.device} onChange={e => change('device', e.target.value)}>
        <option value="">工作台执行端</option>
        {attached.map(device => <option key={device.id} value={device.id}>{device.name}{device.online ? '' : ' · 离线等待'}</option>)}
      </select></Field>}
      {draft.agent && chosenAgent && <div className="inline-meta"><Bot size={16} />{chosenAgent.capability}</div>}
      <details open={preset.material?.length || preset.lesson ? true : undefined} className="form-disclosure">
        <summary>知识与资料{draft.material.length ? ' · ' + draft.material.length + ' 份' : ''}</summary>
        <label className="check-row"><input type="checkbox" checked={draft.recall} onChange={e => change('recall', e.target.checked)} />
          <span>查找相关的现行项目记忆</span></label>
        <MaterialPicker entries={catalog.data ?? []} values={draft.material} onChange={v => change('material', v)} />
        {resources.length > 0 && <fieldset className="selection"><legend>外部链接</legend>
          {resources.map(ref => <label className="check-row" key={ref.ref}><input type="checkbox" checked={draft.resources.includes(ref.ref)}
            disabled={draft.resources.length >= 12 && !draft.resources.includes(ref.ref)} onChange={e => change('resources',
              e.target.checked ? [...draft.resources, ref.ref] : draft.resources.filter(v => v !== ref.ref))} />
            <span>{ref.label}</span><Source channel={ref.source} /></label>)}
        </fieldset>}
      </details>
      {!preset.personal && project.deliveryTargets.length > 0 && <details className="form-disclosure">
        <summary><GitPullRequest size={15} />代码交付</summary>
        <Field label="交付仓库" hint="代码委托须由有仓库权限的研发确认。"><select value={draft.target} onChange={e => change('target', e.target.value)}>
          <option value="">不涉及代码</option>
          {project.deliveryTargets.map(ref => <option key={ref.ref} value={ref.ref}>{ref.label}</option>)}
        </select></Field>
      </details>}
      <details className="form-disclosure" open={preset.lesson ? true : undefined}>
        <summary>优先级与观测</summary>
        <Field label="优先级"><select value={draft.priority} onChange={e => change('priority', e.target.value as Draft['priority'])}>
          <option value="normal">普通</option><option value="urgent">紧急</option>
        </select></Field>
        <div className="form-grid">
          <Field label="观测指标"><Input maxLength={100} value={draft.metric} onChange={e => change('metric', e.target.value)} /></Field>
          <Field label="单位"><Input maxLength={100} value={draft.unit} onChange={e => change('unit', e.target.value)} /></Field>
          <Field label="基线"><Input type="number" step="any" value={draft.baseline} onChange={e => change('baseline', e.target.value)} /></Field>
          <Field label="目标"><Input type="number" step="any" value={draft.targetValue} onChange={e => change('targetValue', e.target.value)} /></Field>
        </div>
      </details>
      <footer className="form-actions"><Button type="submit" disabled={busy}><Plus />提交委托</Button></footer>
    </form>
  </Modal>;
}

export function AgentOptions({ agents, allLabel = '选择 Agent' }: { agents: PageProps['workspace']['agents']; allLabel?: string }) {
  return <><option value="">{allLabel}</option>{agents.map(a => <option key={a.id} value={a.id}>{a.title} · {a.owner}</option>)}</>;
}
