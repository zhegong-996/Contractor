// 第六十七轮 · 把 config.agents 的 mode/use 接上真实语义。
//
// 为什么需要这一层：`agent-registry.resolveAssignment` 只回答「谁有资格接这一棒」——
// 它按职责 / 生效范围 / 责任链排除挑人，完全不看这个主体有没有可执行的引擎。
// 于是配置里的 `mode` 从来没被读过（第六十六轮全仓 grep 零命中），
// 系统挑出一个 manual 岗位却仍按自动执行去期待它，`mode` 形同注释。
//
// 本文件补的是「资格」之后的「可行性」：这一棒到底是平台自己起进程跑完，
// 还是要有人在外部接单。纯函数：不 IO、不读时钟、零模型调用，可独立重放。
//
// 层级关系（不互相覆写）：
//   config.agents        → 执行引擎与派单身份（本文件读它）
//   agent-registry       → 组织形态真相源（谁在什么范围担什么职责）
//   agent-services       → 运行时服务目录（用什么工具 / 能力 / offer）

import type { Agent } from './config.ts';

/** auto = 平台起进程自己跑完；human = 得有人在外部接单。 */
export type ExecutionKind = 'auto' | 'human';

export type AgentExecution = {
  key: string;
  name: string;
  mode: Agent['mode'];
  use: Agent['use'];
  access: Agent['access'];
  enabled: boolean;
  kind: ExecutionKind;
  /** auto 且 access=read：能跑，但只能读。 */
  readOnly: boolean;
  /** 配置自相矛盾或无法派单时的诚实说明；null 表示自洽。 */
  problem: string | null;
  /** 一句话判据，直接给人看。 */
  reason: string;
};

/** use 里哪些有引擎适配器（能起进程跑）：对应 adapters/registry 与 autoloop 的 plugins/<use>。 */
const ENGINE_USES: readonly Agent['use'][] = ['codex', 'claude', 'acp'];

const hasCommand = (agent: Agent) => Array.isArray(agent.command) && agent.command.length > 0;

/**
 * 单个 Agent 的执行语义。
 *
 * 判据是双重的：`mode` 声明意图，`use`/`command` 决定平台**有没有能力**兑现。
 * 两者冲突时以能力为准并如实标注 problem——绝不把「声明托管」当成「真的能跑」。
 */
export function agentExecution(key: string, agent: Agent): AgentExecution {
  const base = {
    key, name: agent.name, mode: agent.mode, use: agent.use,
    access: agent.access, enabled: agent.enabled, readOnly: agent.access === 'read',
  };
  const unregistered = agent.paperclipId ? null : '未在平台注册（缺 paperclipId），不会被派单';

  // 1) 人工接单：无论配了什么引擎，这一棒都要人在外部做完。
  if (agent.mode === 'manual') {
    const aided = ENGINE_USES.includes(agent.use) || hasCommand(agent);
    return {
      ...base, kind: 'human', problem: unregistered,
      reason: aided
        ? `人工接单：派给人在外部完成，配置的 ${agent.use} 只作辅助`
        : '人工接单：派给人在外部工具里完成',
    };
  }

  // 2) 声明托管但没有可用引擎：配置自相矛盾，诚实降级成「要人接单」。
  if (agent.use === 'command' && !hasCommand(agent)) {
    return {
      ...base, kind: 'human',
      problem: '声明托管（managed）但 use=command 未配命令行，平台无法自己起进程',
      reason: '配置缺口：缺可执行命令行，实际只能等人接单',
    };
  }

  // 3) 托管且有引擎：起进程自己跑完。
  const engine = agent.use === 'command' ? '自定义命令' : agent.use;
  return {
    ...base, kind: 'auto', problem: unregistered,
    reason: base.readOnly
      ? `平台托管：起 ${engine} 自动执行，但只有读权限`
      : `平台托管：起 ${engine} 自动执行`,
  };
}

export function executionsOf(agents: Record<string, Agent>): AgentExecution[] {
  return Object.entries(agents)
    .map(([key, agent]) => agentExecution(key, agent))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function executionOfKey(
  agents: Record<string, Agent>, key: string | null | undefined,
): AgentExecution | null {
  if (!key) return null;
  const agent = agents[key];
  return agent ? agentExecution(key, agent) : null;
}

export type ExecutionRollup = {
  /** 在岗（enabled）里的自动执行数。 */
  auto: number;
  /** 在岗里的人员工接单数。 */
  human: number;
  /** 停用数，只作说明不计入在岗。 */
  disabled: number;
  /** 配置自相矛盾或未注册的条数（含停用的）。 */
  problems: number;
  /** 在岗且能自动执行的 key，便于上游直接派单。 */
  autoKeys: string[];
  /** 在岗但需要人接单的 key。 */
  humanKeys: string[];
};

/** 汇总只数事实，不做加权；停用不算在岗，也不掩盖问题。 */
export function executionRollup(executions: readonly AgentExecution[]): ExecutionRollup {
  const live = executions.filter(e => e.enabled);
  return {
    auto: live.filter(e => e.kind === 'auto').length,
    human: live.filter(e => e.kind === 'human').length,
    disabled: executions.length - live.length,
    problems: executions.filter(e => e.problem).length,
    autoKeys: live.filter(e => e.kind === 'auto').map(e => e.key).sort(),
    humanKeys: live.filter(e => e.kind === 'human').map(e => e.key).sort(),
  };
}

export type AssignmentFeasibility = {
  kind: 'auto' | 'human' | 'unassignable';
  reason: string;
  execution: AgentExecution | null;
};

/**
 * 承接人选定之后的可行性判定。
 *
 * 这是 `mode` 空转的正解位置：`resolveAssignment` 挑出「谁有资格」，
 * 本函数回答「挑出来的这位到底跑不跑得起来」。三种结局都必须显式，
 * 不允许静默等待——静默等待就是任务卡在队列里没人知道的经典现场。
 */
export function assignmentFeasibility(
  agentKey: string | null, agents: Record<string, Agent>,
): AssignmentFeasibility {
  if (!agentKey) {
    return { kind: 'unassignable', reason: '组织编制里没有合格的承接人', execution: null };
  }
  const execution = executionOfKey(agents, agentKey);
  if (!execution) {
    return {
      kind: 'unassignable',
      reason: `承接人 ${agentKey} 只出现在组织编制里，config.agents 没有对应的执行定义`,
      execution: null,
    };
  }
  if (!execution.enabled) {
    return { kind: 'unassignable', reason: `承接人 ${agentKey} 已停用`, execution };
  }
  if (execution.kind === 'human') {
    return {
      kind: 'human',
      reason: `承接人 ${agentKey} 是人工接单：等人在外部完成，平台不自动推进`,
      execution,
    };
  }
  return { kind: 'auto', reason: `承接人 ${agentKey} 由平台自动执行`, execution };
}
