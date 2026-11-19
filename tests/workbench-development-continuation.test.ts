import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

test('真实本地 Git 保留交接改动，多轮提交沿用本单历史，基线漂移需确认且冲突回退', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'contractor-git-continuation-'));
  const originalPath = process.env.PATH;
  process.env.COLLAB_STATE_DIR = dir;
  const checkout = path.join(dir, 'checkout'), remote = path.join(dir, 'remote.git'), bin = path.join(dir, 'bin');
  await mkdir(checkout); await mkdir(bin);
  const git = (cwd: string, ...args: string[]) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(checkout, 'init', '-b', 'main'); git(checkout, 'config', 'user.name', 'Contractor local test');
  git(checkout, 'config', 'user.email', 'test@example.invalid');
  await mkdir(path.join(checkout, 'collab-pilot')); await writeFile(path.join(checkout, 'collab-pilot/index.html'), 'base\n');
  git(checkout, 'add', 'collab-pilot/index.html'); git(checkout, 'commit', '-m', 'base');
  git(dir, 'clone', '--bare', checkout, remote); git(checkout, 'remote', 'add', 'origin', 'https://github.com/team/test.git');
  // Only the fetch transport is local. All worktrees, commits, diffs and rebases use the real Git binary.
  await writeFile(path.join(bin, 'git'), '#!' + process.execPath + '\n'
    + 'const cp=require("node:child_process");const a=process.argv.slice(2);'
    + 'if(a[0]==="fetch"||a[0]==="ls-remote")a[a.indexOf("origin")]=' + JSON.stringify(remote) + ';'
    + 'const r=cp.spawnSync("/usr/bin/git",a,{stdio:"inherit"});process.exit(r.status??1);\n');
  await chmod(path.join(bin, 'git'), 0o700); process.env.PATH = bin + path.delimiter + originalPath;
  t.after(async () => { process.env.PATH = originalPath; await rm(dir, { recursive: true, force: true }); });
  const { developmentCheckout, developmentChanges, developmentFolder, commitDevelopment } = await import('../src/workbench/development.ts');
  const config = { entireCommand: '/usr/bin/true', checkouts: { 'team/test': checkout } };
  const target = { repository: 'team/test', base: 'main', paths: ['collab-pilot/'] };
  const one = await developmentCheckout(config, target, 'test-ticket');
  const folder = developmentFolder('test-ticket');
  await writeFile(path.join(folder, 'collab-pilot/index.html'), 'confirmed scene\n');
  await writeFile(path.join(folder, 'collab-pilot/notes.txt'), 'confirmed by product\n');
  const transferred = await developmentCheckout(config, target, 'test-ticket');
  const snapshot = await developmentChanges('test-ticket', transferred);
  assert.match(snapshot.diff, /confirmed scene/); assert.equal(snapshot.untracked[0]!.file, 'collab-pilot/notes.txt');
  assert.equal(snapshot.untracked[0]!.sha256.length, 64);
  const first = await commitDevelopment('test-ticket', transferred, 1);
  await assert.rejects(developmentCheckout(config, target, 'test-ticket'), /上轮受托记录/);
  const two = await developmentCheckout(config, target, 'test-ticket', { commit: first });
  assert.equal(two.startSha, first);
  await writeFile(path.join(folder, 'collab-pilot/index.html'), 'confirmed scene\nstore sample\n');
  const second = await commitDevelopment('test-ticket', two, 2);
  assert.equal(git(folder, 'rev-parse', second + '^'), first);
  assert.equal(await commitDevelopment('test-ticket', two, 2), second, '同次回执不能再提交一次');

  git(folder, 'push', remote, first + ':refs/heads/' + one.branch);
  const retry = { discarded: second, start: first };
  const untracked = path.join(folder, 'collab-pilot/local.txt');
  await writeFile(untracked, 'uncommitted work');
  await assert.rejects(developmentCheckout(config, target, 'test-ticket', { retry }), /无法安全/);
  await rm(untracked);
  assert.equal((await developmentCheckout(config, target, 'test-ticket', { retry })).startSha, first);
  assert.equal(git(folder, 'rev-parse', 'refs/contractor/discarded/' + second), second);
  assert.equal((await developmentCheckout(config, target, 'test-ticket', { retry })).startSha, first);
  git(folder, 'reset', '--hard', second);

  await writeFile(path.join(checkout, 'README.md'), 'new upstream base\n');
  git(checkout, 'add', 'README.md'); git(checkout, 'commit', '-m', 'upstream move'); git(checkout, 'push', remote, 'main');
  const newBase = git(checkout, 'rev-parse', 'HEAD');
  await assert.rejects(developmentCheckout(config, target, 'test-ticket', { commit: second }), /基线已经变化/);
  assert.equal(git(folder, 'rev-parse', 'HEAD'), second);
  const rebased = await developmentCheckout(config, target, 'test-ticket', { commit: second, baseSha: newBase });
  assert.equal(rebased.baseSha, newBase); assert.notEqual(rebased.startSha, second);
  assert.equal(git(folder, 'merge-base', 'HEAD', newBase), newBase);
  await developmentCheckout(config, target, 'test-ticket', { commit: second, baseSha: newBase });
  await writeFile(path.join(folder, 'collab-pilot/index.html'), 'confirmed scene\nstore sample, try on site\n');
  const third = await commitDevelopment('test-ticket', rebased, 3);
  assert.equal((await developmentCheckout(config, target, 'test-ticket', { commit: third, baseSha: newBase })).startSha, third);

  await writeFile(path.join(checkout, 'collab-pilot/index.html'), 'conflicting upstream requirement\n');
  git(checkout, 'add', 'collab-pilot/index.html'); git(checkout, 'commit', '-m', 'upstream conflict'); git(checkout, 'push', remote, 'main');
  const conflictingBase = git(checkout, 'rev-parse', 'HEAD');
  await assert.rejects(developmentCheckout(config, target, 'test-ticket', { commit: third, baseSha: conflictingBase }), /冲突/);
  assert.equal(git(folder, 'rev-parse', 'HEAD'), third); assert.equal(git(folder, 'branch', '--show-current'), one.branch);
  assert.match(await readFile(path.join(folder, 'collab-pilot/index.html'), 'utf8'), /try on site/);
});
