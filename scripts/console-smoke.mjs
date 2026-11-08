// C-2 真跑：在临时端口起自研控制台，连真实本机协作服务，用 Chrome 走查六个视图、
// 深浅主题、425px 窄屏与只读边界。按需启动、跑完即关，不新增常驻服务。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';
process.env.NODE_USE_ENV_PROXY = '0';

const root = process.cwd();
const out = path.join(root, '.runtime/console');
mkdirSync(out, { recursive: true });
const { listenConsole, CONSOLE_READ_ACTIONS } = await import('./console-server.ts');
const { server, port } = await listenConsole(0);
const base = `http://127.0.0.1:${port}`;
const checks = {};
const failures = [];
const check = (name, condition, detail = {}) => {
  checks[name] = { ok: Boolean(condition), ...detail };
  if (!condition) failures.push(name);
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
  check('index', htmlRes.status === 200 && (await htmlRes.text()).includes('SuitMe 协作台'));
  check('styles', (await fetch(base + '/styles.css')).status === 200);
  check('script', (await fetch(base + '/app.js')).status === 200);

  const viewRes = await fetch(base + '/api/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const viewBody = await viewRes.text();
  let viewData = {};
  try { viewData = JSON.parse(viewBody); } catch {}
  check('realTasks', viewRes.status === 200 && Array.isArray(viewData.tasks) && viewData.tasks.length > 0,
    { status: viewRes.status, tasks: viewData.tasks?.length ?? 0, error: viewRes.status === 200 ? undefined : viewBody.slice(0, 300) });

  // P-5：控制台改拉服务端分页摘要，真跑核对体积、字段裁剪与分页口径。
  const summaryStarted = performance.now();
  const summaryRes = await fetch(base + '/api/view-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const summaryRaw = await summaryRes.text();
  const summaryMs = Math.round(performance.now() - summaryStarted);
  let summary = {};
  try { summary = JSON.parse(summaryRaw); } catch {}
  const summaryBytes = Buffer.byteLength(summaryRaw);
  check('summaryReady', summaryRes.status === 200 && Array.isArray(summary.tasks) && summary.fieldsClipped === true,
    { status: summaryRes.status, bytes: summaryBytes, ms: summaryMs, tasks: summary.tasks?.length ?? 0 });
  check('summaryClipped', summaryBytes < 32768 && !summaryRaw.includes('"snapshots"') && !summaryRaw.includes('"body"'),
    { bytes: summaryBytes });
  check('summaryPageHonest', summary.taskCount === summary.page?.total && typeof summary.page?.hasMore === 'boolean',
    { taskCount: summary.taskCount, total: summary.page?.total });

  const pagedRes = await fetch(base + '/api/view-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: { limit: 2 } }) });
  let paged = {};
  try { paged = await pagedRes.json(); } catch {}
  check('summaryPaged', pagedRes.status === 200 && paged.tasks?.length <= 2 && paged.page?.total === summary.taskCount,
    { tasks: paged.tasks?.length, total: paged.page?.total, expected: summary.taskCount });

  const writeRes = await fetch(base + '/api/create-task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('writeBlocked', writeRes.status === 403, { status: writeRes.status });
  check('readOnlyAllowlist', CONSOLE_READ_ACTIONS.length >= 9 && !CONSOLE_READ_ACTIONS.includes('create-task'),
    { actions: CONSOLE_READ_ACTIONS.length });

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
  await delay(1600);

  const views = [
    ['概览', 'overview'], ['协作', 'collaboration'], ['知识', 'knowledge'],
    ['验收', 'acceptance'], ['服务', 'services'], ['设置', 'settings'],
  ];
  let rendered = 0;
  for (const [title, id] of views) {
    const clicked = await evaluate(`(() => {
      const el=[...document.querySelectorAll('[data-view]')].find(e=>e.dataset.view===${JSON.stringify(id)} && e.offsetParent!==null);
      if(!el) return false; el.click(); return true; })()`);
    let ready = false, textLength = 0;
    for (let i = 0; i < 64; i++) {
      const state = await evaluate(`(() => {
        const c=document.getElementById('content');
        return {cards:c.querySelectorAll('.card').length, loading:!!c.querySelector('.loading-card'), len:c.innerText.trim().length};
      })()`);
      textLength = state?.len ?? 0;
      if (state && state.cards >= 2 && !state.loading && state.len > 60) { ready = true; break; }
      await delay(250);
    }
    check('view-' + id, clicked === true && ready, { title, textLength });
    if (ready) rendered++;
    if (id === 'overview') await screenshot('overview-1280');
  }
  check('allViewsRendered', rendered === views.length, { rendered, total: views.length });

  const themeBefore = await evaluate(`document.documentElement.dataset.theme`);
  await evaluate(`document.getElementById('theme-toggle').click()`);
  await delay(150);
  const themeAfter = await evaluate(`document.documentElement.dataset.theme`);
  const stored = await evaluate(`localStorage.getItem('suitme-theme')`);
  check('themeToggle', themeBefore !== themeAfter && stored === themeAfter, { themeBefore, themeAfter, stored });
  await screenshot('overview-dark');

  const visible = await evaluate(`document.body.innerText`);
  const forbidden = ['Paperclip', 'GitHub', 'Slack', 'Vercel', 'OpenAI', 'Claude Code',
    'Codex', 'Cognee', 'npm run', '/accept', 'acceptance:export'];
  const found = forbidden.filter(word => String(visible).includes(word));
  check('noOverseasCopy', found.length === 0, { found });

  const inputs = await evaluate(`document.querySelectorAll('input,textarea,form').length`);
  check('noWebIntake', inputs === 0, { inputs });
  check('feishuNotice', String(visible).includes('发起任务请回到飞书'));
  let statusText = '';
  for (let i = 0; i < 30; i++) {
    statusText = await evaluate(`document.getElementById('status-text').textContent`);
    if (String(statusText).includes('已连接')) break;
    await delay(250);
  }
  check('serviceConnected', String(statusText).includes('已连接'), { statusText });

  await cdp('Emulation.setDeviceMetricsOverride', { width: 425, height: 900, deviceScaleFactor: 1, mobile: true });
  await delay(400);
  const narrow = await evaluate(`(() => {
    const el=document.documentElement;
    const offenders=[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>el.clientWidth+1).length;
    return {clientWidth:el.clientWidth, scrollWidth:el.scrollWidth, offenders};
  })()`);
  check('responsive425', narrow && narrow.scrollWidth <= narrow.clientWidth + 1 && narrow.offenders === 0, narrow);
  await screenshot('overview-425');
} catch (error) {
  failures.push('exception');
  checks.exception = { ok: false, message: String(error?.message ?? error) };
} finally {
  const report = { ok: failures.length === 0, at: new Date().toISOString(), port, checks, failed: failures };
  writeFileSync(path.join(root, '.runtime/console-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  stop();
  process.exitCode = failures.length ? 1 : 0;
}
