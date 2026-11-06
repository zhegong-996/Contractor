// v0.6 workbench views.
//
// Shape constraint (PRD §10A): these views grow INSIDE the existing 5-tab
// plugin page. They do not create a second app, do not import upstream source,
// and read only through /workspace/v06-* actions. Every surface is read-only
// unless the button explicitly says it changes something.
import { useEffect, useState, type ReactNode } from 'react';

interface V06UI {
  data: any;
  busy: boolean;
  prefix: string;
  read: (name: string, payload: any) => Promise<any>;
  invoke: (name: string, payload: any) => Promise<any>;
  run: (name: string, payload: any) => void;
  openTask: (id: string, panel?: string) => void;
}

const when = (value: any) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value)
    : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
};
const show = (value: any): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? value.map(show).join(' · ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};
const keyNames: Record<string, string> = {
  schemaVersion: '结构版本', taskId: '任务', lockedAt: '锁定时间', lockedBy: '锁定人', level: '验证等级',
  reviewer: '独立评审者', producerModel: '产出模型', hash: '清单摘要', draftedBy: '标准起草方',
  items: '检查项', overall: '本轮结论', round: '轮次', judgements: '逐项判定', status: '状态',
  state: '状态', granteeUserId: '承接人', grantorUserId: '授权人', fromRoleId: '原主职能',
  toRoleId: '目标主职能', capabilityBasis: '能力依据', scope: '授权范围', counterSigners: '联签人',
  standardLocked: '标准已锁定', validUntil: '有效期至', consultationOnly: '仅咨询',
  edges: '关系', revision: '版本', generatedAt: '读取时间', wake: '唤醒注意力',
  traceReady: '证据链完整', visualEvidenceRequired: '需要视觉证据', ready: '就绪',
  missing: '缺口', limitations: '限制', reasons: '未就绪原因', reasonsNote: '未就绪原因', nodeKinds: '节点类型', edgeRules: '边规则',
  connected: '已连接 L1 读取器', adapter: '抽取适配器', mode: '抽取模式', lastRun: '最近一次抽取',
  drafted: '新增草稿边', skippedExisting: '已存在跳过', rejected: '被拒绝的提案', modelCalls: '模型调用次数',
  l1: 'L1 投影规模', isolationKey: '隔离键', semanticJudgement: '图像语义判定', vision: '支持视觉输入',
  independent: '独立于产出模型', externalModelEnabled: '启用外部模型', inputModes: '可接收证据类型',
  signals: '组织信号', policy: '策略', registry: '职能注册表', attention: '注意力策略',
  watchdog: '运行时巡检', ontology: '默认本体', transferPolicy: '授权策略',
};
const labelOf = (key: string) => keyNames[key] ?? key;

function useRead(ui: V06UI, action: string, payload: any) {
  const key = action + ':' + JSON.stringify(payload ?? {});
  const [state, setState] = useState<{ value?: any; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    void ui.read(action, payload ?? {}).then(value => { if (active) setState({ value, loading: false }); })
      .catch((error: any) => { if (active) setState({ error: String(error?.message ?? error), loading: false }); });
    return () => { active = false; };
  }, [key]);
  return state;
}

function Load({ state, empty = '暂无记录', children }: { state: ReturnType<typeof useRead>; empty?: string; children: (value: any) => ReactNode }): any {
  if (state.loading) return <p className="sm-muted sm-small" role="status">正在读取…</p>;
  if (state.error) return <div className="sm-notice"><strong>暂不可用</strong><p className="sm-small">{state.error}</p></div>;
  if (state.value === null || state.value === undefined) return <div className="sm-empty"><strong>{empty}</strong></div>;
  return <>{children(state.value)}</>;
}

function Summary({ value }: { value: any }) {
  const entries = Object.entries((value ?? {}) as Record<string, any>).slice(0, 18);
  if (!entries.length) return <p className="sm-muted sm-small">暂无可显示字段</p>;
  return <dl className="sm-document">{entries.map(([key, item]) =>
    <div key={key}><dt>{labelOf(key)}</dt><dd>{show(item)}</dd></div>)}</dl>;
}

function Box({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): any {
  return <section className="sm-section sm-stack"><div className="sm-section-head"><h3>{title}</h3>{hint && <span className="sm-muted sm-small">{hint}</span>}</div>{children}</section>;
}

function Refresh({ onClick, busy }: { onClick: () => void; busy: boolean }): any {
  return <button className="sm-button" data-variant="quiet" disabled={busy} onClick={onClick}>刷新</button>;
}

/** Task-level: "验收与责任" panel inside the existing 协作 task detail. */
export function GovernancePanel({ ui, task }: { ui: V06UI; task: any }): any {
  const [tab, setTab] = useState('acceptance'), [reload, setReload] = useState(0);
  const extra = { taskId: task.id, reload };
  const plan = useRead(ui, 'v06-plan-view', extra);
  const round = useRead(ui, 'v06-round-view', extra);
  const transfer = useRead(ui, 'v06-transfer-view', extra);
  const grant = useRead(ui, 'v06-grant-check', extra);
  const trace = useRead(ui, 'trace-view', extra);
  const archivedReport = useRead(ui, 'v06-acceptance-report-view', extra);
  // Readiness must reflect the actual event stream, never a hard-coded value:
  // an incomplete trace is a real gate (FR-25), not a UI placeholder.
  const traceReady = trace.value?.available === true && (trace.value?.gaps?.length ?? 1) === 0;
  const readiness = useRead(ui, 'v06-review-readiness', { ...extra, traceReady, visualEvidenceRequired: true });
  const refresh = () => setReload(value => value + 1);
  return <section className="sm-stack sm-v06"><div className="sm-section-head"><h2>验收与责任</h2><Refresh onClick={refresh} busy={ui.busy} /></div>
    <p className="sm-small sm-muted">这里只显示依据与责任记录。最终由原发起人在原会话回复「确认验收 任务编号」完成核可；系统不会替人签字，未通过的检查项不会被算作通过。</p>
    <nav className="sm-task-stage" aria-label="验收与责任视图">{[['acceptance', '验收'], ['responsibility', '责任'], ['trace', '过程流水']].map(([id, name]) =>
      <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{name}</button>)}</nav>
    {tab === 'acceptance' && <div className="sm-stack">
      <Box title="开工前锁定的验收清单" hint="锁定后不可改写"><Load state={plan} empty="本任务尚未启用开工前清单，最终仍由原发起人在原会话确认验收">
        {(value: any) => { const sealed = value?.plan ?? value; return <>
          <Summary value={sealed} />
          {Array.isArray(sealed?.items) && <div className="sm-table-scroll"><table className="sm-table"><thead><tr><th>检查项</th><th>判定依据</th><th>证据类型</th></tr></thead><tbody>
            {sealed.items.map((item: any, index: number) => <tr key={item.id ?? index}><th>{show(item.name ?? item.title)}</th><td>{show(item.criteria ?? item.criterion)}</td><td>{show(item.evidenceKind)}</td></tr>)}
          </tbody></table></div>}
          {value?.revision && <p className="sm-muted sm-small">原生修订 {String(value.revision).slice(0, 12)}，改写会产生新修订而不是覆盖。</p>}
        </>; }}
      </Load></Box>
      <Box title="逐项评审报告" hint="独立评审只提供证据"><Load state={round} empty="本轮还没有逐项评审报告">
        {(value: any) => <><Summary value={value} />
          {Array.isArray(value?.judgements) && <div className="sm-table-scroll"><table className="sm-table"><thead><tr><th>检查项</th><th>判定</th><th>说明</th></tr></thead><tbody>
            {value.judgements.map((item: any, index: number) => <tr key={item.name ?? index}><th>{show(item.name)}</th><td>{show(item.status)}</td><td>{show(item.reason)}</td></tr>)}
          </tbody></table></div>}
          <p className="sm-small sm-muted">未通过的项只退这些项，退回原因会沉淀为下次自查标准；报告不替代发起人核可。</p></>}
      </Load></Box>
      <Box title="独立评审就绪状态"><Load state={readiness} empty="尚未评估">
        {(value: any) => <><Summary value={value} />
          <div className="sm-notice"><p className="sm-small">{value?.ready
            ? '独立评审链路已就绪：按已注册评审者的实际能力核对证据绑定（是否判断图像内容取决于评审者配置，不默认宣称视觉语义判定）；逐项报告只作为证据；请原发起人在原会话回复「确认验收 任务编号」完成最终核可。'
            : `尚未就绪：${(value?.reasons ?? []).join('；') || '等待事件流水与评审者注册'}`}</p>
            {!!trace.value?.gaps?.length && <p className="sm-small sm-muted">事件流水缺口：{trace.value.gaps.join('；')}</p>}
            {(value?.limitations ?? []).length > 0 && <p className="sm-small sm-muted">{value.limitations.join('；')}</p>}
          </div></>}
      </Load></Box>
      <Box title="验收报告与自查标准" hint="本机只读报告服务"><Load state={archivedReport} empty="尚未读取报告状态">
        {(value: any) => <><Summary value={{ available: value?.available, verdict: value?.verdict,
          cases: value?.cases, archivedRounds: value?.archivedRounds, createdAt: value?.createdAt }} />
          {value?.available
            ? <div className="sm-actions"><a className="sm-button" href={value.reportUrl} target="_blank" rel="noreferrer">查看逐项验收报告</a></div>
            : <p className="sm-small sm-muted">本任务还没有归档报告，先执行 npm run acceptance:export -- 任务ID。</p>}
          {Array.isArray(value?.selfCheckStandards) && value.selfCheckStandards.length > 0
            && <ul className="sm-small">{value.selfCheckStandards.map((text: string, i: number) => <li key={i}>{text}</li>)}</ul>}
          <p className="sm-small sm-muted">{value?.note}</p></>}
      </Load></Box>
    </div>}
    {tab === 'responsibility' && <div className="sm-stack">
      <Box title="跨职能授权卡片" hint="默认只管本 Task"><Load state={transfer} empty="本任务没有跨职能 Transfer，责任锚在主职能">
        {(value: any) => { const card = value?.transfer ?? value; return <>
          <Summary value={card} />
          <p className="sm-small sm-muted">责任不随能力走：承接人负执行责任，目标职能 owner 保留兜底；对外、资金、客户可见动作需联签。</p>
          <div className="sm-actions"><button className="sm-button" data-variant="quiet" disabled={ui.busy || card?.state !== 'active'}
            onClick={() => ui.run('v06-transfer-revoke', { taskId: task.id, reason: '工作台：授权人撤销' })}>撤销本次授权</button></div>
        </>; }}
      </Load></Box>
      <Box title="跨空间上下文授权" hint="默认隔离、申请后授权"><Load state={grant} empty="本任务没有跨空间授权申请">
        {(value: any) => <><Summary value={value} /><p className="sm-small sm-muted">审批方是目标空间 owner；只开最小可见子集、默认只读、有期限、可撤销。</p></>}
      </Load></Box>
    </div>}
    {tab === 'trace' && <Box title="统一过程流水" hint="谁、调了什么、依据哪版、花了多少"><Load state={trace} empty="本任务还没有结构化事件">
      {(value: any) => { const events: any[] = Array.isArray(value) ? value : Array.isArray(value?.events) ? value.events : [];
        const cost = events.reduce((sum, event) => sum + (Number(event.cost) || 0), 0);
        return <><p className="sm-small sm-muted">共 {events.length} 条事件 · 成本合计 {cost.toFixed(4)}（按原生账本口径）{value?.gaps?.length ? ` · ${value.gaps.length} 处证据缺口` : ''}</p>
          {!events.length ? <div className="sm-empty"><strong>暂无事件</strong>回执、发布、预览、验收与模型调用会逐步留痕。</div>
            : <div className="sm-table-scroll"><table className="sm-table"><thead><tr><th>时间</th><th>事件</th><th>执行者 / 模型</th><th>依据 / 工具</th><th>成本</th><th>证据</th></tr></thead><tbody>
              {events.slice().reverse().slice(0, 60).map((event: any, index: number) => <tr key={event.id ?? index}>
                <td>{when(event.at)}</td><td>{show(event.kind)}{event.outcome ? ' · ' + show(event.outcome) : ''}</td>
                <td>{show(event.actor)}{event.model ? ' · ' + show(event.model) : ''}</td>
                <td>{show(event.sourceRef ?? event.tool ?? event.checkpoint)}</td><td>{show(event.cost)}</td>
                <td>{show(event.evidenceKind)}{event.gaps?.length ? ' · 缺 ' + event.gaps.length : ''}</td></tr>)}</tbody></table></div>}
        </>; }}
    </Load></Box>}
  </section>;
}

/** Settings sub-tab: organisation rules, read-only, never a ranking view. */
export function OrganizationPanel({ ui }: { ui: V06UI }): any {
  const [reload, setReload] = useState(0), [space, setSpace] = useState('default');
  const overview = useRead(ui, 'v06-org-overview', { space, reload });
  const titles: Record<string, string> = { registry: '职能注册表', transferPolicy: 'Transfer 授权策略', policy: 'Workspace 政策',
    attention: '注意力预算', watchdog: '运行时巡检', reviewer: '独立评审就绪度', ontology: '默认组织本体',
    extraction: 'L2 自动抽取状态', feishuOrg: '飞书组织映射', signals: '组织状态信号' };
  return <section className="sm-stack sm-v06"><div className="sm-section-head"><h2>组织规则</h2><Refresh onClick={() => setReload(v => v + 1)} busy={ui.busy} /></div>
    <div className="sm-notice"><p className="sm-small">本页只读。职能划分、验证等级、汇报拓扑与授权档位都是配置，组织级修改需组织 owner；组织信号只提示、不拦截、不排名，也不用于考核。</p></div>
    <label className="sm-field">Workspace 标识<input className="sm-input" value={space} onChange={e => setSpace(e.target.value)} placeholder="default" /></label>
    <Load state={overview} empty="尚未读取到组织规则">
      {(value: any) => <div className="sm-stack"><p className="sm-muted sm-small">读取于 {when(value?.generatedAt)}</p>
        {(value?.sections ?? []).map((section: any) => <details className="sm-details" key={section.name}>
          <summary>{titles[section.name] ?? section.name} <span className="sm-muted sm-small">· {section.ok ? '已读取' : '暂不可用'}</span></summary>
          {section.ok ? <Summary value={section.value} /> : <p className="sm-error">{section.error}</p>}
        </details>)}
      </div>}
    </Load>
  </section>;
}

/** Knowledge sub-tab: relationship states (draft / accepted / reusable). */
export function KnowledgeStatePanel({ ui, domain }: { ui: V06UI; domain?: string }): any {
  const tasks: any[] = ui.data?.tasks ?? [];
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? ''), [reload, setReload] = useState(0);
  const edges = useRead(ui, 'v06-edges-view', { taskId, reload });
  const pack = useRead(ui, 'v06-context-pack', { taskId, registryVersion: 0, reload });
  const extraction = useRead(ui, 'v06-l2-status', { reload });
  const globalEdges = useRead(ui, 'v06-l2-edges-view', { reload });
  const stateNames: Record<string, string> = { draft: '草稿', accepted: '已验收', reusable: '可复用' };
  return <section className="sm-stack sm-v06"><div className="sm-section-head"><h2>关系与状态</h2><Refresh onClick={() => setReload(v => v + 1)} busy={ui.busy} /></div>
    <p className="sm-small sm-muted">空间：{show(domain ?? '全部')}。关系本身带状态与有效期；只有已验收的关系能被 Agent 当作依据，来源变版时旧关系自动失效。L1 证据图按来源修订隔离，不受此页影响。</p>
    <Box title="L2 自动抽取" hint="读 Cognee L1 → 生成带原文证据的草稿边"><Load state={extraction} empty="尚未读取抽取状态">
      {(value: any) => <><Summary value={value?.lastRun ?? value} />
        <p className="sm-small sm-muted">{value?.connected ? '已连接 Cognee L1 只读投影' : '未连接 L1 读取器'}；当前为{value?.mode === 'model' ? '模型' : '确定性'}抽取，模型调用 {show(value?.lastRun?.modelCalls ?? 0)}。L1 按 sha256(sourceId@revision) 物理隔离，抽取只生成草稿，仍要人验收。</p>
        <Load state={globalEdges} empty="全局组织图暂无关系">
          {(list: any) => <p className="sm-small sm-muted">全局组织图已有 {Array.isArray(list) ? list.length : 0} 条带状态关系。</p>}
        </Load></>}
    </Load></Box>
    <label className="sm-field">按任务查看<select className="sm-input" value={taskId} onChange={e => setTaskId(e.target.value)}>
      <option value="">选择协作任务</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.identifier} · {t.title}</option>)}</select></label>
    {!taskId ? <div className="sm-empty"><strong>还没有协作任务</strong>先在「协作」里发起一单，关系会随任务沉淀。</div> : <>
      <Box title="L2 组织图关系" hint="产品层记录"><Load state={edges} empty="此任务还没有组织图关系">
        {(value: any) => { const list: any[] = Array.isArray(value) ? value : Array.isArray(value?.edges) ? value.edges : [];
          return <>{!list.length ? <div className="sm-empty"><strong>暂无关系</strong>协作过程中的决策、证据与责任会在这里留下带状态的边。</div>
            : <div className="sm-table-scroll"><table className="sm-table"><thead><tr><th>关系</th><th>起点 → 终点</th><th>状态</th><th>生效 / 失效</th><th>证据</th><th>操作</th></tr></thead><tbody>
              {list.map((edge: any) => <tr key={edge.id}><th>{show(edge.kind)}</th><td>{show(edge.from)} → {show(edge.to)}</td>
                <td>{stateNames[edge.state] ?? show(edge.state)}</td><td>{when(edge.validFrom)} / {edge.invalidAt ? when(edge.invalidAt) : '仍有效'}</td>
                <td>{show((edge.evidenceRefs ?? []).length)} 条</td>
                <td><div className="sm-actions">
                  <button className="sm-button" data-variant="quiet" disabled={ui.busy} onClick={() => ui.run('v06-edge-accept', { taskId, edgeId: edge.id })}>验收</button>
                  <button className="sm-button" data-variant="quiet" disabled={ui.busy} onClick={() => ui.run('v06-edge-reusable', { taskId, edgeId: edge.id })}>可复用</button>
                  <button className="sm-button" data-variant="quiet" disabled={ui.busy} onClick={() => ui.run('v06-edge-invalidate', { taskId, edgeIds: [edge.id], reason: '工作台：来源变版或验收打回' })}>失效</button>
                </div></td></tr>)}</tbody></table></div>}</>; }}
      </Load></Box>
      <Box title="本任务上下文快照" hint="一次性投影，不是知识库本身"><Load state={pack} empty="尚未构建 Context Pack">
        {(value: any) => <><Summary value={value} /><p className="sm-small sm-muted">快照按任务裁剪，带可见性标签与过期策略；过期后重新裁剪，不会把旧授权带进新任务。</p></>}
      </Load></Box>
    </>}
  </section>;
}
