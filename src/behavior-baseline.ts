// P-8 取长：把 OpenMausBot 参考评估 HANDOFF/08 第 12 条推荐的六项里，
// 不需要新上游 / 外部模型 / 人签变更的确定性能力落地。
//
// 对照 docs/REFERENCE-openmausbot.md 的六项差距：
//   ① 行为轨迹基线 + golden diff       → freezeTraceSnapshot / diffGolden
//   ② 冻结快照纯评分器                 → scoreSnapshot
//   ③ 双臂对照的两个统计旗标           → armFlags（non-discriminating / high-variance）
//   ④ tool-choice 回归 + 版本化判据    → toolSurfaceSignature / inspectOutboundTools
//   ⑤ 工程层自动决策的独立留痕         → assertDecisionTraceIsolation（routing-trace 已有等价物，只补断言）
//   ⑥ 出站 MCP「不暴露」清单硬断言     → FORBIDDEN_OUTBOUND_TOOLS / assertOutboundTools
//
// 全部纯函数、确定性、modelCalls=0；只读，不改任何生产状态、不调用模型、不写日志。
// 本仓库没有 LLM tool-choice，因此第 ④ 项按「出站 MCP 工具面」落地，不虚构模型决策。
import { createHash } from 'node:crypto';

const sha = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

/**
 * 字节序比较，不用 localeCompare：后者的排序依赖 ICU 区域设置，
 * 会让「冻结」快照在不同机器上算出不同签名，破坏跨平台可复现性。
 */
const byteOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// ---------------------------------------------------------------------------
// ①② 冻结快照与 golden diff
// ---------------------------------------------------------------------------

/** 每次真跑都会变的字段一律排除，保证同一行为产出同一签名。 */
const VOLATILE_KEYS = new Set([
  'at', 'port', 'timestamp', 'startedAt', 'finishedAt', 'durationMs', 'ms', 'elapsed',
  'screenshot', 'png', 'image', 'url', 'pageUrl', 'cdpPort', 'harness', 'report',
  'userDataDir', 'log', 'logPath', 'pid', 'random', 'nonce', 'runId', 'lease',
]);

export type FrozenSnapshot = {
  schemaVersion: 1;
  kind: string;
  signature: string;
  entries: { key: string; value: string }[];
  count: number;
  modelCalls: 0;
  excludedKeys: string[];
};

const flatten = (value: unknown, prefix: string, out: Map<string, string>, excluded: Set<string>): void => {
  if (value === null || value === undefined) { out.set(prefix, 'null'); return; }
  if (Array.isArray(value)) {
    if (!value.length) { out.set(prefix, '[]'); return; }
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out, excluded));
    return;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    if (!keys.length) { out.set(prefix, '{}'); return; }
    for (const key of keys) {
      if (VOLATILE_KEYS.has(key)) { excluded.add(key); continue; }
      flatten((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key, out, excluded);
    }
    return;
  }
  out.set(prefix, typeof value === 'string' ? value : String(value));
};

/** 把一份真跑报告冻结成稳定快照；不取时间、不读环境。 */
export function freezeTraceSnapshot(kind: string, raw: unknown): FrozenSnapshot {
  const entries = new Map<string, string>();
  const excluded = new Set<string>();
  flatten(raw, '', entries, excluded);
  const sorted = [...entries.entries()].sort(([a], [b]) => byteOrder(a, b))
    .map(([key, value]) => ({ key, value }));
  return { schemaVersion: 1, kind, signature: sha(sorted), entries: sorted,
    count: sorted.length, modelCalls: 0, excludedKeys: [...excluded].sort() };
}

export type GoldenDiff = {
  added: { key: string; value: string }[];
  removed: { key: string; value: string }[];
  changed: { key: string; golden: string; current: string }[];
  unchanged: number;
  ok: boolean;
};

export function diffGolden(golden: FrozenSnapshot, current: FrozenSnapshot): GoldenDiff {
  const g = new Map(golden.entries.map(entry => [entry.key, entry.value]));
  const c = new Map(current.entries.map(entry => [entry.key, entry.value]));
  const added: GoldenDiff['added'] = [], removed: GoldenDiff['removed'] = [];
  const changed: GoldenDiff['changed'] = [];
  let unchanged = 0;
  for (const [key, value] of c) {
    if (!g.has(key)) added.push({ key, value });
    else if (g.get(key) !== value) changed.push({ key, golden: g.get(key)!, current: value });
    else unchanged++;
  }
  for (const [key, value] of g) if (!c.has(key)) removed.push({ key, value });
  const byKey = (a: { key: string }, b: { key: string }) => byteOrder(a.key, b.key);
  added.sort(byKey); removed.sort(byKey); changed.sort(byKey);
  return { added, removed, changed, unchanged,
    ok: added.length === 0 && removed.length === 0 && changed.length === 0 };
}

/** 纯评分器：只按冻结快照算，不推断、不补零、不调用模型。 */
export function scoreSnapshot(golden: FrozenSnapshot, current: FrozenSnapshot) {
  const diff = diffGolden(golden, current);
  const comparable = golden.kind === current.kind;
  const denominators = diff.unchanged + diff.changed.length + diff.removed.length;
  const passRate = !comparable || denominators === 0 ? null : diff.unchanged / denominators;
  const regressions = diff.changed.length + diff.removed.length;
  return {
    comparable, passRate, regressions,
    goldenSignature: golden.signature, currentSignature: current.signature,
    verdict: !comparable ? 'kind-mismatch' as const
      : diff.ok ? 'identical' as const
        : regressions > 0 ? 'regressed' as const : 'expanded' as const,
    diff, modelCalls: 0 as const,
    note: comparable ? '按冻结快照逐项比对；是否接受新增项仍由人决定。'
      : '快照种类不同，不比较、不编造分数。',
  };
}

// ---------------------------------------------------------------------------
// ③ 双臂对照统计旗标
// ---------------------------------------------------------------------------

export type ArmFlag = 'ok' | 'insufficient-samples' | 'non-discriminating' | 'high-variance';
export type ArmReport = {
  flags: ArmFlag[];
  comparable: boolean;
  control: { samples: number; mean: number | null; spread: number | null };
  treatment: { samples: number; mean: number | null; spread: number | null };
  delta: number | null;
  minSamples: number;
  modelCalls: 0;
  note: string;
};

const mean = (values: number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const spread = (values: number[]) => values.length > 1
  ? Math.max(...values) - Math.min(...values) : 0;

/**
 * 只标出「这轮对照能不能下结论」，不替人下结论。样本不足就标不足，
 * 两臂无区分就标不可区分，波动过大就标高方差；绝不补零或估算。
 */
export function armFlags(controlSamples: number[], treatmentSamples: number[], options: {
  minSamples?: number; tolerance?: number; varianceThreshold?: number;
} = {}): ArmReport {
  const minSamples = options.minSamples ?? 5;
  const tolerance = options.tolerance ?? 1e-9;
  const varianceThreshold = options.varianceThreshold ?? 0.5;
  const controlMean = mean(controlSamples), treatmentMean = mean(treatmentSamples);
  const controlSpread = spread(controlSamples), treatmentSpread = spread(treatmentSamples);
  const delta = controlMean !== null && treatmentMean !== null ? treatmentMean - controlMean : null;
  const flags: ArmFlag[] = [];

  if (controlSamples.length < minSamples || treatmentSamples.length < minSamples)
    flags.push('insufficient-samples');
  if (delta !== null && Math.abs(delta) <= tolerance) flags.push('non-discriminating');
  const highVariance = (values: number[], width: number, avg: number | null) =>
    avg !== null && Math.abs(avg) > tolerance && width / Math.abs(avg) > varianceThreshold;
  if (highVariance(controlSamples, controlSpread, controlMean)
    || highVariance(treatmentSamples, treatmentSpread, treatmentMean))
    flags.push('high-variance');
  if (!flags.length) flags.push('ok');

  return {
    flags, comparable: flags.length === 1 && flags[0] === 'ok',
    control: { samples: controlSamples.length, mean: controlMean, spread: controlSpread },
    treatment: { samples: treatmentSamples.length, mean: treatmentMean, spread: treatmentSpread },
    delta, minSamples, modelCalls: 0,
    note: flags.includes('insufficient-samples') ? '样本不足，不比较、不补零、不估算。'
      : flags.includes('high-variance') ? '臂内波动过大，结果不可直接采信，需补样本或人审。'
        : flags.includes('non-discriminating') ? '两臂无可区分差异，不能据此宣称改进有效。'
          : '样本足、有区分且波动可接受；是否保留改进仍由人决定。',
  };
}

// ---------------------------------------------------------------------------
// ④⑥ 出站 MCP 工具面：版本化判据 + 「不暴露」硬断言
// ---------------------------------------------------------------------------

/**
 * 出站工具「不暴露」清单：验收确认、任务发起、越权管理、撤权、删除、绕过授权
 * 一律不得通过 MCP 暴露给外部 Agent。人签只能由原发起人在原会话完成。
 */
export const FORBIDDEN_OUTBOUND_TOOLS = [
  'confirm_acceptance', 'accept_delivery', 'confirm_delivery', 'verify_acceptance',
  'create_task', 'start_task', 'dispatch_task',
  'admin_view', 'admin_all', 'impersonate', 'read_all_private',
  'revoke_access', 'revoke_grant', 'delete_source', 'delete_task',
  'bypass_authorization', 'bypass_approval', 'grant_without_review',
] as const;

/** 前缀级禁止：即使将来新增工具名也不能绕过。 */
export const FORBIDDEN_TOOL_PREFIXES = [
  'admin_', 'confirm_accept', 'bypass_', 'delete_', 'revoke_', 'impersonate_',
] as const;

export type OutboundInspection = {
  ok: boolean;
  count: number;
  signature: string;
  forbiddenHits: { name: string; reason: string }[];
  tools: string[];
  modelCalls: 0;
};

/** 工具面稳定签名：顺序无关，新增 / 删除 / 改名都会变，便于版本化回归。 */
export function toolSurfaceSignature(names: string[]): string {
  return sha([...new Set(names)].sort());
}

export function inspectOutboundTools(names: string[]): OutboundInspection {
  const forbiddenHits: OutboundInspection['forbiddenHits'] = [];
  for (const name of names) {
    if ((FORBIDDEN_OUTBOUND_TOOLS as readonly string[]).includes(name))
      forbiddenHits.push({ name, reason: '在明确不暴露清单内' });
    else if (FORBIDDEN_TOOL_PREFIXES.some(prefix => name.startsWith(prefix)))
      forbiddenHits.push({ name, reason: '命中禁止前缀（验收 / 越权 / 撤权 / 删除 / 绕过）' });
  }
  return { ok: forbiddenHits.length === 0, count: new Set(names).size,
    signature: toolSurfaceSignature(names), forbiddenHits,
    tools: [...new Set(names)].sort(), modelCalls: 0 };
}

/** 机器化硬断言：命中即抛错，不允许「先上线再补清单」。 */
export function assertOutboundTools(names: string[]): { ok: true; signature: string } {
  const report = inspectOutboundTools(names);
  if (!report.ok)
    throw new Error(`出站 MCP 暴露了禁止工具：${report.forbiddenHits.map(hit => `${hit.name}（${hit.reason}）`).join('、')}`);
  if (!names.length) throw new Error('出站 MCP 工具面为空，无法核对不暴露清单');
  return { ok: true, signature: report.signature };
}

// ---------------------------------------------------------------------------
// ⑤ 自动决策独立留痕断言（routing-trace 已有等价物，只补机器化守门）
// ---------------------------------------------------------------------------

export type DecisionEventLike = { id: string; at: string; kind: string };

/**
 * 决策留痕必须独立于业务状态写入：不同流不共用 id、每条都有标识 / 时间 / 类型、
 * 且按时间单调不减（append-only）。共用 id 或乱序会破坏重放口径，直接拒绝。
 */
export function assertDecisionTraceIsolation(input: {
  decisions: DecisionEventLike[];
  businessWriteIds: string[];
}): { isolated: true; decisions: number; overlappingIds: string[]; modelCalls: 0 } {
  const writeIds = new Set(input.businessWriteIds);
  const overlappingIds = [...new Set(input.decisions
    .filter(event => writeIds.has(event.id)).map(event => event.id))].sort();
  if (overlappingIds.length)
    throw new Error(`决策留痕与业务状态写入共用了 id：${overlappingIds.join(', ')}`);
  for (const event of input.decisions)
    if (!event.id || !event.at || !event.kind)
      throw new Error('决策留痕缺少 id / at / kind，无法独立重放');
  for (let index = 1; index < input.decisions.length; index++)
    if (input.decisions[index]!.at < input.decisions[index - 1]!.at)
      throw new Error('决策留痕时间倒序，append-only 口径被破坏');
  return { isolated: true, decisions: input.decisions.length,
    overlappingIds, modelCalls: 0 };
}
