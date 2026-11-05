import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]+$/).max(160);
export const feishuReference = z.object({
  provider: z.literal('feishu'), kind: z.enum(['docx', 'messages']), profile: id,
  appId: id, userOpenId: id, token: id.optional(), chatId: id.optional(),
  messageIds: z.array(id).max(50).default([]), title: z.string().min(1).max(120),
  url: z.string().url().refine(s => { const u = new URL(s); return u.protocol === 'https:' && (u.hostname.endsWith('.feishu.cn') || u.hostname === 'applink.feishu.cn'); }),
}).strict().superRefine((r, ctx) => {
  if (r.kind === 'docx' ? !r.token : !r.chatId || !r.messageIds.length) ctx.addIssue({ code: 'custom', message: '缺少真实来源定位' });
});
export type FeishuReference = z.infer<typeof feishuReference>;
export class FeishuUnavailable extends Error {
  constructor(readonly permanent: boolean, readonly reason: string) { super(reason); }
}
const reads = new AsyncLocalStorage<Map<string, Promise<any>>>();
export const withFeishuReads = <T>(fn: () => Promise<T>) => reads.run(new Map(), fn);
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const execute = promisify(execFile);
const unsafe = /(?:访问密码|密码\s*[:：]|(?:api[_ -]?key|access[_ -]?token|app[_ -]?secret|authorization)\s*[:=：]|\bsk-[\w-]{12,}|invite\/member\/)/i;
export function safeProjectMessages(messages: any[], ref: FeishuReference) {
  const allowed = new Set(ref.messageIds);
  return messages.filter(m => allowed.has(m.message_id) && (!m.chat_id || m.chat_id === ref.chatId) && !m.deleted
    && m.sender?.sender_type !== 'bot' && ['text', 'post'].includes(m.msg_type) && typeof m.content === 'string' && !unsafe.test(m.content))
    .map(m => ({ id: m.message_id, text: m.content, createdAt: m.create_time, updatedAt: m.update_time ?? null,
      author: m.sender?.name ?? m.sender?.id, url: m.message_app_link ?? ref.url })).sort((a, b) => a.id.localeCompare(b.id));
}
// The official CLI owns OAuth refresh and credentials. No token is exported to a model,
// copied into this repository, or substituted for a participant's authority.
export class FeishuSources {
  constructor(readonly command: (args: string[]) => Promise<any> = async args => {
    try {
      const { stdout } = await execute('lark-cli', args, { timeout: 25000, maxBuffer: 4 * 1024 * 1024,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
          LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } });
      return JSON.parse(stdout);
    } catch (error: any) {
      let code: number | undefined;
      try { code = JSON.parse(error.stderr).error?.code; } catch {}
      throw new FeishuUnavailable([91403, 99991672, 1770032, 1770002, 230001, 230002].includes(code!), '飞书来源不可读取，请核对原权限、登录与来源状态');
    }
  }) {}
  async cached<T>(key: string, work: () => Promise<T>): Promise<T> {
    const cache = reads.getStore(); if (!cache) return work();
    if (!cache.has(key)) cache.set(key, work()); return cache.get(key)!;
  }
  async read(input: FeishuReference) {
    const ref = feishuReference.parse(input);
    return this.cached('source:' + hash(ref), async () => {
      const identity = await this.cached('identity:' + ref.profile, () => this.command(['whoami', '--as', 'user', '--profile', ref.profile]));
      if (identity.identity !== 'user' || !identity.available || identity.appId !== ref.appId || identity.onBehalfOf?.openId !== ref.userOpenId)
        throw new FeishuUnavailable(true, '飞书连接身份已变化，不能沿用旧委托');
      const args = ref.kind === 'docx'
        ? ['docs', '+fetch', '--doc', ref.token!, '--doc-format', 'markdown']
        : ['im', '+messages-mget', '--message-ids', ref.messageIds.join(','), '--no-reactions'];
      const response = await this.command([...args, '--as', 'user', '--profile', ref.profile, '--format', 'json']);
      if (response.ok !== true || response.identity !== 'user') throw new FeishuUnavailable(true, '飞书来源未返回已授权用户数据');
      let body: string, revision: string, details: any;
      if (ref.kind === 'docx') {
        const doc = response.data?.document;
        if (doc?.document_id !== ref.token || !doc.content || doc.revision_id == null) throw new FeishuUnavailable(true, '飞书文档定位或版本不完整');
        if (unsafe.test(doc.content)) throw new FeishuUnavailable(true, '文档含凭据信息，先选取安全的业务范围再接入');
        body = doc.content; revision = String(doc.revision_id); details = { documentId: ref.token, revision };
      } else {
        const found = safeProjectMessages(response.data?.messages ?? [], ref);
        if (found.length !== new Set(ref.messageIds).size) throw new FeishuUnavailable(true, '选定项目讨论已撤回、不可访问或包含应排除的信息，请重新确认范围');
        // Omitted/withdrawn messages change the fingerprint; they are never restored from cache.
        body = found.map(m => `${m.createdAt} · ${m.author}\n${m.text}\n来源：${m.url}`).join('\n\n');
        revision = hash(found); details = { messageIds: found.map(m => m.id), selectedCount: ref.messageIds.length, returnedCount: found.length };
      }
      const fingerprint = hash({ revision, body, details });
      return { revision, hash: fingerprint, body, details, url: ref.url, title: ref.title,
        value: { title: ref.title, body, facts: {}, state: 'source', kind: 'reference', sources: [ref.url],
          appliesTo: '飞书真实来源证据；讨论不等于当前决定，接入不等于知识已经确认' } };
    });
  }
}
