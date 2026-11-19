import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.dirname(import.meta.dirname);
const temporary = mkdtempSync(path.join(os.tmpdir(), 'contractor-runner-package-'));
const stage = path.join(temporary, 'package');
const contractorOnly = process.argv.includes('--contractor-only');
const target = process.argv.slice(2).find(arg => arg !== '--contractor-only');
const destination = path.resolve(target ?? path.join(root, 'dist', 'runner'));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const sandboxPackage = '@anthropic-ai/sandbox-runtime';
const bundled = new Set();

function bundleDependency(name) {
  if (bundled.has(name)) return;
  const entry = 'node_modules/' + name;
  const source = path.join(root, entry);
  const pinned = lock.packages[entry];
  const dependency = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  const nested = path.join(source, 'node_modules');
  if (!pinned?.integrity || pinned.version !== dependency.version || existsSync(nested) && readdirSync(nested).length > 0)
    throw new Error('执行端的随包依赖须匹配已审计的锁文件：' + name);
  const target = path.join(stage, entry);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  bundled.add(name);
  if (name === sandboxPackage) {
    // npm only applies overrides from the installer's root. Pin the package's existing zod/v3 import in the bundle itself.
    dependency.dependencies.zod = manifest.dependencies.zod;
    writeFileSync(path.join(target, 'package.json'), JSON.stringify(dependency, null, 2) + '\n');
  }
  for (const child of Object.keys(dependency.dependencies ?? {})) bundleDependency(child);
}

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
    ...['claude-runner-adapter.ts', 'claude-runner-launch.mjs', 'code-bundle.ts', 'codex-catalog.ts', 'compatibility.ts', 'device-client.ts',
      'devices.ts', 'execution-capabilities.ts', 'isolation.ts', 'remote-runner.ts', 'cursor.ts',
      'execution/cli.ts', 'execution/codex.ts', 'execution/protocol.ts', 'execution/worker.ts',
      'runner-cli.ts', 'runner-connection.ts', 'runner-profile.ts', 'worker-process.ts'].map(file => 'src/workbench/' + file),
    ...(contractorOnly ? [] : ['src/workbench/isolated-adapter.ts', 'src/workbench/legacy-device-worker.ts',
      ...['LICENSE', 'host/home.ts', 'host/plugins.ts', 'kernel/errors.ts', 'plugins/claude/agent.ts', 'plugins/codex/agent.ts',
      'protocol/client.ts', 'protocol/job.ts', 'protocol/validate.ts',
      'worker/agents.ts', 'worker/contract.ts', 'worker/usage.ts', 'worker/worker.ts'].map(file => 'upstream/autoloop/' + file)])]);
  bundleDependency(sandboxPackage);
  const dependencies = Object.fromEntries(['tsx', 'zod', sandboxPackage]
    .map(name => [name, manifest.dependencies[name]]));
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: '@contractor/runner', version: manifest.version, description: 'Contractor execution device connector',
    type: 'module', license: manifest.license, engines: manifest.engines, bin: { contractor: 'bin/contractor.mjs' },
    dependencies, bundleDependencies: [sandboxPackage, 'zod'],
  }, null, 2));
  mkdirSync(destination, { recursive: true });
  const artifact = path.join(destination, 'contractor-runner-' + manifest.version + '.tgz');
  execFileSync('tar', ['-czf', artifact, '-C', temporary, 'package'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'inherit',
  });
  console.log(artifact);
} finally { rmSync(temporary, { recursive: true, force: true }); }
