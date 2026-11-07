// 方案 C-3 · 单一 Router 契约：层是配置、扁平 1 跳 / 分层最多 2 跳、
// 配置成环拒绝、快照不回溯、人签只在最后一跳、legacy 一字不改地回退。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routerConfigSchema, defaultRouterConfig, type RouterConfig } from '../src/config.ts';
import { planRoute, routerRevision, routedBy, planCoverage, Router, ROUTER_MODES,
  type RoutingRequest } from '../src/router.ts';
import { routingDecision, toMemoryEvent } from '../src/routing-decision.ts';
import { RoutingTrace, MemoryRoutingSink, replayRouting } from '../src/routing-trace.ts';
import { assessThreeTier } from '../src/three-tier-assessment.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const request = (overrides: Partial<RoutingRequest> = {}): RoutingRequest => ({
  taskId: 'SUI-300', stage: 'dispatch',
  caller: { actor: 'owner-a', role: 'personal', source: 'human' },
  target: { role: 'worker', agentKey: 'agent-a' },
  basis: { kind: 'user-command', evidence: ['message:om_1'] },
  scope: { allowedPaths: ['src/'], visibility: 'private' },
  idempotencyKey: 'trigger:om_300',
  at: '2026-11-07T01:00:00.000Z',
  ...overrides,
});

const flat = () => routerConfigSchema.parse({ schemaVersion: 1, mode: 'flat' });
const legacy = () => routerConfigSchema.parse({ schemaVersion: 1, mode: 'legacy' });
const layered = (extra: Record<string, unknown> = {}) => routerConfigSchema.parse({
  schemaVersion: 1, mode: 'layered', defaultDomain: 'product',
  domains: { product: { label: '产研', supervisorAgentKey: 'product-lead', personalAgentKey: 'my-assistant' } },
  ...extra,
});

test('组织形态是配置：默认 flat，三种模式，非法配置被拒绝', () => {
  assert.equal(defaultRouterConfig().mode, 'flat');
  assert.deepEqual([...ROUTER_MODES], ['legacy', 'flat', 'layered']);
  assert.throws(() => routerConfigSchema.parse({ schemaVersion: 1, mode: 'three-tier' }));
  assert.throws(() => routerConfigSchema.parse({ schemaVersion: 1, mode: 'layered', defaultDomain: 'ghost' }), /默认业务域必须/);
  assert.throws(() => routerConfigSchema.parse({ schemaVersion: 1, domains: {
    product: { label: '产研', supervisorAgentKey: 'same', personalAgentKey: 'same' } } }), /不得相同/);
  assert.throws(() => routerConfigSchema.parse({ schemaVersion: 1, maxHops: 3 }));
  assert.throws(() => routerConfigSchema.parse({ schemaVersion: 1, invented: true }));
  assert.equal(routerConfigSchema.parse({ schemaVersion: 1, mode: 'layered' }).maxHops, 2);
});

test('配置 revision 稳定且一变就变；历史决策带的是旧快照', () => {
  const a = layered(), b = layered();
  assert.equal(routerRevision(a), routerRevision(b));
  assert.notEqual(routerRevision(a), routerRevision(flat()));
  assert.notEqual(routerRevision(a), routerRevision(layered({ maxHops: 1 })));
  const old = planRoute(request(), a).hops[0]!;
  const changed = planRoute(request(), layered({ maxHops: 1 })).hops[0]!;
  assert.match(old.basis.evidence.join(' '), /router:layered@[0-9a-f]{12}/);
  assert.notEqual(old.basis.evidence.at(-1), changed.basis.evidence.at(-1), '配置变更后标记不同，历史不回溯改写');
});

test('legacy 一行回退：字段、decisionId 与改造前逐字一致', () => {
  const input = request();
  const before = routingDecision(input);
  const plan = planRoute(input, legacy());
  assert.equal(plan.hops.length, 1);
  assert.deepEqual(plan.hops[0], before);
  assert.equal(plan.blocked, null);
  assert.equal(routedBy(plan.hops[0]!), false, 'legacy 不冒充已经 Router 化');
});

test('flat：1 跳且幂等 id 不变，只追加配置快照证据', () => {
  const input = request();
  const plan = planRoute(input, flat());
  assert.equal(plan.hops.length, 1);
  assert.equal(plan.hops[0]!.decisionId, routingDecision(input).decisionId, '收敛入口不能改变既有幂等键');
  assert.equal(routedBy(plan.hops[0]!), true);
  assert.deepEqual(plan.hops[0]!.basis.evidence, ['message:om_1', plan.hops[0]!.basis.evidence[1]]);
  assert.equal(plan.domain, null);
});

test('layered：2 跳，causedBy 串成链，人签只在最后一跳', () => {
  const plan = planRoute(request({ requiresHumanSignature: true, signatureReason: '最终业务验收' }), layered());
  assert.equal(plan.hops.length, 2);
  assert.equal(plan.supervisorAgentKey, 'product-lead');
  const [hop1, hop2] = plan.hops;
  assert.equal(hop1!.target.role, 'supervisor');
  assert.equal(hop1!.target.agentKey, 'product-lead');
  assert.equal(hop1!.requiresHumanSignature, false, '内部分发不能替人签字');
  assert.equal(hop2!.caller.role, 'supervisor');
  assert.equal(hop2!.caller.actor, 'product-lead');
  assert.equal(hop2!.target.agentKey, 'agent-a', '最终承接人不变');
  assert.equal(hop2!.requiresHumanSignature, true);
  assert.equal(hop2!.signatureReason, '最终业务验收');
  assert.equal(hop2!.causedBy, hop1!.decisionId, '第二跳由第一跳因果触发');
  assert.notEqual(hop1!.decisionId, hop2!.decisionId);
  assert.ok(plan.hops.every(routedBy));
});

test('分层不是硬造管理层：无主管业务域、maxHops=1、主管即承接人、未提交决策都退回 1 跳', () => {
  const cases: [string, RouterConfig, Partial<RoutingRequest>][] = [
    ['未登记业务域', layered(), { domain: 'growth' }],
    ['maxHops=1', layered({ maxHops: 1 }), {}],
    ['主管即承接人', layered(), { target: { role: 'worker', agentKey: 'product-lead' } }],
    ['被拒绝', layered(), { outcome: 'rejected' }],
    ['待定', layered(), { outcome: 'pending' }],
  ];
  for (const [name, cfg, overrides] of cases) {
    const plan = planRoute(request(overrides), cfg);
    assert.equal(plan.hops.length, 1, name + ' 应为 1 跳');
    assert.ok(plan.degraded, name + ' 必须如实标注降级原因');
    if (overrides.outcome) assert.equal(plan.hops[0]!.outcome, overrides.outcome, name + ' 不得把结果改成 committed');
  }
});

test('同一 Task 自派自验自环被拦，并写一条 rejected 决策留痕', () => {
  const cases: [string, Partial<RoutingRequest>][] = [
    ['调用方就是主管', { caller: { actor: 'product-lead', role: 'personal', source: 'human' } }],
    ['调用方就是承接人', { caller: { actor: 'agent-a', role: 'personal', source: 'human' } }],
  ];
  for (const [name, overrides] of cases) {
    const plan = planRoute(request(overrides), layered());
    assert.ok(plan.blocked, name + ' 必须被拦');
    assert.equal(plan.hops.length, 1, name + ' 拦截也要留痕');
    assert.equal(plan.hops[0]!.outcome, 'rejected');
    assert.match(plan.hops[0]!.basis.evidence.join(' '), /router:blocked:/);
    assert.equal(routedBy(plan.hops[0]!), true);
  }
});

test('planRoute 是纯函数：同输入同配置两次产出完全一致', () => {
  const cfg = layered();
  const a = planRoute(request(), cfg), b = planRoute(request(), cfg);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(planRoute(request(), cfg)), JSON.stringify(b));
});

test('Router 是唯一写入口：全部 hop 进同一份 Trace，重放可复现', () => {
  const sink = new MemoryRoutingSink();
  const trace = new RoutingTrace([sink]);
  const router = new Router(layered(), trace);
  const result = router.route(request());
  assert.equal(result.written, 2);
  assert.equal(sink.lines.length, 2);
  const events = sink.lines.map(line => JSON.parse(line));
  const p1 = replayRouting(events), p2 = replayRouting(sink.lines.map(line => JSON.parse(line)));
  assert.deepEqual(p1, p2);
  assert.equal(p1.decisions, 2);
  assert.equal(planCoverage(events).singleRouterEntry, true);
  // 日志坏掉也不改业务结果。
  const broken = new Router(layered(), new RoutingTrace([{ write: () => { throw new Error('disk full'); } }]));
  assert.equal(broken.route(request()).written, 0);
});

test('p6 按真实 Trace 证据判定，不靠开关假装完成', () => {
  const plain = [toMemoryEvent(routingDecision(request()))];
  assert.equal(assessThreeTier(plain).prerequisites.find(p => p.id === 'p6-single-router')!.satisfied, false);
  const routed = planRoute(request(), flat()).hops.map(toMemoryEvent);
  const assessment = assessThreeTier(routed, replayRouting(routed));
  assert.equal(assessment.observed.singleRouterEntry, true);
  assert.equal(assessment.prerequisites.find(p => p.id === 'p6-single-router')!.satisfied, true);
  assert.equal(assessment.recommended, false, 'p8 未落地，防跳级闸门不能放开');
  assert.equal(planCoverage([]).singleRouterEntry, false, '空日志不算完成');
  // C-3 发现：只按角色名判定 P3/P4 时，合成数据就能凑齐前置条件；
  // p8 要求 Agent 实例 + 分层配置，C-4/C-5 之前恒为 false。
  const gate = assessment.prerequisites.find(p => p.id === 'p8-agent-bindings')!;
  assert.equal(gate.satisfied, false);
  const flatShape = assessThreeTier(routed, replayRouting(routed), [], { agentBindings: 3, routerMode: 'flat', configuredDomains: 0 });
  assert.equal(flatShape.prerequisites.find(p => p.id === 'p8-agent-bindings')!.satisfied, false, '扁平配置不得要求出现主管');
  const bound = assessThreeTier(routed, replayRouting(routed), [], { agentBindings: 3, routerMode: 'layered', configuredDomains: 1 });
  assert.equal(bound.prerequisites.find(p => p.id === 'p8-agent-bindings')!.satisfied, true, 'C-4/C-5 落地后可由调用方传入真实绑定');
});

test('接线完整：9 处派活点经 Router、服务端装配、状态视图可见', () => {
  const files = ['src/controller.ts', 'src/coordination.ts', 'src/assistant.ts', 'src/service-network.ts', 'src/v06.ts'];
  const total = files.reduce((n, f) => n + (read(f).match(/getRouter\(\)\.route\(/g) ?? []).length, 0);
  assert.equal(total, 9);
  assert.match(read('src/server.ts'), /configureRouter\(config\.router\)/);
  assert.match(read('src/server.ts'), /router:getRouter\(\)\.status\(\)/);
  assert.match(read('console/app.js'), /组织形态/);
  assert.match(read('scripts/router-smoke.ts'), /flat|layered/);
});
