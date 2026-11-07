// 协作任务详情：进展、上下文、交接、知识沉淀、验收，以及任务上下文只读投影。
import { useEffect, useState } from 'react';
import { MarkdownBlock, MarkdownEditor } from '@paperclipai/plugin-sdk/ui';
import { Badge, Button, Details, Icon, RecordBody, actor, date, events, isLive,
  labels, safeHttpUrl, source, sourceName, useDraft, type UI } from './foundation.js';
import { KnowledgeForm } from './forms.js';
import { ServiceNetworkPanel, TaskMemoryReview } from './collaboration-network.js';
import { DevelopmentPanel } from './development.js';
import { GovernancePanel } from './v06-panels.js';

export function RequestItem({ ui, task, request: r, compact = false }: { ui: UI; task: any; request: any; compact?: boolean }) {
  const [reason, setReason] = useDraft(ui.prefix + 'reason:' + r.id, '');
  const effectiveState = ['pending', 'approved'].includes(r.state) && Date.parse(r.expiresAt) <= Date.now() ? 'expired' : r.state;
  return <article className="sm-access-item"><div className="sm-row sm-spread sm-wrap"><h3>{sourceName(ui, r.sourceId)}</h3><Badge state={effectiveState} /></div>
    <div className="sm-inline-meta">{ui.data.tasks.some((t:any)=>t.id===task.id)?<button className="sm-link-button" onClick={() => ui.openTask(task.id, 'access')}>{task.identifier}</button>:<span>{task.identifier}</span>}<span>{actor(ui, r.agent)}使用</span><span>至 {date(r.expiresAt)}</span></div>
    <p className="sm-small">{r.purpose}</p>
    {effectiveState === 'pending'&&r.canReview===false&&<p className="sm-small sm-muted">等待资料负责人处理。</p>}{effectiveState === 'pending' && r.canReview!==false && <><label className="sm-field">处理依据<input className="sm-input" placeholder="可补充依据；授权时记录本任务的用途、范围和期限" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="sm-actions"><Button variant="primary" disabled={ui.busy} onClick={() => ui.run('decide', { id: r.id, decision: 'approved', reason: reason.trim() || '按当前申请用途，仅授予此资料、本任务和指定执行身份的限时访问' })}>授权</Button>
        <Button disabled={ui.busy || !reason.trim()} onClick={() => ui.run('decide', { id: r.id, decision: 'denied', reason })}>拒绝</Button><a className="sm-button" {...ui.nav.linkProps('/approvals/' + r.approvalId)}>原生审批</a></div></>}
    {['approved', 'revoking'].includes(effectiveState) && r.canReview!==false && !compact && <Details remember={ui.prefix + 'revoke:' + r.id}><summary>管理临时授权</summary><div className="sm-tight"><label className="sm-field">撤权依据<input className="sm-input" value={reason} placeholder="说明为何结束这次访问" onChange={e => setReason(e.target.value)} /></label>
      <div><Button disabled={ui.busy || !reason.trim()} onClick={() => ui.run('revoke', { id: r.id, reason })}>撤销授权</Button></div></div></Details>}
    {r.remainingNativeAccess === true && ['revoked', 'expired'].includes(effectiveState) && <p className="sm-muted sm-small">本任务临时授权已结束；该岗位仍有其他合法资料权限。</p>}
  </article>;
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
    {a.enabled && a.attention?.length > 0 && task.phase !== 'accepted' && <form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('context-note', { taskId: task.id, text: answer }).then(() => setAnswer('')).catch((e: any) => ui.report(String(e?.message ?? e))); }}><p>{a.attention[0].text}</p><label className="sm-field">补充说明<textarea className="sm-input" value={answer} onChange={e => setAnswer(e.target.value)} required /></label><div><Button disabled={ui.busy || !answer.trim()}>补充并继续</Button></div></form>}
    {a.output ? <>{a.output.summary.length>500?<Details remember={k+':full-summary'}><summary>整理说明</summary><p className="sm-agent-copy">{a.output.summary}</p></Details>:<p className="sm-agent-copy">{a.output.summary}</p>}{!a.attention?.length && a.output.contextGaps?.length > 0 && <div className="sm-notice"><h3>还缺少的上下文</h3><ul>{a.output.contextGaps.map((g: any, i: number) => <li key={i}>{g.question}</li>)}</ul><Button onClick={() => setPanel('access')}>补充或获取上下文</Button></div>}<div>{a.output.nextSteps.filter((s: any) => !(a.attention?.length && s.owner === 'human' && s.kind === 'clarify')).map((s: any, i: number) => <div className="sm-agent-work" key={i}>
      <span className="sm-owner">{s.owner === 'human' ? '你决定' : 'Agent'}</span><div>{s.text}{s.owner === 'human' && ['authorize', 'handoff', 'adopt', 'accept'].includes(s.kind) &&
        <button className="sm-link-button sm-small" style={{ marginLeft: 8 }} onClick={() => setPanel(s.kind === 'authorize' ? 'access' : s.kind === 'handoff' ? 'handoff' : 'knowledge')}>前往处理</button>}</div></div>)}</div>
      {a.output.evidenceQuotes?.length > 0 && <Details remember={k + ':evidence'}><summary>查看依据 · {a.output.evidenceQuotes.length} 处原文</summary><div className="sm-tight">{a.output.evidenceQuotes.map((q: any, i: number) => <div key={i}><span className="sm-muted sm-small">{source(ui, q.sourceId)?.title ?? a.evidenceSources?.find((s: any) => s.id === q.sourceId)?.title ?? '任务上下文'}</span><blockquote style={{ margin: '4px 0 12px', fontSize: 13 }}>{q.quote}</blockquote></div>)}</div></Details>}
      {a.output.workProducts?.length > 0 && <section className="sm-section" aria-label="Agent 已准备的工作稿"><h3>已准备的工作稿</h3>{a.output.workProducts.map((p: any, i: number) => <Details remember={k + ':product:' + a.jobId + ':' + i} key={i}><summary>{p.title} · 待审阅</summary><RecordBody body={p.body} /></Details>)}</section>}
      {a.applied?.checkpoint && <p className="sm-small sm-muted" style={{ marginTop: 12 }}>已保存检查点{a.applied.knowledge ? '，并准备了待审阅的知识候选' : ''}。</p>}
      {a.mode === 'prepare' && a.output.checkpoint && <Button variant="quiet" onClick={() => { editCheckpoint(a.output.checkpoint); setPanel('progress'); }}>将草稿放入检查点编辑</Button>}
    </> : !running && !a.error && a.status !== 'stale' && <p className="sm-small sm-muted">{task.phase === 'accepted' ? '任务已验收，临时上下文已结束。' : '交给 Agent 整理目标、已有材料和下一步，需要你决定时会集中提醒。'}</p>}
    {running && <p className="sm-small sm-muted">{a.status === 'cancelling' ? '正在停止原运行；结束前不会派发替代任务。' : '正在按当前执行身份权限整理资料。你可以继续浏览其他任务。'}</p>}
    {task.phase !== 'accepted' && <Details remember={k+':adjust-delegation'}><summary>{a.enabled?'调整委托':'委托 Agent'}</summary><div className="sm-agent-edit"><label className="sm-field">补充要求<textarea className="sm-input" rows={2} placeholder="补充目标、约束或需要澄清的地方" value={instruction} onChange={e => setInstruction(e.target.value)} /></label>
      <div className="sm-row sm-spread sm-wrap" style={{ marginTop: 10 }}><label className="sm-field"><span className="sm-small">处理范围</span><select className="sm-input" value={mode} onChange={e => setMode(e.target.value)}><option value="advance">自动整理并推进准备工作</option><option value="prepare">仅给建议和草稿</option></select></label>
        <div className="sm-actions">{a.enabled && <Button disabled={ui.busy || a.status === 'cancelling'} onClick={() => ui.run('assistant-delegate', { taskId: task.id, enabled: false, mode, instruction })}>暂停</Button>}
          <Button variant="primary" disabled={ui.busy || running || !ui.data.assistantAvailable || task.phase === 'unknown'} onClick={() => { void ui.invoke('assistant-delegate', { taskId: task.id, enabled: true, mode, instruction, nonce: crypto.randomUUID() }).then(() => setInstruction('')).catch((e: any) => ui.report(String(e?.message ?? e))); }}>{a.output || a.error || a.status === 'stale' ? '重新整理' : '交给 Agent'}</Button></div></div></div></Details>}
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

export function TaskDetail({ ui, task, panel, setPanel }: { ui: UI; task: any; panel: string; setPanel: (s: string) => void }) {
  const k = ui.prefix + 'task:' + task.id;
  const [checkpoint, setCheckpoint] = useDraft(k + ':checkpoint', ''), [next, setNext] = useDraft(k + ':next', ui.data.actors.find((a: any) => a.key !== task.agent)?.key ?? '');
  const [sourceId, setSourceId] = useDraft(k + ':source', task.state.sources[0] ?? ''), [purpose, setPurpose] = useDraft(k + ':purpose', ''), [hours, setHours] = useDraft(k + ':hours', 8);
  const [requestAgent, setRequestAgent] = useDraft(k + ':request-agent', task.agent), [acceptanceNote, setAcceptanceNote] = useDraft(k + ':acceptance', ''), [skipKnowledge, setSkipKnowledge] = useDraft(k + ':no-knowledge', false), [stopped, setStopped] = useState(false), [stopNote, setStopNote] = useDraft(k + ':stop-note', '');
  useEffect(() => { if (next === task.agent) setNext(ui.data.actors.find((a: any) => a.key !== task.agent)?.key ?? ''); }, [task.agent, next]);
  const canAccept=(task.state.context?.requesterUserId??'local-board')===ui.data.currentUserId;
  const closed = task.phase === 'accepted', snapshots = task.snapshots.filter((s: any) => s.key === 'checkpoint'), candidates = task.snapshots.filter((s: any) => s.key?.startsWith('knowledge-'));
  const acceptance = task.state.history.findLast((h: any) => h.event === 'completed')?.detail?.review;
  const acceptedDraft = snapshots.find((s: any) => s.id === acceptance?.checkpoint?.id && s.revision === acceptance.checkpoint.revision && !s.restricted);
  const nextReady = task.state.sources.every((id: string) => (!source(ui, id)?.external && ui.data.spaces.find((d: any) => d.domain === source(ui, id)?.domain)?.members?.includes(next)) || task.requests.some((r: any) => r.sourceId === id && r.agent === next && isLive(r)));
  return <article className="sm-task-detail"><div className="sm-row sm-spread sm-wrap"><div className="sm-inline-meta"><a {...ui.nav.linkProps('/issues/' + task.id)}>{task.identifier}</a><span>{task.state.context?.service?.name ?? actor(ui, task.agent)}负责</span></div><Badge state={task.phase} /></div>
    <h2 className="sm-task-heading">{task.title}</h2>{task.goal.length>180?<Details remember={k+':goal'}><summary>目标与约束</summary><p className="sm-goal">{task.goal}</p></Details>:<p className="sm-goal">{task.goal}</p>}
    {task.error && <p className="sm-error" role="alert">{task.error}</p>}
    <nav className="sm-task-stage" aria-label="任务工作区">{[['progress', '进展'], ['access', '上下文'], ['handoff', '协作与交接'], ['knowledge', '知识沉淀'], ['governance', '验收与责任']].map(([id, name]) => <button key={id} aria-pressed={panel === id} onClick={() => setPanel(id!)}>{name}{id === 'access' && task.requests.some((r: any) => r.state === 'pending') ? ' · 待授权' : ''}</button>)}</nav>
    {panel === 'progress' && <div className="sm-stack"><AgentPanel ui={ui} task={task} setPanel={setPanel} editCheckpoint={setCheckpoint} />
      {task.phase === 'unknown' && <section className="sm-notice sm-stack"><h3>先核对原执行已停止</h3><p>当前执行状态不明，交接与重新执行已暂停。</p><label className="sm-check"><input type="checkbox" checked={stopped} onChange={e => setStopped(e.target.checked)} />已在原执行端确认停止写入</label>
        <label className="sm-field">核对依据<input className="sm-input" value={stopNote} onChange={e => setStopNote(e.target.value)} /></label><div><Button disabled={ui.busy || !stopped || !stopNote.trim()} onClick={() => ui.run('stopped', { taskId: task.id, confirmed: stopped, note: stopNote })}>记录停止确认</Button></div></section>}
      {snapshots.length > 0 && <section><h3>工作检查点</h3>{snapshots.slice().reverse().map((s: any, i: number) => <Details remember={k + ':snapshot:' + s.id} key={s.id}><summary>{i === 0 ? '最近一次检查点' : '较早检查点'}{s.restricted ? ' · 访问已受限' : ''}</summary>
        {s.restricted ? <p className="sm-small sm-muted">来源权限已变化，内容已隐藏。</p> : <><RecordBody body={s.body} /><a className="sm-small" {...ui.nav.linkProps('/issues/' + s.id)}>原生文档与修订</a></>}</Details>)}</section>}
      {!closed && <Details remember={k + ':manual-checkpoint'}><summary>手动补充检查点</summary><form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('checkpoint', { taskId: task.id, text: checkpoint }).then(() => setCheckpoint('')).catch((e: any) => ui.report(String(e?.message ?? e))); }}>
        <label className="sm-field">工作进展与后续事项<MarkdownEditor value={checkpoint} onChange={setCheckpoint} bordered /></label><div><Button disabled={ui.busy || !checkpoint.trim()}>保存检查点</Button></div></form></Details>}
      <Details remember={k + ':history'}><summary>协作记录</summary><ol className="sm-timeline">{task.state.history.slice().reverse().map((h: any, i: number) => <li key={i}><time>{date(h.at)}</time><span>{events[h.event] ?? h.event}{h.detail?.authoredBy?.startsWith('workspace-assistant:') ? ' · Agent' : ''}</span></li>)}</ol></Details>
    </div>}
    {panel === 'access' && <section><ContextPanel ui={ui} task={task} /><div className="sm-section-head sm-section"><h3>访问与授权</h3><span className="sm-muted sm-small">限本任务和指定执行身份</span></div>
      {task.state.sources.map((id: string) => { const access = task.sourceAccess?.find((s: any) => s.sourceId === id), readable = access?.allowed; return <div className="sm-source-row" key={id}><div><h3>{sourceName(ui, id)}</h3><span className="sm-muted sm-small">{actor(ui, task.agent)} · {readable ? '当前可读取' : access?.reason === 'version' ? '资料当前版本待确认' : '当前未获准读取'}</span></div>
        {access?.reason === 'version' ? <Button onClick={() => ui.useSource(id)}>核对知识版本</Button> : !readable && !closed && !task.requests.some((r: any) => r.sourceId === id && r.agent === task.agent && r.state === 'pending') && <Button disabled={ui.busy} onClick={() => ui.run('request', { taskId: task.id, sourceId: id, purpose: '完成 ' + task.identifier + ' 的当前任务与交接准备', hours: 8, requestKey: crypto.randomUUID() })}>申请访问</Button>}</div>; })}
      {!task.state.sources.length && <p className="sm-muted sm-small">本任务未关联专业资料。</p>}
      <div className="sm-section"><h3 style={{ marginBottom: 16 }}>授权记录</h3>{task.requests.map((r: any) => <RequestItem ui={ui} task={task} request={r} key={r.id} />)}{!task.requests.length && <p className="sm-muted sm-small">Agent 会为缺少的资料准备申请；授权仍由你决定。</p>}</div>
      {!closed && task.state.sources.length > 0 && <Details remember={k + ':manual-request'}><summary>自定义访问申请</summary><form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('request', { taskId: task.id, sourceId, agent: requestAgent, purpose, hours, requestKey: crypto.randomUUID() }).then(() => setPurpose('')).catch((e: any) => ui.report(String(e?.message ?? e))); }}>
        <div className="sm-form-grid"><label className="sm-field">资料<select className="sm-input" value={sourceId} onChange={e => setSourceId(e.target.value)}>{task.state.sources.map((id: string) => <option key={id} value={id}>{sourceName(ui, id)}</option>)}</select></label>
          <label className="sm-field">申请身份<select className="sm-input" value={requestAgent} onChange={e => setRequestAgent(e.target.value)}>{ui.data.actors.map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label></div>
        <label className="sm-field">用途<input className="sm-input" required value={purpose} onChange={e => setPurpose(e.target.value)} /></label><label className="sm-field">有效时长（小时）<input className="sm-input" type="number" min={1 / 60} max={168} step="any" value={hours} onChange={e => setHours(Number(e.target.value))} /></label><div><Button disabled={ui.busy}>提交申请</Button></div></form></Details>}
    </section>}
    {panel === 'handoff' && <section className="sm-stack"><ServiceNetworkPanel ui={ui} task={task}/>{canAccept&&<DevelopmentPanel ui={ui} task={task}/>} {ui.data.canManageWorkspace&&<Details remember={k+':transfer-owner'}><summary>移交当前任务负责人</summary><div><h3>交接给下一参与者</h3><p className="sm-muted sm-small" style={{ marginTop: 6 }}>新岗位先取得所需访问权限。交接后，原执行者的本任务临时权限结束。</p></div>
      {task.assistant?.output?.handoff && <div className="sm-notice"><MarkdownBlock content={task.assistant.output.handoff} /></div>}
      {snapshots.length > 0 && <p className="sm-small">接续任务会保留 {snapshots.length} 份检查点与任务来源。</p>}
      <label className="sm-field">下一执行身份<select className="sm-input" value={next} onChange={e => setNext(e.target.value)}>{ui.data.actors.filter((a: any) => a.key !== task.agent).map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
      <div className="sm-actions"><Button disabled={ui.busy || closed || ['unknown', 'running'].includes(task.phase)} onClick={() => ui.run('prepare-handoff', { taskId: task.id, agent: next })}>准备交接与访问申请</Button>
        <Button variant="primary" disabled={ui.busy || closed || !nextReady || ['unknown', 'running'].includes(task.phase)} onClick={() => ui.run('handoff', { taskId: task.id, agent: next })}>确认交接给{actor(ui, next)}</Button></div>
      {!nextReady && <p className="sm-small sm-muted">下一参与者尚未获准全部资料，先处理下面的访问申请。</p>}
      {task.requests.filter((r: any) => r.agent === next).map((r: any) => <RequestItem key={r.id} ui={ui} task={task} request={r} />)}
    </Details>}</section>}
    {panel === 'knowledge' && <section><div className="sm-section-head"><h3>{closed ? '交付与验收记录' : '从本次工作留下可复用知识'}</h3></div>
      {(task.state.context?.developmentTasks?.length??0)>0&&<DevelopmentPanel ui={ui} task={task} review/>}
      {!closed&&<TaskMemoryReview ui={ui} task={task}/>}
      {!closed && !candidates.length && <div className="sm-empty"><strong>本次尚未新增知识条目</strong>已有知识的概念关系可在此审阅；新的结论先保存为候选。</div>}
      {candidates.map((s: any) => <Candidate key={s.id} ui={ui} task={task} item={s} />)}
      {!closed && <><Details remember={k + ':manual-knowledge'}><summary>手动补充知识候选</summary><KnowledgeForm ui={ui} draftKey={k + ':knowledge'} compact submit={async record => { await ui.invoke('propose', { taskId: task.id, record: { ...record, domains: [task.state.context?.knowledgeSpace ?? ui.data.spaces[0]?.domain] } }); }} /></Details>
        {canAccept?<div className="sm-section sm-stack"><h3>最终验收</h3>{snapshots.at(-1) && <Details remember={k + ':review-draft:' + snapshots.at(-1).revision}><summary>本次工作稿 · {snapshots.at(-1).revision?.slice(0, 8)}</summary><RecordBody body={snapshots.at(-1).body} /><a className="sm-button" {...ui.nav.linkProps('/issues/' + snapshots.at(-1).id)}>原生文档与修订</a></Details>}<p className="sm-muted sm-small">按本次实际交付范围验收，并结束临时访问。工作稿交付与业务功能已实现分别记录。</p>{!candidates.some((s: any) => s.publicationId) && <label className="sm-check"><input type="checkbox" checked={skipKnowledge} onChange={e => setSkipKnowledge(e.target.checked)} />本次只验收工作稿，暂不采用为可复用知识</label>}<label className="sm-field">验收范围与依据<input className="sm-input" value={acceptanceNote} onChange={e => setAcceptanceNote(e.target.value)} placeholder="说明已审阅的交付、未覆盖范围和结论" /></label><div><Button variant="primary" disabled={ui.busy || !acceptanceNote.trim() || (!candidates.some((s: any) => s.publicationId) && (!skipKnowledge || !snapshots.at(-1)?.revision)) || ['unknown', 'running'].includes(task.phase)} onClick={() => ui.run('complete', { taskId: task.id, reason: acceptanceNote, noKnowledge: skipKnowledge, checkpoint: snapshots.at(-1)?.revision ? { id: snapshots.at(-1).id, revision: snapshots.at(-1).revision } : undefined })}>验收完成并结束临时授权</Button></div></div>:<p className="sm-small sm-muted">最终验收由需求发起人处理。</p>}</>}
      {closed && <div className="sm-stack"><div className="sm-notice"><Icon name="check" /> {acceptance?.noKnowledge ? '工作稿交付已验收，暂不采用为可复用知识。临时授权已结束。' : '已验收，临时授权已结束。'}</div>
        {acceptance?.reason && <p>{acceptance.reason}</p>}
        {acceptance?.checkpoint && <Details remember={k + ':accepted-draft:' + acceptance.checkpoint.revision}><summary>已验收工作稿 · {acceptance.checkpoint.revision.slice(0, 8)}</summary>
          {acceptedDraft ? <RecordBody body={acceptedDraft.body} /> : <p className="sm-muted sm-small">已验收版本保存在原生修订记录中，内容仍按当前访问权限显示。</p>}
          <a className="sm-button" {...ui.nav.linkProps('/issues/' + acceptance.checkpoint.id)}>原生文档与修订</a></Details>}</div>}
    </section>}
    {panel === 'governance' && <GovernancePanel ui={ui} task={task} />}
  </article>;
}

export function TaskWorkspace({ ui, selected, setSelected, panel, setPanel }: { ui: UI; selected: string; setSelected: (id: string) => void; panel: string; setPanel: (s: string) => void }) {
  const [query, setQuery] = useDraft(ui.prefix + 'task-search', ''), [all, setAll] = useDraft(ui.prefix + 'task-all', false);
  const filtered = ui.data.tasks.filter((t: any) => (all || t.phase !== 'accepted') && (!t.state.context?.networkParent||!ui.data.tasks.some((p:any)=>p.id===t.state.context.networkParent)) && (t.title + t.identifier).toLowerCase().includes(query.toLowerCase()));
  const task = ui.data.tasks.find((t: any) => t.id === selected) ?? filtered[0] ?? ui.data.tasks[ui.data.tasks.length - 1];
  return <div className="sm-workspace-grid"><aside className="sm-task-list" aria-label="协作任务列表"><header><input className="sm-input" type="search" aria-label="搜索协作任务" placeholder="搜索任务" value={query} onChange={e => setQuery(e.target.value)} />
    <label className="sm-check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />包括已完成</label></header>
    {filtered.map((t: any) => <button className="sm-task-item" key={t.id} aria-current={t.id === task?.id} onClick={() => setSelected(t.id)}><span className="sm-row sm-spread"><span className="sm-muted sm-small">{t.identifier}</span><Badge state={t.phase} /></span><strong>{t.title}</strong><span className="sm-muted sm-small">{t.state.context?.service?.name ?? actor(ui, t.agent)} · {t.networkPending?'等待协作回传':t.assistant?.attention?.length?'需要补充':labels[t.assistant?.status]??'团队协作'}</span></button>)}
    {!filtered.length && <p className="sm-muted sm-small">没有匹配任务。</p>}</aside>
    <div className="sm-mobile-select"><label className="sm-field">协作任务<select className="sm-input" value={task?.id ?? ''} onChange={e => setSelected(e.target.value)}>{filtered.map((t: any) => <option key={t.id} value={t.id}>{t.identifier} · {t.title}</option>)}</select></label></div>
    {task ? <TaskDetail key={task.id} ui={ui} task={task} panel={panel} setPanel={setPanel} /> : <div className="sm-empty"><strong>还没有协作任务</strong>点击“发起协作”，写下要完成的目标。</div>}
  </div>;
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
          {s.external && <p className="sm-small">{safeHttpUrl(s.external.url) ? <a href={safeHttpUrl(s.external.url)!} target="_blank" rel="noreferrer">飞书原始来源</a> : <span className="sm-muted">飞书原始来源（链接不可用）</span>} · {s.external.kind === 'messages' ? '历史讨论证据' : '原文当前版本'}，每轮重新核对可读状态</p>}{s.kind === 'delivery' && s.delivery ? <div className="sm-document"><dl><div><dt>需求来源</dt><dd>{s.origin === 'feishu' ? '飞书发起' : '后台发起'}</dd></div><div><dt>代码交付（本机 Git）</dt><dd>{safeHttpUrl(s.delivery.url) ? <a href={safeHttpUrl(s.delivery.url)!} target="_blank" rel="noreferrer">交付 #{s.delivery.pr}</a> : <span>交付 #{s.delivery.pr}（链接不可用）</span>}</dd></div><div><dt>本机代码检查</dt><dd>{s.delivery.ci === 'passed' ? '已通过' : s.delivery.ci === 'failed' ? '未通过' : '待完成'}</dd></div><div><dt>交付版本</dt><dd>{s.delivery.headSha?.slice(0, 12)}</dd></div><div><dt>预览版本</dt><dd>{s.delivery.deployedSha?.slice(0, 12) ?? '未部署预览'}</dd></div><div><dt>验收</dt><dd>{s.taskStatus === 'accepted' ? '已按指定版本验收' : '尚未验收'}</dd></div></dl></div> : <RecordBody body={s.body} />}
          {s.truncatedMessages && <p className="sm-muted sm-small">本轮载入最近 {s.includedMessages} / {s.totalMessages} 条可见讨论，较早内容未载入。</p>}
          <div className="sm-actions"><a className="sm-button" {...ui.nav.linkProps('/issues/' + (s.nativeIssueId ?? s.id))}>来源与版本</a>{(s.truncated || s.truncatedMessages) && ['knowledge', 'note', 'conversation'].includes(s.kind) && <Button disabled={ui.busy || closed || pack.fullSources.includes(s.id)} onClick={() => ui.run('context-expand', { taskId: task.id, sourceId: s.id })}>扩展读取范围</Button>}
            {s.kind === 'knowledge' && !closed && <Button variant="quiet" disabled={ui.busy} aria-label={'将' + s.title + '移出任务并结束临时授权'} onClick={() => ui.run('context-exclude', { taskId: task.id, sourceId: s.id })}>移出并结束临时授权</Button>}</div>
          <p className="sm-muted sm-small">{s.selectionReason}</p></div>
      </Details>)}</div>
      {pack.layers.checkpoints.length > 0 && <Details remember={k + ':records'}><summary>已纳入的工作记录</summary><div className="sm-tight">{pack.layers.checkpoints.map((c: any) => <div key={c.id} className="sm-row sm-spread sm-wrap"><a {...ui.nav.linkProps('/issues/' + c.id)}>{c.title}</a><span className="sm-muted sm-small">版本 {c.revision.slice(0, 8)}{c.truncated ? ' · 使用片段' : ''}</span></div>)}</div></Details>}
      {pack.matches.some((m: any) => !m.selected) && <div className="sm-notice sm-stack"><h3>可用知识中还有相关内容</h3>{pack.matches.filter((m: any) => !m.selected).map((m: any) => <div key={m.id}><strong>{m.title}</strong><p className="sm-small">{m.reason}</p></div>)}<div><Button disabled={ui.busy || closed} onClick={() => ui.run('context-discover', { taskId: task.id })}>引用相关知识</Button></div></div>}
      {pack.availableDeliveries.length > 0 && <Details remember={k + ':delivery'}><summary>关联已有研发交付</summary><div className="sm-form"><label className="sm-field">已有任务<select className="sm-input" value={linked} onChange={e => setLinked(e.target.value)}><option value="">选择研发任务</option>{pack.availableDeliveries.map((t: any) => <option key={t.id} value={t.id} disabled={t.linked}>{t.identifier} · {t.title}{t.linked ? '（已关联）' : ''}</option>)}</select></label><div><Button disabled={ui.busy || closed || !linked} onClick={() => { void ui.invoke('context-link', { taskId: task.id, linkedId: linked }).then(() => setLinked('')).catch((e: any) => ui.report(String(e?.message ?? e))); }}>关联需求、代码交付、本机 CI 与验收记录</Button></div></div></Details>}
      {!closed && <Details remember={k + ':include'}><summary>指定其他参考知识</summary><div className="sm-form"><label className="sm-field">知识条目<select className="sm-input" value={addSource} onChange={e => setAddSource(e.target.value)}><option value="">选择要引用的资料</option>{ui.data.sources.filter((s: any) => !task.state.sources.includes(s.id)).map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label><p className="sm-muted sm-small">引用不授予权限；其他岗位的资料仍需按用途申请。</p><div><Button disabled={ui.busy || !addSource} onClick={() => { void ui.invoke('context-include', { taskId: task.id, sourceId: addSource }).then(() => setAddSource('')).catch((e: any) => ui.report(String(e?.message ?? e))); }}>引用到本任务</Button></div></div></Details>}
    </>}
    {!closed && <form className="sm-form" onSubmit={e => { e.preventDefault(); void ui.invoke('context-note', { taskId: task.id, text: note }).then(() => setNote('')).catch((e: any) => ui.report(String(e?.message ?? e))); }}>
      <label className="sm-field">补充背景、约束或决定<textarea className="sm-input" placeholder="例如：业务目标、讨论结论、已有研究、不可改动的范围，以及还需要核实的事实。" value={note} onChange={e => setNote(e.target.value)} required /></label>
      <div className="sm-row sm-spread sm-wrap"><span className="sm-muted sm-small">仅用于本任务，可随任务交接接续；不会自动成为专业知识。</span><Button disabled={ui.busy || !note.trim()}>加入任务上下文</Button></div></form>}
  </div>;
}
