import type { DatabaseSync } from 'node:sqlite';
import { digest } from './knowledge.ts';

type Health = {
  generation: number;
  credential?: string;
  denied: boolean;
  observed: number;
  fileVersion?: string;
  candidate?: string;
};
const grantDuration = 5 * 60_000;

/** Source authorization generations are durable. A live verification is required after startup. */
export class FigmaAccess {
  private readonly verified = new Set<string>();

  constructor(private readonly db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS workbench_figma_access (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  get(id: string): Health {
    const saved = this.db.prepare('SELECT value FROM workbench_figma_access WHERE id=?').get(id);
    return saved ? JSON.parse(String(saved.value)) : { generation: 0, denied: false, observed: 0 };
  }

  authority(id: string) {
    const { generation } = this.get(id);
    return generation ? digest({ id, generation }) : id;
  }

  allowed(id: string, credential: string | undefined) {
    const state = this.get(id);
    return !!credential && this.verified.has(id) && !state.denied && state.credential === credential
      && state.observed + grantDuration > Date.now();
  }

  prepare(id: string, credential: string | undefined) {
    const state = this.get(id);
    if (state.credential && state.credential !== credential) this.deny(id);
  }

  deny(id: string) {
    const state = this.get(id);
    this.verified.delete(id);
    if (state.denied) return false;
    this.save(id, { generation: state.generation + 1, denied: true, observed: Date.now() });
    return true;
  }

  confirm(id: string, credential: string, fileVersion: string, candidate: string, generation: number) {
    if (this.get(id).generation !== generation) return false;
    this.save(id, { generation, credential, denied: false, observed: Date.now(), fileVersion, candidate });
    this.verified.add(id);
    return true;
  }

  private save(id: string, state: Health) {
    this.db.prepare('INSERT INTO workbench_figma_access VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(id, JSON.stringify(state));
  }
}
