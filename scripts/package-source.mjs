import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.dirname(import.meta.dirname);
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(root, 'sources.lock.json'), 'utf8'));
const name = manifest.name + '-' + manifest.version;
const args = process.argv.slice(2);
const committed = args.includes('--committed');
const destination = path.resolve(args.find(value => value !== '--committed') ?? path.join(root, 'dist', 'source'));
const stage = mkdtempSync(path.join(os.tmpdir(), 'contractor-source-'));

const publicPaths = [
  '.gitignore', '.gitmodules', '.github/workflows/ci.yml', 'AGENTS.md', 'CONTRIBUTING.md', 'LICENSE', 'README.md',
  'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'sources.lock.json', 'tsconfig.json',
  'bin', 'fixtures', 'integrations', 'licenses', 'scripts', 'src', 'tests', 'workbench',
  'docs/ARCHITECTURE.md', 'docs/PLUGIN-ARCHITECTURE.md', 'docs/SOURCES.md', 'docs/WORKBENCH-OCTOP.md',
  'docs/WORKBENCH-IM-LOGIN.md', 'docs/WORKBENCH-PROJECT-ARCHITECTURE.md',
  'docs/WORKBENCH-DELIVERY-TEMPLATE.md', 'docs/WORKBENCH-REMOTE-RUNNER.md',
];
const files = (directory, selection = []) => [...new Set(execFileSync('git', [
  'ls-files', '-z', '--cached', ...(committed ? [] : ['--others', '--exclude-standard']), '--', ...selection,
], { cwd: directory, encoding: 'utf8' }).split('\0').filter(Boolean))];

function checkCommitted(directory, selection) {
  if (committed) execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...selection], { cwd: directory });
}

function copy(directory, prefix, names) {
  for (const item of names) {
    const source = path.join(directory, item);
    const stat = lstatSync(source, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isFile()) throw new Error('发布范围只允许普通文件：' + item);
    const target = path.join(stage, name, prefix, item);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

try {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/audit-upstream.ts'], { cwd: root, stdio: 'inherit' });
  checkCommitted(root, publicPaths);
  copy(root, '', files(root, publicPaths));
  for (const upstream of Object.keys(lock.sources)) {
    const prefix = path.join('upstream', upstream);
    const directory = path.join(root, prefix);
    const selection = upstream.startsWith('octop-') ? ['LICENSE', 'README.md', 'pyproject.toml', 'src'] : [];
    checkCommitted(directory, selection);
    copy(directory, prefix, files(directory, selection));
  }
  mkdirSync(destination, { recursive: true });
  const artifact = path.join(destination, name + '.tar.gz');
  execFileSync('tar', ['-czf', artifact, '-C', stage, name], {
    env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'inherit',
  });
  console.log(artifact);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
