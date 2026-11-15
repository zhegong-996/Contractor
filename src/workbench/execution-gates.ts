import { decide } from '../../upstream/autoloop/kernel/decide.ts';
import { commitLatest } from '../../upstream/autoloop/kernel/store.ts';
import { deadlines } from '../../upstream/autoloop/kernel/due.ts';
import type { Change, Fact } from '../../upstream/autoloop/kernel/evolve.ts';
import type * as NativeHub from '../../upstream/autoloop/host/runtime.ts';
import type { Job } from '../../upstream/autoloop/protocol/job.ts';

/** Filter eligibility inside the native claim transaction. The native ledger, queue,
 * answer events, leases and event coalescing remain authoritative. The temporary
 * view is never persisted, so waiting neither loses inputs nor cancels a run. */
export function claimWhenAnswered(
  hub: Pick<typeof NativeHub, 'db' | 'getView' | 'environment'>, worker: string, claim: string,
): Job | null {
  let job: Job | null = null;
  commitLatest(hub.db, hub.getView().format, latest => {
    const view = latest.fork();
    const pending = latest.select('cards', { kind: 'ask', state: 'open' });
    for (const run of latest.select('runs', { state: 'queued' })) {
      if (pending.some(card => card.lane === run.lane && card.rule === run.rule))
        view.set('runs', String(run.id), null);
    }
    const now = Date.now();
    const result = decide(view, { type: 'claimNext', args: [worker, claim] }, now, hub.environment);
    job = result.value as Job | null;
    // Native decide also derives deadlines. Recompute those against the complete
    // queue so a waiting run's offline/retry deadlines are not deleted each poll.
    const changes: Change[] = result.facts.flatMap(fact => fact.changes).filter(change => change.table !== 'due');
    const actual = latest.fork();
    for (const change of changes) actual.set(change.table, change.key, change.row);
    const due = deadlines(actual, now);
    for (const [key, row] of Object.entries(due)) {
      if (JSON.stringify(actual.get('due', key)) !== JSON.stringify(row)) changes.push({ table: 'due', key, row });
    }
    for (const row of actual.select('due')) {
      const key = `${row.kind}:${row.key}`;
      if (!due[key]) changes.push({ table: 'due', key, row: null });
    }
    return changes.length ? [{ version: 1, seq: latest.seq + 1, at: now, type: 'claimNext', changes } satisfies Fact] : [];
  });
  return job;
}
