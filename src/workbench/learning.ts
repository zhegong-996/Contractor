import { z } from 'zod';
import type { SuperAgentStore } from '../superagent-ports.ts';

const metricLabel = z.string().trim().min(1).max(100);
const value = z.number().finite();
export const measureSchema = z.object({
  metric: metricLabel,
  unit: metricLabel,
  baseline: value.optional(),
  target: value.optional(),
}).strict();
export const observationSchema = z.object({
  nonce: z.string().uuid(),
  revision: z.string().length(64),
  actual: value,
  evidence: z.string().trim().min(1).max(3500),
  lesson: z.object({
    body: z.string().trim().min(1).max(3500),
    conditions: z.string().trim().min(1).max(600),
  }).strict().optional(),
}).strict();

export type Measure = z.infer<typeof measureSchema>;
export type ObservationInput = z.infer<typeof observationSchema>;
export type Observation = Omit<ObservationInput, 'nonce' | 'lesson'> & {
  id: string;
  actor: string;
  at: string;
  candidate?: string;
  commit?: string;
};

export class WorkObservations {
  constructor(private readonly store: SuperAgentStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_observation (
        id TEXT PRIMARY KEY, ticket TEXT NOT NULL, value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workbench_observation_ticket ON workbench_observation(ticket);
    `);
  }

  list(ticket: string): Observation[] {
    return this.store.db.prepare('SELECT value FROM workbench_observation WHERE ticket=? ORDER BY rowid')
      .all(ticket).map(row => JSON.parse(String(row.value)));
  }

  save(ticket: string, record: Observation): boolean {
    return !!this.store.db.prepare('INSERT OR IGNORE INTO workbench_observation VALUES (?,?,?)')
      .run(record.id, ticket, JSON.stringify(record)).changes;
  }
}
