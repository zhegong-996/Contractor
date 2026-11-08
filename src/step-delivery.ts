/**
 * 第二十四轮 · 持久化队列的累计确认、至少一次通知与投递就绪。
 *
 * 协议语义移植自 Runner —— MIT License, Copyright (c) 2026 Yicheng Wang。
 *   https://github.com/yicheng47/runner @ a42d133139bbe630e4ca3475426c7653fddd86db
 *   docs/arch/arch.md §4「事件如何持久化与投递」与 Dispatcher / readiness 细节
 * 本文件是 TypeScript 重写，未复制任何 Rust 源码；按 MIT 要求保留版权声明，
 * 许可证原文见 licenses/runner-MIT.txt。
 *
 * 三条保证（与 Runner 一致）：
 *   - 消息一旦 append 即 durable；进程退出 / 重启不丢；
 *   - 通知只告诉订阅者「有积压」，不带消息体；重复通知无害，丢失由重投递修复；
 *   - 确认是 cumulative 的：`up_to` 之前的消息全部已消费，ack 只前进、忽略旧 ack。
 *
 * 本项目特有：`TrackedStepQueue` 包住既有 `StepQueue`，在领取与完成处留下
 * 「消息确实送到执行端」证据，不改 PG 表结构、不改默认 loop 路径。
 */
import { createHash } from 'node:crypto';
import type {
  StepQueue, StepSpec, ClaimedStep, CompleteOptions, CompleteResult,
  FailResult, RecoveredStep, StepState,
} from './step-execution.ts';
import { resolveRuntime } from './mission-state.ts';

export type DeliveryEventType = 'message' | 'notification' | 'inbox_read' | 'step_delivered' | 'step_ack';

export type DeliveryEvent = {
  /** append-only 流里的全序编号；ack 与 backlog 都以它为准。 */
  id: string;
  type: DeliveryEventType;
  at: string;
  subscriber?: string;
  from?: string;
  to?: string[] | null;
  runId?: string;
  stepNo?: number;
  upTo?: string;
  payload?: Record<string, unknown>;
};

/** cumulative acknowledgement：只前进，stale ack 一律忽略。 */
export function cumulativeAck(current: string | null, upTo: string,
  order: readonly string[]): string | null {
  const currentIndex = current ? order.indexOf(current) : -1;
  const nextIndex = order.indexOf(upTo);
  if (nextIndex < 0) return current;
  return nextIndex > currentIndex ? upTo : current;
}

export type DeliveryProjection = {
  messages: DeliveryEvent[];
  backlog: DeliveryEvent[];
  lastAck: string | null;
  unreadCount: number;
  notifications: DeliveryEvent[];
  delivered: DeliveryEvent[];
  acknowledged: DeliveryEvent[];
  errors: string[];
};

/** 从同一份 append-only 流折叠投影；启动重放只重建投影，不重跑历史投递。 */
export function foldDelivery(events: readonly DeliveryEvent[], subscriber: string): DeliveryProjection {
  const order = events.map(event => event.id);
  const messages: DeliveryEvent[] = [];
  const notifications: DeliveryEvent[] = [];
  const delivered: DeliveryEvent[] = [];
  const acknowledged: DeliveryEvent[] = [];
  const errors: string[] = [];
  let lastAck: string | null = null;
  for (const event of events) {
    if (!event || typeof event.id !== 'string' || !event.id) { errors.push('投递事件缺少全序编号'); continue; }
    switch (event.type) {
      case 'message': {
        const addressed = !event.to || event.to.includes(subscriber);
        if (event.from !== subscriber && addressed) messages.push(event);
        break;
      }
      case 'notification':
        if (event.subscriber === subscriber) notifications.push(event);
        break;
      case 'inbox_read':
        if (event.subscriber === subscriber && event.upTo)
          lastAck = cumulativeAck(lastAck, event.upTo, order);
        break;
      case 'step_delivered': delivered.push(event); break;
      case 'step_ack': acknowledged.push(event); break;
      default: errors.push(`未登记的投递事件类型：${String(event.type)}`);
    }
  }
  const ackIndex = lastAck ? order.indexOf(lastAck) : -1;
  const backlog = messages.filter(message => order.indexOf(message.id) > ackIndex);
  return { messages, backlog, lastAck, unreadCount: backlog.length, notifications,
    delivered, acknowledged, errors };
}

/** 通知只带未读条数、不带消息体；同一积压量重复生成逐字相同（幂等）。 */
export function notificationText(unreadCount: number): string {
  return `[收件箱] 有 ${Math.max(0, Math.trunc(unreadCount))} 条新消息 — 请读取本任务现场`;
}

/** 只要还有未确认的消息，就一直需要通知（at-least-once；重复无害）。 */
export function atLeastOncePending(projection: DeliveryProjection): boolean {
  return projection.backlog.length > 0;
}

export type ReadinessInput = {
  idle: boolean;
  working: boolean;
  redelivery?: boolean;
  runtime: string;
  pendingSpawn?: boolean;
  startup?: boolean;
  draft?: boolean;
  recentTyping?: boolean;
  humanApproval?: boolean;
  inFlight?: boolean;
  unconfirmedReadiness?: boolean;
};

export type Readiness = { ready: boolean; reason: string };

/**
 * 投递就绪由执行端状态拥有，而不是由队列猜：
 * 空闲才可发起；唯一例外是执行端声明 `queuesInputMidTurn` 且不是重投递。
 * 重投递对所有执行端都只在空闲时发生。
 */
export function deliveryReadiness(input: ReadinessInput): Readiness {
  const holds = [
    [input.pendingSpawn, '执行端尚在启动'],
    [input.startup, '执行端正在初始化'],
    [input.draft, '存在未提交的草稿'],
    [input.recentTyping, '检测到近期输入'],
    [input.humanApproval, '有等待人工批准的动作'],
    [input.inFlight, '已有一次投递在途'],
    [input.unconfirmedReadiness, '就绪状态尚未被确认'],
  ] as const;
  for (const [held, reason] of holds) if (held) return { ready: false, reason };
  if (input.redelivery) {
    return input.idle ? { ready: true, reason: '空闲，允许重投递' }
      : { ready: false, reason: '重投递只在空闲的执行端发生' };
  }
  if (input.idle) return { ready: true, reason: '空闲，可以投递' };
  if (input.working && resolveRuntime(input.runtime).queuesInputMidTurn)
    return { ready: true, reason: '该执行端支持回合中排队输入，下一次工具调用时送达' };
  return { ready: false, reason: '执行端正忙且不支持回合中排队输入，等空闲再投递' };
}

// --- 包装既有队列：留下「消息确实送到执行端」证据 --------------------------

export type DeliveryEvidence = {
  runId: string;
  enqueued: number;
  delivered: number;
  acknowledged: number;
  pendingDelivery: number;
  notifications: number;
  atLeastOnce: boolean;
  errors: number;
  signature: string;
};

/**
 * 组合而非修改：包住 InMemoryStepQueue / PgStepQueue 任意一个实现，
 * 在 enqueue / claim / complete / ack 处追加 append-only 投递事件。
 */
export class TrackedStepQueue implements StepQueue {
  private events: DeliveryEvent[] = [];
  private seq = 0;
  constructor(private readonly inner: StepQueue,
    private readonly now: () => number = () => Date.now()) {}
  private append(event: Omit<DeliveryEvent, 'id' | 'at'>): DeliveryEvent {
    this.seq += 1;
    const full: DeliveryEvent = { id: 'd' + String(this.seq).padStart(6, '0'),
      at: new Date(this.now()).toISOString(), ...event };
    this.events.push(full);
    return full;
  }
  id() { return this.inner.id() + '+delivery'; }
  /** 12b ⑧：对外动作登记透传（组合不改语义，投递事件由调用方自行追加）。 */
  markOutwardAction(runToken: string, action: string) { return this.inner.markOutwardAction(runToken, action); }
  eventsView(): DeliveryEvent[] { return this.events.map(event => ({ ...event })); }
  async enqueueSteps(runId: string, specs: StepSpec[]) {
    const result = await this.inner.enqueueSteps(runId, specs);
    specs.forEach((spec, index) => this.append({ type: 'message', runId,
      stepNo: index + 1, from: 'queue', to: null,
      payload: { kind: spec.kind } }));
    return result;
  }
  /** P-11：立即就绪的入队（自动续跑闸）；同样留下送达证据。 */
  async enqueueReadySteps(runId: string, specs: StepSpec[]) {
    const result = await this.inner.enqueueReadySteps(runId, specs);
    specs.forEach((spec, index) => this.append({ type: 'message', runId,
      stepNo: index + 1, from: 'queue', to: null,
      payload: { kind: spec.kind, immediate: true } }));
    return result;
  }
  async claimStep(workerId: string, runId?: string): Promise<ClaimedStep | null> {
    const step = await this.inner.claimStep(workerId, runId);
    if (step) this.append({ type: 'step_delivered', runId: step.runId, stepNo: step.stepNo,
      subscriber: workerId, payload: { workerId, runTokenPrefix: step.runToken.slice(0, 8) } });
    return step;
  }
  async completeStep(runToken: string, result: Record<string, unknown> = {},
    options: CompleteOptions = {}): Promise<CompleteResult> {
    const done = await this.inner.completeStep(runToken, result, options);
    this.append({ type: 'step_ack', runId: done.runId, stepNo: done.stepNo,
      payload: { nextStepNo: done.nextStepNo } });
    this.append({ type: 'notification', subscriber: done.runId, runId: done.runId,
      payload: { text: notificationText(0), cause: 'step_ack' } });
    return done;
  }
  async failStep(runToken: string, error: string, maxAttempts = 3): Promise<FailResult> {
    const failed = await this.inner.failStep(runToken, error, maxAttempts);
    this.append({ type: 'notification', subscriber: failed.runId, runId: failed.runId,
      payload: { text: notificationText(0), cause: 'step_fail' } });
    return failed;
  }
  recoverStaleSteps(staleSeconds = 60): Promise<RecoveredStep[]> {
    return this.inner.recoverStaleSteps(staleSeconds);
  }
  runState(runId: string): Promise<StepState[]> { return this.inner.runState(runId); }

  /** 累计确认：只有读入成功的消息才推进，旧 ack 自动忽略。 */
  acknowledgeUpTo(runId: string, upTo: string): string | null {
    this.append({ type: 'inbox_read', subscriber: runId, runId, upTo });
    return foldDelivery(this.events, runId).lastAck;
  }

  evidence(runId: string): DeliveryEvidence {
    const projection = foldDelivery(this.events, runId);
    const mine = this.events.filter(event => event.runId === runId);
    const delivered = projection.delivered.filter(event => event.runId === runId).length;
    const acknowledged = projection.acknowledged.filter(event => event.runId === runId).length;
    const notifications = projection.notifications.filter(event => event.runId === runId).length;
    const signature = createHash('sha256').update(JSON.stringify(mine.map(event =>
      ({ id: event.id, type: event.type, stepNo: event.stepNo, upTo: event.upTo })))).digest('hex');
    return { runId, enqueued: mine.filter(e => e.type === 'message').length,
      delivered, acknowledged, pendingDelivery: Math.max(0, delivered - acknowledged),
      notifications, atLeastOnce: atLeastOncePending(projection),
      errors: projection.errors.length, signature };
  }
}
