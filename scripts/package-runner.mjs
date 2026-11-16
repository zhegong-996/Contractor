import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.dirname(import.meta.dirname);
const stage = mkdtempSync(path.join(os.tmpdir(), 'suitme-runner-package-'));
const destination = path.join(root, 'dist', 'runner');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

function copy(source, prefix, names) {
  for (const name of names) {
    if (!name) continue;
    const target = path.join(stage, prefix, name);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(source, name), target);
  }
}

function trackedFiles(repo, paths) {
  return execFileSync('git', ['ls-files', '-z', ...paths], { cwd: repo, encoding: 'utf8' }).split('\0');
}

try {
  copy(root, '', trackedFiles(root, ['src']).concat(['bin/suitme.mjs', 'THIRD_PARTY_NOTICES.md']));
  for (const prefix of ['upstream/autoloop', 'upstream/superagent']) {
    const upstream = path.join(root, prefix);
    copy(upstream, prefix, trackedFiles(upstream, []));
  }
  const dependencies = Object.fromEntries(['tsx', 'zod', '@anthropic-ai/sandbox-runtime', '@backstage/catalog-model']
    .map(name => [name, manifest.dependencies[name]]));
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: '@suitme/runner', version: manifest.version, description: 'SuitMe execution device connector',
    type: 'module', engines: manifest.engines, bin: { suitme: 'bin/suitme.mjs' },
    dependencies, overrides: manifest.overrides,
  }, null, 2));
  mkdirSync(destination, { recursive: true });
  execFileSync('npm', ['pack', stage, '--ignore-scripts', '--pack-destination', destination, '--silent'], { stdio: 'inherit' });
} finally { rmSync(stage, { recursive: true, force: true }); }
