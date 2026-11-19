import type { Job, Result, Rejected, Started } from './protocol.ts';

export const workerName = 'contractor-workbench';
export const executionSource = 'contractor';
export const ruleName = (id: string) => '执行 · ' + id;
export const assignmentEvent = (id: string) => 'assigned.' + id;
export type ExecutionDriver = 'autoloop' | 'contractor';
export type Run = { id: number; lane: string; rule: string; state: string; session: string | null; usage: string | null;
  summary: string | null; cancel_at: string | null; attempts: number; not_before: string | null; claimed_at: string | null; finished_at: string | null };
export type Card = { id: number; title: string; text: string; options: string; state: string; choice: number | null;
  answer: string | null; lane: string; run_id: number; rule: string; kind: string; by: string | null; decided_at: string | null; created_at: string };
export type ConfirmedCard = Card & { by: string; decided_at: string };
export type Lease = { issued: number | null; last_issued: number | null; last_result: string | null; last_answer: string | null };

/** Business logic uses these operations without sharing the scheduler's tables. */
export interface ExecutionHub {
  ingest(source: string, event: { id: string; type: string; subject: string; summary: string; detail: string }): { routed: string[] };
  answer(id: number, answer: { choice?: number; text?: string; by: string; ref: string }): { changed: boolean; state: string };
  resolve(id: number, reason: string, by: string): boolean;
  run(id: number): Run | undefined;
  runs(lane: string, includeHandoffs?: boolean): Run[];
  cards(lane: string, kind?: 'ask' | 'notice'): Card[];
  card(id: number): Card | undefined;
  confirmed(lane: string): ConfirmedCard[];
  timers(lane: string): { id: number; at: string }[];
  nextSchedule(rule: string): string | undefined;
  heartbeat(name: string, ids: number[]): void;
  cancels(name: string): number[];
  claimNext(name: string, claim: string, eligible?: (run: { lane: string; rule: string }) => boolean): Job | null;
  cancel(run: number): void;
  started(id: number, token: string, value: Started): unknown;
  finish(id: number, token: string, result: Result): { rejected: Rejected[] };
  runLease(id: number): Lease | undefined;
  tick(): void;
  close(): void;
}
