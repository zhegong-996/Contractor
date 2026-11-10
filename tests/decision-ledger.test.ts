// 第六十八轮 · 决策账本契约：
// 只收「判定」，不收流水；每条判定都要能回答"谁、凭什么、判了什么、要不要人签字"。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionLedger, summarizeLedger, LEDGER_ACTIONS } from '../src/decision-ledger.ts';

const row = (action: string, value: unknown, at = '2026-11-10T00:00:00.000Z', issue: string | null = 'task-1') =>
  ({ at, action, issue_id: issue, value: JSON.stringify(value) });

test('routing.decision 映射成「确定承接 + 依据链」', () => {
  const [entry] = buildDecisionLedger([row('routing.decision', {
    decisionId: 'd-1', stage: 'admission', basisKind: 'policy', outcome: 'committed',
    caller: { actor: 'scoped-preparation', source: 'superagent-policy' },
    target: { role: 'worker', agentKey: 'workspace-assistant' },
    requiresHumanSignature: false,
  })]);
  assert.equal(entry.kind, 'route');
  assert.equal(entry.id, 'd-1');
  assert.equal(entry.actor, 'scoped-preparation');
  assert.equal(entry.actorKind, 'system', '来自 policy 的是系统判定，不是 agent 自主决定');
  assert.equal(entry.basis, 'policy');
  assert.equal(entry.requiresHuman, false);
  assert.equal(entry.verdict, '确定承接：worker/workspace-assistant');
  assert.ok(entry.reasons.some(r => r.code === 'stage:admission'));
  assert.ok(entry.reasons.some(r => r.code === 'source:superagent-policy'));
});

test('未承接时结论如实，不美化成"已处理"', () => {
  const [entry] = buildDecisionLedger([row('routing.decision', {
    stage: 'admission', basisKind: 'policy', outcome: 'rejected', caller: {}, target: {},
  })]);
  assert.match(entry.verdict, /未承接：rejected/);
});

test('access 批准：需要人签字，且批准人缺失要如实标注', () => {
  const [entry] = buildDecisionLedger([row('workspace.access-approved', {
    id: 'a-1', agent: 'manual', sourceId: 'b8d1ccb3-4d60-4015',
  })]);
  assert.equal(entry.kind, 'access');
  assert.equal(entry.requiresHuman, true);
  assert.equal(entry.basis, 'human');
  assert.equal(entry.actor, 'manual');
  assert.ok(entry.reasons.some(r => r.code === 'approver:missing'), '历史数据没落批准人，必须标出来');
});

test('知识采用：中文化状态、去掉 user: 前缀、只有采用才要人签字', () => {
  const [confirmed] = buildDecisionLedger([row('knowledge.confirmed', {
    key: 'arch', actor: 'user:gongzhe', reviewedRevision: 'db67fef9aaaa', injected: true,
  })]);
  assert.equal(confirmed.actor, 'gongzhe');
  assert.equal(confirmed.requiresHuman, true);
  assert.match(confirmed.verdict, /采用知识：arch（已注入）/);
  assert.ok(confirmed.reasons.some(r => r.text.includes('采用修订 db67fef9')));

  const [withdrawn] = buildDecisionLedger([row('knowledge.withdrawn', { key: 'k', actor: 'user:x' })]);
  assert.equal(withdrawn.requiresHuman, null, '撤回不涉及签字');
  assert.ok(withdrawn.reasons.some(r => r.text.includes('撤回')), '状态要中文化');
});

test('流水不进账本：member.action / tool-completed 一律被过滤', () => {
  const entries = buildDecisionLedger([
    row('member.action', { foo: 1 }),
    row('assistant.tool-completed', { name: 'read_context' }),
    row('routing.decision', { stage: 'admission', outcome: 'committed', caller: {}, target: {} }),
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, 'routing.decision');
});

test('白名单里没有的动作不伪造条目', () => {
  assert.equal(buildDecisionLedger([row('something.unknown', {})]).length, 0);
  assert.ok(LEDGER_ACTIONS.includes('routing.decision'));
});

test('坏 JSON 不抛错，降级成空依据而不是崩掉整本账', () => {
  const entries = buildDecisionLedger([
    { at: '2026-11-10T00:00:00.000Z', action: 'knowledge.confirmed', issue_id: null, value: '{not json' },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].reasons.length > 0, true, '至少还能从动作名给出状态理由');
});

test('summary 统计：按类计数、缺依据数、需签字数、最后时间', () => {
  const entries = buildDecisionLedger([
    row('routing.decision', { stage: 'a', outcome: 'committed', caller: {}, target: {} }, '2026-11-09T00:00:00.000Z'),
    row('knowledge.confirmed', { key: 'k', actor: 'u' }, '2026-11-10T00:00:00.000Z'),
    row('workspace.access-approved', { id: 'x', agent: 'a', sourceId: 's' }, '2026-11-08T00:00:00.000Z'),
  ]);
  const s = summarizeLedger(entries);
  assert.equal(s.total, 3);
  assert.equal(s.byKind.route, 1);
  assert.equal(s.byKind.knowledge, 1);
  assert.equal(s.byKind.access, 1);
  assert.equal(s.missingBasis, 0);
  assert.equal(s.humanRequired, 2);
  assert.equal(s.lastAt, '2026-11-10T00:00:00.000Z');
});

test('顺序不被改写：账本是事实投影，排序是视图的事', () => {
  const entries = buildDecisionLedger([
    row('routing.decision', { outcome: 'committed', caller: {}, target: {} }, '2026-11-01T00:00:00.000Z'),
    row('knowledge.confirmed', { key: 'k', actor: 'u' }, '2026-11-02T00:00:00.000Z'),
  ]);
  assert.equal(entries[0].at, '2026-11-01T00:00:00.000Z');
  assert.equal(entries[1].at, '2026-11-02T00:00:00.000Z');
});
