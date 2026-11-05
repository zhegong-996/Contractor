import { AgentServicesPage } from './agent-services.js';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type DetailsHTMLAttributes, type Dispatch, type SetStateAction } from 'react';
import { usePluginAction, useHostNavigation, MarkdownBlock, MarkdownEditor, type PluginPageProps, type PluginSidebarProps } from '@paperclipai/plugin-sdk/ui';
import { styles } from './styles.js';
import { GraphPanel, DictionaryPanel } from './knowledge-graph.js';

const labels: Record<string, string> = { pending: '待授权', approved: '已授权', denied: '已拒绝', revoked: '已撤权', revoking: '撤权中', expired: '已过期',
  ready: '待推进', waiting: '待审阅', running: '执行中', handoff_pending: '正在恢复交接', access_blocked: '等待授权', unknown: '待核对执行', accepted: '已完成',
  candidate: '待审阅', confirmed: '已确认', withdrawn: '已撤回', queued: '等待执行', completed: '已整理', failed: '整理失败', idle: '待委托', stale: '上下文已更新',
  cancelled: '已停止', cancelling: '正在停止', unavailable: '待恢复连接', scope_changed: '需核对新职责', source: '来源证据' };
const events: Record<string, string> = { 'task-created': '创建协作任务', 'access-requested': '申请资料访问', 'access-approved': '负责人批准访问', 'access-denied': '拒绝访问申请',
  'access-revoked': '结束资料授权', 'access-expired': '资料授权到期', checkpoint: '保存工作检查点', handoff: '完成任务交接', 'handoff-started': '开始任务交接',
  'handoff-assigned': '更新执行身份', 'knowledge-proposed': '准备知识候选', 'knowledge-confirmed': '确认知识版本', 'knowledge-withdrawn': '撤回知识结论',
  'knowledge-published': '采用到专业空间', completed: '验收完成，结束临时授权', 'execution-stop-confirmed': '核对原执行已停止', 'contract-migrated': '升级协作记录',
  'assistant-delegated': '委托 Agent 准备工作', 'assistant-paused': '暂停 Agent 自动准备', 'assistant-queued': 'Agent 已接单', 'assistant-prepared': 'Agent 已提交整理结果',
  'assistant-configuration-repaired': '恢复 Agent 运行配置', 'im-enabled': '启用飞书接续', 'im-resumed': '飞书接续任务',
  'context-note': '补充任务背景', 'context-expanded': '扩展已授权来源', 'context-linked': '关联研发交付',
  'context-included': '引用资料', 'context-excluded': '移出资料', 'context-discovered': '找到相关知识' };
const retained = new Map<string, unknown>();
function useDraft<T,>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [stored, update] = useState(() => ({ key, value: retained.has(key) ? retained.get(key) as T : initial }));
  const value = stored.key === key ? stored.value : retained.has(key) ? retained.get(key) as T : initial;
  const set: Dispatch<SetStateAction<T>> = next => { const previous = retained.has(key) ? retained.get(key) as T : value;
    const v = typeof next === 'function' ? (next as (v: T) => T)(previous) : next; retained.set(key, v); update({ key, value: v }); };
  return [value, set];
}
function Details({ remember, ...props }: DetailsHTMLAttributes<HTMLDetailsElement> & { remember: string }) {
  const [open, setOpen] = useDraft(remember, false); return <details {...props} className={'sm-details ' + (props.className ?? '')} open={open} onToggle={e => setOpen(e.currentTarget.open)} />;
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { work: 'M8 4h8v4H8z M4 9h16v11H4z M9 14l2 2 4-4', task: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5',
    book: 'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3z M12 6v16', shield: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z M8 12l3 3 5-6',
    arrow: 'M4 12h16 M14 6l6 6-6 6', plus: 'M12 4v16 M4 12h16', refresh: 'M20 7v5h-5 M20 12a8 8 0 1 0-2 6',
    bot: 'M5 8h14v12H5z M12 3v5 M9 13v2 M15 13v2 M9 18h6 M2 12v5 M22 12v5', check: 'M5 12l4 4L19 6', link: 'M9 15l6-6 M8 17l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 5 0 M13 7l2-2a4 4 0 0 1 6 5l-5 5a4 4 0 0 1-5 0' };
  return <svg className="sm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.task} /></svg>;
}
function Button({ variant, icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet'; icon?: string }) {
  return <button {...props} className={'sm-button ' + (props.className ?? '')} data-variant={variant}>{icon && <Icon name={icon} />}{children}</button>;
}
function Badge({ state, children }: { state?: string; children?: any }) { return <span className="sm-badge" data-tone={state === 'accepted' || state === 'confirmed' ? 'success' : ['pending', 'candidate'].includes(state ?? '') ? 'attention' : state === 'failed' ? 'error' : undefined}>{children ?? labels[state ?? ''] ?? state}</span>; }
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
const isLive = (r: any) => r.state === 'approved' && Date.parse(r.expiresAt) > Date.now();
export function WorkspaceSidebar(_props: PluginSidebarProps) { const nav = useHostNavigation(); return <a {...nav.linkProps('/knowledge-workspaces')} className="flex items-center px-3 py-2 text-sm">协作台</a>; }

type UI = { data: any; busy: boolean; prefix: string; nav: ReturnType<typeof useHostNavigation>; invoke: (name: string, payload: any) => Promise<any>;
  read: (name: string, payload: any) => Promise<any>;
  run: (name: string, payload: any) => void; openTask: (id: string, panel?: string) => void; useSource: (id: string) => void };
function actor(ui: UI, key: string) { return ui.data.actors.find((a: any) => a.key === key)?.name ?? key; }
function source(ui: UI, id: string) { return ui.data.sources.find((s: any) => s.id === id); }
function sourceName(ui: UI, id: string) { return source(ui, id)?.title ?? '受限资料'; }
function RecordBody({ record, body }: { record?: any; body?: string }) {
  return <div className="sm-document">{record && <><p className="sm-muted sm-small">{record.appliesTo}</p><dl>{Object.entries(record.facts ?? {}).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{typeof v === 'boolean' ? v ? '是' : '否' : String(v)}</dd></div>)}</dl></>}
    <MarkdownBlock content={record?.body ?? body ?? ''} />{record?.sources?.length > 0 && <ul className="sm-source-links">{record.sources.map((url: string, i: number) => <li key={url}><a href={url} target="_blank" rel="noreferrer">来源 {i + 1}</a></li>)}</ul>}</div>;
}
function KnowledgeForm({ ui, draftKey, submit, compact = false, initial }: { ui: UI; draftKey: string; submit: (data: any) => Promise<void>; compact?: boolean; initial?: any }) {
  const [title, setTitle] = useDraft(draftKey + ':title', initial?.title ?? ''), [body, setBody] = useDraft(draftKey + ':body', initial?.body ?? ''), [scope, setScope] = useDraft(draftKey + ':scope', initial?.appliesTo ?? ''), [links, setLinks] = useDraft(draftKey + ':links', initial?.sources?.join('\n') ?? '');
  const [kind, setKind] = useDraft(draftKey + ':kind', initial?.kind ?? 'reference'), [expires, setExpires] = useDraft(draftKey + ':expires', initial?.expiresAt?.slice(0, 10) ?? ''), [formError, setFormError] = useState('');
  const [facts, setFacts] = useDraft<{ name: string; value: string; type: string }[]>(draftKey + ':facts', initial ? Object.entries(initial.facts).map(([name, value]) => ({ name, value: String(value), type: typeof value })) : [{ name: '', value: '', type: 'string' }]);
  return <form className="sm-form" onSubmit={e => { e.preventDefault(); setFormError(''); const values: Record<string, string | number | boolean> = {};
    for (const f of facts.filter(f => f.name.trim())) { const key = f.name.trim(); if (Object.hasOwn(values, key)) { setFormError('字段名不能重复'); return; }
      if (f.type === 'number' && (!f.value.trim() || !Number.isFinite(Number(f.value)))) { setFormError('数字字段需要填写有效数值'); return; }
      Object.defineProperty(values, key, { value: f.type === 'number' ? Number(f.value) : f.type === 'boolean' ? f.value === 'true' : f.value, enumerable: true }); }
    void submit({ key: initial?.key ?? 'knowledge-' + crypto.randomUUID().slice(0, 18), title, kind, appliesTo: scope, ...(initial?.domains ? { domains: initial.domains } : {}),
    body, sources: links.split(/\s+/).filter(Boolean), facts: values, ...(expires ? { expiresAt: new Date(expires + 'T23:59:59+08:00').toISOString() } : {}) })
    .then(() => { if (!initial) { setTitle(''); setBody(''); setScope(''); setLinks(''); setFacts([{ name: '', value: '', type: 'string' }]); } }).catch(() => {}); }}>
    <div className="sm-form-grid"><label className="sm-field">标题<input className="sm-input" required value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className="sm-field">适用范围<input className="sm-input" required value={scope} onChange={e => setScope(e.target.value)} /></label></div>
    <div className="sm-form-grid"><label className="sm-field">内容类型<select className="sm-input" value={kind} onChange={e => setKind(e.target.value)}>{Object.entries(contentKinds).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label className="sm-field">有效至（可选）<input className="sm-input" type="date" value={expires} onChange={e => setExpires(e.target.value)} /></label></div>
    <fieldset className="sm-choices"><legend>结构化字段</legend>{facts.map((f, i) => <div className="sm-fact-editor" key={i}><input className="sm-input" aria-label={'字段名 ' + (i + 1)} placeholder="字段名" value={f.name} onChange={e => setFacts(facts.map((v, j) => j === i ? { ...v, name: e.target.value } : v))} />
      <select className="sm-input" aria-label={'字段类型 ' + (i + 1)} value={f.type} onChange={e => setFacts(facts.map((v, j) => j === i ? { ...v, type: e.target.value, value: e.target.value === 'boolean' ? 'false' : '' } : v))}><option value="string">文本</option><option value="number">数字</option><option value="boolean">是／否</option></select>
      {f.type === 'boolean' ? <select className="sm-input" aria-label={'字段值 ' + (i + 1)} value={f.value} onChange={e => setFacts(facts.map((v, j) => j === i ? { ...v, value: e.target.value } : v))}><option value="true">是</option><option value="false">否</option></select> : <input className="sm-input" type={f.type === 'number' ? 'number' : 'text'} step="any" aria-label={'字段值 ' + (i + 1)} placeholder="值" value={f.value} onChange={e => setFacts(facts.map((v, j) => j === i ? { ...v, value: e.target.value } : v))} />}
      <Button type="button" variant="quiet" aria-label={'移除字段 ' + (i + 1)} onClick={() => setFacts(facts.filter((_, j) => j !== i))}>移除</Button></div>)}
      <div><Button type="button" variant="quiet" icon="plus" onClick={() => setFacts([...facts, { name: '', value: '', type: 'string' }])}>添加字段</Button></div></fieldset>
    <label className="sm-field">正文<MarkdownEditor value={body} onChange={setBody} bordered /></label>
    <label className="sm-field">来源链接<textarea className="sm-input" required value={links} onChange={e => setLinks(e.target.value)} /></label>
    {formError && <p role="alert" className="sm-error">{formError}</p>}
    <div><Button variant="primary" disabled={ui.busy || !body.trim()}>{initial ? '保存为待确认版本' : compact ? '提交知识候选' : '保存知识'}</Button></div>
  </form>;
}
const contentKinds: Record<string, string> = { reference: '资料与参考', decision: '决策', procedure: '流程与规范', experiment: '实验与结论', feedback: '反馈与经验' };
function Compose({ ui, close, initialSources }: { ui: UI; close: () => void; initialSources: string[] }) {
  const k = ui.prefix + 'compose:';
  const [goal, setGoal] = useDraft(k + 'goal', ''), [title, setTitle] = useDraft(k + 'title', ''), [agent, setAgent] = useDraft(k + 'agent', ui.data.actors[0]?.key ?? '');
  const [selected, setSelected] = useDraft<string[]>(k + 'sources', initialSources), [mode, setMode] = useDraft(k + 'mode', 'advance'), [requestKey, setRequestKey] = useDraft(k + 'key', crypto.randomUUID()), [knowledgeSpace, setKnowledgeSpace] = useDraft(k + 'space', ui.data.spaces[0]?.domain ?? ''), [autoDiscover, setAutoDiscover] = useDraft(k + 'auto-context', true);
  useEffect(() => { if (initialSources.length) setSelected(current => [...new Set([...current, ...initialSources])]); }, [initialSources.join(',')]);
  return <section className="sm-compose" aria-label="发起协作"><div className="sm-section-head"><h2>交给团队和 Agent 的事</h2><Button variant="quiet" type="button" onClick={close}>收起</Button></div>
    <form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('start-collaboration', { task: { title: title.trim() || goal.trim().split('\n')[0]!.slice(0, 80), goal,
      agent, sources: selected, requestKey, autoDiscover, knowledgeSpace }, delegate: ui.data.assistantAvailable, mode }).then(t => { setGoal(''); setTitle(''); setSelected([]); setRequestKey(crypto.randomUUID()); close(); ui.openTask(t.id); }).catch(() => {}); }}>
      <label className="sm-field">要完成什么<textarea autoFocus className="sm-input" required placeholder="写清目标、已有背景和验收条件。Agent 会整理下一步，遇到关键决定再交给你。" value={goal} onChange={e => setGoal(e.target.value)} /></label>
      <div className="sm-form-grid"><label className="sm-field">先交给哪位参与者<select className="sm-input" value={agent} onChange={e => setAgent(e.target.value)}>{ui.data.actors.map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
        <label className="sm-field">Agent 处理范围<select className="sm-input" value={mode} onChange={e => setMode(e.target.value)}><option value="advance">自动整理并推进准备工作</option><option value="prepare">仅给建议和草稿</option></select></label></div>
      <label className="sm-field">知识沉淀空间<select className="sm-input" value={knowledgeSpace} onChange={e => setKnowledgeSpace(e.target.value)}>{ui.data.spaces.map((space: any) => <option key={space.domain} value={space.domain}>{space.name}</option>)}</select></label><label className="sm-check"><input type="checkbox" checked={autoDiscover} onChange={e => setAutoDiscover(e.target.checked)} />自动查找执行身份可用的相关知识</label>
      <Details remember={k + 'sources-open'}><summary>指定参考知识（可选）{selected.length ? ' · 已选 ' + selected.length : ''}</summary><fieldset className="sm-choices"><legend>需要参考的知识</legend>{ui.data.sources.map((s: any) => <label key={s.id} className="sm-check"><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} />
        <span>{s.title} <small>· {ui.data.spaces.find((d: any) => d.domain === s.domain)?.name}</small></span></label>)}</fieldset></Details>
      <Details remember={k + 'name-open'}><summary>自定义任务名称</summary><label className="sm-field">任务名称<input className="sm-input" value={title} onChange={e => setTitle(e.target.value)} /></label></Details>
      <div className="sm-row sm-spread sm-wrap"><span className="sm-muted sm-small">授权、知识采用和验收仍由你决定。</span><Button variant="primary" icon="arrow" disabled={ui.busy || !goal.trim()}>{ui.data.assistantAvailable ? '发起并交给 Agent' : '发起协作'}</Button></div>
    </form></section>;
}
function RequestItem({ ui, task, request: r, compact = false }: { ui: UI; task: any; request: any; compact?: boolean }) {
  const [reason, setReason] = useDraft(ui.prefix + 'reason:' + r.id, '');
  const effectiveState = ['pending', 'approved'].includes(r.state) && Date.parse(r.expiresAt) <= Date.now() ? 'expired' : r.state;
  return <article className="sm-access-item"><div className="sm-row sm-spread sm-wrap"><h3>{sourceName(ui, r.sourceId)}</h3><Badge state={effectiveState} /></div>
    <div className="sm-inline-meta"><button className="sm-link-button" onClick={() => ui.openTask(task.id, 'access')}>{task.identifier}</button><span>{actor(ui, r.agent)}使用</span><span>至 {date(r.expiresAt)}</span></div>
    <p className="sm-small">{r.purpose}</p>
    {effectiveState === 'pending' && <><label className="sm-field">处理依据<input className="sm-input" placeholder="可补充依据；授权时记录本任务的用途、范围和期限" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="sm-actions"><Button variant="primary" disabled={ui.busy} onClick={() => ui.run('decide', { id: r.id, decision: 'approved', reason: reason.trim() || '按当前申请用途，仅授予此资料、本任务和指定执行身份的限时访问' })}>授权</Button>
        <Button disabled={ui.busy || !reason.trim()} onClick={() => ui.run('decide', { id: r.id, decision: 'denied', reason })}>拒绝</Button><a className="sm-button" {...ui.nav.linkProps('/approvals/' + r.approvalId)}>原生审批</a></div></>}
    {['approved', 'revoking'].includes(effectiveState) && !compact && <Details remember={ui.prefix + 'revoke:' + r.id}><summary>管理临时授权</summary><div className="sm-tight"><label className="sm-field">撤权依据<input className="sm-input" value={reason} placeholder="说明为何结束这次访问" onChange={e => setReason(e.target.value)} /></label>
      <div><Button disabled={ui.busy || !reason.trim()} onClick={() => ui.run('revoke', { id: r.id, reason })}>撤销授权</Button></div></div></Details>}
    {r.remainingNativeAccess === true && ['revoked', 'expired'].includes(effectiveState) && <p className="sm-muted sm-small">本任务临时授权已结束；该岗位仍有其他合法资料权限。</p>}
  </article>;
}
function MyWork({ ui }: { ui: UI }) {
  const active = ui.data.tasks.filter((t: any) => t.phase !== 'accepted');
  const requests = active.flatMap((t: any) => t.requests.filter((r: any) => r.state === 'pending' && Date.parse(r.expiresAt) > Date.now()).map((r: any) => ({ task: t, request: r })));
  const decisions = active.flatMap((t: any) => [...(t.assistant?.attention?.length ? [{ type: 'clarify', title: t.assistant.attention[0].title, task: t }] : []), ...(t.assistant?.status === 'scope_changed' ? [{ type: 'scope', title: '核对 Agent 的新职责', task: t }] : []), ...(t.phase === 'unknown' ? [{ type: 'unknown', title: '核对原执行已经停止', task: t }] : []),
    ...t.snapshots.filter((s: any) => s.key?.startsWith('knowledge-') && !s.publicationId && !s.restricted && s.knowledgeState !== 'withdrawn').map((s: any) => ({ type: 'knowledge', title: '采用知识：' + s.title, task: t })),
    ...((!t.assistant?.attention?.length && t.assistant?.status !== 'scope_changed' && (t.snapshots.some((s: any) => s.publicationId) || t.snapshots.some((s: any) => s.key === 'checkpoint' && !s.restricted && s.contextState === 'current')) && !['queued', 'running', 'cancelling'].includes(t.assistant?.status)) ? [{ type: 'accept', title: '审阅工作稿并验收', task: t }] : [])]);
  const count = requests.length + decisions.length;
  return <><section><div className="sm-section-head"><h2>需要你决定 <span className="sm-muted sm-small">{count ? count + ' 项' : ''}</span></h2></div>
    {!count && <div className="sm-empty"><strong>当前没有待决事项</strong>发起协作后，Agent 会整理进展；需要授权或验收时再交给你。</div>}
    {requests.map(({ task, request }: any) => <RequestItem key={request.id} ui={ui} task={task} request={request} compact />)}
    <div className="sm-decisions">{decisions.map((d: any, i: number) => <article className="sm-decision" key={d.task.id + ':' + i}><Icon name={d.type === 'clarify' ? 'bot' : d.type === 'unknown' || d.type === 'scope' ? 'shield' : d.type === 'knowledge' ? 'book' : 'check'} />
      <div><h3>{d.title}</h3><div className="sm-inline-meta"><span>{d.task.identifier}</span><span>{d.task.title}</span><span>{actor(ui, d.task.agent)}</span></div></div>
      <div className="sm-actions"><Button onClick={() => ui.openTask(d.task.id, d.type === 'knowledge' || d.type === 'accept' ? 'knowledge' : 'progress')}>查看并决定</Button></div></article>)}</div>
  </section><div className="sm-work-grid sm-section"><section><div className="sm-section-head"><h2>Agent 与团队在推进</h2></div>
    {!active.length && <p className="sm-muted sm-small">暂无进行中的协作。</p>}
    {active.map((t: any) => <div className="sm-list-row" key={t.id}><Icon name={t.assistant?.enabled ? 'bot' : 'task'} /><div className="sm-grow"><button className="sm-link-button" onClick={() => ui.openTask(t.id)}>{t.title}</button>
      <div className="sm-inline-meta"><span>{t.identifier}</span><span>{t.state.context?.service?.name ?? actor(ui, t.agent)}</span><span>{t.assistant?.attention?.length ? '等你补充' : t.assistant?.output?.summary ? '已整理下一步' : labels[t.assistant?.status] ?? labels[t.phase]}</span></div></div><Badge state={t.phase} /></div>)}
  </section><section><div className="sm-section-head"><h2>最近沉淀</h2></div>{ui.data.sources.filter((s: any) => !s.external && s.knowledgeState === 'confirmed').slice(-4).reverse().map((s: any) => <div className="sm-list-row" key={s.id}><Icon name="book" /><div className="sm-grow"><button className="sm-link-button" onClick={() => ui.useSource(s.id)}>{s.title}</button>
    <span className="sm-muted sm-small">{ui.data.spaces.find((v: any) => v.domain === s.domain)?.name} · {labels[s.knowledgeState] ?? '资料'}</span></div></div>)}</section></div></>;
}
function CoordinationTrace({ a, remember }: { a: any; remember: string }) {
  const toolNames: Record<string, string> = { read_context: '核对当前上下文', read_execution_evidence: '核对真实执行证据', discover_services: '寻找协作 Agent', assess_scope: '判断本轮工作范围', search_context: '检索已有权限的知识', discover_context: '补齐相关资料', read_record: '读取任务背景与工作记录', expand_context: '扩展获准资料', request_access: '准备资料访问申请', read_graph: '读取知识关系', schedule_recheck: '约定后续复查' };
  const decision = { accept: '推进准备工作', ignore: '本轮无需行动', unavailable: '需要补充条件' }[a.assessment?.kind as string];
  if (!a.runtime) return null;
  return <Details remember={remember}><summary>本轮判断与行动{a.toolCalls?.length ? ` · ${a.toolCalls.length} 项` : ''}</summary>
    {decision && <p>{decision}：{typeof a.assessment.reason === 'string' ? a.assessment.reason : a.assessment.audit?.direction?.evidence}</p>}
    {!a.toolCalls?.length ? <p className="sm-small sm-muted">正在读取事件与当前上下文。</p> : <ol className="sm-timeline">{a.toolCalls.map((t: any) => <li key={t.id}><span className="sm-muted sm-small">{{ started: '处理中', completed: '已完成', failed: '未完成' }[t.status as string]}</span><div><strong>{toolNames[t.name] ?? '处理任务'}</strong>{t.error && <p className="sm-small">{t.error}</p>}</div></li>)}</ol>}
    {a.nextCheckAt && <p className="sm-small">下次复查：{date(a.nextCheckAt)}</p>}
    <p className="sm-small sm-muted">持续跟进当前任务、{a.subscriptions?.sources?.length ?? 0} 份资料和 {a.subscriptions?.deliveries?.length ?? 0} 项关联交付。</p>
  </Details>;
}
function AgentPanel({ ui, task, setPanel, editCheckpoint }: { ui: UI; task: any; setPanel: (s: string) => void; editCheckpoint: (s: string) => void }) {
  const a = task.assistant ?? {}, k = ui.prefix + 'agent:' + task.id;
  const [instruction, setInstruction] = useDraft(k + ':instruction', ''), [mode, setMode] = useDraft(k + ':mode', a.mode ?? 'advance');
  const [answer, setAnswer] = useDraft(k + ':answer', '');
  const pending = task.sourceAccess?.some((s: any) => !s.allowed), running = ['queued', 'running', 'cancelling'].includes(a.status);
  const name = ui.data.assistantEngine === 'claude' ? 'Claude Code' : 'Codex';
  const status = a.status === 'completed' && a.attention?.length ? '等你补充' : a.status === 'completed' && pending ? '等待授权' : !a.enabled && a.status !== 'idle' ? '已暂停自动准备' : labels[a.status] ?? '待委托';
  return <section className="sm-agent" aria-label="协作 Agent"><div className="sm-agent-title"><Icon name="bot" /><h3>{task.state.context?.service?.name ?? '协作 Agent'}</h3><span className="sm-muted sm-small">{name}</span>
    <span className="sm-badge">{running && <span className="sm-running-dot" />}{status}</span>
    {a.jobId && <a className="sm-muted sm-small" {...ui.nav.linkProps('/issues/' + a.jobId)}>运行记录</a>}</div>
    {!ui.data.assistantAvailable && <p>协作 Agent 未连接。可以先手动处理任务，连接恢复后继续。</p>}
    {a.error && <p className="sm-small" role="alert">{a.error}</p>}
    {a.status === 'stale' && <p className="sm-small">资料、授权或执行身份已经变化，旧整理结果已隐藏。{a.enabled ? 'Agent 会按新上下文重新准备。' : '重新委托后，会使用当前上下文准备。'}</p>}
    <CoordinationTrace a={a} remember={k + ':coordination'} />
    {a.status === 'scope_changed' && <div className="sm-notice"><p>原职责：{a.service?.responsibilities}</p><p>当前职责：{a.updatedService?.responsibilities ?? '服务已暂停或移除'}</p>{a.updatedService?.enabled && <Button disabled={ui.busy} onClick={() => ui.run('rebind-agent-service', { taskId: task.id, version: a.updatedService.version })}>确认新职责并继续</Button>}</div>}
    {a.enabled && a.attention?.length > 0 && task.phase !== 'accepted' && <form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('context-note', { taskId: task.id, text: answer }).then(() => setAnswer('')).catch(() => {}); }}><p>{a.attention[0].text}</p><label className="sm-field">补充说明<textarea className="sm-input" value={answer} onChange={e => setAnswer(e.target.value)} required /></label><div><Button disabled={ui.busy || !answer.trim()}>补充并继续</Button></div></form>}
    {a.output ? <><p className="sm-agent-copy">{a.output.summary}</p>{!a.attention?.length && a.output.contextGaps?.length > 0 && <div className="sm-notice"><h3>还缺少的上下文</h3><ul>{a.output.contextGaps.map((g: any, i: number) => <li key={i}>{g.question}</li>)}</ul><Button onClick={() => setPanel('access')}>补充或获取上下文</Button></div>}<div>{a.output.nextSteps.filter((s: any) => !(a.attention?.length && s.owner === 'human' && s.kind === 'clarify')).map((s: any, i: number) => <div className="sm-agent-work" key={i}>
      <span className="sm-owner">{s.owner === 'human' ? '你决定' : 'Agent'}</span><div>{s.text}{s.owner === 'human' && ['authorize', 'handoff', 'adopt', 'accept'].includes(s.kind) &&
        <button className="sm-link-button sm-small" style={{ marginLeft: 8 }} onClick={() => setPanel(s.kind === 'authorize' ? 'access' : s.kind === 'handoff' ? 'handoff' : 'knowledge')}>前往处理</button>}</div></div>)}</div>
      {a.output.evidenceQuotes?.length > 0 && <Details remember={k + ':evidence'}><summary>查看依据 · {a.output.evidenceQuotes.length} 处原文</summary><div className="sm-tight">{a.output.evidenceQuotes.map((q: any, i: number) => <div key={i}><span className="sm-muted sm-small">{source(ui, q.sourceId)?.title ?? a.evidenceSources?.find((s: any) => s.id === q.sourceId)?.title ?? '任务上下文'}</span><blockquote style={{ margin: '4px 0 12px', fontSize: 13 }}>{q.quote}</blockquote></div>)}</div></Details>}
      {a.output.workProducts?.length > 0 && <section className="sm-section" aria-label="Agent 已准备的工作稿"><h3>已准备的工作稿</h3>{a.output.workProducts.map((p: any, i: number) => <Details remember={k + ':product:' + a.jobId + ':' + i} key={i}><summary>{p.title} · 待审阅</summary><RecordBody body={p.body} /></Details>)}</section>}
      {a.applied?.checkpoint && <p className="sm-small sm-muted" style={{ marginTop: 12 }}>已保存检查点{a.applied.knowledge ? '，并准备了待审阅的知识候选' : ''}。</p>}
      {a.mode === 'prepare' && a.output.checkpoint && <Button variant="quiet" onClick={() => { editCheckpoint(a.output.checkpoint); setPanel('progress'); }}>将草稿放入检查点编辑</Button>}
    </> : !running && !a.error && a.status !== 'stale' && <p className="sm-small sm-muted">{task.phase === 'accepted' ? '任务已验收，临时上下文已结束。' : '交给 Agent 整理目标、已有材料和下一步，需要你决定时会集中提醒。'}</p>}
    {running && <p className="sm-small sm-muted">{a.status === 'cancelling' ? '正在停止原运行；结束前不会派发替代任务。' : '正在按当前执行身份权限整理资料。你可以继续浏览其他任务。'}</p>}
    {task.phase !== 'accepted' && <div className="sm-agent-edit"><label className="sm-field">补充要求<textarea className="sm-input" rows={2} placeholder="补充目标、约束或需要澄清的地方" value={instruction} onChange={e => setInstruction(e.target.value)} /></label>
      <div className="sm-row sm-spread sm-wrap" style={{ marginTop: 10 }}><label className="sm-field"><span className="sm-small">处理范围</span><select className="sm-input" value={mode} onChange={e => setMode(e.target.value)}><option value="advance">自动整理并推进准备工作</option><option value="prepare">仅给建议和草稿</option></select></label>
        <div className="sm-actions">{a.enabled && <Button disabled={ui.busy || a.status === 'cancelling'} onClick={() => ui.run('assistant-delegate', { taskId: task.id, enabled: false, mode, instruction })}>暂停</Button>}
          <Button variant="primary" disabled={ui.busy || running || !ui.data.assistantAvailable || task.phase === 'unknown'} onClick={() => { void ui.invoke('assistant-delegate', { taskId: task.id, enabled: true, mode, instruction, nonce: crypto.randomUUID() }).then(() => setInstruction('')).catch(() => {}); }}>{a.output || a.error || a.status === 'stale' ? '重新整理' : '交给 Agent'}</Button></div></div></div>}
  </section>;
}
function Candidate({ ui, task, item: s }: { ui: UI; task: any; item: any }) {
  const [reason, setReason] = useDraft(ui.prefix + 'adopt:' + s.id, '');
  return <article className="sm-publication"><div className="sm-row sm-spread sm-wrap"><h3>{s.title}</h3><Badge state={s.publicationId ? 'confirmed' : s.knowledgeState}>{s.publicationId ? '已采用' : undefined}</Badge></div>
    {s.restricted ? <p className="sm-muted sm-small">当前执行身份的来源权限已失效，受限内容已隐藏。</p> : <><RecordBody record={s.record} body={s.body} />
      <div className="sm-actions"><a className="sm-button" {...ui.nav.linkProps('/issues/' + s.id)}>编辑与版本</a>
        {!s.publicationId && s.knowledgeState !== 'withdrawn' && <Button variant="quiet" disabled={ui.busy || task.phase === 'accepted'} onClick={() => ui.run('review', { taskId: task.id, outcomeId: s.id, state: 'withdrawn', revision: s.revision })}>撤回候选</Button>}</div>
      {s.contextState === 'historical' && <p className="sm-notice">生成所用上下文已变化，先重新整理，再审阅新的候选。</p>}
      {s.contextState === 'legacy' && <p className="sm-muted sm-small">旧记录未保存完整输入清单；采用前需另行核对来源。</p>}
      {!s.publicationId && task.phase !== 'accepted' && <div className="sm-adopt"><span className="sm-small">采用后可供 <strong>{ui.data.spaces.find((d: any) => d.domain === s.domain)?.name}知识空间成员</strong> 使用。</span>
        <label className="sm-field">采用依据与共享范围<input className="sm-input" placeholder="说明已确认的结论、适用范围及可共享内容" value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="sm-actions"><Button variant="primary" disabled={ui.busy || !reason.trim() || s.contextState === 'historical'} onClick={() => ui.run('adopt', { taskId: task.id, outcomeId: s.id, revision: s.revision, reason })}>确认并采用此版本</Button>
          {s.knowledgeState !== 'confirmed' && <Button disabled={ui.busy || s.contextState === 'historical'} onClick={() => ui.run('review', { taskId: task.id, outcomeId: s.id, state: 'confirmed', revision: s.revision })}>仅确认，暂不共享</Button>}</div></div>}
      {s.publicationId && <a className="sm-button" {...ui.nav.linkProps('/issues/' + s.publicationId)}>查看已采用知识 <Icon name="arrow" /></a>}</>}
  </article>;
}
function TaskDetail({ ui, task, panel, setPanel }: { ui: UI; task: any; panel: string; setPanel: (s: string) => void }) {
  const k = ui.prefix + 'task:' + task.id;
  const [checkpoint, setCheckpoint] = useDraft(k + ':checkpoint', ''), [next, setNext] = useDraft(k + ':next', ui.data.actors.find((a: any) => a.key !== task.agent)?.key ?? '');
  const [sourceId, setSourceId] = useDraft(k + ':source', task.state.sources[0] ?? ''), [purpose, setPurpose] = useDraft(k + ':purpose', ''), [hours, setHours] = useDraft(k + ':hours', 8);
  const [requestAgent, setRequestAgent] = useDraft(k + ':request-agent', task.agent), [acceptanceNote, setAcceptanceNote] = useDraft(k + ':acceptance', ''), [skipKnowledge, setSkipKnowledge] = useDraft(k + ':no-knowledge', false), [stopped, setStopped] = useState(false), [stopNote, setStopNote] = useDraft(k + ':stop-note', '');
  useEffect(() => { if (next === task.agent) setNext(ui.data.actors.find((a: any) => a.key !== task.agent)?.key ?? ''); }, [task.agent, next]);
  const closed = task.phase === 'accepted', snapshots = task.snapshots.filter((s: any) => s.key === 'checkpoint'), candidates = task.snapshots.filter((s: any) => s.key?.startsWith('knowledge-'));
  const acceptance = task.state.history.findLast((h: any) => h.event === 'completed')?.detail?.review;
  const acceptedDraft = snapshots.find((s: any) => s.id === acceptance?.checkpoint?.id && s.revision === acceptance.checkpoint.revision && !s.restricted);
  const nextReady = task.state.sources.every((id: string) => (!source(ui, id)?.external && ui.data.spaces.find((d: any) => d.domain === source(ui, id)?.domain)?.members?.includes(next)) || task.requests.some((r: any) => r.sourceId === id && r.agent === next && isLive(r)));
  return <article className="sm-task-detail"><div className="sm-row sm-spread sm-wrap"><div className="sm-inline-meta"><a {...ui.nav.linkProps('/issues/' + task.id)}>{task.identifier}</a><span>{task.state.context?.service?.name ?? actor(ui, task.agent)}负责</span></div><Badge state={task.phase} /></div>
    <h2 className="sm-task-heading">{task.title}</h2><p className="sm-goal">{task.goal}</p>
    {task.error && <p className="sm-error" role="alert">{task.error}</p>}
    <nav className="sm-task-stage" aria-label="任务工作区">{[['progress', '进展'], ['access', '上下文'], ['handoff', '任务交接'], ['knowledge', '知识沉淀']].map(([id, name]) => <button key={id} aria-pressed={panel === id} onClick={() => setPanel(id!)}>{name}{id === 'access' && task.requests.some((r: any) => r.state === 'pending') ? ' · 待授权' : ''}</button>)}</nav>
    {panel === 'progress' && <div className="sm-stack"><AgentPanel ui={ui} task={task} setPanel={setPanel} editCheckpoint={setCheckpoint} />
      {task.phase === 'unknown' && <section className="sm-notice sm-stack"><h3>先核对原执行已停止</h3><p>当前执行状态不明，交接与重新执行已暂停。</p><label className="sm-check"><input type="checkbox" checked={stopped} onChange={e => setStopped(e.target.checked)} />已在原执行端确认停止写入</label>
        <label className="sm-field">核对依据<input className="sm-input" value={stopNote} onChange={e => setStopNote(e.target.value)} /></label><div><Button disabled={ui.busy || !stopped || !stopNote.trim()} onClick={() => ui.run('stopped', { taskId: task.id, confirmed: stopped, note: stopNote })}>记录停止确认</Button></div></section>}
      {snapshots.length > 0 && <section><h3>工作检查点</h3>{snapshots.slice().reverse().map((s: any, i: number) => <Details remember={k + ':snapshot:' + s.id} key={s.id}><summary>{i === 0 ? '最近一次检查点' : '较早检查点'}{s.restricted ? ' · 访问已受限' : ''}</summary>
        {s.restricted ? <p className="sm-small sm-muted">来源权限已变化，内容已隐藏。</p> : <><RecordBody body={s.body} /><a className="sm-small" {...ui.nav.linkProps('/issues/' + s.id)}>原生文档与修订</a></>}</Details>)}</section>}
      {!closed && <Details remember={k + ':manual-checkpoint'}><summary>手动补充检查点</summary><form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('checkpoint', { taskId: task.id, text: checkpoint }).then(() => setCheckpoint('')).catch(() => {}); }}>
        <label className="sm-field">工作进展与后续事项<MarkdownEditor value={checkpoint} onChange={setCheckpoint} bordered /></label><div><Button disabled={ui.busy || !checkpoint.trim()}>保存检查点</Button></div></form></Details>}
      <Details remember={k + ':history'}><summary>协作记录</summary><ol className="sm-timeline">{task.state.history.slice().reverse().map((h: any, i: number) => <li key={i}><time>{date(h.at)}</time><span>{events[h.event] ?? h.event}{h.detail?.authoredBy?.startsWith('workspace-assistant:') ? ' · Agent' : ''}</span></li>)}</ol></Details>
    </div>}
    {panel === 'access' && <section><ContextPanel ui={ui} task={task} /><div className="sm-section-head sm-section"><h3>访问与授权</h3><span className="sm-muted sm-small">限本任务和指定执行身份</span></div>
      {task.state.sources.map((id: string) => { const access = task.sourceAccess?.find((s: any) => s.sourceId === id), readable = access?.allowed; return <div className="sm-source-row" key={id}><div><h3>{sourceName(ui, id)}</h3><span className="sm-muted sm-small">{actor(ui, task.agent)} · {readable ? '当前可读取' : access?.reason === 'version' ? '资料当前版本待确认' : '当前未获准读取'}</span></div>
        {access?.reason === 'version' ? <Button onClick={() => ui.useSource(id)}>核对知识版本</Button> : !readable && !closed && !task.requests.some((r: any) => r.sourceId === id && r.agent === task.agent && r.state === 'pending') && <Button disabled={ui.busy} onClick={() => ui.run('request', { taskId: task.id, sourceId: id, purpose: '完成 ' + task.identifier + ' 的当前任务与交接准备', hours: 8, requestKey: crypto.randomUUID() })}>申请访问</Button>}</div>; })}
      {!task.state.sources.length && <p className="sm-muted sm-small">本任务未关联专业资料。</p>}
      <div className="sm-section"><h3 style={{ marginBottom: 16 }}>授权记录</h3>{task.requests.map((r: any) => <RequestItem ui={ui} task={task} request={r} key={r.id} />)}{!task.requests.length && <p className="sm-muted sm-small">Agent 会为缺少的资料准备申请；授权仍由你决定。</p>}</div>
      {!closed && task.state.sources.length > 0 && <Details remember={k + ':manual-request'}><summary>自定义访问申请</summary><form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('request', { taskId: task.id, sourceId, agent: requestAgent, purpose, hours, requestKey: crypto.randomUUID() }).then(() => setPurpose('')).catch(() => {}); }}>
        <div className="sm-form-grid"><label className="sm-field">资料<select className="sm-input" value={sourceId} onChange={e => setSourceId(e.target.value)}>{task.state.sources.map((id: string) => <option key={id} value={id}>{sourceName(ui, id)}</option>)}</select></label>
          <label className="sm-field">申请身份<select className="sm-input" value={requestAgent} onChange={e => setRequestAgent(e.target.value)}>{ui.data.actors.map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label></div>
        <label className="sm-field">用途<input className="sm-input" required value={purpose} onChange={e => setPurpose(e.target.value)} /></label><label className="sm-field">有效时长（小时）<input className="sm-input" type="number" min={1 / 60} max={168} step="any" value={hours} onChange={e => setHours(Number(e.target.value))} /></label><div><Button disabled={ui.busy}>提交申请</Button></div></form></Details>}
    </section>}
    {panel === 'handoff' && <section className="sm-stack"><div><h3>交接给下一参与者</h3><p className="sm-muted sm-small" style={{ marginTop: 6 }}>新岗位先取得所需访问权限。交接后，原执行者的本任务临时权限结束。</p></div>
      {task.assistant?.output?.handoff && <div className="sm-notice"><MarkdownBlock content={task.assistant.output.handoff} /></div>}
      {snapshots.length > 0 && <p className="sm-small">接续任务会保留 {snapshots.length} 份检查点与任务来源。</p>}
      <label className="sm-field">下一执行身份<select className="sm-input" value={next} onChange={e => setNext(e.target.value)}>{ui.data.actors.filter((a: any) => a.key !== task.agent).map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
      <div className="sm-actions"><Button disabled={ui.busy || closed || ['unknown', 'running'].includes(task.phase)} onClick={() => ui.run('prepare-handoff', { taskId: task.id, agent: next })}>准备交接与访问申请</Button>
        <Button variant="primary" disabled={ui.busy || closed || !nextReady || ['unknown', 'running'].includes(task.phase)} onClick={() => ui.run('handoff', { taskId: task.id, agent: next })}>确认交接给{actor(ui, next)}</Button></div>
      {!nextReady && <p className="sm-small sm-muted">下一参与者尚未获准全部资料，先处理下面的访问申请。</p>}
      {task.requests.filter((r: any) => r.agent === next).map((r: any) => <RequestItem key={r.id} ui={ui} task={task} request={r} />)}
    </section>}
    {panel === 'knowledge' && <section><div className="sm-section-head"><h3>{closed ? '交付与验收记录' : '从本次工作留下可复用知识'}</h3></div>
      {!closed && !candidates.length && <div className="sm-empty"><strong>还没有知识候选</strong>Agent 根据获准资料整理后会准备候选，也可以手动补充。</div>}
      {candidates.map((s: any) => <Candidate key={s.id} ui={ui} task={task} item={s} />)}
      {!closed && <><Details remember={k + ':manual-knowledge'}><summary>手动补充知识候选</summary><KnowledgeForm ui={ui} draftKey={k + ':knowledge'} compact submit={async record => { await ui.invoke('propose', { taskId: task.id, record: { ...record, domains: [task.state.context?.knowledgeSpace ?? ui.data.spaces[0]?.domain] } }); }} /></Details>
        <div className="sm-section sm-stack"><h3>最终验收</h3>{snapshots.at(-1) && <Details remember={k + ':review-draft:' + snapshots.at(-1).revision}><summary>本次工作稿 · {snapshots.at(-1).revision?.slice(0, 8)}</summary><RecordBody body={snapshots.at(-1).body} /><a className="sm-button" {...ui.nav.linkProps('/issues/' + snapshots.at(-1).id)}>原生文档与修订</a></Details>}<p className="sm-muted sm-small">按本次实际交付范围验收，并结束临时访问。工作稿交付与业务功能已实现分别记录。</p>{!candidates.some((s: any) => s.publicationId) && <label className="sm-check"><input type="checkbox" checked={skipKnowledge} onChange={e => setSkipKnowledge(e.target.checked)} />本次只验收工作稿，暂不采用为可复用知识</label>}<label className="sm-field">验收范围与依据<input className="sm-input" value={acceptanceNote} onChange={e => setAcceptanceNote(e.target.value)} placeholder="说明已审阅的交付、未覆盖范围和结论" /></label><div><Button variant="primary" disabled={ui.busy || !acceptanceNote.trim() || (!candidates.some((s: any) => s.publicationId) && (!skipKnowledge || !snapshots.at(-1)?.revision)) || ['unknown', 'running'].includes(task.phase)} onClick={() => ui.run('complete', { taskId: task.id, reason: acceptanceNote, noKnowledge: skipKnowledge, checkpoint: snapshots.at(-1)?.revision ? { id: snapshots.at(-1).id, revision: snapshots.at(-1).revision } : undefined })}>验收完成并结束临时授权</Button></div></div></>}
      {closed && <div className="sm-stack"><div className="sm-notice"><Icon name="check" /> {acceptance?.noKnowledge ? '工作稿交付已验收，暂不采用为可复用知识。临时授权已结束。' : '已验收，临时授权已结束。'}</div>
        {acceptance?.reason && <p>{acceptance.reason}</p>}
        {acceptance?.checkpoint && <Details remember={k + ':accepted-draft:' + acceptance.checkpoint.revision}><summary>已验收工作稿 · {acceptance.checkpoint.revision.slice(0, 8)}</summary>
          {acceptedDraft ? <RecordBody body={acceptedDraft.body} /> : <p className="sm-muted sm-small">已验收版本保存在原生修订记录中，内容仍按当前访问权限显示。</p>}
          <a className="sm-button" {...ui.nav.linkProps('/issues/' + acceptance.checkpoint.id)}>原生文档与修订</a></Details>}</div>}
    </section>}
  </article>;
}
function TaskWorkspace({ ui, selected, setSelected, panel, setPanel }: { ui: UI; selected: string; setSelected: (id: string) => void; panel: string; setPanel: (s: string) => void }) {
  const [query, setQuery] = useDraft(ui.prefix + 'task-search', ''), [all, setAll] = useDraft(ui.prefix + 'task-all', false);
  const filtered = ui.data.tasks.filter((t: any) => (all || t.phase !== 'accepted') && (t.title + t.identifier).toLowerCase().includes(query.toLowerCase()));
  const task = ui.data.tasks.find((t: any) => t.id === selected) ?? filtered[0] ?? ui.data.tasks[ui.data.tasks.length - 1];
  return <div className="sm-workspace-grid"><aside className="sm-task-list" aria-label="协作任务列表"><header><input className="sm-input" type="search" aria-label="搜索协作任务" placeholder="搜索任务" value={query} onChange={e => setQuery(e.target.value)} />
    <label className="sm-check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />包括已完成</label></header>
    {filtered.map((t: any) => <button className="sm-task-item" key={t.id} aria-current={t.id === task?.id} onClick={() => setSelected(t.id)}><span className="sm-row sm-spread"><span className="sm-muted sm-small">{t.identifier}</span><Badge state={t.phase} /></span><strong>{t.title}</strong><span className="sm-muted sm-small">{t.state.context?.service?.name ?? actor(ui, t.agent)} · {t.assistant?.enabled ? 'Agent 协作中' : '团队协作'}</span></button>)}
    {!filtered.length && <p className="sm-muted sm-small">没有匹配任务。</p>}</aside>
    <div className="sm-mobile-select"><label className="sm-field">协作任务<select className="sm-input" value={task?.id ?? ''} onChange={e => setSelected(e.target.value)}>{ui.data.tasks.map((t: any) => <option key={t.id} value={t.id}>{t.identifier} · {t.title}</option>)}</select></label></div>
    {task ? <TaskDetail key={task.id} ui={ui} task={task} panel={panel} setPanel={setPanel} /> : <div className="sm-empty"><strong>还没有协作任务</strong>点击“发起协作”，写下要完成的目标。</div>}
  </div>;
}
function Spaces({ ui, chosen, choose, domain, setDomain, composeWith }: { ui: UI; chosen: string; choose: (id: string) => void; domain: string; setDomain: (id: string) => void; composeWith: (id: string) => void }) {
  const [query, setQuery] = useDraft(ui.prefix + 'source-search:' + domain, ''), [create, setCreate] = useDraft(ui.prefix + 'source-create:' + domain, false), [feishuUrl, setFeishuUrl] = useDraft(ui.prefix + 'feishu-source:' + domain, '');
  const [stateFilter, setStateFilter] = useDraft(ui.prefix + 'source-state:' + domain, ''), [shape, setShape] = useDraft(ui.prefix + 'source-shape:' + domain, ''), [editing, setEditing] = useState(false);
  const [knowledgeTab, setKnowledgeTab] = useDraft(ui.prefix + 'knowledge-tab:' + domain, 'content');
  const list = ui.data.sources.filter((s: any) => s.domain === domain && (!stateFilter || s.knowledgeState === stateFilter)
    && (!shape || shape === 'external' && s.external || shape === 'structured' && Object.keys(s.record?.value?.facts ?? {}).length > 0 || shape === 'document' && s.record?.value?.body)
    && (s.title + JSON.stringify(s.record?.value?.facts ?? {}) + (s.record?.value?.body ?? '')).toLowerCase().includes(query.toLowerCase()));
  const current = list.find((s: any) => s.id === chosen) ?? list[0], space = ui.data.spaces.find((s: any) => s.domain === domain);
  useEffect(() => setEditing(false), [current?.id]);
  if (!space) return null;
  return <div className="sm-space-grid"><nav className="sm-space-nav" aria-label="知识空间">{ui.data.spaces.map((s: any) => <button key={s.domain} aria-pressed={domain === s.domain} onClick={() => setDomain(s.domain)}><span>{s.name}</span><span className="sm-count">{ui.data.sources.filter((v: any) => v.domain === s.domain).length}</span></button>)}</nav>
    <section><WorkspaceConfiguration ui={ui} /><div className="sm-section-head"><h2>{space.name}</h2><div className="sm-actions"><a className="sm-button" {...ui.nav.linkProps('/projects/' + space.projectId)}>成员与权限</a><Button disabled={ui.busy} onClick={() => ui.run('sync-space-members', { space: domain })}>同步原生成员</Button><Button icon="plus" onClick={() => setCreate(!create)}>{create ? '收起' : '新增知识'}</Button></div></div>
      {ui.data.feishuConnected && <Details remember={ui.prefix + 'feishu-connect:' + domain}><summary>接入飞书文档</summary><form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('attach-feishu-document', { space: domain, url: feishuUrl }).then(() => setFeishuUrl('')).catch(() => {}); }}><label className="sm-field">文档链接<input className="sm-input" type="url" value={feishuUrl} onChange={e => setFeishuUrl(e.target.value)} required /></label><p className="sm-small sm-muted">保存实时来源引用，Agent 使用时仍需本任务授权。</p><div><Button disabled={ui.busy || !feishuUrl.trim()}>接入文档引用</Button></div></form></Details>}{create && <div className="sm-compose"><KnowledgeForm ui={ui} draftKey={ui.prefix + 'source-form:' + domain} submit={async record => { await ui.invoke('create-source', { domain, record: { ...record, domains: [domain] } }); setCreate(false); }} /></div>}
      <nav className="sm-task-stage" aria-label="知识库视图">{[['content', '内容'], ['graph', '图谱'], ['dictionary', '知识字典']].map(([id, title]) => <button key={id} aria-pressed={knowledgeTab === id} onClick={() => setKnowledgeTab(id!)}>{title}</button>)}</nav>
      {knowledgeTab === 'dictionary' ? <DictionaryPanel key={domain} ui={ui} space={domain} /> : <>
      <div className="sm-content-toolbar"><input className="sm-input" type="search" aria-label="搜索知识内容" placeholder="搜索标题、字段和正文" value={query} onChange={e => setQuery(e.target.value)} />
        <select className="sm-input" aria-label="内容状态" value={stateFilter} onChange={e => setStateFilter(e.target.value)}><option value="">全部状态</option>{['candidate', 'confirmed', 'withdrawn', 'source'].map(s => <option key={s} value={s}>{labels[s]}</option>)}</select>
        <select className="sm-input" aria-label="内容形态" value={shape} onChange={e => setShape(e.target.value)}><option value="">全部内容</option><option value="structured">含结构化字段</option><option value="document">含正文</option><option value="external">外部来源</option></select></div>
      {!list.length ? <div className="sm-empty"><strong>{query ? '没有匹配知识' : '这个空间还没有知识'}</strong>{query ? '更换关键词或清空搜索。' : '从任务采用结论，或直接新增一条知识。'}</div> : <><div className={knowledgeTab === 'graph' ? 'sm-graph-source-select' : 'sm-mobile-select'} style={{ marginBottom: 18 }}><label className="sm-field">知识条目<select className="sm-input" value={current?.id ?? ''} onChange={e => choose(e.target.value)}>{list.map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label></div>
      <div className="sm-space-layout" data-view={knowledgeTab}><div className="sm-source-list">{list.map((s: any) => <button key={s.id} aria-current={s.id === current?.id} onClick={() => choose(s.id)}><strong>{s.title}</strong><span className="sm-inline-meta"><Badge state={s.restricted ? 'pending' : s.knowledgeState}>{s.restricted ? '需申请访问' : undefined}</Badge>{s.record && <span>{Object.keys(s.record.value.facts).length} 项事实</span>}</span></button>)}</div>
        {current && <article className="sm-stack"><div className="sm-row sm-spread sm-wrap"><h3>{current.title}</h3><Badge state={current.knowledgeState} /></div>
          {current.external ? <><p className="sm-muted sm-small">飞书实时来源，仅在任务明确授权后取用；不会自动成为已确认知识。</p><div className="sm-actions"><a href={current.external.url} target="_blank" rel="noreferrer" className="sm-button">打开飞书来源</a><Button onClick={() => composeWith(current.id)}>关联到协作任务</Button></div></> : current.record ? <><div className="sm-inline-meta"><span>{contentKinds[current.record.value.kind]}</span><span>版本 {current.record.revision.slice(0, 8)}</span>{current.record.value.expiresAt && <span>有效至 {date(current.record.value.expiresAt)}</span>}</div>
            {editing && knowledgeTab === 'content' ? <><p className="sm-small sm-muted">修改后成为待确认版本，原有确认不沿用；共享范围保持不变。</p><KnowledgeForm key={current.record.revision} ui={ui} draftKey={ui.prefix + 'edit-source:' + current.id + ':' + current.record.revision} initial={current.record.value} submit={async record => { await ui.invoke('update-source', { id: current.id, revision: current.record.revision, record }); setEditing(false); }} /><div><Button onClick={() => setEditing(false)}>取消编辑</Button></div></> : knowledgeTab === 'graph' ? <GraphPanel key={current.id + current.record.revision} ui={ui} source={current} /> : <RecordBody record={current.record.value} />}
            <div className="sm-actions">{knowledgeTab === 'content' && !editing && ui.data.operator === '本机管理员' && <Button onClick={() => setEditing(true)}>编辑内容</Button>}<Button variant="primary" icon="arrow" onClick={() => composeWith(current.id)}>用于协作</Button><a className="sm-button" {...ui.nav.linkProps('/issues/' + current.id)}>版本记录</a></div>
            <div className="sm-actions">{current.knowledgeState !== 'confirmed' ? <Button disabled={ui.busy} onClick={() => ui.run('review-source', { id: current.id, state: 'confirmed', revision: current.record.revision })}>确认当前版本</Button> : <Button variant="quiet" disabled={ui.busy} onClick={() => ui.run('review-source', { id: current.id, state: 'withdrawn', revision: current.record.revision })}>撤回此结论</Button>}</div></>
            : <><p className="sm-muted">当前身份没有此资料的读取权限，可关联到任务后按用途申请访问。</p><div><Button onClick={() => composeWith(current.id)}>关联到协作任务</Button></div></>}
          <div className="sm-muted sm-small">{ui.data.tasks.filter((t: any) => t.state.sources.includes(current.id)).map((t: any) => <div key={t.id}>引用任务：<button className="sm-link-button" onClick={() => ui.openTask(t.id, 'access')}>{t.identifier} · {t.title}</button></div>)}</div>
        </article>}
      </div></>}
      </>}
    </section></div>;
}
function AccessInbox({ ui }: { ui: UI }) {
  const [filter, setFilter] = useDraft(ui.prefix + 'request-filter', 'pending');
  const requests = ui.data.tasks.flatMap((t: any) => t.requests.filter((r: any) => filter === 'all' || filter === 'pending' && r.state === 'pending' && Date.parse(r.expiresAt) > Date.now() || filter === 'approved' && isLive(r)).map((r: any) => ({ task: t, request: r })));
  return <section><div className="sm-section-head"><h2>授权申请</h2><label className="sm-field"><span className="sm-small sm-muted">查看范围</span><select className="sm-input" value={filter} onChange={e => setFilter(e.target.value)}><option value="pending">待我处理</option><option value="approved">生效中的授权</option><option value="all">全部记录</option></select></label></div>
    {!requests.length && <div className="sm-empty"><strong>{filter === 'pending' ? '当前没有待处理的访问申请' : '没有匹配的授权记录'}</strong>所有申请都绑定资料、任务、执行身份和期限。</div>}
    {requests.map(({ task, request }: any) => <RequestItem key={request.id} ui={ui} task={task} request={request} />)}</section>;
}
function WorkspaceConfiguration({ ui }: { ui: UI }) {
  const k = ui.prefix + 'configuration:', [editing, setEditing] = useDraft(k + 'editing', ''), [name, setName] = useDraft(k + 'name', ''),
    [owner, setOwner] = useDraft(k + 'owner', ui.data.actors[0]?.key ?? ''), [description, setDescription] = useDraft(k + 'description', ''),
    [participants, setParticipants] = useDraft<string[]>(k + 'participants', ui.data.actors.map((a: any) => a.key));
  if (!ui.data.configurableAgents?.length) return null;
  return <Details remember={k + 'open'}><summary>配置空间与执行身份</summary><div className="sm-stack sm-section">
    <form className="sm-form" onSubmit={e => { e.preventDefault(); const id = editing || 'space-' + crypto.randomUUID(); void ui.invoke('configure-space', { id, name, agent: owner, description }).then(() => { setEditing(id); }).catch(() => {}); }}>
      <label className="sm-field">知识空间<select className="sm-input" value={editing} onChange={e => { const s = ui.data.spaces.find((s: any) => s.domain === e.target.value); setEditing(e.target.value); setName(s?.name ?? ''); setOwner(s?.agent ?? ui.data.actors[0]?.key ?? ''); setDescription(s?.description ?? ''); }}><option value="">新建空间</option>{ui.data.spaces.map((s: any) => <option key={s.domain} value={s.domain}>{s.name}</option>)}</select></label>
      <div className="sm-form-grid"><label className="sm-field">名称<input className="sm-input" value={name} onChange={e => setName(e.target.value)} required /></label><label className="sm-field">资料责任身份<select className="sm-input" value={owner} onChange={e => setOwner(e.target.value)}>{ui.data.configurableAgents.map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label></div>
      <label className="sm-field">适用范围<input className="sm-input" value={description} onChange={e => setDescription(e.target.value)} /></label>
      <p className="sm-muted sm-small">空间可以按项目、主题或团队组织。新建空间不自动授予资料访问；成员在原生权限页管理，飞书资料另按任务授权。</p><div><Button disabled={ui.busy || !name.trim()}>保存空间</Button></div>
    </form><form className="sm-form" onSubmit={e => { e.preventDefault(); ui.run('configure-participants', { keys: participants }); }}><fieldset className="sm-choices"><legend>可选执行身份</legend>{ui.data.configurableAgents.map((a: any) => <label className="sm-check" key={a.key}><input type="checkbox" checked={participants.includes(a.key)} onChange={e => setParticipants(e.target.checked ? [...participants, a.key] : participants.filter(x => x !== a.key))} />{a.name}</label>)}</fieldset><p className="sm-muted sm-small">调整可选身份不改变原生资源权限。正在负责的任务须先交接。</p><div><Button disabled={ui.busy || !participants.length}>保存执行身份</Button></div></form>
  </div></Details>;
}
function Settings({ ui }: { ui: UI }) {
  const [tab, setTab] = useDraft(ui.prefix + 'settings-tab', 'models'), [modelData, setModelData] = useDraft<any>(ui.prefix + 'model-data', null), [draft, setDraft] = useDraft<any>(ui.prefix + 'model-draft', null);
  const [system, setSystem] = useState<any>(), [loadError, setLoadError] = useState(''), [saved, setSaved] = useState(false);
  async function load() { setLoadError(''); try { const [m, s] = await Promise.all([ui.read('model-settings', {}), ui.read('system-status', {})]); setModelData(m); if (!draft) setDraft(m.settings); setSystem(s); } catch (e: any) { setLoadError(e.message ?? String(e)); } }
  useEffect(() => { void load(); }, []);
  const tiers: Record<string, string> = { fast: '轻量事务', standard: '复杂分析', code: '开发执行' }, providers: Record<string, string> = { unconfigured: '待选择', gemini: 'Gemini', ark: '火山方舟', 'codex-cli': 'Codex CLI', 'claude-cli': 'Claude Code CLI', other: '其他服务' };
  function profileChange(id: string, key: string, value: any) { setSaved(false); setDraft({ ...draft, profiles: draft.profiles.map((p: any) => p.id === id ? { ...p, [key]: value } : p) }); }
  return <section className="sm-stack"><nav className="sm-task-stage" aria-label="系统设置"><button aria-pressed={tab === 'models'} onClick={() => setTab('models')}>模型与代理</button><button aria-pressed={tab === 'system'} onClick={() => setTab('system')}>服务与架构</button></nav>
    {loadError && <div className="sm-error" role="alert">{loadError}<Button onClick={() => void load()}>重试</Button></div>}
    {tab === 'models' && (!draft || !modelData ? <p role="status">正在读取模型配置…</p> : <><div className="sm-section-head"><h2>模型与代理</h2><Badge>新模型服务未启用</Badge></div>
      <p className="sm-small sm-muted">当前协作助手：{modelData.currentAssistant.engine === 'claude' ? 'Claude Code' : 'Codex'} CLI · {modelData.currentAssistant.model ?? '未显式指定型号'}。以下保存为预备策略，不切换既有任务，也不发送资料到新服务。</p>
      <form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('save-model-settings', { settings: draft, revision: modelData.revision }).then(m => { setModelData(m); setDraft(m.settings); setSaved(true); }).catch(() => {}); }}>
        {draft.profiles.map((p: any) => <fieldset className="sm-model-profile" key={p.id}><legend>{tiers[p.tier]}</legend><p className="sm-small sm-muted">{p.tier === 'fast' ? '摘要、分类、待办提取、交接整理。' : p.tier === 'standard' ? '多来源分析、方案推理与复杂决策准备。' : '交给 Codex、Claude Code 等开发工具执行。'}</p>
          <div className="sm-form-grid"><label className="sm-field">服务<select className="sm-input" value={p.provider} onChange={e => profileChange(p.id, 'provider', e.target.value)}>{Object.entries(providers).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="sm-field">模型标识<input className="sm-input" value={p.model} placeholder={p.tier === 'fast' ? '填写 Flash／Lite 级模型或接入点 ID' : '填写明确的模型 ID'} onChange={e => profileChange(p.id, 'model', e.target.value)} /></label></div>
          {!p.provider.endsWith('-cli') && <label className="sm-field">凭据环境变量名<input className="sm-input" value={p.credentialEnv} placeholder="仅填写变量名，不填写密钥" pattern="[A-Z][A-Z0-9_]{0,79}|^$" onChange={e => profileChange(p.id, 'credentialEnv', e.target.value)} /></label>}
          <Details remember={ui.prefix + 'model-limits:' + p.id}><summary>预备额度</summary><div className="sm-form-grid"><label className="sm-field">每次输入字符上限<input className="sm-input" type="number" min="1000" max="80000" value={p.maxInputChars} onChange={e => profileChange(p.id, 'maxInputChars', Number(e.target.value))} /></label><label className="sm-field">每次输出 Token 上限<input className="sm-input" type="number" min="128" max="16384" value={p.maxOutputTokens} onChange={e => profileChange(p.id, 'maxOutputTokens', Number(e.target.value))} /></label></div></Details>
        </fieldset>)}
        <h3>执行身份的模型绑定</h3><p className="sm-small sm-muted">当前安装仅绑定本机管理员。这里的执行身份尚不代表真实员工账号；后续成员可使用共享模型服务，任务上下文和授权分别隔离。</p>
        <div className="sm-table-scroll"><table className="sm-table"><thead><tr><th>执行身份</th>{Object.values(tiers).map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{draft.bindings.map((b: any) => <tr key={b.agent}><th>{modelData.identities.find((a: any) => a.key === b.agent)?.name ?? b.agent}</th>{Object.keys(tiers).map(tier => <td key={tier}><select className="sm-input" aria-label={(modelData.identities.find((a: any) => a.key === b.agent)?.name ?? b.agent) + '的' + tiers[tier]} value={b[tier]} onChange={e => { setSaved(false); setDraft({ ...draft, bindings: draft.bindings.map((v: any) => v.agent === b.agent ? { ...v, [tier]: e.target.value } : v) }); }}><option value="">不绑定</option>{draft.profiles.filter((p: any) => p.tier === tier).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>)}</tr>)}</tbody></table></div>
        <div className="sm-actions"><Button variant="primary" disabled={ui.busy}>保存预备配置</Button>{saved && <span role="status">已保存到私有数据库记录，尚未启用。</span>}</div>
      </form></>)}
    {tab === 'system' && (!system ? <p role="status">正在核对服务…</p> : <><h2>服务与架构</h2><div className="sm-table-scroll"><table className="sm-table"><thead><tr><th>组件</th><th>当前状态</th></tr></thead><tbody>
      <tr><th>Paperclip / 协作服务</th><td>{system.services.paperclip === 'ok' && system.services.bridge === 'ok' ? '运行中' : '待恢复'}</td></tr><tr><th>飞书事件通道</th><td>{system.services.feishu === 'ready' ? '已连接' : '未连接'}</td></tr>
      <tr><th>业务数据</th><td>{system.storage.primary}</td></tr><tr><th>事件、去重与回执</th><td>SQLite（本机持久化）</td></tr><tr><th>数据库备份</th><td>{system.storage.databaseBackup === 'ok' ? '本机备份正常；异机恢复尚未验证' : '待核对'}</td></tr>
      <tr><th>知识引擎</th><td>{system.knowledgeEngine?.installed ? `Cognee · Ladybug；${system.knowledgeEngine.sourceRevisionGraphs} 个来源版本图谱` : 'Cognee 尚未安装'}</td></tr><tr><th>自动知识处理</th><td>实体抽取、语义检索与记忆整理尚未启用</td></tr><tr><th>模型 API / 向量检索 / 对象存储</th><td>尚未接入</td></tr><tr><th>团队登录</th><td>单机受信任模式，员工独立登录尚未接入</td></tr></tbody></table></div>
      <h3>运行关系</h3><ol className="sm-architecture"><li><strong>入口</strong><span>飞书 · 中文协作台 · MCP</span></li><li><strong>协作与上下文</strong><span>任务 · 资料授权 · 版本 · 交接 · 人工验收</span></li><li><strong>原生运行</strong><span>Paperclip 调度与锁 → 当前 Codex CLI；轻量模型待启用</span></li><li><strong>知识与存储</strong><span>字段 + 正文 → 私有文档与修订 → PostgreSQL；确切修订 → Cognee / Ladybug 图谱</span></li></ol>
      <p className="sm-small sm-muted">Wiki 另存于本机 Markdown 目录，自动摄取关闭。当前知识库沿用原生私有文档权限，未把私有资料复制进共享 Wiki。目录配置和部分事件仍在本机文件与 SQLite 中。</p>
      <Details remember={ui.prefix + 'system-counts'}><summary>存储记录（包含联调数据）</summary><dl className="sm-document">{Object.entries(system.records).map(([key, value]) => <div key={key}><dt>{{ tasks: '任务映射', events: '接入事件', outbox: '出站回执', audit: '审计事件' }[key]}</dt><dd>{String(value)}</dd></div>)}</dl></Details>
    </>)}
  </section>;
}
export function WorkspacePage({ context }: PluginPageProps) {
  const action = usePluginAction('workspace'), nav = useHostNavigation();
  const prefix = 'suitme-v3:' + context.companyId + ':' + context.userId + ':', ref = useRef<HTMLElement>(null), requestSeq = useRef(0), inFlight = useRef<Promise<any> | undefined>(undefined);
  const [data, setData] = useState<any>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [view, setView] = useDraft(prefix + 'view', 'work'), [selected, setSelected] = useDraft(prefix + 'selected-task', ''), [panel, setPanel] = useDraft(prefix + 'panel:' + selected, 'progress');
  const [compose, setCompose] = useDraft(prefix + 'compose', false), [chosenSources, setChosenSources] = useDraft<string[]>(prefix + 'chosen-sources', []);
  const [domain, setDomain] = useDraft(prefix + 'domain', ''), [chosenSourcesByDomain, setChosenSourcesByDomain] = useDraft<Record<string, string>>(prefix + 'source-selections', {});
  const chosenSource = chosenSourcesByDomain[domain] ?? '';
  const setChosenSource = (id: string) => setChosenSourcesByDomain(previous => ({ ...previous, [domain]: id }));
  const refresh = useCallback(async (afterMutation = false) => {
    // Polls share one request. A slow read must not be superseded forever by the next timer.
    if (inFlight.current) { const value = await inFlight.current; if (!afterMutation) return value; }
    const seq = ++requestSeq.current, pending = action({ companyId: context.companyId, action: 'view', payload: {} }); inFlight.current = pending;
    try { const value = await pending; if (seq === requestSeq.current) setData(value); return value; }
    finally { if (inFlight.current === pending) inFlight.current = undefined; }
  }, [context.companyId, action]);
  useEffect(() => { let mounted = true; void refresh().catch(e => mounted && setError(String(e.message ?? e))); return () => { mounted = false; ++requestSeq.current; }; }, [refresh]);
  useEffect(() => { if (data && !data.spaces.some((s: any) => s.domain === domain)) setDomain(data.spaces[0]?.domain ?? ''); }, [data, domain]);
  useEffect(() => { if (data && !data.tasks.some((t: any) => t.id === selected)) setSelected(data.tasks.find((t: any) => t.phase !== 'accepted')?.id ?? data.tasks[data.tasks.length - 1]?.id ?? ''); }, [data, selected]);
  const ticking = data?.tasks.some((t: any) => ['queued', 'running', 'cancelling'].includes(t.assistant?.status));
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) void refresh().catch(() => {}); }, ticking ? 4000 : 20000); return () => clearInterval(timer); }, [refresh, ticking]);
  useLayoutEffect(() => {
    if (!data || !ref.current) return;
    let parent = ref.current.parentElement; while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    const scroller = parent, target = scroller ?? window, key = prefix + 'scroll:' + view + ':' + (view === 'tasks' ? selected + ':' + panel : '');
    const save = () => retained.set(key, scroller ? scroller.scrollTop : window.scrollY);
    const frame = requestAnimationFrame(() => { const y = retained.get(key) as number ?? 0; if (scroller) scroller.scrollTop = y; else window.scrollTo(0, y); target.addEventListener('scroll', save, { passive: true }); });
    return () => { cancelAnimationFrame(frame); save(); target.removeEventListener('scroll', save); };
  }, [Boolean(data), prefix, view, selected, panel]);
  async function invoke(name: string, payload: any) { setBusy(true); setError(''); try { const value = await action({ companyId: context.companyId, action: name, payload }); await refresh(true); return value; }
    catch (e: any) { setError(String(e.message ?? e)); throw e; } finally { setBusy(false); } }
  const run = (name: string, payload: any) => { void invoke(name, payload).catch(() => {}); };
  function openTask(id: string, nextPanel = 'progress') { if (id === selected) setPanel(nextPanel); else retained.set(prefix + 'panel:' + id, nextPanel); setSelected(id); setView('tasks'); }
  function useSource(id: string) { const s = data?.sources.find((v: any) => v.id === id); if (s) { setDomain(s.domain); setChosenSourcesByDomain(previous => ({ ...previous, [s.domain]: id })); } setView('spaces'); }
  const ui: UI = { data, busy, prefix, nav, invoke, run, openTask, useSource, read: (name, payload) => action({ companyId: context.companyId, action: name, payload }) };
  if (!data) return <main className="suitme-workbench"><style>{styles}</style>{error ? <div className="sm-error" role="alert"><span>{error}</span><Button onClick={() => { setError(''); void refresh().catch(e => setError(String(e.message ?? e))); }}>重试</Button></div> : <div className="sm-spinner-skeleton" role="status" aria-label="正在读取协作台"><div /><div /><div /><div /></div>}</main>;
  const pending = data.tasks.reduce((n: number, t: any) => n + t.requests.filter((r: any) => r.state === 'pending' && Date.parse(r.expiresAt) > Date.now()).length, 0);
  return <main className="suitme-workbench" ref={ref}><style>{styles}</style><header className="sm-top"><div className="sm-row"><h1>SuitMe 协作台</h1></div><div className="sm-actions"><Button className="sm-icon-button" aria-label="刷新工作台" title="刷新" disabled={busy} onClick={() => { void refresh().catch(e => setError(String(e.message ?? e))); }}><Icon name="refresh" /></Button><Button variant="primary" icon="plus" onClick={() => setCompose(!compose)}>发起协作</Button></div></header>
    <nav className="sm-navigation" aria-label="协作台导航">{[['work', '我的工作', 'work'], ['tasks', '协作任务', 'task'], ['spaces', '知识库', 'book'], ['services', '团队 Agent', 'bot'], ['access', '授权申请', 'shield'], ['settings', '设置', 'bot']].map(([id, name, icon]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id!)}><Icon name={icon!} />{name}{id === 'access' && pending > 0 && <span className="sm-count">{pending}</span>}</button>)}</nav>
    {error && <div className="sm-error" role="alert"><span>{error}</span><Button variant="quiet" onClick={() => setError('')}>关闭提示</Button></div>}
    {compose && <Compose ui={ui} initialSources={chosenSources} close={() => { setCompose(false); setChosenSources([]); }} />}
    {view === 'work' && <MyWork ui={ui} />}
    {view === 'tasks' && <TaskWorkspace ui={ui} selected={selected} setSelected={setSelected} panel={panel} setPanel={setPanel} />}
    {view === 'spaces' && <Spaces ui={ui} chosen={chosenSource} choose={setChosenSource} domain={domain} setDomain={setDomain} composeWith={id => { setChosenSources([id]); setCompose(true); }} />}
    {view === 'access' && <AccessInbox ui={ui} />}
    {view === 'services' && <AgentServicesPage ui={ui} />}
    {view === 'settings' && <Settings ui={ui} />}
  </main>;
}

function ContextPanel({ ui, task }: { ui: UI; task: any }) {
  const k = ui.prefix + 'context:' + task.id, [loaded, setLoaded] = useState<{ stamp: string; value: any }>(), [error, setError] = useState('');
  const [note, setNote] = useDraft(k + ':note', ''), [linked, setLinked] = useDraft(k + ':linked', ''), [addSource, setAddSource] = useDraft(k + ':add-source', '');
  const stamp = task.generation + ':' + task.state.history.length + ':' + JSON.stringify(task.sourceAccess) + ':' + task.snapshots.map((s: any) => s.id + ':' + s.revision).join(',') + ':' + ui.data.sources.filter((s: any) => task.state.sources.includes(s.id)).map((s: any) => s.record?.revision).join(',');
  const pack = loaded?.stamp === stamp ? loaded.value : undefined;
  useEffect(() => { let current = true; setError(''); void ui.read('context-pack', { taskId: task.id }).then(value => { if (current) setLoaded({ stamp, value }); }).catch(e => current && setError(String(e.message ?? e)));
    return () => { current = false; }; }, [task.id, stamp]);
  const closed = task.phase === 'accepted';
  return <div className="sm-stack"><div className="sm-section-head"><h3>任务上下文</h3><Button disabled={ui.busy || closed} icon="refresh" onClick={() => ui.run('context-discover', { taskId: task.id })}>查找相关知识</Button></div>
    {error && <p role="alert" className="sm-notice">{error}</p>}
    {!pack ? <p className="sm-muted sm-small" role="status">正在核对来源、版本和访问范围…</p> : <>
      <div className="sm-row sm-wrap"><Badge>{pack.layers.sources.filter((s: any) => s.kind === 'knowledge' && !s.external).length} 份知识</Badge><Badge>{pack.layers.sources.filter((s: any) => s.external).length} 份来源证据</Badge><Badge>{pack.layers.sources.filter((s: any) => s.kind === 'note').length} 份背景</Badge><Badge>{pack.layers.checkpoints.length} 份工作记录</Badge><Badge>{pack.layers.sources.filter((s: any) => s.kind === 'delivery').length} 份研发交付</Badge>
        {pack.coverage.partialSources > 0 && <Badge>{pack.coverage.partialSources} 份使用了检索片段</Badge>}</div>
      {pack.layers.missing.length > 0 && <div className="sm-notice"><h3>尚未获取的上下文</h3><ul>{pack.layers.missing.map((m: any) => <li key={m.id}>{m.title} · {m.reason === 'version' ? '当前版本待确认' : m.reason === 'permission' ? '当前执行身份未获准访问' : '暂不可读取'}</li>)}</ul></div>}
      <div>{pack.layers.sources.map((s: any) => <Details remember={k + ':source:' + s.id} key={s.id}><summary>{s.title} <span className="sm-muted sm-small">· {s.external ? '来源证据' : s.kind === 'note' ? '人工背景' : s.kind === 'delivery' ? '真实交付' : s.kind === 'conversation' ? '讨论补充' : '专业知识'}</span></summary>
        <div className="sm-stack"><div className="sm-muted sm-small">{s.truncated ? `本轮载入 ${s.range.start}–${s.range.end} / ${s.totalChars} 字符，仍有未读内容` : '已载入当前正文'} · 版本 {s.revision.slice(0, 8)}</div>
          {s.facts && Object.keys(s.facts).length > 0 && <RecordBody record={{ facts: s.facts, body: '' }} />}{s.factsTruncated && <p className="sm-muted sm-small">事实字段也使用了预算内片段，完整信息见来源。</p>}
          {s.external && <p className="sm-small"><a href={s.external.url} target="_blank" rel="noreferrer">飞书原始来源</a> · {s.external.kind === 'messages' ? '历史讨论证据' : '原文当前版本'}，每轮重新核对可读状态</p>}{s.kind === 'delivery' && s.delivery ? <div className="sm-document"><dl><div><dt>需求来源</dt><dd>{s.origin === 'feishu' ? '飞书发起' : '后台发起'}</dd></div><div><dt>GitHub 交付</dt><dd><a href={s.delivery.url} target="_blank" rel="noreferrer">PR #{s.delivery.pr}</a></dd></div><div><dt>代码检查</dt><dd>{s.delivery.ci === 'passed' ? '已通过' : s.delivery.ci === 'failed' ? '未通过' : '待完成'}</dd></div><div><dt>交付版本</dt><dd>{s.delivery.headSha?.slice(0, 12)}</dd></div><div><dt>预览版本</dt><dd>{s.delivery.deployedSha?.slice(0, 12) ?? '未部署预览'}</dd></div><div><dt>验收</dt><dd>{s.taskStatus === 'accepted' ? '已按指定版本验收' : '尚未验收'}</dd></div></dl></div> : <RecordBody body={s.body} />}
          {s.truncatedMessages && <p className="sm-muted sm-small">本轮载入最近 {s.includedMessages} / {s.totalMessages} 条可见讨论，较早内容未载入。</p>}
          <div className="sm-actions"><a className="sm-button" {...ui.nav.linkProps('/issues/' + (s.nativeIssueId ?? s.id))}>来源与版本</a>{(s.truncated || s.truncatedMessages) && ['knowledge', 'note', 'conversation'].includes(s.kind) && <Button disabled={ui.busy || closed || pack.fullSources.includes(s.id)} onClick={() => ui.run('context-expand', { taskId: task.id, sourceId: s.id })}>扩展读取范围</Button>}
            {s.kind === 'knowledge' && !closed && <Button variant="quiet" disabled={ui.busy} aria-label={'将' + s.title + '移出任务并结束临时授权'} onClick={() => ui.run('context-exclude', { taskId: task.id, sourceId: s.id })}>移出并结束临时授权</Button>}</div>
          <p className="sm-muted sm-small">{s.selectionReason}</p></div>
      </Details>)}</div>
      {pack.layers.checkpoints.length > 0 && <Details remember={k + ':records'}><summary>已纳入的工作记录</summary><div className="sm-tight">{pack.layers.checkpoints.map((c: any) => <div key={c.id} className="sm-row sm-spread sm-wrap"><a {...ui.nav.linkProps('/issues/' + c.id)}>{c.title}</a><span className="sm-muted sm-small">版本 {c.revision.slice(0, 8)}{c.truncated ? ' · 使用片段' : ''}</span></div>)}</div></Details>}
      {pack.matches.some((m: any) => !m.selected) && <div className="sm-notice sm-stack"><h3>可用知识中还有相关内容</h3>{pack.matches.filter((m: any) => !m.selected).map((m: any) => <div key={m.id}><strong>{m.title}</strong><p className="sm-small">{m.reason}</p></div>)}<div><Button disabled={ui.busy || closed} onClick={() => ui.run('context-discover', { taskId: task.id })}>引用相关知识</Button></div></div>}
      {pack.availableDeliveries.length > 0 && <Details remember={k + ':delivery'}><summary>关联已有研发交付</summary><div className="sm-form"><label className="sm-field">已有任务<select className="sm-input" value={linked} onChange={e => setLinked(e.target.value)}><option value="">选择研发任务</option>{pack.availableDeliveries.map((t: any) => <option key={t.id} value={t.id} disabled={t.linked}>{t.identifier} · {t.title}{t.linked ? '（已关联）' : ''}</option>)}</select></label><div><Button disabled={ui.busy || closed || !linked} onClick={() => { void ui.invoke('context-link', { taskId: task.id, linkedId: linked }).then(() => setLinked('')).catch(() => {}); }}>关联需求、PR、CI 与验收记录</Button></div></div></Details>}
      {!closed && <Details remember={k + ':include'}><summary>指定其他参考知识</summary><div className="sm-form"><label className="sm-field">知识条目<select className="sm-input" value={addSource} onChange={e => setAddSource(e.target.value)}><option value="">选择要引用的资料</option>{ui.data.sources.filter((s: any) => !task.state.sources.includes(s.id)).map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label><p className="sm-muted sm-small">引用不授予权限；其他岗位的资料仍需按用途申请。</p><div><Button disabled={ui.busy || !addSource} onClick={() => { void ui.invoke('context-include', { taskId: task.id, sourceId: addSource }).then(() => setAddSource('')).catch(() => {}); }}>引用到本任务</Button></div></div></Details>}
    </>}
    {!closed && <form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('context-note', { taskId: task.id, text: note }).then(() => setNote('')).catch(() => {}); }}>
      <label className="sm-field">补充背景、约束或决定<textarea className="sm-input" placeholder="例如：业务目标、讨论结论、已有研究、不可改动的范围，以及还需要核实的事实。" value={note} onChange={e => setNote(e.target.value)} required /></label>
      <div className="sm-row sm-spread sm-wrap"><span className="sm-muted sm-small">仅用于本任务，可随任务交接接续；不会自动成为专业知识。</span><Button disabled={ui.busy || !note.trim()}>加入任务上下文</Button></div></form>}
  </div>;
}
