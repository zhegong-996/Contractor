import { mkdir, writeFile, readFile, lstat, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, runtime } from '../config.ts';
import type { Job } from './execution/protocol.ts';
import type { Agent, OctopSettings } from './config.ts';
import { digest } from './knowledge.ts';
import type { Isolation } from './isolation.ts';

const pathEnv = '/usr/local/bin:/usr/bin:/bin';
export const octopScript = path.join(root, 'src/workbench/octop-bridge.py');
export const octopPythonEnv = (workspace: string) => ({ PATH: pathEnv, HOME: workspace, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' });

export function octopCall(config: OctopSettings, operation: 'gateway' | 'memory', input: object): Promise<unknown> {
  const socket = operation === 'memory' ? config.indexSocket : undefined;
  return new Promise((resolve, reject) => {
    const child = spawn(config.python, [octopScript, socket ? 'query-index' : operation], {
      stdio: ['pipe', 'pipe', 'ignore'], env: octopPythonEnv(runtime()),
    });
    const fail = () => {
      clearTimeout(timeout);
      child.kill('SIGKILL');
      reject(new Error('Octop ' + operation + ' 暂不可用'));
    };
    const timeout = setTimeout(fail, operation === 'memory' ? 15_000 : 4000);
    const chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 512 * 1024) { fail(); return; }
      chunks.push(chunk);
    });
    child.once('error', fail);
    child.stdin.on('error', fail);
    child.once('close', code => {
      clearTimeout(timeout);
      if (code !== 0) return fail();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(socket ? { ...input, socket } : input));
  });
}

const octopRun = (run: number, attempt: number) => runtime('octop-runs', run + '-' + attempt);
export async function prepareOctop(config: OctopSettings, agent: Agent, job: Job, consultation = false): Promise<{ job: Job; isolation: Isolation }> {
  const profile = config.profiles.find(profile => profile.owner === agent.owner);
  if (!profile || agent.model !== profile.model || job.agent.access !== 'read') throw new Error('Octop 缺少成员只读执行配置');
  const host = await realpath(runtime());
  const credential = path.join(host, 'member-credentials', agent.owner, profile.credential + '.json');
  const stat = await lstat(credential);
  if (await realpath(credential) !== credential || !stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.size > 8192)
    throw new Error('Octop 成员凭据必须位于本人凭据目录，且仅本人可读写');
  const directory = octopRun(job.run, job.attempt);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const prompt = path.join(directory, 'prompt.txt');
  await writeFile(prompt, job.rule.prompt ?? '', { mode: 0o600 });
  return {
    job: { ...job, session: null, agent: { ...job.agent, use: 'contractor-octop', model: profile.model,
      command: [config.python, credential, directory, prompt, consultation ? 'consultation' : 'task'] }, rule: { ...job.rule, cwd: directory, skill: undefined } },
    isolation: { scope: digest({ directory, agent: agent.id }), owner: agent.owner, agent: agent.id, provider: 'deepseek', model: profile.model,
      credentialVersion: 'member-slot', boundary: 'octop' },
  };
}

export async function octopReportedModel(run: number, attempt: number): Promise<string | undefined> {
  return await readFile(path.join(octopRun(run, attempt), 'model'), 'utf8').catch(() => undefined);
}
