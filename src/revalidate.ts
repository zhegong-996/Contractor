/**
 * 授权恢复前重校验（对齐 dsh-superagent `002-authorization.md` Revalidation，MIT）。
 *
 * 一个结束的 Ticket 保持它的 Mandate，真人消息可恢复它且不走新 Eval——
 * 但恢复前要重校验：授权当初成立的依据，今天还成不成立。
 * 依据（basis）有四类，各自的重校验条件不同。本模块是纯判定。
 */

/** 授权当初是凭什么成立的（对齐 dsh `MandateBasis`）。 */
export type MandateBasis = 'explicit-followup' | 'inferred' | 'table-cell' | 'bot';

export interface RevalidateInput {
  basis: MandateBasis;
  /** 当时命中的规则 id。 */
  matchedRuleIds: readonly string[];
  /** 那些规则今天是否仍启用。 */
  rulesStillEnabled: (ruleId: string) => boolean;
  /** 当前 accept mode。 */
  acceptMode: 'off' | 'observe' | 'auto';
  /** 表准入：发送人今天是否仍在对应名单。 */
  senderStillListed?: boolean;
  /** 表准入：今天这张表给该发送人的强度是否仍达到当时强度。 */
  cellStrengthHeld?: boolean;
  /** 机器人：该机器人是否仍在 bot 列表。 */
  botStillListed?: boolean;
  /** 显式跟进的 Mandate 直接通过（无需额外条件）。 */
}

export type RevalidateResult = { valid: boolean; reason: string };

const rulesStillMatch = (input: RevalidateInput) =>
  input.matchedRuleIds.length > 0 && input.matchedRuleIds.every(input.rulesStillEnabled);

/**
 * 恢复前重校验（纯函数）。返回授权是否仍成立、为什么。
 * 对齐 dsh：显式跟进直接通过；inferred / bot 需要 auto 模式 + 规则仍启用；
 * 表准入需要今天仍达到至少原强度；其余需要发送人仍在名单。
 */
export function revalidateMandate(input: RevalidateInput): RevalidateResult {
  switch (input.basis) {
    case 'explicit-followup':
      return { valid: true, reason: '显式跟进的授权直接通过重校验' };

    case 'inferred': {
      if (input.acceptMode !== 'auto') {
        return { valid: false, reason: `推断授权需要 auto 模式才可恢复，当前是 ${input.acceptMode}` };
      }
      return rulesStillMatch(input)
        ? { valid: true, reason: '推断授权：auto 模式且规则仍启用' }
        : { valid: false, reason: '推断授权：规则已变更或停用，重校验失败' };
    }

    case 'table-cell': {
      const listed = input.senderStillListed === true;
      const held = input.cellStrengthHeld === true;
      if (!listed) return { valid: false, reason: '表准入：发送人已不在对应名单，重校验失败' };
      if (!held) return { valid: false, reason: '表准入：今天这张表给发送人的强度已低于当时，重校验失败' };
      return { valid: true, reason: '表准入：发送人仍在名单且强度不变' };
    }

    case 'bot': {
      const listed = input.botStillListed === true;
      if (!listed) return { valid: false, reason: '机器人授权：该机器人已不在 bot 列表，重校验失败' };
      if (input.acceptMode !== 'auto') {
        return { valid: false, reason: `机器人授权需要 auto 模式才可恢复，当前是 ${input.acceptMode}` };
      }
      return rulesStillMatch(input)
        ? { valid: true, reason: '机器人授权：仍在列表、auto 模式、规则仍启用' }
        : { valid: false, reason: '机器人授权：规则已变更或停用，重校验失败' };
    }
  }
}
