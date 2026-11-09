/**
 * 决策点（DecisionPoint）：把「谁在什么时候、凭什么、拍了什么板」做成一等公民。
 *
 * 这是差距分析 G1 的落点。此前「决策」散在六个模块里，各自写死「谁有资格判」，
 * 所以回答不了「系统今天替谁做了哪些判断、还有哪些判断悬着没人拍」。
 * 这里把六类决策统一登记，统一「谁有资格判」，统一审计，并支撑 G3 的跨域委派。
 *
 * 边界：
 * - 决策点只登记事实与资格，不替人做判断——判不判、怎么判仍由调用方执行。
 * - 审计是追加式：一个决策点可以有 pending → decided / delegated / rejected 的流转，
 *   但每次流转都落一条记录，不覆盖。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DECISION_KINDS = [
  'admission', 'authorization', 'acceptance', 'countersign', 'transfer', 'cross-domain', 'out-of-scope',
] as const;
export type DecisionKind = typeof DECISION_KINDS[number];

/** 谁有资格拍这个板。 */
export const DECISION_CAPABILITIES = [
  'system', 'human', 'domain-owner', 'domain-expert', 'independent-reviewer',
] as const;
export type DecisionCapability = typeof DECISION_CAPABILITIES[number];

export const DECISION_STATUSES = ['pending', 'decided', 'delegated', 'rejected'] as const;
export type DecisionStatus = typeof DECISION_STATUSES[number];

export interface DecisionPoint {
  schemaVersion: 1;
  id: string;
  /** 关联到任务 / 主题 / 产物 / 事件。 */
  subject: string;
  kind: DecisionKind;
  /** 属于哪个业务域。跨域判断的依据。 */
  domain: string;
  requiredCapability: DecisionCapability;
  /** 判之前必须看到的引用：清单、证据、历史决策。 */
  contextRefs: string[];
  status: DecisionStatus;
  decidedBy?: string;
  decidedAt?: string;
  outcome?: string;
  reason?: string;
  createdAt: string;
}

export interface DecisionEvent {
  at: string;
  from: DecisionStatus;
  to: DecisionStatus;
  by?: string;
  outcome?: string;
  reason?: string;
}

export const decisionDir = (base: string) => path.join(base, 'decisions');
const fileOf = (base: string, id: string) => path.join(decisionDir(base), `${id}.json`);

/** 六类决策 → 各自要求谁有资格判。这是「统一资格」的唯一出处。 */
export const REQUIRED_CAPABILITY: Record<DecisionKind, DecisionCapability> = {
  admission: 'human',               // 谁进门，必须人确认（inferred 档只给指引）
  authorization: 'domain-owner',    // 扩授权面，只有域 owner 能拍
  acceptance: 'independent-reviewer', // 验收必须独立于产出方
  countersign: 'independent-reviewer',
  transfer: 'domain-owner',
  'cross-domain': 'domain-expert',  // 跨域判断，落到对方域的专业人/Agent
  'out-of-scope': 'human',
};

const shortId = (seed: string) => createHash('sha256').update(seed).digest('hex').slice(0, 12);

export function openDecision(input: {
  subject: string; kind: DecisionKind; domain: string;
  contextRefs?: string[]; at?: string;
}): DecisionPoint {
  const at = input.at ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `d-${shortId(`${input.kind}|${input.subject}|${at}`)}`,
    subject: String(input.subject ?? '').trim(),
    kind: input.kind,
    domain: String(input.domain ?? '').trim() || 'default',
    requiredCapability: REQUIRED_CAPABILITY[input.kind],
    contextRefs: [...(input.contextRefs ?? [])],
    status: 'pending',
    createdAt: at,
  };
}

export interface DecisionActor {
  userId: string;
  /** 可选的域标识；跨域判定用。 */
  domain?: string;
  /** 该 actor 具备的资格。默认只具备 system（没有特权）。 */
  capabilities?: readonly DecisionCapability[];
  /** 是否系统/管理员直通（local-board / adminToken）。 */
  admin?: boolean;
}

/**
 * 统一「谁有资格判」。
 * 规则：admin 只有在「域匹配」或「本域决策」时才有资格；
 * 跨域决策（domain 与 actor.domain 不一致且要求 domain-expert/owner）对 admin 也不放行，
 * 必须委派——这直接落实差距分析 G3 / 漏洞 V3。
 */
export function canDecide(actor: DecisionActor, dp: DecisionPoint): { ok: boolean; reason: string } {
  const capabilities = new Set(actor.capabilities ?? []);
  if (actor.admin) capabilities.add('system');
  const needsCrossDomain = dp.requiredCapability === 'domain-expert' || dp.requiredCapability === 'domain-owner';
  if (needsCrossDomain && actor.domain && dp.domain !== actor.domain) {
    return { ok: false, reason: `跨域决策：${dp.domain} 域的判断应由该域的专业人/Agent 来拍，不落给 ${actor.domain} 域` };
  }
  if (capabilities.has(dp.requiredCapability)) return { ok: true, reason: '' };
  if (actor.admin && dp.requiredCapability === 'human') return { ok: true, reason: '' };
  return { ok: false, reason: `缺少资格 ${dp.requiredCapability}` };
}

export function decide(dp: DecisionPoint, input: {
  actor: DecisionActor; outcome: string; reason?: string; at?: string;
}): { point: DecisionPoint; ok: boolean; error?: string } {
  const gate = canDecide(input.actor, dp);
  if (!gate.ok) return { point: dp, ok: false, error: gate.reason };
  const at = input.at ?? new Date().toISOString();
  return {
    point: { ...dp, status: 'decided', decidedBy: input.actor.userId, decidedAt: at,
      outcome: input.outcome, reason: input.reason?.trim() || '' },
    ok: true,
  };
}

/** 委派到目标域：状态变 delegated，记下「转给谁、为什么」。 */
export function delegateDecision(dp: DecisionPoint, input: {
  targetDomain: string; targetOwner: string; reason?: string; by?: string; at?: string;
}): DecisionPoint {
  const at = input.at ?? new Date().toISOString();
  return { ...dp, status: 'delegated', decidedBy: input.by,
    decidedAt: at, reason: `${input.reason ?? '跨域委派'} → 转给 ${input.targetDomain} 域 ${input.targetOwner}` };
}

/** 追加式落盘：一个决策点一条 JSON，0600。 */
export function persistDecision(base: string, dp: DecisionPoint): DecisionPoint {
  mkdirSync(decisionDir(base), { recursive: true, mode: 0o700 });
  writeFileSync(fileOf(base, dp.id), JSON.stringify(dp, null, 2), { mode: 0o600 });
  return dp;
}

export function listDecisions(base: string, filter?: { status?: DecisionStatus; domain?: string }): DecisionPoint[] {
  const dir = decisionDir(base);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      try { return JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as DecisionPoint; } catch { return null; }
    })
    .filter((dp): dp is DecisionPoint => Boolean(dp?.id))
    .filter(dp => (!filter?.status || dp.status === filter.status)
      && (!filter?.domain || dp.domain === filter.domain))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 悬而未决的决策点：系统「正在等谁拍板」的实时清单。 */
export function pendingDecisions(base: string): DecisionPoint[] {
  return listDecisions(base, { status: 'pending' });
}
