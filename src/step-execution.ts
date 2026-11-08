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

export type StepSpec = { kind: string; payload?: Record<string, unknown> };
export type ClaimedStep = {
  id: string; runId: string; stepNo: number; kind: string; status: string;
  runToken: string; claimedBy: string; attempts: number; payload: Record<string, unknown>;
};
export type StepState = {
  stepNo: number; kind: string; status: string; claimedBy: string | null;
  attempts: number; modelCalls: number; result: unknown; checkpoint: unknown;
};
export type RecoveredStep = { id: string; runId: string; stepNo: number };
export type CompleteOptions = {
  next?: StepSpec; checkpoint?: Record<string, unknown>; modelCalls?: number;
};
export type CompleteResult = { runId: string; stepNo: number; nextStepNo: number | null; modelCalls: number };
export type FailResult = { runId: string; stepNo: number; status: string; retryable: boolean };

export interface StepQueue {
  id(): string;
  enqueueSteps(runId: string, specs: StepSpec[]): Promise<{ runId: string; enqueued: number; ready: number }>;
  claimStep(workerId: string, runId?: string): Promise<ClaimedStep | null>;
  completeStep(runToken: string, result?: Record<string, unknown>, options?: CompleteOptions): Promise<CompleteResult>;
  failStep(runToken: string, error: string, maxAttempts?: number): Promise<FailResult>;
  recoverStaleSteps(staleSeconds?: number): Promise<RecoveredStep[]>;
  runState(runId: string): Promise<StepState[]>;
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
      attempts: step.attempts, payload: { ...step.payload } };
  }
  async enqueueSteps(runId: string, specs: StepSpec[]) {
    let start = this.steps.filter(s => s.runId === runId).length;
    for (const spec of specs) {
      start += 1;
      if (this.steps.some(s => s.runId === runId && s.stepNo === start)) continue;
      this.steps.push({ id: `${runId}:${start}`, runId, stepNo: start, kind: spec.kind,
        status: start === 1 ? 'ready' : 'queued', claimedBy: null, runToken: null, attempts: 0,
        payload: { ...(spec.payload ?? {}) }, result: null, checkpoint: null, modelCalls: 0,
        updatedAt: this.now() });
    }
    return { runId, enqueued: specs.length, ready: specs.length ? 1 : 0 };
  }
  async claimStep(workerId: string, runId?: string): Promise<ClaimedStep | null> {
    // 单线程内一次性完成「找 ready + 置 running」，等价于 PG 的锁内更新。
    const step = this.steps.find(s => s.status === 'ready' && (!runId || s.runId === runId));
    if (!step) return null;
    step.status = 'running'; step.claimedBy = workerId; step.runToken = 'tok-' + randomUUID();
    step.attempts += 1; step.updatedAt = this.now();
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
    step.runToken = null; step.updatedAt = this.now();
    const candidate = step.stepNo + 1;
    const promoted = this.steps.find(s => s.runId === step.runId && s.stepNo === candidate && s.status === 'queued');
    let nextStepNo: number | null = null;
    if (promoted) { promoted.status = 'ready'; promoted.updatedAt = this.now(); nextStepNo = candidate; }
    else if (options.next && !this.steps.some(s => s.runId === step.runId && s.stepNo === candidate)) {
      this.steps.push({ id: `${step.runId}:${candidate}`, runId: step.runId, stepNo: candidate,
        kind: options.next.kind, status: 'ready', claimedBy: null, runToken: null, attempts: 0,
        payload: { ...(options.next.payload ?? {}) }, result: null, checkpoint: null,
        modelCalls: 0, updatedAt: this.now() });
      nextStepNo = candidate;
    }
    return { runId: step.runId, stepNo: step.stepNo, nextStepNo, modelCalls };
  }
  async failStep(runToken: string, error: string, maxAttempts = 3): Promise<FailResult> {
    const step = this.held(runToken);
    const retryable = step.attempts < maxAttempts;
    step.status = retryable ? 'ready' : 'failed'; step.result = { error };
    step.runToken = null; step.claimedBy = null; step.updatedAt = this.now();
    return { runId: step.runId, stepNo: step.stepNo, status: step.status, retryable };
  }
  async recoverStaleSteps(staleSeconds = 60): Promise<RecoveredStep[]> {
    const recovered: RecoveredStep[] = [];
    for (const step of this.steps) {
      if (step.status === 'running' && this.now() - step.updatedAt > staleSeconds * 1000) {
        step.status = 'ready'; step.runToken = null; step.claimedBy = null; step.updatedAt = this.now();
        recovered.push({ id: step.id, runId: step.runId, stepNo: step.stepNo });
      }
    }
    return recovered;
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
  enqueueSteps(runId: string, specs: StepSpec[]) { return this.host.enqueueSteps(runId, specs); }
  async claimStep(workerId: string, runId?: string): Promise<ClaimedStep | null> {
    const step = await this.host.claimStep(workerId, runId);
    return step ? { ...step, id: String(step.id) } : null;
  }
  async completeStep(runToken: string, result: Record<string, unknown> = {}, options: CompleteOptions = {}) {
    const done = await this.host.completeStep(runToken, result, options);
    return { runId: done.runId, stepNo: done.stepNo, nextStepNo: done.nextStepNo, modelCalls: done.modelCalls };
  }
  async failStep(runToken: string, error: string, maxAttempts = 3) {
    const failed = await this.host.failStep(runToken, error, maxAttempts);
    return { runId: failed.runId, stepNo: failed.stepNo, status: failed.status, retryable: failed.retryable };
  }
  async recoverStaleSteps(staleSeconds = 60) {
    return (await this.host.recoverStaleSteps(staleSeconds))
      .map(row => ({ id: String(row.id), runId: row.runId, stepNo: row.stepNo }));
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
 */
export async function driveSteppedLoop(input: {
  queue: StepQueue; runId: string; principal: string; scope?: string | null;
  first: StepSpec; handlers: Record<string, StepHandler>;
  recheck?: StepRecheck; maxSteps?: number;
  worker?: (stepNo: number) => { workerId: string; environment: string };
}): Promise<{ steps: number; modelCalls: number; stoppedBy: string; environments: string[]; failure?: string }> {
  const maxSteps = input.maxSteps ?? 60;
  const worker = input.worker ?? (() => ({ workerId: 'step-worker-a', environment: '本机执行环境' }));
  // 幂等：调用方若已把首步排进队列，这里不再插一条重复步骤。
  if ((await input.queue.runState(input.runId)).length === 0)
    await input.queue.enqueueSteps(input.runId, [input.first]);
  let modelCalls = 0;
  const environments: string[] = [];
  for (let i = 1; i <= maxSteps; i += 1) {
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
  loop: '常驻循环（当前默认，可随时回退）',
  step: '单步执行（队列每激活一棒，进程只跑一步）',
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
      '默认底座仍是 paperclip，飞书仍是唯一发起入口',
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
