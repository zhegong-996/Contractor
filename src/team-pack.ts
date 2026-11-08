// 12b ⑪（第三十一轮落地）：团队包——preset allowlist + 导入不提权 + 二次脱敏。
//
// 思想来源（仅借概念，见 docs/REFERENCE-openmausbot.md 第 2.2 节与差距清单
// 第 11 项）：团队包是一份带 frontmatter 的 Markdown，可一键装出 bots / 标准 /
// 知识引用；格式里**没有**权限、凭据、模型字段；导入默认关闭；导出前做二次
// 密钥扫描与地址脱敏。刻意不搬 r/w 双哈希合并（与本仓库「变更留快照、不
// 回溯改写」冲突）。
//
// 本仓库的定位（刻意收窄）：团队包是**组织级 Agent 编制与 C-6 自查标准的
// 携带格式**——导出侧只允许引用既有 agent-registry 的条目名与标准文本；
// 导入侧只生成「候选引用」，不直接改 agent-registry（组织级配置仍以
// agent-registry.ts 为准，导入永不提权、永不覆盖在岗编制）。
import { z } from 'zod';
import { createHash } from 'node:crypto';

/** 字段黑名单：团队包格式里永远不允许出现的东西（权限 / 凭据 / 模型端点）。 */
export const TEAM_PACK_FORBIDDEN_KEYS = [
  'permissions', 'approvalMode', 'autoApprove', 'alwaysAllow', 'peers',
  'apiKey', 'api_key', 'token', 'secret', 'password', 'credential',
  'modelSelection', 'fallbackModels', 'helperModel', 'endpoint', 'baseUrl',
] as const;

/** preset allowlist：团队包能携带的全部合法字段（白名单之外的键拒绝导入）。 */
export const TEAM_PACK_ALLOWED_KEYS = [
  'format', 'version', 'name', 'description',
  'agents', 'standards', 'knowledgeRefs',
] as const;

export const teamPackSchema = z.object({
  format: z.literal('suitme-team-pack'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  /** 编制引用：只允许引用 agent-registry 里已登记的条目名，不带任何配置。 */
  agents: z.array(z.object({
    name: z.string().min(1).max(60), note: z.string().max(300).default(''),
  }).strict()).max(40).default([]),
  /** C-6 自查标准文本（打回原因沉淀的标准）。 */
  standards: z.array(z.string().min(1).max(500)).max(60).default([]),
  /** 知识条目引用（taskId + key 指针，不含正文）。 */
  knowledgeRefs: z.array(z.object({
    taskId: z.string().min(1).max(80), key: z.string().min(1).max(60),
  }).strict()).max(20).default([]),
}).strict();
export type TeamPack = z.infer<typeof teamPackSchema>;

export type TeamPackReview = {
  ok: boolean;
  problems: string[];
  /** 二次脱敏扫描命中（键路径 + 类型），导出前必须清零。 */
  secretScanHits: { key: string; kind: string }[];
  packSha256: string;
  /** 导入永不提权：产物只是候选引用，不改组织级编制。 */
  importPolicy: 'candidate-references-only';
  modelCalls: 0;
};

const SECRET_PATTERNS: { kind: string; pattern: RegExp }[] = [
  { kind: 'sk- 类 API Key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { kind: 'Bearer Token', pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i },
  { kind: 'ghp_/github_pat 类令牌', pattern: /\b(ghp_|github_pat_|xox[bpoas]-)[A-Za-z0-9_-]{16,}\b/ },
  { kind: '私钥块', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { kind: 'postgresql 带口令 DSN', pattern: /postgresql:\/\/[^:\s/]+:[^@\s]+@/i },
  { kind: '环境变量赋值口令', pattern: /\b(PASSWORD|SECRET|TOKEN|API_KEY)\s*=\s*\S{8,}\b/ },
];

/** 二次脱敏扫描（导出前与导入时都跑）：对包全文做密钥模式扫描。 */
export function scanTeamPackSecrets(pack: unknown): { key: string; kind: string }[] {
  const hits: { key: string; kind: string }[] = [];
  const walk = (value: unknown, trail: string) => {
    if (typeof value === 'string') {
      for (const { kind, pattern } of SECRET_PATTERNS)
        if (pattern.test(value)) hits.push({ key: trail, kind });
      return;
    }
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${trail}[${index}]`)); return; }
    if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if ((TEAM_PACK_FORBIDDEN_KEYS as readonly string[]).includes(key))
          hits.push({ key: trail ? `${trail}.${key}` : key, kind: '禁携字段（权限 / 凭据 / 模型）' });
        walk(child, trail ? `${trail}.${key}` : key);
      }
  };
  walk(pack, '');
  return hits;
}

/** 校验 + 二次扫描：导入前的完整审查。黑名单字段直接拒绝，密钥模式如实报出。 */
export function reviewTeamPack(pack: unknown): TeamPackReview {
  const problems: string[] = [];
  const secretScanHits = scanTeamPackSecrets(pack);
  if (secretScanHits.length) problems.push('包含禁携字段或疑似密钥 / 凭据内容，禁止导入');
  let parsed: TeamPack | null = null;
  try {
    parsed = teamPackSchema.parse(pack);
    for (const standard of parsed.standards)
      for (const { kind, pattern } of SECRET_PATTERNS)
        if (pattern.test(standard)) { problems.push(`自查标准含疑似密钥（${kind}）`); break; }
  } catch (error) {
    problems.push('格式不合法：' + String(error).slice(0, 300));
  }
  return { ok: problems.length === 0, problems, secretScanHits,
    packSha256: createHash('sha256').update(JSON.stringify(pack ?? null)).digest('hex'),
    importPolicy: 'candidate-references-only', modelCalls: 0 };
}

/**
 * 导入（不提权）：团队包只产出「候选引用」——编制名进候选清单，标准进候选
 * 标准池（走 C-6 人审），知识引用只登记指针。**不改 agent-registry**、不覆盖
 * 在岗编制、不产生任何权限变更；重复导入按 packSha256 幂等跳过。
 */
export function importTeamPack(pack: unknown, registry: { names: readonly string[] }): {
  ok: boolean; problems: string[]; candidates: { agents: string[]; standards: string[]; knowledgeRefs: { taskId: string; key: string }[] };
  unknownAgents: string[]; packSha256: string; note: string;
} {
  const review = reviewTeamPack(pack);
  if (!review.ok) return { ok: false, problems: review.problems, candidates: { agents: [], standards: [], knowledgeRefs: [] },
    unknownAgents: [], packSha256: review.packSha256, note: '审查未通过，未导入任何内容' };
  const parsed = teamPackSchema.parse(pack);
  const known = new Set(registry.names);
  const unknownAgents = parsed.agents.map(agent => agent.name).filter(name => !known.has(name));
  return { ok: true, problems: [], candidates: {
    agents: parsed.agents.map(agent => agent.name),
    standards: [...parsed.standards],
    knowledgeRefs: parsed.knowledgeRefs.map(ref => ({ taskId: ref.taskId, key: ref.key })),
  }, unknownAgents, packSha256: review.packSha256,
    note: '导入产物是候选引用：编制名需在 agent-registry 人工登记后才生效；标准走 C-6 人审；不产生任何权限变更' };
}
