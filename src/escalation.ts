// 12b ⑩（第三十一轮落地）：升级通道「只通知不代批」+ 限速静音。
//
// 思想来源（仅借概念，见 docs/REFERENCE-openmausbot.md 第 2.2 节与差距清单
// 第 10 项）：Chief 只通知、不代人批准、不派活；升级线程 1 小时 3 次限速静音。
//
// 本仓库的落点：把「Needs you」人必达通知扩成有去重的升级闸——
//   * 同一（任务, 主题）在窗口期内**只通知一次**：问题还挂着时不再重复打扰；
//   * 全局限速：1 小时窗口内最多 3 条，超出静音并计数（呼应 C-6「人被打断
//     次数」指标——静音数就是被省掉的打扰数）；
//   * 恒 advisory：升级通知永远不携带也不代替批准动作，原文案注明
//     「不代为批准；请在原会话处理」。
// 纯函数 + 调用方持久化窗口状态，不引常驻服务。
import { z } from 'zod';

export const ESCALATION_WINDOW_MS = 60 * 60 * 1000;
export const ESCALATION_MAX_PER_WINDOW = 3;

export const escalationEventSchema = z.object({
  taskId: z.string().min(1).max(120),
  topic: z.string().min(1).max(160),
  at: z.number().int().nonnegative(),
}).strict();
export type EscalationEvent = z.infer<typeof escalationEventSchema>;

export type EscalationGateResult = {
  /** true = 发出这条升级通知；false = 静音（去重或限速）。 */
  notify: boolean;
  reason: string;
  /** 窗口内已发出的通知数（含本条）。 */
  windowCount: number;
  /** 因去重 / 限速被省掉的打扰次数（累计）。 */
  muted: number;
  /** 恒 advisory：通知不携带也不代替批准动作。 */
  advisory: true;
  modelCalls: 0;
};

/**
 * 升级闸（纯函数）：`state` 是调用方持久化的历史通知记录（时间 + 任务 + 主题）。
 * 判定顺序固定：去重（同任务同主题窗口内已通知过）→ 限速（窗口内总数 ≥3）→ 放行。
 */
export function escalationGate(state: EscalationEvent[], incoming: EscalationEvent,
  options: { windowMs?: number; maxPerWindow?: number } = {}): EscalationGateResult {
  const event = escalationEventSchema.parse(incoming);
  const windowMs = options.windowMs ?? ESCALATION_WINDOW_MS;
  const maxPerWindow = options.maxPerWindow ?? ESCALATION_MAX_PER_WINDOW;
  const windowStart = event.at - windowMs;
  const recent = state.filter(prior => prior.at > windowStart);
  const windowCount = recent.length + 1;
  // 去重：同一问题还挂着（窗口内已通知过同任务同主题），不重复打扰。
  if (recent.some(prior => prior.taskId === event.taskId && prior.topic === event.topic))
    return { notify: false, reason: '同任务同主题已通知过，等待处理期间不重复打扰',
      windowCount: recent.length, muted: 1, advisory: true, modelCalls: 0 };
  // 限速：窗口内已达上限，静音计数（这条静音数如实上报，不吞掉）。
  if (recent.length >= maxPerWindow)
    return { notify: false, reason: `1 小时窗口内已通知 ${recent.length} 条，超出上限静音`,
      windowCount: recent.length, muted: 1, advisory: true, modelCalls: 0 };
  return { notify: true, reason: '升级通知；不代为批准，请在原会话处理',
    windowCount, muted: 0, advisory: true, modelCalls: 0 };
}

/** 升级通知的标准文案（恒带「不代为批准」防呆，任何级别都不替人回答）。 */
export function escalationMessage(result: EscalationGateResult, question: string): string {
  if (!result.notify) return '';
  return `【需要你】${question.slice(0, 200)}\n（升级通道只通知、不代为批准：这里不提供也不代替批准动作，请在原会话处理；本窗口已通知 ${result.windowCount} 条）`;
}

/** V5 超时升级：悬而未决超过时限、无人处理，就升级到该域的 owner，而不是静默挂着。 */
export interface TimeoutEscalationInput {
  /** 业务域；升级落到这个域的 owner。 */
  domain: string;
  domainOwner: string;
  pendingSince: string;
  now?: string;
  timeoutMs?: number;
}

export interface TimeoutEscalationResult {
  escalated: boolean;
  to: string;
  reason: string;
  elapsedMs: number;
}

export const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * 纯判定：挂多久算超时、超时后升级给谁。不做任何通知动作，
 * 通知仍走 escalationGate（去重 + 限速），升级本身只产出「该找谁」。
 */
export function timeoutEscalation(input: TimeoutEscalationInput): TimeoutEscalationResult {
  const now = Date.parse(input.now ?? new Date().toISOString());
  const pending = Date.parse(input.pendingSince);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const elapsedMs = now - pending;
  const domain = String(input.domain ?? '').trim() || 'default';
  const domainOwner = String(input.domainOwner ?? '').trim();
  if (!domainOwner) {
    return { escalated: true, to: '', elapsedMs,
      reason: `悬置已 ${Math.round(elapsedMs / 3600000)} 小时，但 ${domain} 域没有 owner，无法自动升级——需要人指定负责人` };
  }
  if (elapsedMs >= timeoutMs) {
    return { escalated: true, to: domainOwner, elapsedMs,
      reason: `悬置超过 ${Math.round(timeoutMs / 3600000)} 小时无人处理，升级给 ${domain} 域 owner ${domainOwner}` };
  }
  return { escalated: false, to: domainOwner, elapsedMs, reason: '尚未超时，继续等原负责人' };
}
