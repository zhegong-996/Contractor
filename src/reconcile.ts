/**
 * 回群对账：产物变了，拿它和「事先锁定的清单」比一遍，只报差异，不改任何状态。
 *
 * 出处：千问办公 2.0 的「表更新过了，和待办对一下」——
 * 改完产物回群里说一句，它就回去读原表、挑出漏项。这里把那件事做成本机能力。
 *
 * 三条边界（必须保持）：
 * - 只报不改：不自行补建待办、不改验收结论、不动 readiness。
 * - 清单是唯一口径：报告里多出来的东西不算数，清单里漏验的必须报出来。
 * - 没有可比对的产物就说没有，不拿「暂无差异」冒充「核对通过」。
 */

export type ReconcileStatus = 'pass' | 'fail' | 'blocked' | 'pending';

export interface DeclaredItem {
  id: string;
  name: string;
  required?: boolean;
}

export interface ProducedItem {
  id: string;
  name?: string;
  status: ReconcileStatus | string;
}

export interface ReconcileInput {
  /** 事先锁定、不可篡改的清单（验收项）。 */
  declared: readonly DeclaredItem[];
  /** 产物里实际验了的东西（报告用例）。 */
  produced: readonly ProducedItem[] | null;
  /** 产物标识与修订号；变了才值得对一次账。 */
  artifact?: { ref: string; revision?: string | number | null; at?: string } | null;
}

export interface ReconcileFinding {
  id: string;
  name: string;
  /** missing 漏验 / extra 清单外 / unpassed 未通过 / pending 未出结论 */
  kind: 'missing' | 'extra' | 'unpassed' | 'pending';
  detail: string;
}

export interface ReconcileResult {
  /** 没有产物可对时 false —— 此时 findings 必为空，不能当成「没问题」。 */
  comparable: boolean;
  declaredCount: number;
  producedCount: number;
  findings: ReconcileFinding[];
  counts: { missing: number; extra: number; unpassed: number; pending: number };
  conclusion: string;
  card: string;
}

const nameOf = (id: string, fallback?: string) => fallback?.trim() || id;

/**
 * 上游（lobehub/acceptance 与本仓库评审轮次）用的是 passed / failed，
 * 这里统一成 pass / fail，免得调用方每处都自己映射一遍。
 */
export function normaliseStatus(status: unknown): string {
  const value = String(status ?? '').trim().toLowerCase();
  if (!value) return 'pending';
  if (value === 'passed' || value === 'pass') return 'pass';
  if (value === 'failed' || value === 'fail') return 'fail';
  if (value === 'blocked' || value === 'pending') return value;
  return value;
}

/**
 * 对账主函数。纯函数：同样的输入永远同样的输出，不读写任何外部状态。
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const declared = [...input.declared];
  const produced = input.produced ? [...input.produced] : null;
  if (!produced) {
    return {
      comparable: false,
      declaredCount: declared.length,
      producedCount: 0,
      findings: [],
      counts: { missing: 0, extra: 0, unpassed: 0, pending: 0 },
      conclusion: declared.length
        ? `清单有 ${declared.length} 项，但还没有可核对的产物；这不是核对通过。`
        : '还没有清单，也没有产物，无从对账。',
      card: '',
    };
  }

  const producedById = new Map(produced.map(item => [item.id, item]));
  const declaredIds = new Set(declared.map(item => item.id));
  const findings: ReconcileFinding[] = [];

  for (const item of declared) {
    const hit = producedById.get(item.id);
    if (!hit) {
      findings.push({ id: item.id, name: nameOf(item.id, item.name), kind: 'missing',
        detail: item.required === false ? '清单里的可选项，报告没提' : '清单要求验，报告里没有这一项' });
      continue;
    }
    const status = normaliseStatus(hit.status);
    if (status === 'pending') {
      findings.push({ id: item.id, name: nameOf(item.id, item.name), kind: 'pending', detail: '报告里还没有结论' });
    } else if (status !== 'pass' && item.required !== false) {
      findings.push({ id: item.id, name: nameOf(item.id, item.name), kind: 'unpassed', detail: `状态是 ${status}` });
    }
  }

  for (const item of produced) {
    if (declaredIds.has(item.id)) continue;
    findings.push({ id: item.id, name: nameOf(item.id, item.name), kind: 'extra',
      detail: '清单外的项，不计入结论，需要人决定是补进清单还是删掉' });
  }

  const counts = {
    missing: findings.filter(f => f.kind === 'missing').length,
    extra: findings.filter(f => f.kind === 'extra').length,
    unpassed: findings.filter(f => f.kind === 'unpassed').length,
    pending: findings.filter(f => f.kind === 'pending').length,
  };
  const total = counts.missing + counts.extra + counts.unpassed + counts.pending;
  const conclusion = total === 0
    ? `清单 ${declared.length} 项与报告逐项对上，且都通过。`
    : `清单 ${declared.length} 项 / 报告 ${produced.length} 项，有 ${total} 处要人看一眼。`;

  return {
    comparable: true,
    declaredCount: declared.length,
    producedCount: produced.length,
    findings,
    counts,
    conclusion,
    card: renderReconcileCard({ declared, produced, findings, counts, conclusion, artifact: input.artifact ?? null }),
  };
}

/** 回群播报的卡片文本：先给结论，再列差异，最后一句「没有改动任何状态」。 */
function renderReconcileCard(input: {
  declared: DeclaredItem[];
  produced: ProducedItem[];
  findings: ReconcileFinding[];
  counts: ReconcileResult['counts'];
  conclusion: string;
  artifact: { ref: string; revision?: string | number | null } | null;
}): string {
  const lines = [`【对账】${input.conclusion}`];
  if (input.artifact) {
    const revision = input.artifact.revision ?? '未标修订';
    lines.push(`产物：${input.artifact.ref}（修订 ${revision}）`);
  }
  const label: Record<ReconcileFinding['kind'], string> = {
    missing: '漏验', extra: '清单外', unpassed: '未通过', pending: '未出结论',
  };
  for (const finding of input.findings) {
    lines.push(`· ${label[finding.kind]} ${finding.id}「${finding.name}」：${finding.detail}`);
  }
  if (input.findings.length === 0) lines.push('· 没有差异');
  lines.push('以上只是核对结果，没有改动验收结论、清单或任何任务状态。');
  return lines.join('\n');
}

/**
 * 群消息里是不是在要求对账。
 * 刻意收窄：只认「对一下 / 核对 / 对账」这类明确说法，
 * 免得把「帮我改一下清单」也当成对账去跑。
 */
const RECONCILE_PATTERNS = [
  /(和|跟|与).{0,8}(待办|清单|待办清单).{0,4}(对|核|比)/,
  /(对一下|对一下账|对账|核对一下|核一下|比对一下|比一下)/,
  /(表|文档|产物|报告).{0,6}(更新|改)(过|了).{0,12}(对|核|比)/,
];

/**
 * 「改清单」是越界动作，不能因为句子里同时出现「清单」就被当对账。
 * 注意要排除「改了…跟清单对一下」这种连词结构 —— 那里 清单 是比对对象，不是被改的东西。
 */
const EDIT_PLAN_PATTERNS = [
  /(改|调整|删|增加|加|去掉)[^，。；,;跟和与]{0,6}(清单|标准|检查项)/,
  /(清单|标准|检查项)[^，。；,;]{0,4}(改|调整|删|去掉|增加|加)/,
];

export function isReconcileRequest(text: string): boolean {
  const value = String(text ?? '').trim();
  if (!value) return false;
  if (EDIT_PLAN_PATTERNS.some(pattern => pattern.test(value))) return false;
  return RECONCILE_PATTERNS.some(pattern => pattern.test(value));
}
