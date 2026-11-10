/* SuitMe 协作台 · 前端（第三十轮 P-12/P-13 重写）
 *
 * 复用开源组件库：Vue 3（MIT）+ Element Plus（MIT），本地 vendor 离线可用。
 * 结构：登录门 → 主布局（侧栏菜单 + 顶栏身份）→ 业务视图（概览/协作/知识/
 * 验收/服务）+ 个人设置中心（每用户自己的配置）+ 管理视图（按 casbin 权限
 * 分区渲染：账号与角色 / 用户配置总览 / 角色策略 / 服务管理 / 知识审核 /
 * 待答问题 / 审计日志 / 飞书授权）。
 *
 * 红线不变：不提供网页发起任务；发起仍在飞书；权限判定最终以后端 casbin 为准，
 * 前端显隐只是体验优化。 */
(() => {
  const { createApp, ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue;

  // ---------------------------------------------------------------- API 层
  // 按动作区分超时：未登记动作走默认 12 秒快速失败；重放 / 体检类只读动作放宽。
  // P-5 红线：view-summary 是分页摘要（毫秒级），不给慢请求开口子。
  // knowledge-wiki / dreaming-run 要逐任务读知识文档并跑体检 / 登记，走 30 秒宽限。
  const READ_TIMEOUT = { 'memory-replay': 20000, 'memory-guard': 20000, 'trace-view': 20000, 'knowledge-list': 20000, 'knowledge-wiki': 30000, 'dreaming-run': 30000, 'cognee-search': 185000 };
  const CACHE_MS = 4000;
  const readCache = new Map();
  const inFlight = new Map();
  // 只读动作才允许短缓存；写动作（admin- / knowledge- 写 / settings- / dreaming-）不缓存。
  // cognee-search 走外部模型，不缓存（每次都是真实调用）。
  const cacheable = action => !action.startsWith('admin-') && !action.startsWith('knowledge-') && !action.startsWith('settings-') && !action.startsWith('dreaming-') && action !== 'cognee-search';

  async function api(action, payload = {}) {
    const key = action + ':' + JSON.stringify(payload);
    if (cacheable(action)) {
      const hit = readCache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
      if (inFlight.has(key)) return inFlight.get(key);
    }
    const task = (async () => {
      const response = await fetch('/api/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }), signal: AbortSignal.timeout(READ_TIMEOUT[action] ?? 12000),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { const e = new Error(data.error || '请先登录'); e.login = true; throw e; }
      if (!response.ok) throw new Error(data.error || '请求失败');
      if (cacheable(action))
        readCache.set(key, { at: Date.now(), value: data });
      return data;
    })().finally(() => inFlight.delete(key));
    if (cacheable(action))
      inFlight.set(key, task);
    return task;
  }
  async function safe(action, payload) {
    try { return await api(action, payload); } catch (error) { return { __error: String(error.message || error) }; }
  }

  const VIEWS = [
    { id: 'decisions', title: '待办', subtitle: '把散落在各处的「等你」收拢到一处',
      icon: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>' },
    { id: 'conversation', title: '对话', subtitle: '人和 Agent 最近的往来，串成一条对话流',
      icon: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>' },
    { id: 'overview', title: '概览', subtitle: '同一份共享现场，人和助手各看自己该看的',
      icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
    { id: 'collaboration', title: '协作', subtitle: '谁接、谁派、谁干，都在一条责任链上',
      icon: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0112 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14a5 5 0 016 6"/>' },
    { id: 'organization', title: '组织', subtitle: '一份共享上下文，按职能配置三层座位',
      icon: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5V11M12 11l-5 4.5M12 11l5 4.5"/>' },
    { id: 'knowledge', title: '知识', subtitle: '资料与证据按归属分区管理：个人 / 协作 / 组织',
      icon: '<path d="M4 5a2 2 0 012-2h12v18H6a2 2 0 01-2-2V5z"/><path d="M8 7h8M8 11h8"/>' },
    { id: 'artifacts', title: '产物', subtitle: '交付与文档的产物引用与修订',
      icon: '<path d="M21 8V6a2 2 0 00-2-2H5a2 2 0 00-2 2v2"/><path d="M3 8v10a2 2 0 002 2h14a2 2 0 002-2V8"/><path d="M10 12h4"/>' },
    { id: 'acceptance', title: '验收', subtitle: '开工前锁定清单，逐项判定后由发起人确认',
      icon: '<path d="M5 12l5 5L19 7"/>' },
    { id: 'services', title: '服务', subtitle: '本机与国内服务的实时状态',
      icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>' },
    { id: 'settings', title: '我的配置', subtitle: '界面、通知与模型偏好，只属于你自己',
      icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>' },
  ];
  const KNOWLEDGE_KINDS = [
    ['decision', '决策'], ['procedure', '流程'], ['experiment', '实验'], ['feedback', '反馈'], ['reference', '参考'],
  ];
  const VISIBILITY = [
    ['personal', '个人区（仅自己可改）'], ['team', '协作区（运营及以上）'], ['org', '组织区（管理员及以上）'],
  ];

  // 用户可见层的统一语言：后端内部标识保持英文，展示出来的都换成中文产品词
  // （第二十四轮 C-2 契约，P-12 重写后继续沿用）。
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

  // Agent 职责槽位的中文叫法（C-4 契约：职责用中文，未知槽位如实标注为专项协作）。
  const DUTY_LABELS = { personal: '个人助手', supervisor: '业务域主管', worker: '执行',
    acceptance: '验收', 'standard-drafting': '标准起草', inspection: '周期巡检' };
  const dutyText = id => DUTY_LABELS[id] || '专项协作';
  const agentLabel = id => ({ 'role-product': '产研', 'role-growth': '增长', 'role-ops': '运营',
    'codex': '执行 · codex', 'claude': '执行 · claude', 'workbuddy': 'WorkBuddy' }[id] || id);

  const fmtTime = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';

  // ---------------------------------------------------------------- 登录视图
  const LoginView = {
    template: `
      <div class="login-wrap">
        <el-card class="login-card">
          <div class="login-brand">
            <div class="logo" style="width:44px;height:44px;border-radius:12px;font-size:20px">S</div>
            <div><div class="login-title">SuitMe 协作台</div><div class="login-sub">登录后按你的权限查看与管理</div></div>
          </div>
          <el-form @submit.prevent="submit">
            <el-form-item><el-input v-model="username" placeholder="用户名" size="large" autocomplete="username" autofocus /></el-form-item>
            <el-form-item><el-input v-model="password" type="password" placeholder="口令" size="large" show-password autocomplete="current-password" @keyup.enter="submit" /></el-form-item>
            <el-button type="primary" size="large" style="width:100%" :loading="busy" @click="submit">登 录</el-button>
          </el-form>
          <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-top:14px" />
          <div class="login-note">发起任务请回到飞书，直接对你的助手说；这里是查看、授权与确认验收的地方。</div>
        </el-card>
      </div>`,
    emits: ['ok'],
    setup(_, { emit }) {
      const username = ref(''), password = ref(''), error = ref(''), busy = ref(false);
      const submit = async () => {
        if (!username.value || !password.value || busy.value) return;
        busy.value = true; error.value = '';
        try {
          const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: { username: username.value, password: password.value } }) });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || '登录失败');
          ElementPlus.ElMessage.success('欢迎，' + data.session.roleLabel + ' ' + data.session.username);
          emit('ok');
        } catch (e) { error.value = String(e.message || e); }
        finally { busy.value = false; }
      };
      return { username, password, error, busy, submit };
    },
  };

  // ---------------------------------------------------------------- 概览 / 协作
  // ---------------------------------------------------------------- 任务详情抽屉（第六十六轮 · 时间线 / 上下文 / 留痕）
  // 三块数据全部来自后端真实 action：task-timeline / context-pack / trace-view。
  const TaskDetailDrawer = {
    props: ['visible', 'taskId', 'task'],
    emits: ['update:visible'],
    template: `
      <el-drawer :model-value="visible" @update:model-value="$emit('update:visible', $event)" :title="title" size="52%">
        <el-tabs v-model="tab" class="drawer-tabs">
          <el-tab-pane label="时间线" name="timeline">
            <div v-if="loading" class="field-hint">正在加载…</div>
            <template v-else>
              <el-card v-if="timeline.delivery" shadow="never" class="drawer-block">
                <template #header>交付 / 产物</template>
                <div class="list-row-detail">
                  <template v-if="timeline.delivery.pr">PR #{{ timeline.delivery.pr }}</template>
                  <template v-if="timeline.delivery.ci"> · CI {{ timeline.delivery.ci === 'passed' ? '通过' : timeline.delivery.ci }}</template>
                  <template v-if="timeline.delivery.merged"> · 已合并</template>
                  <template v-if="timeline.delivery.previewUrl"> · <a :href="timeline.delivery.previewUrl" target="_blank" rel="noopener">预览</a></template>
                </div>
              </el-card>
              <el-card v-if="timeline.documents && timeline.documents.length" shadow="never" class="drawer-block">
                <template #header>任务文档（{{ timeline.documents.length }}）</template>
                <div v-for="d in timeline.documents" :key="d.key" class="list-row-detail">· {{ d.title || d.key }}</div>
              </el-card>
              <div v-if="timeline.knowledgeRefs && timeline.knowledgeRefs.length" class="field-hint drawer-block">关联知识 {{ timeline.knowledgeRefs.length }} 条</div>
              <el-timeline v-if="timeline.entries && timeline.entries.length" style="padding-left:4px">
                <el-timeline-item v-for="(e, i) in timeline.entries" :key="i" :type="tlType(e.kind)" :timestamp="e.at ? fmtTime(e.at) : ''" placement="top">
                  <div class="tl-head"><span class="tl-kind" :class="'tl-' + e.kind">{{ tlKind(e.kind) }}</span><span class="tl-label">{{ e.label }}</span></div>
                  <div class="tl-detail" v-if="e.detail">{{ e.detail }}</div>
                </el-timeline-item>
              </el-timeline>
              <div v-else class="field-hint">这条任务还没有时间线记录</div>
            </template>
          </el-tab-pane>

          <el-tab-pane label="上下文" name="context">
            <div v-if="ctxLoading" class="field-hint">正在加载上下文包…</div>
            <el-alert v-else-if="ctx.__error" :title="'读取失败：' + ctx.__error" type="warning" :closable="false" />
            <template v-else>
              <el-card v-if="ctx.layers && ctx.layers.goal" shadow="never" class="drawer-block">
                <template #header>目标</template>
                <div class="list-row-title">{{ ctx.layers.goal.title || '（无标题）' }}</div>
                <div class="list-row-detail">{{ ctx.layers.goal.goal || '（无描述）' }}</div>
                <div v-if="ctx.layers.goal.requirements && ctx.layers.goal.requirements.length" class="field-hint">需求：{{ ctx.layers.goal.requirements.join('；') }}</div>
              </el-card>
              <el-card v-if="ctx.coverage" shadow="never" class="drawer-block">
                <template #header>覆盖度</template>
                <div class="sys-chips">
                  <span class="sys-chip sys-muted">已含 {{ ctx.coverage.includedChars }} / {{ ctx.coverage.limitBytes }} 字符</span>
                  <span v-if="ctx.coverage.partialSources" class="sys-chip sys-warn">{{ ctx.coverage.partialSources }} 份被截断</span>
                  <span v-if="ctx.coverage.missingCount" class="sys-chip sys-bad">缺 {{ ctx.coverage.missingCount }} 份</span>
                  <span v-if="ctx.fullSources && ctx.fullSources.length" class="sys-chip sys-ok">已展开 {{ ctx.fullSources.length }} 份长资料</span>
                </div>
              </el-card>
              <el-card v-if="ctx.layers && ctx.layers.sources && ctx.layers.sources.length" shadow="never" class="drawer-block">
                <template #header>资料清单（{{ ctx.layers.sources.length }}）</template>
                <div v-for="s in ctx.layers.sources" :key="s.id" class="list-row-detail">· {{ s.title || s.id }}<span class="list-row-meta"> · {{ s.includedChars }} 字{{ s.truncated ? '（截断）' : '' }}</span></div>
              </el-card>
              <el-card v-if="ctx.layers && ctx.layers.checkpoints && ctx.layers.checkpoints.length" shadow="never" class="drawer-block">
                <template #header>检查点（{{ ctx.layers.checkpoints.length }}）</template>
                <div v-for="c in ctx.layers.checkpoints" :key="c.id" class="list-row-detail">· {{ c.title || c.id }}<span class="list-row-meta"> · {{ c.includedChars }} 字</span></div>
              </el-card>
              <el-card v-if="ctx.layers && ctx.layers.missing && ctx.layers.missing.length" shadow="never" class="drawer-block">
                <template #header>缺失资料（{{ ctx.layers.missing.length }}）</template>
                <div v-for="(m, i) in ctx.layers.missing" :key="i" class="list-row-detail">· {{ typeof m === 'string' ? m : (m.title || JSON.stringify(m)) }}</div>
              </el-card>
              <el-card v-if="ctx.availableDeliveries && ctx.availableDeliveries.length" shadow="never" class="drawer-block">
                <template #header>可关联的研发交付（{{ ctx.availableDeliveries.length }}）</template>
                <div v-for="d in ctx.availableDeliveries" :key="d.id" class="list-row">
                  <div class="list-row-head">
                    <span class="list-row-title">{{ d.identifier }} · {{ d.title }}</span>
                    <el-tag v-if="d.linked" size="small" type="success" effect="light">已关联</el-tag>
                  </div>
                </div>
              </el-card>
              <div v-if="!ctx.layers" class="field-hint">这条任务还没有可展示的上下文包。</div>
            </template>
          </el-tab-pane>

          <el-tab-pane label="留痕" name="trace">
            <div v-if="traceLoading" class="field-hint">正在加载留痕…</div>
            <template v-else>
              <el-alert v-if="trace.available === false" title="留痕存储暂不可用，未据此判定验收" type="info" :closable="false" style="margin-bottom:10px" />
              <div v-if="trace.gaps && trace.gaps.length" class="field-hint" style="margin-bottom:10px">缺口：{{ trace.gaps.join('；') }}</div>
              <div v-if="!trace.events || !trace.events.length" class="field-hint">这条任务还没有留痕事件。</div>
              <div v-else class="trace-list">
                <div v-for="(e, i) in trace.events" :key="i" class="trace-item">
                  <span class="tl-kind" :class="'tl-' + traceTone(e.kind)">{{ traceLabel(e.kind) }}</span>
                  <span class="trace-actor">{{ e.actor }}</span>
                  <span class="trace-outcome" v-if="e.outcome">· {{ e.outcome }}</span>
                  <span class="trace-time">{{ e.at ? fmtTime(e.at) : '' }}</span>
                  <span class="ev-media" :class="'ev-' + evidenceTone(e.evidenceKind)">{{ evidenceLabel(e.evidenceKind) }}</span>
                </div>
              </div>
            </template>
          </el-tab-pane>

          <el-tab-pane label="关系图" name="graph">
            <div v-if="graphLoading" class="field-hint">正在加载关系图…</div>
            <el-alert v-else-if="graph.__error" :title="'读取失败：' + graph.__error" type="warning" :closable="false" />
            <template v-else>
              <div class="hint-text">组织关系图（跨来源）：谁负责什么、交付依赖哪些证据、哪些判断影响了哪些任务。</div>
              <el-card v-if="graphNodes.length" shadow="never" class="drawer-block">
                <template #header>节点（{{ graphNodes.length }}）</template>
                <div v-for="n in graphNodes" :key="n.id" class="list-row">
                  <div class="list-row-head"><span class="list-row-title">{{ n.label }}</span><el-tag size="small" effect="plain">{{ n.kind }}</el-tag></div>
                </div>
              </el-card>
              <el-card v-if="graphEdges.length" shadow="never" class="drawer-block">
                <template #header>关系（{{ graphEdges.length }}）</template>
                <div v-for="e in graphEdges" :key="e.id" class="list-row">
                  <div class="list-row-head"><span class="list-row-title">{{ e.from }} → {{ e.to }}</span><el-tag size="small" :type="e.state === 'accepted' ? 'success' : e.state === 'reusable' ? 'primary' : 'info'" effect="light">{{ e.family }}</el-tag></div>
                </div>
              </el-card>
              <div v-if="!graphNodes.length && !graphEdges.length" class="field-hint">这条任务还没有组织关系图。</div>
            </template>
          </el-tab-pane>
          <el-tab-pane label="决策" name="ledger">
            <div v-if="ledgerLoading" class="field-hint">正在加载决策账本…</div>
            <el-alert v-else-if="ledger.__error" :title="'读取失败：' + ledger.__error" type="warning" :closable="false" />
            <template v-else>
              <div class="hint-text">
                这条任务被做过哪些判定、每次凭什么——只收判定，不收流水。
                <template v-if="ledger.summary">共 {{ ledger.summary.total }} 条，其中需人签字 {{ ledger.summary.humanRequired }} 条。</template>
              </div>
              <div v-if="ledger.assignment" class="assign-compare">
                <div class="assign-head">
                  <span class="assign-title">分配对账</span>
                  <el-tag size="small" :type="ledger.assignment.agree ? 'success' : 'warning'" effect="light">
                    {{ ledger.assignment.agree ? '建议与实派一致' : '建议与实派不一致' }}
                  </el-tag>
                </div>
                <div class="assign-row">
                  <span class="assign-label">平台实派</span>
                  <span class="assign-value">{{ ledger.assignment.actual || '（无）' }}</span>
                </div>
                <div class="assign-row">
                  <span class="assign-label">编制建议</span>
                  <span class="assign-value">{{ ledger.assignment.suggested || '（算不出来）' }}</span>
                </div>
                <div class="field-hint" style="margin-top:4px">
                  {{ ledger.assignment.reason }}<template v-if="ledger.assignment.candidates && ledger.assignment.candidates.length">
                  · 合格候选 {{ ledger.assignment.candidates.join('、') }}</template>
                  · 在岗编制 {{ ledger.assignment.registryOnDuty }} 个 · 零模型调用
                </div>
              </div>
              <div v-for="(e, i) in ledgerEntries" :key="e.id + i" class="ledger-item">
                <div class="ledger-head">
                  <el-tag size="small" :type="ledgerTag(e.kind)" effect="light">{{ ledgerKind(e.kind) }}</el-tag>
                  <span class="ledger-verdict">{{ e.verdict }}</span>
                  <span class="ledger-time">{{ e.at ? fmtTime(e.at) : '' }}</span>
                </div>
                <div class="ledger-meta">
                  由 {{ e.actor }}（{{ ledgerActor(e.actorKind) }}）· 依据 {{ e.basis }}
                  <el-tag v-if="e.requiresHuman" size="small" type="warning" effect="plain" style="margin-left:6px">需人签字</el-tag>
                </div>
                <ul class="ledger-reasons" v-if="e.reasons && e.reasons.length">
                  <li v-for="r in e.reasons" :key="r.code">{{ r.text }}</li>
                </ul>
                <div v-else class="field-hint">这条判定没有留下依据——本身就是沉淀缺口。</div>
              </div>
              <div v-if="!ledgerEntries.length" class="field-hint">这条任务还没有判定记录。</div>
            </template>
          </el-tab-pane>
          <el-tab-pane label="协作组" name="group">
            <div v-if="groupLoading" class="field-hint">正在加载协作组…</div>
            <el-alert v-else-if="group.__error" :title="'读取失败：' + group.__error" type="warning" :closable="false" />
            <template v-else>
              <div class="hint-text">
                主持人与服务成员来自当前编制。这里只给「下一轮该怎么协作」的决策——<b>不派单、不改任务</b>，派活仍归平台，授权与验收仍归人。
              </div>
              <el-alert v-if="group.problem" :title="group.problem" type="warning" :closable="false" style="margin-bottom:10px" />
              <el-radio-group v-model="groupIntent" size="small" style="margin-bottom:10px" @change="replan">
                <el-radio-button value="opinions">征询意见</el-radio-button>
                <el-radio-button value="handoff">转交</el-radio-button>
                <el-radio-button value="execute">派执行</el-radio-button>
                <el-radio-button value="answer">单问</el-radio-button>
              </el-radio-group>
              <el-card shadow="never" class="drawer-block">
                <template #header>成员（{{ groupMembers.length }}）</template>
                <div v-for="m in groupMembers" :key="m.key" class="list-row">
                  <div class="list-row-head">
                    <span class="list-row-title">{{ m.name }}</span>
                    <el-tag size="small" :type="m.role === 'supervisor' ? 'primary' : 'info'" effect="plain">{{ m.role === 'supervisor' ? '主持人' : '成员' }}</el-tag>
                  </div>
                  <div class="list-row-detail">{{ (m.offers || []).map(offerText).join(' / ') || '未声明能力' }}<span v-if="!m.enabled"> · 已停用</span></div>
                </div>
              </el-card>
              <el-card shadow="never" class="drawer-block" v-if="groupDecision">
                <template #header>下一轮决策</template>
                <div class="ledger-head">
                  <el-tag size="small" type="success" effect="light">{{ modeText(groupDecision.mode) }}</el-tag>
                  <span class="ledger-verdict">{{ group.decisionText }}</span>
                </div>
                <ul class="ledger-reasons" v-if="groupDecision.reasons && groupDecision.reasons.length">
                  <li v-for="r in groupDecision.reasons" :key="r.code">{{ r.text }}</li>
                </ul>
                <div class="field-hint" style="margin-top:6px">四模式由意图决定，不是"模型觉得"：征询并行且禁工具，转交是单向终态，派执行只挑有出稿能力的人。</div>
              </el-card>
            </template>
          </el-tab-pane>
        </el-tabs>
      </el-drawer>`,
    setup(props) {
      const tab = ref('timeline');
      const timeline = ref({}); const loading = ref(false);
      const ctx = ref({}); const ctxLoading = ref(false);
      const trace = ref({}); const traceLoading = ref(false);
      const graph = ref({}); const graphLoading = ref(false);
      const graphNodes = computed(() => Array.isArray(graph.value.nodes) ? graph.value.nodes : []);
      const graphEdges = computed(() => Array.isArray(graph.value.edges) ? graph.value.edges : []);
      // 第六十八轮 · 决策账本（DSH Decision 模型）：只收判定，不收流水。
      const ledger = ref({}); const ledgerLoading = ref(false);
      const ledgerEntries = computed(() => Array.isArray(ledger.value.entries) ? ledger.value.entries : []);
      // 第六十八轮 · 群组编排（LobeHub GroupOrchestration）：只产决策，不派单。
      const group = ref({}); const groupLoading = ref(false); const groupIntent = ref('opinions');
      const groupMembers = computed(() => Array.isArray(group.value.members) ? group.value.members : []);
      const groupDecision = computed(() => group.value.decision ?? null);
      const loadGroup = async () => {
        groupLoading.value = true;
        group.value = await safe('group-view', { intent: groupIntent.value, maxRounds: 6 });
        groupLoading.value = false;
      };
      const replan = () => loadGroup();
      const offerText = o => ({ feasibility: '评估可行性', draft: '出稿', review: '审阅' }[o] || o);
      const modeText = m => ({ speak: '单人发言', broadcast: '并行征询', delegate: '转交承接', executeTask: '派异步执行', finish: '收敛结束' }[m] || m);
      const title = computed(() => (props.task && (props.task.identifier || props.task.title)) || '任务详情');
      const load = async id => {
        loading.value = true; ctxLoading.value = true; traceLoading.value = true; graphLoading.value = true;
        ledgerLoading.value = true; groupLoading.value = true;
        const [t, c, tr, g, lg, gp] = await Promise.all([
          safe('task-timeline', { taskId: id }),
          safe('context-pack', { taskId: id }),
          safe('trace-view', { taskId: id }),
          safe('ontology-view', { taskId: id }),
          safe('decision-ledger', { taskId: id, limit: 120, withAssignment: true }),
          safe('group-view', { intent: groupIntent.value, maxRounds: 6 }),
        ]);
        timeline.value = t; ctx.value = c; trace.value = tr; graph.value = g;
        ledger.value = lg; group.value = gp;
        loading.value = false; ctxLoading.value = false; traceLoading.value = false;
        graphLoading.value = false; ledgerLoading.value = false; groupLoading.value = false;
      };
      watch(() => [props.visible, props.taskId], async ([v, id]) => {
        if (v && id) { tab.value = 'timeline'; await load(id); }
      }, { immediate: true });
      const tlType = k => ({ human: 'primary', agent: 'success', system: 'info' }[k] || 'info');
      const tlKind = k => ({ human: '人', agent: 'Agent', system: '系统' }[k] || '系统');
      const traceLabel = k => ({ model: '模型', tool: '工具', receipt: '回执', ci: 'CI', checkpoint: '检查点', gate: '闸门', acceptance: '验收' }[k] || k);
      const traceTone = k => ({ model: 'human', tool: 'agent', receipt: 'agent', ci: 'system', checkpoint: 'system', gate: 'system', acceptance: 'human' }[k] || 'system');
      const evidenceLabel = k => ({ captured: '实跑', imported: '导入', authored: '自撰' }[k] || k || '—');
      const evidenceTone = k => ({ captured: 'blue', imported: 'slate', authored: 'amber' }[k] || 'info');
      const ledgerKind = k => ({ route: '派活', access: '授权', knowledge: '知识', delegation: '委托', acceptance: '验收', escalation: '升级', review: '评审' }[k] || k);
      const ledgerTag = k => ({ route: 'primary', access: 'warning', knowledge: 'success', delegation: 'info', acceptance: 'primary', escalation: 'danger', review: 'info' }[k] || 'info');
      const ledgerActor = k => ({ human: '人', agent: 'Agent', system: '系统' }[k] || '系统');
      return { tab, timeline, loading, ctx, ctxLoading, trace, traceLoading, title,
        graph, graphLoading, graphNodes, graphEdges,
        ledger, ledgerLoading, ledgerEntries, ledgerKind, ledgerTag, ledgerActor,
        group, groupLoading, groupIntent, groupMembers, groupDecision, replan, offerText, modeText,
        tlType, tlKind, traceLabel, traceTone, evidenceLabel, evidenceTone, fmtTime };
    },
  };

  const TasksView = {
    props: ['session', 'mode'],
    components: { TaskDetailDrawer },
    template: `
      <div>
        <div class="welcome-bar" v-if="mode !== 'collaboration'">
          <div class="welcome-title">你好，{{ session.username || '同事' }}</div>
          <div class="welcome-sub">发起任务请回飞书、直接对你的助手说；这里是查看进度、授权与确认验收的地方。</div>
        </div>
        <div class="metric-grid">
          <div v-for="card in statCards" :key="card.label" class="metric-card">
            <div class="metric-ico" :class="'tone-' + card.tone">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="card.icon"></svg>
            </div>
            <div class="metric-body">
              <el-skeleton :loading="loading" :rows="1" animated>
                <div class="metric-num">{{ card.value }}</div>
                <div class="metric-label">{{ card.label }}</div>
              </el-skeleton>
            </div>
          </div>
        </div>
        <el-row v-if="mode !== 'collaboration'" :gutter="14" style="margin-bottom:14px">
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>
                <div class="card-head"><span>系统健康</span><el-tag :type="healthTag" size="small" effect="light">{{ healthLabel }}</el-tag></div>
              </template>
              <div class="sys-chips">
                <span class="sys-chip sys-ok">{{ health.connected }} 接通</span>
                <span class="sys-chip sys-warn">{{ health.degraded }} 降级</span>
                <span class="sys-chip sys-bad">{{ health.unavailable }} 未接通</span>
                <span class="sys-chip sys-muted">共 {{ health.total }} 项</span>
              </div>
              <div class="hint-text" style="margin-top:8px">本机协作服务与出站通道的实时健康；点侧栏「服务」看逐项明细与实时探测。</div>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>
                <div class="card-head">
                  <span>执行负载</span>
                  <el-tag v-if="registry.onDuty" size="small" type="primary" effect="plain">{{ registry.onDuty }} 个编制在岗</el-tag>
                  <el-tag v-else size="small" type="info" effect="plain" title="组织编制（谁担什么职责）还没配，但执行端可派单">
                    编制未配置 · {{ (summary.agentRollup?.auto ?? 0) + (summary.agentRollup?.human ?? 0) }} 个执行端可用
                  </el-tag>
                </div>
              </template>
              <el-descriptions :column="2" border size="small">
                <el-descriptions-item label="执行形态">{{ execution.modeLabel || '常驻循环' }}</el-descriptions-item>
                <el-descriptions-item label="单步模式">{{ execution.steppedReady ? '已启用' : '未启用' }}</el-descriptions-item>
                <el-descriptions-item label="状态队列">{{ execution.queue || '未接入' }}</el-descriptions-item>
                <el-descriptions-item label="单任务最多步数">{{ execution.maxStepsPerRun ?? 60 }}</el-descriptions-item>
                <el-descriptions-item label="执行构成">
                  <span class="exec-mix"><b class="exec-auto">{{ summary.agentRollup?.auto ?? 0 }}</b> 自动 ·
                    <b class="exec-human">{{ summary.agentRollup?.human ?? 0 }}</b> 人工</span>
                </el-descriptions-item>
                <el-descriptions-item label="配置缺口">
                  <el-tag v-if="summary.agentRollup?.problems" size="small" type="warning" effect="plain">{{ summary.agentRollup.problems }} 条</el-tag>
                  <span v-else class="hint-text">无</span>
                </el-descriptions-item>
              </el-descriptions>
              <div class="hint-text" style="margin-top:8px">「自动」= 平台起进程自己跑完；「人工」= 派给人在外部接单。编制与执行形态来自组织配置，点侧栏「协作」看完整编制与红线。</div>
            </el-card>
          </el-col>
        </el-row>
        <el-card shadow="never">
          <template #header>{{ mode === 'collaboration' ? '任务与责任链' : '最近任务' }}</template>
          <el-alert v-if="summary.__error" :title="'读取失败：' + summary.__error" type="warning" :closable="false" />
          <el-table v-else :data="tasks" size="default" @row-click="openTask">
            <el-table-column label="任务" min-width="300">
              <template #default="{ row }">
                <div class="task-cell">
                  <div class="task-id">{{ row.identifier || row.id }}</div>
                  <el-link type="primary" class="task-title">{{ row.title || '（无标题）' }}</el-link>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="agent" label="负责" width="150">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ agentLabel(row.agent) }}</el-tag>
                <el-tag v-if="row.agentKind === 'human'" size="small" type="info" effect="plain" style="margin-left:4px"
                  title="人工接单：等人在外部完成，平台不自动推进">人工</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="阶段" width="110">
              <template #default="{ row }"><el-tag :type="phaseTag(row.phase)" effect="light">{{ phaseLabel(row.phase) }}</el-tag></template>
            </el-table-column>
          </el-table>
        </el-card>
        <task-detail-drawer v-model:visible="taskDrawer" :task-id="current && current.id" :task="current" />
      </div>`,
    setup(props) {
      const summary = ref({}); const loading = ref(true); const taskDrawer = ref(false); const current = ref(null);
      const timeline = ref({}); const timelineLoading = ref(false);
      // 第六十四轮：概览加「系统健康 / 执行负载」机器维度。
      const services = ref({}); const registry = ref({}); const execution = ref({});
      const health = computed(() => {
        const list = Array.isArray(services.value.services) ? services.value.services : [];
        const count = state => list.filter(s => s.state === state).length;
        return { connected: count('connected'), degraded: count('degraded'), unavailable: count('unavailable'), total: list.length };
      });
      const healthTag = computed(() => health.value.unavailable ? 'danger' : health.value.degraded ? 'warning' : 'success');
      const healthLabel = computed(() => health.value.unavailable ? '有服务未接通' : health.value.degraded ? '有服务降级' : '全部正常');
      const tasks = computed(() => Array.isArray(summary.value.tasks) ? summary.value.tasks : []);
      const statCards = computed(() => {
        const need = { blocked: 0, review: 0, waiting: 0, ready: 0, running: 0, in_progress: 0, dispatched: 0, intake: 0, todo: 0, delivered: 0, accepted: 0, closed: 0 };
        for (const t of tasks.value) if (t.phase in need) need[t.phase] += 1;
        return [
          { label: '待我拍板', value: need.blocked + need.review + need.waiting + need.ready, tone: 'blue',
            icon: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>' },
          { label: '进行中', value: need.running + need.in_progress + need.dispatched + need.intake + need.todo, tone: 'violet',
            icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
          { label: '待验收', value: need.delivered, tone: 'amber',
            icon: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>' },
          { label: '已完成', value: need.accepted + need.closed, tone: 'green',
            icon: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>' },
        ];
      });
      const phaseLabel = p => ({ running: '进行中', waiting: '等待', delivered: '已交付', failed: '失败', todo: '待办', blocked: '受阻',
        intake: '待接入', dispatched: '已派单', in_progress: '进行中', review: '待评审', ready: '待人处理', accepted: '已验收', closed: '已结束', draft: '草稿' }[p] || p || '—');
      const phaseTag = p => ({ running: 'primary', waiting: 'warning', delivered: 'success', failed: 'danger', blocked: 'danger',
        ready: 'warning', accepted: 'success', review: 'warning', closed: 'info', draft: 'info', dispatched: 'primary', intake: 'info', in_progress: 'primary', todo: 'info' }[p] || 'info');
      const load = async () => {
        loading.value = true;
        const [s, sv, rg, ex] = await Promise.all([safe('view-summary'), safe('service-status'), safe('v06-agent-registry-view'), safe('v06-execution-view')]);
        summary.value = s; services.value = sv; registry.value = rg; execution.value = ex; loading.value = false;
      };
      const openTask = row => { current.value = row; taskDrawer.value = true; };
      const tlType = k => ({ human: 'primary', agent: 'success', system: 'info' }[k] || 'info');
      const tlKind = k => ({ human: '人', agent: 'Agent', system: '系统' }[k] || '系统');
      onMounted(load);
      return { summary, loading, tasks, statCards, phaseLabel, phaseTag, load, openTask, taskDrawer, current, fmtTime, agentLabel, timeline, timelineLoading, tlType, tlKind,
        services, registry, execution, health, healthTag, healthLabel };
    },
  };

  // ---------------------------------------------------------------- 待你决定（第六十六轮 · 聚合散落的「等你」）
  // 对标 paperclip 的 Needs You：把待回答 / 待拍板 / 待评审 / 待验收收拢成一个入口。
  const DecisionCenterView = {
    props: ['session'],
    components: { TaskDetailDrawer },
    template: `
      <div>
        <div class="welcome-bar">
          <div class="welcome-title">待你决定</div>
          <div class="welcome-sub">把散落在各处的「等你」收拢到一处：待回答、待拍板、待评审、待验收。</div>
        </div>
        <div class="metric-grid">
          <div v-for="c in cards" :key="c.label" class="metric-card">
            <div class="metric-ico" :class="'tone-' + c.tone">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="c.icon"></svg>
            </div>
            <div class="metric-body"><div class="metric-num">{{ c.value }}</div><div class="metric-label">{{ c.label }}</div></div>
          </div>
        </div>
        <el-card v-if="hitl.pending && hitl.pending.length" shadow="never" style="margin-bottom:14px">
          <template #header>
            <div class="card-head"><span>等你回答（{{ hitl.pending.length }}）</span><el-button size="small" @click="load" :loading="loading">刷新</el-button></div>
          </template>
          <div v-for="q in hitl.pending" :key="q.id" class="hitl-item">
            <div class="hitl-q"><span class="tl-kind tl-human">待回答</span><span class="hitl-prompt">{{ q.prompt }}</span></div>
            <div class="hitl-meta">{{ fmtTime(q.at) }} · 问题号 {{ (q.id || '').slice(0, 12) }}<template v-if="q.asker"> · 由 {{ q.asker }} 提问</template></div>
            <div class="hitl-actions">
              <el-radio-group v-model="astate(q).choice">
                <el-radio-button v-for="c in (q.choices || [])" :key="c" :value="c">{{ c }}</el-radio-button>
              </el-radio-group>
              <el-input v-model="astate(q).note" placeholder="补充说明（可选）" size="small" style="max-width:200px" />
              <el-button type="primary" size="small" :loading="astate(q).busy" :disabled="!astate(q).choice" @click="answer(q)">提交回答</el-button>
            </div>
          </div>
        </el-card>
        <el-card v-for="group in groups" :key="group.key" v-show="group.tasks.length" shadow="never" style="margin-bottom:14px">
          <template #header>{{ group.label }}（{{ group.tasks.length }}）</template>
          <el-table :data="group.tasks" size="default" @row-click="openTask">
            <el-table-column label="任务" min-width="280">
              <template #default="{ row }"><div class="task-cell"><div class="task-id">{{ row.identifier }}</div><el-link type="primary" class="task-title">{{ row.title }}</el-link></div></template>
            </el-table-column>
            <el-table-column label="阶段" width="110"><template #default="{ row }"><el-tag :type="phaseTag(row.phase)" size="small" effect="light">{{ phaseLabel(row.phase) }}</el-tag></template></el-table-column>
            <el-table-column label="负责" width="150"><template #default="{ row }">
              <el-tag size="small" effect="plain">{{ agentLabel(row.agent) }}</el-tag>
              <el-tag v-if="row.agentKind === 'human'" size="small" type="info" effect="plain" style="margin-left:4px"
                title="人工接单：等人在外部完成，平台不自动推进">人工</el-tag>
            </template></el-table-column>
          </el-table>
        </el-card>
        <el-empty v-if="nothing" description="当前没有等你处理的事，一切都在自动推进中" />
        <task-detail-drawer v-model:visible="drawer" :task-id="current && current.id" :task="current" />
      </div>`,
    setup() {
      const summary = ref({}); const hitl = ref({}); const loading = ref(true);
      const drawer = ref(false); const current = ref(null);
      const answerState = reactive({});
      const tasks = computed(() => Array.isArray(summary.value.tasks) ? summary.value.tasks : []);
      const blocked = computed(() => tasks.value.filter(t => ['blocked', 'waiting', 'ready'].includes(t.phase)));
      const review = computed(() => tasks.value.filter(t => t.phase === 'review'));
      const delivered = computed(() => tasks.value.filter(t => t.phase === 'delivered'));
      const groups = computed(() => [
        { key: 'blocked', label: '等你拍板', tasks: blocked.value },
        { key: 'review', label: '等你评审', tasks: review.value },
        { key: 'delivered', label: '等你验收', tasks: delivered.value },
      ]);
      const cards = computed(() => [
        { label: '等你回答', value: (hitl.value.pending || []).length, tone: 'blue', icon: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>' },
        { label: '等你拍板', value: blocked.value.length, tone: 'violet', icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>' },
        { label: '等你评审', value: review.value.length, tone: 'amber', icon: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>' },
        { label: '等你验收', value: delivered.value.length, tone: 'green', icon: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>' },
      ]);
      const nothing = computed(() => !(hitl.value.pending || []).length && !blocked.value.length && !review.value.length && !delivered.value.length);
      const load = async () => {
        loading.value = true;
        const [s, h] = await Promise.all([safe('view-summary', { limit: 50 }), safe('admin-hitl')]);
        summary.value = s; hitl.value = h; loading.value = false;
      };
      const openTask = row => { current.value = row; drawer.value = true; };
      const astate = q => { if (!answerState[q.id]) answerState[q.id] = { choice: '', note: '', busy: false }; return answerState[q.id]; };
      const answer = async q => {
        const st = astate(q);
        if (!st.choice || st.busy) return;
        st.busy = true;
        try {
          await api('admin-hitl-answer', { questionId: q.id, choice: st.choice, note: st.note });
          ElementPlus.ElMessage.success('已回答');
          await load();
        } catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
        finally { st.busy = false; }
      };
      const phaseLabel = p => ({ running: '进行中', waiting: '等待', delivered: '已交付', failed: '失败', todo: '待办', blocked: '受阻',
        intake: '待接入', dispatched: '已派单', in_progress: '进行中', review: '待评审', ready: '待人处理', accepted: '已验收', closed: '已结束', draft: '草稿' }[p] || p || '—');
      const phaseTag = p => ({ running: 'primary', waiting: 'warning', delivered: 'success', failed: 'danger', blocked: 'danger',
        ready: 'warning', accepted: 'success', review: 'warning', closed: 'info', draft: 'info', dispatched: 'primary', intake: 'info', in_progress: 'primary', todo: 'info' }[p] || 'info');
      const agentLabel = id => ({ 'role-product': '产研', 'role-growth': '增长', 'role-ops': '运营',
        'codex': '执行 · codex', 'claude': '执行 · claude', 'workbuddy': 'WorkBuddy' }[id] || id);
      onMounted(load);
      return { summary, hitl, loading, drawer, current, tasks, blocked, review, delivered, groups, cards, nothing,
        load, openTask, astate, answer, phaseLabel, phaseTag, agentLabel, fmtTime };
    },
  };

  // ---------------------------------------------------------------- 产物库（第六十六轮 · v06-artifact-list）
  const ArtifactView = {
    props: ['session'],
    template: `
      <div>
        <el-card shadow="never">
          <template #header>
            <div class="card-head"><span>产物库（{{ total }}）</span><el-button size="small" @click="load" :loading="loading">刷新</el-button></div>
          </template>
          <div class="hint-text">产物只存引用与修订号，内容仍在原来的文档 / 报告 / 表里。</div>
          <el-alert v-if="data.__error" :title="'读取失败：' + data.__error" type="warning" :closable="false" />
          <el-table v-else :data="artifacts" size="default">
            <el-table-column prop="ref" label="产物引用" min-width="220" show-overflow-tooltip />
            <el-table-column prop="title" label="标题" min-width="200" />
            <el-table-column label="当前修订" width="130"><template #default="{ row }"><span class="mono">{{ (row.current || '').slice(0, 12) }}</span></template></el-table-column>
            <el-table-column prop="revisions" label="修订数" width="90" />
            <el-table-column label="更新时间" width="170"><template #default="{ row }">{{ fmtTime(row.updatedAt) }}</template></el-table-column>
          </el-table>
          <div v-if="!loading && !artifacts.length && !data.__error" class="field-hint">还没有登记产物。</div>
        </el-card>
      </div>`,
    setup() {
      const data = ref({}); const loading = ref(true);
      const artifacts = computed(() => Array.isArray(data.value.artifacts) ? data.value.artifacts : []);
      const total = computed(() => data.value.total ?? 0);
      const load = async () => { loading.value = true; data.value = await safe('v06-artifact-list'); loading.value = false; };
      onMounted(load);
      return { data, artifacts, total, loading, load, fmtTime };
    },
  };

  // ---------------------------------------------------------------- 对话视图（第六十三轮 · 通用 Agent 对话入口）
  const ConversationView = {
    props: ['session'],
    template: `
      <div>
        <div class="welcome-bar">
          <div class="welcome-title">协作现场</div>
          <div class="welcome-sub">左侧选任务，右侧看它的人 / Agent 往来；发起新任务仍请回飞书、直接对你的助手说。</div>
          <div class="my-agent" v-if="myAgent">
            <div class="feed-avatar fa-human" style="width:26px;height:26px;font-size:12px">我</div>
            <span class="my-agent-label">我的助手</span>
            <el-tag size="small" effect="light" type="primary">{{ myAgent.label }}</el-tag>
            <el-tag v-if="myAgent.execution" size="small" effect="plain"
              :type="myAgent.execution.kind === 'auto' ? 'success' : 'info'"
              :title="myAgent.execution.reason">
              {{ myAgent.execution.kind === 'auto' ? (myAgent.execution.readOnly ? '自动执行 · 只读' : '自动执行') : '人工接单' }}
            </el-tag>
          </div>
          <div class="my-agent" v-else>
            <span class="my-agent-label">未绑定个人 Agent · 请管理员在「组织」里为你开通</span>
          </div>
        </div>
        <el-card v-if="hitl.pending && hitl.pending.length" shadow="never" style="margin-bottom:14px">
          <template #header>
            <div class="card-head"><span>待答问题 · Agent 在等你</span><el-button size="small" @click="loadHitl" :loading="hitlLoading">刷新</el-button></div>
          </template>
          <div v-for="q in hitl.pending" :key="q.id" class="hitl-item">
            <div class="hitl-q"><span class="tl-kind tl-human">待回答</span><span class="hitl-prompt">{{ q.prompt }}</span></div>
            <div class="hitl-meta">{{ fmtTime(q.at) }} · 问题号 {{ (q.id || '').slice(0, 12) }}<template v-if="q.asker"> · 由 {{ q.asker }} 提问</template></div>
            <div class="hitl-actions">
              <el-radio-group v-model="astate(q).choice">
                <el-radio-button v-for="c in (q.choices || [])" :key="c" :value="c">{{ c }}</el-radio-button>
              </el-radio-group>
              <el-button type="primary" size="small" :loading="astate(q).busy" :disabled="!astate(q).choice" @click="answer(q)">回答</el-button>
            </div>
            <div class="field-hint">回答不等于验收，最终核可仍在原会话。</div>
          </div>
        </el-card>
        <el-card shadow="never">
          <template #header>
            <div class="card-head"><span>按任务看协作往来</span><el-button size="small" @click="loadSummary" :loading="loading">刷新</el-button></div>
          </template>
          <el-row :gutter="14">
            <el-col :xs="24" :md="7">
              <el-input v-model="query" placeholder="搜索任务号 / 标题" aria-label="搜索任务" size="small" clearable style="margin-bottom:8px" />
              <div class="conv-list">
                <div v-for="t in filteredTasks" :key="t.id" class="conv-item" :class="{ active: t.id === activeId }" tabindex="0" @click="open(t)" @keyup.enter="open(t)">
                  <div class="task-id">{{ t.identifier || t.id }}</div>
                  <div class="conv-title">{{ t.title || '（无标题）' }}</div>
                  <el-tag :type="phaseTag(t.phase)" size="small" effect="light">{{ phaseLabel(t.phase) }}</el-tag>
                </div>
                <div v-if="!filteredTasks.length" class="field-hint">没有匹配的任务</div>
              </div>
            </el-col>
            <el-col :xs="24" :md="17">
              <div v-if="!activeId" class="field-hint" style="padding:20px 0">从左侧选一个任务，看它的人 / Agent 往来。</div>
              <div v-else-if="timelineLoading" class="field-hint">正在加载这条任务的对话…</div>
              <div v-else class="feed">
                <div v-for="(e, i) in entries" :key="i" class="feed-item" :class="'feed-' + e.kind">
                  <template v-if="e.kind === 'system'">
                    <span class="feed-system">{{ e.label }}<template v-if="e.detail"> · {{ e.detail }}</template></span>
                  </template>
                  <template v-else>
                    <div class="feed-avatar" :class="'fa-' + e.kind">{{ e.kind === 'human' ? '我' : 'A' }}</div>
                    <div class="feed-bubble">
                      <div class="feed-meta">
                        <span class="tl-kind" :class="'tl-' + e.kind">{{ kindLabel(e.kind) }}</span>
                        <span class="feed-label">{{ e.label }}</span>
                        <span class="feed-time">{{ e.at ? fmtTime(e.at) : '' }}</span>
                      </div>
                      <div class="feed-detail" v-if="e.detail">{{ e.detail }}</div>
                    </div>
                  </template>
                </div>
                <div v-if="!entries.length" class="field-hint">这条任务还没有对话记录</div>
              </div>
            </el-col>
          </el-row>
        </el-card>
      </div>`,
    setup() {
      const summary = ref({}); const loading = ref(true);
      const hitl = ref({}); const hitlLoading = ref(false);
      const answerState = reactive({});
      const activeId = ref(''); const timeline = ref({}); const timelineLoading = ref(false);
      const query = ref('');
      const tasks = computed(() => Array.isArray(summary.value.tasks) ? summary.value.tasks : []);
      const myAgent = computed(() => summary.value.myAgent ?? null);
      const filteredTasks = computed(() => {
        const q = query.value.trim().toLowerCase();
        if (!q) return tasks.value;
        return tasks.value.filter(t => ((t.identifier ?? '') + ' ' + (t.title ?? '')).toLowerCase().includes(q));
      });
      const entries = computed(() => Array.isArray(timeline.value.entries) ? timeline.value.entries : []);
      const openTimeline = async t => {
        timelineLoading.value = true; timeline.value = {};
        timeline.value = await safe('task-timeline', { taskId: t.id || t.identifier });
        timelineLoading.value = false;
      };
      const open = t => { activeId.value = t.id; openTimeline(t); };
      const loadSummary = async () => {
        loading.value = true;
        summary.value = await safe('view-summary', { limit: 50 });
        if (!activeId.value && tasks.value.length) { activeId.value = tasks.value[0].id; await openTimeline(tasks.value[0]); }
        loading.value = false;
      };
      const loadHitl = async () => { hitlLoading.value = true; hitl.value = await safe('admin-hitl'); hitlLoading.value = false; };
      const astate = q => { if (!answerState[q.id]) answerState[q.id] = { choice: '', busy: false }; return answerState[q.id]; };
      const answer = async q => {
        const st = astate(q);
        if (!st.choice || st.busy) return;
        st.busy = true;
        try {
          await api('admin-hitl-answer', { questionId: q.id, choice: st.choice });
          ElementPlus.ElMessage.success('已回答');
          await loadHitl();
        } catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
        finally { st.busy = false; }
      };
      const kindLabel = k => ({ human: '人', agent: 'Agent', system: '系统' }[k] || '系统');
      const phaseLabel = p => ({ running: '进行中', waiting: '等待', delivered: '已交付', failed: '失败', todo: '待办', blocked: '受阻',
        intake: '待接入', dispatched: '已派单', in_progress: '进行中', review: '待评审', ready: '待人处理', accepted: '已验收', closed: '已结束', draft: '草稿' }[p] || p || '—');
      const phaseTag = p => ({ running: 'primary', waiting: 'warning', delivered: 'success', failed: 'danger', blocked: 'danger',
        ready: 'warning', accepted: 'success', review: 'warning', closed: 'info', draft: 'info', dispatched: 'primary', intake: 'info', in_progress: 'primary', todo: 'info' }[p] || 'info');
      onMounted(async () => { await loadSummary(); await loadHitl(); });
      return { summary, tasks, filteredTasks, loading, loadSummary, hitl, hitlLoading, loadHitl, astate, answer,
        activeId, timeline, timelineLoading, entries, open, query, kindLabel, phaseLabel, phaseTag, fmtTime, myAgent };
    },
  };

  // ---------------------------------------------------------------- 协作视图（C-3 / C-4 / P-6 卡片）
  const CollaborationView = {
    props: ['session'],
    components: { TaskDetailDrawer },
    template: `
      <div>
        <el-tabs v-model="activeTab" class="collab-tabs">
          <el-tab-pane label="协作现场" name="现场" />
          <el-tab-pane label="任务跟进" name="任务" />
        </el-tabs>
        <div v-show="activeTab === '现场'">
        <el-card shadow="never" style="margin-bottom:14px">
          <template #header>
            <div class="card-head">
              <span>待答问题 · Agent 在等你</span>
              <el-button size="small" @click="loadHitl" :loading="hitlLoading">刷新</el-button>
            </div>
          </template>
          <el-alert v-if="hitl.__error" :title="'读取失败：' + hitl.__error" type="warning" :closable="false" />
          <template v-else>
            <div v-if="!hitl.pending || !hitl.pending.length" class="field-hint">当前没有待你回答的问题。Agent 卡在人工确认步骤时，问题会出现在这里，你选一个选项回答即可。</div>
            <div v-for="q in hitl.pending" :key="q.id" class="hitl-item">
              <div class="hitl-q">
                <span class="tl-kind tl-human">待回答</span>
                <span class="hitl-prompt">{{ q.prompt }}</span>
              </div>
              <div class="hitl-meta">{{ fmtTime(q.at) }} · 问题号 {{ (q.id || '').slice(0, 12) }}<template v-if="q.asker"> · 由 {{ q.asker }} 提问</template></div>
              <div class="hitl-actions">
                <el-radio-group v-model="astate(q).choice">
                  <el-radio-button v-for="c in (q.choices || [])" :key="c" :value="c">{{ c }}</el-radio-button>
                </el-radio-group>
                <el-input v-model="astate(q).note" placeholder="补充说明（可选）" size="small" style="max-width:220px" />
                <el-button type="primary" size="small" :loading="astate(q).busy" :disabled="!astate(q).choice" @click="answer(q)">提交回答</el-button>
              </div>
              <div class="field-hint">回答只是把答案送回提问方并留痕，不等于验收；最终核可仍在原会话完成。</div>
            </div>
          </template>
        </el-card>

        <el-row :gutter="14">
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>责任链</template>
              <div class="hint-text">承接人负执行责任，目标职能负责人兜底；高风险动作需要人联签</div>
              <el-descriptions :column="1" border size="small">
                <el-descriptions-item label="承接">按主职能定组、领域定人、邻接补位</el-descriptions-item>
                <el-descriptions-item label="验收">开工前锁定清单，独立评审者不等于产出方</el-descriptions-item>
                <el-descriptions-item label="确认">原发起人在原会话用中文确认验收</el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>组织形态</template>
              <div class="hint-text">团队怎么分工是配置，不是固定骨架：小团队可以扁平，上百人可按业务域分层</div>
              <el-alert v-if="routing.__error" :title="'读取失败：' + routing.__error" type="warning" :closable="false" />
              <el-descriptions v-else :column="1" border size="small">
                <el-descriptions-item label="当前形态">{{ router.shape || '扁平（1 跳）' }}</el-descriptions-item>
                <el-descriptions-item label="配置版本">{{ router.revision || '未读取' }}</el-descriptions-item>
                <el-descriptions-item label="业务域">{{ domainText }}</el-descriptions-item>
                <el-descriptions-item label="最多跳数">{{ router.maxHops ?? 1 }}</el-descriptions-item>
                <el-descriptions-item label="入口收敛">{{ coverage.singleRouterEntry ? '是，留痕都带配置快照' : '改造前的历史留痕不回溯改写' }}</el-descriptions-item>
                <el-descriptions-item label="形态判定">{{ shapeReady ? '按当前配置闭环' : '按当前配置逐项判定，未齐项如实列出' }}</el-descriptions-item>
                <el-descriptions-item label="三层结论">{{ threeTier.recommended ? '当前分层配置已可正式启用' : '当前形态不需要三层，不硬造管理层' }}</el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>Agent 编制</template>
              <div class="hint-text">谁在什么范围担什么职责，由组织配置决定；没配就不硬造管理层</div>
              <el-alert v-if="registry.__error" :title="'读取失败：' + registry.__error" type="warning" :closable="false" />
              <template v-else-if="agents.length">
                <div v-for="agent in agents.slice(0, 6)" :key="agent.key" class="list-row">
                  <div class="list-row-head">
                    <span class="list-row-title">{{ clean(agent.label || '在岗助手') }}</span>
                    <span class="list-row-meta">{{ (agent.domains || []).includes('*') ? '全域' : '按业务域' }}</span>
                  </div>
                  <div class="list-row-detail">{{ (agent.responsibilities || []).map(dutyText).join('、') }} · 共 {{ registry.onDuty || 0 }} 个在岗</div>
                </div>
              </template>
              <el-descriptions v-else :column="1" border size="small">
                <el-descriptions-item label="当前">未配置在岗 Agent（扁平，不硬造管理层）</el-descriptions-item>
                <el-descriptions-item label="验收">仍走本机服务与逐项报告</el-descriptions-item>
                <el-descriptions-item label="红线">独立评审者不等于产出方；最终由原发起人确认验收</el-descriptions-item>
              </el-descriptions>
              <div v-if="execRollup" class="exec-block">
                <div class="exec-block-head">
                  <span class="exec-block-title">执行端</span>
                  <span class="exec-mix">
                    <b class="exec-auto">{{ execRollup.auto }}</b> 自动 ·
                    <b class="exec-human">{{ execRollup.human }}</b> 人工 ·
                    <span class="exec-off">{{ execRollup.disabled }} 停用</span>
                  </span>
                </div>
                <div class="hint-text" style="margin-bottom:8px">编制回答「谁有资格接」，执行端回答「跑不跑得起来」——两套 key 空间，不互相覆写。</div>
                <div v-for="e in liveExecs" :key="e.key" class="list-row">
                  <div class="list-row-head">
                    <span class="list-row-title">{{ e.name }}</span>
                    <el-tag size="small" :type="e.kind === 'auto' ? 'success' : 'info'" effect="plain"
                      :title="e.reason">{{ e.kind === 'auto' ? (e.readOnly ? '自动·只读' : '自动') : '人工' }}</el-tag>
                  </div>
                  <div class="list-row-detail">{{ e.reason }}</div>
                </div>
                <div v-if="problemExecs.length" class="exec-problem">
                  <span class="exec-problem-title">配置缺口</span>
                  <div v-for="p in problemExecs" :key="p.key" class="list-row-detail">{{ p.key }} · {{ p.problem }}</div>
                </div>
              </div>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>怎么派活</template>
              <div class="hint-text">同一份共享现场，不靠摘要转发；没配主管的业务域不会硬造管理层</div>
              <div class="list-row">
                <div class="list-row-head"><span class="list-row-title">扁平</span><span class="list-row-meta">1 跳</span></div>
                <div class="list-row-detail">人说出目标，助手直接交给执行者。</div>
              </div>
              <div class="list-row">
                <div class="list-row-head"><span class="list-row-title">按业务域分层</span><span class="list-row-meta">最多 2 跳</span></div>
                <div class="list-row-detail">人只跟自己的助手说，业务域主管助手负责派活，执行者干活。</div>
              </div>
              <div class="list-row">
                <div class="list-row-head"><span class="list-row-title">红线</span><span class="list-row-meta">始终生效</span></div>
                <div class="list-row-detail">同一任务不得自派自验自环，高风险动作仍由人签字。</div>
              </div>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>沉淀与自演进</template>
              <div class="hint-text">打回原因变成下次交付前的自查项；改进要过回放验证与真人批准，随时可回滚</div>
              <el-alert v-if="evolution.__error" :title="'读取失败：' + evolution.__error" type="warning" :closable="false" />
              <template v-else>
                <el-descriptions :column="1" border size="small">
                  <el-descriptions-item label="交付前自查">{{ evolution.selfCheckGateEnabled === false ? '闸门已按配置关闭（仍需人签）' : ('已强制 · ' + (evolution.standardsCount || 0) + ' 条沉淀标准') }}</el-descriptions-item>
                  <el-descriptions-item label="登记与放行">{{ evolution.selfCheckRuns || 0 }} 次自查登记 · {{ evolution.gatePasses || 0 }} 次闸门放行 }}</el-descriptions-item>
                  <el-descriptions-item label="候选改进">{{ candidates.length ? candidates.slice(0, 4).map(i => clean(i.title) + '（' + clean(i.stateLabel) + '）').join('；') : '暂无候选改进' }}</el-descriptions-item>
                  <el-descriptions-item label="当前生效版本">{{ evolution.activeVersion ? clean(String(evolution.activeVersion)) : '无（未启用任何改进）' }}</el-descriptions-item>
                  <el-descriptions-item label="效果对比">{{ comparison ? (comparison.comparable ? '前后窗口可对比' : '观测不齐，缺项逐条标不可比') : '尚未登记前后观测窗口，不可比' }}</el-descriptions-item>
                  <el-descriptions-item label="红线">{{ clean((evolution.redLines || [])[2] || 'Agent 不能自己让改进生效') }}</el-descriptions-item>
                </el-descriptions>
                <div v-if="evolution.standards && evolution.standards.length" class="kb-standards">
                  <div class="field-hint" style="margin:12px 0 4px">沉淀的自查标准（打回原因 → 下次必查）：</div>
                  <div v-for="(s, i) in evolution.standards" :key="i" class="list-row">
                    <div class="list-row-title">{{ i + 1 }}. {{ s }}</div>
                  </div>
                </div>
              </template>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>长程执行</template>
              <div class="hint-text">一次调用只做一步；循环、会话状态、执行环境分开，换机器只是换执行工具的地方</div>
              <el-alert v-if="execution.__error" :title="'读取失败：' + execution.__error" type="warning" :closable="false" />
              <el-descriptions v-else :column="1" border size="small">
                <el-descriptions-item label="当前形态">{{ execution.modeLabel || '常驻循环（当前默认，可随时回退）' }}</el-descriptions-item>
                <el-descriptions-item label="状态外置队列">{{ execution.queue || '未接入状态外置队列' }}</el-descriptions-item>
                <el-descriptions-item label="单步是否启用">{{ execution.steppedReady ? '已启用，每步由队列领取并留痕' : '未启用，不改变任何现有行为' }}</el-descriptions-item>
                <el-descriptions-item label="一个任务最多步数">{{ execution.maxStepsPerRun ?? 60 }}</el-descriptions-item>
                <el-descriptions-item label="崩溃回收">超过 {{ execution.staleSeconds ?? 60 }} 秒未回执即回收，旧凭据立即失效</el-descriptions-item>
                <el-descriptions-item label="仍缺">{{ missingText }}</el-descriptions-item>
                <el-descriptions-item label="红线">{{ clean((execution.redLines || [])[3] || '没有外部模型端点时如实拒绝模型步，不编造模型调用') }}</el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
        </el-row>
        </div>

        <div v-show="activeTab === '任务'">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span>任务跟进</span>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <el-input v-model="taskQuery" placeholder="搜索任务号 / 标题" size="small" clearable style="max-width:200px" />
                <el-select v-model="taskFilter" size="small" style="width:130px" clearable placeholder="全部阶段">
                  <el-option v-for="(l, p) in phaseOptions" :key="p" :value="p" :label="l" />
                </el-select>
              </div>
            </div>
          </template>
          <el-alert v-if="summary.__error" :title="'读取失败：' + summary.__error" type="warning" :closable="false" />
          <el-table v-else :data="filteredTasks" size="default" @row-click="openTask">
            <el-table-column label="任务" min-width="300">
              <template #default="{ row }">
                <div class="task-cell">
                  <div class="task-id">{{ row.identifier || row.id }}</div>
                  <el-link type="primary" class="task-title">{{ row.title || '（无标题）' }}</el-link>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="agent" label="负责" width="150">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ agentLabel(row.agent) }}</el-tag>
                <el-tag v-if="row.agentKind === 'human'" size="small" type="info" effect="plain" style="margin-left:4px"
                  title="人工接单：等人在外部完成，平台不自动推进">人工</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="阶段" width="110">
              <template #default="{ row }"><el-tag :type="phaseTag(row.phase)" effect="light">{{ phaseLabel(row.phase) }}</el-tag></template>
            </el-table-column>
            <el-table-column v-if="canControlTask" label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button v-if="resumable(row)" size="small" type="primary" plain @click.stop="controlTask(row, '接续')">接续</el-button>
                <el-button v-else-if="pausable(row)" size="small" type="warning" plain @click.stop="controlTask(row, '暂停')">暂停</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
        </div>

        <task-detail-drawer v-model:visible="taskDrawer" :task-id="current && current.id" :task="current" />
      </div>`,
    setup(props) {
      const summary = ref({}), routing = ref({}), registry = ref({}), evolution = ref({}), execution = ref({});
      const taskDrawer = ref(false); const current = ref(null);
      const timeline = ref({}); const timelineLoading = ref(false);
      // 第六十轮：待答问题操作区（真人回答 Agent 提出的人工问题）+ 任务接续/暂停。
      const hitl = ref({}); const hitlLoading = ref(false);
      const answerState = reactive({});
      const canControlTask = computed(() => (props.session?.permissions ?? []).includes('task-control'));
      const tasks = computed(() => Array.isArray(summary.value.tasks) ? summary.value.tasks : []);
      // 第六十轮：协作视图分「协作现场 / 任务跟进」两个标签（对标 paperclip Coordinator 的 Chat + Tasks）。
      const activeTab = ref('现场');
      const taskQuery = ref(''); const taskFilter = ref('');
      const phaseOptions = { running: '进行中', waiting: '等待', delivered: '已交付', failed: '失败', todo: '待办', blocked: '受阻',
        intake: '待接入', dispatched: '已派单', in_progress: '进行中', review: '待评审', ready: '待人处理', accepted: '已验收', closed: '已结束', draft: '草稿' };
      const filteredTasks = computed(() => {
        const q = taskQuery.value.trim().toLowerCase();
        return tasks.value.filter(t => {
          if (taskFilter.value && t.phase !== taskFilter.value) return false;
          if (q && !((t.identifier ?? '') + ' ' + (t.title ?? '') + ' ' + (t.id ?? '')).toLowerCase().includes(q)) return false;
          return true;
        });
      });
      const router = computed(() => routing.value.router ?? {});
      const coverage = computed(() => routing.value.routerCoverage ?? {});
      const threeTier = computed(() => routing.value.threeTier ?? {});
      const shapeReady = computed(() => threeTier.value.shape?.ready === true);
      const agents = computed(() => Array.isArray(registry.value.agents) ? registry.value.agents : []);
      const candidates = computed(() => Array.isArray(evolution.value.candidates) ? evolution.value.candidates : []);
      const comparison = computed(() => evolution.value.effectComparison);
      const missing = computed(() => Array.isArray(execution.value.missing) ? execution.value.missing : []);
      const domainText = computed(() => {
        const domains = Array.isArray(router.value.domains) ? router.value.domains : [];
        return domains.length ? domains.map(item => clean(item.label)).join('、') : '未配置中间决策层';
      });
      const missingText = computed(() => missing.value.length ? missing.value.slice(0, 3).join('；') : '无');
      const phaseLabel = p => ({ running: '进行中', waiting: '等待', delivered: '已交付', failed: '失败', todo: '待办', blocked: '受阻',
        intake: '待接入', dispatched: '已派单', in_progress: '进行中', review: '待评审', accepted: '已验收', closed: '已结束', draft: '草稿' }[p] || p || '—');
      const phaseTag = p => ({ running: 'primary', waiting: 'warning', delivered: 'success', failed: 'danger', blocked: 'danger',
        accepted: 'success', review: 'warning', closed: 'info', draft: 'info', dispatched: 'primary', intake: 'info', in_progress: 'primary', todo: 'info' }[p] || 'info');
      const openTask = row => { current.value = row; taskDrawer.value = true; };
      const tlType = k => ({ human: 'primary', agent: 'success', system: 'info' }[k] || 'info');
      const tlKind = k => ({ human: '人', agent: 'Agent', system: '系统' }[k] || '系统');
      const load = async () => { summary.value = await safe('view-summary'); };
      const loadHitl = async () => { hitlLoading.value = true; hitl.value = await safe('admin-hitl'); hitlLoading.value = false; };
      const astate = q => {
        if (!answerState[q.id]) answerState[q.id] = { choice: '', note: '', busy: false };
        return answerState[q.id];
      };
      const answer = async q => {
        const st = astate(q);
        if (!st.choice || st.busy) return;
        st.busy = true;
        try {
          const r = await api('admin-hitl-answer', { questionId: q.id, choice: st.choice, note: st.note });
          ElementPlus.ElMessage.success('已回答（' + (r.autoResume && r.autoResume.ok ? '已自动排续跑闸' : '留痕完成，待续跑') + '）');
          await loadHitl();
        } catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
        finally { st.busy = false; }
      };
      const resumable = row => ['blocked', 'waiting', 'ready', 'failed'].includes(row.phase);
      const pausable = row => ['running', 'in_progress', 'dispatched', 'intake', 'todo'].includes(row.phase);
      const controlTask = async (row, command) => {
        try {
          await ElementPlus.ElMessageBox.confirm(`对任务「${row.title || row.identifier || row.id}」执行「${command}」？这会通过本机协作服务把指令送回该任务。`, '确认操作', { type: 'warning' });
        } catch { return; }
        try {
          const r = await api('admin-task-control', { taskId: row.id || row.identifier, command });
          ElementPlus.ElMessage.success(r.ok ? ('已' + command) : ('操作未成功：' + (r.response?.error || '未知原因')));
          await load();
        } catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
      };
      onMounted(async () => {
        const [s, r, g, e, x] = await Promise.all([
          safe('view-summary'), safe('routing-status'), safe('v06-agent-registry-view'),
          safe('v06-evolution-view'), safe('v06-execution-view')]);
        summary.value = s; routing.value = r; registry.value = g; evolution.value = e; execution.value = x;
        loadHitl();
      });
      // 第六十七轮：执行端语义（auto / human）来自 v06-agent-registry-view 的 executions，
      // 与「编制」分开呈现——编制空不等于没有执行引擎，反之亦然。
      const execRollup = computed(() => registry.value?.executionRollup ?? null);
      const liveExecs = computed(() => (Array.isArray(registry.value?.executions) ? registry.value.executions : [])
        .filter(e => e.enabled));
      const problemExecs = computed(() => (Array.isArray(registry.value?.executions) ? registry.value.executions : [])
        .filter(e => e.problem));
      return { summary, tasks, routing, router, coverage, threeTier, shapeReady, registry, agents, evolution, candidates,
        comparison, execution, missing, missingText, domainText, phaseLabel, phaseTag, openTask, taskDrawer, current,
        clean, dutyText, fmtTime, agentLabel, timeline, timelineLoading, tlType, tlKind,
        hitl, hitlLoading, astate, answer, loadHitl, canControlTask, resumable, pausable, controlTask,
        activeTab, taskQuery, taskFilter, filteredTasks, phaseOptions, execRollup, liveExecs, problemExecs };
    },
  };

  // ---------------------------------------------------------------- 知识视图（CRUD + 分区权限）
  const KnowledgeView = {
    props: ['session'],
    template: `
      <div>
        <el-card v-if="canSearch" shadow="never" style="margin-bottom:14px">
          <template #header>
            <div class="card-head">
              <span>语义检索（原生知识管线）</span>
              <div style="display:flex;gap:8px;align-items:center">
                <el-tag size="small" effect="plain" type="warning">外部模型调用</el-tag>
                <el-button size="small" text @click="searchOpen = !searchOpen">{{ searchOpen ? '收起' : '展开' }}</el-button>
              </div>
            </div>
          </template>
          <div v-show="searchOpen">
          <div class="field-hint" style="margin-bottom:10px">对已进入原生知识管线（cognify）的材料做语义检索：知识条目「生成图谱」后自动抽取，或命令行手动喂入。提问会发往所配置的外部模型服务汇总；结果为机器生成摘要，请核对原始资料。仅所有者与管理员可用。</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <el-input v-model="search.query" placeholder="例如：支付模块有什么风险？谁负责前端？" style="max-width:420px" clearable @keyup.enter="runSearch" />
            <el-input v-model="search.dataset" placeholder="数据集" style="max-width:170px" />
            <el-button type="primary" :loading="search.busy" :disabled="!search.query.trim()" @click="runSearch">检索</el-button>
          </div>
          <el-alert v-if="search.error" :title="search.error" type="error" :closable="false" />
          <template v-if="search.results">
            <div class="field-hint">数据集 {{ search.datasetUsed || search.dataset }} · {{ search.results.length }} 条结果</div>
            <div v-if="!search.results.length" class="field-hint">没有召回结果——此数据集可能还没有 cognify 过材料；先在知识工作台对来源「生成图谱」（凭据就绪时会自动 cognify）。</div>
            <pre v-for="(r, i) in search.results" :key="i" class="code-block" style="margin-top:8px">{{ resultText(r) }}</pre>
          </template>
          </div>
        </el-card>
        <div class="kb-layout">
          <aside class="kb-side">
            <div class="kb-side-head"><span>知识库</span></div>
            <div v-for="lib in libraries" :key="lib.id" class="kb-lib" :class="{ active: activeLib === lib.id }" @click="activeLib = lib.id">
              <div class="kb-lib-name">{{ lib.name }}</div>
              <div class="kb-lib-meta">{{ lib.count }} 条 · 三层齐 {{ lib.complete }}</div>
            </div>
            <div class="kb-side-foot">
              <el-button text size="small" @click="sedimentVisible = true">沉淀候选 {{ sedimentList.length }}</el-button>
            </div>
            <div class="kb-side-note">按归属分区（个人 / 协作 / 组织）。每条知识都该落满结构化、正文、图谱三层。</div>
          </aside>
          <section class="kb-main">
            <div class="kb-toolbar">
              <el-input v-model="kbQuery" placeholder="按标题或标识筛选" size="small" clearable style="max-width:240px" aria-label="筛选知识条目" />
              <div style="display:flex;gap:8px">
                <el-button size="small" @click="runGuard">知识体检</el-button>
                <el-button type="primary" size="small" @click="openCreate" v-if="canWriteSome">新建知识</el-button>
              </div>
            </div>
            <el-alert v-if="list.__error" :title="'读取失败：' + list.__error" type="warning" :closable="false" />
            <template v-else>
              <div v-if="libItems.length" class="kb-layer-audit">
                当前库 {{ libItems.length }} 条 · 结构化 <b>{{ layerStats.structured }}</b> · 正文达标 <b>{{ layerStats.narrative }}</b>
                <span v-if="layerStats.mostGap" class="kb-layer-gap">· 最缺「{{ layerStats.mostGap }}」{{ layerStats.mostGapCount }} 条</span>
                <span v-else class="kb-layer-ok">· 全部三层齐备</span>
              </div>
              <el-table :data="libItems" v-loading="loading" size="default" @row-click="openView">
                <el-table-column label="知识" min-width="200">
                  <template #default="{ row }">
                    <div class="task-cell">
                      <div class="task-id">{{ row.key }}</div>
                      <el-link type="primary" class="task-title">{{ row.title || '（无标题）' }}</el-link>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="类型" width="72"><template #default="{ row }">{{ kindLabel(row.kind) }}</template></el-table-column>
                <el-table-column label="状态" width="84">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.state === 'confirmed' ? 'success' : row.state === 'withdrawn' ? 'info' : 'warning'" effect="light">{{ stateLabel(row.state) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="三层" width="150">
                  <template #default="{ row }">
                    <span class="kb-layer" :class="{ on: row.factsCount > 0 }" :title="'结构化层 ' + (row.factsCount || 0) + ' 个字段'">结构化</span>
                    <span class="kb-layer" :class="{ on: (row.bodyLength || 0) >= 80 }" :title="'非结构化层 ' + (row.bodyLength || 0) + ' 字'">正文</span>
                    <span v-if="row.injected" class="kb-layer on" title="已提升到注入索引">注入</span>
                  </template>
                </el-table-column>
                <el-table-column prop="owner" label="归属" width="120" show-overflow-tooltip />
                <el-table-column label="更新" width="122"><template #default="{ row }">{{ fmtTime(row.updatedAt) }}</template></el-table-column>
                <el-table-column label="操作" width="80" fixed="right">
                  <template #default="{ row }">
                    <el-dropdown trigger="click" @command="c => c === 'edit' ? openEdit(row) : remove(row)">
                      <el-button size="small" text>操作</el-button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item v-if="canEdit(row)" command="edit">编辑</el-dropdown-item>
                          <el-dropdown-item v-if="canDelete(row)" command="remove">撤回</el-dropdown-item>
                          <el-dropdown-item v-if="!canEdit(row) && !canDelete(row)" disabled>只读</el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </template>
                </el-table-column>
              </el-table>
              <div v-if="!libItems.length" class="field-hint">{{ kbQuery ? '没有匹配的知识条目' : '这个库还没有知识条目' }}</div>
            </template>
          </section>
        </div>

        <el-drawer v-model="sedimentVisible" title="沉淀候选 · 从判定模式提炼" size="620px">
          <div class="hint-text">
            从最近的判定账本里找出<b>重复出现</b>的模式，提炼成三层知识候选——结构化字段 + 叙事正文 + 图谱草稿边。孤例不算知识。
            这里只产候选，写进知识库仍要你审。
          </div>
          <div class="card-head" style="margin-bottom:10px">
            <span style="font-size:12.5px;color:var(--el-text-color-secondary)">
              共 {{ sedimentList.length }} 条<template v-if="sediment.summary"> · {{ sediment.summary.complete }} 条三层齐备</template>
            </span>
            <el-button size="small" @click="loadSediment" :loading="sedimentLoading">重新提炼</el-button>
          </div>
          <el-alert v-if="sediment.__error" :title="'提炼失败：' + sediment.__error" type="warning" :closable="false" />
          <div v-for="c in sedimentList" :key="c.id" class="sediment-item">
            <div class="sediment-head">
              <el-tag size="small" type="primary" effect="light">{{ kindLabel(c.kind) }}</el-tag>
              <span class="sediment-title">{{ c.title }}</span>
              <span class="sediment-count">×{{ c.occurrences }}</span>
              <span class="sediment-layers">
                <span class="kb-layer" :class="{ on: !c.gaps.includes('facts') }">结构化</span>
                <span class="kb-layer" :class="{ on: !c.gaps.includes('body') }">正文</span>
                <span class="kb-layer" :class="{ on: !c.gaps.includes('edges') }">图谱</span>
              </span>
            </div>
            <div class="sediment-meta">{{ c.appliesTo }} · 建议标识 {{ c.suggestedKey }}</div>
            <ul class="ledger-reasons">
              <li v-for="r in c.reasons" :key="r.code">{{ r.text }}</li>
            </ul>
          </div>
          <div v-if="!sedimentList.length && !sediment.__error" class="field-hint">
            最近的判定还不够多——同类判定出现 2 次以上才会成为候选。
          </div>
        </el-drawer>
        <el-card shadow="never">
          <template #header>知识体检（只读 advisory）</template>
          <pre class="code-block">{{ guardText }}</pre>
        </el-card>

        <el-dialog v-model="dialog" :title="form.key ? '编辑：' + form.key : '新建知识'" width="720px" top="6vh">
          <el-form label-width="92px">
            <el-form-item label="标识 key" v-if="!form.existing">
              <el-input v-model="form.key" placeholder="knowledge-小写字母数字连字符" />
            </el-form-item>
            <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
            <el-form-item label="类型">
              <el-select v-model="form.kind" style="width:200px">
                <el-option v-for="[v, l] in kinds" :key="v" :value="v" :label="l" />
              </el-select>
            </el-form-item>
            <el-form-item label="业务域"><el-input v-model="form.domainsText" placeholder="逗号分隔，如 product, growth" /></el-form-item>
            <el-form-item label="归属分区">
              <el-radio-group v-model="form.visibility" :disabled="form.existing && !canChangeVis(form.existing)">
                <el-radio v-for="[v, l] in visibilities" :key="v" :value="v">{{ l }}</el-radio>
              </el-radio-group>
              <div class="field-hint">分区决定谁可以改：个人区只有归属者本人；协作区运营及以上；组织区管理员及以上（agent 按架构档位，只能改自己范围内）。</div>
            </el-form-item>
            <el-form-item label="适用范围"><el-input v-model="form.appliesTo" /></el-form-item>
            <el-form-item label="正文"><el-input v-model="form.body" type="textarea" :rows="7" /></el-form-item>
            <el-form-item label="来源 URL"><el-input v-model="form.sourcesText" type="textarea" :rows="2" placeholder="每行一个 http(s) 链接" /></el-form-item>
            <el-form-item label="挂靠任务" v-if="!form.existing">
              <el-select v-model="form.taskId" filterable allow-create style="width:100%" placeholder="选择本项目内非协作任务">
                <el-option v-for="t in anchorTasks" :key="t" :value="t" :label="t" />
              </el-select>
              <div class="field-hint">知识以任务文档形式存储，需要一个挂靠任务。</div>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="dialog = false">取消</el-button>
            <el-button type="primary" :loading="saving" @click="save">{{ form.existing ? '保存修订' : '创建' }}</el-button>
          </template>
        </el-dialog>

        <el-dialog v-model="viewDialog" :title="viewing.title || '知识详情'" width="760px" top="6vh">
          <div class="kb-view-head">
            <el-tag size="small" effect="light">{{ kindLabel(viewing.kind) }}</el-tag>
            <el-tag v-if="viewing.meta" size="small" effect="plain" :type="visTag(viewing.meta.visibility)">{{ visLabel(viewing.meta.visibility) }}</el-tag>
            <el-tag v-if="viewing.meta && viewing.meta.state !== 'confirmed'" size="small" effect="plain" :type="viewing.meta.state === 'withdrawn' ? 'info' : 'warning'">{{ stateLabel(viewing.meta.state) }}</el-tag>
            <span class="list-row-meta">{{ viewing.meta ? viewing.meta.owner + ' · ' + fmtTime(viewing.meta.updatedAt) : '' }}</span>
          </div>
          <el-tabs v-model="viewTab">
            <el-tab-pane label="结构化" name="facts">
              <div class="hint-text">字段化的事实，可被查询与校验；空表示这条知识只有叙述、没有可计算的部分。</div>
              <el-descriptions v-if="viewFacts.length" :column="2" border size="small">
                <el-descriptions-item v-for="f in viewFacts" :key="f.key" :label="f.key">{{ f.value }}</el-descriptions-item>
              </el-descriptions>
              <div v-else class="field-hint">没有结构化字段 —— 缺一层。</div>
              <div class="hint-text" style="margin-top:10px">适用范围：{{ viewing.appliesTo || '（未声明）' }}</div>
              <div class="hint-text" v-if="viewing.domains && viewing.domains.length">归属域：{{ viewing.domains.join('、') }}</div>
            </el-tab-pane>
            <el-tab-pane label="正文" name="body">
              <div class="kb-view-body">{{ viewing.body || '（无正文）' }}</div>
              <div v-if="viewing.sources && viewing.sources.length" class="kb-view-sources">
                <div class="list-row-title" style="margin-bottom:4px">来源</div>
                <div v-for="s in viewing.sources" :key="s" class="list-row-detail">· {{ s }}</div>
              </div>
            </el-tab-pane>
            <el-tab-pane label="图谱" name="graph">
              <div class="hint-text">这条知识在图谱里的关系边。草稿边不可作依据，只有人验收后才生效。</div>
              <div v-if="viewEdges.length">
                <div class="hint-text" v-if="!viewEdgesMatched">
                  没有与这条知识直接关联的边，下面是同一任务下的全部 {{ viewEdgesTotal }} 条关系（供参考，不代表直接关联）。
                </div>
                <div v-for="e in viewEdges" :key="e.id" class="list-row">
                  <div class="list-row-head">
                    <span class="list-row-title">{{ e.from }} → {{ e.to }}</span>
                    <el-tag size="small" :type="e.state === 'reusable' ? 'success' : e.state === 'accepted' ? 'primary' : 'info'" effect="light">{{ e.kind }}</el-tag>
                  </div>
                  <div class="list-row-detail">{{ e.state === 'draft' ? '草稿（未验收）' : e.state === 'accepted' ? '已验收' : '可复用' }} · 证据 {{ (e.evidenceRefs || []).length }} 条</div>
                </div>
              </div>
              <div v-else class="field-hint">
                单条知识的边查询还没接入——知识边由 knowledge-edges 管理（belongs_to_role / verified_by / responsible_for …），
                目前只有全局图谱，没有按知识 key 回查的读接口。这是缺口，不编造边。
              </div>
            </el-tab-pane>
          </el-tabs>
          <template #footer>
            <el-button @click="viewDialog = false">关闭</el-button>
            <el-button v-if="viewing.meta && canEdit(viewing.meta)" type="primary" @click="viewDialog = false; openEdit(viewing.meta)">编辑</el-button>
          </template>
        </el-dialog>
      </div>`,
    setup(props) {
      const list = ref({}); const loading = ref(false); const guardText = ref('尚未运行；点击「跑知识体检」获取只读报告。');
      const dialog = ref(false); const saving = ref(false);
      // 第六十九轮 · 沉淀候选：从决策账本提炼三层知识候选（只产候选，写库仍走人审）。
      const sediment = ref({}); const sedimentLoading = ref(false);
      const sedimentList = computed(() => Array.isArray(sediment.value.candidates) ? sediment.value.candidates : []);
      const loadSediment = async () => {
        sedimentLoading.value = true;
        sediment.value = await safe('knowledge-sediment', { limit: 400, minOccurrences: 2 });
        sedimentLoading.value = false;
      };
      // 第六十四轮：知识文档「查看」——打开正文只读阅读（后端 knowledge-get 已有）。
      const viewDialog = ref(false); const viewing = ref({});
      const viewTab = ref('body'); const viewEdges = ref([]);
      const viewEdgesTotal = ref(0); const viewEdgesMatched = ref(false);
      const viewFacts = computed(() => Object.entries(viewing.value.facts || {}).map(([key, value]) => ({ key, value: String(value) })));
      // 第三十四轮：原生知识管线语义检索（所有者/管理员；跨分区数据集故收口）。
      const search = reactive({ query: '', dataset: 'suitme-knowledge', busy: false, error: '', results: null, datasetUsed: '' });
      const canSearch = computed(() => props.session?.role === 'owner' || props.session?.role === 'admin');
      const resultText = r => typeof r === 'string' ? r
        : Array.isArray(r?.search_result) ? r.search_result.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n')
        : typeof r?.text === 'string' ? r.text : JSON.stringify(r, null, 2);
      const runSearch = async () => {
        if (!search.query.trim() || search.busy) return;
        search.busy = true; search.error = ''; search.results = null;
        try {
          const r = await api('cognee-search', { query: search.query.trim(), dataset: search.dataset.trim() || 'suitme-knowledge' });
          search.results = Array.isArray(r.results) ? r.results : [];
          search.datasetUsed = r.dataset || '';
          if (!search.results.length) ElementPlus.ElMessage.info('没有召回结果');
        } catch (e) { search.error = String(e.message || e); }
        finally { search.busy = false; }
      };
      const form = reactive({ key: '', title: '', kind: 'reference', domainsText: '', visibility: 'team', appliesTo: '', body: '', sourcesText: '', taskId: '', existing: null });
      const kinds = KNOWLEDGE_KINDS, visibilities = VISIBILITY;
      const items = computed(() => Array.isArray(list.value.items) ? list.value.items : []);
      const perms = computed(() => props.session?.permissions ?? []);
      const me = computed(() => 'user:' + (props.session?.username ?? ''));
      const canWriteSome = computed(() => perms.value.includes('knowledge-write-team') || perms.value.includes('knowledge-write-org'));
      const anchorTasks = computed(() => [...new Set(items.value.map(i => i.taskId))]);
      const visLabel = v => ({ personal: '个人区', team: '协作区', org: '组织区' }[v] || v || '组织区');
      const visTag = v => ({ personal: 'warning', team: 'primary', org: 'danger' }[v] || 'info');
      const stateLabel = s => ({ candidate: '待审核', confirmed: '已确认', withdrawn: '已撤回' }[s] || s);

      const canEdit = row => {
        if (row.visibility === 'personal') return row.owner === me.value;
        if (row.visibility === 'team') return perms.value.includes('knowledge-write-team');
        return perms.value.includes('knowledge-write-org');
      };
      const canDelete = row => {
        if (row.visibility === 'personal') return row.owner === me.value;
        if (row.visibility === 'team') return perms.value.includes('knowledge-write-team');
        return perms.value.includes('knowledge-delete-org');
      };
      const canChangeVis = row => canEdit(row);

      const load = async () => { loading.value = true; list.value = await safe('knowledge-list'); loading.value = false; };
      const runGuard = async () => {
        guardText.value = '体检运行中…';
        const r = await safe('memory-guard');
        guardText.value = r.__error ? ('体检失败：' + r.__error) : JSON.stringify(r, null, 2);
      };
      const openCreate = () => {
        Object.assign(form, { key: '', title: '', kind: 'reference', domainsText: '', visibility: perms.value.includes('knowledge-write-org') ? 'team' : 'personal', appliesTo: '', body: '', sourcesText: '', taskId: anchorTasks.value[0] ?? '', existing: null });
        dialog.value = true;
      };
      const openView = async row => {
        // 第七十轮 · 详情按三层展开（对标 LobeHub 的文件详情：分块预览 → 我们这里是结构化/正文/图谱）。
        // 默认落在「正文」，因为它是最常看的一层；结构化与图谱作为并列页签。
        const hasFacts = (row.factsCount || 0) > 0;
        viewTab.value = hasFacts ? 'facts' : 'body';
        viewing.value = { title: row.title, kind: row.kind, body: '正文加载中…', sources: [],
          meta: row, facts: {}, appliesTo: '', domains: row.domains ?? [] };
        viewEdges.value = []; viewEdgesTotal.value = 0; viewEdgesMatched.value = false;
        viewDialog.value = true;
        const [d, eg] = await Promise.all([
          safe('knowledge-get', { taskId: row.taskId, key: row.key }),
          safe('knowledge-edges', { taskId: row.taskId, key: row.key }),
        ]);
        if (d.value) {
          viewing.value.body = d.value.body ?? '（无正文）';
          viewing.value.sources = d.value.sources ?? [];
          viewing.value.facts = d.value.facts ?? {};
          viewing.value.appliesTo = d.value.appliesTo ?? '';
          viewing.value.domains = d.value.domains ?? [];
        } else if (d.__error) {
          viewing.value.body = '读取失败：' + d.__error;
        }
        // 图谱层：优先显示与这条知识直接相关的边；没有则退回该任务的全部边（并标明未直接关联）。
        if (Array.isArray(eg.edges)) {
          viewEdges.value = eg.edges;
          viewEdgesTotal.value = eg.total ?? eg.edges.length;
          viewEdgesMatched.value = eg.matched === true;
        }
      };
      const openEdit = async row => {
        Object.assign(form, { key: row.key, title: row.title, kind: row.kind, domainsText: (row.domains ?? []).join(', '),
          visibility: row.visibility || 'org', appliesTo: '', body: '', sourcesText: '', taskId: row.taskId, existing: row });
        dialog.value = true;
        const d = await safe('knowledge-get', { taskId: row.taskId, key: row.key });
        if (d.value) {
          form.appliesTo = d.value.appliesTo ?? ''; form.body = d.value.body ?? '';
          form.sourcesText = (d.value.sources ?? []).join('\n');
        }
      };
      const save = async () => {
        if (saving.value) return;
        saving.value = true;
        try {
          const domains = form.domainsText.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
          if (!domains.length) throw new Error('至少一个业务域');
          const sources = form.sourcesText.split(/\n+/).map(s => s.trim()).filter(Boolean);
          if (!sources.length) throw new Error('至少一个来源 URL');
          const base = { key: form.key.trim(), title: form.title.trim(), kind: form.kind, domains,
            visibility: form.visibility, appliesTo: form.appliesTo.trim() || '本项目', body: form.body.trim(), sources };
          if (base.body.length < 1) throw new Error('正文不能为空');
          const payload = form.existing ? { taskId: form.existing.taskId, ...base } : { taskId: form.taskId, ...base };
          await api(form.existing ? 'knowledge-update' : 'knowledge-create', payload);
          ElementPlus.ElMessage.success(form.existing ? '已保存修订（如原为已确认状态，需重新审核）' : '已创建（待审核）');
          dialog.value = false; await load();
        } catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
        finally { saving.value = false; }
      };
      const remove = async row => {
        try {
          await ElementPlus.ElMessageBox.confirm(`删除（撤回）知识「${row.title || row.key}」？归属分区：${visLabel(row.visibility)}。`, '确认删除', { type: 'warning' });
        } catch { return; }
        try { await api('knowledge-delete', { taskId: row.taskId, key: row.key }); ElementPlus.ElMessage.success('已撤回'); await load(); }
        catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
      };
      // 知识列表要逐个任务拉文档，慢；沉淀候选与它并行，不要串在它后面。
      onMounted(() => { load(); loadSediment(); });
      // 第七十轮 · 前台对标 LobeHub 资源库：左栏知识库列表 + 右栏文件列表。
      // 我们的「库」= 归属分区（个人 / 协作 / 组织）；「文件」= 知识条目。
      const activeLib = ref('all'); const kbQuery = ref(''); const sedimentVisible = ref(false); const searchOpen = ref(false);
      const threeLayerComplete = i => (i.factsCount || 0) > 0 && (i.bodyLength || 0) >= 80;
      const libraries = computed(() => {
        const list = items.value;
        const build = (id, name, keep) => {
          const sub = list.filter(keep);
          return { id, name, count: sub.length, complete: sub.filter(threeLayerComplete).length };
        };
        return [
          build('all', '全部知识', () => true),
          build('personal', '个人区', i => (i.visibility || 'org') === 'personal'),
          build('team', '协作区', i => (i.visibility || 'org') === 'team'),
          build('org', '组织区', i => (i.visibility || 'org') === 'org'),
        ];
      });
      const libItems = computed(() => {
        const q = kbQuery.value.trim().toLowerCase();
        return items.value
          .filter(i => activeLib.value === 'all' || (i.visibility || 'org') === activeLib.value)
          .filter(i => !q || String(i.title || '').toLowerCase().includes(q) || String(i.key || '').toLowerCase().includes(q));
      });
      // 三层体检：只看当前库，结构化（facts）/ 非结构化（正文 ≥80 字）逐条算，最缺哪层直接点名。
      const layerStats = computed(() => {
        const list = libItems.value;
        const structured = list.filter(i => (i.factsCount || 0) > 0).length;
        const narrative = list.filter(i => (i.bodyLength || 0) >= 80).length;
        const missingFacts = list.length - structured;
        const missingBody = list.length - narrative;
        const mostGap = missingFacts === 0 && missingBody === 0 ? ''
          : missingFacts >= missingBody ? '结构化字段' : '正文';
        return { structured, narrative, mostGap, mostGapCount: Math.max(missingFacts, missingBody) };
      });
      const kindLabel = k => ({ reference: '参考', decision: '决策', standard: '标准', note: '笔记', draft: '草稿',
        procedure: '流程', experiment: '实验', feedback: '反馈' }[k] || k || '参考');
      return { list, items, loading, guardText, dialog, saving, form, kinds, visibilities, anchorTasks,
        sediment, sedimentLoading, sedimentList, loadSediment, layerStats,
        activeLib, kbQuery, sedimentVisible, searchOpen, libraries, libItems,
        visLabel, visTag, stateLabel, canEdit, canDelete, canChangeVis, canWriteSome, load, runGuard, openCreate, openEdit, save, remove, fmtTime,
        viewDialog, viewing, viewTab, viewEdges, viewEdgesTotal, viewEdgesMatched, viewFacts, openView, search, canSearch, runSearch, resultText, kindLabel };
    },
  };

  // ---------------------------------------------------------------- 验收 / 审查视图
  // 只读工作台：清单在开工前锁定，这里看逐项判定、证据区域与审查 Agent 编组。
  // 最终核可仍由原发起人在飞书原会话完成；本页不提供「通过 / 打回」写入口。
  const AcceptanceView = {
    template: `
      <div>
        <el-card shadow="never" style="margin-bottom:14px">
          <div class="card-head">
            <div>
              <label class="list-row-title" for="acceptance-task-select">选择要审查的任务</label>
              <div class="hint-text" style="margin:4px 0 0">清单锁定后不可改写；证据与逐项判定只是给人看的依据。</div>
            </div>
            <el-select id="acceptance-task-select" v-model="taskId" filterable placeholder="选择一个协作任务" style="width:min(360px, 100%)" @change="load">
              <el-option v-for="t in tasks" :key="t.id" :label="t.identifier + ' · ' + t.title" :value="t.id" />
            </el-select>
          </div>
        </el-card>
        <el-alert v-if="errorText" :title="errorText" type="warning" :closable="false" style="margin-bottom:14px" />
        <el-empty v-if="!tasks.length" description="当前身份可见范围内还没有协作任务" />
        <el-empty v-else-if="!taskId" description="先选择一个任务" />
        <template v-else>
          <el-row :gutter="14" style="margin-bottom:14px">
            <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="6">
              <el-card shadow="never"><div class="stat"><div class="stat-num">{{ card.value }}</div><div class="stat-label">{{ card.label }}</div></div></el-card>
            </el-col>
          </el-row>
          <el-row :gutter="14">
            <el-col :xs="24" :md="15" style="margin-bottom:14px">
              <el-card shadow="never" class="contract-card">
                <template #header>
                  <div class="card-head"><span>验收清单与逐项判定</span><span class="list-row-meta">{{ planLine }}</span></div>
                </template>
                <el-alert v-if="!data.plan" type="info" :closable="false" title="该任务未锁定验收清单，沿用原发起人在原会话核可；本页不伪造清单。" />
                <template v-else>
                  <div class="hint-text">等级 {{ data.plan.level }} · 清单指纹 {{ shortHash }} · 锁定 {{ fmtTime(data.plan.lockedAt) }} · 起草 {{ data.plan.draftedBy || '未记录' }}</div>
                  <el-table :data="data.items" size="small">
                    <el-table-column label="检查项" min-width="190">
                      <template #default="{ row }">
                        <div class="list-row-title">{{ row.name }}</div>
                        <div class="list-row-detail">{{ row.criteria }}</div>
                      </template>
                    </el-table-column>
                    <el-table-column label="证据" width="130">
                      <template #default="{ row }">
                        <span class="ev-media" :class="'ev-' + evidenceMedia(row.evidenceKind).tone">{{ evidenceMedia(row.evidenceKind).label }}</span>
                        <span v-if="row.evidenceRefs.length" class="ev-count" :title="row.evidenceRefs.length + ' 条证据引用'">{{ row.evidenceRefs.length }} 条</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="判定" width="88">
                      <template #default="{ row }"><el-tag size="small" :type="statusTag(row.status)" effect="light">{{ statusText(row.status) }}</el-tag></template>
                    </el-table-column>
                    <el-table-column label="原因 / 证据位置" min-width="210">
                      <template #default="{ row }">
                        <div>{{ row.reason || '—' }}</div>
                        <div v-if="row.evidenceRefs.length" class="list-row-meta">证据 {{ row.evidenceRefs.length }} 条</div>
                        <div v-if="row.regions.length" class="region-chips">
                          <el-button v-for="(region, i) in row.regions" :key="i" size="small" text type="primary"
                            :aria-label="'选中 ' + row.name + ' 的第 ' + (i + 1) + ' 个证据区域'"
                            @click="pickRegion(row, i)">区域 {{ i + 1 }}：{{ region.x }},{{ region.y }} · {{ region.width }}×{{ region.height }}</el-button>
                        </div>
                        <div class="region-chips" style="margin-top:4px">
                          <el-button size="small" text :aria-label="'就 ' + row.name + ' 发起讨论'" @click="pickItem(row)">讨论此项</el-button>
                        </div>
                      </template>
                    </el-table-column>
                  </el-table>
                  <div v-if="data.round" class="hint-text" style="margin-top:10px">
                    第 {{ data.round.round }} 轮 · 结论 {{ overallText(data.round.overall) }} · 打回 {{ data.round.rejected.recheckItems.length }} 项 / 保留 {{ data.round.rejected.keepItems.length }} 项
                  </div>
                </template>
              </el-card>
            </el-col>
            <el-col :xs="24" :md="9">
              <el-card shadow="never" class="contract-card" style="margin-bottom:14px">
                <template #header><div class="card-head"><span>审查 Agent</span><el-tag size="small" :type="data.crew && data.crew.configured ? 'success' : 'info'">{{ data.crew && data.crew.configured ? '已编组' : '未配置（降级）' }}</el-tag></div></template>
                <el-alert v-if="data.crew && data.crew.degraded" :title="data.crew.degraded" type="info" :closable="false" style="margin-bottom:10px" />
                <div v-for="row in crewRows" :key="row.key" class="list-row">
                  <div class="list-row-head"><span class="list-row-title">{{ row.label }}</span><span class="list-row-meta">{{ row.agent }}</span></div>
                </div>
                <div v-if="data.crew && data.crew.collaborators.length" class="list-row">
                  <div class="list-row-title">协作职责</div>
                  <div class="list-row-detail">{{ data.crew.collaborators.map(c => dutyText(c.responsibility) + '：' + (c.assignment.agentKey || '未配置')).join('；') }}</div>
                </div>
                <div class="hint-text" style="margin-top:8px">红线：{{ ((data.crew && data.crew.redLines) || []).join('；') }}</div>
              </el-card>
              <el-card shadow="never" class="contract-card" style="margin-bottom:14px">
                <template #header>报告与沉淀</template>
                <el-descriptions :column="1" border size="small">
                  <el-descriptions-item label="报告">{{ data.report && data.report.available ? (data.report.verdict + ' · ' + data.report.cases + ' 项') : '本机暂无归档报告' }}</el-descriptions-item>
                  <el-descriptions-item label="归档轮次">{{ data.report ? data.report.archivedRounds : 0 }}</el-descriptions-item>
                  <el-descriptions-item label="就绪">{{ data.readiness && data.readiness.ready ? '证据链已齐' : '未就绪（见下）' }}</el-descriptions-item>
                </el-descriptions>
                <div v-if="data.readiness && data.readiness.gaps.length" class="hint-text" style="margin-top:8px">
                  <div v-for="gap in data.readiness.gaps" :key="gap">· {{ gap }}</div>
                </div>
                <div class="hint-text" style="margin-top:8px">下次交付前先自查：</div>
                <div v-if="data.selfCheckStandards && data.selfCheckStandards.length">
                  <div v-for="item in data.selfCheckStandards" :key="item" class="list-row-detail">· {{ item }}</div>
                </div>
                <div v-else class="hint-text">暂无沉淀标准；没有历史打回就不凭空造。</div>
              </el-card>
              <el-card shadow="never" class="contract-card">
                <template #header>签字与边界</template>
                <div class="hint-text">最终「确认验收」只能由原发起人在飞书原会话用中文完成；本页只读，不提供通过 / 打回按钮。报告、模型判定、CI 与合并审批都不替代人签。</div>
              </el-card>
            </el-col>
          </el-row>
          <el-row :gutter="14">
            <el-col :xs="24" :md="15" style="margin-bottom:14px">
              <el-card shadow="never" class="contract-card">
                <template #header>
                  <div class="card-head"><span>证据区域 · 点选定位</span><span class="list-row-meta">{{ pickedLabel }}</span></div>
                </template>
                <div v-if="!pickedRegions.length" class="hint-text">
                  这一项没有记录证据区域。没有区域就不画框，不凭空造坐标。
                </div>
                <template v-else>
                  <div class="region-board" role="group" aria-label="证据区域坐标板">
                    <button v-for="(region, i) in pickedRegions" :key="i" type="button" class="region-box"
                      :class="{ active: picked && picked.index === i }" :style="boxStyle(region)"
                      :aria-label="'区域 ' + (i + 1) + (region.note ? '：' + region.note : '')"
                      :aria-pressed="picked && picked.index === i ? 'true' : 'false'"
                      @click="pickRegion(pickedItem, i)">{{ i + 1 }}</button>
                  </div>
                  <div class="field-hint">{{ pickedRegionNote }}</div>
                  <div class="hint-text" style="margin-top:6px">
                    区域只是「回到具体位置」的定位信息，不参与通过 / 不通过判定；底板按本项区域的坐标范围等比缩放，不是原截图像素。
                  </div>
                </template>
              </el-card>
            </el-col>
            <el-col :xs="24" :md="9" style="margin-bottom:14px">
              <el-card shadow="never" class="contract-card">
                <template #header>
                  <div class="card-head">
                    <span>报告内讨论</span>
                    <el-tag size="small" :type="threadDigest.unresolved ? 'warning' : 'info'">
                      {{ threadDigest.unresolved || 0 }} 条待处理 / 共 {{ threadDigest.total || 0 }} 条
                    </el-tag>
                  </div>
                </template>
                <div class="hint-text">讨论只供人看：不改变逐项判定，也不替代原发起人在原会话「确认验收」。</div>
                <el-input v-model="draft" type="textarea" :rows="3" maxlength="1000" show-word-limit
                  :placeholder="'就「' + targetLabel + '」说一句'" aria-label="讨论内容" />
                <div class="card-head" style="margin-top:8px">
                  <span class="list-row-meta">挂到：{{ targetLabel }}</span>
                  <span>
                    <el-button size="small" aria-label="改为讨论整份报告" @click="pickReport">整份报告</el-button>
                    <el-button size="small" type="primary" :loading="posting" :disabled="!draft.trim()"
                      aria-label="提交讨论" @click="addComment">发表</el-button>
                  </span>
                </div>
                <div v-if="!thread.length" class="hint-text" style="margin-top:10px">还没有讨论。没有讨论就如实显示 0 条。</div>
                <div v-else class="thread">
                  <div v-for="comment in thread" :key="comment.id" class="thread-item" :class="{ resolved: comment.resolvedAt }">
                    <div class="list-row-head">
                      <span class="list-row-title">{{ comment.author }}</span>
                      <span class="list-row-meta">{{ fmtTime(comment.at) }}</span>
                    </div>
                    <div class="list-row-detail">{{ comment.body }}</div>
                    <div class="list-row-head" style="margin-top:6px">
                      <span class="list-row-meta">{{ targetText(comment.target) }}</span>
                      <el-button v-if="!comment.resolvedAt" size="small" text type="primary"
                        aria-label="把这条讨论标为已处理" @click="resolveComment(comment)">标为已处理</el-button>
                      <span v-else class="list-row-meta">已处理 · {{ comment.resolvedBy || '' }}</span>
                    </div>
                  </div>
                </div>
              </el-card>
            </el-col>
          </el-row>
        </template>
      </div>`,
    setup() {
      const summary = ref({}); const data = ref({});
      const taskId = ref('');
      const tasks = computed(() => Array.isArray(summary.value.tasks) ? summary.value.tasks : []);
      const errorText = computed(() => summary.value.__error ? ('任务读取失败：' + summary.value.__error)
        : (data.value.__error ? ('验收数据读取失败：' + data.value.__error) : ''));
      const statCards = computed(() => {
        const s = data.value.summary || {};
        return [
          { label: '检查项', value: s.total ?? 0 }, { label: '通过', value: s.passed ?? 0 },
          { label: '打回 / 阻断', value: (s.failed ?? 0) + (s.blocked ?? 0) }, { label: '待评审', value: s.pending ?? 0 },
        ];
      });
      const planLine = computed(() => data.value.plan ? ('等级 ' + data.value.plan.level + ' · 版本 ' + data.value.plan.revision) : '未锁定');
      const shortHash = computed(() => data.value.plan ? String(data.value.plan.hash).slice(0, 12) : '—');
      const crewRows = computed(() => {
        const crew = data.value.crew; if (!crew) return [];
        return [
          { key: 'reviewer', label: '逐项评审', agent: (crew.reviewer && crew.reviewer.agentKey) || '未配置（沿用服务式验收）' },
          { key: 'standard', label: '标准起草', agent: (crew.standardDrafter && crew.standardDrafter.agentKey) || '未配置' },
          { key: 'inspector', label: '周期巡检', agent: (crew.inspector && crew.inspector.agentKey) || '未配置' },
        ];
      });
      const statusText = s => ({ passed: '通过', failed: '打回', blocked: '阻断', pending: '待评审' }[s] || s);
      const statusTag = s => ({ passed: 'success', failed: 'danger', blocked: 'warning', pending: 'info' }[s] || 'info');
      const overallText = s => ({ passed: '全部通过', partial: '部分打回', blocked: '受阻' }[s] || s);
      // 第六十四轮：证据媒体徽标（截图 / 日志 / 自撰，带颜色区分）。
      const evidenceMedia = s => ({
        captured: { label: '截图', tone: 'blue' }, imported: { label: '日志', tone: 'slate' }, authored: { label: '自撰', tone: 'amber' },
      }[s] || { label: s || '无', tone: 'info' });
      // ---- 第四十一轮：区域点选 + 报告内讨论 -------------------------------
      // 区域只是定位信息，讨论只是旁听席：两者都不参与就绪判定与人签。
      const picked = ref(null);          // { itemId, index }；index 为 null 表示挂在整项
      const thread = ref([]);
      const threadDigest = ref({ total: 0, unresolved: 0, byItem: {} });
      const draft = ref('');
      const posting = ref(false);
      const pickedItem = computed(() => picked.value ? (data.value.items || []).find(row => row.id === picked.value.itemId) || null : null);
      const pickedRegions = computed(() => (pickedItem.value && pickedItem.value.regions) || []);
      const pickedLabel = computed(() => {
        if (!pickedItem.value) return '未选择检查项';
        const index = picked.value && picked.value.index;
        return pickedItem.value.name + (index === null || index === undefined ? '（整项）' : ' · 区域 ' + (index + 1));
      });
      const boxScale = computed(() => {
        const regions = pickedRegions.value;
        if (!regions.length) return 1;
        // 归一化坐标（0..1）直接用；像素坐标按本项最大范围等比缩放。
        return Math.max(1, ...regions.map(region => Math.max(region.x + region.width, region.y + region.height)));
      });
      const boxStyle = region => ({
        left: (region.x / boxScale.value * 100) + '%', top: (region.y / boxScale.value * 100) + '%',
        width: (region.width / boxScale.value * 100) + '%', height: (region.height / boxScale.value * 100) + '%',
      });
      const pickedRegionNote = computed(() => {
        const index = picked.value && picked.value.index;
        if (index === null || index === undefined) return '选中一项后可以点框定位到具体区域；也可以直接讨论整项。';
        const region = pickedRegions.value[index];
        if (!region) return '该区域不在本项证据里。';
        const note = region.note ? '：' + region.note : '';
        return '区域 ' + (index + 1) + ' 坐标 ' + region.x + ',' + region.y + ' · ' + region.width + '×' + region.height + note;
      });
      const targetLabel = computed(() => {
        if (!picked.value) return '整份报告';
        const item = pickedItem.value;
        if (!item) return '整份报告';
        const index = picked.value.index;
        return item.name + (index === null || index === undefined ? '' : ' · 区域 ' + (index + 1));
      });
      const targetText = target => {
        if (!target || target.kind === 'report') return '整份报告';
        const item = (data.value.items || []).find(row => row.id === target.itemId);
        const name = item ? item.name : target.itemId;
        return target.kind === 'region' ? name + ' · 区域 ' + (Number(target.regionIndex) + 1) : name;
      };
      const pickRegion = (item, index) => { if (item) picked.value = { itemId: item.id, index }; };
      const pickItem = item => { if (item) picked.value = { itemId: item.id, index: null }; };
      const pickReport = () => { picked.value = null; };
      const loadDiscussion = async () => {
        if (!taskId.value) { thread.value = []; threadDigest.value = { total: 0, unresolved: 0, byItem: {} }; return; }
        const result = await safe('v06-acceptance-discussion-list', { taskId: taskId.value });
        if (result.__error) { thread.value = []; return; }
        thread.value = Array.isArray(result.comments) ? result.comments : [];
        threadDigest.value = result.digest || { total: 0, unresolved: 0, byItem: {} };
      };
      const addComment = async () => {
        const body = draft.value.trim();
        if (!body || !taskId.value) return;
        const index = picked.value && picked.value.index;
        const target = !picked.value ? { kind: 'report' }
          : index === null || index === undefined
            ? { kind: 'item', itemId: picked.value.itemId }
            : { kind: 'region', itemId: picked.value.itemId, regionIndex: index };
        posting.value = true;
        try {
          await api('v06-acceptance-discussion-add', { taskId: taskId.value, target, body });
          draft.value = '';
          ElementPlus.ElMessage.success('已记录讨论（不改变判定）');
          await loadDiscussion();
        } catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
        finally { posting.value = false; }
      };
      const resolveComment = async comment => {
        try {
          await api('v06-acceptance-discussion-resolve', { taskId: taskId.value, commentId: comment.id });
          await loadDiscussion();
        } catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
      };
      const load = async () => {
        picked.value = null; draft.value = '';
        if (!taskId.value) { data.value = {}; thread.value = []; return; }
        data.value = await safe('v06-acceptance-workbench', { taskId: taskId.value });
        await loadDiscussion();
      };
      onMounted(async () => {
        summary.value = await safe('view-summary', { limit: 50 });
        if (tasks.value.length) { taskId.value = tasks.value[0].id; await load(); }
      });
      return { summary, data, taskId, tasks, errorText, statCards, planLine, shortHash, crewRows,
        statusText, statusTag, overallText, evidenceMedia, load, fmtTime, dutyText,
        picked, pickedItem, pickedRegions, pickedLabel, pickedRegionNote, boxStyle,
        thread, threadDigest, draft, posting, targetLabel, targetText,
        pickRegion, pickItem, pickReport, addComment, resolveComment };
    },
  };

  // ---------------------------------------------------------------- 组织视图
  // 团队共用一份上下文底座；在它之上按职能配置三层座位。层是配置不是骨架。
  const OrganizationView = {
    template: `
      <div>
        <el-alert v-if="data.__error" :title="'组织数据读取失败：' + data.__error" type="warning" :closable="false" style="margin-bottom:14px" />
        <el-row :gutter="14" style="margin-bottom:14px">
          <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="6">
            <el-card shadow="never"><div class="stat"><div class="stat-num">{{ card.value }}</div><div class="stat-label">{{ card.label }}</div></div></el-card>
          </el-col>
        </el-row>
        <el-row :gutter="14">
          <el-col :xs="24" :md="14">
            <el-card shadow="never" class="contract-card">
              <template #header>
                <div class="card-head"><span>三层职能座位</span><span class="list-row-meta">{{ data.shape ? data.shape.label : '' }}</span></div>
              </template>
              <div class="hint-text">同一份共享现场上的三种座位；谁在这一层由编制决定，不是固定组织架构图。</div>
              <div v-for="layer in layers" :key="layer.key" class="layer-block">
                <div class="list-row-head">
                  <span class="list-row-title">{{ layer.label }}</span>
                  <el-tag size="small" :type="layer.configured ? 'success' : 'info'" effect="light">{{ layer.configured ? (layer.agents.length + ' 个 Agent') : '未配置' }}</el-tag>
                </div>
                <div class="list-row-detail">{{ layer.hint }}</div>
                <div v-if="layer.agents.length" class="agent-chips">
                  <el-tag v-for="agent in layer.agents" :key="agent.key + layer.key" size="small" effect="plain">
                    {{ agent.label }}<span class="hint-text" style="margin-left:6px">{{ agent.responsibilities.map(dutyText).join(' / ') }}</span>
                  </el-tag>
                </div>
                <div v-else class="hint-text">这一层当前没有配置，系统按扁平运行，不硬造。</div>
              </div>
            </el-card>
            <el-card shadow="never" class="contract-card" style="margin-top:14px">
              <template #header><div class="card-head"><span>按职能分布</span><span class="list-row-meta">任务按承接 Agent 归并</span></div></template>
              <el-table :data="domains" size="small">
                <el-table-column prop="domain" label="业务域" min-width="120" />
                <el-table-column label="主管" min-width="140">
                  <template #default="{ row }">{{ row.supervisor || '未配置（扁平）' }}</template>
                </el-table-column>
                <el-table-column prop="workers" label="执行" width="70" />
                <el-table-column prop="reviewers" label="验收" width="70" />
                <el-table-column prop="tasks" label="任务" width="70" />
              </el-table>
              <div v-if="!domains.length" class="hint-text">还没有配置业务域；当前按扁平形态运行。</div>
              <div class="hint-text" style="margin-top:8px">未分配任务 {{ data.tasks ? data.tasks.unassigned : 0 }} 个；{{ data.tasks ? data.tasks.note : '' }}</div>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="10">
            <el-card shadow="never" class="contract-card">
              <template #header>团队共享上下文底座</template>
              <el-descriptions :column="1" border size="small">
                <el-descriptions-item label="引擎">{{ data.contextBase ? data.contextBase.engine : '—' }}</el-descriptions-item>
                <el-descriptions-item label="事件主干">{{ data.contextBase ? data.contextBase.events : 0 }} 条</el-descriptions-item>
                <el-descriptions-item label="知识来源 / 空间">{{ data.contextBase ? (data.contextBase.sources + ' / ' + data.contextBase.spaces) : '0 / 0' }}</el-descriptions-item>
                <el-descriptions-item label="投影">{{ data.contextBase ? data.contextBase.projections.join(' · ') : '—' }}</el-descriptions-item>
                <el-descriptions-item label="模型调用">{{ data.contextBase ? data.contextBase.modelCalls : 0 }}</el-descriptions-item>
              </el-descriptions>
              <div class="hint-text" style="margin-top:8px">{{ data.contextBase ? data.contextBase.note : '' }}</div>
            </el-card>
            <el-card shadow="never" class="contract-card" style="margin-top:14px">
              <template #header>任务分布</template>
              <div class="agent-chips">
                <el-tag v-for="(count, phase) in phaseRows" :key="phase" size="small" effect="plain">{{ phaseText(phase) }} {{ count }}</el-tag>
              </div>
              <div v-for="row in agentRows" :key="row.agent" class="list-row">
                <div class="list-row-head"><span class="list-row-title">{{ row.agent }}</span><span class="list-row-meta">{{ row.count }} 个任务</span></div>
              </div>
              <div v-if="!agentRows.length" class="hint-text">当前可见范围内还没有承接中的任务。</div>
            </el-card>
            <el-card shadow="never" class="contract-card" style="margin-top:14px">
              <template #header>
                <div class="card-head"><span>成员与 Agent 绑定</span><el-tag v-if="!members.__error" size="small" effect="plain">{{ bindingRows.length }} 位成员</el-tag></div>
              </template>
              <el-alert v-if="members.__error" :title="'读取失败：' + members.__error" type="info" :closable="false" />
              <template v-else>
                <div v-for="u in bindingRows" :key="u.id" class="list-row">
                  <div class="list-row-head">
                    <span class="list-row-title">{{ u.name }}</span>
                    <el-tag v-if="u.agent" size="small" type="success" effect="light">{{ u.agent }}</el-tag>
                    <span v-else class="list-row-meta">未绑定个人 Agent</span>
                  </div>
                </div>
                <div v-if="!bindingRows.length" class="hint-text">还没有可展示的成员。</div>
                <div class="hint-text" style="margin-top:6px">每位成员绑定独立的个人 Agent 资料身份，不能复用他人身份。</div>
              </template>
            </el-card>
            <el-card shadow="never" class="contract-card" style="margin-top:14px">
              <template #header>组织原则</template>
              <div v-for="note in notes" :key="note" class="list-row-detail">· {{ note }}</div>
            </el-card>
          </el-col>
        </el-row>
      </div>`,
    setup() {
      const data = ref({});
      const layers = computed(() => Array.isArray(data.value.layers) ? data.value.layers : []);
      const domains = computed(() => Array.isArray(data.value.domains) ? data.value.domains : []);
      const notes = computed(() => Array.isArray(data.value.notes) ? data.value.notes : []);
      const agentRows = computed(() => data.value.tasks && Array.isArray(data.value.tasks.byAgent) ? data.value.tasks.byAgent : []);
      const phaseRows = computed(() => data.value.tasks && data.value.tasks.byPhase ? data.value.tasks.byPhase : {});
      const statCards = computed(() => {
        const agents = new Set(); for (const layer of layers.value) for (const agent of layer.agents) agents.add(agent.key);
        return [
          { label: '共享事件', value: data.value.contextBase ? data.value.contextBase.events : 0 },
          { label: '知识来源', value: data.value.contextBase ? data.value.contextBase.sources : 0 },
          { label: '在岗 Agent', value: agents.size },
          { label: '业务域', value: domains.value.length },
        ];
      });
      const phaseText = p => ({ intake: '待接入', dispatched: '已派单', in_progress: '进行中', review: '待评审',
        accepted: '已验收', closed: '已结束', draft: '草稿', waiting: '等待中' }[p] || p);
      const members = ref({});
      const bindingRows = computed(() => {
        const users = Array.isArray(members.value.users) ? members.value.users : [];
        const bindings = members.value.bindings || {};
        return users.map(u => ({ id: u.id, name: u.name, agent: bindings[u.id] || '' }));
      });
      onMounted(async () => {
        const [o, m] = await Promise.all([safe('organization-view'), safe('team-members')]);
        data.value = o; members.value = m;
      });
      return { data, layers, domains, notes, agentRows, phaseRows, statCards, phaseText, dutyText, members, bindingRows };
    },
  };

  // ---------------------------------------------------------------- 服务视图
  const ServicesView = {
    props: ['session'],
    template: `
      <div>
        <el-row :gutter="14">
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never">
              <template #header>本机服务状态</template>
              <el-alert v-if="data.__error" :title="'读取失败：' + data.__error" type="warning" :closable="false" />
              <el-table v-else :data="services" size="default">
                <el-table-column prop="name" label="服务" min-width="150">
                  <template #default="{ row }">{{ clean(row.name) }}</template>
                </el-table-column>
                <el-table-column label="状态" width="96">
                  <template #default="{ row }">
                    <el-tag :type="stateTag(row.state)" effect="light">{{ stateText(row.state) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="说明（实时探测）" min-width="260" show-overflow-tooltip>
                  <template #default="{ row }">{{ clean(row.detail || row.setup || '') }}<a v-if="row.url" :href="row.url" target="_blank" rel="noopener" style="margin-left:6px">入口</a></template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-card shadow="never">
              <template #header>系统状态</template>
              <pre class="code-block">{{ text }}</pre>
            </el-card>
          </el-col>
        </el-row>
        <el-row :gutter="14">
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>
                <div class="card-head">
                  <span>出站投递健康</span>
                  <el-tag v-if="retry" size="small" :type="retryTag(retry.verdict)" effect="light">{{ retryText(retry.verdict) }}</el-tag>
                </div>
              </template>
              <el-alert v-if="retry && retry.__error" :title="'读取失败：' + retry.__error" type="info" :closable="false" />
              <template v-else-if="retry">
                <div class="agent-chips">
                  <el-tag v-for="cell in retry.states" :key="cell.state" size="small" effect="plain">{{ cell.label }} {{ cell.count }}</el-tag>
                </div>
                <el-descriptions :column="2" border size="small" style="margin-top:10px">
                  <el-descriptions-item label="待投递">{{ retry.pending.count }}</el-descriptions-item>
                  <el-descriptions-item label="最久等待">{{ retry.pending.oldestMinutes === null ? '—' : retry.pending.oldestMinutes + ' 分钟' }}</el-descriptions-item>
                </el-descriptions>
                <div v-if="retry.pending.stuck.length" class="hint-text" style="margin-top:8px">
                  超过 {{ retry.pending.stuckThresholdMinutes }} 分钟未投出：{{ retry.pending.stuck.length }} 条
                </div>
                <div v-if="retry.failures.length" class="hint-text" style="margin-top:8px">
                  近 24 小时失败：{{ retry.failures.map(f => f.channel + ' ' + f.count + ' 次').join('；') }}
                </div>
                <div v-for="note in retry.notes" :key="note" class="hint-text">· {{ note }}</div>
              </template>
              <div v-else class="hint-text">需要管理权限才能看出站队列。</div>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>
                <div class="card-head">
                  <span>事件收件箱</span>
                  <el-tag size="small" type="info" effect="light">{{ inbox && inbox.enabled ? (inbox.pending + ' 条待分流') : '未启用' }}</el-tag>
                </div>
              </template>
              <el-alert v-if="inbox && inbox.__error" :title="'读取失败：' + inbox.__error" type="info" :closable="false" />
              <template v-else-if="inbox && inbox.enabled">
                <el-table :data="inbox.counts" size="small">
                  <el-table-column prop="source" label="来源" min-width="90" />
                  <el-table-column prop="type" label="类型" min-width="110" />
                  <el-table-column prop="state" label="状态" width="90" />
                  <el-table-column prop="count" label="条数" width="70" />
                </el-table>
                <div v-if="!inbox.counts.length" class="hint-text">还没有外部事件进来。</div>
                <div class="hint-text" style="margin-top:8px">收件箱只收事实，建不建任务由例行规则的 when 决定；验收仍由原发起人在原会话确认。</div>
              </template>
              <div v-else class="hint-text">入站面按「登记了来源」开启：没登记来源时没有入口，登记后由例行规则的 when 决定开不开单。</div>
            </el-card>
          </el-col>
        </el-row>
        <el-row :gutter="14">
          <el-col :xs="24" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>
                <div class="card-head">
                  <span>通道体检</span>
                  <el-tag v-if="channels && channels.verdict" size="small" :type="channelTag(channels.verdict)" effect="light">{{ channelText(channels.verdict) }}</el-tag>
                </div>
              </template>
              <el-alert v-if="channels && channels.__error" :title="'读取失败：' + channels.__error" type="info" :closable="false" />
              <template v-else-if="channels && channels.checks">
                <el-table :data="channels.checks" size="small">
                  <el-table-column prop="name" label="通道" min-width="110" />
                  <el-table-column label="方向" width="76">
                    <template #default="{ row }">{{ directionText(row.direction) }}</template>
                  </el-table-column>
                  <el-table-column label="状态" width="86">
                    <template #default="{ row }">
                      <el-tag :type="channelTag(row.verdict)" effect="light" size="small">{{ channelText(row.verdict) }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="依据" min-width="240">
                    <template #default="{ row }">
                      <div v-for="fact in row.facts" :key="fact" class="hint-text" style="margin:0">· {{ clean(fact) }}</div>
                    </template>
                  </el-table-column>
                  <el-table-column label="缺什么 / 下一步" min-width="260">
                    <template #default="{ row }">
                      <div v-for="item in row.missing" :key="item" class="hint-text" style="margin:0;color:#d9534f">· {{ clean(item) }}</div>
                      <div class="hint-text" style="margin:0">{{ clean(row.next) }}</div>
                    </template>
                  </el-table-column>
                </el-table>
                <div class="hint-text" style="margin-top:8px">{{ clean(channels.note || '') }}</div>
                <div class="hint-text">体检只读配置与本地台账，不发任何外部请求；「部分可用」不是故障，「未配置」也不算。</div>
              </template>
              <div v-else class="hint-text">需要管理权限才能看通道体检。</div>
            </el-card>
          </el-col>
        </el-row>
        <el-row :gutter="14">
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>
                <div class="card-head"><span>Agent 服务网络</span><el-tag v-if="!network.__error" size="small" effect="plain">{{ serviceProfiles.length }} 个服务</el-tag></div>
              </template>
              <el-alert v-if="network.__error" :title="'读取失败：' + network.__error" type="info" :closable="false" />
              <template v-else>
                <div v-for="p in serviceProfiles" :key="p.id" class="list-row">
                  <div class="list-row-head">
                    <span class="list-row-title">{{ p.name || p.key }}</span>
                    <el-tag size="small" :type="p.enabled ? 'success' : 'info'" effect="light">{{ p.kind === 'personal' ? '个人' : '公共' }}{{ p.enabled ? '' : ' · 停用' }}</el-tag>
                  </div>
                  <div class="list-row-detail">{{ p.actorKey || '' }}<template v-if="p.version"> · v{{ String(p.version).slice(0, 8) }}</template></div>
                </div>
                <div v-if="!serviceProfiles.length" class="hint-text">还没有登记 Agent 服务。</div>
              </template>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12" style="margin-bottom:14px">
            <el-card shadow="never" class="contract-card">
              <template #header>
                <div class="card-head"><span>定时任务与唤醒</span><el-tag size="small" :type="scheduler.enabled ? 'success' : 'info'" effect="light">{{ scheduler.enabled ? '已启用' : '未启用' }}</el-tag></div>
              </template>
              <el-alert v-if="scheduler.__error" :title="String(scheduler.__error).includes('权限') ? '需要管理权限才能看定时任务' : ('读取失败：' + scheduler.__error)" type="info" :closable="false" />
              <template v-else>
                <div v-for="r in routines" :key="r.name || r.id" class="list-row">
                  <div class="list-row-head"><span class="list-row-title">{{ r.name || r.id }}</span><span class="list-row-meta">{{ r.next ? fmtTime(r.next) : '' }}</span></div>
                  <div class="list-row-detail" v-if="r.group">分组 {{ r.group }}</div>
                </div>
                <div v-if="!routines.length" class="hint-text">还没有定时任务。</div>
                <div v-if="wakes.length" class="field-hint" style="margin-top:8px">等唤醒 {{ wakes.length }} 条</div>
              </template>
            </el-card>
          </el-col>
        </el-row>

        <el-card shadow="never" class="contract-card">
          <template #header>
            <div class="card-head">
              <span>接入台 · 本机执行端</span>
              <div style="display:flex;gap:8px;align-items:center">
                <el-tag v-if="probe.summary" size="small" type="success" effect="plain">{{ probe.summary.ready }} 就绪</el-tag>
                <el-tag v-if="probe.summary && probe.summary.actionable" size="small" type="warning" effect="plain">{{ probe.summary.actionable }} 可接入</el-tag>
                <el-button size="small" @click="rescan" :loading="scanning">重新扫描</el-button>
              </div>
            </div>
          </template>
          <el-alert v-if="probe.__error" :title="'扫描失败：' + probe.__error" type="warning" :closable="false" />
          <template v-else>
            <div class="hint-text">
              扫描这台机器上已安装的执行端<template v-if="probe.device">（{{ probe.device.host }} · {{ probe.device.platform }}）</template>。
              接入只登记「这台机器上有一个能跑的 CLI」，不改它的权限——<b>工作目录不是安全沙箱</b>，先跑只读任务再接写。
            </div>
            <div v-for="e in shownEntries" :key="e.key" class="exec-row">
              <div class="exec-row-main">
                <span class="exec-name">{{ e.name }}</span>
                <el-tag size="small" :type="onbTag(e.state)" effect="light">{{ onbText(e.state) }}</el-tag>
                <span class="exec-ver">{{ e.version || '—' }}</span>
                <span v-if="e.signedIn === true" class="exec-sign">已登录</span>
                <span v-else-if="e.signedIn === false" class="exec-sign exec-sign-quiet">未见登录</span>
              </div>
              <div class="exec-row-act">
                <el-button v-if="e.state === 'needs-enable'" size="small" type="primary" plain :loading="busy === e.key" @click="enable(e)">启用</el-button>
                <el-button v-else-if="e.state === 'needs-register'" size="small" type="primary" plain :loading="busy === e.key" @click="register(e)">接入</el-button>
                <el-button v-else-if="e.state === 'needs-binding'" size="small" text type="warning" @click="openDoc(e)">去平台注册</el-button>
                <el-button v-else-if="e.state === 'not-installed'" size="small" text @click="openDoc(e)">怎么装</el-button>
                <span v-else class="exec-ready-hint">可派单</span>
              </div>
            </div>
            <el-button v-if="hiddenCount" text size="small" style="margin-top:6px" @click="showAll = !showAll">
              {{ showAll ? '收起未安装' : ('显示未安装（' + hiddenCount + '）') }}
            </el-button>
          </template>
        </el-card>

        <el-card shadow="never" class="contract-card" style="margin-top:14px">
          <template #header>
            <div class="card-head">
              <span>Skill 生效体检</span>
              <div style="display:flex;gap:8px;align-items:center">
                <el-tag v-if="skillSummary" size="small" :type="skillSummary.degraded ? 'warning' : 'success'" effect="plain">
                  {{ skillSummary.totalEffective }}/{{ skillSummary.totalDeclared }} 条生效
                </el-tag>
                <el-button size="small" @click="loadSkillAudit" :loading="skillLoading">重新体检</el-button>
              </div>
            </div>
          </template>
          <div class="hint-text">
            判定只认一件事：最终 prompt 里有没有那段指令。配置写了不算生效，日志写了也不算。
            <b>编译一次要几秒</b>，所以只在点「重新体检」时跑。
          </div>
          <el-alert v-if="skill.__error" :title="'体检失败：' + skill.__error" type="warning" :closable="false" />
          <div v-for="a in skillAudits" :key="a.agentKey" class="exec-row">
            <div class="exec-row-main">
              <span class="exec-name">{{ a.name }}</span>
              <el-tag size="small" :type="a.missing.length || a.unknown.length ? 'warning' : 'success'" effect="light">
                {{ a.missing.length || a.unknown.length ? '有缺口' : '全部生效' }}
              </el-tag>
              <span class="exec-ver">{{ a.verdict }}</span>
            </div>
            <div class="exec-row-act">
              <span class="exec-ready-hint">{{ a.promptLength }} 字 · {{ a.toolCount }} 工具</span>
            </div>
          </div>
          <div v-if="!skillAudits.length && !skillLoading" class="field-hint">还没有体检结果，点右上角「重新体检」。</div>
        </el-card>
      </div>`,
    setup() {
      const data = ref({}), system = ref({}), retry = ref(null), inbox = ref(null), channels = ref(null);
      const network = ref({}); const scheduler = ref({});
      const serviceProfiles = computed(() => (Array.isArray(network.value.profiles) ? network.value.profiles : []));
      const routines = computed(() => (Array.isArray(scheduler.value.routines) ? scheduler.value.routines : []));
      const wakes = computed(() => (Array.isArray(scheduler.value.wakes) ? scheduler.value.wakes : []));
      const services = computed(() => Array.isArray(data.value.services) ? data.value.services : []);
      const text = computed(() => system.value.__error ? '读取失败：' + system.value.__error : JSON.stringify(system.value, null, 2));
      // 第三十四轮修复：service-status 返回的是 state（connected / degraded / unavailable），
      // 旧代码读不存在的 running 布尔，导致所有服务永远显示「已停止」、说明列为空。
      const stateText = state => ({ connected: '已接通', degraded: '已降级', unavailable: '未接通' }[state] || state || '未知');
      const stateTag = state => ({ connected: 'success', degraded: 'warning', unavailable: 'info' }[state] || 'info');
      const retryText = v => ({ healthy: '正常', backlog: '有积压', failing: '在失败' }[v] || v);
      const retryTag = v => ({ healthy: 'success', backlog: 'warning', failing: 'danger' }[v] || 'info');
      const channelText = v => ({ ready: '可用', partial: '部分可用', blocked: '不可用', off: '未配置', degraded: '有缺口' }[v] || v);
      const channelTag = v => ({ ready: 'success', partial: 'warning', blocked: 'danger', off: 'info', degraded: 'warning' }[v] || 'info');
      const directionText = v => ({ inbound: '收', outbound: '发', both: '收+发' }[v] || v);
      onMounted(async () => {
        data.value = await safe('service-status'); system.value = await safe('system-status');
        // 这三项要管理权限：只读角色会拿到 403，如实显示成「看不到」而不是报错。
        retry.value = await safe('retry-health');
        inbox.value = await safe('event-inbox-status');
        channels.value = await safe('channel-health');
        // 第六十六轮：服务网络 + 定时调度（定时任务需 manager，viewer 如实 403）。
        network.value = await safe('agent-services');
        scheduler.value = await safe('scheduler-status');
        await rescan();
      });
      // 第六十八轮 · 接入台（对标 LobeHub Connect External Agents）：
      // 已安装的排在前面，未安装的折叠——目录很长，噪声不该盖过可行动的项。
      const probe = ref({}); const scanning = ref(false); const showAll = ref(false); const busy = ref('');
      const shownEntries = computed(() => {
        const list = Array.isArray(probe.value.entries) ? probe.value.entries : [];
        if (showAll.value) return list;
        return list.filter(e => e.state !== 'not-installed');
      });
      const hiddenCount = computed(() => {
        if (showAll.value) return 0;
        const list = Array.isArray(probe.value.entries) ? probe.value.entries : [];
        return list.filter(e => e.state === 'not-installed').length;
      });
      const rescan = async () => {
        scanning.value = true;
        probe.value = await safe('agent-onboarding-probe');
        scanning.value = false;
      };
      // 第七十一轮 · Skill 生效体检：编译一次几秒，只在按钮触发时跑，不随页面加载。
      const skill = ref({}); const skillLoading = ref(false);
      const skillAudits = computed(() => Array.isArray(skill.value.audits) ? skill.value.audits : []);
      const skillSummary = computed(() => skill.value.summary ?? null);
      const loadSkillAudit = async () => {
        skillLoading.value = true;
        skill.value = await safe('skill-audit', {});
        skillLoading.value = false;
      };
      const onbText = s => ({ ready: '就绪', 'needs-enable': '待启用', 'needs-binding': '待注册', 'needs-register': '待接入', 'not-installed': '未安装' }[s] || s || '未知');      const onbTag = s => ({ ready: 'success', 'needs-enable': 'warning', 'needs-binding': 'warning', 'needs-register': 'primary', 'not-installed': 'info' }[s] || 'info');
      const openDoc = e => { if (e && e.docs) window.open(e.docs, '_blank', 'noopener'); };
      const enable = async e => {
        busy.value = e.key;
        try {
          const r = await api('agent-onboarding-enable', { key: e.key, enabled: true });
          ElementPlus.ElMessage.success((r.response && r.response.note) || '已启用');
          await rescan();
        } catch (err) { ElementPlus.ElMessage.error(String(err.message || err)); }
        finally { busy.value = ''; }
      };
      const register = async e => {
        let ok = true;
        try {
          await ElementPlus.ElMessageBox.confirm(
            `把「${e.name}」登记进执行端编制？会写入 config.json（先自动备份）。登记后还需要到平台注册拿到 paperclipId 才能派单。`,
            '接入执行端', { type: 'warning', confirmButtonText: '接入', cancelButtonText: '取消' });
        } catch { ok = false; }
        if (!ok) return;
        busy.value = e.key;
        try {
          const r = await api('agent-onboarding-register', { key: e.key });
          ElementPlus.ElMessage.success((r.response && r.response.note) || '已登记');
          await rescan();
        } catch (err) { ElementPlus.ElMessage.error(String(err.message || err)); }
        finally { busy.value = ''; }
      };
      return { data, services, text, retry, inbox, channels, clean, stateText, stateTag,
        retryText, retryTag, channelText, channelTag, directionText,
        network, scheduler, serviceProfiles, routines, wakes, fmtTime,
        probe, scanning, showAll, busy, shownEntries, hiddenCount, rescan, onbText, onbTag, enable, register, openDoc,
        skill, skillLoading, skillAudits, skillSummary, loadSkillAudit };
    },
  };

  // ---------------------------------------------------------------- 我的配置（每用户自己的）
  const SettingsView = {
    props: ['session'],
    emits: ['theme'],
    template: `
      <div>
        <el-row :gutter="14">
          <el-col :xs="24" :md="14" style="margin-bottom:14px">
            <el-card shadow="never">
              <template #header>我的偏好</template>
              <el-form label-width="110px" style="max-width:560px">
                <el-form-item label="默认视图">
                  <el-select v-model="form.defaultView" style="width:240px">
                    <el-option v-for="v in views" :key="v.id" :value="v.id" :label="v.title" />
                  </el-select>
                </el-form-item>
                <el-form-item label="界面主题">
                  <el-radio-group v-model="form.theme" @change="applyTheme">
                    <el-radio value="light">浅色</el-radio><el-radio value="dark">深色</el-radio>
                  </el-radio-group>
                </el-form-item>
                <el-form-item label="刷新间隔">
                  <el-input-number v-model="form.refreshSeconds" :min="10" :max="600" :step="10" /> 秒
                </el-form-item>
                <el-divider content-position="left">通知</el-divider>
                <el-form-item label="任务状态变化"><el-switch v-model="form.notify.taskPhaseChange" /></el-form-item>
                <el-form-item label="有待答问题"><el-switch v-model="form.notify.hitlWaiting" /></el-form-item>
                <el-form-item label="回执就绪"><el-switch v-model="form.notify.receiptReady" /></el-form-item>
                <el-divider content-position="left">模型偏好（后续接入）</el-divider>
                <el-form-item label="模型名称"><el-input v-model="form.model.label" placeholder="如 apple-vision-local" /></el-form-item>
                <el-form-item label="端点"><el-input v-model="form.model.endpoint" placeholder="OpenAI 兼容端点，留空走系统默认" /></el-form-item>
                <el-form-item label="API Key">
                  <el-input v-model="form.model.apiKey" type="password" show-password :placeholder="form.model.apiKeySet ? '已设置（输入新值替换）' : '未设置'" />
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" :loading="saving" @click="save">保存我的配置</el-button>
                </el-form-item>
              </el-form>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="10">
            <el-card shadow="never">
              <template #header>修改口令</template>
              <el-form label-width="90px">
                <el-form-item label="新口令"><el-input v-model="pass.new" type="password" show-password placeholder="至少 8 位" /></el-form-item>
                <el-form-item label="确认"><el-input v-model="pass.again" type="password" show-password /></el-form-item>
                <el-form-item><el-button :loading="changing" @click="changePass">修改口令</el-button></el-form-item>
              </el-form>
              <el-alert title="口令只属于你；管理员也无法查看，只能重置。" type="info" :closable="false" />
            </el-card>
          </el-col>
        </el-row>
      </div>`,
    setup(props, { emit }) {
      const form = reactive(JSON.parse(JSON.stringify(props.session?.settings ?? {})));
      if (!form.notify) form.notify = { taskPhaseChange: true, hitlWaiting: true, receiptReady: true };
      if (!form.model) form.model = { label: '', endpoint: '', apiKey: '', apiKeySet: false };
      const pass = reactive({ new: '', again: '' });
      const saving = ref(false), changing = ref(false);
      const views = VIEWS;
      const applyTheme = theme => { document.documentElement.classList.toggle('dark', theme === 'dark'); emit('theme', theme); };
      const save = async () => {
        saving.value = true;
        try {
          await api('settings-set', { defaultView: form.defaultView, theme: form.theme, refreshSeconds: form.refreshSeconds,
            notify: { ...form.notify }, model: { label: form.model.label ?? '', endpoint: form.model.endpoint ?? '', apiKey: form.model.apiKey ?? '' } });
          if (form.model.apiKey && !form.model.apiKey.includes('*')) form.model.apiKey = '';
          ElementPlus.ElMessage.success('已保存你的配置');
        } catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
        finally { saving.value = false; }
      };
      const changePass = async () => {
        if (pass.new.length < 8) { ElementPlus.ElMessage.warning('口令至少 8 位'); return; }
        if (pass.new !== pass.again) { ElementPlus.ElMessage.warning('两次输入不一致'); return; }
        changing.value = true;
        try { await api('admin-password-change', { newPassword: pass.new }); pass.new = pass.again = ''; ElementPlus.ElMessage.success('口令已修改'); }
        catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
        finally { changing.value = false; }
      };
      return { form, pass, saving, changing, views, applyTheme, save, changePass };
    },
  };

  // ---------------------------------------------------------------- 管理视图（按权限分区）
  const AdminView = {
    props: ['session'],
    template: `
      <div>
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span>管理（{{ session.roleLabel }} {{ session.username }}）</span>
              <span class="field-hint">管理员也是用户：业务视图与「我的配置」照常使用</span>
            </div>
          </template>
          <el-tabs v-model="tab">
            <el-tab-pane v-if="can('accounts-manage')" label="账号与角色" name="accounts">
              <div style="margin-bottom:10px"><el-button size="small" type="primary" @click="newAccount.visible = true">新建账号</el-button></div>
              <el-table :data="accounts" size="default">
                <el-table-column prop="username" label="用户名" width="140" />
                <el-table-column label="角色" width="120">
                  <template #default="{ row }"><el-tag :type="row.role === 'owner' ? 'danger' : row.role === 'admin' ? 'warning' : 'primary'" effect="light">{{ row.roleLabel }}</el-tag></template>
                </el-table-column>
                <el-table-column label="状态" width="90">
                  <template #default="{ row }"><el-tag :type="row.disabled ? 'info' : 'success'" effect="plain">{{ row.disabled ? '已停用' : '在岗' }}</el-tag></template>
                </el-table-column>
                <el-table-column prop="createdAt" label="创建时间" width="180"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
                <el-table-column label="操作" min-width="220">
                  <template #default="{ row }">
                    <el-select :model-value="row.role" size="small" style="width:110px" @change="v => changeRole(row, v)" :disabled="row.username === session.username">
                      <el-option v-for="r in roles" :key="r" :value="r" :label="roleLabels[r] || r" />
                    </el-select>
                    <el-button size="small" text :type="row.disabled ? 'success' : 'danger'" @click="toggleDisabled(row)" :disabled="row.username === session.username && !row.disabled">
                      {{ row.disabled ? '启用' : '停用' }}
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane v-if="can('users-settings-view') || can('accounts-manage')" label="用户配置总览" name="users">
              <el-alert title="每个用户都可以配置自己的部分；这里只读总览全部用户的配置（API Key 已打码）。修改仍限本人。" type="info" :closable="false" style="margin-bottom:10px" />
              <el-table :data="userSettings" size="default">
                <el-table-column type="expand">
                  <template #default="{ row }"><pre class="code-block">{{ JSON.stringify(row.settings, null, 2) }}</pre></template>
                </el-table-column>
                <el-table-column prop="username" label="用户" width="140" />
                <el-table-column label="角色" width="110"><template #default="{ row }">{{ roleLabels[row.role] || row.role }}</template></el-table-column>
                <el-table-column label="默认视图" width="100"><template #default="{ row }">{{ row.settings.defaultView }}</template></el-table-column>
                <el-table-column label="主题" width="80"><template #default="{ row }">{{ row.settings.theme === 'dark' ? '深色' : '浅色' }}</template></el-table-column>
                <el-table-column label="刷新" width="90"><template #default="{ row }">{{ row.settings.refreshSeconds }}s</template></el-table-column>
                <el-table-column label="模型" min-width="160"><template #default="{ row }">{{ row.settings.model?.label || '系统默认' }}{{ row.settings.model?.apiKeySet ? '（密钥已设）' : '' }}</template></el-table-column>
                <el-table-column label="配置更新" width="170"><template #default="{ row }">{{ fmtTime(row.updatedAt) }}</template></el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane v-if="can('users-settings-view') || can('accounts-manage')" label="角色策略" name="policy">
              <el-alert :title="policyNote" type="info" :closable="false" style="margin-bottom:10px" />
              <pre class="code-block">{{ policyText }}</pre>
            </el-tab-pane>
            <el-tab-pane v-if="can('services-control')" label="服务管理" name="services">
              <el-table :data="adminServices" size="default">
                <el-table-column prop="label" label="服务" min-width="240" />
                <el-table-column label="状态" width="100">
                  <template #default="{ row }"><el-tag :type="row.running ? 'success' : 'info'" effect="light">{{ row.running ? '运行中' : '已停止' }}</el-tag></template>
                </el-table-column>
                <el-table-column label="操作" width="220">
                  <template #default="{ row }">
                    <el-button size="small" @click="serviceControl(row.name, 'restart')">重启</el-button>
                    <el-button size="small" v-if="row.running" type="danger" plain @click="serviceControl(row.name, 'stop')">停止</el-button>
                    <el-button size="small" v-else type="success" plain @click="serviceControl(row.name, 'start')">启动</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <pre class="code-block" v-if="serviceOutput">{{ serviceOutput }}</pre>
            </el-tab-pane>
            <el-tab-pane v-if="can('knowledge-review')" label="知识审核" name="review">
              <el-alert title="确认或撤回候选知识；确认后才会被任务引用。编辑已确认的知识会自动回到待审核。确认时可选「同步提升到注入索引」——只有人审批准的知识才会出现在组织级索引里。" type="info" :closable="false" style="margin-bottom:10px" />
              <el-table :data="candidates" size="default">
                <el-table-column prop="key" label="标识" min-width="200" />
                <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
                <el-table-column prop="owner" label="归属者" width="140" />
                <el-table-column label="操作" width="260">
                  <template #default="{ row }">
                    <el-button size="small" type="success" plain @click="openReview(row, 'confirmed')">确认…</el-button>
                    <el-button size="small" type="warning" plain @click="review(row, 'withdrawn', false)">撤回</el-button>
                  </template>
                </el-table-column>
              </el-table>

              <el-divider content-position="left">知识地图与注入索引（13a · 投影体检）</el-divider>
              <el-alert title="知识地图与注入索引都是知识文档的投影（可重建，不是第二事实源）：地图回答「组织沉淀了哪些知识、断言能否查回事实源」，索引只收人审批准提升的已确认知识标题；任务输入（Context Pack）另按预算组装正文。" type="info" :closable="false" style="margin-bottom:10px" />
              <div style="margin-bottom:10px">
                <el-button size="small" :loading="wikiBusy" @click="loadWiki">体检 / 重建投影</el-button>
                <el-button size="small" :loading="dreamBusy" @click="runDreaming">离线整理：把建议登记进改进闸门</el-button>
              </div>
              <el-descriptions v-if="wikiView" :column="3" size="small" border style="margin-bottom:10px">
                <el-descriptions-item label="知识记录">{{ wikiView.records }}</el-descriptions-item>
                <el-descriptions-item label="地图页面 / 链接">{{ wikiView.wiki.pages }} / {{ wikiView.wiki.links }}</el-descriptions-item>
                <el-descriptions-item label="地图体积">{{ wikiView.wiki.bytes }} / {{ wikiView.corpusBytes }} 字节</el-descriptions-item>
                <el-descriptions-item label="悬空链接">{{ wikiView.wiki.danglingLinks.length }}</el-descriptions-item>
                <el-descriptions-item label="断言无出处">{{ wikiView.wiki.ungroundedClaims.length }}</el-descriptions-item>
                <el-descriptions-item label="索引条目 / 被裁">{{ wikiView.injected.entries.length }} / {{ wikiView.injected.omitted }}</el-descriptions-item>
              </el-descriptions>
              <el-alert v-if="wikiView && wikiView.wiki.bloated" title="知识地图体积超过原始语料：抽象为零，需要先裁剪" type="warning" :closable="false" style="margin-bottom:10px" />
              <el-table v-if="dreamResult" :data="dreamResult.proposals" size="small" style="margin-bottom:10px">
                <el-table-column prop="kind" label="建议类型" width="150" />
                <el-table-column prop="target" label="对象" min-width="200" show-overflow-tooltip />
                <el-table-column prop="reason" label="原因" min-width="300" show-overflow-tooltip />
              </el-table>
              <el-alert v-if="dreamResult" :title="'本次登记 ' + dreamResult.registered.length + ' 条候选改进（重复跳过 ' + dreamResult.skippedDuplicates + ' 条）；全部待工程闸门与真人批准，离线整理不自动采用。'" type="success" :closable="false" />
            </el-tab-pane>
            <el-tab-pane label="待答问题" name="hitl">
              <el-alert title="回答仍在飞书对话里进行；这里只读查看当前挂起的人工问题与续跑建议。" type="info" :closable="false" style="margin-bottom:10px" />
              <el-table :data="hitlPending" size="default">
                <el-table-column label="时间" width="170"><template #default="{ row }">{{ fmtTime(row.at) }}</template></el-table-column>
                <el-table-column prop="prompt" label="问题" min-width="300" show-overflow-tooltip />
                <el-table-column label="选项" min-width="160">
                  <template #default="{ row }"><el-tag v-for="c in (row.choices || [])" :key="c" size="small" style="margin-right:6px">{{ c }}</el-tag></template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane v-if="can('audit-view')" label="审计日志" name="audit">
              <el-table :data="auditEntries" size="small">
                <el-table-column label="时间" width="170"><template #default="{ row }">{{ fmtTime(row.at) }}</template></el-table-column>
                <el-table-column prop="action" label="动作" width="200" />
                <el-table-column prop="actor" label="操作者" width="130" />
                <el-table-column label="详情" min-width="260">
                  <template #default="{ row }"><span class="mono">{{ JSON.stringify({...row, at: undefined, action: undefined, actor: undefined}) }}</span></template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane v-if="can('feishu-auth')" label="飞书授权" name="feishu">
              <el-alert title="生成授权信息后，本人需要在飞书扫码确认；脚本不代替授权，也不会清空已有权限。" type="info" :closable="false" style="margin-bottom:10px" />
              <div style="margin-bottom:10px">
                <el-button size="small" @click="feishu(false)">生成授权信息 / 二维码</el-button>
                <el-button size="small" type="primary" plain @click="feishu(true)">执行授权流程</el-button>
              </div>
              <pre class="code-block">{{ feishuOutput || '尚未生成。' }}</pre>
            </el-tab-pane>
          </el-tabs>
        </el-card>

        <el-dialog v-model="newAccount.visible" title="新建账号" width="460px">
          <el-form label-width="90px">
            <el-form-item label="用户名"><el-input v-model="newAccount.username" placeholder="2-32 位字母数字_-，与你的飞书号一致最方便" /></el-form-item>
            <el-form-item label="口令"><el-input v-model="newAccount.password" type="password" show-password placeholder="至少 8 位" /></el-form-item>
            <el-form-item label="角色">
              <el-select v-model="newAccount.role" style="width:200px">
                <el-option v-for="r in roles" :key="r" :value="r" :label="roleLabels[r] + '（' + r + '）'" />
              </el-select>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="newAccount.visible = false">取消</el-button>
            <el-button type="primary" :loading="newAccount.busy" @click="createAccount">创建</el-button>
          </template>
        </el-dialog>

        <el-dialog v-model="reviewDialog.visible" title="确认知识" width="480px">
          <p style="margin:0 0 12px">{{ reviewDialog.row ? reviewDialog.row.title : '' }}</p>
          <el-checkbox v-model="reviewDialog.inject">同步提升到注入索引（组织级知识目录，仅人审批准的条目）</el-checkbox>
          <el-alert title="提升后该条目标题进入注入索引（≤200 行 / 25KB 的小指针层）；任务输入按需加载正文，不额外占预算。再次编辑会自动退出索引。" type="info" :closable="false" style="margin-top:12px" />
          <template #footer>
            <el-button @click="reviewDialog.visible = false">取消</el-button>
            <el-button type="primary" @click="confirmReview">确认</el-button>
          </template>
        </el-dialog>
      </div>`,
    setup(props) {
      const tab = ref('accounts');
      const accounts = ref([]), userSettings = ref([]), policyText = ref(''), policyNote = ref('');
      const adminServices = ref([]), serviceOutput = ref(''), auditEntries = ref([]), feishuOutput = ref('');
      const candidates = ref([]), hitlPending = ref([]);
      const newAccount = reactive({ visible: false, username: '', password: '', role: 'viewer', busy: false });
      const roles = ['owner', 'admin', 'operator', 'viewer'];
      const roleLabels = { owner: '所有者', admin: '管理员', operator: '运营', viewer: '只读' };
      const perms = computed(() => props.session?.permissions ?? []);
      const can = permission => perms.value.includes(permission);

      const loadAccounts = async () => { const r = await safe('admin-accounts'); accounts.value = r.__error ? [] : (r.accounts ?? []); };
      const loadUsers = async () => { const r = await safe('admin-users-settings'); userSettings.value = r.__error ? [] : (r.users ?? []); };
      const loadPolicy = async () => { const r = await safe('admin-policy'); policyText.value = r.policy ?? String(r.__error ?? ''); policyNote.value = r.note ?? ''; };
      const loadServices = async () => { const r = await safe('admin-services'); adminServices.value = r.__error ? [] : (r.services ?? []); };
      const loadAudit = async () => { const r = await safe('admin-audit'); auditEntries.value = r.__error ? [] : (r.entries ?? []); };
      const loadKnowledge = async () => { const r = await safe('knowledge-list'); candidates.value = (r.items ?? []).filter(i => i.state === 'candidate'); };
      const loadHitl = async () => { const r = await safe('admin-hitl'); hitlPending.value = r.__error ? [] : (r.pending ?? []); };

      const createAccount = async () => {
        newAccount.busy = true;
        try {
          await api('admin-account-create', { username: newAccount.username, password: newAccount.password, role: newAccount.role });
          ElementPlus.ElMessage.success('账号已创建'); newAccount.visible = false; newAccount.username = newAccount.password = '';
          await loadAccounts(); await loadUsers();
        } catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
        finally { newAccount.busy = false; }
      };
      const changeRole = async (row, role) => {
        try { await api('admin-account-role', { username: row.username, role }); ElementPlus.ElMessage.success('角色已变更（该用户的会话已失效，需重新登录）'); await loadAccounts(); }
        catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
      };
      const toggleDisabled = async row => {
        try { await api('admin-account-disable', { username: row.username, disabled: !row.disabled }); await loadAccounts(); }
        catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
      };
      const serviceControl = async (name, action) => {
        serviceOutput.value = '执行中…';
        const r = await safe('admin-service-control', { name, action });
        serviceOutput.value = r.__error ? ('失败：' + r.__error) : (r.output || '完成');
        await loadServices();
      };
      const review = async (row, state, inject) => {
        try { await api('admin-knowledge-review', { taskId: row.taskId, key: row.key, revision: row.revision, state, inject: inject === true }); ElementPlus.ElMessage.success(state === 'confirmed' ? '已确认' : '已撤回'); await loadKnowledge(); }
        catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
      };
      // 13a ③：确认对话框——提升到注入索引只能由人在确认这一刻显式选择。
      const reviewDialog = reactive({ visible: false, row: null, inject: false });
      const openReview = (row, state) => { if (state !== 'confirmed') return review(row, state, false); reviewDialog.row = row; reviewDialog.inject = false; reviewDialog.visible = true; };
      const confirmReview = async () => {
        const row = reviewDialog.row; reviewDialog.visible = false;
        if (row) await review(row, 'confirmed', reviewDialog.inject);
      };
      // 13a ②③④：知识地图 / 注入索引体检与离线整理（只读投影 + 候选登记）。
      const wikiView = ref(null), wikiBusy = ref(false), dreamResult = ref(null), dreamBusy = ref(false);
      const loadWiki = async () => {
        wikiBusy.value = true;
        try { const r = await safe('knowledge-wiki'); if (r.__error) ElementPlus.ElMessage.error('体检失败：' + r.__error); else wikiView.value = r; }
        finally { wikiBusy.value = false; }
      };
      const runDreaming = async () => {
        dreamBusy.value = true; dreamResult.value = null;
        try {
          const r = await api('dreaming-run', {});
          dreamResult.value = r;
          ElementPlus.ElMessage.success('已登记 ' + (r.registered ?? []).length + ' 条候选改进');
        } catch (e) { ElementPlus.ElMessage.error(String(e.message || e)); }
        finally { dreamBusy.value = false; }
      };
      const feishu = async execute => {
        feishuOutput.value = '生成中…';
        const r = await safe('admin-feishu-auth', execute ? { execute: true } : {});
        feishuOutput.value = r.__error ? ('失败：' + r.__error) : (r.output || '');
      };

      onMounted(async () => {
        const jobs = [];
        if (can('accounts-manage')) jobs.push(loadAccounts());
        if (can('users-settings-view') || can('accounts-manage')) jobs.push(loadUsers(), loadPolicy());
        if (can('services-control')) jobs.push(loadServices());
        if (can('knowledge-review') || true) jobs.push(loadKnowledge());
        jobs.push(loadHitl());
        if (can('audit-view')) jobs.push(loadAudit());
        await Promise.all(jobs);
        if (!can('accounts-manage')) tab.value = can('users-settings-view') ? 'users' : can('services-control') ? 'services' : can('knowledge-review') ? 'review' : 'hitl';
      });
      return { tab, accounts, userSettings, policyText, policyNote, adminServices, serviceOutput, auditEntries, feishuOutput,
        candidates, hitlPending, newAccount, roles, roleLabels, can, createAccount, changeRole, toggleDisabled,
        serviceControl, review, feishu, fmtTime,
        reviewDialog, openReview, confirmReview, wikiView, wikiBusy, loadWiki, dreamResult, dreamBusy, runDreaming };
    },
  };

  // ---------------------------------------------------------------- 主壳
  const App = {
    components: { LoginView, TasksView, ConversationView, CollaborationView, OrganizationView, KnowledgeView, AcceptanceView, ServicesView, SettingsView, AdminView, DecisionCenterView, ArtifactView },
    template: `
      <login-view v-if="!session" @ok="loadSession" />
      <el-container v-else class="app-shell">
        <el-aside width="228px" class="app-aside">
          <div class="brand">
            <div class="logo">S</div>
            <div class="brand-name">
              <span class="t">SuitMe 协作台</span>
              <span class="s">AI-native 协作</span>
            </div>
          </div>
          <el-menu :default-active="view" @select="switchView" class="app-menu">
            <!-- 第三十八轮 · 键盘可达：菜单项默认 tabindex=-1（只靠方向键），
                 而菜单根节点又不可聚焦，结果键盘用户根本进不了侧栏。显式给
                 tabindex=0 让每一项都能 Tab 到，并在样式里补 :focus-visible 环。 -->
            <el-menu-item v-for="v in visibleViews" :key="v.id" :index="v.id" tabindex="0">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:11px;flex:none" v-html="v.icon"></svg>
              <span>{{ v.title }}</span>
            </el-menu-item>
            <el-menu-item v-if="hasAdminArea" index="admin" tabindex="0">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right:11px;flex:none"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>
              <span>管理</span>
            </el-menu-item>
          </el-menu>
          <div class="aside-foot">
            <div class="user-card" tabindex="0" @click="view = 'settings'" @keyup.enter="view = 'settings'" :title="'打开' + session.username + '的配置'">
              <div class="avatar">{{ initial }}</div>
              <div class="who">
                <div class="n">{{ session.username }}</div>
                <div class="r">{{ session.roleLabel }}</div>
              </div>
            </div>
            <div class="aside-hint">发起任务请回到飞书</div>
          </div>
        </el-aside>
        <el-container>
          <el-header class="app-header">
            <div>
              <h2 class="view-title">{{ currentView.title }}</h2>
              <div class="view-sub">{{ currentView.subtitle }}</div>
            </div>
            <div class="header-right">
              <button class="icon-btn" @click="toggleTheme" :title="theme === 'dark' ? '切到浅色' : '切到深色'">
                <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
                <svg v-else viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>
              </button>
              <el-dropdown @command="onUserCommand">
                <span class="user-chip">
                  <div class="avatar" style="width:26px;height:26px;font-size:12px;border-radius:50%">{{ initial }}</div>
                  <b style="font-size:13px">{{ session.username }}</b>
                </span>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="settings">我的配置</el-dropdown-item>
                    <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </el-header>
          <el-main class="app-main">
            <div class="main-inner">
              <decision-center-view v-if="view === 'decisions'" :session="session" />
              <conversation-view v-if="view === 'conversation'" :session="session" />
              <tasks-view v-if="view === 'overview'" :session="session" mode="overview" />
              <collaboration-view v-else-if="view === 'collaboration'" :session="session" />
              <organization-view v-else-if="view === 'organization'" />
              <knowledge-view v-else-if="view === 'knowledge'" :session="session" />
              <artifact-view v-else-if="view === 'artifacts'" :session="session" />
              <acceptance-view v-else-if="view === 'acceptance'" />
              <services-view v-else-if="view === 'services'" :session="session" />
              <settings-view v-else-if="view === 'settings'" :session="session" @theme="saveTheme" />
              <admin-view v-else-if="view === 'admin' && hasAdminArea" :session="session" />
            </div>
          </el-main>
        </el-container>
      </el-container>`,
    setup() {
      const session = ref(null);
      const view = ref('overview');
      const theme = ref('light');

      const visibleViews = computed(() => VIEWS);
      const currentView = computed(() => [...VIEWS, { id: 'admin', title: '管理', subtitle: '按 casbin 权限分区渲染：谁可以管理什么' }]
        .find(v => v.id === view.value) ?? VIEWS[0]);
      const hasAdminArea = computed(() => {
        const p = session.value?.permissions ?? [];
        return p.some(x => ['accounts-manage', 'services-control', 'knowledge-review', 'audit-view', 'feishu-auth', 'task-control'].includes(x));
      });
      const initial = computed(() => (session.value?.username || 'S').charAt(0).toUpperCase());

      const applyTheme = value => { theme.value = value; document.documentElement.classList.toggle('dark', value === 'dark'); };
      const toggleTheme = () => { applyTheme(theme.value === 'dark' ? 'light' : 'dark'); void api('settings-set', { theme: theme.value }).catch(() => {}); };
      const saveTheme = value => applyTheme(value);

      const loadSession = async () => {
        try {
          const r = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (!r.ok) { session.value = null; return; }
          const data = await r.json();
          session.value = data;
          applyTheme(data.settings?.theme === 'dark' ? 'dark' : 'light');
          const target = ['decisions', 'conversation', 'overview', 'collaboration', 'organization', 'knowledge', 'artifacts', 'acceptance', 'services'].includes(data.settings?.defaultView)
            ? data.settings.defaultView : 'decisions';
          view.value = target === 'admin' && !hasAdminArea.value ? 'overview' : target;
        } catch { session.value = null; }
      };
      const switchView = target => { view.value = target; };
      const onUserCommand = async command => {
        if (command === 'settings') { view.value = 'settings'; return; }
        if (command === 'logout') {
          await fetch('/api/logout', { method: 'POST' }).catch(() => {});
          session.value = null;
        }
      };
      onMounted(loadSession);
      return { session, view, theme, visibleViews, currentView, hasAdminArea, initial, toggleTheme, saveTheme, switchView, onUserCommand, loadSession };
    },
  };

  createApp(App).use(ElementPlus, { locale: ElementPlusLocaleZhCn }).mount('#app');
})();
