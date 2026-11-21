import type { DatabaseSync } from 'node:sqlite';
import { key } from '../../upstream/superagent/src/core/index.ts';
import { WorkbenchError } from './errors.ts';
import { octopIMRoute, type OctopIMAddress, type OctopIMConnector } from './octop-im-contract.ts';

type Address = Pick<OctopIMAddress, 'connector' | 'kind' | 'chat' | 'thread' | 'tag'>;
type Binding = { project: string; topic: string; chat: string; thread?: string; tag?: string };
export type IMTopicInput = Omit<Address, 'kind'> & { topic: string };

export function readIMTopicTag(text: string) {
  const match = /^\[主题:([a-z][a-z0-9-]{0,31})\]\s+([^\s][\s\S]*)$/.exec(text);
  if (match) return { tag: match[1], text: match[2]! };
  if (!text.startsWith('[主题:')) return { text };
}

export const imTopicText = (tag: string | undefined, text: string) => tag ? '[主题:' + tag + '] ' + text : text;

export function openIMTopics(db: DatabaseSync, connectors: OctopIMConnector[] = []) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_im_topic_binding (
    connector TEXT NOT NULL, chat TEXT NOT NULL, thread TEXT NOT NULL, tag TEXT NOT NULL, project TEXT NOT NULL, topic TEXT NOT NULL,
    PRIMARY KEY(connector,chat,thread,tag)
  );`);

  const find = (address: Address) => connectors.find(row => row.id === address.connector && row.kind === address.kind);
  const location = (connector: OctopIMConnector, chat: string, thread?: string) => connector.allowedConversations?.find(row => row.chat === chat && row.thread === thread);
  const scope = db.prepare('SELECT tag,project,topic FROM workbench_im_topic_binding WHERE connector=? AND chat=? AND thread=? ORDER BY rowid');

  function route(address: Address): Binding | undefined {
    const connector = find(address);
    if (!connector) return;
    const { chat, thread, tag } = address;
    const saved = !tag && octopIMRoute([connector], address);
    if (saved) return saved;
    if (!location(connector, chat, thread)) return;
    const row = scope.all(connector.id, chat, thread ?? '').find(row => row.tag === (tag ?? ''));
    if (row) return { project: String(row.project), topic: String(row.topic), chat, thread, tag };
  }

  function catalog(project: string, mayConfigure: boolean) {
    return connectors.flatMap(({ id: connector, kind, routes, allowedConversations }) => [
      ...routes.filter(row => row.project === project).map(({ chat, thread, topic }) => ({ connector, kind, chat, thread, topic,
        tag: undefined, label: connector, available: false, direct: undefined, canPublish: false, id: key('im-topic', connector, chat, thread ?? '', '') })),
      ...(allowedConversations ?? []).flatMap(({ chat, thread, label, direct }) => {
        const rows = scope.all(connector, chat, thread ?? '');
        const base = { connector, kind, chat, thread, label, direct };
        const canPublish = !direct && ['wecom', 'dingtalk', 'telegram', 'discord'].includes(kind);
        const bindings = rows.filter(row => row.project === project).map(row => {
          const tag = String(row.tag) || undefined;
          return { ...base, id: key('im-topic', connector, chat, thread ?? '', tag ?? ''), tag, topic: String(row.topic), available: false, canPublish };
        });
        if (mayConfigure && !rows.some(row => !row.tag)) bindings.push({ ...base,
          id: key('im-topic', connector, chat, thread ?? '', 'available'), tag: undefined, topic: '', available: true, canPublish: false });
        return bindings;
      }),
    ]);
  }

  function bind(project: string, input: IMTopicInput) {
    const connector = connectors.find(row => row.id === input.connector);
    const { chat, thread, tag, topic } = input;
    if (!connector || !location(connector, chat, thread)) throw new WorkbenchError('请选择已获准连接的会话。', 403);
    const current = scope.all(connector.id, chat, thread ?? '');
    if (current.some(row => row.tag === (tag ?? '') && row.project === project && row.topic === topic)) return false;
    if (current.some(row => !row.tag || !tag || row.tag === tag))
      throw new WorkbenchError('此会话或主题标识已有归属。共享会话的每个主题需要使用独立标识。', 409);
    db.prepare('INSERT INTO workbench_im_topic_binding VALUES (?,?,?,?,?,?)').run(connector.id, chat, thread ?? '', tag ?? '', project, topic);
    return true;
  }
  return { route, catalog, bind };
}
