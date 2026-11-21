import { spawn } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { root, runtime } from '../config.ts';
import type { OctopSettings } from './config.ts';
import { octopPythonEnv } from './octop-bridge.ts';
import { channelJournalFile } from './channel-journal.ts';
import { octopIMDeliveryForm, type OctopIMDeliveryForm, type OctopIMTransport } from './octop-im-contract.ts';

const credentialsSchema = z.record(z.string(), z.unknown());
const gatewayOutput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), connector: z.string() }),
  z.object({ type: z.literal('offline'), connector: z.string() }),
  z.object({ type: z.literal('delivery'), request: z.uuid(), sent: z.boolean(), form: octopIMDeliveryForm.optional() }),
]);

export async function startOctopIM(settings: OctopSettings | undefined) {
  if (!settings?.channels?.length) return;
  const state = await realpath(runtime());
  const connectors = (await Promise.all(settings.channels.map(async ({ id, kind, credential, routes, allowedConversations, allowAccountBinding }) => {
    try {
      const file = path.join(state, 'octop-im', credential + '.json');
      const stat = await lstat(file);
      if (await realpath(file) !== file || !stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.size > 65536)
        throw new Error('凭据文件须为仅本人可读写的本地文件');
      const config = credentialsSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      return { id, kind, config, routes: [...routes.map(({ chat, thread }) => ({ chat, thread })),
        ...(allowedConversations ?? []).map(({ chat, thread, direct }) => ({ chat, thread, direct, proactive: !direct }))], allowAccountBinding };
    } catch {
      console.error('Octop IM 未载入本地连接配置 ' + id);
      return undefined;
    }
  }))).filter(row => row !== undefined);
  if (!connectors.length) return;

  const command = path.join(root, 'src/workbench/octop-im.py');
  const ready = new Set<string>();
  const pending = new Map<string, (sent: boolean, form?: OctopIMDeliveryForm) => void>();
  let child: ReturnType<typeof launch>;
  let stopped = false;
  let reconnect: ReturnType<typeof setTimeout> | undefined;

  function launch() {
    const bot = spawn(settings!.python, [command, channelJournalFile()], {
      env: octopPythonEnv(state), stdio: ['pipe', 'pipe', 'ignore'],
    });
    const input = createInterface({ input: bot.stdout });
    input.on('line', line => {
      if (stopped || bot !== child || line.length > 24000) return;
      let json: unknown;
      try { json = JSON.parse(line); } catch { return; }
      const parsed = gatewayOutput.safeParse(json);
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.type === 'delivery') { pending.get(event.request)?.(event.sent, event.form); return; }
      if (!connectors.some(row => row.id === event.connector)) return;
      if (event.type === 'ready') ready.add(event.connector);
      else { ready.delete(event.connector); console.error('Octop IM 连接未就绪 ' + event.connector); }
    });
    bot.once('error', () => console.error('Octop IM 子进程未启动'));
    bot.stdin.on('error', () => {});
    bot.once('close', () => {
      input.close();
      ready.clear();
      for (const settle of pending.values()) settle(false);
      if (!stopped) reconnect = setTimeout(() => { child = launch(); }, 5000);
    });
    bot.stdin.write(JSON.stringify(connectors) + '\n');
    return bot;
  }
  child = launch();

  const transport: OctopIMTransport = {
    ready: address => !stopped && ready.has(address.connector),
    async send(address, text, card, delivery, proactive) {
      if (!transport.ready(address)) throw new Error('Octop IM 连接未就绪');
      return await new Promise<OctopIMDeliveryForm | void>((resolve, reject) => {
        const request = randomUUID();
        const settle = (sent: boolean, form?: OctopIMDeliveryForm) => {
          clearTimeout(timeout);
          pending.delete(request);
          if (sent) resolve(form); else reject(new Error('Octop IM 未确认回传'));
        };
        const timeout = setTimeout(() => settle(false), 25000);
        pending.set(request, settle);
        child.stdin.write(JSON.stringify({ request, address, text, card, delivery, proactive }) + '\n', error => { if (error) settle(false); });
      });
    },
  };
  return { transport, connected: (connector: string) => !stopped && ready.has(connector), async close() {
    stopped = true;
    clearTimeout(reconnect);
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('close', () => { clearTimeout(timeout); resolve(); });
      child.kill('SIGTERM');
    });
  } };
}
