import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { WorkerFactory, WorkerHub } from './execution/protocol.ts';
import { parseResult } from './execution/protocol.ts';
import { runtime } from '../config.ts';
import { trackWorkerProcesses } from './worker-process.ts';
import { checkClaudeRunnerModel, remoteEngine, runnerAgentSchema } from './runner-profile.ts';
import { deviceHome, type DeviceJob, type ReleasedLease } from './devices.ts';
import { cleanAcknowledged, cleanRemoteCodex, neverLaunched, prepareRemote, remoteStop } from './remote-runner.ts';
import { runnerEndpoint } from './runner-connection.ts';

if (!process.env.COLLAB_STATE_DIR || !path.isAbsolute(process.env.COLLAB_STATE_DIR))
  throw new Error('请使用工作台的 COLLAB_STATE_DIR 绝对路径。');
const portSchema = z.coerce.number().int().min(1024).max(65535);
const fields = { driver: z.literal('contractor').optional(), id: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) };
const endpointSchema = runnerEndpoint;
const credentials = z.union([
  z.object({ ...fields, port: portSchema }).strict(),
  z.object({ ...fields, endpoint: endpointSchema, profile: runnerAgentSchema.refine(remoteEngine) }).strict(),
]);
const argv = process.argv.slice(2);

async function request<T>(endpoint: string, action: string, data: unknown, token?: string, remote = false, driver?: 'contractor'): Promise<T> {
  const response = await fetch(new URL('/api/runner/' + action, endpoint), {
    method: 'POST', signal: AbortSignal.timeout(remote ? 6000 : 90000), redirect: 'error',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(driver && { 'x-contractor-execution': driver }) },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '接单服务暂不可用。');
  return result;
}

if (argv[0] === 'pair' || argv[0] === 'pair-remote') {
  const remote = argv[0] === 'pair-remote';
  const port = remote ? undefined : portSchema.parse(argv[1]);
  const endpoint = remote ? endpointSchema.parse(argv[1]) : 'http://127.0.0.1:' + port;
  const name = z.string().trim().min(1).max(100).parse(argv[2]);
  const code = z.string().regex(/^[a-f0-9]{24}$/).parse((await readFile('/dev/stdin', 'utf8')).trim());
  let proof: { code: string; name: string; host?: string } = { code, name };
  if (remote) {
    const members: string[] = await readdir(runtime()).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
    const devices = await readdir(runtime('devices')).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
    if (members.includes('workbench.json') || members.includes('orchestrator.sqlite') || devices.length)
      throw new Error('每个远程执行端须使用独立的数据目录');
  } else proof = { ...proof, host: (await readFile(runtime('devices', 'host.key'), 'utf8')).trim() };
  const result = await request<{ id: string; token: string }>(endpoint, 'pair', proof, undefined, remote);
  const connection = credentials.parse(remote ? { ...result, endpoint } : { ...result, port });
  await mkdir(runtime('devices', connection.id), { mode: 0o700, recursive: true });
  await writeFile(runtime('devices', connection.id, 'connection.json'), JSON.stringify(connection), { mode: 0o600, flag: 'wx' });
  console.log('已配对。执行端 ID ' + connection.id);
  console.log('启动命令 npm run runner -- connect ' + connection.id);
} else if (argv[0] === 'connect') {
  const id = z.uuid().parse(argv[1]);
  const connection = credentials.parse(JSON.parse(await readFile(runtime('devices', id, 'connection.json'), 'utf8')));
  if (id !== connection.id) throw new Error('执行端配置与 ID 不一致。');
  const profile = 'profile' in connection ? connection.profile : undefined;
  const endpoint = 'endpoint' in connection ? connection.endpoint : 'http://127.0.0.1:' + connection.port;
  const home = deviceHome(id, connection.driver);
  const lock = runtime('devices', id, 'running.pid');
  const ready = runtime('devices', id, 'ready.pid');
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
    if (profile?.engine === 'claude') await checkClaudeRunnerModel(profile);
    let createWorker: WorkerFactory;
    if (connection.driver === 'contractor') {
      const { workerFactory } = await import('./execution/worker.ts');
      createWorker = workerFactory(home, profile?.execution?.provider);
    } else {
      process.env.AGENT_AUTOLOOP_HOME = home;
      const legacy = await import('./legacy-device-worker.ts');
      await legacy.configureDeviceWorker(home, profile);
      createWorker = legacy.createWorker;
    }
    const send = <T>(action: string, data: unknown) => request<T>(endpoint, action, data, connection.token, !!profile, connection.driver);
    let announced = false;
    const hub: WorkerHub = {
      async work(data) {
        const answer = await send<{ job?: DeviceJob | null; cancel?: number[]; release?: ReleasedLease; deviceActive?: boolean }>('work', data);
        if (!announced) {
          await writeFile(ready, String(process.pid) + (answer.deviceActive === false ? ':paused' : ''), { mode: 0o600 });
          announced = true;
        }
        if (profile) {
          for (const run of answer.cancel ?? []) trackWorkerProcesses(run, true, home);
          if (answer.release) {
            const lease = answer.release;
            if (!await neverLaunched(home, lease)) throw new Error('有未归档的旧执行，请保留原机器和执行目录');
            await send('result', { run: lease.run, lease: lease.lease, stop: { attempt: lease.attempt, state: 'not-launched' },
              value: { outcome: 'cancelled', summary: '远端未启动此轮' } });
            if (profile.engine === 'codex') await cleanRemoteCodex(lease.run, lease.attempt);
          }
          if (answer.job) {
            try { answer.job = await prepareRemote(home, profile, answer.job); }
            catch {
              const lease = { run: answer.job.run, attempt: answer.job.attempt, lease: answer.job.token };
              if (!await neverLaunched(home, lease)) throw new Error('等待旧执行记录接续');
              await send('result', { run: lease.run, lease: lease.lease, stop: { attempt: lease.attempt, state: 'not-launched' },
                value: { outcome: 'failed', error: '远端 Agent 或隔离工作区未能准备，请检查对应设备' } });
              if (profile.engine === 'codex') await cleanRemoteCodex(lease.run, lease.attempt);
              answer.job = undefined;
            }
          }
        }
        return answer;
      },
      started: (run, lease, value) => send('started', { run, lease, value }),
      async result(run, lease, value) {
        if (!profile) return send('result', { run, lease, value });
        const entry = worker.entries().find(entry => entry.run === run && entry.token === lease);
        if (!entry) throw new Error('缺少远端本轮执行记录');
        const receipt = parseResult(value);
        const { stop, usage } = await remoteStop(home, entry, receipt.session,
          !receipt.usage && (receipt.outcome === 'cancelled' || receipt.outcome === 'failed'));
        const ack = await send<Awaited<ReturnType<WorkerHub['result']>>>('result', { run, lease, value: usage ? { ...receipt, usage } : value, stop });
        await writeFile(path.join(entry.dir, 'contractor-acknowledged'), '', { mode: 0o600 });
        return ack;
      },
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
      if (profile) await cleanAcknowledged(home, profile.engine === 'codex');
      if (!stop.signal.aborted) await delay(800);
    }
    await send('offline', {}).catch(() => {});
  } finally {
    if (await readFile(ready, 'utf8').catch(() => '') === String(process.pid)) await unlink(ready);
    if (await readFile(lock, 'utf8').catch(() => '') === String(process.pid)) await unlink(lock);
  }
} else {
  throw new Error('用 runner -- pair <端口> <名称>、runner -- pair-remote <URL> <名称> 配对，或用 runner -- connect <ID> 接单。');
}
