/**
 * 第三十轮 P-13 · 知识写入链的分区权限判定（人与 agent 共用 casbin）。
 *
 * 用户 2026-11-08 19:33 指令：「agent 和人都可以增删改查，但是肯定是有对应
 * 权限区域的，像我们 agent 的几层架构一样，你只能改自己范围内的东西。」
 *
 * 分区规则（条目归属域 + 角色档位双维度）：
 *   - personal（个人区）：只有条目 owner 本人（人按 user:<name>，agent 按
 *     agent:<key>）可改可删——谁都不能动别人个人区里的东西；
 *   - team（协作区）：需 casbin 档位 knowledge-write-team（人 operator+，
 *     agent worker/supervisor 档）；
 *   - org（组织区）：更新需 knowledge-write-org、删除需 knowledge-delete-org
 *     （人 admin+；agent 仅 supervisor 档）；
 *   - agent 额外约束（对齐 agent registry 架构）：写 team/org 区时，agent 的
 *     生效范围必须覆盖条目的至少一个业务域（scopeCovers），个人区免此判。
 *
 * 删除是软删（state -> withdrawn），沿用既有语义，不做物理删除。
 */
import { rbacEnforce } from './rbac.ts';
import { scopeCovers, type AgentInstance } from './agent-registry.ts';

export type KnowledgeActor =
  | { kind: 'human'; username: string }
  | { kind: 'agent'; key: string; agent?: AgentInstance };

export type KnowledgeEntryLike = {
  visibility?: 'personal' | 'team' | 'org';
  owner?: string;
  domains?: readonly string[];
};

export type KnowledgeWriteIntent = 'create' | 'update' | 'delete';

export type KnowledgeAuthzResult = { allowed: boolean; reason: string };

/**
 * 判定函数可注入：生产用 casbin（默认），体检 / 单测用角色种子矩阵。
 * 注入点只影响「用什么策略判定」，不影响分区规则本身——规则始终在本文件。
 */
export type Enforce = (sub: string, permission: string) => boolean;

function actorSub(actor: KnowledgeActor): string {
  return actor.kind === 'human' ? 'user:' + actor.username : 'agent:' + actor.key;
}

/** agent 档位：对齐 agent registry 的职责分层（supervisor 主管 / worker 干活 / personal 个人）。 */
export function agentTier(agent?: AgentInstance): 'agent-supervisor' | 'agent-worker' | 'agent-personal' {
  const r = agent?.responsibilities ?? [];
  if (r.includes('supervisor')) return 'agent-supervisor';
  if (r.includes('worker') || r.includes('acceptance') || r.includes('standard-drafting') || r.includes('inspection')) return 'agent-worker';
  return 'agent-personal';
}

function entryVisibility(entry: KnowledgeEntryLike): 'personal' | 'team' | 'org' {
  return entry.visibility ?? 'org'; // 旧记录缺省按组织区（最严管控）
}

function coversEntryDomain(actor: KnowledgeActor, entry: KnowledgeEntryLike): boolean {
  if (actor.kind !== 'agent') return true; // 人不受业务域限制，按角色档位判
  if (!actor.agent) return false; // 无 registry 信息的 agent 一律不覆盖（fail-closed）
  const domains = entry.domains ?? [];
  return domains.some(d => scopeCovers(actor.agent!, d));
}

export function canWriteKnowledge(actor: KnowledgeActor, entry: KnowledgeEntryLike,
  intent: KnowledgeWriteIntent, enforce: Enforce = rbacEnforce): KnowledgeAuthzResult {
  const sub = actorSub(actor);
  const visibility = entryVisibility(entry);
  const owner = entry.owner ?? '';

  // 个人区：owner 本人独占（人与 agent 同规）。
  if (visibility === 'personal') {
    if (owner && owner === sub) return { allowed: true, reason: '个人区条目，归属者本人可改' };
    return { allowed: false, reason: `个人区条目只允许归属者（${owner || '未登记'}）本人修改` };
  }

  // agent 写 team/org 前先过生效范围（agent 架构：只能改自己范围内的东西）。
  if (actor.kind === 'agent' && !coversEntryDomain(actor, entry))
    return { allowed: false, reason: 'agent 的生效范围不覆盖该条目的业务域' };

  if (visibility === 'team') {
    const tier = actor.kind === 'human' ? sub : agentTier(actor.agent);
    const ok = enforce(tier, 'knowledge-write-team');
    return ok ? { allowed: true, reason: '协作区条目，档位允许' }
      : { allowed: false, reason: '协作区条目需要运营（operator）及以上或 worker 档 agent' };
  }

  // org 组织区：update 需 write-org，delete 需 delete-org。
  const tier = actor.kind === 'human' ? sub : agentTier(actor.agent);
  const permission = intent === 'delete' ? 'knowledge-delete-org' : 'knowledge-write-org';
  const ok = enforce(tier, permission);
  return ok ? { allowed: true, reason: '组织区条目，档位允许' }
    : { allowed: false, reason: intent === 'delete'
      ? '删除组织区条目需要管理员（admin）及以上或 supervisor 档 agent' : '修改组织区条目需要管理员（admin）及以上或 supervisor 档 agent' };
}

/**
 * 创建时的判定：visibility 由创建者声明，org/team 走档位，personal 恒可建。
 *
 * 第四十轮修正：新建条目也要按**条目自己的业务域**校验 agent 的生效范围，
 * 而不是一律拿 ['*'] 去比。旧写法等于「只有全域 agent 能建 team/org 条目」，
 * 与「改已有条目时按条目域判定」不一致——域主管改得、却建不得，是自相矛盾的收窄。
 * 不传 domains 时保持旧行为（['*']），避免既有调用方语义漂移。
 */
export type CreateKnowledgeOptions = { domains?: readonly string[]; enforce?: Enforce };
export function canCreateKnowledge(actor: KnowledgeActor, visibility: 'personal' | 'team' | 'org',
  options: CreateKnowledgeOptions = {}): KnowledgeAuthzResult {
  if (visibility === 'personal') return { allowed: true, reason: '个人区知识可自由创建' };
  const { domains = ['*'], enforce = rbacEnforce } = options;
  return canWriteKnowledge(actor, { visibility, owner: actorSub(actor), domains: [...domains] }, 'create', enforce);
}

/**
 * 读分区判定（第三十一轮补 P-13 的读边界，第四十一轮补业务域收窄）：
 *
 *   - personal：仅归属者本人与管理员可见（「管理员可以看到所有的」）；
 *   - org：登录即可读（组织区本来就是全员可见）；
 *   - team：**声明了业务域**的条目按读方业务域收窄——读方域与条目域相交才可读，
 *     管理员档可总览；读方域未知时按协作区档位兜底（operator+ / worker+），
 *     不退回「全域放行」。没有声明业务域的历史条目保持登录可读（数据兼容，
 *     且不臆造它属于哪个域）。
 *
 * console 代理虽是 bridge admin 身份，但 actorUser 由可信端注入后按真实登录
 * 用户判定，冒充他人只会降权不会提权。
 */
export type ReadKnowledgeOptions = {
  /** 读方可读的业务域；不传 = 未知（按档位兜底，不按全域放行）。 */
  readerDomains?: readonly string[];
};

export function canReadKnowledge(actor: KnowledgeActor, entry: KnowledgeEntryLike,
  enforce: Enforce = rbacEnforce, options: ReadKnowledgeOptions = {}): KnowledgeAuthzResult {
  const visibility = entryVisibility(entry);
  if (visibility === 'org') return { allowed: true, reason: '组织区条目登录即可读' };
  if (visibility === 'personal') {
    const sub = actorSub(actor);
    const owner = entry.owner ?? '';
    if (owner && owner === sub) return { allowed: true, reason: '个人区条目，归属者本人可读' };
    // 管理员总览：人 admin 档、agent supervisor 档（与写判定的 org 档位对齐）。
    const tier = actor.kind === 'human' ? sub : agentTier(actor.agent);
    if (enforce(tier, 'knowledge-write-org'))
      return { allowed: true, reason: '管理员总览：个人区条目对 admin 档可见' };
    return { allowed: false, reason: `个人区条目仅归属者（${owner || '未登记'}）本人与管理员可见` };
  }

  // team 协作区：先看条目有没有声明业务域。
  const domains = entry.domains ?? [];
  if (domains.length === 0) return { allowed: true, reason: '协作区条目未声明业务域（历史数据），登录即可读' };
  const tier = actor.kind === 'human' ? actorSub(actor) : agentTier(actor.agent);
  const reader = options.readerDomains;
  if (reader && (reader.includes('*') || domains.some(domain => reader.includes(domain))))
    return { allowed: true, reason: '协作区条目，读方业务域与条目域相交' };
  if (enforce(tier, 'knowledge-write-org'))
    return { allowed: true, reason: '管理员总览：可读全部协作区条目' };
  if (!reader)
    return enforce(tier, 'knowledge-write-team')
      ? { allowed: true, reason: '读方业务域未知，按协作区档位放行（operator+ / worker+）' }
      : { allowed: false, reason: '读方业务域未知且档位不足以读协作区；请由管理员登记你的业务域' };
  return { allowed: false, reason: `协作区条目属于 ${domains.join('/')}，不在你可读的业务域内` };
}
