// FR-08 default ontology and FR-22/23/24 runtime guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrgGraph, responsibilityOf, evidenceOf, influencedBy, reachableFrom, NODE_KINDS, EDGE_FAMILIES,
  type OrgGraph } from '../src/org-ontology.ts';
import { defaultAttentionPolicy, filterEvent, defaultWatchdogPolicy, inspectRun, recoveryFrom, assertIntervention } from '../src/runtime-guard.ts';

const at = '2026-11-06T08:00:00.000Z';
const node = (id: string, kind: OrgGraph['nodes'][number]['kind']) => ({ id, kind, label: id, at });

function graph(): OrgGraph {
  return { schemaVersion: 1,
    nodes: [node('li', 'person'), node('pd', 'role'), node('T-1', 'task'), node('A-1', 'artifact'),
      node('E-1', 'evidence'), node('Q-1', 'source'), node('T-2', 'task')],
    edges: [
      { id: 'e-role', family: 'belongs_to_role', from: 'li', to: 'pd', state: 'accepted', evidenceRefs: [{ sourceId: 'registry', revision: 'v1' }], actor: 'owner', at },
      { id: 'e-resp', family: 'responsible_for', from: 'li', to: 'T-1', state: 'accepted', evidenceRefs: [{ sourceId: 'transfer', revision: 'v1' }], actor: 'owner', at },
      { id: 'e-proof', family: 'verified_by', from: 'A-1', to: 'E-1', state: 'accepted', evidenceRefs: [{ sourceId: 'quote', revision: 'v3', excerpt: '报价 3.0' }], actor: 'owner', at },
      { id: 'e-reuse', family: 'reused_by', from: 'A-1', to: 'T-2', state: 'accepted', evidenceRefs: [{ sourceId: 'pack', revision: 'v1' }], actor: 'owner', at },
    ] };
}

test('default ontology has 16 node kinds and 5 edge families, with typed edge rules', () => {
  assert.equal(NODE_KINDS.length, 16);
  assert.equal(EDGE_FAMILIES.length, 5);
  assert.doesNotThrow(() => validateOrgGraph(graph()));
  assert.throws(() => validateOrgGraph({ ...graph(), edges: [{ ...graph().edges[0]!, state: 'accepted', evidenceRefs: [] }] }), /必须带 L1 原文证据引用/);
  assert.throws(() => validateOrgGraph({ ...graph(), edges: [{ ...graph().edges[0]!, from: 'T-1' }] }), /不符合 belongs_to_role 的本体规则/);
  assert.throws(() => validateOrgGraph({ ...graph(), edges: [...graph().edges, { ...graph().edges[0]! }] }), /边 ID 重复/);
});

test('the three organisation questions are answerable from one relation set', () => {
  const g = graph();
  assert.equal(responsibilityOf(g, 'T-1')[0]?.actorNode?.id, 'li');
  assert.equal(evidenceOf(g, 'A-1').nodes[0]?.id, 'E-1');
  assert.equal(evidenceOf(g, 'A-1').refs[0]?.sourceId, 'quote');
  assert.deepEqual(influencedBy(g, 'e-reuse'), ['T-2']);
  assert.deepEqual([...reachableFrom(g, ['li'], ['e-role', 'e-resp'])].sort(), ['T-1', 'li', 'pd']);
  assert.deepEqual([...reachableFrom(g, ['li'], [])], ['li'], 'no grant means no reachability beyond the starting node');
});

test('attention budget: two-stage filter, self-progress silence, caps and role boundary', () => {
  const policy = defaultAttentionPolicy();
  assert.equal(policy.maxToolCallsPerTurn, 12);
  assert.equal(policy.maxRechecksPerDelegation, 2);
  const state = { toolCallsThisTurn: 0, rechecksThisDelegation: 0, interruptionsToday: {} as Record<string, number> };
  const base = { id: 'ev1', actorId: 'agent', targetUserId: 'li', withinRoleBoundary: true, summary: '需要确认', at };
  assert.equal(filterEvent({ ...base, kind: 'self-progress' }, policy, state).wake, false);
  assert.equal(filterEvent({ ...base, kind: 'review' }, policy, state).wake, true);
  assert.match(filterEvent({ ...base, kind: 'tool-call' }, policy, { ...state, toolCallsThisTurn: 12 }).reason, /工具调用已达上限/);
  assert.match(filterEvent({ ...base, kind: 'delegation' }, policy, { ...state, rechecksThisDelegation: 2 }).reason, /复查已达上限/);
  assert.match(filterEvent({ ...base, kind: 'review' }, policy, { ...state, interruptionsToday: { li: 8 } }).reason, /被打断次数已达上限/);
  assert.equal(filterEvent({ ...base, kind: 'signal', withinRoleBoundary: false }, policy, state).stage, 'semantic');
  assert.equal(filterEvent({ ...base, kind: 'signal' }, { ...policy, sensitivity: 'low' }, state).wake, false);
});

test('Watchdog separates human waiting from a stall, and never replays without a checkpoint', () => {
  const policy = defaultWatchdogPolicy();
  const run = { taskId: 'T-1', runId: 'r1', lastProgressAt: at, checkpoint: 'cp-1', status: 'running' as const, toolCalls: 3 };
  assert.equal(inspectRun({ ...run, status: 'waiting-human' }, policy, at).state, 'waiting');
  assert.equal(inspectRun(run, policy, '2026-11-06T08:10:00.000Z').state, 'healthy');
  const stalled = inspectRun(run, policy, '2026-11-06T08:20:00.000Z');
  assert.equal(stalled.state, 'stalled');
  assert.equal(recoveryFrom(stalled).allowed, true);
  assert.equal(recoveryFrom(inspectRun({ ...run, checkpoint: undefined }, policy, '2026-11-06T08:20:00.000Z')).allowed, false);
  assert.match(String(recoveryFrom(inspectRun({ ...run, checkpoint: undefined }, policy, '2026-11-06T08:20:00.000Z')).reason), /禁止自动重放/);
  assert.equal(inspectRun({ ...run, toolCalls: 500 }, policy, at).state, 'runaway');
});

test('intervention requires a checkpoint for resume/rollback, and refuses unknown phases', () => {
  const base = { schemaVersion: 1 as const, taskId: 'T-1', actorUserId: 'li', reason: '客户改需求', at };
  assert.doesNotThrow(() => assertIntervention({ ...base, action: 'pause' }, { phase: 'running' }));
  assert.throws(() => assertIntervention({ ...base, action: 'resume' }, { phase: 'waiting' }), /必须指定检查点/);
  assert.throws(() => assertIntervention({ ...base, action: 'rollback' }, { phase: 'running' }), /上一已验收版本/);
  assert.throws(() => assertIntervention({ ...base, action: 'stop' }, { phase: 'unknown' }), /须先核对原执行终止/);
  assert.equal(assertIntervention({ ...base, action: 'resume', checkpoint: 'cp-1' }, { phase: 'waiting' }).action, 'resume');
});
