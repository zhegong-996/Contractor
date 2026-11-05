import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { root, runtime } from './config.ts';
// Dynamic package boundaries avoid typechecking DSH's unrelated host/peer APIs.
// The code executed here is still the pinned, unmodified upstream source.
const moduleAt = (file: string) => import(pathToFileURL(path.join(root, 'upstream', file)).href);
process.env.AGENT_AUTOLOOP_HOME = runtime('autoloop');
const feishu = await moduleAt('superagent/src/sources/feishu-trigger.ts');
const channel = await moduleAt('superagent/src/sources/feishu-channel.ts');
const contract = await moduleAt('autoloop/worker/contract.ts');
const agents = await moduleAt('autoloop/worker/agents.ts');
export type NativeTrigger = { id: string; human: boolean; addressed?: string; actor: { id: string }; text: string; meta: Record<string, unknown> };
export const feishuTrigger: (input: unknown, botId: string, appId: string) => NativeTrigger | undefined = feishu.feishuTrigger;
export const feishuThreadId: (chat: string, root: string | undefined, message: string) => string = feishu.feishuThreadId;
export const feishuTriggerId: (message: string) => string = feishu.feishuTriggerId;
export const sendFeishu: (host: any, message: any) => Promise<'sent' | 'gone'> = (host, message) => {
  // Keep existing short keys stable; bound new long keys to Feishu's 50-character limit.
  const id = message.id.length <= 50 ? message.id : 'sui-' + createHash('sha256').update(message.id).digest('base64url');
  return channel.sendFeishu(host, { ...message, id });
};
export type Result = { outcome: string; summary?: string; error?: string; ask?: { title: string; text: string; options: string[] }[]; later?: unknown[]; events?: unknown[]; resolve?: unknown[] };
export const readMessage: (said: string) => unknown = contract.readMessage;
export const resultFrom: (message: unknown, extra: { session?: string }) => { result: Result; problem?: string } = contract.resultFrom;
export type Reading = { text?: string; error?: string; session?: string; usage?: object; sessionUsage?: object; started?: boolean; finished?: boolean };
export type Turn = { prompt: string; session: string; resume: string | null; cwd: string; access: 'read' | 'edit'; folder: string; contextFile: string; command?: string[]; model?: string; effort?: string };
export type Adapter = { command(turn: Turn): string[]; read(stdout: string, code: number | null, stderr: string): Reading; check?(): string | null };
export const adapterFor: (use: string) => Promise<Adapter> = agents.adapterFor;
// Pure upstream reference-envelope serialization; no Harness host is started.
export { stringifyTagSafeJson } from '../upstream/deepseek-harness/packages/context/session-reference/src/serialization.ts';
