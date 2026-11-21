import { digestSchedule } from './execution/cron.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import type { Project } from './config.ts';

export type RoutineAction =
  | { kind: 'ticket'; title: string; request: string; topic?: string; agent?: string }
  | { kind: 'consultation'; topic: string; text: string; agent: string }
  | { kind: 'next-version'; ticket: string; reason: string };

export function openRoutines(store: Pick<SuperAgentStore, 'db'>) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_routine_runs (
      routine TEXT NOT NULL, occurrence INTEGER NOT NULL, at TEXT NOT NULL,
      PRIMARY KEY (routine, occurrence)
    );
  `);
  const due = (routine: NonNullable<Project['routines']>[number], now: number) => {
    try {
      const schedule = digestSchedule(routine.cron);
      const latest = schedule.latest(now);
      if (latest === undefined || latest > now || now - latest > 2 * 24 * 60 * 60_000) return undefined;
      return latest;
    } catch { return undefined; }
  };
  const ran = (routine: string, occurrence: number) =>
    !!store.db.prepare('SELECT 1 FROM workbench_routine_runs WHERE routine=? AND occurrence=?').get(routine, occurrence);
  const mark = (routine: string, occurrence: number) => store.db.prepare(
    'INSERT OR IGNORE INTO workbench_routine_runs(routine, occurrence, at) VALUES (?,?,?)',
  ).run(routine, occurrence, new Date().toISOString());
  return { due, ran, mark };
}
