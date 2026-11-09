/**
 * 无障碍检查结果解析（对齐 lobehub/acceptance `references/axe.md`，Apache-2.0）。
 *
 * axe-core 的输出里 `violations` 是要修的，`passes` / `incomplete` 是已过 / 需要人工复核。
 * 本模块把 axe 的 JSON 结果解析成「阻断 / 不阻断」的判定 + 摘要，供验收判定消费。
 * 只解析结果，不驱动 axe 本身（axe CLI 是外部工具）。
 */

export const AXE_IMPACTS = ['critical', 'serious', 'moderate', 'minor'] as const;
export type AxeImpact = (typeof AXE_IMPACTS)[number];

/** critical / serious 阻断；moderate / minor 只记录不阻断（对齐常见 a11y 门槛）。 */
export const BLOCKING_IMPACTS: readonly AxeImpact[] = ['critical', 'serious'];

export interface AxeViolation {
  id: string;
  impact: AxeImpact;
  help?: string;
  nodes?: number;
}

export interface AxeReport {
  violations?: AxeViolation[];
  incomplete?: AxeViolation[];
}

export interface A11yVerdict {
  /** 是否有阻断级违规。 */
  blocked: boolean;
  /** 阻断级违规的摘要。 */
  blocking: AxeViolation[];
  /** 需要人工复核的（incomplete）。 */
  needsReview: AxeViolation[];
  conclusion: string;
}

/**
 * 解析 axe 结果，产出验收用的判定。
 * 一条 critical/serious 违规即阻断；incomplete 标「需人工复核」但不自动判过。
 */
export function a11yVerdict(report: AxeReport): A11yVerdict {
  const violations = report.violations ?? [];
  const incomplete = report.incomplete ?? [];
  const blocking = violations.filter(v => BLOCKING_IMPACTS.includes(v.impact));
  const needsReview = incomplete;
  const blocked = blocking.length > 0;
  const conclusion = blocked
    ? `无障碍阻断：${blocking.length} 条 critical/serious 违规（${blocking.map(v => v.id).join(', ')}）`
    : violations.length
      ? `无障碍：${violations.length} 条违规均为 moderate/minor，不阻断，建议修复`
      : '无障碍：无违规';
  return { blocked, blocking, needsReview, conclusion };
}
