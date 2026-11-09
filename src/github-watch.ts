/**
 * 第三十六轮 · GitHub 仓库事件监听。
 *
 * 用户 2026-11-09 拍板：「GitHub 监听（换本机 Git）…这几个也都要做」。
 * 此前边界是「代码交付走本机 Git，不监听 GitHub」；本轮恢复监听，但交付链路
 * 仍按 delivery.provider 配置走（默认本机）。监听只做「事件 → 协作任务」，
 * 不做任何代码写入。
 *
 * 两条入站路径，共用同一套事件指纹与建任务逻辑：
 *   1) 轮询（默认）：优先 gh api（复用既有 gh CLI 认证），无 gh 时退
 *      REST + token（环境变量 githubWatch.tokenEnv）。轮询不需要公网，
 *      国内可用；默认 60 秒节奏由 server 主循环控制。
 *   2) Webhook（可选）：POST /github/webhook，HMAC-SHA256 验签
 *      （X-Hub-Signature-256，密钥在环境变量 githubWatch.secretEnv）。
 *      bridge 只绑 127.0.0.1，公网暴露需自行反代——如实边界，不假装支持。
 *
 * 红线（不放宽）：
 *   - 事件只产生「任务」，任务的验收 / 合并 / 放行仍走原会话与审批链；
 *   - 幂等：事件指纹进 events 表（github-watch:{kind}:{fingerprint}），
 *     轮询与 webhook 双路径对同一事件只建一次任务；
 *   - 首次运行（表里没有任何 github-watch 记录）只记基线不建任务，
 *     避免「一开监听就冒出 15 个历史任务」的噪音；
 *   - 凭据只从环境变量读，绝不写进 config.json / 仓库。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.ts';
import type { Workspaces } from './workspaces.ts';
import type { WorkspaceAssistant } from './assistant.ts';
import { automationActor } from './scheduler.ts';
import { command } from './commands.ts';

export const githubWatchConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** 监听的仓库；缺省复用 config.repository（owner/repo）。 */
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
  /** REST 兜底用的 token 环境变量名（gh api 优先，无需 token）。 */
  tokenEnv: z.string().min(1).default('GITHUB_WATCH_TOKEN'),
  /** webhook 验签密钥的环境变量名；未设置时 webhook 端点直接拒绝。 */
  secretEnv: z.string().min(1).default('GITHUB_WEBHOOK_SECRET'),
  watchPush: z.boolean().default(true),
  watchIssues: z.boolean().default(true),
  watchPulls: z.boolean().default(true),
  /** 每个 tick 最多转成任务的事件数，防一次拉取把待办打爆。 */
  maxEventsPerTick: z.number().int().min(1).max(20).default(5),
}).strict();
export type GithubWatchConfig = z.infer<typeof githubWatchConfigSchema>;
export function defaultGithubWatchConfig(): GithubWatchConfig {
  return githubWatchConfigSchema.parse({});
}

export type GithubEventKind = 'push' | 'issue' | 'pull';
export type ObservedEvent = { kind: GithubEventKind; fingerprint: string; title: string; detail: string; url?: string };

export type GithubWatchTick = {
  at: string;
  baseline: boolean;
  observed: number;
  tasksCreated: number;
  errors: string[];
};

/** 事件 → 指纹：同一对象再次变化会产生新指纹（含 updated_at），旧指纹已消费不重复建任务。 */
export function fingerprintOf(kind: GithubEventKind, payload: Record<string, unknown>): string | undefined {
  const updated = typeof payload.updated_at === 'string' ? payload.updated_at : undefined;
  switch (kind) {
    case 'push': return typeof payload.sha === 'string' ? payload.sha : undefined;
    case 'issue': case 'pull': {
      const number = payload.number;
      return typeof number === 'number' && updated ? `${number}:${updated}` : undefined;
    }
  }
}

/** webhook 验签：GitHub 文档口径 sha256=<hex>，常量时间比较。 */
export function verifyGithubSignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const given = header.slice('sha256='.length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
}

export class GithubWatcher {
  /** 轮询节流：server 主循环默认 15s 一 tick，对 GitHub API 太频；固定 60s 拉一次。进程内状态，重启多拉一次无害（指纹幂等保护）。 */
  private lastPollAt = 0;
  private static readonly POLL_INTERVAL_MS = 60_000;

  constructor(
    readonly w: Workspaces,
    private readonly assistant: WorkspaceAssistant,
    private readonly config: Config,
    /** 测试注入：环境变量视图（token / secret）。生产用 process.env。 */
    private readonly env: Record<string, string | undefined> = process.env,
    /** 测试注入：REST 兜底 fetch。生产用 globalThis.fetch。 */
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get repo(): string { return this.config.githubWatch?.repository ?? this.config.repository; }

  private seen(fingerprint: string): boolean {
    return Boolean(this.w.store.db.prepare('SELECT 1 FROM events WHERE id=?').get(`github-watch:${fingerprint}`));
  }
  private mark(fingerprint: string, state: string, value: unknown): void {
    this.w.store.db.prepare('INSERT OR REPLACE INTO events(id,state,value) VALUES(?,?,?)')
      .run(`github-watch:${fingerprint}`, state, JSON.stringify(value));
  }
  private hasAnyMark(): boolean {
    return Boolean(this.w.store.db.prepare("SELECT 1 FROM events WHERE id LIKE 'github-watch:%' LIMIT 1").get());
  }

  /** gh api 优先；失败（无 gh / 未认证）时 REST + token 兜底；都不行则抛错。 */
  private async api(route: string): Promise<unknown[]> {
    try {
      const raw = await command('gh', ['api', `repos/${this.repo}/${route}`]);
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { /* 落到 REST 兜底 */ }
    const token = this.env[this.config.githubWatch?.tokenEnv ?? 'GITHUB_WATCH_TOKEN'];
    if (!token) throw new Error(`gh CLI 不可用且未设置 ${this.config.githubWatch?.tokenEnv ?? 'GITHUB_WATCH_TOKEN'}，GitHub 监听无法拉取`);
    const response = await this.fetchImpl(`https://api.github.com/repos/${this.repo}/${route}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'suitme-collab' },
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const parsed = await response.json() as unknown;
    return Array.isArray(parsed) ? parsed : [];
  }

  async tick(): Promise<GithubWatchTick> {
    const report: GithubWatchTick = { at: this.now().toISOString(), baseline: false, observed: 0, tasksCreated: 0, errors: [] };
    const cfg = this.config.githubWatch;
    if (!cfg?.enabled) return report;
    const nowMs = Date.parse(this.now().toISOString());
    if (nowMs - this.lastPollAt < GithubWatcher.POLL_INTERVAL_MS) return report;
    this.lastPollAt = nowMs;
    // 首次运行只记基线：把当前最近事件全部标记为已见，不建任务。
    const baseline = !this.hasAnyMark();
    report.baseline = baseline;
    const sources: [GithubEventKind, boolean, string][] = [
      ['push', cfg.watchPush, 'commits?per_page=5'],
      ['issue', cfg.watchIssues, 'issues?state=all&sort=updated&direction=desc&per_page=5'],
      ['pull', cfg.watchPulls, 'pulls?state=all&sort=updated&direction=desc&per_page=5'],
    ];
    let budget = baseline ? 15 : cfg.maxEventsPerTick;
    for (const [kind, on, route] of sources) {
      if (!on) continue;
      let batch: unknown[];
      try { batch = await this.api(route); } catch (error) {
        report.errors.push(String(error instanceof Error ? error.message : error).slice(0, 200));
        continue;
      }
      for (const item of batch) {
        if (budget <= 0) break;
        const payload = item as Record<string, unknown>;
        const fingerprint = fingerprintOf(kind, payload);
        if (!fingerprint || this.seen(fingerprint)) continue;
        budget -= 1; report.observed += 1;
        const event = describeEvent(kind, payload);
        if (!event) { this.mark(fingerprint, 'ignored', { kind }); continue; }
        if (baseline) { this.mark(fingerprint, 'baseline', { kind }); continue; }
        this.mark(fingerprint, 'observed', { kind, title: event.title });
        try {
          await this.createTaskFor(event);
          this.mark(fingerprint, 'tasked', { kind, title: event.title });
          report.tasksCreated += 1;
        } catch (error) {
          this.mark(fingerprint, 'failed', { kind, error: String(error instanceof Error ? error.message : error).slice(0, 200) });
          this.w.store.audit('github.watch-failed', null, { fingerprint, error: String(error instanceof Error ? error.message : error).slice(0, 300) });
          report.errors.push(String(error instanceof Error ? error.message : error).slice(0, 200));
        }
      }
    }
    if (baseline) this.w.store.audit('github.baseline', null, { repository: this.repo, observed: report.observed, automation: 'github-watch' });
    return report;
  }

  /** webhook 事件处理：与轮询共用指纹幂等；不做 baseline（推送的都是明确的新事件）。 */
  async handleWebhook(rawBody: string, signature: string | undefined, event: string | undefined): Promise<{ handled: boolean; reason?: string; taskId?: string }> {
    const cfg = this.config.githubWatch;
    if (!cfg?.enabled) return { handled: false, reason: 'not-enabled' };
    const secret = this.env[cfg.secretEnv];
    if (!secret) return { handled: false, reason: 'webhook-secret-not-configured' };
    if (!verifyGithubSignature(secret, rawBody, signature)) return { handled: false, reason: 'bad-signature' };
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { return { handled: false, reason: 'bad-json' }; }
    const kind: GithubEventKind | undefined
      = event === 'push' ? 'push' : event === 'issues' ? 'issue' : event === 'pull_request' ? 'pull' : undefined;
    if (!kind) return { handled: false, reason: 'event-not-watched:' + String(event) };
    const target = (kind === 'push' ? payload.head_commit : kind === 'issue' ? payload.issue : payload.pull_request) as Record<string, unknown> | undefined;
    if (!target) return { handled: false, reason: 'no-target' };
    const fingerprint = fingerprintOf(kind, target);
    if (!fingerprint || this.seen(fingerprint)) return { handled: false, reason: 'duplicate' };
    const described = describeEvent(kind, target, payload);
    if (!described) { this.mark(fingerprint, 'ignored', { kind, via: 'webhook' }); return { handled: false, reason: 'ignored' }; }
    this.mark(fingerprint, 'observed', { kind, via: 'webhook' });
    const task = await this.createTaskFor(described);
    this.mark(fingerprint, 'tasked', { kind, via: 'webhook' });
    return { handled: true, taskId: task.id };
  }

  private async createTaskFor(event: ObservedEvent) {
    const actor = automationActor('github-watch');
    const task = await this.w.createTask({
      title: `[GitHub] ${event.title}`.slice(0, 120),
      goal: `${event.detail}${event.url ? `\n\n事件链接：${event.url}` : ''}\n\n——本任务由 GitHub 仓库监听自动发起（${this.repo}），不是新的人工需求；需要动代码时按 delivery 配置走交付链路，验收仍由任务发起人在原会话确认。`,
      agent: this.config.defaultAgent, sources: [], requestKey: `github:${event.fingerprint}`.slice(0, 120), autoDiscover: true,
    }, actor);
    this.w.store.audit('github.event-observed', task.id, {
      kind: event.kind, fingerprint: event.fingerprint, title: event.title, taskId: task.id, repository: this.repo, automation: 'github-watch' });
    try {
      await this.assistant.delegate(task.id, true, 'advance',
        'GitHub 事件任务已自动发起。先核对事件内容再行动；需要人拍板的问题走提问链路，不要自行合并或放行。', actor, 'github:' + event.fingerprint);
    } catch (error) {
      this.w.store.audit('github.assistant-unavailable', task.id, { fingerprint: event.fingerprint, error: String(error instanceof Error ? error.message : error).slice(0, 300) });
    }
    return task;
  }

  status(): { enabled: boolean; repository: string; transport: string; tokenConfigured: boolean; webhookSecretConfigured: boolean } {
    const cfg = this.config.githubWatch;
    const token = Boolean(this.env[cfg?.tokenEnv ?? 'GITHUB_WATCH_TOKEN']);
    const secret = Boolean(this.env[cfg?.secretEnv ?? 'GITHUB_WEBHOOK_SECRET']);
    return { enabled: cfg?.enabled === true, repository: this.repo,
      transport: 'poll(gh api 优先，REST 兜底) + webhook(可选)', tokenConfigured: token, webhookSecretConfigured: secret };
  }
}

/** 把 GitHub API / webhook 里的对象整理成任务可读的事件描述。 */
export function describeEvent(kind: GithubEventKind, target: Record<string, unknown>, root?: Record<string, unknown>): ObservedEvent | undefined {
  const link = typeof target.html_url === 'string' ? target.html_url : undefined;
  if (kind === 'push') {
    const message = typeof target.message === 'string' ? target.message : '';
    const author = (target.author as Record<string, unknown> | undefined)?.name;
    const pusher = (root?.pusher as Record<string, unknown> | undefined)?.name ?? author;
    const sha = typeof target.sha === 'string' ? target.sha.slice(0, 10) : '';
    if (!message && !sha) return undefined;
    return { kind, fingerprint: String(target.sha), title: `推送 ${sha}：${message.split('\n')[0]?.slice(0, 80)}`,
      detail: `仓库有新提交。提交说明：${message || '（无说明）'}${pusher ? `；提交人：${String(pusher)}` : ''}`, url: link };
  }
  const title = typeof target.title === 'string' ? target.title : '';
  const number = target.number;
  const user = (target.user as Record<string, unknown> | undefined)?.login;
  const state = typeof target.state === 'string' ? target.state : '';
  const action = typeof root?.action === 'string' ? root.action : 'updated';
  if (typeof number !== 'number' || !title) return undefined;
  const fingerprint = `${number}:${String(target.updated_at)}`;
  if (kind === 'issue') {
    return { kind, fingerprint, title: `议题 #${number} ${action}：${title.slice(0, 80)}`,
      detail: `仓库议题 #${number}「${title}」${action}（状态：${state || 'open'}${user ? `；发起人：${String(user)}` : ''}）。请判断是否需要跟进。`, url: link };
  }
  return { kind, fingerprint, title: `PR #${number} ${action}：${title.slice(0, 80)}`,
    detail: `仓库 PR #${number}「${title}」${action}（状态：${state || 'open'}${user ? `；发起人：${String(user)}` : ''}）。评审与合并走审批链，不要自动放行。`, url: link };
}
