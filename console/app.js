(() => {
  'use strict';

  const VIEWS = [
    { id: 'overview', title: '概览', glyph: '◎', subtitle: '同一份共享现场，人和助手各看自己该看的', actions: ['view', 'memory-status', 'routing-status'] },
    { id: 'collaboration', title: '协作', glyph: '⇄', subtitle: '谁接、谁派、谁干，都在一条责任链上', actions: ['view', 'trace-view', 'routing-status', 'v06-agent-registry-view', 'v06-evolution-view', 'v06-execution-view'] },
    { id: 'knowledge', title: '知识', glyph: '▤', subtitle: '资料、证据与组织关系，按身份逐步重评', actions: ['memory-status', 'memory-replay', 'system-status'] },
    { id: 'acceptance', title: '验收', glyph: '✓', subtitle: '开工前锁定清单，逐项判定后由发起人确认', actions: ['view', 'v06-org-overview'] },
    { id: 'services', title: '服务', glyph: '◈', subtitle: '本机与国内服务的实时状态，没连接不放空入口', actions: ['service-status', 'system-status'] },
    { id: 'settings', title: '设置', glyph: '⚙', subtitle: '运行关系与预备策略，只做查看，不发起任务', actions: ['system-status', 'model-settings'] },
  ];

  const PHASE_LABELS = {
    intake: '待接入', dispatched: '已派单', in_progress: '进行中', review: '待评审',
    accepted: '已验收', blocked: '受阻', closed: '已结束', draft: '草稿',
  };
  const KEY_LABELS = {
    tasks: '任务', spaces: '知识空间', sources: '资料', members: '成员',
    events: '事件', records: '记录', modelCalls: '模型调用', engine: '检索引擎',
    connected: '已连接', unavailable: '未接通', eventCount: '事件总数',
    logErrors: '日志异常', deploymentMode: '部署形态', primary: '主存储',
    revision: '版本', deterministic: '确定性重放', sections: '板块',
    generatedAt: '生成时间', checkedAt: '检查时间', phase: '阶段',
    identifier: '编号', title: '标题', agent: '承接方', goal: '目标',
  };

  // 用户可见层的统一语言：后端内部标识保持英文，展示出来的都换成中文产品词。
  const DOMESTIC_TERMS = [
    [/Slack\s*\/\s*GitHub\s*\/\s*Linear\s*\/\s*Notion\s*\/\s*Vercel\s*\/\s*Zapier/gi, '海外协作服务（默认不启用）'],
    [/Paperclip/gi, '本机协作服务'], [/Cognee/gi, '知识引擎'],
    [/Ladybug/gi, '图存储'], [/OpenAI[-\s]?compatible/gi, '兼容模型服务'],
    [/Claude Code/gi, '本地开发工具'], [/Codex( CLI)?/gi, '本地开发工具'],
    [/GitHub/gi, '代码仓库'], [/Slack/gi, '海外即时通讯'],
    [/Vercel/gi, '海外托管服务'], [/Notion/gi, '海外文档服务'],
    [/Gemini/gi, '轻量模型服务'], [/SQLite/gi, '本机持久化'],
    [/PostgreSQL/gi, '事务数据库'], [/Wiki/gi, '文库'],
    [/Markdown/gi, '富文本'], [/BM25/gi, '词法检索'],
    [/Plugin SDK/gi, '扩展接口'], [/Trace/gi, '留痕'],
  ];

  function clean(text) {
    let value = String(text ?? '');
    for (const [pattern, replacement] of DOMESTIC_TERMS) value = value.replace(pattern, replacement);
    return value;
  }
  function label(key) { return KEY_LABELS[key] ?? clean(key); }
  function escapeHtml(text) {
    return clean(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }
  function timeText(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return clean(value);
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  const state = { view: 'overview', tasks: [], facts: {}, theme: localStorage.getItem('suitme-theme') || 'light' };
  const $ = id => document.getElementById(id);

  // 只读请求的 in-flight 去重 + 短缓存：视图本身和顶部状态条会同时请求同一个
  // action，并发重复请求会在超时边界下一起挂掉。只合并同一时刻的相同只读请求，
  // 不改变任何数据、不缓存失败结果。
  // view 会带回整个工作区快照，真实浏览器实测 10~12 秒 / 400KB+（宿主数据增长后
  // 从约 5 秒退化），单独给宽限；其余只读动作仍 8 秒快速失败，不让一个慢请求拖住整页。
  const inFlight = new Map();
  const readCache = new Map();
  const CACHE_MS = 1500;
  const READ_TIMEOUT = { view: 30000 };
  async function api(action, payload = {}) {
    const key = action + ':' + JSON.stringify(payload);
    const hit = readCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      const response = await fetch('/api/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }), signal: AbortSignal.timeout(READ_TIMEOUT[action] ?? 8000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '读取失败');
      readCache.set(key, { at: Date.now(), value: data });
      return data;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, task);
    return task;
  }
  async function safe(action, payload) {
    try { return await api(action, payload); } catch (error) { return { __error: String(error.message || error) }; }
  }

  function card(title, hint, body, extra = '') {
    return `<section class="card ${extra}"><div class="card-head"><h2>${escapeHtml(title)}</h2></div>${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ''}${body}</section>`;
  }
  function statRow(items) {
    return `<div class="stat-row">${items.map(([value, text]) => `<div class="stat"><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${escapeHtml(text)}</div></div>`).join('')}</div>`;
  }
  function kvRows(entries) {
    if (!entries.length) return '<p class="empty">暂无数据</p>';
    return `<dl class="kv">${entries.map(([key, value]) => `<div class="kv-row"><dt>${escapeHtml(label(key))}</dt><dd>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</dd></div>`).join('')}</dl>`;
  }
  function listRows(rows) {
    if (!rows.length) return '<p class="empty">暂无条目，连接后会自动出现在这里。</p>';
    return `<div class="list">${rows.map(row => `<div class="list-row"><div class="list-row-head"><span class="list-row-title">${escapeHtml(row.title)}</span><span class="list-row-meta">${escapeHtml(row.meta || '')}</span></div>${row.detail ? `<div class="list-row-detail">${escapeHtml(row.detail)}</div>` : ''}</div>`).join('')}</div>`;
  }
  function errorCard(result) {
    return result && result.__error ? card('暂时无法读取', '', `<p class="empty">${escapeHtml(result.__error)}。请确认本机协作服务已启动。</p>`, 'error-card') : '';
  }

  async function renderOverview() {
    const [view, memory, routing] = await Promise.all([safe('view'), safe('memory-status'), safe('routing-status')]);
    const tasks = Array.isArray(view.tasks) ? view.tasks : [];
    state.tasks = tasks;
    const events = routing.projection?.eventCount ?? routing.eventCount ?? 0;
    const counts = memory.records ?? {};
    const totalRecords = Object.values(counts).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
    const stats = card('现场概览', '任务、知识事件与共享现场的当前规模', statRow([
      [tasks.length, '进行中的任务'], [(Array.isArray(view.spaces) ? view.spaces.length : 0), '知识空间'],
      [events, '留痕事件'],
    ]));
    const recent = card('最近协作', '点开左侧会话可查看对应任务', listRows(tasks.slice(0, 6).map(task => ({
      title: (task.identifier ? task.identifier + ' · ' : '') + (task.title || '未命名任务'),
      meta: PHASE_LABELS[task.phase] || clean(task.phase || ''),
      detail: task.goal || '',
    }))));
    const memoryCard = card('共享记忆', '四条投影由同一份事件主干重放，重放结果可逐字节对照',
      kvRows([['engine', memory.engine ?? '本机检索'], ['modelCalls', memory.modelCalls ?? 0], ['records', totalRecords], ['deterministic', '是']]));
    const orgCard = card('组织与接入', '飞书仍是唯一发起入口；这里只做查看、授权与确认',
      kvRows([['feishuConnected', view.feishuConnected ? '已连接' : '未连接'], ['assistantAvailable', view.assistantAvailable ? '可用' : '待启用'], ['configurableAgents', Array.isArray(view.configurableAgents) ? view.configurableAgents.length : 0]]));
    return errorCard(view) + `<div class="content-grid">${stats}${recent}${memoryCard}${orgCard}</div>`;
  }

  async function renderCollaboration() {
    const [view, routing, registry, evolution, execution] = await Promise.all([
      safe('view'), safe('routing-status'), safe('v06-agent-registry-view'),
      safe('v06-evolution-view'), safe('v06-execution-view'),
    ]);
    const tasks = Array.isArray(view.tasks) ? view.tasks : state.tasks;
    state.tasks = tasks;
    const bubbles = tasks.slice(0, 8).map((task, index) =>
      `<div class="bubble ${index % 2 ? 'alt' : ''}"><strong>${escapeHtml(task.identifier || '任务')}</strong> · ${escapeHtml(task.title || '未命名任务')}<span class="bubble-time">${escapeHtml(PHASE_LABELS[task.phase] || clean(task.phase || ''))} · 由发起人在飞书确认</span></div>`).join('')
      || '<p class="empty">暂无协作记录。</p>';
    const timeline = card('协作时间线', '同一份共享现场，不靠摘要转发', `<div class="bubbles">${bubbles}</div>`);
    const chain = card('责任链', '承接人负执行责任，目标职能负责人兜底；高风险动作需要人联签',
      kvRows([['承接', '按主职能定组、领域定人、邻接补位'], ['验收', '开工前锁定清单，独立评审者不等于产出方'], ['确认', '原发起人在原会话用中文确认验收']]));
    const router = routing.router ?? {};
    const domains = Array.isArray(router.domains) ? router.domains : [];
    const orgCard = card('组织形态', '团队怎么分工是配置，不是固定骨架：小团队可以扁平，上百人可按业务域分层',
      kvRows([
        ['当前形态', router.shape ?? '扁平（1 跳）'],
        ['配置版本', router.revision ?? '未读取'],
        ['业务域', domains.length ? domains.map(item => clean(item.label)).join('、') : '未配置中间决策层'],
        ['最多跳数', router.maxHops ?? 1],
        ['入口收敛', routing.routerCoverage?.singleRouterEntry ? '是，留痕都带配置快照' : '改造前的历史留痕不回溯改写'],
        ['形态判定', routing.threeTier?.shape?.ready ? '按当前配置闭环' : '按当前配置逐项判定，未齐项如实列出'],
        ['三层结论', routing.threeTier?.recommended ? '当前分层配置已可正式启用' : '当前形态不需要三层，不硬造管理层'],
      ]));
    const explain = card('怎么派活', '同一份共享现场，不靠摘要转发；没配主管的业务域不会硬造管理层',
      listRows([
        { title: '扁平', meta: '1 跳', detail: '人说出目标，助手直接交给执行者。' },
        { title: '按业务域分层', meta: '最多 2 跳', detail: '人只跟自己的助手说，业务域主管助手负责派活，执行者干活。' },
        { title: '红线', meta: '始终生效', detail: '同一任务不得自派自验自环，高风险动作仍由人签字。' },
      ]));
    const dutyLabels = { personal: '个人助手', supervisor: '业务域主管', worker: '执行',
      acceptance: '验收', 'standard-drafting': '标准起草', inspection: '周期巡检' };
    const agents = Array.isArray(registry.agents) ? registry.agents : [];
    const crewCard = card('Agent 编制', '谁在什么范围担什么职责，由组织配置决定；没配就不硬造管理层',
      agents.length
        ? listRows(agents.slice(0, 6).map(agent => ({
            title: clean(agent.label || '在岗助手'),
            meta: (agent.domains || []).includes('*') ? '全域' : '按业务域',
            detail: (agent.responsibilities || []).map(id => dutyLabels[id] || '专项协作').join('、')
              + ' · 编制版本 ' + String(agent.version || '').slice(0, 8),
          }))) + `<p class="note">${escapeHtml(clean(registry.shape || ''))} · 共 ${registry.onDuty || 0} 个在岗</p>`
        : kvRows([
            ['当前', '未配置在岗 Agent（扁平，不硬造管理层）'],
            ['验收', '仍走本机服务与逐项报告'],
            ['红线', '独立评审者不等于产出方；最终由原发起人确认验收'],
          ]));
    const evo = evolution || {};
    const candidates = Array.isArray(evo.candidates) ? evo.candidates : [];
    const comparison = evo.effectComparison;
    const fmtEffect = value => typeof value === 'number'
      ? (Number.isInteger(value) ? String(value) : value.toFixed(3)) : '—';
    const verdictLabels = { improved: '变好', regressed: '变差', flat: '持平', unknown: '不可比' };
    const effectRows = comparison && Array.isArray(comparison.rows)
      ? comparison.rows.map(row => ({
          title: row.label,
          meta: verdictLabels[row.verdict] || '不可比',
          detail: row.delta === null ? row.note
            : `${fmtEffect(row.before)} → ${fmtEffect(row.after)} · ${row.note}`,
        })) : [];
    const violations = Array.isArray(evo.violations) ? evo.violations : [];
    const evolutionCard = card('沉淀与自演进',
      '打回原因变成下次交付前的自查项；改进要过回放验证与真人批准，随时可回滚',
      kvRows([
        ['交付前自查', evo.selfCheckGateEnabled === false ? '闸门已按配置关闭（仍需人签）'
          : `已强制 · ${evo.standardsCount || 0} 条沉淀标准`],
        ['登记与放行', `${evo.selfCheckRuns || 0} 次自查登记 · ${evo.gatePasses || 0} 次闸门放行`],
        ['候选改进', candidates.length
          ? candidates.slice(0, 4).map(item => `${clean(item.title)}（${clean(item.stateLabel)}）`).join('；')
          : '暂无候选改进'],
        ['当前生效版本', evo.activeVersion ? clean(String(evo.activeVersion)) : '无（未启用任何改进）'],
        ['效果对比', comparison
          ? (comparison.comparable ? '前后窗口可对比，见下方四项' : '观测不齐，缺项逐条标不可比')
          : '尚未登记前后观测窗口，不可比'],
        ['红线', clean(evo.redLines?.[2] || 'Agent 不能自己让改进生效')],
      ]) + (effectRows.length ? listRows(effectRows) : '')
        + (violations.length ? `<p class="note">越权尝试留痕 ${violations.length} 条：${escapeHtml(clean(violations[violations.length - 1]))}</p>` : '')
        + `<p class="note">${escapeHtml(clean(evo.note || '工程闸门只做确定性回放与清单比对。'))}</p>`);
    const exe = execution || {};
    const missing = Array.isArray(exe.missing) ? exe.missing : [];
    const executionCard = card('长程执行',
      '一次调用只做一步；循环、会话状态、执行环境分开，换机器只是换执行工具的地方',
      kvRows([
        ['当前形态', exe.modeLabel || '常驻循环（当前默认，可随时回退）'],
        ['状态外置队列', exe.queue || '未接入状态外置队列'],
        ['单步是否启用', exe.steppedReady ? '已启用，每步由队列领取并留痕' : '未启用，不改变任何现有行为'],
        ['一个任务最多步数', exe.maxStepsPerRun ?? 60],
        ['崩溃回收', `超过 ${exe.staleSeconds ?? 60} 秒未回执即回收，旧凭据立即失效`],
        ['仍缺', missing.length ? missing.slice(0, 3).join('；') : '无'],
        ['红线', clean(exe.redLines?.[3] || '没有外部模型端点时如实拒绝模型步，不编造模型调用')],
      ]) + `<p class="note">${escapeHtml(clean(exe.note || ''))}</p>`);
    return errorCard(view) + errorCard(routing) + errorCard(registry) + errorCard(evolution) + errorCard(execution)
      + `<div class="content-grid">${timeline}${chain}${orgCard}${crewCard}${explain}${evolutionCard}${executionCard}</div>`;
  }

  async function renderKnowledge() {
    const [memory, replay, system] = await Promise.all([safe('memory-status'), safe('memory-replay'), safe('system-status')]);
    const projections = replay.projection ?? replay;
    const stats = card('知识底座', '一级证据图按来源版本物理隔离，二级组织图按节点与边级可见性',
      statRow([[(projections.l1Evidence ?? projections.ownL1 ?? 0), '一级证据'], [(projections.l2Organization ?? projections.ownL2 ?? 0), '组织关系'], [(projections.contextPacks ?? projections.ownPacks ?? 0), '上下文包']]));
    const engine = card('检索与抽取', '确定性工程层先处理，模型只接判不准的少数',
      kvRows([['engine', memory.engine ?? '本机检索'], ['modelCalls', memory.modelCalls ?? 0], ['semanticEmbedding', memory.semanticEmbedding ? '已启用设备端词向量' : '未启用'], ['deterministic', replay.deterministic === false ? '否' : '是']]));
    const knowledge = (system.knowledgeEngine ?? {});
    const native = card('运行状态', '资料撤回会全局阻断派生记忆，单主体撤权只影响该主体',
      kvRows([['installed', knowledge.installed ? '已装载' : '未装载'], ['automaticExtraction', knowledge.automaticExtraction ? '资料入库时确定性抽取' : '未启用'], ['cogneeNative', knowledge.cogneeNative?.configured ? '已配置外部模型' : '未配置外部模型（不外发材料）']]));
    return errorCard(memory) + errorCard(replay) + `<div class="content-grid">${stats}${engine}${native}</div>`;
  }

  async function renderAcceptance() {
    const [view, org] = await Promise.all([safe('view'), safe('v06-org-overview')]);
    const tasks = Array.isArray(view.tasks) ? view.tasks : state.tasks;
    const accepted = tasks.filter(task => task.phase === 'accepted').length;
    const pending = tasks.filter(task => ['review', 'in_progress', 'dispatched'].includes(task.phase)).length;
    const stats = card('验收水位', '验收本身也是可与产品、技术、运营协作的助手',
      statRow([[accepted, '已验收'], [pending, '待确认'], [tasks.length, '任务总数']]));
    const rules = card('验收规则', '清单锁定后不可改写；打回原因沉淀为下次交付前的自查标准',
      kvRows([['清单', '开工前锁定，逐项判定'], ['证据', '捕获、导入、自撰三类分开'], ['评审', '独立评审者不得等于产出模型'], ['签字', '原发起人在原会话中文确认']]));
    const sections = Array.isArray(org.sections) ? org.sections : [];
    const orgCard = card('组织概览', '层是配置不是产品骨架；小团队可扁平，大团队按业务域分层',
      listRows(sections.slice(0, 8).map(section => ({ title: clean(section.title ?? section.name ?? '板块'), meta: clean(section.status ?? ''), detail: clean(section.summary ?? section.description ?? '') }))));
    return errorCard(view) + `<div class="content-grid">${stats}${rules}${orgCard}</div>`;
  }

  async function renderServices() {
    const [status, system] = await Promise.all([safe('service-status'), safe('system-status')]);
    const services = Array.isArray(status.services) ? status.services : [];
    const domestic = services.filter(item => item.category === 'domestic' || item.category === 'local');
    const connected = services.filter(item => item.state === 'connected');
    const stats = card('服务连接', '只列本机与国内服务；海外服务不作为一等入口',
      statRow([[status.connected ?? connected.length, '已连接'], [status.unavailable ?? 0, '未接通'], [domestic.length, '可接入项']]));
    const rows = card('本机服务', '实时探测，未连接项只给文字说明',
      listRows(services.filter(item => item.category === 'local').map(item => ({
        title: clean(item.name), meta: item.state === 'connected' ? '运行中' : '未接通', detail: clean(item.detail ?? item.setup ?? ''),
      }))));
    const domesticRows = card('国内可接入', '接通并实测后才会出现可点入口',
      listRows(services.filter(item => item.category === 'domestic').map(item => ({
        title: clean(item.name), meta: item.state === 'connected' ? '已接通' : '待接入', detail: clean(item.detail ?? item.setup ?? ''),
      }))));
    const runtime = card('运行形态', '默认底座退到数据层，用户看到的这一层由自研界面承载',
      kvRows([['deploymentMode', system.deploymentMode ?? '本机'], ['primary', system.storage?.primary ?? '本机持久化'], ['feishu', system.services?.feishu === 'ready' ? '已连接' : '未连接']]));
    return errorCard(status) + `<div class="content-grid">${stats}${rows}${domesticRows}${runtime}</div>`;
  }

  async function renderSettings() {
    const [system, models] = await Promise.all([safe('system-status'), safe('model-settings')]);
    const integrations = system.integrations ?? {};
    const runtime = card('运行关系', '入口在飞书，协作与上下文在本机，执行工具可替换',
      kvRows([['deploymentMode', system.deploymentMode ?? '本机'], ['primary', system.storage?.primary ?? '本机持久化'], ['records', Object.keys(system.records ?? {}).length + ' 类']]));
    const integrationCard = card('能力状态', '只显示真实状态，未接通的不会伪装成可用',
      kvRows([['modelApi', integrations.modelApi ? '已接入兼容模型服务' : '未配置（不外发材料）'], ['vectorSearch', integrations.vectorSearch ? '已启用设备端词向量' : '未启用'], ['visionReviewer', integrations.visionReviewer ?? '未挂接']]));
    const profiles = Array.isArray(models.settings?.profiles) ? models.settings.profiles : [];
    const modelCard = card('预备策略', '保存后不切换既有任务，也不把资料发往新服务',
      listRows(profiles.slice(0, 6).map(profile => ({ title: clean(profile.name ?? profile.tier ?? '策略'), meta: clean(profile.provider ?? ''), detail: clean(profile.model ?? '未指定型号') }))));
    return errorCard(system) + `<div class="content-grid">${runtime}${integrationCard}${modelCard}</div>`;
  }

  const RENDERERS = {
    overview: renderOverview, collaboration: renderCollaboration, knowledge: renderKnowledge,
    acceptance: renderAcceptance, services: renderServices, settings: renderSettings,
  };

  function paintNav() {
    $('nav-list').innerHTML = VIEWS.map(view =>
      `<button class="nav-item" type="button" data-view="${view.id}" aria-current="${view.id === state.view ? 'page' : 'false'}"><span class="nav-glyph">${view.glyph}</span>${view.title}</button>`).join('');
    $('rail-items').innerHTML = VIEWS.map(view =>
      `<button class="rail-item" type="button" data-view="${view.id}" title="${view.title}" aria-label="${view.title}" aria-current="${view.id === state.view ? 'page' : 'false'}"><span class="nav-glyph">${view.glyph}</span></button>`).join('');
  }
  function paintThreads() {
    const tasks = state.tasks || [];
    $('thread-count').textContent = tasks.length ? String(tasks.length) : '—';
    $('thread-list').innerHTML = tasks.length
      ? tasks.slice(0, 12).map(task => `<button class="thread" type="button" data-thread="${escapeHtml(task.identifier ?? task.id ?? '')}"><span class="thread-id">${escapeHtml(task.identifier ?? '任务')}</span><div class="thread-title">${escapeHtml(task.title ?? '未命名任务')}</div><span class="thread-phase">${escapeHtml(PHASE_LABELS[task.phase] || clean(task.phase || ''))}</span></button>`).join('')
      : '<p class="empty">暂无协作会话</p>';
  }
  function paintFacts() {
    $('fact-list').innerHTML = [
      ['任务', state.facts.tasks ?? '—'], ['已连接服务', state.facts.connected ?? '—'], ['记忆事件', state.facts.events ?? '—'],
    ].map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  }
  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('suitme-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#131418' : '#f6f7f9');
  }

  async function show(viewId) {
    const view = VIEWS.find(item => item.id === viewId) ?? VIEWS[0];
    state.view = view.id;
    $('view-title').textContent = view.title;
    $('view-subtitle').textContent = view.subtitle;
    paintNav();
    $('content').innerHTML = '<div class="loading-card"><div class="spinner"></div><span>正在读取本机协作数据…</span></div>';
    try {
      $('content').innerHTML = await RENDERERS[view.id]();
      paintThreads();
      const [status, viewData, routing] = await Promise.all([safe('service-status'), safe('view'), safe('routing-status')]);
      state.facts = {
        tasks: Array.isArray(viewData.tasks) ? viewData.tasks.length : (state.tasks.length || '—'),
        connected: status.connected ?? '—',
        events: routing.projection?.eventCount ?? routing.eventCount ?? '—',
      };
      paintFacts();
      const ok = !status.__error;
      $('status-dot').dataset.state = ok ? 'ok' : 'warn';
      $('status-text').textContent = ok ? '本机服务已连接' : '本机服务未就绪';
    } catch (error) {
      $('content').innerHTML = card('读取失败', '', `<p class="empty">${escapeHtml(error.message ?? error)}</p>`, 'error-card');
      $('status-dot').dataset.state = 'warn';
      $('status-text').textContent = '读取失败';
    }
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-view]');
    if (target) { void show(target.dataset.view); $('sidebar').classList.remove('open'); return; }
    const themeButton = event.target.closest('#theme-toggle');
    if (themeButton) { setTheme(state.theme === 'light' ? 'dark' : 'light'); return; }
    if (event.target.closest('#sidebar-open')) { $('sidebar').classList.add('open'); return; }
    if (event.target.closest('#sidebar-close')) { $('sidebar').classList.remove('open'); return; }
    const thread = event.target.closest('[data-thread]');
    if (thread) { void show('collaboration'); return; }
  });

  setTheme(state.theme);
  paintNav();
  void show('overview');
})();
