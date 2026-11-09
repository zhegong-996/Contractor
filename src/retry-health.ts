/**
 * 第三十八轮 · 出站队列的重试健康（`retry-health` 视图的后端）。
 *
 * RE-AUDIT 第 3.2 节：「出站队列 / 重试健康 / 通知去重」这一格此前是 ◐ ——
 * outbox 状态机（pending / mirrored / local_only / sent / suppressed）是有的，
 * 但**没有独立的 retry-health 视图**，于是「积压了多久、哪一路在失败」只能靠
 * 翻日志。这一层把状态机读成一张人能看懂的健康表。
 *
 * 三条口径必须先说清，否则「pending 很多」会被误读成「系统坏了」：
 *   - **pending 不等于失败**：飞书不可达时消息刻意堆在队列里等恢复（不丢），
 *     这是设计，不是 bug；
 *   - **local_only 是有意的**：本地任务没有飞书回信地址，只能留在本机；
 *   - **suppressed 是注意力预算裁掉的**：人问的问题 / 验收 / 授权类永远不裁。
 */
import type { Store } from './store.ts';

export type OutboxRow = { id: string; issueId: string; state: string; at?: string | undefined };

export type RetryHealth = {
  schemaVersion: 1;
  at: string;
  total: number;
  states: { state: string; count: number; label: string }[];
  pending: {
    count: number;
    oldestMinutes: number | null;
    stuckThresholdMinutes: number;
    stuck: { id: string; issueId: string; minutes: number | null }[];
  };
  failures: { channel: string; count: number; lastAt: string | null }[];
  verdict: 'healthy' | 'backlog' | 'failing';
  notes: string[];
};

const LABELS: Record<string, string> = {
  pending: '待投递', mirrored: '已镜像到他路', local_only: '仅本机', sent: '已送达', suppressed: '预算裁掉',
};

const NOTES = [
  '待投递不等于失败：飞书不可达时消息刻意留在队列等恢复，不丢消息。',
  '仅本机是有意的：本地任务没有飞书回信地址，只能在控制台看到。',
  '预算裁掉只针对过程通知；人问的问题、验收与授权类永远不裁。',
];

export function buildRetryHealth(input: {
  rows: OutboxRow[];
  /** 审计里的投递失败记录（im-outbound.failed），只看窗口内的。 */
  failures: { channel: string; at: string }[];
  now?: Date;
  stuckThresholdMinutes?: number;
  failureWindowHours?: number;
}): RetryHealth {
  const now = input.now ?? new Date();
  const stuckThresholdMinutes = input.stuckThresholdMinutes ?? 15;
  const windowMs = (input.failureWindowHours ?? 24) * 3_600_000;

  const tally = new Map<string, number>();
  for (const row of input.rows) tally.set(row.state, (tally.get(row.state) ?? 0) + 1);
  const states = [...tally.entries()].map(([state, count]) => ({ state, count, label: LABELS[state] ?? state }))
    .sort((a, b) => b.count - a.count);

  const pendingRows = input.rows.filter(row => row.state === 'pending');
  const ages = pendingRows.map(row => (row.at ? Math.max(0, Math.round((now.getTime() - Date.parse(row.at)) / 60_000)) : null));
  const oldestMinutes = ages.filter((age): age is number => age !== null).sort((a, b) => b - a)[0] ?? null;
  const stuck = pendingRows.map((row, index) => ({ id: row.id, issueId: row.issueId, minutes: ages[index] ?? null }))
    .filter(item => item.minutes !== null && item.minutes >= stuckThresholdMinutes)
    .sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))
    .slice(0, 20);

  const recent = input.failures.filter(failure => {
    const at = Date.parse(failure.at);
    return Number.isFinite(at) && now.getTime() - at <= windowMs;
  });
  const byChannel = new Map<string, { count: number; lastAt: string | null }>();
  for (const failure of recent) {
    const cell = byChannel.get(failure.channel) ?? { count: 0, lastAt: null };
    cell.count += 1;
    if (!cell.lastAt || failure.at > cell.lastAt) cell.lastAt = failure.at;
    byChannel.set(failure.channel, cell);
  }
  const failures = [...byChannel.entries()].map(([channel, cell]) => ({ channel, ...cell }))
    .sort((a, b) => b.count - a.count);

  // 判定：有失败且仍有积压 = failing（在漏）；只积压 = backlog（在等）；否则健康。
  const verdict: RetryHealth['verdict'] = failures.length && pendingRows.length ? 'failing'
    : stuck.length || (pendingRows.length && oldestMinutes !== null && oldestMinutes >= stuckThresholdMinutes) ? 'backlog'
    : 'healthy';

  return {
    schemaVersion: 1, at: now.toISOString(), total: input.rows.length, states,
    pending: { count: pendingRows.length, oldestMinutes, stuckThresholdMinutes, stuck },
    failures, verdict,
    notes: verdict === 'healthy' ? [...NOTES] : [
      ...(verdict === 'failing' ? ['最近 24 小时有投递失败，且队列里还有待投递：先看失败原因，再看积压是否在涨。'] : []),
      ...(verdict === 'backlog' ? [`有待投递超过 ${stuckThresholdMinutes} 分钟：确认通道是否可达，不要直接清队列。`] : []),
      ...NOTES,
    ],
  };
}

/** 从库里读出 outbox 与失败审计，交给纯函数汇总（只读，不改任何状态）。 */
export function readRetryHealth(store: Store, opts: { now?: Date; stuckThresholdMinutes?: number; failureWindowHours?: number } = {}): RetryHealth {
  const rows = store.db.prepare('SELECT id,issue_id,state,at FROM outbox').all() as { id: string; issue_id: string; state: string; at?: string }[];
  const since = new Date((opts.now ?? new Date()).getTime() - (opts.failureWindowHours ?? 24) * 3_600_000).toISOString();
  const auditRows = store.db.prepare("SELECT at,value FROM audit WHERE action='im-outbound.failed' AND at>=?").all(since) as { at: string; value: string }[];
  const failures = auditRows.map(row => {
    let channel = 'unknown';
    try { channel = String((JSON.parse(row.value) as { channel?: string }).channel ?? 'unknown'); } catch { /* 坏记录按 unknown 计数 */ }
    return { channel, at: row.at };
  });
  return buildRetryHealth({ rows: rows.map(row => ({ id: row.id, issueId: row.issue_id, state: row.state, at: row.at ?? undefined })), failures, ...opts });
}
