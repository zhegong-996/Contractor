// 可复用表单：知识候选 / 编辑、发起协作任务。
import { useEffect, useState } from 'react';
import { MarkdownEditor } from '@paperclipai/plugin-sdk/ui';
import { ActionError, Button, Details, contentKinds, useDraft, type UI } from './foundation.js';
import { useActionFeedback } from './async.js';

export function KnowledgeForm({ ui, draftKey, submit, compact = false, initial }: { ui: UI; draftKey: string; submit: (data: any) => Promise<void>; compact?: boolean; initial?: any }) {
  const [title, setTitle] = useDraft(draftKey + ':title', initial?.title ?? ''), [body, setBody] = useDraft(draftKey + ':body', initial?.body ?? ''), [scope, setScope] = useDraft(draftKey + ':scope', initial?.appliesTo ?? ''), [links, setLinks] = useDraft(draftKey + ':links', initial?.sources?.join('\n') ?? '');
  const [kind, setKind] = useDraft(draftKey + ':kind', initial?.kind ?? 'reference'), [expires, setExpires] = useDraft(draftKey + ':expires', initial?.expiresAt?.slice(0, 10) ?? ''), [formError, setFormError] = useState('');
  const [facts, setFacts] = useDraft<{ name: string; value: string; type: string }[]>(draftKey + ':facts', initial ? Object.entries(initial.facts).map(([name, value]) => ({ name, value: String(value), type: typeof value })) : [{ name: '', value: '', type: 'string' }]);
  const { error: submitError, busy: submitting, send } = useActionFeedback();
  return <form className="sm-form" onSubmit={e => { e.preventDefault(); setFormError(''); const values: Record<string, string | number | boolean> = {};
    for (const f of facts.filter(f => f.name.trim())) { const key = f.name.trim(); if (Object.hasOwn(values, key)) { setFormError('字段名不能重复'); return; }
      if (f.type === 'number' && (!f.value.trim() || !Number.isFinite(Number(f.value)))) { setFormError('数字字段需要填写有效数值'); return; }
      Object.defineProperty(values, key, { value: f.type === 'number' ? Number(f.value) : f.type === 'boolean' ? f.value === 'true' : f.value, enumerable: true }); }
    void send(() => submit({ key: initial?.key ?? 'knowledge-' + crypto.randomUUID().slice(0, 18), title, kind, appliesTo: scope, ...(initial?.domains ? { domains: initial.domains } : {}),
    body, sources: links.split(/\s+/).filter(Boolean), facts: values, ...(expires ? { expiresAt: new Date(expires + 'T23:59:59+08:00').toISOString() } : {}) }),
    () => { if (!initial) { setTitle(''); setBody(''); setScope(''); setLinks(''); setFacts([{ name: '', value: '', type: 'string' }]); } }); }}>
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
    <ActionError error={submitError} />
    <div><Button variant="primary" disabled={ui.busy || submitting || !body.trim()}>{initial ? '保存为待确认版本' : compact ? '提交知识候选' : '保存知识'}</Button></div>
  </form>;
}

export function Compose({ ui, close, initialSources }: { ui: UI; close: () => void; initialSources: string[] }) {
  const k = ui.prefix + 'compose:';
  const [goal, setGoal] = useDraft(k + 'goal', ''), [title, setTitle] = useDraft(k + 'title', ''), [agent, setAgent] = useDraft(k + 'agent', ui.data.currentAgent??ui.data.actors[0]?.key ?? '');
  const [selected, setSelected] = useDraft<string[]>(k + 'sources', initialSources), [mode, setMode] = useDraft(k + 'mode', 'advance'), [requestKey, setRequestKey] = useDraft(k + 'key', crypto.randomUUID()), [knowledgeSpace, setKnowledgeSpace] = useDraft(k + 'space', ui.data.spaces.find((s:any)=>s.members?.includes(ui.data.currentAgent))?.domain??ui.data.spaces[0]?.domain ?? ''), [autoDiscover, setAutoDiscover] = useDraft(k + 'auto-context', true);
  const { error: submitError, busy: submitting, send } = useActionFeedback();
  useEffect(() => { if (initialSources.length) setSelected(current => [...new Set([...current, ...initialSources])]); }, [initialSources.join(',')]);
  return <section className="sm-compose" aria-label="发起协作"><div className="sm-section-head"><h2>交给团队和 Agent 的事</h2><Button variant="quiet" type="button" onClick={close}>收起</Button></div>
    <form className="sm-form" onSubmit={e => { e.preventDefault(); void send(() => ui.invoke('start-collaboration', { task: { title: title.trim() || goal.trim().split('\n')[0]!.slice(0, 80), goal,
      agent, sources: selected, requestKey, autoDiscover, knowledgeSpace }, delegate: ui.data.assistantAvailable, mode }),
      t => { setGoal(''); setTitle(''); setSelected([]); setRequestKey(crypto.randomUUID()); close(); ui.openTask(t.id); }); }}>
      <label className="sm-field">要完成什么<textarea autoFocus className="sm-input" required placeholder="写清目标、已有背景和验收条件。Agent 会整理下一步，遇到关键决定再交给你。" value={goal} onChange={e => setGoal(e.target.value)} /></label>
      <div className="sm-form-grid"><label className="sm-field">先交给哪位参与者<select className="sm-input" value={agent} onChange={e => setAgent(e.target.value)}>{ui.data.actors.filter((a:any)=>ui.data.canManageWorkspace||a.key===ui.data.currentAgent).map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
        <label className="sm-field">Agent 处理范围<select className="sm-input" value={mode} onChange={e => setMode(e.target.value)}><option value="advance">自动整理并推进准备工作</option><option value="prepare">仅给建议和草稿</option></select></label></div>
      <label className="sm-field">知识沉淀空间<select className="sm-input" value={knowledgeSpace} onChange={e => setKnowledgeSpace(e.target.value)}>{ui.data.spaces.map((space: any) => <option key={space.domain} value={space.domain}>{space.name}</option>)}</select></label><label className="sm-check"><input type="checkbox" checked={autoDiscover} onChange={e => setAutoDiscover(e.target.checked)} />自动查找执行身份可用的相关知识</label>
      <Details remember={k + 'sources-open'}><summary>指定参考知识（可选）{selected.length ? ' · 已选 ' + selected.length : ''}</summary><fieldset className="sm-choices"><legend>需要参考的知识</legend>{ui.data.sources.map((s: any) => <label key={s.id} className="sm-check"><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} />
        <span>{s.title} <small>· {ui.data.spaces.find((d: any) => d.domain === s.domain)?.name}</small></span></label>)}</fieldset></Details>
      <Details remember={k + 'name-open'}><summary>自定义任务名称</summary><label className="sm-field">任务名称<input className="sm-input" value={title} onChange={e => setTitle(e.target.value)} /></label></Details>
      <ActionError error={submitError} />
      <div className="sm-row sm-spread sm-wrap"><span className="sm-muted sm-small">授权、知识采用和验收仍由你决定。</span><Button variant="primary" icon="arrow" disabled={ui.busy || submitting || !goal.trim()}>{ui.data.assistantAvailable ? '发起并交给 Agent' : '发起协作'}</Button></div>
    </form></section>;
}
