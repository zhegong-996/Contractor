// 方案 C-1：PostgreSQL 宿主后端（本机真跑，非「文件锁等价」）。
//
// 用户 2026-11-07 明确改口：「本机可以引入 pgsql 数据库去测试」。同时给出
// LobeHub / DeepSeek 的架构输入：把 Agent 的循环、会话状态、执行环境拆开，
// 每一步（调一次模型或工具）都是一次独立调用，步与步之间靠队列推进，
// 换机器只是换一个执行工具的地方。
//
// 这一层只负责「循环与状态分离」的地基：状态写进 PG、下一步由队列领取。
// 它没有把工具发到远端沙箱（那是执行环境，属 C-2/C-4 与生产部署），
// 也没有引入 Redis：本机试点用 PG 的 FOR UPDATE SKIP LOCKED 保证并发领取，
// 队列与状态在同一事务里一致；大规模横向扩展时替换队列实现即可，切换点
// 就是下面的 claimStep / completeStep / recoverStaleSteps 三个方法。
//
// 复用口径：只新增 npm 依赖 pg@8.23.1（MIT），不复制任何上游源码。
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { Config } from './config.ts';
import type { HostCapabilities, HostPlatformPort } from './platform-port.ts';

/** 专属 schema，避免与同一实例上的其它业务库/表互相影响。 */
export const PG_SCHEMA = 'suitme_c1';
const S = PG_SCHEMA;

/** DSN 只从环境变量取值，凭据不写进 config.json 或仓库；本机默认无密码回环连接。 */
export function pgDsn(config?: Config): string {
  const envName = config?.host?.pgDsnEnv ?? 'COLLAB_PG_DSN';
  return process.env[envName] || 'postgresql://127.0.0.1:5432/suitme_collab_c1';
}

/** 只允许本机回环地址，避免把业务材料发到未批准的外部数据库。 */
export function assertLocalPgDsn(dsn: string): string {
  const url = new URL(dsn);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:')
    throw new Error('PG 连接只接受 postgresql: / postgres: 协议');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname))
    throw new Error('PG 连接只允许本机回环地址；真实业务材料不得写入未批准的外部数据库');
  return dsn;
}

export type StepSpec = { kind: string; payload?: Record<string, unknown> };
export type ClaimedStep = {
  id: number; runId: string; stepNo: number; kind: string; status: string;
  runToken: string; claimedBy: string; attempts: number; payload: Record<string, unknown>;
};
export type RunStateStep = {
  stepNo: number; kind: string; status: string; claimedBy: string | null;
  attempts: number; modelCalls: number; result: unknown; checkpoint: unknown;
  payload?: Record<string, unknown> | null;
};

const DDL = [
  `CREATE SCHEMA IF NOT EXISTS ${S}`,
  `CREATE TABLE IF NOT EXISTS ${S}.issues (
     id text PRIMARY KEY, identifier text NOT NULL, title text NOT NULL, description text,
     status text NOT NULL, project_id text, company_id text, assignee_agent_id text,
     assignee_user_id text, parent_id text, visibility text, idempotency_key text UNIQUE,
     created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS ${S}.documents (
     issue_id text NOT NULL, key text NOT NULL, title text NOT NULL, body text NOT NULL,
     format text NOT NULL DEFAULT 'markdown', revision integer NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (issue_id, key))`,
  `CREATE TABLE IF NOT EXISTS ${S}.journal (
     id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
     method text NOT NULL, route text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb)`,
  `CREATE TABLE IF NOT EXISTS ${S}.members (
     id text PRIMARY KEY, display_name text NOT NULL, roles jsonb NOT NULL DEFAULT '[]'::jsonb,
     active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS ${S}.cost_events (
     id bigserial PRIMARY KEY, company_id text NOT NULL, run_id text, kind text NOT NULL,
     amount numeric(18,6) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'USD',
     detail jsonb NOT NULL DEFAULT '{}'::jsonb, at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS ${S}.heartbeat_runs (
     id text PRIMARY KEY, status text NOT NULL DEFAULT 'ready', run_token text,
     worker_id text, attempt integer NOT NULL DEFAULT 0, checkout_at timestamptz,
     context jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS ${S}.steps (
     id bigserial PRIMARY KEY, run_id text NOT NULL, step_no integer NOT NULL,
     kind text NOT NULL, status text NOT NULL DEFAULT 'ready', claimed_by text,
     run_token text, attempts integer NOT NULL DEFAULT 0,
     payload jsonb NOT NULL DEFAULT '{}'::jsonb, result jsonb, checkpoint jsonb,
     model_calls integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (run_id, step_no))`,
  `CREATE INDEX IF NOT EXISTS steps_ready_idx ON ${S}.steps (status, id) WHERE status = 'ready'`,
];

function issueRow(row: any) {
  return {
    id: row.id, identifier: row.identifier, title: row.title, description: row.description,
    status: row.status, projectId: row.project_id, companyId: row.company_id,
    assigneeAgentId: row.assignee_agent_id, assigneeUserId: row.assignee_user_id,
    parentId: row.parent_id, visibility: row.visibility, idempotencyKey: row.idempotency_key,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function stepRow(row: any): ClaimedStep {
  return { id: Number(row.id), runId: row.run_id, stepNo: Number(row.step_no), kind: row.kind,
    status: row.status, runToken: row.run_token, claimedBy: row.claimed_by,
    attempts: Number(row.attempts), payload: row.payload ?? {} };
}

/**
 * PostgreSQL 版宿主：与 LocalHostPlatform 同一端口契约，但所有状态都在数据库里。
 * 默认底座仍是 paperclip；这里只是可显式切换、可真跑验证的一条路径。
 */
export class PgHostPlatform implements HostPlatformPort {
  readonly pool: Pool;
  readonly dsn: string;
  private ready?: Promise<void>;
  constructor(dsn: string = pgDsn(), readonly config?: Config) {
    this.dsn = assertLocalPgDsn(dsn);
    this.pool = new Pool({ connectionString: this.dsn, max: 8, connectionTimeoutMillis: 5000 });
  }
  id() { return 'local-pg'; }
  uiBaseUrl() { return 'http://127.0.0.1:' + (this.config?.bridgePort ?? 4180); }

  private async ensure(): Promise<void> {
    if (!this.ready) this.ready = this.migrate().catch(error => { this.ready = undefined; throw error; });
    await this.ready;
  }
  /** 幂等建表；advisory lock 避免多个进程同时执行 DDL 时互相抢类型名。 */
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [S + ':migrate']);
      for (const statement of DDL) await client.query(statement);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  private async write<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  private async journal(client: PoolClient, method: string, route: string, detail: unknown) {
    await client.query(`INSERT INTO ${S}.journal (method, route, detail) VALUES ($1,$2,$3)`,
      [method, route, JSON.stringify(detail ?? {})]);
  }

  async health() { return { status: 'ok', deploymentMode: 'local-postgres-host' }; }
  async get<T = any>(route: string): Promise<T> {
    await this.ensure();
    if (route === '/health') return (await this.health()) as T;
    const doc = /^\/issues\/([^/]+)\/documents\/([^/]+)$/.exec(route);
    if (doc) {
      const { rows } = await this.pool.query(
        `SELECT title, body, revision FROM ${S}.documents WHERE issue_id=$1 AND key=$2`, [doc[1], doc[2]]);
      if (!rows[0]) throw new Error('PgHostPlatform GET ' + route + ': 404');
      return { title: rows[0].title, body: rows[0].body, latestRevisionId: String(rows[0].revision) } as T;
    }
    const issue = /^\/issues\/([^/]+)$/.exec(route);
    if (issue) {
      const { rows } = await this.pool.query(`SELECT * FROM ${S}.issues WHERE id=$1`, [issue[1]]);
      if (!rows[0]) throw new Error('PgHostPlatform GET ' + route + ': 404');
      return issueRow(rows[0]) as T;
    }
    const run = /^\/heartbeat-runs\/([^/]+)$/.exec(route);
    if (run) {
      const { rows } = await this.pool.query(`SELECT * FROM ${S}.heartbeat_runs WHERE id=$1`, [run[1]]);
      if (!rows[0]) throw new Error('PgHostPlatform GET ' + route + ': 404');
      return { id: rows[0].id, status: rows[0].status, runToken: rows[0].run_token,
        attempt: Number(rows[0].attempt), localHost: true } as T;
    }
    const costs = /^\/companies\/([^/]+)\/cost-events$/.exec(route);
    if (costs) {
      const { rows } = await this.pool.query(
        `SELECT id, run_id, kind, amount, currency, detail, at FROM ${S}.cost_events WHERE company_id=$1 ORDER BY id`,
        [costs[1]]);
      return rows as T;
    }
    throw new Error('PgHostPlatform 尚未实现 GET ' + route + '；切换前需补齐该 route');
  }
  async post<T = any>(route: string, body: any): Promise<T> {
    await this.ensure();
    const create = /^\/companies\/([^/]+)\/issues$/.exec(route);
    if (create) {
      return await this.write<T>(async client => {
        if (body?.idempotencyKey) {
          const prior = await client.query(`SELECT * FROM ${S}.issues WHERE idempotency_key=$1`, [body.idempotencyKey]);
          if (prior.rows[0]) return issueRow(prior.rows[0]) as T;
        }
        const id = 'LOCALPG-' + randomUUID().slice(0, 8);
        const { rows } = await client.query(
          `INSERT INTO ${S}.issues (id, identifier, title, description, status, company_id, project_id,
             assignee_agent_id, parent_id, visibility, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [id, 'SUI-' + id.slice(-4), String(body?.title ?? '未命名任务'), body?.description ?? null,
            String(body?.status ?? 'backlog'), create[1], body?.projectId ?? null,
            body?.assigneeAgentId ?? null, body?.parentId ?? null, body?.visibility ?? null,
            body?.idempotencyKey ?? null]);
        await this.journal(client, 'POST', route, { id });
        return issueRow(rows[0]) as T;
      });
    }
    const comment = /^\/issues\/([^/]+)\/comments$/.exec(route);
    if (comment) {
      return await this.write<T>(async client => {
        await this.journal(client, 'COMMENT', route, { issueId: comment[1], clientRequestId: body?.clientRequestId });
        return { ok: true } as T;
      });
    }
    const wake = /^\/agents\/([^/]+)\/wakeup$/.exec(route);
    if (wake) {
      return await this.write<T>(async client => {
        await this.journal(client, 'WAKEUP', route, { agentId: wake[1], reason: body?.reason });
        return { ok: true } as T;
      });
    }
    const cost = /^\/companies\/([^/]+)\/cost-events$/.exec(route);
    if (cost) {
      return await this.write<T>(async client => {
        const { rows } = await client.query(
          `INSERT INTO ${S}.cost_events (company_id, run_id, kind, amount, currency, detail)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [cost[1], body?.runId ?? null, String(body?.kind ?? 'model-call'), Number(body?.amount ?? 0),
            String(body?.currency ?? 'USD'), JSON.stringify(body?.detail ?? {})]);
        return { id: Number(rows[0].id), ok: true } as T;
      });
    }
    const runs = route === '/heartbeat-runs';
    if (runs) {
      return await this.write<T>(async client => {
        await client.query(
          `INSERT INTO ${S}.heartbeat_runs (id, status, context) VALUES ($1,'ready',$2)
           ON CONFLICT (id) DO NOTHING`, [String(body?.id), JSON.stringify(body?.context ?? {})]);
        return { id: String(body?.id), status: 'ready' } as T;
      });
    }
    throw new Error('PgHostPlatform 尚未实现 POST ' + route + '；切换前需补齐该 route');
  }
  async patch<T = any>(route: string, body: any): Promise<T> {
    await this.ensure();
    const match = /^\/issues\/([^/]+)$/.exec(route);
    if (!match) throw new Error('PgHostPlatform 尚未实现 PATCH ' + route);
    return await this.write<T>(async client => {
      const { rows } = await client.query(
        `UPDATE ${S}.issues SET status=COALESCE($2,status), updated_at=now() WHERE id=$1 RETURNING *`,
        [match[1], body?.status ?? null]);
      if (!rows[0]) throw new Error('PgHostPlatform PATCH ' + route + ': 404');
      await this.journal(client, 'PATCH', route, { id: match[1], status: rows[0].status });
      return issueRow(rows[0]) as T;
    });
  }
  async document(issueId: string, key: string, title: string, body: string) {
    await this.ensure();
    return await this.write(async client => {
      const prior = await client.query(
        `SELECT title, body, revision FROM ${S}.documents WHERE issue_id=$1 AND key=$2 FOR UPDATE`, [issueId, key]);
      if (prior.rows[0] && prior.rows[0].title === title && prior.rows[0].body === body)
        return { title, body, latestRevisionId: String(prior.rows[0].revision) };
      const { rows } = await client.query(
        `INSERT INTO ${S}.documents (issue_id, key, title, body, revision) VALUES ($1,$2,$3,$4,1)
         ON CONFLICT (issue_id, key) DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body,
           revision=${S}.documents.revision + 1, updated_at=now()
         RETURNING revision`, [issueId, key, title, body]);
      await this.journal(client, 'DOCUMENT', `/issues/${issueId}/documents/${key}`, { revision: Number(rows[0].revision) });
      return { title, body, latestRevisionId: String(rows[0].revision) };
    });
  }

  // ---- ACL / 成员身份 ----------------------------------------------------
  async upsertMember(id: string, displayName: string, roles: string[] = []) {
    await this.ensure();
    await this.pool.query(
      `INSERT INTO ${S}.members (id, display_name, roles) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, roles=EXCLUDED.roles,
         active=true, updated_at=now()`, [id, displayName, JSON.stringify(roles)]);
  }
  async members() {
    await this.ensure();
    const { rows } = await this.pool.query(`SELECT id, display_name, roles, active FROM ${S}.members ORDER BY id`);
    return rows.map(row => ({ id: row.id, displayName: row.display_name, roles: row.roles, active: row.active }));
  }
  /** 业务动作前按当前身份重评；未知或已停用的主体直接拒绝，不静默放行。 */
  async assertMember(actor: string): Promise<void> {
    const member = (await this.members()).find(item => item.id === actor && item.active);
    if (!member) throw new Error('主体未在本地成员目录中或已停用：' + actor);
  }

  // ---- heartbeat checkout / retry / runToken ----------------------------
  /** 原子领取一次执行；过期未完成的 run 可被重新 checkout，旧 token 随即失效。 */
  async checkout(runId: string, workerId: string, staleSeconds = 60) {
    await this.ensure();
    return await this.write(async client => {
      const token = randomUUID();
      const { rows } = await client.query(
        `UPDATE ${S}.heartbeat_runs SET status='running', run_token=$2, worker_id=$3,
           attempt=attempt+1, checkout_at=now(), updated_at=now()
         WHERE id=$1 AND (status IN ('ready','retry')
           OR (status='running' AND checkout_at < now() - make_interval(secs => $4)))
         RETURNING id, status, run_token, worker_id, attempt`,
        [runId, token, workerId, staleSeconds]);
      if (!rows[0]) throw new Error('该执行不可领取：不存在、正在运行或已被其它 worker 持有');
      await this.journal(client, 'CHECKOUT', `/heartbeat-runs/${runId}`, { workerId, attempt: Number(rows[0].attempt) });
      return { id: rows[0].id, status: rows[0].status, runToken: rows[0].run_token,
        workerId: rows[0].worker_id, attempt: Number(rows[0].attempt) };
    });
  }
  async retry(runId: string, reason: string) {
    await this.ensure();
    return await this.write(async client => {
      const { rows } = await client.query(
        `UPDATE ${S}.heartbeat_runs SET status='retry', run_token=NULL, worker_id=NULL,
           updated_at=now() WHERE id=$1 RETURNING id, status`, [runId]);
      if (!rows[0]) throw new Error('heartbeat run 不存在：' + runId);
      await this.journal(client, 'RETRY', `/heartbeat-runs/${runId}`, { reason });
      return { id: rows[0].id, status: rows[0].status };
    });
  }

  // ---- 步进队列：循环与状态分离 -----------------------------------------
  /**
   * 一次事务把整串步骤写入队列；只有第一步是 ready，其余是 queued。
   * 这样「步与步靠队列推进」才有真实约束：后续步骤不会被并行提前领走，
   * 也不存在持有整串状态的常驻进程。
   */
  async enqueueSteps(runId: string, specs: StepSpec[]) {
    await this.ensure();
    return await this.write(async client => {
      let stepNo = 0;
      for (const spec of specs) {
        stepNo += 1;
        await client.query(
          `INSERT INTO ${S}.steps (run_id, step_no, kind, status, payload) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (run_id, step_no) DO NOTHING`,
          [runId, stepNo, spec.kind, stepNo === 1 ? 'ready' : 'queued', JSON.stringify(spec.payload ?? {})]);
      }
      return { runId, enqueued: specs.length, ready: specs.length ? 1 : 0 };
    });
  }
  /**
   * P-11：立即就绪的入队——自动续跑的「续跑闸」用。前一步可能已永久失败，
   * 没有人会再提升 queued 步骤；这道闸必须直接可领取。step_no 接在当前
   * 最大步号之后，冲突时跳过（幂等）。
   */
  async enqueueReadySteps(runId: string, specs: StepSpec[]) {
    await this.ensure();
    return await this.write(async client => {
      const { rows } = await client.query(`SELECT COALESCE(MAX(step_no), 0) AS max FROM ${S}.steps WHERE run_id = $1`, [runId]);
      let stepNo = Number(rows[0]?.max ?? 0);
      let inserted = 0;
      for (const spec of specs) {
        stepNo += 1;
        const result = await client.query(
          `INSERT INTO ${S}.steps (run_id, step_no, kind, status, payload) VALUES ($1,$2,$3,'ready',$4)
           ON CONFLICT (run_id, step_no) DO NOTHING`,
          [runId, stepNo, spec.kind, JSON.stringify(spec.payload ?? {})]);
        inserted += result.rowCount ?? 0;
      }
      return { runId, enqueued: inserted, ready: inserted };
    });
  }
  /**
   * 领一步：FOR UPDATE SKIP LOCKED 保证多个 worker 并发时不会抢到同一步；
   * runToken 是这一步的唯一凭据，进程崩了也能由 recoverStaleSteps 回收。
   */
  async claimStep(workerId: string, runId?: string): Promise<ClaimedStep | null> {
    await this.ensure();
    return await this.write(async client => {
      const token = randomUUID();
      const { rows } = await client.query(
        `WITH next AS (
           SELECT id FROM ${S}.steps
           WHERE status='ready' AND ($2::text IS NULL OR run_id=$2)
           ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE ${S}.steps s SET status='running', claimed_by=$1, run_token=$3,
           attempts=s.attempts+1, updated_at=now()
         FROM next WHERE s.id=next.id
         RETURNING s.*`, [workerId, runId ?? null, token]);
      if (!rows[0]) return null;
      await this.journal(client, 'STEP-CLAIM', `/steps/${rows[0].id}`,
        { runId: rows[0].run_id, stepNo: Number(rows[0].step_no), workerId });
      return stepRow(rows[0]);
    });
  }
  /** 完成当前步并入下一棒：两者在同一事务里，避免「做完了但没排下一步」。 */
  async completeStep(runToken: string, result: Record<string, unknown> = {},
    options: { next?: StepSpec; checkpoint?: Record<string, unknown>; modelCalls?: number } = {}) {
    await this.ensure();
    return await this.write(async client => {
      const held = await client.query(
        `SELECT * FROM ${S}.steps WHERE run_token=$1 AND status='running' FOR UPDATE`, [runToken]);
      if (!held.rows[0]) throw new Error('runToken 无效或该步已结束；不得重复写结果');
      const current = stepRow(held.rows[0]);
      await client.query(
        `UPDATE ${S}.steps SET status='done', result=$2, checkpoint=$3, model_calls=$4,
           updated_at=now() WHERE id=$1`,
        [current.id, JSON.stringify(result), JSON.stringify(options.checkpoint ?? {}),
          Math.max(0, Math.trunc(options.modelCalls ?? 0))]);
      // 先激活预先排好的下一棒；没有预排步骤时，才按 options.next 动态插入。
      // 两者都在同一事务里，不会出现「做完了但没排下一步」或「两步并跑」。
      const candidate = current.stepNo + 1;
      const promoted = await client.query(
        `UPDATE ${S}.steps SET status='ready', updated_at=now()
         WHERE run_id=$1 AND step_no=$2 AND status='queued' RETURNING step_no`,
        [current.runId, candidate]);
      let nextStepNo: number | null = promoted.rows[0] ? Number(promoted.rows[0].step_no) : null;
      if (options.next && nextStepNo === null) {
        const inserted = await client.query(
          `INSERT INTO ${S}.steps (run_id, step_no, kind, status, payload)
           VALUES ($1,$2,$3,'ready',$4) ON CONFLICT (run_id, step_no) DO NOTHING RETURNING step_no`,
          [current.runId, candidate, options.next.kind, JSON.stringify(options.next.payload ?? {})]);
        if (inserted.rows[0]) nextStepNo = Number(inserted.rows[0].step_no);
      }
      await this.journal(client, 'STEP-DONE', `/steps/${current.id}`,
        { runId: current.runId, stepNo: current.stepNo, nextStepNo });
      return { runId: current.runId, stepNo: current.stepNo, nextStepNo,
        modelCalls: Math.max(0, Math.trunc(options.modelCalls ?? 0)) };
    });
  }
  /** 失败按 attempts 决定是否重试；重试会重置 token，不会让旧凭据继续生效。 */
  async failStep(runToken: string, error: string, maxAttempts = 3) {
    await this.ensure();
    return await this.write(async client => {
      const held = await client.query(
        `SELECT * FROM ${S}.steps WHERE run_token=$1 AND status='running' FOR UPDATE`, [runToken]);
      if (!held.rows[0]) throw new Error('runToken 无效或该步已结束');
      const step = stepRow(held.rows[0]);
      const retryable = step.attempts < maxAttempts;
      await client.query(
        `UPDATE ${S}.steps SET status=$2, run_token=NULL, claimed_by=NULL,
           result=$3, updated_at=now() WHERE id=$1`,
        [step.id, retryable ? 'ready' : 'failed', JSON.stringify({ error })]);
      await this.journal(client, 'STEP-FAIL', `/steps/${step.id}`,
        { runId: step.runId, stepNo: step.stepNo, retryable, error });
      return { runId: step.runId, stepNo: step.stepNo, status: retryable ? 'ready' : 'failed', retryable };
    });
  }
  /** 崩溃恢复：超时仍在 running 的步回收为 ready，旧 runToken 作废。 */
  async recoverStaleSteps(staleSeconds = 60) {
    await this.ensure();
    return await this.write(async client => {
      const { rows } = await client.query(
        `UPDATE ${S}.steps SET status='ready', run_token=NULL, claimed_by=NULL, updated_at=now()
         WHERE status='running' AND updated_at < now() - make_interval(secs => $1)
         RETURNING id, run_id, step_no`, [staleSeconds]);
      if (rows.length) await this.journal(client, 'STEP-RECOVER', '/steps', {
        recovered: rows.map(row => ({ id: Number(row.id), runId: row.run_id, stepNo: Number(row.step_no) })),
      });
      return rows.map(row => ({ id: Number(row.id), runId: row.run_id, stepNo: Number(row.step_no) }));
    });
  }
  async runState(runId: string): Promise<RunStateStep[]> {
    await this.ensure();
    const { rows } = await this.pool.query(
      `SELECT step_no, kind, status, claimed_by, attempts, model_calls, result, checkpoint, payload
       FROM ${S}.steps WHERE run_id=$1 ORDER BY step_no`, [runId]);
    return rows.map(row => ({ stepNo: Number(row.step_no), kind: row.kind, status: row.status,
      claimedBy: row.claimed_by, attempts: Number(row.attempts), modelCalls: Number(row.model_calls),
      result: row.result, checkpoint: row.checkpoint, payload: row.payload }));
  }
  async journalLines() {
    await this.ensure();
    const { rows } = await this.pool.query(`SELECT method, route, detail, at FROM ${S}.journal ORDER BY id`);
    return rows.map(row => ({ method: row.method, route: row.route, detail: row.detail, at: row.at }));
  }

  /** 只用于专属测试库重置；绝不用于任何真实业务库。 */
  async resetForTest(): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `TRUNCATE ${S}.steps, ${S}.heartbeat_runs, ${S}.cost_events, ${S}.members,
        ${S}.journal, ${S}.documents, ${S}.issues RESTART IDENTITY`);
  }
  async close() { await this.pool.end(); }

  capabilities(): HostCapabilities {
    return { id: 'local-pg', pluginSdk: false,
      implemented: [
        'issues(create/get/patch)', 'documents(put/get/revision，事务内原子递增)',
        'comments / agents-wakeup / append-only journal',
        'ACL 与成员身份（assertMember 按当前主体拒绝未知身份）',
        'cost-ledger（cost_events 读写）',
        'heartbeat-runs checkout / retry / runToken（原子领取与过期接管）',
        '步进队列（FOR UPDATE SKIP LOCKED 并发领取）',
        '事务与并发控制（PostgreSQL 17）',
        '状态外置与崩溃恢复（completeStep 原子入下一棒 / recoverStaleSteps）',
      ],
      missing: [
        '默认底座仍由宿主承载界面（C-2 已提供自研独立控制台预览，尚未切换默认底座）',
        '真实远端工具沙箱 / 多机 Remote Tool Calling（本轮只验证循环与状态分离，未部署外部执行环境）',
        'Redis 队列横向扩展（本机用 PG SKIP LOCKED 等价；生产大规模可替换，切换点为 claimStep / completeStep / recoverStaleSteps）',
      ] };
  }
}
