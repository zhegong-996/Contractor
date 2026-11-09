// 第四十轮 · 分层契约体检（src/layers-audit.ts + src/pass-through.ts）。
//
// 这些用例的作用不是「再测一遍业务」，而是钉住**分层架构的边界**：
// 路由跳数、直通不扩权、Agent 编制与范围、知识三分区、验收只能人签、个性化可校验。
// 任何一条被改松，这里先红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLayerContracts, layerSummary, LAYERS, type LayerReport } from '../src/layers-audit.ts';
import { passThroughDecision } from '../src/pass-through.ts';

const report: LayerReport = auditLayerContracts();
const check = (id: string) => report.checks.find(item => item.id === id)!;

test('分层体检：七层都有结论，且不存在 gap', () => {
  assert.equal(report.checks.length > 0, true);
  assert.deepEqual(Object.keys(report.byLayer).sort(), [...LAYERS].sort());
  const gaps = report.checks.filter(item => item.status === 'gap').map(item => `${item.id}：${item.title}`);
  assert.deepEqual(gaps, [], '存在 gap：' + gaps.join('；'));
  assert.equal(report.ok, true);
  assert.equal(report.counts.total, report.checks.length);
  assert.equal(report.counts.ok + report.counts.partial + report.counts.gap, report.counts.total);
});

test('每条结论都带证据，且声明零模型调用', () => {
  for (const item of report.checks) {
    assert.ok(item.evidence.length > 0, `${item.id} 没有证据`);
    assert.equal(item.modelCalls, 0, `${item.id} 不应调用模型`);
    assert.ok(item.claim.length > 0, `${item.id} 没有断言文本`);
  }
});

test('路由：分层两跳因果相连，人签只落在最后一跳', () => {
  assert.equal(check('router.layered-two-hop').status, 'ok');
  assert.equal(check('router.human-signature-last-hop').status, 'ok');
  assert.equal(check('router.self-review-blocked').status, 'ok');
});

test('直通：只少建单，不多给权', () => {
  const direct = passThroughDecision({
    candidates: [{ id: 'T1', phase: 'running', binding: { senderId: 'u1', chatId: 'c1' }, requesterUserId: 'u1' }],
    actor: { id: 'u1', chatId: 'c1' }, member: { userId: 'u1' },
  });
  assert.equal(direct.direct, true);
  assert.equal(direct.taskId, 'T1');
  // 直通决策里不能夹带范围 / 权限字段——否则就是绕过授权。
  assert.equal('scope' in direct, false);
  assert.equal('permissions' in direct, false);

  const explicit = passThroughDecision({
    explicitAction: 'accept', candidates: [], actor: { id: 'u1', chatId: 'c1' },
  });
  assert.equal(explicit.direct, false);
  assert.equal(explicit.kind, 'explicit-command');

  const accepted = passThroughDecision({
    candidates: [{ id: 'T1', phase: 'accepted', binding: { senderId: 'u1', chatId: 'c1' } }],
    actor: { id: 'u1', chatId: 'c1' },
  });
  assert.equal(accepted.direct, false);
  assert.equal(accepted.kind, 'accepted');

  const ambiguous = passThroughDecision({
    candidates: [
      { id: 'T1', phase: 'running', binding: { senderId: 'u1', chatId: 'c1' } },
      { id: 'T2', phase: 'ready', binding: { senderId: 'u1', chatId: 'c1' } },
    ],
    actor: { id: 'u1', chatId: 'c1' },
  });
  assert.equal(ambiguous.needsTaskReference, true);

  const otherMember = passThroughDecision({
    candidates: [{ id: 'T1', phase: 'running', binding: { senderId: 'u1', chatId: 'c1' }, requesterUserId: 'u1' }],
    actor: { id: 'u1', chatId: 'c1' }, member: { userId: 'u2' },
  });
  assert.equal(otherMember.deny, true);
  assert.equal(otherMember.kind, 'ownership');
});

test('知识：新建与修改同一条范围口径（域内可建、跨域被拒）', () => {
  // 第四十轮修的真实缺陷：canCreateKnowledge 曾一律拿 ['*'] 比范围，
  // 导致域主管「改得、建不得」。这里钉住修正后的行为。
  assert.equal(check('knowledge.create-aligns-with-update').status, 'ok');
});

test('知识：读不按业务域收窄，如实标 partial 而不是假装通过', () => {
  const item = check('knowledge.read-not-domain-scoped');
  assert.equal(item.status, 'partial');
  assert.ok(String(item.note ?? '').includes('读隔离'));
});

test('验收：没有清单 / 评审者与产出方相同都判未就绪', () => {
  assert.equal(check('acceptance.not-ready-without-plan').status, 'ok');
  assert.equal(check('acceptance.reviewer-not-producer').status, 'ok');
  assert.equal(check('acceptance.no-approval-action').status, 'ok');
});

test('权限：四级角色单调，且 Agent 三档与职责对齐', () => {
  assert.equal(check('permission.role-monotonic').status, 'ok');
  assert.equal(check('permission.agent-tiers').status, 'ok');
  assert.equal(check('permission.knowledge-agent-scope').status, 'ok');
});

test('个性化：模型绑定校验 + 个人区独占 + 中文指令', () => {
  assert.equal(check('personal.model-binding-guarded').status, 'ok');
  assert.equal(check('personal.own-knowledge-space').status, 'ok');
  assert.equal(check('personal.chinese-commands').status, 'ok');
});

test('摘要按层给出 verdict，可用于控制台与交接文档', () => {
  const summary = layerSummary(report);
  assert.equal(summary.length, LAYERS.length);
  for (const entry of summary) {
    assert.ok(entry.checks.length > 0, `${entry.layer} 没有检查项`);
    assert.ok(['ok', 'partial', 'gap'].includes(entry.verdict));
  }
});
