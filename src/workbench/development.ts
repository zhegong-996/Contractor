import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { command } from '../commands.ts';
import { runtime } from '../config.ts';
import { allowedFile } from '../github.ts';
import type { Settings } from './config.ts';
import { commitSha } from './github-delivery.ts';

export type DevelopmentTarget = { repository: string; base: string; paths: string[] };
export type Development = DevelopmentTarget & { branch: string; baseSha: string; startSha?: string; commit?: string; rebasedFrom?: string };
export const developmentFolder = (ticket: string) => runtime('development', ticket);
export const checkoutFor = (config: Settings['attribution'], repository: string) => Object.entries(config?.checkouts ?? {})
  .find(([name]) => name.toLowerCase() === repository.toLowerCase())?.[1];
const git = async (cwd: string, ...args: string[]) => (await command('git', args, cwd)).trimEnd();

export async function developmentCheckout(config: Settings['attribution'], target: DevelopmentTarget, ticket: string,
  continuation?: { commit?: string; baseSha?: string; retry?: { discarded: string; start: string } }): Promise<Development> {
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
  if (continuation?.retry && !existing) throw new Error('找不到本版原工作区，无法接续本地修正。');
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
  let head = commitSha.parse(await git(folder, 'rev-parse', 'HEAD'));
  if (continuation?.retry) {
    const { discarded, start } = continuation.retry;
    const remoteHead = (await git(checkout, 'ls-remote', '--heads', 'origin', 'refs/heads/' + branch)).split('\t')[0];
    if (remoteSha !== saved.baseSha || remoteHead !== start || (head !== discarded && head !== start)
      || await git(folder, 'rev-parse', discarded + '^') !== start || (await changedFiles(folder)).length)
      throw new Error('本地改动或远端基线已变化，无法安全从本版起点修正。');
    if (head === discarded) {
      await git(folder, 'update-ref', 'refs/suitme/discarded/' + discarded, discarded);
      await git(folder, 'reset', '--hard', start);
      head = start;
    }
    return { ...saved, startSha: head };
  }
  const expected = saved.startSha && saved.rebasedFrom === continuation?.commit && continuation?.baseSha === saved.baseSha
    ? saved.startSha : continuation?.commit ?? saved.startSha ?? saved.baseSha;
  if (head !== expected) throw new Error('工作区提交与上轮受托记录不同，需研发核对。');
  if (remoteSha !== saved.baseSha) {
    if (continuation?.baseSha !== remoteSha) throw new Error('代码基线已经变化，请研发确认新的基线提交后接续。');
    if ((await changedFiles(folder)).length) throw new Error('基线变化且有未提交改动，请研发先处理工作区。');
    try {
      // Only an explicit repository contributor can supply this exact new base SHA.
      await git(folder, 'rebase', '--onto', remoteSha, saved.baseSha, saved.branch);
    } catch {
      await git(folder, 'rebase', '--abort').catch(() => undefined);
      throw new Error('新基线存在冲突，已中止自动接续，请研发处理。');
    }
    head = commitSha.parse(await git(folder, 'rev-parse', 'HEAD'));
    saved.rebasedFrom = continuation?.commit;
    saved.baseSha = remoteSha;
    saved.startSha = head;
    await writeFile(marker, JSON.stringify(saved), { mode: 0o600 });
  }
  return { ...saved, startSha: head };
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
  const start = work.startSha ?? work.baseSha;
  if (head !== start) {
    const parent = await git(folder, 'rev-parse', 'HEAD^');
    const subject = await git(folder, 'show', '-s', '--format=%s', 'HEAD');
    if (parent !== start || subject !== 'SuitMe ' + ticket + ' run ' + run || (await changedFiles(folder)).length)
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

export async function developmentChanges(ticket: string, work: Development) {
  const folder = developmentFolder(ticket);
  const files = await changedFiles(folder);
  if (files.some(file => !allowedFile(file, work.paths))) throw new Error('交接包含范围外改动。');
  const diff = await git(folder, 'diff', '--no-ext-diff', '--no-textconv', work.baseSha, '--', ...work.paths);
  const untracked = (await git(folder, 'ls-files', '--others', '--exclude-standard', '-z', '--', ...work.paths)).split('\0').filter(Boolean);
  const hashes: { file: string; sha256: string }[] = [];
  for (const file of untracked) {
    let cursor = folder;
    for (const part of file.split('/')) {
      cursor = path.join(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('交接文件不能经过符号链接。');
    }
    hashes.push({ file, sha256: createHash('sha256').update(await readFile(path.join(folder, file))).digest('hex') });
  }
  return { baseSha: work.baseSha, startSha: work.startSha ?? work.baseSha, branch: work.branch,
    files, untracked: hashes, diffHash: createHash('sha256').update(diff).digest('hex'),
    diff: diff.slice(0, 20000), truncated: diff.length > 20000 };
}
