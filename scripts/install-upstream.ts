import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime } from '../src/config.ts';
mkdirSync(runtime('corepack-bin'), { recursive: true });
writeFileSync(runtime('corepack-bin/pnpm'), '#!/bin/sh\nexec corepack pnpm "$@"\n', { mode: 0o755 });
function run(program: string, args: string[], cwd = root) {
  const result = spawnSync(program, args, { cwd, stdio: 'inherit', env: { ...process.env, PAPERCLIP_TELEMETRY_DISABLED: '1',
    PAPERCLIP_HOME: runtime('paperclip'), PATH: `${runtime('corepack-bin')}${path.delimiter}${process.env.PATH}` } });
  if (result.status !== 0) throw new Error(`${program} failed (${result.status})`);
}
run('git', ['submodule', 'update', '--init', '--recursive']);
const repo = path.join(root, 'upstream/paperclip');
run('corepack', ['pnpm', 'install', '--frozen-lockfile'], repo);
// Run explicit package builds; the dev wrapper also requires the optional Rust
// native runner. This MVP uses the existing process adapter, not a fake runnerd.
run('corepack', ['pnpm', '--filter', '@paperclipai/plugin-sdk', 'build'], repo);
run('corepack', ['pnpm', '--filter', '@paperclipai/paperclip-runner', 'build:typescript'], repo);
run('corepack', ['pnpm', '--filter', '@paperclipai/ui', 'build'], repo);
run('corepack', ['pnpm', 'db:migrate'], repo);
