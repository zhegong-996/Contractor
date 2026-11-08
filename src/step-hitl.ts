/**
 * 生产项 P-6 · HITL（人在回路）成对留痕（第二十四轮）。
 *
 * 协议语义移植自 Runner —— MIT License, Copyright (c) 2026 Yicheng Wang。
 *   https://github.com/yicheng47/runner @ a42d133139bbe630e4ca3475426c7653fddd86db
 *   docs/arch/arch.md §3「ask_human / HITL」
 * 本文件是 TypeScript 重写，未复制任何 Rust 源码；按 MIT 要求保留版权声明，
 * 许可证原文见 licenses/runner-MIT.txt，来源登记见 docs/SOURCES.md。
 *
 * 与 Runner 一致的三个不变量：
 *   1. canonical question_id 就是 `human_question` 事件自己的 id；
 *   2. 因果关系放 payload（`triggered_by` / `question_id`），不放 envelope；
 *   3. `human_response` 只是把答案送回提问者，不等于验收。
 *
 * 本项目红线（不因移植放宽）：
 *   - 执行进程只能提问，不得自行放行人工确认步；
 *   - 最终核可仍只能由原发起人在原会话用中文「确认验收 任务编号」完成；
 *   - 这份台账刻意独立于 B1 记忆主干（同 C-6 治理台账），不并入 events.jsonl。
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runtime } from './config.ts';

export const HITL_RED_LINES = [
  '执行进程只能提出人工问题，不得自行放行人工确认步',
  '问题编号就是提问事件自己的 id，因果关系放载荷而不是信封',
  '人工回答只是把答案送回提问者，绝不替代原发起人在原会话确认验收',
  '台账独立于共享记忆主干，历史问题与回答不回溯改写',
] as const;

export type HitlEvent = {
  id: string;
  kind: 'signal';
  type: 'human_question' | 'human_response';
  from: string;
  to?: string;
  at: string;
  payload: Record<string, unknown>;
};

export type HitlSink = {
  append(event: HitlEvent): void;
  read(): HitlEvent[];
};

/** 计算确定性的事件 id；真跑可注入 idFactory 使用全局单调递增编号。 */
function eventId(parts: readonly (string | number)[], at: string, idFactory?: () => string): string {
  if (idFactory) return idFactory();
  return 'hq-' + createHash('sha256').update([...parts, at].join(':')).digest('hex').slice(0, 24);
}

export type AskHumanInput = {
  runId: string;
  stepNo: number;
  asker: string;
  prompt: string;
  choices: readonly string[];
  /** 触发这次提问的上游事件 id；因果只放 payload。 */
  triggeredBy?: string | null;
  onBehalfOf?: string | null;
  at?: string;
  idFactory?: () => string;
};

/** `ask_human` → 一条给人的 `human_question`，id 即后续回答要引用的问题编号。 */
export function askHuman(input: AskHumanInput): HitlEvent {
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) throw new Error('人工提问不能为空，拒绝留一条没有内容的问题');
  const choices = [...new Set((input.choices ?? []).map(String).map(s => s.trim()).filter(Boolean))];
  if (choices.length < 2) throw new Error('人工提问至少要给出两个可选项');
  if (!input.runId || !input.asker) throw new Error('人工提问必须登记任务编号与提问者');
  const at = input.at ?? new Date().toISOString();
  const id = eventId([input.runId, input.stepNo, prompt, choices.join('|'), input.asker], at, input.idFactory);
  return {
    id, kind: 'signal', type: 'human_question', from: 'router', at,
    payload: {
      triggered_by: input.triggeredBy ?? null,
      prompt, choices,
      on_behalf_of: input.onBehalfOf ?? null,
      run_id: input.runId, step_no: input.stepNo, asker: input.asker,
    },
  };
}

export type AnswerHumanInput = {
  question: HitlEvent;
  choice: string;
  /** 真人身份；空值一律拒绝，避免执行进程冒充人。 */
  actor: string;
  note?: string;
  at?: string;
  idFactory?: () => string;
};

/** `human_response` → 一条 from `human` 给原始 asker 的成对回答。 */
export function answerHuman(input: AnswerHumanInput): HitlEvent {
  if (input.question.type !== 'human_question') throw new Error('回答必须关联一条人工提问事件');
  const actor = String(input.actor ?? '').trim();
  if (!actor) throw new Error('人工回答必须由真人身份给出，执行进程不得冒充');
  const choices = (input.question.payload.choices as string[] | undefined) ?? [];
  if (!choices.includes(input.choice)) throw new Error('回答选项不在提问给出的范围内');
  const at = input.at ?? new Date().toISOString();
  const id = eventId([input.question.id, input.choice, actor], at, input.idFactory);
  return {
    id, kind: 'signal', type: 'human_response', from: 'human',
    to: String(input.question.payload.asker ?? ''), at,
    payload: {
      question_id: input.question.id,
      choice: input.choice,
      note: String(input.note ?? ''),
      actor,
      // 显式标注：这条回答不是验收，避免将来被误读成「人已核可」。
      acceptance: false,
    },
  };
}

/** 执行进程在 human-gate 步抛出：只提问、不放行，由调用方决定把问题落到哪份台账。 */
export class HitlRefusal extends Error {
  constructor(readonly question: HitlEvent) {
    super(`人工确认只能由原发起人在原会话完成，执行进程不得自行放行；问题编号 ${question.id}（等待真人在原会话回答）`);
    this.name = 'HitlRefusal';
  }
}

export type HitlPair = { question: HitlEvent; response: HitlEvent | null };
export type HitlProjection = {
  questions: HitlEvent[];
  responses: HitlEvent[];
  pairs: HitlPair[];
  pending: HitlEvent[];
  orphanResponses: HitlEvent[];
  duplicateAnswers: HitlEvent[];
  acceptanceAttempts: HitlEvent[];
  errors: string[];
};

/** 从 append-only 事件流折叠投影；坏行如实记 errors，不静默丢弃。 */
export function foldHitl(events: readonly HitlEvent[]): HitlProjection {
  const questions = new Map<string, HitlEvent>();
  const answers = new Map<string, HitlEvent>();
  const projection: HitlProjection = {
    questions: [], responses: [], pairs: [], pending: [], orphanResponses: [],
    duplicateAnswers: [], acceptanceAttempts: [], errors: [],
  };
  for (const event of events) {
    if (!event || typeof event.id !== 'string' || !['human_question', 'human_response'].includes(event.type)) {
      projection.errors.push('事件缺少 id 或类型未登记');
      continue;
    }
    if (event.type === 'human_question') {
      if (questions.has(event.id)) { projection.errors.push(`问题编号重复：${event.id}`); continue; }
      questions.set(event.id, event);
      projection.questions.push(event);
      continue;
    }
    projection.responses.push(event);
    const questionId = String(event.payload?.question_id ?? '');
    if (event.payload?.acceptance === true || /确认验收|accepted|approved/i.test(String(event.payload?.choice ?? '')))
      projection.acceptanceAttempts.push(event);
    if (!questionId || !questions.has(questionId)) { projection.orphanResponses.push(event); continue; }
    if (answers.has(questionId)) { projection.duplicateAnswers.push(event); continue; }
    answers.set(questionId, event);
  }
  for (const question of projection.questions) {
    const response = answers.get(question.id) ?? null;
    projection.pairs.push({ question, response });
    if (!response) projection.pending.push(question);
  }
  return projection;
}

/** 红线校验：孤儿回答、重复回答、坏行、把回答冒充验收一律拒绝。 */
export function assertHitlRedLines(events: readonly HitlEvent[]): HitlProjection {
  const projection = foldHitl(events);
  if (projection.errors.length) throw new Error(`人工问题台账存在坏行：${projection.errors[0]}`);
  if (projection.orphanResponses.length) throw new Error('存在没有对应提问的人工回答');
  if (projection.duplicateAnswers.length) throw new Error('同一问题被重复回答，历史不得回溯改写');
  if (projection.acceptanceAttempts.length) throw new Error('人工回答不得冒充原发起人的确认验收');
  return projection;
}

/** 确定性摘要：两次相同事件流必须逐字节一致。 */
export function hitlSummary(events: readonly HitlEvent[]) {
  const projection = foldHitl(events);
  const signature = createHash('sha256').update(JSON.stringify(events.map(e =>
    ({ id: e.id, type: e.type, from: e.from, at: e.at, payload: e.payload })))).digest('hex');
  return {
    questions: projection.questions.length,
    responses: projection.responses.length,
    paired: projection.pairs.filter(p => p.response).length,
    pending: projection.pending.length,
    orphanResponses: projection.orphanResponses.length,
    duplicateAnswers: projection.duplicateAnswers.length,
    acceptanceAttempts: projection.acceptanceAttempts.length,
    errors: projection.errors.length,
    signature,
  };
}

// --- 台账：默认落在 .runtime/，测试可注入内存或临时文件 --------------------

export class MemoryHitlSink implements HitlSink {
  private events: HitlEvent[] = [];
  append(event: HitlEvent) { this.events.push(event); }
  read(): HitlEvent[] { return this.events.map(e => ({ ...e })); }
}

/** append-only JSONL；跨进程的 step:once 与 step:answer 共享同一份文件。 */
export class FileHitlSink implements HitlSink {
  constructor(readonly file: string) { mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); }
  append(event: HitlEvent) {
    appendFileSync(this.file, JSON.stringify(event) + '\n', { mode: 0o600 });
  }
  read(): HitlEvent[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line) as HitlEvent]; } catch { return []; }
    });
  }
}

export function resolveHitlSink(): HitlSink {
  const custom = process.env.COLLAB_HITL_LEDGER;
  if (custom) return new FileHitlSink(path.resolve(custom));
  if (process.env.COLLAB_TEST_HITL === 'memory') return new MemoryHitlSink();
  return new FileHitlSink(runtime('step-hitl', 'events.jsonl'));
}
