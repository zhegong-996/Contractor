// P-6 契约：累计确认 / 至少一次通知 / 投递就绪 / Runner 四项借思想。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cumulativeAck, foldDelivery, notificationText, atLeastOncePending, deliveryReadiness,
  TrackedStepQueue, type DeliveryEvent,
} from '../src/step-delivery.ts';
import { InMemoryStepQueue, executionView } from '../src/step-execution.ts';
import {
  deriveMissionState, MISSION_STATE_LABELS, SETTLE_QUIET_SECONDS,
  resolveRuntime, assertNoStoredArgv, assertCoordinationLayering,
  assertSnapshotNoRewrite, missionStateSignature,
} from '../src/mission-state.ts';
import { loadConfig } from '../src/config.ts';

const at = '2026-11-08T03:30:00.000Z';
const event = (id: string, type: DeliveryEvent['type'], patch: Partial<DeliveryEvent> = {}): DeliveryEvent =>
  ({ id, type, at, ...patch });

test('P-6 累计确认只前进，旧确认与未知编号一律忽略', () => {
  const order = ['d1', 'd2', 'd3', 'd4'];
  assert.equal(cumulativeAck(null, 'd2', order), 'd2');
  assert.equal(cumulativeAck('d2', 'd4', order), 'd4');
  assert.equal(cumulativeAck('d4', 'd2', order), 'd4', 'stale ack 不得回退');
  assert.equal(cumulativeAck('d2', 'nope', order), 'd2');
});

test('P-6 折叠投影按订阅边界与 ack 计算积压，坏行如实记错', () => {
  const events: DeliveryEvent[] = [
    event('d1', 'message', { from: 'queue', to: null }),
    event('d2', 'message', { from: 'queue', to: ['worker-a'] }),
    event('d3', 'message', { from: 'queue', to: ['worker-b'] }),
    event('d4', 'message', { from: 'worker-a', to: null }),
    event('d5', 'notification', { subscriber: 'worker-a' }),
    event('d6', 'inbox_read', { subscriber: 'worker-a', upTo: 'd2' }),
  ];
  const projection = foldDelivery(events, 'worker-a');
  assert.deepEqual(projection.messages.map(m => m.id), ['d1', 'd2'], '自己发的与发给别人的都不入收件箱');
  assert.equal(projection.lastAck, 'd2');
  assert.equal(projection.unreadCount, 0);
  assert.equal(projection.notifications.length, 1);
  assert.equal(atLeastOncePending(projection), false);
  const beforeAck = foldDelivery(events.slice(0, 5), 'worker-a');
  assert.equal(beforeAck.unreadCount, 2);
  assert.equal(atLeastOncePending(beforeAck), true);
  assert.equal(foldDelivery([event('', 'message')], 'worker-a').errors.length, 1);
});

test('P-6 通知只带条数、幂等、不含消息正文', () => {
  assert.equal(notificationText(3), notificationText(3));
  assert.match(notificationText(2), /有 2 条新消息/);
  assert.ok(!notificationText(2).includes('d1'));
  assert.equal(notificationText(-1), notificationText(0));
});

test('P-6 投递就绪按能力声明：空闲可投、回合中排队是唯一例外、重投递只认空闲', () => {
  assert.equal(deliveryReadiness({ idle: true, working: false, runtime: 'step-once' }).ready, true);
  const midTurn = deliveryReadiness({ idle: false, working: true, runtime: 'claude-code' });
  assert.equal(midTurn.ready, true);
  assert.match(midTurn.reason, /回合中排队输入/);
  assert.equal(deliveryReadiness({ idle: false, working: true, runtime: 'step-once' }).ready, false);
  assert.equal(deliveryReadiness({ idle: false, working: true, runtime: 'claude-code',
    redelivery: true }).ready, false, '重投递对所有执行端都只在空闲时发生');
  assert.equal(deliveryReadiness({ idle: true, working: false, runtime: 'step-once',
    redelivery: true }).ready, true);
  assert.match(deliveryReadiness({ idle: true, working: false, runtime: 'step-once',
    pendingSpawn: true }).reason, /启动/);
  assert.match(deliveryReadiness({ idle: true, working: false, runtime: 'step-once',
    inFlight: true }).reason, /在途/);
});

test('P-6 包装队列留下「消息确实送到执行端」证据，不改内层队列行为', async () => {
  const inner = new InMemoryStepQueue(() => 0);
  const queue = new TrackedStepQueue(inner, () => 0);
  await queue.enqueueSteps('r1', [{ kind: 'tool-call' }, { kind: 'tool-call' }]);
  const step = (await queue.claimStep('w1', 'r1'))!;
  await queue.completeStep(step.runToken, { ok: true }, { checkpoint: { n: 1 } });
  const evidence = queue.evidence('r1');
  assert.equal(evidence.enqueued, 2);
  assert.equal(evidence.delivered, 1);
  assert.equal(evidence.acknowledged, 1);
  assert.equal(evidence.pendingDelivery, 0);
  assert.equal(evidence.notifications >= 1, true);
  assert.equal(evidence.errors, 0);
  assert.equal(evidence.atLeastOnce, true, '还有未确认消息就持续需要通知');
  assert.equal(evidence.signature, queue.evidence('r1').signature, '证据摘要确定性');
  assert.deepEqual((await inner.runState('r1')).map(s => s.status), ['done', 'ready']);
});

test('P-6 累计确认推进后积压清零，旧凭据重复完成被拒且证据不增', async () => {
  const queue = new TrackedStepQueue(new InMemoryStepQueue(() => 0), () => 0);
  await queue.enqueueSteps('r2', [{ kind: 'tool-call' }]);
  const step = (await queue.claimStep('w1', 'r2'))!;
  await queue.completeStep(step.runToken, { ok: true });
  assert.equal(queue.acknowledgeUpTo('r2', 'd000001'), 'd000001');
  assert.equal(queue.acknowledgeUpTo('r2', 'd000001'), 'd000001', '重复确认不回退');
  assert.equal(queue.evidence('r2').atLeastOnce, false);
  await assert.rejects(() => queue.completeStep(step.runToken, { again: true }), /runToken 无效/);
  assert.equal(queue.evidence('r2').acknowledged, 1);
});

test('P-6 六个状态词由任务事实派生，已收敛与运行中可并存', () => {
  const base = { steps: [], pendingQuestions: 0, hasFailure: false,
    interrupted: false, ended: false, lastActivityAt: 0, now: 0 };
  assert.equal(Object.keys(MISSION_STATE_LABELS).length, 6);
  assert.equal(SETTLE_QUIET_SECONDS, 30);
  assert.equal(deriveMissionState({ ...base, now: 29_999 }).settled, false);
  const settled = deriveMissionState({ ...base, now: 30_000 });
  assert.equal(settled.settled, true);
  assert.equal(settled.state, 'settled');
  assert.equal(settled.label, '已安静收敛');
  const both = deriveMissionState({ ...base, now: 30_000, steps: [{ status: 'running' }] });
  assert.equal(both.settled, true);
  assert.equal(both.running, true);
  assert.equal(both.state, 'working', '两个维度并存，展示用词取进行中');
  assert.equal(deriveMissionState({ ...base, now: 60_000, pendingQuestions: 1 }).state, 'needsYou');
  assert.equal(deriveMissionState({ ...base, hasFailure: true }).state, 'failed');
  assert.equal(deriveMissionState({ ...base, interrupted: true, hasFailure: true }).state, 'interrupted');
  assert.equal(deriveMissionState({ ...base, ended: true, interrupted: true }).state, 'ended');
  assert.equal(deriveMissionState({ ...base, now: 5_000, quietSeconds: 3 }).settled, true);
  assert.equal(missionStateSignature([settled, both]), missionStateSignature([{ ...settled }, { ...both }]));
});

test('P-6 运行时适配层只声明能力、不存启动参数，未知名称保守处理', () => {
  assert.equal(resolveRuntime('claude-code').queuesInputMidTurn, true);
  assert.equal(resolveRuntime('step-once').queuesInputMidTurn, false);
  assert.equal(resolveRuntime('unknown-runtime').queuesInputMidTurn, false);
  assert.match(resolveRuntime('unknown-runtime').note, /不迁移/);
  assert.doesNotThrow(() => assertNoStoredArgv({ name: 'step-once', capabilities: ['sha256'] }));
  assert.throws(() => assertNoStoredArgv({ argv: ['--model', 'x'] }), /不得存储 argv/);
  assert.throws(() => assertNoStoredArgv({ command: 'node' }), /不得存储 command/);
});

test('P-6 配置库只放配置、实时协作全在追加写日志（机器化守门）', () => {
  assert.doesNotThrow(() => assertCoordinationLayering({ configTables: [{ name: 'config', columns: ['dsn', 'mode'] }],
    coordinationLog: '.runtime/memory/events.jsonl', singleMutableSharedState: '.runtime/memory/events.jsonl' }));
  assert.throws(() => assertCoordinationLayering({ configTables: [{ name: 'config', columns: ['status'] }],
    coordinationLog: 'a', singleMutableSharedState: 'a' }), /不得存放运行时协作状态/);
  assert.throws(() => assertCoordinationLayering({ configTables: [],
    coordinationLog: 'a', singleMutableSharedState: 'b' }), /唯一可变共享状态/);
});

test('P-6 编制快照变更不回溯改写历史决策', () => {
  const before = [{ id: 'dec-1', configRevision: 'rev-1', evidence: 'agents:rev-1:0' }];
  assert.doesNotThrow(() => assertSnapshotNoRewrite(before, [...before], 'rev-2'));
  assert.throws(() => assertSnapshotNoRewrite(before,
    [{ id: 'dec-1', configRevision: 'rev-2', evidence: 'agents:rev-2:0' }], 'rev-2'), /回溯改写/);
  assert.throws(() => assertSnapshotNoRewrite(before, [], 'rev-2'), /条数/);
});

test('P-6 只读执行视图新增状态词、能力声明与两条协议说明，原有口径不变', () => {
  const view = executionView(loadConfig());
  assert.equal(view.steppedReady, true);
  assert.equal(view.modelCalls, 0);
  assert.equal(view.mission.states.length, 6);
  assert.equal(view.mission.settleQuietSeconds, 30);
  assert.equal(view.mission.settledAndRunningCanCoexist, true);
  assert.ok(view.runtimeCapabilities.some(c => c.queuesInputMidTurn === true));
  assert.equal(view.hitl.pairedEvidence, true);
  assert.match(view.hitl.redLines.join(' '), /确认验收/);
  assert.match(view.delivery.cumulativeAck, /只前进/);
});
