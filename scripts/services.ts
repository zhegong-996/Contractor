// 第二十九轮 P-11 · 辅助本机服务的统一管理入口（也是管理后台「服务管理」的后端）。
//
//   node --import tsx scripts/services.ts status
//   node --import tsx scripts/services.ts start   [vision|report|delivery]
//   node --import tsx scripts/services.ts stop    [name]
//   node --import tsx scripts/services.ts restart [name]
//
// 背景：4190 视觉评审 / 4192 验收报告 / 4194+9418 本机交付台此前是三个
// 独立前台脚本，用户主动取消后没有统一的重启口径。本轮用户明确「全部搞定」，
// 按同一套 PID + 健康检查口径纳管，与管理后台的服务开关共用这一个入口。
//
// 红线不变：全部只监听 127.0.0.1；PID 归属校验失败拒绝操作；
// 本脚本不代替任何真人授权，也不触碰飞书 / 外部网络。
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, root, runtime } from '../src/config.ts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(runtime('logs'), { recursive: true });

export type AuxSpec = {
  name: string; label: string; script: string; args?: string[];
  httpPort: number; httpPath: string;
  /** 附带的 TCP 端口（如交付台的 git daemon 9418）；无则为空。 */
  tcpPorts?: number[];
  note: string;
};

export const AUX_SERVICES: AuxSpec[] = [
  { name: 'vision', label: '视觉评审（本机 Apple Vision 模型）', script: 'scripts/vision-server.ts',
    httpPort: 4190, httpPath: '/health',
    note: 'OpenAI 兼容端点 /v1/chat/completions；截图不出本机、不联网。' },
  { name: 'report', label: '验收报告（只读）', script: 'scripts/acceptance-report.ts', args: ['serve'],
    httpPort: 4192, httpPath: '/overview',
    note: '独立评审逐项报告的只读承载；不代替原发起人确认验收。' },
  { name: 'delivery', label: '本机代码交付台', script: 'scripts/delivery-server.ts',
    httpPort: 4194, httpPath: '/', tcpPorts: [9418],
    note: 'HTTP 4194 + git daemon 9418；审批是代码合并审批，不等于业务验收。' },
  { name: 'console', label: '协作台管理后台（登录制）', script: 'scripts/console-server.ts',
    httpPort: 4200, httpPath: '/',
    note: '分权限管理后台：账号 / 服务 / 审核与审计；只监听回环，发起任务仍在飞书。' },
];

function pidFile(name: string) { return runtime(`${name}-service.pid`); }

/** 与 scripts/up.ts 相同的归属校验：PID 必须还在、且命令行属于本项目脚本；
 * ps 在部分沙箱拿不到命令行时，退回「PID 正在监听该服务端口」判断。 */
function ownsPid(pid: number, script: string, ports: number[]): boolean {
  try { process.kill(pid, 0); } catch { return false; }
  try {
    const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    if (cmd.includes(path.join(root, script)) || cmd.includes(script)) return true;
  } catch { /* ps 在部分沙箱不可用，继续用端口归属判断 */ }
  for (const port of ports) {
    try {
      const listeners = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
        { encoding: 'utf8' });
      if (listeners.split('\n').map(line => Number(line.trim())).filter(Boolean).includes(pid)) return true;
    } catch { /* lsof 不可用则继续 */ }
  }
  return false;
}

function tcpOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 1200 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

function httpOk(port: number, pathname: string): Promise<boolean> {
  // 用 node:http 直连而不是 fetch：本机环境可能配置了 HTTP(S)_PROXY，
  // fetch 会被代理劫持回环地址；健康检查必须绕开任何代理。
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, timeout: 3000,
      headers: { Connection: 'close' } }, res => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

export async function auxHealth(spec: AuxSpec): Promise<{
  name: string; label: string; running: boolean; http: boolean; tcp: boolean; pid: number | null; note: string;
}> {
  const file = pidFile(spec.name);
  const pid = existsSync(file) ? Number(readFileSync(file, 'utf8')) : null;
  const owned = pid != null && Number.isFinite(pid)
    && ownsPid(pid, spec.script, [spec.httpPort, ...(spec.tcpPorts ?? [])]);
  const http = await httpOk(spec.httpPort, spec.httpPath);
  const tcp = spec.tcpPorts ? (await Promise.all(spec.tcpPorts.map(tcpOpen))).every(Boolean) : true;
  return { name: spec.name, label: spec.label, running: (owned || http) && tcp, http, tcp, pid: owned ? pid : null,
    note: spec.note };
}

async function stopAux(spec: AuxSpec): Promise<string> {
  const file = pidFile(spec.name);
  const health = await auxHealth(spec);
  if (!existsSync(file)) return `${spec.name}: 没有本管理器的 PID 记录${health.http ? '（端口仍在监听，可能是手动启动的进程）' : ''}`;
  const pid = Number(readFileSync(file, 'utf8'));
  if (!ownsPid(pid, spec.script, [spec.httpPort, ...(spec.tcpPorts ?? [])]))
    return `${spec.name}: PID 归属校验失败，拒绝操作`;
  try { process.kill(pid, 'SIGTERM'); } catch (error) { return `${spec.name}: ${String(error)}`; }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!(await httpOk(spec.httpPort, spec.httpPath))) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return `${spec.name}: stopping`;
}

async function startAux(spec: AuxSpec): Promise<string> {
  const health = await auxHealth(spec);
  if (health.running) return `${spec.name}: already running`;
  const log = openSync(runtime('logs', `${spec.name}.log`), 'a', 0o600);
  const child = spawn(process.execPath,
    ['--import', path.join(rootDir, 'node_modules/tsx/dist/loader.mjs'), path.join(rootDir, spec.script),
      ...(spec.args ?? [])],
    { cwd: rootDir, detached: true, stdio: ['ignore', log, log], env: process.env });
  writeFileSync(pidFile(spec.name), String(child.pid), { mode: 0o600 });
  child.unref();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await httpOk(spec.httpPort, spec.httpPath)) return `${spec.name}: ready`;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return `${spec.name}: 未在 30 秒内就绪；查看 .runtime/logs/${spec.name}.log`;
}

async function main() {
  const [action, target] = process.argv.slice(2);
  const specs = target ? AUX_SERVICES.filter(s => s.name === target) : AUX_SERVICES;
  if (target && !specs.length) { console.log(`未知服务：${target}（可选：${AUX_SERVICES.map(s => s.name).join(' | ')}）`); process.exitCode = 1; return; }
  // 载入配置只为保证环境一致；这些服务自身读取 .runtime/config.json。
  loadConfig();
  if (action === 'status') {
    for (const spec of specs) {
      const health = await auxHealth(spec);
      console.log(`${health.name}: ${health.running ? 'running' : 'stopped'} (http=${health.http} tcp=${health.tcp})`);
    }
    return;
  }
  if (action === 'stop') { for (const spec of specs) console.log(await stopAux(spec)); return; }
  if (action === 'start') { for (const spec of specs) console.log(await startAux(spec)); return; }
  if (action === 'restart') {
    for (const spec of specs) { console.log(await stopAux(spec)); console.log(await startAux(spec)); }
    return;
  }
  console.log('用法：services.ts status | start [name] | stop [name] | restart [name]（不指定 name 时作用于全部辅助服务）');
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
