// 第六十八轮 · 群组编排：对标 LobeHub 的 GroupOrchestrationRuntime。
//
// LobeHub 的四种协作模式与两条熔断，是这个模块的唯一蓝本：
//   speak        只叫一个成员发言
//   broadcast    并行叫多个成员，**默认禁工具**（只说不做）
//   delegate     把活转交出去，下一轮由承接方收口，主持人不再插手
//   executeTask  派一次异步执行（可批量），等回执
//   熔断         单 agent 是 maxSteps / costLimit，群组是 maxRounds；
//                未知决策一律收敛成 finish，不带着看不懂的结果继续跑
//
// 我们的语义对应：
//   主持人 = 协作事务 Agent（workspace-assistant，只读）
//   成员   = 编制里能承接服务的 agent（agent-registry / agent-services）
//   一轮   = 一次编排决策
//
// 边界（必须说清楚，避免被当成"自动派活机"）：
// 本模块只产出**决策**，不执行、不派单、不改任务状态。派单仍归 paperclip，
// 人的授权与验收仍归人。决策可以被落库、被对账，但不能自己生效。
//
// 纯函数：不 IO、不读时钟、零模型调用。

export type GroupMode = 'speak' | 'broadcast' | 'delegate' | 'executeTask' | 'finish';

export type GroupRole = 'supervisor' | 'member';

/** 成员能承接的服务类型，与 agent-services 的 offers 对齐。 */
export type GroupOffer = 'feasibility' | 'draft' | 'review';

export type GroupMember = {
  key: string;
  name: string;
  role: GroupRole;
  offers: GroupOffer[];
  enabled: boolean;
};

export type GroupState = {
  /** 已完成的轮数。 */
  round: number;
  maxRounds: number;
  /** 每个成员已发言次数，用于防"同一个人一直说"。 */
  spoken: Record<string, number>;
  /** delegate 的承接方；一旦设定，主持人不再收口。 */
  delegatedTo: string | null;
  finished: boolean;
};

export type GroupReason = { code: string; text: string };

export type GroupDecision = {
  mode: GroupMode;
  /** 本轮被叫到的人。finish 时为空。 */
  targets: string[];
  /** 是否允许被叫到的人动工具。broadcast 恒为 false。 */
  toolsAllowed: boolean;
  /** 谁负责收口本轮。delegate 后是承接方，其余是主持人。 */
  closer: string | null;
  reasons: GroupReason[];
  /** 熔断/停止原因；null 表示正常推进。 */
  stopped: string | null;
};

export const DEFAULT_MAX_ROUNDS = 6;

export function emptyGroupState(maxRounds = DEFAULT_MAX_ROUNDS): GroupState {
  return { round: 0, maxRounds, spoken: {}, delegatedTo: null, finished: false };
}

/** 群组校验：必须恰好一个启用中的主持人；成员 key 不可重复。 */
export function validateGroup(members: readonly GroupMember[]): string | null {
  const keys = members.map(m => m.key);
  if (new Set(keys).size !== keys.length) return '成员标识重复';
  const supervisors = members.filter(m => m.role === 'supervisor' && m.enabled);
  if (supervisors.length === 0) return '没有启用中的主持人，群组无法推进';
  if (supervisors.length > 1) return '主持人不唯一，收口责任会打架';
  return null;
}

const eligible = (members: readonly GroupMember[], offer?: GroupOffer): GroupMember[] =>
  members.filter(m => m.enabled && m.role === 'member' && (!offer || m.offers.includes(offer)));

const supervisorOf = (members: readonly GroupMember[]): GroupMember | undefined =>
  members.find(m => m.enabled && m.role === 'supervisor');

/** 轮转：优先选发言次数最少的，避免一个人包场。 */
function leastSpoken(state: GroupState, pool: readonly GroupMember[]): GroupMember | undefined {
  if (!pool.length) return undefined;
  return [...pool].sort((a, b) => {
    const diff = (state.spoken[a.key] ?? 0) - (state.spoken[b.key] ?? 0);
    return diff !== 0 ? diff : a.key.localeCompare(b.key);
  })[0];
}

export type GroupIntent = 'opinions' | 'handoff' | 'execute' | 'answer';

/**
 * 决定下一轮怎么协作。
 *
 * 四模式的选择完全由 intent 决定，不看"模型觉得"——判断是工程层：
 * 需要多方意见就 broadcast（且禁工具，免得边聊边改），需要交出去就 delegate
 * （单向终态），需要动手就 executeTask，只是问一句就 speak。
 *
 * 熔断优先于一切：轮次耗尽、群组非法、成员不足，都收敛成 finish 并说明原因。
 */
export function decideGroupTurn(input: {
  members: readonly GroupMember[];
  state: GroupState;
  intent: GroupIntent;
  from: string;
}): GroupDecision {
  const { members, state, intent, from } = input;
  const supervisor = supervisorOf(members);
  const base = { toolsAllowed: false, closer: supervisor?.key ?? null, stopped: null as string | null };

  const invalid = validateGroup(members);
  if (invalid) {
    return { ...base, mode: 'finish', targets: [], closer: null,
      reasons: [{ code: 'group:invalid', text: invalid }], stopped: 'group-invalid' };
  }
  if (state.finished) {
    return { ...base, mode: 'finish', targets: [],
      reasons: [{ code: 'group:finished', text: '本轮协作已结束' }], stopped: 'already-finished' };
  }
  // delegate 是终态：承接方还没回执前，主持人不再发号施令。
  if (state.delegatedTo) {
    return { ...base, mode: 'finish', targets: [], closer: state.delegatedTo,
      reasons: [{ code: 'group:waiting-handoff', text: `已交给 ${state.delegatedTo}，等回执` }],
      stopped: 'waiting-handoff' };
  }
  if (state.round >= state.maxRounds) {
    return { ...base, mode: 'finish', targets: [],
      reasons: [{ code: 'group:round-budget', text: `已用满 ${state.maxRounds} 轮，收敛结束` }],
      stopped: 'round-budget-exhausted' };
  }

  const membersOnly = eligible(members);

  if (intent === 'opinions') {
    // broadcast 至少要两个人，否则退化成 speak。
    if (membersOnly.length < 2) {
      const one = leastSpoken(state, membersOnly);
      if (!one) {
        return { ...base, mode: 'finish', targets: [],
          reasons: [{ code: 'group:no-member', text: '没有可发言的成员' }], stopped: 'no-eligible-member' };
      }
      return { ...base, mode: 'speak', targets: [one.key],
        reasons: [
          { code: 'group:broadcast-degraded', text: '可发言成员不足两人，退化为单人发言' },
          { code: 'group:pick', text: `选 ${one.name}：发言次数最少` },
        ] };
    }
    return { ...base, mode: 'broadcast', targets: membersOnly.map(m => m.key).sort(), toolsAllowed: false,
      reasons: [
        { code: 'group:broadcast', text: `需要多方意见，并行叫 ${membersOnly.length} 人` },
        { code: 'group:tools-off', text: 'broadcast 默认禁工具：只说不做，避免边聊边改' },
      ] };
  }

  if (intent === 'handoff') {
    const one = leastSpoken(state, membersOnly);
    if (!one) {
      return { ...base, mode: 'finish', targets: [],
        reasons: [{ code: 'group:no-member', text: '没有可承接的成员' }], stopped: 'no-eligible-member' };
    }
    return { mode: 'delegate', targets: [one.key], toolsAllowed: true, closer: one.key,
      reasons: [
        { code: 'group:delegate', text: `交给 ${one.name} 承接，主持人不再收口` },
        { code: 'group:pick', text: '选发言次数最少的成员，避免同一人连轴' },
      ], stopped: null };
  }

  if (intent === 'execute') {
    const pool = eligible(members, 'draft');
    const one = leastSpoken(state, pool);
    if (!one) {
      return { ...base, mode: 'finish', targets: [],
        reasons: [{ code: 'group:no-draft-offer', text: '没有成员提供「出稿」能力，无法派执行' }],
        stopped: 'no-eligible-member' };
    }
    return { ...base, mode: 'executeTask', targets: [one.key], toolsAllowed: true,
      reasons: [
        { code: 'group:execute', text: `派一次异步执行给 ${one.name}` },
        { code: 'group:offer:draft', text: '该成员具备出稿能力' },
      ] };
  }

  // answer：只叫一个成员回答，不并行、不动工具。
  const one = leastSpoken(state, membersOnly);
  if (!one) {
    return { ...base, mode: 'finish', targets: [],
      reasons: [{ code: 'group:no-member', text: '没有可回答的成员' }], stopped: 'no-eligible-member' };
  }
  return { ...base, mode: 'speak', targets: [one.key],
    reasons: [{ code: 'group:speak', text: `叫 ${one.name} 回应一句` }] };
}

/** 把一次决策推进到状态里；finish 不改轮次，只标记结束。 */
export function applyGroupDecision(state: GroupState, decision: GroupDecision): GroupState {
  if (decision.mode === 'finish') {
    return { ...state, finished: true, delegatedTo: decision.closer ?? state.delegatedTo };
  }
  const spoken = { ...state.spoken };
  for (const key of decision.targets) spoken[key] = (spoken[key] ?? 0) + 1;
  return {
    ...state,
    round: state.round + 1,
    spoken,
    // delegate 是单向终态；其余模式不动 delegatedTo。
    delegatedTo: decision.mode === 'delegate' ? (decision.closer ?? decision.targets[0] ?? null) : state.delegatedTo,
  };
}

/** 一句话描述一轮，供时间线与对账用。 */
export function describeGroupDecision(decision: GroupDecision): string {
  const modeText = { speak: '单人发言', broadcast: '并行征询', delegate: '转交承接', executeTask: '派异步执行', finish: '收敛结束' }[decision.mode];
  if (decision.mode === 'finish') {
    return `${modeText}${decision.stopped ? `（${decision.stopped}）` : ''}`;
  }
  return `${modeText} → ${decision.targets.join('、')}${decision.toolsAllowed ? '' : '（禁工具）'}`;
}
