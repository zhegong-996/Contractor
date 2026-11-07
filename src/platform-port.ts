// 宿主平台端口（去 Paperclip 化第一步，v0.7）。
//
// 用户决策：Paperclip 的平台底座与 Plugin SDK 不再作为长期依赖。但当前
// 任务真源、ACL、文档修订、插件 UI 承载全部由它提供，一次删除会让系统
// 不可运行。因此先把平台能力收拢到一个端口，让「换底座」变成「换一个
// 适配器」，而不是全仓改 import；同时提供一个不依赖 Paperclip 的最小
// 可运行实现，用来证明切换路径真实存在、并给出明确的补齐清单。
//
// 复用口径：
//   - DeepSeek Harness：per-task scope / 工具白名单语义沿用 harness-composition.ts
//     的 createScope + tools.restrict，不另造一套权限模型；
//   - Super Agent：入口触发解析仍走 upstream.ts 的 feishuTrigger，与宿主无关；
//   - Agent Autoloop：worker 执行循环仍走 runner.ts / assistant-runner.ts；
//   - LobeHub / CoPaw / Octop / DeerFlow：产品形态参考，不复制代码。
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import { runtime } from './config.ts';
import { Paperclip } from './paperclip.ts';
import { PgHostPlatform, pgDsn } from './pg-host.ts';

export type HostCapabilities = {
  id: string;
  implemented: string[];
  /** 尚未实现的 route / 能力：切换前必须逐条补齐，不能假装已经替换完成。 */
  missing: string[];
  /** 是否提供插件式 UI 承载。 */
  pluginSdk: boolean;
};

export interface HostPlatformPort {
  id(): string;
  get<T = any>(route: string): Promise<T>;
  post<T = any>(route: string, body: unknown): Promise<T>;
  patch<T = any>(route: string, body: unknown): Promise<T>;
  document(issueId: string, key: string, title: string, body: string): Promise<{ title: string; body: string; latestRevisionId?: string }>;
  health(): Promise<{ status: string; deploymentMode?: string }>;
  uiBaseUrl(): string;
  capabilities(): HostCapabilities;
}

/** 现有底座的薄包装：行为与直接 new Paperclip(...) 完全一致。 */
export class PaperclipPlatform implements HostPlatformPort {
  constructor(readonly pc: Paperclip, readonly url: string) {}
  id() { return 'paperclip'; }
  get<T = any>(route: string) { return this.pc.get<T>(route); }
  post<T = any>(route: string, body: unknown) { return this.pc.post<T>(route, body); }
  patch<T = any>(route: string, body: unknown) { return this.pc.patch<T>(route, body); }
  document(issueId: string, key: string, title: string, body: string) { return this.pc.document(issueId, key, title, body); }
  async health() { const value = await this.pc.get<any>('/health'); return { status: String(value?.status ?? 'ok'), deploymentMode: value?.deploymentMode }; }
  uiBaseUrl() { return this.url; }
  capabilities(): HostCapabilities {
    return { id: 'paperclip', pluginSdk: true,
      implemented: ['issues', 'documents', 'comments', 'agents/wakeup', 'heartbeat-runs', 'cost-ledger', 'plugin-ui', 'ACL'],
      missing: [] };
  }
}

type LocalIssue = {
  id: string; identifier: string; title: string; description?: string; status: string;
  projectId?: string; companyId?: string; assigneeAgentId?: string | null; assigneeUserId?: string | null;
  parentId?: string | null; visibility?: string; idempotencyKey?: string; createdAt: string; updatedAt: string;
};
type LocalDocument = { title: string; body: string; format: string; revision: number; updatedAt: string };

const safeSegment = (value: string) => /^[A-Za-z0-9_.:-]{1,160}$/.test(value);

/**
 * 不依赖 Paperclip 的最小宿主：本地文件 + append-only journal。
 * 只实现主链路真正用到的 route 子集；未实现的 route 明确报错，绝不静默返回
 * 假数据。它是「可以不要 Paperclip」的可运行证明与切换清单，不是完整替换。
 */
export class LocalHostPlatform implements HostPlatformPort {
  readonly dir: string;
  private readonly issuesFile: string;
  private readonly journalFile: string;
  private readonly docsDir: string;
  constructor(dir: string = runtime('local-host'), readonly config?: Config) {
    this.dir = dir;
    this.issuesFile = path.join(dir, 'issues.json');
    this.journalFile = path.join(dir, 'journal.jsonl');
    this.docsDir = path.join(dir, 'documents');
    mkdirSync(this.docsDir, { recursive: true, mode: 0o700 });
    if (!existsSync(this.issuesFile)) writeFileSync(this.issuesFile, '[]', { mode: 0o600 });
  }
  id() { return 'local'; }
  uiBaseUrl() { return 'http://127.0.0.1:' + (this.config?.bridgePort ?? 4180); }
  private journal(method: string, route: string, detail: unknown) {
    appendFileSync(this.journalFile, JSON.stringify({ at: new Date().toISOString(), method, route, detail }) + '\n', { mode: 0o600 });
  }
  private issues(): LocalIssue[] { return JSON.parse(readFileSync(this.issuesFile, 'utf8')) as LocalIssue[]; }
  private saveIssues(list: LocalIssue[]) { writeFileSync(this.issuesFile, JSON.stringify(list, null, 2), { mode: 0o600 }); }
  private docPath(issueId: string, key: string) {
    if (!safeSegment(issueId) || !safeSegment(key)) throw new Error('本机宿主的文档键只允许字母、数字、_ . : -');
    return path.join(this.docsDir, issueId, key + '.json');
  }
  async health() { return { status: 'ok', deploymentMode: 'local-file-host' }; }
  async get<T = any>(route: string): Promise<T> {
    if (route === '/health') return (await this.health()) as T;
    const doc = /^\/issues\/([^/]+)\/documents\/([^/]+)$/.exec(route);
    if (doc) {
      const file = this.docPath(doc[1]!, doc[2]!);
      if (!existsSync(file)) throw new Error('LocalHostPlatform GET ' + route + ': 404');
      const value = JSON.parse(readFileSync(file, 'utf8')) as LocalDocument;
      return { title: value.title, body: value.body, latestRevisionId: String(value.revision) } as T;
    }
    const issue = /^\/issues\/([^/]+)$/.exec(route);
    if (issue) {
      const found = this.issues().find(i => i.id === issue[1]);
      if (!found) throw new Error('LocalHostPlatform GET ' + route + ': 404');
      return found as T;
    }
    const run = /^\/heartbeat-runs\/([^/]+)$/.exec(route);
    if (run) return { id: run[1], status: 'succeeded', localHost: true } as T;
    throw new Error('LocalHostPlatform 尚未实现 GET ' + route + '；切换前需补齐该 route');
  }
  async post<T = any>(route: string, body: any): Promise<T> {
    const create = /^\/companies\/([^/]+)\/issues$/.exec(route);
    if (create) {
      const list = this.issues();
      if (body?.idempotencyKey) {
        const prior = list.find(i => i.idempotencyKey === body.idempotencyKey);
        if (prior) return prior as T;
      }
      const id = 'LOCAL-' + randomUUID().slice(0, 8);
      const issue: LocalIssue = { id, identifier: 'SUI-LOCAL-' + id.slice(-4), title: String(body?.title ?? '未命名任务'),
        description: body?.description, status: String(body?.status ?? 'backlog'), companyId: create[1], projectId: body?.projectId,
        assigneeAgentId: body?.assigneeAgentId ?? null, parentId: body?.parentId ?? null, visibility: body?.visibility,
        idempotencyKey: body?.idempotencyKey, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      list.push(issue); this.saveIssues(list); this.journal('POST', route, { id });
      return issue as T;
    }
    const comment = /^\/issues\/([^/]+)\/comments$/.exec(route);
    if (comment) { this.journal('COMMENT', route, { issueId: comment[1], clientRequestId: body?.clientRequestId }); return { ok: true } as T; }
    const wake = /^\/agents\/([^/]+)\/wakeup$/.exec(route);
    if (wake) { this.journal('WAKEUP', route, { agentId: wake[1], reason: body?.reason }); return { ok: true } as T; }
    throw new Error('LocalHostPlatform 尚未实现 POST ' + route + '；切换前需补齐该 route');
  }
  async patch<T = any>(route: string, body: any): Promise<T> {
    const match = /^\/issues\/([^/]+)$/.exec(route);
    if (!match) throw new Error('LocalHostPlatform 尚未实现 PATCH ' + route);
    const list = this.issues(); const found = list.find(i => i.id === match[1]);
    if (!found) throw new Error('LocalHostPlatform PATCH ' + route + ': 404');
    Object.assign(found, body, { updatedAt: new Date().toISOString() });
    this.saveIssues(list); this.journal('PATCH', route, { id: found.id, status: found.status });
    return found as T;
  }
  async document(issueId: string, key: string, title: string, body: string) {
    const file = this.docPath(issueId, key);
    let prior: LocalDocument | undefined;
    if (existsSync(file)) prior = JSON.parse(readFileSync(file, 'utf8')) as LocalDocument;
    if (prior && prior.body === body && prior.title === title) return { title, body, latestRevisionId: String(prior.revision) };
    const next: LocalDocument = { title, body, format: 'markdown', revision: (prior?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
    this.journal('DOCUMENT', `/issues/${issueId}/documents/${key}`, { revision: next.revision });
    return { title, body, latestRevisionId: String(next.revision) };
  }
  journalLines(): Record<string, unknown>[] {
    if (!existsSync(this.journalFile)) return [];
    return readFileSync(this.journalFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  capabilities(): HostCapabilities {
    return { id: 'local', pluginSdk: false,
      implemented: ['issues(create/get/patch)', 'documents(put/get/revision)', 'comments', 'agents/wakeup', 'heartbeat-runs', 'append-only journal'],
      // 切换前的真实缺口，供 C 阶段逐条补齐，不藏在文档里。② 下「Plugin SDK」
      // 不再是缺口：独立应用 UI 承载由 C-2 提供。事务/并发已在 local-pg 后端
      // 真实实现（见 PgHostPlatform.capabilities()），文件后端仍只适合单进程。
      missing: ['ACL / 成员身份（现由 members.ts + 宿主 actor 提供）',
        'cost-ledger（TraceBridge.flush 依赖）',
        'heartbeat 真实执行与 checkout / retry / runToken 语义',
        '事务与并发控制（单进程文件后端；local-pg 已实现）',
        '独立应用 UI 承载（② 下由 C-2 提供，不再是 Plugin SDK 缺口）'] };
  }
}

/** 配置驱动的工厂；默认仍是 Paperclip，切换是显式配置行为。 */
export function resolvePlatform(config: Config): HostPlatformPort {
  if (config.host.provider === 'local-pg') return new PgHostPlatform(pgDsn(config), config);
  if (config.host.provider === 'local') return new LocalHostPlatform(runtime('local-host'), config);
  return new PaperclipPlatform(new Paperclip(config.paperclipUrl), config.paperclipUrl);
}

/** 供文档与只读状态接口用的切换清单。 */
export function platformSwitchChecklist(): { current: string; steps: string[] } {
  const local = new LocalHostPlatform(runtime('local-host'));
  return {
    current: 'paperclip（默认，未切换）',
    steps: [
      'config.host.provider=local 后，平台调用统一经 HostPlatformPort，不再直接 new Paperclip(...)',
      ...local.capabilities().missing.map(item => '待补齐：' + item),
      '验收：npm run host:smoke 全绿 + 全套回归 + 真实浏览器走查 11/11',
      '补齐后再移除 plugins/knowledge-workspaces 对 Plugin SDK 的编译期依赖',
    ],
  };
}
