import { mkdir, writeFile, readFile, copyFile, access, lstat } from 'node:fs/promises';
import path from 'node:path';
import { command } from './commands.ts';
import type { Config } from './config.ts';
import { runtime, root } from './config.ts';
import type { Delivery, Task } from './store.ts';

/** 交付适配器接口：GitHub 与本机 Git 服务都必须实现同样四个动作。 */
export interface DeliveryAdapter {
  prepare(id: string): Promise<{ workspace: string; branch: string; baseSha: string }>;
  publish(task: Task): Promise<Delivery>;
  inspect(pr: number): Promise<Delivery>;
  preview(task: Task): Promise<Delivery>;
}

export function allowedFile(file: string, allowed: string[]): boolean {
  if (!file || file.startsWith('/') || file.split('/').some(p => p === '..') || file.includes('\\')) return false;
  return allowed.some(prefix => prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix);
}
export function parsePr(url: string, repository: string): number {
  const u = new URL(url); const expected = `/${repository}/pull/`;
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || !u.pathname.toLowerCase().startsWith(expected.toLowerCase())) throw new Error('PR is outside the configured repository');
  const value = u.pathname.slice(expected.length); if (!/^\d+\/?$/.test(value)) throw new Error('Invalid PR URL'); return Number(value.replace('/', ''));
}
async function noSymlink(rootPath: string, file: string) {
  let current = rootPath;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Delivery paths must not contain symbolic links'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
export class Github implements DeliveryAdapter {
  constructor(readonly config: Config) {}
  async api(route: string) { return JSON.parse(await command('gh', ['api', `repos/${this.config.repository}/${route}`])); }
  async prepare(id: string) {
    const workspace = path.join(runtime('tasks'), id, 'worktree'); const branch = `collab/${id.slice(0, 12)}`;
    if (await access(path.join(workspace, '.git')).then(() => true).catch(() => false)) {
      const currentBranch = (await command('git', ['branch', '--show-current'], workspace)).trim();
      if (currentBranch !== branch) throw new Error('Retained workspace branch does not match the task');
      return { workspace, branch, baseSha: (await command('git', ['merge-base', 'HEAD', 'origin/main'], workspace)).trim() };
    }
    await command('git', ['fetch', 'origin', 'main'], this.config.checkout);
    await mkdir(path.dirname(workspace), { recursive: true });
    await command('git', ['worktree', 'add', '-b', branch, workspace, 'origin/main'], this.config.checkout);
    return { workspace, branch, baseSha: (await command('git', ['rev-parse', 'HEAD'], workspace)).trim() };
  }
  async publish(task: Task): Promise<Delivery> {
    const taskPaths: string[] = JSON.parse(task.context).allowedPaths ?? [];
    const permitted = (file: string) => allowedFile(file, this.config.allowedPaths) && allowedFile(file, taskPaths);
    if ((await command('git', ['branch', '--show-current'], task.workspace)).trim() !== task.branch) throw new Error('Workspace branch changed');
    if (permitted('.github/workflows/collab-pilot.yml')) {
      await noSymlink(task.workspace, '.github/workflows/collab-pilot.yml');
      await mkdir(path.join(task.workspace, '.github/workflows'), { recursive: true });
      await copyFile(path.join(root, 'fixtures/collab-pilot.yml'), path.join(task.workspace, '.github/workflows/collab-pilot.yml'));
    }
    await command('git', ['diff', '--check'], task.workspace);
    const status = await command('git', ['status', '--porcelain=v1', '-uall', '-z'], task.workspace);
    const files = status.split('\0').filter(Boolean).map(line => line.slice(3));
    if (files.some(f => !permitted(f))) throw new Error('Changes exceed task or project allowedPaths');
    for (const file of files) await noSymlink(task.workspace, file);
    if (files.length) {
      await command('git', ['add', '--', ...files], task.workspace);
      await command('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', `${task.identifier}：交付协作试点任务`], task.workspace);
    }
    const headSha = (await command('git', ['rev-parse', 'HEAD'], task.workspace)).trim();
    const taskBase: string = JSON.parse(task.context).baseSha;
    if (!/^[a-f0-9]{40}$/.test(taskBase)) throw new Error('Task base commit is missing');
    const committedFiles = (await command('git', ['diff', '--name-only', '--no-renames', '-z', taskBase, 'HEAD'], task.workspace)).split('\0').filter(Boolean);
    if (committedFiles.some(file => !permitted(file))) throw new Error('Committed changes exceed task or project allowedPaths');
    for (const file of committedFiles) await noSymlink(task.workspace, file);
    const baseSha = (await command('git', ['rev-parse', 'origin/main'], task.workspace)).trim();
    if (headSha === baseSha) throw new Error('No code change to deliver');
    await command('git', ['-c', 'core.hooksPath=/dev/null', 'push', `https://github.com/${this.config.repository}.git`, `HEAD:refs/heads/${task.branch}`], task.workspace);
    const pulls = await this.api(`pulls?state=open&head=${encodeURIComponent(this.config.repository.split('/')[0] + ':' + task.branch)}`);
    let pr = pulls.find((p: any) => p.head.ref === task.branch);
    if (!pr) {
      const bodyFile = path.join(runtime('tasks'), task.id, 'pr-body.md');
      await writeFile(bodyFile, `任务：${task.identifier}\n\n本 PR 由 SuitMe 协作台关联交付。\n\n- 范围：${this.config.allowedPaths.join('、')}\n- 验收：以指定提交的 CI、预览版本及逐项验收记录为准。\n- Agent 完成本轮不代表业务验收通过。\n`);
      try {
        const url = (await command('gh', ['pr', 'create', '--repo', this.config.repository, '--head', task.branch, '--base', 'main', '--title', `${task.identifier}：协作试点交付`, '--body-file', bodyFile], task.workspace)).trim();
        pr = await this.api(`pulls/${parsePr(url, this.config.repository)}`);
      } catch (error) {
        // Reconcile a lost create response instead of creating another PR.
        const found = await this.api(`pulls?state=open&head=${encodeURIComponent(this.config.repository.split('/')[0] + ':' + task.branch)}`);
        pr = found.find((p: any) => p.head.ref === task.branch); if (!pr) throw error;
      }
    }
    return { pr: pr.number, url: pr.html_url, headSha, ci: 'pending', merged: Boolean(pr.merged_at) };
  }
  async inspect(prNumber: number): Promise<Delivery> {
    const pr = await this.api(`pulls/${prNumber}`);
    const checks = await this.api(`commits/${pr.head.sha}/check-runs`);
    const expected = checks.check_runs.filter((c: any) => c.name === 'collab-pilot' && c.app?.slug === 'github-actions')
      .sort((a: any, b: any) => b.id - a.id).slice(0, 1);
    const ci = expected.some((c: any) => c.status === 'completed' && c.conclusion !== 'success') ? 'failed'
      : expected.length && expected.every((c: any) => c.status === 'completed' && c.conclusion === 'success') ? 'passed' : 'pending';
    return { pr: pr.number, url: pr.html_url, headSha: pr.head.sha, ci, merged: Boolean(pr.merged_at), ...(pr.merged_at ? { mergeSha: pr.merge_commit_sha } : {}) };
  }
  async preview(task: Task): Promise<Delivery> {
    if (!task.delivery || task.delivery.ci !== 'passed') throw new Error('Exact-commit CI must pass before preview');
    const delivery = await this.inspect(task.delivery.pr);
    if (delivery.headSha !== task.delivery.headSha || delivery.ci !== 'passed') throw new Error('PR changed since CI evidence was recorded');
    const runs = await this.api(`actions/runs?head_sha=${delivery.headSha}&status=success`);
    let selected: any;
    for (const run of runs.workflow_runs.filter((r: any) => r.path === '.github/workflows/collab-pilot.yml')) {
      const artifacts = await this.api(`actions/runs/${run.id}/artifacts`);
      if (artifacts.artifacts.some((a: any) => a.name === `collab-pilot-${delivery.headSha}` && !a.expired)) { selected = run; break; }
    }
    if (!selected) throw new Error('No matching CI artifact found');
    const dir = runtime('previews', task.id, delivery.headSha); await mkdir(dir, { recursive: true });
    const cached = await readFile(path.join(dir, 'version.json'), 'utf8').then(s => JSON.parse(s).commit === delivery.headSha).catch(() => false);
    const hasPage = await access(path.join(dir, 'index.html')).then(() => true).catch(() => false);
    if (!cached || !hasPage) await command('gh', ['run', 'download', String(selected.id), '--repo', this.config.repository, '--name', `collab-pilot-${delivery.headSha}`, '--dir', dir]);
    const version = JSON.parse(await readFile(path.join(dir, 'version.json'), 'utf8'));
    if (version.commit !== delivery.headSha) throw new Error('CI artifact version does not match delivery commit');
    await readFile(path.join(dir, 'index.html'), 'utf8');
    return { ...delivery, artifactRunId: selected.id, environment: version.kind === 'files' ? 'local-artifact-preview' : 'local-pr-preview', artifactKind: version.kind ?? 'page', deployedSha: version.commit,
      previewUrl: `http://127.0.0.1:${this.config.bridgePort}/preview/${task.id}/${delivery.headSha}/index.html` };
  }
}
