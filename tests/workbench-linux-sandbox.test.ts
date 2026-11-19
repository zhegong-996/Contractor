import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sandboxPolicy } from '../src/workbench/isolation.ts';

test('Linux 原版 SRT：受托精确文件可写，邻接文件和宿主资料不可写读', { skip: process.platform !== 'linux' }, t => {
  execFileSync('which', ['bwrap']); // Required on supported Linux runners; do not silently weaken isolation.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'contractor-linux-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const item of ['workspace/pilot', 'home', 'input', 'temp']) mkdirSync(path.join(dir, item), { recursive: true });
  writeFileSync(path.join(dir, 'workspace/pilot/index.html'), '');
  writeFileSync(path.join(dir, 'workspace/README.md'), 'read-only');
  writeFileSync(path.join(dir, 'outside'), 'private');
  const policy = sandboxPolicy(path.join(dir, 'workspace'), path.join(dir, 'home'), path.join(dir, 'input'), '/bin/sh',
    ['pilot/index.html'], [], path.join(dir, 'temp'), ['README.md', 'pilot/index.html']);
  const file = path.join(dir, 'policy.json');
  writeFileSync(file, JSON.stringify(policy));
  const script = 'echo changed > "$1/workspace/pilot/index.html" || exit 10; '
    + 'if echo bad > "$1/workspace/README.md"; then exit 11; fi; '
    + 'if cat "$1/outside"; then exit 12; fi';
  const run = spawnSync(process.execPath, ['node_modules/@anthropic-ai/sandbox-runtime/dist/cli.js', '--settings', file,
    '--', '/bin/sh', '-c', script, 'probe', dir], { encoding: 'utf8', timeout: 15000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(path.join(dir, 'workspace/pilot/index.html'), 'utf8'), 'changed\n');
  assert.equal(readFileSync(path.join(dir, 'workspace/README.md'), 'utf8'), 'read-only');
});
