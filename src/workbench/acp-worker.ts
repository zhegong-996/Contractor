import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { runtime } from '../config.ts';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { isolatedCommand, sandboxInvocation, sandboxPolicy } from './isolation.ts';
import { sandboxProvider } from './sandbox-provider.ts';
import { executable } from './execution/cli.ts';
import type { Adapter } from './execution/protocol.ts';

const launcher = fileURLToPath(new URL('./acp-client.mjs', import.meta.url));
export async function probeAcp() {
  const binary = await realpath(executable('codex-acp'));
  const probes = runtime('acp-probes');
  await mkdir(probes, { recursive: true, mode: 0o700 });
  const folder = await realpath(await mkdtemp(path.join(probes, 'probe-')));
  const temp = await realpath(await mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'acp-')));
  try {
    const home = path.join(folder, 'home'), input = path.join(folder, 'input'), policy = path.join(folder, 'policy.json');
    await mkdir(input, { mode: 0o700 });
    await mkdir(home, { mode: 0o700 });
    await writeFile(path.join(home, 'config.toml'), 'sandbox_mode = "read-only"\n', { mode: 0o600 });
    const sandboxRoot = sandboxProvider().root;
    await writeFile(policy, JSON.stringify(sandboxPolicy(folder, home, input, binary, [], [], temp, undefined, sandboxRoot, true)), { mode: 0o600 });
    const argv = sandboxInvocation({ home, temp, policy, sandboxRoot }, [binary], '');
    const { stdout } = await promisify(execFile)(process.execPath, [launcher, 'probe', folder, '', '', '', ...argv], { timeout: 42000 });
    return JSON.parse(stdout).ready === true;
  } finally { await Promise.all([temp, folder].map(dir => rm(dir, { recursive: true, force: true }))); }
}

export const acpWorker: Adapter = {
  command(turn) {
    if (turn.access !== 'read' || turn.resume) throw new Error('ACP 仅接当前授权的全新只读轮次');
    const argv = isolatedCommand(turn, (_isolated, binary) => [binary]);
    return [process.execPath, launcher, 'run', turn.cwd, turn.contextFile,
      turn.prompt.replaceAll(turn.contextFile, '随本轮提供的上下文'), turn.model!, ...argv];
  },
  read(stdout, code) {
    const rows = stdout.trim().split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const session = rows.find(row => typeof row.session === 'string')?.session;
    const text = rows.find(row => typeof row.text === 'string')?.text;
    const rejectedModel = rows.some(row => row.blocked === 'model');
    return { session, ...(rejectedModel ? { error: 'acp-model-unavailable' } : code === 0 && text ? { text } : { error: '尚未取得本轮完整结束回执' }) };
  },
};
