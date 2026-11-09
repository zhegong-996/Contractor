/**
 * 交互成本（GOMS-KLM）定价（对齐 lobehub/acceptance `references/interaction-cost.md`，Apache-2.0）。
 *
 * 上游的核心设计是「你只数动作，平台统一定价」：driver 往 trace 里追加原始算子计数，
 * 平台用一个固定的时序模型（goms-klm@lobe-v1）把它折成人等价的秒数。
 * 这样每一轮都由同一个模型定价、任何已发布的数字都能从 trace 重算。
 *
 * 本模块做「定价」这半（纯函数）：解析 trace 的算子计数，套 KLM 时序模型算秒数。
 * 采集算子计数属于 driver，不在本模块。
 */

export const KLM_SCHEMA = 'lobehub.agentBrowserKlmTrace@1';

/** KLM 算子时序模型（秒）。经典值，可作为 lobe-v1 的本地兜底。 */
export const KLM_OPERATOR_SECONDS: Record<string, number> = {
  P: 1.1,        // pointing at a target
  K: 0.2,        // one keystroke / button press
  H: 0.4,        // homing between keyboard and pointer
  M: 1.35,       // mental preparation
  T_chars: 0.12, // per character typed
};

export interface KlmAtom {
  schema: string;
  type?: 'action' | 'mental_estimate';
  category?: 'action' | 'mental' | 'blocked';
  operators?: Record<string, number>;
  durationMs?: number;
  phase?: { id?: string; label?: string; checkItemId?: string };
  mentalEstimate?: { score?: number; confidence?: number; reason?: string };
}

export interface KlmCost {
  /** 是否成功定价（trace 里有没有可定价的动作）。 */
  priceable: boolean;
  /** 人等价秒数。 */
  seconds: number;
  /** 算子总数（按类）。 */
  operators: Record<string, number>;
  /** 定价了原子的个数。 */
  atoms: number;
  /** 被跳过（blocked / 非本 schema）的原子数。 */
  skipped: number;
}

/**
 * 解析一行 trace，返回一个规范化的原子；非本 schema 或畸形 → null（上游不求和外来 tag）。
 */
export function parseKlmAtom(line: unknown): KlmAtom | null {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  let atom: KlmAtom;
  try { atom = JSON.parse(trimmed); } catch { return null; }
  if (!atom || atom.schema !== KLM_SCHEMA) return null;
  return atom;
}

/**
 * 定价：累加每个 action 原子的算子计数，套时序模型折秒。
 * blocked 记 0（没发生的事不收费）；M 是估计值、已由 driver 写进 operators。
 * 一个可定价原子都没有 → priceable=false，而不是谎报 0 秒。
 */
export function priceKlmTrace(lines: readonly unknown[]): KlmCost {
  const operators: Record<string, number> = {};
  let atoms = 0;
  let skipped = 0;
  let seconds = 0;

  for (const line of lines) {
    const atom = parseKlmAtom(line);
    if (!atom) { skipped++; continue; }
    if (atom.category === 'blocked') { skipped++; continue; }
    const ops = atom.operators ?? {};
    let hasOperator = false;
    for (const [key, count] of Object.entries(ops)) {
      const n = Number(count);
      if (!Number.isFinite(n) || n <= 0) continue;
      const rate = KLM_OPERATOR_SECONDS[key];
      if (rate === undefined) continue;           // 外来算子不计价
      hasOperator = true;
      operators[key] = (operators[key] ?? 0) + n;
      seconds += n * rate;
    }
    if (hasOperator) atoms++;
    else skipped++;
  }

  return {
    priceable: atoms > 0 && seconds > 0,
    seconds: Math.round(seconds * 100) / 100,
    operators, atoms, skipped,
  };
}

/** 给人看的一句结论。 */
export function klmSummary(cost: KlmCost): string {
  if (!cost.priceable) return '本轮没有可定价的交互动作（不谎报 0 秒）';
  const detail = Object.entries(cost.operators).map(([k, n]) => `${k}×${n}`).join(' ');
  return `用户等价交互成本 ${cost.seconds}s（${cost.atoms} 个动作；算子 ${detail}）`;
}
