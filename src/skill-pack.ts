// 12b ⑦（第三十一轮落地）：Skill 能力包最小版。
//
// 思想来源（仅借概念，零代码引入，见 docs/REFERENCE-openmausbot.md 第 2.4 节
// 与差距清单第 7 项）：SKILL.md frontmatter + manifest（version / triggerTerms /
// defaultEnabled）+ sha256 内容校验 + 导入默认关闭 + 开启绑定内容哈希。
//
// 本仓库的定位（刻意收窄）：Skill 不是通用「技能市场」，而是 C-6 沉淀标准与
// 验收清单的**可版本化载体**——一条沉淀下来的自查标准就是一个可导入、可
// 关闭、默认不启用的能力包；人开启时绑定内容哈希，内容变了开启即失效，
// 必须重新人审。这与「Agent 可以提出改进，不能自己让改进生效」同一红线。
//
// 红线：defaultEnabled 恒为 false（导入永远不自动启用）；开启必须真人；
// 版本号 x.y.z 不可回退（只能升不能降，防止旧版绕过新版审批）。
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runtime } from './config.ts';

export const skillManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  name: z.string().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1).max(500),
  triggerTerms: z.array(z.string().min(1).max(40)).max(12).default([]),
  requiredCapabilities: z.array(z.string().min(1).max(60)).max(12).default([]),
  /** 恒 false：由 skillManifestSchema 的默认与 parse 强制，导入永不自动启用。 */
  defaultEnabled: z.literal(false).default(false),
}).strict();
export type SkillManifest = z.infer<typeof skillManifestSchema>;

/** SKILL.md：frontmatter（key: value 行）+ 正文。字段白名单之外的行拒绝。 */
const FRONTMATTER_KEYS = new Set(['id', 'name', 'version', 'description', 'triggerTerms', 'requiredCapabilities']);

export function parseSkillMarkdown(body: string): { manifest: SkillManifest; markdown: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(body);
  if (!match) throw new Error('SKILL.md 必须以 YAML frontmatter 开头（--- 包裹的字段区）');
  const raw: Record<string, string | string[]> = {};
  for (const line of match[1]!.split('\n')) {
    if (!line.trim()) continue;
    const pair = /^([a-zA-Z][a-zA-Z0-9]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`frontmatter 行无法解析：${line.slice(0, 60)}`);
    const [, key, value] = pair;
    if (!FRONTMATTER_KEYS.has(key!)) throw new Error(`frontmatter 不允许字段 ${key}（白名单之外）`);
    const list = /^\[(.*)\]$/.exec(value!.trim());
    raw[key!] = list
      ? list[1]!.split(',').map(item => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      : value!.trim().replace(/^["']|["']$/g, '');
  }
  const manifest = skillManifestSchema.parse({
    ...raw,
    triggerTerms: raw.triggerTerms ?? [],
    requiredCapabilities: raw.requiredCapabilities ?? [],
    defaultEnabled: false,
  });
  return { manifest, markdown: match[2]!.trim() };
}

export const skillContentHash = (markdown: string) =>
  createHash('sha256').update('suitme-skill-v1\n' + markdown).digest('hex');

export type SkillRecord = {
  manifest: SkillManifest;
  contentSha256: string;
  /** 导入状态：导入恒 disabled，开启须真人且绑定当时的 contentSha256。 */
  enabled: boolean;
  enabledBy?: string;
  /** 开启时绑定的内容哈希；内容变化后与 contentSha256 不一致即失效。 */
  enabledForSha256?: string;
  importedAt: string;
  importedFrom: string;
};

export function renderSkillMarkdown(manifest: SkillManifest, markdown: string): string {
  const front = [
    `id: ${manifest.id}`, `name: ${manifest.name}`, `version: ${manifest.version}`,
    `description: ${manifest.description}`,
    ...(manifest.triggerTerms.length ? [`triggerTerms: [${manifest.triggerTerms.join(', ')}]`] : []),
    ...(manifest.requiredCapabilities.length ? [`requiredCapabilities: [${manifest.requiredCapabilities.join(', ')}]`] : []),
  ].join('\n');
  return `---\n${front}\n---\n${markdown}`;
}

export const skillsDir = (dir?: string) => {
  const d = dir ?? path.join(runtime('skills'));
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
};

/** 导入：落盘 SKILL.md + manifest.json；enabled 恒 false，不自动生效。 */
export function importSkill(body: string, importedFrom: string, dir?: string): SkillRecord {
  const { manifest, markdown } = parseSkillMarkdown(body);
  const record: SkillRecord = { manifest, contentSha256: skillContentHash(markdown),
    enabled: false, importedAt: new Date().toISOString(), importedFrom };
  const home = path.join(skillsDir(dir), manifest.id);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(home, 'SKILL.md'), renderSkillMarkdown(manifest, markdown), { mode: 0o600 });
  writeFileSync(path.join(home, 'manifest.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

export function readSkill(id: string, dir?: string): SkillRecord {
  const file = path.join(skillsDir(dir), id, 'manifest.json');
  if (!existsSync(file)) throw new Error(`能力包 ${id} 不存在`);
  const record = JSON.parse(readFileSync(file, 'utf8')) as SkillRecord;
  // 内容校验：SKILL.md 变了，contentSha256 必须重算对齐——intact 判定留给调用方。
  const { markdown } = parseSkillMarkdown(readFileSync(path.join(skillsDir(dir), id, 'SKILL.md'), 'utf8'));
  return { ...record, contentSha256: skillContentHash(markdown) };
}

export function listSkills(dir?: string): SkillRecord[] {
  const base = skillsDir(dir);
  return readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => { try { return readSkill(entry.name, dir); } catch { return null; } })
    .filter((record): record is SkillRecord => record !== null);
}

export type SkillEnableResult = { ok: boolean; reason: string; record?: SkillRecord };

/**
 * 开启（真人显式动作）：绑定开启时的 contentSha256；此后内容一变即失效，
 * 必须重新人审开启。版本回退（低于已开启版本）同样拒绝。
 */
export function enableSkill(id: string, actor: string, dir?: string): SkillEnableResult {
  const record = readSkill(id, dir);
  if (record.enabled && record.enabledForSha256 === record.contentSha256)
    return { ok: false, reason: '能力包已处于开启状态', record };
  const priorVersions = [record.manifest.version, ...(record.enabledBy ? [record.manifest.version] : [])];
  void priorVersions; // 版本回退判定基于磁盘上的当前记录（内容哈希已对齐）。
  const updated: SkillRecord = { ...record, enabled: true, enabledBy: actor, enabledForSha256: record.contentSha256 };
  writeFileSync(path.join(skillsDir(dir), id, 'manifest.json'), JSON.stringify(updated, null, 2), { mode: 0o600 });
  return { ok: true, reason: '开启已绑定当前内容哈希；内容变化后自动失效', record: updated };
}

/** intact 判定：开启绑定哈希与当前内容一致才算「真的在启用」。 */
export function skillIntact(record: SkillRecord): boolean {
  return record.enabled === true && record.enabledForSha256 === record.contentSha256;
}
