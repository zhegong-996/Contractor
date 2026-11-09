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
    { id: 'overview', title: '概览', subtitle: '同一份共享现场，人和助手各看自己该看的' },
    { id: 'collaboration', title: '协作', subtitle: '谁接、谁派、谁干，都在一条责任链上' },
    { id: 'organization', title: '组织', subtitle: '一份共享上下文，按职能配置三层座位' },
    { id: 'knowledge', title: '知识', subtitle: '资料与证据按归属分区管理：个人 / 协作 / 组织' },
    { id: 'acceptance', title: '验收', subtitle: '开工前锁定清单，逐项判定后由发起人确认' },
    { id: 'services', title: '服务', subtitle: '本机与国内服务的实时状态' },
    { id: 'settings', title: '我的配置', subtitle: '界面、通知与模型偏好，只属于你自己' },
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

  const fmtTime = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';

  // ---------------------------------------------------------------- 登录视图
  const LoginView = {
    template: `
      <div class="login-wrap">
        <el-card class="login-card">
          <div class="login-brand">
            <svg viewBox="0 0 48 48" width="44" height="44"><circle cx="24" cy="24" r="21" fill="none" stroke="var(--el-color-primary)" stroke-width="3"/><path d="M14 30c3-8 7-12 10-12s7 4 10 12" fill="none" stroke="var(--el-color-primary)" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="33" r="3" fill="var(--el-color-primary)"/></svg>
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
  const TasksView = {
    props: ['session', 'mode'],
    template: `
      <div>
        <el-row :gutter="14" style="margin-bottom:14px">
          <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="8" :md="6">
            <el-card shadow="never"><el-skeleton :loading="loading" :rows="1" animated>
              <div class="stat"><div class="stat-num">{{ card.value }}</div><div class="stat-label">{{ card.label }}</div></div>
            </el-skeleton></el-card>
          </el-col>
        </el-row>
        <el-card shadow="never">
          <template #header>{{ mode === 'collaboration' ? '任务与责任链' : '最近任务' }}</template>
          <el-alert v-if="summary.__error" :title="'读取失败：' + summary.__error" type="warning" :closable="false" />
          <el-table v-else :data="tasks" size="default" @row-click="openTask">
            <el-table-column prop="id" label="任务" min-width="220">
              <template #default="{ row }"><el-link type="primary">{{ row.title || row.id }}</el-link></template>
            </el-table-column>
            <el-table-column prop="agent" label="负责" width="110" />
            <el-table-column label="阶段" width="110">
              <template #default="{ row }"><el-tag :type="phaseTag(row.phase)" effect="light">{{ phaseLabel(row.phase) }}</el-tag></template>
            </el-table-column>
            <el-table-column label="更新时间" width="180">
              <template #default="{ row }">{{ fmtTime(row.updatedAt || row.updated_at) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
        <el-drawer v-model="taskDrawer" :title="current && (current.title || current.id)" size="46%">
          <el-descriptions v-if="current" :column="1" border>
            <el-descriptions-item label="任务 ID">{{ current.id }}</el-descriptions-item>
            <el-descriptions-item label="负责 Agent">{{ current.agent }}</el-descriptions-item>
            <el-descriptions-item label="阶段">{{ phaseLabel(current.phase) }}</el-descriptions-item>
            <el-descriptions-item label="创建">{{ fmtTime(current.createdAt || current.created_at) }}</el-descriptions-item>
            <el-descriptions-item label="摘要"><div style="white-space:pre-wrap">{{ current.summary || current.context || '（无）' }}</div></el-descriptions-item>
          </el-descriptions>
        </el-drawer>
      </div>`,
    setup(props) {
      const summary = ref({}); const loading = ref(true); const taskDrawer = ref(false); const current = ref(null);
      const tasks = computed(() => Array.isArray(summary.value.tasks) ? summary.value.tasks : []);
      const statCards = computed(() => {
        const phases = { running: 0, waiting: 0, delivered: 0, failed: 0 };
        for (const t of tasks.value) if (t.phase in phases) phases[t.phase] += 1;
        return [
          { label: '进行中', value: phases.running }, { label: '待回答/等待', value: phases.waiting },
          { label: '已交付', value: phases.delivered }, { label: '失败', value: phases.failed },
        ];
      });
      const phaseLabel = p => ({ running: '进行中', waiting: '等待', delivered: '已交付', failed: '失败', todo: '待办', blocked: '受阻',
        intake: '待接入', dispatched: '已派单', in_progress: '进行中', review: '待评审', accepted: '已验收', closed: '已结束', draft: '草稿' }[p] || p || '—');
      const phaseTag = p => ({ running: 'primary', waiting: 'warning', delivered: 'success', failed: 'danger', blocked: 'danger',
        accepted: 'success', review: 'warning', closed: 'info', draft: 'info', dispatched: 'primary', intake: 'info', in_progress: 'primary', todo: 'info' }[p] || 'info');
      const load = async () => { loading.value = true; summary.value = await safe('view-summary'); loading.value = false; };
      const openTask = row => { current.value = row; taskDrawer.value = true; };
      onMounted(load);
      return { summary, loading, tasks, statCards, phaseLabel, phaseTag, load, openTask, taskDrawer, current, fmtTime };
    },
  };

  // ---------------------------------------------------------------- 协作视图（C-3 / C-4 / P-6 卡片）
  const CollaborationView = {
    props: ['session'],
    template: `
      <div>
        <el-card shadow="never" style="margin-bottom:14px">
          <template #header>任务与责任链</template>
          <el-alert v-if="summary.__error" :title="'读取失败：' + summary.__error" type="warning" :closable="false" />
          <el-table v-else :data="tasks" size="default" @row-click="openTask">
            <el-table-column prop="id" label="任务" min-width="220">
              <template #default="{ row }"><el-link type="primary">{{ row.title || row.id }}</el-link></template>
            </el-table-column>
            <el-table-column prop="agent" label="负责" width="110" />
            <el-table-column label="阶段" width="110">
              <template #default="{ row }"><el-tag :type="phaseTag(row.phase)" effect="light">{{ phaseLabel(row.phase) }}</el-tag></template>
            </el-table-column>
            <el-table-column label="更新时间" width="180">
              <template #default="{ row }">{{ fmtTime(row.updatedAt || row.updated_at) }}</template>
            </el-table-column>
          </el-table>
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
              <el-descriptions v-else :column="1" border size="small">
                <el-descriptions-item label="交付前自查">{{ evolution.selfCheckGateEnabled === false ? '闸门已按配置关闭（仍需人签）' : ('已强制 · ' + (evolution.standardsCount || 0) + ' 条沉淀标准') }}</el-descriptions-item>
                <el-descriptions-item label="登记与放行">{{ evolution.selfCheckRuns || 0 }} 次自查登记 · {{ evolution.gatePasses || 0 }} 次闸门放行 }}</el-descriptions-item>
                <el-descriptions-item label="候选改进">{{ candidates.length ? candidates.slice(0, 4).map(i => clean(i.title) + '（' + clean(i.stateLabel) + '）').join('；') : '暂无候选改进' }}</el-descriptions-item>
                <el-descriptions-item label="当前生效版本">{{ evolution.activeVersion ? clean(String(evolution.activeVersion)) : '无（未启用任何改进）' }}</el-descriptions-item>
                <el-descriptions-item label="效果对比">{{ comparison ? (comparison.comparable ? '前后窗口可对比' : '观测不齐，缺项逐条标不可比') : '尚未登记前后观测窗口，不可比' }}</el-descriptions-item>
                <el-descriptions-item label="红线">{{ clean((evolution.redLines || [])[2] || 'Agent 不能自己让改进生效') }}</el-descriptions-item>
              </el-descriptions>
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

        <el-drawer v-model="taskDrawer" :title="current && (current.title || current.id)" size="46%">
          <el-descriptions v-if="current" :column="1" border>
            <el-descriptions-item label="任务 ID">{{ current.id }}</el-descriptions-item>
            <el-descriptions-item label="负责 Agent">{{ current.agent }}</el-descriptions-item>
            <el-descriptions-item label="阶段">{{ phaseLabel(current.phase) }}</el-descriptions-item>
            <el-descriptions-item label="创建">{{ fmtTime(current.createdAt || current.created_at) }}</el-descriptions-item>
            <el-descriptions-item label="摘要"><div style="white-space:pre-wrap">{{ current.summary || current.context || '（无）' }}</div></el-descriptions-item>
          </el-descriptions>
        </el-drawer>
      </div>`,
    setup() {
      const summary = ref({}), routing = ref({}), registry = ref({}), evolution = ref({}), execution = ref({});
      const taskDrawer = ref(false); const current = ref(null);
      const tasks = computed(() => Array.isArray(summary.value.tasks) ? summary.value.tasks : []);
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
      onMounted(async () => {
        const [s, r, g, e, x] = await Promise.all([
          safe('view-summary'), safe('routing-status'), safe('v06-agent-registry-view'),
          safe('v06-evolution-view'), safe('v06-execution-view')]);
        summary.value = s; routing.value = r; registry.value = g; evolution.value = e; execution.value = x;
      });
      return { summary, tasks, routing, router, coverage, threeTier, shapeReady, registry, agents, evolution, candidates,
        comparison, execution, missing, missingText, domainText, phaseLabel, phaseTag, openTask, taskDrawer, current,
        clean, dutyText, fmtTime };
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
              <el-tag size="small" effect="plain" type="warning">外部模型调用</el-tag>
            </div>
          </template>
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
        </el-card>
        <el-card shadow="never" style="margin-bottom:14px">
          <template #header>
            <div class="card-head">
              <span>知识条目（{{ items.length }}）</span>
              <div>
                <el-button size="small" @click="runGuard">跑知识体检（只读）</el-button>
                <el-button type="primary" size="small" @click="openCreate" v-if="canWriteSome">新建知识</el-button>
              </div>
            </div>
          </template>
          <el-alert v-if="list.__error" :title="'读取失败：' + list.__error" type="warning" :closable="false" />
          <template v-else>
            <el-table :data="items" size="default" v-loading="loading">
              <el-table-column prop="key" label="标识" min-width="200" />
              <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
              <el-table-column label="归属分区" width="150">
                <template #default="{ row }">
                  <el-tag :type="visTag(row.visibility)" effect="light">{{ visLabel(row.visibility) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.state === 'confirmed' ? 'success' : row.state === 'withdrawn' ? 'info' : 'warning'" effect="plain">{{ stateLabel(row.state) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="owner" label="归属者" width="140" />
              <el-table-column label="更新时间" width="170">
                <template #default="{ row }">{{ fmtTime(row.updatedAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="200" fixed="right">
                <template #default="{ row }">
                  <el-button size="small" text type="primary" @click="openEdit(row)">查看/编辑</el-button>
                  <el-button v-if="canDelete(row)" size="small" text type="danger" @click="remove(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </el-card>
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
      </div>`,
    setup(props) {
      const list = ref({}); const loading = ref(false); const guardText = ref('尚未运行；点击「跑知识体检」获取只读报告。');
      const dialog = ref(false); const saving = ref(false);
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
      onMounted(load);
      return { list, items, loading, guardText, dialog, saving, form, kinds, visibilities, anchorTasks,
        visLabel, visTag, stateLabel, canEdit, canDelete, canChangeVis, canWriteSome, load, runGuard, openCreate, openEdit, save, remove, fmtTime,
        search, canSearch, runSearch, resultText };
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
                    <el-table-column label="证据" width="96">
                      <template #default="{ row }">{{ evidenceText(row.evidenceKind) }}</template>
                    </el-table-column>
                    <el-table-column label="判定" width="88">
                      <template #default="{ row }"><el-tag size="small" :type="statusTag(row.status)" effect="light">{{ statusText(row.status) }}</el-tag></template>
                    </el-table-column>
                    <el-table-column label="原因 / 证据位置" min-width="210">
                      <template #default="{ row }">
                        <div>{{ row.reason || '—' }}</div>
                        <div v-if="row.evidenceRefs.length" class="list-row-meta">证据 {{ row.evidenceRefs.length }} 条</div>
                        <div v-for="(region, i) in row.regions" :key="i" class="list-row-meta">
                          区域 {{ i + 1 }}：{{ region.x }},{{ region.y }} · {{ region.width }}×{{ region.height }}{{ region.note ? ' · ' + region.note : '' }}
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
      const evidenceText = s => ({ captured: '实跑捕获', imported: '导入', authored: '自撰' }[s] || s);
      const load = async () => {
        if (!taskId.value) { data.value = {}; return; }
        data.value = await safe('v06-acceptance-workbench', { taskId: taskId.value });
      };
      onMounted(async () => {
        summary.value = await safe('view-summary', { limit: 50 });
        if (tasks.value.length) { taskId.value = tasks.value[0].id; await load(); }
      });
      return { summary, data, taskId, tasks, errorText, statCards, planLine, shortHash, crewRows,
        statusText, statusTag, overallText, evidenceText, load, fmtTime, dutyText };
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
      onMounted(async () => { data.value = await safe('organization-view'); });
      return { data, layers, domains, notes, agentRows, phaseRows, statCards, phaseText, dutyText };
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
      </div>`,
    setup() {
      const data = ref({}), system = ref({}), retry = ref(null), inbox = ref(null), channels = ref(null);
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
      });
      return { data, services, text, retry, inbox, channels, clean, stateText, stateTag,
        retryText, retryTag, channelText, channelTag, directionText };
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
    components: { LoginView, TasksView, CollaborationView, OrganizationView, KnowledgeView, AcceptanceView, ServicesView, SettingsView, AdminView },
    template: `
      <login-view v-if="!session" @ok="loadSession" />
      <el-container v-else class="app-shell">
        <el-aside width="216px" class="app-aside">
          <div class="brand">
            <svg viewBox="0 0 48 48" width="30" height="30"><circle cx="24" cy="24" r="21" fill="none" stroke="var(--el-color-primary)" stroke-width="3"/><path d="M14 30c3-8 7-12 10-12s7 4 10 12" fill="none" stroke="var(--el-color-primary)" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="33" r="3" fill="var(--el-color-primary)"/></svg>
            <span>SuitMe 协作台</span>
          </div>
          <el-menu :default-active="view" @select="switchView" class="app-menu">
            <!-- 第三十八轮 · 键盘可达：菜单项默认 tabindex=-1（只靠方向键），
                 而菜单根节点又不可聚焦，结果键盘用户根本进不了侧栏。显式给
                 tabindex=0 让每一项都能 Tab 到，并在样式里补 :focus-visible 环。 -->
            <el-menu-item v-for="v in visibleViews" :key="v.id" :index="v.id" tabindex="0">
              <span>{{ v.title }}</span>
            </el-menu-item>
            <el-menu-item v-if="hasAdminArea" index="admin" tabindex="0"><span>管理</span></el-menu-item>
          </el-menu>
          <div class="aside-foot">发起任务请回到飞书</div>
        </el-aside>
        <el-container>
          <el-header class="app-header">
            <div>
              <h2 class="view-title">{{ currentView.title }}</h2>
              <div class="view-sub">{{ currentView.subtitle }}</div>
            </div>
            <div class="header-right">
              <el-button circle size="small" @click="toggleTheme" :title="theme === 'dark' ? '切到浅色' : '切到深色'">
                {{ theme === 'dark' ? '☀' : '☾' }}
              </el-button>
              <el-dropdown @command="onUserCommand">
                <span class="user-chip">
                  <el-tag size="small" effect="light" type="primary">{{ session.roleLabel }}</el-tag>
                  <b>{{ session.username }}</b>
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
            <tasks-view v-if="view === 'overview'" :session="session" mode="overview" />
            <collaboration-view v-else-if="view === 'collaboration'" :session="session" />
            <organization-view v-else-if="view === 'organization'" />
            <knowledge-view v-else-if="view === 'knowledge'" :session="session" />
            <acceptance-view v-else-if="view === 'acceptance'" />
            <services-view v-else-if="view === 'services'" :session="session" />
            <settings-view v-else-if="view === 'settings'" :session="session" @theme="saveTheme" />
            <admin-view v-else-if="view === 'admin' && hasAdminArea" :session="session" />
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
          const target = ['overview', 'collaboration', 'organization', 'knowledge', 'acceptance', 'services'].includes(data.settings?.defaultView)
            ? data.settings.defaultView : 'overview';
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
      return { session, view, theme, visibleViews, currentView, hasAdminArea, toggleTheme, saveTheme, switchView, onUserCommand, loadSession };
    },
  };

  createApp(App).use(ElementPlus, { locale: ElementPlusLocaleZhCn }).mount('#app');
})();
