import { chmodSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { credential, digest } from '../../../upstream/autoloop/kernel/credentials.ts';
import { keyOf, View, type Change, type Table } from '../../../upstream/autoloop/kernel/evolve.ts';
import { commit } from '../../../upstream/autoloop/kernel/store.ts';
import { digestAgentId, discussionRule } from '../discussion.ts';
import { executionSource, ruleName } from './contract.ts';
import { openScheduler } from './scheduler.ts';

const tables = ['runs', 'events', 'run_events', 'cards', 'timers', 'schedules'] as const;
type LedgerTable = typeof tables[number];
type Row = Record<string, SQLInputValue>;
const transferableStates = new Set(['queued', 'done', 'nothing', 'failed', 'cancelled']);

export function checkTransferBoundary(db: DatabaseSync) {
  for (const run of db.prepare('SELECT state,attempts,cancel_at,rule FROM runs').iterate()) {
    if (!transferableStates.has(String(run.state)) || run.cancel_at && run.state === 'queued')
      throw new Error('有活动或未确认停止的租约。先让原调度器接回并结清。');
    if (run.state === 'queued' && run.attempts !== 0)
      throw new Error('有等待重试的尝试。先在原调度器结清或停止。');
    if (run.state === 'queued' && String(run.rule).startsWith(discussionRule('')))
      throw new Error('有尚未处理的群整理运行。先在原调度器结清。');
  }
  if (db.prepare('SELECT 1 FROM timers WHERE event_id IS NULL LIMIT 1').get())
    throw new Error('有尚未触发的复查定时器。先在原调度器处理或取消。');
}

const select = (db: DatabaseSync, table: LedgerTable) => db.prepare(`SELECT * FROM ${table}`).all() as Row[];

function projection(db: DatabaseSync) {
  const meta = db.prepare('SELECT seq,next,format FROM projection_meta WHERE id=1').get();
  const tail = db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM facts').get()!;
  if (!meta || meta.seq !== tail.seq) throw new Error('AutoLoop 事实日志和投影位置不一致。请先在原运行时核查。');
  return { seq: Number(meta.seq), next: JSON.parse(String(meta.next)) as Record<string, number>, format: String(meta.format) };
}

function insertRows(db: DatabaseSync, table: LedgerTable, fields: string, records: Row[]) {
  const columns = fields.split(' ');
  const insert = db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
  for (const row of records) insert.run(...columns.map(key => row[key] ?? null));
}

const runColumns = 'id lane rule state attempts not_before claimed_at finished_at session usage summary cancel_at seen_at';
const cardColumns = 'id lane rule run_id kind title text options state about choice answer by decided_at created_at answer_event';

export function importAutoLoop(from: DatabaseSync, filename: string, secret: string) {
  const meta = projection(from);
  const opened = openScheduler(filename, []);
  opened.hub.close();
  chmodSync(filename, 0o600);
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    const projectedRun = from.prepare("SELECT data FROM projections WHERE collection='runs' AND key=?");
    const runRows = select(from, 'runs').map(row => {
      const raw = projectedRun.get(String(row.id));
      const state = JSON.parse(String(raw?.data)) as Row;
      return {
        ...row, session: row.session ?? row.resume, summary: row.summary ?? row.error,
        last_issued: state.last_issued, last_answer: state.last_answer,
        last_token_hash: state.last_issued == null ? null : digest(credential({ secret, publicUrl: '' }, 'run', row.id, state.last_issued)),
      };
    });
    insertRows(db, 'runs', runColumns + ' last_issued last_token_hash last_result last_answer', runRows);
    const eventRows = from.prepare("SELECT data FROM projections WHERE collection='events'").all()
      .map(item => JSON.parse(String(item.data)) as Row);
    insertRows(db, 'events', 'id source event_key body received_at routes', eventRows.map(row => ({
      id: row.id, source: row.source, event_key: row.key, received_at: row.received_at, routes: row.routed,
      body: JSON.stringify({ id: row.key, type: row.type, subject: row.subject, summary: row.summary, detail: row.detail, link: row.link, hops: row.hops ?? 0 }),
    })));
    insertRows(db, 'run_events', 'run_id event_id', select(from, 'run_events'));
    const cards = select(from, 'cards').filter(row => row.run_id != null);
    insertRows(db, 'cards', cardColumns + ' local_key', cards.map(row => ({
      ...row, local_key: String(row.key).startsWith(`thread:${row.rule}:${row.lane}:`)
        ? String(row.key).slice(`thread:${row.rule}:${row.lane}:`.length) : null,
    })));
    insertRows(db, 'timers', 'id rule lane key about at event_id', select(from, 'timers'));
    insertRows(db, 'schedules', 'rule cron next_at', select(from, 'schedules'));
    const sequence = db.prepare('INSERT INTO sqlite_sequence(name,seq) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=?)');
    for (const table of ['runs', 'cards', 'timers']) {
      const floor = meta.next[table] ?? 0;
      sequence.run(table, floor, table);
      db.prepare('UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name=?').run(floor, table);
    }
    db.prepare('UPDATE lease_sequence SET value=? WHERE id=1').run(meta.seq);
    db.exec('COMMIT');
  } finally { db.close(); }
}

function configuredAgent(rule: string) {
  const taskPrefix = ruleName('');
  if (rule.startsWith(taskPrefix)) return rule.slice(taskPrefix.length);
  const digestPrefix = discussionRule('');
  if (rule.startsWith(digestPrefix)) return digestAgentId(rule.slice(digestPrefix.length));
  throw new Error('存在工作台以外的 AutoLoop 规则，无法核对归属。');
}

/** Append to the original AutoLoop facts. A rebuild sees the same IDs and new native work. */
export function restoreAutoLoop(from: DatabaseSync, archivedFile: string, keyFile: string) {
  const db = new DatabaseSync(archivedFile);
  const secret = readFileSync(keyFile, 'utf8').trim();
  db.function('card_hash', { deterministic: true }, (id, at) => digest(credential({ secret, publicUrl: '' }, 'card', id, at)));
  try {
    const meta = projection(db);
    const view = new View(db, meta.seq, meta.next, meta.format);
    const changes: Change[] = [];
    function keep(table: Table, row: Row) {
      const key = keyOf(table, row);
      const old = view.get(table, key);
      const next = { ...old, ...row };
      if (Object.keys(row).some(field => next[field] !== old?.[field])) changes.push({ table, key, row: next });
    }

    for (const row of select(from, 'events')) {
      const { id, event_key: key, source, routes, received_at } = row;
      if (view.get('events', String(id))) continue; // The original AutoLoop fact preserves its extra fields.
      const body = JSON.parse(String(row.body)) as Row;
      keep('events', { ...body, id, key, source, routed: routes, received_at });
    }
    for (const row of select(from, 'runs')) {
      const old = view.get('runs', String(row.id));
      const agent = old?.agent ?? configuredAgent(String(row.rule));
      const retainsAcknowledgement = old?.last_result === row.last_result && old?.last_issued === row.last_issued;
      const fields = Object.fromEntries(runColumns.split(' ').map(key => [key, row[key] ?? null]));
      keep('runs', { ...fields, agent, grp: old?.grp ?? row.rule, created_at: old?.created_at ?? row.claimed_at ?? row.not_before,
        rules_version: old?.rules_version ?? view.get('config', 'rules')!.version,
        link: old?.link ?? null, resume: old?.resume ?? null, claim: null, issued: null,
        last_issued: retainsAcknowledgement ? row.last_issued : null,
        last_result: retainsAcknowledgement ? row.last_result : null, last_answer: retainsAcknowledgement ? row.last_answer : null });
    }
    for (const row of select(from, 'run_events')) keep('run_events', row);
    for (const row of select(from, 'cards')) {
      const old = view.get('cards', String(row.id));
      const fields = Object.fromEntries(cardColumns.split(' ').map(key => [key, row[key] ?? null]));
      const issued = from.prepare('SELECT session,rule FROM runs WHERE id=?').get(row.run_id!);
      keep('cards', { ...fields, key: old?.key ?? `thread:${row.rule}:${row.lane}:${row.local_key ?? `imported-${row.id}`}`,
        grp: old?.grp ?? row.rule, source: old ? old.source : executionSource, agent: old?.agent ?? configuredAgent(String(row.rule)),
        session: old?.session ?? issued?.session ?? null, version: old ? old.version + Number(row.state !== old.state) : 1,
        fyi: old?.fyi ?? 0, quiet: old?.quiet ?? 0,
        closed_at: ['done', 'closed'].includes(String(row.state)) ? old?.closed_at ?? row.decided_at ?? row.created_at : null });
    }
    for (const row of select(from, 'timers')) keep('timers', { ...row, source: view.get('timers', String(row.id))?.source ?? executionSource });
    for (const row of select(from, 'schedules').filter(item => item.next_at)) keep('schedules', row);
    if (changes.length) commit(db, view, () => [{ version: 1, seq: meta.seq + 1, at: Date.now(), type: 'contractor.migration', changes }]);
  } finally { db.close(); }
}
