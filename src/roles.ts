// v0.6 FR-01 / FR-02 / FR-03 / FR-28 — Role Registry (M12).
//
// 「划分是配置，责任是事实」(P6): the product defines HOW roles are divided,
// the organization decides HOW MANY and WHAT they are called. There is no
// built-in department list; the examples in PRD are deletable sample data.
//
// Three-layer capability model (v0.3/v0.4):
//   primary role   — stable, declared, exactly one per member  → responsibility anchor
//   domain context — derived from tasks/artifacts/graph edges   → find the right person
//   adjacency      — derived + self-declared, low weight        → cross-function backup
//
// Historical records keep a ROLE SNAPSHOT. Registry changes never rewrite the
// past; in-flight tasks keep the role assignment they started with.
import { z } from 'zod';

export const roleIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,39}$/, '职能 ID 需为 3-40 位小写字母/数字/连字符');
export type RoleId = z.infer<typeof roleIdSchema>;

export const roleSchema = z.object({
  id: roleIdSchema,
  name: z.string().trim().min(1).max(80),
  ownerUserId: z.string().trim().min(1),          // 联签、兜底、起草标准的落点
  active: z.boolean().default(true),
  replacedBy: z.string().optional(),             // split/merge keeps history resolvable
}).strict();
export type Role = z.infer<typeof roleSchema>;

export const roleSnapshotSchema = z.object({
  roleId: roleIdSchema, name: z.string(), ownerUserId: z.string(), registryVersion: z.number().int().min(0),
}).strict();
export type RoleSnapshot = z.infer<typeof roleSnapshotSchema>;

export const memberRoleSchema = z.object({
  userId: z.string().trim().min(1),
  roleId: roleIdSchema,
  /** Derived only. Never hand-maintained (FR-02). */
  domains: z.array(z.object({ tag: z.string().min(1), weight: z.number().min(0).max(1), evidence: z.array(z.string()) })).default([]),
  /** Derived + self-declared, low weight; must never become the primary anchor. */
  adjacency: z.array(z.object({ roleId: roleIdSchema, weight: z.number().min(0).max(1), evidence: z.array(z.string()) })).default([]),
  roleSnapshot: roleSnapshotSchema.optional(),
}).strict();
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const registrySchema = z.object({
  schemaVersion: z.literal(1),
  version: z.number().int().min(0),
  updatedAt: z.string(),
  roles: z.array(roleSchema),
  members: z.array(memberRoleSchema),
  /** Granularity thresholds are configurable too; no preset organization shape. */
  thresholds: z.object({
    minMembersPerRole: z.number().int().min(1).default(2),
    crossRoleRatioWarn: z.number().min(0).max(1).default(0.3),
    overlapWarn: z.number().min(0).max(1).default(0.5),
  }).default({ minMembersPerRole: 2, crossRoleRatioWarn: 0.3, overlapWarn: 0.5 }),
}).strict();
export type RoleRegistry = z.infer<typeof registrySchema>;

export function emptyRegistry(at = new Date().toISOString()): RoleRegistry {
  return { schemaVersion: 1, version: 0, updatedAt: at, roles: [], members: [],
    thresholds: { minMembersPerRole: 2, crossRoleRatioWarn: 0.3, overlapWarn: 0.5 } };
}

/** Four structural invariants are enforced by the product; everything else is config. */
export function assertRegistry(reg: RoleRegistry): void {
  // Business error first: a missing owner should read as an organisation rule,
  // not as a raw schema violation.
  for (const role of reg.roles ?? []) if (!role.ownerUserId?.trim?.()) throw new Error(`职能 ${role.id} 必须有 owner`);
  registrySchema.parse(reg);
  const ids = reg.roles.map(r => r.id);
  if (new Set(ids).size !== ids.length) throw new Error('职能 ID 重复');
  if (new Set(reg.members.map(m => m.userId)).size !== reg.members.length) throw new Error('成员主职能必须唯一，不能多挂');
  const activeIds = new Set(reg.roles.filter(r => r.active).map(r => r.id));
  for (const role of reg.roles) {
    if (!role.ownerUserId.trim()) throw new Error(`职能 ${role.id} 必须有 owner`);
    if (role.replacedBy && !reg.roles.some(r => r.id === role.replacedBy)) throw new Error('职能合并目标不存在');
  }
  for (const member of reg.members) {
    if (!member.roleId) throw new Error('成员主职能不能留空');
    if (!activeIds.has(member.roleId)) throw new Error(`成员 ${member.userId} 引用了不存在或已停用的职能 ${member.roleId}`);
    for (const a of member.adjacency) {
      if (a.roleId === member.roleId) throw new Error('邻接能力不能指向自己的主职能');
      if (a.weight > 0.5) throw new Error('邻接能力权重须低于主职能，不能反客为主');
    }
  }
}

export function snapshotFor(reg: RoleRegistry, userId: string): RoleSnapshot {
  const member = reg.members.find(m => m.userId === userId);
  if (!member) throw new Error(`成员 ${userId} 未登记主职能`);
  const role = reg.roles.find(r => r.id === member.roleId && r.active);
  if (!role) throw new Error('主职能已停用');
  return { roleId: role.id, name: role.name, ownerUserId: role.ownerUserId, registryVersion: reg.version };
}

/** FR-02: three-stage routing. Returns the basis so dispatch logs can replay it. */
export function routeFor(reg: RoleRegistry, input: { roleId: string; domain?: string; prefer?: 'primary' | 'adjacency' }) {
  assertRegistry(reg);
  const role = reg.roles.find(r => r.id === input.roleId && r.active);
  if (!role) throw new Error(`目标职能 ${input.roleId} 不存在或已停用`);
  const inRole = reg.members.filter(m => m.roleId === role.id);
  const byDomain = input.domain
    ? inRole.map(m => ({ member: m, weight: m.domains.find(d => d.tag === input.domain)?.weight ?? 0 }))
        .filter(x => x.weight > 0).sort((a, b) => b.weight - a.weight)
    : [];
  const primary = byDomain[0]?.member.userId ?? inRole[0]?.userId;
  const adjacency = input.prefer === 'adjacency'
    ? reg.members.filter(m => m.roleId !== role.id && m.adjacency.some(a => a.roleId === role.id))
        .sort((a, b) => (b.adjacency.find(x => x.roleId === role.id)?.weight ?? 0) - (a.adjacency.find(x => x.roleId === role.id)?.weight ?? 0))
        .map(m => m.userId)
    : [];
  return { roleId: role.id, roleOwnerUserId: role.ownerUserId, primary, domainRank: byDomain.map(x => ({ userId: x.member.userId, weight: x.weight })),
    adjacency, basis: `主职能定组=${role.id} → 领域定人=${input.domain ?? '未指定'}${byDomain.length ? '(命中)' : '(未命中)'} → 邻接补位=${adjacency.length}` };
}

/** FR-02: derive domain/adjacency tags from real participation. Pure, additive. */
export function deriveCapabilities(reg: RoleRegistry, evidence: {
  userId: string; taskId: string; roleId: string;
  domainTags?: string[]; sourceRefs?: string[]; accepted?: boolean;
}[]): RoleRegistry {
  const next: RoleRegistry = JSON.parse(JSON.stringify(reg));
  for (const item of evidence) {
    const member = next.members.find(m => m.userId === item.userId);
    if (!member) continue;                       // unknown participants are ignored, never invented
    for (const tag of item.domainTags ?? []) {
      const existing = member.domains.find(d => d.tag === tag);
      if (existing) { existing.weight = Math.min(1, existing.weight + 0.1); if (!existing.evidence.includes(item.taskId)) existing.evidence.push(item.taskId); }
      else member.domains.push({ tag, weight: 0.2, evidence: [item.taskId] });
    }
    if (item.roleId !== member.roleId && item.accepted === true) {
      const existing = member.adjacency.find(a => a.roleId === item.roleId);
      if (existing) { existing.weight = Math.min(0.5, existing.weight + 0.05); if (!existing.evidence.includes(item.taskId)) existing.evidence.push(item.taskId); }
      else member.adjacency.push({ roleId: item.roleId, weight: 0.1, evidence: [item.taskId] });
    }
  }
  assertRegistry(next);
  return next;
}

/** FR-03 / FR-28: read-only hints, never blocking. */
export function granularityHints(reg: RoleRegistry, metrics: { crossRoleRatio?: number; transfers?: Record<string, number> } = {}): string[] {
  const hints: string[] = [];
  for (const role of reg.roles.filter(r => r.active)) {
    const size = reg.members.filter(m => m.roleId === role.id).length;
    if (size < reg.thresholds.minMembersPerRole) hints.push(`职能「${role.name}」仅 ${size} 人，低于阈值 ${reg.thresholds.minMembersPerRole}，可考虑合并`);
  }
  if ((metrics.crossRoleRatio ?? 0) > reg.thresholds.crossRoleRatioWarn)
    hints.push(`跨职能派单占比 ${(metrics.crossRoleRatio! * 100).toFixed(0)}% 偏高，提示主职能划分可能需要细分或补人`);
  const total = Object.values(metrics.transfers ?? {}).reduce((a, b) => a + b, 0);
  for (const [roleId, count] of Object.entries(metrics.transfers ?? {})) {
    if (total > 0 && count / total > reg.thresholds.overlapWarn) hints.push(`职能 ${roleId} 承接了 ${(count / total * 100).toFixed(0)}% 的跨职能派单，可能长期缺人`);
  }
  return hints;
}

export type RegistryChange = { action: string; at: string; actor: string; detail: unknown; version: number };

/** Every registry write is an audited, versioned event; in-flight tasks keep their snapshot. */
export class RoleRegistryService {
  constructor(private readonly store: import('./v06-store.ts').V06Store,
    private readonly audit: (action: string, detail: unknown) => void = () => {}) {}
  async read(): Promise<{ registry: RoleRegistry; revision: string | null }> {
    const stored = await this.store.readConfig<RoleRegistry>('role-registry');
    if (!stored) return { registry: emptyRegistry(), revision: null };
    assertRegistry(stored.value);
    return { registry: stored.value, revision: stored.revision };
  }
  async save(input: unknown, expectedRevision: string | null, actor: string, at = new Date().toISOString()) {
    const current = await this.read();
    if (current.revision !== expectedRevision) throw new Error('职能注册表已变化，请刷新后再保存');
    const parsed = registrySchema.parse(input) as RoleRegistry;
    const next: RoleRegistry = { ...parsed, schemaVersion: 1, version: current.registry.version + 1, updatedAt: at,
      members: parsed.members.map(m => ({ ...m, roleSnapshot: m.roleSnapshot ?? snapshotFor(parsed, m.userId) })) };
    assertRegistry(next);
    const revision = await this.store.writeConfig('role-registry', next, expectedRevision);
    // V1 配置篡改留痕：变更前后各算内容哈希，审计里能查到「内容从哪个 hash 变成哪个 hash」。
    const { sealDiff } = await import('./content-seal.ts');
    const seal = sealDiff(current.registry, next, ['version', 'updatedAt']);
    const change: RegistryChange = { action: 'role-registry.changed', at, actor,
      detail: { version: next.version, roles: next.roles.length, members: next.members.length,
        beforeHash: seal.beforeHash, afterHash: seal.afterHash, changedKeys: seal.changedKeys },
      version: next.version };
    this.audit(change.action, change);
    return { registry: next, revision, change };
  }
  async derive(evidence: Parameters<typeof deriveCapabilities>[1], actor: string) {
    const current = await this.read();
    const next = deriveCapabilities(current.registry, evidence);
    const revision = await this.store.writeConfig('role-registry', next, current.revision);
    this.audit('role-registry.derived', { actor, derivedFrom: evidence.length, version: next.version });
    return { registry: next, revision };
  }
}
