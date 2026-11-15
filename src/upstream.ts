import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { root } from './config.ts';
import type { Trigger } from '../upstream/superagent/src/core/index.ts';
// Dynamic package boundaries avoid typechecking DSH's unrelated host/peer APIs.
// The code executed here is still the pinned, unmodified upstream source.
const moduleAt = (file: string) => import(pathToFileURL(path.join(root, 'upstream', file)).href);
const feishu = await moduleAt('superagent/src/sources/feishu-trigger.ts');
const channel = await moduleAt('superagent/src/sources/feishu-channel.ts');
const github = await moduleAt('superagent/src/sources/github-trigger.ts');
export type NativeTrigger = { id: string; human: boolean; addressed?: string; actor: { id: string }; text: string; meta: Record<string, unknown> };
export const feishuTrigger: (input: unknown, botId: string, appId: string) => NativeTrigger | undefined = feishu.feishuTrigger;
export const feishuHistory: (input: unknown, chat: string) => { event?: unknown; id: string; deleted: boolean } | undefined = (input, chat) => {
  const result = feishu.HistoricalMessageSchema.safeParse(input);
  if (!result.success || result.data.chat_id !== chat) return;
  const message = result.data;
  return { id: feishu.feishuTriggerId(message.message_id), deleted: message.deleted === true,
    event: message.deleted ? undefined : feishu.historyEvent(message, chat, false) };
};
export const feishuTriggerId: (message: string) => string = feishu.feishuTriggerId;
export const feishuChatLink: (brand: 'feishu' | 'lark', chatId: string) => string = channel.feishuChatLink;
type GithubMessage = { user: { login: string; type?: string }; id: number; body: string; created_at: string; updated_at: string; html_url: string };
export const githubIssueTrigger: (issue: GithubMessage & { number: number; title: string }, agent: string) => Trigger = github.issueTrigger;
export const githubPullTrigger: typeof githubIssueTrigger = github.pullTrigger;
export const githubCommentTrigger: (message: GithubMessage, ref: { number: number; isPr: boolean }, kind: 'conversation' | 'inline', agent: string) => Trigger = github.commentTrigger;
export const githubAddress: (url: string, repository: string) => { number: number; pr: boolean; discussion?: number } | undefined = github.githubAddress;
export const sendFeishu: (host: any, message: any) => Promise<'sent' | 'gone'> = (host, message) => {
  // Keep existing short keys stable; bound new long keys to Feishu's 50-character limit.
  const id = message.id.length <= 50 ? message.id : 'sui-' + createHash('sha256').update(message.id).digest('base64url');
  return channel.sendFeishu(host, { ...message, id });
};
