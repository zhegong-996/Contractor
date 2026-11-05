// The acceptance contract is a P0 foundation: criteria locked before work,
// an independent per-item review, partial rejection, and a gate that must NOT
// block the existing originator-only /accept when no plan was sealed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlan, planHash, verifyPlan, lockPlan, readPlan, encodePlan, decodePlan, planForTask,
  type PlanDocumentStore,
} from '../src/acceptance-plan.ts';
import {
  evaluateRound, toAcceptanceCases, partialReject, selfCheckStandards,
  writeRound, readRound, verifyAcceptanceGate,
} from '../src/acceptance-round.ts';

const lockedAt = '2026-11-05T00:00:00.000Z';
const producer = 'gpt-prod';
const reviewer = 'independent-reviewer';

function store() {
  const docs: Record<string, { body: string; latestRevisionId: string }> = {};
  let version = 0;
  const pc: PlanDocumentStore = {
    get: async <T = any>(route: string): Promise<T> => {
      const key = route.split('/').pop()!;
      if (!docs[key]) throw new Error(`Paperclip GET ${route}: 404 not found`);
      return docs[key] as T;
    },
    document: async (_issueId, key, _title, body) => {
      version++; docs[key] = { body, latestRevisionId: `rev-${version}` }; return {};
    },
  };
  return { pc, docs, revision: () => `rev-${version}` };
}

function plan() {
  return createPlan({ taskId: 'task-1', names: ['报价版本正确', '客户可见文案'], lockedBy: '产品 owner',
    level: 'L3', producerModel: producer, reviewerModel: reviewer, lockedAt });
}
const good = { refs: ['trace:abc'], evidenceKind: 'captured' as const, sourceRefs: [{ id: 'quote', revision: 'v3' }] };

test('criteria are sealed with a hash and an independent, vision-capable reviewer', () => {
  const p = plan();
  assert.equal(p.items.length, 2);
  assert.equal(p.reviewer.differsFromProducer, true);
  assert.equal(p.reviewer.requiresVision, true);
  assert.doesNotThrow(() => verifyPlan(p));
  assert.throws(() => createPlan({ taskId: 't', names: ['x'], lockedBy: 'o', producerModel: producer, reviewerModel: producer }),
    /评审者不得与产出模型相同/);
  assert.throws(() => verifyPlan({ ...p, items: [...p.items, { ...p.items[0]!, id: 'extra' }] }), /验收清单已被修改/);
  assert.equal(planHash({ ...p, hash: 'ignored' }), p.hash);
});

test('the sealed plan round-trips through a native Paperclip document revision', async () => {
  const { pc } = store();
  const p = plan();
  const revision = await lockPlan(pc, p);
  assert.ok(revision);
  const sealed = await readPlan(pc, 'task-1');
  assert.equal(sealed?.plan.hash, p.hash);
  assert.equal(sealed?.revision, revision);
  assert.deepEqual(decodePlan(encodePlan(p)), p);
  assert.equal(await readPlan({ ...pc, get: async () => { throw new Error('Paperclip GET: 404 not found'); } }, 'task-2'), null);
});

test('planForTask derives criteria from the business acceptance lines already stored', () => {
  const p = planForTask({ id: 'task-1', context: JSON.stringify({ businessAcceptance: ['A', 'B'] }) }, 'owner');
  assert.deepEqual(p.items.map(i => i.name), ['A', 'B']);
  const fallback = planForTask({ id: 'task-1', context: 'not json' }, 'owner');
  assert.deepEqual(fallback.items.map(i => i.name), ['符合任务要求']);
});

test('per-item judgement rejects wrong evidence kind, missing source version and unreplayable refs', () => {
  const p = plan();
  const bad = evaluateRound({ plan: p, reviewerModel: reviewer, producerModel: producer,
    evidence: {
      'item-1': good,
      'item-2': { refs: ['trace:x'], evidenceKind: 'authored', sourceRefs: [{ id: 'doc', revision: 'v1' }] },
    },
  });
  assert.equal(bad.overall, 'partial');
  assert.equal(bad.judgements[0]!.status, 'passed');
  assert.match(bad.judgements[1]!.reason, /证据类型不符/);

  const noSource = evaluateRound({ plan: p, reviewerModel: reviewer, producerModel: producer,
    evidence: { 'item-1': { refs: ['x'], evidenceKind: 'captured' }, 'item-2': good } });
  assert.match(noSource.judgements[0]!.reason, /证据缺少来源与版本/);

  const missing = evaluateRound({ plan: p, reviewerModel: reviewer, producerModel: producer, evidence: { 'item-2': good } });
  assert.equal(missing.judgements[0]!.status, 'blocked');
  assert.match(missing.judgements[0]!.reason, /缺少证据引用/);
  assert.throws(() => evaluateRound({ plan: p, reviewerModel: producer, producerModel: producer, evidence: {} }),
    /评审者不得与产出模型相同/);
});

test('only a fully passed round creates /accept cases; rejection retreats only failed items', () => {
  const p = plan();
  const partial = evaluateRound({ plan: p, reviewerModel: reviewer, producerModel: producer,
    evidence: { 'item-1': good, 'item-2': { refs: [], evidenceKind: 'captured' } } });
  assert.throws(() => toAcceptanceCases(partial, p), /存在未通过或未受阻项/);
  const rejection = partialReject(partial);
  assert.deepEqual(rejection.recheckItems, ['item-2']);
  assert.deepEqual(rejection.keepItems, ['item-1']);
  assert.equal(rejection.closeTask, false);
  assert.ok(selfCheckStandards(partial).some(line => line.includes('客户可见文案')));

  const full = evaluateRound({ plan: p, reviewerModel: reviewer, producerModel: producer,
    evidence: { 'item-1': good, 'item-2': good } });
  assert.equal(full.overall, 'passed');
  assert.deepEqual(toAcceptanceCases(full, p), [
    { name: '报价版本正确', passed: true }, { name: '客户可见文案', passed: true },
  ]);
});

test('without a sealed plan the gate waives, preserving the original originator /accept', async () => {
  const { pc } = store();
  const gate = await verifyAcceptanceGate({ pc, taskId: 'task-1', cases: [{ name: '符合任务要求', passed: true }] });
  assert.equal(gate.status, 'waived');
  assert.match(String(gate.reason), /沿用原有发起人核可/);
});

test('with a sealed plan the gate demands an independent round and matching cases', async () => {
  const { pc } = store();
  const p = plan();
  await lockPlan(pc, p);
  await assert.rejects(() => verifyAcceptanceGate({ pc, taskId: 'task-1', cases: [] }), /尚未完成独立逐项评审/);

  const full = evaluateRound({ plan: p, reviewerModel: reviewer, producerModel: producer,
    evidence: { 'item-1': good, 'item-2': good } });
  await writeRound(pc, { ...full, planRevision: (await readPlan(pc, 'task-1'))!.revision });
  assert.ok(await readRound(pc, 'task-1'));
  await assert.rejects(() => verifyAcceptanceGate({ pc, taskId: 'task-1',
    cases: [{ name: '别的标准', passed: true }] }), /提交用例与逐项评审报告不一致/);
  const gate = await verifyAcceptanceGate({ pc, taskId: 'task-1', cases: toAcceptanceCases(full, p) });
  assert.equal(gate.status, 'verified');
  assert.equal(gate.plan?.hash, p.hash);
});
