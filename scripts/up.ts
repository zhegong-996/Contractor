import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime } from '../src/config.ts';

mkdirSync(runtime('logs'), { recursive: true });
const action = process.argv[2] ?? 'up';
const services = [
  { name: 'paperclip', script: 'scripts/paperclip.ts', port: 3100, url: 'http://127.0.0.1:3100/api/health' },
  { name: 'bridge', script: 'src/server.ts', port: 4180, url: 'http://127.0.0.1:4180/health' },
];

/**
 * 校验 PID 确实属于本项目服务再允许停止。
 * 优先按命令行判断；在禁用 ps 的沙箱/受限环境里退回「pid 正在监听该服务端口」，
 * 两者都拿不到就拒绝停止，避免误杀无关进程。
 */
function ownsServicePid(pid: number, script: string, port: number): boolean {
  try { process.kill(pid, 0); } catch { return false; }
  try {
    const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    if (cmd.includes(path.join(root, script))) return true;
  } catch { /* ps 在部分沙箱不可用，继续用端口归属判断 */ }
  let listeners: number[] = [];
  try {
    listeners = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
      .split('\n').map(line => Number(line.trim())).filter(Boolean);
  } catch { return false; }
  if (listeners.includes(pid)) return true;
  // paperclip 是「supervisor（pid 文件里记的那个）→ 子进程监听端口」两层结构，
  // ps 被沙箱禁用时上面的命令匹配拿不到，这里用 pgrep -P 认亲，避免 stop 卡死。
  try {
    const children = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split('\n').map(line => Number(line.trim())).filter(Boolean);
    return listeners.some(listener => children.includes(listener));
  } catch { return false; }
}
// 启动时兜底：如果上游重新构建过 UI 把中文壳覆盖成英文，这里自动重建一次。
// 只检查标记，不每次都跑 Vite，避免拖慢日常启动。
if (action === 'up') {
  const indexHtml = path.join(root, 'upstream/paperclip/ui/dist/index.html');
  if (existsSync(indexHtml) && !readFileSync(indexHtml, 'utf8').includes('suitme-domestic.js')) {
    const nodeBin = existsSync('/usr/local/bin/node') ? '/usr/local/bin/node' : process.execPath;
    const rebuilt = spawnSync(nodeBin, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'),
      'scripts/build-chinese-shell.ts'], { cwd: root, stdio: 'inherit', env: process.env });
    if (rebuilt.status !== 0) throw new Error('中文界面构建失败；请先运行 npm run install:upstream');
  }
}
for (const service of action === 'restart-bridge' ? services.filter(s => s.name === 'bridge') : action === 'stop' ? [...services].reverse() : services) {
  const file = runtime(`${service.name}-service.pid`);
  let online = await fetch(service.url).then(r => r.ok).catch(() => false);
  if (action === 'restart-bridge' && online) {
    if (!existsSync(file)) throw new Error('Bridge is not owned by this supervisor');
    const pid = Number(readFileSync(file, 'utf8'));
    if (!ownsServicePid(pid, service.script, service.port)) throw new Error('PID identity changed; refusing to stop');
    process.kill(pid, 'SIGTERM');
    const deadline = Date.now() + 35000;
    while (Date.now() < deadline) {
      online = await fetch(service.url).then(r => r.ok).catch(() => false); if (!online) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (online) throw new Error('Bridge is finishing in-flight work; retry after it stops');
  }
  if (action === 'status') { console.log(`${service.name}: ${online ? 'running' : 'stopped'}`); continue; }
  if (action === 'stop') {
    if (!existsSync(file)) { console.log(`${service.name}: not owned by this supervisor`); continue; }
    const pid = Number(readFileSync(file, 'utf8'));
    try {
      if (!ownsServicePid(pid, service.script, service.port)) throw new Error('PID identity changed; refusing to stop');
      process.kill(pid, 'SIGTERM'); console.log(`${service.name}: stopping`);
    } catch (error) { console.log(`${service.name}: ${String(error).split('\n')[0]}`); }
    continue;
  }
  if (online) { console.log(`${service.name}: already running`); continue; }
  const log = openSync(runtime('logs', `${service.name}.log`), 'a', 0o600);
  const child = spawn(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, service.script)],
    { cwd: root, detached: true, stdio: ['ignore', log, log], env: process.env });
  writeFileSync(file, String(child.pid), { mode: 0o600 }); child.unref();
  const deadline = Date.now() + (service.name === 'paperclip' ? 120000 : 90000);
  while (Date.now() < deadline) {
    if (await fetch(service.url).then(r => r.ok).catch(() => false)) { console.log(`${service.name}: ready`); break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!(await fetch(service.url).then(r => r.ok).catch(() => false))) throw new Error(`${service.name} did not become ready; inspect .runtime/logs/${service.name}.log`);
}
