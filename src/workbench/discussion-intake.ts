import { z } from 'zod';
import { FeishuSources, withFeishuReads } from '../feishu-sources.ts';
import { feishuChatLink, feishuHistory, feishuTrigger, type NativeTrigger } from '../upstream.ts';
import type { Trigger } from '../../upstream/superagent/src/core/index.ts';
import type { ChannelRef, PlatformActor } from './channel-links.ts';
import type { Project, Settings } from './config.ts';
import type { ProjectResource } from './project-resources.ts';

export type DiscussionInput = { trigger: Trigger; origin: ChannelRef; sender: PlatformActor; history?: boolean };
export type SourceFact = { kind: 'material' | 'github'; key: string; title: string; text?: string; revision?: string; url?: string;
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
  items: z.array(z.unknown()), has_more: z.boolean(), page_token: z.string().optional(),
}) });
const rawMessage = z.looseObject({ chat_id: z.string(), msg_type: z.string(), message_position: z.string().regex(/^\d+$/).optional(),
  sender: z.looseObject({ id: z.string(), sender_type: z.string(), id_type: z.string().optional() }) });

type History = NonNullable<NonNullable<Project['discussion']>['history']>;
type Feishu = NonNullable<Settings['feishu']>;

export async function readDiscussionHistory(reader: FeishuSources, history: History, feishu: Feishu, chat: string, start: number, end: number) {
  const login = await reader.command(['whoami', '--as', 'user', '--profile', history.profile]);
  if (login.identity !== 'user' || !login.available || login.appId !== history.appId || login.onBehalfOf?.openId !== history.userOpenId)
    throw new Error('飞书群补读身份已变化');

  const inputs: DiscussionInput[] = [];
  const withdrawn: string[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const params = { container_id_type: 'chat', container_id: chat, sort_type: 'ByCreateTimeAsc', page_size: 50,
      start_time: String(Math.floor(start / 1000)), end_time: String(Math.ceil(end / 1000)), page_token: cursor };
    const page = pageSchema.parse(await reader.command(['api', 'GET', '/open-apis/im/v1/messages', '--params', JSON.stringify(params),
      '--as', 'user', '--profile', history.profile, '--format', 'json'])).data;
    if (page.has_more && (!page.page_token || cursors.has(page.page_token))) throw new Error('飞书群补读分页不完整');
    cursor = page.has_more ? page.page_token : undefined;
    if (cursor) cursors.add(cursor);
    for (const row of page.items) {
      const raw = rawMessage.safeParse(row);
      if (!raw.success || raw.data.chat_id !== chat || raw.data.msg_type !== 'text') continue;
      const native = feishuHistory(row, chat);
      if (!native) continue;
      if (native.deleted) { withdrawn.push(native.id); continue; }
      const sender = raw.data.sender;
      if (sender.sender_type !== 'user' || (sender.id_type && sender.id_type !== 'open_id')) continue;
      const trigger = feishuTrigger(native.event, feishu.botId, feishu.appId) as (NativeTrigger & Trigger) | undefined;
      if (!trigger || Date.parse(trigger.at) < start || Date.parse(trigger.at) >= end) continue;
      if (!trigger.url && raw.data.message_position) {
        const url = new URL(feishuChatLink('feishu', chat));
        url.searchParams.set('position', raw.data.message_position);
        trigger.url = url.href;
      }
      // A user's Open ID is app-scoped. History alone cannot attribute a message to someone in another app.
      inputs.push({ ...discussionInput(trigger, feishu.appId, history.appId), history: true });
    }
  } while (cursor);
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
