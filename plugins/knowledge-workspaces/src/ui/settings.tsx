// 设置区：空间与权限、模型与代理、服务与架构、组织规则、国内服务清单。
import { useEffect, useState } from 'react';
import { Badge, Button, Details, useDraft, type UI } from './foundation.js';
import { OrganizationPanel } from './v06-panels.js';
import { DomesticServices } from './domestic-services.js';

function WorkspaceConfiguration({ ui }: { ui: UI }) {
  const k = ui.prefix + 'configuration:', [editing, setEditing] = useDraft(k + 'editing', ''), [name, setName] = useDraft(k + 'name', ''),
    [owner, setOwner] = useDraft(k + 'owner', ui.data.actors[0]?.key ?? ''), [description, setDescription] = useDraft(k + 'description', ''),
    [participants, setParticipants] = useDraft<string[]>(k + 'participants', ui.data.actors.map((a: any) => a.key));
  if (!ui.data.configurableAgents?.length) return null;
  return <Details remember={k + 'open'}><summary>配置空间与执行身份</summary><div className="sm-stack sm-section">
    <form className="sm-form" onSubmit={e => { e.preventDefault(); const id = editing || 'space-' + crypto.randomUUID(); void ui.invoke('configure-space', { id, name, agent: owner, description }).then(() => { setEditing(id); }).catch((e: any) => ui.report(String(e?.message ?? e))); }}>
      <label className="sm-field">知识空间<select className="sm-input" value={editing} onChange={e => { const s = ui.data.spaces.find((s: any) => s.domain === e.target.value); setEditing(e.target.value); setName(s?.name ?? ''); setOwner(s?.agent ?? ui.data.actors[0]?.key ?? ''); setDescription(s?.description ?? ''); }}><option value="">新建空间</option>{ui.data.spaces.map((s: any) => <option key={s.domain} value={s.domain}>{s.name}</option>)}</select></label>
      <div className="sm-form-grid"><label className="sm-field">名称<input className="sm-input" value={name} onChange={e => setName(e.target.value)} required /></label><label className="sm-field">资料责任身份<select className="sm-input" value={owner} onChange={e => setOwner(e.target.value)}>{ui.data.configurableAgents.map((a: any) => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label></div>
      <label className="sm-field">适用范围<input className="sm-input" value={description} onChange={e => setDescription(e.target.value)} /></label>
      <p className="sm-muted sm-small">空间可以按项目、主题或团队组织。新建空间不自动授予资料访问；成员在原生权限页管理，飞书资料另按任务授权。</p><div><Button disabled={ui.busy || !name.trim()}>保存空间</Button></div>
    </form><form className="sm-form" onSubmit={e => { e.preventDefault(); ui.run('configure-participants', { keys: participants }); }}><fieldset className="sm-choices"><legend>可选执行身份</legend>{ui.data.configurableAgents.map((a: any) => <label className="sm-check" key={a.key}><input type="checkbox" checked={participants.includes(a.key)} onChange={e => setParticipants(e.target.checked ? [...participants, a.key] : participants.filter(x => x !== a.key))} />{a.name}</label>)}</fieldset><p className="sm-muted sm-small">调整可选身份不改变原生资源权限。正在负责的任务须先交接。</p><div><Button disabled={ui.busy || !participants.length}>保存执行身份</Button></div></form>
  </div></Details>;
}

export function Settings({ ui }: { ui: UI }) {
  const [tab, setTab] = useDraft(ui.prefix + 'settings-tab', 'models'), [modelData, setModelData] = useDraft<any>(ui.prefix + 'model-data', null), [draft, setDraft] = useDraft<any>(ui.prefix + 'model-draft', null);
  const [system, setSystem] = useState<any>(), [loadError, setLoadError] = useState(''), [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false), [saveError, setSaveError] = useState('');
  async function load() {
    setLoadError(''); setLoaded(false);
    // 两个读分别降级：管理员级视图被拒时，不要让另一块也停在永久「正在读取」。
    const [m, s] = await Promise.all([
      ui.read('model-settings', {}).catch((e: any) => ({ __error: String(e?.message ?? e) })),
      ui.read('system-status', {}).catch((e: any) => ({ __error: String(e?.message ?? e) })),
    ]);
    if (!m.__error) { setModelData(m); if (!draft) setDraft(m.settings); }
    if (!s.__error) setSystem(s);
    const errors = [m.__error, s.__error].filter(Boolean);
    if (errors.length) setLoadError(errors.join('；'));
    setLoaded(true);
  }
  useEffect(() => { void load().catch((e: any) => { setLoadError(String(e?.message ?? e)); setLoaded(true); }); }, []);
  const tiers: Record<string, string> = { fast: '轻量事务', standard: '复杂分析', code: '开发执行' }, providers: Record<string, string> = { unconfigured: '待选择', gemini: 'Gemini', ark: '火山方舟', 'codex-cli': 'Codex CLI', 'claude-cli': 'Claude Code CLI', other: '其他服务' };
  function profileChange(id: string, key: string, value: any) { setSaved(false); setDraft({ ...draft, profiles: draft.profiles.map((p: any) => p.id === id ? { ...p, [key]: value } : p) }); }
  return <section className="sm-stack"><nav className="sm-task-stage" aria-label="系统设置"><button aria-pressed={tab === 'models'} onClick={() => setTab('models')}>模型与代理</button><button aria-pressed={tab === 'system'} onClick={() => setTab('system')}>服务与架构</button><button aria-pressed={tab === 'workspace'} onClick={() => setTab('workspace')}>空间与权限</button><button aria-pressed={tab === 'organization'} onClick={() => setTab('organization')}>组织规则</button><button aria-pressed={tab === 'domestic'} onClick={() => setTab('domestic')}>国内服务</button></nav>{tab==='workspace'&&<WorkspaceConfiguration ui={ui}/>}{tab==='organization'&&<OrganizationPanel ui={ui}/>}{tab==='domestic'&&<DomesticServices ui={ui}/>}
    {loadError && <div className="sm-error" role="alert">{loadError}<Button onClick={() => void load()}>重试</Button></div>}
    {tab === 'models' && (!draft || !modelData ? (loaded ? <p role="alert" className="sm-error">模型配置未读取{loadError ? '：' + loadError : ''}</p> : <p role="status">正在读取模型配置…</p>) : <><div className="sm-section-head"><h2>模型与代理</h2><Badge>新模型服务未启用</Badge></div>
      <p className="sm-small sm-muted">当前协作助手：{modelData.currentAssistant.engine === 'claude' ? 'Claude Code' : 'Codex'} CLI · {modelData.currentAssistant.model ?? '未显式指定型号'}。以下保存为预备策略，不切换既有任务，也不发送资料到新服务。</p>
      <form className="sm-form" onSubmit={e => { e.preventDefault(); setSaveError(''); setSaved(false); void ui.invoke('save-model-settings', { settings: draft, revision: modelData.revision }).then(m => { setModelData(m); setDraft(m.settings); setSaved(true); }).catch((err: any) => setSaveError(String(err?.message ?? err))); }}>
        {draft.profiles.map((p: any) => <fieldset className="sm-model-profile" key={p.id}><legend>{tiers[p.tier]}</legend><p className="sm-small sm-muted">{p.tier === 'fast' ? '摘要、分类、待办提取、交接整理。' : p.tier === 'standard' ? '多来源分析、方案推理与复杂决策准备。' : '交给 Codex、Claude Code 等开发工具执行。'}</p>
          <div className="sm-form-grid"><label className="sm-field">服务<select className="sm-input" value={p.provider} onChange={e => profileChange(p.id, 'provider', e.target.value)}>{Object.entries(providers).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="sm-field">模型标识<input className="sm-input" value={p.model} placeholder={p.tier === 'fast' ? '填写 Flash／Lite 级模型或接入点 ID' : '填写明确的模型 ID'} onChange={e => profileChange(p.id, 'model', e.target.value)} /></label></div>
          {!p.provider.endsWith('-cli') && <label className="sm-field">凭据环境变量名<input className="sm-input" value={p.credentialEnv} placeholder="仅填写变量名，不填写密钥" pattern="[A-Z][A-Z0-9_]{0,79}|^$" onChange={e => profileChange(p.id, 'credentialEnv', e.target.value)} /></label>}
          <Details remember={ui.prefix + 'model-limits:' + p.id}><summary>预备额度</summary><div className="sm-form-grid"><label className="sm-field">每次输入字符上限<input className="sm-input" type="number" min="1000" max="80000" value={p.maxInputChars} onChange={e => profileChange(p.id, 'maxInputChars', Number(e.target.value))} /></label><label className="sm-field">每次输出 Token 上限<input className="sm-input" type="number" min="128" max="16384" value={p.maxOutputTokens} onChange={e => profileChange(p.id, 'maxOutputTokens', Number(e.target.value))} /></label></div></Details>
        </fieldset>)}
        <h3>执行身份的模型绑定</h3><p className="sm-small sm-muted">执行引擎可共享；成员的资料身份、任务上下文与授权独立。新模型服务仅保存预备配置。</p>
        <div className="sm-table-scroll"><table className="sm-table"><thead><tr><th>执行身份</th>{Object.values(tiers).map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{draft.bindings.map((b: any) => <tr key={b.agent}><th>{modelData.identities.find((a: any) => a.key === b.agent)?.name ?? b.agent}</th>{Object.keys(tiers).map(tier => <td key={tier}><select className="sm-input" aria-label={(modelData.identities.find((a: any) => a.key === b.agent)?.name ?? b.agent) + '的' + tiers[tier]} value={b[tier]} onChange={e => { setSaved(false); setDraft({ ...draft, bindings: draft.bindings.map((v: any) => v.agent === b.agent ? { ...v, [tier]: e.target.value } : v) }); }}><option value="">不绑定</option>{draft.profiles.filter((p: any) => p.tier === tier).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>)}</tr>)}</tbody></table></div>
        <div className="sm-actions"><Button variant="primary" disabled={ui.busy || !ui.data.canManageWorkspace}>保存预备配置</Button>{saved && <span role="status">已保存到私有数据库记录，尚未启用。</span>}</div>
        {saveError && <p className="sm-error" role="alert">保存失败：{saveError}</p>}
        {!ui.data.canManageWorkspace && <p className="sm-small sm-muted">当前为成员视图：模型预备配置仅本机操作员可保存。</p>}
      </form></>)}
    {tab === 'system' && (!system ? (loaded ? <p role="alert" className="sm-error">服务状态未读取{loadError ? '：' + loadError : ''}</p> : <p role="status">正在核对服务…</p>) : <><h2>服务与架构</h2><div className="sm-table-scroll"><table className="sm-table"><thead><tr><th>组件</th><th>当前状态</th></tr></thead><tbody>
      <tr><th>Paperclip / 协作服务</th><td>{system.services.paperclip === 'ok' && system.services.bridge === 'ok' ? '运行中' : '待恢复'}</td></tr><tr><th>飞书事件通道</th><td>{system.services.feishu === 'ready' ? '已连接' : '未连接'}</td></tr>
      <tr><th>业务数据</th><td>{system.storage.primary}</td></tr><tr><th>事件、去重与回执</th><td>SQLite（本机持久化）</td></tr><tr><th>数据库备份</th><td>{system.storage.databaseBackup === 'ok' ? '本机备份正常；异机恢复尚未验证' : '待核对'}</td></tr>
      <tr><th>知识引擎</th><td>{system.knowledgeEngine?.installed ? `Cognee · Ladybug；${system.knowledgeEngine.sourceRevisionGraphs} 个来源版本图谱` : 'Cognee 尚未安装'}</td></tr>
      <tr><th>自动知识处理</th><td>{system.knowledgeEngine?.automaticExtraction ? '资料入库时确定性抽取 L2 组织图谱；' : '未启用确定性抽取；'}{system.knowledgeEngine?.cogneeNative?.enabled ? 'Cognee 原生 LLM 实体抽取 / embedding / cognify 已打开' : 'Cognee 原生抽取关闭'}</td></tr>
      <tr><th>Cognee 原生管线</th><td>{system.knowledgeEngine?.cogneeNative?.configured ? `已配置 · ${system.knowledgeEngine.cogneeNative.llmModel} / ${system.knowledgeEngine.cogneeNative.embeddingModel}` : `未就绪 · 缺少环境变量 ${(system.knowledgeEngine?.cogneeNative?.missing ?? []).join('、') || '无'}`}{system.knowledgeEngine?.cogneeNative?.privacy ? ' · ' + system.knowledgeEngine.cogneeNative.privacy : ''}</td></tr>
      <tr><th>模型 API / 对象存储</th><td>{system.integrations?.modelApi ? '已接入外部 OpenAI-compatible 模型服务（Cognee 原生管线）；对象存储未接入' : '外部模型服务未配置；对象存储未接入'}</td></tr>
      <tr><th>本机向量检索</th><td>{system.integrations?.vectorSearch ? '已启用 · 设备端词向量 + Cognee BM25 混合' : '未启用'}{system.integrations?.vectorSearchNote ? ' · ' + system.integrations.vectorSearchNote : ''}</td></tr>
      <tr><th>独立视觉评审</th><td>{system.integrations?.visionReviewer ?? '未挂接'}</td></tr>
      <tr><th>团队登录</th><td>当前单机受信任模式；已适配原生成员登录与个人 Agent 绑定</td></tr></tbody></table></div>
      <h3>运行关系</h3><ol className="sm-architecture"><li><strong>入口</strong><span>飞书 · 中文协作台 · MCP</span></li><li><strong>协作与上下文</strong><span>任务 · 资料授权 · 版本 · 交接 · 人工验收</span></li><li><strong>原生运行</strong><span>Paperclip 调度与锁 → 当前 Codex CLI；轻量模型待启用</span></li><li><strong>知识与存储</strong><span>字段 + 正文 → 私有文档与修订 → PostgreSQL；确切修订 → Cognee / Ladybug 图谱</span></li></ol>
      <p className="sm-small sm-muted">Wiki 另存于本机 Markdown 目录，自动摄取关闭（指不自动把私有资料复制进共享 Wiki）。当前知识库沿用原生私有文档权限。目录配置和部分事件仍在本机文件与 SQLite 中。</p>
      <Details remember={ui.prefix + 'system-counts'}><summary>存储记录（包含联调数据）</summary><dl className="sm-document">{Object.entries(system.records).map(([key, value]) => <div key={key}><dt>{{ tasks: '任务映射', events: '接入事件', outbox: '出站回执', audit: '审计事件' }[key]}</dt><dd>{String(value)}</dd></div>)}</dl></Details>
    </>)}
  </section>;
}
