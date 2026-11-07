// 方案 C-4 真跑：在隔离的内存 Trace 上把「配置里写的主管名」与「真实在岗的
// Agent 编制」组合起来跑一遍，验证分层跳数、在岗校验、验收编组、A2A 交接、
// 自派自验自环与配置快照不回溯。**绝不写真实 .runtime/routing/events.jsonl。**
//
// 用法：npm run agents:smoke
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runtime, routerConfigSchema, type RouterConfig } from '../src/config.ts';
import { Router, planCoverage, planRoute, routedBy, type RoutingRequest } from '../src/router.ts';
import { RoutingTrace, MemoryRoutingSink, replayRouting } from '../src/routing-trace.ts';
import { agentRegistrySchema, defaultAgentRegistry, registryRevision, onDuty,
  resolveAssignment, handoffEnvelope, reviewCrew, registrySummary,
  type AgentRegistry } from '../src/agent-registry.ts';
import { assessThreeTier } from '../src/three-tier-assessment.ts';
import type { MemoryEvent } from '../src/architecture-contracts.ts';

type Check = { name: string; ok: boolean; detail: Record<string, unknown> };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: Record<string, unknown> = {}) =>
  checks.push({ name, ok, detail });

const root = path.resolve(runtime(), '..');
const src = (file: string) => readFileSync(path.join(root, file), 'utf8');

/** 一套「上百人团队按业务域分层」的编制：可兼任、可自定义职责、可停用。 */
const crew = (overrides: (agents: Record<string, unknown>[]) => Record<string, unknown>[] = a => a): AgentRegistry =>
  agentRegistrySchema.parse({ schemaVersion: 1, agents: overrides([
    { key: 'my-assistant', label: '我的助手', responsibilities: ['personal', 'inspection'], domains: ['*'] },
    { key: 'product-lead', label: '产研主管', responsibilities: ['supervisor', 'worker'], domains: ['product'] },
    { key: 'tech-agent', label: '技术助手', responsibilities: ['worker', 'tech'], domains: ['product'] },
    { key: 'qa-agent', label: '验收助手', responsibilities: ['acceptance', 'standard-drafting'], domains: ['*'] },
    { key: 'growth-agent', label: '增长助手', responsibilities: ['growth'], domains: ['growth'] },
  ]) });

const flat = routerConfigSchema.parse({ schemaVersion: 1, mode: 'flat' });
const legacy = routerConfigSchema.parse({ schemaVersion: 1, mode: 'legacy' });
const layered = routerConfigSchema.parse({
  schemaVersion: 1, mode: 'layered', defaultDomain: 'product',
  domains: { product: { label: '产研', supervisorAgentKey: 'product-lead', personalAgentKey: 'my-assistant' } },
});

/** 一段真实派活意图，字段与五个派活点一致。 */
const requests: RoutingRequest[] = [
  { taskId: 'SUI-400', stage: 'intake', caller: { actor: 'owner-a', role: 'personal', source: 'human' },
    target: { role: 'worker', agentKey: 'tech-agent' }, basis: { kind: 'user-command', evidence: ['message:om_400'] },
    scope: { visibility: 'private' }, requiresHumanSignature: true, signatureReason: '最终业务验收只能由原发起人在原会话确认',
    idempotencyKey: 'intake:om_400', at: '2026-11-07T02:00:00.000Z' },
  { taskId: 'SUI-400', stage: 'dispatch', caller: { actor: 'owner-a', role: 'personal', source: 'human' },
    target: { role: 'worker', agentKey: 'tech-agent' }, basis: { kind: 'user-command', evidence: ['1 条业务验收项'] },
    scope: { visibility: 'private' }, idempotencyKey: 'dispatch:om_400', at: '2026-11-07T02:00:01.000Z' },
  { taskId: 'SUI-400', stage: 'delegation', caller: { actor: 'tech-agent', role: 'supervisor', source: 'a2a-sdk' },
    target: { role: 'worker', serviceId: 'review-service', agentKey: 'qa-agent' },
    basis: { kind: 'service-route', evidence: ['goal:独立评审'] },
    scope: { sourceIds: ['src-1'], visibility: 'space' }, outcome: 'committed',
    idempotencyKey: 'service-start:SUI-400:child-1', at: '2026-11-07T02:00:02.000Z' },
];

/** 隔离真跑：Router 写内存 Trace，重放验证一致，不碰真实日志。 */
function run(name: string, config: RouterConfig, registry?: AgentRegistry) {
  const sink = new MemoryRoutingSink();
  const router = new Router(config, new RoutingTrace([sink]), registry);
  const plans = requests.map(req => router.route(req));
  const events = sink.lines.map(line => JSON.parse(line)) as MemoryEvent[];
  const projection = replayRouting(events);
  const replayAgain = replayRouting(sink.lines.map(line => JSON.parse(line)));
  const coverage = planCoverage(events);
  const threeTier = assessThreeTier(events, projection, [],
    { agentBindings: registry ? onDuty(registry).length : 0,
      routerMode: config.mode, configuredDomains: Object.keys(config.domains).length });
  check(`${name}:Trace 写入与重放一致`,
    plans.every(p => p.written === p.hops.length) && projection.decisions === events.length
    && JSON.stringify(projection) === JSON.stringify(replayAgain),
    { events: events.length, decisions: projection.decisions, written: plans.reduce((n, p) => n + p.written, 0) });
  check(`${name}:配置快照与路由标记`,
    plans.every(p => p.hops.every(h => !registry || h.basis.evidence.some(e => e.startsWith('agents:'))))
    && (config.mode === 'legacy' || plans.every(p => p.hops.every(routedBy))),
    { mode: config.mode, registryRevision: registry ? registryRevision(registry) : null });
  check(`${name}:p8 按真实在岗数判定`,
    threeTier.prerequisites.find(p => p.id === 'p8-agent-bindings')!.satisfied
      === (config.mode === 'layered' && (registry ? onDuty(registry).length : 0) > 0
        && Object.keys(config.domains).length > 0),
    { p8: threeTier.prerequisites.find(p => p.id === 'p8-agent-bindings')!.satisfied,
      recommended: threeTier.recommended });
  return { plans, events, coverage, threeTier, projection };
}

// --- 1. 三种组织形态 × 注册表状态 ----------------------------------------
const c3Legacy = run('C-3 legacy', legacy);
check('C-3 legacy 逐字回退：1 跳、不带 Router 标记',
  c3Legacy.plans.every(p => p.hops.length === 1) && c3Legacy.projection.decisions === 3,
  { decisions: c3Legacy.projection.decisions });

const c3Layered = run('C-3 layered 无注册表', layered);
check('C-3 不传注册表逐字等价：分层仍是 2 跳',
  c3Layered.plans.every(p => p.hops.length === 2) && c3Layered.plans.every(p => p.registryRevision === null),
  { hops: c3Layered.plans.map(p => p.hops.length) });

const c4Flat = run('C-4 flat 空编制', flat, defaultAgentRegistry());
check('C-4 扁平小团队：空编制仍 1 跳，不硬造管理层',
  c4Flat.plans.every(p => p.hops.length === 1) && registrySummary(defaultAgentRegistry()).onDuty === 0,
  { hops: c4Flat.plans.map(p => p.hops.length) });

const emptyLayered = run('C-4 layered 空编制', layered, defaultAgentRegistry());
check('C-4 配了主管名却没有在岗事实：降级 1 跳并如实说明',
  emptyLayered.plans.every(p => p.hops.length === 1 && Boolean(p.degraded))
  && emptyLayered.plans.every(p => /未在组织注册表在岗/.test(p.degraded!)),
  { degraded: emptyLayered.plans[0]!.degraded });

const onDutyRun = run('C-4 layered 主管在岗', layered, crew());
check('C-4 主管真实在岗：恢复 2 跳且每跳带编制快照',
  onDutyRun.plans.every(p => p.hops.length === 2)
  && onDutyRun.plans.every(p => p.hops.every(h => h.basis.evidence.some(e => e.startsWith('agents:')))),
  { hops: onDutyRun.plans.map(p => p.hops.length) });
check('C-4 分层两跳因果链闭合、最终承接人不变、人签只在最后一跳',
  onDutyRun.plans.every((p, i) => p.hops.length === 2
    && p.hops[0]!.target.agentKey === 'product-lead'
    && p.hops[1]!.causedBy === p.hops[0]!.decisionId
    && p.hops[0]!.requiresHumanSignature !== true
    && p.hops[1]!.target.agentKey === requests[i]!.target.agentKey),
  { twoHopPlans: onDutyRun.plans.filter(p => p.hops.length === 2).length });
check('C-4 真实在岗数与入口覆盖率如实可查',
  onDutyRun.coverage.singleRouterEntry && onDuty(crew()).length === 5,
  { coverage: onDutyRun.coverage, onDuty: onDuty(crew()).length });

// --- 2. 在岗校验的四类降级 ------------------------------------------------
const disabled = crew(agents => agents.map(a => a.key === 'product-lead' ? { ...a, enabled: false } : a));
const wrongDuty = crew(agents => agents.map(a => a.key === 'product-lead' ? { ...a, responsibilities: ['worker'] } : a));
const wrongScope = crew(agents => agents.map(a => a.key === 'product-lead' ? { ...a, domains: ['growth'] } : a));
for (const [name, registry, reason] of [
  ['主管停用', disabled, /未在组织注册表在岗/],
  ['职责不符', wrongDuty, /未绑定主管职责/],
  ['范围不符', wrongScope, /生效范围不覆盖/],
] as const) {
  const plan = planRoute(requests[1]!, layered, registry);
  check(`C-4 ${name}：一律降级 1 跳，不静默放行`,
    plan.hops.length === 1 && Boolean(plan.degraded) && reason.test(plan.degraded!),
    { degraded: plan.degraded });
}

// --- 3. 自派自验自环 ------------------------------------------------------
const selfPlan = planRoute({ ...requests[1]!, caller: { actor: 'product-lead', role: 'personal', source: 'human' } },
  layered, crew());
check('C-4 自派自验自环被拦并写 rejected 留痕',
  Boolean(selfPlan.blocked) && selfPlan.hops.length === 1
  && selfPlan.hops[0]!.outcome === 'rejected'
  && selfPlan.hops[0]!.basis.evidence.some(e => e.startsWith('router:blocked:')),
  { blocked: selfPlan.blocked });

// --- 4. 验收编组 ----------------------------------------------------------
const emptyCrew = reviewCrew(defaultAgentRegistry(), { taskId: 'SUI-400' });
check('C-4 空编制验收：如实降级，不硬造验收 Agent',
  !emptyCrew.configured && emptyCrew.reviewer.agentKey === null
  && /不硬造验收 Agent/.test(emptyCrew.degraded!) && emptyCrew.redLines.length === 3,
  { degraded: emptyCrew.degraded });
const fullCrew = reviewCrew(crew(), { taskId: 'SUI-400', producedBy: 'tech-agent' });
check('C-4 验收编组：逐项判定 / 标准起草 / 周期巡检不重复、产出方被排除',
  fullCrew.reviewer.agentKey === 'qa-agent'
  && fullCrew.standardDrafter.agentKey === null
  && fullCrew.inspector.agentKey !== null
  && [fullCrew.reviewer, fullCrew.standardDrafter, fullCrew.inspector]
    .every(a => a.agentKey !== 'tech-agent')
  && fullCrew.modelCalls === 0,
  { reviewer: fullCrew.reviewer.agentKey, drafter: fullCrew.standardDrafter.agentKey,
    inspector: fullCrew.inspector.agentKey });
check('C-4 验收 Agent 与产品 / 技术 / 运营等自定义职责协作',
  fullCrew.collaborators.some(c => c.responsibility === 'tech')
  && fullCrew.collaborators.some(c => c.responsibility === 'growth'),
  { collaborators: fullCrew.collaborators.map(c => c.responsibility) });
const noReviewer = reviewCrew(crew(), { taskId: 'SUI-400', producedBy: 'qa-agent' });
check('C-4 产出方就是唯一验收 Agent：无合格独立评审者，如实降级',
  noReviewer.reviewer.agentKey === null && /没有合格的独立验收 Agent/.test(noReviewer.degraded!),
  { degraded: noReviewer.degraded });

// --- 5. A2A handoff：引用与范围，不搬运正文 -------------------------------
const handoffBase = { taskId: 'SUI-400', from: 'my-assistant', to: 'product-lead',
  responsibility: 'supervisor', domain: 'product', sourceIds: ['src-1'], causedBy: 'SUI-400:hop1' };
const okHandoff = handoffEnvelope(crew(), handoffBase);
check('C-4 A2A 合格交接带 sourceIds / scope / causedBy 与版本，零模型调用',
  okHandoff.ok && okHandoff.scope.sourceIds[0] === 'src-1'
  && okHandoff.scope.agentVersion === okHandoff.agentVersion
  && okHandoff.causedBy === 'SUI-400:hop1' && okHandoff.modelCalls === 0
  && !('content' in okHandoff.scope),
  { version: okHandoff.agentVersion });
const handoffFailures: [string, Parameters<typeof handoffEnvelope>[1], RegExp][] = [
  ['自环', { ...handoffBase, from: 'product-lead' }, /同一主体/],
  ['未在岗', { ...handoffBase, to: 'ghost' }, /未在组织注册表在岗/],
  ['职责不符', { ...handoffBase, responsibility: 'acceptance' }, /未绑定/],
  ['范围不符', { ...handoffBase, domain: 'growth' }, /生效范围/],
  ['版本漂移', { ...handoffBase, expectedVersion: 'deadbeef0000' }, /版本已变化/],
  ['责任链重复', { ...handoffBase, usedKeys: ['product-lead'] }, /责任链/],
];
for (const [name, input, reason] of handoffFailures) {
  const envelope = handoffEnvelope(crew(), input);
  check(`C-4 A2A ${name}：ok:false 且给出真实原因`,
    !envelope.ok && reason.test(envelope.reason!), { reason: envelope.reason });
}
const emptyHandoff = handoffEnvelope(defaultAgentRegistry(), handoffBase);
check('C-4 空编制不阻塞既有 A2A 链路：由调用方跳过校验',
  !emptyHandoff.ok && /未在组织注册表在岗/.test(emptyHandoff.reason!),
  { note: 'ServiceNetwork 在 onDuty=0 时不调用校验，SUI-103/106 委派链路保持原样' });

// --- 6. 配置快照、确定性与工程层判定 ---------------------------------------
const revisionA = registryRevision(crew());
const revisionB = registryRevision(crew());
const changed = crew(agents => agents.map(a => a.key === 'qa-agent' ? { ...a, enabled: false } : a));
check('C-4 编制快照稳定、一变就变、备注不算变更',
  revisionA === revisionB && revisionA !== registryRevision(changed)
  && registryRevision({ ...crew(), updatedAt: '2026-11-08' }) === revisionA,
  { base: revisionA, changed: registryRevision(changed) });
check('C-4 新旧决策各带自己的编制快照，历史不回溯',
  planRoute(requests[1]!, layered, crew()).registryRevision === revisionA
  && planRoute(requests[1]!, layered, changed).registryRevision === registryRevision(changed)
  && planRoute(requests[1]!, layered, crew()).hops[0]!.decisionId
    === planRoute(requests[1]!, layered, crew()).hops[0]!.decisionId,
  { base: revisionA, changed: registryRevision(changed) });
const assignment = resolveAssignment(crew(), { taskId: 'SUI-400', responsibility: 'supervisor', domain: 'product' });
check('C-4 职责解析是确定性工程层：零模型调用、可重复',
  assignment.agentKey === 'product-lead' && assignment.modelCalls === 0
  && JSON.stringify(assignment) === JSON.stringify(resolveAssignment(crew(),
    { taskId: 'SUI-400', responsibility: 'supervisor', domain: 'product' })),
  { agentKey: assignment.agentKey, candidates: assignment.candidates });
check('C-4 未登记业务域不硬造管理层',
  resolveAssignment(crew(), { taskId: 'SUI-400', responsibility: 'supervisor', domain: 'finance' }).agentKey === null
  && planRoute({ ...requests[1]!, domain: 'finance' }, layered, crew()).hops.length === 1,
  { reason: '业务域没有在岗主管时按扁平派单' });

// --- 7. 接线守门（源码事实，不是文档印象） ---------------------------------
const server = src('src/server.ts');
check('C-4 服务端、Router、A2A、v06、控制台五处接线齐全',
  /configureAgentRegistry\(config\.agentRegistry\)/.test(server)
  && /configureRouter\(config\.router, undefined, getAgentRegistry\(\)\)/.test(server)
  && /agentBindings:onDuty\(getAgentRegistry\(\)\)\.length/.test(server)
  && /handoffEnvelope\(/.test(src('src/service-network.ts'))
  && /case 'agent-registry-view'/.test(src('src/v06.ts'))
  && /case 'acceptance-crew'/.test(src('src/v06.ts'))
  && /card\('Agent 编制'/.test(src('console/app.js'))
  && /'v06-agent-registry-view'/.test(src('scripts/console-server.ts'))
  && /agentRegistry: agentRegistrySchema\.default/.test(src('src/config.ts')),
  { files: ['src/server.ts', 'src/router.ts', 'src/service-network.ts', 'src/v06.ts',
    'console/app.js', 'scripts/console-server.ts', 'src/config.ts'] });

const failed = checks.filter(c => !c.ok).map(c => c.name);
const report = {
  ok: failed.length === 0,
  note: '隔离内存 Trace，未写真实 .runtime/routing/events.jsonl；C-3 不传注册表时逐字等价，C-4 显式装配后在岗校验生效',
  checks: checks.length, failed, details: checks,
  scenarios: {
    c3Legacy: { hops: c3Legacy.plans.map(p => p.hops.length) },
    c3Layered: { hops: c3Layered.plans.map(p => p.hops.length) },
    c4FlatEmpty: { hops: c4Flat.plans.map(p => p.hops.length) },
    c4LayeredEmpty: { hops: emptyLayered.plans.map(p => p.hops.length), degraded: emptyLayered.plans[0]!.degraded },
    c4LayeredOnDuty: { hops: onDutyRun.plans.map(p => p.hops.length), revision: revisionA,
      coverage: onDutyRun.coverage },
  },
  boundaries: [
    '默认空编制：扁平小团队不硬造管理层；C-5 之前三层判断仍 recommended=false',
    'Agent 不能自己让改进生效；独立评审者 ≠ 产出方；不替代原发起人确认验收',
    '飞书仍是唯一发起入口，控制台只新增只读编制视图，未新增写动作或常驻服务',
    '未引入新上游、未改上游提交、未复制 LobeHub 代码',
  ],
};
mkdirSync(runtime(), { recursive: true });
writeFileSync(runtime('agent-registry-smoke.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failed }, null, 2));
if (failed.length) process.exitCode = 1;
