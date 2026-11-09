/**
 * 分层契约体检（第四十轮）。
 *
 * 目的：把「架构文档里写的分层」变成「跑一次就能看到的断言」。
 * 本文件是纯函数、零模型调用、不读时钟、不写盘；每条检查都**调用真实实现**
 * （Router 的 planRoute、Agent 注册表的 resolveAssignment、知识分区判定、
 * 验收工作台聚合、直通判定），不是复述文档。
 *
 * 口径铁律：
 *   - 只报事实：通过写通过，降级写 partial 并说明为什么，缺失写 gap；
 *   - 不许把「没做」写成「等价实现」；
 *   - 检查函数自身抛错 = gap，不吞异常。
 *
 * 运行时检查（文件装配、casbin 策略文件、派活点接线）由
 * scripts/layers-audit.ts 追加，本文件只覆盖可纯判定的部分。
 */
import { planRoute, routedBy, planCoverage, type RoutingRequest } from './router.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reconcile, isReconcileRequest } from './reconcile.ts';
import { attachChannel, attachTask, createTopic, readTopic, topicDigest } from './topic.ts';
import type { RouterConfig } from './config.ts';
import {
  agentInstanceSchema, agentRegistrySchema, defaultAgentRegistry, resolveAssignment,
  reviewCrew, handoffEnvelope, selfReviewConflict, registryRevision, agentVersion,
  type AgentRegistry,
} from './agent-registry.ts';
import { toMemoryEvent } from './routing-decision.ts';
import { ROLE_PERMISSIONS, RBAC_HUMAN_ROLES, RBAC_AGENT_TIERS } from './rbac.ts';
import {
  canWriteKnowledge, canReadKnowledge, canCreateKnowledge, agentTier,
  type Enforce, type KnowledgeActor,
} from './knowledge-authz.ts';
import { buildAcceptanceWorkbench } from './acceptance-workbench.ts';
import { createPlan, type AcceptancePlan } from './acceptance-plan.ts';
import { assertEvidenceRegions, type AcceptanceRound } from './acceptance-round.ts';
import { passThroughDecision, type PassThroughCandidate } from './pass-through.ts';
import { assessAdmission } from './admission.ts';
import { validateModelSettings } from './model-settings.ts';
import { parseUserCommand } from './user-language.ts';

export const LAYERS = ['router', 'pass-through', 'agent', 'permission', 'knowledge', 'acceptance', 'personalization'] as const;
export type Layer = typeof LAYERS[number];
export const LAYER_LABELS: Record<Layer, string> = {
  router: '路由层（三层派活）',
  'pass-through': '直通层（同会话接续）',
  agent: 'Agent 层（编制与交接）',
  permission: '权限层（RBAC 三档）',
  knowledge: '知识层（三分区）',
  acceptance: '验收层（清单与人签）',
  personalization: '个性化层（偏好与个人区）',
};

export type LayerStatus = 'ok' | 'partial' | 'gap';

export type LayerCheck = {
  id: string;
  layer: Layer;
  title: string;
  /** 这条断言到底断言了什么（一句话，可被反驳）。 */
  claim: string;
  status: LayerStatus;
  evidence: string[];
  note?: string;
  modelCalls: 0;
};

export type LayerVerdict = { ok: number; partial: number; gap: number; verdict: LayerStatus };

export type LayerReport = {
  schemaVersion: 1;
  ok: boolean;
  counts: { total: number; ok: number; partial: number; gap: number };
  byLayer: Record<Layer, LayerVerdict>;
  checks: LayerCheck[];
};

export type LayerAuditOptions = {
  /** 用户名 -> 角色；用于模拟 casbin 的 g 段绑定（默认四个演示账号）。 */
  roles?: Record<string, 'owner' | 'admin' | 'operator' | 'viewer'>;
  /** 自定义判定函数；默认按 ROLE_PERMISSIONS 种子 + roles 绑定模拟 casbin。 */
  enforce?: Enforce;
};

type CheckResult = { status: LayerStatus; evidence: string[]; note?: string };
const pass = (evidence: string[], note?: string): CheckResult => ({ status: 'ok', evidence, ...(note ? { note } : {}) });
const half = (evidence: string[], note: string): CheckResult => ({ status: 'partial', evidence, note });
const miss = (evidence: string[], note?: string): CheckResult => ({ status: 'gap', evidence, ...(note ? { note } : {}) });

const msg = (error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 200);

function run(id: string, layer: Layer, title: string, claim: string, fn: () => CheckResult): LayerCheck {
  try {
    const result = fn();
    return { id, layer, title, claim, ...result, modelCalls: 0 };
  } catch (error) {
    return { id, layer, title, claim, status: 'gap', evidence: [`判定过程抛错：${msg(error)}`], modelCalls: 0 };
  }
}

/* ------------------------------------------------------------------ 夹具 */

const FLAT: RouterConfig = { schemaVersion: 1, mode: 'flat', domains: {}, maxHops: 2 };
const LAYERED: RouterConfig = {
  schemaVersion: 1, mode: 'layered', maxHops: 2, defaultDomain: 'product',
  domains: { product: { label: '产品', supervisorAgentKey: 'sup-product', personalAgentKey: 'pa-owner' } },
};

const registryOf = (agents: unknown[]): AgentRegistry => agentRegistrySchema.parse({ schemaVersion: 1, agents });
const REGISTRY: AgentRegistry = registryOf([
  { key: 'sup-product', label: '产品主管', responsibilities: ['supervisor'], domains: ['product'] },
  { key: 'pa-owner', label: '发起人个人助手', responsibilities: ['personal'], domains: ['product'] },
  { key: 'worker-a', label: '执行 A', responsibilities: ['worker'], domains: ['product'] },
  { key: 'acc-1', label: '验收 Agent', responsibilities: ['acceptance'], domains: ['product'] },
  { key: 'std-1', label: '标准起草', responsibilities: ['standard-drafting'], domains: ['product'] },
  { key: 'ins-1', label: '巡检 Agent', responsibilities: ['inspection'], domains: ['product'] },
]);
const OFF_DUTY: AgentRegistry = registryOf([
  { key: 'sup-product', label: '产品主管（已停用）', responsibilities: ['supervisor'], domains: ['product'], enabled: false },
  { key: 'worker-a', label: '执行 A', responsibilities: ['worker'], domains: ['product'] },
]);

const routeInput = (overrides: Partial<RoutingRequest> = {}): RoutingRequest => ({
  taskId: 'T-AUDIT', stage: 'dispatch',
  caller: { actor: 'alice', role: 'personal', source: 'human' },
  target: { role: 'worker', agentKey: 'worker-a' },
  basis: { kind: 'user-command', evidence: ['audit'] },
  domain: 'product',
  idempotencyKey: 'audit-1',
  ...overrides,
});

const agentOf = (key: string, domains: string[], responsibilities: string[] = ['worker']) =>
  agentInstanceSchema.parse({ key, label: key, responsibilities, domains });

const human = (name: string): KnowledgeActor => ({ kind: 'human', username: name });

const PASS_CANDIDATE: PassThroughCandidate = {
  id: 'T-DIRECT', phase: 'running',
  binding: { senderId: 'ou_alice', chatId: 'oc_team' }, requesterUserId: 'u-alice',
};

const planFixture = (): AcceptancePlan => createPlan({
  taskId: 'T-ACCEPT', names: ['页面可打开且无白屏', '控制台无未捕获异常'],
  lockedBy: 'alice', reviewerModel: 'reviewer-x', producerModel: 'producer-y',
});

const roundFixture = (plan: AcceptancePlan, over: Partial<AcceptanceRound> = {}): AcceptanceRound => ({
  schemaVersion: 1, taskId: plan.taskId, round: 1, planHash: plan.hash, planRevision: 'rev-1',
  reviewer: { model: 'reviewer-x', producerModel: 'producer-y', requiresVision: true },
  judgements: plan.items.map(item => ({
    itemId: item.id, name: item.name, status: 'passed' as const,
    evidenceRefs: ['evidence:1'], reason: '按清单逐项核对通过',
  })),
  overall: 'passed', createdAt: '2026-11-09T00:00:00.000Z', ...over,
});

const MODEL_SETTINGS = {
  profiles: [
    { id: 'fast', name: '轻量事务', tier: 'fast', provider: 'unconfigured', model: '', credentialEnv: '', maxInputChars: 12000, maxOutputTokens: 2048 },
    { id: 'standard', name: '复杂分析', tier: 'standard', provider: 'codex-cli', model: '', credentialEnv: '', maxInputChars: 24000, maxOutputTokens: 4096 },
    { id: 'code', name: '开发执行', tier: 'code', provider: 'codex-cli', model: '', credentialEnv: '', maxInputChars: 24000, maxOutputTokens: 8192 },
  ],
  bindings: [{ agent: 'worker-a', fast: 'fast', standard: 'standard', code: 'code' }],
  externalRequestsEnabled: false as const,
};

function seedEnforceFor(roles: NonNullable<LayerAuditOptions['roles']>): Enforce {
  return (sub, permission) => {
    const role = sub.startsWith('user:') ? roles[sub.slice(5)] : sub;
    return Boolean(role) && (ROLE_PERMISSIONS[role!] ?? []).includes(permission);
  };
}

/* ------------------------------------------------------------------ 主函数 */

export function auditLayerContracts(options: LayerAuditOptions = {}): LayerReport {
  const roles = options.roles ?? { alice: 'owner', bob: 'admin', carol: 'operator', dave: 'viewer' };
  const enforce = options.enforce ?? seedEnforceFor(roles);
  const checks: LayerCheck[] = [];

  /* ---------------------------------------------------------------- 路由 */
  checks.push(run('router.flat-default', 'router', '默认扁平：1 跳',
    '未配置业务域主管时，派活产出 1 跳决策且带 Router 快照，不硬造中间层', () => {
      const plan = planRoute(routeInput({ domain: undefined }), FLAT);
      const marked = plan.hops.length === 1 && routedBy(plan.hops[0]!);
      return marked
        ? pass([`mode=${plan.mode}`, `hops=${plan.hops.length}`, `快照=${plan.hops[0]!.basis.evidence.at(-1)}`])
        : miss([`mode=${plan.mode}`, `hops=${plan.hops.length}`, '决策未带可识别的 Router 快照']);
    }));

  checks.push(run('router.layered-two-hop', 'router', '分层：2 跳且因果相连',
    '配置了主管的业务域走「派活人 → 主管 → 执行者」两跳，第二跳的 causedBy 指向第一跳', () => {
      const plan = planRoute(routeInput(), LAYERED, REGISTRY);
      const [hop1, hop2] = plan.hops;
      const okShape = plan.hops.length === 2 && hop1?.target.agentKey === 'sup-product'
        && hop2?.caller.actor === 'sup-product' && hop2?.causedBy === hop1?.decisionId
        && hop2?.target.agentKey === 'worker-a';
      return okShape
        ? pass([`hops=${plan.hops.length}`, `第一跳→${hop1!.target.agentKey}`, `第二跳 causedBy=${hop2!.causedBy!.slice(0, 12)}…`])
        : miss([`hops=${plan.hops.length}`, `第一跳=${hop1?.target.agentKey ?? '无'}`, `第二跳=${hop2?.target.agentKey ?? '无'}`]);
    }));

  checks.push(run('router.human-signature-last-hop', 'router', '人签只落在最后一跳',
    '红线动作（如最终验收）两跳时只有最后一跳 requiresHumanSignature=true，中间层不替人签字', () => {
      const plan = planRoute(routeInput({ requiresHumanSignature: true, signatureReason: '最终业务验收只能由原发起人在原会话确认' }), LAYERED, REGISTRY);
      const [hop1, hop2] = plan.hops;
      return plan.hops.length === 2 && hop1?.requiresHumanSignature === false && hop2?.requiresHumanSignature === true
        ? pass(['第一跳 requiresHumanSignature=false', '第二跳 requiresHumanSignature=true', `原因=${hop2.signatureReason}`])
        : miss([`hops=${plan.hops.length}`, `第一跳=${hop1?.requiresHumanSignature}`, `第二跳=${hop2?.requiresHumanSignature}`]);
    }));

  checks.push(run('router.degrade-no-supervisor', 'router', '无主管业务域自动退回 1 跳',
    '分层模式遇到未配置主管的业务域，如实降级为扁平派单并写明原因', () => {
      const plan = planRoute(routeInput({ domain: 'finance' }), LAYERED, REGISTRY);
      return plan.hops.length === 1 && Boolean(plan.degraded)
        ? pass([`hops=${plan.hops.length}`, `降级原因=${plan.degraded}`])
        : miss([`hops=${plan.hops.length}`, 'degraded 为空']);
    }));

  checks.push(run('router.degrade-off-duty-supervisor', 'router', '主管不在岗即降级',
    '配置里写了主管名但该 Agent 已停用时，不假装两跳，降级并说明「未在组织注册表在岗」', () => {
      const plan = planRoute(routeInput(), LAYERED, OFF_DUTY);
      const text = String(plan.degraded ?? '');
      return plan.hops.length === 1 && text.includes('在岗')
        ? pass([`hops=${plan.hops.length}`, `降级原因=${text}`])
        : miss([`hops=${plan.hops.length}`, `degraded=${text || '空'}`]);
    }));

  checks.push(run('router.self-review-blocked', 'router', '自派自验自环被拦',
    '承接人与调用方为同一主体时，不产出两跳，写一条 rejected 决策留痕而不是静默丢弃', () => {
      const plan = planRoute(routeInput({ target: { role: 'worker', agentKey: 'alice' } }), LAYERED, REGISTRY);
      return Boolean(plan.blocked) && plan.hops.length === 1 && plan.hops[0]?.outcome === 'rejected'
        ? pass([`blocked=${plan.blocked}`, `决策 outcome=${plan.hops[0]!.outcome}`])
        : miss([`blocked=${plan.blocked ?? '空'}`, `hops=${plan.hops.length}`]);
    }));

  checks.push(run('router.uncommitted-single-hop', 'router', '未提交的派活不展开两跳',
    'outcome=pending/rejected 的派活没有真的交出去，保持单跳记录并注明原因', () => {
      const plan = planRoute(routeInput({ outcome: 'pending' }), LAYERED, REGISTRY);
      return plan.hops.length === 1 && String(plan.degraded ?? '').includes('未提交')
        ? pass([`hops=${plan.hops.length}`, `说明=${plan.degraded}`])
        : miss([`hops=${plan.hops.length}`, `degraded=${plan.degraded ?? '空'}`]);
    }));

  checks.push(run('router.single-trace-entry', 'router', '全部决策走同一份 Trace',
    '把两跳决策转成记忆事件后，覆盖率为 100%（singleRouterEntry=true）', () => {
      const plan = planRoute(routeInput(), LAYERED, REGISTRY);
      const coverage = planCoverage(plan.hops.map(toMemoryEvent));
      return coverage.singleRouterEntry && coverage.total === plan.hops.length
        ? pass([`decisions=${coverage.total}`, `routed=${coverage.routed}`, 'singleRouterEntry=true'])
        : miss([`decisions=${coverage.total}`, `routed=${coverage.routed}`]);
    }));

  /* ---------------------------------------------------------------- 直通 */
  checks.push(run('pass-through.direct-hit', 'pass-through', '同会话补充说明直接接续',
    '同一发起人 + 同一会话 + 唯一在办任务时，直通把话交给原任务，不新建任务', () => {
      const decision = passThroughDecision({
        candidates: [PASS_CANDIDATE],
        actor: { id: 'ou_alice', chatId: 'oc_team' },
        member: { userId: 'u-alice' },
      });
      return decision.direct && decision.taskId === 'T-DIRECT' && !('scope' in decision)
        ? pass([`taskId=${decision.taskId}`, `kind=${decision.kind}`, '决策不含 scope / 权限字段'])
        : miss([`direct=${decision.direct}`, `kind=${decision.kind}`]);
    }));

  checks.push(run('pass-through.binding-required', 'pass-through', '只认原绑定',
    '会话或发起人任一不匹配，就不算直通，按新需求进入 Router', () => {
      const wrongChat = passThroughDecision({ candidates: [PASS_CANDIDATE], actor: { id: 'ou_alice', chatId: 'oc_other' } });
      const wrongSender = passThroughDecision({ candidates: [PASS_CANDIDATE], actor: { id: 'ou_bob', chatId: 'oc_team' } });
      return !wrongChat.direct && !wrongSender.direct
        && wrongChat.kind === 'no-binding' && wrongSender.kind === 'no-binding'
        ? pass([`错会话=${wrongChat.kind}`, `错发起人=${wrongSender.kind}`])
        : miss([`错会话=${wrongChat.kind}`, `错发起人=${wrongSender.kind}`]);
    }));

  checks.push(run('pass-through.accepted-not-revived', 'pass-through', '已验收任务不被直通复活',
    '会话只绑定已验收任务时，直通不接续，按新需求走（不把完成单拉回执行）', () => {
      const decision = passThroughDecision({
        candidates: [{ ...PASS_CANDIDATE, phase: 'accepted' }],
        actor: { id: 'ou_alice', chatId: 'oc_team' },
      });
      return !decision.direct && decision.kind === 'accepted'
        ? pass([`kind=${decision.kind}`, `reason=${decision.reason}`])
        : miss([`direct=${decision.direct}`, `kind=${decision.kind}`]);
    }));

  checks.push(run('pass-through.release-is-terminal', 'pass-through', '释放是终态，不靠 phase 顺带推出',
    '审计里记录过 subscription.released 的绑定，直通报 released 而不是静默当成新需求；与「只绑已验收单」区分开', () => {
      const released = passThroughDecision({
        candidates: [{ ...PASS_CANDIDATE, released: true }],
        actor: { id: 'ou_alice', chatId: 'oc_team' },
      });
      const accepted = passThroughDecision({
        candidates: [{ ...PASS_CANDIDATE, phase: 'accepted' }],
        actor: { id: 'ou_alice', chatId: 'oc_team' },
      });
      return !released.direct && released.kind === 'released' && !accepted.direct && accepted.kind === 'accepted'
        ? pass([`释放=${released.kind}`, `仅验收=${accepted.kind}`, `说明=${released.reason}`])
        : miss([`释放=${released.kind}`, `仅验收=${accepted.kind}`]);
    }));

  checks.push(run('pass-through.out-of-scope-hands-back', 'pass-through', '越界要求交回主链路',
    '换人 / 改验收清单 / 加权限 / 换来源这类补充说明不当成 note 塞给执行端，原样交回主链路且不夹带权限字段', () => {
      const samples = ['把验收清单改一下，少两项', '这个任务换别人做', '给小王开一下访问权限', '把来源换成新的那份文档'];
      const decisions = samples.map(text => passThroughDecision({
        candidates: [PASS_CANDIDATE], actor: { id: 'ou_alice', chatId: 'oc_team' }, text,
      }));
      const inScope = passThroughDecision({
        candidates: [PASS_CANDIDATE], actor: { id: 'ou_alice', chatId: 'oc_team' }, text: '刚补充了验收要求，请继续核对',
      });
      const noScopeField = decisions.every(decision => !('scope' in decision) && !('permissions' in decision));
      return decisions.every(decision => !decision.direct && decision.kind === 'hand-back' && decision.taskId)
        && inScope.direct && noScopeField
        ? pass([`越界=${decisions.length} 条全部 hand-back`, `普通补充说明=${inScope.kind}`, '无权限字段'])
        : miss([`越界=${decisions.map(d => d.kind).join('/')}`, `普通补充说明=${inScope.kind}`]);
    }));

  checks.push(run('pass-through.ambiguous-needs-id', 'pass-through', '多条在办任务要指明任务号',
    '同一会话绑定两条在办任务时，不猜测、不随便挑一条，要求指明任务号', () => {
      const decision = passThroughDecision({
        candidates: [PASS_CANDIDATE, { ...PASS_CANDIDATE, id: 'T-OTHER' }],
        actor: { id: 'ou_alice', chatId: 'oc_team' },
      });
      return !decision.direct && decision.kind === 'ambiguous' && decision.needsTaskReference
        ? pass([`kind=${decision.kind}`, `needsTaskReference=true`])
        : miss([`kind=${decision.kind}`, `needsTaskReference=${decision.needsTaskReference}`]);
    }));

  checks.push(run('pass-through.explicit-command-returns', 'pass-through', '显式指令不进直通',
    '确认验收 / 退回 / 转交 / 查进度 / 建单一律回主链路，直通只处理补充说明', () => {
      const results = (['accept', 'reject', 'handoff', 'status', 'task'] as const).map(action =>
        passThroughDecision({ explicitAction: action, candidates: [PASS_CANDIDATE], actor: { id: 'ou_alice', chatId: 'oc_team' } }));
      return results.every(d => !d.direct && d.kind === 'explicit-command')
        ? pass(results.map((d, i) => `${['accept', 'reject', 'handoff', 'status', 'task'][i]}→${d.kind}`))
        : miss(results.map(d => `${d.kind}`));
    }));

  checks.push(run('pass-through.ownership-denied', 'pass-through', '成员归属不符显式拒绝',
    '配对成员与任务发起人不符时返回 deny=true（拒绝），不静默降级成新需求', () => {
      const decision = passThroughDecision({
        candidates: [PASS_CANDIDATE],
        actor: { id: 'ou_alice', chatId: 'oc_team' },
        member: { userId: 'u-someone-else' },
      });
      return decision.deny && decision.kind === 'ownership' && !decision.direct
        ? pass([`kind=${decision.kind}`, `deny=${decision.deny}`])
        : miss([`kind=${decision.kind}`, `deny=${decision.deny}`]);
    }));

  /* --------------------------------------------------------------- Agent */
  checks.push(run('agent.empty-registry-flat', 'agent', '空编制就是扁平',
    '未配置任何在岗 Agent 时，职责解析返回 null 并说明「扁平小团队不硬造管理层」', () => {
      const assignment = resolveAssignment(defaultAgentRegistry(), { taskId: 'T-AUDIT', responsibility: 'worker' });
      return assignment.agentKey === null && assignment.reason.includes('扁平')
        ? pass(['agentKey=null', `reason=${assignment.reason}`])
        : miss([`agentKey=${assignment.agentKey}`, `reason=${assignment.reason}`]);
    }));

  checks.push(run('agent.assignment-deterministic', 'agent', '职责解析可重放',
    '同一注册表 + 同一查询二次解析结果完全一致（含版本与 revision），且零模型调用', () => {
      const query = { taskId: 'T-AUDIT', responsibility: 'acceptance', domain: 'product' };
      const a = resolveAssignment(REGISTRY, query);
      const b = resolveAssignment(REGISTRY, query);
      const same = a.agentKey === b.agentKey && a.version === b.version && a.registryRevision === b.registryRevision;
      return same && a.modelCalls === 0 && a.agentKey === 'acc-1'
        ? pass([`agentKey=${a.agentKey}`, `version=${a.version}`, `revision=${a.registryRevision}`, 'modelCalls=0'])
        : miss([`a=${a.agentKey}`, `b=${b.agentKey}`]);
    }));

  checks.push(run('agent.scope-filter', 'agent', '生效范围过滤',
    '业务域不覆盖的 Agent 不会被选中接棒（finance 域拿不到 product 域编制的验收 Agent）', () => {
      const assignment = resolveAssignment(REGISTRY, { taskId: 'T-AUDIT', responsibility: 'acceptance', domain: 'finance' });
      return assignment.agentKey === null
        ? pass(['agentKey=null', `candidates=${assignment.candidates.length}`, `reason=${assignment.reason}`])
        : miss([`意外命中 ${assignment.agentKey}`]);
    }));

  checks.push(run('agent.self-review-conflict', 'agent', '产出方不得自验',
    '承接人等于产出方、或已在本 Task 责任链上时，判定为冲突并给出中文原因', () => {
      const sameProducer = selfReviewConflict({ taskId: 'T-AUDIT', candidate: 'worker-a', producer: 'worker-a' });
      const onChain = selfReviewConflict({ taskId: 'T-AUDIT', candidate: 'worker-a', usedKeys: ['worker-a'] });
      return Boolean(sameProducer) && Boolean(onChain)
        ? pass([`产出方冲突=${sameProducer}`, `责任链冲突=${onChain}`])
        : miss(['冲突未被识别']);
    }));

  checks.push(run('agent.handoff-envelope', 'agent', '交接只给引用与范围',
    '交接信封校验职责 / 范围 / 版本 / 自环；通过时只携带 sourceIds 引用，不带正文', () => {
      const okEnvelope = handoffEnvelope(REGISTRY, {
        taskId: 'T-AUDIT', from: 'worker-a', to: 'acc-1', responsibility: 'acceptance',
        domain: 'product', sourceIds: ['src:1', 'src:2'], causedBy: 'c-1',
      });
      const selfHandoff = handoffEnvelope(REGISTRY, {
        taskId: 'T-AUDIT', from: 'acc-1', to: 'acc-1', responsibility: 'acceptance',
        domain: 'product', sourceIds: ['src:1'], causedBy: 'c-2',
      });
      const wrongDuty = handoffEnvelope(REGISTRY, {
        taskId: 'T-AUDIT', from: 'worker-a', to: 'acc-1', responsibility: 'worker',
        domain: 'product', sourceIds: ['src:1'], causedBy: 'c-3',
      });
      return okEnvelope.ok && okEnvelope.scope.sourceIds.length === 2 && !selfHandoff.ok && !wrongDuty.ok
        ? pass([`ok=${okEnvelope.ok}`, `sourceIds=${okEnvelope.scope.sourceIds.join(',')}`, `自交接=${selfHandoff.reason}`, `职责不符=${wrongDuty.reason}`])
        : miss([`ok=${okEnvelope.ok}`, `自交接=${selfHandoff.ok}`, `职责不符=${wrongDuty.ok}`]);
    }));

  checks.push(run('agent.review-crew-distinct', 'agent', '审查编组三方分离',
    '验收 / 起草 / 巡检由不同 Agent 承担，评审者不等于产出方；空编制如实降级', () => {
      const crew = reviewCrew(REGISTRY, { taskId: 'T-AUDIT', domain: 'product', producedBy: 'worker-a' });
      const keys = [crew.reviewer.agentKey, crew.standardDrafter.agentKey, crew.inspector.agentKey];
      const distinct = new Set(keys).size === 3 && !keys.includes('worker-a');
      const empty = reviewCrew(defaultAgentRegistry(), { taskId: 'T-AUDIT', domain: 'product' });
      return distinct && crew.configured && empty.degraded !== null
        ? pass([`编组=${keys.join(' / ')}`, `空编制降级=${empty.degraded}`])
        : miss([`编组=${keys.join(' / ')}`, `configured=${crew.configured}`]);
    }));

  checks.push(run('agent.admission-three-tiers', 'agent', '准入三档，推断档不授予成员身份',
    '配对出在职成员 / 单负责人白名单 = 显式准入；配对失效或多成员未配对 = 推断准入（只回说明）；其余未准入。只有显式准入能带成员身份',
    () => {
      const explicitPaired = assessAdmission({ channel: 'feishu', senderId: 's1', chatId: 'c1', paired: true, pairingValid: true, allowlisted: true, allowlistSize: 1 });
      const explicitOwner = assessAdmission({ channel: 'feishu', senderId: 's1', chatId: 'c1', paired: false, allowlisted: true, allowlistSize: 1 });
      const inferredStale = assessAdmission({ channel: 'feishu', senderId: 's1', chatId: 'c1', paired: true, pairingValid: false, allowlistSize: 1 });
      const inferredUnpaired = assessAdmission({ channel: 'feishu', senderId: 's1', chatId: 'c1', paired: false, allowlisted: true, allowlistSize: 3 });
      const rejected = assessAdmission({ channel: 'feishu', senderId: 's1', chatId: 'c1', paired: false, allowlisted: false, allowlistSize: 1 });
      const okChain = explicitPaired.memberContext && !explicitOwner.memberContext
        && inferredStale.handling === 'acknowledge' && !inferredStale.memberContext
        && inferredUnpaired.handling === 'acknowledge' && !inferredUnpaired.memberContext
        && rejected.handling === 'reject';
      const evidence = [
        `已配对=${explicitPaired.strength}/成员身份=${explicitPaired.memberContext}`,
        `单负责人白名单=${explicitOwner.strength}/成员身份=${explicitOwner.memberContext}`,
        `配对失效=${inferredStale.strength}/${inferredStale.handling}`,
        `多成员未配对=${inferredUnpaired.strength}/${inferredUnpaired.handling}`,
        `未准入=${rejected.strength}/${rejected.handling}`,
      ];
      return okChain ? pass(evidence) : miss(evidence);
    }));

  /* ---------------------------------------------------------------- 权限 */
  checks.push(run('permission.role-monotonic', 'permission', '四级角色单调包含',
    'owner ⊇ admin ⊇ operator ⊇ viewer（owner 额外持有账号管理），没有越级空洞', () => {
      const set = (role: string) => new Set(ROLE_PERMISSIONS[role] ?? []);
      const subset = (a: Set<string>, b: Set<string>) => [...a].every(item => b.has(item));
      const admin = set('admin'), operator = set('operator'), viewer = set('viewer');
      const ownerExtra = [...set('owner')].filter(item => !admin.has(item));
      const okChain = subset(admin, set('owner')) && subset(operator, admin) && subset(viewer, operator)
        && ownerExtra.every(item => item === 'accounts-manage');
      return okChain
        ? pass([`owner=${set('owner').size}`, `admin=${admin.size}`, `operator=${operator.size}`, `viewer=${viewer.size}`,
          `owner 额外持有=${ownerExtra.join(',') || '无'}`])
        : miss([`越级权限=${ownerExtra.filter(item => item !== 'accounts-manage').join(',') || '无'}`]);
    }));

  checks.push(run('permission.agent-tiers', 'permission', 'Agent 三档对齐职责',
    '主管 → agent-supervisor；执行/验收/起草/巡检 → agent-worker；其余 → agent-personal', () => {
      const supervisor = agentTier(agentOf('s', ['*'], ['supervisor']));
      const worker = agentTier(agentOf('w', ['*'], ['worker']));
      const acceptance = agentTier(agentOf('a', ['*'], ['acceptance']));
      const personal = agentTier(agentOf('p', ['*'], ['personal']));
      return supervisor === 'agent-supervisor' && worker === 'agent-worker'
        && acceptance === 'agent-worker' && personal === 'agent-personal'
        ? pass([`supervisor=${supervisor}`, `worker=${worker}`, `acceptance=${acceptance}`, `personal=${personal}`])
        : miss([supervisor, worker, acceptance, personal]);
    }));

  checks.push(run('permission.knowledge-personal-owner-only', 'permission', '个人区只有本人可改',
    '个人区条目：归属者本人可写，他人（含管理员）不可写；管理员可读（总览）', () => {
      const entry = { visibility: 'personal' as const, owner: 'user:alice' };
      const owner = canWriteKnowledge(human('alice'), entry, 'update', enforce);
      const other = canWriteKnowledge(human('bob'), entry, 'update', enforce);
      const adminRead = canReadKnowledge(human('bob'), entry, enforce);
      return owner.allowed && !other.allowed && adminRead.allowed
        ? pass([`本人=${owner.allowed}`, `他人写=${other.allowed}`, `管理员读=${adminRead.allowed}`])
        : miss([`本人=${owner.allowed}`, `他人写=${other.allowed}`, `管理员读=${adminRead.allowed}`]);
    }));

  checks.push(run('permission.knowledge-team-org', 'permission', '协作区 / 组织区按档位',
    'viewer 不能写协作区；operator 能写协作区但不能改组织区；admin 能改能删组织区', () => {
      const team = { visibility: 'team' as const, owner: 'user:dave', domains: ['product'] };
      const org = { visibility: 'org' as const, owner: 'user:bob', domains: ['product'] };
      const viewerTeam = canWriteKnowledge(human('dave'), team, 'create', enforce);
      const operatorTeam = canWriteKnowledge(human('carol'), team, 'create', enforce);
      const operatorOrg = canWriteKnowledge(human('carol'), org, 'update', enforce);
      const adminOrg = canWriteKnowledge(human('bob'), org, 'update', enforce);
      const adminDelete = canWriteKnowledge(human('bob'), org, 'delete', enforce);
      const okChain = !viewerTeam.allowed && operatorTeam.allowed && !operatorOrg.allowed && adminOrg.allowed && adminDelete.allowed;
      return okChain
        ? pass([`viewer→team=${viewerTeam.allowed}`, `operator→team=${operatorTeam.allowed}`,
          `operator→org=${operatorOrg.allowed}`, `admin→org 改=${adminOrg.allowed}`, `admin→org 删=${adminDelete.allowed}`])
        : miss([`viewer→team=${viewerTeam.allowed}`, `operator→team=${operatorTeam.allowed}`,
          `operator→org=${operatorOrg.allowed}`, `admin→org=${adminOrg.allowed}`]);
    }));

  checks.push(run('permission.knowledge-agent-scope', 'permission', 'Agent 只能改自己域内',
    'Agent 写协作区 / 组织区前先校验生效范围；跨域写入被拒，无编制信息的 Agent 一律拒绝', () => {
      const worker = { kind: 'agent' as const, key: 'agent-a', agent: agentOf('agent-a', ['product']) };
      const inScope = canWriteKnowledge(worker, { visibility: 'team', owner: 'agent:agent-a', domains: ['product'] }, 'create', enforce);
      const crossScope = canWriteKnowledge(worker, { visibility: 'team', owner: 'agent:agent-a', domains: ['finance'] }, 'create', enforce);
      const ghost = canWriteKnowledge({ kind: 'agent', key: 'ghost' }, { visibility: 'team', domains: ['product'] }, 'create', enforce);
      return inScope.allowed && !crossScope.allowed && !ghost.allowed
        ? pass([`域内=${inScope.allowed}`, `跨域=${crossScope.allowed}`, `无编制=${ghost.allowed}`])
        : miss([`域内=${inScope.allowed}`, `跨域=${crossScope.allowed}`, `无编制=${ghost.allowed}`]);
    }));

  /* ---------------------------------------------------------------- 知识 */
  checks.push(run('knowledge.legacy-default-org', 'knowledge', '旧记录缺省按最严分区',
    '没有 visibility 字段的历史条目按组织区处理（最严），viewer 不能改', () => {
      const legacy = {};
      const result = canWriteKnowledge(human('dave'), legacy, 'update', enforce);
      const readable = canReadKnowledge(human('carol'), legacy, enforce);
      return !result.allowed && readable.allowed
        ? pass([`viewer 写=${result.allowed}`, `reason=${result.reason}`, `operator 读=${readable.allowed}`])
        : miss([`viewer 写=${result.allowed}`]);
    }));

  checks.push(run('knowledge.create-aligns-with-update', 'knowledge', '新建与修改同一条范围口径',
    '新建条目按条目自己的业务域校验 Agent 范围：域内可建、跨域被拒，与改已有条目一致', () => {
      const domainSupervisor = { kind: 'agent' as const, key: 'sup-p', agent: agentOf('sup-p', ['product'], ['supervisor']) };
      const globalSupervisor = { kind: 'agent' as const, key: 'sup-all', agent: agentOf('sup-all', ['*'], ['supervisor']) };
      const inDomainTeam = canCreateKnowledge(domainSupervisor, 'team', { domains: ['product'], enforce });
      const crossDomainTeam = canCreateKnowledge(domainSupervisor, 'team', { domains: ['finance'], enforce });
      const inDomainOrg = canCreateKnowledge(domainSupervisor, 'org', { domains: ['product'], enforce });
      const globalOrg = canCreateKnowledge(globalSupervisor, 'org', { domains: ['*'], enforce });
      const consistent = inDomainTeam.allowed && !crossDomainTeam.allowed && inDomainOrg.allowed && globalOrg.allowed
        && canWriteKnowledge(domainSupervisor, { visibility: 'org', owner: 'agent:sup-p', domains: ['product'] }, 'update', enforce).allowed;
      return consistent
        ? pass([`域内 team=${inDomainTeam.allowed}`, `跨域 team=${crossDomainTeam.allowed}`,
          `域内 org=${inDomainOrg.allowed}`, `全域 org=${globalOrg.allowed}`, '与 update 判定一致'])
        : miss([`域内 team=${inDomainTeam.allowed}`, `跨域 team=${crossDomainTeam.allowed}`,
          `域内 org=${inDomainOrg.allowed}`, `全域 org=${globalOrg.allowed}`]);
    }));

  checks.push(run('knowledge.read-scoped-by-domain', 'knowledge', '读按业务域收窄（与写同口径）',
    '声明了业务域的协作区条目：读方域相交才可读，跨域被拒，管理员可总览；读方域未知时按档位兜底（viewer 被拒），不退回全域放行；未声明域的历史条目保持登录可读',
    () => {
      const worker = { kind: 'agent' as const, key: 'agent-a', agent: agentOf('agent-a', ['product']) };
      const inDomain = canReadKnowledge(worker, { visibility: 'team', domains: ['product'] }, enforce, { readerDomains: ['product'] });
      const crossDomain = canReadKnowledge(worker, { visibility: 'team', domains: ['finance'] }, enforce, { readerDomains: ['product'] });
      const adminOverview = canReadKnowledge(human('bob'), { visibility: 'team', domains: ['finance'] }, enforce, { readerDomains: ['product'] });
      // 读方域未知：worker 档可按协作区档位读，viewer 档被拒（不是全域放行）。
      const unknownWorker = canReadKnowledge(worker, { visibility: 'team', domains: ['finance'] }, enforce);
      const unknownViewer = canReadKnowledge(human('dave'), { visibility: 'team', domains: ['finance'] }, enforce);
      const legacy = canReadKnowledge(worker, { visibility: 'team' }, enforce, { readerDomains: ['product'] });
      const orgRead = canReadKnowledge(worker, { visibility: 'org', domains: ['finance'] }, enforce, { readerDomains: ['product'] });
      const ok = inDomain.allowed && !crossDomain.allowed && adminOverview.allowed
        && unknownWorker.allowed && !unknownViewer.allowed && legacy.allowed && orgRead.allowed;
      const evidence = [
        `域内读=${inDomain.allowed}`, `跨域读=${crossDomain.allowed}`,
        `管理员总览=${adminOverview.allowed}`, `域未知 worker=${unknownWorker.allowed}`,
        `域未知 viewer=${unknownViewer.allowed}`, `历史无域条目=${legacy.allowed}`, `组织区=${orgRead.allowed}`,
      ];
      return ok ? pass(evidence) : miss(evidence);
    }));

  /* ---------------------------------------------------------------- 验收 */
  checks.push(run('acceptance.plan-rejects-same-model', 'acceptance', '清单锁定即拒绝自评',
    '起草验收清单时评审模型不得等于产出模型，直接抛错而不是事后提醒', () => {
      let rejected = '';
      try { createPlan({ taskId: 'T-ACCEPT', names: ['x'], lockedBy: 'alice', reviewerModel: 'same', producerModel: 'same' }); }
      catch (error) { rejected = msg(error); }
      return rejected.includes('评审者')
        ? pass([`拒绝原因=${rejected}`])
        : miss(['同模型清单未被拒绝']);
    }));

  checks.push(run('acceptance.not-ready-without-plan', 'acceptance', '无清单即未就绪',
    '没有开工前锁定的清单与逐项评审时，工作台 readiness.ready=false 并逐条列缺口', () => {
      const workbench = buildAcceptanceWorkbench({
        taskId: 'T-ACCEPT', plan: null, round: null,
        crew: reviewCrew(defaultAgentRegistry(), { taskId: 'T-ACCEPT' }), report: null,
      });
      const gaps = workbench.readiness.gaps;
      return !workbench.readiness.ready && gaps.length >= 2
        ? pass([`ready=${workbench.readiness.ready}`, `缺口=${gaps.join('；')}`])
        : miss([`ready=${workbench.readiness.ready}`, `gaps=${gaps.length}`]);
    }));

  checks.push(run('acceptance.reviewer-not-producer', 'acceptance', '评审者≠产出方才成立',
    '同一轮评审里评审模型等于产出模型时，工作台判定未就绪并写明原因', () => {
      const plan = planFixture();
      const round = roundFixture(plan, { reviewer: { model: 'producer-y', producerModel: 'producer-y', requiresVision: true } });
      const workbench = buildAcceptanceWorkbench({
        taskId: 'T-ACCEPT', plan: { plan, revision: 'rev-1' }, round,
        crew: reviewCrew(REGISTRY, { taskId: 'T-ACCEPT', domain: 'product' }), report: null,
      });
      const hit = workbench.readiness.gaps.some(gap => gap.includes('评审者与产出方相同'));
      return !workbench.readiness.ready && hit
        ? pass([`ready=${workbench.readiness.ready}`, `缺口=${workbench.readiness.gaps.join('；')}`])
        : miss([`ready=${workbench.readiness.ready}`, `gaps=${workbench.readiness.gaps.join('；')}`]);
    }));

  checks.push(run('acceptance.plan-hash-mismatch', 'acceptance', '清单被替换即作废',
    '本轮评审记录的 planHash 与当前清单哈希不一致时，判定本轮作废', () => {
      const plan = planFixture();
      const round = roundFixture(plan, { planHash: 'tampered' });
      const workbench = buildAcceptanceWorkbench({
        taskId: 'T-ACCEPT', plan: { plan, revision: 'rev-1' }, round,
        crew: reviewCrew(REGISTRY, { taskId: 'T-ACCEPT', domain: 'product' }), report: null,
      });
      const hit = workbench.readiness.gaps.some(gap => gap.includes('清单已变更'));
      return !workbench.readiness.ready && hit
        ? pass([`缺口=${workbench.readiness.gaps.join('；')}`])
        : miss([`gaps=${workbench.readiness.gaps.join('；')}`]);
    }));

  checks.push(run('acceptance.ready-still-human', 'acceptance', '就绪也只是证据',
    '证据链齐时 readiness.ready=true，但结论仍写明「最终核可由原发起人在原会话完成」', () => {
      const plan = planFixture();
      const workbench = buildAcceptanceWorkbench({
        taskId: 'T-ACCEPT', plan: { plan, revision: 'rev-1' }, round: roundFixture(plan),
        crew: reviewCrew(REGISTRY, { taskId: 'T-ACCEPT', domain: 'product' }), report: null,
      });
      const humanReminder = workbench.readiness.note.includes('原发起人')
        && workbench.notes.some(note => note.includes('不替代'));
      return workbench.readiness.ready && humanReminder
        ? pass([`ready=${workbench.readiness.ready}`, `说明=${workbench.readiness.note}`, `红线条数=${workbench.crew.redLines.length}`])
        : miss([`ready=${workbench.readiness.ready}`, `note=${workbench.readiness.note}`]);
    }));

  checks.push(run('acceptance.no-approval-action', 'acceptance', '工作台没有放行按钮',
    '只读聚合产物不含 approve / accept 动作字段，验收动作只能回到原会话', () => {
      const plan = planFixture();
      const workbench = buildAcceptanceWorkbench({
        taskId: 'T-ACCEPT', plan: { plan, revision: 'rev-1' }, round: roundFixture(plan),
        crew: reviewCrew(REGISTRY, { taskId: 'T-ACCEPT', domain: 'product' }), report: null,
      }) as unknown as Record<string, unknown>;
      const actionKeys = Object.keys(workbench).filter(key => /approve|accept|release/i.test(key));
      return actionKeys.length === 0
        ? pass([`字段=${Object.keys(workbench).join(',')}`])
        : miss([`出现动作字段=${actionKeys.join(',')}`]);
    }));

  checks.push(run('acceptance.discussion-is-advisory', 'acceptance', '讨论不参与判定',
    '报告内讨论只带计数：加上讨论前后，工作台的就绪结论与逐项统计完全一致；讨论不能换来「已通过」', () => {
      const plan = planFixture();
      const crew = reviewCrew(REGISTRY, { taskId: 'T-ACCEPT', domain: 'product' });
      const round = roundFixture(plan);
      const plain = buildAcceptanceWorkbench({ taskId: 'T-ACCEPT', plan: { plan, revision: 'rev-1' }, round, crew, report: null });
      const discussed = buildAcceptanceWorkbench({ taskId: 'T-ACCEPT', plan: { plan, revision: 'rev-1' }, round, crew, report: null,
        discussion: { total: 5, unresolved: 3, byItem: { 'item-1': 3 }, note: '讨论只供人看' } });
      const same = JSON.stringify(plain.readiness) === JSON.stringify(discussed.readiness)
        && JSON.stringify(plain.summary) === JSON.stringify(discussed.summary)
        && JSON.stringify(plain.items) === JSON.stringify(discussed.items);
      return same && discussed.discussion.total === 5
        ? pass([`讨论计入=${discussed.discussion.total} 条`, `未处理=${discussed.discussion.unresolved} 条`, '就绪与逐项统计未被讨论改变'])
        : miss(['讨论改变了就绪判定或逐项统计']);
    }));

  checks.push(run('acceptance.regions-are-locators', 'acceptance', '区域只是定位信息',
    '证据区域有上限、非坐标即拒绝，且带不带区域都不改变逐项判定——区域不进判定公式', () => {
      const plan = planFixture();
      const crew = reviewCrew(REGISTRY, { taskId: 'T-ACCEPT', domain: 'product' });
      const withRegions = roundFixture(plan, {
        judgements: plan.items.map(item => ({
          itemId: item.id, name: item.name, status: 'passed' as const, evidenceRefs: ['evidence:1'], reason: '按清单核对通过',
          regions: [{ x: 10, y: 20, width: 120, height: 80, note: '按钮被遮挡' }],
        })),
      });
      const withoutRegions = roundFixture(plan);
      const a = buildAcceptanceWorkbench({ taskId: 'T-ACCEPT', plan: { plan, revision: 'rev-1' }, round: withRegions, crew, report: null });
      const b = buildAcceptanceWorkbench({ taskId: 'T-ACCEPT', plan: { plan, revision: 'rev-1' }, round: withoutRegions, crew, report: null });
      let tooMany = '';
      try { assertEvidenceRegions(Array.from({ length: 9 }, () => ({ x: 0, y: 0, width: 1, height: 1 }))); }
      catch (error) { tooMany = msg(error); }
      let badCoords = '';
      try { assertEvidenceRegions([{ x: -1, y: 0, width: 1, height: 1 }]); }
      catch (error) { badCoords = msg(error); }
      const sameJudgement = a.summary.passed === b.summary.passed && a.items.every((item, index) => item.status === b.items[index]!.status)
        && a.readiness.ready === b.readiness.ready;
      return sameJudgement && a.items[0]!.regions.length === 1 && Boolean(tooMany) && Boolean(badCoords)
        ? pass([`区域数=${a.items[0]!.regions.length}`, `判定一致=${sameJudgement}`, `超限拒绝=${tooMany}`])
        : miss([`判定一致=${sameJudgement}`, `区域数=${a.items[0]!.regions.length}`, `超限拒绝=${tooMany || '未拒绝'}`]);
    }));

  checks.push(run('reconcile.reports-without-mutating', 'acceptance', '对账只报不改',
    '清单与报告对不上时只产出差异与卡片、不改判定；没有产物时说「没得比」而不是「没问题」', () => {
      const declared: { id: string; name: string; required: boolean }[] = [
        { id: 'E1', name: '能导出', required: true }, { id: 'E2', name: '能回滚', required: true },
      ];
      const drifted = reconcile({ declared,
        produced: [{ id: 'E1', status: 'passed' }, { id: 'X9', name: '清单外', status: 'passed' }] });
      const nothing = reconcile({ declared, produced: null });
      const untouched = declared.length === 2 && declared[1]!.id === 'E2';
      const detects = isReconcileRequest('表更新过了，和待办对一下') && !isReconcileRequest('把验收清单改一下，少两项');
      const same = drifted.comparable && drifted.counts.missing === 1 && drifted.counts.extra === 1
        && /没有改动/.test(drifted.card) && nothing.comparable === false && nothing.findings.length === 0
        && /不是核对通过/.test(nothing.conclusion) && untouched && detects;
      return same
        ? pass([`漏验=${drifted.counts.missing}`, `清单外=${drifted.counts.extra}`,
          `无产物可比=${!nothing.comparable}`, '清单未被对账改写'])
        : miss([`漏验=${drifted.counts.missing}`, `清单外=${drifted.counts.extra}`,
          `无产物可比=${!nothing.comparable}`, `改清单不入对账=${detects}`, `清单未被改写=${untouched}`]);
    }));

  checks.push(run('topic.aggregation-requires-owner', 'router', '主题只聚合有责任人的东西',
    '缺负责人的入口/任务挂不进来，一个任务只属一个主题，摘要只陈述现状', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'audit-topic-'));
      const a = createTopic({ title: '闭门会筹备', goal: '把活动办完', ownerUserId: 'ou_a' }, dir);
      const b = createTopic({ title: '另一个主题', goal: '另一件事', ownerUserId: 'ou_b' }, dir);
      let noOwner = '';
      try { attachChannel({ topicId: a.id, kind: 'im', ref: 'oc_1', ownerUserId: '' }, dir); }
      catch (error) { noOwner = msg(error); }
      attachTask({ topicId: a.id, taskId: 't1', roleId: 'role-product', ownerUserId: 'ou_a' }, dir);
      let twice = '';
      try { attachTask({ topicId: b.id, taskId: 't1', roleId: 'role-product', ownerUserId: 'ou_b' }, dir); }
      catch (error) { twice = msg(error); }
      // 挂完要重读：attachTask 返回的是新对象，用挂之前的快照会读到空主题。
      const digest = topicDigest(readTopic(a.id, dir), { t1: { state: 'blocked', blockedReason: '等物料规格' } });
      const ok = Boolean(noOwner) && Boolean(twice) && digest.tasks === 1 && digest.blocked.length === 1
        && /1 个卡点/.test(digest.summary);
      return ok
        ? pass([`缺负责人拒绝=${noOwner.slice(0, 20)}`, `跨主题重复拒绝=${twice.slice(0, 20)}`, '摘要只陈述现状'])
        : miss([`缺负责人拒绝=${noOwner || '未拒绝'}`, `跨主题重复=${twice || '未拒绝'}`, `摘要=${digest.summary}`]);
    }));

  /* ------------------------------------------------------------ 个性化 */
  checks.push(run('personal.model-binding-guarded', 'personalization', '每人模型绑定受校验',
    '执行身份必须存在、档位必须一致、外部请求必须关闭；三处任一不符即拒绝保存', () => {
      const good = validateModelSettings(MODEL_SETTINGS, ['worker-a']);
      let unknownAgent = '', tierMismatch = '', external = '';
      try { validateModelSettings({ ...MODEL_SETTINGS, bindings: [{ agent: 'ghost', fast: 'fast', standard: 'standard', code: 'code' }] }, ['worker-a']); }
      catch (error) { unknownAgent = msg(error); }
      try { validateModelSettings({ ...MODEL_SETTINGS, bindings: [{ agent: 'worker-a', fast: 'fast', standard: 'fast', code: 'code' }] }, ['worker-a']); }
      catch (error) { tierMismatch = msg(error); }
      try { validateModelSettings({ ...MODEL_SETTINGS, externalRequestsEnabled: true }, ['worker-a']); }
      catch (error) { external = msg(error); }
      return good.bindings.length === 1 && Boolean(unknownAgent) && Boolean(tierMismatch) && Boolean(external)
        ? pass([`合法=${good.bindings.length} 条绑定`, `未知身份=${unknownAgent}`, `档位不符=${tierMismatch}`, `外发=${external.slice(0, 40)}`])
        : miss([`未知身份=${unknownAgent || '未拒绝'}`, `档位=${tierMismatch || '未拒绝'}`]);
    }));

  checks.push(run('personal.own-knowledge-space', 'personalization', '个人区可自建',
    '任何人都能建个人区条目，且只有本人可改——个性化知识与团队知识分区隔离', () => {
      const create = canCreateKnowledge(human('dave'), 'personal', { enforce });
      const write = canWriteKnowledge(human('dave'), { visibility: 'personal', owner: 'user:dave' }, 'update', enforce);
      const other = canWriteKnowledge(human('bob'), { visibility: 'personal', owner: 'user:dave' }, 'update', enforce);
      return create.allowed && write.allowed && !other.allowed
        ? pass([`自建=${create.allowed}`, `自改=${write.allowed}`, `他人改=${other.allowed}`])
        : miss([`自建=${create.allowed}`, `自改=${write.allowed}`, `他人改=${other.allowed}`]);
    }));

  checks.push(run('personal.chinese-commands', 'personalization', '中文指令直达动作',
    '「确认验收 / 打回 / 转交 / 查看进度」在语言层解析为固定动作，旧英文命令仍兼容', () => {
      const accept = parseUserCommand('确认验收 SUI-1');
      const reject = parseUserCommand('打回 SUI-1 截图缺失');
      const handoff = parseUserCommand('转交 SUI-1 产品组');
      const legacy = parseUserCommand('/accept SUI-1 abc123');
      return accept?.action === 'accept' && reject?.action === 'reject'
        && handoff?.action === 'handoff' && legacy?.action === 'accept' && legacy.fromLegacySyntax
        ? pass([`确认验收→${accept.action}`, `打回→${reject.action}`, `转交→${handoff.action}`, `旧命令→${legacy.action}`])
        : miss([`accept=${accept?.action}`, `reject=${reject?.action}`, `handoff=${handoff?.action}`]);
    }));

  /* -------------------------------------------------------------- 汇总 */
  const counts = { total: checks.length, ok: 0, partial: 0, gap: 0 };
  const byLayer = Object.fromEntries(LAYERS.map(layer => [layer, { ok: 0, partial: 0, gap: 0, verdict: 'ok' as LayerStatus }])) as Record<Layer, LayerVerdict>;
  for (const check of checks) {
    counts[check.status]++;
    byLayer[check.layer][check.status]++;
  }
  for (const layer of LAYERS) {
    const entry = byLayer[layer];
    entry.verdict = entry.gap > 0 ? 'gap' : entry.partial > 0 ? 'partial' : 'ok';
  }
  return { schemaVersion: 1, ok: counts.gap === 0, counts, byLayer, checks };
}

/** 只读摘要：给控制台 / 交接文档用的短表。 */
export function layerSummary(report: LayerReport) {
  return LAYERS.map(layer => ({
    layer, label: LAYER_LABELS[layer], ...report.byLayer[layer],
    checks: report.checks.filter(check => check.layer === layer).map(check => ({ id: check.id, status: check.status, title: check.title })),
  }));
}

export type { AgentRegistry, AcceptancePlan };
export { registryRevision, agentVersion, RBAC_HUMAN_ROLES, RBAC_AGENT_TIERS };
