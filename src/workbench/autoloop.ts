import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WorkerHub } from '../../upstream/autoloop/worker/worker.ts';
import type { Job } from '../../upstream/autoloop/protocol/job.ts';
import type { Result } from '../../upstream/autoloop/protocol/validate.ts';
import { root, runtime } from '../config.ts';
import type { Agent } from './config.ts';

export const workerName = 'suitme-workbench';
export const ruleName = (id: string) => '执行 · ' + id;
export const assignmentEvent = (id: string) => 'assigned.' + id;

export type Run = { id: number; lane: string; state: string; session: string | null; usage: string | null; summary: string | null; cancel_at: string | null };
export type Card = { id: number; title: string; text: string; options: string; state: string; choice: number | null; answer: string | null; lane: string };
type Started = Parameters<WorkerHub['started']>[2];
export interface Autoloop {
  ingest(source: string, event: { id: string; type: string; subject: string; summary: string; detail: string }): { routed: string[] };
  answer(id: number, answer: { choice?: number; text?: string; by: string; ref: string }): { changed: boolean; state: string };
  all<T>(sql: string, params?: (string | number)[]): T[];
  one<T>(sql: string, params?: (string | number)[]): T | undefined;
  heartbeat(name: string, ids: number[]): void;
  cancels(name: string): number[];
  claimNext(name: string, claim: string): Job | null;
  cancel(run: number): void;
  started(id: number, token: string, value: Started): unknown;
  finish(id: number, token: string, result: Result): unknown;
  tick(): void;
  db: { close(): void };
}

export async function openExecution(agents: Agent[]) {
  const home = runtime('autoloop');
  process.env.AGENT_AUTOLOOP_HOME = home;
  // Rules are generated from the trusted local runtime registry. Browser clients never supply commands.
  process.env.AGENT_AUTOLOOP_RULES = path.join(home, 'rules.json');
  await mkdir(home, { recursive: true, mode: 0o700 });
  const cwd = runtime('execution');
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  if (agents.some(agent => agent.engine === 'cursor')) {
    const plugins = path.join(home, 'plugins', 'cursor');
    await mkdir(plugins, { recursive: true, mode: 0o700 });
    const adapter = pathToFileURL(path.join(root, 'src/workbench/cursor.ts')).href;
    await writeFile(path.join(plugins, 'agent.ts'), 'export { default } from ' + JSON.stringify(adapter) + ';\n', { mode: 0o600 });
  }
  const rules = {
    timezone: 'Asia/Shanghai',
    sources: { suitme: { name: 'SuitMe 协作台' } },
    agents: Object.fromEntries(agents.map(a => [a.id, {
      name: a.title, worker: workerName, use: a.engine, access: 'read', timeout: 8,
      ...(a.model ? { model: a.model } : {}), ...(a.command ? { command: a.command } : {}),
    }])),
    rules: agents.map(a => ({
      name: ruleName(a.id), when: { source: 'suitme', types: [assignmentEvent(a.id)] }, to: a.id, cwd,
      prompt: '按工单授权提供专业意见', parallel: 1, tell: 'needed',
    })),
  };
  await writeFile(path.join(home, 'rules.json'), JSON.stringify(rules), { mode: 0o600 });
  const at = (file: string) => pathToFileURL(path.join(root, 'upstream/autoloop', file)).href;
  const hub: Autoloop = await import(at('host/runtime.ts'));
  const { createWorker } = await import(at('worker/worker.ts')) as typeof import('../../upstream/autoloop/worker/worker.ts');
  return { hub, createWorker };
}
