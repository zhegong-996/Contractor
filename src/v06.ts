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
import { validateOrgGraph, responsibilityOf, evidenceOf, influencedBy, reachableFrom, NODE_KINDS, EDGE_RULES, EDGE_FAMILIES, type OrgGraph } from './org-ontology.ts';
import { defaultAttentionPolicy, defaultWatchdogPolicy, filterEvent, assertIntervention, inspectRun, recoveryFrom,
  type AttentionPolicy, type WatchdogPolicy } from './runtime-guard.ts';
import { assertStandardExternalised, readPlan } from './acceptance-plan.ts';
import { renderForChannel, endpointCapabilities, PLAIN_TEXT, type ChannelId, type SemanticObject, type RenderedMessage } from './channels.ts';

export interface V06Options {
  workbenchUrl: string;
  channel: ChannelId;
  actorUserId: string;
}

export class V06Services {
  readonly store: V06Store;
  readonly roles: RoleRegistryService;
  readonly transfers: TransferService;
  readonly reviewer: IndependentReviewer;
  constructor(readonly localStore: Store,
    readonly pc?: { get: (route: string) => Promise<any>; document: (a: string, b: string, c: string, d: string) => Promise<any> },
    injected?: V06Store, reviewer?: IndependentReviewer) {
    this.store = injected ?? (pc ? new RuntimeV06Store(pc) : new MemoryV06Store());
    const audit = (action: string, detail: unknown) => this.localStore.audit(action, this.scopeOf(detail), detail);
    this.roles = new RoleRegistryService(this.store, audit);
    this.transfers = new TransferService(this.store, (action, taskId, detail) => this.localStore.audit(action, taskId, detail));
    this.reviewer = reviewer ?? new TraceEvidenceReviewer();
  }
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
    if (!registry.roles.length) return { ...assertDispatchAllowed({ ...input, transfer: null, consultationOnly: true }),
      skipped: true, reason: '尚未配置职能注册表，沿用原有扁平派单' };
    const transfer = await this.transfers.read(input.taskId);
    return assertDispatchAllowed({ ...input, transfer });
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
    const grant = await this.readGrant(taskId);
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
    return next;
  }
  async edgeImpact(taskId: string, edgeId: string) { return impactOf(await this.edgesView(taskId), edgeId); }
  async contextPack(input: { taskId: string; registryVersion: number; visibilityFilter: (v: KnowledgeEdge['visibility']) => boolean; ttlHours?: number; at?: string }) {
    const edges = await this.edgesView(input.taskId);
    const pack = buildContextPack({ ...input, edges });
    this.localStore.audit('v06.context-pack-built', input.taskId, { refs: pack.refs.length, usable: eligibleForContextPack(edges).length, expiresAt: pack.expiresAt });
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

  // --- F. Independent review readiness (FR-18/25) ------------------------
  async reviewReadiness(traceReady: boolean, visualEvidenceRequired = true) {
    assertReviewerCapable(this.reviewer, { producerModel: '', visualEvidenceRequired: false });
    return acceptanceChainReady({ traceReady, reviewer: this.reviewer, visualEvidenceRequired });
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
      'attention-policy-save', 'ontology-save'];
    if (orgOnly.includes(action) && !actor.admin) throw new Error('Unauthorized: 该配置只能由组织级 owner 修改');
    // The authenticated identity wins. opts.actorUserId is only a display hint
    // for channel rendering and must never be usable to impersonate an owner.
    const who = actor.userId || opts.actorUserId || 'local-operator';
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
      // F. review readiness
      case 'review-readiness': return this.reviewReadiness(p.traceReady === true, p.visualEvidenceRequired !== false);
      case 'review-evidence': return this.reviewEvidence(p);
      // FR-08 ontology
      case 'ontology-meta': return this.ontologyMeta();
      case 'ontology-view': return this.ontologyView(p.taskId);
      case 'ontology-save': return this.ontologySave(p.taskId, p.graph, who);
      case 'ontology-query': return this.ontologyQuery(p.taskId, p.query, p.params);
      // FR-22/23/24 runtime guard
      case 'attention-policy': return this.attentionPolicy(p.space);
      case 'attention-policy-save': return this.attentionPolicySave(p.space, p.policy, p.revision ?? null, who);
      case 'attention-filter': return this.attentionFilter(p.space, p.event, p.state);
      case 'watchdog-policy': return this.watchdogPolicy(p.space);
      case 'watchdog-inspect': return this.watchdogInspect(p.space, p.run, p.now);
      case 'intervention': return this.intervention(p.intervention, p.current);
      default: throw new Error(`Unknown v06 action: ${action}`);
    }
  }
}
