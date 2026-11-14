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
  sources: string[];
};
type Request = { id: string; ticket: string; entry: string; revision: string; requestedBy: string; reason: string; state: string };

export class ProjectKnowledge {
  constructor(private readonly store: SuperAgentStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_knowledge (id TEXT PRIMARY KEY, project TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workbench_access (
        id TEXT PRIMARY KEY, ticket TEXT NOT NULL, entry TEXT NOT NULL, revision TEXT NOT NULL,
        requester TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL, expires INTEGER,
        UNIQUE(ticket,entry,revision)
      );
    `);
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

  request(ticket: string, entry: Entry, actor: string, reason: string) {
    this.store.db.prepare(`INSERT INTO workbench_access VALUES (?,?,?,?,?,?,'requested',NULL)
      ON CONFLICT(ticket,entry,revision) DO UPDATE SET state='requested',reason=excluded.reason,expires=NULL
      WHERE state='revoked' OR (state='granted' AND expires<=?)`)
      .run(randomUUID(), ticket, entry.id, entry.revision, actor, reason, Date.now());
  }

  requests(ticket: string): Request[] {
    return this.store.db.prepare(`SELECT id,ticket,entry,revision,requester AS requestedBy,reason,
      CASE WHEN state='granted' AND expires<=? THEN 'expired' ELSE state END AS state
      FROM workbench_access WHERE ticket=? ORDER BY rowid`).all(Date.now(), ticket) as unknown as Request[];
  }

  change(request: Request, state: 'granted' | 'revoked') {
    const from = state === 'granted' ? 'requested' : 'granted';
    if (request.state !== from) throw new Error('资料申请状态已变化。');
    this.store.db.prepare('UPDATE workbench_access SET state=?, expires=? WHERE id=? AND state=?')
      .run(state, state === 'granted' ? Date.now() + 8 * 3600_000 : null, request.id, from);
  }

  usable(ticket: string, entry: Entry): boolean {
    return entry.state === 'published' && (entry.visibility === 'project'
      || this.requests(ticket).some(r => r.entry === entry.id && r.revision === entry.revision && r.state === 'granted'));
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
