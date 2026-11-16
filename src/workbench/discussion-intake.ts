import { z } from 'zod';
import { FeishuSources, withFeishuReads } from '../feishu-sources.ts';
import { feishuChatLink, feishuHistory, feishuTrigger, feishuTriggerId, type NativeTrigger } from '../upstream.ts';
import type { Trigger } from '../../upstream/superagent/src/core/index.ts';
import type { ChannelRef, PlatformActor } from './channel-links.ts';
import type { Project, Settings } from './config.ts';
import type { ProjectResource } from './project-resources.ts';

export type DiscussionInput = { trigger: Trigger; origin: ChannelRef; sender: PlatformActor; history?: boolean; updatedAt?: number };
export type SourceFact = { kind: 'material' | 'github'; key: string; title: string; text?: string; revision?: string; url?: string; knowledge?: true;
  messages?: string[]; exact?: boolean };

export function discussionInput(trigger: Trigger, app: string, senderApp = app): DiscussionInput {
  const chat = String(trigger.meta.chatId);
  return {
    trigger,
    sender: { provider: 'feishu', namespace: senderApp, id: trigger.actor.id, label: trigger.actor.id },
    origin: { key: 'feishu:' + app + ':' + trigger.threads[0]!.id,
      label: trigger.url ? '飞书原消息' : '飞书群', url: trigger.url ?? feishuChatLink('feishu', chat) },
  };
}

const pageSchema = z.object({ ok: z.literal(true), identity: z.literal('user'), data: z.object({
  items: z.array(z.unknown()), has_more: z.boolean().default(false), page_token: z.string().optional(),
}) });
const rawMessage = z.looseObject({ chat_id: z.string(), msg_type: z.string(), message_position: z.string().regex(/^\d+$/).optional(),
  message_id: z.string(), update_time: z.string().regex(/^\d+$/).optional(),
  sender: z.looseObject({ id: z.string(), sender_type: z.string(), id_type: z.string().optional() }) });
const tombstone = z.object({ chat_id: z.string(), message_id: z.string(), deleted: z.literal(true) });

type History = NonNullable<NonNullable<Project['discussion']>['history']>;
type Feishu = NonNullable<Settings['feishu']>;

async function confirmReader(reader: FeishuSources, history: History) {
  const login = await reader.cached('identity:' + history.profile, () =>
    reader.command(['whoami', '--as', 'user', '--profile', history.profile]));
  if (login.identity !== 'user' || !login.available || login.appId !== history.appId || login.onBehalfOf?.openId !== history.userOpenId)
    throw new Error('飞书群补读身份已变化');
}

function historyMessages(items: unknown[], history: History, feishu: Feishu, chat: string, start: number, end: number,
  expected?: ReadonlySet<string>) {
  const inputs: DiscussionInput[] = [];
  const withdrawn: string[] = [];
  for (const row of items) {
    const removed = tombstone.safeParse(row);
    if (removed.success) {
      const { chat_id, message_id } = removed.data;
      if (chat_id === chat && (!expected || expected.has(message_id))) withdrawn.push(feishuTriggerId(message_id));
      continue;
    }
    const raw = rawMessage.safeParse(row);
    if (!raw.success || raw.data.chat_id !== chat || raw.data.msg_type !== 'text'
      || (expected && !expected.has(raw.data.message_id))) continue;
    const native = feishuHistory(row, chat);
    if (!native || native.deleted) continue;
    const sender = raw.data.sender;
    if (sender.sender_type !== 'user' || (sender.id_type && sender.id_type !== 'open_id')) continue;
    const trigger = feishuTrigger(native.event, feishu.botId, feishu.appId) as (NativeTrigger & Trigger) | undefined;
    if (!trigger || Date.parse(trigger.at) < start || Date.parse(trigger.at) >= end) continue;
    if (!trigger.url && raw.data.message_position) {
      const url = new URL(feishuChatLink('feishu', chat));
      url.searchParams.set('position', raw.data.message_position);
      trigger.url = url.href;
    }
    // The reader's application scopes its Open IDs, even though the message and thread IDs are shared.
    const updatedAt = raw.data.update_time && Number(raw.data.update_time);
    inputs.push({ ...discussionInput(trigger, feishu.appId, history.appId), history: true,
      updatedAt: typeof updatedAt === 'number' && Number.isSafeInteger(updatedAt) ? updatedAt : undefined });
  }
  return { inputs, withdrawn };
}

export async function readDiscussionHistory(reader: FeishuSources, history: History, feishu: Feishu, chat: string, start: number, end: number,
  signal?: AbortSignal) {
  signal?.throwIfAborted();
  await confirmReader(reader, history);
  const inputs: DiscussionInput[] = [];
  const withdrawn: string[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const params = { container_id_type: 'chat', container_id: chat, sort_type: 'ByCreateTimeAsc', page_size: 50,
      start_time: String(Math.floor(start / 1000)), end_time: String(Math.ceil(end / 1000)), page_token: cursor };
    const page = pageSchema.parse(await reader.command(['api', 'GET', '/open-apis/im/v1/messages', '--params', JSON.stringify(params),
      '--as', 'user', '--profile', history.profile, '--format', 'json'])).data;
    if (page.has_more && (!page.page_token || cursors.has(page.page_token))) throw new Error('飞书群补读分页不完整');
    cursor = page.has_more ? page.page_token : undefined;
    if (cursor) cursors.add(cursor);
    if (cursors.size >= 100) throw new Error('飞书补读超过单次分页上限');
    const batch = historyMessages(page.items, history, feishu, chat, start, end);
    inputs.push(...batch.inputs);
    withdrawn.push(...batch.withdrawn);
  } while (cursor);
  return { inputs, withdrawn };
}

export async function refreshDiscussionMessages(reader: FeishuSources, history: History, feishu: Feishu, chat: string, ids: string[]) {
  const inputs: DiscussionInput[] = [];
  const withdrawn: string[] = [];
  if (!ids.length) return { inputs, withdrawn };
  await confirmReader(reader, history);
  for (let offset = 0; offset < ids.length; offset += 50) {
    const message_ids = ids.slice(offset, offset + 50);
    const page = pageSchema.parse(await reader.command(['api', 'GET', '/open-apis/im/v1/messages/mget',
      '--params', JSON.stringify({ message_ids }), '--as', 'user', '--profile', history.profile, '--format', 'json'])).data;
    const batch = historyMessages(page.items, history, feishu, chat, -Infinity, Infinity, new Set(message_ids));
    inputs.push(...batch.inputs);
    withdrawn.push(...batch.withdrawn);
  }
  // An omitted item is ambiguous (it can be a permission change). Only a confirmed tombstone withdraws a source.
  return { inputs, withdrawn };
}

export async function readDiscussionDocuments(reader: FeishuSources, history: History, refs: ProjectResource[]): Promise<SourceFact[]> {
  return withFeishuReads(async () => {
    const settled = await Promise.allSettled(refs.map(async ref => {
      const address = new URL(ref.url!);
      const [, , token] = address.pathname.split('/');
      const { profile, appId, userOpenId } = history;
      const document = await reader.read({ provider: 'feishu', kind: 'docx', profile, appId, userOpenId, token,
        block: address.hash.slice(1) || undefined, messageIds: [], url: ref.url!, title: ref.label ?? '项目文档' });
      return { kind: 'material' as const, key: ref.externalId, title: document.title,
        revision: document.revision, text: document.body.slice(0, 2100), url: ref.url };
    }));
    return settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  });
}
