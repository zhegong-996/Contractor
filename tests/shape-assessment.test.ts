// 方案 C-5 · 按当前配置重跑三层评估的契约：
// 扁平不要求主管、分层主管必须真实在岗、防跳级闸门不因合成数据转绿、
// 「形态闭环」与「启用三层」分开表述、服务端 / CLI / 控制台接线不漂移。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routerConfigSchema, type RouterConfig } from '../src/config.ts';
import { Router, type RoutingRequest } from '../src/router.ts';
import { RoutingTrace, MemoryRoutingSink, replayRouting } from '../src/routing-trace.ts';
import { assessThreeTier, shapeOptions, ORG_SHAPE_LABELS, type ThreeTierAssessment } from '../src/three-tier-assessment.ts';
import { agentRegistrySchema, defaultAgentRegistry, type AgentRegistry } from '../src/agent-registry.ts';
import type { MemoryEvent } from '../src/architecture-contracts.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const prerequisite = (a: ThreeTierAssessment, id: string) => a.prerequisites.find(p => p.id === id)!;

const flat = () => routerConfigSchema.parse({ schemaVersion: 1, mode: 'flat' });
const layered = (supervisorAgentKey = 'product-lead') => routerConfigSchema.parse({
  schemaVersion: 1, mode: 'layered', defaultDomain: 'product', maxHops: 2,
  domains: { product: { label: '产研', supervisorAgentKey, personalAgentKey: 'my-assistant' } },
});
const crew = (dropPersonal = false): AgentRegistry => agentRegistrySchema.parse({
  schemaVersion: 1,
  agents: [
    ...(dropPersonal ? [] : [{ key: 'my-assistant', label: '个人助手', responsibilities: ['personal'], domains: ['*'] }]),
    { key: 'product-lead', label: '产研主管助手', responsibilities: ['supervisor'], domains: ['product'] },
    { key: 'worker-a', label: '执行助手', responsibilities: ['worker'], domains: ['product'] },
    { key: 'qa-agent', label: '验收助手', responsibilities: ['acceptance'], domains: ['*'] },
  ],
});

/** 一单走完五个派活阶段，只写隔离内存 Trace；时间固定，可重复重放。 */
function runOne(config: RouterConfig, registry: AgentRegistry = defaultAgentRegistry()) {
  const sink = new MemoryRoutingSink();
  const router = new Router(config, new RoutingTrace([sink]), registry);
  const stages = ['intake', 'admission', 'dispatch', 'delegation', 'transfer'] as const;
  const plans = stages.map((stage, i) => {
    const request: RoutingRequest = {
      taskId: 'SUI-500', stage,
      caller: { actor: 'owner-a', role: 'personal', source: 'human' },
      target: { role: 'worker', agentKey: 'worker-a' },
      basis: { kind: 'user-command', evidence: [`message:om_${i}`] },
      scope: { visibility: 'private' }, outcome: 'committed',
      idempotencyKey: `SUI-500:${stage}`,
      at: `2026-11-08T01:00:0${i}.000Z`,
      ...(i === 0 ? { requiresHumanSignature: true,
        signatureReason: '最终业务验收只能由原发起人在原会话确认' } : {}),
    };
    return router.route(request);
  });
  const events = sink.lines.map(line => JSON.parse(line)) as MemoryEvent[];
  return { router, plans, events, projection: replayRouting(events) };
}
const assessmentOf = (config: RouterConfig, registry: AgentRegistry) => {
  const run = runOne(config, registry);
  return assessThreeTier(run.events, run.projection, [], shapeOptions(run.router, registry));
};

test('shapeOptions 只从当前真实 Router 配置与在岗编制取口径', () => {
  const flatRun = runOne(flat());
  const flatOptions = shapeOptions(flatRun.router, defaultAgentRegistry());
  assert.equal(flatOptions.routerMode, 'flat');
  assert.equal(flatOptions.configuredDomains, 0);
  assert.equal(flatOptions.agentBindings, 0);
  assert.deepEqual(flatOptions.dutySupervisors, []);
  const layeredRun = runOne(layered(), crew());
  const options = shapeOptions(layeredRun.router, crew());
  assert.equal(options.routerMode, 'layered');
  assert.equal(options.configuredDomains, 1);
  assert.equal(options.agentBindings, crew().agents.length);
  assert.ok(options.configuredSupervisors?.includes('product-lead'));
  assert.ok(options.dutySupervisors?.includes('product-lead'));
  assert.ok(options.dutyPersonals?.includes('my-assistant'));
  assert.equal(ORG_SHAPE_LABELS.flat, '扁平（1 跳）');
});

test('扁平配置：P3 / P4 按直达派活判定，不要求出现主管', () => {
  const a = assessmentOf(flat(), defaultAgentRegistry());
  assert.equal(a.shape.mode, 'flat');
  assert.equal(prerequisite(a, 'p3-personal-entry').satisfied, true);
  assert.match(prerequisite(a, 'p3-personal-entry').label, /不要求独立的 Personal Agent 实体/);
  assert.equal(prerequisite(a, 'p4-supervisor-dispatch').satisfied, true);
  assert.match(prerequisite(a, 'p4-supervisor-dispatch').label, /不要求主管/);
  assert.ok(a.observed.directDispatches > 0);
  assert.equal(a.observed.boundSupervisorDispatches, 0);
  assert.match(prerequisite(a, 'p4-supervisor-dispatch').evidence, /不参与本形态判定/);
});

test('扁平配置：形态按配置闭环，但绝不因此建议启用三层', () => {
  const a = assessmentOf(flat(), defaultAgentRegistry());
  assert.equal(a.shape.ready, true);
  assert.equal(a.recommended, false);
  assert.equal(a.coverage, 7 / 8);
  assert.match(a.verdict, /本形态不需要三层/);
  assert.ok(a.shape.applicable.includes('p3-personal-entry'));
  assert.ok(!a.shape.applicable.includes('p8-agent-bindings'), 'p8 是跳级闸门，不是扁平形态的缺口');
  assert.match(prerequisite(a, 'p8-agent-bindings').evidence, /防跳级闸门/);
  assert.ok(a.reasons.some(r => r.includes('不要求出现主管')));
});

test('分层配置：P3 要求在岗 Personal Agent，P4 核对配置登记 + 真实在岗主管', () => {
  const a = assessmentOf(layered(), crew());
  assert.equal(prerequisite(a, 'p3-personal-entry').satisfied, true);
  assert.equal(prerequisite(a, 'p4-supervisor-dispatch').satisfied, true);
  assert.equal(a.observed.boundSupervisorDispatches, 5);
  assert.match(prerequisite(a, 'p4-supervisor-dispatch').evidence, /product-lead/);
  const noPersonal = assessmentOf(layered(), crew(true));
  assert.equal(prerequisite(noPersonal, 'p3-personal-entry').satisfied, false,
    '删掉在岗个人助手后，分层形态的人机入口条件不成立');
});

test('分层配置：八项前置条件齐备才可按配置启用三层', () => {
  const a = assessmentOf(layered(), crew());
  assert.equal(a.shape.ready, true);
  assert.equal(a.recommended, true);
  assert.equal(a.coverage, 1);
  assert.equal(prerequisite(a, 'p8-agent-bindings').satisfied, true);
  assert.ok(a.shape.applicable.includes('p8-agent-bindings'));
  assert.match(a.verdict, /可按配置启用三层汇报/);
  assert.ok(a.reasons.some(r => r.includes('真实在岗职责')));
});

test('防跳级：只有角色名、没有真实编制不能凑齐分层 P4', () => {
  const run = runOne(layered(), crew());
  const synthetic = assessThreeTier(run.events, run.projection, [],
    { routerMode: 'layered', agentBindings: 4, configuredDomains: 1, configuredSupervisors: ['product-lead'] });
  assert.equal(prerequisite(synthetic, 'p4-supervisor-dispatch').satisfied, false);
  assert.equal(synthetic.recommended, false);
});

test('防跳级：扁平配置即使有在岗 Agent 也不放行三层', () => {
  const a = assessmentOf(flat(), crew());
  assert.equal(a.shape.mode, 'flat');
  assert.equal(a.recommended, false);
  assert.equal(prerequisite(a, 'p8-agent-bindings').satisfied, false);
  assert.equal(a.observed.boundSupervisorDispatches, 0);
});

test('防跳级：配置的主管不在岗时降级 1 跳，分层 P4 不成立', () => {
  const run = runOne(layered('ghost-lead'), crew());
  assert.ok(run.plans.every(plan => plan.hops.length === 1 && Boolean(plan.degraded)));
  const a = assessThreeTier(run.events, run.projection, [], shapeOptions(run.router, crew()));
  assert.equal(prerequisite(a, 'p4-supervisor-dispatch').satisfied, false);
  assert.equal(a.recommended, false);
});

test('未声明配置时退回最保守固定口径，保持旧调用向后兼容', () => {
  const run = runOne(layered(), crew());
  const a = assessThreeTier(run.events, run.projection, []);
  assert.equal(a.shape.mode, 'unspecified');
  assert.equal(a.shape.ready, false);
  assert.equal(a.recommended, false);
  assert.match(a.verdict, /暂不引入/);
  assert.ok(a.reasons.some(r => r.includes('玉伯')));
  assert.ok(a.reasons.some(r => r.includes('Community License')));
  assert.equal(typeof a.observed.directDispatches, 'number');
  assert.equal(typeof a.observed.boundSupervisorDispatches, 'number');
});

test('接线：服务端 / CLI 用 shapeOptions，控制台显示白话结论，真跑脚本登记在案', () => {
  assert.match(read('src/server.ts'), /shapeOptions\(getRouter\(\),getAgentRegistry\(\)\)/);
  assert.match(read('scripts/routing-status.ts'), /shapeOptions\(getRouter\(\), getAgentRegistry\(\)\)/);
  // P-12：Vue 前端以组织形态卡片呈现（el-descriptions 标签）。
  assert.match(read('console/app.js'), /形态判定/);
  assert.match(read('console/app.js'), /三层结论/);
  assert.match(read('console/app.js'), /当前形态不需要三层，不硬造管理层/);
  assert.match(read('package.json'), /"shapes:smoke": "node --import tsx scripts\/shapes-smoke\.ts"/);
  const smoke = read('scripts/shapes-smoke.ts');
  assert.match(smoke, /new MemoryRoutingSink\(\)/);
  assert.match(smoke, /logLines\(\) === beforeLines/, '真跑必须自证未写真实路由日志');
  assert.match(smoke, /扁平 \/ 分层两种组织配置各跑/);
});
