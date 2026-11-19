import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { executionSource, type Card, type ExecutionHub, type Lease, type Run } from './contract.ts';
import { formerName } from '../compatibility.ts';
import { executionViews } from './views.ts';
import { digestSchedule } from './cron.ts';
import { parseEvent, parseResult, type EventInput, type Job, type Rejected, type Result, type Usage } from './protocol.ts';

export type ExecutionRule = { agent: Job['agent']; rule: Job['rule']; source: string; type: string; cron?: string };
type QueueRow = Run & Lease & { worker: string | null; claim: string | null; token_hash: string | null; last_token_hash: string | null; job: string | null };
type CardRow = Card & { local_key: string | null; about: string; answer_event: number | null };
type TimerRow = { id: number; key: string; about: string; at: string; lane: string; rule: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const iso = (at: number) => new Date(at).toISOString();
const leaseMs = 120_000;
const maxAttempts = 10;

export function openScheduler(file: string, initialRules: ExecutionRule[], clock = () => Date.now()) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lane TEXT NOT NULL, rule TEXT NOT NULL, state TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, not_before TEXT NOT NULL, claimed_at TEXT, finished_at TEXT,
      session TEXT, usage TEXT, summary TEXT, cancel_at TEXT, seen_at TEXT, worker TEXT, claim TEXT,
      issued INTEGER, token_hash TEXT, job TEXT, last_issued INTEGER, last_token_hash TEXT, last_result TEXT, last_answer TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_execution_per_lane ON runs(lane) WHERE state IN ('claimed', 'unknown');
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_per_lane_rule ON runs(lane, rule) WHERE state='queued' AND attempts=0;
    CREATE INDEX IF NOT EXISTS runs_by_state ON runs(state, not_before, id);
    CREATE INDEX IF NOT EXISTS runs_by_lane ON runs(lane, id);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, source TEXT NOT NULL, event_key TEXT NOT NULL, body TEXT NOT NULL,
      received_at TEXT NOT NULL, routes TEXT NOT NULL, UNIQUE(source, event_key)
    );
    CREATE TABLE IF NOT EXISTS run_events (
      run_id INTEGER NOT NULL REFERENCES runs(id), event_id INTEGER NOT NULL REFERENCES events(id), PRIMARY KEY(run_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lane TEXT NOT NULL, rule TEXT NOT NULL, run_id INTEGER NOT NULL REFERENCES runs(id),
      kind TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, options TEXT NOT NULL, state TEXT NOT NULL,
      local_key TEXT, about TEXT NOT NULL DEFAULT '', choice INTEGER, answer TEXT, by TEXT, decided_at TEXT,
      created_at TEXT NOT NULL, answer_event INTEGER REFERENCES events(id), answer_ref TEXT
    );
    CREATE INDEX IF NOT EXISTS cards_by_lane ON cards(lane, kind, state, id);
    CREATE TABLE IF NOT EXISTS timers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lane TEXT NOT NULL, rule TEXT NOT NULL, key TEXT NOT NULL,
      about TEXT NOT NULL, at TEXT NOT NULL, event_id INTEGER REFERENCES events(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_timer ON timers(lane, rule, key) WHERE event_id IS NULL;
    CREATE TABLE IF NOT EXISTS schedules (rule TEXT PRIMARY KEY, cron TEXT NOT NULL, next_at TEXT);
    CREATE TABLE IF NOT EXISTS lease_sequence (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
    INSERT OR IGNORE INTO lease_sequence VALUES (1,0);`);
  const all = <T>(sql: string, args: SQLInputValue[] = []) => db.prepare(sql).all(...args) as T[];
  const one = <T>(sql: string, args: SQLInputValue[] = []) => db.prepare(sql).get(...args) as T | undefined;
  const write = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).run(...args);
  const now = () => iso(clock());
  const views = executionViews({ all, one });
  const rules = new Map<string, ExecutionRule>();
  const agendas = new Map<string, ReturnType<typeof digestSchedule>>();
  const atomic = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const readRun = (id: number) => one<QueueRow>('SELECT * FROM runs WHERE id=?', [id]);
  const readCard = (id: number) => one<CardRow>('SELECT * FROM cards WHERE id=?', [id]);
  function register(rule: ExecutionRule) {
    const name = rule.rule.name;
    if (rule.cron) {
      const schedule = digestSchedule(rule.cron);
      const next = schedule.next(clock());
      write(`INSERT INTO schedules VALUES (?,?,?) ON CONFLICT(rule) DO UPDATE
        SET cron=excluded.cron,next_at=excluded.next_at WHERE schedules.cron<>excluded.cron`, name, rule.cron, next === undefined ? null : iso(next));
      agendas.set(name, schedule);
    }
    rules.set(name, rule);
  }
  for (const rule of initialRules) register(rule);

  function route(source: string, input: EventInput, targets: { name: string; lane: string; session?: string | null }[]) {
    const routed = targets.map(target => target.name);
    const stored = one<{ id: number; routes: string }>('SELECT id,routes FROM events WHERE source IN (?,?) AND event_key=? ORDER BY id LIMIT 1',
      [source, source === executionSource ? formerName(source) : source, input.id]);
    if (stored) return { event: stored.id, routed: JSON.parse(stored.routes) as string[] };
    const event = Number(write('INSERT INTO events(source,event_key,body,received_at,routes) VALUES (?,?,?,?,?)',
      source, input.id, JSON.stringify(input), now(), JSON.stringify(routed)).lastInsertRowid);
    for (const { name, lane, session } of targets) {
      const queued = one<{ id: number }>("SELECT id FROM runs WHERE rule=? AND lane=? AND state='queued' ORDER BY id LIMIT 1", [name, lane]);
      const run = queued?.id ?? Number(write("INSERT INTO runs(lane,rule,state,not_before,session) VALUES (?,?,'queued',?,?)",
        lane, name, now(), session ?? null).lastInsertRowid);
      if (queued && session) write('UPDATE runs SET session=COALESCE(session,?) WHERE id=?', session, run);
      write('INSERT INTO run_events VALUES (?,?)', run, event);
    }
    return { event, routed };
  }

  function makeJob(row: QueueRow, spec: ExecutionRule, token: string): Job {
    const events = all<{ source: string; body: string; received_at: string }>(`SELECT source,body,received_at FROM events e
      JOIN run_events input ON input.event_id=e.id WHERE input.run_id=? ORDER BY e.id`, [row.id]);
    const related = all<CardRow>(`SELECT c.* FROM cards c JOIN run_events input ON input.event_id=c.answer_event
      WHERE input.run_id=? AND c.lane=? AND c.rule=? ORDER BY c.id`, [row.id, row.lane, row.rule]);
    const timers = all<TimerRow>(`SELECT t.* FROM timers t JOIN run_events input ON input.event_id=t.event_id
      WHERE input.run_id=? ORDER BY t.at,t.id`, [row.id]);
    return { run: row.id, token, attempt: row.attempts + 1, rule: spec.rule, agent: spec.agent, session: row.session, askFirst: [],
      context: {
        events: events.map(item => ({ ...JSON.parse(item.body) as EventInput, source: item.source,
          sourceName: item.source === 'schedule' ? '定时任务' : 'Contractor', receivedAt: item.received_at })),
        answers: related.map(card => ({ card: card.id, title: card.title, options: JSON.parse(card.options), choice: card.choice,
          text: card.answer, about: card.about, by: card.by, at: card.decided_at! })),
        timers: timers.map(({ key, about, at }) => ({ key, about, at })),
        waiting: all<TimerRow>('SELECT key,about,at FROM timers WHERE lane=? AND rule=? AND event_id IS NULL ORDER BY at,id', [row.lane, row.rule]),
        open: views.cards(row.lane).filter(card => card.rule === row.rule && card.state === 'open')
          .map(card => ({ card: card.id, title: card.title, text: card.text, at: card.created_at })),
        decided: related.map(card => ({ card: card.id, title: card.title,
          choice: card.choice === null ? card.answer : JSON.parse(card.options)[card.choice], at: card.decided_at! })),
      },
    };
  }

  function live(id: number, token: string) {
    const run = readRun(id);
    if (!run || run.issued === null || run.token_hash !== hash(token) || !['claimed', 'unknown'].includes(run.state))
      throw new Error('执行租约已失效');
    return run;
  }
  function closeCard(card: number, actor: string, reason: string) {
    return Number(write("UPDATE cards SET state='closed',by=?,answer=?,decided_at=? WHERE id=? AND kind='notice' AND state='open'",
      actor, reason, now(), card).changes) === 1;
  }
  function storeCard(run: QueueRow, kind: 'ask' | 'notice', item: NonNullable<Result['ask']>[number] | NonNullable<Result['notice']>[number]) {
    const duplicate = item.key && one<{ id: number }>("SELECT id FROM cards WHERE lane=? AND rule=? AND kind=? AND local_key=? AND state='open'",
      [run.lane, run.rule, kind, item.key]);
    if (duplicate) return;
    const ask = 'options' in item ? item : undefined;
    write(`INSERT INTO cards(lane,rule,run_id,kind,title,text,options,state,local_key,about,created_at)
      VALUES (?,?,?,?,?,?,?,'open',?,?,?)`, run.lane, run.rule, run.id, kind, item.title, item.text,
      JSON.stringify(ask?.options ?? []), item.key ?? null, ask?.about ?? '', now());
  }
  function addUsage(former: string | null, current: Usage | undefined) {
    if (!current) return former;
    const total = JSON.parse(former ?? '{}') as Record<string, number>;
    for (const field of ['input', 'output', 'cached', 'cost'] as const) {
      const count = current[field];
      if (count !== undefined) total[field] = (total[field] ?? 0) + count;
    }
    return JSON.stringify(total);
  }

  const hub: ExecutionHub = {
    ...views,
    ingest(source, input) {
      return atomic(() => {
        const event = parseEvent(input);
        const targets = [...rules.values()].filter(rule => rule.source === source && rule.type === event.type && !rule.cron)
          .map(rule => ({ name: rule.rule.name, lane: event.subject || event.id }));
        return route(source, event, targets);
      });
    },
    answer(id, answer) {
      return atomic(() => {
        const card = readCard(id);
        if (!card) throw new Error('没有这张卡片');
        if (card.state !== 'open') return { changed: false, state: card.state };
        if (card.kind === 'notice') return { changed: closeCard(id, answer.by, answer.text ?? ''), state: 'closed' };
        const options = JSON.parse(card.options) as string[];
        const response = answer.text?.trim() || null;
        if (answer.choice === undefined ? !response : !Number.isInteger(answer.choice) || !options[answer.choice]) throw new Error('没有这个选项');
        if ([...response ?? ''].length > 4000 || answer.by.length > 500 || answer.ref.length > 500) throw new Error('答复超出长度限制');
        const original = readRun(card.run_id);
        const { event } = route('answer', parseEvent({ id: String(id), type: 'card.answered', subject: card.lane, summary: card.title }),
          [{ name: card.rule, lane: card.lane, session: original?.session }]);
        write("UPDATE cards SET state='decided',choice=?,answer=?,by=?,decided_at=?,answer_event=?,answer_ref=? WHERE id=?",
          answer.choice ?? null, response, answer.by, now(), event, answer.ref, id);
        return { changed: true, state: 'decided' };
      });
    },
    resolve(id, reason, by) {
      return Number(write("UPDATE cards SET state='closed',by=?,answer=?,decided_at=? WHERE id=? AND state='open'",
        by, reason, now(), id).changes) === 1;
    },
    heartbeat(name, ids) {
      const at = now();
      atomic(() => {
        for (const id of ids) write(`UPDATE runs SET seen_at=?,state=CASE WHEN cancel_at IS NULL THEN 'claimed' ELSE state END
          WHERE id=? AND worker=? AND state IN ('claimed','unknown')`, at, id, name);
      });
    },
    cancels: name => all<{ id: number }>(`SELECT id FROM runs WHERE worker=? AND cancel_at IS NOT NULL
      AND state IN ('claimed','unknown') ORDER BY id`, [name]).map(row => row.id),
    claimNext(name, claim, eligible = () => true) {
      return atomic(() => {
        const held = one<{ job: string; lane: string; rule: string }>(`SELECT job,lane,rule FROM runs
          WHERE worker=? AND claim=? AND state='claimed' AND cancel_at IS NULL`, [name, claim]);
        if (held) return eligible(held) ? JSON.parse(held.job) as Job : null;
        const candidates = all<QueueRow>(`SELECT * FROM runs q WHERE q.state='queued' AND q.not_before<=?
          AND NOT EXISTS (SELECT 1 FROM runs a WHERE a.state IN ('claimed','unknown') AND (q.lane=a.lane OR q.rule=a.rule))
          AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.lane=q.lane AND c.rule=q.rule AND c.kind='ask' AND c.state='open')
          AND NOT EXISTS (SELECT 1 FROM runs a WHERE a.state='queued' AND a.lane=q.lane AND a.rule=q.rule AND a.id<q.id)
          ORDER BY q.not_before,q.id`, [now()]);
        const row = candidates.find(row => rules.has(row.rule) && eligible(row));
        if (!row) return null;
        const issued = one<{ value: number }>('UPDATE lease_sequence SET value=value+1 WHERE id=1 RETURNING value')!.value;
        const token = randomBytes(32).toString('base64url');
        const job = makeJob(row, rules.get(row.rule)!, token);
        write(`UPDATE runs SET state='claimed',worker=?,claim=?,issued=?,token_hash=?,job=?,seen_at=?,claimed_at=?
          WHERE id=?`, name, claim, issued, hash(token), JSON.stringify(job), now(), now(), row.id);
        return job;
      });
    },
    cancel(id) {
      atomic(() => {
        write("UPDATE runs SET state='cancelled',summary='已停止',finished_at=? WHERE id=? AND state='queued'", now(), id);
        write("UPDATE runs SET cancel_at=COALESCE(cancel_at,?) WHERE id=? AND state IN ('claimed','unknown')", now(), id);
      });
    },
    started(id, token, value) {
      atomic(() => { live(id, token); write('UPDATE runs SET session=?,seen_at=? WHERE id=?', value.session, now(), id); });
    },
    finish(id, token, input) {
      return atomic(() => {
        const resultHash = hash(JSON.stringify(input));
        const prior = readRun(id);
        if (prior?.last_token_hash === hash(token)) {
          if (prior.last_result !== resultHash) throw new Error('同一执行已提交不同内容');
          return { rejected: JSON.parse(prior.last_answer ?? '[]') as Rejected[] };
        }
        const row = live(id, token);
        const result = parseResult(input);
        const rejected: Rejected[] = [];
        const success = result.outcome === 'done' || result.outcome === 'nothing';
        if (row.cancel_at && success) throw new Error('正在停止的执行不能提交成功成果');
        if (result.outcome !== 'cancelled') for (const item of result.notice ?? []) storeCard(row, 'notice', item);
        if (success) {
          write(`UPDATE cards SET state='done' WHERE state='decided' AND answer_event IN
            (SELECT event_id FROM run_events WHERE run_id=?)`, id);
          for (const item of result.ask ?? []) storeCard(row, 'ask', item);
          for (const item of result.resolve ?? []) {
            const card = readCard(item.card);
            if (card?.lane !== row.lane || card.rule !== row.rule || !closeCard(item.card, row.rule, item.reason))
              rejected.push({ card: item.card, reason: '仅能结清本轮范围内开启的告知卡片' });
          }
          for (const item of result.later ?? []) {
            if (item.cancel) write('DELETE FROM timers WHERE lane=? AND rule=? AND key=? AND event_id IS NULL', row.lane, row.rule, item.key);
            else write(`INSERT INTO timers(lane,rule,key,about,at) VALUES (?,?,?,?,?)
              ON CONFLICT(lane,rule,key) WHERE event_id IS NULL DO UPDATE SET about=excluded.about,at=excluded.at`,
            row.lane, row.rule, item.key, item.about!, iso(Date.parse(item.at!)));
          }
          // Result events are handed to the business ledger. Only input offered by the core can enqueue work.
        } else for (const key of ['ask', 'resolve', 'later', 'events'] as const) {
          for (const _ of result[key] ?? []) rejected.push({ what: key, reason: '未完成的执行不能产生业务动作' });
        }
        const attempts = row.attempts + (result.outcome === 'failed' ? 1 : 0);
        const retry = result.outcome === 'failed' && !row.cancel_at && attempts < maxAttempts;
        const state = retry ? 'queued' : result.outcome;
        const at = now();
        const notBefore = retry ? iso(clock() + Math.min(300_000 * 2 ** (attempts - 1), 3_600_000)) : row.not_before;
        write(`UPDATE runs SET state=?,attempts=?,not_before=?,finished_at=?,summary=?,usage=?,session=?,
          last_issued=issued,last_token_hash=token_hash,last_result=?,last_answer=?,issued=NULL,token_hash=NULL,job=NULL,cancel_at=NULL
          WHERE id=?`, state, attempts, notBefore, retry ? null : at, result.summary ?? result.error ?? null, addUsage(row.usage, result.usage),
        result.session ?? row.session, resultHash, JSON.stringify(rejected), id);
        return { rejected };
      });
    },
    runLease: id => one<Lease>('SELECT issued,last_issued,last_result,last_answer FROM runs WHERE id=?', [id]),
    tick() {
      atomic(() => {
        const time = clock();
        write("UPDATE runs SET state='unknown' WHERE state='claimed' AND seen_at<=?", iso(time - leaseMs));
        for (const timer of all<TimerRow>('SELECT id,lane,rule,key,about,at FROM timers WHERE event_id IS NULL AND at<=? ORDER BY at,id', [iso(time)])) {
          if (!rules.has(timer.rule)) continue;
          const { event } = route('timer', parseEvent({ id: String(timer.id), type: 'timer.due', subject: timer.lane, detail: timer.about }),
            [{ name: timer.rule, lane: timer.lane }]);
          write('UPDATE timers SET event_id=? WHERE id=?', event, timer.id);
        }
        for (const due of all<{ rule: string; next_at: string }>('SELECT rule,next_at FROM schedules WHERE next_at<=?', [iso(time)])) {
          const schedule = agendas.get(due.rule);
          if (!schedule) continue;
          const latest = schedule.latest(time);
          if (latest !== undefined && latest >= Date.parse(due.next_at)) route('schedule', parseEvent({ id: due.rule + '@' + iso(latest),
            type: 'schedule.tick', subject: rules.get(due.rule)!.agent.id }),
          [{ name: due.rule, lane: rules.get(due.rule)!.agent.id }]);
          const next = schedule.next(time);
          write('UPDATE schedules SET next_at=? WHERE rule=?', next === undefined ? null : iso(next), due.rule);
        }
      });
    },
    close: () => db.close(),
  };
  return { hub, register };
}
