/**
 * 失败恢复：指数退避 + 「不可用」判定（对齐 dsh-superagent `003-execution.md`，MIT）。
 *
 * dsh 区分两类失败：
 *   - 瞬时失败（transient）：模型 provider/网络的 408/429/5xx、连接拒绝/重置/超时——
 *     重试 3 次，退避递增；Eval 连续两次过期后，第三次记 unavailable。
 *   - 硬失败（hard）：配置错误、权限拒绝——不重试。
 *
 * 本模块只产出「要不要重试、退避多久、要不要记 unavailable」的纯判定，
 * 实际网络动作由调用方执行。
 */

export interface RetryInput {
  /** 第几次尝试（从 1 起）。 */
  attempt: number;
  /** 上一次失败是否瞬时（可重试）失败。 */
  transient: boolean;
}

export interface RetryDecision {
  retry: boolean;
  /** 下一次重试前要等的毫秒数。 */
  delayMs: number;
  /** 连续瞬时失败达到上限、该记 unavailable。 */
  unavailable: boolean;
  reason: string;
}

/** 瞬时失败最多重试几次（不含首次）。 */
export const MAX_TRANSIENT_RETRIES = 3;

/** 指数退避：2s 起步，翻倍，封顶。 */
export function backoffMs(attempt: number, { baseMs = 2000, capMs = 60_000 } = {}): number {
  return Math.min(baseMs * 2 ** Math.max(0, attempt - 1), capMs);
}

/** 是否是 dsh 定义的瞬时失败（可重试的那类）。 */
export function isTransientFailure(error: { code?: number | string; message?: string }): boolean {
  const code = Number(error?.code);
  if (code === 408 || code === 429 || (code >= 500 && code < 600)) return true;
  const message = String(error?.message ?? '');
  return /(refused|reset|timed?\s*out|ECONN|ENOTFOUND|ETIMEDOUT)/i.test(message);
}

/**
 * 一次失败后的处置（纯判定）。
 * 硬失败直接不可用；瞬时失败在第 3 次重试后仍失败 → unavailable。
 */
export function retryDecision(input: RetryInput): RetryDecision {
  if (!input.transient) {
    return { retry: false, delayMs: 0, unavailable: true,
      reason: '硬失败（配置/权限/输入错误），不重试，记 unavailable' };
  }
  if (input.attempt > MAX_TRANSIENT_RETRIES) {
    return { retry: false, delayMs: 0, unavailable: true,
      reason: `连续 ${MAX_TRANSIENT_RETRIES} 次瞬时失败，记 unavailable` };
  }
  return { retry: true, delayMs: backoffMs(input.attempt), unavailable: false,
    reason: `瞬时失败，第 ${input.attempt} 次重试，退避 ${backoffMs(input.attempt)}ms` };
}

/** Eval 过期/失败的 unavailable 记录（连续两次过期后第三次记 unavailable）。 */
export function evalUnavailable(consecutiveTimeouts: number): { unavailable: boolean; reason: string } {
  return consecutiveTimeouts >= 3
    ? { unavailable: true, reason: `Eval 连续 ${consecutiveTimeouts} 次未完成，记 unavailable` }
    : { unavailable: false, reason: `Eval 第 ${consecutiveTimeouts} 次未完成，仍可重试` };
}
