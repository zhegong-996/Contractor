/**
 * 多 Agent 并行（fan-out / fan-in）：主管拆解 → 多个 worker 分头做 → 汇总 → 会签。
 *
 * 对齐 LobeHub Chief Agent Operator 的 fan-out/fan-in（借概念，非代码照搬）。
 * 本仓 agent-delegation 只有「串行委托链」（一个 coordinator 逐个 delegate 子任务），
 * 这里补上「并行」这一半：coordinator 把任务拆成 N 个子任务，N 个 worker 并行，
 * 各自受授权/预算/深度约束，最后 fan-in 汇总成一个 checker 评审。
 */

import { delegate, narrowBudget, narrowMandate, type Assignment, type Budget, type Mandate } from './agent-delegation.ts';

export interface Subtask {
  task: string;
  mandate: Mandate;
  budget: Budget;
}

export interface ParallelPlan {
  /** coordinator 拆出来的子任务；每项都由「授权/预算只减」校验。 */
  subtasks: Subtask[];
  /** 汇总任务交给谁（checker），以及它要看的上下文引用。 */
  summary: { task: string; mandate: Mandate; budget: Budget };
}

export type PlanResult =
  | { ok: true; plan: ParallelPlan }
  | { ok: false; reason: string };

/**
 * 主管把一个任务拆成并行子任务。
 * 拆解结果本身不执行：每个子任务的授权范围必须是父的子集、预算不得超父，
 * 任一项越界整份计划拒绝（不产出「半张计划」）。
 */
export function planParallel(input: {
  task: string;
  parent: { mandate: Mandate; budget: Budget };
  subtasks: readonly Subtask[];
  summary: { task: string; mandate: Mandate; budget: Budget };
}): PlanResult {
  if (input.subtasks.length === 0) return { ok: false, reason: '并行计划至少需要 1 个子任务' };
  for (const [index, subtask] of input.subtasks.entries()) {
    const mandate = narrowMandate(input.parent.mandate, subtask.mandate);
    if (!mandate.ok) return { ok: false, reason: `子任务 ${index + 1} 越权：${mandate.reason}` };
    const budget = narrowBudget(input.parent.budget, subtask.budget);
    if (!budget.ok) return { ok: false, reason: `子任务 ${index + 1} 预算越界：${budget.reason}` };
  }
  const sumMandate = narrowMandate(input.parent.mandate, input.summary.mandate);
  if (!sumMandate.ok) return { ok: false, reason: `汇总越权：${sumMandate.reason}` };
  const sumBudget = narrowBudget(input.parent.budget, input.summary.budget);
  if (!sumBudget.ok) return { ok: false, reason: `汇总预算越界：${sumBudget.reason}` };
  return { ok: true, plan: { subtasks: [...input.subtasks], summary: input.summary } };
}

/**
 * fan-out：把一份并行计划变成 N 个同深度的 worker assignment（挂在同一个 coordinator 下）。
 * 每个 assignment 独立，互不依赖，可并行执行。
 */
export function fanOut(input: {
  coordinator: Assignment;
  plan: ParallelPlan;
  makeId: () => string;
}): Assignment[] {
  const workers: Assignment[] = [];
  for (const subtask of input.plan.subtasks) {
    const result = delegate({
      task: subtask.task, parent: input.coordinator, role: 'worker',
      mandate: subtask.mandate, budget: subtask.budget,
    }, input.makeId);
    if (result.ok) workers.push(result.assignment);
  }
  return workers;
}

/** fan-in：把多个 worker 的结果汇总成一份交给 checker 的输入。 */
export interface FanInInput {
  workerResults: readonly { worker: Assignment; output: string }[];
  summaryTask: string;
}

export interface FanInResult {
  /** 汇总后的评审任务描述 + 各 worker 产出拼接。 */
  brief: string;
  /** 有几个 worker 是空产出（空输出是被评审判「打回」的常见真实原因）。 */
  emptyCount: number;
  /** 是否所有 worker 都有产出。 */
  complete: boolean;
}

export function fanIn(input: FanInInput): FanInResult {
  const emptyCount = input.workerResults.filter(item => !item.output.trim()).length;
  const parts = input.workerResults.map((item, index) =>
    `【worker ${index + 1}｜${item.worker.id}】${item.output.trim() || '（无产出）'}`);
  return {
    brief: `${input.summaryTask}\n\n${parts.join('\n\n')}`,
    emptyCount,
    complete: emptyCount === 0,
  };
}
