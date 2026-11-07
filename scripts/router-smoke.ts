// 方案 C-3 真跑：在隔离的内存 Trace 上把五个派活阶段的真实请求分别按
// legacy / flat / layered 三种组织形态跑一遍，验证跳数、因果链、人签位置、
// 重放一致性与 p6 判定。绝不写真实 .runtime/routing/events.jsonl。
//
// 用法：npm run router:smoke
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runtime, routerConfigSchema, type RouterConfig } from '../src/config.ts';
import { Router, planCoverage, routerRevision, type RoutingRequest } from '../src/router.ts';
import { RoutingTrace, MemoryRoutingSink, replayRouting } from '../src/routing-trace.ts';
import { assessThreeTier } from '../src/three-tier-assessment.ts';
import type { MemoryEvent } from '../src/architecture-contracts.ts';

type Check = { name: string; ok: boolean; detail: Record<string, unknown> };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail: Record<string, unknown> = {}) => checks.push({ name, ok, detail });

/** 五个真实派活阶段的意图，字段与 controller / coordination / assistant / service-network / v06 对齐。 */
const requests: RoutingRequest[] = [
  { taskId: 'SUI-300', stage: 'intake', caller: { actor: 'owner-a', role: 'personal', source: 'human' },
    target: { role: 'worker', agentKey: 'agent-a' }, basis: { kind: 'user-command', evidence: ['message:om_300'] },
    scope: { visibility: 'private' }, requiresHumanSignature: true, signatureReason: '最终业务验收只能由原发起人在原会话确认',
    idempotencyKey: 'intake:om_300', at: '2026-11-07T01:00:00.000Z' },
  { taskId: 'SUI-300', stage: 'admission', caller: { actor: 'scoped-preparation', role: 'supervisor', source: 'superagent-policy' },
    target: { role: 'worker', agentKey: 'workspace-assistant' }, basis: { kind: 'policy', evidence: ['ready', 'enabled:true'] },
    scope: { visibility: 'private' }, outcome: 'committed', idempotencyKey: 'admission:SUI-300:ready', at: '2026-11-07T01:00:01.000Z' },
  { taskId: 'SUI-300', stage: 'dispatch', caller: { actor: 'owner-a', role: 'personal', source: 'human' },
    target: { role: 'worker', agentKey: 'agent-a' }, basis: { kind: 'user-command', evidence: ['1 条业务验收项'] },
    scope: { allowedPaths: ['src/'], visibility: 'private' }, idempotencyKey: 'dispatch:om_300', at: '2026-11-07T01:00:02.000Z' },
  { taskId: 'SUI-300', stage: 'delegation', caller: { actor: 'agent-a', role: 'supervisor', source: 'a2a-sdk' },
    target: { role: 'worker', serviceId: 'review-service', agentKey: 'reviewer-b' },
    basis: { kind: 'service-route', evidence: ['goal:独立评审', 'version:v1'] },
    scope: { sourceIds: ['src-1'], visibility: 'space' }, outcome: 'committed',
    idempotencyKey: 'service-start:SUI-300:child-1', at: '2026-11-07T01:00:03.000Z' },
  { taskId: 'SUI-300', stage: 'transfer', caller: { actor: 'owner-a', role: 'personal', source: 'human' },
    target: { role: 'worker', agentKey: 'agent-c' }, basis: { kind: 'transfer', evidence: ['generation:2'] },
    scope: { visibility: 'private' }, idempotencyKey: 'transfer:SUI-300:g2', at: '2026-11-07T01:00:04.000Z' },
];

const layeredConfig = routerConfigSchema.parse({
  schemaVersion: 1, mode: 'layered', defaultDomain: 'product',
  domains: {
    product: { label: '产研', supervisorAgentKey: 'product-lead', personalAgentKey: 'my-assistant' },
    growth: { label: '增长运营', supervisorAgentKey: 'growth-lead' },
  },
});

function run(name: string, config: RouterConfig, expectedHops: number) {
  const sink = new MemoryRoutingSink();
  const router = new Router(config, new RoutingTrace([sink]));
  let written = 0, blocked = 0, degraded = 0;
  const plans = requests.map(req => {
    const result = router.route(req);
    written += result.written;
    if (result.blocked) blocked++;
    if (result.degraded) degraded++;
    return result;
  });
  const events = sink.lines.map(line => JSON.parse(line)) as MemoryEvent[];
  const projection = replayRouting(events);
  const coverage = planCoverage(events);
  const threeTier = assessThreeTier(events, projection, []);
  const hops = plans.reduce((n, p) => n + p.hops.length, 0);

  check(`${name}:决策条数`, hops === requests.length * expectedHops, { hops, expected: requests.length * expectedHops });
  check(`${name}:全部落盘`, sink.lines.length === hops && written === hops, { lines: sink.lines.length, written, hops });
  check(`${name}:重放去重可复现`, projection.decisions === hops && projection.uniqueDecisions === hops
    && JSON.stringify(projection) === JSON.stringify(replayRouting(events)), { decisions: projection.decisions });
  check(`${name}:五个阶段都覆盖`, ['intake', 'admission', 'dispatch', 'delegation', 'transfer']
    .every(stage => (projection.byStage[stage] ?? 0) > 0), { byStage: projection.byStage });
  const marked = plans.every(p => p.hops.every(h => h.basis.evidence.some(e => e.startsWith(`router:${config.mode}@`))));
  check(`${name}:配置快照`, plans.every(p => p.revision === routerRevision(config))
    && (config.mode === 'legacy' ? !marked : marked),
    { revision: routerRevision(config), mode: config.mode, marked });
  check(`${name}:p6 按证据判定`, coverage.singleRouterEntry === (config.mode !== 'legacy')
    && threeTier.observed.singleRouterEntry === coverage.singleRouterEntry,
    { coverage, p6: threeTier.prerequisites.find(p => p.id === 'p6-single-router')?.satisfied });
  check(`${name}:人签次数不扩散`, projection.humanSignature === 1, { humanSignature: projection.humanSignature });
  // C-4 未落地 Agent 实例与职责绑定之前，p8 恒为 false，防跳级闸门不被合成数据骗过。
  const gate = threeTier.prerequisites.find(p => p.id === 'p8-agent-bindings');
  check(`${name}:三层评估与前置条件一致`,
    threeTier.recommended === threeTier.prerequisites.every(p => p.satisfied)
      && threeTier.recommended === false && gate?.satisfied === false,
    { coverage: threeTier.coverage, recommended: threeTier.recommended, gate: gate?.evidence,
      note: '合成数据仅供链路验证，不构成引入三层的产品结论' });
  return { events, plans, sink, blocked, degraded, projection, coverage, threeTier };
}

const legacyRun = run('legacy', routerConfigSchema.parse({ schemaVersion: 1, mode: 'legacy' }), 1);
const flatRun = run('flat', routerConfigSchema.parse({ schemaVersion: 1, mode: 'flat' }), 1);
const layeredRun = run('layered', layeredConfig, 2);

// 收敛入口不改变既有幂等键：flat 与 legacy 的 decisionId 必须逐条一致。
check('flat 与 legacy 幂等键逐条一致',
  flatRun.plans.every((p, i) => p.hops[0]!.decisionId === legacyRun.plans[i]!.hops[0]!.decisionId),
  { flat: flatRun.plans.map(p => p.hops[0]!.decisionId.slice(0, 8)), legacy: legacyRun.plans.map(p => p.hops[0]!.decisionId.slice(0, 8)) });

// 分层两跳：第一跳交给业务域主管，第二跳由第一跳因果触发，且最终承接人不变。
check('分层两跳因果链闭合', layeredRun.plans.every(p => p.hops.length === 2
  && p.hops[0]!.target.role === 'supervisor'
  && p.hops[0]!.target.agentKey === 'product-lead'
  && p.hops[1]!.caller.role === 'supervisor'
  && p.hops[1]!.causedBy === p.hops[0]!.decisionId),
  { hops: layeredRun.plans.map(p => p.hops.length), chain: layeredRun.plans.map(p => p.hops[1]!.causedBy?.slice(0, 8)) });
check('分层最终承接人不变', layeredRun.plans.every((p, i) => p.hops[1]!.target.agentKey === requests[i]!.target.agentKey
  && p.hops[1]!.stage === requests[i]!.stage), { stages: layeredRun.plans.map(p => p.hops[1]!.stage) });
check('分层人签只在最后一跳', layeredRun.plans.every(p => p.hops[0]!.requiresHumanSignature === false)
  && layeredRun.plans.filter(p => p.hops[1]!.requiresHumanSignature).length === 1,
  { firstHopSignatures: layeredRun.plans.filter(p => p.hops[0]!.requiresHumanSignature).length });

// 未配主管的业务域退回 1 跳；自派自验被拦且留痕。
const growthRouter = new Router(layeredConfig, new RoutingTrace([new MemoryRoutingSink()]));
// finance 是完全没登记的业务域；growth 已登记但另配了主管，不作为「无主管」样本。
const unconfigured = growthRouter.route({ ...requests[2]!, domain: 'finance', idempotencyKey: 'unconfigured-case' });
check('未登记业务域不硬造管理层', unconfigured.hops.length === 1 && Boolean(unconfigured.degraded), { degraded: unconfigured.degraded });
const growth = growthRouter.route({ ...requests[2]!, domain: 'growth', idempotencyKey: 'growth-case' });
check('已按业务域分层时换用该域自己的主管', growth.hops.length === 2
  && growth.hops[0]!.target.agentKey === 'growth-lead', { supervisor: growth.hops[0]?.target.agentKey });
const self = growthRouter.route({ ...requests[2]!, caller: { actor: 'product-lead', role: 'personal', source: 'human' },
  idempotencyKey: 'self-case' });
check('自派自验被拦且留痕', Boolean(self.blocked) && self.hops.length === 1 && self.hops[0]!.outcome === 'rejected',
  { blocked: self.blocked, outcome: self.hops[0]?.outcome });

const failed = checks.filter(c => !c.ok).map(c => c.name);
const report = {
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  note: '隔离内存 Trace，未写真实 .runtime/routing/events.jsonl；五个派活阶段的真实意图按三种组织形态重放',
  assessmentNote: 'C-3 发现 P3/P4 只按角色名判定时合成数据会凑齐旧前置条件，已补 p8：C-4 落地 Agent 实例与职责绑定、C-5 按当前配置判定之前恒为 false，扁平配置不要求出现主管。',
  checks: checks.length, failed,
  modes: {
    legacy: { hops: legacyRun.projection.decisions, p6: legacyRun.coverage.singleRouterEntry },
    flat: { hops: flatRun.projection.decisions, p6: flatRun.coverage.singleRouterEntry,
      threeTierRecommended: flatRun.threeTier.recommended },
    layered: { hops: layeredRun.projection.decisions, p6: layeredRun.coverage.singleRouterEntry,
      supervisor: 'product-lead', degradationOnUnconfiguredDomain: unconfigured.degraded,
      threeTierRecommended: layeredRun.threeTier.recommended },
  },
  details: checks,
};
mkdirSync(runtime(), { recursive: true });
writeFileSync(path.join(runtime(), 'router-smoke.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ ok: report.ok, checks: checks.length, failed, modes: report.modes }, null, 2));
if (failed.length) process.exitCode = 1;
