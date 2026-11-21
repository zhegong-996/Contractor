import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import path from 'node:path';

const state = process.env.COLLAB_STATE_DIR;
if (!state || !path.isAbsolute(state)) throw new Error('请设置 COLLAB_STATE_DIR 的绝对路径。');
const config = JSON.parse(readFileSync(path.join(state, 'workbench.json'), 'utf8'));
const base = new URL(config.workbenchPublicUrl);
const listen = Number(process.argv[2]);
const validPort = port => Number.isInteger(port) && port >= 1024 && port <= 65535;
if (base.protocol !== 'https:' || base.href !== base.origin + '/' || base.username || base.password
  || !validPort(listen) || !validPort(config.port) || listen === config.port)
  throw new Error('请设置工作台的 HTTPS 根地址及独立的反向代理回环端口。');
const runner = config.runnerConnectUrl && new URL(config.runnerConnectUrl).href === base.href;
if (runner && (!validPort(config.remoteRunnerPort) || [config.port, listen].includes(config.remoteRunnerPort)))
  throw new Error('使用同一 HTTPS 地址登记设备时，远程接单服务需要独立的回环端口。');

const machinePaths = /^\/api\/runner\/(?:enroll|enroll-status|pair|work|started|result|offline|protocol)$/;
const confirmationPath = /^\/runner\/connect\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const shellFiles = new Set(['/', '/favicon.ico', '/licenses/components', '/licenses/browser-dependencies']);
const webHeaders = ['cookie', 'content-type', 'content-length', 'origin', 'accept', 'user-agent', 'range'];
const machineHeaders = ['authorization', 'content-type', 'content-length', 'x-contractor-execution'];
const reject = (res, status) => res.writeHead(status, { 'cache-control': 'no-store' }).end();

// This listener sits behind TLS. Upstream browser requests use the configured public origin.
createServer((req, res) => {
  const url = req.url ?? '';
  if (!url.startsWith('/') || url.startsWith('//')) return reject(res, 404);
  const pathname = url.split('?', 1)[0];
  try {
    const target = new URL(url, base);
    if (target.origin !== base.origin || target.pathname !== pathname) return reject(res, 404);
  } catch { return reject(res, 404); }
  const get = req.method === 'GET';
  const post = req.method === 'POST';
  const machine = runner && post && machinePaths.test(url);
  const confirmation = runner && (get || post) && confirmationPath.test(pathname);
  const file = get && (shellFiles.has(pathname) || /^\/assets\/[\w-]+\.(js|css|webp)$/.test(pathname));
  const web = (get || post) && /^\/api\/(?!runner(?:\/|$))[a-z][a-z0-9-]*(?:\/|$)/.test(pathname);
  if (!machine && !confirmation && !file && !web) return reject(res, 404);
  if (machine && (req.headers.cookie || req.headers.origin)) return reject(res, 403);
  const headers = { host: base.host };
  for (const name of machine ? machineHeaders : webHeaders) {
    if (req.headers[name] !== undefined) headers[name] = req.headers[name];
  }
  const upstream = request({ hostname: '127.0.0.1', port: machine ? config.remoteRunnerPort : config.port,
    path: url, method: req.method, headers }, reply => {
    res.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(res);
  });
  upstream.setTimeout(machine ? 60_000 : 25_000, () => upstream.destroy());
  upstream.on('error', () => {
    if (res.headersSent) res.destroy();
    else reject(res, 502);
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}).listen(listen, '127.0.0.1', () => console.log('工作台 HTTPS 反向代理已在回环地址就绪。'));
