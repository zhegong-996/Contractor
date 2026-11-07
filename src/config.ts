import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 方案 C-3 · 组织形态配置。层是配置不是产品骨架：扁平 1 跳、按业务域分层最多
// 2 跳，没配主管的业务域退回扁平；`legacy` 是显式的「沿用改造前直写」开关。
// 放在本文件而不是 router.ts，避免 config.ts ↔ routing-trace.ts 的循环依赖。
export const ROUTER_MODES = ['legacy', 'flat', 'layered'] as const;
const agentKey = z.string().min(1).max(80).regex(/^[a-z][a-z0-9-]*$/, 'Agent 标识只允许小写字母、数字与连字符');
const domainId = z.string().min(1).max(80).regex(/^[a-z][a-z0-9-]*$/, '业务域标识只允许小写字母、数字与连字符');
export const routerDomainSchema = z.object({
  label: z.string().min(1).max(80),
  supervisorAgentKey: agentKey,
  personalAgentKey: agentKey.optional(),
}).strict();
export const routerConfigSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(ROUTER_MODES).default('flat'),
  /** 按业务域 / 组织单元生效，组织级唯一；项目只引用不覆写。 */
  domains: z.record(domainId, routerDomainSchema).default({}),
  defaultDomain: domainId.optional(),
  /** 极限保护：即使 layered 也不允许超过 2 跳。 */
  maxHops: z.number().int().min(1).max(2).default(2),
}).strict().superRefine((cfg, ctx) => {
  if (cfg.defaultDomain && !cfg.domains[cfg.defaultDomain]) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultDomain'], message: '默认业务域必须在 domains 中登记' });
  }
  for (const [id, domain] of Object.entries(cfg.domains)) {
    if (domain.personalAgentKey === domain.supervisorAgentKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['domains', id], message: '同一业务域的 Personal Agent 与主管 Agent 不得相同' });
    }
  }
});
export type RouterConfig = z.infer<typeof routerConfigSchema>;
export function defaultRouterConfig(): RouterConfig {
  return routerConfigSchema.parse({ schemaVersion: 1, mode: 'flat' });
}

const agentSchema = z.object({
  name: z.string(), mode: z.enum(['managed', 'manual']),
  use: z.enum(['codex', 'claude', 'command', 'acp']).default('command'),
  command: z.array(z.string()).optional(), access: z.enum(['read', 'edit']).default('edit'),
  enabled: z.boolean().default(true), model: z.string().optional(), effort: z.string().optional(),
  paperclipId: z.string().optional(),
});
export const configSchema = z.object({
  paperclipUrl: z.string().url().refine(u => ['localhost', '127.0.0.1'].includes(new URL(u).hostname), 'Local control plane required'),
  bridgePort: z.number().int().min(1024).max(65535).default(4180),
  companyId: z.string().optional(), projectId: z.string().optional(),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  checkout: z.string(), allowedPaths: z.array(z.string()).min(1),
  defaultAgent: z.string(), agents: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), agentSchema),
  assistant: z.object({ agentKey: z.string().default('workspace-assistant'), engine: z.enum(['codex', 'claude']).default('codex'),
    model: z.string().optional(), effort: z.string().optional(), projectId: z.string().optional(), enabled: z.boolean().default(true) }).optional(),
  feishu: z.object({ profile: z.string(), enabled: z.boolean().default(false), botId: z.string().default(''), appId: z.string().default(''),
    allowedSenders: z.array(z.string()).default([]), allowedChats: z.array(z.string()).default([]) }),
  pollMs: z.number().int().min(1000).default(15000),
  // v0.6 P0: the acceptance contract is available but opt-in until an
  // independent review model is wired in (P1). Turning this on without a
  // reviewer would block the originator's /accept with no way to pass.
  acceptance: z.object({
    sealPlanOnCreate: z.boolean().default(false),
    level: z.enum(['L1', 'L2', 'L3', 'L4']).default('L3'),
    reviewerModel: z.string().min(1).default('independent-reviewer'),
    // 'legacy' keeps the original originator-only /accept. 'independent'
    // turns on the FR-16~19 chain: seal plan on create, run an independent
    // (vision-capable) review before accept. Both are explicit configuration.
    mode: z.enum(['legacy', 'independent']).default('legacy'),
    visualReviewer: z.object({
      // 'structural' is deterministic and needs NO model service (it verifies
      // visual evidence binding, not semantic image content). 'model' wires an
      // OpenAI-compatible LOCAL endpoint when a vision model is available.
      mode: z.enum(['structural', 'model']).default('structural'),
      model: z.string().min(1).default('structural-vision-reviewer'),
      endpoint: z.string().url().optional(),
      timeoutMs: z.number().int().min(1000).max(60000).default(15000),
    }).default(() => ({ mode: 'structural' as const, model: 'structural-vision-reviewer', timeoutMs: 15000 })),
  }).optional(),
  // v0.6 runtime guard. Enforcement is ON by default now that the notification
  // gateway protects every human-required message: low-value / self-progress
  // outbox rows are suppressed, while ask / preview / accept / PR / grant
  // requests and anything waiting on a human are always delivered.
  runtimeGuard: z.object({
    enforce: z.boolean().default(true),
    protectHumanNotifications: z.boolean().default(true),
  }).default(() => ({ enforce: true, protectHumanNotifications: true })),
  // 设备端语义加权；Cognee 原生管线单列在 cogneeNative，两者互不替代。
  knowledge: z.object({
    semanticRecall: z.object({
      enabled: z.boolean().default(true),
      weight: z.number().min(0).max(1).default(0.45),
    }).default(() => ({ enabled: true, weight: 0.45 })),
    /**
     * Cognee 原生 LLM 实体抽取 / embedding / cognify（用户 2026-11-07 明确打开）。
     * 允许外部 OpenAI-compatible 模型 API：这里只存**环境变量名**，凭据与
     * 端点值只在进程环境里，绝不写进 .runtime/config.json 或仓库。
     * 业务材料会发往所配置的外部模型服务；未配置时明确报错，不静默降级成设备端能力。
     */
    cogneeNative: z.object({
      enabled: z.boolean().default(true),
      llm: z.object({
        baseUrlEnv: z.string().min(1).default('COGNEE_LLM_BASE_URL'),
        apiKeyEnv: z.string().min(1).default('COGNEE_LLM_API_KEY'),
        modelEnv: z.string().min(1).default('COGNEE_LLM_MODEL'),
        defaultModel: z.string().min(1).default('openai/gpt-4o-mini'),
      }).default(() => ({ baseUrlEnv: 'COGNEE_LLM_BASE_URL', apiKeyEnv: 'COGNEE_LLM_API_KEY',
        modelEnv: 'COGNEE_LLM_MODEL', defaultModel: 'openai/gpt-4o-mini' })),
      embedding: z.object({
        baseUrlEnv: z.string().min(1).default('COGNEE_EMBEDDING_BASE_URL'),
        apiKeyEnv: z.string().min(1).default('COGNEE_EMBEDDING_API_KEY'),
        modelEnv: z.string().min(1).default('COGNEE_EMBEDDING_MODEL'),
        defaultModel: z.string().min(1).default('openai/text-embedding-3-small'),
        dimensions: z.number().int().min(1).default(1536),
      }).default(() => ({ baseUrlEnv: 'COGNEE_EMBEDDING_BASE_URL', apiKeyEnv: 'COGNEE_EMBEDDING_API_KEY',
        modelEnv: 'COGNEE_EMBEDDING_MODEL', defaultModel: 'openai/text-embedding-3-small', dimensions: 1536 })),
    }).default(() => ({ enabled: true,
      llm: { baseUrlEnv: 'COGNEE_LLM_BASE_URL', apiKeyEnv: 'COGNEE_LLM_API_KEY', modelEnv: 'COGNEE_LLM_MODEL', defaultModel: 'openai/gpt-4o-mini' },
      embedding: { baseUrlEnv: 'COGNEE_EMBEDDING_BASE_URL', apiKeyEnv: 'COGNEE_EMBEDDING_API_KEY', modelEnv: 'COGNEE_EMBEDDING_MODEL', defaultModel: 'openai/text-embedding-3-small', dimensions: 1536 } })),
  }).default(() => ({ semanticRecall: { enabled: true, weight: 0.45 },
    cogneeNative: { enabled: true,
      llm: { baseUrlEnv: 'COGNEE_LLM_BASE_URL', apiKeyEnv: 'COGNEE_LLM_API_KEY', modelEnv: 'COGNEE_LLM_MODEL', defaultModel: 'openai/gpt-4o-mini' },
      embedding: { baseUrlEnv: 'COGNEE_EMBEDDING_BASE_URL', apiKeyEnv: 'COGNEE_EMBEDDING_API_KEY', modelEnv: 'COGNEE_EMBEDDING_MODEL', defaultModel: 'openai/text-embedding-3-small', dimensions: 1536 } } })),
  // L2 organisation-graph extraction. The default adapter is deterministic:
  // no model service is started and Cognee L1 stays read-only and isolated.
  orgExtraction: z.object({
    enabled: z.boolean().default(true),
    autoRunOnIndex: z.boolean().default(true),
    mode: z.enum(['deterministic', 'model']).default('deterministic'),
  }).default(() => ({ enabled: true, autoRunOnIndex: true, mode: 'deterministic' as const })),
  // 代码交付链路。国内环境默认用本机 Git 服务（git:// + 本机交付台），
  // 不依赖 github.com / gh CLI；保留 github 适配器供已有部署显式回退。
  delivery: z.object({
    provider: z.enum(['local', 'github']).default('local'),
    /** 本机交付台 HTTP 端口，只绑 127.0.0.1。 */
    port: z.number().int().min(1024).max(65535).default(4194),
    /** git daemon 端口，提供 clone / pull / push。 */
    gitPort: z.number().int().min(1024).max(65535).default(9418),
    repoName: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).default('suitme-collab'),
    /** 审批时是否自动给飞书 allowlist 本人发通知；默认关闭，避免未经确认的消息。 */
    feishuNotify: z.boolean().default(false),
    /**
     * 本机 Git 交付自动化（用户 2026-11-07 明确放开）：CI 通过 + 审批齐全后
     * 自动 fast-forward 合并到本机 main，并自动发布固定版本预览 / 制品。
     * 只作用于本机裸仓库与本机预览，不发布业务仓库、不触发云端 CI。
     * **业务验收仍必须由原发起人在原会话「确认验收」，红线不变。**
     */
    autoMerge: z.boolean().default(true),
    autoPublish: z.boolean().default(true),
  }).default(() => ({ provider: 'local' as const, port: 4194, gitPort: 9418,
    repoName: 'suitme-collab', feishuNotify: false, autoMerge: true, autoPublish: true })),
  /**
   * 宿主平台选择（v0.7 · 去 Paperclip 化第一步；第十六轮 C-1 扩展）。默认仍用
   * Paperclip，保证现有主链路不回退；`local` 走 LocalHostPlatform（本地文件 +
   * append-only journal），`local-pg` 走 PgHostPlatform（PostgreSQL 事务、并发
   * 领取、步进队列与状态外置）。用户 2026-11-07 明确「本机可以引入 pgsql 数据库
   * 去测试」，所以 PG 是真实可跑的后端，不是被排除的方案。
   * **DSN 只从 pgDsnEnv 指定的环境变量读取，凭据绝不写入 config.json / 仓库。**
   */
  host: z.object({
    provider: z.enum(['paperclip', 'local', 'local-pg']).default('paperclip'),
    pgDsnEnv: z.string().min(1).default('COLLAB_PG_DSN'),
  }).default(() => ({ provider: 'paperclip' as const, pgDsnEnv: 'COLLAB_PG_DSN' as const })),
  /** C-3：五个派活点统一经 Router；默认 flat（1 跳，行为与改造前一致）。 */
  router: routerConfigSchema.default(() => defaultRouterConfig()),
});
export type Config = z.infer<typeof configSchema>;
export type Agent = Config['agents'][string];
const stateRoot = process.env.COLLAB_STATE_DIR ?? path.join(root, '.runtime');
export const configPath = process.env.COLLAB_CONFIG ?? path.join(stateRoot, 'config.json');
export function loadConfig(): Config { return configSchema.parse(JSON.parse(readFileSync(configPath, 'utf8'))); }
export function secrets(): { adminToken: string; agentTokens: Record<string, string>; paperclipTokens?: Record<string, string>; workspacePluginToken?: string; jwtSecret: string } {
  return JSON.parse(readFileSync(path.join(stateRoot, 'secrets.json'), 'utf8'));
}
export const runtime = (...parts: string[]) => path.join(stateRoot, ...parts);
