import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { command } from '../commands.ts';
import { allowedFile } from '../github.ts';
import { bundleHash } from './code-bundle.ts';
import { protocolMatches } from './compatibility.ts';
import type { Settings } from './config.ts';
import { changedFiles, checkoutFor, type Development, type DevelopmentTarget } from './development.ts';
import { commitSha } from './github-delivery.ts';
import { exportCodeBundle, importRemoteCode } from './isolation.ts';
import type { Assembled, Work } from './work-types.ts';

const git = async (cwd: string, ...args: string[]) => (await command('git', args, cwd)).trimEnd();

const sameTarget = (a: DevelopmentTarget, b: DevelopmentTarget) => a.repository === b.repository && a.base === b.base
  && JSON.stringify(a.paths) === JSON.stringify(b.paths);

async function plain(file: string, directory: boolean) {
  const info = await lstat(file);
  if ((directory ? !info.isDirectory() : !info.isFile()) || await realpath(file) !== file)
    throw new Error('代码迁移需要原目录中的普通工作树和登记文件。');
}

/** Recreate the stopped branch in a private independent checkout that survives renaming the staged runtime directory. */
export async function stageDevelopmentWorktrees(source: string, stage: string, config: Settings, db: DatabaseSync) {
  const development = path.join(source, 'development');
  const entries = await readdir(development).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return [] as string[];
  });
  if (!entries.length) return;
  await plain(development, true);
  const tickets = entries.filter(name => /^[a-zA-Z0-9_-]{1,80}$/.test(name));
  if (entries.length !== tickets.length * 2 || !tickets.every(ticket => entries.includes(ticket + '.json')))
    throw new Error('Git 工作树和登记文件不完整，请在迁移前核对。');
  await mkdir(path.join(stage, 'development'), { mode: 0o700 });
  const record = db.prepare('SELECT value FROM workbench_ticket WHERE id=?');
  const manifest = db.prepare(`SELECT run,attempt,value FROM workbench_manifest WHERE ticket=? AND json_type(value,'$.development')='object'
    ORDER BY run DESC,attempt DESC LIMIT 1`);
  for (const ticket of tickets.sort()) {
    const folder = path.join(development, ticket);
    const marker = folder + '.json';
    await plain(folder, true);
    await plain(marker, false);
    const row = record.get(ticket);
    const last = manifest.get(ticket);
    if (!row || !last) throw new Error('未找到 Git 工作树对应的受托运行记录。');
    const work = JSON.parse(String(row.value)) as Work;
    const execution = JSON.parse(String(last.value)) as Assembled;
    const saved = JSON.parse(await readFile(marker, 'utf8')) as Development;
    const known = execution.development;
    if (!work.development || !known || !sameTarget(saved, work.development) || !sameTarget(saved, known)
      || !protocolMatches(saved.branch, 'contractor/' + ticket) || known.branch !== saved.branch || known.baseSha !== saved.baseSha)
      throw new Error('代码工作树与工单、分支或冻结基线不一致。');
    const base = commitSha.parse(saved.baseSha);
    const head = commitSha.parse(await git(folder, 'rev-parse', 'HEAD'));
    if (head !== (known.commit ?? known.startSha ?? base) || await git(folder, 'branch', '--show-current') !== saved.branch)
      throw new Error('代码工作区提交与原运行记录不同，请先由研发核对。');
    if (execution.isolation?.boundary === 'remote' && !db.prepare(`SELECT 1 FROM workbench_device_stop
      WHERE run=? AND attempt=? AND state IN ('exited','not-launched')`).get(last.run, last.attempt))
      throw new Error('缺少该代码轮次的远程停止证明。');
    const trusted = checkoutFor(config.attribution, saved.repository);
    const remote = `https://github.com/${saved.repository}.git`;
    if (!trusted || await git(folder, 'rev-parse', '--show-toplevel') !== folder
      || (await git(trusted, 'remote', 'get-url', 'origin')).toLowerCase() !== remote.toLowerCase()
      || (await git(folder, 'remote', 'get-url', 'origin')).toLowerCase() !== remote.toLowerCase())
      throw new Error('代码工作树与已授权仓库来源不同。');
    await git(folder, 'merge-base', '--is-ancestor', base, head);
    for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
      const state = path.resolve(folder, await git(folder, 'rev-parse', '--git-path', name));
      if (await lstat(state).catch(error => { if (error.code !== 'ENOENT') throw error; }))
        throw new Error('Git 工作区仍有未完成的合并、回放或变基。');
    }
    if (await git(folder, 'diff', '--cached', '--name-only', '--no-renames'))
      throw new Error('代码工作树有暂存区改动，请先核对暂存区和工作区。');
    if ((await changedFiles(folder)).some(file => !allowedFile(file, saved.paths)))
      throw new Error('存在原工单授权范围外的工作区改动。');
    const diff = () => git(folder, 'diff', '--binary', '--no-ext-diff', '--no-textconv', head);
    const originalDiff = await diff();
    const original = await exportCodeBundle(folder, saved.paths);
    const output = path.join(stage, 'development', ticket);
    await git(path.dirname(output), 'init', '--template=', '--initial-branch=' + saved.branch, output);
    await git(output, '-c', 'protocol.file.allow=always', 'fetch', '--no-tags', folder, head);
    await git(output, '-c', 'core.hooksPath=/dev/null', 'reset', '--hard', head);
    await git(output, 'remote', 'add', 'origin', remote);
    for (const key of ['user.name', 'user.email']) {
      const value = await git(trusted, 'config', '--get', key).catch(() => '');
      if (value) await git(output, 'config', '--local', key, value);
    }
    const baseline = await exportCodeBundle(output, saved.paths);
    const edited = Object.fromEntries([...new Set([...Object.keys(baseline.files), ...Object.keys(original.files)])]
      .filter(name => baseline.files[name] !== original.files[name]).map(name => [name, original.files[name] ?? null]));
    await importRemoteCode(output, baseline, { base: bundleHash(baseline), files: edited }, () => true);
    if (await git(output, 'diff', '--binary', '--no-ext-diff', '--no-textconv', head) !== originalDiff
      || bundleHash(await exportCodeBundle(output, saved.paths)) !== bundleHash(original)
      || await git(folder, 'rev-parse', 'HEAD') !== head || await diff() !== originalDiff
      || bundleHash(await exportCodeBundle(folder, saved.paths)) !== bundleHash(original))
      throw new Error('代码基线或未提交内容在迁移时发生变化。');
    await writeFile(output + '.json', JSON.stringify(saved), { flag: 'wx', mode: 0o600 });
  }
}
