// 方案 C-3 · 单一 Router：五个派活点唯一的「谁交给谁」入口。
//
// 之前 controller / coordination / assistant / service-network / v06 共 8 处
// 各自 routingDecision(...) + Trace.record(...)，层数是写死在调用点里的。
// 现在调用点只描述「这一跳的原始意图」，由 Router 读配置决定下一跳：
//   - legacy  : 一行回退，原样产出改造前那一条决策，不改写任何字段；
//   - flat    : 1 跳，人 / Personal Agent 直接到执行者；
//   - layered : 最多 2 跳，经业务域的中间决策层 Agent 再到执行者；
//               业务域没配主管时自动退回 1 跳，不给小团队硬造管理层。
//
// 产品红线（用户 2026-11-07 拍板）：层是配置不是产品骨架；配置按业务域 /
// 组织单元生效，项目只引用不覆写；允许一个 Agent 兼任多职责，但同一 Task
// 禁止自派自验自环；配置变更留 revision 快照，不回溯改写历史决策。
//
// 边界：Router 只产出决策链并写 append-only Trace，绝不改变任何业务结果。
// 写入失败、配置成环都与既有 advisory 语义一致——不改变任务、回执或验收。
import { createHash } from 'node:crypto';
import { routingDecision, decisionOf, type RoutingDecision, type RoutingDecisionInput } from './routing-decision.ts';
import type { MemoryEvent } from './architecture-contracts.ts';
import { getRoutingTrace, type RoutingTrace } from './routing-trace.ts';
import { defaultRouterConfig, type RouterConfig, ROUTER_MODES } from './config.ts';
import { onDuty, scopeCovers, registryRevision, registrySummary, defaultAgentRegistry,
  type AgentRegistry } from './agent-registry.ts';

export { ROUTER_MODES, defaultRouterConfig } from './config.ts';
export type RouterMode = typeof ROUTER_MODES[number];
export type { RouterConfig } from './config.ts';

/** 配置快照：键序稳定，配置一变 revision 就变，历史决策仍带旧 revision。 */
export function routerRevision(config: RouterConfig): string {
  const stable = {
    schemaVersion: config.schemaVersion, mode: config.mode, defaultDomain: config.defaultDomain ?? null,
    maxHops: config.maxHops,
    domains: Object.keys(config.domains).sort().map(id => [id, config.domains[id]]),
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 12);
}

/** 派活点交给 Router 的原始意图；domain 只用于查配置，不进 RoutingDecision。 */
export type RoutingRequest = RoutingDecisionInput & { domain?: string };
export type RoutingPlan = {
  mode: RouterMode;
  revision: string;
  hops: RoutingDecision[];
  /** 配置成环时不写任何决策，如实记录原因。 */
  blocked: string | null;
  /** 分层但业务域没主管时降级为 1 跳，不硬造管理层。 */
  degraded: string | null;
  domain: string | null;
  supervisorAgentKey: string | null;
  /** C-4：显式传入 Agent 注册表时写入配置快照；未传为 null（C-3 逐字等价）。 */
  registryRevision: string | null;
};

const mark = (mode: RouterMode, revision: string, hop: number, total: number) =>
  `router:${mode}@${revision}:${hop}/${total}`;
const dutyMark = (registry: AgentRegistry) =>
  `agents:${registryRevision(registry)}:${onDuty(registry).length}`;

/** C-4：配置里写的主管名必须对应一个真实在岗、职责匹配、范围覆盖的 Agent。 */
function supervisorDutyIssue(registry: AgentRegistry, key: string, domain: string | null): string | null {
  const agent = onDuty(registry).find(a => a.key === key);
  if (!agent) return '未在组织注册表在岗（或已停用）';
  if (!agent.responsibilities.includes('supervisor')) return '未绑定主管职责';
  if (!scopeCovers(agent, domain)) return '生效范围不覆盖该业务域';
  return null;
}

/** evidence 上限 12 条；追加 Router 快照时先给原有证据让位，不改任何既有业务依据。 */
function withMark(input: RoutingRequest, ...marks: string[]): RoutingRequest {
  const prior = input.basis.evidence ?? [];
  return { ...input, basis: { ...input.basis, evidence: [...prior.slice(0, 12 - marks.length), ...marks] } };
}

function keyOf(target: RoutingDecision['target']): string {
  return target.agentKey ?? target.serviceId ?? target.roleId ?? target.role;
}

/**
 * 纯函数：不 IO、不读时钟（时间由 routingDecision 统一注入）、不写 Trace。
 * 两次同输入同配置产出完全相同（含 decisionId），便于重放与回放验证。
 */
export function planRoute(input: RoutingRequest, config: RouterConfig = defaultRouterConfig(),
  registry?: AgentRegistry): RoutingPlan {
  const revision = routerRevision(config);
  const regRevision = registry ? registryRevision(registry) : null;
  /** 注册表快照追加在 Router 标记之前，保持「最后一个证据是 Router 配置快照」的既有语义。 */
  const snapshot = (req: RoutingRequest, ...marks: string[]) =>
    withMark(req, ...(registry ? [dutyMark(registry)] : []), ...marks);
  const { domain: requestedDomain, ...decisionInput } = input;
  const base = (overrides: Partial<RoutingRequest> = {}) => ({ ...decisionInput, ...overrides });
  const domain = requestedDomain ?? config.defaultDomain ?? null;
  const empty = (extra: Partial<RoutingPlan> = {}): RoutingPlan => ({
    mode: config.mode, revision, hops: [], blocked: null, degraded: null,
    domain, supervisorAgentKey: null, registryRevision: regRevision, ...extra,
  });

  // legacy：一行回退。原样产出改造前那一条决策，连 evidence 都不动。
  if (config.mode === 'legacy') {
    return empty({ hops: [routingDecision(decisionInput)] });
  }

  const supervisor = domain ? config.domains[domain] : undefined;
  const supervisorKey = supervisor?.supervisorAgentKey ?? null;
  // 被拒绝 / 待定的派活没有真的交出去，不展开两跳；人签红线只在最后一跳。
  const committed = (input.outcome ?? 'committed') === 'committed';
  // C-4：显式传入注册表时，配置里写的主管名必须对应真实在岗、职责匹配、范围覆盖的 Agent。
  // 未传注册表 = C-3 逐字等价（既有真跑与历史决策一律不受影响）。
  const dutyIssue = registry && supervisorKey ? supervisorDutyIssue(registry, supervisorKey, domain) : null;
  let wantsTwoHops = config.mode === 'layered' && config.maxHops >= 2 && committed
    && Boolean(supervisor) && supervisorKey !== keyOf(input.target);
  let boundDegraded: string | null = null;
  if (wantsTwoHops && dutyIssue) {
    wantsTwoHops = false;
    boundDegraded = `业务域 ${domain ?? '未指定'} 配置的主管 ${supervisorKey} ${dutyIssue}，按扁平派单`;
  }
  const total = wantsTwoHops ? 2 : 1;
  const degraded = boundDegraded ?? (config.mode === 'layered' && total === 1
    ? (!committed ? '本次派活未提交（rejected / pending），保持单跳记录'
      : supervisor ? '业务域主管与承接人是同一 Agent，跳过中间层避免自派自验'
        : `业务域 ${domain ?? '未指定'} 未配置中间决策层，按扁平派单`)
    : null);

  if (!wantsTwoHops) {
    return empty({
      hops: [routingDecision(snapshot(base(), mark(config.mode, revision, 1, total)))],
      degraded, supervisorAgentKey: supervisorKey,
    });
  }

  // 走到这里说明 wantsTwoHops 成立：业务域与主管名必然存在。
  const confirmedSupervisor = supervisorKey!;
  const seed = input.idempotencyKey ?? `${input.taskId}:${input.stage}:${input.caller.actor}`;
  const personalKey = supervisor!.personalAgentKey;

  // 自派自验自环守卫：caller 与 target 撞车、主管与承接人撞车、或个人 Agent 与主管撞车。
  const collisions: string[] = [];
  if (input.caller.actor === keyOf(input.target)) collisions.push('原始调用方与承接人是同一主体');
  if (input.caller.actor === confirmedSupervisor) collisions.push('原始调用方与业务域主管是同一主体');
  if (personalKey && personalKey === keyOf(input.target)) collisions.push('Personal Agent 与承接人是同一主体');
  if (collisions.length) {
    // 被拦的派活也要留痕：写一条 rejected 决策，不静默丢掉这次尝试。
    const reason = collisions.join('；');
    return empty({
      blocked: reason, supervisorAgentKey: confirmedSupervisor,
      hops: [routingDecision(snapshot(base({ outcome: 'rejected' as const }),
        mark(config.mode, revision, 1, 1), 'router:blocked:' + reason.slice(0, 120)))],
    });
  }

  // 第一跳只是把活交给业务域主管：不能替人签字，也不能把红线扩散成两次签字。
  const handoff: RoutingRequest = { ...decisionInput,
    target: { role: 'supervisor' as const, agentKey: confirmedSupervisor },
    causedBy: input.causedBy ?? input.taskId,
    idempotencyKey: seed + ':hop1',
    outcome: 'committed' as const,
  };
  delete handoff.requiresHumanSignature;
  delete handoff.signatureReason;
  const hop1 = routingDecision(snapshot(handoff, mark(config.mode, revision, 1, 2)));

  const hop2 = routingDecision(snapshot(base({
    caller: { actor: confirmedSupervisor, role: 'supervisor' as const, source: 'role-registry' as const },
    causedBy: hop1.decisionId,
    idempotencyKey: seed + ':hop2',
  }), mark(config.mode, revision, 2, 2)));

  return {
    mode: config.mode, revision, hops: [hop1, hop2], blocked: null, degraded: null,
    domain, supervisorAgentKey: confirmedSupervisor, registryRevision: regRevision,
  };
}

/** Trace 里认 Router 的标记：p6 单一 Router 入口按真实证据判定，不靠开关假装完成。 */
export const ROUTER_MARK = /^router:(legacy|flat|layered)@[0-9a-f]{12}:\d\/\d$/;
export function routedBy(decision: RoutingDecision): boolean {
  return decision.basis.evidence.some(e => ROUTER_MARK.test(e));
}
/** 全部路由事件都带 Router 快照，才算入口收敛；空日志不算完成。 */
export function planCoverage(events: MemoryEvent[]): { total: number; routed: number; singleRouterEntry: boolean } {
  const decisions = events.map(decisionOf).filter((d): d is RoutingDecision => d !== null);
  const routed = decisions.filter(routedBy).length;
  return { total: decisions.length, routed, singleRouterEntry: decisions.length > 0 && routed === decisions.length };
}

export type RouteResult = RoutingPlan & { written: number };

/** 唯一写入口：所有 hop 都经同一个 RoutingTrace，日志失败不改业务结果。 */
export class Router {
  constructor(
    readonly config: RouterConfig = defaultRouterConfig(),
    readonly trace: RoutingTrace = getRoutingTrace(),
    /** C-4：显式装配后才启用「主管必须真实在岗」校验；undefined 保持 C-3 逐字等价。 */
    readonly registry?: AgentRegistry,
  ) {}
  route(input: RoutingRequest, trace?: RoutingTrace): RouteResult {
    const sink = trace ?? this.trace;
    const plan = planRoute(input, this.config, this.registry);
    let written = 0;
    for (const hop of plan.hops) {
      try { if (sink.record(hop).written) written++; } catch { /* advisory：日志永不前置 */ }
    }
    return { ...plan, written };
  }
  status() {
    const revision = routerRevision(this.config);
    return {
      mode: this.config.mode, revision, maxHops: this.config.maxHops,
      defaultDomain: this.config.defaultDomain ?? null,
      domains: Object.entries(this.config.domains).map(([id, d]) => ({ id, label: d.label, supervisorAgentKey: d.supervisorAgentKey })),
      shape: this.config.mode === 'legacy' ? '沿用原有直写' : this.config.mode === 'flat' ? '扁平（1 跳）' : '按业务域分层（最多 2 跳）',
      agentRegistry: registrySummary(this.registry ?? defaultAgentRegistry()),
    };
  }
}

let current: Router | undefined;
export function getRouter(): Router { return current ??= new Router(); }
/** 服务端启动时用真实配置装配；不主动 loadConfig，避免测试进程读真实 .runtime/config.json。 */
export function configureRouter(config: RouterConfig, trace?: RoutingTrace, registry?: AgentRegistry): Router {
  return current = new Router(config, trace ?? getRoutingTrace(), registry);
}
export function setRouter(router: Router | null): void { current = router ?? undefined; }
