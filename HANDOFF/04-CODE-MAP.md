# 04 · 代码地图（按功能域）

> 逐文件一行说明见 `FILE-INVENTORY.md`。本文件讲「哪些文件一起完成什么」与依赖方向，改代码前先看这里。

## 1. 入口、配置与基础设施

| 文件 | 职责 |
|---|---|
| `src/config.ts` | 全项目配置 schema（zod）、`loadConfig()`、`secrets()`、`runtime()` 状态目录、`root`。新增配置项必须在这里加默认值并同步文档。 |
| `src/store.ts` | 本地 SQLite：任务投影、事件去重、outbox 通知、`audit()`。`Task` / `Delivery` 类型定义在此。 |
| `src/paperclip.ts` | Paperclip REST 薄封装（`get/post/patch/document`），带乐观修订号。 |
| `src/commands.ts` | 子进程命令执行封装。 |
| `src/client.ts` | 前端/CLI 调 Bridge 的 `api()`。 |
| `src/cli.ts` | 命令行入口。 |
| `src/mcp.ts` | stdio MCP 传输（有真实协议测试 `tests/mcp.test.ts`）。 |
| `src/platform-evidence.ts` | 平台指纹与测试证据，防止「换机器仍假装验证过」。 |

## 2. Bridge 与权限（改 action 必读）

| 文件 | 职责 |
|---|---|
| `src/server.ts` | **主服务**：`createServer`、workspace action 分发、`readOnly` 白名单、`service-status` / `routing-status` / `memory-replay` 等只读接口、服务组装与注入；P-13 起含知识分区写通道（判定走 `knowledge-authz.ts`）。 |
| `src/members.ts` | 成员身份解析、`gate()`、成员级 `reads` / `v06Reads` 白名单。**新增只读 action 必须同步 `server.ts` 与这里两处**。 |
| `src/rbac.ts` | **P-12**：casbin RBAC 统一封装（Apache-2.0 上游引擎）。`initRbac()` 幂等加载策略文件（缺省从 `ROLE_PERMISSIONS` 种子生成）、`rbacEnforce()` 同步 fail-closed、`ensureHumanBound()` 跨进程绑定自愈；人四档走 `g` 绑定，agent 三档按档位直判。bridge 与 console 两进程共用 `.runtime/console/rbac_policy.csv`。 |
| `src/console-auth.ts` | **P-11/P-12**：控制台账号（PBKDF2 口令、HttpOnly 会话）、用户级配置 `ConsoleUserSettings`（本人读写 / 管理员总览打码）、审计日志；casbin 逻辑委托 `rbac.ts`。 |
| `src/knowledge-authz.ts` | **P-13**：知识分区权限判定。`canCreateKnowledge` / `canWriteKnowledge`（personal 仅归属者 / team 运营+ / org 管理员+，agent 按 `scopeCovers` + 档位）；**③c 起** `canReadKnowledge` 读分区（personal 仅归属者本人 + admin 档，console 代理按真实登录用户判定）。 |
| `src/knowledge-representation.ts` | **③c**：wiki 投影与注入索引落盘。`knowledgeToWikiPages`（同 domain 互链、claimEventIds=evidenceEventIds、withdrawn 不进地图）、`toTranscriptEvents`（撤权类标 revoked）、`writeWikiProjection` / `readWikiProjection` / `writeInjectedIndex` / `readInjectedIndex`（`.runtime/memory/`，0600）、`knowledgeWikiView` 体检（listLenient + skippedDocuments 如实计数）。**wiki 是投影不是第二事实源**，canonical 仍在任务文档、可随时重建。 |
| `plugins/knowledge-workspaces/src/worker.ts` | 插件 worker：只做 action 转发，携带宿主不可变 `actor`（UI 不能指定操作人）。 |
| `plugins/knowledge-workspaces/src/action-name.ts` | action 名 → URL 路径段映射。 |
| `plugins/knowledge-workspaces/src/manifest.ts` | 插件清单与 SDK 入口声明。 |
| `src/feishu-sources.ts` | 飞书证据引用与 `withFeishuReads()`（只读请求包装）。 |

## 3. 业务编排

| 文件 | 职责 |
|---|---|
| `src/controller.ts` | 任务生命周期：`ingest` / `createTask` / `reply` / `handoff` / `receipt` / `publish` / `accept` / `confirmAcceptance` / `runIndependentReview`。**验收红线实现处**。 |
| `src/workspaces.ts` | 知识空间、来源、访问申请与授权、快照、撤权、协作任务创建。**最大业务文件（735 行）**。 |
| `src/v06.ts` | v0.6 功能编排门面：职能注册表、Transfer、Grant、边状态、Context Pack、L2 抽取、组织信号、验收视图（736 行）。 |
| `src/v06-store.ts` | v0.6 存储边界（`RuntimeV06Store` / `MemoryV06Store`）。 |
| `src/collaboration-intake.ts` | 协作任务入口，复用 Super Agent 事件归一化。 |
| `src/development.ts` | 开发/交付视图的业务封装。 |
| `src/user-language.ts` | 中文用户指令解析与 `USER_HELP`（7 条指令）。 |
| `src/channels.ts` | 语义对象统一降级渲染（`renderForChannel`），IM 文本 + 工作台链接 + 可选卡片。 |

## 4. 验收链（红线所在）

| 文件 | 职责 |
|---|---|
| `src/acceptance-plan.ts` | 开工前锁定验收清单（`planForTask` / `lockPlan` / `readPlan`）。 |
| `src/acceptance-round.ts` | 独立逐项判定、证据闸门 `verifyAcceptanceGate`、报告写入。 |
| `src/acceptance-interop.ts` | 只读对接 `lobehub/acceptance` 的报告格式契约（不跑其 CLI）。 |
| `src/acceptance-report.ts` | 本机中文验收报告索引、HTML 渲染、成果总览页 `OverviewService`。 |
| `src/independent-review.ts` | 可插拔独立评审者与能力校验（不得是产出模型）。 |
| `src/visual-review.ts` | 视觉评审适配器、结构式 / 本机模型两档、`acceptanceChainEnabled`。 |
| `src/vision-semantics.ts` | 本机 Apple Vision 语义判定。 |
| `src/trace-bridge.ts` | 验收证据 Trace 与成本账本（best-effort，失败不改业务结果）。 |
| `src/event-stream.ts` | `CollabEvent` 契约与各来源 normalizer（`fromAssistantTurn` / `fromWorkerJournal` / `fromDelivery` / `capture`）。 |

## 5. 知识与共享记忆

| 文件 | 职责 |
|---|---|
| `src/knowledge.ts` | 知识的规范存储与修订历史，`reusable()`（要求 `state==='confirmed'`）。**③c 起**：propose/revise 服务端自动追加 `fact-extracted` 证据锚点（idempotencyKey 防重）、`evidenceEventIds` 悬空即抛错拒绝（向后兼容旧文档）、review 的 `inject` 选项是人审确认的唯一提升路径（revise 恒重置 false）、`listLenient()` 宽松列举（坏行跳过计数）。 |
| `src/dreaming.ts` | **③c**：离线整理（Dreaming）——`dreamFromKnowledge` 从知识记录产纯函数建议（不模型判 salience），`registerDreamProposals` 焊红线断言后按 candidateId 查重登记进 `EvolutionService` 既有 C-6 闸门（工程回放 / 人审 / 灰度），复跑幂等。 |
| `src/graph.ts` | Cognee 子进程 RPC 封装、`CogneeL1Reader`、pin 的 commit。 |
| `src/ontology.ts` | 知识空间字典（GraphSchema/JSON Schema）与 `automaticExtraction` 状态。 |
| `src/semantic-recall.ts` | 设备端 Apple NL 词向量、混合召回、语义索引读写。 |
| `src/team-memory.ts` | 团队记忆索引、BM25 + 语义融合检索、检索时权限/版本重评；**B2** 在重评之后叠加投影召回为第三路信号。 |
| `src/knowledge-edges.ts` | L2 边状态（draft/accepted/reusable）、`invalidateEdges`、`buildContextPack`。 |
| `src/org-extraction.ts` | 从 L1 投影确定性抽取 L2 组织图（`modelCalls=0`），含 ModelExtractionAdapter 与 `buildTaskGraphMirror`。 |
| `src/org-ontology.ts` | 组织图 TBox 校验（常量已上移到 `architecture-contracts.ts`，此处再导出保持兼容）。 |
| `src/context.ts` | 任务上下文裁剪、InputRef、证据哈希。**③c 起** collect() 的 layers 加 `injectedIndex` 持久指针层（只有 id/title/pointer，不占 192KB Context Pack 预算；manifest 不加新 kind，不动快照校验契约）。 |
| `src/context-grant.ts` | 跨空间 Context Grant（申请/批准/拒绝/撤销/分离审批）。 |
| `src/evidence.ts` | 证据引用校验（含用户授权的原型移植）。 |
| **`src/memory-log.ts`** | **B1**：append-only 共享记忆事件主干、幂等、桥接 `routing-decided`。 |
| **`src/memory-projections.ts`** | **B1/B2**：四类投影纯函数重放、撤权 lineage、稳定 checksum、`recallMemory`（按 principal 精确过滤）、`assertDeterministic`、`ProjectionState` 可续算。 |
| **`src/memory-recall.ts`** | **B2**：`projectionRecall` 重放主干、`projectRecallHits` 按 `sourceId@revision` 白名单裁剪、`fuseProjectionHits` 三路融合；读日志失败 advisory 降级。 |
| **`src/memory-checkpoint.ts`** | **B2**：checkpoint 读写与增量应用；撤权 / 乱序 / 失效祖先 / 已撤回来源回退全量，与全量 checksum 对照。 |
| `src/memory-contract.ts` | 早期 `memoryAnnotation` schema（概念/关系候选，与 B1 主干不是同一层）。 |

B2 的只读 / 真跑入口：`scripts/memory-replay.ts`、`scripts/memory-smoke.ts`（B1）、`scripts/memory-checkpoint.ts`、`scripts/memory-journey.ts`（**会写真实日志**）。接线硬约束：投影永远不是权限来源，只在 `reusable()` / `allowed()` / hash 版本重评之后消费。

## 6. Agent 运行时与上游装配

| 文件 | 职责 |
|---|---|
| `src/upstream.ts` | 上游动态 import 边界（Super Agent 触发/channel、Autoloop contract/agents、Harness session-reference）。 |
| `src/harness-composition.ts` | esbuild 打包 DeepSeek Harness 13 模块，`compileAgent` / `executeComposedTool`。 |
| `src/agent-definition.ts` | 能力目录与技能目录。 |
| `src/assistant.ts` | 事务整理 Agent：任务上下文编译、委托、job 生命周期。 |
| `src/assistant-turn.ts` | 一轮模型调用编排与中文业务 prompt（40 行）、CLI 适配。 |
| `src/assistant-runner.ts` / `src/runner.ts` / `src/native-worker.ts` | Autoloop worker 执行、回执恢复、原生 worker 装配；P-1 起无常驻 `while`，按 `config.execution.mode` 分派 legacy / stepped 泵。 |
| `src/step-runner.ts` | `npm run step:once` 一次进程一步；P-11 起执行「续跑闸」（从台账重新验证回答后放行接续步）。 |
| `src/step-execution.ts` | **P-1/P-6**：`StepQueue` 契约 + `InMemoryStepQueue` / `PgStepQueue` 适配器 + `executeOneStep()` / 泵。**③d ⑧⑨ 起**：`markOutwardAction`（对外动作发生时登记，接口必选）、`lineageOf`（血缘查询，可选）、ClaimedStep 带 `parentStepId` / `generation` / `outwardActions`、RecoveredStep 带 `status: 'ready' \| 'interrupted'`；`failStep` 对已对外动作的步同样标 interrupted 不自动重跑。 |
| `src/pg-host.ts` | **C-1**：PG 宿主（事务 / ACL / 成本账本 / heartbeat / `SKIP LOCKED` 步进队列）。**③d ⑧⑨ 起** steps 表新增 `parent_step_id` / `generation` / `outward_actions` 三列（幂等迁移），`claimStep` 每次领取 generation+1、`recoverStaleSteps` 区分 interrupted（携带已发动作清单）/ ready、`lineageOf` 用递归 CTE（深度封顶 32）、`markOutwardAction` 幂等去重并写 journal `STEP-OUTWARD`。 |
| `src/auto-resume.ts` | **P-11**：回答后自动续跑闸——`AUTO_RESUME_MANDATE` 逐字入库；闸执行时从成对台账重新验证回答才放行 `resume_next`。 |
| `src/assistant-tools.ts` | 任务绑定工具集暴露。 |
| `src/agent-services.ts` | 服务 Agent 职责与版本。 |
| `src/service-network.ts` | A2A 服务委派、Link 合同、`route/start/dispatch/rpc`。 |
| `src/coordination.ts` | Super Agent `policy.ts` 准入与范围判断、运行时工具白名单、事件订阅。 |
| `src/runtime-guard.ts` / `src/runtime-bridge.ts` | 注意力预算、干预、Watchdog 与真实执行链接线。**③d 起** `runtime-bridge.gateNotification` 的 mustDeliver 分支接 `escalation.ts` 升级闸（去重 / 限速 / 静音留痕 `v06.escalation-muted`）。 |
| `src/skill-pack.ts` | **③d ⑦**：Skill 能力包最小版——SKILL.md frontmatter 键白名单、manifest（version x.y.z / triggerTerms / `defaultEnabled` 恒 false）、sha256 内容校验、`enableSkill` 绑定内容哈希（篡改即失效需重开）、`skillIntact` 开启态完整性判据。 |
| `src/escalation.ts` | **③d ⑩**：升级闸纯函数——同 (taskId, topic) 窗口去重、1 小时 3 条限速、首个新问题必达、文案恒「不代为批准」（恒 advisory，绝不代批）。 |
| `src/team-pack.ts` | **③d ⑪**：团队包审查——权限/凭据/模型三类 17 键黑名单 + zod 键白名单 + 6 类密钥二次扫描（sk- / Bearer / ghp_ / 私钥块 / DSN 等）；`importTeamPack` 只产候选引用不提权，unknownAgents 如实标出。 |
| `src/model-settings.ts` | 模型三档预备策略（不存 Key）。 |
| `src/roles.ts` / `src/transfer.ts` / `src/workspace-policy.ts` / `src/organization-signals.ts` | 职能注册表、责任转移、空间策略、组织信号。 |
| `src/feishu-org.ts` | 飞书组织映射草案、scope 缺失报告、owner 决策、`orgAuthCommand`。 |

## 7. 统一路由契约（A / B1 地基）

| 文件 | 职责 |
|---|---|
| `src/architecture-contracts.ts` | **唯一常量来源**：16 类节点 / 5 边族 / ontology 三层 / Agent 角色 / 运行时来源 / 记忆投影 / `memoryEventSchema`。 |
| `src/routing-decision.ts` | `RoutingDecision` 五维契约、人签红线、`toMemoryEvent()`。 |
| `src/routing-trace.ts` | 5 派活点共用单例 Trace、append-only JSONL、重放投影、测试隔离。 |
| `src/three-tier-assessment.ts` | 用真实 Trace 判断要不要引入 LobeHub 三层（当前 `false`）。 |
| `src/platform-port.ts` | `HostPlatformPort` + `PaperclipPlatform`（默认）+ `LocalHostPlatform`。 |

## 8. 代码交付

| 文件 | 职责 |
|---|---|
| `src/github.ts` | `DeliveryAdapter` 接口 + GitHub 适配器（显式回退）+ 路径校验、PR URL 解析。 |
| `src/local-git.ts` | 本机 Git 交付：裸仓库、worktree、push、本机 CI、自动合并、固定版本预览、审批与通知。 |
| `scripts/delivery-server.ts` | 4194 中文交付台 HTTP + git daemon（当前停机）。 |
| `scripts/delivery-demo.ts` | 端到端真跑冒烟。 |

## 9. 国内适配与中文壳

| 文件 | 职责 |
|---|---|
| `src/shell-locale.ts` + `locales/shell.zh-CN.json` | 构建期 Babel AST 只换展示文案的中文壳词典。 |
| `src/shell-domestic.ts` | 构建期收敛 4 侧栏入口 + 运行时隐藏未连接海外卡片（含 `protectedEl` / `repair` 自愈）。 |
| `src/service-status.ts` | 「国内服务」唯一数据源：并发 loopback 探测 + 状态来源 + 接通步骤，未接通不带 `url`。 |
| `scripts/build-chinese-shell.ts` | 构建顺序「先 domestic 再 chinese」，构建前恢复 `sw.js` 占位符。 |
| `scripts/install-upstream.ts` / `scripts/install-wiki.ts` / `scripts/install-workspace-plugin.ts` | 上游 UI / Wiki / 插件安装与 esbuild 打包。 |
| `console/`（P-12 重写） | **Vue 3 + Element Plus 独立控制台**：`index.html`（挂载点 + 本地 vendor 引用）、`app.js`（登录门 / 六业务视图 / 管理视图按权限分区）、`styles.css`、`vendor/`（vue.global.prod.js、element-plus.* 全套本地文件，离线可用）；`DOMESTIC_TERMS` / `clean()` 品牌词清洗在此。 |
| `scripts/console-server.ts` | 控制台承载服务：回环 + 登录制（HttpOnly cookie）+ `CONSOLE_READ_ACTIONS` 白名单 + `KNOWLEDGE_WRITE_ACTIONS`（带 `actorUser` 转发）+ `ADMIN_ACTIONS`（casbin 权限映射）+ 静态 vendor 分发与安全头。 |
| `scripts/console-smoke.mjs` | 真实浏览器冒烟（49 项：登录 / RBAC 边界 / 知识分区正负例 / 视图 / 主题 / 425px / 产品词）。 |
| `scripts/services.ts` | **P-11**：4190 / 4192 / 4194(+9418) 辅助服务统一纳管（PID 归属校验 + 健康检查 + start/stop/restart），管理后台「服务管理」复用。 |
| `scripts/delegated-accept.ts` | **P-11**：授权代办「确认验收」（`npm run delegated:accept`），回执如实留痕 `executedBy='agent-under-delegation'`。 |

## 10. 前端分层（第十轮重构后）

`plugins/knowledge-workspaces/src/ui/`：`index.tsx`（5 行 SDK 入口）→ `workspace-page.tsx`（页面壳、5 tab、轮询）→ `task-detail.tsx` / `spaces.tsx` / `settings.tsx` / `forms.tsx` / `domestic-services.tsx` / `v06-panels.tsx` / `agent-services.tsx` / `agent-builder.tsx` / `knowledge-graph.tsx` / `collaboration-network.tsx` / `development.tsx`（视图）→ `foundation.tsx`（原语/文案/UI 契约/URL 白名单）与 `async.ts`（`useRead` / `useActionFeedback`）；`styles.ts` 是真实样式，`cognee-dynamic.tsx` + `cognee-modules.d.ts` 处理 Cognee 组件的 client-only 边界。

依赖单向由 `tests/frontend-structure.test.ts` 守卫。

## 11. 脚本与 CLI（`scripts/`）

- **启动/安装**：`up.ts`（服务启动停止与 PID 归属校验）、`setup.ts`、`setup-graph.ts`、`setup-workspaces.ts`、`setup-assistant.ts`、`setup-team-pilot.ts`、`install-upstream.ts`、`install-wiki.ts`、`install-workspace-plugin.ts`、`pair-feishu.ts`、`paperclip.ts`。
- **构建/验证**：`test.ts`（测试 runner + 测试隔离 env）、`doctor.ts`、`audit-upstream.ts`、`responsive-audit.ts`、`workbench-walkthrough.mjs`（真实浏览器 11 步走查）、`build-chinese-shell.ts`。
- **组织映射**：`org-auth.ts`、`org-mapping.ts`、`org-table.ts`。
- **Cognee / 视觉**：`cognee-graph.py`、`cognee-recall.py`、`cognee-native.py`、`cognee-native.ts`、`apple-embedding.swift`、`apple-vision.swift`、`vision-server.ts`。
- **验收/交付**：`acceptance-report.ts`、`export-acceptance.ts`、`delivery-server.ts`、`delivery-demo.ts`。
- **A/B1 只读与冒烟**：`routing-status.ts`、`host-smoke.ts`、`memory-replay.ts`、`memory-smoke.ts`。
- **试点与冒烟**：`run-team-pilot.ts`、`seed-team-pilot.ts`、`verify-team-pilot.ts`、`smoke-*.ts`、`migrate-workspace-contracts.ts`。

## 12. 测试（`tests/`，55 个文件）

按域划分：验收（`acceptance-*` / `confirm-acceptance` / `event-stream` / `trace-bridge` / `visual-review` / `independent`）、知识与记忆（`knowledge*` / `graph` / `l2-extraction` / `team-memory` / `memory-replay` / `cognee-native`）、组织与责任（`roles` / `transfer` / `policy-signals` / `feishu-org` / `v06-*`）、Agent 运行时（`assistant` / `autonomous-worker` / `harness-composition` / `mcp` / `service-network`）、前端与适配（`frontend-structure` / `shell-domestic` / `shell-locale` / `responsive-layout` / `service-status` / `workspace-action`）、交付（`local-delivery` / `delivery` / `artifact-preview`）、契约与基础设施（`contracts` / `architecture-contracts` / `routing-decision` / `platform-evidence` / `paperclip` / `user-language` / `channels` / `coordination` / `context*`）。

**新增源码静态断言时注意**：项目有多处读源码字符串做守门，改动文件结构时要同步更新这些测试（第十轮曾专门把「绑死 `index.tsx`」的断言改成按模块/目录读取）。

## 13. 文档与合规（`docs/`、根目录）

- **权威现状**：`docs/SYSTEM-ARCHITECTURE.md`、`docs/VALIDATION.md`、`docs/ADAPTATION-v0.6.md`（最新边界 `0.0000000000000000000000000000` 节，第二十七轮 P-9）。
- **产品定稿**：`docs/ARCHITECTURE-v0.6.md`（设计，不等于实现）、`docs/PRD-v0.6.md`、`PRODUCT.md`、`DESIGN.md`。
- **v0.7 方案**：`docs/ARCHITECTURE-OPTIONS-v0.7.md`、`docs/ROUTING-AND-HOST-v0.7.md`、`docs/MEMORY-ARCHITECTURE-v0.7.md`。
- **上游与合规**：`docs/UPSTREAM-ADAPTERS.md`、`docs/SOURCES.md`、`docs/OPEN-SOURCE-COMPLIANCE.md`、`THIRD_PARTY_NOTICES.md`、`licenses/`、`sources.lock.json`、`.gitmodules`。
- **专题**：`docs/AGENT-SERVICE-NETWORK.md`、`docs/AUTONOMOUS-COLLABORATION.md`、`docs/KNOWLEDGE-ENGINE.md`、`docs/KNOWLEDGE-AND-ACCESS.md`、`docs/TEAM-NETWORK-MEMORY.md`、`docs/WORKSPACES.md`、`docs/ASSISTANT-CONTEXT.md`、`docs/AGENT-BUILDING.md`、`docs/FEISHU-SOURCES.md`、`docs/agent-integration.md`。
- **给 Agent 的规则**：`AGENTS.md`；交接包：`HANDOFF/`。

## 14. 依赖方向速查

```
architecture-contracts.ts（零 IO，最底层）
  ├── routing-decision.ts ──> routing-trace.ts ──> three-tier-assessment.ts
  ├── memory-log.ts ──> memory-projections.ts（纯函数，零 IO）
  │     ├── memory-recall.ts ──> team-memory.ts（第三路召回信号）
  │     └── memory-checkpoint.ts（增量应用 / 回退全量）
  └── org-ontology.ts / ontology.ts / org-extraction.ts
config.ts / store.ts / paperclip.ts
  └── server.ts（组装一切）──> controller / workspaces / v06 / team-memory / service-network
        └── Action → plugins/worker.ts → 前端 UI
```

**循环依赖红线**：`memory-projections.ts` 刻意不导入 `memory-log.ts`（本地定义 `sourceKey`），保证重放可在任意环境纯函数执行；`memory-log.ts` 可导入 `routing-trace.ts`，反向不成立。
