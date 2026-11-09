// FR-18/FR-25: vision-capable independent reviewer + the complete
// FR-16~19 chain, exercised without any model service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { configSchema } from '../src/config.ts';
import { createPlan, encodePlan, lockPlan, type PlanDocumentStore } from '../src/acceptance-plan.ts';
import { evaluateRound, writeRound, verifyAcceptanceGate } from '../src/acceptance-round.ts';
import { capture, eventId, projectTrace, type CollabEvent } from '../src/event-stream.ts';
import { createIndependentReviewer, acceptanceChainEnabled, reviewerIdFor, StructuralVisionAdapter,
  VisionReviewer, type VisualArtifact } from '../src/visual-review.ts';
import { TraceEvidenceReviewer, acceptanceChainReady, assertReviewerCapable } from '../src/independent-review.ts';
import { Controller } from '../src/controller.ts';
import { readRound } from '../src/acceptance-round.ts';

const base = { paperclipUrl: 'http://127.0.0.1:4180', repository: 'a/b', checkout: '/tmp/a',
  allowedPaths: ['/tmp/a'], defaultAgent: 'codex', agents: {}, feishu: { profile: 'local' } };
const legacy = configSchema.parse({ ...base });
const independent = configSchema.parse({ ...base, acceptance: { mode: 'independent', level: 'L3',
  visualReviewer: { mode: 'structural', model: 'structural-vision-reviewer' } } });
const at = '2026-11-06T08:00:00.000Z';
const taskId = 'SUI-1000';

function pcStore(): PlanDocumentStore & { docs: Record<string, any> } {
  const docs: Record<string, any> = {};
  return { docs,
    get: async (route: string) => { const doc = docs[route]; if (!doc) throw new Error(`GET ${route}: 404 not found`); return doc; },
    document: async (issueId: string, key: string, _title: string, body: string) => {
      docs[`/issues/${issueId}/documents/${key}`] = { body, latestRevisionId: `rev-${key}-1` }; return {};
    } };
}
const event: CollabEvent = capture({ taskId, at, kind: 'tool', actor: 'screenshot-capture',
  provenance: 'ci-screenshot', evidenceKind: 'captured', sourceRef: { id: 'sha-1', revision: 'rev-1' }, refs: [] }).event!;
const bytes = Buffer.from('png-fixture').toString('base64');
const artifact = (itemId: string, extra: Partial<VisualArtifact> = {}): VisualArtifact => ({
  eventId: eventId(event), kind: 'screenshot', mimeType: 'image/png', itemId,
  sha256: createHash('sha256').update(Buffer.from(bytes, 'base64')).digest('hex'), bytesBase64: bytes, ...extra,
});

test('legacy 模式保持原评审者；independent 模式换成视觉可用且独立的评审者', () => {
  assert.equal(acceptanceChainEnabled(legacy), false);
  assert.ok(createIndependentReviewer(legacy) instanceof TraceEvidenceReviewer);
  assert.equal(acceptanceChainEnabled(independent), true);
  const reviewer = createIndependentReviewer(independent);
  assert.ok(reviewer instanceof VisionReviewer);
  assert.equal(reviewer.capabilities.vision, true);
  assert.equal(reviewer.capabilities.independent, true);
  assert.equal(reviewer.capabilities.semanticJudgement, false);
  assert.equal(reviewer.id, reviewerIdFor(independent));
  assert.doesNotThrow(() => assertReviewerCapable(reviewer, { producerModel: 'producer-gpt', visualEvidenceRequired: true }));
  assert.throws(() => assertReviewerCapable(new TraceEvidenceReviewer(), { producerModel: 'x', visualEvidenceRequired: true }), /不支持视觉输入/);
  const ready = acceptanceChainReady({ traceReady: true, reviewer, visualEvidenceRequired: true });
  assert.equal(ready.ready, true);
  assert.ok(ready.limitations.some(l => /未做图像内容语义判定/.test(l)));
});

test('结构式视觉评审：绑定截图可过，缺证据受阻，自撰材料判失败，哈希不符判失败', async () => {
  const reviewer = createIndependentReviewer(independent);
  const plan = createPlan({ taskId, names: ['报价版本正确'], lockedBy: 'pd-owner', lockedAt: at,
    producerModel: 'producer-gpt', reviewerModel: reviewer.id });
  const passed = await reviewer.review({ plan, producerModel: 'producer-gpt', events: [event],
    visualArtifacts: [artifact('item-1')], visualEvidenceRequired: true });
  assert.deepEqual(passed.evidence['item-1']?.refs, [eventId(event)]);
  assert.ok(passed.limitations.some(l => /结构式/.test(l)));

  const blocked = await reviewer.review({ plan, producerModel: 'producer-gpt', events: [], visualArtifacts: [] });
  assert.ok(blocked.evidence['item-1']?.note?.includes('缺少可回放的截图'));
  assert.deepEqual(blocked.evidence['item-1']?.refs, []);
  // Without visual artifacts but with real captured trace evidence, the
  // reviewer degrades explicitly instead of claiming an image was judged.
  const degraded = await reviewer.review({ plan, producerModel: 'producer-gpt', events: [event], visualArtifacts: [] });
  assert.deepEqual(degraded.evidence['item-1']?.refs, [eventId(event)]);
  assert.ok(degraded.limitations.some(l => /视觉内容未核验/.test(l)));

  const authored: CollabEvent = { ...event, evidenceKind: 'authored' };
  const failed = await reviewer.review({ plan, producerModel: 'producer-gpt', events: [authored],
    visualArtifacts: [artifact('item-1', { eventId: eventId(authored) })] });
  assert.ok(failed.evidence['item-1']?.note?.includes('自撰材料'));
  const tampered = await reviewer.review({ plan, producerModel: 'producer-gpt', events: [event],
    visualArtifacts: [artifact('item-1', { sha256: 'a'.repeat(64) })] });
  assert.ok(tampered.evidence['item-1']?.note?.includes('哈希不匹配'));
});

test('完整新验收流程：锁定清单 → 独立视觉评审 → 逐项报告 → 核可闸门（人仍是最终签字）', async () => {
  const pc = pcStore();
  const reviewer = createIndependentReviewer(independent);
  const plan = createPlan({ taskId, names: ['报价版本正确'], lockedBy: 'pd-owner', lockedAt: at,
    producerModel: 'producer-gpt', reviewerModel: reviewer.id });
  await lockPlan(pc, plan);
  await pc.document(taskId, 'trace', '统一过程流水', projectTrace([event]));
  await assert.rejects(() => verifyAcceptanceGate({ pc, taskId, cases: [{ name: '报价版本正确', passed: true }] }), /尚未完成独立逐项评审/);

  const result = await reviewer.review({ plan, producerModel: plan.producerModel!, events: [event],
    visualArtifacts: [artifact('item-1')], visualEvidenceRequired: true });
  const report = evaluateRound({ plan, reviewerModel: reviewer.id, producerModel: plan.producerModel!,
    evidence: result.evidence, events: [event], planRevision: 'rev-acceptance-plan-1' });
  assert.equal(report.overall, 'passed');
  await writeRound(pc, report);
  const gate = await verifyAcceptanceGate({ pc, taskId, cases: [{ name: '报价版本正确', passed: true }] });
  assert.equal(gate.status, 'verified');
  assert.equal(gate.round?.reviewer.model, reviewer.id);
  assert.equal(gate.round?.reviewer.producerModel, 'producer-gpt');
  assert.equal(gate.round?.reviewer.requiresVision, true);
  assert.ok(Array.isArray(gate.gaps)); // trace readiness is reported, not hidden
});

test('评审者不得等于产出模型；锁定清单与注册评审者不一致时闸门作废', () => {
  assert.throws(() => createPlan({ taskId, names: ['A'], lockedBy: 'owner',
    producerModel: 'same-model', reviewerModel: 'same-model' }), /评审者不得与产出模型相同/);
  const plan = createPlan({ taskId, names: ['A'], lockedBy: 'owner', lockedAt: at,
    producerModel: 'producer-gpt', reviewerModel: 'structural-vision-reviewer' });
  assert.throws(() => evaluateRound({ plan, reviewerModel: 'structural-vision-reviewer',
    producerModel: 'structural-vision-reviewer', evidence: {} }), /评审者不得与产出模型相同/);
});

test('Controller 把独立评审接成可运行的链路：自动写报告、限制随轮次留痕', async () => {
  const pc = pcStore();
  const reviewer = createIndependentReviewer(independent);
  const plan = createPlan({ taskId, names: ['报价版本正确'], lockedBy: 'pd-owner', lockedAt: at,
    producerModel: 'producer-gpt', reviewerModel: reviewer.id });
  await lockPlan(pc, plan);
  await pc.document(taskId, 'trace', '统一过程流水', projectTrace([event]));
  const audits: any[] = [];
  const control: any = Object.create(Controller.prototype);
  Object.assign(control, { pc, config: independent,
    store: { audit: (...args: any[]) => audits.push(args) },
    trace: { view: async () => ({ events: [event], gaps: [], available: true }) },
    v06: { reviewer } });
  const result = await control.runIndependentReview(taskId);
  assert.equal(result.report.overall, 'passed');
  assert.equal(result.reviewer, reviewer.id);
  assert.ok(result.limitations.some((l: string) => /视觉内容未核验|结构式/.test(l)));
  assert.equal((await readRound(pc, taskId))?.reviewer.model, reviewer.id);
  assert.equal(audits[0]?.[0], 'acceptance.independent-review');
});

test('本地视觉模型适配器只允许本机端点，避免把真实材料发往外部', async () => {
  const { LocalModelVisionAdapter } = await import('../src/visual-review.ts');
  assert.throws(() => new LocalModelVisionAdapter('https://api.example.com/v1/chat', 'vision', 1000), /只能是本机地址/);
  assert.doesNotThrow(() => new LocalModelVisionAdapter('http://127.0.0.1:8090/v1/chat/completions', 'vision', 1000));
  assert.equal(new StructuralVisionAdapter().semanticJudgement, false);
});

test('外部视觉模型适配器：必须 https 且 host 在授权白名单内', async () => {
  const { ExternalVisionAdapter } = await import('../src/visual-review.ts');
  assert.throws(() => new ExternalVisionAdapter('http://api.deepseek.com/v1/chat/completions', 'vl', 1000,
    ['api.deepseek.com'], 'SUITME_VISION_API_KEY'), /必须使用 https/);
  assert.throws(() => new ExternalVisionAdapter('https://evil.example.com/v1/chat/completions', 'vl', 1000,
    ['api.deepseek.com'], 'SUITME_VISION_API_KEY'), /不在授权白名单/);
  assert.doesNotThrow(() => new ExternalVisionAdapter('https://api.deepseek.com/v1/chat/completions', 'vl', 1000,
    ['api.deepseek.com'], 'SUITME_VISION_API_KEY'));
});

test('外部视觉模型适配器无密钥时诚实报错，不假装判了视觉内容', async () => {
  const { ExternalVisionAdapter } = await import('../src/visual-review.ts');
  const plan = createPlan({ taskId, names: ['A'], lockedBy: 'owner', producerModel: 'producer-gpt', reviewerModel: 'external-vision:vl' });
  const adapter = new ExternalVisionAdapter('https://api.deepseek.com/v1/chat/completions', 'vl', 1000,
    ['api.deepseek.com'], 'SUITME_VISION_API_KEY');
  await assert.rejects(() => adapter.review({ plan, producerModel: 'producer-gpt', events: [], artifacts: [] }),
    /未配置密钥/);
});

test('visualAdapterFor：external 授权下选外部适配器，否则保持本机适配器', async () => {
  const { visualAdapterFor, ExternalVisionAdapter, LocalModelVisionAdapter } = await import('../src/visual-review.ts');
  const external = configSchema.parse({ ...base, acceptance: { mode: 'independent',
    visualReviewer: { mode: 'model', model: 'deepseek-vl-chat', endpoint: 'https://api.deepseek.com/v1/chat/completions',
      external: { enabled: true, allowedHosts: ['api.deepseek.com'], apiKeyEnv: 'SUITME_VISION_API_KEY' } } } });
  assert.ok(visualAdapterFor(external) instanceof ExternalVisionAdapter);
  const local = configSchema.parse({ ...base, acceptance: { mode: 'independent',
    visualReviewer: { mode: 'model', model: 'apple-vision-local', endpoint: 'http://127.0.0.1:4190/v1/chat/completions' } } });
  assert.ok(visualAdapterFor(local) instanceof LocalModelVisionAdapter);
});

test('reviewerIdFor 区分外部与本地视觉模型', () => {
  const external = configSchema.parse({ ...base, acceptance: { mode: 'independent',
    visualReviewer: { mode: 'model', model: 'deepseek-vl-chat', endpoint: 'https://api.deepseek.com/v1/chat/completions',
      external: { enabled: true } } } });
  assert.equal(reviewerIdFor(external), 'external-vision:deepseek-vl-chat');
  assert.equal(reviewerIdFor(independent), 'structural-vision-reviewer');
});
