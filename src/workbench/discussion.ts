import { z } from 'zod';
import { key } from '../../upstream/superagent/src/core/index.ts';
import { describeCron, nextRun, parseCron } from '../../upstream/autoloop/kernel/cron.ts';
import type { EventInput } from '../../upstream/autoloop/protocol/validate.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import type { ChannelRef, PlatformActor } from './channel-links.ts';
import type { DiscussionInput, SourceFact } from './discussion-intake.ts';
import { sensitiveFeishuText } from '../feishu-sources.ts';

export const discussionRule = (project: string) => '群消息整理 · ' + project;
export const discussionZone = 'Asia/Shanghai';
export const discussionBatch = 60;
export const discussionLookback = 3 * 24 * 3600_000;
const duplicateWindow = 12 * 3600_000;
const casual = /^(?:[\s。！!？，,]*(?:好的|收到|了解|嗯+|哈+|[oｏ]k|好呀|早安|晚安|早上好|大家好|谢谢(?:大家)?|辛苦了|点赞|节日快乐|生日快乐|周末愉快)[\s。！!？，,]*)$/iu;
const offTopic = /^(?:[（(][^）)]{1,18}[）)]\s*)?(?:大家|你们?|今天|晚上|今晚|中午|下班后|咱们|一起)*(?:打游戏[吗么具体]?|吃(?:了|啥|什么|饭)|晚饭吃|午饭吃|谁想喝|去不去打球|约球|周末去哪)[^。；;\n]{0,10}[？?。！!\s]*$/u;

export function discussionText(text: string) {
  const value = text.trim();
  if (!value || value.length > 3500 || value.startsWith('/') || sensitiveFeishuText.test(value) || casual.test(value)
    || offTopic.test(value) || /^[\p{P}\p{S}\s]+$/u.test(value)) return '';
  return value;
}

export type Observation = {
  id: string; message: string; project: string; chat: string; at: number; text: string;
  actor: PlatformActor; member?: string; origin: ChannelRef; root?: string; parent?: string; topic?: string; history?: boolean;
};
export function observation(project: string, input: DiscussionInput, member?: string, topic?: string): Observation {
  const { trigger, sender, origin } = input;
  return { id: trigger.id, message: String(trigger.meta.messageId), project, at: Date.parse(trigger.at), text: discussionText(trigger.text),
    chat: String(trigger.meta.chatId), actor: sender, member, origin, topic, history: input.history,
    root: typeof trigger.meta.rootId === 'string' ? trigger.meta.rootId : undefined,
    parent: typeof trigger.meta.parentId === 'string' ? trigger.meta.parentId : undefined };
}

export type DigestScope = {
  project: string; slot: number; ids: string[]; topics: string[]; tickets: string[]; facts: SourceFact[];
  matches: Record<string, string | null>; unavailable: string[]; relatedGithub: Record<string, string[]>;
};
export function githubObjectPath(text: string) {
  const url = new URL(text);
  const match = /^\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)\/?$/i.exec(url.pathname);
  if (url.protocol === 'https:' && url.hostname === 'github.com' && match)
    return [match[1]!.toLowerCase(), match[2]!.toLowerCase(), match[3]!].join('/');
}
export type Destination = { action: 'project' | 'topic' | 'link' | 'create' | 'review' | 'dismiss'; topic?: string; ticket?: string; agent?: string };
const proposalSchema = z.object({
  message: z.string().min(1).max(64), action: z.enum(['project', 'topic', 'link', 'create', 'review', 'dismiss']),
  topic: z.string().max(48).optional(), ticket: z.string().max(64).optional(),
  title: z.string().trim().max(100).default(''), reason: z.string().trim().max(380).default(''),
}).strict();
export type Proposal = z.infer<typeof proposalSchema>;

export function digestProposals(scope: DigestScope, events: EventInput[] | undefined): Proposal[] | undefined {
  const expected = new Set(scope.ids);
  const used = new Set<string>();
  const proposals: Proposal[] = [];
  for (const event of events ?? []) {
    if (event.type !== 'discussion.destination') return;
    let decoded: unknown;
    try { decoded = JSON.parse(event.detail); } catch { return; }
    const result = proposalSchema.safeParse(decoded);
    if (!result.success || !expected.has(result.data.message) || used.has(result.data.message)) return;
    const value = result.data;
    if ((value.ticket && !scope.tickets.includes(value.ticket)) || (value.topic && !scope.topics.includes(value.topic))) return;
    if ((value.action === 'link' && !value.ticket) || (value.action === 'topic' && !value.topic)) return;
    if (value.action !== 'dismiss' && (!value.title || !value.reason || sensitiveFeishuText.test(value.title + '\n' + value.reason))) return;
    used.add(value.message);
    proposals.push(value);
  }
  return used.size === expected.size ? proposals : undefined;
}

export type DigestItem = {
  id: string; project: string; slot: number; title: string; reason: string; destination: Destination;
  status: 'applied' | 'pending' | 'suggested'; topic?: string; ticket?: string; messageRefs: string[];
  decidedBy?: string;
  evidence: { title: string; kind: 'feishu' | SourceFact['kind']; url?: string; revision?: string }[];
};

export class Discussions {
  constructor(private readonly store: SuperAgentStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_discussion_chat (
        project TEXT NOT NULL, chat TEXT NOT NULL, since INTEGER NOT NULL, cursor INTEGER NOT NULL,
        PRIMARY KEY(project,chat)
      );
      CREATE TABLE IF NOT EXISTS workbench_discussion_message (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, chat TEXT NOT NULL, at INTEGER NOT NULL, body TEXT,
        fingerprint TEXT, settled INTEGER NOT NULL, item TEXT
      );
      CREATE INDEX IF NOT EXISTS workbench_discussion_due ON workbench_discussion_message(project,settled,at);
      CREATE TABLE IF NOT EXISTS workbench_discussion_run (
        run INTEGER PRIMARY KEY, project TEXT NOT NULL, slot INTEGER NOT NULL, scope TEXT, state TEXT NOT NULL, detail TEXT
      );
      CREATE INDEX IF NOT EXISTS workbench_discussion_latest ON workbench_discussion_run(project,slot);
      CREATE TABLE IF NOT EXISTS workbench_discussion_item (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, slot INTEGER NOT NULL, status TEXT NOT NULL, value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workbench_discussion_project ON workbench_discussion_item(project,slot);
      CREATE INDEX IF NOT EXISTS workbench_discussion_ticket ON workbench_discussion_item(json_extract(value,'$.ticket'));
    `);
  }

  chat(project: string, chat: string) {
    return this.store.db.prepare('SELECT since,cursor FROM workbench_discussion_chat WHERE project=? AND chat=?')
      .get(project, chat) as { since: number; cursor: number } | undefined;
  }

  track(project: string, chat: string, now: number) {
    this.store.db.prepare('INSERT OR IGNORE INTO workbench_discussion_chat VALUES (?,?,?,?)').run(project, chat, now, now);
  }

  advance(project: string, chat: string, end: number) {
    this.store.db.prepare('UPDATE workbench_discussion_chat SET cursor=MAX(cursor,?) WHERE project=? AND chat=?').run(end, project, chat);
  }

  remember(row: Observation) {
    const fingerprint = row.text ? key('ordinary-feishu', row.project, row.chat, row.root ?? '',
      row.text.normalize('NFKC').trim()) : null;
    const previous = fingerprint && this.store.db.prepare(`SELECT m.item FROM workbench_discussion_message m
      JOIN workbench_discussion_item i ON m.item=i.id WHERE m.project=? AND m.fingerprint=? AND m.at>=? ORDER BY m.at DESC LIMIT 1`)
      .get(row.project, fingerprint, row.at - duplicateWindow);
    const inserted = this.store.db.prepare(`INSERT INTO workbench_discussion_message VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(row.id, row.project, row.chat, row.at, row.text && !previous ? JSON.stringify(row) : null,
        fingerprint, row.text && !previous ? 0 : 1, previous ? previous.item : null);
    if (!inserted.changes && row.origin.label === '飞书原消息') {
      const saved = this.store.db.prepare('SELECT body FROM workbench_discussion_message WHERE id=? AND settled=0').get(row.id);
      if (typeof saved?.body === 'string') {
        const original: Observation = JSON.parse(saved.body);
        if (original.origin.label !== '飞书原消息') this.store.db.prepare('UPDATE workbench_discussion_message SET body=? WHERE id=?')
          .run(JSON.stringify({ ...original, origin: row.origin }), row.id);
      }
    }
    if (inserted.changes && previous && typeof previous.item === 'string') {
      const item = this.item(previous.item);
      if (item && item.messageRefs.length < discussionBatch && !item.messageRefs.includes(row.id)) this.saveItem({ ...item, messageRefs: item.messageRefs.concat(row.id),
        evidence: [...item.evidence, { kind: 'feishu', title: row.origin.label, url: row.origin.url }] });
    }
  }

  batch(project: string, end: number) {
    const unique = new Map<string, Observation>();
    const rows = this.store.db.prepare(`SELECT body,fingerprint FROM workbench_discussion_message
      WHERE project=? AND settled=0 AND at<? AND body IS NOT NULL ORDER BY at,id LIMIT ?`)
      .all(project, end, discussionBatch);
    for (const row of rows) {
      const fingerprint = String(row.fingerprint);
      if (!unique.has(fingerprint)) unique.set(fingerprint, JSON.parse(String(row.body)));
    }
    return [...unique.values()];
  }

  prune(now: number) {
    this.store.db.prepare('UPDATE workbench_discussion_message SET body=NULL,settled=1 WHERE at<? AND body IS NOT NULL')
      .run(now - discussionLookback);
    this.store.db.prepare('DELETE FROM workbench_discussion_message WHERE at<? AND item IS NULL')
      .run(now - discussionLookback * 2);
  }

  withdraw(project: string, chat: string, id: string, at: number) {
    const row = this.store.db.prepare('SELECT item FROM workbench_discussion_message WHERE project=? AND chat=? AND id=?').get(project, chat, id);
    this.store.db.prepare(`INSERT INTO workbench_discussion_message(id,project,chat,at,settled) VALUES (?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET settled=1,body=NULL,item=NULL WHERE project=excluded.project AND chat=excluded.chat`).run(id, project, chat, at);
    if (typeof row?.item === 'string') this.dismiss(row.item);
  }

  messageGroupFor(id: string, slot: number): Observation[] {
    return this.store.db.prepare(`SELECT sibling.body FROM workbench_discussion_message first
      JOIN workbench_discussion_message sibling ON first.project=sibling.project AND first.fingerprint=sibling.fingerprint
      WHERE first.id=? AND sibling.settled=0 AND sibling.body IS NOT NULL AND sibling.at<? ORDER BY sibling.at,sibling.id LIMIT ?`)
      .all(id, slot, discussionBatch).map(row => JSON.parse(String(row.body)));
  }

  messageRefs(item: string): Observation[] {
    return this.store.db.prepare('SELECT body FROM workbench_discussion_message WHERE item=? AND body IS NOT NULL ORDER BY at,id')
      .all(item).map(row => JSON.parse(String(row.body)));
  }

  settle(id: string, item?: string, keep = true) {
    this.store.db.prepare('UPDATE workbench_discussion_message SET settled=1,item=?,body=CASE WHEN ? IS NULL THEN NULL ELSE body END WHERE id=?')
      .run(item ?? null, keep ? item ?? null : null, id);
  }

  saveRun(run: number, project: string, slot: number, state: string, detail?: string, scope?: DigestScope) {
    this.store.db.prepare(`INSERT INTO workbench_discussion_run VALUES (?,?,?,?,?,?) ON CONFLICT(run)
      DO UPDATE SET state=excluded.state,detail=excluded.detail,scope=excluded.scope`)
      .run(run, project, slot, scope ? JSON.stringify(scope) : null, state, detail ?? null);
  }

  run(run: number) {
    const row = this.store.db.prepare('SELECT project,slot,state,scope,detail FROM workbench_discussion_run WHERE run=?').get(run);
    return row && { project: String(row.project), slot: Number(row.slot), state: String(row.state),
      detail: typeof row.detail === 'string' ? row.detail : undefined,
      scope: typeof row.scope === 'string' ? JSON.parse(row.scope) as DigestScope : undefined };
  }

  runs(project: string): number[] {
    return this.store.db.prepare('SELECT run FROM workbench_discussion_run WHERE project=?').all(project).map(row => Number(row.run));
  }

  item(id: string): DigestItem | undefined {
    const row = this.store.db.prepare('SELECT value FROM workbench_discussion_item WHERE id=?').get(id);
    return row && JSON.parse(String(row.value));
  }

  saveItem(item: DigestItem) {
    this.store.db.prepare(`INSERT INTO workbench_discussion_item VALUES (?,?,?,?,?) ON CONFLICT(id)
      DO UPDATE SET status=excluded.status,value=excluded.value`).run(item.id, item.project, item.slot, item.status, JSON.stringify(item));
  }

  list(project: string): DigestItem[] {
    return this.store.db.prepare(`SELECT value FROM workbench_discussion_item WHERE project=?
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END, slot DESC,rowid DESC LIMIT 100`)
      .all(project).map(row => JSON.parse(String(row.value)));
  }

  dismiss(id: string) {
    this.store.db.prepare('DELETE FROM workbench_discussion_item WHERE id=?').run(id);
    this.store.db.prepare('UPDATE workbench_discussion_message SET body=NULL,item=NULL WHERE item=?').run(id);
  }


  linked(ticket: string): DigestItem[] {
    return this.store.db.prepare(`SELECT value FROM workbench_discussion_item
      WHERE json_extract(value,'$.ticket')=? ORDER BY slot DESC,rowid DESC LIMIT 40`).all(ticket)
      .map(row => JSON.parse(String(row.value)));
  }

  pendingCount(project: string) {
    return Number(this.store.db.prepare(`SELECT COUNT(*) AS count FROM workbench_discussion_item WHERE project=? AND status='pending'`)
      .get(project)?.count);
  }

  stopChanged(project: string, stillAllowed: (row: Observation) => boolean) {
    this.store.atomic(() => {
      const rows = this.store.db.prepare(`SELECT id,item,body FROM workbench_discussion_message WHERE project=? AND body IS NOT NULL`).all(project);
      for (const row of rows) {
        if (stillAllowed(JSON.parse(String(row.body)))) continue;
        if (typeof row.item === 'string') this.dismiss(row.item);
        else this.settle(String(row.id));
      }
    });
  }

  view(project: string, cron: string, next?: number) {
    const result = this.store.db.prepare(`SELECT slot,state,detail FROM workbench_discussion_run
      WHERE project=? AND state<>'empty' ORDER BY slot DESC,run DESC LIMIT 1`).get(project);
    return { schedule: cron === '0 0,12 * * *' ? '每天 00:00 和 12:00' : describeCron(cron),
      next: next ?? nextRun(parseCron(cron)!, Date.now(), discussionZone), last: result,
      waiting: Number(this.store.db.prepare('SELECT COUNT(*) AS count FROM workbench_discussion_message WHERE project=? AND settled=0').get(project)?.count) };
  }
}
