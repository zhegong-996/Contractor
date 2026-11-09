// 事件合并（对齐 KKKKhazix/agent-autoloop 的 kernel/decide.ts enqueue + lane，MIT）。
//
// 同一件事短时间连续进来多条消息，不该开多个 Agent 去抢同一个东西——那会产出多份互相冲突的改动。
// 这里把「同一规则 + 同一 lane」的事件合并进同一个排队轮次，Agent 只启动一次，多条消息作为上下文一次交给它。

export interface MergeableEvent {
  id: string;
  /** 事件的主题标识；parallel 规则用它做 lane，让「同一件事」合并。 */
  subject: string;
}

export interface QueueRun {
  id: string;
  rule: string;
  lane: string;
  state: 'queued' | 'running' | 'done';
  eventIds: string[];
}

/**
 * 计算一条事件在给定规则下的 lane：
 * - 串行规则（parallel=false）：lane 为空，同规则所有事件合并进同一个排队轮次；
 * - 并行规则（parallel=true）：lane 用 subject，只有「同一件事」才合并。
 */
export function laneOf(rule: { parallel: boolean }, event: { subject: string }): string {
  return rule.parallel ? String(event.subject ?? '') : '';
}

/**
 * 把一条事件挂进队列：同规则同 lane 已有 queued 轮次就复用，否则新建。
 * 返回该轮次；调用方据此只启动一个 Agent，把 eventIds 全部交给它。
 */
export function enqueueRun(
  runs: readonly QueueRun[],
  rule: { name: string; parallel: boolean },
  event: MergeableEvent,
  makeId: () => string,
): QueueRun {
  const lane = laneOf(rule, event);
  const existing = runs.find(run => run.rule === rule.name && run.lane === lane && run.state === 'queued');
  if (existing) return { ...existing, eventIds: [...existing.eventIds, event.id] };
  return { id: makeId(), rule: rule.name, lane, state: 'queued', eventIds: [event.id] };
}

/**
 * 一批事件按规则归并成「该启动几个 Agent」的分组。
 * 返回每一组一个 run（同一组的事件合并进一个 run）。
 */
export function groupEvents(
  events: readonly MergeableEvent[],
  rule: { name: string; parallel: boolean },
  makeId: () => string,
): QueueRun[] {
  const runs: QueueRun[] = [];
  for (const event of events) {
    const lane = laneOf(rule, event);
    const existing = runs.find(run => run.rule === rule.name && run.lane === lane && run.state === 'queued');
    if (existing) existing.eventIds.push(event.id);
    else runs.push({ id: makeId(), rule: rule.name, lane, state: 'queued', eventIds: [event.id] });
  }
  return runs;
}
