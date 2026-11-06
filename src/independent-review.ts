// v0.6 FR-18 / FR-25 — pluggable independent reviewer.
//
// Boundary (deliberately explicit): this repository does NOT enable an external
// model service. The adapter below assembles evidence and can be replaced by a
// vision-capable model later. It declares its capabilities honestly; the gate
// refuses to claim FR-18 is satisfied when visual judging is required but the
// registered reviewer has no vision capability.
//
// The reviewer's output is evidence FOR the human originator. It never
// approves anything (R3/R4) and never replaces /accept.
import type { AcceptancePlan } from './acceptance-plan.ts';
import type { ItemEvidence } from './acceptance-round.ts';
import { eventId, type CollabEvent, type EvidenceKind } from './event-stream.ts';

export interface ReviewerCapabilities {
  /** Can the reviewer actually inspect screenshots / recordings? */
  vision: boolean;
  /** Is this a different model/principal from the producer? */
  independent: boolean;
  /** External network model calls are disabled in this installation. */
  externalModelEnabled: boolean;
  /** Optional: can the reviewer judge the CONTENT of an image (vs. only
   *  verifying that a visual artifact exists and is trace-bound)? */
  semanticJudgement?: boolean;
  /** Optional: which visual input kinds the reviewer accepts. */
  inputModes?: ('screenshot' | 'recording' | 'log')[];
}

export interface ReviewInput {
  plan: AcceptancePlan;
  producerModel: string;
  events: CollabEvent[];
  /** Evidence supplied by the execution side, keyed by plan item id. */
  supplied?: Record<string, ItemEvidence>;
  visualEvidenceRequired?: boolean;
  /** Optional visual artifacts; the vision-capable reviewer validates them. */
  visualArtifacts?: unknown[];
}

export interface ReviewResult {
  reviewerId: string;
  capabilities: ReviewerCapabilities;
  evidence: Record<string, ItemEvidence>;
  /** Present only when the reviewer could not fully judge; never silently dropped. */
  limitations: string[];
}

export interface IndependentReviewer {
  readonly id: string;
  readonly capabilities: ReviewerCapabilities;
  review(input: ReviewInput): Promise<ReviewResult>;
}

/** Deterministic evidence binder. No model call, no vision, no judgement. */
export class TraceEvidenceReviewer implements IndependentReviewer {
  readonly id = 'trace-evidence-binder';
  readonly capabilities: ReviewerCapabilities = { vision: false, independent: true, externalModelEnabled: false,
    semanticJudgement: false, inputModes: [] };
  async review(input: ReviewInput): Promise<ReviewResult> {
    const traceIds = new Set(input.events.map(eventId));
    const evidence: Record<string, ItemEvidence> = {};
    const limitations: string[] = [
      '本评审者只做证据与来源绑定，不替代模型对截图/录屏的视觉判断',
      '外部模型服务未启用；FR-18 的视觉评审能力尚未接入',
    ];
    for (const item of input.plan.items) {
      const supplied = input.supplied?.[item.id];
      if (supplied) {
        const replayable = supplied.refs.every(ref => traceIds.has(ref));
        const kind: EvidenceKind = supplied.evidenceKind;
        evidence[item.id] = {
          refs: supplied.refs,
          evidenceKind: kind,
          sourceRefs: supplied.sourceRefs ?? input.events.filter(e => supplied.refs.includes(eventId(e)) && e.provenance)
            .map(e => ({ id: e.provenance, revision: e.checkpoint ?? 'current' })),
          note: replayable ? undefined : '部分证据无法在事件流中回放',
        };
        continue;
      }
      // Fall back to captured/imported trace events only. Authored output is
      // never accepted as evidence (FR-17).
      const candidates = input.events.filter(e => e.provenance && e.evidenceKind !== 'authored'
        && (e.kind === 'ci' || e.kind === 'tool' || e.kind === 'receipt'));
      evidence[item.id] = {
        refs: candidates.map(eventId),
        evidenceKind: item.evidenceKind,
        sourceRefs: candidates.map(e => ({ id: e.provenance, revision: e.checkpoint ?? 'current' })),
        note: candidates.length ? undefined : '事件流中未找到可绑定证据',
      };
    }
    return { reviewerId: this.id, capabilities: this.capabilities, evidence, limitations };
  }
}

/** FR-18 gate: refuse to claim an independent visual review that did not happen. */
export function assertReviewerCapable(reviewer: IndependentReviewer, input: {
  producerModel: string; visualEvidenceRequired: boolean;
}): void {
  if (!reviewer.capabilities.independent) throw new Error('评审者必须独立于产出模型');
  if (reviewer.id === input.producerModel) throw new Error('评审者不得与产出模型相同');
  if (input.visualEvidenceRequired && !reviewer.capabilities.vision)
    throw new Error('该验收等级要求视觉证据评审，但注册的评审者不支持视觉输入：不得宣称 FR-18 已完成');
}

/** Whether the FR-16~19 chain may be enabled at all. */
export function acceptanceChainReady(input: {
  traceReady: boolean; reviewer: IndependentReviewer | null; visualEvidenceRequired: boolean;
}): { ready: boolean; reasons: string[]; limitations: string[] } {
  const reasons: string[] = [];
  const limitations: string[] = [];
  if (!input.traceReady) reasons.push('统一事件流水字段不完整（FR-25）');
  if (!input.reviewer) reasons.push('未注册独立评审者（FR-18）');
  if (input.reviewer && input.visualEvidenceRequired && !input.reviewer.capabilities.vision)
    reasons.push('评审者不支持视觉输入，视觉证据无法判定');
  if (input.reviewer?.capabilities.vision && input.reviewer.capabilities.semanticJudgement === false)
    limitations.push('评审者可接收截图/录屏并核对绑定与来源，但未做图像内容语义判定；最终核可仍由人完成');
  return { ready: reasons.length === 0, reasons, limitations };
}
