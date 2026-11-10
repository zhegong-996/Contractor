// 第六十八轮 · 决策账本：对标 DSH SuperAgent 的 Decision 模型。
//
// DSH 的立场很清楚：沉淀的不是「发生了什么」，是「为什么这么判」。
// 它的 Decision 长这样：
//
//   { kind, reason: [{code, values}], strength, mandate,
//     audit: { rule_assessments: [{rule_id, matched, reason}],
//              direction: { implementation_requested, target_basis, evidence } } }
//
// 我们这边的原始事实散在三处：`routing.decision`（559 条，真有 stage/caller/
// basisKind/outcome）、`workspace.access-*`（授权）、`knowledge.*`（知识采用）。
// 它们都是「判定」，但形状不一、也没有统一的可读结论。
//
// 本模块只做一件事：把这些判定归一成 LedgerEntry，让「谁在什么依据下判了什么、
// 要不要人签字」能一条条读出来。**刻意不收工具调用与成员动作**——那是流水，
// 不是判定；混进来就退化成又一个事件流。
//
// 纯函数：不 IO、不读时钟、零模型调用，可独立重放。

/** 判定类别。与 DSH 的 kind 同层，但按我们的领域切。 */
export type LedgerKind =
  | 'route' | 'access' | 'knowledge' | 'delegation' | 'acceptance' | 'escalation' | 'review';

export type LedgerActorKind = 'human' | 'agent' | 'system';

/** 一条判定理由。`code` 是机器可判的枚举，`text` 是给人看的一句话。 */
export type LedgerReason = { code: string; text: string; values?: Record<string, unknown> };

export type LedgerEntry = {
  /** 稳定标识：优先用原始 decisionId / id，没有就按位置生成。 */
  id: string;
  at: string;
  taskId: string | null;
  kind: LedgerKind;
  /** 原始审计动作名，便于回查。 */
  action: string;
  actor: string;
  actorKind: LedgerActorKind;
  /** 一句话结论，人话。 */
  verdict: string;
  /** 为什么这么判。空数组表示这条判定没有留下依据——本身就是个问题。 */
  reasons: LedgerReason[];
  /** 依据类型：policy / human / evidence / default / unknown。 */
  basis: string;
  /** 是否需要人签字；null 表示这条判定不涉及签字。 */
  requiresHuman: boolean | null;
};

export type LedgerSummary = {
  total: number;
  byKind: Record<string, number>;
  /** 没有留下任何依据的条数——沉淀质量的直接指标。 */
  missingBasis: number;
  /** 需要人签字的条数。 */
  humanRequired: number;
  lastAt: string | null;
};

/** 进账本的动作白名单。刻意精简：只有「判定」，没有流水。 */
export const LEDGER_ACTIONS: readonly string[] = [
  'routing.decision',
  'workspace.access-requested', 'workspace.access-approved', 'workspace.access-revoked',
  'knowledge.proposed', 'knowledge.confirmed', 'knowledge.withdrawn',
  'workspace.assistant-delegated',
  'v06.acceptance-confirmed', 'v06.acceptance-rejected',
  'v06.handoff-requested', 'v06.escalated',
] as const;

function parseValue(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
/** 主体名去掉 `user:` / `agent:` 前缀——那是内部命名空间，不是给人看的名字。 */
const cleanActor = (v: string): string => v.replace(/^(user|agent|system):/, '') || 'unknown';

/** 知识状态的中文说法；未知状态不硬翻。 */
const KNOWLEDGE_STATE: Record<string, string> = { proposed: '提出', confirmed: '采用', withdrawn: '撤回' };

/** 未知动作一律不伪造结论：返回 null，账本就不收它。 */
function mapEntry(row: { at: string; action: string; issue_id: string | null; value: unknown }, index: number): LedgerEntry | null {
  const { action } = row;
  if (!LEDGER_ACTIONS.includes(action)) return null;
  const v = parseValue(row.value);
  const base = {
    at: row.at, taskId: row.issue_id ?? null, action,
    id: str(v.decisionId) || str(v.id) || `${action}#${index}`,
  };

  if (action === 'routing.decision') {
    const caller = (v.caller ?? {}) as Record<string, unknown>;
    const target = (v.target ?? {}) as Record<string, unknown>;
    const outcome = str(v.outcome) || 'unknown';
    const basisKind = str(v.basisKind) || 'unknown';
    const stage = str(v.stage) || 'unknown';
    const targetLabel = [str(target.role), str(target.agentKey)].filter(Boolean).join('/');
    const reasons: LedgerReason[] = [
      { code: `stage:${stage}`, text: `判定阶段：${stage}` },
      { code: `basis:${basisKind}`, text: `依据类型：${basisKind}` },
    ];
    if (str(caller.source)) reasons.push({ code: `source:${str(caller.source)}`, text: `规则来源：${str(caller.source)}` });
    if (str(caller.actor)) reasons.push({ code: `actor:${str(caller.actor)}`, text: `判定主体：${str(caller.actor)}` });
    return {
      ...base, kind: 'route',
      actor: cleanActor(str(caller.actor)),
      actorKind: str(caller.source).includes('policy') ? 'system' : 'agent',
      verdict: outcome === 'committed'
        ? (targetLabel ? `确定承接：${targetLabel}` : '确定承接')
        : `未承接：${outcome}`,
      reasons, basis: basisKind,
      requiresHuman: bool(v.requiresHumanSignature),
    };
  }

  if (action.startsWith('workspace.access-')) {
    const sourceId = str(v.sourceId);
    const short = sourceId ? sourceId.slice(0, 8) : '（未记）';
    const state = action.endsWith('requested') ? '申请' : action.endsWith('approved') ? '批准' : '撤销';
    const reasons: LedgerReason[] = [{ code: `access:${state}`, text: `资料 ${short} ${state}` }];
    // 批准人这一栏在历史记录里就没有落——如实标出来，不用 agent 冒充。
    if (action.endsWith('approved')) reasons.push({ code: 'approver:missing', text: '批准人未落库（历史数据缺口）' });
    return {
      ...base, kind: 'access',
      actor: cleanActor(str(v.agent)),
      actorKind: 'agent',
      verdict: `${state}资料访问：${short}`,
      reasons, basis: action.endsWith('approved') ? 'human' : 'policy',
      requiresHuman: action.endsWith('approved') ? true : null,
    };
  }

  if (action.startsWith('knowledge.')) {
    const key = str(v.key) || '（未命名）';
    const state = action.split('.')[1] ?? 'unknown';
    const stateText = KNOWLEDGE_STATE[state] ?? state;
    const injected = v.injected === true;
    const reasons: LedgerReason[] = [{ code: `knowledge:${state}`, text: `知识 ${key}：${stateText}` }];
    if (injected) reasons.push({ code: 'knowledge:injected', text: '同时提升到注入索引' });
    if (str(v.reviewedRevision)) reasons.push({ code: 'knowledge:revision', text: `采用修订 ${str(v.reviewedRevision).slice(0, 8)}` });
    return {
      ...base, kind: 'knowledge',
      actor: cleanActor(str(v.actor)),
      actorKind: 'human',
      verdict: {
        proposed: `提出知识候选：${key}`,
        confirmed: `采用知识：${key}${injected ? '（已注入）' : ''}`,
        withdrawn: `撤回知识：${key}`,
      }[state] ?? `知识${stateText}：${key}`,
      reasons, basis: 'human',
      // 只有"采用"这一步需要人的决定；提出和撤回不涉及签字。
      requiresHuman: state === 'confirmed' ? true : null,
    };
  }

  if (action === 'workspace.assistant-delegated') {
    const mode = str(v.mode) || 'unknown';
    return {
      ...base, kind: 'delegation',
      actor: cleanActor(str(v.delegatedBy)),
      actorKind: 'human',
      verdict: `委托协作助手（模式 ${mode}）`,
      reasons: [{ code: `delegate:${mode}`, text: `委托模式：${mode}` }],
      basis: 'human', requiresHuman: null,
    };
  }

  if (action === 'v06.acceptance-confirmed' || action === 'v06.acceptance-rejected') {
    const accepted = action.endsWith('confirmed');
    const note = str(v.reason) || str(v.note);
    const reasons: LedgerReason[] = [{ code: accepted ? 'acceptance:confirmed' : 'acceptance:rejected', text: accepted ? '人确认验收' : '人退回' }];
    if (note) reasons.push({ code: 'acceptance:note', text: note });
    return {
      ...base, kind: 'acceptance',
      actor: cleanActor(str(v.actor)),
      actorKind: 'human',
      verdict: accepted ? '已验收' : '退回重做',
      reasons, basis: 'human', requiresHuman: true,
    };
  }

  if (action === 'v06.handoff-requested' || action === 'v06.escalated') {
    const escalated = action.endsWith('escalated');
    return {
      ...base, kind: escalated ? 'escalation' : 'route',
      actor: cleanActor(str(v.actor)), actorKind: 'system',
      verdict: escalated ? '升级处理' : '发起交接',
      reasons: [{ code: escalated ? 'escalate' : 'handoff', text: escalated ? '触发升级' : '请求交接' }],
      basis: 'policy', requiresHuman: escalated ? true : null,
    };
  }

  return null;
}

/**
 * 构建账本。
 *
 * `audit` 按传入顺序消费；调用方负责倒序/正序，这里不改写顺序——
 * 账本是"事实的投影"，排序是视图的事。
 */
export function buildDecisionLedger(
  audit: readonly { at: string; action: string; issue_id?: string | null; value: unknown }[],
): LedgerEntry[] {
  return audit
    .map((row, index) => mapEntry({ at: row.at, action: row.action, issue_id: row.issue_id ?? null, value: row.value }, index))
    .filter((entry): entry is LedgerEntry => entry !== null);
}

export function summarizeLedger(entries: readonly LedgerEntry[]): LedgerSummary {
  const byKind: Record<string, number> = {};
  for (const entry of entries) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  const lastAt = entries.reduce<string | null>((latest, entry) =>
    !latest || entry.at > latest ? entry.at : latest, null);
  return {
    total: entries.length,
    byKind,
    missingBasis: entries.filter(entry => entry.reasons.length === 0).length,
    humanRequired: entries.filter(entry => entry.requiresHuman === true).length,
    lastAt,
  };
}
