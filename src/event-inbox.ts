/**
 * 第三十八轮 · 通用入站事件源 + 事件收件箱。
 *
 * 为什么要有它：RE-AUDIT 第 6 节「待补」第 3 项 —— 事件源此前只有 GitHub
 * 监听一项，GitLab 与「任意系统 POST 一条 JSON」都进不来；而第 1 项「按
 * `when.source/types` 给例行计划分流」必须建立在「有稳定事件类型」之上，
 * 否则只是一句空配置。这一层把「收到事实」与「决定要不要开工单」拆开：
 *
 *   POST /events/:source ──▶ 收件箱（events 表 inbox:* 记录，pending）
 *                              │
 *                              └──▶ Scheduler 按 routine.when 分流 → 建任务 → consumed
 *
 * 纪律（与 scheduler 同口径，不放宽任何红线）：
 *   - **只收事件，不建任务**：收件箱只往 events 表写 `inbox:{source}:{type}:{fingerprint}`
 *     的 pending 记录；建不建、建几条、要不要合并成一轮，由规则决定；
 *   - **幂等**：同 source + type + fingerprint 只落一条（INSERT OR IGNORE），
 *     重复投递不会重复开工单；
 *   - **验签**：每个来源独立密钥（环境变量名写在配置里），没配密钥直接拒收，
 *     不提供「裸奔」模式；密钥比对与 HMAC 比对都用 timingSafeEqual；
 *   - **指令数据分离**：事件正文只作为**事实**进任务 goal（带来源与指纹），
 *     不当作指令执行；runtimeGuard.enforce 仍然拦外部文字进提示词。
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store.ts';

/** 每个来源一条配置：密钥所在环境变量 + 允许的事件类型（留空 = 不限）。 */
export const inboxSourceSchema = z.object({
  secretEnv: z.string().trim().min(1),
  /** 事件类型白名单，支持 `x.*` 与 `*`；留空表示该来源不限类型。 */
  allow: z.array(z.string().trim().min(1)).default([]),
  /** 归一化口径：gitlab / github 走内置映射，generic 读正文里的 type。 */
  kind: z.enum(['gitlab', 'github', 'generic']).default('generic'),
}).strict();
export type InboxSource = z.infer<typeof inboxSourceSchema>;

export const inboxConfigSchema = z.object({
  /** 默认关闭：没配来源就不该有入站面。 */
  enabled: z.boolean().default(false),
  sources: z.record(z.string().min(1), inboxSourceSchema).default(() => ({})),
}).strict();
export type InboxConfig = z.infer<typeof inboxConfigSchema>;
export function defaultInboxConfig(): InboxConfig {
  return inboxConfigSchema.parse({ enabled: false, sources: {} });
}

/** 一条进箱事件：只描述事实与来源，不含任何「该怎么办」的指令。 */
export type InboxEvent = {
  id: string;
  source: string;
  type: string;
  fingerprint: string;
  title: string;
  detail: string;
  url?: string;
  at: string;
  state: string;
  taskId?: string;
  /** 收件时该来源是否命中类型白名单；未命中仍然入箱，但不会参与分流。 */
  allowed: boolean;
};

export type InboxAcceptResult =
  | { ok: true; id: string; source: string; type: string; fingerprint: string; duplicate: boolean }
  | { ok: false; reason: string };

/** 事件类型匹配：`*` 全域、`push` 精确、`merge_request.*` 前缀族。 */
export function inboxTypeMatches(patterns: string[], type: string): boolean {
  if (!patterns.length) return true;
  return patterns.some(pattern => pattern === '*'
    || pattern === type
    || (pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1))));
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** GitHub / GitLab 的 `sha256=` 前缀签名与本项目的裸 hex 都接受。 */
function hmacHex(secret: string, raw: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}
function signatureOk(secret: string, raw: string, header: string | undefined): boolean {
  if (!header) return false;
  const given = header.replace(/^sha256=/, '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(given)) return false;
  return safeEqual(given, hmacHex(secret, raw));
}

/** GitLab 的 `X-Gitlab-Event` 是「Push Hook」这类人话，映射成稳定类型。 */
const GITLAB_EVENTS: Record<string, string> = {
  'push hook': 'push',
  'tag push hook': 'tag_push',
  'merge request hook': 'merge_request',
  'issue hook': 'issue',
  'note hook': 'note',
  'pipeline hook': 'pipeline',
  'job hook': 'job',
  'release hook': 'release',
  'deployment hook': 'deployment',
};
/** GitHub 的 `X-GitHub-Event` 与监听器已用的三类型对齐，其余按原名保留。 */
const GITHUB_EVENTS: Record<string, string> = {
  push: 'push',
  issues: 'issue',
  issue_comment: 'issue_comment',
  pull_request: 'pull',
  pull_request_review: 'pull_review',
  workflow_run: 'workflow_run',
  release: 'release',
};

/** 指纹优先取正文里的稳定标识，取不到才用整包哈希（同包重复投递仍幂等）。 */
function fingerprintOf(source: string, type: string, body: Record<string, unknown>, raw: string): string {
  const pick = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : undefined;
  const attrs = (body.object_attributes ?? {}) as Record<string, unknown>;
  const explicit = pick(body.fingerprint) ?? pick(body.id) ?? pick(body.delivery);
  const stable = explicit
    ?? pick(attrs.id) ?? pick(attrs.iid)
    ?? pick(body.after) ?? pick(body.checkout_sha)
    ?? pick(body.sha)
    ?? (body.head_commit ? pick((body.head_commit as Record<string, unknown>).id) : undefined);
  const seed = stable ? `${source}|${type}|${stable}` : `${source}|${type}|${raw}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

/** 事件正文只抽出「发生了什么」，不抽「该做什么」。 */
function describe(source: string, type: string, body: Record<string, unknown>): { title: string; detail: string; url?: string } {
  const attrs = (body.object_attributes ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const title = text(body.title) || text(attrs.title) || text(attrs.name)
    || (body.head_commit ? text((body.head_commit as Record<string, unknown>).message).split('\n')[0] ?? '' : '')
    || `${source} 的 ${type} 事件`;
  const detail = text(body.detail) || text(attrs.description) || text(attrs.message)
    || text(body.message) || text(body.ref) || '';
  const url = text(body.url) || text(attrs.url) || text(body.html_url) || undefined;
  return { title: title.slice(0, 200), detail: detail.slice(0, 1000), ...(url ? { url } : {}) };
}

export class EventInbox {
  constructor(
    private readonly store: Store,
    private readonly config: InboxConfig | undefined,
    /** 环境变量读取口；测试可注入，生产恒用 process.env。 */
    private readonly env: Record<string, string | undefined> = process.env,
    /** 测试可注入时钟。 */
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get cfg(): InboxConfig | undefined {
    return this.config?.enabled ? this.config : undefined;
  }

  /**
   * 收一条入站事件。签名/密钥不对、来源没登记、类型不在白名单 —— 一律拒收并
   * 如实给出原因（不静默吞掉，也不猜测调用方意图）。
   */
  accept(source: string, raw: string, headers: Record<string, string | undefined>): InboxAcceptResult {
    const cfg = this.cfg;
    if (!cfg) return { ok: false, reason: 'events-disabled' };
    const sourceCfg = cfg.sources[source];
    if (!sourceCfg) return { ok: false, reason: 'source-not-configured' };
    const secret = this.env[sourceCfg.secretEnv];
    // 没配密钥就没有可信来源；宁可不收，也不开一个谁都能投的口子。
    if (!secret) return { ok: false, reason: 'secret-not-configured' };

    const signature = headers['x-signature-256'] ?? headers['x-hub-signature-256'];
    const token = headers['x-gitlab-token'] ?? headers.authorization?.replace(/^Bearer /, '');
    const verified = signature ? signatureOk(secret, raw, signature) : token ? safeEqual(token, secret) : false;
    if (!verified) return { ok: false, reason: 'bad-signature' };

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: 'bad-json' };
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, reason: 'bad-json' };

    const header = headers['x-gitlab-event'] ?? headers['x-github-event'];
    const mapped = sourceCfg.kind === 'gitlab' ? GITLAB_EVENTS[String(header ?? '').toLowerCase()]
      : sourceCfg.kind === 'github' ? GITHUB_EVENTS[String(header ?? '')]
      : undefined;
    const bodyType = typeof body.type === 'string' ? body.type.trim() : typeof body.object_kind === 'string' ? body.object_kind.trim() : '';
    const type = (mapped ?? bodyType).toLowerCase();
    if (!type) return { ok: false, reason: 'missing-type' };

    const allowed = inboxTypeMatches(sourceCfg.allow, type);
    const fingerprint = fingerprintOf(source, type, body, raw);
    const id = `inbox:${source}:${type}:${fingerprint}`;
    const described = describe(source, type, body);
    const record: InboxEvent = {
      id, source, type, fingerprint, ...described,
      at: this.now().toISOString(), state: allowed ? 'pending' : 'filtered', allowed,
    };
    const result = this.store.db.prepare('INSERT OR IGNORE INTO events(id,state,value) VALUES(?,?,?)')
      .run(id, record.state, JSON.stringify(record));
    const duplicate = result.changes !== 1;
    if (!duplicate) {
      this.store.audit('inbox.accepted', null, { source, type, fingerprint, allowed, id });
    }
    return { ok: true, id, source, type, fingerprint, duplicate };
  }

  /** 待分流事件（默认只看 pending）；指定 source / types 时按规则筛。 */
  pending(filter: { source?: string; types?: string[] } = {}): InboxEvent[] {
    const rows = this.store.db.prepare("SELECT value FROM events WHERE id LIKE 'inbox:%' AND state='pending'").all() as { value: string }[];
    return rows.map(row => JSON.parse(row.value) as InboxEvent)
      .filter(event => (!filter.source || event.source === filter.source)
        && inboxTypeMatches(filter.types ?? [], event.type))
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  /** 消费：标记 state=consumed 并记下被哪条任务接走（可回溯到规则与槽位）。 */
  consume(ids: string[], taskId: string): void {
    // 列与正文一起改：`state` 列是查询用的真相，正文里的 state 只是给人读的，
    // 两边不同步会让「已消费」在状态页上仍显示成 pending。
    const update = this.store.db.prepare('UPDATE events SET state=?, value=? WHERE id=?');
    for (const id of ids) {
      const row = this.store.db.prepare('SELECT value FROM events WHERE id=?').get(id) as { value: string } | undefined;
      if (!row) continue;
      const event = { ...(JSON.parse(row.value) as InboxEvent), state: 'consumed', taskId };
      update.run('consumed', JSON.stringify(event), id);
    }
    if (ids.length) this.store.audit('inbox.consumed', taskId, { count: ids.length, ids: ids.slice(0, 20) });
  }

  /** 只读状态：按来源×类型×状态计数，供控制台展示事件面。 */
  status(): { enabled: boolean; sources: { name: string; kind: string; allow: string[]; secretConfigured: boolean }[]; counts: { source: string; type: string; state: string; count: number }[]; pending: number } {
    const rows = this.store.db.prepare("SELECT state,value FROM events WHERE id LIKE 'inbox:%'").all() as { state: string; value: string }[];
    const tally = new Map<string, { source: string; type: string; state: string; count: number }>();
    let pending = 0;
    for (const row of rows) {
      const event = JSON.parse(row.value) as InboxEvent;
      // 状态以列为准（见 consume 的注释），正文只提供来源与类型。
      const state = row.state || event.state;
      const key = `${event.source}|${event.type}|${state}`;
      const cell = tally.get(key) ?? { source: event.source, type: event.type, state, count: 0 };
      cell.count += 1; tally.set(key, cell);
      if (state === 'pending') pending += 1;
    }
    const cfg = this.cfg;
    return {
      enabled: Boolean(cfg),
      sources: Object.entries((cfg?.sources ?? {}) as Record<string, InboxSource>).map(([name, source]) => ({
        name, kind: source.kind, allow: source.allow, secretConfigured: Boolean(this.env[source.secretEnv]),
      })),
      counts: [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 50),
      pending,
    };
  }
}
