// v0.6 FR-18 / FR-25 — independent, vision-capable reviewer adapter.
//
// The product rule is "the reviewer must not be the producer model and must
// accept visual input (screenshots / recordings)". This module makes that
// rule satisfiable WITHOUT a model service:
//
// * `structural` (default when the chain is on): a deterministic reviewer that
//   DOES ingest visual artifacts and verifies their hash, source binding,
//   evidence kind and replayability in the unified trace. It honestly declares
//   `semanticJudgement: false`: it cannot say whether a screenshot *looks*
//   right. No model call, fully testable with fixtures.
// * `model`: an OpenAI-compatible LOCAL endpoint adapter. Off by default and
//   optional; configure acceptance.visualReviewer to plug in a real vision
//   model later. Only localhost endpoints are allowed so real business
//   material is never sent to an unapproved external service.
//
// Both produce the same per-item verdict shape and both flow into
// acceptance-round.evaluateRound. A reviewer NEVER approves a task (R3/R4).
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.ts';
import { eventId, type CollabEvent } from './event-stream.ts';
import type { AcceptancePlan } from './acceptance-plan.ts';
import { TraceEvidenceReviewer, type IndependentReviewer, type ReviewInput, type ReviewResult, type ReviewerCapabilities } from './independent-review.ts';
import type { ItemEvidence } from './acceptance-round.ts';

export const visualArtifactSchema = z.object({
  /** Must be an id of a captured/imported event in the unified trace. */
  eventId: z.string().min(1),
  kind: z.enum(['screenshot', 'recording', 'log']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  mimeType: z.string().optional(),
  /** Only used for hash verification; never persisted by this module. */
  bytesBase64: z.string().optional(),
  itemId: z.string().optional(),
}).strict();
export type VisualArtifact = z.infer<typeof visualArtifactSchema>;

export const visualVerdictSchema = z.object({
  itemId: z.string().min(1), status: z.enum(['passed', 'failed', 'blocked']),
  reason: z.string(), refs: z.array(z.string()).default([]),
}).strict();
export type VisualVerdict = z.infer<typeof visualVerdictSchema>;

export interface VisualReviewRequest {
  plan: AcceptancePlan;
  producerModel: string;
  events: CollabEvent[];
  artifacts: VisualArtifact[];
}
export interface VisualReviewOutput { verdicts: VisualVerdict[]; limitations: string[] }

export interface VisualReviewAdapter {
  readonly id: string;
  readonly semanticJudgement: boolean;
  review(request: VisualReviewRequest): Promise<VisualReviewOutput>;
}

export interface ExtendedReviewInput extends ReviewInput {
  visualArtifacts?: VisualArtifact[];
}

/** Deterministic visual-evidence reviewer. No model, no semantic judgement. */
export class StructuralVisionAdapter implements VisualReviewAdapter {
  readonly id = 'structural-vision-evidence';
  readonly semanticJudgement = false;
  async review(request: VisualReviewRequest): Promise<VisualReviewOutput> {
    const traceIds = new Map(request.events.map(e => [eventId(e), e]));
    const limitations = [
      '结构式视觉评审：核对截图/录屏的来源、哈希、证据类型与事件可回放性，不判断图像内容是否符合标准',
      '未启用视觉模型；需要语义判定请配置 acceptance.visualReviewer.mode=model 并接入本地视觉模型',
    ];
    let fallbackUsed = false;
    const verdicts: VisualVerdict[] = request.plan.items.map(item => {
      const bound = request.artifacts.filter(a => (a.itemId ?? '') === item.id && a.kind !== 'log');
      // No screenshot/record was supplied for this item. The reviewer does NOT
      // pretend to have judged an image: it degrades explicitly to captured /
      // imported trace evidence and records that limitation in the round.
      if (!bound.length) {
        const traceRefs = request.events.filter(e => e.provenance && e.evidenceKind !== 'authored'
          && ['ci', 'tool', 'receipt'].includes(e.kind)).map(e => eventId(e));
        if (!traceRefs.length) return { itemId: item.id, status: 'blocked' as const,
          reason: '缺少可回放的截图/录屏证据，事件流中也没有捕获/导入证据', refs: [] };
        fallbackUsed = true;
        return { itemId: item.id, status: 'passed' as const,
          reason: '本轮未提供截图/录屏，仅依据事件流中的捕获/导入证据判定，未做视觉内容核验', refs: traceRefs };
      }
      const problems: string[] = [];
      const refs: string[] = [];
      for (const artifact of bound) {
        const event = traceIds.get(artifact.eventId);
        if (!event) { problems.push('视觉证据未绑定到统一事件流水'); continue; }
        if (event.evidenceKind === 'authored') { problems.push('自撰材料不能作为验收证据'); continue; }
        if (artifact.kind === 'screenshot' && !/^image\//.test(artifact.mimeType ?? '')) problems.push('截图缺少 image 类型标记');
        if (artifact.sha256 && artifact.bytesBase64) {
          const digest = createHash('sha256').update(Buffer.from(artifact.bytesBase64, 'base64')).digest('hex');
          if (digest !== artifact.sha256) problems.push('视觉证据哈希不匹配');
        }
        refs.push(artifact.eventId);
      }
      if (problems.length) return { itemId: item.id, status: 'failed' as const, reason: [...new Set(problems)].join('；'), refs };
      if (!refs.length) return { itemId: item.id, status: 'blocked' as const, reason: '视觉证据无法在事件流中回放', refs: [] };
      return { itemId: item.id, status: 'passed' as const, reason: '', refs };
    });
    if (fallbackUsed) limitations.push('本轮部分检查项没有截图/录屏，只依据统一事件流中的捕获/导入证据判定；视觉内容未核验');
    return { verdicts, limitations };
  }
}

/** Optional real vision model. Endpoint must be local; key comes from env only. */
export class LocalModelVisionAdapter implements VisualReviewAdapter {
  readonly id: string;
  readonly semanticJudgement = true;
  constructor(private readonly endpoint: string, private readonly model: string, private readonly timeoutMs: number, reviewerId?: string) {
    const url = new URL(endpoint);
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname))
      throw new Error('视觉评审端点只能是本机地址；真实业务材料不得发送到未批准的外部服务');
    this.id = reviewerId ?? `local-vision:${model}`;
  }
  async review(request: VisualReviewRequest): Promise<VisualReviewOutput> {
    const apiKey = process.env.SUITME_VISION_API_KEY ?? '';
    const content: unknown[] = [{ type: 'text', text: JSON.stringify({
      instruction: '按开工前锁定的逐项标准，独立判定每项是否通过；只能依据所提供的截图/录屏与事件证据，不得臆测。',
      producerModel: request.producerModel,
      items: request.plan.items,
      events: request.events.map(e => ({ id: eventId(e), kind: e.kind, evidenceKind: e.evidenceKind, outcome: e.outcome })),
      artifacts: request.artifacts.map(({ bytesBase64, ...rest }) => ({ ...rest })),
      outputSchema: '{"verdicts":[{"itemId":"","status":"passed|failed|blocked","reason":"","refs":[]}],"limitations":[]}',
    }) }];
    for (const artifact of request.artifacts) if (artifact.bytesBase64 && artifact.kind === 'screenshot')
      content.push({ type: 'image_url', image_url: { url: `data:${artifact.mimeType ?? 'image/png'};base64,${artifact.bytesBase64}` } });
    const response = await fetch(this.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content }], temperature: 0 }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`视觉评审模型返回 ${response.status}`);
    const payload: any = await response.json();
    const text = String(payload?.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?|```$/g, '').trim();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error('视觉评审模型输出不是合法 JSON'); }
    const result = z.object({ verdicts: z.array(visualVerdictSchema), limitations: z.array(z.string()).default([]) }).parse(parsed);
    // A model may not judge items that were not in the sealed plan.
    const allowed = new Set(request.plan.items.map(i => i.id));
    if (result.verdicts.some(v => !allowed.has(v.itemId))) throw new Error('视觉评审返回了验收清单之外的检查项');
    return { verdicts: result.verdicts, limitations: result.limitations };
  }
}

export function visualAdapterFor(config: Config): VisualReviewAdapter {
  const spec = config.acceptance?.visualReviewer;
  if (spec?.mode === 'model') {
    if (!spec.endpoint) throw new Error('视觉评审模型模式需要 acceptance.visualReviewer.endpoint（本机地址）');
    return new LocalModelVisionAdapter(spec.endpoint, spec.model, spec.timeoutMs, reviewerIdFor(config));
  }
  return new StructuralVisionAdapter();
}

/** The identity recorded in the sealed plan and in every review round. */
export function reviewerIdFor(config: Config): string {
  const spec = config.acceptance?.visualReviewer;
  return spec?.mode === 'model' ? `local-vision:${spec.model}` : (spec?.model ?? 'structural-vision-reviewer');
}

export function acceptanceChainEnabled(config: Config): boolean {
  return config.acceptance?.mode === 'independent' || config.acceptance?.sealPlanOnCreate === true;
}

/**
 * Registered reviewer for V06Services. In legacy mode the original
 * TraceEvidenceReviewer stays in place, so previously verified journeys are
 * untouched; turning the chain on swaps in a vision-capable independent one.
 */
export function createIndependentReviewer(config: Config): IndependentReviewer {
  if (!acceptanceChainEnabled(config)) return new TraceEvidenceReviewer();
  return new VisionReviewer(config, visualAdapterFor(config));
}

export class VisionReviewer implements IndependentReviewer {
  readonly id: string;
  readonly capabilities: ReviewerCapabilities;
  constructor(readonly config: Config, readonly adapter: VisualReviewAdapter) {
    this.id = reviewerIdFor(config);
    this.capabilities = { vision: true, independent: true,
      externalModelEnabled: config.acceptance?.visualReviewer?.mode === 'model',
      semanticJudgement: adapter.semanticJudgement, inputModes: ['screenshot', 'recording', 'log'] };
  }
  async review(input: ReviewInput): Promise<ReviewResult> {
    const extended = input as ExtendedReviewInput;
    const artifacts = z.array(visualArtifactSchema).max(60).parse(extended.visualArtifacts ?? []);
    const base = await new TraceEvidenceReviewer().review(input);
    const outcome = await this.adapter.review({ plan: input.plan, producerModel: input.producerModel,
      events: input.events, artifacts });
    const evidence: Record<string, ItemEvidence> = { ...base.evidence };
    for (const verdict of outcome.verdicts) {
      const current = evidence[verdict.itemId] ?? { refs: [], evidenceKind: input.plan.items.find(i => i.id === verdict.itemId)!.evidenceKind };
      // A failed / blocked visual verdict must not ride on trace-only refs:
      // evaluateRound has to see a genuine evidence gap for this item.
      const refs = verdict.status === 'passed' ? [...new Set([...current.refs, ...verdict.refs])] : [];
      evidence[verdict.itemId] = { ...current, refs,
        note: [current.note, verdict.reason || undefined].filter(Boolean).join('；') || undefined };
    }
    // Every plan item must have a verdict; a missing one is blocked, never passed.
    for (const item of input.plan.items) if (!outcome.verdicts.some(v => v.itemId === item.id))
      evidence[item.id] = { ...(evidence[item.id] ?? { refs: [], evidenceKind: item.evidenceKind }),
        refs: [], note: '视觉评审模型未返回该检查项的判定' };
    const limitations = [
      ...(this.capabilities.semanticJudgement ? [] : ['当前为结构式视觉评审，未做图像内容语义判定']),
      ...outcome.limitations,
    ];
    return { reviewerId: this.id, capabilities: this.capabilities, evidence, limitations };
  }
}
