import { channelInbox, drainChannelInbox, openChannelJournal } from './channel-journal.ts';
import type { watchFeishu } from './feishu-events.ts';

type Subscription = ReturnType<ReturnType<typeof watchFeishu>['status']>;
type Status = { messages: Subscription; cards?: Subscription };
type Kind = 'message' | 'card';
const leaseMs = 15_000;

export function openFeishuInbox(appId: string) {
  const db = openChannelJournal();
  const inbox = channelInbox<Kind>(db, appId);
  return {
    ...inbox,
    claim(owner: string, now: number) {
      return db.prepare(`INSERT INTO ingress_lease(app,owner,beat) VALUES (?,?,?)
        ON CONFLICT(app) DO UPDATE SET owner=excluded.owner,beat=excluded.beat,status=NULL
        WHERE ingress_lease.beat <= ? OR (excluded.owner LIKE 'workbench:%' AND ingress_lease.owner LIKE 'workbench:%')`)
        .run(appId, owner, now, now - leaseMs).changes === 1;
    },
    pulse(owner: string, now: number, status: Status) {
      return db.prepare('UPDATE ingress_lease SET beat=?, status=? WHERE app=? AND owner=?')
        .run(now, JSON.stringify(status), appId, owner).changes === 1;
    },
    release(owner: string) { db.prepare('DELETE FROM ingress_lease WHERE app=? AND owner=?').run(appId, owner); },
    status(now: number) {
      const row = db.prepare('SELECT owner,status FROM ingress_lease WHERE app=? AND beat>?').get(appId, now - leaseMs);
      if (!row?.status) return;
      return { owner: String(row.owner), ...JSON.parse(String(row.status)) as Status };
    },
    put(owner: string, kind: Kind, lane: string, line: string, now: number, id?: string) {
      return inbox.put(kind, lane, line, now, id, { owner, activeSince: now - leaseMs });
    },
  };
}

export function pullFeishuInbox(inbox: ReturnType<typeof openFeishuInbox>, handlers: {
  message: (line: string) => Promise<void>;
  card: (line: string) => Promise<void>;
  ready: () => void;
  retryable: (error: unknown) => boolean;
  log: (error: unknown) => void;
}) {
  let status: ReturnType<typeof inbox.status>;
  let generation: string | undefined;
  return { ...drainChannelInbox<Kind>(inbox, {
    deliver: (kind, line) => handlers[kind](line), retryable: handlers.retryable, log: handlers.log,
    update() {
      status = inbox.status(Date.now());
      if (status?.messages.state !== 'ready' || status.messages.busHealth === 'unavailable') return;
      const connected = [status.owner, status.messages.attempt, status.messages.lostEvents].join(':');
      if (generation === connected) return;
      generation = connected;
      handlers.ready();
    },
  }), messages: () => status?.messages ?? { state: 'stopped' as const }, cards: () => status?.cards };
}
