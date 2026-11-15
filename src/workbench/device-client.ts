import { chmod, copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { WorkerHub } from '../../upstream/autoloop/worker/worker.ts';
import { runtime } from '../config.ts';
import { trackWorkerProcesses } from './autoloop.ts';
import { deviceHome } from './devices.ts';

if (!process.env.COLLAB_STATE_DIR || !path.isAbsolute(process.env.COLLAB_STATE_DIR))
  throw new Error('请使用工作台的 COLLAB_STATE_DIR 绝对路径。');
const portSchema = z.coerce.number().int().min(1024).max(65535);
const credentials = z.object({ id: z.uuid(), port: portSchema, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const argv = process.argv.slice(2);

async function request<T>(port: number, action: string, data: unknown, token?: string): Promise<T> {
  const response = await fetch('http://127.0.0.1:' + port + '/api/runner/' + action, {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '接单服务暂不可用。');
  return result;
}

if (argv[0] === 'pair') {
  const port = portSchema.parse(argv[1]);
  const name = z.string().trim().min(1).max(100).parse(argv[2]);
  const code = z.string().regex(/^[a-f0-9]{24}$/).parse((await readFile('/dev/stdin', 'utf8')).trim());
  const host = await readFile(runtime('devices', 'host.key'), 'utf8');
  const result = await request<{ id: string; token: string }>(port, 'pair', { code, name, host: host.trim() });
  const connection = credentials.parse({ ...result, port });
  await mkdir(runtime('devices', connection.id), { mode: 0o700, recursive: true });
  await writeFile(runtime('devices', connection.id, 'connection.json'), JSON.stringify(connection), { mode: 0o600, flag: 'wx' });
  console.log('已配对。执行端 ID ' + connection.id);
  console.log('启动命令 npm run runner -- connect ' + connection.id);
} else if (argv[0] === 'connect') {
  const id = z.uuid().parse(argv[1]);
  const connection = credentials.parse(JSON.parse(await readFile(runtime('devices', id, 'connection.json'), 'utf8')));
  if (id !== connection.id) throw new Error('执行端配置与 ID 不一致。');
  const home = deviceHome(id);
  const lock = runtime('devices', id, 'running.pid');
  await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }).catch(async error => {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lock, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('无法核对旧接单进程。');
    try { process.kill(pid, 0); }
    catch (sample) {
      if ((sample as NodeJS.ErrnoException).code !== 'ESRCH') throw sample;
      await unlink(lock);
      await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
      return;
    }
    throw new Error('此执行端已在运行。');
  });
  try {
    const connectionFile = runtime('devices', id, 'connection.json');
    if ((await stat(connectionFile)).mode & 0o077) throw new Error('执行端凭据应只允许当前用户读取。');
    const plugin = path.join(home, 'plugins', 'suitme-isolated');
    await mkdir(plugin, { recursive: true, mode: 0o700 });
    await copyFile(runtime('autoloop', 'plugins', 'suitme-isolated', 'agent.ts'), path.join(plugin, 'agent.ts'));
    await chmod(path.join(plugin, 'agent.ts'), 0o600);
    process.env.AGENT_AUTOLOOP_HOME = home;
    // Environment paths are captured once by the native worker module.
    const { createWorker } = await import('../../upstream/autoloop/worker/worker.ts');
    const send = <T>(action: string, data: unknown) => request<T>(connection.port, action, data, connection.token);
    const hub: WorkerHub = {
      work: data => send('work', data),
      started: (run, lease, value) => send('started', { run, lease, value }),
      result: (run, lease, value) => send('result', { run, lease, value }),
    };
    const worker = createWorker({ hub, name: id, capacity: 1, wait: 0, log(line) {
      const started = /^run (\d+) .* turn \d+ started, pid \d+$/.exec(line);
      if (started) trackWorkerProcesses(Number(started[1]), false, home);
      if (/^run \d+: (done|failed|cancelled|nothing)/.test(line)) console.log(line.split(': ').slice(0, 2).join(': '));
    } });
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.once('SIGTERM', () => stop.abort());
    worker.tidy();
    console.log('执行端正在连接 ' + id);
    while (!stop.signal.aborted) {
      for (const entry of worker.entries()) trackWorkerProcesses(entry.run, false, home);
      await worker.tick();
      if (!stop.signal.aborted) await delay(800);
    }
    await send('offline', {}).catch(() => {});
  } finally {
    if (await readFile(lock, 'utf8').catch(() => '') === String(process.pid)) await unlink(lock);
  }
} else {
  throw new Error('用 runner -- pair <端口> <设备名称> 配对，或用 runner -- connect <执行端 ID> 接单。');
}
