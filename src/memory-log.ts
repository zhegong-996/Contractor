// 方案 B · append-only 共享记忆事件主干。
//
// 目标：知识库正式定义为「Agent 的共享记忆」——事件日志是 system-of-record，
// L1 证据图 / L2 组织图 / BM25 向量 / Context Pack 都只是它的投影（见
// memory-projections.ts）。现有 Cognee / Ladybug / SQLite / Paperclip 文档存储
// 继续工作，本轮采用「双写」：真实写入点在写原存储的同时追加一条事件，
// 记录失败绝不影响业务结果（与 RoutingTrace / TraceBridge 的 advisory 语义一致）。
//
// 与 routing-trace.ts 的关系：两者都是 append-only 的 MemoryEvent 流，但职责
// 不同——路由决策链回答「谁把任务交给谁」，记忆事件链回答「知识从哪来、
// 变成什么、被谁撤权」。routing-decided 可通过 bridgeRoutingEvent() 并入主干。
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runtime } from './config.ts';
import { memoryEventSchema, type MemoryEvent, type MemoryEventKind, type MemoryProjection } from './architecture-contracts.ts';
import { readRoutingEvents } from './routing-trace.ts';

export const memoryLogPath = (dir?: string) => path.join(dir ?? runtime('memory'), 'events.jsonl');

export interface MemorySink { write(line: string): void }
export class FileMemorySink implements MemorySink {
  constructor(readonly file: string) { mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); }
  write(line: string) { appendFileSync(this.file, line + '\n', { mode: 0o600 }); }
}
export class InMemorySink implements MemorySink {
  readonly lines: string[] = [];
  write(line: string) { this.lines.push(line); }
}

export type MemoryEventInput = {
  id?: string;
  kind: MemoryEventKind;
  actor: string;
  at?: string;
  causedBy?: string;
  sourceRef?: { sourceId: string; revision: string };
  policyVersion?: string;
  modelCalls?: number;
  projection?: MemoryProjection;
  visibility?: MemoryEvent['visibility'];
  payload?: Record<string, unknown>;
  /** 提供时不把时间纳入 id，重试同一业务动作不会造成重复事件。 */
  idempotencyKey?: string;
};

export type MemoryAudit = (action: string, issueId: string | null, value: unknown) => void;

const stable = (value: unknown) => JSON.stringify(value);

/** 构造一条经过契约校验的事件；校验失败说明调用方有 bug，必须显式暴露。 */
export function memoryEvent(input: MemoryEventInput): MemoryEvent {
  const at = input.at ?? new Date().toISOString();
  const identity = input.idempotencyKey ?? [input.kind, input.actor, at,
    stable(input.sourceRef ?? null), stable(input.payload ?? {}), input.causedBy ?? ''].join('|');
  const id = input.id ?? createHash('sha256').update(identity).digest('hex').slice(0, 32);
  return memoryEventSchema.parse({
    id, kind: input.kind, actor: input.actor, at,
    ...(input.causedBy ? { causedBy: input.causedBy } : {}),
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    ...(input.policyVersion ? { policyVersion: input.policyVersion } : {}),
    ...(input.modelCalls !== undefined ? { modelCalls: input.modelCalls } : {}),
    ...(input.projection ? { projection: input.projection } : {}),
    ...(input.visibility ? { visibility: input.visibility } : {}),
    payload: input.payload ?? {},
  });
}

export class MemoryLog {
  private readonly seen = new Set<string>();
  constructor(readonly sinks: MemorySink[] = [new FileMemorySink(memoryLogPath())], private audit?: MemoryAudit) {}
  attachAudit(audit: MemoryAudit) { this.audit = audit; return this; }

  /** 追加一条事件。永远不抛错：主干是证据，不是业务前置条件。 */
  append(input: MemoryEventInput): { written: boolean; duplicate: boolean; event?: MemoryEvent; reason?: string } {
    let event: MemoryEvent;
    try { event = memoryEvent(input); }
    catch (error) { return { written: false, duplicate: false, reason: 'invalid-event: ' + String(error).slice(0, 200) }; }
    if (this.seen.has(event.id)) return { written: false, duplicate: true, event, reason: 'duplicate-in-process' };
    let written = 0;
    for (const sink of this.sinks) {
      try { sink.write(JSON.stringify(event)); written++; } catch { /* 单个 sink 失败不影响其它 sink */ }
    }
    this.seen.add(event.id);
    try {
      this.audit?.('memory.event', event.sourceRef?.sourceId ?? event.payload.taskId as string ?? null,
        { id: event.id, kind: event.kind, actor: event.actor, modelCalls: event.modelCalls ?? 0 });
    } catch { /* 审计表不可用不改业务结果 */ }
    return { written: written > 0, duplicate: false, event,
      ...(written === 0 ? { reason: 'no-sink-available' } : {}) };
  }

  /** 把一条已有事件（例如 RoutingTrace 的决策事件）并入主干，保持同一 id。 */
  bridge(event: MemoryEvent) { return this.append({ ...event, idempotencyKey: event.id }); }
}

let current: MemoryLog | undefined;
/** 真实写入点共用的单例；测试进程由 scripts/test.ts 标记为内存 sink。 */
export function getMemoryLog(): MemoryLog {
  if (current) return current;
  if (process.env.COLLAB_TEST_MEMORY === 'memory') return current = new MemoryLog([new InMemorySink()]);
  return current = new MemoryLog();
}
export function setMemoryLog(log: MemoryLog | null): void { current = log ?? undefined; }

/** 接线点唯一需要调用的便捷函数：advisory 写入，不影响业务。 */
export function recordMemory(input: MemoryEventInput) { return getMemoryLog().append(input); }

/** 只读重放输入：坏行不静默丢弃，记入 errors。 */
export function readMemoryEvents(file = memoryLogPath()): { events: MemoryEvent[]; errors: string[] } {
  if (!existsSync(file)) return { events: [], errors: [] };
  const events: MemoryEvent[] = [], errors: string[] = [];
  readFileSync(file, 'utf8').split('\n').filter(Boolean).forEach((line, index) => {
    try { events.push(memoryEventSchema.parse(JSON.parse(line))); }
    catch (error) { errors.push(`line ${index + 1}: ${String(error).slice(0, 160)}`); }
  });
  return { events, errors };
}

/**
 * 只读合并视图：RoutingDecision 在上一轮已通过 toMemoryEvent() 变成合法
 * MemoryEvent，B 阶段直接并入重放输入，不需要第二套格式、也不复制数据。
 * 路由事件属于「谁把任务交给谁」，不参与四类知识投影，但计入可核对的事件流。
 */
/** 单条路由事件的桥接归一化，纯函数，可直接测试。 */
export function bridgeRoutingEvent(event: MemoryEvent): MemoryEvent {
  const { causedBy, ...rest } = event;
  return causedBy ? { ...rest, payload: { ...rest.payload, routingCausedBy: causedBy } } : rest;
}

export function readBridgedEvents(): { events: MemoryEvent[]; errors: string[]; routingEvents: number } {
  const memory = readMemoryEvents(), routing = readRoutingEvents();
  // 不在桥接层去重：同一业务动作在不同进程各写一次是 append-only 日志的正常现象，
  // 必须由 replayMemory 如实记入 integrity.duplicateIds 再去重，不能悄悄藏起来。
  // 路由事件的 causedBy 是业务标识（triggerId / phase），不是主干事件 id，
  // 由 bridgeRoutingEvent 归一化，避免合并视图误报悬空 lineage。
  return { events: [...memory.events, ...routing.events.map(bridgeRoutingEvent)],
    errors: [...memory.errors, ...routing.errors.map(error => 'routing: ' + error)],
    routingEvents: routing.events.length };
}

export function sourceKey(sourceId: string, revision: string) { return `${sourceId}@${revision}`; }

/** 来源事件的稳定 id；派生事件用它作 causedBy，撤权才能沿 lineage 传播。 */
export function sourceEventId(sourceId: string, revision: string): string {
  return createHash('sha256').update('source:' + sourceKey(sourceId, revision)).digest('hex').slice(0, 32);
}
