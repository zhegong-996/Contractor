import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { channelCommand, feishuCommandText } from './channel-links.ts';
import { loadSettings } from './config.ts';
import { watchFeishu } from './feishu-events.ts';
import { openFeishuInbox } from './feishu-inbox.ts';
import { feishuIngressCard, feishuIngressMessage } from './feishu-ingress-envelope.ts';
import { routesEvents } from './project-resources.ts';
import { acquireStateLease } from './state-lease.ts';

async function serve(release: () => void) {
  if (!path.isAbsolute(process.env.COLLAB_STATE_DIR ?? '')) throw new Error('请提供独立工作台的 COLLAB_STATE_DIR 绝对路径。');
  const settings = await loadSettings();
  const config = settings.feishu;
  if (!config?.separateIngress) throw new Error('请先开启 feishu.separateIngress。');
  const groups = new Set(config.allowedGroups);
  for (const project of settings.projects) for (const source of project.resources)
    if (source.source === 'feishu' && source.state === 'bound' && routesEvents(source)) groups.add(source.externalId);
  const inbox = openFeishuInbox(config.appId);
  const owner = randomUUID();
  if (!inbox.claim(owner, Date.now())) {
    inbox.close();
    throw new Error('当前飞书应用已有活跃入口，请在旧进程退出后重试。');
  }
  let messages: ReturnType<typeof watchFeishu> | undefined;
  let cards: ReturnType<typeof watchFeishu> | undefined;
  let closed = false;
  let nextPrune = 0;
  const log = (message: string) => console.info(message);
  function pulse() {
    if (closed || !messages) return;
    const now = Date.now();
    try {
      if (!inbox.pulse(owner, now, { messages: messages.status(), cards: cards?.status() })) {
        process.exitCode = 1;
        void close();
        return;
      }
      if (now >= nextPrune) {
        inbox.prune(now);
        if (inbox.backlog(now).overdue) console.error('飞书入口存在超过三天未处理的事件，已保留等待恢复。');
        nextPrune = now + 60_000;
      }
    } catch { console.error('飞书入口状态暂未落盘。'); }
  }
  messages = watchFeishu(config.profile, line => {
    if (closed || Buffer.byteLength(line) > 128 * 1024) return;
    try {
      const incoming = feishuIngressMessage(line);
      if (!incoming) return;
      const data = incoming.event;
      if (data.chat_type === 'group' && !groups.has(data.chat_id)) return;
      const mention = data.mentions?.find(item => item.id === config.botId || item.id === config.appId);
      const command = settings.crossChannel && channelCommand(feishuCommandText(data.content, mention));
      if (command && (command.kind === 'recovery' || command.kind === 'activation') && data.chat_type !== 'p2p') return;
      if (data.chat_type === 'p2p') {
        if (!command || !['proof', 'answer', 'recovery', 'activation'].includes(command.kind)) return;
      }
      inbox.put(owner, 'message', incoming.lane, line, Date.now(), incoming.id);
    } catch (error) { if (!(error instanceof SyntaxError)) console.error('飞书消息暂未落盘，将由授权历史补读核对。'); }
  }, log, { onReady: pulse });
  if (config.decisionCards) cards = watchFeishu(config.profile, line => {
    if (closed || Buffer.byteLength(line) > 8192) return;
    try {
      const card = feishuIngressCard(line);
      if (card) inbox.put(owner, 'card', card.lane, line, Date.now(), card.id);
    } catch (error) { if (!(error instanceof z.ZodError || error instanceof SyntaxError)) console.error('飞书卡片回调暂未落盘。'); }
  }, log, { event: 'card.action.trigger', onReady: pulse });
  const timer = setInterval(pulse, 2000);
  pulse();
  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    await Promise.all([messages?.close(), cards?.close()]);
    inbox.release(owner);
    inbox.close();
    release();
  }
  process.once('SIGTERM', () => void close());
  process.once('SIGINT', () => void close());
}

const directory = process.env.COLLAB_STATE_DIR ?? '';
if (!path.isAbsolute(directory)) throw new Error('请提供独立工作台的 COLLAB_STATE_DIR 绝对路径。');
const release = acquireStateLease(directory, 'feishu-ingress');
try { await serve(release); }
catch (error) { release(); throw error; }
