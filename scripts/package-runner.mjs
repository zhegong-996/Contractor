import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.dirname(import.meta.dirname);
const stage = mkdtempSync(path.join(os.tmpdir(), 'contractor-runner-package-'));
const contractorOnly = process.argv.includes('--contractor-only');
const target = process.argv.slice(2).find(arg => arg !== '--contractor-only');
const destination = path.resolve(target ?? path.join(root, 'dist', 'runner'));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

function copy(source, prefix, names) {
  for (const name of names) {
    if (!name) continue;
    const target = path.join(stage, prefix, name);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(source, name), target);
  }
}

try {
  copy(root, '', ['LICENSE', 'bin/contractor.mjs', 'THIRD_PARTY_NOTICES.md', 'licenses/sandbox-runtime-APACHE-2.0.txt',
    'src/commands.ts', 'src/config.ts', 'src/github.ts',
    ...['claude-runner-adapter.ts', 'claude-runner-launch.mjs', 'code-bundle.ts', 'compatibility.ts', 'device-client.ts',
      'devices.ts', 'execution-capabilities.ts', 'isolation.ts', 'remote-runner.ts', 'cursor.ts',
      'execution/cli.ts', 'execution/codex.ts', 'execution/protocol.ts', 'execution/worker.ts',
      'runner-cli.ts', 'runner-connection.ts', 'runner-profile.ts', 'worker-process.ts'].map(file => 'src/workbench/' + file),
    ...(contractorOnly ? [] : ['src/workbench/isolated-adapter.ts', 'src/workbench/legacy-device-worker.ts',
      ...['LICENSE', 'host/home.ts', 'host/plugins.ts', 'kernel/errors.ts', 'plugins/claude/agent.ts', 'plugins/codex/agent.ts',
      'protocol/client.ts', 'protocol/job.ts', 'protocol/validate.ts',
      'worker/agents.ts', 'worker/contract.ts', 'worker/usage.ts', 'worker/worker.ts'].map(file => 'upstream/autoloop/' + file)])]);
  const dependencies = Object.fromEntries(['tsx', 'zod', '@anthropic-ai/sandbox-runtime']
    .map(name => [name, manifest.dependencies[name]]));
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: '@contractor/runner', version: manifest.version, description: 'Contractor execution device connector',
    type: 'module', license: manifest.license, engines: manifest.engines, bin: { contractor: 'bin/contractor.mjs' },
    dependencies, overrides: manifest.overrides,
  }, null, 2));
  mkdirSync(destination, { recursive: true });
  execFileSync('npm', ['pack', stage, '--ignore-scripts', '--pack-destination', destination, '--silent'], { stdio: 'inherit' });
} finally { rmSync(stage, { recursive: true, force: true }); }
