/**
 * 独立协作台控制台：自研前端外壳的本地承载服务。
 *
 * 设计约束（与 PRD §10A 的 S1–S4 一致）：
 * - 只监听回环地址，不对外暴露业务材料；
 * - 浏览器只拿到只读 action 的结果，密钥永远留在服务端；
 * - 不提供任何「网页发起任务」入口，发起仍在飞书；
 * - 不依赖宿主插件接口，宿主只作为数据层，随时可换。
 */
import { createServer, request as httpRequest, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, secrets } from '../src/config.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consoleDir = path.join(root, 'console');

/** 控制台允许读取的动作；写操作一律不开放。与 bridge 的只读分发保持一致。 */
export const CONSOLE_READ_ACTIONS: readonly string[] = [
  'view', 'service-status', 'system-status', 'memory-status', 'memory-replay',
  'routing-status', 'trace-view', 'model-settings', 'v06-org-overview',
  'network-view', 'ontology-view', 'context-pack', 'memory-search',
  'v06-agent-registry-view',
] as const;

const STATIC: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
};

function applyHeaders(res: ServerResponse): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 65536) throw new Error('请求体过大');
  }
  return data;
}

/** 把只读请求转发到本机协作服务的动作分发口；不透传浏览器来源头。 */
function proxy(action: string, body: string): Promise<{ status: number; payload: string }> {
  const config = loadConfig();
  const token = secrets().adminToken;
  const payload = JSON.stringify({ payload: body ? JSON.parse(body).payload ?? {} : {} });
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1', port: config.bridgePort,
      path: '/workspace/' + action, method: 'POST', timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: 'Bearer ' + token,
      },
    }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { out += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 502, payload: out }));
    });
    req.on('timeout', () => req.destroy(new Error('协作服务响应超时')));
    req.on('error', reject);
    req.end(payload);
  });
}

export function createConsoleServer(): Server {
  return createServer(async (req, res) => {
    applyHeaders(res);
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const item = STATIC[url.pathname]!;
        res.writeHead(200, { 'Content-Type': item.type });
        res.end(readFileSync(path.join(consoleDir, item.file)));
        return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const action = url.pathname.slice('/api/'.length);
        if (!CONSOLE_READ_ACTIONS.includes(action)) {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '只允许读取已登记的状态，不提供任务发起或写入' }));
          return;
        }
        const body = await readBody(req);
        const result = await proxy(action, body);
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(result.payload);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '未找到' }));
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String((error as Error).message ?? error) }));
    }
  });
}

/** 供冒烟脚本在同一进程内启动，避免新增常驻服务。 */
export function listenConsole(port = 0): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createConsoleServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : port });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.CONSOLE_PORT ?? 4200);
  listenConsole(port).then(({ port: bound }) => {
    console.log(`SuitMe 协作台已启动：http://127.0.0.1:${bound}/`);
    console.log('只读控制台，发起任务请回到飞书；按需启动，不是常驻服务。');
  }).catch(error => { console.error(String(error)); process.exitCode = 1; });
}
