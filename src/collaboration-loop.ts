/**
 * 双向协作回路（Bidirectional Collaboration Loop）· 纯函数契约，零 IO / 零网络 / 零模型调用。
 *
 * 这一层回答的不是「Agent 能不能干活」，而是「人和干活的 Agent 之间有没有
 * 两条相反方向的移动」：
 *
 *   下行 downstream（人 → 执行端）：发起、授权、补充说明、回答、批准接续、复核、核可、驳回
 *   上行 upstream（执行端 → 人）：进度、提问、请示、阻塞、回执、结果
 *
 * 一条**完整回合**是「上行 → 人侧应答 → 执行端带着应答继续」。只有下行没有
 * 上行是推送，只有上行没有下行是失联，上行之后人来答了却没有回流是半条回路——
 * 三者都不构成有机互动。`loopReport()` 把这些状态显式判出来，不靠运行时推断。
 *
 * 红线（与 HANDOFF/07 一致，且比上游更严）：
 *   1. 回执 / 结果 ≠ 验收；只有原发起人在原会话的 accept 才算核可。
 *   2. 人工回答 ≠ 放行；回答只产生「待真人确认的续跑建议」，不自动排后续步骤。
 *   3. 执行进程不得冒充真人，不得自行批准、自行验收、自行改写任务状态。
 *   4. 回路体检是只读 advisory，不拦截业务、不回写 B1 记忆主干。
 *
 * 协议思想参考（都只用 TypeScript 重写，未复制上游代码）：
 *   - Runner `ask_human → human_question → human_response`（MIT @ a42d1331，
 *     见 sources.lock.json 的 protocolReferences）：成对留痕 + 答案要回到提问者。
 *   - Autoloop `ask / notice / resolve / later` 的回执与接续语义（upstream/autoloop）。
 *   - OpenMausBot question / approval 卡片的人侧回写（Apache-2.0 @ 3f81576，
 *     见 sources.lock.json 的 conceptReferences）。
 */
import { createHash } from 'node:crypto';

export const LOOP_DIRECTIONS = ['downstream', 'upstream'] as const;
export type LoopDirection = (typeof LOOP_DIRECTIONS)[number];

/** 下行：人发出的动作。reject / review 也算人侧应答，用于关闭回执回路。 */
export const DOWNSTREAM_KINDS = [
  'initiate', 'authorize', 'supplement', 'answer', 'resume-approved',
  'review', 'accept', 'reject',
] as const;
/** 上行：执行端发出的动作。progress 是告知型，不要求人侧必答。 */
export const UPSTREAM_KINDS = [
  'progress', 'question', 'escalation', 'blocked', 'receipt', 'result',
] as const;
export type DownstreamKind = (typeof DOWNSTREAM_KINDS)[number];
export type UpstreamKind = (typeof UPSTREAM_KINDS)[number];
export type LoopKind = DownstreamKind | UpstreamKind;

/** 哪些上行必须由人侧动作关闭。progress 是告知，其余都要求应答。 */
export const UPSTREAM_REQUIRES_REPLY: readonly UpstreamKind[] = [
  'question', 'escalation', 'blocked', 'receipt', 'result',
];
/** 关闭提问 / 请示 / 阻塞的人侧动作。 */
export const QUESTION_REPLY_KINDS: readonly DownstreamKind[] = [
  'answer', 'supplement', 'resume-approved', 'reject',
];
/** 关闭回执 / 结果的人侧动作；回执本身绝不等于验收。 */
export const RECEIPT_REPLY_KINDS: readonly DownstreamKind[] = [
  'review', 'accept', 'reject',
];

export type LoopEvent = {
  id: string;
  direction: LoopDirection;
  kind: LoopKind;
  at: number;
  taskId: string;
  actor: string;
  /** 本事件回应的是哪条相反方向的事件；这是回路的因果边，不放在自由载荷里。 */
  inReplyTo?: string | null;
  /** 上行事件期待的人侧动作；未登记且非 progress 会判为缺口。 */
  expectsHumanAction?: string | null;
  /** 只有 accept 可以为 true，且 actor 必须是原发起人。 */
  acceptance?: boolean;
  /** 是否只是建议而非已执行的动作（resume proposal 用）。 */
  advisory?: boolean;
  payload?: Record<string, unknown>;
};

export type OpenLoop = {
  upstreamId: string;
  kind: UpstreamKind;
  taskId: string;
  reason: 'no-human-reply' | 'missing-expectation' | 'reply-not-followed-through';
};

export type LoopFinding = {
  code: string;
  severity: 'gap' | 'violation';
  target: string;
  message: string;
};

export type LoopReport = {
  total: number;
  downstream: number;
  upstream: number;
  /** 两个方向都真实出现过事件，才算双向。 */
  bidirectional: boolean;
  /** 上行被人侧关闭、且之后执行端继续动作（或任务被核可）的完整回合数。 */
  closedCycles: number;
  /** 上行还没有人侧应答，或应答后没有回流。 */
  openLoops: OpenLoop[];
  /** 人回答了，但之后既没有回流建议也没有执行端新动作：答完就消失。 */
  staleAnswers: string[];
  /** 回执 / 结果之后没有人侧复核：把回执误当收口。 */
  receiptWithoutReview: string[];
  /** 只有下行、从未上行的任务：单向推送段。 */
  oneWayTasks: string[];
  /** 没有任务归属的孤儿事件。 */
  orphanEvents: string[];
  /** 冒用验收、非原发起人核可、自动执行等红线违规。 */
  violations: LoopFinding[];
  findings: LoopFinding[];
  signature: string;
};

const sha = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const isDownstream = (kind: string): kind is DownstreamKind =>
  (DOWNSTREAM_KINDS as readonly string[]).includes(kind);
const isUpstream = (kind: string): kind is UpstreamKind =>
  (UPSTREAM_KINDS as readonly string[]).includes(kind);

/**
 * 回路完整性体检。输入是归一化后的事件流，不读文件、不查宿主、不写状态。
 * 判据全部是结构性的：方向、因果边、人侧应答、应答后的回流。
 */
export function loopReport(input: {
  events: readonly LoopEvent[];
  /** 原发起人身份；accept 的 actor 必须在这里，否则判违规。 */
  humanOwners?: readonly string[];
  /** 外部已经生成的回流建议编号（由 bridgeAnswerToResume 产出）。 */
  resumeProposals?: readonly { id: string; inReplyTo: string }[];
}): LoopReport {
  const events = [...input.events].sort((a, b) =>
    toLoopAt(a.at) - toLoopAt(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const owners = new Set(input.humanOwners ?? []);
  const proposals = input.resumeProposals ?? [];
  const proposalsByReply = new Map<string, string[]>();
  for (const p of proposals) {
    const list = proposalsByReply.get(p.inReplyTo) ?? [];
    list.push(p.id);
    proposalsByReply.set(p.inReplyTo, list);
  }

  const findings: LoopFinding[] = [];
  const violations: LoopFinding[] = [];
  const orphanEvents: string[] = [];
  const valid: LoopEvent[] = [];

  for (const event of events) {
    if (!event || typeof event.id !== 'string' || !event.id || !event.taskId) {
      const label = String(event?.id || '<no-id>');
      orphanEvents.push(label);
      findings.push({ code: 'orphan-event', severity: 'gap', target: label,
        message: '事件缺少编号或任务归属，无法形成回路' });
      continue;
    }
    if (!LOOP_DIRECTIONS.includes(event.direction)
      || (event.direction === 'downstream' && !isDownstream(event.kind))
      || (event.direction === 'upstream' && !isUpstream(event.kind))) {
      findings.push({ code: 'direction-kind-mismatch', severity: 'gap', target: event.id,
        message: `方向 ${event.direction} 与动作 ${event.kind} 不匹配` });
      continue;
    }
    if (event.acceptance === true) {
      if (event.kind !== 'accept') {
        violations.push({ code: 'acceptance-forged', severity: 'violation', target: event.id,
          message: `${event.kind} 不得标记为验收：回执 / 回答 / 报告都不替代最终核可` });
      } else if (owners.size && !owners.has(event.actor)) {
        violations.push({ code: 'acceptance-not-owner', severity: 'violation', target: event.id,
          message: `核可人 ${event.actor} 不是原发起人` });
      }
    }
    if (event.kind === 'resume-approved' && event.advisory !== true) {
      violations.push({ code: 'auto-resume', severity: 'violation', target: event.id,
        message: '自动批准接续：续跑建议必须标 advisory 且由真人确认' });
    }
    valid.push(event);
  }

  const byIdMap = new Map(valid.map(e => [e.id, e]));
  const replies = new Map<string, LoopEvent[]>();
  for (const event of valid) {
    if (!event.inReplyTo) continue;
    const list = replies.get(event.inReplyTo) ?? [];
    list.push(event);
    replies.set(event.inReplyTo, list);
  }

  const openLoops: OpenLoop[] = [];
  const staleAnswers: string[] = [];
  const receiptWithoutReview: string[] = [];
  let closedCycles = 0;

  for (const event of valid.filter(e => e.direction === 'upstream')) {
    const kind = event.kind as UpstreamKind;
    if (kind === 'progress') continue; // 告知型，不要求必答
    if (!event.expectsHumanAction) {
      openLoops.push({ upstreamId: event.id, kind, taskId: event.taskId,
        reason: 'missing-expectation' });
      findings.push({ code: 'no-expectation', severity: 'gap', target: event.id,
        message: `上行 ${kind} 未登记期待的人侧动作，回路无法闭合` });
    }
    const expected = (kind === 'receipt' || kind === 'result')
      ? RECEIPT_REPLY_KINDS : QUESTION_REPLY_KINDS;
    const human = (replies.get(event.id) ?? [])
      .filter(r => r.direction === 'downstream'
        && (expected as readonly string[]).includes(r.kind));
    if (!human.length) {
      openLoops.push({ upstreamId: event.id, kind, taskId: event.taskId,
        reason: 'no-human-reply' });
      findings.push({ code: 'no-human-reply', severity: 'gap', target: event.id,
        message: `上行 ${kind} 没有人侧应答` });
      if (kind === 'receipt' || kind === 'result') receiptWithoutReview.push(event.id);
      continue;
    }
    if (kind === 'receipt' || kind === 'result') {
      const reviewed = human.some(r => r.kind === 'review' || r.kind === 'accept' || r.kind === 'reject');
      if (!reviewed) receiptWithoutReview.push(event.id);
    }
    // 人答了之后，执行端必须继续动作，或者已有明确（advisory、待真人确认）的回流建议。
    const followed = valid.some(e => e.direction === 'upstream' && toLoopAt(e.at) >= toLoopAt(human[0]!.at)
      && e.id !== event.id)
      || proposalsByReply.has(human[0]!.id)
      || human.some(r => r.kind === 'accept' || r.kind === 'reject');
    if (!followed) {
      staleAnswers.push(human[0]!.id);
      openLoops.push({ upstreamId: event.id, kind, taskId: event.taskId,
        reason: 'reply-not-followed-through' });
      findings.push({ code: 'answer-not-reflowed', severity: 'gap', target: human[0]!.id,
        message: '人已经回答，但没有回流建议也没有执行端后续动作：这是半条回路' });
    } else {
      closedCycles++;
    }
    // 因果边必须指向真实存在的相反方向事件，不能凭空造。
    for (const reply of human) {
      if (reply.inReplyTo && !byIdMap.has(reply.inReplyTo)) {
        findings.push({ code: 'dangling-cause', severity: 'gap', target: reply.id,
          message: `应答指向不存在的事件 ${reply.inReplyTo}` });
      }
    }
  }

  const downstreamCount = valid.filter(e => e.direction === 'downstream').length;
  const upstreamCount = valid.filter(e => e.direction === 'upstream').length;
  const tasks = [...new Set(valid.map(e => e.taskId))];
  const oneWayTasks = tasks.filter(task => !valid.some(e => e.taskId === task && e.direction === 'upstream'));

  const core = {
    total: valid.length, downstream: downstreamCount, upstream: upstreamCount,
    bidirectional: downstreamCount > 0 && upstreamCount > 0,
    closedCycles, openLoops: [...openLoops].sort((a, b) =>
      a.upstreamId < b.upstreamId ? -1 : a.upstreamId > b.upstreamId ? 1 : 0),
    staleAnswers: [...staleAnswers].sort(), receiptWithoutReview: [...receiptWithoutReview].sort(),
    oneWayTasks: [...oneWayTasks].sort(), orphanEvents: [...orphanEvents].sort(),
    violations: [...violations].sort((a, b) => a.target < b.target ? -1 : a.target > b.target ? 1 : 0),
    findings: [...findings].sort((a, b) => a.target < b.target ? -1 : a.target > b.target ? 1 : 0),
  };
  return { ...core, signature: sha(core) };
}

/** 红线守门：体检结论只能作 advisory，不得据此自动放行、自动验收或改写主干。 */
export function assertLoopAdvisory(report: LoopReport): {
  advisory: true; blocking: false; modelCalls: 0; violations: number;
} {
  if (report.violations.length) {
    throw new Error(`双向回路红线被突破：${report.violations[0]!.message}`);
  }
  return { advisory: true, blocking: false, modelCalls: 0, violations: 0 };
}

/**
 * 把 P-6 的成对 `human_response` 桥接成一条**回流建议**。
 * 参考 Runner 的「答案送回提问的 Agent」，但按本仓库红线收窄：
 * 只产出「下一步该由谁做什么」，不排队、不改任务状态、不等于验收、不自动执行。
 */
export type ResumeProposal = {
  id: string;
  questionId: string;
  responseId: string;
  taskId: string;
  runId: string;
  stepNo: number | null;
  actor: string;
  choice: string;
  /** 建议回到执行端的哪一段；只是指针，不是排程。 */
  target: 'execution-chain';
  nextHumanAction: string;
  autoExecute: false;
  requiresHumanApproval: true;
  notAcceptance: true;
  advisory: true;
  at: number;
  signature: string;
};

export function bridgeAnswerToResume(input: {
  question: { id: string; payload?: Record<string, unknown> };
  response: { id: string; actor: string; payload?: Record<string, unknown> };
  taskId?: string;
  at?: number;
}): ResumeProposal {
  const q = input.question.payload ?? {};
  const r = input.response.payload ?? {};
  const runId = String(q.run_id ?? input.taskId ?? '');
  const choice = String(r.choice ?? '');
  const actor = String(input.response.actor ?? r.actor ?? '');
  if (!input.question.id || !input.response.id) throw new Error('回流建议必须挂靠真实的问题与回答编号');
  if (!runId) throw new Error('回流建议缺少任务 / run 编号，无法指回执行链');
  if (!actor) throw new Error('回流建议必须登记真人身份，执行进程不得冒充');
  if (r.acceptance === true || /确认验收|accepted|approved/i.test(choice)) {
    throw new Error('人工回答不得冒充原发起人的确认验收');
  }
  const at = input.at ?? 0;
  const core = {
    id: 'resume:' + sha([input.question.id, input.response.id, choice, actor]),
    questionId: input.question.id,
    responseId: input.response.id,
    taskId: runId,
    runId,
    stepNo: typeof q.step_no === 'number' ? q.step_no : null,
    actor,
    choice,
    target: 'execution-chain' as const,
    nextHumanAction: '由原发起人在原会话用中文接续或确认；续跑建议不自动排后续步骤',
    autoExecute: false as const,
    requiresHumanApproval: true as const,
    notAcceptance: true as const,
    advisory: true as const,
    at,
  };
  return { ...core, signature: sha(core) };
}

export function assertResumeProposal(proposal: ResumeProposal): ResumeProposal {
  if (proposal.autoExecute !== false || proposal.requiresHumanApproval !== true
    || proposal.notAcceptance !== true || proposal.advisory !== true
    || proposal.target !== 'execution-chain') {
    throw new Error('回流建议不得变成自动执行、自动放行或验收');
  }
  if (!/原会话|接续|确认/.test(proposal.nextHumanAction)) {
    throw new Error('回流建议必须明确「原发起人在原会话决定下一步」');
  }
  return proposal;
}

/**
 * 飞书入站「补充说明 / 回答」→ 结构化回答候选（纯函数，不写台账、不发消息）。
 * 主链路的 `collaboration-intake.ts` 本来就在消费这条 IM 流；这里只补上
 * 「把人的回答映射回上行提问」的协议层，让两条方向能对得上。
 */
export type InboundAnswer = {
  accepted: boolean;
  questionId: string | null;
  choice: string | null;
  text: string;
  acceptance: false;
  reason?: string;
};

export function mapFollowupToAnswer(text: string, actor = ''): InboundAnswer {
  const raw = String(text ?? '').trim();
  const empty: InboundAnswer = { accepted: false, questionId: null, choice: null,
    text: raw, acceptance: false };
  if (!raw) return { ...empty, reason: '空消息' };
  if (!actor) return { ...empty, reason: '未登记真人身份：执行进程不得冒充人回答' };
  // 「确认验收 任务编号」是核可，不是回答，必须走 confirmAcceptance，不能混进回路。
  // 注意不能用 \b：JS 的词边界只认 ASCII 词字符，跟在中文字符后面永远不成立，
  // 裸的「确认验收」会漏网。这里显式覆盖「整句就是核可」与「以核可短语开头」两种。
  if (/^确认验收(?:\s|$)|确认验收\s+\S/.test(raw)) {
    return { ...empty, reason: '这是最终核可，不是对提问的回答；须走原会话确认验收' };
  }
  const explicit = /^(?:回答|回复)\s+(\S+)\s+([\s\S]+)$/.exec(raw);
  if (explicit) {
    return { accepted: true, questionId: explicit[1]!, choice: explicit[2]!.trim(),
      text: raw, acceptance: false };
  }
  if (raw.startsWith('/')) return { ...empty, reason: '斜杠指令不是对提问的回答' };
  return { accepted: true, questionId: null, choice: raw, text: raw, acceptance: false };
}

/**
 * 上游协议耦合点①：Autoloop 回执 → 上行事件。
 *
 * 协议语义来自已入库上游 `upstream/autoloop/docs/protocol.md`（固定提交见
 * sources.lock.json）：`ask` 是向人提问的卡片、`notice` 是告知、`later` 是延后复查、
 * `resolve` 与 `events` 本项目明确拒绝（见 controller.receipt 的校验），
 * outcome 决定本轮是否结束。这里把它们归一成回路判据能识别的上行事件，
 * 让「执行端 → 人」这一半在真实回执入口落地，而不是只在体检脚本里造数据。
 *
 * 特别注意：本仓库口径比上游严——`done` / `executed` 仍只是回执，
 * 必须再有一条人侧 `review` / `accept` / `reject` 才闭合回路。
 */
export type AutoloopResultLike = {
  outcome?: string;
  ask?: readonly { title?: string; text?: string; options?: readonly string[]; key?: string }[];
  notice?: readonly unknown[];
  resolve?: readonly unknown[];
  later?: readonly unknown[];
  events?: readonly unknown[];
  error?: string;
};

export function fromAutoloopReceipt(input: {
  result: AutoloopResultLike;
  receiptId: string;
  taskId: string;
  agent: string;
  at: number;
}): LoopEvent[] {
  const { result, receiptId, taskId, agent, at } = input;
  const base = { taskId, actor: agent, at };
  const events: LoopEvent[] = [{
    ...base, id: `receipt:${receiptId}`, direction: 'upstream', kind: 'receipt',
    expectsHumanAction: 'review',
    payload: { outcome: result.outcome ?? 'unknown', source: 'upstream/autoloop' },
  }];
  for (const [index, ask] of (result.ask ?? []).entries()) {
    events.push({
      ...base, id: `ask:${receiptId}:${index}`, direction: 'upstream', kind: 'question',
      inReplyTo: `receipt:${receiptId}`, expectsHumanAction: 'answer',
      payload: { title: ask.title ?? '', key: ask.key ?? null,
        options: [...(ask.options ?? [])], source: 'upstream/autoloop' },
    });
  }
  for (const [index] of (result.notice ?? []).entries()) {
    events.push({ ...base, id: `notice:${receiptId}:${index}`,
      direction: 'upstream', kind: 'progress', payload: { source: 'upstream/autoloop' } });
  }
  for (const [index] of (result.later ?? []).entries()) {
    events.push({ ...base, id: `later:${receiptId}:${index}`,
      direction: 'upstream', kind: 'progress', payload: { deferred: true, source: 'upstream/autoloop' } });
  }
  if (result.outcome === 'failed') {
    events.push({ ...base, id: `blocked:${receiptId}`, direction: 'upstream', kind: 'blocked',
      inReplyTo: `receipt:${receiptId}`, expectsHumanAction: 'answer',
      payload: { error: result.error ?? '', source: 'upstream/autoloop' } });
  }
  return events;
}

/** 上游协议耦合点②：Runner 成对 HITL 台账 → 回路事件。 */
export type HitlEventLike = {
  id: string; type: string; at: string | number; from?: string; to?: string;
  payload?: Record<string, unknown>;
};

/**
 * 时间归一化：真实台账里 `at` 是 ISO 字符串，而回路事件的 `at` 是 epoch 毫秒。
 * 两种类型混在同一份事件流里时，`a.at - b.at` 会得到 NaN、排序与因果比较全部失效
 * （这是第二十八轮修掉的真实缺陷）。这里统一折叠成 number；无法解析的时间按 0
 * 处理，保证确定性而不是抛 NaN。
 */
export function toLoopAt(at: string | number): number {
  if (typeof at === 'number' && Number.isFinite(at)) return at;
  const parsed = Date.parse(String(at));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function fromHitlLedger(input: {
  events: readonly HitlEventLike[];
  defaultTaskId?: string;
}): LoopEvent[] {
  // 真实台账里 `human_response` 的 payload 只有 question_id / choice / actor，
  // 不带 run_id（P-6 的成对设计）。任务归属必须从它配对的 `human_question`
  // 继承，否则回答会被误判成孤儿、下行方向凭空消失。
  const questionTasks = new Map<string, string>();
  for (const event of input.events) {
    if (event?.type !== 'human_question' || !event.id) continue;
    const taskId = String(event.payload?.run_id ?? input.defaultTaskId ?? '');
    if (taskId) questionTasks.set(event.id, taskId);
  }
  const out: LoopEvent[] = [];
  for (const event of input.events) {
    if (!event || !event.id) continue;
    if (event.type === 'human_question') {
      const taskId = questionTasks.get(event.id) ?? '';
      if (!taskId) continue; // 没有任务归属的事件不进回路，避免伪造因果边
      out.push({ id: event.id, direction: 'upstream', kind: 'question', taskId,
        at: toLoopAt(event.at), actor: String(event.payload?.asker ?? event.from ?? 'step-runner'),
        expectsHumanAction: 'answer', inReplyTo: null,
        payload: { stepNo: event.payload?.step_no ?? null, source: 'protocolReferences/runner' } });
      continue;
    }
    if (event.type === 'human_response') {
      const questionId = String(event.payload?.question_id ?? '');
      const taskId = String(event.payload?.run_id ?? questionTasks.get(questionId) ?? input.defaultTaskId ?? '');
      if (!questionId || !taskId) continue;
      out.push({ id: event.id, direction: 'downstream', kind: 'answer', taskId,
        at: toLoopAt(event.at), actor: String(event.payload?.actor ?? event.from ?? 'human'),
        inReplyTo: questionId,
        payload: { choice: event.payload?.choice ?? null, source: 'protocolReferences/runner' } });
    }
  }
  return out;
}

/**
 * 回路事件按 id 去重：同一条 IM 消息可能同时被 `controller.reply()` 与
 * `collaboration-intake.ingest()` 留痕（或审计行重复），不去重会让 loop-guard
 * 双计下行、破坏「一条应答只关一个回合」的判据。保留时间最早的一条，
 * 其余计入 duplicates——如实报数，不静默吞掉。
 */
export function dedupeLoopEvents(events: readonly LoopEvent[]): {
  events: LoopEvent[]; duplicates: number; duplicateIds: string[];
} {
  const seen = new Set<string>();
  const kept: LoopEvent[] = [];
  const duplicateIds = new Set<string>();
  for (const event of [...events].sort((a, b) =>
    toLoopAt(a.at) - toLoopAt(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (seen.has(event.id)) { duplicateIds.add(event.id); continue; }
    seen.add(event.id);
    kept.push(event);
  }
  return { events: kept, duplicates: events.length - kept.length, duplicateIds: [...duplicateIds].sort() };
}

/**
 * 真实 IM 场景里人通常直接回一句「继续 / 用方案二」，不会带问题编号。
 * 这里按「同一任务、时间在前、最近的未关闭上行提问」做时间就近配对，
 * 把隐含的因果边补上；已有显式 inReplyTo 的事件原样保留。纯函数、确定性。
 */
export function attachImplicitReplies(events: readonly LoopEvent[]): LoopEvent[] {
  const ordered = [...events].sort((a, b) =>
    toLoopAt(a.at) - toLoopAt(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const openQuestions = new Map<string, LoopEvent>();
  const result: LoopEvent[] = [];
  const replyKinds: readonly string[] = ['answer', 'supplement', 'resume-approved', 'review', 'accept', 'reject'];
  for (const event of ordered) {
    if (event.direction === 'upstream'
      && ['question', 'escalation', 'blocked', 'receipt', 'result'].includes(event.kind)) {
      openQuestions.set(event.taskId, event);
      result.push(event);
      continue;
    }
    if (event.direction === 'downstream' && replyKinds.includes(event.kind) && !event.inReplyTo) {
      const candidate = openQuestions.get(event.taskId);
      if (candidate) {
        const patched = { ...event, inReplyTo: candidate.id };
        openQuestions.delete(event.taskId);
        result.push(patched);
        continue;
      }
    }
    result.push(event);
  }
  return result;
}

/** 归一化体检结果的确定性排序：所有集合都按字节序，避免跨机器 ICU 漂移。 */
export function loopSignature(report: LoopReport): string {
  return sha({
    total: report.total, downstream: report.downstream, upstream: report.upstream,
    bidirectional: report.bidirectional, closedCycles: report.closedCycles,
    openLoops: [...report.openLoops].sort((a, b) =>
      a.upstreamId < b.upstreamId ? -1 : a.upstreamId > b.upstreamId ? 1 : 0),
    staleAnswers: [...report.staleAnswers].sort(),
    receiptWithoutReview: [...report.receiptWithoutReview].sort(),
    oneWayTasks: [...report.oneWayTasks].sort(),
    orphanEvents: [...report.orphanEvents].sort(),
    violations: [...report.violations].sort((a, b) => a.target < b.target ? -1 : 1),
    findings: [...report.findings].sort((a, b) => a.target < b.target ? -1 : 1),
  });
}
