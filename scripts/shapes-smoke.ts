// 方案 C-5 真跑：扁平 / 分层两种组织配置各跑「真实一单」，Trace 每步可回放。
//
// 与 C-3 的 router:smoke 不同：这里不再只验证跳数，而是把 C-4 的真实在岗
// Agent 编制、单一 Router 配置快照、三层评估按配置判定放在同一条链路上验证。
// 结论必须同时成立：
//   - 扁平配置跑得好 → shape.ready=true，但 recommended 仍 false（不逼小团队硬造管理层）；
//   - 分层配置 + 真实在岗主管跑得好 → recommended=true（按配置启用三层，不是「建议所有团队升级」）；
//   - 只有角色名、没有真实编制的合成数据不能凑齐 P3 / P4。
//
// 绝不写真实 .runtime/routing/events.jsonl；报告落在 .runtime/shapes-smoke.json。
// 用法：npm run shapes:smoke
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runtime, routerConfigSchema, type RouterConfig } from '../src/config.ts';
import { Router, planCoverage, routerRevision, ROUTER_MARK, type RoutingRequest } from '../src/router.ts';
import { RoutingTrace, MemoryRoutingSink, replayRouting } from '../src/routing-trace.ts';
import { decisionOf } from '../src/routing-decision.ts';
import { assessThreeTier, shapeOptions } from '../src/three-tier-assessment.ts';
import { agentRegistrySchema, defaultAgentRegistry, onDuty, registryRevision, type AgentRegistry } from '../src/agent-registry.ts';
import type { MemoryEvent } from '../src/architecture-contracts.ts';

type Check = { name: string; ok: boolean; detail: Record<string, unknown> };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: Record<string, unknown> = {}) => checks.push({ name, ok, detail });
const p = (id: string) => (a: ReturnType<typeof assessThreeTier>) => a.prerequisites.find(x => x.id === id)!;

/** 与 controller / coordination / assistant / service-network / v06 对齐的五阶段真实意图。固定时间，不读时钟。 */
function requestsFor(taskId: string): RoutingRequest[] {
  return [
    { taskId, stage: 'intake', caller: { actor: 'owner-a', role: 'personal', source: 'human' },
      target: { role: 'worker', agentKey: 'worker-a' }, basis: { kind: 'user-command', evidence: ['message:om_510'] },
      scope: { visibility: 'private' }, requiresHumanSignature: true,
      signatureReason: '最终业务验收只能由原发起人在原会话确认',
      idempotencyKey: `${taskId}:intake`, at: '2026-11-08T01:00:00.000Z' },
    { taskId, stage: 'admission', caller: { actor: 'scoped-preparation', role: 'supervisor', source: 'superagent-policy' },
      target: { role: 'worker', agentKey: 'workspace-assistant' }, basis: { kind: 'policy', evidence: ['ready', 'enabled:true'] },
      scope: { visibility: 'private' }, outcome: 'committed',
      idempotencyKey: `${taskId}:admission`, at: '2026-11-08T01:00:01.000Z' },
    { taskId, stage: 'dispatch', caller: { actor: 'owner-a', role: 'personal', source: 'human' },
      target: { role: 'worker', agentKey: 'worker-a' }, basis: { kind: 'user-command', evidence: ['1 条业务验收项'] },
      scope: { allowedPaths: ['src/'], visibility: 'private' },
      idempotencyKey: `${taskId}:dispatch`, at: '2026-11-08T01:00:02.000Z' },
    { taskId, stage: 'delegation', caller: { actor: 'agent-a', role: 'supervisor', source: 'a2a-sdk' },
      target: { role: 'worker', serviceId: 'review-service', agentKey: 'reviewer-b' },
      basis: { kind: 'service-route', evidence: ['goal:独立评审', 'version:v1'] },
      scope: { sourceIds: ['src-1'], visibility: 'space' }, outcome: 'committed',
      idempotencyKey: `${taskId}:delegation`, at: '2026-11-08T01:00:03.000Z' },
    { taskId, stage: 'transfer', caller: { actor: 'owner-a', role: 'personal', source: 'human' },
      target: { role: 'worker', agentKey: 'worker-c' }, basis: { kind: 'transfer', evidence: ['generation:2'] },
      scope: { visibility: 'private' },
      idempotencyKey: `${taskId}:transfer`, at: '2026-11-08T01:00:04.000Z' },
  ];
}

const flatConfig = routerConfigSchema.parse({ schemaVersion: 1, mode: 'flat' });
const layeredConfig = routerConfigSchema.parse({
  schemaVersion: 1, mode: 'layered', defaultDomain: 'product', maxHops: 2,
  domains: {
    product: { label: '产研', supervisorAgentKey: 'product-lead', personalAgentKey: 'my-assistant' },
    growth: { label: '增长运营', supervisorAgentKey: 'growth-lead' },
  },
});
/** 真实在岗编制：个人助手 / 业务域主管 / 执行 / 验收 / 标准起草，各司其职。 */
const crew = agentRegistrySchema.parse({
  schemaVersion: 1,
  agents: [
    { key: 'my-assistant', label: '我的个人助手', responsibilities: ['personal'], domains: ['*'] },
    { key: 'product-lead', label: '产研主管助手', responsibilities: ['supervisor'], domains: ['product'] },
    { key: 'growth-lead', label: '增长主管助手', responsibilities: ['supervisor'], domains: ['growth'] },
    { key: 'worker-a', label: '产研执行助手', responsibilities: ['worker'], domains: ['product'] },
    { key: 'qa-agent', label: '验收助手', responsibilities: ['acceptance'], domains: ['*'] },
    { key: 'standard-agent', label: '标准起草助手', responsibilities: ['standard-drafting'], domains: ['*'] },
  ],
});

/** 每一步的可回放证据：决策本身、配置快照、编制快照、因果来源、人签位置。 */
function stepsOf(plans: ReturnType<Router['route']>[]) {
  return plans.flatMap((plan, i) => plan.hops.map((hop, j) => ({
    seq: `${i + 1}.${j + 1}`,
    stage: hop.stage,
    decisionId: hop.decisionId.slice(0, 12),
    caller: `${hop.caller.actor}:${hop.caller.role}`,
    target: `${hop.target.agentKey ?? hop.target.serviceId ?? hop.target.role}`,
    causedBy: hop.causedBy ?? null,
    humanSignature: Boolean(hop.requiresHumanSignature),
    routerRevision: hop.basis.evidence.find(e => ROUTER_MARK.test(e)) ?? null,
    agentsRevision: hop.basis.evidence.find(e => e.startsWith('agents:')) ?? null,
  })));
}

function runShape(name: 'flat' | 'layered', config: RouterConfig, registry: AgentRegistry, expectedHops: number) {
  const sink = new MemoryRoutingSink();
  const router = new Router(config, new RoutingTrace([sink]), registry);
  const requests = requestsFor(name === 'flat' ? 'SUI-510' : 'SUI-520');
  const plans = requests.map(req => router.route(req));
  const events = sink.lines.map(line => JSON.parse(line)) as MemoryEvent[];
  const projection = replayRouting(events);
  const options = shapeOptions(router, registry);
  const assessment = assessThreeTier(events, projection, [], options);
  const steps = stepsOf(plans);
  const hops = plans.reduce((n, plan) => n + plan.hops.length, 0);
  const coverage = planCoverage(events);
  const revision = routerRevision(config);

  check(`${name}:五阶段各 ${expectedHops} 跳`, hops === requests.length * expectedHops
    && plans.every(plan => plan.hops.length === expectedHops), { hops, expected: requests.length * expectedHops });
  check(`${name}:全部落盘且无静默丢步`, sink.lines.length === hops
    && plans.every(plan => plan.written === plan.hops.length), { lines: sink.lines.length, hops });
  check(`${name}:重放两次逐字节一致`, projection.decisions === hops
    && projection.uniqueDecisions === hops
    && JSON.stringify(projection) === JSON.stringify(replayRouting(events)),
    { decisions: projection.decisions, unique: projection.uniqueDecisions });
  check(`${name}:五个派活阶段都覆盖`, ['intake', 'admission', 'dispatch', 'delegation', 'transfer']
    .every(stage => (projection.byStage[stage] ?? 0) > 0), { byStage: projection.byStage });
  check(`${name}:每一步带 Router 配置快照`, steps.every(step => step.routerRevision !== null
    && step.routerRevision!.includes(`router:${config.mode}@${revision}:`)),
    { revision, sample: steps[0]?.routerRevision });
  check(`${name}:入口收敛按证据判定`, coverage.singleRouterEntry === true
    && assessment.observed.singleRouterEntry === true,
    { total: coverage.total, routed: coverage.routed });
  check(`${name}:人签只在最后一跳`, plans.every(plan => plan.hops.slice(0, -1)
    .every(hop => hop.requiresHumanSignature !== true))
    && plans.filter(plan => plan.hops.at(-1)!.requiresHumanSignature).length === 1,
    { humanSignature: projection.humanSignature });
  check(`${name}:评估口径取自当前真实配置`, assessment.shape.mode === name
    && options.routerMode === name && options.configuredDomains === Object.keys(config.domains).length
    && options.agentBindings === onDuty(registry).length,
    { shape: assessment.shape.mode, options });
  check(`${name}:决策可从事件逐步还原`, events.map(decisionOf).filter(d => d !== null).length === hops
    && steps.every(step => events.some(e => decisionOf(e)?.decisionId.startsWith(step.decisionId))),
    { steps: steps.length, events: events.length });

  if (expectedHops === 2) {
    check(`${name}:每单两跳因果链闭合`, plans.every(plan =>
      plan.hops[1]!.causedBy === plan.hops[0]!.decisionId
      && plan.hops[0]!.target.role === 'supervisor'
      && plan.hops[1]!.caller.role === 'supervisor'),
      { chains: plans.map(plan => `${plan.hops[0]!.decisionId.slice(0, 8)}→${plan.hops[1]!.causedBy?.slice(0, 8)}`) });
    check(`${name}:每一步带在岗编制快照`, steps.every(step => step.agentsRevision !== null
      && step.agentsRevision!.includes(registryRevision(registry))),
      { registryRevision: registryRevision(registry), sample: steps[0]?.agentsRevision });
    check(`${name}:最终承接人不变`, plans.every((plan, i) =>
      plan.hops[1]!.target.agentKey === requests[i]!.target.agentKey
      && plan.hops[1]!.stage === requests[i]!.stage),
      { stages: plans.map(plan => plan.hops[1]!.stage) });
    // 配置变了只影响新决策，历史 Trace 不回溯改写。
    const changed = routerConfigSchema.parse({
      schemaVersion: 1, mode: 'layered', defaultDomain: 'product', maxHops: 2,
      domains: { ...layeredConfig.domains, finance: { label: '财务', supervisorAgentKey: 'product-lead' } },
    });
    const changedSink = new MemoryRoutingSink();
    const next = new Router(changed, new RoutingTrace([changedSink]), registry).route(requests[0]!);
    check(`${name}:配置快照不回溯`, routerRevision(changed) !== revision
      && next.hops.every(h => h.basis.evidence.some(e => e.includes(routerRevision(changed))))
      && steps.every(step => step.routerRevision!.includes(revision)),
      { old: revision, changed: routerRevision(changed) });
  }

  return { name, config, registry, router, plans, requests, events, projection, options, assessment, steps, coverage };
}

const realLog = path.join(runtime(), 'routing', 'events.jsonl');
const logLines = () => {
  try { return readFileSync(realLog, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; }
};
const beforeLines = logLines();

const flat = runShape('flat', flatConfig, defaultAgentRegistry(), 1);
const layered = runShape('layered', layeredConfig, crew, 2);

// ---- 扁平：跑得好，但绝不因此建议启用三层 ----------------------------------
check('扁平配置不要求主管：P3 按人机入口判定', p('p3-personal-entry')(flat.assessment).satisfied
  && p('p3-personal-entry')(flat.assessment).label.includes('不要求独立的 Personal Agent 实体'),
  { label: p('p3-personal-entry')(flat.assessment).label });
check('扁平配置不要求主管：P4 按直达派活判定', p('p4-supervisor-dispatch')(flat.assessment).satisfied
  && p('p4-supervisor-dispatch')(flat.assessment).label.includes('不要求主管')
  && flat.assessment.observed.directDispatches > 0
  && flat.assessment.observed.boundSupervisorDispatches === 0,
  { directDispatches: flat.assessment.observed.directDispatches,
    evidence: p('p4-supervisor-dispatch')(flat.assessment).evidence });
check('扁平默认空编制，不硬造管理层', defaultAgentRegistry().agents.length === 0
  && flat.options.agentBindings === 0 && flat.options.dutySupervisors?.length === 0,
  { onDuty: flat.options.agentBindings });
check('扁平形态按配置闭环，但不建议启用三层', flat.assessment.shape.ready === true
  && flat.assessment.recommended === false
  && flat.assessment.verdict.includes('本形态不需要三层'),
  { shapeReady: flat.assessment.shape.ready, recommended: flat.assessment.recommended,
    verdict: flat.assessment.verdict });
check('扁平下 p8 是防跳级闸门而非缺口', p('p8-agent-bindings')(flat.assessment).satisfied === false
  && p('p8-agent-bindings')(flat.assessment).evidence.includes('防跳级闸门'),
  { evidence: p('p8-agent-bindings')(flat.assessment).evidence });

// ---- 分层：真实在岗编制支撑，才可按配置启用三层 ------------------------------
check('分层 P3 要求在岗 Personal Agent', p('p3-personal-entry')(layered.assessment).satisfied
  && (layered.options.dutyPersonals?.length ?? 0) > 0,
  { dutyPersonals: layered.options.dutyPersonals });
check('分层 P4 核对配置登记 + 真实在岗主管', p('p4-supervisor-dispatch')(layered.assessment).satisfied
  && layered.assessment.observed.boundSupervisorDispatches === layered.plans.length
  && layered.options.configuredSupervisors?.includes('product-lead') === true
  && layered.options.dutySupervisors?.includes('product-lead') === true,
  { bound: layered.assessment.observed.boundSupervisorDispatches,
    configured: layered.options.configuredSupervisors, duty: layered.options.dutySupervisors,
    evidence: p('p4-supervisor-dispatch')(layered.assessment).evidence });
check('分层 p8 由真实在岗数 + 分层配置 + 业务域共同判定', p('p8-agent-bindings')(layered.assessment).satisfied,
  { agentBindings: layered.options.agentBindings, configuredDomains: layered.options.configuredDomains });
check('分层配置八项前置条件全部满足，可按配置启用三层', layered.assessment.recommended === true
  && layered.assessment.shape.ready === true
  && layered.assessment.coverage === 1
  && layered.assessment.verdict.includes('可按配置启用三层汇报'),
  { coverage: layered.assessment.coverage, verdict: layered.assessment.verdict,
    unsatisfied: layered.assessment.prerequisites.filter(x => !x.satisfied).map(x => x.id) });

// ---- 防跳级：合成数据 / 错配主管都不能让评估转绿 -----------------------------
const synthetic = assessThreeTier(layered.events, layered.projection, [],
  { routerMode: 'layered', agentBindings: 6, configuredDomains: 2, configuredSupervisors: ['product-lead'] });
check('只有角色名、没有真实编制不能凑齐分层 P4', synthetic.prerequisites.find(x => x.id === 'p4-supervisor-dispatch')!.satisfied === false
  && synthetic.recommended === false,
  { p4: synthetic.prerequisites.find(x => x.id === 'p4-supervisor-dispatch')!.evidence,
    recommended: synthetic.recommended });
const flatWithCrew = assessThreeTier(flat.events, flat.projection, [],
  shapeOptions(new Router(flatConfig, new RoutingTrace([new MemoryRoutingSink()]), crew), crew));
check('扁平配置即使有在岗 Agent 也不放行三层', flatWithCrew.recommended === false
  && p('p8-agent-bindings')(flatWithCrew).satisfied === false
  && flatWithCrew.shape.mode === 'flat',
  { recommended: flatWithCrew.recommended, shape: flatWithCrew.shape.mode });
const ghostConfig = routerConfigSchema.parse({
  schemaVersion: 1, mode: 'layered', defaultDomain: 'product', maxHops: 2,
  domains: { product: { label: '产研', supervisorAgentKey: 'ghost-lead' } },
});
const ghostSink = new MemoryRoutingSink();
const ghostRouter = new Router(ghostConfig, new RoutingTrace([ghostSink]), crew);
const ghostPlan = ghostRouter.route(layered.requests[0]!);
const ghostEvents = ghostSink.lines.map(line => JSON.parse(line)) as MemoryEvent[];
const ghost = assessThreeTier(ghostEvents, replayRouting(ghostEvents), [], shapeOptions(ghostRouter, crew));
check('配置的主管不在岗时降级 1 跳且分层 P4 不成立', ghostPlan.hops.length === 1
  && Boolean(ghostPlan.degraded) && ghost.recommended === false
  && p('p4-supervisor-dispatch')(ghost).satisfied === false,
  { degraded: ghostPlan.degraded, hops: ghostPlan.hops.length });
check('未声明配置时退回最保守固定口径', assessThreeTier(layered.events, layered.projection, []).shape.mode === 'unspecified'
  && assessThreeTier(layered.events, layered.projection, []).shape.ready === false,
  { note: '旧调用（router:smoke / 历史脚本）保持向后兼容' });

check('真跑未写真实路由日志', logLines() === beforeLines, { before: beforeLines, after: logLines() });

const failed = checks.filter(c => !c.ok).map(c => c.name);
const shapeSummary = (run: ReturnType<typeof runShape>) => ({
  mode: run.assessment.shape.mode, label: run.assessment.shape.label,
  shapeReady: run.assessment.shape.ready, recommended: run.assessment.recommended,
  coverage: run.assessment.coverage, verdict: run.assessment.verdict,
  hops: run.plans.reduce((n, plan) => n + plan.hops.length, 0),
  observed: run.assessment.observed,
  prerequisites: run.assessment.prerequisites.map(x => ({ id: x.id, label: x.label, satisfied: x.satisfied, evidence: x.evidence })),
  steps: run.steps,
});
const report = {
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  note: '隔离内存 Trace，未写真实 .runtime/routing/events.jsonl；扁平 / 分层各跑一单，每一步都带 Router 与在岗编制快照，可按 causedBy 逐步回放',
  assessmentNote: 'C-5：P3/P4 按当前 config.router.mode 判定，扁平不要求主管；分层主管派活须同时是配置登记且真实在岗带 supervisor 职责的 Agent。recommended 仅表示「当前分层配置可正式启用三层」，不是建议所有团队升级。',
  checks: checks.length, failed,
  shapes: { flat: shapeSummary(flat), layered: shapeSummary(layered) },
  guards: {
    syntheticRoleNamesBlocked: synthetic.recommended === false,
    flatWithCrewBlocked: flatWithCrew.recommended === false,
    ghostSupervisorDegraded: ghostPlan.degraded,
    unspecifiedConservative: true,
  },
  details: checks,
};
mkdirSync(runtime(), { recursive: true });
writeFileSync(path.join(runtime(), 'shapes-smoke.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ ok: report.ok, checks: checks.length, failed,
  shapes: { flat: { shapeReady: flat.assessment.shape.ready, recommended: flat.assessment.recommended },
    layered: { shapeReady: layered.assessment.shape.ready, recommended: layered.assessment.recommended } } }, null, 2));
if (failed.length) process.exitCode = 1;
