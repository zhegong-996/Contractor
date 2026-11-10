/**
 * 任务时间线：把审计事件翻译成「人 / Agent / 系统」三类、能看懂的一条时间线。
 *
 * 数据源是 store 的 audit 表（按 issue_id 关联），加上任务本身的初始请求与最后一句话。
 * 审计 action 是技术名（loop.downstream / routing.decision …），这里翻译成人话，
 * 并归到「谁在动」三类：human（人发来的）、agent（Agent 回的）、system（系统判定）。
 * 纯函数、零 IO、零模型调用，可复现。
 */

export type TimelineKind = 'human' | 'agent' | 'system';

export interface TimelineEntry {
  at: string;
  kind: TimelineKind;
  label: string;
  detail: string;
}

export interface TimelineInput {
  audit: readonly { at: string; action: string; value: string }[];
  /** 任务的初始请求（context 里的 request 字段，已由调用方解析）。 */
  request?: string | null;
  /** 任务最后一句话。 */
  lastMessage?: string | null;
  /** 交付信息（pr / ci / merged）。 */
  delivery?: { pr?: number; ci?: string; merged?: boolean; previewUrl?: string } | null;
}

/** 审计 action → 人话 + 归谁。未列出的 action 归 system，原文标出。 */
const ACTION_MAP: Record<string, { kind: TimelineKind; label: string }> = {
  'task.created': { kind: 'system', label: '任务创建' },
  'routing.decision': { kind: 'system', label: '派活决策' },
  'acceptance.plan-locked': { kind: 'system', label: '验收清单锁定' },
  'loop.downstream': { kind: 'human', label: '发来消息' },
  'loop.upstream': { kind: 'agent', label: '回执 / 进度' },
  'task.handoff': { kind: 'system', label: '交接' },
  'run.reconciled': { kind: 'system', label: '对账' },
  'trace.appended': { kind: 'system', label: '追加证据' },
  'subscription.released': { kind: 'system', label: '验收完成' },
  'collaboration.delegation': { kind: 'system', label: '委托链' },
  'collaboration.countersigned': { kind: 'system', label: '会签' },
  'collaboration.started': { kind: 'system', label: '协作启动' },
  'delivery.registered': { kind: 'agent', label: '交付登记' },
  'artifact.registered': { kind: 'agent', label: '产物登记' },
  'v06.acceptance-confirmed': { kind: 'human', label: '确认验收' },
  'v06.acceptance-rejected': { kind: 'human', label: '退回' },
  'member.action': { kind: 'human', label: '操作' },
};

/** 从 value JSON 里抽一句能看懂的摘要。 */
function detailOf(action: string, value: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return ''; }
  if (!parsed || typeof parsed !== 'object') return '';
  const v = parsed as Record<string, unknown>;
  if (action === 'routing.decision') {
    const outcome = String(v.outcome ?? '');
    return outcome === 'committed' ? '已派单给执行 Agent' : `结论：${outcome || '未定'}`;
  }
  if (action === 'loop.downstream') {
    const choice = String(v.choice ?? '');
    if (choice) return choice;
    const kind = String(v.kind ?? '');
    if (kind === 'supplement') return '补充说明';
    if (kind === 'answer') return `回答：${String(v.text ?? v.detail ?? '')}`;
    return kind ? `类型：${kind}` : '';
  }
  if (action === 'loop.upstream') {
    const events = Array.isArray(v.events) ? v.events : [];
    const first = (events[0] ?? {}) as Record<string, unknown>;
    const payload = (first.payload ?? {}) as Record<string, unknown>;
    const outcome = String(payload.outcome ?? '');
    const expects = String(first.expectsHumanAction ?? v.expectsHumanAction ?? '');
    const parts: string[] = [];
    if (outcome) parts.push(`结论：${outcome}`);
    if (expects && expects !== 'none') parts.push(`期望人：${expects}`);
    return parts.join('；');
  }
  if (action === 'trace.appended') {
    return v.kind ? `证据：${String(v.kind)}` : '';
  }
  if (action === 'member.action') {
    return v.action ? `动作：${String(v.action)}` : '';
  }
  if (action === 'task.handoff') {
    const next = String(v.next ?? '');
    const generation = Number(v.generation ?? 0);
    return next ? `交接给 ${next}（第 ${generation || 1} 代）` : '任务已交接';
  }
  if (action === 'subscription.released') return String(v.reason || '任务已验收');
  if (action === 'collaboration.countersigned') {
    const verdict = String(v.verdict ?? '');
    const allow = Number(v.allows ?? 0), deny = Number(v.denies ?? 0);
    return verdict === 'allow' ? `会签通过（${allow} 通过 / ${deny} 否决）` : `会签：${verdict || '未定'}`;
  }
  const phase = v.phase ? `阶段：${String(v.phase)}` : '';
  const reason = v.reason ? String(v.reason) : '';
  return [phase, reason].filter(Boolean).join('；');
}

/** 交付信息转一条 agent 时间线（放在最后，最新）。 */
function deliveryEntry(delivery: TimelineInput['delivery']): TimelineEntry | null {
  if (!delivery) return null;
  const parts: string[] = [];
  if (delivery.pr) parts.push(`PR #${delivery.pr}`);
  if (delivery.ci) parts.push(`CI ${delivery.ci === 'passed' ? '通过' : delivery.ci}`);
  parts.push(delivery.merged ? '已合并' : '未合并');
  if (delivery.previewUrl) parts.push(`预览 ${delivery.previewUrl}`);
  return { at: '', kind: 'agent', label: '交付', detail: parts.join(' · ') };
}

/**
 * 组装时间线：倒序审计在前（最新在前），初始请求垫底，交付信息置顶。
 * 同一条请求若出现重复 action 会保留（审计本来就是逐条事实，不合并）。
 */
export function buildTaskTimeline(input: TimelineInput): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const delivery = deliveryEntry(input.delivery);
  if (delivery) entries.push(delivery);
  if (input.lastMessage) {
    entries.push({ at: '', kind: 'agent', label: '最后一句话', detail: input.lastMessage });
  }
  for (const item of input.audit) {
    const mapped = ACTION_MAP[item.action] ?? { kind: 'system' as TimelineKind, label: item.action };
    entries.push({ at: item.at, kind: mapped.kind, label: mapped.label, detail: detailOf(item.action, item.value) });
  }
  if (input.request) {
    entries.push({ at: '', kind: 'human', label: '发起请求', detail: input.request });
  }
  return entries;
}

/** 全局对话流条目：跨任务聚合的「谁在动 + 说了什么」，供「对话」视图做气泡时间线。 */
export interface FeedEntry {
  at: string;
  kind: TimelineKind;
  taskId: string;
  taskTitle: string;
  label: string;
  detail: string;
}

/**
 * 组装全局对话流：把跨任务的审计事件翻译成「人 / Agent / 系统」三类，
 * 附带所属任务标题。纯函数、零 IO、零模型调用，可复现。
 */
export function buildConversationFeed(input: {
  audit: readonly { at: string; action: string; issue_id: string | null; value: string }[];
  tasks: ReadonlyMap<string, { title: string }>;
}): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const item of input.audit) {
    const mapped = ACTION_MAP[item.action] ?? { kind: 'system' as TimelineKind, label: item.action };
    const task = item.issue_id ? input.tasks.get(item.issue_id) : undefined;
    entries.push({
      at: item.at,
      kind: mapped.kind,
      taskId: item.issue_id ?? '',
      taskTitle: task?.title ?? '',
      label: mapped.label,
      detail: detailOf(item.action, item.value),
    });
  }
  return entries;
}
