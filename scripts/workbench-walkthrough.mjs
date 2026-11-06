// Real-host browser walkthrough. Drives the running Paperclip + SuitMe bridge
// instance through the existing 5 tabs and the three v0.6 sub-views, captures
// screenshots and asserts that every workspace action actually returns data.
//
// Usage: npm run test:walkthrough [-- --url http://127.0.0.1:3100/SUI/knowledge-workspaces]
// Requires: Google Chrome (macOS), Paperclip on 3100, bridge on 4180.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const out = path.join(root, '.runtime/walkthrough');
mkdirSync(out, { recursive: true });
const argUrl = process.argv.indexOf('--url');
const pageUrl = argUrl > 0 ? process.argv[argUrl + 1] : 'http://127.0.0.1:3100/SUI/knowledge-workspaces';
const chromeBin = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9361 + Math.floor(Math.random() * 200);
const profile = path.join(out, 'chrome-walkthrough');

const chrome = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'],
  { stdio: 'ignore' });
let ws;
const stop = () => { try { ws?.close(); } catch {} try { chrome.kill('SIGTERM'); } catch {} };
process.on('exit', stop);

async function waitForChrome() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return; } catch {}
    await delay(200);
  }
  throw new Error('Chrome 调试端口未就绪');
}
await waitForChrome();
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === 'page');
if (!page) throw new Error('找不到 Chrome 页面目标');
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => { ws.onopen = resolve; });
let seq = 0; const pending = new Map(); let expired = 0;
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  else if (message.method === 'Emulation.virtualTimeBudgetExpired') expired++;
};
const cdp = (method, params = {}) => new Promise(resolve => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.result?.exceptionDetails) throw new Error(String(response.result.exceptionDetails.text).slice(0, 200));
  return response.result?.result?.value;
};
const click = async (text, exact = true) => evaluate(`(() => {
  const els=[...document.querySelectorAll('button,a,[role="tab"],summary')].filter(e=>e.offsetParent!==null);
  const el=${exact}?els.find(e=>e.textContent.trim()===${JSON.stringify(text)}):els.find(e=>e.textContent.includes(${JSON.stringify(text)}));
  if(!el)return false; el.click(); return true; })()`);
const screenshot = async name => {
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(out, `${name}.png`), Buffer.from(result.result.data, 'base64'));
};

await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
// 宿主静态资源会随中文壳重建而变化；禁用缓存，避免走查拿到旧 bundle 误判适配层已生效。
await cdp('Network.setCacheDisabled', { cacheDisabled: true });
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: pageUrl });
await delay(300);
await cdp('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: 15000 });
for (let i = 0; i < 100 && !expired; i++) await delay(200);
await cdp('Emulation.setVirtualTimePolicy', { policy: 'advance' });
await delay(1800);

const sequence = [
  { name: 'overview-1280', tab: null, sub: null, expect: ['SuitMe 协作台', '发起协作'] },
  { name: 'collaboration-1280', tab: '协作', sub: null, expect: ['任务', '访问申请'] },
  { name: 'governance-acceptance-1280', tab: '协作', sub: '验收与责任', expect: ['开工前锁定的验收清单', '逐项评审报告', '独立评审就绪状态'] },
  { name: 'governance-responsibility-1280', tab: '协作', sub: '责任', expect: ['跨职能授权卡片', '跨空间上下文授权'] },
  { name: 'governance-trace-1280', tab: '协作', sub: '过程流水', expect: ['统一过程流水'] },
  { name: 'knowledge-1280', tab: '知识', sub: null, expect: ['知识'] },
  // The knowledge tab has two navigation levels: enter "内容与图谱" first,
  // then the relations sub-view appears in the inner nav.
  { name: 'knowledge-state-1280', tab: '知识', preClicks: ['内容与图谱'], sub: '关系与状态', expect: ['关系与状态'] },
  { name: 'agent-1280', tab: 'Agent', sub: null, expect: ['Agent'] },
  { name: 'settings-1280', tab: '设置', sub: null, expect: ['组织规则'] },
  { name: 'organization-1280', tab: '设置', sub: '组织规则', expect: ['组织规则', '职能注册表'] },
  { name: 'domestic-services-1280', tab: '设置', sub: '国内服务',
    expect: ['国内可用服务', '未接通不放入口', '状态来源'], domestic: true },
];
const steps = [];
for (const step of sequence) {
  let tabFound = true, subFound = true;
  if (step.tab) tabFound = await click(step.tab, true);
  await delay(1100);
  for (const pre of step.preClicks ?? []) { await click(pre, true); await delay(900); }
  if (step.sub) { subFound = await click(step.sub, true); await delay(1600); }
  const body = String(await evaluate('document.body.innerText') ?? '');
  const invalid = body.includes('Invalid workspace action');
  const unavailable = body.includes('暂不可用');
  const unavailableContext = unavailable
    ? body.slice(Math.max(0, body.indexOf('暂不可用') - 120), body.indexOf('暂不可用') + 200) : null;
  const hits = step.expect.filter(text => body.includes(text));
  // 「国内服务」页额外做真实 DOM 校验：状态表必须有行、必须可刷新，
  // 且渲染出来的每一个链接都只能是本机 loopback 地址（未接通项不能偷偷带 href）。
  const domesticCheck = step.domestic ? await evaluate(`(() => {
    const head = [...document.querySelectorAll('h2')].find(h => h.textContent.trim() === '国内可用服务');
    const section = head?.closest('section');
    if (!section) return { found: false, rows: 0, links: [], badLinks: [], hasRefresh: false, hasUnconnectedStep: false };
    const links = [...section.querySelectorAll('a')].map(a => a.getAttribute('href') ?? '');
    const badLinks = links.filter(h => !(h.startsWith('http://127.0.0.1:') || h.startsWith('http://localhost:')));
    const hostNav = [...document.querySelectorAll('a,button')]
      .filter(e => /^(技能|连接服务|Skills|Connectors)$/.test((e.textContent || '').trim()))
      .map(e => ({ tag: e.tagName, href: e.getAttribute('href'),
        hidden: !!e.dataset.suitmeHidden || getComputedStyle(e).display === 'none' }));
    return { found: true, rows: section.querySelectorAll('tbody tr').length, links, badLinks,
      hasRefresh: section.textContent.includes('刷新状态'),
      hasUnconnectedStep: section.textContent.includes('接通后此页自动出现入口'),
      noLoadError: !section.querySelector('.sm-error'),
      hostNavHidden: hostNav.every(x => x.hidden), hostNav };
  })()`) : null;
  await screenshot(step.name);
  steps.push({ name: step.name, tabFound, subFound, expect: step.expect, hits, domesticCheck,
    invalidWorkspaceAction: invalid, unavailable, unavailableContext, screenshot: `${step.name}.png` });
  console.log(`${invalid ? '✖' : '✓'} ${step.name}: ${hits.length}/${step.expect.length} 项可见, tab=${tabFound}, sub=${subFound}${invalid ? ' [Invalid workspace action]' : ''}${unavailable ? ' [暂不可用]' : ''}`);
}

// Real host at 425px: keep the same DOM, override the viewport, measure the
// plugin container only (the native Paperclip shell manages its own scroll).
await cdp('Emulation.setDeviceMetricsOverride', { width: 425, height: 900, deviceScaleFactor: 1, mobile: true });
await delay(1600);
await click('协作', true); await delay(1200);
await click('验收与责任', true); await delay(1600);

// A React re-render right after the viewport switch can leave a transient
// narrow ancestor (observed once as clientWidth 153 instead of 393). Wait for
// the plugin container width to settle before measuring; a genuinely broken
// layout still fails the assertions below instead of being papered over.
let lastWidth = -1, stable = 0;
for (let i = 0; i < 24; i++) {
  const w = Number(await evaluate(`(() => { const e=document.querySelector('.suitme-workbench'); return e ? e.clientWidth : -1; })()`) ?? -1);
  stable = w > 0 && w === lastWidth ? stable + 1 : 0;
  lastWidth = w;
  if (stable >= 3 && w >= 300) break;
  await delay(300);
}
const narrow = await evaluate(`(() => {
  const el=document.querySelector('.suitme-workbench');
  if(!el)return {found:false};
  const left=el.getBoundingClientRect().left;
  const buttons=[...el.querySelectorAll('button')].filter(b=>b.offsetParent!==null);
  const offenders=[...el.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right-left>el.clientWidth+1&&getComputedStyle(x).overflowX!=='auto');
  return {found:true,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,
    minButtonHeight:buttons.length?Math.min(...buttons.map(b=>b.getBoundingClientRect().height)):0,
    overflowOffenders:offenders.length};
})()`);
await screenshot('governance-425');
console.log('✓ governance-425:', JSON.stringify(narrow));

const failed = steps.filter(s => s.invalidWorkspaceAction || s.unavailable || !s.tabFound || s.hits.length === 0
  || (s.domesticCheck && (!s.domesticCheck.found || s.domesticCheck.rows === 0
    || s.domesticCheck.badLinks.length > 0 || !s.domesticCheck.hasRefresh
    || !s.domesticCheck.hasUnconnectedStep || !s.domesticCheck.noLoadError
    || !s.domesticCheck.hostNavHidden)));
const narrowOk = !!narrow.found && narrow.scrollWidth <= narrow.clientWidth + 1
  && narrow.overflowOffenders === 0 && narrow.minButtonHeight >= 43.5;
const report = { at: new Date().toISOString(), url: pageUrl, viewport: [1280, 425],
  steps, narrow, narrowOk, ok: failed.length === 0 && narrowOk,
  failures: failed.map(s => s.name) };
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, steps: steps.length, failures: report.failures }, null, 2));
stop();
if (!report.ok) process.exitCode = 1;
