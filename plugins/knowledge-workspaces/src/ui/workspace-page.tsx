// 插件页面壳：宿主 action 通道、轮询、5 个主 tab 与视图路由。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePluginAction, useHostNavigation, type PluginPageProps } from '@paperclipai/plugin-sdk/ui';
import { styles } from './styles.js';
import { Badge, Button, Icon, actor, date, isLive, labels, retained, useDraft, type UI } from './foundation.js';
import { Compose } from './forms.js';
import { RequestItem, TaskWorkspace } from './task-detail.js';
import { Spaces } from './spaces.js';
import { Settings } from './settings.js';
import { AgentServicesPage } from './agent-services.js';
import { MemoryWorkspace, MemberBindings, focusMemorySource } from './collaboration-network.js';

function MyWork({ ui }: { ui: UI }) {
  const active = ui.data.tasks.filter((t: any) => t.phase !== 'accepted'&&(!t.state.context?.networkParent||!ui.data.tasks.some((p:any)=>p.id===t.state.context.networkParent)));
  const requests = active.flatMap((t: any) => t.requests.filter((r: any) => r.state === 'pending' && Date.parse(r.expiresAt) > Date.now()).map((r: any) => ({ task: t, request: r })));
  const decisions = active.flatMap((t: any) => [...(t.assistant?.attention?.length ? [{ type: 'clarify', title: t.assistant.attention[0].title, task: t }] : []), ...(t.assistant?.status === 'scope_changed' ? [{ type: 'scope', title: '核对 Agent 的新职责', task: t }] : []), ...(t.phase === 'unknown' ? [{ type: 'unknown', title: '核对原执行已经停止', task: t }] : []),
    ...t.snapshots.filter((s: any) => s.key?.startsWith('knowledge-') && !s.publicationId && !s.restricted && s.knowledgeState !== 'withdrawn').map((s: any) => ({ type: 'knowledge', title: '采用知识：' + s.title, task: t })),
    ...(t.networkAttention?[{type:'service',title:'协作服务需要处理',task:t}]:[]),
    ...((!t.networkAttention && !t.networkPending && !t.assistant?.attention?.length && t.assistant?.status !== 'scope_changed' && (t.snapshots.some((s: any) => s.publicationId) || t.snapshots.some((s: any) => s.key === 'checkpoint' && !s.restricted && s.contextState === 'current')) && !['queued', 'running', 'cancelling'].includes(t.assistant?.status)) ? [{ type: 'accept', title: '审阅工作稿并验收', task: t }] : [])]);
  for(const entry of ui.data.sourceRequests??[])if(entry.request.state==='pending'&&!requests.some((x:any)=>x.request.id===entry.request.id))requests.push(entry);
  const count = requests.length + decisions.length;
  return <><section><div className="sm-section-head"><h2>需要你决定 <span className="sm-muted sm-small">{count ? count + ' 项' : ''}</span></h2></div>
    {!count && <div className="sm-empty"><strong>当前没有待决事项</strong>发起协作后，Agent 会整理进展；需要授权或验收时再交给你。</div>}
    {requests.map(({ task, request }: any) => <RequestItem key={request.id} ui={ui} task={task} request={request} compact />)}
    <div className="sm-decisions">{decisions.map((d: any, i: number) => <article className="sm-decision" key={d.task.id + ':' + i}><Icon name={d.type === 'clarify' ? 'bot' : d.type === 'unknown' || d.type === 'scope' ? 'shield' : d.type === 'knowledge' ? 'book' : 'check'} />
      <div><h3>{d.type==='accept'?d.task.title:d.title}</h3><div className="sm-inline-meta"><span>{d.task.identifier}</span><span>{d.type==='accept'?'工作稿待你审阅':d.task.title}</span><span>{d.task.state.context?.service?.name??actor(ui,d.task.agent)}</span></div></div>
      <div className="sm-actions"><Button onClick={() => ui.openTask(d.task.id, d.type==='service'?'handoff':d.type === 'knowledge' || d.type === 'accept' ? 'knowledge' : 'progress')}>{d.type==='accept'?'审阅成果':'查看并决定'}</Button></div></article>)}</div>
  </section><div className="sm-work-grid sm-section"><section><div className="sm-section-head"><h2>Agent 与团队在推进</h2></div>
    {!active.length && <p className="sm-muted sm-small">暂无进行中的协作。</p>}
    {active.map((t: any) => <div className="sm-list-row" key={t.id}><Icon name={t.assistant?.enabled ? 'bot' : 'task'} /><div className="sm-grow"><button className="sm-link-button" onClick={() => ui.openTask(t.id)}>{t.title}</button>
      <div className="sm-inline-meta"><span>{t.identifier}</span><span>{t.state.context?.service?.name ?? actor(ui, t.agent)}</span><span>{t.networkPending?'等待协作服务':t.assistant?.attention?.length ? '等你补充' : t.assistant?.output?.summary ? '已整理下一步' : labels[t.assistant?.status] ?? labels[t.phase]}</span></div></div><Badge state={t.phase} /></div>)}
  </section><section><div className="sm-section-head"><h2>最近沉淀</h2></div>{ui.data.sources.filter((s: any) => !s.external && s.knowledgeState === 'confirmed').slice(-4).reverse().map((s: any) => <div className="sm-list-row" key={s.id}><Icon name="book" /><div className="sm-grow"><button className="sm-link-button" onClick={() => ui.useSource(s.id)}>{s.title}</button>
    <span className="sm-muted sm-small">{ui.data.spaces.find((v: any) => v.domain === s.domain)?.name} · {labels[s.knowledgeState] ?? '资料'}</span></div></div>)}</section></div></>;
}

function AccessInbox({ ui }: { ui: UI }) {
  const [filter, setFilter] = useDraft(ui.prefix + 'request-filter', 'pending');
  const requests = ui.data.tasks.flatMap((t: any) => t.requests.filter((r: any) => filter === 'all' || filter === 'pending' && r.state === 'pending' && Date.parse(r.expiresAt) > Date.now() || filter === 'approved' && isLive(r)).map((r: any) => ({ task: t, request: r })));
  for(const entry of ui.data.sourceRequests??[])if(!requests.some((x:any)=>x.request.id===entry.request.id)&&(filter==='all'||filter==='pending'&&entry.request.state==='pending'||filter==='approved'&&isLive(entry.request)))requests.push(entry);
  return <section><div className="sm-section-head"><h2>授权申请</h2><label className="sm-field"><span className="sm-small sm-muted">查看范围</span><select className="sm-input" value={filter} onChange={e => setFilter(e.target.value)}><option value="pending">待我处理</option><option value="approved">生效中的授权</option><option value="all">全部记录</option></select></label></div>
    {!requests.length && <div className="sm-empty"><strong>{filter === 'pending' ? '当前没有待处理的访问申请' : '没有匹配的授权记录'}</strong>所有申请都绑定资料、任务、执行身份和期限。</div>}
    {requests.map(({ task, request }: any) => <RequestItem key={request.id} ui={ui} task={task} request={request} />)}</section>;
}

export function WorkspacePage({ context }: PluginPageProps) {
  const action = usePluginAction('workspace'), nav = useHostNavigation();
  const [data, setData] = useState<any>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const prefix = 'suitme-v4:' + context.companyId + ':' + (data?.currentUserId??context.userId??'loading') + ':', ref = useRef<HTMLElement>(null), requestSeq = useRef(0), inFlight = useRef<Promise<any> | undefined>(undefined);
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
  useEffect(() => { if (data && !data.spaces.some((s: any) => s.domain === domain)) setDomain(data.spaces.find((s:any)=>s.members?.includes(data.currentAgent))?.domain ?? data.spaces[0]?.domain ?? ''); }, [data, domain]);
  useEffect(() => { if (data && !data.tasks.some((t: any) => t.id === selected)) setSelected(data.tasks.find((t: any) => t.phase !== 'accepted')?.id ?? data.tasks[data.tasks.length - 1]?.id ?? ''); }, [data, selected]);
  const ticking = data?.tasks.some((t: any) => ['queued', 'running', 'cancelling'].includes(t.assistant?.status));
  // 后台轮询失败不打断用户，也不弹错误条：保留上一次数据，等下一次轮询或手动刷新恢复。
  // 这是有意保留的静默 catch，禁止把它改成向页面上报错误（会造成瞬时抖动刷屏）。
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
  // invoke 内部已把失败写入页面错误条，这里只负责吞掉 rethrow 避免 unhandled rejection。
  const run = (name: string, payload: any) => { void invoke(name, payload).catch(() => {}); };
  function openTask(id: string, nextPanel = 'progress') { if (id === selected) setPanel(nextPanel); else retained.set(prefix + 'panel:' + id, nextPanel); setSelected(id); setView('tasks'); }
  function useSource(id: string) { const s = data?.sources.find((v: any) => v.id === id); if (s) { setDomain(s.domain); setChosenSourcesByDomain(previous => ({ ...previous, [s.domain]: id })); } setView('spaces'); }
  const ui: UI = { data, busy, prefix, nav, invoke, run, openTask, useSource,openMemory:(id)=>{focusMemorySource(prefix,id);setView('memory');}, read: (name, payload) => action({ companyId: context.companyId, action: name, payload }), report: (message: string) => setError(message) };
  if (!data) return <main className="suitme-workbench"><style>{styles}</style>{error ? <div className="sm-error" role="alert"><span>{error}</span><Button onClick={() => { setError(''); void refresh().catch(e => setError(String(e.message ?? e))); }}>重试</Button></div> : <div className="sm-spinner-skeleton" role="status" aria-label="正在读取协作台"><div /><div /><div /><div /></div>}</main>;
  const pending = data.tasks.reduce((n: number, t: any) => n + t.requests.filter((r: any) => r.state === 'pending' && Date.parse(r.expiresAt) > Date.now()).length, 0);
  return <main className="suitme-workbench" ref={ref}><style>{styles}</style><header className="sm-top"><div className="sm-row"><h1>SuitMe 协作台</h1></div><div className="sm-actions"><Button className="sm-icon-button" aria-label="刷新工作台" title="刷新" disabled={busy} onClick={() => { void refresh().catch(e => setError(String(e.message ?? e))); }}><Icon name="refresh" /></Button><Button variant="primary" icon="plus" onClick={() => setCompose(!compose)}>发起协作</Button></div></header>
    <nav className="sm-navigation" aria-label="协作台导航">{[['work', '我的工作', 'work'], ['tasks', '协作', 'task'], ['spaces', '知识', 'book'], ['services', 'Agent', 'bot'], ['settings', '设置', 'shield']].map(([id, name, icon]) => <button key={id} aria-pressed={view === id || id==='tasks'&&view==='access'||id==='spaces'&&view==='memory'||id==='services'&&view==='members'} onClick={() => setView(id==='spaces'?'memory':id!)}><Icon name={icon!} />{name}</button>)}</nav>
    {['tasks','access'].includes(view)&&<nav className="sm-task-stage" aria-label="协作视图"><button aria-pressed={view==='tasks'} onClick={()=>setView('tasks')}>任务</button><button aria-pressed={view==='access'} onClick={()=>setView('access')}>访问申请{pending>0?' · '+pending:''}</button></nav>}
    {['spaces','memory'].includes(view)&&<nav className="sm-task-stage" aria-label="知识视图"><button aria-pressed={view==='spaces'} onClick={()=>setView('spaces')}>内容与图谱</button><button aria-pressed={view==='memory'} onClick={()=>setView('memory')}>检索与记忆</button></nav>}
    {['services','members'].includes(view)&&<nav className="sm-task-stage" aria-label="Agent视图"><button aria-pressed={view==='services'} onClick={()=>setView('services')}>服务目录</button><button aria-pressed={view==='members'} onClick={()=>setView('members')}>成员与归属</button></nav>}
    {error && <div className="sm-error" role="alert"><span>{error}</span><Button variant="quiet" onClick={() => setError('')}>关闭提示</Button></div>}
    {compose && <Compose ui={ui} initialSources={chosenSources} close={() => { setCompose(false); setChosenSources([]); }} />}
    {view === 'work' && <MyWork ui={ui} />}
    {view === 'tasks' && <TaskWorkspace ui={ui} selected={selected} setSelected={setSelected} panel={panel} setPanel={setPanel} />}
    {view === 'spaces' && <Spaces ui={ui} chosen={chosenSource} choose={setChosenSource} domain={domain} setDomain={setDomain} composeWith={id => { setChosenSources([id]); setCompose(true); }} />}
    {view === 'access' && <AccessInbox ui={ui} />}
    {view === 'services' && <AgentServicesPage ui={ui} />}
    {view === 'memory' && <MemoryWorkspace ui={ui}/>}
    {view === 'members' && <MemberBindings ui={ui}/>}
    {view === 'settings' && <Settings ui={ui} />}
  </main>;
}
