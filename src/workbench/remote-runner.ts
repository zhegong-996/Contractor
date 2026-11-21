import { mkdir, readFile, readdir, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Job } from './execution/protocol.ts';
import { workerStopped } from './worker-process.ts';
import { protocolMatches } from './compatibility.ts';
import { remoteEngine, type RunnerAgent } from './runner-profile.ts';
import type { DeviceJob, ReleasedLease, RemoteStop } from './devices.ts';
import { codexSessionEvidence, cleanIsolationTemp, discardIsolation, exportCodeDelta, isolateJob, readIsolation } from './isolation.ts';

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

export async function hasUnsettledRuns(local: string) {
  const entries = (folder: string) => readdir(folder).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return [] as string[];
  });
  for (const driver of ['autoloop', 'dispatch']) {
    const runs = path.join(local, driver, 'worker', 'runs');
    for (const id of await entries(runs)) {
      if (!/^\d+-\d+$/.test(id)) continue;
      const files = await entries(path.join(runs, id));
      if (files.some(name => !protocolMatches(name, 'contractor-settled'))) return true;
    }
  }
  return false;
}

export async function assertRunnerSettled(local: string) {
  if (await hasUnsettledRuns(local)) throw new Error('执行机仍有未结清的运行记录。请先用原调度器完成停止与回执。');
}

export async function prepareRemote(home: string, profile: RunnerAgent, job: DeviceJob): Promise<Job> {
  if (!remoteEngine(profile) || !/^[a-f0-9]{64}$/.test(job.remote?.authority ?? '') || job.agent.id !== profile.id
    || job.agent.use !== profile.engine || job.agent.model !== profile.model || (job.remote?.code ? profile.engine !== 'codex' || job.agent.access !== 'edit' : job.agent.access !== 'read')
    || job.agent.command || job.rule.cwd !== '.' || job.rule.skill || job.session)
    throw new Error('领到的任务与远程配对范围不一致');
  const lease = leaseSchema.parse({ run: job.run, attempt: job.attempt, lease: job.token });
  if (!await neverLaunched(home, lease)) throw new Error('远端磁盘已有该轮执行记录，须保留旧执行和回执');
  if (profile.engine === 'codex') {
    const scoped = await isolateJob({ ...profile, execution: { ...profile.execution!, kind: 'sandbox' } }, job,
      { authority: job.remote!.authority, home }, undefined, job.remote?.code ? { bundle: job.remote.code, paths: job.remote.code.paths } : undefined);
    return scoped.job;
  }
  const cwd = runDirectory(home, lease);
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  return { ...job, agent: { ...job.agent, use: 'contractor-remote-claude', provider: profile.execution!.provider }, rule: { ...job.rule, cwd } };
}

export async function remoteStop(home: string, entry: { run: number; attempt: number; token: string; turn: number; dir: string;
  job: Job }, session?: string, recoverUsage = false) {
  if (!workerStopped(entry.run, entry.attempt, entry.token, home)) throw new Error('等待远端旧进程和它的子进程退出');
  let model: string | undefined;
  let usage;
  const codex = protocolMatches(entry.job.agent.use, 'contractor-isolated');
  if (codex) {
    // Only a fresh first turn can use the session total without charging another turn or attempt.
    ({ model, usage } = await codexSessionEvidence(await readIsolation(entry.run, entry.attempt), session,
      recoverUsage && entry.turn === 1 && !entry.job.session));
  } else {
    const stream = await readFile(path.join(entry.dir, 'stdout-' + entry.turn + '.log'), 'utf8').catch(() => '');
    for (const line of stream.split('\n')) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'assistant' && typeof event.message?.model === 'string') model = event.message.model;
      } catch { /* Plain CLI diagnostics are not model receipts. */ }
    }
  }
  const code = codex ? await exportCodeDelta(entry.run, entry.attempt) : undefined;
  const stop: RemoteStop = { ...(code && { code }), attempt: entry.attempt, state: entry.turn > 0 ? 'exited' : 'not-launched',
    ...(model && { model }), ...(usage && { usageCoverage: 'partial' }) };
  return { stop, usage };
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
    const receipt = files.find(file => protocolMatches(file, 'contractor-acknowledged'));
    if (!receipt || files.includes('entry.json')) continue;
    const [run, attempt] = name.split('-').map(Number);
    if (codex) await cleanRemoteCodex(run!, attempt!);
    for (const file of files.filter(file => file !== receipt))
      await rm(path.join(directory, file), { recursive: true, force: true });
    await rename(path.join(directory, receipt), path.join(directory, 'contractor-settled'));
  }
}
