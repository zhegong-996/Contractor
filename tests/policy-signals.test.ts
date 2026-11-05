// FR-05/20/28 (owner may only tighten) and FR-21 (signals warn, never rank).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPolicy, tightenPolicy, effectiveLevel, requiresHumanSign, topologyAdvice, policyForTask,
  workspacePolicySchema, type WorkspacePolicy } from '../src/workspace-policy.ts';
import { evaluateSignals, clusterSignals, openFixLoop, retest, toSignalCard } from '../src/organization-signals.ts';
import { renderForChannel, PLAIN_TEXT } from '../src/channels.ts';

const at = '2026-11-06T08:00:00.000Z';
const policy = () => defaultPolicy('space-a', 'owner-a', at);
const candidate = (p: WorkspacePolicy, patch: Record<string, unknown>) => workspacePolicySchema.parse({ ...p, ...patch });

test('verification level has a floor the owner cannot lower', () => {
  const p = policy();
  assert.equal(effectiveLevel(p, {}), 'L2');
  assert.equal(effectiveLevel(p, { external: true }), 'L4');
  assert.equal(effectiveLevel(p, { riskAction: 'customer_visible' }), 'L4');
  assert.equal(effectiveLevel(p, { riskAction: 'funds', taskType: 'cheap' }), 'L4');
  assert.equal(requiresHumanSign('merge'), true);
  assert.equal(requiresHumanSign('internal_note'), false);
  // A stored lower override is still overridden at read time.
  const lowered = tightenPolicy(p, candidate(p, { verification: { defaultLevel: 'L1', byTaskType: {}, byRiskAction: { external_publish: 'L1' } } }), at);
  assert.equal(lowered.verification.defaultLevel, 'L2', 'owner cannot lower the default');
  assert.equal(lowered.verification.byRiskAction.external_publish, 'L4', 'forced L4 is applied on write');
  assert.equal(effectiveLevel(lowered, { riskAction: 'external_publish' }), 'L4');
});

test('owner may tighten; topology is configurable but event direct-routing is not', () => {
  const p = policy();
  const tightened = tightenPolicy(p, candidate(p, { topology: 'hierarchical',
    verification: { defaultLevel: 'L3', byTaskType: { proposal: 'L4' }, byRiskAction: {} } }), at);
  assert.equal(tightened.topology, 'hierarchical');
  assert.equal(tightened.verification.defaultLevel, 'L3');
  assert.equal(tightened.version, 1);
  assert.equal(tightened.interventionViaTaskCard, true);
  assert.equal(tightened.subscriptionDirectRouting, true);
  assert.throws(() => tightenPolicy(p, candidate(p, { subscriptionDirectRouting: false as any })), /订阅直通是工程路由/);
  assert.throws(() => tightenPolicy(p, candidate(p, { space: 'other' })), /不能修改其他空间/);
  assert.throws(() => tightenPolicy(p, candidate(p, { ownerUserId: 'someone-else' })), /组织级审批/);
  assert.throws(() => policyForTask([tightened], 0), /禁止用新配置回溯在途任务/);
  assert.equal(policyForTask([p, tightened], 0).version, 0);
});

test('topology advice is read-only and comes from observed density', () => {
  const flat = topologyAdvice({ crossGroupCalls: 3, interruptionsPerPerson: 2, findPersonRetries: 1 });
  assert.equal(flat.suggest, 'flat');
  const layered = topologyAdvice({ crossGroupCalls: 42, interruptionsPerPerson: 11, findPersonRetries: 2 });
  assert.equal(layered.suggest, 'hierarchical');
  assert.ok(layered.reasons.length >= 2);
});

test('organisation signals warn only, never block, rank or score people', () => {
  const signals = evaluateSignals({ at, readings: {
    'cross-function-dispatch-ratio': 0.45, 'transfer-revocation-rate': 0.2,
    'knowledge-reuse-rate': 0.1, 'attention-cost': 12, 'rework-rate': 0.05,
  } });
  assert.equal(signals.length, 4);
  assert.ok(signals.every(s => s.blocking === false));
  assert.ok(signals.every(s => s.hint.length > 0));
  const clusters = clusterSignals(signals);
  assert.ok(clusters.length >= 2);
  assert.ok(clusters.every(c => c.signals.every(s => s.clusterId === c.clusterId)));
  const text = renderForChannel(toSignalCard(signals[0]!), { capabilities: PLAIN_TEXT, workbenchUrl: 'http://127.0.0.1:4180' }).text;
  assert.match(text, /仅提示，不拦截任务、不做人员排名与考核/);
});

test('signal fix loop closes with a next-day retest', () => {
  const [signal] = evaluateSignals({ at, readings: { 'rework-rate': 0.4 } });
  assert.ok(signal);
  const loop = openFixLoop(signal, 'T-fix-1', '补齐开工前验收清单', at);
  assert.equal(loop.status, 'open');
  assert.equal(loop.retestAt, '2026-11-07T08:00:00.000Z');
  assert.throws(() => retest(loop, 0.1, 0.2, at), /次日复测时间未到/);
  assert.equal(retest(loop, 0.1, 0.2, '2026-11-07T09:00:00.000Z').status, 'fixed');
  assert.equal(retest(loop, 0.5, 0.2, '2026-11-08T08:00:00.000Z').status, 'regressed');
});
