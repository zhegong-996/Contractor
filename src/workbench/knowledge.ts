import { createHash, randomUUID } from 'node:crypto';
import { recallMemory, replayMemory } from '../memory-projections.ts';
import type { MemoryEvent } from '../architecture-contracts.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type KnowledgeRef = { id: string; revision: string };
export type KnowledgeDirectory = 'requestable' | 'hidden';
export type SourceVersion = {
  resource: string; path?: string; authority: string; revision: string; fingerprint: string; url: string;
};
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
  draft?: { run: number; version: number; cards: number[]; needsReview: boolean };
  reviewed?: { by: string; at: string };
  source?: SourceVersion;
  replaces?: KnowledgeRef;
  published?: { by: string; at: string };
  retirement?: { kind: 'superseded' | 'invalidated'; by: string; at: string; reason?: string; replacement?: KnowledgeRef };
};
export type AccessReader = { agent: string; owner: string };
export type KnowledgeGrantState = 'requested' | 'granted' | 'revoked' | 'expired';
type Request = { id: string; ticket: string; entry: string; revision: string; requestedBy: string; reason: string; state: KnowledgeGrantState;
  readerAgent: string; readerOwner: string; generation: number; purpose: 'execute' | 'review'; output: string };

export class ProjectKnowledge {
  constructor(private readonly store: SuperAgentStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_knowledge (id TEXT PRIMARY KEY, project TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workbench_knowledge_revision (
        entry TEXT NOT NULL, revision TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(entry,revision)
      );
      CREATE TABLE IF NOT EXISTS workbench_knowledge_directory (
        entry TEXT PRIMARY KEY, visibility TEXT NOT NULL CHECK(visibility IN ('requestable','hidden'))
      );
      CREATE TABLE IF NOT EXISTS workbench_knowledge_access_policy (
        project TEXT PRIMARY KEY, hours INTEGER NOT NULL CHECK(hours BETWEEN 1 AND 168)
      );
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
    if (!store.db.prepare('PRAGMA table_info(workbench_access)').all().some(column => column.name === 'purpose')) {
      store.atomic(() => store.db.exec("ALTER TABLE workbench_access ADD COLUMN purpose TEXT NOT NULL DEFAULT 'execute'; ALTER TABLE workbench_access ADD COLUMN output TEXT NOT NULL DEFAULT ''"));
    }
  }

  get(id: string, revision?: string): Entry | undefined {
    const row = this.store.db.prepare('SELECT value FROM workbench_knowledge WHERE id=?').get(id);
    const entry: Entry | undefined = row && JSON.parse(String(row.value));
    return entry && (revision === undefined || entry.revision === revision) ? entry : undefined;
  }

  /** Published versions have immutable content and IDs. Retirement changes selection, not snapshots. */
  current(id: string): Entry | undefined {
    let next: KnowledgeRef | undefined = undefined;
    const visited = new Set<string>();
    for (;;) {
      const entry: Entry | undefined = next ? this.get(next.id, next.revision) : this.get(id);
      if (!entry || entry.state !== 'published' || visited.has(entry.id)) return;
      if (!entry.retirement) return entry;
      visited.add(entry.id);
      next = entry.retirement.replacement;
      if (!next) return;
    }
  }

  save(input: Omit<Entry, 'id' | 'revision'>, id: string = randomUUID()): Entry {
    const value = { ...input, id, revision: digest({ ...input, id }) };
    this.store.db.prepare('INSERT OR IGNORE INTO workbench_knowledge VALUES (?,?,?)').run(id, value.project, JSON.stringify(value));
    const stored = this.get(id)!;
    this.keepRevision(stored);
    return stored;
  }

  list(project: string): Entry[] {
    return this.store.db.prepare('SELECT value FROM workbench_knowledge WHERE project=? ORDER BY rowid DESC')
      .all(project).map(row => JSON.parse(String(row.value)));
  }

  private directoryRoot(entry: Entry): Entry {
    const seen = new Set([entry.id]);
    while (entry.replaces) {
      const prior = this.get(entry.replaces.id, entry.replaces.revision);
      if (!prior || seen.has(prior.id) || prior.owner !== entry.owner || prior.project !== entry.project) break;
      seen.add(prior.id);
      entry = prior;
    }
    return entry;
  }

  directory(entry: Entry): KnowledgeDirectory {
    const root = this.directoryRoot(entry);
    const row = this.store.db.prepare('SELECT visibility FROM workbench_knowledge_directory WHERE entry=?').get(root.id);
    if (row) return row.visibility as KnowledgeDirectory;
    return root.ticket ? 'hidden' : 'requestable';
  }

  setDirectory(entry: Entry, visibility: KnowledgeDirectory) {
    this.store.db.prepare(`INSERT INTO workbench_knowledge_directory VALUES (?,?)
      ON CONFLICT(entry) DO UPDATE SET visibility=excluded.visibility`).run(this.directoryRoot(entry).id, visibility);
  }

  accessHours(project: string): number {
    return Number(this.store.db.prepare('SELECT hours FROM workbench_knowledge_access_policy WHERE project=?').get(project)?.hours ?? 8);
  }

  setAccessHours(project: string, hours: number) {
    this.store.db.prepare(`INSERT INTO workbench_knowledge_access_policy VALUES (?,?)
      ON CONFLICT(project) DO UPDATE SET hours=excluded.hours`).run(project, hours);
  }

  publish(entry: Entry, revision: string, actor = entry.owner, previous?: Entry) {
    if (entry.state !== 'candidate' || entry.revision !== revision) throw new Error('知识候选已更新，请重新核对。');
    if (entry.draft?.needsReview || !entry.conditions.trim()) throw new Error('采用前请核对结论并补充适用条件。');
    const published = { by: actor, at: new Date().toISOString() };
    this.store.db.prepare('UPDATE workbench_knowledge SET value=? WHERE id=?')
      .run(JSON.stringify({ ...entry, state: 'published', published,
        ...(previous ? { replaces: { id: previous.id, revision: previous.revision } } : {}) }), entry.id);
    if (previous) this.retire(previous, { kind: 'superseded', ...published, replacement: { id: entry.id, revision } });
  }

  retire(entry: Entry, retirement: NonNullable<Entry['retirement']>) {
    this.store.db.prepare('UPDATE workbench_knowledge SET value=? WHERE id=?').run(JSON.stringify({ ...entry, retirement }), entry.id);
  }

  sourceHead(project: string, source: Pick<SourceVersion, 'resource' | 'path' | 'authority'>) {
    const row = this.store.db.prepare(`SELECT value FROM workbench_knowledge WHERE project=?
      AND json_extract(value,'$.state')='published' AND json_extract(value,'$.retirement.replacement') IS NULL
      AND json_extract(value,'$.source.resource')=? AND COALESCE(json_extract(value,'$.source.path'),'')=?
      AND json_extract(value,'$.source.authority')=? ORDER BY rowid DESC LIMIT 1`)
      .get(project, source.resource, source.path ?? '', source.authority);
    return row ? JSON.parse(String(row.value)) as Entry : undefined;
  }

  hasSource(project: string, resource: string) {
    return !!this.store.db.prepare("SELECT 1 FROM workbench_knowledge WHERE project=? AND json_extract(value,'$.source.resource')=? LIMIT 1")
      .get(project, resource);
  }

  private keepRevision(entry: Entry) {
    this.store.db.prepare('INSERT OR IGNORE INTO workbench_knowledge_revision VALUES (?,?,?)')
      .run(entry.id, entry.revision, JSON.stringify(entry));
  }

  review(entry: Entry, revision: string, body: string, conditions: string, actor: string, title = entry.title): Entry {
    if (entry.state !== 'candidate' || entry.revision !== revision) throw new Error('知识候选已更新，请重新核对。');
    if (!body.trim() || !conditions.trim()) throw new Error('请确认结论并填写适用条件。');
    const { revision: _old, ...previous } = entry;
    const input = { ...previous, title, body, conditions, reviewed: { by: actor, at: new Date().toISOString() },
      ...(entry.draft ? { draft: { ...entry.draft, needsReview: false } } : {}) };
    const value = { ...input, revision: digest(input) };
    this.store.atomic(() => {
      const changed = this.store.db.prepare(`UPDATE workbench_knowledge SET value=? WHERE id=? AND json_extract(value,'$.revision')=?
        AND json_extract(value,'$.state')='candidate'`).run(JSON.stringify(value), entry.id, revision);
      if (!changed.changes) throw new Error('知识候选已更新，请重新核对。');
      this.keepRevision(entry);
      this.keepRevision(value);
    });
    return value;
  }

  request(ticket: string, entry: Entry, actor: string, reason: string, reader: AccessReader, review = ''): Request {
    if (!reader.agent || !reader.owner) throw new Error('资料申请需要明确读取 Agent 及其所有者。');
    return this.store.atomic(() => {
      const all = this.requests(ticket).filter(r => r.entry === entry.id && r.revision === entry.revision
        && r.readerAgent === reader.agent && r.readerOwner === reader.owner);
      const previous = all.filter(r => r.output === review && r.purpose === (review ? 'review' : 'execute')).at(-1);
      if (previous && ['requested', 'granted'].includes(previous.state)) return previous;
      const id = randomUUID();
      this.store.db.prepare(`INSERT INTO workbench_access VALUES (?,?,?,?,?,?,'requested',NULL,?,?,?,?,?)`)
        .run(id, ticket, entry.id, entry.revision, actor, reason, reader.agent, reader.owner, (all.at(-1)?.generation ?? 0) + 1,
          review ? 'review' : 'execute', review);
      return this.requests(ticket).find(r => r.id === id)!;
    });
  }

  requests(ticket: string): Request[] {
    return this.store.db.prepare(`SELECT id,ticket,entry,revision,requester AS requestedBy,reason,
      reader_agent AS readerAgent,reader_owner AS readerOwner,generation,purpose,output,
      CASE WHEN state='granted' AND expires<=? THEN 'expired' ELSE state END AS state
      FROM workbench_access WHERE ticket=? ORDER BY rowid`).all(Date.now(), ticket) as unknown as Request[];
  }

  change(request: Request, state: 'granted' | 'revoked', hours = 8) {
    const from = state === 'granted' ? 'requested' : 'granted';
    if (request.state !== from) throw new Error('资料申请状态已变化。');
    const changed = this.store.db.prepare('UPDATE workbench_access SET state=?, expires=? WHERE id=? AND state=?')
      .run(state, state === 'granted' ? Date.now() + hours * 3600_000 : null, request.id, from);
    if (!changed.changes) throw new Error('资料申请状态已变化。');
  }

  revokeProjectParticipant(project: string, member: string) {
    return this.store.db.prepare(`UPDATE workbench_access SET state='revoked', expires=NULL
      WHERE state IN ('requested','granted') AND entry IN (
        SELECT id FROM workbench_knowledge WHERE project=?
      ) AND (reader_owner=? OR requester=? OR entry IN (
        SELECT id FROM workbench_knowledge WHERE project=? AND json_extract(value,'$.owner')=?
      )) RETURNING id,ticket`).all(project, member, member, project, member)
      .map(row => ({ id: String(row.id), ticket: String(row.ticket) }));
  }

  ownedRequests(project: string, owner: string) {
    return this.store.db.prepare(`SELECT a.id,a.ticket,a.entry,a.revision,a.reader_agent AS readerAgent,
      a.reader_owner AS readerOwner,a.requester AS requestedBy,a.purpose,a.expires,
      CASE WHEN a.state='granted' AND a.expires<=? THEN 'expired' ELSE a.state END AS state,
      json_extract(k.value,'$.title') AS title
      FROM workbench_access a JOIN workbench_knowledge k ON k.id=a.entry
      WHERE k.project=? AND json_extract(k.value,'$.owner')=? ORDER BY a.rowid DESC`)
      .all(Date.now(), project, owner) as { id: string; ticket: string; entry: string; revision: string; readerAgent: string;
        readerOwner: string; requestedBy: string; purpose: 'review' | 'execute'; expires: number | null; state: Request['state']; title: string }[];
  }

  granted(ticket: string, entry: Entry, reader?: AccessReader, review = ''): Request | undefined {
    return reader && this.requests(ticket).find(r => r.entry === entry.id && r.revision === entry.revision && r.state === 'granted'
      && r.readerAgent === reader.agent && r.readerOwner === reader.owner && r.output === review && r.purpose === (review ? 'review' : 'execute'));
  }

  usable(ticket: string, entry: Entry, reader?: AccessReader, request?: string, review = ''): boolean {
    return entry.state === 'published' && (entry.visibility === 'project'
      || !!this.granted(ticket, entry, reader, review) && (!request || this.granted(ticket, entry, reader, review)?.id === request));
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
