import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime } from '../src/config.ts';

mkdirSync(runtime('logs'), { recursive: true });
const action = process.argv[2] ?? 'up';
const services = [
  { name: 'paperclip', script: 'scripts/paperclip.ts', url: 'http://127.0.0.1:3100/api/health' },
  { name: 'bridge', script: 'src/server.ts', url: 'http://127.0.0.1:4180/health' },
];
for (const service of action === 'restart-bridge' ? services.filter(s => s.name === 'bridge') : action === 'stop' ? [...services].reverse() : services) {
  const file = runtime(`${service.name}-service.pid`);
  let online = await fetch(service.url).then(r => r.ok).catch(() => false);
  if (action === 'restart-bridge' && online) {
    if (!existsSync(file)) throw new Error('Bridge is not owned by this supervisor');
    const pid = Number(readFileSync(file, 'utf8'));
    const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    if (!cmd.includes(path.join(root, service.script))) throw new Error('PID identity changed; refusing to stop');
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
      const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
      if (!cmd.includes(path.join(root, service.script))) throw new Error('PID identity changed; refusing to stop');
      process.kill(pid, 'SIGTERM'); console.log(`${service.name}: stopping`);
    } catch (error) { console.log(`${service.name}: ${String(error).split('\n')[0]}`); }
    continue;
  }
  if (online) { console.log(`${service.name}: already running`); continue; }
  const log = openSync(runtime('logs', `${service.name}.log`), 'a', 0o600);
  const child = spawn(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, service.script)],
    { cwd: root, detached: true, stdio: ['ignore', log, log], env: process.env });
  writeFileSync(file, String(child.pid), { mode: 0o600 }); child.unref();
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await fetch(service.url).then(r => r.ok).catch(() => false)) { console.log(`${service.name}: ready`); break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!(await fetch(service.url).then(r => r.ok).catch(() => false))) throw new Error(`${service.name} did not become ready; inspect .runtime/logs/${service.name}.log`);
}
