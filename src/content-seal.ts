/**
 * 内容密封（V1/V2 的共享地基）：给关键对象算内容哈希，篡改能查出来。
 *
 * 用途：
 * - V1 配置篡改检测：role-registry、org-table 等关键配置落盘时 seal，读回时 verify；
 * - V2 产物可信：产物登记时 seal 内容，验收比对时校验「声称的结果就是产出的内容」。
 *
 * 与验收清单的 planHash 是同一套思路，这里做成通用工具。
 * 规范化：键排序 + 稳定序列化 + 可排除易变字段（时间戳、端口等）。
 */
import { createHash } from 'node:crypto';

function stable(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 从对象里剔除易变字段后取内容哈希。 */
export function contentHash(value: unknown, excluded: readonly string[] = []): string {
  const omit = new Set(excluded);
  const stripped = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(stripped);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        if (omit.has(key)) continue;
        out[key] = stripped(val);
      }
      return out;
    }
    return node;
  };
  return createHash('sha256').update(stable(stripped(value))).digest('hex');
}

export interface Seal {
  hash: string;
  at: string;
  excluded: string[];
}

/** 给对象盖章。 */
export function seal(value: unknown, options: { excluded?: readonly string[]; at?: string } = {}): Seal {
  const excluded = [...(options.excluded ?? [])];
  return { hash: contentHash(value, excluded), at: options.at ?? new Date().toISOString(), excluded };
}

/** 校验：内容是否还和盖章时一致。 */
export function verifySeal(value: unknown, existing: Seal): boolean {
  return contentHash(value, existing.excluded) === existing.hash;
}

/** 找出「改了什么」（用于审计文案，不用于判定）。 */
export function sealDiff<T extends Record<string, unknown>>(
  before: T, after: T, excluded: readonly string[] = [],
): { changedKeys: string[]; beforeHash: string; afterHash: string } {
  const omit = new Set(excluded);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changedKeys = [...keys].filter(key => !omit.has(key)
    && stable(before[key]) !== stable(after[key]));
  return {
    changedKeys,
    beforeHash: contentHash(before, excluded),
    afterHash: contentHash(after, excluded),
  };
}
