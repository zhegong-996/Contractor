import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Trigger } from '../../upstream/superagent/src/core/index.ts';

export type Provider = 'feishu' | 'github';
export type PlatformActor = { provider: Provider; namespace: string; id: string; label: string };
export type ChannelRef = { key: string; url?: string; label: string };
export type ChannelRequest = {
  trigger: Trigger;
  sender: PlatformActor;
  origin: ChannelRef;
  project: string;
  agent: string;
  request: string;
  note?: boolean;
  topic?: string;
};

type Binding = {
  provider: Provider; namespace: string; id: string; label: string; member: string; verifiedAt: string;
};
type Proof = {
  member: string; provider: Provider; expires: number; sender: string | null; url: string | null;
};
export type PendingRequest = {
  id: string; member: string; request: ChannelRequest; reason: string;
};

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function feishuCommandText(content: string, mention?: { key?: string; name?: string }) {
  const text = content.trim();
  const prefix = [mention?.key, mention?.name ? '@' + mention.name : undefined]
    .find(value => value && text.startsWith(value) && /^\s/.test(text.slice(value.length)));
  return prefix ? text.slice(prefix.length).trimStart() : text;
}

export function channelCommand(text: string) {
  const proof = /^\/绑定协作\s+([a-f0-9]{32})$/.exec(text.trim());
  if (proof) return { kind: 'proof' as const, code: proof[1]! };
  const work = /^\/协作\s+([a-z][a-z0-9-]{0,47})(?:\s+\[([^\]\r\n]{1,350})\])?\s+([\s\S]+)$/.exec(text.trim());
  if (work && work[3]!.trim().length <= 3500)
    return { kind: 'work' as const, agent: work[1]!, reference: work[2]?.trim(), request: work[3]!.trim() };
}

/** SuitMe mappings share the native Store transaction with Engine ticket creation. */
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
    const existing = this.member(sender);
    if (existing && existing !== member) return 'conflict';
    this.db.prepare(`INSERT INTO workbench_account_link VALUES (?,?,?,?,?,?)
      ON CONFLICT(provider,namespace,id) DO UPDATE SET label=excluded.label`)
      .run(provider, sender.namespace, sender.id, sender.label, member, new Date().toISOString());
    this.db.prepare('DELETE FROM workbench_account_proof WHERE member=? AND provider=?').run(member, provider);
    return 'bound';
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

  private read(row: Record<string, unknown>): PendingRequest {
    return { id: String(row.id), member: String(row.member), request: JSON.parse(String(row.request)), reason: String(row.reason ?? '') };
  }

  pending(project: string) {
    return this.db.prepare('SELECT * FROM workbench_channel_event WHERE project=? AND resolved=0 ORDER BY rowid')
      .all(project).map(row => this.read(row));
  }

  getPending(id: string) {
    const row = this.db.prepare('SELECT * FROM workbench_channel_event WHERE id=? AND resolved=0').get(id);
    return row && this.read(row);
  }

  history(ticket: string) {
    return this.db.prepare('SELECT * FROM workbench_channel_event WHERE ticket=? ORDER BY rowid').all(ticket).map(row => this.read(row));
  }

  settle(id: string, ticket?: string) {
    this.db.prepare('UPDATE workbench_channel_event SET resolved=1,ticket=? WHERE id=? AND resolved=0')
      .run(ticket ?? null, id);
  }
}
