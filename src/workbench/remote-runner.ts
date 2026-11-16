import { mkdir, readFile, readdir, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Job } from '../../upstream/autoloop/protocol/job.ts';
import { workerStopped } from './autoloop.ts';
import { remoteEngine, type RunnerAgent } from './config.ts';
import type { DeviceJob, ReleasedLease, RemoteStop } from './devices.ts';
import { cleanIsolationTemp, discardIsolation, isolateJob, modelReceipt, readIsolation } from './isolation.ts';

const leaseSchema = z.object({
  run: z.number().int().positive(), attempt: z.number().int().positive(), lease: z.string().min(1).max(500),
}).strict();
const runDirectory = (home: string, lease: Pick<ReleasedLease, 'run' | 'attempt'>) =>
  path.join(home, 'worker', 'runs', lease.run + '-' + lease.attempt);

export async function neverLaunched(home: string, lease: ReleasedLease) {
  leaseSchema.parse(lease);
  const files = await readdir(runDirectory(home, lease)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return [];
  });
  return files.length === 0;
}

export async function prepareRemote(home: string, profile: RunnerAgent, job: DeviceJob): Promise<Job> {
  if (!remoteEngine(profile) || !/^[a-f0-9]{64}$/.test(job.remote?.authority ?? '') || job.agent.id !== profile.id
    || job.agent.use !== profile.engine || job.agent.model !== profile.model || job.agent.access !== 'read'
    || job.agent.command || job.rule.cwd !== '.' || job.rule.skill || job.session)
    throw new Error('领到的任务与远程配对范围不一致');
  const lease = leaseSchema.parse({ run: job.run, attempt: job.attempt, lease: job.token });
  if (!await neverLaunched(home, lease)) throw new Error('远端磁盘已有该轮执行记录，须保留旧执行和回执');
  if (profile.engine === 'codex') {
    const scoped = await isolateJob({ ...profile, execution: { ...profile.execution!, kind: 'sandbox' } }, job,
      { authority: job.remote!.authority, home });
    return scoped.job;
  }
  const cwd = runDirectory(home, lease);
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  return { ...job, agent: { ...job.agent, use: 'suitme-remote-claude' }, rule: { ...job.rule, cwd } };
}

export async function remoteStop(home: string, entry: { run: number; attempt: number; token: string; turn: number; dir: string;
  job: Job }, session?: string): Promise<RemoteStop> {
  if (!workerStopped(entry.run, entry.attempt, entry.token, home)) throw new Error('等待远端旧进程和它的子进程退出');
  let model: string | undefined;
  if (entry.job.agent.use === 'suitme-isolated') {
    const receipt = await modelReceipt(await readIsolation(entry.run, entry.attempt), session);
    if (receipt.verification === 'session-reported') model = receipt.reported;
  } else {
    const stream = await readFile(path.join(entry.dir, 'stdout-' + entry.turn + '.log'), 'utf8').catch(() => '');
    for (const line of stream.split('\n')) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'assistant' && typeof event.message?.model === 'string') model = event.message.model;
      } catch { /* Plain CLI diagnostics are not model receipts. */ }
    }
  }
  return { attempt: entry.attempt, state: entry.turn > 0 ? 'exited' : 'not-launched', ...(model && { model }) };
}

export async function cleanRemoteCodex(run: number, attempt: number) {
  const local = await readIsolation(run, attempt);
  if (!local) return;
  await discardIsolation(local);
  await cleanIsolationTemp(run, attempt);
}

export async function cleanAcknowledged(home: string, codex: boolean) {
  const base = path.join(home, 'worker', 'runs');
  for (const name of await readdir(base)) {
    if (!/^\d+-\d+$/.test(name)) continue;
    const directory = path.join(base, name);
    const files = await readdir(directory);
    if (!files.includes('suitme-acknowledged') || files.includes('entry.json')) continue;
    const [run, attempt] = name.split('-').map(Number);
    if (codex) await cleanRemoteCodex(run!, attempt!);
    for (const file of files.filter(file => file !== 'suitme-acknowledged'))
      await rm(path.join(directory, file), { recursive: true, force: true });
    await rename(path.join(directory, 'suitme-acknowledged'), path.join(directory, 'suitme-settled'));
  }
}
