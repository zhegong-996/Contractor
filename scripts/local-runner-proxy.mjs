import { createServer, request } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const state = process.env.COLLAB_STATE_DIR;
if (!state || !path.isAbsolute(state)) throw new Error('请设置 COLLAB_STATE_DIR 的绝对路径。');
const config = JSON.parse(readFileSync(path.join(state, 'workbench.json'), 'utf8'));
const base = new URL(config.runnerConnectUrl);
const ports = [Number(base.port), config.port, config.remoteRunnerPort];
if (base.origin !== 'http://127.0.0.1:' + ports[0] || base.href !== base.origin + '/'
  || new Set(ports).size !== ports.length || !ports.every(port => Number.isInteger(port) && port >= 1024 && port <= 65535))
  throw new Error('本机示例需要三个独立端口与 http://127.0.0.1 上的执行端连接地址。');

const [listen, workbench, runner] = ports;
createServer((req, res) => {
  const url = req.url ?? '';
  const target = /^\/runner\/connect\/[a-f0-9-]+(?:\?[^#]*)?$/.test(url) ? workbench
    : /^\/api\/runner\/(?:enroll|enroll-status|pair|work|started|result|offline|protocol)$/.test(url) ? runner : undefined;
  if (!target || req.headers.host !== base.host) {
    res.writeHead(404, { 'cache-control': 'no-store' }).end('未找到。');
    return;
  }
  const forward = request({ hostname: '127.0.0.1', port: target, path: url, method: req.method, headers: req.headers }, reply => {
    res.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(res);
  });
  forward.on('error', () => {
    if (res.headersSent) res.destroy();
    else res.writeHead(502, { 'cache-control': 'no-store' }).end('请先启动本机工作台。');
  });
  res.on('close', () => forward.destroy());
  req.pipe(forward);
}).listen(listen, '127.0.0.1', () => console.log('本机执行端连接入口 ' + base.origin));
