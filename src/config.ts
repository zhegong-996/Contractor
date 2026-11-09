import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { agentRegistrySchema, defaultAgentRegistry } from './agent-registry.ts';
import { schedulerConfigSchema, defaultSchedulerConfig } from './scheduler.ts';
import { inboxConfigSchema, defaultInboxConfig } from './event-inbox.ts';
import { githubWatchConfigSchema, defaultGithubWatchConfig } from './github-watch.ts';
import { dingtalkConfigSchema, defaultDingtalkConfig, wecomConfigSchema, defaultWecomConfig } from './im-outbound.ts';

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

// 生产项 P-1 · 长程执行形态。层是配置，不是产品骨架：第三十二轮起默认 step
//（状态外置 PG 队列，进程不持有跨步状态，崩溃可接棒）；step 要求 host.provider
// 必须是 local-pg——没有状态外置队列就不叫「循环与状态分离」，配置层直接拒绝，
// 避免用户以为切了开关就已经单步化。回退路径：显式配 mode=loop 即恢复改造前
// 常驻循环（逐字等价）。
export const EXECUTION_MODES = ['loop', 'step'] as const;
export const executionConfigSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(EXECUTION_MODES).default('step'),
  /**
   * 一个 run 最多领多少步，防止队列被失控循环写满。
   * 第二十九轮 P-11：真实业务单（tick 级单步 + 1s 间隔）暴露 60 步上限过低，
   * 上限提高到 20000；真实业务建议 7200（≈2 小时 @1s/步）。
   */
  maxStepsPerRun: z.number().int().min(1).max(20000).default(60),
  /** running 超过该秒数视为崩溃，回收为 ready 且旧 runToken 作废。 */
  staleSeconds: z.number().int().min(1).max(3600).default(60),
}).strict();
export type ExecutionConfig = z.infer<typeof executionConfigSchema>;
export function defaultExecutionConfig(): ExecutionConfig {
  return executionConfigSchema.parse({ schemaVersion: 1, mode: 'step' });
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
     * 允许外部 OpenAI-compatible 模型 API：这里只存**环境变量名**，凭据值优先走
     * 进程环境；`.runtime/cognee-env.json`（gitignored、0600）作为本机持久化兜底，
     * 由 server / CLI 启动时装载，绝不写进 .runtime/config.json 或仓库。
     * 用户 2026-11-08 拍板：LLM 走外部 DeepSeek v4 flash，embedding 走本机
     * fastembed（pinned Cognee venv 自带，无需端点与凭据）——provider 默认
     * 'fastembed'；显式配 'custom' 时恢复「外部 OpenAI-compatible embedding 端点」
     * 的旧口径（endpoint/key 缺失仍会列进 missing）。
     * 用户 2026-11-08 晚间拍板（费用可接受）：图谱投影成功后自动把该来源正文
     * cognify 进原生管线（autoCognify，默认开；关闭即回到纯手动 CLI 形态）。
     */
    cogneeNative: z.object({
      enabled: z.boolean().default(true),
      /** 图谱投影（project=true）成功后自动 cognify 该来源正文（用户拍板费用可接受）。 */
      autoCognify: z.boolean().default(true),
      /** 自动 cognify 与「知识检索」UI 共用的数据集名。 */
      dataset: z.string().min(1).default('suitme-knowledge'),
      llm: z.object({
        baseUrlEnv: z.string().min(1).default('COGNEE_LLM_BASE_URL'),
        apiKeyEnv: z.string().min(1).default('COGNEE_LLM_API_KEY'),
        modelEnv: z.string().min(1).default('COGNEE_LLM_MODEL'),
        defaultModel: z.string().min(1).default('openai/gpt-4o-mini'),
      }).default(() => ({ baseUrlEnv: 'COGNEE_LLM_BASE_URL', apiKeyEnv: 'COGNEE_LLM_API_KEY',
        modelEnv: 'COGNEE_LLM_MODEL', defaultModel: 'openai/gpt-4o-mini' })),
      embedding: z.object({
        /** 'fastembed' = 本机 CPU 模型（无端点无凭据）；'custom' = 外部 OpenAI-compatible 端点。 */
        provider: z.enum(['custom', 'fastembed']).default('fastembed'),
        baseUrlEnv: z.string().min(1).default('COGNEE_EMBEDDING_BASE_URL'),
        apiKeyEnv: z.string().min(1).default('COGNEE_EMBEDDING_API_KEY'),
        modelEnv: z.string().min(1).default('COGNEE_EMBEDDING_MODEL'),
        defaultModel: z.string().min(1).default('openai/text-embedding-3-small'),
        dimensions: z.number().int().min(1).default(1536),
        /** provider='fastembed' 时的本机模型与维度（jina v2 base zh：中英双语，768 维）。 */
        fastembedModel: z.string().min(1).default('jinaai/jina-embeddings-v2-base-zh'),
        fastembedDimensions: z.number().int().min(1).default(768),
      }).default(() => ({ provider: 'fastembed' as const, baseUrlEnv: 'COGNEE_EMBEDDING_BASE_URL', apiKeyEnv: 'COGNEE_EMBEDDING_API_KEY',
        modelEnv: 'COGNEE_EMBEDDING_MODEL', defaultModel: 'openai/text-embedding-3-small', dimensions: 1536,
        fastembedModel: 'jinaai/jina-embeddings-v2-base-zh', fastembedDimensions: 768 })),
    }).default(() => ({ enabled: true, autoCognify: true, dataset: 'suitme-knowledge',
      llm: { baseUrlEnv: 'COGNEE_LLM_BASE_URL', apiKeyEnv: 'COGNEE_LLM_API_KEY', modelEnv: 'COGNEE_LLM_MODEL', defaultModel: 'openai/gpt-4o-mini' },
      embedding: { provider: 'fastembed' as const, baseUrlEnv: 'COGNEE_EMBEDDING_BASE_URL', apiKeyEnv: 'COGNEE_EMBEDDING_API_KEY', modelEnv: 'COGNEE_EMBEDDING_MODEL', defaultModel: 'openai/text-embedding-3-small', dimensions: 1536, fastembedModel: 'jinaai/jina-embeddings-v2-base-zh', fastembedDimensions: 768 } })),
  }).default(() => ({ semanticRecall: { enabled: true, weight: 0.45 },
    cogneeNative: { enabled: true, autoCognify: true, dataset: 'suitme-knowledge',
      llm: { baseUrlEnv: 'COGNEE_LLM_BASE_URL', apiKeyEnv: 'COGNEE_LLM_API_KEY', modelEnv: 'COGNEE_LLM_MODEL', defaultModel: 'openai/gpt-4o-mini' },
      embedding: { provider: 'fastembed' as const, baseUrlEnv: 'COGNEE_EMBEDDING_BASE_URL', apiKeyEnv: 'COGNEE_EMBEDDING_API_KEY', modelEnv: 'COGNEE_EMBEDDING_MODEL', defaultModel: 'openai/text-embedding-3-small', dimensions: 1536, fastembedModel: 'jinaai/jina-embeddings-v2-base-zh', fastembedDimensions: 768 } } })),
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
   * 宿主平台选择（v0.7 · 去 Paperclip 化第一步；第十六轮 C-1 扩展）。第三十二轮起
   * 默认 `local-pg`：PgHostPlatform（PostgreSQL 事务、并发领取、步进队列与状态外置）
   * 已经过 host:pg 24/24 与真实业务单验证，成为默认底座。`paperclip` 保持完整支持
   * （显式配置即回退），`local` 走 LocalHostPlatform（本地文件 + append-only journal）。
   * 用户 2026-11-07 明确「本机可以引入 pgsql 数据库去测试」，2026-11-08 拍板切默认。
   * **DSN 只从 pgDsnEnv 指定的环境变量读取，凭据绝不写入 config.json / 仓库；**
   * 未设置时回退本机回环无密码默认 DSN（仅限 127.0.0.1）。
   */
  host: z.object({
    provider: z.enum(['paperclip', 'local', 'local-pg']).default('local-pg'),
    pgDsnEnv: z.string().min(1).default('COLLAB_PG_DSN'),
  }).default(() => ({ provider: 'local-pg' as const, pgDsnEnv: 'COLLAB_PG_DSN' as const })),
  /** C-3：五个派活点统一经 Router；默认 flat（1 跳，行为与改造前一致）。 */
  router: routerConfigSchema.default(() => defaultRouterConfig()),
  /**
   * C-4：组织级 Agent 实例 + 职责绑定 + 生效范围 + 版本。组织级唯一，项目只引用不覆写。
   * 默认**空注册表**——扁平小团队不硬造管理层；配置显示在岗 Agent 后，Router 才校验
   * 主管是否在岗 / 职责是否匹配 / 范围是否覆盖 / 版本是否一致。
   * 与既有 `agents`（执行引擎配置）、`agent-services.ts`（运行时服务目录）互不覆写。
   */
  agentRegistry: agentRegistrySchema.default(() => defaultAgentRegistry()),
  /**
   * C-6：沉淀回流与自演进。交付前自查闸门默认强制（有沉淀标准时必须逐条比对）；
   * 关闭只影响「是否比对」，不影响最终仍由原发起人确认验收这条红线。
   * 「候选改进必须真人批准」与「不得改写清单 / 权限 / 人签 / 历史任务」是硬编码
   * 红线，不提供配置项——避免一次误配置让 Agent 自己把改进改生效。
   */
  evolution: z.object({
    selfCheckGate: z.object({ enabled: z.boolean().default(true) })
      .default(() => ({ enabled: true as const })),
    canaryPercent: z.number().int().min(1).max(100).default(20),
  }).default(() => ({ selfCheckGate: { enabled: true as const }, canaryPercent: 20 })),
  /**
   * 第三十六轮 · 自动化四件套（用户 2026-11-09 拍板「这几个也都要做」，放宽
   * 「飞书唯一发起入口」的旧边界；验收 / 核可 / 放行红线不放宽）：
   *   - scheduler：定时调度器（例行任务）+ 定时唤醒复查（wakes）；
   *   - githubWatch：GitHub 仓库事件监听（轮询 + 可选 webhook），只产生任务；
   *   - dingtalk / wecom：钉钉 / 企业微信补充送达通道（出站 webhook 立即可用，
   *     入站端点需公网回调；凭据一律走环境变量，绝不进 config / 仓库）。
   */
  scheduler: schedulerConfigSchema.default(() => defaultSchedulerConfig()),
  /**
   * 第三十八轮 · 通用入站事件源（GitLab / 任意系统 POST 一条 JSON）。
   * 只收事实进收件箱，要不要开工单由 scheduler 的 `when` 规则决定；每个来源
   * 一把独立密钥（环境变量名写在这里，值不进仓库）。默认关闭。
   */
  eventInbox: inboxConfigSchema.default(() => defaultInboxConfig()),
  /**
   * 第三十八轮 · 独立审码阶段的闸门。默认开启：block 级问题（密钥、环境文件）
   * 拦住预览部署；关掉则降级为「记录但不拦」，并在报告里写明没拦。
   */
  codeReview: z.object({ enforce: z.boolean().default(true) }).default(() => ({ enforce: true as const })),

  githubWatch: githubWatchConfigSchema.default(() => defaultGithubWatchConfig()),
  dingtalk: dingtalkConfigSchema.default(() => defaultDingtalkConfig()),
  wecom: wecomConfigSchema.default(() => defaultWecomConfig()),
  /**
   * P-1：长程执行形态。第三十二轮起默认 step（状态外置、崩溃可接棒）；step 要求
   * host.provider 必须是 local-pg（真实状态外置队列），否则 superRefine 拒绝启动。
   * 回退：显式配 mode=loop 恢复改造前常驻循环（逐字等价）。
   */
  execution: executionConfigSchema.default(() => defaultExecutionConfig()),
}).superRefine((cfg, ctx) => {
  if (cfg.execution.mode === 'step' && cfg.host.provider !== 'local-pg') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['execution', 'mode'],
      message: '单步执行要求 host.provider=local-pg：没有状态外置队列就不能把循环与会话状态分开' });
  }
});
export type Config = z.infer<typeof configSchema>;
export type Agent = Config['agents'][string];
const stateRoot = process.env.COLLAB_STATE_DIR ?? path.join(root, '.runtime');
export const configPath = process.env.COLLAB_CONFIG ?? path.join(stateRoot, 'config.json');
export function loadConfig(): Config { return configSchema.parse(JSON.parse(readFileSync(configPath, 'utf8'))); }
export function secrets(): { adminToken: string; agentTokens: Record<string, string>; paperclipTokens?: Record<string, string>; workspacePluginToken?: string; boardToken?: string; authSecret?: string; jwtSecret: string } {
  return JSON.parse(readFileSync(path.join(stateRoot, 'secrets.json'), 'utf8'));
}
export const runtime = (...parts: string[]) => path.join(stateRoot, ...parts);
