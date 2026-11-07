import {memoryAnnotation} from './memory-contract.ts';
import { getRouter } from './router.ts';
import { getRoutingTrace, type RoutingTrace } from './routing-trace.ts';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { root } from './config.ts';
import type { Task, Store } from './store.ts';
import type { State } from './workspaces.ts';

// These are the original Super-agent policy functions, not a parallel Ticket engine.
const policy = await import(pathToFileURL(path.join(root, 'upstream/superagent/src/policy.ts')).href);
export const preparationRule = { id: 'scoped-preparation', name: '推进当前已委托任务', enabled: true,
  instruction: '在当前任务、用途和已有权限内检索证据、整理草稿、准备访问申请与交接。授权、采用知识、最终验收、改变目标和对外发布由人决定。' };
export const assessmentInput = z.object({ decision: z.enum(['accept', 'ignore', 'unavailable']),
  direction: z.object({ implementation_requested: z.boolean(), target_basis: z.enum(['specified', 'existing-standard', 'undetermined']),
    requires_design_decision: z.boolean(), evidence: z.string().min(1).max(700) }).strict(),
  rule_assessments: z.array(z.object({ rule_id: z.string().max(80), matched: z.boolean(), reason: z.string().min(1).max(500) }).strict()).max(4),
  title: z.string().min(1).max(160), scope: z.string().max(1500), reason: z.string().min(1).max(500), intent_evidence: z.string().min(1).max(700).nullable(),
}).strict();
export function assessPreparation(input: unknown, mode: 'observe' | 'auto' = 'auto') {
  const assessment = assessmentInput.parse(input);
  return policy.assessmentOutcome(assessment, { policy: { rules: [preparationRule] }, eval: { mode } }, 'inferred');
}
export function admitPreparation(taskId: string, enabled: boolean, phase: string,
  trace: RoutingTrace | null = getRoutingTrace()) {
  let result: any;
  if (!enabled || ['accepted', 'running', 'unknown', 'handoff_pending'].includes(phase)) {
    result = { admissible: false, reason: 'task_not_delegated' };
  } else {
    const settings = policy.SettingsSchema.parse({ policy: { rules: [preparationRule], sources: {
      task: { allowed: [], admission: { current: { unlistedUnaddressed: 'inferred' } } } } }, eval: { mode: 'auto' } });
    const gate = policy.settingsPolicy(settings, { scope: () => ({ listened: true, observed: true, row: 'current' }) });
    result = gate.gate({ id: taskId, source: 'task', actor: { source: 'task', id: '' }, human: false, meta: { taskId } }, { subscriptions: [taskId] }, []);
  }
  // 策略路由与其它派活点写同一份 Trace；判断逻辑与返回值一字未改。
  getRouter().route({
    taskId, stage: 'admission',
    caller: { actor: 'scoped-preparation', role: 'supervisor', source: 'superagent-policy' },
    target: { role: 'worker', agentKey: 'workspace-assistant' },
    basis: { kind: 'policy', evidence: [phase, 'enabled:' + String(enabled)],
      policyVersion: 'scoped-preparation-v1', ruleId: preparationRule.id },
    scope: { visibility: 'private' },
    outcome: result?.admissible === true ? 'committed' : 'rejected',
    causedBy: taskId + ':' + phase,
    idempotencyKey: 'admission:' + taskId + ':' + phase + ':' + String(enabled),
  }, trace ?? undefined);
  return result;
}
export type CoordinationEvent = { id: string; kind: string; at: string; subject: string };
const relevant = /^(workspace\.(task-created|im-resumed|assistant-delegated|service-response|service-state-changed|service-route-configured|service-answer|recheck-due|context-(note|linked|included|excluded|expanded|discovered)|access-(approved|denied|revoked|expired)|handoff)|knowledge\.(content-updated|reviewed)|delivery\.changed|task\.(handoff|accepted))$/;
export function subscribedEvents(store: Store, task: Task, state: State, since = 0): CoordinationEvent[] {
  const scope = new Set([task.id, ...state.sources, ...(state.context?.linkedTasks ?? [])]);
  const rows = store.db.prepare('SELECT id,at,action,issue_id FROM audit WHERE id>? ORDER BY id').all(since) as { id: number; at: string; action: string; issue_id: string }[];
  // Never feed machine progress back as a new request. Bodies stay in their governed source.
  return rows.filter(r => scope.has(r.issue_id) && relevant.test(r.action)).slice(-24)
    .map(r => ({ id: String(r.id), kind: r.action, at: r.at, subject: r.issue_id }));
}
export const runtimeToolInput = z.discriminatedUnion('name', [
  z.object({ name: z.literal('read_context') }).strict(),
  z.object({ name: z.literal('read_execution_evidence') }).strict(),
  z.object({ name: z.literal('discover_services') }).strict(),
  z.object({ name:z.literal('delegate_service'),serviceId:z.string() }).strict(),
  z.object({ name:z.literal('read_service_network') }).strict(),
  z.object({name:z.literal('reply_service'),childId:z.string(),sourceId:z.string(),quote:z.string().min(4).max(1800)}).strict(),
  z.object({ name:z.literal('propose_memory'),annotation:memoryAnnotation }).strict(),
  z.object({name:z.literal('read_memory_dictionary'),sourceId:z.string()}).strict(),
  z.object({ name: z.literal('assess_scope'), assessment: assessmentInput }).strict(),
  z.object({ name: z.literal('search_context'), query: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ name: z.literal('discover_context') }).strict(),
  z.object({ name: z.literal('read_record'), recordId: z.string() }).strict(),
  z.object({ name: z.literal('expand_context'), sourceId: z.string() }).strict(),
  z.object({ name: z.literal('request_access'), sourceId: z.string(), purpose: z.string().min(1).max(1000) }).strict(),
  z.object({ name: z.literal('read_graph'), sourceId: z.string(), revision: z.string() }).strict(),
  z.object({ name: z.literal('schedule_recheck'), afterSeconds: z.number().int().min(60).max(86400), kind: z.enum(['context', 'delivery']), reason: z.string().min(1).max(500) }).strict(),
]);
export const maxRuntimeTools = 12;

export function consumeDueRecheck(delegation: { enabled: boolean; nonce?: string; recheck?: { at: string; reason: string; kind: string }; recheckCount?: number }, now = Date.now()) {
  if (!delegation.enabled || !delegation.recheck || Date.parse(delegation.recheck.at) > now || (delegation.recheckCount ?? 0) >= 2) return;
  const due = delegation.recheck; delete delegation.recheck; delegation.recheckCount = (delegation.recheckCount ?? 0) + 1;
  delegation.nonce = 'recheck:' + due.at + ':' + delegation.recheckCount; return due;
}
