// v0.6 FR-05 / FR-20 / FR-28 — Workspace owner configuration (D9/D10).
//
// The owner may TIGHTEN but never lower the system floor. Verification level
// (trust strength) and artifact state (reuse) stay two independent axes.
import { z } from 'zod';

export const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const;
export type Level = typeof LEVELS[number];
export const levelRank = (l: Level) => LEVELS.indexOf(l) + 1;

/** Actions that can never be downgraded by any owner (PRD 3.1 / R4 / R5). */
export const FORCED_L4 = ['external_publish', 'funds', 'customer_visible'] as const;
export const FORCED_HUMAN_SIGN = ['database_change', 'permission_change', 'merge', 'publish', ...FORCED_L4] as const;

export const workspacePolicySchema = z.object({
  schemaVersion: z.literal(1),
  space: z.string().min(1),
  ownerUserId: z.string().min(1),
  /** FR-05: the owner chooses the reporting topology; product does not hard-code it. */
  topology: z.enum(['flat', 'hierarchical']).default('flat'),
  /** FR-20: default level plus per-type / per-risk overrides. */
  verification: z.object({
    defaultLevel: z.enum(LEVELS).default('L2'),
    byTaskType: z.record(z.string(), z.enum(LEVELS)).default({}),
    byRiskAction: z.record(z.string(), z.enum(LEVELS)).default({}),
  }).default({ defaultLevel: 'L2', byTaskType: {}, byRiskAction: {} }),
  /** FR-05: switching to hierarchical routes mid-flight interventions through a Task card. */
  interventionViaTaskCard: z.boolean().default(true),
  /** Direct event subscription inside one Thread is engineering routing, not escalation.
   *  Enforced as a business rule (with a readable error) rather than a schema literal. */
  subscriptionDirectRouting: z.boolean().default(true),
  version: z.number().int().min(0).default(0),
  updatedAt: z.string(),
}).strict();
export type WorkspacePolicy = z.infer<typeof workspacePolicySchema>;

export function defaultPolicy(space: string, ownerUserId: string, at = new Date().toISOString()): WorkspacePolicy {
  return workspacePolicySchema.parse({ schemaVersion: 1, space, ownerUserId, topology: 'flat',
    verification: { defaultLevel: 'L2', byTaskType: {}, byRiskAction: {} },
    interventionViaTaskCard: true, subscriptionDirectRouting: true, version: 0, updatedAt: at });
}

/** Effective level: requested policy, then the non-negotiable floor on top. */
export function effectiveLevel(policy: WorkspacePolicy, input: { taskType?: string; riskAction?: string; external?: boolean }): Level {
  let level: Level = (input.taskType ? policy.verification.byTaskType[input.taskType] : undefined) ?? policy.verification.defaultLevel;
  if (input.riskAction && policy.verification.byRiskAction[input.riskAction])
    level = levelRank(policy.verification.byRiskAction[input.riskAction]!) > levelRank(level) ? policy.verification.byRiskAction[input.riskAction]! : level;
  if (input.external || (input.riskAction && (FORCED_L4 as readonly string[]).includes(input.riskAction))) level = 'L4';
  return level;
}

export function requiresHumanSign(action: string): boolean {
  return (FORCED_HUMAN_SIGN as readonly string[]).includes(action);
}

/** FR-20: owner may only tighten. Returns the merged policy, never a lowered floor. */
export function tightenPolicy(current: WorkspacePolicy, input: unknown, at = new Date().toISOString()): WorkspacePolicy {
  const candidate = workspacePolicySchema.parse(input);
  if (candidate.space !== current.space) throw new Error('不能修改其他空间的策略');
  if (candidate.ownerUserId !== current.ownerUserId) throw new Error('空间 owner 变更需组织级审批');
  if (!candidate.subscriptionDirectRouting) throw new Error('事件订阅直通是工程路由，不可关闭');
  const merged: WorkspacePolicy = {
    ...candidate, version: current.version + 1, updatedAt: at,
    topology: candidate.topology,
    verification: {
      defaultLevel: levelRank(candidate.verification.defaultLevel) >= levelRank(current.verification.defaultLevel)
        ? candidate.verification.defaultLevel : current.verification.defaultLevel,
      byTaskType: { ...current.verification.byTaskType },
      byRiskAction: { ...current.verification.byRiskAction },
    },
    interventionViaTaskCard: current.interventionViaTaskCard || candidate.interventionViaTaskCard,
  };
  for (const [k, v] of Object.entries(candidate.verification.byTaskType)) {
    const old = merged.verification.byTaskType[k];
    merged.verification.byTaskType[k] = old && levelRank(old) > levelRank(v) ? old : v;
  }
  for (const [k, v] of Object.entries(candidate.verification.byRiskAction)) {
    const old = merged.verification.byRiskAction[k];
    merged.verification.byRiskAction[k] = old && levelRank(old) > levelRank(v) ? old : v;
  }
  // The floor is applied at read time too, so a stored lower value cannot win.
  for (const action of FORCED_L4) merged.verification.byRiskAction[action] = 'L4';
  return workspacePolicySchema.parse(merged);
}

/** FR-05: read-only advice from observed density; never auto-switches. */
export function topologyAdvice(metrics: { crossGroupCalls: number; interruptionsPerPerson: number; findPersonRetries: number }): { suggest: 'flat' | 'hierarchical'; reasons: string[] } {
  const reasons: string[] = [];
  if (metrics.crossGroupCalls > 30) reasons.push(`跨组调用密度 ${metrics.crossGroupCalls} 偏高`);
  if (metrics.interruptionsPerPerson > 8) reasons.push(`人均被打断 ${metrics.interruptionsPerPerson} 次`);
  if (metrics.findPersonRetries > 5) reasons.push(`「找不到该 @ 谁」重试 ${metrics.findPersonRetries} 次`);
  return { suggest: reasons.length >= 2 ? 'hierarchical' : 'flat', reasons };
}

/** FR-28: in-flight tasks keep the policy version they started with. */
export function policyForTask<T extends { version: number }>(history: T[], startedVersion: number): T {
  const found = history.find(h => h.version === startedVersion);
  if (!found) throw new Error('找不到任务开工时的策略版本，禁止用新配置回溯在途任务');
  return found;
}
