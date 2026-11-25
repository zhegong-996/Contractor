import { useState, type FormEvent } from 'react';
import { Bot, Plus } from 'lucide-react';
import { api, readable, uid, useData, type DispatchReadiness, type Knowledge, type StartResult } from './api.ts';
import { ExecutionEnvironment, executionTargetState, useExecutionTargets } from './execution-target.tsx';
import { Failure, Field, Modal, Pill, SearchBox, Source, TopicOptions, useActions, useStored } from './ui.tsx';
import { Button } from './components/button.tsx';
import { Input, TextArea } from './components/input.tsx';
import { go, routeFor, withConversationOrigin, type PageProps, type TaskPreset } from './navigation.ts';
import { CaseEditor } from './product-criteria.tsx';

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
  title: string; request: string; topic: string; agent: string; target: string; goal: string; material: string[]; resources: string[];
  priority: 'normal' | 'urgent'; nonce: string; metric: string; unit: string; baseline: string; targetValue: string;
  recall: boolean; device: string; codeDelivery?: boolean;
  productCases?: { title: string; expectation: string }[];
  reuseAcceptance?: boolean;
};
function initialDraft(preset: TaskPreset): Draft {
  return { title: preset.lesson ? preset.lesson.title.slice(0, 94) + ' · 复查' : preset.request?.split('\n')[0]?.slice(0, 100) ?? '', request: preset.request ?? '', topic: preset.topic ?? '',
    agent: preset.agent ?? '', target: '', goal: '', material: preset.material ?? (preset.lesson ? [preset.lesson.id] : []), resources: [],
    priority: 'normal', nonce: uid(), metric: preset.lesson?.metric ?? '', unit: preset.lesson?.unit ?? '',
    baseline: preset.lesson ? String(preset.lesson.baseline) : '', targetValue: '', recall: !!preset.personal, device: preset.device ?? '' };
}

export function Composer({ project, workspace, route, preset, close }: PageProps & { preset: TaskPreset; close: () => void }) {
  const defaultDraft = useState(() => initialDraft(preset))[0];
  const key = ['composer', project.id, preset.agent, preset.parent, preset.topic, preset.device, preset.request, preset.material?.join(','), preset.lesson?.id, preset.personal].join('/');
  const [draft, setDraft] = useStored(key, defaultDraft);
  const { busy, run } = useActions();
  const catalog = useData<Knowledge[]>('knowledge/' + project.id);
  const change = <K extends keyof Draft>(name: K, value: Draft[K]) => setDraft({ ...draft, [name]: value });
  const options = workspace.agents.filter(a => a.active && a.projects.includes(project.id)
    && (!preset.personal || a.kind === 'personal' && a.owner === workspace.actor));
  const chosenAgent = options.find(a => a.id === draft.agent);
  const targets = useExecutionTargets(chosenAgent ? project.id : undefined);
  const deviceState = chosenAgent && executionTargetState(targets, chosenAgent, draft.device);
  const needsDevice = draft.device ? !deviceState?.selected : deviceState?.needsChoice;
  const codeTargets = project.deliveryTargets.filter(ref => ref.eligibleAgents.some(id => options.some(agent => agent.id === id)));
  const deliveryTarget = codeTargets.find(ref => ref.ref === draft.target);
  const codeDelivery = !preset.personal && (draft.codeDelivery ?? !!draft.target);
  const changeTarget = (code: boolean, target: string) => {
    const selected = codeTargets.find(ref => ref.ref === target);
    const keepAgent = !code || selected?.eligibleAgents.includes(draft.agent);
    const eligible = options.filter(agent => selected?.eligibleAgents.includes(agent.id));
    const agent = keepAgent ? draft.agent : eligible.length === 1 ? eligible[0]!.id : '';
    setDraft({ ...draft, codeDelivery: code, target, agent, device: agent === draft.agent ? draft.device : '' });
  };
  const incompleteDelivery = codeDelivery && !deliveryTarget?.eligibleAgents.includes(draft.agent);
  const agentOptions = codeDelivery ? options.filter(agent => deliveryTarget?.eligibleAgents.includes(agent.id)) : options;
  const openGoals = project.goals.filter(goal => !goal.done);
  const parent = preset.lesson?.ticket ?? preset.parent;
  const topicRequired = !!deliveryTarget?.stages?.requireTopicBasis && !parent;
  const product = deliveryTarget?.product;
  const resources = project.resources.filter(ref => ref.state === 'bound');
  const routeAgent: Record<string, string> = draft.agent.startsWith('function:') ? { function: draft.agent.slice('function:'.length) } : { agent: draft.agent || 'auto' };
  const selection = new URLSearchParams({ ...routeAgent, ...(draft.topic && { topic: draft.topic }), ...(draft.target && { target: draft.target }),
    ...(draft.device && { device: draft.device }), ...(preset.personal && { personal: '1' }) });
  const readiness = useData<DispatchReadiness>(incompleteDelivery || (preset.personal && !draft.agent) ? '' : 'project/' + project.id + '/dispatch-readiness?' + selection);
  const blocked = readiness.data?.state === 'blocked';
  const resolved = readiness.data && 'agent' in readiness.data ? readiness.data : undefined;
  const scopeKey = JSON.stringify([deliveryTarget?.ref, deliveryTarget?.scope, draft.agent]);
  const [confirmedScope, setConfirmedScope] = useState('');
  const confirmWrite = codeDelivery && !!deliveryTarget?.scope && confirmedScope !== scopeKey;
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.request.trim() || incompleteDelivery || confirmWrite || blocked || readiness.error || !readiness.data) return;
    const outcome = await run(async () => {
      if (needsDevice)
        throw new Error('请先选择该 Agent 可以使用的执行设备。');
      if (draft.target && !deliveryTarget?.eligibleAgents.includes(draft.agent))
        throw new Error('请选择具有该仓库交付资格的 Agent。');
      if (topicRequired && !draft.topic)
        throw new Error('请选择主题，立项后确认一条主题依据。');
      const hasMeasure = Boolean(draft.metric || draft.unit || draft.baseline || draft.targetValue);
      if (hasMeasure && (!draft.metric.trim() || !draft.unit.trim())) throw new Error('请填写观测指标和单位。');
      const measure = hasMeasure ? { metric: draft.metric.trim(), unit: draft.unit.trim(),
        ...(draft.baseline !== '' ? { baseline: Number(draft.baseline) } : {}),
        ...(draft.targetValue !== '' ? { target: Number(draft.targetValue) } : {}) } : undefined;
      const started = await api<StartResult>('ticket', {
        project: project.id, title: draft.title.trim() || draft.request.trim().split(/\r?\n/, 1)[0]!.slice(0, 100),
        request: draft.request.trim(), nonce: draft.nonce,
        agent: draft.agent.startsWith('function:') ? undefined : draft.agent || 'auto',
        function: draft.agent.startsWith('function:') ? draft.agent.slice('function:'.length) : undefined,
        topic: draft.topic || undefined, target: draft.target || undefined, material: draft.material, resources: draft.resources,
        priority: draft.priority, parent, goal: draft.goal || undefined, measure, reusedLesson: preset.lesson?.id,
        personal: preset.personal, recall: draft.recall, device: draft.device || undefined,
        productCases: draft.productCases, reuseAcceptance: draft.reuseAcceptance,
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
      if (outcome.pending) go(project.id, 'inbox');
      else window.location.hash = withConversationOrigin(routeFor(project.id, 'work', outcome.ticket),
        outcome.ticket && route.view === 'chat' ? route : undefined);
    }
  };
  const [editing, setEditing] = useState(false);
  const routingIssue = !!needsDevice || !!blocked || !!incompleteDelivery;
  const fields = <>
      <Field label="工单标题（选填）"><Input value={draft.title} onChange={e => change('title', e.target.value)} maxLength={100}
        placeholder={draft.request.trim().split(/\r?\n/, 1)[0]?.slice(0, 100) || '默认使用任务描述的第一行'} /></Field>
      {!preset.personal && <Field label="交付方式">
        <select aria-label="交付方式" value={codeDelivery ? 'code' : 'standard'} onChange={e => {
          const code = e.target.value === 'code';
          changeTarget(code, code && codeTargets.length === 1 ? codeTargets[0]!.ref : '');
        }}><option value="standard">常规工单</option><option value="code">代码交付（PR）</option></select>
      </Field>}
      {codeDelivery && <section className="revision-note" aria-label="代码交付范围">
        {codeTargets.length ? <Field label="交付仓库"><select aria-label="交付仓库" value={deliveryTarget?.ref ?? ''} required
          onChange={e => changeTarget(true, e.target.value)}><option value="">选择交付仓库</option>
          {codeTargets.map(ref => <option key={ref.ref} value={ref.ref}>{ref.label}</option>)}</select></Field>
          : <p>此项目暂无已授权且有 Agent 可接单的代码仓库。<a href={routeFor(project.id, 'project', undefined, 'sources')} onClick={close}>查看资料与连接</a></p>}
        {deliveryTarget?.scope && <dl className="facts delivery-scope">
          <dt>目标分支</dt><dd><code>{deliveryTarget.scope.base}</code></dd>
          <dt>可修改路径</dt><dd>{deliveryTarget.scope.paths.map(p => <code key={p}>{p}</code>)}</dd>
          <dt>提交须通过</dt><dd>{deliveryTarget.scope.checks.join('、')}{deliveryTarget.scope.independentReview && ' · 独立审查'}</dd>
          {deliveryTarget.scope.environment && <><dt>验收环境</dt><dd>{deliveryTarget.scope.environment}</dd></>}
        </dl>}
      </section>}
      <div className="form-grid">
        <Field label="执行 Agent"><select aria-label="执行 Agent" value={draft.agent} required={!!preset.personal || codeDelivery} disabled={codeDelivery && !deliveryTarget}
          onChange={e => setDraft({ ...draft, agent: e.target.value, device: '' })}>
          <option value="">{preset.personal ? '选择我的执行 Agent' : codeDelivery ? '选择有仓库资格的 Agent' : '按项目职责分派'}</option>
          {agentOptions.map(agent => <option key={agent.id} value={agent.id}>{agent.title} · {agent.owner}</option>)}
          {!preset.personal && !codeDelivery && workspace.functions.filter(fn => options.some(agent => agent.function === fn.id)).map(fn => <option key={fn.id} value={'function:' + fn.id}>职责 · {fn.title}</option>)}
        </select></Field>
        <Field label="主题" hint={deliveryTarget?.stages?.requireTopicBasis ? '委托提交后，在工单中确认一条主题依据。' : undefined}>
          <select value={draft.topic} required={topicRequired} onChange={e => change('topic', e.target.value)}>
            <TopicOptions project={project} empty={topicRequired ? '选择主题' : '未归入主题'} />
          </select>
        </Field>
      </div>
      {openGoals.length > 0 && <Field label="所属目标" hint="选择本项目尚未完成的目标，执行与验收会沿用该目标。">
        <select aria-label="所属目标" value={draft.goal} onChange={e => change('goal', e.target.value)}>
          <option value="">不挂目标</option>
          {openGoals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
        </select>
      </Field>}
      {chosenAgent && <ExecutionEnvironment project={project.id} agent={chosenAgent} targets={targets} value={draft.device}
        connectUrl={chosenAgent.owner === workspace.actor && chosenAgent.executionCapabilities.remote ? workspace.runnerConnectUrl : undefined}
        onChange={id => change('device', id)} />}
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
      {!preset.personal && <details className="form-disclosure">
        <summary>需求验收{(product?.cases.length ?? 0) + (draft.productCases?.length ?? 0)
          ? ' · ' + ((product?.cases.length ?? 0) + (draft.productCases?.length ?? 0)) + ' 项' : ''}</summary>
        {product && <ul>{product.cases.map(row => <li key={row.id + row.title}>{row.title} · {row.expectation}</li>)}</ul>}
        {draft.topic && (product || draft.recall) && <label className="check-row"><input type="checkbox" checked={draft.reuseAcceptance !== false}
          onChange={e => change('reuseAcceptance', e.target.checked)} />沿用本主题的现行验收知识</label>}
        <CaseEditor value={draft.productCases ?? []} onChange={cases => change('productCases', cases)} />
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
  </>;
  return <Modal title={preset.personal ? '发起只读代办' : preset.parent ? '新建子工单' : '发起协作'} close={close}>
    <form className="form" onSubmit={handleSubmit}>
      <Field label="要做什么"><TextArea autoFocus rows={5} value={draft.request} onChange={e => change('request', e.target.value)} required maxLength={3500}
        placeholder="描述要解决的问题和验收条件" /></Field>
      {preset.topic ? <details className="form-disclosure dispatch-options" open={editing || routingIssue} onToggle={e => setEditing(e.currentTarget.open)}>
        <summary>{[project.topics.find(row => row.id === draft.topic)?.title ?? '未归入主题',
          chosenAgent?.title ?? resolved?.agent?.name ?? '按项目职责分派',
          deviceState?.summary ?? resolved?.device?.name].filter(Boolean).join(' · ')} · 调整</summary>
        {fields}
      </details> : fields}
      {codeDelivery && deliveryTarget?.scope && <label className="check-row"><input type="checkbox" required
        checked={confirmedScope === scopeKey} onChange={e => setConfirmedScope(e.target.checked ? scopeKey : '')} />
        确认写入 {deliveryTarget.label} 的 {deliveryTarget.scope.base} 分支范围 · {deliveryTarget.scope.paths.join('、')}</label>}
      {readiness.error && <Failure error={readiness.error} retry={() => void readiness.refetch()} />}
      {readiness.data && <div className="revision-note">
        <div className="inline-meta"><Pill tone={blocked ? 'amber' : readiness.data.state === 'ready' ? 'green' : 'neutral'}>
          {readiness.data.state === 'ready' ? '派工条件已核对' : blocked ? '当前无法派工' : '待维护人确认派工'}</Pill>
          {'agent' in readiness.data && <><span>{readiness.data.agent?.name}</span><span>{readiness.data.model ?? '默认模型'}</span>
            {readiness.data.device && <span>{readiness.data.device.name}</span>}
            {readiness.data.estimate !== undefined && <span>预计预留 {readiness.data.estimate} 积分</span>}</>}
        </div>
        {readiness.data.issues.map(issue => <div key={issue.reason} className="record-row">
          <span>{issue.reason}</span>{issue.kind === 'quota' && <a href={routeFor(project.id, 'project', undefined, 'usage')} onClick={close}>查看用量</a>}
          {issue.kind === 'delivery' && <a href={routeFor(project.id, 'project', undefined, 'sources')} onClick={close}>交付配置</a>}
          {issue.kind === 'routing' && project.maintain && <a href={routeFor(project.id, 'project', undefined, 'routing')} onClick={close}>职责与路由</a>}
        </div>)}
        {blocked && <Button type="button" size="sm" variant="ghost" onClick={() => void readiness.refetch()}>重新核对</Button>}
      </div>}
      <footer className="form-actions"><Button type="submit" loading={busy} disabled={!draft.request.trim() || busy || incompleteDelivery || confirmWrite || needsDevice || blocked || !!readiness.error || !readiness.data}><Plus />提交委托</Button></footer>
    </form>
  </Modal>;
}

export function AgentOptions({ agents, allLabel = '选择 Agent' }: { agents: PageProps['workspace']['agents']; allLabel?: string }) {
  return <><option value="">{allLabel}</option>{agents.map(a => <option key={a.id} value={a.id}>{a.title} · {a.owner}</option>)}</>;
}
