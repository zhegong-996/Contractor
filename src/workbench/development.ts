import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { command } from '../commands.ts';
import { runtime } from '../config.ts';
import { allowedFile } from '../github.ts';
import type { Settings } from './config.ts';
import { commitSha } from './github-delivery.ts';

export type DevelopmentTarget = { repository: string; base: string; paths: string[] };
export type Development = DevelopmentTarget & { branch: string; baseSha: string; commit?: string };
export const developmentFolder = (ticket: string) => runtime('development', ticket);
export const checkoutFor = (config: Settings['attribution'], repository: string) => Object.entries(config?.checkouts ?? {})
  .find(([name]) => name.toLowerCase() === repository.toLowerCase())?.[1];
const git = async (cwd: string, ...args: string[]) => (await command('git', args, cwd)).trimEnd();

export async function developmentCheckout(config: Settings['attribution'], target: DevelopmentTarget, ticket: string): Promise<Development> {
  const checkout = checkoutFor(config, target.repository);
  if (!checkout || !config) throw new Error('此仓库尚未配置本地执行工作区。');
  const remote = await git(checkout, 'remote', 'get-url', 'origin');
  if (remote.toLowerCase() !== ('https://github.com/' + target.repository + '.git').toLowerCase())
    throw new Error('本地仓库与授权交付目标不一致。');
  const folder = developmentFolder(ticket);
  const branch = 'suitme/' + ticket;
  const remoteBase = 'refs/remotes/origin/' + target.base;
  const existing = await lstat(path.join(folder, '.git')).then(() => true, () => false);
  const marker = runtime('development', ticket + '.json');
  await git(checkout, 'fetch', '--no-tags', '--no-write-fetch-head', 'origin', '+refs/heads/' + target.base + ':' + remoteBase);
  const remoteSha = commitSha.parse(await git(checkout, 'rev-parse', remoteBase));
  if (!existing) {
    await mkdir(runtime('development'), { recursive: true, mode: 0o700 });
    await git(checkout, 'worktree', 'add', '-b', branch, folder, remoteSha);
    await writeFile(marker, JSON.stringify({ ...target, branch, baseSha: remoteSha }), { mode: 0o600, flag: 'wx' });
  }
  const saved = JSON.parse(await readFile(marker, 'utf8')) as Development;
  if (saved.repository !== target.repository || saved.base !== target.base || saved.branch !== branch
    || JSON.stringify(saved.paths) !== JSON.stringify(target.paths)) throw new Error('本地工作区授权已变化。');
  if (!existing || !await lstat(path.join(folder, '.entire/settings.local.json')).then(() => true, () => false)) {
    // Entire installs its upstream hooks locally. Git shares checkpoint refs with the dedicated checkout.
    for (const engine of ['codex', 'cursor'])
      await command(config.entireCommand, ['enable', '--agent', engine,
        '--local', '--skip-push-sessions', '--telemetry=false', '--absolute-git-hook-path',
        '--agent-help-skill=false', '--search-skill=false'], folder);
  }
  if (await git(folder, 'branch', '--show-current') !== branch) throw new Error('本地分支已经变化。');
  if (existing && (await changedFiles(folder)).some(file => !allowedFile(file, target.paths)))
    throw new Error('本地工作区存在范围外改动。');
  if (remoteSha !== saved.baseSha || commitSha.parse(await git(folder, 'rev-parse', 'HEAD')) !== remoteSha)
    throw new Error('代码基线已经变化。');
  return saved;
}

async function changedFiles(folder: string) {
  const [staged, unstaged, untracked] = await Promise.all([
    git(folder, 'diff', '--cached', '--name-only', '--no-renames', '-z'),
    git(folder, 'diff', '--name-only', '--no-renames', '-z'),
    git(folder, 'ls-files', '--others', '--exclude-standard', '-z'),
  ]);
  const localHooks = new Set(['.codex/hooks.json', '.cursor/hooks.json', '.entire/.gitignore', '.codex/config.toml']);
  return [...new Set([...staged.split('\0'), ...unstaged.split('\0'),
    ...untracked.split('\0').filter(name => !localHooks.has(name))].filter(Boolean))];
}

export async function commitDevelopment(ticket: string, work: Development, run: number) {
  const folder = developmentFolder(ticket);
  if (await git(folder, 'branch', '--show-current') !== work.branch) throw new Error('本地分支已经变化。');
  const head = await git(folder, 'rev-parse', 'HEAD');
  if (head !== work.baseSha) {
    const parent = await git(folder, 'rev-parse', 'HEAD^');
    const subject = await git(folder, 'show', '-s', '--format=%s', 'HEAD');
    if (parent !== work.baseSha || subject !== 'SuitMe ' + ticket + ' run ' + run || (await changedFiles(folder)).length)
      throw new Error('发现执行范围外的本地提交。');
    return commitSha.parse(head);
  }
  const files = await changedFiles(folder);
  if (!files.length) throw new Error('本轮尚未生成可提交的文件。');
  for (const file of files) {
    if (!allowedFile(file, work.paths)) throw new Error('改动超出受托路径。');
    let current = folder;
    for (const part of file.split('/')) {
      current = path.join(current, part);
      const item = await lstat(current).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (item?.isSymbolicLink()) throw new Error('交付文件不能经过符号链接。');
    }
  }
  await git(folder, 'diff', '--check');
  await git(folder, 'add', '-A', '--', ...files);
  await git(folder, 'diff', '--cached', '--check');
  // Keep Entire's upstream commit hooks on so the exact code commit receives its checkpoint.
  await git(folder, 'commit', '-m', 'SuitMe ' + ticket + ' run ' + run, '--', ...files);
  return commitSha.parse(await git(folder, 'rev-parse', 'HEAD'));
}
