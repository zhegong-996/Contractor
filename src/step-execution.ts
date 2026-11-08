// 生产项 P-1 · 长程执行单步化（C-P6 的工程落地，第二十二轮）。
//
// 用户 2026-11-07 给的架构输入：LobeHub / DeepSeek 把 Agent 的循环、会话状态、
// 执行环境拆开；每一步（一次模型或工具调用）都是一次独立调用；步与步之间靠
// 队列推进；换机器只是换「执行工具的地方」，Agent 察觉不到执行环境差异。
//
// C-1 已把队列与状态外置做进 PgHostPlatform，但一直没有执行器接上：
// runner.ts / assistant-runner.ts 仍是「一个进程里 while(!settled){ tick(); sleep }」。
// 这一层补上执行器，并把两个入口的常驻循环改成配置驱动的单步泵。
//
// 三条不能越过的线：
//   1. 一次调用只做一步；会话状态只存在队列的 checkpoint / result 里，进程崩了
//      可回收，旧 runToken 立即失效。
//   2. 步与步之间按当前身份重评权限；换执行环境 ≠ 权限可以跨环境放大。
//   3. 没有外部模型端点时 model-call 步明确拒绝，不编造模型调用；人签仍由
//      原发起人在原会话完成。
//
// 本文件只做确定性编排，不发起任何网络调用、不读写业务资料正文。
import { createHash, randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import { assertLocalPgDsn, pgDsn, PgHostPlatform } from './pg-host.ts';
// P-6：HITL 成对留痕与 Runner 借用的状态词/能力声明（协议语义移植，TS 重写）。
import { HitlRefusal, HITL_RED_LINES, type HitlSink } from './step-hitl.ts';
import { MISSION_STATE_LABELS, SETTLE_QUIET_SECONDS, RUNTIME_CAPABILITIES } from './mission-state.ts';

// --- 队列契约（与 C-1 PgHostPlatform 的步进方法同形） ----------------------

export type StepSpec = { kind: string; payload?: Record<string, unknown>; parentStepId?: string };
export type ClaimedStep = {
  id: string; runId: string; stepNo: number; kind: string; status: string;
  runToken: string; claimedBy: string; attempts: number; payload: Record<string, unknown>;
  /** 12b ⑨：委托树血缘与领取代数（每次领取 +1，迟到旧 token 属于旧代）。 */
  parentStepId?: string | null; generation: number;
  /** 12b ⑧：本步已产生的对外动作，崩溃回收时据此判「不重跑」。 */
  outwardActions?: string[];
};
export type StepState = {
  stepNo: number; kind: string; status: string; claimedBy: string | null;
  attempts: number; modelCalls: number; result: unknown; checkpoint: unknown;
};
export type RecoveredStep = { id: string; runId: string; stepNo: number;
  /** 12b ⑧：interrupted = 已对外动作的步被回收后不重跑（终态，是否补跑由人决定）。 */
  status?: 'ready' | 'interrupted'; outwardActions?: string[] };
export type CompleteOptions = {
  next?: StepSpec; checkpoint?: Record<string, unknown>; modelCalls?: number;
  /** 12b ⑧：本步已真实发生的对外动作（发消息 / 交付 / 发布）。 */
  outwardActions?: string[];
};
export type CompleteResult = { runId: string; stepNo: number; nextStepNo: number | null; modelCalls: number };
export type FailResult = { runId: string; stepNo: number; status: string; retryable: boolean };

export interface StepQueue {
  id(): string;
  enqueueSteps(runId: string, specs: StepSpec[]): Promise<{ runId: string; enqueued: number; ready: number }>;
  /**
   * P-11：把步骤以「立即可领取」状态排进队列。普通 enqueueSteps 只把第一步
   * 标 ready（后续步靠前一步完成时原子提升）；当 run 的前一步已永久失败、
   * 没有人会再提升后续步时，自动续跑的「续跑闸」必须用它才不会被永久挂起。
   */
  enqueueReadySteps(runId: string, specs: StepSpec[]): Promise<{ runId: string; enqueued: number; ready: number }>;
  claimStep(workerId: string, runId?: string): Promise<ClaimedStep | null>;
  completeStep(runToken: string, result?: Record<string, unknown>, options?: CompleteOptions): Promise<CompleteResult>;
  /**
   * 12b ⑧：对外动作**发生时**就登记（发消息 / 交付 / 发布的前后各调一次），
   * 不能等 completeStep——进程崩在「已发信、未完成」之间也要能判出不重跑。
   */
  markOutwardAction(runToken: string, action: string): Promise<boolean>;
  failStep(runToken: string, error: string, maxAttempts?: number): Promise<FailResult>;
  recoverStaleSteps(staleSeconds?: number): Promise<RecoveredStep[]>;
  runState(runId: string): Promise<StepState[]>;
  /** 12b ⑨：委托树血缘——向上追溯父步链（可选实现；PG 与内存队列都提供）。 */
  lineageOf?(stepId: string): Promise<{ id: string; runId: string; stepNo: number; kind: string; status: string; generation: number }[]>;
}

export const STEP_KINDS = ['tool-call', 'model-call', 'worker-tick', 'human-gate'] as const;

export const STEP_RED_LINES = [
  '一次调用只做一步（一次模型或工具调用），Agent 循环不再常驻在单个进程里',
  '会话状态外置到队列，崩溃可回收，旧 runToken 立即失效',
  '步与步之间按当前身份重评权限，换执行环境不等于放大权限',
  '没有外部模型端点时如实拒绝模型步，不编造模型调用',
  '人签与最终确认验收仍由原发起人在原会话完成',
] as const;

// --- 内存队列：隔离真跑用，语义与 PG 队列一致 ------------------------------

type MemStep = {
  id: string; runId: string; stepNo: number; kind: string; status: string;
  claimedBy: string | null; runToken: string | null; attempts: number;
  payload: Record<string, unknown>; result: unknown; checkpoint: unknown;
  modelCalls: number; updatedAt: number;
  parentStepId: string | null; generation: number; outwardActions: string[];
};

/** 与 PgHostPlatform 的 SKIP LOCKED / 事务内入下一棒语义等价的可注入实现。 */
export class InMemoryStepQueue implements StepQueue {
  private steps: MemStep[] = [];
  constructor(private readonly now: () => number = () => Date.now()) {}
  id() { return 'memory'; }
  reset() { this.steps = []; }
  private snapshot(step: MemStep): ClaimedStep {
    return { id: step.id, runId: step.runId, stepNo: step.stepNo, kind: step.kind,
      status: step.status, runToken: step.runToken!, claimedBy: step.claimedBy!,
      attempts: step.attempts, payload: { ...step.payload },
      parentStepId: step.parentStepId, generation: step.generation, outwardActions: [...step.outwardActions] };
  }
  async enqueueSteps(runId: string, specs: StepSpec[]) {
    return this.insert(runId, specs, false);
  }
  async enqueueReadySteps(runId: string, specs: StepSpec[]) {
    return this.insert(runId, specs, true);
  }
  private async insert(runId: string, specs: StepSpec[], immediate: boolean) {
    const existing = this.steps.filter(s => s.runId === runId);
    let start = existing.reduce((max, s) => Math.max(max, s.stepNo), 0);
    let inserted = 0;
    for (const spec of specs) {
      start += 1;
      if (this.steps.some(s => s.runId === runId && s.stepNo === start)) continue;
      this.steps.push({ id: `${runId}:${start}`, runId, stepNo: start, kind: spec.kind,
        status: immediate || start === 1 ? 'ready' : 'queued', claimedBy: null, runToken: null, attempts: 0,
        payload: { ...(spec.payload ?? {}) }, result: null, checkpoint: null,
        modelCalls: 0, updatedAt: this.now(),
        parentStepId: spec.parentStepId ?? null, generation: 0, outwardActions: [] });
      inserted += 1;
    }
    return { runId, enqueued: inserted, ready: immediate ? inserted : (inserted ? 1 : 0) };
  }
  async claimStep(workerId: string, runId?: string): Promise<ClaimedStep | null> {
    // 单线程内一次性完成「找 ready + 置 running」，等价于 PG 的锁内更新。
    // 12b ⑨：每次领取 generation+1，迟到的旧 runToken 属于旧代，完成校验天然拒绝。
    const step = this.steps.find(s => s.status === 'ready' && (!runId || s.runId === runId));
    if (!step) return null;
    step.status = 'running'; step.claimedBy = workerId; step.runToken = 'tok-' + randomUUID();
    step.attempts += 1; step.generation += 1; step.updatedAt = this.now();
    return this.snapshot(step);
  }
  private held(runToken: string): MemStep {
    const step = this.steps.find(s => s.runToken === runToken && s.status === 'running');
    if (!step) throw new Error('runToken 无效或该步已结束；不得重复写结果');
    return step;
  }
  async completeStep(runToken: string, result: Record<string, unknown> = {}, options: CompleteOptions = {}): Promise<CompleteResult> {
    const step = this.held(runToken);
    const modelCalls = Math.max(0, Math.trunc(options.modelCalls ?? 0));
    step.status = 'done'; step.result = { ...result };
    step.checkpoint = { ...(options.checkpoint ?? {}) }; step.modelCalls = modelCalls;
    // 12b ⑧：登记本步已发生的对外动作；崩溃回收时据此判「不重跑」。
    step.outwardActions = [...new Set([...step.outwardActions, ...(options.outwardActions ?? [])])].filter(Boolean);
    step.runToken = null; step.updatedAt = this.now();
    const candidate = step.stepNo + 1;
    const promoted = this.steps.find(s => s.runId === step.runId && s.stepNo === candidate && s.status === 'queued');
    let nextStepNo: number | null = null;
    if (promoted) { promoted.status = 'ready'; promoted.updatedAt = this.now(); nextStepNo = candidate; }
    else if (options.next && !this.steps.some(s => s.runId === step.runId && s.stepNo === candidate)) {
      this.steps.push({ id: `${step.runId}:${candidate}`, runId: step.runId, stepNo: candidate,
        kind: options.next.kind, status: 'ready', claimedBy: null, runToken: null, attempts: 0,
        payload: { ...(options.next.payload ?? {}) }, result: null, checkpoint: null,
        modelCalls: 0, updatedAt: this.now(),
        parentStepId: options.next.parentStepId ?? null, generation: 0, outwardActions: [] });
      nextStepNo = candidate;
    }
    return { runId: step.runId, stepNo: step.stepNo, nextStepNo, modelCalls };
  }
  async failStep(runToken: string, error: string, maxAttempts = 3): Promise<FailResult> {
    const step = this.held(runToken);
    // 12b ⑧：已对外动作的步显式失败也不自动重跑——重跑会重复发信 / 重复交付，
    // 与崩溃回收同一判据标 interrupted 终态，是否补跑由人在台账上决定。
    const outward = step.outwardActions.length > 0;
    const retryable = !outward && step.attempts < maxAttempts;
    step.status = outward ? 'interrupted' : (retryable ? 'ready' : 'failed');
    step.result = { error, ...(outward ? { outwardActions: [...step.outwardActions] } : {}) };
    step.runToken = null; step.claimedBy = null; step.updatedAt = this.now();
    return { runId: step.runId, stepNo: step.stepNo, status: step.status, retryable };
  }
  /** 12b ⑧：对外动作发生时登记（running 态即可写），崩溃回收据此判 interrupted。 */
  async markOutwardAction(runToken: string, action: string): Promise<boolean> {
    const step = this.steps.find(s => s.runToken === runToken && s.status === 'running');
    if (!step || !action.trim()) return false;
    if (!step.outwardActions.includes(action)) step.outwardActions.push(action);
    return true;
  }
  async recoverStaleSteps(staleSeconds = 60): Promise<RecoveredStep[]> {
    const recovered: RecoveredStep[] = [];
    for (const step of this.steps) {
      if (step.status === 'running' && this.now() - step.updatedAt > staleSeconds * 1000) {
        // 12b ⑧：已对外动作（发消息 / 交付 / 发布）的步标 interrupted 终态，
        // 绝不重跑——重跑会重复发信 / 重复交付；是否人工补跑由人决定。
        const interrupted = step.outwardActions.length > 0;
        step.status = interrupted ? 'interrupted' : 'ready';
        step.runToken = null; step.claimedBy = null; step.updatedAt = this.now();
        recovered.push({ id: step.id, runId: step.runId, stepNo: step.stepNo,
          status: interrupted ? 'interrupted' : 'ready',
          ...(interrupted ? { outwardActions: [...step.outwardActions] } : {}) });
      }
    }
    return recovered;
  }
  /** 12b ⑨：委托树血缘——沿 parentStepId 向上追溯（跨 run 连通，深度封顶防环）。 */
  async lineageOf(stepId: string): Promise<{ id: string; runId: string; stepNo: number; kind: string; status: string; generation: number }[]> {
    const chain: MemStep[] = [];
    let cursor = this.steps.find(s => s.id === stepId);
    while (cursor && chain.length < 32) {
      chain.push(cursor);
      cursor = cursor.parentStepId ? this.steps.find(s => s.id === cursor!.parentStepId) : undefined;
    }
    return chain.map(step => ({ id: step.id, runId: step.runId, stepNo: step.stepNo,
      kind: step.kind, status: step.status, generation: step.generation }));
  }
  async runState(runId: string): Promise<StepState[]> {
    return this.steps.filter(s => s.runId === runId).sort((a, b) => a.stepNo - b.stepNo)
      .map(s => ({ stepNo: s.stepNo, kind: s.kind, status: s.status, claimedBy: s.claimedBy,
        attempts: s.attempts, modelCalls: s.modelCalls, result: s.result, checkpoint: s.checkpoint }));
  }
}

// --- PG 适配器：把 C-1 的真实队列接进同一契约 ------------------------------

/** 只允许回环专属库；不在此处 reset，避免动到 host:pg 的既有真跑证据。 */
export class PgStepQueue implements StepQueue {
  constructor(readonly host: PgHostPlatform) {}
  static fromConfig(config: Config): PgStepQueue {
    return new PgStepQueue(new PgHostPlatform(assertLocalPgDsn(pgDsn(config)), config));
  }
  id() { return 'local-pg'; }
  enqueueSteps(runId: string, specs: StepSpec[]) {
    return this.host.enqueueSteps(runId, specs.map(spec => this.toHostSpec(spec)));
  }
  enqueueReadySteps(runId: string, specs: StepSpec[]) {
    return this.host.enqueueReadySteps(runId, specs.map(spec => this.toHostSpec(spec)));
  }
  /** 本契约的血缘 id 是字符串，PG 层是 bigint：入队方向字符串 → 数字。 */
  private toHostSpec(spec: StepSpec) {
    return { kind: spec.kind, payload: spec.payload,
      ...(spec.parentStepId !== undefined ? { parentStepId: Number(spec.parentStepId) } : {}) };
  }
  async claimStep(workerId: string, runId?: string): Promise<ClaimedStep | null> {
    const step = await this.host.claimStep(workerId, runId);
    return step ? { ...step, id: String(step.id), parentStepId: step.parentStepId === null ? null : String(step.parentStepId) } : null;
  }
  async completeStep(runToken: string, result: Record<string, unknown> = {}, options: CompleteOptions = {}) {
    // next 的 parentStepId 在本契约是字符串、PG 层是 bigint：出队方向同样转换。
    const done = await this.host.completeStep(runToken, result, {
      checkpoint: options.checkpoint,
      modelCalls: options.modelCalls,
      outwardActions: options.outwardActions,
      next: options.next ? this.toHostSpec(options.next) : undefined,
    });
    return { runId: done.runId, stepNo: done.stepNo, nextStepNo: done.nextStepNo, modelCalls: done.modelCalls };
  }
  markOutwardAction(runToken: string, action: string) { return this.host.markOutwardAction(runToken, action); }
  async failStep(runToken: string, error: string, maxAttempts = 3) {
    const failed = await this.host.failStep(runToken, error, maxAttempts);
    return { runId: failed.runId, stepNo: failed.stepNo, status: failed.status, retryable: failed.retryable };
  }
  async recoverStaleSteps(staleSeconds = 60) {
    // 12b ⑧：status 与 outwardActions 如实透传（interrupted 携带已发动作清单）。
    return (await this.host.recoverStaleSteps(staleSeconds))
      .map(row => ({ id: String(row.id), runId: row.runId, stepNo: row.stepNo,
        ...(row.status ? { status: row.status } : {}),
        ...(row.outwardActions ? { outwardActions: row.outwardActions.map(String) } : {}) }));
  }
  /** 12b ⑨：血缘查询透传（PG 用递归 CTE，见 pg-host.ts lineageOf）。 */
  async lineageOf(stepId: string) {
    return (await this.host.lineageOf(Number(stepId)))
      .map(row => ({ id: String(row.id), runId: row.runId, stepNo: row.stepNo,
        kind: row.kind, status: row.status, generation: row.generation }));
  }
  runState(runId: string) { return this.host.runState(runId); }
  close() { return this.host.close(); }
}

// --- 一次调用 = 一步 ---------------------------------------------------------

export type StepOutcome = {
  result?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
  next?: StepSpec;
  /** 只记真实发生的模型调用次数；没有端点时必须是 0 或直接拒绝。 */
  modelCalls?: number;
};
export type StepHandler = (step: ClaimedStep, ctx: StepContext) => StepOutcome | Promise<StepOutcome>;
export type StepContext = {
  runId: string; principal: string; scope: string | null; environment: string;
  /** 上一步写回队列的会话状态；进程内不持有跨步状态。 */
  previousCheckpoint: Record<string, unknown>;
};
export type RecheckInput = { principal: string; scope: string | null; environment: string; step: ClaimedStep };
export type RecheckResult = { ok: boolean; reason?: string };
export type StepRecheck = (input: RecheckInput) => RecheckResult | Promise<RecheckResult>;

/** fail-closed 的默认权限重评：换机器只换执行环境，不放大资料范围。 */
export function defaultStepRecheck(input: RecheckInput): RecheckResult {
  if (!input.principal) return { ok: false, reason: '未声明当前主体，按最小权限拒绝执行' };
  const declared = typeof input.step.payload?.scope === 'string' ? String(input.step.payload.scope) : null;
  if (declared && declared !== input.scope)
    return { ok: false, reason: `步内声明的资料范围 ${declared} 与当前授权范围 ${input.scope ?? '未指定'} 不一致` };
  return { ok: true };
}

export type OneStepInput = {
  queue: StepQueue; handlers: Record<string, StepHandler>;
  workerId: string; principal: string; environment: string;
  scope?: string | null; runId?: string;
  recheck?: StepRecheck; maxAttempts?: number;
  /** 注入后才落 HITL 台账；不传则完全无副作用，旧调用逐字等价。 */
  hitl?: HitlSink;
};
export type OneStepResult = {
  claimed: boolean; ok: boolean; failed: boolean;
  stepNo?: number; kind?: string; nextStepNo?: number | null;
  modelCalls: number; environment: string; reason?: string;
  runId?: string; checkpoint?: Record<string, unknown>;
  /** 人工确认步被拒绝时留下的成对证据起点（问题编号）。 */
  hitlQuestionId?: string;
};

/**
 * 领一步、跑一步、把结果和下一棒在同一个完成动作里写回队列，然后返回。
 * 这里没有 while：一次调用就是一次独立短执行，进程结束也不会丢状态。
 */
export async function executeOneStep(input: OneStepInput): Promise<OneStepResult> {
  const { queue, handlers } = input;
  const environment = input.environment;
  const step = await queue.claimStep(input.workerId, input.runId);
  if (!step) return { claimed: false, ok: false, failed: false, modelCalls: 0, environment,
    reason: '队列里没有可领取的步骤' };
  const scope = input.scope ?? null;
  const recheck = input.recheck ?? defaultStepRecheck;
  const base = { claimed: true, environment, runId: step.runId, stepNo: step.stepNo, kind: step.kind };
  const verdict = await recheck({ principal: input.principal, scope, environment, step });
  if (!verdict.ok) {
    await queue.failStep(step.runToken, '步间权限重评未通过：' + (verdict.reason ?? '当前主体无权执行'), input.maxAttempts ?? 3);
    return { ...base, ok: false, failed: true, modelCalls: 0, nextStepNo: null,
      reason: '步间权限重评未通过：' + (verdict.reason ?? '当前主体无权执行') };
  }
  const handler = handlers[step.kind];
  if (!handler) {
    await queue.failStep(step.runToken, `没有登记 ${step.kind} 的执行器，拒绝静默跳过`, input.maxAttempts ?? 3);
    return { ...base, ok: false, failed: true, modelCalls: 0, nextStepNo: null,
      reason: `没有登记 ${step.kind} 的执行器` };
  }
  const prior = await queue.runState(step.runId);
  const lastDone = [...prior].reverse().find(s => s.status === 'done' && s.stepNo < step.stepNo);
  const previousCheckpoint = lastDone?.checkpoint && typeof lastDone.checkpoint === 'object'
    ? lastDone.checkpoint as Record<string, unknown> : {};
  let outcome: StepOutcome;
  try {
    outcome = await handler(step, { runId: step.runId, principal: input.principal, scope,
      environment, previousCheckpoint });
  } catch (error) {
    // P-6：执行进程在 human-gate 步只能提出问题、不能自行放行；这里把
    // `human_question` 落到注入的 append-only 台账，作为成对证据的起点。
    const question = error instanceof HitlRefusal ? error.question : undefined;
    const sink = question ? input.hitl : undefined;
    if (question && sink) sink.append(question);
    const reason = '这一步执行失败：' + String(error instanceof Error ? error.message : error).slice(0, 300);
    await queue.failStep(step.runToken, reason, input.maxAttempts ?? 3);
    return { ...base, ok: false, failed: true, modelCalls: 0, nextStepNo: null, reason,
      ...(question && sink ? { hitlQuestionId: question.id } : {}) };
  }
  const modelCalls = Math.max(0, Math.trunc(outcome.modelCalls ?? 0));
  const done = await queue.completeStep(step.runToken, outcome.result ?? {},
    { next: outcome.next, checkpoint: outcome.checkpoint ?? {}, modelCalls });
  return { ...base, ok: true, failed: false, nextStepNo: done.nextStepNo, modelCalls,
    checkpoint: outcome.checkpoint ?? {} };
}

/** 供真跑与只读视图使用的确定性摘要；两次相同状态必须逐字节一致。 */
export function stepExecutionSummary(states: StepState[]) {
  const done = states.filter(s => s.status === 'done').length;
  const failed = states.filter(s => s.status === 'failed').length;
  const running = states.filter(s => s.status === 'running').length;
  const modelCalls = states.reduce((sum, s) => sum + (Number(s.modelCalls) || 0), 0);
  const lastCheckpoint = [...states].reverse().find(s => s.status === 'done')?.checkpoint ?? {};
  const signature = createHash('sha256').update(JSON.stringify(states.map(s =>
    ({ stepNo: s.stepNo, kind: s.kind, status: s.status, attempts: s.attempts,
      modelCalls: s.modelCalls, result: s.result, checkpoint: s.checkpoint })))).digest('hex');
  return { total: states.length, done, failed, running, modelCalls, lastCheckpoint, signature };
}

/**
 * 外部调度器：每次只调用一次 executeOneStep，随时可以换 workerId / environment。
 * 它是「由队列激活下一棒」的驱动器，不是常驻在进程里的 Agent 循环。
 * 第二十九轮 P-11：intervalMs 让步与步之间有真实业务的节奏（真实单的
 * worker.tick 多数是等待轮询，不间歇会把步数上限瞬间烧完）。
 */
export async function driveSteppedLoop(input: {
  queue: StepQueue; runId: string; principal: string; scope?: string | null;
  first: StepSpec; handlers: Record<string, StepHandler>;
  recheck?: StepRecheck; maxSteps?: number;
  worker?: (stepNo: number) => { workerId: string; environment: string };
  intervalMs?: number;
}): Promise<{ steps: number; modelCalls: number; stoppedBy: string; environments: string[]; failure?: string }> {
  const maxSteps = input.maxSteps ?? 60;
  const intervalMs = Math.max(0, input.intervalMs ?? 0);
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const worker = input.worker ?? (() => ({ workerId: 'step-worker-a', environment: '本机执行环境' }));
  // 幂等：调用方若已把首步排进队列，这里不再插一条重复步骤。
  if ((await input.queue.runState(input.runId)).length === 0)
    await input.queue.enqueueSteps(input.runId, [input.first]);
  let modelCalls = 0;
  const environments: string[] = [];
  for (let i = 1; i <= maxSteps; i += 1) {
    if (i > 1 && intervalMs) await sleep(intervalMs);
    const seat = worker(i);
    environments.push(seat.environment);
    const result = await executeOneStep({ queue: input.queue, handlers: input.handlers,
      workerId: seat.workerId, principal: input.principal, environment: seat.environment,
      scope: input.scope ?? null, runId: input.runId, recheck: input.recheck });
    modelCalls += result.modelCalls;
    if (result.failed) return { steps: i - 1, modelCalls, stoppedBy: 'failed', environments,
      failure: result.reason };
    if (!result.claimed) return { steps: i - 1, modelCalls, stoppedBy: 'empty', environments };
    if (result.nextStepNo === null) return { steps: i, modelCalls, stoppedBy: 'settled', environments };
  }
  return { steps: maxSteps, modelCalls, stoppedBy: 'limit', environments };
}

// --- 只读状态：如实说明单步模式是否真的可用 --------------------------------

export const EXECUTION_MODE_LABELS: Record<string, string> = {
  loop: '常驻循环（显式配置的回退形态）',
  step: '单步执行（当前默认；队列每激活一棒，进程只跑一步）',
};

export function executionView(config: Config) {
  const stepped = config.execution.mode === 'step';
  const pg = config.host.provider === 'local-pg';
  return {
    available: true,
    mode: config.execution.mode,
    modeLabel: EXECUTION_MODE_LABELS[config.execution.mode] ?? config.execution.mode,
    queue: pg ? '本机 PostgreSQL 步进队列（只连回环专属库）' : '未接入状态外置队列',
    steppedReady: stepped && pg,
    maxStepsPerRun: config.execution.maxStepsPerRun,
    staleSeconds: config.execution.staleSeconds,
    redLines: [...STEP_RED_LINES],
    missing: [
      ...(stepped ? [] : ['当前仍是 loop 模式；config.execution.mode=step 且 host.provider=local-pg 才启用单步']),
      ...(pg ? [] : ['单步模式要求 host.provider=local-pg；paperclip / local 没有状态外置队列，配置校验会拒绝']),
      'Agent worker 内部一次 tick 的多次模型 / 工具子调用尚未逐次拆分（当前按 tick 级单步）',
      '真实外部模型端点与凭据未接通：model-call 步会如实拒绝，不编造模型调用',
      '远端工具沙箱 / 多机 Remote Tool Calling 未部署；Redis 横向扩展未引入',
      '默认底座已切 local-pg（paperclip 显式配置可回退），飞书仍是唯一发起入口',
    ],
    // P-6：从 Runner 借用的状态词、能力声明与两条协议，均为只读说明。
    mission: {
      states: Object.entries(MISSION_STATE_LABELS).map(([id, label]) => ({ id, label })),
      settleQuietSeconds: SETTLE_QUIET_SECONDS,
      settledAndRunningCanCoexist: true,
      note: '状态由任务事实派生，不是手写字段；已安静收敛与仍有步骤在跑可以同时为真',
    },
    runtimeCapabilities: Object.values(RUNTIME_CAPABILITIES).map(c =>
      ({ name: c.name, label: c.label, queuesInputMidTurn: c.queuesInputMidTurn })),
    hitl: { pairedEvidence: true, redLines: [...HITL_RED_LINES] },
    delivery: {
      cumulativeAck: '累计确认：只前进，忽略旧确认',
      notification: '至少一次通知：只带未读条数、不带消息体，重复无害',
      readiness: '投递就绪按执行端能力声明判断，重投递只在空闲时发生',
    },
    modelCalls: 0,
    note: stepped && pg
      ? '单步模式已配置：循环、会话状态、执行环境三者分离，每一步由队列领取并留痕'
      : '当前按原常驻循环运行；单步执行器已就绪但未启用，不改变任何现有行为',
  };
}
