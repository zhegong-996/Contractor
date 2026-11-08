/**
 * 第二十四轮 · 从 Runner 借用的四项设计思想（零代码复制）。
 *
 * 思想来源：Runner —— MIT License, Copyright (c) 2026 Yicheng Wang。
 *   https://github.com/yicheng47/runner @ a42d133139bbe630e4ca3475426c7653fddd86db
 *   docs/arch/arch.md §1.2 / §3 / §4 / §5、docs/guide/concepts/missions.md
 * 本文件是 TypeScript 自研实现，未复制任何 Rust 源码；按 MIT 要求保留版权声明，
 * 许可证原文见 licenses/runner-MIT.txt。
 *
 * 四件事：① Mission 状态由任务状态派生（不是手写状态字段）；② 运行时适配层
 * 用能力声明收敛差异、不存启动参数；③ 配置库只放配置、实时协作全在追加写
 * 事件日志；④ 编制快照变更不回溯改写历史决策。
 */
import { createHash } from 'node:crypto';

// --- ① 由任务状态派生的六个状态词 -----------------------------------------

export const MISSION_STATE_LABELS = {
  working: '进行中',
  settled: '已安静收敛',
  needsYou: '等待人回答',
  failed: '失败',
  interrupted: '后台重启中断',
  ended: '已结束',
} as const;
export type MissionState = keyof typeof MISSION_STATE_LABELS;

/** Runner 用「连续安静 30 秒」判定 settled；这里保持同一口径、可配置。 */
export const SETTLE_QUIET_SECONDS = 30;

export type MissionStateInput = {
  steps: readonly { status: string }[];
  pendingQuestions: number;
  hasFailure: boolean;
  interrupted: boolean;
  ended: boolean;
  /** 最近一次协作活动的时间戳（epoch 毫秒）。 */
  lastActivityAt: number;
  now: number;
  quietSeconds?: number;
};

export type DerivedMissionState = {
  label: string;
  state: MissionState;
  /** 两个独立维度：已安静收敛与仍有步骤在跑可以同时为真。 */
  settled: boolean;
  running: boolean;
  needsYou: boolean;
  quietForMs: number;
  quietMs: number;
  reason: string;
};

/**
 * 状态是派生结果，不是可手写的字段：调用方给事实（步骤状态、待回答问题、
 * 失败、中断、最近活动时间），这里算展示用的状态词。
 */
export function deriveMissionState(input: MissionStateInput): DerivedMissionState {
  const quietMs = Math.max(0, Math.trunc(input.quietSeconds ?? SETTLE_QUIET_SECONDS)) * 1000;
  const quietForMs = Math.max(0, input.now - input.lastActivityAt);
  const settled = quietForMs >= quietMs;
  const running = input.steps.some(step => step.status === 'running');
  const needsYou = input.pendingQuestions > 0;
  let state: MissionState;
  let reason: string;
  if (input.ended) { state = 'ended'; reason = '任务已结束'; }
  else if (input.interrupted) { state = 'interrupted'; reason = '后台进程重启，未回执的步骤被回收'; }
  else if (input.hasFailure) { state = 'failed'; reason = '存在失败且不可重试的步骤'; }
  else if (needsYou) { state = 'needsYou'; reason = '有等待真人回答的成对问题'; }
  else if (running) { state = 'working'; reason = '仍有步骤在执行端运行'; }
  else if (settled) { state = 'settled'; reason = `连续安静 ${Math.floor(quietForMs / 1000)} 秒`; }
  else { state = 'working'; reason = '尚未达到安静窗口'; }
  return { label: MISSION_STATE_LABELS[state], state, settled, running, needsYou,
    quietForMs, quietMs, reason };
}

// --- ② 运行时适配层：能力声明，不存启动参数 --------------------------------

export type RuntimeCapability = {
  name: string;
  label: string;
  /** 能否在回合进行中把输入排队、下一次工具调用时送达。 */
  queuesInputMidTurn: boolean;
  /** 是否需要真实终端（PTY）；本项目单步执行进程不需要。 */
  requiresPty: boolean;
  note: string;
};

/** 能力表是配置，不是可执行命令；unknown 名称保留保守行为、不静默迁移。 */
export const RUNTIME_CAPABILITIES: Record<string, RuntimeCapability> = {
  'step-once': { name: 'step-once', label: '本机单步执行进程', queuesInputMidTurn: false,
    requiresPty: false, note: '一次进程只领一步，忙时不接收新的投递' },
  'loop': { name: 'loop', label: '常驻循环执行端（回退形态）', queuesInputMidTurn: false,
    requiresPty: false, note: '保持既有行为，不引入回合中排队输入' },
  'claude-code': { name: 'claude-code', label: '可在回合中排队输入的执行端', queuesInputMidTurn: true,
    requiresPty: true, note: '仅作为能力声明参考，本项目未接通该执行端' },
  'pi': { name: 'pi', label: '轻量执行端', queuesInputMidTurn: false,
    requiresPty: true, note: '仅作为能力声明参考，本项目未接通该执行端' },
};

export function resolveRuntime(name: string): RuntimeCapability {
  return RUNTIME_CAPABILITIES[name] ?? { name: String(name || 'unknown'), label: '未登记执行端',
    queuesInputMidTurn: false, requiresPty: false, note: '未知执行端按最保守能力处理，不迁移旧名称' };
}

/** Runner 的 argv 由适配器在启动时组合、本身不入库；这里把这条约束焊成守门。 */
export function assertNoStoredArgv(launchDefinition: Record<string, unknown>): void {
  for (const key of ['argv', 'args', 'command', 'cmd', 'shell', 'executablePath']) {
    if (key in launchDefinition)
      throw new Error(`启动定义不得存储 ${key}；执行参数由适配层按能力声明在启动时组合`);
  }
}

// --- ③ 配置库只放配置、实时协作全在追加写日志 ------------------------------

export const COORDINATION_FORBIDDEN_COLUMNS = [
  'status', 'result', 'checkpoint', 'run_token', 'events', 'messages',
  'backlog', 'pending_question', 'last_ack',
] as const;

/** 机器化守门：配置表不得塞运行时协作状态，且唯一可变共享状态必须是事件日志。 */
export function assertCoordinationLayering(input: {
  configTables: readonly { name: string; columns: readonly string[] }[];
  coordinationLog: string;
  singleMutableSharedState: string;
}): void {
  for (const table of input.configTables) {
    for (const column of table.columns) {
      if ((COORDINATION_FORBIDDEN_COLUMNS as readonly string[]).includes(column.toLowerCase()))
        throw new Error(`配置表 ${table.name} 不得存放运行时协作状态列 ${column}`);
    }
  }
  if (input.coordinationLog !== input.singleMutableSharedState)
    throw new Error('唯一可变共享状态必须是那份追加写协作日志');
}

// --- ④ 编制快照不回溯改写历史决策 ------------------------------------------

export type DecisionSnapshot = { id: string; configRevision: string; evidence: string };

/** 配置版本前进时，历史决策仍带着产生时的快照，不得被新版本覆盖。 */
export function assertSnapshotNoRewrite(before: readonly DecisionSnapshot[],
  after: readonly DecisionSnapshot[], newRevision: string): void {
  if (before.length !== after.length) throw new Error('历史决策条数不得因配置变更而增减');
  for (let i = 0; i < before.length; i += 1) {
    const old = before[i]!, current = after[i]!;
    if (old.id !== current.id || old.configRevision !== current.configRevision
      || old.evidence !== current.evidence)
      throw new Error(`历史决策 ${old.id} 被回溯改写`);
    if (current.configRevision === newRevision && old.configRevision !== newRevision)
      throw new Error(`历史决策 ${old.id} 被新编制快照覆盖`);
  }
}

/** 确定性摘要，供只读视图与真跑比对。 */
export function missionStateSignature(states: readonly DerivedMissionState[]): string {
  return createHash('sha256').update(JSON.stringify(states.map(s =>
    ({ state: s.state, settled: s.settled, running: s.running, needsYou: s.needsYou,
      quietForMs: s.quietForMs })))).digest('hex');
}
