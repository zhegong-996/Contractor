import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readCardClick } from './feishu-cards.ts';

const message = z.object({
  message_id: z.string().min(1).max(180), chat_id: z.string().min(1).max(180), chat_type: z.enum(['group', 'p2p']),
  sender_type: z.literal('user'), sender_id: z.string().optional(), message_type: z.literal('text').optional(), content: z.string().max(16_000),
  root_id: z.string().max(180).nullish(), thread_id: z.string().max(180).nullish(), update_time: z.union([z.string(), z.number()]).optional(),
  mentions: z.array(z.object({ id: z.string(), key: z.string().optional(), name: z.string().optional() })).optional(),
});

const identity = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export function feishuIngressMessage(line: string) {
  if (Buffer.byteLength(line) > 128 * 1024) return;
  const checked = message.safeParse(JSON.parse(line));
  if (!checked.success) return;
  const event = checked.data;
  return { event, id: identity('message', event.chat_id, event.message_id, event.sender_id, event.update_time, event.content),
    lane: event.chat_id + '/' + (event.root_id || event.thread_id || event.message_id) };
}

export function feishuIngressCard(line: string) {
  if (Buffer.byteLength(line) > 8192) return;
  const event = readCardClick(line);
  return { id: identity('card', event.nonce), lane: event.chat + '/' + event.ref };
}
