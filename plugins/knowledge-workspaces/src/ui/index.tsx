import { useEffect, useLayoutEffect, useRef, useState, type DetailsHTMLAttributes, type Dispatch, type SetStateAction } from 'react';
import { usePluginAction, useHostNavigation, MarkdownBlock, MarkdownEditor, type PluginPageProps, type PluginSidebarProps } from '@paperclipai/plugin-sdk/ui';
type Fact = { name: string; value: string };
const labels: Record<string, string> = { pending: '待授权', approved: '已授权', denied: '已拒绝', revoked: '已撤权', revoking: '撤权中', expired: '已过期',
  ready: '待接单', waiting: '待交接', running: '执行中', handoff_pending: '正在恢复交接', access_blocked: '等待访问权限', unknown: '待核对执行', accepted: '已完成',
  candidate: '待确认', confirmed: '已确认', withdrawn: '已撤回' };
const events: Record<string, string> = { 'task-created': '创建任务', 'access-requested': '申请资料', 'access-approved': '批准访问', 'access-denied': '拒绝申请',
  'access-revoked': '撤销授权', 'access-expired': '授权到期', checkpoint: '保存检查点', handoff: '交接岗位', 'knowledge-proposed': '提交知识候选',
  'knowledge-confirmed': '确认结论', 'knowledge-withdrawn': '撤回结论', 'knowledge-published': '采用到专业空间', completed: '结束任务与临时授权',
  'execution-stop-confirmed': '核对执行已停止', 'contract-migrated': '升级协作记录' };
const button = 'rounded border border-border px-3 py-2 text-sm disabled:opacity-50';
const input = 'w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground';
// In-memory drafts survive host navigation, without writing private inputs to browser storage.
const retained = new Map<string, unknown>();
function useRetained<T,>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, update] = useState<T>(() => retained.has(key) ? retained.get(key) as T : initial);
  useEffect(() => { update(retained.has(key) ? retained.get(key) as T : initial); }, [key]);
  const set: Dispatch<SetStateAction<T>> = next => { const v = typeof next === 'function' ? (next as (v: T) => T)(retained.has(key) ? retained.get(key) as T : value) : next;
    retained.set(key, v); update(v); };
  return [value, set];
}
function Details({ remember, ...props }: DetailsHTMLAttributes<HTMLDetailsElement> & { remember: string }) {
  const [open, setOpen] = useRetained(remember, false);
  return <details {...props} open={open} onToggle={e => setOpen(e.currentTarget.open)} />;
}
export function WorkspaceSidebar(_props: PluginSidebarProps) {
  const nav = useHostNavigation(); return <a {...nav.linkProps('/knowledge-workspaces')} className="flex items-center px-3 py-2 text-sm">知识协作</a>;
}
function KnowledgeForm({ submit, busy, draftKey, compact = false }: { submit: (data: any) => Promise<void>; busy: boolean; draftKey: string; compact?: boolean }) {
  const [title, setTitle] = useRetained(draftKey + ':title', ''), [body, setBody] = useRetained(draftKey + ':body', ''),
    [scope, setScope] = useRetained(draftKey + ':scope', ''), [links, setLinks] = useRetained(draftKey + ':links', '');
  const [facts, setFacts] = useRetained<Fact[]>(draftKey + ':facts', [{ name: '', value: '' }]);
  return <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void submit({ key: 'knowledge-' + crypto.randomUUID().slice(0, 18),
    title, kind: 'reference', appliesTo: scope, body, sources: links.split(/\s+/).filter(Boolean), facts: Object.fromEntries(facts.filter(f => f.name.trim()).map(f => [f.name.trim(), f.value])) })
    .then(() => { setTitle(''); setBody(''); setScope(''); setLinks(''); setFacts([{ name: '', value: '' }]); }).catch(() => {}); }}>
    <label>标题<input className={input} required value={title} onChange={e => setTitle(e.target.value)} /></label>
    <label>适用范围<input className={input} required value={scope} onChange={e => setScope(e.target.value)} /></label>
    <fieldset className="grid gap-2"><legend>事实字段</legend>{facts.map((f, i) => <div key={i} className="grid grid-cols-2 gap-2">
      <input aria-label={'字段名 ' + (i + 1)} placeholder="字段名" className={input} value={f.name} onChange={e => setFacts(facts.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
      <input aria-label={'字段值 ' + (i + 1)} placeholder="值" className={input} value={f.value} onChange={e => setFacts(facts.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
    </div>)}<button type="button" className={button} onClick={() => setFacts([...facts, { name: '', value: '' }])}>添加字段</button></fieldset>
    <label>正文<MarkdownEditor value={body} onChange={setBody} bordered /></label>
    <label>来源链接<textarea className={input} required value={links} onChange={e => setLinks(e.target.value)} /></label>
    <button className={button} disabled={busy || !body.trim()}>{compact ? '提交知识候选' : '保存知识'}</button>
  </form>;
}
export function WorkspacePage({ context }: PluginPageProps) {
  const action = usePluginAction('workspace'), nav = useHostNavigation();
  const prefix = 'workspace:' + context.companyId + ':', pageRef = useRef<HTMLElement>(null);
  const [data, setData] = useState<any>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [domain, setDomain] = useRetained(prefix + 'domain', 'product'), [selectedTask, setSelectedTask] = useRetained(prefix + 'selectedTask', ''), [showSource, setShowSource] = useRetained(prefix + 'showSource', false);
  const [title, setTitle] = useRetained(prefix + 'title', ''), [goal, setGoal] = useRetained(prefix + 'goal', ''), [agent, setAgent] = useRetained(prefix + 'agent', 'role-growth'), [sources, setSources] = useRetained<string[]>(prefix + 'sources', []);
  const [sourceId, setSourceId] = useRetained(prefix + 'sourceId', ''), [requestAgent, setRequestAgent] = useRetained(prefix + 'requestAgent', ''), [purpose, setPurpose] = useRetained(prefix + 'purpose', ''), [hours, setHours] = useRetained(prefix + 'hours', 8);
  const [checkpoint, setCheckpoint] = useRetained(prefix + 'checkpoint', ''), [next, setNext] = useRetained(prefix + 'next', 'role-product'), [reasons, setReasons] = useRetained<Record<string, string>>(prefix + 'reasons', {});
  const [stopped, setStopped] = useState(false), [stopNote, setStopNote] = useState('');
  async function refresh() { const v = await action({ companyId: context.companyId, action: 'view', payload: {} }); setData(v); return v; }
  useEffect(() => { void refresh().catch(e => setError(String(e.message ?? e))); }, [context.companyId]);
  useLayoutEffect(() => {
    if (!data || !pageRef.current) return;
    let el = pageRef.current.parentElement;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    const scroller = el, target = scroller ?? window, key = prefix + 'scroll';
    const save = () => retained.set(key, scroller ? scroller.scrollTop : window.scrollY);
    const frame = requestAnimationFrame(() => { const y = retained.get(key) as number ?? 0; if (scroller) scroller.scrollTop = y; else window.scrollTo(0, y); target.addEventListener('scroll', save, { passive: true }); });
    return () => { cancelAnimationFrame(frame); save(); target.removeEventListener('scroll', save); };
  }, [Boolean(data), prefix]);
  async function invoke(name: string, payload: any): Promise<any> {
    setBusy(true); setError('');
    try { const result = await action({ companyId: context.companyId, action: name, payload }); await refresh(); return result; }
    catch (e: any) { setError(String(e.message ?? e)); throw e; } finally { setBusy(false); }
  }
  const run = (name: string, payload: any) => { void invoke(name, payload).catch(() => {}); };
  if (!data) return <div className="p-6" role="status">{error || '正在读取知识空间'}</div>;
  const task = data.tasks.find((t: any) => t.id === selectedTask) ?? data.tasks[data.tasks.length - 1];
  const actorName = (key: string) => data.actors.find((a: any) => a.key === key)?.name ?? key;
  const sourceName = (id: string) => data.sources.find((s: any) => s.id === id)?.title ?? id;
  return <main ref={pageRef} className="grid gap-6 p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold">知识协作</h1>
      <span>{data.operator}</span><button className={button} disabled={busy} onClick={() => { void refresh().catch(e => setError(e.message)); }}>刷新</button></header>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <nav aria-label="专业空间" className="flex flex-wrap gap-2">{data.spaces.map((s: any) => <button key={s.domain} className={button}
      aria-pressed={domain === s.domain} onClick={() => setDomain(s.domain)}>{s.name}</button>)}</nav>
    <section className="grid gap-3" aria-label="知识条目">
      <div className="flex items-center justify-between"><a {...nav.linkProps('/projects/' + data.spaces.find((s: any) => s.domain === domain).projectId)}>打开原生私有项目</a>
        <button className={button} onClick={() => setShowSource(!showSource)}>新增知识</button></div>
      {showSource && <KnowledgeForm draftKey={prefix + 'source:' + domain} busy={busy} submit={async record => { await invoke('create-source', { domain, record: { ...record, domains: [domain] } }); setShowSource(false); }} />}
      {data.sources.filter((s: any) => s.domain === domain).map((s: any) => <Details remember={prefix + 'source-open:' + s.id} key={s.id} className="rounded border border-border p-3">
        <summary>{s.title} · {s.restricted ? '需申请访问' : labels[s.knowledgeState] ?? '资料'}</summary>
        {s.record && <div className="grid gap-3 pt-3"><p>{s.record.value.appliesTo}</p>
          <dl>{Object.entries(s.record.value.facts).map(([k, v]) => <div key={k} className="grid grid-cols-2 gap-2"><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
          <MarkdownBlock content={s.record.value.body} /><div className="flex flex-wrap gap-2">
            <a {...nav.linkProps('/issues/' + s.id)}>编辑原生文档与版本</a>
            {s.knowledgeState !== 'confirmed' && <button className={button} disabled={busy} onClick={() => run('review-source', { id: s.id, revision: s.record.revision, state: 'confirmed' })}>确认当前版本</button>}
            {s.record.value.state === 'confirmed' && <button className={button} disabled={busy} onClick={() => run('review-source', { id: s.id, revision: s.record.revision, state: 'withdrawn' })}>撤回结论</button>}
          </div><ul>{s.record.value.sources.map((url: string) => <li key={url}><a href={url}>{url}</a></li>)}</ul></div>}
      </Details>)}
      {!data.sources.some((s: any) => s.domain === domain) && <p>暂无知识</p>}
    </section>
    <Details remember={prefix + 'create-open'}><summary>新建跨岗位任务</summary><form className="grid gap-3 pt-3" onSubmit={e => { e.preventDefault(); void invoke('create-task',
      { title, goal, agent, sources, requestKey: crypto.randomUUID() }).then(t => { setSelectedTask(t.id); setTitle(''); setGoal(''); }).catch(() => {}); }}>
      <label>任务名称<input className={input} required value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>目标与验收条件<textarea className={input} required value={goal} onChange={e => setGoal(e.target.value)} /></label>
      <label>执行岗位<select className={input} value={agent} onChange={e => setAgent(e.target.value)}>{data.actors.map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
      <fieldset><legend>所需资料</legend>{data.sources.map((s: any) => <label key={s.id} className="flex gap-2">
        <input type="checkbox" checked={sources.includes(s.id)} onChange={e => setSources(e.target.checked ? [...sources, s.id] : sources.filter(id => id !== s.id))} />{s.title}</label>)}</fieldset>
      <button className={button} disabled={busy}>创建任务</button></form></Details>
    <section className="grid gap-4" aria-label="跨岗位协作">
      <h2 className="text-lg font-semibold">跨岗位任务</h2>
      <select className={input} aria-label="选择协作任务" value={task?.id ?? ''} onChange={e => setSelectedTask(e.target.value)}>
        {data.tasks.map((t: any) => <option key={t.id} value={t.id}>{t.identifier} · {t.title}</option>)}</select>
      {task && <>
        {task.error && <p role="alert">{task.error}</p>}
        <div className="flex flex-wrap gap-3"><a {...nav.linkProps('/issues/' + task.id)}>{task.identifier}</a><span>{actorName(task.agent)}</span><span>{labels[task.phase] ?? task.phase}</span></div>
        {task.phase === 'unknown' && <section className="grid gap-2 rounded border border-border p-3"><p>原执行尚未核对，交接与重新执行已停止。</p>
          <label><input type="checkbox" checked={stopped} onChange={e => setStopped(e.target.checked)} />已在原执行端确认停止写入</label>
          <label>核对依据<input className={input} value={stopNote} onChange={e => setStopNote(e.target.value)} /></label>
          <button className={button} disabled={busy || !stopped || !stopNote.trim()} onClick={() => run('stopped', { taskId: task.id, confirmed: stopped, note: stopNote })}>记录停止确认</button></section>}
        <form className="grid gap-3 rounded border border-border p-3" onSubmit={e => { e.preventDefault(); void invoke('request',
          { taskId: task.id, sourceId: sourceId || task.state.sources[0], agent: requestAgent || task.agent, purpose, hours, requestKey: crypto.randomUUID() }).then(() => setPurpose('')).catch(() => {}); }}>
          <h3>申请资料访问</h3>
          <label>资料<select className={input} value={sourceId || task.state.sources[0]} onChange={e => setSourceId(e.target.value)}>
            {task.state.sources.map((id: string) => <option key={id} value={id}>{sourceName(id)}</option>)}</select></label>
          <label>申请岗位<select className={input} value={requestAgent || task.agent} onChange={e => setRequestAgent(e.target.value)}>{data.actors.map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
          <label>用途<input className={input} required value={purpose} onChange={e => setPurpose(e.target.value)} /></label>
          <label>有效时长（小时）<input className={input} type="number" min={1 / 60} max={168} step="any" value={hours} onChange={e => setHours(Number(e.target.value))} /></label>
          <button className={button} disabled={busy || !task.state.sources.length || task.phase === 'accepted'}>提交申请</button>
        </form>
        <div className="grid gap-3">{task.requests.map((r: any) => <article key={r.id} className="grid gap-2 rounded border border-border p-3">
          <div>{sourceName(r.sourceId)} · {actorName(r.agent)} · {labels[r.state]}</div><p>{r.purpose}</p><p>截止 {new Date(r.expiresAt).toLocaleString()}</p>
          {r.remainingNativeAccess === true && ['revoked', 'expired'].includes(r.state) && <p>本次临时授权已结束；该岗位仍有其他资料访问权限。</p>}
          {r.approvalId && <a {...nav.linkProps('/approvals/' + r.approvalId)}>原生审批记录</a>}
          {['pending', 'approved', 'revoking'].includes(r.state) && <><label>处理依据<input className={input} value={reasons[r.id] ?? ''} onChange={e => setReasons({ ...reasons, [r.id]: e.target.value })} /></label>
            <div className="flex gap-2">{r.state === 'pending' ? <>
              <button className={button} disabled={busy || !reasons[r.id]?.trim()} onClick={() => run('decide', { id: r.id, decision: 'approved', reason: reasons[r.id] })}>授权</button>
              <button className={button} disabled={busy || !reasons[r.id]?.trim()} onClick={() => run('decide', { id: r.id, decision: 'denied', reason: reasons[r.id] })}>拒绝</button></> :
              <button className={button} disabled={busy || !reasons[r.id]?.trim()} onClick={() => run('revoke', { id: r.id, reason: reasons[r.id] })}>撤销授权</button>}</div></>}
        </article>)}</div>
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void invoke('checkpoint', { taskId: task.id, text: checkpoint }).then(() => setCheckpoint('')).catch(() => {}); }}>
          <label>检查点<MarkdownEditor value={checkpoint} onChange={setCheckpoint} bordered /></label><button className={button} disabled={busy || !checkpoint.trim() || task.phase === 'accepted'}>保存检查点</button></form>
        <div className="flex flex-wrap gap-3"><label>交接给<select className={input} value={next} onChange={e => setNext(e.target.value)}>{data.actors.map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
          <button className={button} disabled={busy || next === task.agent || task.phase === 'accepted'} onClick={() => run('handoff', { taskId: task.id, agent: next })}>交接任务</button></div>
        <Details remember={prefix + 'propose-open:' + task.id}><summary>沉淀知识</summary><KnowledgeForm draftKey={prefix + 'propose:' + task.id} compact busy={busy} submit={async record => { await invoke('propose', { taskId: task.id, record: { ...record, domains: [data.spaces.find((s: any) => s.agent === task.agent).domain] } }); }} /></Details>
        {task.snapshots.map((s: any) => <Details remember={prefix + 'snapshot-open:' + s.id} key={s.id} className="rounded border border-border p-3"><summary>{s.title}{s.knowledgeState ? ' · ' + labels[s.knowledgeState] : ''}</summary>
          {s.restricted ? <p>当前身份没有源资料权限</p> : <><MarkdownBlock content={s.body} /><a {...nav.linkProps('/issues/' + s.id)}>原生文档与修订</a>
            {s.key !== 'checkpoint' && <div className="grid gap-2 pt-3">
              <label>采用与共享依据<input className={input} value={reasons[s.id] ?? ''} onChange={e => setReasons({ ...reasons, [s.id]: e.target.value })} /></label>
              <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => run('review', { taskId: task.id, outcomeId: s.id, state: 'confirmed', revision: s.revision })}>确认结论</button>
                <button className={button} disabled={busy} onClick={() => run('review', { taskId: task.id, outcomeId: s.id, state: 'withdrawn', revision: s.revision })}>撤回结论</button>
                <button className={button} disabled={busy || !reasons[s.id]?.trim()} onClick={() => run('publish', { taskId: task.id, outcomeId: s.id, revision: s.revision, reason: reasons[s.id] })}>采用到专业空间</button></div>
              {s.publicationId && <a {...nav.linkProps('/issues/' + s.publicationId)}>查看已采用知识</a>}
            </div>}</>}
        </Details>)}
        {task.phase !== 'accepted' && <button className={button} disabled={busy} onClick={() => run('complete', { taskId: task.id })}>完成任务并结束临时授权</button>}
        <Details remember={prefix + 'history-open:' + task.id}><summary>协作记录</summary><ol className="grid gap-2 pt-3">{task.state.history.map((h: any, i: number) => <li key={i}>{new Date(h.at).toLocaleString()} · {events[h.event] ?? h.event}</li>)}</ol></Details>
      </>}
    </section>
  </main>;
}
