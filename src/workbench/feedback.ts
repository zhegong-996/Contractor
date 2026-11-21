import type { SuperAgentStore } from '../superagent-ports.ts';
import { key } from '../../upstream/superagent/src/core/index.ts';
import type { Work } from './work-types.ts';

export type FeedbackSentiment = 'up' | 'down';
export type FeedbackRow = {
  ticket: string; project: string; actor: string; revision: string; agent: string;
  sentiment: FeedbackSentiment; note?: string; at: string;
};
export type FeedbackCycle = { day: string; state: 'quiet' | 'considered'; subject?: string; summary?: string; at: string };

/**
 * 反馈闭环账本：点赞/点踩 → 每日聚合 → 维护人决定改进动作（忽略或转工单）。
 * 聚合由 feedback_cycle 表按天幂等，重启与重复触发不会重复派发。
 */
export function openFeedback(store: Pick<SuperAgentStore, 'db'>) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_ticket_feedback (
      ticket TEXT NOT NULL, project TEXT NOT NULL, actor TEXT NOT NULL, revision TEXT NOT NULL,
      agent TEXT NOT NULL, sentiment TEXT NOT NULL, note TEXT, at TEXT NOT NULL,
      PRIMARY KEY (ticket, actor, revision)
    );
    CREATE INDEX IF NOT EXISTS workbench_feedback_project ON workbench_ticket_feedback(project, at);
    CREATE TABLE IF NOT EXISTS workbench_feedback_cycle (project TEXT NOT NULL, day TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(project, day));
  `);
  const vote = (ticket: string, work: Work, actor: string, revision: string, sentiment: FeedbackSentiment, note?: string) =>
    store.db.prepare('INSERT OR REPLACE INTO workbench_ticket_feedback VALUES (?,?,?,?,?,?,?,?)')
      .run(ticket, work.project, actor, revision, work.agent, sentiment, note?.slice(0, 1000) ?? null,
        new Date().toISOString());
  const list = (ticket: string): FeedbackRow[] => store.db.prepare(
    'SELECT ticket, project, actor, revision, agent, sentiment, note, at FROM workbench_ticket_feedback WHERE ticket=? ORDER BY at DESC LIMIT 60',
  ).all(ticket).map(row => ({
    ticket: String(row.ticket), project: String(row.project), actor: String(row.actor), revision: String(row.revision),
    agent: String(row.agent), sentiment: row.sentiment as FeedbackSentiment, note: row.note ? String(row.note) : undefined,
    at: String(row.at),
  }));
  const cycle = (project: string): FeedbackCycle | undefined => {
    const row = store.db.prepare('SELECT value FROM workbench_feedback_cycle WHERE project=?').get(project);
    return row ? JSON.parse(String(row.value)) : undefined;
  };
  const consider = (project: string, now: number): FeedbackCycle | undefined => {
    const day = new Date(now).toISOString().slice(0, 10);
    if (cycle(project)) return undefined;
    const since = new Date(now - 24 * 3600_000).toISOString();
    const rows = store.db.prepare(
      "SELECT agent, sentiment, note, ticket FROM workbench_ticket_feedback WHERE project=? AND at>=? AND sentiment='down'",
    ).all(project, since);
    const record: FeedbackCycle = { day, state: rows.length ? 'considered' : 'quiet', at: new Date(now).toISOString() };
    if (rows.length) {
      const perAgent = new Map<string, { count: number; notes: string[] }>();
      for (const row of rows) {
        const bucket = perAgent.get(String(row.agent)) ?? { count: 0, notes: [] as string[] };
        bucket.count += 1;
        if (row.note && bucket.notes.length < 3) bucket.notes.push(String(row.note).slice(0, 160));
        perAgent.set(String(row.agent), bucket);
      }
      record.subject = key('feedback', project, day);
      record.summary = [...perAgent.entries()].map(([agent, bucket]) =>
        agent + ' 收到 ' + bucket.count + ' 条差评' + (bucket.notes.length ? '：' + bucket.notes.join('；') : '')).join('\n');
    }
    store.db.prepare('INSERT OR REPLACE INTO workbench_feedback_cycle VALUES (?,?,?)')
      .run(project, day, JSON.stringify(record));
    return record;
  };
  return { vote, list, cycle, consider };
}
