// v0.6 functional orchestration.
//
// One entry point for every new semantic object so the shape constraint in
// PRD §10A holds: every object answers "how is it expressed in the IM chat,
// which workbench action records it, and who signs". All renderings go through
// channels.renderForChannel — no ad-hoc message assembly.
//
// Rollout rule: registry/policy are opt-in. When no Role Registry is
// configured, dispatch keeps the existing flat flow untouched (no regression
// of the previously verified SUI journeys).
import type { Store } from './store.ts';
import { RuntimeV06Store, MemoryV06Store, type V06Store } from './v06-store.ts';
import { RoleRegistryService, routeFor, snapshotFor, granularityHints, deriveCapabilities, assertRegistry, emptyRegistry, type RoleRegistry } from './roles.ts';
import { TransferService, createTransfer, assertDispatchAllowed, assertCounterSign, responsibilityChain, toTransferCard,
  evaluateWidening, evaluateTightening, dispatchReceipt, type CreateTransferInput, type Transfer, type GrantMetrics } from './transfer.ts';
import { defaultPolicy, tightenPolicy, effectiveLevel, requiresHumanSign, topologyAdvice, policyForTask, type WorkspacePolicy } from './workspace-policy.ts';
import { requestGrant, approveGrant, denyGrant, revokeGrant, separateApproval, assertGrantUsable, toContextGrantCard, type ContextGrant } from './context-grant.ts';
import { buildContextPack, eligibleForContextPack, acceptEdge, markReusable, invalidateEdges, impactOf, assertLabelAccess,
  type KnowledgeEdge, type ContextPack } from './knowledge-edges.ts';
import { evaluateSignals, clusterSignals, openFixLoop, retest, toSignalCard, type Signal, type SignalMetric } from './organization-signals.ts';
import { TraceEvidenceReviewer, assertReviewerCapable, acceptanceChainReady, type IndependentReviewer } from './independent-review.ts';
import { validateOrgGraph, responsibilityOf, evidenceOf, influencedBy, reachableFrom, NODE_KINDS, EDGE_RULES, EDGE_FAMILIES, type OrgGraph, type OrgEdge, type OrgNode } from './org-ontology.ts';
import { runOrgExtraction, DeterministicExtractionAdapter, buildTaskGraphMirror,
  type L1Reader, type ExtractionAdapter } from './org-extraction.ts';
import { defaultAttentionPolicy, defaultWatchdogPolicy, filterEvent, assertIntervention, inspectRun, recoveryFrom,
  type AttentionPolicy, type WatchdogPolicy } from './runtime-guard.ts';
import { assertStandardExternalised, readPlan } from './acceptance-plan.ts';
import { buildAcceptanceWorkbench } from './acceptance-workbench.ts';
import { FeishuOrgService, parseOrgTable, type OrgMappingDraft } from './feishu-org.ts';
import type { CollabEvent } from './event-stream.ts';
import { renderForChannel, endpointCapabilities, PLAIN_TEXT, type ChannelId, type SemanticObject, type RenderedMessage } from './channels.ts';
import { signatureFor } from './routing-decision.ts';
import { getRouter } from './router.ts';
import { getAgentRegistry, registrySummary, onDuty, agentVersion, reviewCrew,
  type ReviewCrewQuery } from './agent-registry.ts';
import { recordMemory, readBridgedEvents, sourceEventId, sourceKey } from './memory-log.ts';
import { replayMemory } from './memory-projections.ts';
import { EvolutionService, defaultEvolutionDeps, isEvolutionAction } from './evolution.ts';
import { loadConfig } from './config.ts';
import { executionView } from './step-execution.ts';

export interface V06Options {
  workbenchUrl: string;
  channel: ChannelId;
  actorUserId: string;
}

interface OrgMappingRecord {
  appliedAt: string;
  actor: string;
  entries: { userId: string; name: string; roleId: string; department: string | null }[];
  registryVersion: number;
  source: string;
  note: string;
}

export class V06Services {
  readonly store: V06Store;
  readonly roles: RoleRegistryService;
  readonly transfers: TransferService;
  readonly reviewer: IndependentReviewer;
  constructor(readonly localStore: Store,
    readonly pc?: { get: (route: string) => Promise<any>; document: (a: string, b: string, c: string, d: string) => Promise<any> },
    injected?: V06Store, reviewer?: IndependentReviewer,
    readonly l1Reader?: L1Reader, readonly extractionAdapter?: ExtractionAdapter) {
    this.store = injected ?? (pc ? new RuntimeV06Store(pc) : new MemoryV06Store());
    const audit = (action: string, detail: unknown) => this.localStore.audit(action, this.scopeOf(detail), detail);
    this.roles = new RoleRegistryService(this.store, audit);
    this.transfers = new TransferService(this.store, (action, taskId, detail) => this.localStore.audit(action, taskId, detail));
    this.reviewer = reviewer ?? new TraceEvidenceReviewer();
  }
  /** C-6：懒加载，既有测试不触碰到治理台账；服务端可注入按真实配置构造的实例。 */
  private evolutionService?: EvolutionService;
  setEvolution(service: EvolutionService) { this.evolutionService = service; return this; }
  private evolution(): EvolutionService { return this.evolutionService ??= new EvolutionService(); }
  static evolutionWithConfig(config: Parameters<typeof defaultEvolutionDeps>[0]) {
    return new EvolutionService(defaultEvolutionDeps(config));
  }
  /** Injectable so organisation-mapping contracts can be tested without Lark credentials. */
  private feishuOrg = new FeishuOrgService();
  setOrgReader(reader: FeishuOrgService) { this.feishuOrg = reader; }
  private scopeOf(detail: unknown): string {
    const d = detail as { taskId?: string };
    return d?.taskId ?? 'organization';
  }
  private render(obj: SemanticObject, opts: V06Options): RenderedMessage {
    const capabilities = opts.channel === 'feishu' ? PLAIN_TEXT : endpointCapabilities[opts.channel];
    return renderForChannel(obj, { capabilities, workbenchUrl: opts.workbenchUrl });
  }

  // --- A. Role Registry (FR-01/02/03/28) ---------------------------------
  async registryView() { return this.roles.read(); }
  async registrySave(input: unknown, expectedRevision: string | null, actor: string) {
    const result = await this.roles.save(input, expectedRevision, actor);
    this.localStore.audit('v06.registry-saved', 'organization', { actor, version: result.registry.version, roles: result.registry.roles.length });
    return result;
  }
  async registryDerive(evidence: Parameters<typeof deriveCapabilities>[1], actor: string) {
    return this.roles.derive(evidence, actor);
  }
  async roleRoute(input: { roleId: string; domain?: string; prefer?: 'primary' | 'adjacency' }) {
    const { registry } = await this.roles.read();
    return routeFor(registry, input);
  }
  async roleHints(metrics: { crossRoleRatio?: number; transfers?: Record<string, number> } = {}) {
    const { registry } = await this.roles.read();
    return { hints: granularityHints(registry, metrics), blocking: false };
  }
  async roleSnapshot(userId: string) {
    const { registry } = await this.roles.read();
    return snapshotFor(registry, userId);
  }

  // --- D. Transfer (FR-11/12/13) -----------------------------------------
  async transferCreate(input: CreateTransferInput, opts: V06Options) {
    const { registry } = await this.roles.read();
    // The grantor must be the target function owner from the registry, not a
    // value supplied by the caller.
    if (registry.roles.length) {
      const role = registry.roles.find(r => r.id === input.toRoleId && r.active);
      if (!role) throw new Error(`目标职能 ${input.toRoleId} 不在职能注册表中`);
      if (input.toRoleOwnerUserId !== role.ownerUserId || input.grantorUserId !== role.ownerUserId)
        throw new Error('授权人必须是职能注册表中的目标职能 owner');
      const grantee = registry.members.find(m => m.userId === input.granteeUserId);
      if (!grantee) throw new Error('承接人未登记主职能');
      if (grantee.roleId !== input.fromRoleId) throw new Error('承接人主职能与 Transfer 记录不一致');
      const basis = grantee.adjacency.find(a => a.roleId === input.toRoleId);
      if (!basis && !input.consultationOnly) throw new Error('邻接能力没有来自已验收任务的依据，不能正式派单');
      if (basis && !basis.evidence.length) throw new Error('邻接能力依据为空');
    }
    const result = await this.transfers.create({ ...input, capabilityBasis: input.capabilityBasis.length
      ? input.capabilityBasis : [`职能注册表：${input.fromRoleId} → ${input.toRoleId}`] });
    const rendered = this.render(toTransferCard(result.transfer), opts);
    this.localStore.audit('v06.transfer-rendered', result.transfer.taskId, { channel: opts.channel, degraded: rendered.degraded });
    // The existing outbox feeds the connected conversation channel (feishu today).
    // No new frontend route and no ad-hoc message assembly.
    this.localStore.notify(`v06:transfer:${result.transfer.id}`, result.transfer.taskId, rendered.text);
    getRouter().route({
      taskId: result.transfer.taskId, stage: 'transfer',
      caller: { actor: input.grantorUserId, role: 'supervisor', source: 'role-registry' },
      target: { role: 'worker', roleId: input.toRoleId },
      basis: { kind: 'registry', evidence: ['transfer:' + result.transfer.id, 'from:' + input.fromRoleId,
        ...input.capabilityBasis.slice(0, 4)], policyVersion: 'role-registry-v1' },
      scope: { visibility: 'space', ...(input.validUntil ? { expiresAt: input.validUntil } : {}) },
      ...(input.consultationOnly ? {} : signatureFor('formal-transfer')),
      causedBy: result.transfer.id,
      idempotencyKey: 'transfer:' + result.transfer.id,
    });
    return { ...result, message: rendered, responsibility: responsibilityChain(result.transfer) };
  }
  async transferView(taskId: string) { return this.transfers.read(taskId); }
  async transferRevoke(taskId: string, reason: string) { return this.transfers.revoke(taskId, reason); }
  async transferPolicy() { return this.transfers.readPolicy(); }
  async transferPolicySave(input: unknown, expectedRevision: string | null, actor: string) {
    return this.transfers.savePolicy(input, expectedRevision);
  }
  /** FR-11: reject cross-function formal dispatch without an active Transfer. */
  async guardDispatch(input: { taskId: string; fromRoleId: string; toRoleId: string; consultationOnly?: boolean }) {
    const { registry } = await this.roles.read();
    const record = (outcome: 'committed' | 'rejected', reason: string) => getRouter().route({
      taskId: input.taskId, stage: 'dispatch',
      caller: { actor: 'role-registry', role: 'supervisor', source: 'role-registry' },
      target: { role: 'worker', roleId: input.toRoleId },
      basis: { kind: 'registry', evidence: ['from:' + input.fromRoleId, 'to:' + input.toRoleId, reason], policyVersion: 'fr-11' },
      scope: { visibility: 'space' }, outcome,
      causedBy: input.taskId + ':' + input.fromRoleId + '>' + input.toRoleId,
      idempotencyKey: 'guard:' + input.taskId + ':' + input.fromRoleId + ':' + input.toRoleId + ':' + outcome,
    });
    try {
      if (!registry.roles.length) {
        const result = { ...assertDispatchAllowed({ ...input, transfer: null, consultationOnly: true }),
          skipped: true, reason: '尚未配置职能注册表，沿用原有扁平派单' };
        record('committed', result.reason);
        return result;
      }
      const transfer = await this.transfers.read(input.taskId);
      const result = assertDispatchAllowed({ ...input, transfer });
      record('committed', result.reason);
      return result;
    } catch (error) {
      record('rejected', String(error).slice(0, 200));
      throw error;
    }
  }
  async widenPolicy(metrics: GrantMetrics) {
    const { policy, revision } = await this.transfers.readPolicy();
    const evaluation = evaluateWidening(policy, metrics);
    return { policy, revision, evaluation, note: '放宽只免逐次人工审批；留痕、联签、兜底责任、可撤销均不放宽' };
  }
  async tightenOnIncident(metrics: GrantMetrics, actor: string) {
    const { policy, revision } = await this.transfers.readPolicy();
    const next = evaluateTightening(policy, metrics);
    if (next.level === policy.level) return { policy, revision, changed: false };
    const saved = await this.transfers.savePolicy(next, revision);
    this.localStore.audit('v06.grant-auto-tightened', 'organization', { actor, from: policy.level, to: next.level, reason: next.tightenedReason });
    return { ...saved, changed: true };
  }
  async dispatchReceipt(taskId: string) {
    const t = await this.transfers.read(taskId);
    if (!t) throw new Error('未找到 Transfer');
    const receipt = dispatchReceipt(t);
    this.localStore.audit('v06.dispatch-receipt', taskId, receipt);
    return receipt;
  }

  // --- F. Standard externalisation (FR-12) --------------------------------
  async lockStandardForTransfer(taskId: string, plan: Parameters<typeof assertStandardExternalised>[0]) {
    const t = await this.transfers.read(taskId);
    if (!t) throw new Error('跨职能任务必须先有 Transfer');
    assertStandardExternalised(plan, { targetRoleOwner: t.toRoleOwnerUserId, granteeUserId: t.granteeUserId, standardDraftedBy: t.standardDraftedBy });
    const next: Transfer = { ...t, standardLocked: true, planHash: plan.hash };
    await this.store.writeTaskDoc(taskId, 'responsibility-transfer', next);
    this.localStore.audit('v06.standard-locked', taskId, { draftedBy: t.standardDraftedBy, planHash: plan.hash });
    return next;
  }
  async assertCounterSign(taskId: string, action: string, signers: string[]) {
    const t = await this.transfers.read(taskId);
    if (!t) throw new Error('未找到 Transfer');
    assertCounterSign(t, action, signers);
    return { required: true, signers: t.counterSigners };
  }
  /**
   * Pre-/accept consistency check. Opt-in by construction: tasks without a
   * Transfer keep the original originator-only flow untouched. When a
   * cross-function Transfer exists, the sealed plan must have been drafted by
   * the target function owner and must still be the same revision.
   */
  async acceptanceConsistency(taskId: string): Promise<{ checked: boolean; reason: string }> {
    const t = await this.transfers.read(taskId);
    if (!t || t.consultationOnly || t.fromRoleId === t.toRoleId)
      return { checked: false, reason: '无跨职能 Transfer，沿用原有发起人核可' };
    if (!t.standardLocked) throw new Error('跨职能任务的验收标准尚未由目标职能锁定，不能验收');
    if (!this.pc) return { checked: false, reason: '未连接原生文档存储，跳过计划一致性校验' };
    const sealed = await readPlan(this.pc as any, taskId);
    if (!sealed) throw new Error('跨职能任务缺少开工前锁定的验收清单');
    assertStandardExternalised(sealed.plan, { targetRoleOwner: t.toRoleOwnerUserId,
      granteeUserId: t.granteeUserId, standardDraftedBy: t.standardDraftedBy });
    if (t.planHash && t.planHash !== sealed.plan.hash) throw new Error('验收清单已被改写，本轮 Transfer 与验收作废');
    this.localStore.audit('v06.acceptance-consistency', taskId, { transfer: t.id, planHash: sealed.plan.hash });
    return { checked: true, reason: 'Transfer 双段责任链与开工前验收清单一致' };
  }

  // --- C/K. Context Grant & knowledge edges (FR-07/09/10/26) --------------
  async grantRequest(input: Parameters<typeof requestGrant>[0], opts: V06Options) {
    const grant = requestGrant(input);
    await this.store.writeTaskDoc(grant.taskId, 'context-grant', grant);
    this.localStore.audit('v06.grant-requested', grant.taskId, { id: grant.id, approver: grant.approverUserId, granularity: grant.granularity });
    const message = this.render(toContextGrantCard(grant), opts);
    this.localStore.notify(`v06:grant-request:${grant.id}`, grant.taskId, message.text);
    return { grant, message };
  }
  async grantDecide(taskId: string, decision: 'approved' | 'denied', actorUserId: string, reason = '') {
    const grant = await this.readGrant(taskId);
    const next = decision === 'approved' ? approveGrant(grant, actorUserId) : denyGrant(grant, actorUserId, reason);
    await this.store.writeTaskDoc(taskId, 'context-grant', next);
    this.localStore.audit('v06.grant-decided', taskId, { id: next.id, decision, actorUserId });
    return next;
  }
  async grantRevoke(taskId: string, reason: string) {
    const grant = await this.readGrant(taskId);
    const next = revokeGrant(grant, reason);
    await this.store.writeTaskDoc(taskId, 'context-grant', next);
    this.localStore.audit('v06.grant-revoked', taskId, { id: next.id, reason });
    return next;
  }
  async grantSeparateApproval(taskId: string, kind: 'write' | 'reflow', actorUserId: string) {
    const grant = await this.readGrant(taskId);
    const next = separateApproval(grant, kind, actorUserId);
    await this.store.writeTaskDoc(taskId, 'context-grant', next);
    this.localStore.audit('v06.grant-separate-approval', taskId, { kind, actorUserId });
    return next;
  }
  private async readGrant(taskId: string): Promise<ContextGrant> {
    const found = (await this.store.readTaskDoc<ContextGrant>(taskId, 'context-grant'))?.value;
    if (!found) throw new Error('未找到跨空间授权申请');
    return found;
  }
  async grantCheck(taskId: string) {
    // Read model, not a precondition: "this task has no cross-space grant"
    // is a normal empty state. Throwing here made the workbench render
    // "暂不可用" as if the service were broken.
    const grant = (await this.store.readTaskDoc<ContextGrant>(taskId, 'context-grant'))?.value;
    if (!grant) return null;
    assertGrantUsable(grant);
    return { usable: true, message: toContextGrantCard(grant) };
  }

  async edgesView(taskId: string): Promise<KnowledgeEdge[]> {
    return (await this.store.readTaskDoc<KnowledgeEdge[]>(taskId, 'knowledge-edges'))?.value ?? [];
  }
  async edgesSave(taskId: string, edges: KnowledgeEdge[], actor: string) {
    await this.store.writeTaskDoc(taskId, 'knowledge-edges', edges);
    this.localStore.audit('v06.edges-saved', taskId, { actor, count: edges.length, states: edges.reduce<Record<string, number>>((a, e) => ({ ...a, [e.state]: (a[e.state] ?? 0) + 1 }), {}) });
    return edges;
  }
  async edgeAccept(taskId: string, edgeId: string, actor: string) {
    const edges = await this.edgesView(taskId);
    const next = edges.map(e => e.id === edgeId ? acceptEdge(e, actor) : e);
    if (next.every(e => e.id !== edgeId)) throw new Error('边不存在');
    await this.edgesSave(taskId, next, actor);
    this.localStore.audit('v06.edge-accepted', taskId, { edgeId, actor });
    const accepted = edges.find(e => e.id === edgeId);
    recordMemory({ kind: 'edge-accepted', actor, projection: 'l2-organization',
      ...(accepted?.evidenceRefs[0] ? { sourceRef: { sourceId: accepted.evidenceRefs[0].sourceId,
        revision: accepted.evidenceRefs[0].revision } } : {}),
      payload: { taskId, edgeId, state: 'accepted',
        edges: [{ id: edgeId, kind: accepted?.kind ?? '', from: accepted?.from ?? '', to: accepted?.to ?? '' }] },
      idempotencyKey: 'edge-accepted:' + taskId + ':' + edgeId });
    return next;
  }
  async edgeReusable(taskId: string, edgeId: string, actor: string) {
    const edges = await this.edgesView(taskId);
    const next = edges.map(e => e.id === edgeId ? markReusable(e) : e);
    await this.edgesSave(taskId, next, actor);
    return next;
  }
  async edgeInvalidate(taskId: string, reason: string, predicate: (e: KnowledgeEdge) => boolean, actor: string) {
    const edges = await this.edgesView(taskId);
    const next = invalidateEdges(edges, reason, new Date().toISOString(), predicate);
    await this.edgesSave(taskId, next, actor);
    recordMemory({ kind: 'edge-invalidated', actor, projection: 'l2-organization',
      payload: { taskId, reason, edgeIds: next.filter((e, i) => e.invalidAt && !edges[i]?.invalidAt).map(e => e.id) },
      idempotencyKey: 'edge-invalidated:' + taskId + ':' + reason });
    return next;
  }
  async edgeImpact(taskId: string, edgeId: string) { return impactOf(await this.edgesView(taskId), edgeId); }
  async contextPack(input: { taskId: string; registryVersion: number; visibilityFilter: (v: KnowledgeEdge['visibility']) => boolean; ttlHours?: number; at?: string }) {
    const allEdges = await this.edgesView(input.taskId);
    // 方案 B：资料被撤回后，其证据边不得进入 Context Pack。
    // 只按 source-revoked 过滤，避免把单主体授权撤销放大成全局屏蔽；
    // 过滤状态无法核对时 fail-closed，不静默放行。
    let revokedSources: Set<string>;
    try { revokedSources = new Set(replayMemory(readBridgedEvents().events).sourceRevocations); }
    catch (error) { throw new Error('无法核对资料撤权状态，已拒绝构建上下文包：' + String(error).slice(0, 160)); }
    const edges = allEdges.filter(e => !e.evidenceRefs.some(ref => revokedSources.has(ref.sourceId)));
    if (edges.length !== allEdges.length) this.localStore.audit('v06.memory-lineage-filtered', input.taskId,
      { excludedEdges: allEdges.length - edges.length, revokedSources: [...revokedSources] });
    const pack = buildContextPack({ ...input, edges });
    this.localStore.audit('v06.context-pack-built', input.taskId, { refs: pack.refs.length, usable: eligibleForContextPack(edges).length, expiresAt: pack.expiresAt });
    const first = pack.refs[0];
    recordMemory({ kind: 'context-packed', actor: 'organization', projection: 'context-pack',
      ...(first ? { sourceRef: { sourceId: first.sourceId, revision: first.revision },
        causedBy: sourceEventId(first.sourceId, first.revision) } : {}),
      payload: { taskId: input.taskId, refs: pack.refs.map(r => sourceKey(r.sourceId, r.revision)),
        ...(pack.expiresAt ? { expiresAt: pack.expiresAt } : {}) },
      idempotencyKey: 'context-pack:' + input.taskId + ':' + pack.refs.map(r => sourceKey(r.sourceId, r.revision)).join(',') });
    return pack;
  }
  async labelCheck(input: Parameters<typeof assertLabelAccess>[0]) { return assertLabelAccess(input); }

  // --- Workspace policy (FR-05/20/28) ------------------------------------
  async policyView(space: string, ownerUserId: string) {
    const stored = await this.store.readConfig<WorkspacePolicy>(`workspace-policy:${space}`);
    return { policy: stored?.value ?? defaultPolicy(space, ownerUserId), revision: stored?.revision ?? null };
  }
  async policySave(space: string, input: unknown, expectedRevision: string | null, actor: string) {
    const current = await this.policyView(space, (input as any)?.ownerUserId ?? actor);
    if (current.revision !== expectedRevision) throw new Error('空间策略已变化，请刷新后再保存');
    const next = tightenPolicy(current.policy, input);
    const revision = await this.store.writeConfig(`workspace-policy:${space}`, next, expectedRevision);
    this.localStore.audit('v06.workspace-policy-saved', space, { actor, version: next.version, topology: next.topology, defaultLevel: next.verification.defaultLevel });
    return { policy: next, revision };
  }
  async verificationLevel(space: string, ownerUserId: string, input: { taskType?: string; riskAction?: string; external?: boolean }) {
    const { policy } = await this.policyView(space, ownerUserId);
    const level = effectiveLevel(policy, input);
    return { level, humanSign: requiresHumanSign(input.riskAction ?? ''), policyVersion: policy.version,
      floor: (input.external || input.riskAction === 'external_publish' || input.riskAction === 'funds' || input.riskAction === 'customer_visible') ? 'L4（不可下调）' : 'none' };
  }
  async topologyAdvice(metrics: Parameters<typeof topologyAdvice>[0]) { return topologyAdvice(metrics); }
  async inFlightPolicy(space: string, ownerUserId: string, startedVersion: number) {
    const { policy } = await this.policyView(space, ownerUserId);
    return policyForTask([policy], startedVersion);
  }

  // --- G. Organisation signals (FR-21) -----------------------------------
  async signalsView(readings: Partial<Record<SignalMetric, number>>, at = new Date().toISOString()) {
    const signals = evaluateSignals({ at, readings });
    const clusters = clusterSignals(signals);
    this.localStore.audit('v06.signals-read', 'organization', { at, count: signals.length, metrics: signals.map(s => s.metric) });
    return { signals, clusters, messages: signals.map(s => this.render(toSignalCard(s), { channel: 'workspace', workbenchUrl: '', actorUserId: 'system' })),
      blocking: false, note: '只读、只预警、不排名、不考核、不做情绪推断' };
  }
  async signalFixLoop(signal: Signal, taskId: string, fix: string) { return openFixLoop(signal, taskId, fix); }
  async signalRetest(loop: Parameters<typeof retest>[0], value: number, threshold: number) { return retest(loop, value, threshold); }

  // --- C-4 组织级 Agent 编制与验收协作（只读） ---------------------------
  /** 展示在岗 Agent、职责槽位、生效范围与版本；内部标识不外露给用户层。 */
  agentRegistryView() {
    const registry = getAgentRegistry();
    return { ...registrySummary(registry),
      agents: onDuty(registry).map(agent => ({
        key: agent.key, label: agent.label,
        responsibilities: [...agent.responsibilities], domains: [...agent.domains],
        version: agentVersion(agent),
      })) };
  }
  /** 按配置解析这一单的验收协作编组；空编制如实降级，不硬造验收 Agent。 */
  acceptanceCrew(query: Partial<ReviewCrewQuery> = {}) {
    return reviewCrew(getAgentRegistry(), {
      taskId: query.taskId ?? '', domain: query.domain ?? null,
      producedBy: query.producedBy ?? null, usedKeys: query.usedKeys ?? [],
    });
  }

  // --- F. Independent review readiness (FR-18/25) ------------------------
  async reviewReadiness(traceReady: boolean, visualEvidenceRequired = true,
    crewQuery: Partial<ReviewCrewQuery> = {}) {
    assertReviewerCapable(this.reviewer, { producerModel: '', visualEvidenceRequired: false });
    return { ...acceptanceChainReady({ traceReady, reviewer: this.reviewer, visualEvidenceRequired }),
      crew: this.acceptanceCrew(crewQuery) };
  }
  async reviewEvidence(input: Parameters<IndependentReviewer['review']>[0]) {
    const result = await this.reviewer.review(input);
    this.localStore.audit('v06.review-evidence', input.plan.taskId, { reviewer: result.reviewerId, limitations: result.limitations });
    return result;
  }

  // --- FR-08 organisation ontology ---------------------------------------
  async ontologyView(taskId: string): Promise<OrgGraph> {
    return (await this.store.readTaskDoc<OrgGraph>(taskId, 'org-graph'))?.value
      ?? { schemaVersion: 1, nodes: [], edges: [] };
  }
  async ontologySave(taskId: string, graph: OrgGraph, actor: string) {
    validateOrgGraph(graph);
    await this.store.writeTaskDoc(taskId, 'org-graph', graph);
    this.localStore.audit('v06.org-ontology-saved', taskId, { actor, nodes: graph.nodes.length, edges: graph.edges.length });
    return graph;
  }
  async ontologyQuery(taskId: string, query: 'responsibility' | 'evidence' | 'influence' | 'reachability', params: { nodeId?: string; edgeId?: string; startNodeIds?: string[]; allowedEdgeIds?: string[] } = {}) {
    const graph = await this.ontologyView(taskId);
    validateOrgGraph(graph);
    switch (query) {
      case 'responsibility': return responsibilityOf(graph, params.nodeId ?? '');
      case 'evidence': return evidenceOf(graph, params.nodeId ?? '');
      case 'influence': return influencedBy(graph, params.edgeId ?? '');
      case 'reachability': return [...reachableFrom(graph, params.startNodeIds ?? [], params.allowedEdgeIds ?? [])];
    }
  }
  ontologyMeta() { return { nodeKinds: NODE_KINDS, edgeFamilies: EDGE_FAMILIES, rules: EDGE_RULES,
    note: 'L2 组织图；L1 Cognee 证据图按 sourceId@revision 物理隔离，未改动' }; }

  // --- L2 auto-extraction: pinned Cognee L1 projection -> drafted edges -----
  // The canonical L2 graph is organisation-level config (one global graph).
  // Task documents are only a mirror so the existing five-tab workbench can
  // show the same edges; human acceptance always happens on the task record.
  async l2EdgesGlobal(): Promise<KnowledgeEdge[]> {
    return (await this.store.readConfig<KnowledgeEdge[]>('org-edges:global'))?.value ?? [];
  }
  async l2GraphGlobal(): Promise<OrgGraph> {
    return (await this.store.readConfig<OrgGraph>('org-graph:global'))?.value ?? { schemaVersion: 1, nodes: [], edges: [] };
  }
  async l2Status() {
    const stored = await this.store.readConfig<Record<string, unknown>>('l2-extraction:last');
    return { connected: Boolean(this.l1Reader),
      adapter: (this.extractionAdapter ?? new DeterministicExtractionAdapter()).id,
      mode: this.extractionAdapter?.modelCalls ? 'model' : 'deterministic',
      l1Isolation: 'sha256(sourceId@revision) 物理隔离；只读 op=read，不启用 cognify/embedding',
      lastRun: stored?.value ?? null, revision: stored?.revision ?? null };
  }
  async l2Extract(input: { sourceId: string; revision: string; taskId?: string; space?: string;
    classification?: 'public' | 'internal' | 'confidential' | 'restricted'; actor: string; at?: string }) {
    if (!this.l1Reader) throw new Error('L2 抽取未连接 Cognee L1 读取器；先完成 setup:graph 并装配 reader');
    const projection = await this.l1Reader.read({ sourceId: input.sourceId, revision: input.revision });
    const taskId = input.taskId ?? '';
    const globalEdges = await this.l2EdgesGlobal(), globalGraph = await this.l2GraphGlobal();
    const result = await runOrgExtraction({
      projection, sourceId: input.sourceId, revision: input.revision,
      taskId: taskId || 'organization', space: input.space ?? 'default',
      classification: input.classification, actor: input.actor, at: input.at,
      adapter: this.extractionAdapter ?? new DeterministicExtractionAdapter(),
      existingEdges: globalEdges, existingGraph: globalGraph,
    });
    if (result.edges.length || result.orgEdges.length) {
      const edgesRevision = (await this.store.readConfig<KnowledgeEdge[]>('org-edges:global'))?.revision ?? null;
      await this.store.writeConfig('org-edges:global', [...globalEdges, ...result.edges], edgesRevision);
      const graphRevision = (await this.store.readConfig<OrgGraph>('org-graph:global'))?.revision ?? null;
      const merged: OrgGraph = { schemaVersion: 1,
        nodes: [...globalGraph.nodes, ...result.orgNodes], edges: [...globalGraph.edges, ...result.orgEdges] };
      validateOrgGraph(merged);
      await this.store.writeConfig('org-graph:global', merged, graphRevision);
      if (taskId) {
        const taskEdges = await this.edgesView(taskId);
        const freshEdges = result.edges.filter(e => !taskEdges.some(x => x.id === e.id));
        if (freshEdges.length) await this.edgesSave(taskId, [...taskEdges, ...freshEdges], input.actor);
        const taskGraph = await this.ontologyView(taskId);
        // 新草稿边可能引用全局图已有、但本任务图还没有的节点（索引时自动抽取
        // 先跑过一次就会出现）。镜像必须把这些节点一并带入，否则校验会拒绝。
        const mirror: OrgGraph = buildTaskGraphMirror(taskGraph, globalGraph, result);
        validateOrgGraph(mirror);
        await this.store.writeTaskDoc(taskId, 'org-graph', mirror);
      }
    }
    const summary = { sourceId: input.sourceId, revision: input.revision, taskId: taskId || null,
      isolationKey: result.isolationKey, adapterId: result.adapterId, modelCalls: result.modelCalls,
      at: result.at, drafted: result.edges.length, skippedExisting: result.skippedExisting,
      rejected: result.rejected.map(r => r.reason), l1: result.l1, actor: input.actor };
    const lastRevision = (await this.store.readConfig('l2-extraction:last'))?.revision ?? null;
    await this.store.writeConfig('l2-extraction:last', summary, lastRevision);
    this.localStore.audit('v06.l2-extracted', taskId || 'organization', summary);
    // 方案 B：确定性抽取的模型调用数必须如实进事件流（modelCalls=0 是验收红线）。
    recordMemory({ kind: 'edge-drafted', actor: input.actor, projection: 'l2-organization',
      sourceRef: { sourceId: input.sourceId, revision: input.revision },
      causedBy: sourceEventId(input.sourceId, input.revision),
      modelCalls: result.modelCalls,
      policyVersion: 'l2-extraction:' + result.adapterId,
      payload: { sourceId: input.sourceId, revision: input.revision, taskId,
        edges: result.edges.map(e => ({ id: e.id, kind: e.kind, from: e.from, to: e.to })),
        drafted: result.edges.length, rejected: result.rejected.length },
      idempotencyKey: 'l2:' + sourceKey(input.sourceId, input.revision) + ':' + result.isolationKey });
    return { ...summary, edges: result.edges, orgEdges: result.orgEdges, orgNodes: result.orgNodes };
  }

  // --- F. Read-only projections for the existing workbench -------------------
  /** Plan sealed before work started. null means the legacy /accept flow is in use. */
  async acceptancePlanView(taskId: string) {
    if (!this.pc) return null;
    return readPlan(this.pc as any, taskId);
  }
  /** Per-item review report. It is evidence for the originator, never an approval. */
  async acceptanceRoundView(taskId: string) {
    if (!this.pc) return null;
    const { readRound } = await import('./acceptance-round.ts');
    return readRound(this.pc as any, taskId);
  }
  /** Export the sealed round into the pinned lobehub/acceptance report shape. */
  async acceptanceExport(taskId: string) {
    if (!this.pc) throw new Error('未连接原生文档存储，不能导出验收报告');
    const [{ readRound }, interop, { parseTrace }] = await Promise.all([
      import('./acceptance-round.ts'), import('./acceptance-interop.ts'), import('./event-stream.ts'),
    ]);
    const sealed = await readPlan(this.pc as any, taskId);
    const round = await readRound(this.pc as any, taskId);
    if (!sealed || !round) throw new Error('该任务缺少开工前锁定清单或逐项评审报告');
    let events: CollabEvent[] = [];
    try {
      const trace = await this.pc.get(`/issues/${taskId}/documents/trace`);
      events = parseTrace(String(trace?.body ?? ''));
    } catch { events = []; }
    const report = interop.toAcceptanceReport({ plan: sealed.plan, round, events,
      verifier: this.reviewer.capabilities.semanticJudgement ? 'llm' : 'program' });
    interop.assertAcceptanceReport(report);
    const info = interop.upstreamInfo();
    this.localStore.audit('v06.acceptance-exported', taskId,
      { upstreamVersion: info.version, commit: info.commit, verdict: report.summary.verdict });
    return { report, upstream: { name: 'lobehub/acceptance', version: info.version, commit: info.commit } };
  }
  /** One read for the organization sub-tab. Each section degrades independently. */
  /** 工作台只读：本机验收报告索引与自查标准，不触发外部服务。 */
  async acceptanceReportView(taskId: string) {
    const { runtime } = await import('./config.ts');
    const { listBundles, readBundle, readSelfCheck } = await import('./acceptance-report.ts');
    const dir = runtime('acceptance');
    const safe = String(taskId ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const report = safe ? readBundle(dir, safe) : null;
    const standards = readSelfCheck(runtime('v06'));
    return {
      available: !!report, taskId: safe,
      verdict: report?.summary?.verdict ?? null, cases: report?.cases?.length ?? 0,
      createdAt: report?.createdAt ?? null, archivedRounds: listBundles(dir).length,
      selfCheckStandards: standards.standards.slice(-20).map(item => item.text),
      reportUrl: `http://127.0.0.1:4192/acceptance/${safe}`,
      note: '本机只读报告服务（npm run acceptance:serve）；不启动 Acceptance 云端报告服务，业务材料不外发。报告不代替原发起人「确认验收」。',
    };
  }

  /**
   * 控制台「验收 / 审查」工作台：一次只读聚合。
   * 只合并既有投影与审查编组，不产生新的验收结论、不改写清单或人签状态。
   */
  async acceptanceWorkbenchView(taskId: string) {
    const [plan, round, report] = await Promise.all([
      this.acceptancePlanView(taskId),
      this.acceptanceRoundView(taskId),
      this.acceptanceReportView(taskId),
    ]);
    return buildAcceptanceWorkbench({
      taskId, plan, round, report, crew: this.acceptanceCrew({ taskId }),
    });
  }

  // --- 飞书组织映射（FR-01/02 的组织落地）--------------------------------
  /** 只读预览：把当前授权范围可见的真实成员读成草案，不写注册表、不改派单。 */
  async orgMappingPreview(includeChatted = true) {
    const draft = await this.feishuOrg.preview(includeChatted);
    const previous = await this.store.readConfig<OrgMappingDraft>('org-mapping-draft');
    const revision = await this.store.writeConfig('org-mapping-draft', draft, previous?.revision ?? null);
    this.localStore.audit('v06.org-mapping-preview', 'organization', {
      members: draft.members.length, appId: draft.appId,
      departmentScopeMissing: draft.departmentScopeMissing, available: draft.available });
    return { draft, revision };
  }

  /** 工作台只读状态：不触发外部通讯录读取，避免页面等待远端接口。 */
  async orgMappingView() {
    const applied = await this.store.readConfig<OrgMappingRecord>('org-mapping');
    const draft = await this.store.readConfig<OrgMappingDraft>('org-mapping-draft');
    const current = await this.roles.read();
    return {
      applied: applied?.value ?? null,
      draft: draft ? { generatedAt: draft.value.generatedAt, members: draft.value.members.length,
        departmentScopeMissing: draft.value.departmentScopeMissing,
        authorizationHint: draft.value.authorizationHint, note: draft.value.note } : null,
      registryVersion: current.registry.version,
      registeredMembers: current.registry.members.length,
      note: '成员映射只决定派单候选；真人登录、权限与配对仍由原生成员目录决定。',
    };
  }

  /** 人工确认后导入：草案不自动生效，且必须携带注册表当前修订号，防止覆盖他人修改。 */
  async orgMappingApply(input: unknown, expectedRegistryRevision: string | null, actor: string) {
    // Array.prototype.entries is a method — never read it as an `entries` field.
    const entries = parseOrgTable(Array.isArray(input) ? input : (input as { entries?: unknown })?.entries);
    const current = await this.roles.read();
    if (current.revision !== expectedRegistryRevision) throw new Error('职能注册表已变化，请刷新后再导入组织映射');
    const registry = structuredClone(current.registry);
    for (const entry of entries) {
      const role = registry.roles.find(r => r.id === entry.roleId && r.active);
      if (!role) throw new Error(`职能 ${entry.roleId} 不存在或已停用，请先配置职能再导入成员`);
      const existing = registry.members.find(m => m.userId === entry.userId);
      if (existing) {
        if (existing.roleId !== entry.roleId) throw new Error(`成员 ${entry.userId} 已有主职能，需先显式调整再导入`);
        continue; // 保留已派生的领域、邻接能力与职能快照
      }
      registry.members.push({ userId: entry.userId, roleId: entry.roleId,
        domains: entry.domains.map(tag => ({ tag, weight: 0.2, evidence: ['飞书组织表导入，待任务证据校准'] })),
        adjacency: [] });
    }
    const saved = await this.registrySave(registry, current.revision, actor);
    const record: OrgMappingRecord = {
      appliedAt: new Date().toISOString(), actor,
      entries: entries.map(e => ({ userId: e.userId, name: e.name, roleId: e.roleId, department: e.department ?? null })),
      registryVersion: saved.registry.version, source: 'feishu-org-table',
      note: '导入只登记派单候选，不等于真人登录，也不授予任何资料权限。',
    };
    const previous = await this.store.readConfig<OrgMappingRecord>('org-mapping');
    await this.store.writeConfig('org-mapping', record, previous?.revision ?? null);
    this.localStore.audit('v06.org-mapping-applied', 'organization',
      { actor, entries: entries.length, registryVersion: saved.registry.version });
    return { record, registry: { version: saved.registry.version, members: saved.registry.members.length } };
  }

  async organizationOverview(space = 'default') {
    const safe = async <T,>(name: string, job: () => T | Promise<T>) => {
      try { return { name, ok: true as const, value: await job() }; }
      catch (error) { return { name, ok: false as const, error: String((error as Error).message ?? error) }; }
    };
    const sections = await Promise.all([
      safe('registry', () => this.registryView()),
      safe('transferPolicy', () => this.transferPolicy()),
      safe('policy', () => this.policyView(space, 'workspace-owner')),
      safe('attention', () => this.attentionPolicy(space)),
      safe('watchdog', () => this.watchdogPolicy(space)),
      safe('reviewer', () => this.reviewReadiness(false, true)),
      safe('ontology', () => this.ontologyMeta()),
      safe('extraction', () => this.l2Status()),
      safe('feishuOrg', () => this.orgMappingView()),
      safe('signals', () => this.signalsView({})),
      safe('agents', () => this.agentRegistryView()),
    ]);
    return { space, sections, generatedAt: new Date().toISOString() };
  }

  // --- FR-22/23/24 runtime guard -----------------------------------------
  async attentionPolicy(space: string): Promise<{ policy: AttentionPolicy; revision: string | null }> {
    const stored = await this.store.readConfig<AttentionPolicy>(`attention-policy:${space}`);
    return { policy: stored?.value ?? defaultAttentionPolicy(), revision: stored?.revision ?? null };
  }
  async attentionPolicySave(space: string, input: unknown, expectedRevision: string | null, actor: string) {
    const current = await this.attentionPolicy(space);
    if (current.revision !== expectedRevision) throw new Error('注意力策略已变化，请刷新后再保存');
    const policy = (await import('./runtime-guard.ts')).attentionPolicySchema.parse(input);
    const revision = await this.store.writeConfig(`attention-policy:${space}`, policy, expectedRevision);
    this.localStore.audit('v06.attention-policy-saved', space, { actor, sensitivity: policy.sensitivity });
    return { policy, revision };
  }
  async attentionFilter(space: string, event: Parameters<typeof filterEvent>[0], state: Parameters<typeof filterEvent>[2]) {
    const { policy } = await this.attentionPolicy(space);
    return filterEvent(event, policy, state);
  }
  async watchdogPolicy(space: string): Promise<{ policy: WatchdogPolicy; revision: string | null }> {
    const stored = await this.store.readConfig<WatchdogPolicy>(`watchdog-policy:${space}`);
    return { policy: stored?.value ?? defaultWatchdogPolicy(), revision: stored?.revision ?? null };
  }
  async watchdogInspect(space: string, run: Parameters<typeof inspectRun>[0], now?: string) {
    const { policy } = await this.watchdogPolicy(space);
    const verdict = inspectRun(run, policy, now);
    const recovery = recoveryFrom(verdict);
    this.localStore.audit('v06.watchdog-inspected', run.taskId, { runId: run.runId, state: verdict.state, recovery: recovery.allowed });
    return { verdict, recovery };
  }
  async intervention(input: Parameters<typeof assertIntervention>[0], current: { phase: string; lease?: string }) {
    const result = assertIntervention(input, current);
    this.localStore.audit('v06.intervention', result.taskId, { action: result.action, actor: result.actorUserId, checkpoint: result.checkpoint });
    return result;
  }

  // --- Unified dispatch ---------------------------------------------------
  /** All /workspace/v06-* actions land here. Config writes require the org-level owner. */
  async dispatch(action: string, p: any, actor: { admin: boolean; userId?: string }, opts: V06Options): Promise<unknown> {
    const orgOnly = ['roles-save', 'roles-derive', 'transfer-policy-save', 'grant-tighten', 'policy-save', 'edges-save',
      'attention-policy-save', 'ontology-save', 'l2-extract', 'org-mapping-apply', 'org-mapping-preview'];
    if (orgOnly.includes(action) && !actor.admin) throw new Error('Unauthorized: 该配置只能由组织级 owner 修改');
    // The authenticated identity wins. opts.actorUserId is only a display hint
    // for channel rendering and must never be usable to impersonate an owner.
    const who = actor.userId || opts.actorUserId || 'local-operator';
    // C-6 的七个动作统一走治理服务：只读 view 之外都要真人 / 组织级身份。
    if (isEvolutionAction(action)) return this.evolution().handle(action, p,
      { admin: actor.admin, userId: actor.userId, agent: (actor as { agent?: string }).agent });
    switch (action) {
      // A. roles
      case 'roles-view': return this.registryView();
      case 'roles-save': return this.registrySave(p.registry, p.revision ?? null, who);
      case 'roles-derive': return this.registryDerive(p.evidence ?? [], who);
      case 'role-route': return this.roleRoute(p);
      case 'role-hints': return this.roleHints(p.metrics ?? {});
      case 'role-snapshot': return this.roleSnapshot(p.userId);
      // D. transfers
      case 'transfer-create': return this.transferCreate(p, opts);
      case 'transfer-view': return this.transferView(p.taskId);
      case 'transfer-revoke': return this.transferRevoke(p.taskId, p.reason ?? '授权人撤销');
      case 'transfer-policy': return this.transferPolicy();
      case 'transfer-policy-save': return this.transferPolicySave(p.policy, p.revision ?? null, who);
      case 'dispatch-guard': return this.guardDispatch(p);
      case 'grant-widen': return this.widenPolicy(p.metrics);
      case 'grant-tighten': return this.tightenOnIncident(p.metrics, who);
      case 'dispatch-receipt': return this.dispatchReceipt(p.taskId);
      case 'standard-lock': return this.lockStandardForTransfer(p.taskId, p.plan);
      case 'counter-sign': return this.assertCounterSign(p.taskId, p.riskAction, p.signers ?? []);
      // C/K. grants and edges
      case 'grant-request': return this.grantRequest(p, opts);
      case 'grant-decide': return this.grantDecide(p.taskId, p.decision, who, p.reason);
      case 'grant-revoke': return this.grantRevoke(p.taskId, p.reason ?? '目标空间 owner 撤销');
      case 'grant-separate': return this.grantSeparateApproval(p.taskId, p.kind, who);
      case 'grant-check': return this.grantCheck(p.taskId);
      case 'edges-view': return this.edgesView(p.taskId);
      case 'edges-save': return this.edgesSave(p.taskId, p.edges, who);
      case 'edge-accept': return this.edgeAccept(p.taskId, p.edgeId, who);
      case 'edge-reusable': return this.edgeReusable(p.taskId, p.edgeId, who);
      case 'edge-invalidate': return this.edgeInvalidate(p.taskId, p.reason ?? '来源变版 / 撤权 / 验收打回',
        (e: KnowledgeEdge) => p.edgeIds ? p.edgeIds.includes(e.id) : e.evidenceRefs.some(r => p.sourceId === r.sourceId), who);
      case 'edge-impact': return this.edgeImpact(p.taskId, p.edgeId);
      case 'context-pack': return this.contextPack({ taskId: p.taskId, registryVersion: p.registryVersion ?? 0,
        visibilityFilter: () => true, ttlHours: p.ttlHours, at: p.at });
      case 'label-check': return this.labelCheck(p);
      // Workspace policy
      case 'policy-view': return this.policyView(p.space, p.ownerUserId ?? who);
      case 'policy-save': return this.policySave(p.space, p.policy, p.revision ?? null, who);
      case 'verification-level': return this.verificationLevel(p.space, p.ownerUserId ?? who, p);
      case 'topology-advice': return this.topologyAdvice(p.metrics);
      case 'inflight-policy': return this.inFlightPolicy(p.space, p.ownerUserId ?? who, p.startedVersion);
      // G. signals
      case 'signals': return this.signalsView(p.readings ?? {}, p.at);
      case 'signal-fix': return this.signalFixLoop(p.signal, p.taskId, p.fix);
      case 'signal-retest': return this.signalRetest(p.loop, p.value, p.threshold);
      // F. review readiness + read-only workbench projections
      case 'plan-view': return this.acceptancePlanView(p.taskId);
      case 'round-view': return this.acceptanceRoundView(p.taskId);
      case 'acceptance-workbench': return this.acceptanceWorkbenchView(p.taskId);
      case 'acceptance-export': return this.acceptanceExport(p.taskId);
      case 'org-overview': return this.organizationOverview(p.space ?? 'default');
      case 'acceptance-report-view': return this.acceptanceReportView(p.taskId ?? '');
      case 'org-mapping-preview': return this.orgMappingPreview(p.includeChatted !== false);
      case 'org-mapping-view': return this.orgMappingView();
      case 'org-mapping-apply': return this.orgMappingApply(p.entries ?? p, p.registryRevision ?? null, who);
      case 'review-readiness': return this.reviewReadiness(p.traceReady === true, p.visualEvidenceRequired !== false, p);
      case 'review-evidence': return this.reviewEvidence(p);
      case 'agent-registry-view': return this.agentRegistryView();
      case 'acceptance-crew': return this.acceptanceCrew(p);
      // FR-08 ontology
      case 'ontology-meta': return this.ontologyMeta();
      case 'ontology-view': return this.ontologyView(p.taskId);
      case 'ontology-save': return this.ontologySave(p.taskId, p.graph, who);
      case 'ontology-query': return this.ontologyQuery(p.taskId, p.query, p.params);
      // L2 auto-extraction from the pinned Cognee L1 projection
      case 'l2-status': return this.l2Status();
      case 'l2-edges-view': return this.l2EdgesGlobal();
      case 'l2-graph-view': return this.l2GraphGlobal();
      case 'l2-extract': return this.l2Extract({ sourceId: p.sourceId, revision: p.revision, taskId: p.taskId,
        space: p.space, classification: p.classification, actor: who, at: p.at });
      // FR-22/23/24 runtime guard
      case 'attention-policy': return this.attentionPolicy(p.space);
      case 'attention-policy-save': return this.attentionPolicySave(p.space, p.policy, p.revision ?? null, who);
      case 'attention-filter': return this.attentionFilter(p.space, p.event, p.state);
      case 'watchdog-policy': return this.watchdogPolicy(p.space);
      case 'watchdog-inspect': return this.watchdogInspect(p.space, p.run, p.now);
      case 'intervention': return this.intervention(p.intervention, p.current);
      // P-1：只读。当前执行形态、队列是否真接上、仍缺什么，如实返回。
      case 'execution-view': return executionView(loadConfig());
      default: throw new Error(`Unknown v06 action: ${action}`);
    }
  }
}
