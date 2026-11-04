import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import readline from 'node:readline';
import { loadConfig, configPath, runtime } from '../src/config.ts';
import { command } from '../src/commands.ts';

const config = loadConfig();
if (config.feishu.enabled) throw new Error('Stop the configured IM consumer before pairing a new chat');
const status = JSON.parse(await command('lark-cli', ['--profile', config.feishu.profile, 'auth', 'status', '--json', '--verify']));
if (!status.identities?.bot?.verified) throw new Error('A verified dedicated bot profile is required');
const code = randomBytes(12).toString('hex');
const child = spawn('lark-cli', ['--profile', config.feishu.profile, 'event', 'consume', 'im.message.receive_v1', '--as', 'bot', '--timeout', '30m'], { stdio: ['pipe', 'pipe', 'pipe'] });
let paired = false;
readline.createInterface({ input: child.stderr! }).on('line', line => {
  console.error(line);
  if (line.includes('[event] ready event_key=')) console.log(JSON.stringify({ ready: true, url: `https://applink.feishu.cn/client/bot/open?appId=${status.appId}`, message: `/pair ${code}` }));
});
readline.createInterface({ input: child.stdout! }).on('line', line => {
  let event: any; try { event = JSON.parse(line); } catch { return; }
  if (paired || event.sender_type !== 'user' || event.chat_type !== 'p2p' || event.content?.trim() !== `/pair ${code}`) return;
  if (!/^ou_/.test(event.sender_id) || !/^oc_/.test(event.chat_id)) return;
  paired = true;
  config.feishu = { ...config.feishu, enabled: true, botId: status.identities.bot.openId, appId: status.appId,
    allowedSenders: [event.sender_id], allowedChats: [event.chat_id] };
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  writeFileSync(runtime('feishu-pairing-evidence.json'), JSON.stringify({ pairedAt: new Date().toISOString(), appId: status.appId,
    messageId: event.message_id, chatId: event.chat_id, senderId: event.sender_id, method: 'one-time-code-in-p2p', taskCreated: false }, null, 2), { mode: 0o600 });
  console.log('Paired the explicitly verified sender and chat. Restart the bridge to enable task intake.');
  child.stdin.end(); child.kill('SIGTERM');
});
child.on('exit', code => { if (!paired) process.exitCode = code || 1; });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { child.stdin.end(); child.kill('SIGTERM'); });
