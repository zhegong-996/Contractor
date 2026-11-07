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
| `src/server.ts` | **主服务**：`createServer`、workspace action 分发、`readOnly` 白名单、`service-status` / `routing-status` / `memory-replay` 等只读接口、服务组装与注入。 |
| `src/members.ts` | 成员身份解析、`gate()`、成员级 `reads` / `v06Reads` 白名单。**新增只读 action 必须同步 `server.ts` 与这里两处**。 |
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
| `src/knowledge.ts` | 知识的规范存储与修订历史，`reusable()`（要求 `state==='confirmed'`）。 |
| `src/graph.ts` | Cognee 子进程 RPC 封装、`CogneeL1Reader`、pin 的 commit。 |
| `src/ontology.ts` | 知识空间字典（GraphSchema/JSON Schema）与 `automaticExtraction` 状态。 |
| `src/semantic-recall.ts` | 设备端 Apple NL 词向量、混合召回、语义索引读写。 |
| `src/team-memory.ts` | 团队记忆索引、BM25 + 语义融合检索、检索时权限/版本重评；**B2** 在重评之后叠加投影召回为第三路信号。 |
| `src/knowledge-edges.ts` | L2 边状态（draft/accepted/reusable）、`invalidateEdges`、`buildContextPack`。 |
| `src/org-extraction.ts` | 从 L1 投影确定性抽取 L2 组织图（`modelCalls=0`），含 ModelExtractionAdapter 与 `buildTaskGraphMirror`。 |
| `src/org-ontology.ts` | 组织图 TBox 校验（常量已上移到 `architecture-contracts.ts`，此处再导出保持兼容）。 |
| `src/context.ts` | 任务上下文裁剪、InputRef、证据哈希。 |
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
| `src/assistant-runner.ts` / `src/runner.ts` / `src/native-worker.ts` | Autoloop worker 执行、回执恢复、原生 worker 装配。 |
| `src/assistant-tools.ts` | 任务绑定工具集暴露。 |
| `src/agent-services.ts` | 服务 Agent 职责与版本。 |
| `src/service-network.ts` | A2A 服务委派、Link 合同、`route/start/dispatch/rpc`。 |
| `src/coordination.ts` | Super Agent `policy.ts` 准入与范围判断、运行时工具白名单、事件订阅。 |
| `src/runtime-guard.ts` / `src/runtime-bridge.ts` | 注意力预算、干预、Watchdog 与真实执行链接线。 |
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

- **权威现状**：`docs/SYSTEM-ARCHITECTURE.md`、`docs/VALIDATION.md`、`docs/ADAPTATION-v0.6.md`（最新边界 `0.00000000000000` 节）。
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
