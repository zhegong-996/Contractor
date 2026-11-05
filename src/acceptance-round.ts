// Independent, per-item judgement. A round produces evidence FOR the human
// originator; it never replaces the originator's final /accept (red lines R3/R4).
import { verifyPlan, planHash, readPlan, type AcceptancePlan, type PlanDocumentStore } from './acceptance-plan.ts';
import { eventId, parseTrace, assertTraceReady, type CollabEvent, type EvidenceKind } from './event-stream.ts';

export type JudgementStatus = 'passed' | 'failed' | 'blocked';

export interface ItemEvidence {
  refs: string[];
  evidenceKind: EvidenceKind;
  sourceRefs?: { id: string; revision: string }[];
  note?: string;
}

export interface Judgement {
  itemId: string;
  name: string;
  status: JudgementStatus;
  evidenceRefs: string[];
  reason: string;
}

export interface AcceptanceRound {
  schemaVersion: 1;
  taskId: string;
  round: number;
  planHash: string;
  planRevision: string;
  reviewer: { model: string; producerModel: string; requiresVision: boolean };
  judgements: Judgement[];
  overall: 'passed' | 'partial' | 'blocked';
  createdAt: string;
}

export function evaluateRound(input: {
  plan: AcceptancePlan;
  reviewerModel: string;
  producerModel: string;
  requiresVision?: boolean;
  evidence: Record<string, ItemEvidence>;
  events?: CollabEvent[];
  round?: number;
  planRevision?: string;
}): AcceptanceRound {
  if (!input.reviewerModel) throw new Error('缺少独立评审者');
  if (input.reviewerModel === input.producerModel) throw new Error('评审者不得与产出模型相同');
  if (input.requiresVision === false) throw new Error('评审者必须支持视觉输入');
  if (planHash(input.plan) !== input.plan.hash) throw new Error('验收清单已被修改');
  const replayable = input.events ? new Set(input.events.map(eventId)) : null;
  const judgements: Judgement[] = input.plan.items.map(item => {
    const evidence = input.evidence[item.id];
    const base = { itemId: item.id, name: item.name };
    if (!evidence?.refs?.length) {
      return { ...base, status: 'blocked', evidenceRefs: [], reason: '缺少证据引用' };
    }
    if (evidence.evidenceKind !== item.evidenceKind) {
      return { ...base, status: 'failed', evidenceRefs: evidence.refs, reason: `证据类型不符：要求 ${item.evidenceKind}，实际 ${evidence.evidenceKind}` };
    }
    if (!evidence.sourceRefs?.length || evidence.sourceRefs.some(ref => !ref.id || !ref.revision)) {
      return { ...base, status: 'failed', evidenceRefs: evidence.refs, reason: '证据缺少来源与版本' };
    }
    if (replayable && evidence.refs.some(ref => !replayable.has(ref))) {
      return { ...base, status: 'failed', evidenceRefs: evidence.refs, reason: '证据无法在事件流中回放' };
    }
    return { ...base, status: 'passed', evidenceRefs: evidence.refs, reason: '' };
  });
  const overall: AcceptanceRound['overall'] = judgements.every(item => item.status === 'passed') ? 'passed'
    : judgements.some(item => item.status === 'failed') ? 'partial' : 'blocked';
  return {
    schemaVersion: 1,
    taskId: input.plan.taskId,
    round: input.round ?? 1,
    planHash: input.plan.hash,
    planRevision: input.planRevision ?? '',
    reviewer: { model: input.reviewerModel, producerModel: input.producerModel, requiresVision: true },
    judgements,
    overall,
    createdAt: new Date().toISOString(),
  };
}

/** Only a fully passed round may generate the cases handed to the human /accept. */
export function toAcceptanceCases(round: AcceptanceRound, plan: AcceptancePlan): { name: string; passed: boolean }[] {
  if (round.planHash !== plan.hash) throw new Error('验收清单已变更，本轮评审作废');
  if (round.overall !== 'passed') throw new Error('存在未通过或未受阻项，不能生成通过用例');
  if (round.judgements.length !== plan.items.length || round.judgements.some(item => item.status !== 'passed')) {
    throw new Error('逐项判定不完整');
  }
  return plan.items.map(item => ({ name: item.name, passed: true }));
}

/** A rejection retreats only the failed items; the task stays open. */
export function partialReject(round: AcceptanceRound): { recheckItems: string[]; keepItems: string[]; closeTask: false } {
  return {
    recheckItems: round.judgements.filter(item => item.status !== 'passed').map(item => item.itemId),
    keepItems: round.judgements.filter(item => item.status === 'passed').map(item => item.itemId),
    closeTask: false,
  };
}

/** Rejection reasons become the producer's self-check list for the next round. */
export function selfCheckStandards(round: AcceptanceRound): string[] {
  return [...new Set(round.judgements.filter(item => item.status !== 'passed' && item.reason)
    .map(item => `${item.name}：${item.reason}`))];
}

export function encodeRound(round: AcceptanceRound): string {
  return `# 逐项评审报告（第 ${round.round} 轮）\n\n结论：${round.overall}\n评审者：${round.reviewer.model}\n\n` +
    `本报告只提供证据与逐项判定，不替代发起人的最终核可。\n\n\`\`\`json\n${JSON.stringify(round, null, 2)}\n\`\`\``;
}

export function decodeRound(body: string): AcceptanceRound | null {
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(String(body ?? ''));
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!);
    return parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.judgements) ? parsed as AcceptanceRound : null;
  } catch { return null; }
}

export async function writeRound(pc: PlanDocumentStore, round: AcceptanceRound): Promise<void> {
  await pc.document(round.taskId, 'acceptance-round', '逐项评审报告', encodeRound(round));
}

export async function readRound(pc: PlanDocumentStore, taskId: string): Promise<AcceptanceRound | null> {
  let doc: any;
  try { doc = await pc.get(`/issues/${taskId}/documents/acceptance-round`); }
  catch (error) { if (String(error).includes(': 404 ')) return null; throw error; }
  return decodeRound(String(doc?.body ?? ''));
}

export interface GateResult {
  status: 'verified' | 'waived';
  reason?: string;
  plan?: AcceptancePlan;
  round?: AcceptanceRound;
  gaps: string[];
}

/**
 * Pre-/accept gate. Tasks without a sealed Acceptance Plan keep the original
 * originator-only flow (waived) so previously verified journeys never regress.
 * A present but invalid / modified plan is always rejected, never waived.
 */
export async function verifyAcceptanceGate(input: {
  pc: PlanDocumentStore;
  taskId: string;
  cases: { name: string; passed: boolean }[];
}): Promise<GateResult> {
  let sealed: { plan: AcceptancePlan; revision: string } | null = null;
  try { sealed = await readPlan(input.pc, input.taskId); }
  catch { sealed = null; }
  if (!sealed) {
    return { status: 'waived', reason: '该任务没有开工前锁定的验收清单，沿用原有发起人核可', gaps: [] };
  }
  const { plan, revision } = sealed;
  verifyPlan(plan);

  let round: AcceptanceRound | null = null;
  try { round = await readRound(input.pc, input.taskId); } catch { round = null; }
  if (!round) throw new Error('尚未完成独立逐项评审，不能验收');
  if (round.planHash !== plan.hash) throw new Error('验收清单已变更，本轮评审作废');
  if (revision && round.planRevision && round.planRevision !== revision) throw new Error('验收清单文档被改写，本轮评审作废');
  if (round.reviewer.model === round.reviewer.producerModel) throw new Error('评审者不得与产出模型相同');
  if (!round.reviewer.requiresVision) throw new Error('评审者必须支持视觉输入');

  const expected = toAcceptanceCases(round, plan);
  const expectedNames = expected.map(item => item.name).sort();
  const givenNames = input.cases.map(item => item.name).sort();
  if (givenNames.length !== expectedNames.length || givenNames.some((name, index) => name !== expectedNames[index])
    || input.cases.some(item => item.passed !== true)) {
    throw new Error('提交用例与逐项评审报告不一致');
  }

  let events: CollabEvent[] = [];
  try {
    const doc: any = await input.pc.get(`/issues/${input.taskId}/documents/trace`);
    events = parseTrace(String(doc?.body ?? ''));
  } catch { events = []; }
  const { gaps } = assertTraceReady(events, plan.level);
  return { status: 'verified', plan, round, gaps };
}
