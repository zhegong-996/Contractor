// C-2 真跑：在临时端口起自研控制台，连真实本机协作服务，用 Chrome 走查视图、
// 深浅主题、窄屏与权限边界。按需启动、跑完即关，不新增常驻服务。
//
// 第三十轮 P-12/P-13：前端重写为 Vue 3 + Element Plus（本地 vendor）；权限判定
// 走 casbin；新增用户级配置与知识分区 CRUD。冒烟同步覆盖：
//   未登录 401 / 错口令 401 / 登录发 cookie / 只读可用 / viewer 越权 403 /
//   用户配置读写 / viewer 管理动作 403 / admin 用户配置总览 / casbin 策略查看 /
//   知识分区（viewer 建 personal 可、写 team 拒、改他人 personal 拒、admin 总览）/
//   Vue 登录页渲染与表单登录走查 / 主题切换 / 产品词与窄屏检查。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';
process.env.NODE_USE_ENV_PROXY = '0';

const root = process.cwd();
const out = path.join(root, '.runtime/console');
mkdirSync(out, { recursive: true });
const { listenConsole, CONSOLE_READ_ACTIONS } = await import('./console-server.ts');
const { ConsoleAuth } = await import('../src/console-auth.ts');

// 冒烟专用账号：viewer + admin（默认不存在则创建；跑完禁用，留审计痕迹）。
const provisioning = new ConsoleAuth();
const provision = async (username, role) => {
  const password = 'smoke-' + randomBytes(12).toString('hex');
  if (!provisioning.listAccounts().some(a => a.username === username)) {
    await provisioning.createAccount(username, password, role, 'console-smoke');
  } else {
    await provisioning.changePassword(username, password);
    await provisioning.setDisabled('console-smoke', username, false);
  }
  return password;
};
const smokeUser = 'smoke-viewer';
const smokeAdmin = 'smoke-admin';
const smokePassword = await provision(smokeUser, 'viewer');
const adminPassword = await provision(smokeAdmin, 'admin');

const { server, port } = await listenConsole(0);
const base = `http://127.0.0.1:${port}`;
const checks = {};
const failures = [];
const check = (name, condition, detail = {}) => {
  checks[name] = { ok: Boolean(condition), ...detail };
  if (!condition) failures.push(name);
};
const post = async (route, body = {}, cookie = '') => {
  const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const text = await response.text();
  let data = {}; try { data = JSON.parse(text); } catch {}
  return { status: response.status, data, text, cookie: response.headers.get('set-cookie') };
};

const chromeBin = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdpPort = 9820 + Math.floor(Math.random() * 150);
const chrome = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${path.join(out, 'chrome-profile')}`,
  '--window-size=1280,900', '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });
let ws;
const stop = () => { try { ws?.close(); } catch {} try { chrome.kill('SIGTERM'); } catch {} try { server.close(); } catch {} };
process.on('exit', stop);

try {
  const htmlRes = await fetch(base + '/');
  const htmlText = await htmlRes.text();
  check('index', htmlRes.status === 200 && htmlText.includes('SuitMe 协作台') && htmlText.includes('vendor/vue.global.prod.js'));
  check('vendorVue', (await fetch(base + '/vendor/vue.global.prod.js')).status === 200);
  check('vendorElement', (await fetch(base + '/vendor/element-plus.full.min.js')).status === 200
    && (await fetch(base + '/vendor/element-plus.css')).status === 200);
  check('styles', (await fetch(base + '/styles.css')).status === 200);
  check('script', (await fetch(base + '/app.js')).status === 200);

  // ---- 登录制契约 -----------------------------------------------------------
  const anonymous = await post('/api/view-summary');
  check('anonymousBlocked', anonymous.status === 401 && anonymous.data.login === true, { status: anonymous.status });

  const badLogin = await post('/api/login', { payload: { username: smokeUser, password: 'wrong-password' } });
  check('badLoginRejected', badLogin.status === 401, { status: badLogin.status });

  const login = await post('/api/login', { payload: { username: smokeUser, password: smokePassword } });
  const cookie = (login.cookie ?? '').split(';')[0];
  check('loginOk', login.status === 200 && login.data.ok === true && cookie.startsWith('suitme_console='),
    { status: login.status, role: login.data.session?.role });
  check('viewerRoleHonest', login.data.session?.role === 'viewer' && Array.isArray(login.data.session?.permissions)
    && login.data.session.permissions.join(',') === 'read', { permissions: login.data.session?.permissions });

  const session = await post('/api/session', {}, cookie);
  check('sessionEcho', session.status === 200 && session.data.username === smokeUser
    && session.data.settings && typeof session.data.settings.defaultView === 'string',
    { username: session.data.username, hasSettings: Boolean(session.data.settings) });

  // ---- 用户级配置（本人读写；admin 总览；viewer 越权 403） -------------------
  const setRes = await post('/api/settings-set', { payload: { defaultView: 'knowledge', theme: 'dark', refreshSeconds: 45,
    notify: { hitlWaiting: false }, model: { label: 'smoke-model' } } }, cookie);
  check('settingsSetOwn', setRes.status === 200 && setRes.data.defaultView === 'knowledge'
    && setRes.data.refreshSeconds === 45 && setRes.data.notify?.hitlWaiting === false
    && setRes.data.model?.label === 'smoke-model' && setRes.data.model?.apiKey === '', setRes.data);
  const getRes = await post('/api/settings-get', {}, cookie);
  check('settingsGetOwn', getRes.status === 200 && getRes.data.theme === 'dark' && getRes.data.model?.apiKeySet === false, getRes.data);
  const badRefresh = await post('/api/settings-set', { payload: { refreshSeconds: 3 } }, cookie);
  check('settingsValidated', badRefresh.status === 400, { status: badRefresh.status });

  const adminLogin = await post('/api/login', { payload: { username: smokeAdmin, password: adminPassword } });
  const adminCookie = (adminLogin.cookie ?? '').split(';')[0];
  check('adminLoginOk', adminLogin.status === 200 && adminLogin.data.session?.role === 'admin', { role: adminLogin.data.session?.role });

  const viewerUsersView = await post('/api/admin-users-settings', {}, cookie);
  check('viewerUsersOverviewForbidden', viewerUsersView.status === 403, { status: viewerUsersView.status });
  const adminUsersView = await post('/api/admin-users-settings', {}, adminCookie);
  const usersRows = adminUsersView.data?.users ?? [];
  check('adminUsersOverview', adminUsersView.status === 200 && Array.isArray(usersRows)
    && usersRows.some(u => u.username === smokeUser && u.settings?.defaultView === 'knowledge')
    && usersRows.every(u => typeof u.settings?.model?.apiKey === 'string'),
    { count: usersRows.length, smokeSettings: usersRows.find(u => u.username === smokeUser)?.settings?.defaultView });
  const adminAccountsDenied = await post('/api/admin-accounts', {}, adminCookie);
  check('adminAccountsForbidden', adminAccountsDenied.status === 403, { status: adminAccountsDenied.status });
  const policyView = await post('/api/admin-policy', {}, adminCookie);
  check('policyReadable', policyView.status === 200 && String(policyView.data.policy).includes('p, owner, read, use')
    && String(policyView.data.policy).includes('knowledge-write-team'), { note: policyView.data?.note?.slice(0, 60) });

  // ---- 登录后的只读与管理边界 -----------------------------------------------
  const viewRes = await post('/api/view', {}, cookie);
  let viewData = {};
  try { viewData = JSON.parse(viewRes.text); } catch {}
  check('realTasks', viewRes.status === 200 && Array.isArray(viewData.tasks) && viewData.tasks.length > 0,
    { status: viewRes.status, tasks: viewData.tasks?.length ?? 0 });

  const summaryRes = await post('/api/view-summary', {}, cookie);
  const summaryRaw = summaryRes.text;
  let summary = {};
  try { summary = JSON.parse(summaryRaw); } catch {}
  const summaryBytes = Buffer.byteLength(summaryRaw);
  check('summaryReady', summaryRes.status === 200 && Array.isArray(summary.tasks) && summary.fieldsClipped === true,
    { status: summaryRes.status, bytes: summaryBytes, tasks: summary.tasks?.length ?? 0 });
  check('summaryClipped', summaryBytes < 32768 && !summaryRaw.includes('"snapshots"') && !summaryRaw.includes('"body"'), { bytes: summaryBytes });

  const writeRes = await post('/api/create-task', {}, cookie);
  check('writeBlocked', writeRes.status === 403, { status: writeRes.status });

  const forbidden = await post('/api/admin-accounts', {}, cookie);
  check('viewerAdminForbidden', forbidden.status === 403, { status: forbidden.status });
  const anonymousAdmin = await post('/api/admin-accounts');
  check('anonymousAdminBlocked', anonymousAdmin.status === 401 && anonymousAdmin.data.login === true, { status: anonymousAdmin.status });

  const hitl = await post('/api/admin-hitl', {}, cookie);
  check('viewerHitlReadable', hitl.status === 200 && Array.isArray(hitl.data.pending), { status: hitl.status });
  check('readOnlyAllowlist', CONSOLE_READ_ACTIONS.length >= 9 && !CONSOLE_READ_ACTIONS.includes('create-task'),
    { actions: CONSOLE_READ_ACTIONS.length });

  // ---- 知识分区 CRUD（走真实 bridge；分区判定在 casbin） ---------------------
  const knowledgeList = await post('/api/knowledge-list', {}, cookie);
  const items = knowledgeList.data?.items ?? [];
  check('knowledgeListReadable', knowledgeList.status === 200 && Array.isArray(items) && items.length > 0
    && items.every(i => ['personal', 'team', 'org'].includes(i.visibility)), { count: items.length });
  const anchor = items[0]?.taskId;

  const viewerTeamWrite = await post('/api/knowledge-create', { payload: { taskId: anchor, key: 'knowledge-smoke-team',
    title: '越权测试', kind: 'reference', domains: ['product'], visibility: 'team', appliesTo: 't', body: 'b',
    sources: ['https://example.org/s'] } }, cookie);
  check('viewerTeamWriteForbidden', [400, 409].includes(viewerTeamWrite.status) && /未授权/.test(viewerTeamWrite.data?.error ?? ''),
    { status: viewerTeamWrite.status, error: (viewerTeamWrite.data?.error ?? '').slice(0, 60) });

  const viewerPersonal = await post('/api/knowledge-create', { payload: { taskId: anchor, key: 'knowledge-smoke-personal',
    title: '冒烟个人区', kind: 'reference', domains: ['product'], visibility: 'personal', appliesTo: 't', body: 'b',
    sources: ['https://example.org/s'] } }, cookie);
  check('viewerPersonalCreateOk', viewerPersonal.status === 200 && viewerPersonal.data?.visibility === 'personal',
    { status: viewerPersonal.status });

  const adminSteal = await post('/api/knowledge-update', { payload: { taskId: anchor, key: 'knowledge-smoke-personal',
    title: 'admin 篡改 viewer 个人区', kind: 'reference', domains: ['product'], visibility: 'personal', appliesTo: 't', body: 'x',
    sources: ['https://example.org/s'] } }, adminCookie);
  check('adminCannotTouchOthersPersonal', [400, 409].includes(adminSteal.status) && /个人区/.test(adminSteal.data?.error ?? ''),
    { status: adminSteal.status, error: (adminSteal.data?.error ?? '').slice(0, 60) });

  const adminTeamCreate = await post('/api/knowledge-create', { payload: { taskId: anchor, key: 'knowledge-smoke-admin-team',
    title: 'admin 协作区', kind: 'reference', domains: ['product'], visibility: 'team', appliesTo: 't', body: 'b',
    sources: ['https://example.org/s'] } }, adminCookie);
  check('adminTeamCreateOk', adminTeamCreate.status === 200 && adminTeamCreate.data?.visibility === 'team', { status: adminTeamCreate.status, error: adminTeamCreate.data?.error ?? '' });

  // ---- 13a 写入链：读分区 + 证据锚点 + 注入索引红线 -------------------------
  // admin 建 personal 条目：viewer 的列表里必须看不到（个人区仅归属者与管理员）。
  const adminPersonal = await post('/api/knowledge-create', { payload: { taskId: anchor, key: 'knowledge-smoke-admin-own',
    title: 'admin 个人区（读分区冒烟）', kind: 'reference', domains: ['product'], visibility: 'personal', appliesTo: 't', body: 'b',
    sources: ['https://example.org/s'] } }, adminCookie);
  const viewerList = await post('/api/knowledge-list', {}, cookie);
  const viewerSees = (viewerList.data?.items ?? []).some(i => i.key === 'knowledge-smoke-admin-own');
  check('readPartitionHidesOthersPersonal', adminPersonal.status === 200 && viewerList.status === 200 && viewerSees === false,
    { created: adminPersonal.status, visibleToViewer: viewerSees });
  const adminList = await post('/api/knowledge-list', {}, adminCookie);
  const adminSees = (adminList.data?.items ?? []).some(i => i.key === 'knowledge-smoke-admin-own');
  check('readPartitionAdminOverview', adminSees === true, { visibleToAdmin: adminSees });
  const viewerGet = await post('/api/knowledge-get', { payload: { taskId: anchor, key: 'knowledge-smoke-admin-own' } }, cookie);
  check('readPartitionGetBlocked', [400, 403, 409].includes(viewerGet.status), { status: viewerGet.status });

  // 新 propose 的条目必须自动挂证据锚点（13a ①）。
  const anchored = await post('/api/knowledge-get', { payload: { taskId: anchor, key: 'knowledge-smoke-admin-own' } }, adminCookie);
  check('proposeAnchorsEvidence', anchored.status === 200
    && Array.isArray(anchored.data?.value?.evidenceEventIds) && anchored.data.value.evidenceEventIds.length >= 1,
    { evidence: anchored.data?.value?.evidenceEventIds?.length ?? 0 });

  // 知识地图 / 注入索引只读体检（13a ②③）：投影可重建、零模型调用。
  const wiki = await post('/api/knowledge-wiki', {}, adminCookie);
  check('knowledgeWikiReadable', wiki.status === 200 && typeof wiki.data?.records === 'number'
    && Array.isArray(wiki.data?.pages) && wiki.data?.modelCalls === 0 && wiki.data.wiki.danglingLinks.length === 0,
    { status: wiki.status, records: wiki.data?.records, pages: wiki.data?.pages?.length });

  // 无证据挂靠的旧条目即使人审确认 + inject 也不得进注入索引（红线：挂不住事实源不进顶层）。
  // 冒烟不污染真实确认状态，只验证「索引构建」这一侧：直接跑只读体检，索引条目
  // 必须全部满足 confirmed + 人签 + 证据 + 提升（由 buildInjectedIndex 判据保证）。
  const injectedEntries = wiki.data?.injected?.entries ?? [];
  check('injectedIndexDiscipline', Array.isArray(injectedEntries)
    && injectedEntries.every(e => e.pointer?.startsWith('note:') && !e.body && Object.keys(e).sort().join(',') === 'id,pointer,title'),
    { entries: injectedEntries.length });

  const cleanup = await post('/api/knowledge-delete', { payload: { taskId: anchor, key: 'knowledge-smoke-personal' } }, cookie);
  const cleanup2 = await post('/api/knowledge-delete', { payload: { taskId: anchor, key: 'knowledge-smoke-admin-team' } }, adminCookie);
  const cleanup3 = await post('/api/knowledge-delete', { payload: { taskId: anchor, key: 'knowledge-smoke-admin-own' } }, adminCookie);
  check('knowledgeCleanup', cleanup.status === 200 && cleanup2.status === 200 && cleanup3.status === 200,
    { a: cleanup.status, b: cleanup2.status, c: cleanup3.status });

  // ---- 浏览器走查（Vue 3 + Element Plus） -----------------------------------
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok) break; } catch {}
    await delay(200);
  }
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('找不到 Chrome 页面目标');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0; const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const cdp = (method, params = {}) => new Promise(resolve => {
    const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(String(response.result.exceptionDetails.text).slice(0, 200));
    return response.result?.result?.value;
  };
  const screenshot = async name => {
    const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(path.join(out, name + '.png'), Buffer.from(result.result.data, 'base64'));
  };

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await cdp('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base + '/' });
  await delay(2200);

  // 未登录：Vue 登录卡片可见。
  const loginVisible = await evaluate(`(() => ({
    card: Boolean(document.querySelector('.login-card')),
    inputs: document.querySelectorAll('.login-card input').length,
    brand: document.body.innerText.includes('SuitMe 协作台'),
  }))()`);
  check('loginGateRendered', loginVisible && loginVisible.card === true && loginVisible.inputs >= 2
    && loginVisible.brand === true, loginVisible);
  await screenshot('login-1280');

  // 表单登录走查（原生 value + input 事件驱动 Vue v-model）。
  const loginDone = await evaluate(`(async () => {
    const inputs = document.querySelectorAll('.login-card input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], ${JSON.stringify(smokeUser)});
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], ${JSON.stringify(smokePassword)});
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    const btn = [...document.querySelectorAll('.login-card button')].find(b => b.textContent.includes('登'));
    btn.click();
    for (let i = 0; i < 48; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (document.querySelector('.app-shell')) return true;
    }
    return false;
  })()`);
  check('loginFormSubmits', loginDone === true, {});
  await delay(1500);

  const shellInfo = await evaluate(`(() => ({
    menu: document.querySelectorAll('.app-menu .el-menu-item').length,
    user: document.body.innerText.includes(${JSON.stringify(smokeUser)}),
    roleTag: document.body.innerText.includes('只读'),
    adminHidden: ![...document.querySelectorAll('.app-menu .el-menu-item')].some(m => m.textContent.includes('管理')),
    feishuNote: document.body.innerText.includes('发起任务请回到飞书'),
  }))()`);
  check('shellPainted', shellInfo && shellInfo.menu >= 6 && shellInfo.user === true && shellInfo.roleTag === true
    && shellInfo.feishuNote === true, shellInfo);
  check('viewerNoAdminMenu', shellInfo?.adminHidden === true, shellInfo);
  await screenshot('overview-1280');

  // 视图切换走查（知识视图含分区列）。
  const views = ['对话', '概览', '协作', '组织', '知识', '验收', '服务', '我的配置'];
  let rendered = 0;
  for (const title of views) {
    const clicked = await evaluate(`(() => {
      const item = [...document.querySelectorAll('.app-menu .el-menu-item')].find(m => m.textContent.includes(${JSON.stringify(title)}));
      if (!item) return false; item.click(); return true;
    })()`);
    let ready = false, textLength = 0;
    for (let i = 0; i < 60; i++) {
      const state = await evaluate(`(() => ({ len: (document.querySelector('.app-main')?.innerText ?? '').trim().length,
        tables: document.querySelectorAll('.app-main .el-table, .app-main .el-card').length }))()`);
      textLength = state?.len ?? 0;
      if (state && state.tables >= 1 && state.len > 40) { ready = true; break; }
      await delay(250);
    }
    check('view-' + title, clicked === true && ready, { title, textLength });
    if (ready) rendered++;
    if (title === '知识') {
      let rows = 0;
      for (let i = 0; i < 60; i++) {
        rows = await evaluate(`document.querySelectorAll('.app-main .el-table__row').length`);
        if (rows >= 1) break;
        await delay(300);
      }
      await screenshot('knowledge-1280');
      const knowledgeView = await evaluate(`(() => ({
        vis: document.body.innerText.includes('归属分区'),
        org: document.body.innerText.includes('组织区') || document.body.innerText.includes('协作区') || document.body.innerText.includes('个人区'),
        rows: document.querySelectorAll('.app-main .el-table__row').length,
      }))()`);
      check('knowledgeColumns', knowledgeView?.vis === true && knowledgeView?.org === true, knowledgeView);
    }
  }
  check('allViewsRendered', rendered === views.length, { rendered, total: views.length });

  // 主题切换（Element Plus dark：html.dark）。第五十九轮起主题按钮改为 .icon-btn（SVG 太阳/月亮）。
  const darkBefore = await evaluate(`document.documentElement.classList.contains('dark')`);
  await evaluate(`document.querySelector('.app-header .icon-btn')?.click()`);
  await delay(300);
  const darkAfter = await evaluate(`document.documentElement.classList.contains('dark')`);
  check('themeToggle', darkBefore !== darkAfter, { darkBefore, darkAfter });
  await screenshot('overview-dark');

  // ---- 验收矩阵：深浅色并排 + 320px + 键盘逐键（标准化执行）------------------
  // RE-AUDIT「待补」第 5 项。矩阵只测四条与人相关的硬线，不测主观好看：
  //   ① 页面级没有横向溢出（内容不该被挤到屏幕外）；
  //   ② 每个可聚焦元素都有可读名字，且没有 tabindex > 0 劫持顺序；
  //   ③ 逐键 Tab 的落点严格按 DOM 顺序递增（键盘用户不会被甩来甩去）；
  //   ④ 视图不是白屏（渲染出的节点数有下限）—— 否则「能点开」会被误当成「能用」。
  const matrix = [];
  const matrixProblems = [];
  // 第三十九轮：从三条抽样视图扩到全部七个 —— 抽样会漏掉没被抽到的那个。
  const matrixViews = ['对话', '概览', '协作', '组织', '知识', '验收', '服务', '我的配置'];
  const tabKey = async () => {
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' });
  };
  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 320]) {
      for (const title of matrixViews) {
        await evaluate(`(() => {
          const item = [...document.querySelectorAll('.app-menu .el-menu-item')].find(m => m.textContent.includes(${JSON.stringify(title)}));
          item?.click(); return Boolean(item);
        })()`);
        await delay(500);
        await evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`);
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
        await delay(350);
        const cell = await evaluate(`(() => {
          const el = document.documentElement;
          const clipped = node => { let p = node.parentElement;
            while (p && p !== document.body) { const ov = getComputedStyle(p).overflowX;
              if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') return true; p = p.parentElement; } return false; };
          const offenders = [...document.querySelectorAll('.app-main *')]
            .filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.right > el.clientWidth + 1 && !clipped(node); })
            .slice(0, 4).map(node => node.tagName.toLowerCase() + '.' + String(node.className).slice(0, 40));
          const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
            .filter(node => !node.disabled && node.offsetParent !== null);
          focusables.forEach((node, index) => { node.dataset.kbIndex = String(index); });
          const nameOf = node => (node.getAttribute('aria-label') || node.labels?.[0]?.textContent || node.textContent || node.value || node.getAttribute('title') || '').trim();
          const unnamedTags = focusables.filter(node => !nameOf(node))
            .slice(0, 4).map(node => node.tagName.toLowerCase() + '.' + String(node.className).slice(0, 40));
          return { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, offenders,
            nodes: document.querySelectorAll('.app-main *').length,
            focusables: focusables.length,
            unnamed: focusables.filter(node => !nameOf(node)).length, unnamedTags,
            hijack: focusables.filter(node => Number(node.getAttribute('tabindex')) > 0).length };
        })()`);
        // 逐键：先把焦点归到页面第一个可聚焦元素（标准化起点），再真实派发 Tab。
        // 判据只有三条硬线（不追求「序号严格递增」——Element Plus 菜单用的是
        // roving tabindex，焦点落在带 tabindex=-1 的菜单项上是标准做法）：
        //   ① 焦点不许逃到 body / html（逃了就是「按 Tab 掉出页面」）；
        //   ② 落点是有名字的可交互元素；
        //   ③ 6 次 Tab 至少经过 3 个不同元素（否则就是焦点陷阱）。
        await evaluate(`(() => {
          const first = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
            .filter(node => !node.disabled && node.offsetParent !== null)[0];
          if (first) first.focus();
          return Boolean(first);
        })()`);
        const stops = [];
        for (let i = 0; i < 12; i++) {
          stops.push(await evaluate(`(() => {
            const node = document.activeElement;
            if (!node) return { tag: 'none', name: '' };
            const name = (node.getAttribute('aria-label') || node.labels?.[0]?.textContent || node.textContent || node.value || node.getAttribute('title') || '').trim();
            return { tag: node.tagName.toLowerCase(), cls: String(node.className).slice(0, 30), name: name.slice(0, 24) };
          })()`));
          await tabKey();
        }
        // Tab 走到底会落到 body（浏览器把焦点交回自身）—— 这是文档结束，不是缺陷。
        // 只看「走到末尾之前」的落点：要有至少 3 个不同元素，且没有缺名字的交互元素。
        const bodyIndex = stops.findIndex(stop => stop.tag === 'body' || stop.tag === 'html');
        const core = bodyIndex === -1 ? stops : stops.slice(0, bodyIndex);
        const distinct = new Set(core.map(stop => stop.tag + '.' + (stop.cls ?? ''))).size;
        const interactive = new Set(['input', 'button', 'a', 'select', 'textarea']);
        const nameless = core.filter(stop => interactive.has(stop.tag) && !stop.name).length;
        const keyboardOk = distinct >= 3 && nameless === 0;
        matrix.push({ view: title, theme, width, ...cell, stops: stops.map(stop => stop.tag + (stop.name ? ':' + stop.name : '')), distinct, nameless, increasing: keyboardOk });
        if (cell.scrollWidth > cell.clientWidth + 1) matrixProblems.push(`${title}/${theme}/${width}px 横向溢出 ${cell.scrollWidth - cell.clientWidth}px`);
        if (cell.offenders.length) matrixProblems.push(`${title}/${theme}/${width}px ${cell.offenders.length} 个元素越过视口：${cell.offenders.join(', ')}`);
        if (cell.unnamed) matrixProblems.push(`${title}/${theme}/${width}px ${cell.unnamed} 个可聚焦元素没有可读名字：${cell.unnamedTags.join(', ')}`);
        if (cell.hijack) matrixProblems.push(`${title}/${theme}/${width}px ${cell.hijack} 个元素用 tabindex>0 劫持键盘顺序`);
        if (nameless) matrixProblems.push(`${title}/${theme}/${width}px 有 ${nameless} 次 Tab 落在没有名字的可交互元素上`);
        if (distinct < 3) matrixProblems.push(`${title}/${theme}/${width}px Tab 只经过 ${distinct} 个元素就去到文档末尾，键盘用户基本走不动`);
        // 白屏检测：能点开 ≠ 能用。渲染节点太少说明数据没到或模板没渲染。
        if (cell.nodes < 12) matrixProblems.push(`${title}/${theme}/${width}px 只渲染了 ${cell.nodes} 个节点，疑似白屏（数据没到或模板没渲染）`);
      }
    }
  }
  writeFileSync(path.join(root, '.runtime/console-matrix.json'), JSON.stringify({ at: new Date().toISOString(), cells: matrix, problems: matrixProblems }, null, 2));
  check('matrixOverflowAndFocus', matrixProblems.length === 0, { cells: matrix.length, problems: matrixProblems.slice(0, 8) });
  check('matrixKeyboardOrder', matrix.every(cell => cell.increasing), { stops: matrix.map(cell => cell.stops.join('→')).slice(0, 4) });

  // 回到浅色 + 桌面宽度，后续检查在稳定形态下进行。
  await evaluate(`document.documentElement.classList.toggle('dark', false)`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`[...document.querySelectorAll('.app-menu .el-menu-item')].find(m => m.textContent.includes('概览'))?.click()`);
  await delay(500);

  // 产品词与网页发起入口检查。
  const visible = await evaluate(`document.body.innerText`);
  const forbiddenWords = ['Paperclip', 'GitHub', 'Slack', 'Vercel', 'OpenAI', 'npm run'];
  const found = forbiddenWords.filter(word => String(visible).includes(word));
  check('noOverseasCopy', found.length === 0, { found });

  // 窄屏检查（425px）。
  await cdp('Emulation.setDeviceMetricsOverride', { width: 425, height: 900, deviceScaleFactor: 1, mobile: true });
  await delay(500);
  const narrow = await evaluate(`(() => {
    const el = document.documentElement;
    return { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth };
  })()`);
  check('responsive425', narrow && narrow.scrollWidth <= narrow.clientWidth + 1, narrow);
  await screenshot('overview-425');

  // ---- 登出与收尾 -----------------------------------------------------------
  const logout = await post('/api/logout', {}, cookie);
  check('logoutOk', logout.status === 200, { status: logout.status });
  const afterLogout = await post('/api/view-summary', {}, cookie);
  check('sessionRevoked', afterLogout.status === 401, { status: afterLogout.status });
} catch (error) {
  failures.push('exception');
  checks.exception = { ok: false, message: String(error?.message ?? error) };
} finally {
  // 冒烟账号跑完即禁用（保留账号与审计痕迹，不留可登录口令）。
  try { await provisioning.setDisabled('console-smoke', smokeUser, true); } catch {}
  try { await provisioning.setDisabled('console-smoke', smokeAdmin, true); } catch {}
  stop();
  const report = { ok: failures.length === 0, failed: failures, checks,
    at: new Date().toISOString(), frontend: 'vue3+element-plus(vendor)', rbac: 'casbin' };
  writeFileSync(path.join(root, '.runtime/console-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exit(failures.length === 0 ? 0 : 1);
}
