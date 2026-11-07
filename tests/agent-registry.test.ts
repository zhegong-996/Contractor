// 方案 C-4 · 组织级 Agent 注册表契约：
// 层是配置不是骨架、职责槽位可扩展、允许兼任但同一 Task 不得自派自验自环、
// 生效范围 / 版本 / 快照全部由确定性工程层判定（modelCalls=0）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentRegistrySchema, defaultAgentRegistry, agentVersion, registryRevision,
  scopeCovers, onDuty, resolveAssignment, selfReviewConflict, assertNoSelfReview,
  handoffEnvelope, registrySummary, reviewCrew, BUILTIN_RESPONSIBILITIES,
  REVIEW_RED_LINES, getAgentRegistry, configureAgentRegistry, setAgentRegistry,
  type AgentRegistry } from '../src/agent-registry.ts';
import { routerConfigSchema } from '../src/config.ts';
import { planRoute, routedBy, ROUTER_MARK, type RoutingRequest } from '../src/router.ts';
import { assessThreeTier } from '../src/three-tier-assessment.ts';
import { replayRouting } from '../src/routing-trace.ts';
import { toMemoryEvent } from '../src/routing-decision.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const build = (agents: unknown[]): AgentRegistry =>
  agentRegistrySchema.parse({ schemaVersion: 1, agents });
const productCrew = () => build([
  { key: 'my-assistant', label: '我的助手', responsibilities: ['personal', 'inspection'], domains: ['*'] },
  { key: 'product-lead', label: '产研主管', responsibilities: ['supervisor', 'worker'], domains: ['product'] },
  { key: 'tech-agent', label: '技术助手', responsibilities: ['worker', 'tech'], domains: ['product'] },
  { key: 'qa-agent', label: '验收助手', responsibilities: ['acceptance', 'standard-drafting'], domains: ['*'] },
  { key: 'ops-agent', label: '运营助手', responsibilities: ['growth'], domains: ['growth'] },
]);
const request = (overrides: Partial<RoutingRequest> = {}): RoutingRequest => ({
  taskId: 'SUI-400', stage: 'dispatch',
  caller: { actor: 'owner-a', role: 'personal', source: 'human' },
  target: { role: 'worker', agentKey: 'agent-a' },
  basis: { kind: 'user-command', evidence: ['message:om_400'] },
  scope: { visibility: 'private' },
  idempotencyKey: 'trigger:om_400',
  at: '2026-11-07T01:00:00.000Z',
  ...overrides,
});
const layered = () => routerConfigSchema.parse({
  schemaVersion: 1, mode: 'layered', defaultDomain: 'product',
  domains: { product: { label: '产研', supervisorAgentKey: 'product-lead', personalAgentKey: 'my-assistant' } },
});

test('默认是空注册表：扁平小团队不硬造管理层', () => {
  const empty = defaultAgentRegistry();
  assert.deepEqual(empty.agents, []);
  assert.equal(registrySummary(empty).onDuty, 0);
  assert.match(registrySummary(empty).shape, /不硬造管理层/);
  assert.ok(BUILTIN_RESPONSIBILITIES.includes('acceptance'), '验收是一等公民职责槽位');
});

test('schema：职责槽位可扩展，但重复 / 范围歧义 / 重复标识一律拒绝', () => {
  assert.doesNotThrow(() => build([{ key: 'x', label: '专项', responsibilities: ['sales-enablement'] }]));
  assert.throws(() => build([{ key: 'x', label: '专项', responsibilities: ['worker', 'worker'] }]), /职责不能重复/);
  assert.throws(() => build([{ key: 'x', label: '专项', responsibilities: ['worker'], domains: ['*', 'product'] }]), /范围歧义/);
  assert.throws(() => build([
    { key: 'x', label: '甲', responsibilities: ['worker'] }, { key: 'x', label: '乙', responsibilities: ['worker'] },
  ]), /标识不能重复/);
  assert.throws(() => build([{ key: 'X', label: '大写', responsibilities: ['worker'] }]), /标识只允许/);
  assert.equal(build([{ key: 'x', label: '专项', responsibilities: ['worker'] }]).agents[0]!.enabled, true);
});

test('版本与配置快照只看内容：键序无关、备注不影响、职责一变就变', () => {
  const a = productCrew(), b = build([...productCrew().agents].reverse());
  assert.equal(registryRevision(a), registryRevision(b), '键序不影响快照');
  assert.equal(registryRevision(a), registryRevision({ ...a, updatedAt: '2026-11-08' }), '只改备注不算配置变更');
  const changed = build(productCrew().agents.map(x =>
    x.key === 'product-lead' ? { ...x, responsibilities: ['supervisor'] } : x));
  assert.notEqual(registryRevision(a), registryRevision(changed));
  assert.equal(agentVersion(a.agents[0]!), agentVersion(b.agents.find(x => x.key === a.agents[0]!.key)!));
  const disabled = build(productCrew().agents.map(x =>
    x.key === 'product-lead' ? { ...x, enabled: false } : x));
  assert.notEqual(registryRevision(a), registryRevision(disabled), '停用也是配置变更');
  assert.equal(onDuty(disabled).length, 4);
});

test('生效范围：全域覆盖所有业务域，具体域只覆盖自己；组织级任务只认全域', () => {
  const reg = productCrew();
  const lead = reg.agents.find(a => a.key === 'product-lead')!;
  const personal = reg.agents.find(a => a.key === 'my-assistant')!;
  assert.equal(scopeCovers(lead, 'product'), true);
  assert.equal(scopeCovers(lead, 'growth'), false);
  assert.equal(scopeCovers(lead, null), false);
  assert.equal(scopeCovers(personal, 'growth'), true);
  assert.equal(scopeCovers(personal, null), true);
});

test('resolveAssignment 是确定性工程层：职责 + 范围 + 责任链排除，modelCalls=0', () => {
  const reg = productCrew();
  const supervisor = resolveAssignment(reg, { taskId: 'T1', responsibility: 'supervisor', domain: 'product' });
  assert.equal(supervisor.agentKey, 'product-lead');
  assert.equal(supervisor.modelCalls, 0);
  assert.equal(supervisor.version, agentVersion(reg.agents.find(a => a.key === 'product-lead')!));
  assert.equal(resolveAssignment(reg, { taskId: 'T1', responsibility: 'supervisor', domain: 'growth' }).agentKey, null);
  assert.equal(resolveAssignment(defaultAgentRegistry(), { taskId: 'T1', responsibility: 'supervisor' }).agentKey, null);
  assert.equal(resolveAssignment(reg, { taskId: 'T1', responsibility: 'tech', domain: 'product' }).agentKey, 'tech-agent',
    '自定义职责同样可被解析');
  assert.deepEqual(resolveAssignment(reg, { taskId: 'T1', responsibility: 'supervisor', domain: 'product' }), supervisor);
});

test('产出方与责任链排除：独立评审者不得等于产出方，同一 Task 不得自派自验自环', () => {
  const reg = productCrew();
  assert.equal(resolveAssignment(reg, { taskId: 'T1', responsibility: 'acceptance', producedBy: 'qa-agent' }).agentKey, null);
  assert.equal(resolveAssignment(reg, { taskId: 'T1', responsibility: 'acceptance', usedKeys: ['qa-agent'] }).agentKey, null);
  assert.equal(resolveAssignment(reg, { taskId: 'T1', responsibility: 'acceptance', producedBy: 'tech-agent' }).agentKey, 'qa-agent');
  assert.match(selfReviewConflict({ taskId: 'T1', candidate: 'qa-agent', producer: 'qa-agent' }) ?? '', /不能自验/);
  assert.match(selfReviewConflict({ taskId: 'T1', candidate: 'qa-agent', usedKeys: ['qa-agent'] }) ?? '', /自派自验自环/);
  assert.equal(selfReviewConflict({ taskId: 'T1', candidate: 'qa-agent' }), null);
  assert.throws(() => assertNoSelfReview({ taskId: 'T1', candidate: 'qa-agent', producer: 'qa-agent' }), /自派自验自环/);
});

test('版本漂移：期望版本不一致的候选视为不合格，不静默用旧编制', () => {
  const reg = productCrew();
  const lead = reg.agents.find(a => a.key === 'product-lead')!;
  const ok = resolveAssignment(reg, { taskId: 'T1', responsibility: 'supervisor', domain: 'product',
    expectedVersion: agentVersion(lead) });
  assert.equal(ok.agentKey, 'product-lead');
  const drift = resolveAssignment(reg, { taskId: 'T1', responsibility: 'supervisor', domain: 'product',
    expectedVersion: 'deadbeef0000' });
  assert.equal(drift.agentKey, null);
  assert.match(drift.reason, /版本一致/);
});

test('A2A handoff：交接引用与范围，不搬运正文；不合格如实返回原因', () => {
  const reg = productCrew();
  const input = { taskId: 'T1', from: 'my-assistant', to: 'product-lead', responsibility: 'supervisor',
    domain: 'product', sourceIds: ['src-1', 'src-2'], causedBy: 'T1:hop1' };
  const ok = handoffEnvelope(reg, input);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.scope.sourceIds, ['src-1', 'src-2']);
  assert.equal(ok.scope.domain, 'product');
  assert.equal(ok.scope.agentVersion, ok.agentVersion);
  assert.equal(ok.causedBy, 'T1:hop1');
  assert.equal(ok.modelCalls, 0);
  assert.ok(!('content' in ok.scope) && !('body' in ok.scope), '交接的是引用与范围，不搬运资料正文');
  assert.match(handoffEnvelope(reg, { ...input, to: 'my-assistant', from: 'my-assistant' }).reason!, /同一主体/);
  assert.match(handoffEnvelope(reg, { ...input, to: 'ghost' }).reason!, /未在组织注册表在岗/);
  assert.match(handoffEnvelope(reg, { ...input, responsibility: 'acceptance' }).reason!, /未绑定/);
  assert.match(handoffEnvelope(reg, { ...input, domain: 'growth' }).reason!, /生效范围/);
  assert.match(handoffEnvelope(reg, { ...input, expectedVersion: 'deadbeef0000' }).reason!, /版本已变化/);
  assert.match(handoffEnvelope(reg, { ...input, usedKeys: ['product-lead'] }).reason!, /责任链/);
});

test('验收编组：逐项判定 / 标准起草 / 周期巡检互不重复，红线不变', () => {
  const reg = productCrew();
  const crew = reviewCrew(reg, { taskId: 'T1', producedBy: 'tech-agent' });
  assert.equal(crew.configured, true);
  assert.equal(crew.reviewer.agentKey, 'qa-agent');
  assert.equal(crew.standardDrafter.agentKey, null, '同一 Task 不得由同一 Agent 既判定又起草标准');
  assert.equal(crew.inspector.agentKey, 'my-assistant');
  assert.equal(crew.modelCalls, 0);
  assert.deepEqual(crew.redLines, [...REVIEW_RED_LINES]);
  assert.ok(crew.collaborators.some(c => c.responsibility === 'tech'), '与自定义职责 Agent 协作');
  assert.ok(crew.collaborators.every(c => c.assignment.agentKey !== 'tech-agent'), '产出方不进入验收编组');
  const emptyCrew = reviewCrew(defaultAgentRegistry(), { taskId: 'T1' });
  assert.equal(emptyCrew.configured, false);
  assert.match(emptyCrew.degraded!, /不硬造验收 Agent/);
  assert.equal(emptyCrew.reviewer.agentKey, null);
  const noReviewer = reviewCrew(reg, { taskId: 'T1', producedBy: 'qa-agent' });
  assert.equal(noReviewer.reviewer.agentKey, null);
  assert.match(noReviewer.degraded!, /没有合格的独立验收 Agent/);
});

test('编制摘要：自定义职责标记为非内置，分层形态如实可辨', () => {
  const summary = registrySummary(productCrew());
  assert.equal(summary.onDuty, 5);
  assert.equal(summary.responsibilities.find(r => r.id === 'tech')!.builtin, false);
  assert.equal(summary.responsibilities.find(r => r.id === 'acceptance')!.onDuty, 1);
  assert.match(summary.shape, /按业务域配置中间决策层/);
  const flat = registrySummary(build([{ key: 'a', label: '执行者', responsibilities: ['worker'] }]));
  assert.match(flat.shape, /无中间决策层/);
});

test('Router 接线：C-3 不传注册表逐字等价，C-4 传注册表才校验在岗', () => {
  const cfg = layered();
  const before = planRoute(request(), cfg);
  assert.equal(before.hops.length, 2);
  assert.equal(before.registryRevision, null);
  const empty = planRoute(request(), cfg, defaultAgentRegistry());
  assert.equal(empty.hops.length, 1);
  assert.match(empty.degraded!, /未在组织注册表在岗/);
  assert.equal(empty.registryRevision, registryRevision(defaultAgentRegistry()));
  const onDutyPlan = planRoute(request(), cfg, productCrew());
  assert.equal(onDutyPlan.hops.length, 2);
  assert.ok(onDutyPlan.hops.every(routedBy), '注册表快照不能破坏 Router 标记');
  assert.ok(onDutyPlan.hops[0]!.basis.evidence.some(e => e.startsWith('agents:')));
  assert.match(onDutyPlan.hops[0]!.basis.evidence.at(-1)!, ROUTER_MARK, '最后一个证据仍是 Router 配置快照');
  const wrong = planRoute(request(), cfg, build(productCrew().agents.map(a =>
    a.key === 'product-lead' ? { ...a, responsibilities: ['worker'] } : a)));
  assert.equal(wrong.hops.length, 1);
  assert.match(wrong.degraded!, /未绑定主管职责/);
  const scope = planRoute(request(), cfg, build(productCrew().agents.map(a =>
    a.key === 'product-lead' ? { ...a, domains: ['growth'] } : a)));
  assert.equal(scope.hops.length, 1);
  assert.match(scope.degraded!, /生效范围不覆盖/);
});

test('配置快照不回溯：改编制后新旧决策各带自己的 revision', () => {
  const cfg = layered();
  const old = planRoute(request(), cfg, productCrew());
  const changed = build(productCrew().agents.map(a =>
    a.key === 'qa-agent' ? { ...a, enabled: false } : a));
  const next = planRoute(request(), cfg, changed);
  assert.notEqual(old.registryRevision, next.registryRevision);
  assert.notEqual(old.hops[0]!.basis.evidence.find(e => e.startsWith('agents:')),
    next.hops[0]!.basis.evidence.find(e => e.startsWith('agents:')));
  assert.equal(planRoute(request(), cfg, productCrew()).hops[0]!.decisionId, old.hops[0]!.decisionId,
    '同配置重放得到同一决策，历史决策不被回溯改写');
});

test('p8 闸门用真实在岗数：默认空编制仍为 false，扁平配置不要求出现主管', () => {
  const events = planRoute(request(), routerConfigSchema.parse({ schemaVersion: 1, mode: 'flat' })).hops.map(toMemoryEvent);
  const empty = assessThreeTier(events, replayRouting(events), [],
    { agentBindings: onDuty(defaultAgentRegistry()).length, routerMode: 'flat', configuredDomains: 0 });
  assert.equal(empty.prerequisites.find(p => p.id === 'p8-agent-bindings')!.satisfied, false);
  assert.equal(empty.recommended, false);
  const bound = assessThreeTier(events, replayRouting(events), [],
    { agentBindings: onDuty(productCrew()).length, routerMode: 'layered', configuredDomains: 1 });
  assert.equal(bound.prerequisites.find(p => p.id === 'p8-agent-bindings')!.satisfied, true);
});

test('单例装配：服务端显式配置后，Router / A2A / 验收共用同一份编制', () => {
  setAgentRegistry(null);
  assert.equal(getAgentRegistry().agents.length, 0);
  configureAgentRegistry(productCrew());
  assert.equal(onDuty(getAgentRegistry()).length, 5);
  setAgentRegistry(null);
  const server = read('src/server.ts');
  assert.match(server, /configureAgentRegistry\(config\.agentRegistry\)/);
  assert.match(server, /configureRouter\(config\.router, undefined, getAgentRegistry\(\)\)/);
  assert.match(read('src/service-network.ts'), /handoffEnvelope\(/);
  assert.match(read('src/v06.ts'), /case 'agent-registry-view'/);
  assert.match(read('src/v06.ts'), /case 'acceptance-crew'/);
  assert.match(read('console/app.js'), /card\('Agent 编制'/);
  assert.match(read('scripts/console-server.ts'), /'v06-agent-registry-view'/);
  assert.match(read('src/config.ts'), /agentRegistry: agentRegistrySchema\.default/);
});
