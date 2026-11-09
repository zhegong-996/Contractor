// 验收证据的「口径」约束（对齐 lobehub/acceptance SKILL.md 的 HARD RULE + evidence 契约，Apache-2.0 借概念）。
//
// 三条铁律：
// 1. 程序 gate 永远不是验收检查（unit/tsc/lint/build/CI 只能是一行 narrative）；
// 2. requiredEvidence 声明了类型但没提供 → 不 pass，标 uncertain；
// 3. UI 改动需要 before/after 同视角对比。

/** 程序 gate 特征：这些是「工程质量」不是「人看到的交付结果」，不能作为验收 check。 */
const PROGRAMMATIC_PATTERNS: RegExp[] = [
  /(unit|单元|单测|集成|回归|快照|snapshot|e2e|端到端)\s*(test|测试)?/i,
  /coverage|覆盖率/,
  /type-?check|tsc|类型检查/,
  /lint|eslint|format|prettier|格式化/,
  /(compiles?|编译|构建|build)\s*(通过|pass|成功|绿)?/,
  /CI\s*(is\s*)?(green|绿)|CI\s*通过/,
];

/**
 * 判断一个验收检查是否其实是「程序 gate」。
 * 对齐 LobeHub HARD RULE：程序 gate 运行后只能作为一行 narrative，绝不能作为验收 check。
 * 否则「CI 绿了 = 验收通过」——人根本没看到交付结果，就稀里糊涂点了接受。
 */
export function isProgrammaticGate(check: { title: string; method?: string }): boolean {
  const text = `${check.title ?? ''} ${check.method ?? ''}`;
  return PROGRAMMATIC_PATTERNS.some(pattern => pattern.test(text));
}

export type EvidenceType = 'screenshot' | 'recording' | 'log' | 'audio' | 'comparison';

/**
 * requiredEvidence 强制：声明了必须的证据类型但没提供 → 不满足，标 uncertain。
 * 缺失的证据不 pass（对齐 LobeHub「一个声明了 requiredEvidence 的检查不能只靠文字通过」）。
 */
export function requiredEvidenceSatisfied(
  required: readonly EvidenceType[],
  provided: readonly EvidenceType[],
): { satisfied: boolean; missing: EvidenceType[] } {
  const missing = required.filter(type => !provided.includes(type));
  return { satisfied: missing.length === 0, missing };
}

/** before/after 对比：改动已有 UI 的检查需要前后同视角证据。 */
export interface ComparisonPair {
  before: string;
  after: string;
  sameView: boolean;
}

/** 一个 UI 改动检查是否配齐了前后对比（只有 after 不能证明「它替换了旧状态」）。 */
export function comparisonComplete(pair: ComparisonPair | undefined): { ok: boolean; reason: string } {
  if (!pair) return { ok: false, reason: 'UI 改动缺少 before/after 对比：只有 after 截图不能证明它替换了旧状态' };
  if (!pair.before || !pair.after) return { ok: false, reason: 'before/after 对比缺一半' };
  if (!pair.sameView) return { ok: false, reason: 'before/after 不是同一视角，无法对照' };
  return { ok: true, reason: '' };
}
