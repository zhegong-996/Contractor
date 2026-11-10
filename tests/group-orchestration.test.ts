// 第六十八轮 · 群组编排契约（对标 LobeHub GroupOrchestrationRuntime）：
// 四模式由 intent 决定、broadcast 恒禁工具、delegate 是单向终态、熔断优先于一切。
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideGroupTurn, applyGroupDecision, emptyGroupState, validateGroup, describeGroupDecision,
  type GroupMember } from '../src/group-orchestration.ts';

const members: GroupMember[] = [
  { key: 'workspace-assistant', name: '协作事务 Agent', role: 'supervisor', offers: ['feasibility', 'review'], enabled: true },
  { key: 'role-product', name: '产研岗位', role: 'member', offers: ['feasibility', 'draft'], enabled: true },
  { key: 'role-growth', name: '增长岗位', role: 'member', offers: ['draft'], enabled: true },
  { key: 'role-sales', name: '销售岗位', role: 'member', offers: ['review'], enabled: true },
];

const state0 = () => emptyGroupState(3);

test('群组校验：必须恰好一个启用中的主持人', () => {
  assert.equal(validateGroup(members), null);
  assert.match(validateGroup(members.filter(m => m.role === 'member'))!, /没有启用中的主持人/);
  assert.match(validateGroup([...members, { ...members[0], key: 'second-sup' }])!, /主持人不唯一/);
  assert.match(validateGroup([members[0], members[1], { ...members[1] }])!, /成员标识重复/);
});

test('intent=opinions 且成员足够 → broadcast，且强制禁工具', () => {
  const d = decideGroupTurn({ members, state: state0(), intent: 'opinions', from: 'u1' });
  assert.equal(d.mode, 'broadcast');
  assert.equal(d.toolsAllowed, false, 'broadcast 只说不做');
  assert.deepEqual(d.targets, ['role-growth', 'role-product', 'role-sales'], '目标排序稳定');
  assert.ok(d.reasons.some(r => r.code === 'group:tools-off'));
});

test('broadcast 成员不足两人 → 降级为 speak，并说明原因', () => {
  const solo = [{ ...members[1] }];
  const withSup = [members[0], ...solo];
  const d = decideGroupTurn({ members: withSup, state: state0(), intent: 'opinions', from: 'u1' });
  assert.equal(d.mode, 'speak');
  assert.equal(d.targets.length, 1);
  assert.ok(d.reasons.some(r => r.code === 'group:broadcast-degraded'));
});

test('intent=handoff → delegate，承接方成为收口人，主持人让位', () => {
  const d = decideGroupTurn({ members, state: state0(), intent: 'handoff', from: 'u1' });
  assert.equal(d.mode, 'delegate');
  assert.equal(d.targets.length, 1);
  assert.equal(d.closer, d.targets[0], 'delegate 后由承接方收口');
  assert.equal(d.toolsAllowed, true);
});

test('delegate 是单向终态：已转交时再问，只等回执', () => {
  const first = decideGroupTurn({ members, state: state0(), intent: 'handoff', from: 'u1' });
  const next = applyGroupDecision(state0(), first);
  assert.equal(next.delegatedTo, first.targets[0], '状态要记住承接方');
  const again = decideGroupTurn({ members, state: next, intent: 'handoff', from: 'u1' });
  assert.equal(again.mode, 'finish');
  assert.equal(again.stopped, 'waiting-handoff');
  assert.equal(again.closer, first.targets[0], '等回执时收口人仍是承接方');
});

test('intent=execute 只挑有 draft 能力的成员', () => {
  const d = decideGroupTurn({ members, state: state0(), intent: 'execute', from: 'u1' });
  assert.equal(d.mode, 'executeTask');
  assert.ok(['role-product', 'role-growth'].includes(d.targets[0]), 'role-sales 只有 review，不能派执行');
});

test('intent=execute 但没人能出稿 → 收敛并说明缺口', () => {
  const noDraft = members.map(m => m.role === 'member' ? { ...m, offers: ['review' as const] } : m);
  const d = decideGroupTurn({ members: noDraft, state: state0(), intent: 'execute', from: 'u1' });
  assert.equal(d.mode, 'finish');
  assert.equal(d.stopped, 'no-eligible-member');
  assert.ok(d.reasons.some(r => r.code === 'group:no-draft-offer'));
});

test('轮次熔断优先：用满 maxRounds 就收敛，不再派活', () => {
  let state = emptyGroupState(2);
  for (let i = 0; i < 2; i += 1) {
    state = applyGroupDecision(state, decideGroupTurn({ members, state, intent: 'answer', from: 'u1' }));
  }
  assert.equal(state.round, 2);
  const d = decideGroupTurn({ members, state, intent: 'answer', from: 'u1' });
  assert.equal(d.mode, 'finish');
  assert.equal(d.stopped, 'round-budget-exhausted');
  assert.ok(d.reasons.some(r => r.code === 'group:round-budget'));
});

test('轮转：同一 intent 连续推进时，不会一直叫同一个人', () => {
  let state = emptyGroupState(6);
  const picked: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const d = decideGroupTurn({ members, state, intent: 'answer', from: 'u1' });
    picked.push(d.targets[0]);
    state = applyGroupDecision(state, d);
  }
  assert.equal(new Set(picked).size, 3, '三次应轮到三个不同的人');
});

test('非法群组 → 直接收敛，不带病推进', () => {
  const d = decideGroupTurn({ members: members.filter(m => m.role === 'member'), state: state0(), intent: 'answer', from: 'u1' });
  assert.equal(d.mode, 'finish');
  assert.equal(d.stopped, 'group-invalid');
});

test('已结束的群组不再产出新决策', () => {
  const finished = { ...state0(), finished: true };
  const d = decideGroupTurn({ members, state: finished, intent: 'answer', from: 'u1' });
  assert.equal(d.mode, 'finish');
  assert.equal(d.stopped, 'already-finished');
});

test('describeGroupDecision 给人话，禁工具要标出来', () => {
  const broadcast = decideGroupTurn({ members, state: state0(), intent: 'opinions', from: 'u1' });
  assert.match(describeGroupDecision(broadcast), /并行征询/);
  assert.match(describeGroupDecision(broadcast), /禁工具/);
  const fin = decideGroupTurn({ members, state: { ...state0(), round: 9 }, intent: 'answer', from: 'u1' });
  assert.match(describeGroupDecision(fin), /收敛结束/);
});
