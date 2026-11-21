import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { command } from '../commands.ts';
import { WorkbenchError } from './errors.ts';

const chatId = /^oc_[a-zA-Z0-9_-]{1,128}$/;
const messageId = /^om_[a-zA-Z0-9_-]{1,128}$/;
const threadId = /^omt_[a-zA-Z0-9_-]{1,128}$/;
const nativeMessage = z.object({ chat_id: z.string().regex(chatId), message_id: z.string().regex(messageId),
  root_id: z.string().nullish(), thread_id: z.string().regex(threadId).nullish(), deleted: z.boolean().optional() });

export type FeishuTopicAddress = { chat: string; root: string; thread?: string };
export type FeishuTopicTransport = {
  resolve(chat: string, rootOrThread: string): Promise<FeishuTopicAddress>;
  publish(chat: string, key: string, title: string, url: string): Promise<FeishuTopicAddress>;
  reply(to: FeishuTopicAddress, key: string, url: string): Promise<{ chat: string; message: string }>;
};

export function feishuTopicUrl({ chat, root, thread }: FeishuTopicAddress) {
  if (!thread) return 'https://applink.feishu.cn/client/message/link?message_id=' + encodeURIComponent(root);
  const query = new URLSearchParams({ open_chat_id: chat, open_thread_id: thread, openchatid: chat, openthreadid: thread });
  return 'https://applink.feishu.cn/client/thread/open?' + query;
}

export function feishuTopicInput(chat: string, value: string) {
  if (messageId.test(value) || threadId.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://applink.feishu.cn' || url.username || url.password) return;
    const values = (keys: string[]) => [...new Set(keys.flatMap(key => url.searchParams.getAll(key)))];
    if (url.pathname === '/client/message/link') {
      const messages = values(['message_id']);
      return messages.length === 1 && messageId.test(messages[0]!) ? messages[0] : undefined;
    }
    const chats = values(['open_chat_id', 'openchatid']);
    const threads = values(['open_thread_id', 'openthreadid']);
    if (url.pathname === '/client/thread/open' && chats.length === 1 && chats[0] === chat && threads.length === 1
      && (threadId.test(threads[0]!) || messageId.test(threads[0]!))) return threads[0];
  } catch { return; }
}

export function feishuTopicTransport(profile: string): FeishuTopicTransport {
  async function call(args: string[], input?: string) {
    const result = JSON.parse(await command('lark-cli', ['--profile', profile, ...args, '--as', 'bot'], undefined, input));
    if (!result || result.ok === false || result.error || result.code && result.code !== 0) throw new Error('飞书话题操作失败');
    return result.data;
  }
  function rootAddress(chat: string, value: unknown): FeishuTopicAddress {
    const message = nativeMessage.parse(value);
    if (message.chat_id !== chat || message.deleted || message.root_id && message.root_id !== message.message_id)
      throw new Error('飞书消息不属于所选群的话题根');
    return { chat, root: message.message_id, thread: message.thread_id ?? undefined };
  }
  const content = (title: string, url: string) => JSON.stringify({ zh_cn: { title, content: [[{ tag: 'a', text: '打开 Contractor', href: url }]] } });
  return {
    async resolve(chat, value) {
      if (threadId.test(value)) {
        const query = JSON.stringify({ container_id_type: 'thread', container_id: value, sort_type: 'ByCreateTimeAsc', page_size: 1 });
        const data = await call(['api', 'GET', '/open-apis/im/v1/messages', '--params', query]);
        const address = rootAddress(chat, data?.items?.[0]);
        if (address.thread !== value) throw new Error('飞书返回了其他话题');
        return address;
      }
      if (!messageId.test(value)) throw new Error('飞书消息标识无效');
      const data = await call(['api', 'GET', '/open-apis/im/v1/messages/' + value]);
      const address = rootAddress(chat, data?.items?.[0]);
      if (address.root !== value) throw new Error('飞书返回了其他消息');
      return address;
    },
    async publish(chat, key, title, url) {
      const value = await call(['im', '+messages-send', '--chat-id', chat, '--msg-type', 'post', '--idempotency-key', key,
        '--content', content(title, url)]);
      return rootAddress(chat, value);
    },
    async reply(to, key, url) {
      const value = await call(['api', 'POST', '/open-apis/im/v1/messages/' + to.root + '/reply', '--data', '-'],
        JSON.stringify({ msg_type: 'post', content: content('有一项协作工单', url), reply_in_thread: true, uuid: key }));
      const message = nativeMessage.parse(value);
      if (message.chat_id !== to.chat || message.deleted || (message.root_id && message.root_id !== to.root))
        throw new Error('飞书返回了其他会话');
      return { chat: message.chat_id, message: message.message_id };
    },
  };
}

type Assignment = FeishuTopicAddress & { project: string; topic: string };
type SendIntent = { id: string; signature: string; started: number; result?: string };

export function openFeishuTopics(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_feishu_topic_route (
    app TEXT NOT NULL, chat TEXT NOT NULL, root TEXT NOT NULL, thread TEXT, project TEXT NOT NULL, topic TEXT NOT NULL,
    PRIMARY KEY(app,chat,root), UNIQUE(app,chat,thread), UNIQUE(app,chat,project,topic)
  );
  CREATE TABLE IF NOT EXISTS workbench_feishu_topic_send (
    id TEXT PRIMARY KEY, signature TEXT NOT NULL, started INTEGER NOT NULL, result TEXT
  );
  CREATE TABLE IF NOT EXISTS workbench_feishu_topic_observed (
    app TEXT NOT NULL, chat TEXT NOT NULL, root TEXT NOT NULL, thread TEXT, at INTEGER NOT NULL,
    PRIMARY KEY(app,chat,root)
  );`);
  db.exec('CREATE INDEX IF NOT EXISTS workbench_feishu_topic_observed_thread ON workbench_feishu_topic_observed(app,chat,thread);');
  const read = (row: Record<string, unknown>): Assignment => ({ chat: String(row.chat), root: String(row.root),
    project: String(row.project), topic: String(row.topic), thread: typeof row.thread === 'string' ? row.thread : undefined });
  const get = (app: string, chat: string, rootOrThread: unknown) => {
    if (typeof rootOrThread !== 'string') return;
    const found = db.prepare('SELECT * FROM workbench_feishu_topic_route WHERE app=? AND chat=? AND (root=? OR thread=?)')
      .get(app, chat, rootOrThread, rootOrThread);
    return found && read(found);
  };
  const list = (app: string, project: string) => db.prepare('SELECT * FROM workbench_feishu_topic_route WHERE app=? AND project=? ORDER BY rowid')
    .all(app, project).map(read);
  return {
    get, list,
    observe(app: string, address: FeishuTopicAddress, at: number) {
      if (!chatId.test(address.chat) || !messageId.test(address.root) || address.thread && !threadId.test(address.thread)) return;
      db.prepare(`INSERT INTO workbench_feishu_topic_observed VALUES (?,?,?,?,?)
        ON CONFLICT(app,chat,root) DO UPDATE SET thread=COALESCE(excluded.thread,thread),at=MAX(at,excluded.at)`)
        .run(app, address.chat, address.root, address.thread ?? null, at);
    },
    observed(app: string, chat: string, reference: string) {
      const rows = db.prepare('SELECT root,thread FROM workbench_feishu_topic_observed WHERE app=? AND chat=? AND (root=? OR thread=?) LIMIT 2')
        .all(app, chat, reference, reference);
      if (rows.length !== 1) return;
      return { chat, root: String(rows[0]!.root), thread: typeof rows[0]!.thread === 'string' ? rows[0]!.thread : undefined };
    },
    bind(app: string, address: FeishuTopicAddress, project: string, topic: string) {
      const previous = get(app, address.chat, address.root) ?? get(app, address.chat, address.thread);
      const existing = list(app, project).find(row => row.chat === address.chat && row.topic === topic);
      if (previous && (previous.project !== project || previous.topic !== topic || previous.root !== address.root)
        || existing && existing.root !== address.root) throw new WorkbenchError('话题在该群已有对应关系，请先核对原映射。', 409);
      db.prepare(`INSERT INTO workbench_feishu_topic_route VALUES (?,?,?,?,?,?)
        ON CONFLICT(app,chat,root) DO UPDATE SET thread=COALESCE(excluded.thread,thread)`)
        .run(app, address.chat, address.root, address.thread ?? null, project, topic);
    },
    begin(id: string, signature: string, now: number) {
      db.prepare('INSERT OR IGNORE INTO workbench_feishu_topic_send VALUES (?,?,?,NULL)').run(id, signature, now);
      const row = db.prepare('SELECT * FROM workbench_feishu_topic_send WHERE id=?').get(id) as SendIntent;
      if (row.signature !== signature) throw new WorkbenchError('此发送请求已使用，请核对原话题。', 409);
      // The provider's idempotency key expires in one hour. Reconcile the existing message after that window.
      if (row.result === null && now - row.started >= 50 * 60_000)
        throw new WorkbenchError('飞书回执待核对。请在群里查找已发送消息，再关联其话题。', 409);
      return row.result === null ? undefined : String(row.result);
    },
    finish(id: string, result: string) {
      db.prepare('UPDATE workbench_feishu_topic_send SET result=COALESCE(result,?) WHERE id=?').run(result, id);
    },
  };
}
