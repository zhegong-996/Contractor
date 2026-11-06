/**
 * 本机代码交付适配器：与 Github 实现同一个 DeliveryAdapter 接口，
 * 但把「push 到 github.com + gh api 建 PR + Actions 产物」换成
 * 「push 到本机裸仓库 + 本机合并请求记录 + 本机 CI 校验 + 本机预览」。
 *
 * 国内环境不需要 GitHub 账号、token 或海外网络；所有写入只发生在
 * `.runtime/git/` 与 `.runtime/previews/`，不进仓库、不出本机。
 * 注意：这里的「审批」是交付台的合并审批，不是业务验收；
 * 业务验收仍由原发起人在原会话「确认验收」，红线没有变。
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { command } from './commands.ts';
import type { Config } from './config.ts';
import { runtime } from './config.ts';
import type { Delivery, Task } from './store.ts';
import { allowedFile, type DeliveryAdapter } from './github.ts';

export type LocalCi = 'pending' | 'passed' | 'failed';
export type LocalStatus = 'open' | 'approved' | 'rejected' | 'merged';

export interface LocalDeliveryRecord {
  schemaVersion: 1;
  id: number;
  taskId: string;
  identifier: string;
  branch: string;
  baseSha: string;
  headSha: string;
  ci: LocalCi;
  status: LocalStatus;
  createdAt: string;
  updatedAt: string;
  changedFiles: string[];
  ciNote: string;
  approvals: { actor: string; decision: 'approved' | 'rejected'; at: string; note: string }[];
  notifications: { at: string; kind: string; text: string }[];
  url: string;
}

const recordFile = (id: number) => runtime('git', 'deliveries', `${id}.json`);
const now = () => new Date().toISOString();

export class LocalGitDelivery implements DeliveryAdapter {
  constructor(readonly config: Config) {}

  get repoName() { return this.config.delivery.repoName; }
  get gitPort() { return this.config.delivery.gitPort; }
  get port() { return this.config.delivery.port; }
  get bare() { return runtime('git', 'repos', `${this.repoName}.git`); }
  get cloneUrl() { return `git://127.0.0.1:${this.gitPort}/${this.repoName}.git`; }
  deliveryUrl(id: number) { return `http://127.0.0.1:${this.port}/delivery/${id}`; }

  /** 创建本机裸仓库，并把当前 checkout 的 HEAD 作为 main 基线（一次即可）。 */
  async ensureRepo(): Promise<{ bare: string; mainSha: string; cloneUrl: string }> {
    mkdirSync(path.dirname(this.bare), { recursive: true });
    if (!existsSync(this.bare)) {
      await command('git', ['init', '--bare', this.bare]);
      await command('git', ['-C', this.config.checkout, 'push', this.bare, 'HEAD:refs/heads/main']);
      await command('git', ['--git-dir', this.bare, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
    }
    const mainSha = (await command('git', ['--git-dir', this.bare, 'rev-parse', 'refs/heads/main'])).trim();
    return { bare: this.bare, mainSha, cloneUrl: this.cloneUrl };
  }

  async prepare(id: string) {
    const { mainSha } = await this.ensureRepo();
    const workspace = path.join(runtime('tasks'), id, 'worktree');
    const branch = `collab/${id.slice(0, 12)}`;
    if (existsSync(path.join(workspace, '.git'))) {
      const current = (await command('git', ['branch', '--show-current'], workspace)).trim();
      if (current !== branch) throw new Error('保留的工作区分支与任务不一致');
      return { workspace, branch, baseSha: mainSha };
    }
    await mkdir(path.dirname(workspace), { recursive: true });
    await command('git', ['-C', this.config.checkout, 'worktree', 'add', '-b', branch, workspace, mainSha]);
    return { workspace, branch, baseSha: mainSha };
  }

  private nextId(): number {
    const dir = runtime('git', 'deliveries');
    mkdirSync(dir, { recursive: true });
    const ids = readdirSync(dir).map(f => Number(/^(\d+)\.json$/.exec(f)?.[1] ?? 0)).filter(n => n > 0);
    return ids.length ? Math.max(...ids) + 1 : 1;
  }
  read(id: number): LocalDeliveryRecord | null {
    const file = recordFile(id);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8')) as LocalDeliveryRecord;
  }
  list(): LocalDeliveryRecord[] {
    const dir = runtime('git', 'deliveries');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => /^\d+\.json$/.test(f))
      .map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as LocalDeliveryRecord)
      .sort((a, b) => b.id - a.id);
  }
  private save(record: LocalDeliveryRecord) {
    mkdirSync(path.dirname(recordFile(record.id)), { recursive: true });
    writeFileSync(recordFile(record.id), JSON.stringify(record, null, 2), { mode: 0o600 });
  }
  private pushNotification(record: LocalDeliveryRecord, kind: string, text: string) {
    record.notifications.push({ at: now(), kind, text });
  }

  async publish(task: Task): Promise<Delivery> {
    await this.ensureRepo();
    const taskPaths: string[] = JSON.parse(task.context).allowedPaths ?? [];
    const permitted = (file: string) => allowedFile(file, this.config.allowedPaths) && allowedFile(file, taskPaths);
    if (!task.workspace || !task.branch) throw new Error('任务缺少工作区或分支');
    if ((await command('git', ['branch', '--show-current'], task.workspace)).trim() !== task.branch)
      throw new Error('工作区分支已变化，拒绝交付');
    await command('git', ['diff', '--check'], task.workspace);
    const status = await command('git', ['status', '--porcelain=v1', '-uall', '-z'], task.workspace);
    const files = status.split('\0').filter(Boolean).map(line => line.slice(3));
    if (files.some(f => !permitted(f))) throw new Error('改动超出任务或项目允许的路径范围');
    if (files.length) {
      await command('git', ['add', '--', ...files], task.workspace);
      await command('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', `${task.identifier}：本机代码交付`], task.workspace);
    }
    const headSha = (await command('git', ['rev-parse', 'HEAD'], task.workspace)).trim();
    const baseSha = (await command('git', ['--git-dir', this.bare, 'rev-parse', 'refs/heads/main'])).trim();
    if (headSha === baseSha) throw new Error('没有代码改动可交付');
    const changed = (await command('git', ['diff', '--name-only', '--no-renames', '-z', baseSha, 'HEAD'], task.workspace))
      .split('\0').filter(Boolean);
    if (changed.some(file => !permitted(file))) throw new Error('已提交改动超出允许路径范围');
    await command('git', ['-c', 'core.hooksPath=/dev/null', 'push', this.bare, `HEAD:refs/heads/${task.branch}`], task.workspace);

    const id = this.nextId();
    const record: LocalDeliveryRecord = {
      schemaVersion: 1, id, taskId: task.id, identifier: task.identifier, branch: task.branch,
      baseSha, headSha, ci: 'pending', status: 'open', createdAt: now(), updatedAt: now(),
      changedFiles: changed, ciNote: '等待本机 CI 校验', approvals: [],
      notifications: [{ at: now(), kind: '提交', text: `${task.identifier} 已推送到本机仓库分支 ${task.branch}，等待合并审批。` }],
      url: this.deliveryUrl(id),
    };
    this.save(record);
    return { pr: id, url: record.url, headSha, ci: 'pending', merged: false };
  }

  /** 本机 CI：提交存在 + 改动路径合法 + 与 main 无合并冲突。不跑任何外部服务。 */
  async inspect(pr: number): Promise<Delivery> {
    const record = this.read(pr);
    if (!record) throw new Error(`本机没有这个交付请求：${pr}`);
    let passed = true;
    const notes: string[] = [];
    try { await command('git', ['--git-dir', this.bare, 'cat-file', '-e', `${record.headSha}^{commit}`]); }
    catch { passed = false; notes.push('提交对象不存在'); }
    const outOfScope = record.changedFiles.filter(file => !allowedFile(file, this.config.allowedPaths));
    if (outOfScope.length) { passed = false; notes.push(`越界文件：${outOfScope.join('、')}`); }
    let conflict = false;
    try {
      const merge = await command('git', ['--git-dir', this.bare, 'merge-tree', 'refs/heads/main', `refs/heads/${record.branch}`]);
      conflict = /changed in both|CONFLICT|<<<<<<</i.test(merge);
      if (conflict) { passed = false; notes.push('与 main 存在合并冲突'); }
    } catch (error) { passed = false; notes.push(`无法核对合并状态：${String((error as Error).message).slice(0, 120)}`); }
    const ci: LocalCi = passed ? 'passed' : 'failed';
    if (record.ci !== ci) {
      record.ci = ci; record.updatedAt = now();
      record.ciNote = passed ? `本机校验通过：${record.changedFiles.length} 个文件、无冲突、路径合规` : notes.join('；');
      this.pushNotification(record, 'CI', passed ? '本机 CI 校验通过，等待合并审批。' : `本机 CI 未通过：${record.ciNote}`);
      this.save(record);
    }
    return { pr: record.id, url: record.url, headSha: record.headSha, ci,
      merged: record.status === 'merged', ...(record.status === 'merged' ? { mergeSha: record.headSha } : {}) };
  }

  async preview(task: Task): Promise<Delivery> {
    if (!task.delivery || task.delivery.ci !== 'passed') throw new Error('本机 CI 通过后才能生成预览');
    const record = this.read(task.delivery.pr);
    if (!record || record.headSha !== task.delivery.headSha) throw new Error('交付提交与预览版本不一致');
    const dir = runtime('previews', task.id, record.headSha);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'version.json'), JSON.stringify({
      commit: record.headSha, kind: 'files', provider: 'local-git', at: now(),
    }, null, 2), { mode: 0o600 });
    await writeFile(path.join(dir, 'index.html'),
      `<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><title>本机交付预览</title><body><h1>本机交付预览</h1><p>提交 ${record.headSha}</p><ul>${record.changedFiles.map(f => `<li>${f}</li>`).join('')}</ul></body></html>`,
      { mode: 0o600 });
    record.updatedAt = now();
    this.pushNotification(record, '预览', `本机预览版本已固定到提交 ${record.headSha}。`);
    this.save(record);
    return { ...task.delivery, artifactKind: 'files', environment: 'local-artifact-preview',
      deployedSha: record.headSha, previewUrl: `http://127.0.0.1:${this.port}/preview/${record.id}` };
  }

  /** 交付台的合并审批；业务验收仍走 Controller.accept / confirmAcceptance。 */
  async decide(id: number, decision: 'approved' | 'rejected' | 'merge', actor: string, note = ''): Promise<LocalDeliveryRecord> {
    const record = this.read(id);
    if (!record) throw new Error(`本机没有这个交付请求：${id}`);
    if (decision === 'merge') {
      if (record.ci !== 'passed' || record.status !== 'approved') throw new Error('必须先通过本机 CI 并取得合并审批');
      record.status = 'merged';
      this.pushNotification(record, '合并', `${actor} 已登记本机合并（不自动改写业务验收状态）。`);
    } else {
      if (record.status === 'merged') throw new Error('已合并的交付不能撤回审批');
      record.status = decision;
      record.approvals.push({ actor, decision, at: now(), note });
      this.pushNotification(record, '审批', `${actor} ${decision === 'approved' ? '同意合并' : '打回'}：${note || '无补充说明'}`);
    }
    record.updatedAt = now();
    this.save(record);
    return record;
  }

  async repoInfo() {
    const { mainSha, cloneUrl } = await this.ensureRepo();
    const branches = (await command('git', ['--git-dir', this.bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']))
      .split('\n').map(s => s.trim()).filter(Boolean);
    const log = (await command('git', ['--git-dir', this.bare, 'log', '--oneline', '-8', 'refs/heads/main'])).trim();
    return { repoName: this.repoName, cloneUrl, mainSha, branches, log, deliveries: this.list().length };
  }
}

/** 交付台读取预览目录里的版本证据。 */
export async function readPreview(taskId: string, sha: string): Promise<{ commit: string; kind: string } | null> {
  try {
    return JSON.parse(await readFile(runtime('previews', taskId, sha, 'version.json'), 'utf8'));
  } catch { return null; }
}
