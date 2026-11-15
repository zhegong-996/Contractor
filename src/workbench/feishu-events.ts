import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

const eventKey = 'im.message.receive_v1';
const readyMarker = '[event] ready event_key=' + eventKey;

export function watchFeishu(profile: string, receive: (line: string) => void, log: (message: string) => void) {
  let child: ChildProcessWithoutNullStreams | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let state: 'connecting' | 'ready' | 'reconnecting' | 'stopped' = 'connecting';
  let attempt = 0;
  let failures = 0;
  let readyAt: number | undefined;
  let disconnectedAt: number | undefined;
  let closed = false;

  function launch() {
    attempt++;
    const consumer = spawn('lark-cli', ['--profile', profile, 'event', 'consume', eventKey, '--as', 'bot'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
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
      readyAt = Date.now();
      log('飞书实时订阅已就绪。');
      createInterface({ input: consumer.stdout }).on('line', value => { if (!closed) receive(value); });
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
    status: () => ({ state, attempt, readyAt, disconnectedAt }),
    close() {
      closed = true;
      state = 'stopped';
      clearTimeout(retry);
      child?.stdin.end();
    },
  };
}
