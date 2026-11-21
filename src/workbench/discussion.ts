import { z } from 'zod';
import { key } from '../../upstream/superagent/src/core/index.ts';
import { describeDigestSchedule, digestSchedule } from './execution/cron.ts';
import type { EventInput } from './execution/protocol.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import type { ChannelRef, PlatformActor } from './channel-links.ts';
import type { DiscussionInput, DiscussionThread, SourceFact } from './discussion-intake.ts';
import { sensitiveFeishuText } from '../feishu-sources.ts';
import type { TriggerPolicy } from './config.ts';

export const discussionRule = (project: string) => '群消息整理 · ' + project;
export const digestAgentId = (project: string) => 'discussion-worker-' + project;
export const discussionZone = 'Asia/Shanghai';
export const discussionBatch = 30;
export const discussionLookback = 3 * 24 * 3600_000;
export const previewLength = 600;
const casual = /^(?:[\s。！!？，,]*(?:好的|收到|了解|嗯+|哈+|[oｏ]k|好呀|早安|晚安|早上好|大家好|谢谢(?:大家)?|辛苦了|点赞|节日快乐|生日快乐|周末愉快)[\s。！!？，,]*)$/iu;
const offTopic = /^(?:[（(][^）)]{1,18}[）)]\s*)?(?:大家|你们?|今天|晚上|今晚|中午|下班后|咱们|一起)*(?:打游戏[吗么具体]?|吃(?:了|啥|什么|饭)|晚饭吃|午饭吃|谁想喝|去不去打球|约球|周末去哪)[^。；;\n]{0,10}[？?。！!\s]*$/u;

export function discussionText(text: string) {
  const value = text.trim();
  if (!value || value.length > 3500 || value.startsWith('/') || sensitiveFeishuText.test(value) || casual.test(value)
    || offTopic.test(value) || /^[\p{P}\p{S}\s]+$/u.test(value)) return '';
  return value;
}

/**
 * 触发策略裁决：关键词命中优先；strict 只收关键词或点名；open 只过滤敏感与空消息；
 * 沉默期内非关键词消息被静默，避免同一话题重复唤醒。
 */
export function triggerVerdict(policy: TriggerPolicy | undefined, text: string, silence: boolean, mention = false): { text: string; keyword?: string } {
  const value = text.trim();
  if (!value) return { text: '' };
  const keyword = policy?.keywords.find(term => value.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  if (keyword) return { text: value.slice(0, 3500), keyword };
  if (!policy) return { text: discussionText(value) };
  if (policy.sensitivity === 'strict' && !(mention && policy.mentionAlways)) return { text: '' };
  if (silence && policy.silenceMinutes > 0) return { text: '' };
  if (policy.sensitivity === 'open') {
    if (sensitiveFeishuText.test(value) || value.startsWith('/') || /^[\p{P}\p{S}\s]+$/u.test(value)) return { text: '' };
    return { text: value.slice(0, 3500) };
  }
  return { text: discussionText(value) };
}

export type Observation = {
  id: string; message: string; project: string; chat: string; at: number; text: string;
  actor: PlatformActor; member?: string; origin: ChannelRef; root?: string; parent?: string; topic?: string; history?: boolean;
  updatedAt?: number; channel?: boolean;
};
export function observation(project: string, input: DiscussionInput, member?: string, topic?: string): Observation {
  const { trigger, sender, origin } = input;
  return { id: trigger.id, message: String(trigger.meta.messageId), project, at: Date.parse(trigger.at), text: discussionText(trigger.text),
    updatedAt: input.updatedAt,
    chat: String(trigger.meta.chatId), actor: sender, member, origin, topic, history: input.history,
    root: typeof trigger.meta.rootId === 'string' ? trigger.meta.rootId : undefined,
    parent: typeof trigger.meta.parentId === 'string' ? trigger.meta.parentId : undefined };
}

export type DigestScope = {
  project: string; slot: number; ids: string[]; topics: string[]; tickets: string[]; facts: SourceFact[];
  matches: Record<string, string | null>; unavailable: string[]; relatedGithub: Record<string, string[]>;
  groups?: Record<string, Record<string, string>>;
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

export { confirmedDiscussionDestination } from './router.ts';

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
    const conflicted = scope.matches[value.message] === null || scope.unavailable.includes(value.message);
    proposals.push(conflicted && value.action === 'dismiss' ? { ...value, action: 'review',
      title: '群消息需要确认归属', reason: '来源引用冲突或暂时无法核对，请查看原消息。' } : value);
  }
  return used.size === expected.size ? proposals : undefined;
}

export type DigestItem = {
  id: string; project: string; slot: number; title: string; reason: string; destination: Destination;
  status: 'applied' | 'pending' | 'suggested'; topic?: string; ticket?: string; messageRefs: string[];
  decidedBy?: string;
  evidence: { title: string; kind: 'feishu' | SourceFact['kind']; url?: string; revision?: string; message?: string }[];
};

type SavedMessage = { body: string | null; source: string | null; updated: number | null; withdrawn: number; item: string | null; settled: number };
type MessageRevision = { at: number; revision: string; text: string | null };
export const observationVersion = ({ text }: Observation) => key('discussion-text', text);

export class Discussions {
  constructor(private readonly store: SuperAgentStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_discussion_chat (
        project TEXT NOT NULL, chat TEXT NOT NULL, since INTEGER NOT NULL, cursor INTEGER NOT NULL,
        PRIMARY KEY(project,chat)
      );
      CREATE TABLE IF NOT EXISTS workbench_discussion_thread (
        project TEXT NOT NULL, chat TEXT NOT NULL, id TEXT NOT NULL, root TEXT NOT NULL,
        at INTEGER NOT NULL, cursor INTEGER NOT NULL, checked INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(project,chat,id)
      );
      CREATE TABLE IF NOT EXISTS workbench_discussion_message (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, chat TEXT NOT NULL, at INTEGER NOT NULL, body TEXT,
        fingerprint TEXT, settled INTEGER NOT NULL, item TEXT, source TEXT, updated INTEGER, checked INTEGER, withdrawn INTEGER NOT NULL DEFAULT 0
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
      CREATE TABLE IF NOT EXISTS workbench_discussion_revision (
        message TEXT NOT NULL, at INTEGER NOT NULL, revision TEXT NOT NULL, text TEXT,
        PRIMARY KEY(message,at,revision), FOREIGN KEY(message) REFERENCES workbench_discussion_message(id) ON DELETE CASCADE
      );
    `);
    const columns = new Set(store.db.prepare('PRAGMA table_info(workbench_discussion_message)').all().map(column => column.name));
    for (const [name, type] of [['source', 'TEXT'], ['updated', 'INTEGER'], ['checked', 'INTEGER'], ['withdrawn', 'INTEGER NOT NULL DEFAULT 0']])
      if (!columns.has(name)) store.db.exec('ALTER TABLE workbench_discussion_message ADD COLUMN ' + name + ' ' + type);
    store.db.exec(`CREATE INDEX IF NOT EXISTS workbench_discussion_topic ON workbench_discussion_message(project,json_extract(source,'$.topic'),at DESC);`);
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

  trackThread(project: string, chat: string, thread: DiscussionThread) {
    const scope = this.chat(project, chat);
    if (!scope) return;
    this.store.db.prepare(`INSERT INTO workbench_discussion_thread(project,chat,id,root,at,cursor) VALUES (?,?,?,?,?,?)
      ON CONFLICT(project,chat,id) DO UPDATE SET at=MAX(at,excluded.at) WHERE root=excluded.root`)
      .run(project, chat, thread.id, thread.root, thread.at, scope.since);
  }

  threads(project: string, chat: string, end: number, roots: string[] = []) {
    return this.store.db.prepare(`SELECT id,root,at,cursor FROM workbench_discussion_thread
      WHERE project=? AND chat=? AND (at>=? OR root IN (SELECT value FROM json_each(?)))
        AND cursor<? ORDER BY checked,at,id LIMIT 12`)
      .all(project, chat, end - discussionLookback, JSON.stringify(roots), end) as (DiscussionThread & { cursor: number })[];
  }

  thread(project: string, chat: string, id: string) {
    return this.store.db.prepare('SELECT id,root,at,cursor FROM workbench_discussion_thread WHERE project=? AND chat=? AND id=?')
      .get(project, chat, id) as (DiscussionThread & { cursor: number }) | undefined;
  }

  forgetThread(project: string, chat: string, root: string) {
    this.store.db.prepare('DELETE FROM workbench_discussion_thread WHERE project=? AND chat=? AND root=?').run(project, chat, root);
  }

  advanceThread(project: string, chat: string, thread: string, end: number, covered: boolean) {
    this.store.db.prepare(`UPDATE workbench_discussion_thread SET cursor=MAX(cursor,?),checked=?
      WHERE project=? AND chat=? AND id=?`).run(covered ? end : 0, Date.now(), project, chat, thread);
  }

  remember(row: Observation) {
    const db = this.store.db;
    const fingerprint = row.text ? key('ordinary-feishu', row.project, row.chat, row.root ?? '', row.parent ?? '',
      row.text.normalize('NFKC').trim()) : null;
    const at = Math.max(row.at, row.updatedAt ?? row.at);
    const checked = row.history ? Date.now() : null;
    const saved = db.prepare('SELECT * FROM workbench_discussion_message WHERE id=? AND project=? AND chat=?')
      .get(row.id, row.project, row.chat) as SavedMessage | undefined;
    if (!saved) {
      const inserted = db.prepare(`INSERT INTO workbench_discussion_message
        (id,project,chat,at,body,fingerprint,settled,source,updated,checked) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
        .run(row.id, row.project, row.chat, row.at, row.text && !row.channel ? JSON.stringify(row) : null,
          fingerprint, row.text && !row.channel ? 0 : 1, row.text || row.channel ? JSON.stringify({ ...row, text: '' }) : null, at, checked);
      if (inserted.changes && (row.text || row.channel)) this.saveRevision(row, at);
      return;
    }
    if (saved.withdrawn || at < (saved.updated ?? row.at)) return;
    const previousBody: Observation | undefined = saved.body ? JSON.parse(saved.body) : undefined;
    const original: Observation = saved.source ? JSON.parse(saved.source) : previousBody ?? row;
    const latest = db.prepare('SELECT revision FROM workbench_discussion_revision WHERE message=? ORDER BY at DESC,rowid DESC LIMIT 1').get(row.id);
    const previous = latest?.revision ?? (previousBody && observationVersion(previousBody));
    const changed = previous ? previous !== observationVersion(row)
      // Older archives kept the summary and dropped the input text. The first reread seeds its evidence history.
      : !saved.item && !!row.text;
    const current = { ...original, ...(!original.member && row.member ? { member: row.member, actor: row.actor, history: row.history } : {}),
      origin: row.origin.label === '飞书原消息' ? row.origin : original.origin, text: row.text, updatedAt: at };
    if (changed && previousBody && !latest) this.saveRevision(previousBody, saved.updated ?? original.at);
    if (changed || (!latest && row.text)) this.saveRevision(current, at);
    const item = saved.item ? this.item(saved.item) : undefined;
    const keep = item && (!changed || item.status === 'applied') ? item : undefined;
    if (changed && item && !keep) this.removeSource(item, row.id);
    const waiting = Boolean(row.text && !current.channel && !keep && (!saved.settled || changed));
    db.prepare(`UPDATE workbench_discussion_message SET body=?,fingerprint=?,settled=?,item=?,source=?,updated=?,checked=COALESCE(?,checked)
      WHERE id=?`).run(waiting || (row.text && keep && keep.status !== 'applied') ? JSON.stringify(current) : null,
        fingerprint, waiting ? 0 : 1, keep?.id ?? null,
        saved.source || row.text ? JSON.stringify({ ...current, text: '' }) : null, at, checked, row.id);
  }

  private saveRevision(row: Observation, at: number) {
    this.store.db.prepare('INSERT OR IGNORE INTO workbench_discussion_revision VALUES (?,?,?,?)')
      .run(row.id, at, observationVersion(row), row.text || null);
  }

  revisions(id: string) {
    return this.store.db.prepare('SELECT at,revision,text FROM workbench_discussion_revision WHERE message=? ORDER BY at,rowid')
      .all(id) as MessageRevision[];
  }

  pendingMessage(id: string, slot: number): Observation | undefined {
    const row = this.store.db.prepare('SELECT body FROM workbench_discussion_message WHERE id=? AND settled=0 AND at<?').get(id, slot);
    return typeof row?.body === 'string' ? JSON.parse(row.body) : undefined;
  }

  sources(item: DigestItem) {
    return item.messageRefs.map(id => {
      const source = this.source(id);
      const revisions = this.revisions(id).map(({ at, revision }) => ({ at, revision }));
      const evidence = item.evidence.find(ref => ref.kind === 'feishu' && this.belongsTo(item, ref, id));
      return { id, url: source?.origin.url ?? evidence?.url, member: source?.member,
        sender: source && key('discussion-sender', source.actor.namespace, source.actor.id), at: source?.at,
        digestRevision: evidence?.revision, currentRevision: revisions.at(-1)?.revision, revisions };
    });
  }

  sourceEvidence(row: Observation): DigestItem['evidence'][number] {
    return { kind: 'feishu', title: row.origin.label, url: row.origin.url, message: row.id, revision: observationVersion(row) };
  }

  source(id: string) {
    const data = this.store.db.prepare('SELECT source,body FROM workbench_discussion_message WHERE id=? AND withdrawn=0').get(id);
    const raw = data?.source ?? data?.body;
    return typeof raw === 'string' ? JSON.parse(raw) as Observation : undefined;
  }

  recentTopic(project: string, topic: string): string[] {
    return this.store.db.prepare(`SELECT id FROM workbench_discussion_message WHERE project=? AND json_extract(source,'$.topic')=?
      AND withdrawn=0 AND COALESCE(json_extract(source,'$.channel'),0)=0 ORDER BY at DESC,id LIMIT 16`)
      .all(project, topic).map(row => String(row.id));
  }

  withdrawn(id: string) {
    return !!this.store.db.prepare('SELECT 1 FROM workbench_discussion_message WHERE id=? AND withdrawn=1').get(id);
  }

  watchMessages(project: string, chat: string) {
    // Fetch older known messages by ID to catch edits after their creation window. Rotate the read budget.
    return this.store.db.prepare(`SELECT id,COALESCE(source,body) AS source FROM workbench_discussion_message WHERE project=? AND chat=?
      AND (source IS NOT NULL OR body IS NOT NULL) AND withdrawn=0 AND (item IS NOT NULL OR settled=0 OR json_extract(source,'$.channel')=1)
      ORDER BY COALESCE(checked,0),at,id LIMIT 50`).all(project, chat)
      .map(row => ({ id: String(row.id), native: (JSON.parse(String(row.source)) as Observation).message }));
  }

  checked(ids: string[]) {
    const update = this.store.db.prepare('UPDATE workbench_discussion_message SET checked=? WHERE id=?');
    for (const id of ids) update.run(Date.now(), id);
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
    const cutoff = now - discussionLookback;
    this.store.db.prepare(`UPDATE workbench_discussion_message SET body=NULL,settled=1 WHERE COALESCE(updated,at)<?
      AND body IS NOT NULL AND item IS NULL`).run(cutoff);
    this.store.db.prepare(`UPDATE workbench_discussion_revision SET text=NULL WHERE text IS NOT NULL AND at<?
      AND message IN (SELECT id FROM workbench_discussion_message WHERE item IS NULL AND COALESCE(json_extract(source,'$.channel'),0)=0)`).run(cutoff);
    this.store.db.prepare(`DELETE FROM workbench_discussion_message WHERE COALESCE(updated,at)<? AND item IS NULL AND withdrawn=0
      AND COALESCE(json_extract(source,'$.channel'),0)=0`)
      .run(now - discussionLookback * 2);
  }

  withdraw(project: string, chat: string, id: string, at: number) {
    const row = this.store.db.prepare('SELECT item FROM workbench_discussion_message WHERE project=? AND chat=? AND id=?').get(project, chat, id);
    this.store.db.prepare(`INSERT INTO workbench_discussion_message(id,project,chat,at,settled,withdrawn) VALUES (?,?,?,?,1,1)
      ON CONFLICT(id) DO UPDATE SET settled=1,withdrawn=1,body=NULL,source=NULL,fingerprint=NULL,item=NULL
      WHERE project=excluded.project AND chat=excluded.chat`).run(id, project, chat, at);
    this.store.db.prepare(`UPDATE workbench_discussion_revision SET text=NULL WHERE message=? AND EXISTS
      (SELECT 1 FROM workbench_discussion_message WHERE id=? AND project=? AND chat=? AND withdrawn=1)`).run(id, id, project, chat);
    const item = typeof row?.item === 'string' ? this.item(row.item) : undefined;
    if (item) this.removeSource(item, id);
    return item?.ticket;
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

  extract(item: DigestItem, message: string, id: string) {
    const evidence = item.evidence.filter(ref => ref.kind !== 'feishu' || this.belongsTo(item, ref, message));
    this.removeSource(item, message);
    this.store.db.prepare('UPDATE workbench_discussion_message SET item=? WHERE id=? AND item=?').run(id, message, item.id);
    const portion = { ...item, id, messageRefs: [message], evidence };
    this.saveItem(portion);
    return portion;
  }

  private belongsTo(item: DigestItem, ref: DigestItem['evidence'][number], id: string) {
    if (ref.message) return ref.message === id;
    // Older digests stored Feishu evidence in source order without recording the message ID.
    return item.evidence.filter(entry => entry.kind === 'feishu').indexOf(ref) === item.messageRefs.indexOf(id);
  }

  private removeSource(item: DigestItem, id: string) {
    const messageRefs = item.messageRefs.filter(message => message !== id);
    if (!messageRefs.length) this.store.db.prepare('DELETE FROM workbench_discussion_item WHERE id=?').run(item.id);
    else this.saveItem({ ...item, messageRefs, evidence: item.evidence.filter(ref => ref.kind !== 'feishu' || !this.belongsTo(item, ref, id)) });
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

  stopChanged(project: string, stillAllowed: (row: Observation) => boolean, removed: (id: string, ticket: string) => void) {
    this.store.atomic(() => {
      const rows = this.store.db.prepare(`SELECT COALESCE(source,body) AS source FROM workbench_discussion_message
        WHERE project=? AND withdrawn=0 AND (source IS NOT NULL OR body IS NOT NULL)`).all(project);
      for (const row of rows) {
        const source = JSON.parse(String(row.source)) as Observation;
        if (stillAllowed(source)) continue;
        const ticket = this.withdraw(project, source.chat, source.id, source.at);
        if (ticket) removed(source.id, ticket);
      }
    });
  }

  view(project: string, cron: string, next?: number) {
    const result = this.store.db.prepare(`SELECT slot,state,detail FROM workbench_discussion_run
      WHERE project=? AND state<>'empty' ORDER BY slot DESC,run DESC LIMIT 1`).get(project);
    return { schedule: cron === '0 0,12 * * *' ? '每天 00:00 和 12:00' : describeDigestSchedule(cron),
      next: next ?? digestSchedule(cron).next(Date.now()), last: result,
      waiting: Number(this.store.db.prepare('SELECT COUNT(*) AS count FROM workbench_discussion_message WHERE project=? AND settled=0').get(project)?.count) };
  }
}
