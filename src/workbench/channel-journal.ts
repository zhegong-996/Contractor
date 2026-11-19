import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runtime } from '../config.ts';

const retentionMs = 3 * 86_400_000;

export function channelJournalFile() { return runtime('feishu-ingress', 'inbox.sqlite'); }

export function openChannelJournal() {
  // Keep the existing Feishu spool path so a deployment can resume old callbacks.
  const directory = runtime('feishu-ingress');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077))
    throw new Error('渠道日志目录须为当前服务用户独享。');
  const file = channelJournalFile();
  const existing = lstatSync(file, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.uid !== process.getuid?.() || existing.nlink !== 1))
    throw new Error('渠道日志须为当前服务用户的普通文件。');
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`PRAGMA busy_timeout=1500; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS ingress_lease (
      app TEXT PRIMARY KEY, owner TEXT NOT NULL, beat INTEGER NOT NULL, status TEXT
    );
    CREATE TABLE IF NOT EXISTS ingress_event (
      sequence INTEGER PRIMARY KEY, app TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
      lane TEXT NOT NULL, line TEXT NOT NULL, received INTEGER NOT NULL, due INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      UNIQUE(app, id)
    );
    CREATE INDEX IF NOT EXISTS ingress_event_lane ON ingress_event(app, lane, sequence);
    CREATE TABLE IF NOT EXISTS ingress_ack (
      app TEXT NOT NULL, id TEXT NOT NULL, acknowledged INTEGER NOT NULL, PRIMARY KEY(app,id)
    );
    CREATE TABLE IF NOT EXISTS ingress_reply_route (
      app TEXT NOT NULL, id TEXT NOT NULL, endpoint TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(app,id)
    );
    CREATE TABLE IF NOT EXISTS channel_delivery (
      id TEXT PRIMARY KEY, connector TEXT NOT NULL, started_at TEXT NOT NULL, acknowledged_at TEXT,
      form TEXT, uncertain_at TEXT, reference TEXT
    );`);
  return db;
}

type Pending<Kind extends string> = { id: string; kind: Kind; line: string; attempts: number };
export function channelInbox<Kind extends string>(db: DatabaseSync, namespace: string) {
  return {
    put(kind: Kind, lane: string, line: string, now: number, id?: string, lease?: { owner: string; activeSince: number }) {
      id ??= createHash('sha256').update(kind).update('\0').update(line).digest('hex');
      return db.prepare(`INSERT OR IGNORE INTO ingress_event(app,id,kind,lane,line,received,due) SELECT ?,?,?,?,?,?,?
        WHERE NOT EXISTS (SELECT 1 FROM ingress_ack WHERE app=? AND id=?)
        ${lease ? 'AND EXISTS (SELECT 1 FROM ingress_lease WHERE app=? AND owner=? AND beat>?)' : ''}`)
        .run(namespace, id, kind, lane, line, now, now, namespace, id,
          ...(lease ? [namespace, lease.owner, lease.activeSince] : [])).changes === 1;
    },
    pending(now: number) {
      return db.prepare(`SELECT e.id,e.kind,e.line,e.attempts FROM ingress_event e WHERE e.app=? AND e.due<=?
        AND NOT EXISTS (SELECT 1 FROM ingress_event p WHERE p.app=e.app AND p.lane=e.lane AND p.sequence<e.sequence)
        ORDER BY e.sequence LIMIT 25`).all(namespace, now) as Pending<Kind>[];
    },
    acknowledge(id: string) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT OR IGNORE INTO ingress_ack SELECT app,id,? FROM ingress_event WHERE app=? AND id=?')
          .run(Date.now(), namespace, id);
        db.prepare('DELETE FROM ingress_event WHERE app=? AND id=?').run(namespace, id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    retry(event: Pending<Kind>, now: number) {
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(event.attempts, 5));
      db.prepare('UPDATE ingress_event SET attempts=attempts+1,due=? WHERE app=? AND id=?').run(now + delay, namespace, event.id);
    },
    prune(now: number) {
      db.prepare('DELETE FROM ingress_reply_route WHERE app=? AND expires<=?').run(namespace, now);
      return db.prepare('DELETE FROM ingress_ack WHERE app=? AND acknowledged<?').run(namespace, now - retentionMs).changes;
    },
    backlog(now: number) {
      const row = db.prepare(`SELECT COUNT(*) AS pending, COUNT(*) FILTER(WHERE received<?) AS overdue,
        MIN(received) AS oldest FROM ingress_event WHERE app=?`).get(now - retentionMs, namespace)!;
      return { pending: Number(row.pending), overdue: Number(row.overdue), oldest: row.oldest as number | null };
    },
    close() { db.close(); },
  };
}

export function drainChannelInbox<Kind extends string>(inbox: Omit<ReturnType<typeof channelInbox<Kind>>, 'put'>, handlers: {
  deliver(kind: Kind, value: string): Promise<void>;
  retryable(error: unknown): boolean;
  log(error: unknown): void;
  update?(): void;
}) {
  let closing = false;
  let active: Promise<void> | undefined;
  let nextPrune = 0;
  async function process() {
    handlers.update?.();
    const now = Date.now();
    if (now >= nextPrune) {
      inbox.prune(now);
      nextPrune = now + 60_000;
    }
    for (const event of inbox.pending(now)) {
      if (closing) break;
      try { await handlers.deliver(event.kind, event.line); }
      catch (error) {
        if (handlers.retryable(error)) {
          inbox.retry(event, Date.now());
          handlers.log(error);
          continue;
        }
      }
      inbox.acknowledge(event.id);
    }
  }
  function poll() {
    if (!closing && !active) active = process().catch(handlers.log).finally(() => { active = undefined; });
  }
  const timer = setInterval(poll, 1000);
  timer.unref();
  poll();
  return { poll, backlog: () => inbox.backlog(Date.now()), async close() {
    closing = true;
    clearInterval(timer);
    await active;
    inbox.close();
  } };
}
