import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { z } from 'zod';

const eventKey = 'im.message.receive_v1';
const readyMarker = '[event] ready event_key=' + eventKey;
const execute = promisify(execFile);
async function isConsumerProcess(pid: number, launcher: number | undefined) {
  // The npm CLI launcher starts the native subscriber as a child. Match its ancestry,
  // not any subscriber in the same app and not the launcher's PID alone.
  for (let depth = 0; depth < 8 && Number.isSafeInteger(pid) && pid > 1; depth++) {
    if (pid === launcher) return true;
    const { stdout } = await execute('ps', ['-o', 'ppid=', '-p', String(pid)], { timeout: 1000 });
    if (!/^\s*\d+\s*$/.test(stdout)) return false;
    pid = Number(stdout.trim());
  }
  return false;
}
const busStatus = z.object({ apps: z.array(z.object({ running: z.boolean(), status: z.string(),
  consumers: z.array(z.object({ pid: z.number(), event_key: z.string(), dropped: z.number() })).optional(),
})) });

export function watchFeishu(profile: string, receive: (line: string) => void, log: (message: string) => void,
  options: { healthIntervalMs?: number; onReady?: () => void } = {}) {
  let child: ChildProcessWithoutNullStreams | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let state: 'connecting' | 'ready' | 'reconnecting' | 'stopped' = 'connecting';
  let attempt = 0;
  let failures = 0;
  let readyAt: number | undefined;
  let disconnectedAt: number | undefined;
  let closed = false;
  let checkedAt: number | undefined;
  let health: 'unknown' | 'healthy' | 'unavailable' = 'unknown';
  let probing = false;
  let failedProbes = 0;
  let lostEvents = 0;
  const environment = { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' };

  // The official CLI exposes local bus and consumer health, not a remote websocket heartbeat.
  // An idle group is healthy. Missing consumers or an orphan daemon must not stay "ready".
  const monitor = setInterval(async () => {
    const consumer = child;
    if (closed || probing || !consumer || state !== 'ready') return;
    probing = true;
    try {
      const output = await execute('lark-cli', ['--profile', profile, 'event', 'status', '--current', '--json'],
        { env: environment, timeout: 5000, maxBuffer: 128 * 1024 });
      if (closed || consumer !== child) return;
      const parsed = busStatus.parse(JSON.parse(output.stdout));
      const candidates = parsed.apps.filter(app => app.running && app.status === 'running')
        .flatMap(app => app.consumers ?? []).filter(item => item.event_key === eventKey);
      let active;
      for (const item of candidates) if (await isConsumerProcess(item.pid, consumer.pid).catch(() => false)) { active = item; break; }
      if (!active) throw new Error('local consumer unavailable');
      checkedAt = Date.now();
      health = 'healthy';
      failedProbes = 0;
      if (active.dropped > lostEvents) {
        lostEvents = Math.max(lostEvents, active.dropped);
        log('飞书订阅报告丢弃事件，请通过已授权历史补读核对缺口。');
      }
    } catch {
      if (closed || consumer !== child) return;
      checkedAt = Date.now();
      health = 'unavailable';
      if (++failedProbes >= 2) {
        state = 'reconnecting';
        disconnectedAt = Date.now();
        consumer.stdin.end();
        // Only terminate our subscriber, never the daemon shared by other applications.
        const deadline = setTimeout(() => { if (child === consumer && consumer.exitCode === null) consumer.kill('SIGTERM'); }, 2000);
        deadline.unref();
      }
    } finally { probing = false; }
  }, options.healthIntervalMs ?? 15000);
  monitor.unref();

  function launch() {
    attempt++;
    const consumer = spawn('lark-cli', ['--profile', profile, 'event', 'consume', eventKey, '--as', 'bot'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: environment,
    });
    child = consumer;
    let connected = false;
    const startup = setTimeout(() => {
      if (closed || connected) return;
      state = 'reconnecting';
      consumer.kill('SIGTERM');
    }, 30_000);
    consumer.stdin.on('error', () => {});
    consumer.on('error', () => { if (!closed) state = 'reconnecting'; });
    consumer.on('exit', () => { if (!closed) state = 'reconnecting'; });
    createInterface({ input: consumer.stderr }).on('line', line => {
      if (closed || connected || consumer.exitCode !== null || consumer.signalCode !== null || line.trim() !== readyMarker) return;
      clearTimeout(startup);
      connected = true;
      state = 'ready';
      health = 'unknown';
      failedProbes = 0;
      readyAt = Date.now();
      log('飞书实时订阅已就绪。');
      createInterface({ input: consumer.stdout }).on('line', value => { if (!closed) receive(value); });
      options.onReady?.();
    });
    consumer.once('close', () => {
      clearTimeout(startup);
      child = undefined;
      if (closed) return;
      if (connected && readyAt !== undefined && Date.now() - readyAt >= 10_000) failures = 0;
      state = 'reconnecting';
      disconnectedAt = Date.now();
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
      log('飞书实时订阅中断，' + delay / 1000 + ' 秒后重连。');
      retry = setTimeout(launch, delay);
    });
  }

  launch();
  return {
    status: () => ({ state, attempt, readyAt, disconnectedAt, busHealth: health, checkedAt, lostEvents }),
    close() {
      closed = true;
      state = 'stopped';
      clearTimeout(retry);
      clearInterval(monitor);
      child?.stdin.end();
    },
  };
}
