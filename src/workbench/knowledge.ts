import { createHash, randomUUID } from 'node:crypto';
import { recallMemory, replayMemory } from '../memory-projections.ts';
import type { MemoryEvent } from '../architecture-contracts.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Entry = {
  id: string;
  project: string;
  owner: string;
  title: string;
  kind: string;
  body: string;
  conditions: string;
  revision: string;
  visibility: 'project' | 'restricted';
  state: 'candidate' | 'published';
  ticket?: string;
  observation?: string;
  sources: string[];
};
export type AccessReader = { agent: string; owner: string };
type Request = { id: string; ticket: string; entry: string; revision: string; requestedBy: string; reason: string; state: string;
  readerAgent: string; readerOwner: string; generation: number };

export class ProjectKnowledge {
  constructor(private readonly store: SuperAgentStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_knowledge (id TEXT PRIMARY KEY, project TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workbench_access (
        id TEXT PRIMARY KEY, ticket TEXT NOT NULL, entry TEXT NOT NULL, revision TEXT NOT NULL,
        requester TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL, expires INTEGER,
        reader_agent TEXT NOT NULL, reader_owner TEXT NOT NULL, generation INTEGER NOT NULL,
        UNIQUE(ticket,entry,revision,reader_agent,reader_owner,generation)
      );
    `);
    if (!store.db.prepare('PRAGMA table_info(workbench_access)').all().some(column => column.name === 'reader_agent')) {
      store.atomic(() => {
        store.db.exec(`
          ALTER TABLE workbench_access RENAME TO workbench_access_unscoped;
          CREATE TABLE workbench_access (
            id TEXT PRIMARY KEY, ticket TEXT NOT NULL, entry TEXT NOT NULL, revision TEXT NOT NULL,
            requester TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL, expires INTEGER,
            reader_agent TEXT NOT NULL, reader_owner TEXT NOT NULL, generation INTEGER NOT NULL,
            UNIQUE(ticket,entry,revision,reader_agent,reader_owner,generation)
          );
          INSERT INTO workbench_access SELECT *, '', '', 1 FROM workbench_access_unscoped;
          DROP TABLE workbench_access_unscoped;
        `);
      });
    }
  }

  get(id: string): Entry | undefined {
    const row = this.store.db.prepare('SELECT value FROM workbench_knowledge WHERE id=?').get(id);
    return row && JSON.parse(String(row.value));
  }

  save(input: Omit<Entry, 'id' | 'revision'>, id: string = randomUUID()): Entry {
    const value = { ...input, id, revision: digest({ ...input, id }) };
    this.store.db.prepare('INSERT OR IGNORE INTO workbench_knowledge VALUES (?,?,?)').run(id, value.project, JSON.stringify(value));
    return this.get(id)!;
  }

  list(project: string): Entry[] {
    return this.store.db.prepare('SELECT value FROM workbench_knowledge WHERE project=? ORDER BY rowid DESC')
      .all(project).map(row => JSON.parse(String(row.value)));
  }

  publish(entry: Entry, revision: string) {
    if (entry.state !== 'candidate' || entry.revision !== revision) throw new Error('知识候选已更新，请重新核对。');
    this.store.db.prepare('UPDATE workbench_knowledge SET value=? WHERE id=?')
      .run(JSON.stringify({ ...entry, state: 'published' }), entry.id);
  }

  request(ticket: string, entry: Entry, actor: string, reason: string, reader: AccessReader): Request {
    if (!reader.agent || !reader.owner) throw new Error('资料申请需要明确读取 Agent 及其所有者。');
    return this.store.atomic(() => {
      const previous = this.requests(ticket).filter(r => r.entry === entry.id && r.revision === entry.revision
        && r.readerAgent === reader.agent && r.readerOwner === reader.owner).at(-1);
      if (previous && ['requested', 'granted'].includes(previous.state)) return previous;
      const id = randomUUID();
      this.store.db.prepare(`INSERT INTO workbench_access VALUES (?,?,?,?,?,?,'requested',NULL,?,?,?)`)
        .run(id, ticket, entry.id, entry.revision, actor, reason, reader.agent, reader.owner, (previous?.generation ?? 0) + 1);
      return this.requests(ticket).find(r => r.id === id)!;
    });
  }

  requests(ticket: string): Request[] {
    return this.store.db.prepare(`SELECT id,ticket,entry,revision,requester AS requestedBy,reason,
      reader_agent AS readerAgent,reader_owner AS readerOwner,generation,
      CASE WHEN state='granted' AND expires<=? THEN 'expired' ELSE state END AS state
      FROM workbench_access WHERE ticket=? ORDER BY rowid`).all(Date.now(), ticket) as unknown as Request[];
  }

  change(request: Request, state: 'granted' | 'revoked') {
    const from = state === 'granted' ? 'requested' : 'granted';
    if (request.state !== from) throw new Error('资料申请状态已变化。');
    const changed = this.store.db.prepare('UPDATE workbench_access SET state=?, expires=? WHERE id=? AND state=?')
      .run(state, state === 'granted' ? Date.now() + 8 * 3600_000 : null, request.id, from);
    if (!changed.changes) throw new Error('资料申请状态已变化。');
  }

  granted(ticket: string, entry: Entry, reader?: AccessReader): Request | undefined {
    return reader && this.requests(ticket).find(r => r.entry === entry.id && r.revision === entry.revision && r.state === 'granted'
      && r.readerAgent === reader.agent && r.readerOwner === reader.owner);
  }

  usable(ticket: string, entry: Entry, reader?: AccessReader, request?: string): boolean {
    return entry.state === 'published' && (entry.visibility === 'project'
      || !!this.granted(ticket, entry, reader) && (!request || this.granted(ticket, entry, reader)?.id === request));
  }

  search(entries: Entry[], query: string, principal: string): Entry[] {
    if (!query) return entries;
    const events: MemoryEvent[] = entries.map(entry => ({
      id: entry.id, kind: 'memory-indexed', actor: entry.owner, at: '2000-01-01T00:00:00.000Z',
      sourceRef: { sourceId: entry.id, revision: entry.revision },
      visibility: 'space',
      payload: { chunkTexts: [{ id: entry.id, text: [entry.title, entry.conditions, entry.body].join('\n') }] },
    }));
    const hits = recallMemory(replayMemory(events), query, { principal, visibility: 'space', limit: 30 }).hits;
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    return hits.flatMap(hit => byId.get(hit.sourceId) ?? []);
  }
}

export type KnowledgeEntry = Entry;
