/**
 * 巡检播报：只有「真的变了」才出声。
 *
 * 出处：千问办公的定时汇总——到点不用 @ 它，有进展自己推过来。
 * 我们的例行（routines）本来就会定时跑，缺的是最后这一步：
 * 跑完把「没变化」也播报一遍，等于制造噪声。这里用快照比对解决。
 *
 * 另外接一条闭环：产物 revision 变了 → 触发对账（见 reconcile.ts），
 * 把「要多看几眼的地方」并进同一张卡。仍然只报不改。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 一个任务在快照里的样子：阶段 + 验收轮次，足以判断「有没有变化」。 */
export interface TaskMark {
  phase: string;
  round: number | null;
  /** 产物修订号；变了说明产物被改过，值得重算一遍待办。 */
  artifactRevision?: string | number | null;
}

export interface PatrolSnapshot {
  schemaVersion: 1;
  at: string;
  tasks: Record<string, TaskMark>;
}

export interface PatrolChange {
  taskId: string;
  kind: 'phase' | 'round' | 'artifact';
  from: string;
  to: string;
  /** 产物变了：建议重算待办（调用方决定要不要真的跑对账）。 */
  recheck?: boolean;
}

export const snapshotFile = (dir: string) => path.join(dir, 'patrol-snapshot.json');

export function readSnapshot(dir: string): PatrolSnapshot | null {
  try {
    const file = snapshotFile(dir);
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as PatrolSnapshot;
    return parsed?.tasks ? parsed : null;
  } catch { return null; }
}

export function writeSnapshot(dir: string, tasks: Record<string, TaskMark>, at = new Date().toISOString()): PatrolSnapshot {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const snapshot: PatrolSnapshot = { schemaVersion: 1, at, tasks };
  writeFileSync(snapshotFile(dir), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  return snapshot;
}

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/**
 * 比对两次快照。首次巡检（没有上一份快照）不算变化——
 * 否则上线第一天会把所有任务当成「新变化」推一遍。
 */
export function diffSnapshot(previous: PatrolSnapshot | null, next: Record<string, TaskMark>): PatrolChange[] {
  if (!previous) return [];
  const changes: PatrolChange[] = [];
  for (const [taskId, mark] of Object.entries(next)) {
    const before = previous.tasks[taskId];
    if (!before) continue;                       // 新任务由派活链路自己通知，巡检不重复报
    if (str(before.phase) !== str(mark.phase)) {
      changes.push({ taskId, kind: 'phase', from: str(before.phase), to: str(mark.phase) });
    }
    if (str(before.round) !== str(mark.round)) {
      changes.push({ taskId, kind: 'round', from: str(before.round), to: str(mark.round) });
    }
    const artifactChanged = str(before.artifactRevision) !== str(mark.artifactRevision) && str(mark.artifactRevision) !== '';
    if (artifactChanged) {
      changes.push({ taskId, kind: 'artifact',
        from: str(before.artifactRevision) || '未记录', to: str(mark.artifactRevision), recheck: true });
    }
  }
  return changes;
}

/**
 * 巡检卡片。没有变化就返回空串 —— 调用方据此决定「不发消息」，
 * 而不是发一条「本次无变化」制造噪声。
 */
export function patrolCard(changes: readonly PatrolChange[], options: { at?: string } = {}): string {
  if (changes.length === 0) return '';
  const label: Record<PatrolChange['kind'], string> = { phase: '阶段', round: '验收轮次', artifact: '产物修订' };
  const byTask = new Map<string, PatrolChange[]>();
  for (const change of changes) {
    if (!byTask.has(change.taskId)) byTask.set(change.taskId, []);
    byTask.get(change.taskId)!.push(change);
  }
  const lines = [`【巡检】${byTask.size} 个任务有变化（${options.at ?? new Date().toISOString()}）`];
  for (const [taskId, list] of byTask) {
    lines.push(`· ${taskId}`);
    for (const change of list) {
      lines.push(`  - ${label[change.kind]}：${change.from || '空'} → ${change.to || '空'}`
        + (change.recheck ? '（产物改过，建议和待办对一遍）' : ''));
    }
  }
  const recheck = changes.filter(change => change.recheck).length;
  if (recheck) lines.push(`产物有 ${recheck} 处修订，可执行对账核对清单。`);
  lines.push('以上只是巡检结果，没有改动任何任务状态。');
  return lines.join('\n');
}
