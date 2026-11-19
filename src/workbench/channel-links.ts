import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Trigger } from '../../upstream/superagent/src/core/index.ts';

export type Provider = 'feishu' | 'github' | 'octop';
export type PlatformActor = { provider: Provider; namespace: string; id: string; label: string };
export type ChannelRef = { key: string; url?: string; label: string; project?: string };
export type ChannelRequest = {
  trigger: Trigger;
  sender: PlatformActor;
  origin: ChannelRef;
  project: string;
  agent: string;
  request: string;
  note?: boolean;
  topic?: string;
  reference?: ChannelRef | string;
  parentMessage?: ChannelRef;
  revision?: string;
  recovered?: { kind: 'work' } | { kind: 'answer'; ticket: string; card: number };
};

type Binding = {
  provider: Provider; namespace: string; id: string; label: string; member: string; verifiedAt: string;
};
type Proof = {
  member: string; provider: Provider; expires: number; sender: string | null; url: string | null;
};
export type PendingRequest = {
  id: string; member: string; request: ChannelRequest; reason: string; ticket?: string;
};

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const messageRef = (id: string, url?: string): ChannelRef => ({ key: 'channel-message:' + id, label: '原消息', url });
export const consultationReplyType = 'contractor.consultation-reply';

export function feishuCommandText(content: string, mention?: { key?: string; name?: string }) {
  const text = content.trim();
  const prefix = [mention?.key, mention?.name ? '@' + mention.name : undefined]
    .find(value => value && text.startsWith(value) && /^\s/.test(text.slice(value.length)));
  return prefix ? text.slice(prefix.length).trimStart() : text;
}

export function feishuConsultation(text: string) {
  const match = /^\/咨询\s+(?:@([a-z][a-z0-9-]{0,47})\s+)?([^@\s][\s\S]*)$/.exec(text.trim());
  if (match && match[2]!.length <= 3500) return { text: match[2]!, ...(match[1] && { agents: [match[1]] }) };
}

export function channelCommand(text: string) {
  const activation = /^\/开通协作\s+([a-f0-9]{32})$/.exec(text.trim());
  if (activation) return { kind: 'activation' as const, code: activation[1]! };
  const recovery = /^\/找回口令\s+([a-f0-9]{32})$/.exec(text.trim());
  if (recovery) return { kind: 'recovery' as const, code: recovery[1]! };
  const proof = /^\/绑定协作\s+([a-f0-9]{32})$/.exec(text.trim());
  if (proof) return { kind: 'proof' as const, code: proof[1]! };
  const answer = /^\/答\s+([a-f0-9]{32})\s+([\s\S]{1,3500})$/.exec(text.trim());
  if (answer) return { kind: 'answer' as const, id: answer[1]!, response: answer[2]! };
  const work = /^\/协作\s+([a-z][a-z0-9-]{0,47})(?:\s+\[([^\]\r\n]{1,350})\])?\s+([\s\S]+)$/.exec(text.trim());
  if (work && work[3]!.trim().length <= 3500)
    return { kind: 'work' as const, agent: work[1]!, reference: work[2]?.trim(), request: work[3]!.trim() };
}

/** Contractor mappings share the native Store transaction with Engine ticket creation. */
export class ChannelLinks {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_account_link (
        provider TEXT NOT NULL, namespace TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL,
        member TEXT NOT NULL, verifiedAt TEXT NOT NULL, PRIMARY KEY(provider,namespace,id)
      );
      CREATE TABLE IF NOT EXISTS workbench_account_proof (
        hash TEXT PRIMARY KEY, member TEXT NOT NULL, provider TEXT NOT NULL, expires INTEGER NOT NULL,
        sender TEXT, url TEXT, UNIQUE(member,provider)
      );
      CREATE TABLE IF NOT EXISTS workbench_thread_link (
        ref TEXT PRIMARY KEY, ticket TEXT NOT NULL, label TEXT NOT NULL, url TEXT
      );
      CREATE TABLE IF NOT EXISTS workbench_channel_event (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, member TEXT NOT NULL, request TEXT NOT NULL,
        reason TEXT, ticket TEXT, resolved INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS workbench_channel_pending ON workbench_channel_event(project,resolved);
      CREATE INDEX IF NOT EXISTS workbench_channel_ticket ON workbench_channel_event(ticket);
      CREATE INDEX IF NOT EXISTS workbench_thread_ticket ON workbench_thread_link(ticket);
      CREATE TABLE IF NOT EXISTS workbench_channel_revision (
        event TEXT NOT NULL, at TEXT NOT NULL, hash TEXT NOT NULL, text TEXT,
        PRIMARY KEY(event,at,hash), FOREIGN KEY(event) REFERENCES workbench_channel_event(id)
      );
      CREATE TABLE IF NOT EXISTS workbench_channel_archive (
        event TEXT PRIMARY KEY, topic TEXT, FOREIGN KEY(event) REFERENCES workbench_channel_event(id)
      );
    `);
  }

  begin(member: string, provider: Provider) {
    const code = randomBytes(16).toString('hex');
    const expires = Date.now() + 10 * 60_000;
    this.db.prepare(`INSERT INTO workbench_account_proof VALUES (?,?,?,?,NULL,NULL)
      ON CONFLICT(member,provider) DO UPDATE SET hash=excluded.hash, expires=excluded.expires, sender=NULL, url=NULL`)
      .run(digest(code), member, provider, expires);
    return { command: '/绑定协作 ' + code, expires };
  }

  prove(code: string, sender: PlatformActor, url?: string) {
    return this.db.prepare(`UPDATE workbench_account_proof SET sender=?,url=?
      WHERE hash=? AND provider=? AND expires>? AND sender IS NULL`)
      .run(JSON.stringify(sender), url ?? null, digest(code), sender.provider, Date.now()).changes === 1;
  }

  status(member: string) {
    const accounts = this.db.prepare('SELECT * FROM workbench_account_link WHERE member=? ORDER BY provider,label')
      .all(member) as Binding[];
    const proofs = this.db.prepare('SELECT * FROM workbench_account_proof WHERE member=? AND expires>? ORDER BY provider')
      .all(member, Date.now()) as Proof[];
    return { accounts, proofs: proofs.map(({ provider, expires, sender, url }) => ({
      provider, expires, url, sender: sender ? JSON.parse(sender) as PlatformActor : null,
    })) };
  }

  confirm(member: string, provider: Provider, expected: { namespace: string; id: string }) {
    const proof = this.db.prepare('SELECT * FROM workbench_account_proof WHERE member=? AND provider=? AND expires>?')
      .get(member, provider, Date.now()) as Proof | undefined;
    if (!proof?.sender) return 'missing';
    const sender = JSON.parse(proof.sender) as PlatformActor;
    if (sender.id !== expected.id || sender.namespace !== expected.namespace) return 'changed';
    if (!this.bindVerified(member, sender)) return 'conflict';
    this.db.prepare('DELETE FROM workbench_account_proof WHERE member=? AND provider=?').run(member, provider);
    return 'bound';
  }

  bindVerified(member: string, sender: PlatformActor) {
    const existing = this.member(sender);
    if (existing && existing !== member) return false;
    this.db.prepare(`INSERT INTO workbench_account_link VALUES (?,?,?,?,?,?)
      ON CONFLICT(provider,namespace,id) DO UPDATE SET label=excluded.label`)
      .run(sender.provider, sender.namespace, sender.id, sender.label, member, new Date().toISOString());
    return true;
  }

  unlink(member: string, provider: Provider, namespace: string, id: string) {
    return this.db.prepare('DELETE FROM workbench_account_link WHERE member=? AND provider=? AND namespace=? AND id=?')
      .run(member, provider, namespace, id).changes === 1;
  }

  member(sender: PlatformActor, at?: string): string | undefined {
    const row = this.db.prepare('SELECT member,verifiedAt FROM workbench_account_link WHERE provider=? AND namespace=? AND id=?')
      .get(sender.provider, sender.namespace, sender.id) as Pick<Binding, 'member' | 'verifiedAt'> | undefined;
    if (!row) return;
    if (at && !(Date.parse(at) >= Date.parse(row.verifiedAt))) return;
    return row.member;
  }

  ticket(ref: ChannelRef) {
    const row = this.db.prepare('SELECT ticket FROM workbench_thread_link WHERE ref=?').get(ref.key);
    return typeof row?.ticket === 'string' ? row.ticket : undefined;
  }

  link(ref: ChannelRef, ticket: string) {
    const existing = this.ticket(ref);
    if (existing) return existing === ticket;
    this.db.prepare('INSERT INTO workbench_thread_link VALUES (?,?,?,?)')
      .run(ref.key, ticket, ref.label, ref.url ?? null);
    return true;
  }

  references(ticket: string) {
    return this.db.prepare('SELECT ref AS key,label,url FROM workbench_thread_link WHERE ticket=? ORDER BY rowid').all(ticket);
  }

  unlinkReference(ref: ChannelRef, ticket: string) {
    this.db.prepare('DELETE FROM workbench_thread_link WHERE ref=? AND ticket=?').run(ref.key, ticket);
  }

  seen(id: string) {
    return !!this.db.prepare('SELECT 1 FROM workbench_channel_event WHERE id=?').get(id);
  }

  record(event: ChannelRequest, member: string, outcome: { ticket: string } | { reason: string }) {
    this.db.prepare('INSERT INTO workbench_channel_event VALUES (?,?,?,?,?,?,?)').run(
      event.trigger.id, event.project, member, JSON.stringify(event),
      'reason' in outcome ? outcome.reason : null, 'ticket' in outcome ? outcome.ticket : null,
      'ticket' in outcome ? 1 : 0,
    );
  }

  revise(id: string, at: string, body: string, shared: boolean) {
    const hash = digest(body.trim());
    const last = this.db.prepare('SELECT at,hash FROM workbench_channel_revision WHERE event=? ORDER BY at DESC,rowid DESC LIMIT 1').get(id);
    if (last && (Date.parse(String(last.at)) > Date.parse(at) || last.hash === hash)) return;
    this.db.prepare('INSERT OR IGNORE INTO workbench_channel_revision VALUES (?,?,?,?)')
      .run(id, at, hash, shared ? body : null);
  }

  revisions(id: string) {
    return this.db.prepare('SELECT at,hash AS revision,text FROM workbench_channel_revision WHERE event=? ORDER BY at,rowid')
      .all(id) as { at: string; revision: string; text: string | null }[];
  }

  private read(row: Record<string, unknown>): PendingRequest {
    return { id: String(row.id), member: String(row.member), request: JSON.parse(String(row.request)), reason: String(row.reason ?? ''),
      ticket: typeof row.ticket === 'string' ? row.ticket : undefined };
  }

  event(id: string) {
    const row = this.db.prepare('SELECT * FROM workbench_channel_event WHERE id=?').get(id);
    return row && this.read(row);
  }

  recentFeishuTriggers(project: string, chat: string, since: string): Trigger[] {
    return this.db.prepare(`SELECT json_extract(request,'$.trigger') AS trigger FROM workbench_channel_event
      WHERE project=? AND json_extract(request,'$.trigger.source')='feishu'
        AND json_extract(request,'$.trigger.meta.chatId')=?
        AND json_extract(request,'$.trigger.at')>=?
        AND json_extract(request,'$.trigger.meta.threadId') IS NOT NULL
      ORDER BY rowid DESC LIMIT 100`).all(project, chat, since).map(row => JSON.parse(String(row.trigger)) as Trigger);
  }

  pending(project: string) {
    return this.db.prepare('SELECT * FROM workbench_channel_event WHERE project=? AND resolved=0 ORDER BY rowid')
      .all(project).map(row => this.read(row));
  }

  getPending(id: string) {
    const row = this.db.prepare('SELECT * FROM workbench_channel_event WHERE id=? AND resolved=0').get(id);
    return row && this.read(row);
  }

  updatePending(request: ChannelRequest) {
    this.db.prepare('UPDATE workbench_channel_event SET request=? WHERE id=? AND resolved=0')
      .run(JSON.stringify(request), request.trigger.id);
  }

  redactPending(id: string, ticket?: string) {
    const row = this.getPending(id);
    if (!row) return;
    this.updatePending({ ...row.request, request: '', trigger: { ...row.request.trigger, text: '' } });
    this.settle(id, ticket);
  }

  history(ticket: string) {
    return this.db.prepare('SELECT * FROM workbench_channel_event WHERE ticket=? ORDER BY rowid').all(ticket).map(row => this.read(row));
  }

  recent(ticket: string, project: string) {
    return this.db.prepare('SELECT * FROM workbench_channel_event WHERE ticket=? AND project=? ORDER BY rowid DESC LIMIT 12')
      .all(ticket, project).reverse().map(row => this.read(row));
  }

  archive(id: string, topic?: string) {
    this.db.prepare('INSERT INTO workbench_channel_archive VALUES (?,?)').run(id, topic ?? null);
    this.settle(id);
  }

  archived(project: string) {
    return this.db.prepare(`SELECT event.*, archive.topic FROM workbench_channel_archive archive
      JOIN workbench_channel_event event ON event.id=archive.event WHERE event.project=? ORDER BY archive.rowid DESC LIMIT 100`)
      .all(project).map(row => ({ ...this.read(row), topic: typeof row.topic === 'string' ? row.topic : undefined }));
  }

  settle(id: string, ticket?: string) {
    this.db.prepare('UPDATE workbench_channel_event SET resolved=1,ticket=? WHERE id=? AND resolved=0')
      .run(ticket ?? null, id);
  }
}
