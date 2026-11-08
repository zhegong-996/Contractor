// 一次性：对运行中的 console（4200）以 owner 身份截图（登录页 / 知识页含语义检索 / 服务页）。
// 复用 console-smoke.mjs 的 CDP 模式；凭据来自 .runtime/console/owner-password.txt，不写仓库。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

const out = path.join(process.cwd(), '.runtime/console');
const password = readFileSync(path.join(out, 'owner-password.txt'), 'utf8').trim();
const chromeBin = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdpPort = 9233;
const chrome = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${path.join(out, 'chrome-shot-profile')}`,
  '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
let ws;
const stop = () => { try { ws?.close(); } catch {} try { chrome.kill('SIGTERM'); } catch {} };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(1); });

for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok) break; } catch {}
  await delay(200);
}
const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const page = targets.find(t => t.type === 'page');
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
  if (response.result?.exceptionDetails) throw new Error(String(response.result.exceptionDetails.text).slice(0, 300));
  return response.result?.result?.value;
};
const screenshot = async name => {
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(out, name + '.png'), Buffer.from(result.result.data, 'base64'));
};
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Network.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1.5, mobile: false });

// 1. 登录页
await cdp('Page.navigate', { url: 'http://127.0.0.1:4200/' });
await delay(2500);
await screenshot('owner-01-login');

// 2. owner 登录
await evaluate(`(() => {
  const inputs = document.querySelectorAll('.login-card input');
  const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(inputs[0], 'gongzhe'); set(inputs[1], ${JSON.stringify(password)});
  document.querySelector('.login-card button').click(); return true;
})()`);
await delay(2500);

// 3. 知识页（含语义检索卡）
await evaluate(`(() => { [...document.querySelectorAll('.el-menu-item, aside button, nav button')].find(b => b.textContent.includes('知识'))?.click(); return true; })()`);
await delay(1800);
const hasSearch = await evaluate(`document.body.innerText.includes('语义检索')`);
console.log('语义检索卡可见:', hasSearch);
await screenshot('owner-02-knowledge-search');

// 4. 服务页
await evaluate(`(() => { [...document.querySelectorAll('.el-menu-item, aside button, nav button')].find(b => b.textContent.includes('服务'))?.click(); return true; })()`);
await delay(2000);
await screenshot('owner-03-services');

// 5. 概览页
await evaluate(`(() => { [...document.querySelectorAll('.el-menu-item, aside button, nav button')].find(b => b.textContent.includes('概览'))?.click(); return true; })()`);
await delay(1800);
await screenshot('owner-04-overview');

stop();
console.log('done: .runtime/console/owner-01-login.png, owner-02-knowledge-search.png, owner-03-services.png, owner-04-overview.png');
