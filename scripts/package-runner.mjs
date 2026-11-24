import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.dirname(import.meta.dirname);
const temporary = mkdtempSync(path.join(os.tmpdir(), 'contractor-runner-package-'));
const stage = path.join(temporary, 'package');
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
  copy(root, '', ['LICENSE', 'bin/contractor.mjs',
    'src/commands.ts', 'src/config.ts', 'src/github.ts',
    ...['claude-runner-adapter.ts', 'claude-runner-launch.mjs', 'code-bundle.ts', 'codex-catalog.ts', 'compatibility.ts', 'device-client.ts',
      'devices.ts', 'execution-capabilities.ts', 'isolation.ts', 'sandbox-provider.ts', 'remote-runner.ts', 'cursor.ts',
      'execution/cli.ts', 'execution/codex.ts', 'execution/protocol.ts', 'execution/worker.ts',
      'deepseek-catalog.ts', 'runner-cli.ts', 'runner-connection.ts', 'runner-credentials.ts', 'runner-profile.ts', 'worker-process.ts'].map(file => 'src/workbench/' + file),
    ...(contractorOnly ? [] : ['src/workbench/isolated-adapter.ts', 'src/workbench/legacy-device-worker.ts',
      ...['LICENSE', 'host/home.ts', 'host/plugins.ts', 'kernel/errors.ts', 'plugins/claude/agent.ts', 'plugins/codex/agent.ts',
      'protocol/client.ts', 'protocol/job.ts', 'protocol/validate.ts',
      'worker/agents.ts', 'worker/contract.ts', 'worker/usage.ts', 'worker/worker.ts'].map(file => 'upstream/autoloop/' + file)])]);
  const notices = ['# Third-party notices',
    'Contractor source in this archive is MIT. npm installs tsx and Zod with their own license files.',
    'Codex, Claude Code and the separately installed operating-system sandbox are supplied by the operator.'];
  if (!contractorOnly) notices.push('The compatibility adapter includes MIT-licensed Agent AutoLoop files. See upstream/autoloop/LICENSE.');
  writeFileSync(path.join(stage, 'THIRD_PARTY_NOTICES.md'), notices.join('\n\n') + '\n');
  const dependencies = Object.fromEntries(['tsx', 'zod']
    .map(name => [name, manifest.dependencies[name]]));
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: '@contractor/runner', version: manifest.version, description: 'Contractor execution device connector',
    type: 'module', license: manifest.license, engines: manifest.engines, bin: { contractor: 'bin/contractor.mjs' },
    dependencies,
  }, null, 2));
  mkdirSync(destination, { recursive: true });
  const artifact = path.join(destination, 'contractor-runner-' + manifest.version + '.tgz');
  execFileSync('tar', ['-czf', artifact, '-C', temporary, 'package'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'inherit',
  });
  console.log(artifact);
} finally { rmSync(temporary, { recursive: true, force: true }); }
