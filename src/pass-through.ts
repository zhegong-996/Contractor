// 直通（pass-through）契约：同一会话里对已绑定任务的补充说明，直接交给
// 该任务原来的承接方，不再新建任务、不再过 Router。
//
// 为什么要把这件事单独写成一个纯函数：
//   - 它是一条**绕过派活层**的路径，必须能一眼看出它绕过了什么、没绕过什么；
//   - 它此前散在 CollaborationIntake.ingestTrigger 的 if 分支里，只能靠读代码
//     推断边界，无法单独验证；
//   - 直通只能「少建一张单」，不能「多给一份权」——权限、验收、范围一个字都不能放宽。
//
// 直通不改变的四件事（红线，任何配置都不可放宽）：
//   1. 只认原绑定：发起人与会话必须同时匹配任务上的 imBinding；
//   2. 不复活已完成任务（accepted 之后只能走新的发起）；
//   3. 显式指令（确认验收 / 退回 / 转交 / 查进度 / 建单）一律回主链路；
//   4. 带上别人的会话身份不算数：成员归属与任务发起人不符即拒绝。
//
// 与 DeepSeek Super-agent 的对应关系：上游叫「订阅直通」——同一 Thread 的事件
// 直接唤醒该 Thread 的 Agent，不经过中央 Router。这里保留同样的传输优化，
// 但明确它**不是**组织级越级，也不参与「谁有资格接这一棒」的判断。
import type { NativeTrigger } from './upstream.ts';

/** 显式指令走主链路；直通只处理「补充说明」。 */
export const PASS_THROUGH_BLOCKING_ACTIONS = ['task', 'status', 'accept', 'reject', 'handoff'] as const;

export type PassThroughCandidate = {
  id: string;
  phase: string;
  binding?: { senderId: string; chatId: string } | null;
  requesterUserId?: string | null;
};

export type PassThroughInput = {
  /** parseUserCommand 的结果；显式指令不进直通。 */
  explicitAction?: string | null;
  /** 与该发起人 + 会话绑定的全部任务（含已完成），由本函数判定可接续的那一条。 */
  candidates: readonly PassThroughCandidate[];
  actor: { id: string; chatId: string };
  /** 当前成员身份（配对过的真人）；未配对为 null。 */
  member?: { userId: string } | null;
};

export type PassThroughKind =
  | 'direct'          // 命中：直接接续原任务
  | 'explicit-command'// 显式指令，交回主链路
  | 'no-binding'      // 没有绑定任务，按新需求进入 Router
  | 'ambiguous'       // 同一会话绑定了多条在办任务，需指明任务号
  | 'accepted'        // 只绑定了已验收任务，直通不复活，按新需求走
  | 'ownership';      // 成员身份与任务发起人不符

export type PassThroughDecision = {
  direct: boolean;
  kind: PassThroughKind;
  taskId: string | null;
  reason: string;
  /** 鉴权类失败要显式拒绝，不能静默降级成「新需求」。 */
  deny: boolean;
  needsTaskReference: boolean;
  modelCalls: 0;
};

const result = (direct: boolean, kind: PassThroughKind, reason: string,
  extra: Partial<PassThroughDecision> = {}): PassThroughDecision => ({
  direct, kind, taskId: null, reason, deny: false, needsTaskReference: false, modelCalls: 0, ...extra,
});

export function passThroughDecision(input: PassThroughInput): PassThroughDecision {
  const action = input.explicitAction ?? null;
  if (action && (PASS_THROUGH_BLOCKING_ACTIONS as readonly string[]).includes(action))
    return result(false, 'explicit-command', `显式指令「${action}」走主链路，不当作同会话补充说明`);

  const bound = input.candidates.filter(candidate =>
    candidate.binding
    && candidate.binding.senderId === input.actor.id
    && candidate.binding.chatId === input.actor.chatId);
  if (bound.length === 0)
    return result(false, 'no-binding', '当前会话没有绑定在办任务，按新需求进入 Router');

  const open = bound.filter(candidate => candidate.phase !== 'accepted');
  if (open.length === 0)
    return result(false, 'accepted', '该会话只绑定了已验收任务，直通不复活；按新需求走');
  if (open.length > 1)
    return result(false, 'ambiguous', `当前会话绑定了 ${open.length} 条在办任务，请指明任务号`, { needsTaskReference: true });

  const only = open[0]!;
  if (input.member?.userId && only.requesterUserId && only.requesterUserId !== input.member.userId)
    return result(false, 'ownership', 'Unauthorized: 成员身份与任务发起人不符', { deny: true });

  return {
    direct: true, kind: 'direct', taskId: only.id,
    reason: '同一发起人在同一会话的补充说明，直接接续原任务；权限与验收范围不变',
    deny: false, needsTaskReference: false, modelCalls: 0,
  };
}

/** 归一化后的触发是否属于「同会话补充说明」（不含斜杠命令）。 */
export function isFollowup(trigger: NativeTrigger): boolean {
  const text = String(trigger.text ?? '').trim();
  return Boolean(text) && !text.startsWith('/');
}
