import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Job } from '../../upstream/autoloop/protocol/job.ts';
import type { EventInput, Rejected, Result } from '../../upstream/autoloop/protocol/validate.ts';
import { root, runtime } from '../config.ts';

export const workerName = 'suitme-dev';
export const taskRule = 'SuitMe 项目开发';
export interface ExecutionCard {
  id: number;
  title: string;
  text: string;
  options: string;
  state: string;
}

export interface AutoloopHub {
  ingest(source: string, event: Partial<EventInput>): { event: number; duplicate: boolean; routed: string[] };
  answer(card: number, input: { choice: number; by: string; ref: string }): { state: string; changed: boolean };
  one<T>(sql: string, params?: (number | string)[]): T | undefined;
  claimNext(worker: string, claim: string): Job | null;
  heartbeat(worker: string, running: number[]): void;
  cancels(worker: string): number[];
  cancel(run: number): void;
  started(run: number, token: string, input: object): object;
  finish(run: number, token: string, result: Result): { rejected: Rejected[]; duplicate?: boolean };
  tick(): void;
  db: { close(): void };
}

export async function openAutoloop(checkout: string): Promise<AutoloopHub> {
  const home = runtime('autoloop');
  await mkdir(home, { recursive: true, mode: 0o700 });
  const rules = {
    timezone: 'Asia/Shanghai',
    sources: { suitme: { name: 'SuitMe 已授权工单' } },
    agents: { codex: { name: 'Codex', worker: workerName, use: 'codex', access: 'read', timeout: 8 } },
    rules: [{
      name: taskRule, when: { source: 'suitme', types: ['ticket.assigned'] }, to: 'codex', cwd: checkout,
      prompt: '处理 SuitMe 授权的当前工单。遵守本轮范围与版本。', parallel: 1, tell: 'needed',
    }],
  };
  const rulesFile = runtime('autoloop', 'rules.json');
  if (process.env.AGENT_AUTOLOOP_HOME !== home) throw new Error('Autoloop 状态目录必须隔离');
  await writeFile(rulesFile, JSON.stringify(rules), { mode: 0o600 });
  const url = pathToFileURL(path.join(root, 'upstream/autoloop/host/runtime.ts'));
  // Import the original host runtime so execution state belongs to its event log.
  return await import(url.href) as AutoloopHub;
}
