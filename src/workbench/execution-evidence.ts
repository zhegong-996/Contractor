import type { DatabaseSync } from 'node:sqlite';
import type { Job } from '../../upstream/autoloop/protocol/job.ts';
import type { Usage } from '../../upstream/autoloop/protocol/validate.ts';
import { digest } from './knowledge.ts';

type Assembly = {
  schema: 1;
  skill: string;
  context: string;
  runtime: string;
};
type FrozenRuntime = Omit<Job['agent'], 'command'> & { commandHash?: string; resumed: boolean };
export type ExecutionActor = {
  agent: string; owner: string; delegatedBy: string; function: string; engine: string; model?: string;
};
type Snapshot = {
  run: number; attempt: number; project: string; ticket?: string; assembly: Assembly; actor: ExecutionActor;
};
type UsageReceipt = ExecutionActor & {
  run: number; attempt: number; project: string;
  outcome: string; usage?: Usage;
};

export function unpricedAttempts(attempts: number[], receipts: Pick<UsageReceipt, 'attempt' | 'usage'>[], activeAttempt?: number) {
  return receipts.filter(receipt => receipt.usage?.cost === undefined).length
    + attempts.filter(attempt => attempt !== activeAttempt && !receipts.some(receipt => receipt.attempt === attempt)).length;
}

/** Evidence only. AutoLoop still owns claim, retry, cancellation and usage accumulation. */
export class ExecutionEvidence {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_execution_pack (hash TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workbench_execution_snapshot (
        run INTEGER NOT NULL, attempt INTEGER NOT NULL, project TEXT NOT NULL, ticket TEXT,
        value TEXT NOT NULL, PRIMARY KEY(run,attempt)
      );
      CREATE TABLE IF NOT EXISTS workbench_usage_receipt (
        run INTEGER NOT NULL, attempt INTEGER NOT NULL, project TEXT NOT NULL,
        value TEXT NOT NULL, PRIMARY KEY(run,attempt)
      );
    `);
  }

  freeze(project: string, ticket: string | undefined, job: Job, actor: ExecutionActor): Assembly {
    const { command, ...agent } = job.agent;
    const values = {
      skill: { prompt: job.rule.prompt, skill: job.rule.skill ?? null, askFirst: job.askFirst },
      context: job.context,
      runtime: { ...agent, ...(command ? { commandHash: digest(command) } : {}), resumed: !!job.session } satisfies FrozenRuntime,
    };
    const assembly: Assembly = { schema: 1, skill: digest(values.skill), context: digest(values.context), runtime: digest(values.runtime) };
    const value: Snapshot = { run: job.run, attempt: job.attempt, project, ticket, assembly, actor };
    const old = this.snapshot(job.run, job.attempt);
    if (old && digest(old) !== digest(value)) throw new Error('同一次执行的装配内容已变化');
    for (const kind of ['skill', 'context', 'runtime'] as const) {
      this.db.prepare('INSERT OR IGNORE INTO workbench_execution_pack VALUES (?,?)').run(assembly[kind], JSON.stringify(values[kind]));
    }
    this.db.prepare('INSERT OR IGNORE INTO workbench_execution_snapshot VALUES (?,?,?,?,?)')
      .run(job.run, job.attempt, project, ticket ?? null, JSON.stringify(value));
    return assembly;
  }

  snapshot(run: number, attempt: number): Snapshot | undefined {
    const row = this.db.prepare('SELECT value FROM workbench_execution_snapshot WHERE run=? AND attempt=?').get(run, attempt);
    return row && JSON.parse(String(row.value));
  }

  unpack(assembly: Assembly) {
    const read = <T>(hash: string): T => {
      const row = this.db.prepare('SELECT value FROM workbench_execution_pack WHERE hash=?').get(hash);
      if (!row) throw new Error('执行快照缺失，不能用当前配置代替');
      const value = JSON.parse(String(row.value));
      if (digest(value) !== hash) throw new Error('执行快照校验失败');
      return value;
    };
    return { skill: read<{ prompt: string; skill: unknown; askFirst: string[] }>(assembly.skill),
      context: read<Job['context']>(assembly.context), runtime: read<FrozenRuntime>(assembly.runtime) };
  }

  recordUsage(receipt: UsageReceipt) {
    // A duplicate native result must not book another charge or replace an unknown price with a guess.
    this.db.prepare('INSERT OR IGNORE INTO workbench_usage_receipt VALUES (?,?,?,?)')
      .run(receipt.run, receipt.attempt, receipt.project, JSON.stringify(receipt));
  }

  receipts(project: string): UsageReceipt[] {
    return this.db.prepare('SELECT value FROM workbench_usage_receipt WHERE project=? ORDER BY run,attempt').all(project)
      .map(row => JSON.parse(String(row.value)));
  }
}
