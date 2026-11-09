// 跳数熔断（对齐 KKKKhazix/agent-autoloop 的 kernel/decide.ts MAX_HOPS + hopsOf，MIT）。
//
// Agent 交回的事件再派给另一个 Agent 时，层数（hops）+1；超过上限后只记录、不再派活。
// 没有这道闸，A 干完叫醒 B、B 干完叫醒 A，一个晚上能把额度绕光（无限套娃）。

/** 一条处理链最多允许的 Agent 交接层数；超过即熔断。 */
export const MAX_HOPS = 8;

/** 一批事件里最大的 hops（未标 hops 的按 0 计）。 */
export function hopsOf(events: readonly { hops?: number }[]): number {
  let max = 0;
  for (const event of events) {
    const hops = Number(event.hops ?? 0);
    if (Number.isFinite(hops) && hops > max) max = hops;
  }
  return max;
}

/** 一次 Agent 交回再派活，层数 +1。 */
export function nextHops(currentHops: number): number {
  return Math.max(0, Math.floor(currentHops)) + 1;
}

export interface FuseDecision {
  /** 是否允许继续派活。 */
  admissible: boolean;
  /** 熔断时给的原因；未熔断为空。 */
  reason: string;
  /** 熔断后是否仍要留痕（审计）——永远是 true，熔断不是删除，是只记录不派活。 */
  recordOnly: boolean;
}

/**
 * 熔断判定：hops 超过 MAX_HOPS 即「只记录、不再派活」。
 * 熔断不是丢弃——事件仍要进审计日志，只是不再产生新的执行轮次。
 */
export function fuseDecision(hops: number): FuseDecision {
  if (hops > MAX_HOPS) {
    return { admissible: false, recordOnly: true,
      reason: `同一条处理链已超过 ${MAX_HOPS} 层（当前 ${hops}），后续事件只记录、不再派发，防止 Agent 互相唤醒无限套娃` };
  }
  return { admissible: true, recordOnly: false, reason: '' };
}
