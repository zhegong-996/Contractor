# FILE-INVENTORY · 逐文件说明（100% 覆盖）

> 生成自 `git ls-files` + `HANDOFF/`，第二十二轮 P-1 收尾后共 **297** 个条目，2026-11-08 交接总结新增根目录 2 个文件后共 **299** 个条目，第二十三轮 P-5 新增 2 个文件后共 **301** 个条目，第二十四轮 P-6 新增 7 个文件后共 **308** 个条目，OpenMausBot 参考评估新增 1 份文档后共 **309** 个条目（第十四轮 269 + C-1 新增 4 + C-2 新增 7 + C-3 新增 3 + C-4 新增 3 + C-5 新增 2 + C-6 新增 4 + P-1 新增 5 + 交接总结新增 2 + P-5 新增 2 + P-6 新增 7 + 评估文档 1）。
> 列：`路径 | 行数 | 说明`。`upstream/<name>` 是 gitlink（submodule），行数记 `-`；既有条目的行数为生成时快照，文档改版后以文件实际内容为准。
> 说明来源：精写字典 213 条、从源码注释/导出/测试名自动提取 69 条、按类型兜底 0 条。
> 需要更详细的「哪些文件一起完成什么」见 `04-CODE-MAP.md`；目录结构见 `DIRECTORY-GUIDE.md`。

## 交接包 HANDOFF/（14）

| 路径 | 行数 | 说明 |
|---|---|---|
| `HANDOFF/00-START-HERE.md` | 88 | 新 Agent 第一份必读：环境、同步状态、干净环境变量、服务端口（含 5432 PG）、首次验证、8 个已知坑（含宿主重启后插件重挂）。 |
| `HANDOFF/01-PROJECT-OVERVIEW.md` | 56 | 产品与业务架构：定位、渠道分工、三级 owner、8 步闭环、5 tab 功能地图、成熟度三档、五条红线。 |
| `HANDOFF/02-ARCHITECTURE.md` | 89 | 技术架构：四层数据流、7 个上游真实引用强度、前端分层、中文壳、路由契约、共享记忆主干（B1+B2）、平台端口、代码交付。 |
| `HANDOFF/03-WORK-LOG.md` | 58 | 全部 22 轮工作记录（含第十五轮补遗、第十六轮 C-1、第十七轮 C-2、第十八轮 C-3、第十九轮 C-4、第二十轮 C-5、第二十一轮 C-6）、7 条排障模式、用户明确做过的决策。 |
| `HANDOFF/04-CODE-MAP.md` | 172 | 按 14 个功能域讲「哪些文件一起完成什么」、关键导出与依赖方向速查。 |
| `HANDOFF/05-VALIDATION-AND-COMMANDS.md` | 145 | 全套回归命令、第二十二轮 P-1 / 第二十三轮 P-5 / 第二十四轮 P-6 实测结果（含 `npm test` 445/445、`steps:smoke` 54/54、E 段 HITL / F 段送达证据 / G 段四项借思想、host:pg 21/21、各隔离冒烟）、真实 HTTP 冒烟模板、服务端口表、排障速查、提交前检查。 |
| `HANDOFF/06-CURRENT-STATE-AND-NEXT.md` | 130 | 当前状态快照（第二十四轮 P-6）、B2 四项真跑证据、C-0~C-6 分步清单、按配置的三层判断、去 Paperclip 化路线、P-1 / P-5 / P-6 三轮生产项交付与证据、剩余生产项与待拍板事项。 |
| `HANDOFF/07-RULES-AND-BOUNDARIES.md` | 44 | 红线与边界：业务验收身份、隐私与 .runtime、服务约束、许可证、前端入口、工程约束。 |
| `HANDOFF/08-OPEN-DECISIONS.md` | 103 | 12 个条目（7 项待拍板 + 产品形态 ②、B2 范围、组织形态可配置与自演进、Paperclip 去留四条历史记录 + 第 11 条 Runner 已拍板完成）：外部模型凭据、真人验收、部门 scope、外部服务、已停服务、pi 指代、第 12 条 OpenMausBot 落地范围三档结论与红线。 |
| `HANDOFF/DIRECTORY-GUIDE.md` | 154 | ★ 目录完全指南：完整目录树、每个顶层目录作用与入库状态、7 个 submodule、.runtime 详解、构建产物位置、新文件该放哪。 |
| `HANDOFF/FILE-INVENTORY.md` | 328 | ★ 本文件：全部入库文件逐文件一行说明（路径 / 行数 / 用途），用于快速定位。 |
| `HANDOFF/README.md` | 62 | 交接包总索引：5 分钟接手路径、包内每个文件的说明、根目录两份总览入口、一句话现状与检查清单。 |
| `HANDOFF/SYNC-STATUS.md` | 58 | ★ 唯一位置声明（含根目录两份总览入口）、代码基线/提交关系、接手校验命令、本目录内阅读顺序。 |
| `HANDOFF/handoff-manifest.json` | 203 | 机器可读元数据：commit、远端、测试结果、服务状态、包内文件清单、下一步与开放决策。 |

## 后端核心 src/（82）

| 路径 | 行数 | 说明 |
|---|---|---|
| `src/acceptance-interop.ts` | 186 | 把锁定的验收清单与逐项轮次导出为 lobehub/acceptance 报告格式；只读上游 schema/LICENSE，不跑其 CLI。 |
| `src/acceptance-plan.ts` | 172 | 开工前锁定验收清单：planForTask / lockPlan / readPlan，验收标准不得由承接人事后自定。 |
| `src/acceptance-report.ts` | 313 | 本机中文验收报告服务：归档索引、HTML 渲染、自查标准、成果总览页 OverviewService。 |
| `src/acceptance-round.ts` | 182 | 独立逐项判定与证据闸门 verifyAcceptanceGate / evaluateRound / writeRound / toAcceptanceCases。 |
| `src/agent-definition.ts` | 32 | 能力目录 capabilityCatalog 与技能目录 skillCatalog，供 Harness 装配使用。 |
| `src/agent-services.ts` | 71 | 服务 Agent 的职责定义、版本计算 serviceVersion 与 profile 读取。 |
| `src/architecture-contracts.ts` | 112 | ★ 唯一架构常量来源：16 类节点/5 边族/EDGE_RULES、ontology 三层、Agent 三层角色、四套运行时来源、记忆投影与 memoryEventSchema。 |
| `src/assistant-runner.ts` | 70 | Autoloop worker 运行器：把 assistant job 转成原生执行并恢复回执；P-1 起无常驻 `while`，按配置分派双泵。 |
| `src/assistant-tools.ts` | 41 | 暴露任务绑定的运行时工具集（read_context / delegate_service / assess_scope 等）。 |
| `src/assistant-turn.ts` | 82 | 单轮模型调用编排：中文业务 prompt、CLI 适配器 adapterFor、输出与用量解析。 |
| `src/assistant.ts` | 374 | 事务整理 Agent：上下文编译 bundle、委托 delegate、job 生命周期、复查与取消。 |
| `src/channels.ts` | 184 | 语义对象统一降级渲染 renderForChannel：IM 纯文本 / 工作台卡片 / 链接，禁止各处自拼消息。 |
| `src/cli.ts` | 23 | 命令行入口，装配配置与命令分发。 |
| `src/client.ts` | 11 | 前端或 CLI 调 Bridge 的 api() 请求封装。 |
| `src/cognee-native.ts` | 110 | Cognee 原生管线接入层：从进程环境解析 LLM/embedding 配置、生成状态、spawn Python 子进程；凭据不落盘。 |
| `src/collaboration-intake.ts` | 72 | 协作任务入口：复用 Super Agent 事件归一化与既有 event/outbox 存储。 |
| `src/commands.ts` | 10 | 子进程命令执行封装（command()），带 cwd 与 stdin 支持。 |
| `src/config.ts` | 137 | 全项目 zod 配置 schema、loadConfig / secrets / runtime / root；新增配置项必须在此加默认值。 |
| `src/context-grant.ts` | 92 | 跨空间 Context Grant（FR-10/26）：申请、批准、拒绝、撤销、读写分离审批、可用性校验。 |
| `src/context.ts` | 214 | 任务上下文裁剪与证据哈希：InputRef、contextHash、goal/delivery/discussion 证据。 |
| `src/controller.ts` | 472 | ★ 任务生命周期与验收红线：ingest/createTask/reply/handoff/receipt/publish/accept/confirmAcceptance/runIndependentReview。 |
| `src/coordination.ts` | 83 | Super Agent policy.ts 准入与范围判断、运行时工具白名单、订阅事件筛选、recheck 消费。 |
| `src/development.ts` | 18 | 开发/交付视图的业务封装（调用 Controller 与 Assistant）。 |
| `src/event-stream.ts` | 246 | CollabEvent 契约与统一只读证据投影；各来源 normalizer（fromAssistantTurn / fromWorkerJournal / fromDelivery / capture）。 |
| `src/evidence.ts` | 17 | 证据引用校验（源自用户授权的本体原型移植）：逐字引文与投影证据一致性。 |
| `src/feishu-org.ts` | 195 | 飞书组织映射草案、部门 scope 缺失报告、owner 决策持久化、orgAuthCommand 安全登录命令。 |
| `src/feishu-sources.ts` | 81 | 飞书证据引用 schema 与 withFeishuReads() 只读请求包装；不可用时明确报错。 |
| `src/github.ts` | 121 | DeliveryAdapter 接口（prepare/publish/inspect/preview）+ GitHub 适配器（显式回退）+ 路径校验与 PR URL 解析。 |
| `src/graph.ts` | 92 | Cognee 子进程 RPC 封装、CogneeL1Reader、pin 的 cogneeCommit。 |
| `src/harness-composition.ts` | 65 | esbuild 动态打包 DeepSeek Harness 13 模块；compileAgent / executeComposedTool，含 createScope 工具白名单。 |
| `src/independent-review.ts` | 118 | 可插拔独立评审者与能力校验；评审者不得是产出模型。 |
| `src/knowledge-edges.ts` | 152 | L2 组织边状态（draft/accepted/reusable）、invalidateEdges、eligibleForContextPack、buildContextPack。 |
| `src/knowledge.ts` | 104 | 知识的规范存储与修订历史；reusable() 要求 state=confirmed（来源撤权的现有阻断）。 |
| `src/local-git.ts` | 269 | ★ 本机 Git 交付：裸仓库、worktree、push、本机 CI、自动合并、固定版本预览、审批与通知；与 Github 同实现 DeliveryAdapter。 |
| `src/mcp.ts` | 46 | stdio MCP 传输实现，配 tests/mcp.test.ts 真实协议测试。 |
| `src/members.ts` | 130 | ★ 成员身份解析与权限 gate；成员级 reads / v06Reads 白名单（新增只读 action 必须同步）。 |
| `src/memory-checkpoint.ts` | 139 | ★ B2 checkpoint：保存 raw events / logErrors / bundle / checksum，普通事件增量应用；撤权 / 乱序 / 失效祖先 / 已撤回来源一律回退全量，增量与全量 checksum 逐字节对照。 |
| `src/memory-contract.ts` | 5 | 早期 memoryAnnotation schema（概念/关系候选），与 B1 事件主干不是同一层。 |
| `src/memory-log.ts` | 147 | ★ B1 append-only 共享记忆事件主干：MemoryLog、memoryEvent、幂等、advisory、桥接 routing-decided、坏行报错。 |
| `src/memory-projections.ts` | 377 | ★ B1/B2 纯函数重放四类投影、撤权 lineage 传播、双层过滤、稳定 checksum、recallMemory（B2 按 principal 精确过滤）、assertDeterministic；拆出 ProjectionState 供 checkpoint 复用。 |
| `src/memory-recall.ts` | 116 | ★ B2 读取链：projectionRecall 重放主干、projectRecallHits 按 sourceId@revision 白名单裁剪、fuseProjectionHits 三路融合；读日志失败 advisory 降级，modelCalls=0。 |
| `src/model-settings.ts` | 72 | 模型三档预备策略的配置与保存（不存 API Key，不等于启用）。 |
| `src/native-worker.ts` | 13 | Autoloop 恢复日志与原生 worker 运行的衔接。 |
| `src/ontology.ts` | 56 | 知识空间字典（GraphSchema / JSON Schema）校验与保存；automaticExtraction 状态由配置派生。 |
| `src/org-extraction.ts` | 346 | 从 Cognee L1 投影确定性抽取 L2 组织图（modelCalls=0），含 ModelExtractionAdapter 与拒绝原因；B2 新增 buildTaskGraphMirror 修复任务级镜像悬空边。 |
| `src/org-ontology.ts` | 102 | 组织图 TBox 校验 validateOrgGraph、责任链/证据/影响面查询；常量从 architecture-contracts 再导出保持兼容。 |
| `src/organization-signals.ts` | 106 | 组织状态信号（FR-21/03）：评估、聚类、修复回路与复测，只警告不排名。 |
| `src/paperclip.ts` | 21 | Paperclip REST 薄封装 get/post/patch/document，带乐观修订号与 404 处理。 |
| `src/pg-host.ts` | 475 | C-1 PostgreSQL 宿主后端：事务、ACL、成本账本、heartbeat checkout/retry/runToken、SKIP LOCKED 步进队列、崩溃恢复、状态外置；assertLocalPgDsn 只允许回环。 |
| `src/platform-evidence.ts` | 48 | 平台指纹与测试证据生成，防止换机器后仍声称已验证。 |
| `src/platform-port.ts` | 193 | ★ 去 Paperclip 化第一步：HostPlatformPort + PaperclipPlatform（默认）+ LocalHostPlatform（可运行最小实现）。 |
| `src/roles.ts` | 187 | 职能注册表（FR-01/02/03/28）：主职能、邻接能力、能力派生与路由建议。 |
| `src/routing-decision.ts` | 155 | ★ RoutingDecision 五维契约（caller/target/basis/scope/requiresHumanSignature）、人签红线、toMemoryEvent / decisionOf。 |
| `src/routing-trace.ts` | 126 | ★ 5 派活点共用单例 Trace：append-only JSONL、SQLite audit 投影、readRoutingEvents / replayRouting、测试隔离。 |
| `src/runner.ts` | 105 | Autoloop createWorker 执行入口与 HubError 处理；P-1 起按 `config.execution.mode` 分派 legacy / stepped 泵，无常驻 `while`。 |
| `src/step-execution.ts` | 342 | ★ P-1 单步执行契约：`StepQueue` / `InMemoryStepQueue` / `PgStepQueue` / `executeOneStep()` / 步间权限重评 / 外部调度器 / 确定性摘要 / 中文只读状态。 |
| `src/loop-pump.ts` | 80 | ★ P-1 双泵：`driveLegacyLoop()` 逐字等价、`driveSteppedPump()` 会话快照写回队列。 |
| `src/step-runner.ts` | 74 | ★ P-1 `step:once` 入口：一次进程只领一步，工具白名单、模型步拒绝、人工步不得自行放行。 |
| `src/runtime-bridge.ts` | 118 | 把 FR-22/23/24 运行时守卫契约接到真实执行路径。 |
| `src/runtime-guard.ts` | 111 | 注意力预算、干预判定、Watchdog 与事件过滤（纯函数契约）。 |
| `src/semantic-recall.ts` | 144 | 设备端 Apple NL 中英文词向量、BM25 混合召回、语义索引读写；不调用外部模型。 |
| `src/server.ts` | 488 | ★ Bridge 主服务：workspace action 分发、readOnly 白名单、service-status/routing-status/memory-replay 只读接口、全部服务组装注入。 |
| `src/service-network.ts` | 201 | A2A 服务委派：Link 合同、route/start/dispatch/rpc、AgentCard 与 TaskStore 绑定。 |
| `src/service-status.ts` | 215 | ★ 「国内服务」唯一数据源：并发 loopback 探测、状态来源、未接通原因与接通步骤；未接通项不带 url。 |
| `src/shell-domestic.ts` | 92 | 国内适配：构建期收敛 4 侧栏入口 + 运行时脚本隐藏未连接海外卡片（含 protectedEl/repair 自愈）。 |
| `src/shell-locale.ts` | 44 | 构建期中文壳：Babel AST 只替换展示文案，不改路由/API enum/业务内容。 |
| `src/store.ts` | 41 | 本地 SQLite：Task/Delivery 类型、任务投影、事件去重、outbox 通知、audit 表。 |
| `src/team-memory.ts` | 152 | 团队记忆索引与检索：L1 图/词向量生成、BM25+语义融合、检索时权限与版本重评；B2 在重评之后叠加投影召回为第三路信号，8 处 B1 双写之一。 |
| `src/three-tier-assessment.ts` | 87 | 用真实路由 Trace 判断要不要引入 LobeHub 三层（7 条前置条件，当前 recommended=false）。 |
| `src/trace-bridge.ts` | 66 | 验收证据 Trace 与成本账本 best-effort 写入；失败绝不改变业务结果。 |
| `src/transfer.ts` | 220 | 责任转移（FR-11/12/13）：createTransfer、assertDispatchAllowed、联签、双段责任链、熔断影响面。 |
| `src/upstream.ts` | 30 | 上游动态 import 边界：Super Agent 触发/channel、Autoloop contract/agents、Harness session-reference。 |
| `src/user-language.ts` | 94 | 中文用户语言层：USER_HELP、parseUserCommand、7 条指令与 legacy 斜杠命令兼容。 |
| `src/v06-store.ts` | 93 | v0.6 存储边界：RuntimeV06Store（Paperclip 文档）与 MemoryV06Store（测试用）。 |
| `src/v06.ts` | 735 | ★ v0.6 功能编排门面（736 行）：注册表、Transfer、Grant、边状态、Context Pack、L2 抽取、组织信号、验收视图。 |
| `src/vendor/prime-query.ts` | 31 | 从 Prime Agent 移植的检索词/近期目标权重（必须保留 Mario Zechner 原始 MIT 版权头）。 |
| `src/vision-semantics.ts` | 119 | 本机 Apple Vision 语义判定（结构式与模型两档）。 |
| `src/visual-review.ts` | 246 | 独立视觉评审适配器、reviewerIdFor、acceptanceChainEnabled 与视觉证据绑定。 |
| `src/workspace-policy.ts` | 100 | Workspace owner 策略（FR-05/20/28）：只能收紧、验证等级、拓扑建议、在途版本校验。 |
| `src/workspaces.ts` | 740 | ★ 知识空间与授权核心：来源、访问申请、快照、撤权、协作任务创建、allowed 权限重评；B2 收尾改用评审后 revision 写来源事件，消除真实链路悬空 lineage。 |
| `src/router.ts` | 190 | ★ C-3 单一 Router：`planRoute()` 纯函数决定 1/2 跳、`Router` 唯一写入口、`routerRevision()` 配置快照、`planCoverage()` 证据判定；自派自验自环被拦留痕，人签只在最后一跳。 |

| `src/evolution-ledger.ts` | 325 | ★ C-6 独立 append-only 治理台账：7 类事件、`modelCalls=0`、内容哈希 / 幂等键、状态机守门、两次重放 checksum 一致；刻意不并入 B1 主干。 |
| `src/evolution.ts` | 486 | ★ C-6 自查闸门 / 工程回放闸门 / 四项效果指标 / `EvolutionService` 统一编排；`assertDeliverySelfCheck()` 接在 `Controller.publish()` 之前。 |
| `src/agent-registry.ts` | 324 | ★ C-4 组织级 Agent 注册表：可扩展职责槽位 / 生效范围 / 内容哈希版本 / 配置快照 / `resolveAssignment` / `handoffEnvelope` / `reviewCrew` / 单例装配；确定性工程层 `modelCalls=0`。 |
| `src/workspace-summary.ts` | 138 | ★ P-5 控制台只读摘要：`parseViewSummaryPage()` 分页参数夹取、`visibleTasksFor()` 身份过滤、`buildWorkspaceSummary()` 确定性纯函数与字段白名单；不读工作稿正文、不发起网络请求。 |
| `src/step-hitl.ts` | 229 | ★ P-6 HITL 成对留痕（Runner MIT 协议语义移植）：`askHuman` / `answerHuman` 生成 `human_question` / `human_response`，问题编号即提问事件自身 id、因果放载荷；`foldHitl` / `assertHitlRedLines` / `hitlSummary` 折叠投影与红线校验；`FileHitlSink` / `MemoryHitlSink` append-only 台账；`HitlRefusal` 让执行进程只提问不放行。 |
| `src/step-delivery.ts` | 232 | ★ P-6 队列送达证据（Runner MIT 协议语义移植）：`cumulativeAck` 只前进、`foldDelivery` 订阅边界与 backlog、`notificationText` 幂等不带消息体、`atLeastOncePending`、`deliveryReadiness` 按能力声明且重投递只认空闲；`TrackedStepQueue` 组合既有队列留下送达 / 确认证据。 |
| `src/mission-state.ts` | 161 | ★ P-6 四项借思想：`deriveMissionState` 六态由任务事实派生（安静 30 秒、settled 与 running 可并存）、`RUNTIME_CAPABILITIES` / `resolveRuntime` 能力声明且 `assertNoStoredArgv` 焊住启动参数不入库、`assertCoordinationLayering` 配置库与追加写日志分层、`assertSnapshotNoRewrite` 编制快照不回溯。 |

## 脚本与服务 scripts/（52）

| 路径 | 行数 | 说明 |
|---|---|---|
| `scripts/acceptance-report.ts` | 132 | 本机验收报告 HTTP 服务与 CLI（/health、/overview、报告索引），只绑 loopback。 |
| `scripts/apple-embedding.swift` | 98 | Apple NaturalLanguage 设备端文本词向量，供语义召回，不外发材料。 |
| `scripts/apple-vision.swift` | 86 | 本机离线视觉模型（OCR + 图像分类），独立评审的图像证据来源。 |
| `scripts/audit-upstream.ts` | 92 | 上游适配边界审计：.gitmodules / gitlink / sources.lock.json / 许可证一致性，输出 clean 标记。 |
| `scripts/build-chinese-shell.ts` | 42 | 构建中文壳 + 国内适配产物；构建前恢复 public/sw.js 占位符保证幂等，顺序先 domestic 再 chinese。 |
| `scripts/cognee-graph.py` | 112 | Cognee Python 侧：按 sourceId@revision 隔离建图、导出节点/边与 BM25 索引。 |
| `scripts/cognee-native.py` | 90 | Cognee 原生管线 Python 侧：add → cognify(extractor=llm) → search，接外部 OpenAI-compatible 端点。 |
| `scripts/cognee-native.ts` | 28 | Cognee 原生 CLI（status / cognify / search）；凭据只从进程环境读取。 |
| `scripts/cognee-recall.py` | 33 | Cognee BM25 检索子进程，只接受权限过滤后的语料注入。 |
| `scripts/console-server.ts` | 130 | C-2 独立控制台本地承载：只绑回环、13 项只读 action 白名单、密钥不出服务端、CSP 与禁表单；导出 listenConsole 供冒烟复用。 |
| `scripts/console-smoke.mjs` | 155 | C-2 真跑：临时端口 + Chrome 走查 6 视图、主题、425px、零海外文案、写动作 403；报告 .runtime/console-smoke.json（不入库）。 |
| `scripts/delivery-demo.ts` | 74 | 本机 Git 交付端到端冒烟：建裸仓库、提交、push、本机 CI、审批、预览。 |
| `scripts/delivery-server.ts` | 199 | 本机代码交付台 4194 HTTP + git daemon 9418，只绑 127.0.0.1；当前按用户要求停机。 |
| `scripts/doctor.ts` | 17 | 环境自检 CLI（依赖、配置、服务状态）。 |
| `scripts/export-acceptance.ts` | 19 | 把一次锁定的验收轮次导出为可摄取格式（acceptance 互操作）。 |
| `scripts/host-pg-smoke.ts` | 156 | C-1 真跑脚本 npm run host:pg：拒绝非专属库、21 项 checks、报告写 .runtime/host-pg-smoke.json（不入库）。 |
| `scripts/host-smoke.ts` | 58 | 真跑不依赖 Paperclip 的 LocalHostPlatform：增删改查、幂等、文档修订、未实现 route 明确报错。 |
| `scripts/install-upstream.ts` | 25 | 安装/构建上游 Paperclip UI，并在之后自动重建中文壳。 |
| `scripts/install-wiki.ts` | 30 | 安装 pin 的上游 Wiki 存储与 UI，不重新实现 Wiki、不开启全员摄取。 |
| `scripts/install-workspace-plugin.ts` | 35 | esbuild 打包并安装工作台插件（--build-only 可只打包）。 |
| `scripts/memory-checkpoint.ts` | 67 | ★ B2 真实日志 checkpoint CLI：按 append-only 前缀增量应用，`--reset` 全量重建；回退全量时如实给出 fallback 原因。 |
| `scripts/memory-journey.ts` | 155 | ★ B2 真跑脚本：经真实 bridge action 跑 8 步完整知识事件链与端到端撤权，9 项 checks 含 lineageComplete；会写真实日志，不是只读检查。 |
| `scripts/memory-replay.ts` | 46 | B1 只读验收 CLI：重放四类投影、checksum、撤权状态与 5 处接线自检。 |
| `scripts/memory-smoke.ts` | 63 | B1 真跑冒烟：临时目录里「写入 → 重放 → 撤权 → 派生记忆不可召回」。 |
| `scripts/migrate-workspace-contracts.ts` | 31 | 工作区契约数据迁移脚本。 |
| `scripts/org-auth.ts` | 42 | 生成「补齐飞书部门 scope」的安全登录命令（携带现有全部 scope，默认只打印）。 |
| `scripts/org-mapping.ts` | 46 | 飞书组织映射本地操作入口（preview / apply）。 |
| `scripts/org-table.ts` | 71 | 把 owner 人工核对结论变成可导入组织表，只写 .runtime。 |
| `scripts/pair-feishu.ts` | 33 | 飞书身份/会话配对辅助脚本。 |
| `scripts/paperclip.ts` | 19 | Paperclip 服务相关辅助脚本。 |
| `scripts/responsive-audit.ts` | 112 | 窄屏（425px）真实样式走查，检查溢出与按钮尺寸。 |
| `scripts/routing-status.ts` | 40 | A 阶段只读 CLI：统一路由 Trace、5 处接线自检、三层判断与平台切换清单。 |
| `scripts/run-team-pilot.ts` | 16 | 团队试点运行入口。 |
| `scripts/seed-team-pilot.ts` | 19 | 团队试点数据播种。 |
| `scripts/setup-assistant.ts` | 31 | 配置事务整理 Agent（projectId / agentKey / engine）。 |
| `scripts/setup-graph.ts` | 7 | 初始化 Cognee 图环境与 Python 虚拟环境。 |
| `scripts/setup-team-pilot.ts` | 36 | 初始化团队试点。 |
| `scripts/setup-workspaces.ts` | 43 | 初始化知识空间目录与工作区契约。 |
| `scripts/setup.ts` | 73 | 项目初始化总入口（配置、密钥、Paperclip 绑定等）。 |
| `scripts/smoke-cross-role.ts` | 103 | 跨职能协作链路冒烟。 |
| `scripts/smoke-managed.ts` | 49 | 托管 Agent 模式冒烟。 |
| `scripts/smoke-memory-graph.ts` | 11 | 团队记忆图冒烟。 |
| `scripts/smoke-privacy.ts` | 29 | 隐私边界冒烟（确认真实数据不入库）。 |
| `scripts/smoke-service-memory.ts` | 16 | 服务 Agent 记忆冒烟。 |
| `scripts/test.ts` | 21 | 测试 runner：发现 tests/*.test.ts、写平台验证报告，并注入 COLLAB_TEST_TRACE/COLLAB_TEST_MEMORY 隔离变量。 |
| `scripts/up.ts` | 76 | 服务启动/停止/重启/状态；ownsServicePid 校验 PID 归属，启动前检查中文壳产物。 |
| `scripts/verify-team-pilot.ts` | 25 | 团队试点结果校验。 |
| `scripts/vision-server.ts` | 108 | 本机 OpenAI-compatible 视觉端点（4190），当前按用户要求停机。 |
| `scripts/workbench-walkthrough.mjs` | 181 | ★ 真实浏览器 11 步走查：CDP 驱动 3100 工作台，含白屏守卫、链接白名单、侧栏隐藏断言。 |
| `scripts/router-smoke.ts` | 130 | C-3 真跑：隔离内存 Trace 跑 legacy / flat / layered 三种形态，31 项 checks，报告 `.runtime/router-smoke.json`（不入库）。 |

| `scripts/agents-smoke.ts` | 265 | C-4 真跑：隔离内存 Trace 跑 C-3 兼容 / 空编制降级 / 在岗 2 跳 / 验收编组 / A2A 六类失败 / 接线守门，43 项 checks，报告 `.runtime/agent-registry-smoke.json`（不入库）。 |
| `scripts/steps-smoke.ts` | 414 | ★ P-1 / P-6 真跑：隔离内存队列 + 本机 PG 专属库 + 真实子进程跨进程领步，54/54（含 E 段 HITL 成对留痕、F 段送达证据、G 段四项借思想守门），不 reset 他人数据。 |
| `scripts/step-answer.ts` | 54 | ★ P-6 真人在原会话回答人工问题的 CLI 入口（`npm run step:answer`）：校验 `COLLAB_HUMAN_ACTOR`，只追加 `human_response`、不排后续步骤、不改任务状态，明确不等于验收。 |
| `scripts/evolution-smoke.ts` | 318 | C-6 真跑：隔离临时台账跑完整闭环与全部反例 45 项 checks，报告 `.runtime/evolution-smoke.json`（不入库），前后真实台账 / B1 主干行数不变。 |
| `scripts/shapes-smoke.ts` | 276 | C-5 真跑：隔离内存 Trace 让扁平 / 分层各跑一单五阶段，36 项 checks，每步带 Router / 在岗快照可回放，报告 `.runtime/shapes-smoke.json`（不入库）。 |

## 回归测试 tests/（65）

| 路径 | 行数 | 说明 |
|---|---|---|
| `tests/acceptance-contract.test.ts` | 136 | 回归测试：criteria are sealed with a hash and an independent, vision-capable reviewer；the sealed plan round-trips through a native Paperclip document revision；planForTask derives criteria from the business acceptance lines already stored… |
| `tests/acceptance-interop.test.ts` | 100 | 回归测试：acceptance submodule 固定在 Apache-2.0 提交且规范文件存在；锁定清单逐项映射到 acceptance 冻结 plan，ID 保持不变；逐项评审报告导出为上游 result.json 形状，证据都带真实描述… |
| `tests/acceptance-report.test.ts` | 131 | 回归测试：中文 HTML 报告转义用户内容、标注边界，且不出现英文 /accept；归档索引与 HTML 报告落盘可回放；打回原因沉淀为自查标准，同一轮重复记录不新增… |
| `tests/agent-services.test.ts` | 52 | 回归测试：a stale profile version cannot silently change the specialist chosen for a request；service version is independent of JSON field insertion order… |
| `tests/apple-vision.test.ts` | 155 | 回归测试：锁定标准中的期望文本被解析为可核验的视觉特征；本机视觉模型按截图实际内容逐项判定，命中才通过；没有绑定截图时绝不假装看过图；纯色图不算界面证据… |
| `tests/architecture-contracts.test.ts` | 86 | 回归测试：组织本体常量只有一份来源，domain/range 规则覆盖全部边族；共享契约给出三层 ontology、三层 Agent 角色与四套运行时来源；记忆事件强制溯源字段，不允许缺 actor / at 或伪造 sourceRef… |
| `tests/artifact-preview.test.ts` | 7 | 回归测试：the actual CI assembler supports a JSON delivery and escapes its contents；invalid JSON and malformed HTML still fail their real CI validation |
| `tests/assistant.test.ts` | 132 | 回归测试：reused local evidence checks reject forged or paraphrased quotes and pin original revision；assistant output cannot add authority fields or references outside the supplied task；a permission or revision change during generation discards output before any write… |
| `tests/autonomous-worker.test.ts` | 19 | 回归测试：the real Autoloop worker recovers its journal and retries a receipt without rerunning work |
| `tests/channels.test.ts` | 95 | 回归测试：the existing Feishu trigger maps to a channel-independent envelope；bot messages and non-Feishu payloads are ignored without throwing；a Transfer card degraded to Feishu text keeps every responsibility field… |
| `tests/cognee-native.test.ts` | 83 | 回归测试：Cognee 原生管线默认打开，配置里只存环境变量名；未配置外部模型时列出缺失的环境变量名，状态接口不泄露凭据；配置齐全时解析出端点 / 模型，并把凭据只放进子进程环境… |
| `tests/collaboration-intake.test.ts` | 57 | 回归测试：a whitelist alone cannot control another task that was not bound to this chat and sender；unapproved senders cannot resume, append background or change a task；pause does not create another task or treat IM text as permission approval… |
| `tests/confirm-acceptance.test.ts` | 175 | 回归测试：按锁定清单确认验收：逐项全通过才归档，改 done、留痕并给中文通知；身份不符、无锁定清单、逐项未通过、清单被改写，一律拒绝且不改任务状态；会话里一句「确认验收」走按清单核可；未锁清单的旧流程要求中文写明的交付提交号 |
| `tests/console-shell.test.ts` | 88 | C-2 控制台静态契约 7 例：用户可见层无国外元素、无网页发起入口、只读白名单、密钥与回环边界、资源自足。 |
| `tests/context-dependency-performance.test.ts` | 9 | 回归测试：shared history dependencies are checked once per read and rechecked on the next read |
| `tests/context.test.ts` | 99 | 回归测试：ported Prime Agent query terms match the pinned original Python implementation；adoption rechecks the exact input versions and blocks historical knowledge；a historical draft cannot reintroduce changed source evidence into a fresh model context… |
| `tests/contracts.test.ts` | 123 | 回归测试：upstream Feishu intake deduplicates by message, not event delivery; ignores own bot；durable claim excludes another writer and another agent, including after reopening SQLite；event data cannot choose a new executable, identity or repository… |
| `tests/coordination.test.ts` | 26 | 回归测试：the pinned Super-agent policy gates current delegated work and preserves observation mode；a due check is consumed once, bounded across rounds, and cannot resume a paused mandate… |
| `tests/delivery.test.ts` | 26 | 回归测试：覆盖该模块的契约与失败路径。 |
| `tests/development.test.ts` | 5 | 回归测试：development and acceptance cannot impersonate a requester even after a scoped member gate |
| `tests/domestic-localization.test.ts` | 90 | C-2 国内适配契约 7 例：中文壳词典、页面元数据、服务清单去海外一等入口、工作台文案、控制台不依赖宿主。 |
| `tests/event-stream.test.ts` | 143 | 回归测试：the three existing evidence sources normalize into one shape；agent-written conclusions stay authored and are never reported as captured evidence；malformed events are rejected with field paths instead of being silently stored… |
| `tests/feishu-org.test.ts` | 165 | 回归测试：只读预览去重、排除外部租户、部门缺 scope 时给出授权命令；部门字段可用时不报缺 scope；读取失败时返回结构化空草案而不是抛出；补部门权限时携带现有全部 scope，不会把已有授权清空… |
| `tests/feishu-sources.test.ts` | 40 | 回归测试：losing original source access never falls back to a previously read body… |
| `tests/fixtures/prime-context-terms.json` | 89 | Prime Agent 检索词权重测试夹具。 |
| `tests/frontend-structure.test.ts` | 102 | 回归测试：index.tsx 只是 SDK 固定入口，业务实现按职责分散；展示原语与 UI 契约只有 foundation 一份来源；依赖单向：视图不反向 import 页面壳，也不形成模块环… |
| `tests/graph.test.ts` | 41 | 回归测试：graph access rechecks the owning task and source before any graph process can start |
| `tests/harness-composition.test.ts` | 22 | 回归测试：pinned Harness composes distinct scoped personas and actual callable tools without a model；failed native composition leaves no persona or capability registered for the next build… |
| `tests/journey-intake.test.ts` | 48 | 回归测试：飞书消息中的「。验收：」必须进入锁定清单，不再静默退化成通用项；独立评审可在运行实例上触发，但只写证据报告，最终核可仍是 /accept；捕获事件只能由可信执行端写入，taskId 取自 URL，字段不完整则拒绝 |
| `tests/knowledge-governance.test.ts` | 99 | 回归测试：inferred edges without human acceptance cannot be used as a basis；invalidation is a state write with a timestamp and reason, never a physical delete；reuse lineage can be walked backwards to find the blast radius… |
| `tests/knowledge.test.ts` | 44 | 回归测试：覆盖该模块的契约与失败路径。 |
| `tests/l2-extraction.test.ts` | 149 | 回归测试：L1 隔离：混入其他来源版本时直接拒绝抽取；确定性抽取：生成草稿边、逐条带 L1 原文证据、零模型调用，且不改 L1；抽取是幂等的：重复运行不新增草稿，已由人验收的边不会被重置… |
| `tests/local-delivery.test.ts` | 90 | 回归测试：国内环境默认走本机 Git 交付，GitHub 适配器仍可显式回退；delivery-status 是只读接口，三处白名单一致；本机交付台只绑 loopback，审批不等于业务验收… |
| `tests/mcp.test.ts` | 36 | 回归测试：覆盖该模块的契约与失败路径。 |
| `tests/memory-checkpoint.test.ts` | 127 | ★ B2 回归：checkpoint 读写往返与损坏拒绝、普通增量与全量 checksum 一致、撤权 / 乱序 / 失效祖先 / 已撤回来源回退全量、分批追加、重复行不重复投影。 |
| `tests/memory-recall.test.ts` | 79 | ★ B2 回归：投影白名单裁剪、三路融合不覆盖原分数、接线顺序（权限重评之后才消费投影）、principal 精确撤权、读日志失败降级。 |
| `tests/memory-replay.test.ts` | 278 | 回归测试：记忆事件契约：溯源字段强制，modelCalls 只能是非负整数，来源 id 稳定；主干落盘 → 读回 → 幂等，坏行如实报错；重放可复现：两次 checksum 一致；B2 单主体撤权与版本前进后的完整 lineage… |
| `tests/model-settings.test.ts` | 30 | 回归测试：model drafts cannot enable a provider, carry credentials, or bind an unauthorized identity；model configuration uses exact native revision and refuses agent self-configuration |
| `tests/ontology-runtime.test.ts` | 77 | 回归测试：default ontology has 16 node kinds and 5 edge families, with typed edge rules；the three organisation questions are answerable from one relation set；attention budget: two-stage filter, self-progress silence, caps and role boundary… |
| `tests/paperclip.test.ts` | 19 | 回归测试：document updates use the latestRevisionId returned by the real API contract；retrying a delivered document does not create another native revision |
| `tests/pg-host.test.ts` | 62 | C-1 纯函数契约 6 例：DSN 回环白名单、外部主机拒绝、pgDsn 环境变量、capabilities 如实区分；不连库也不假绿。 |
| `tests/platform-evidence.test.ts` | 25 | 回归测试：execution evidence reads only exact-SHA hashed delivery files and rejects tampering |
| `tests/policy-signals.test.ts` | 76 | 回归测试：verification level has a floor the owner cannot lower；owner may tighten; topology is configurable but event direct-routing is not；topology advice is read-only and comes from observed density… |
| `tests/responsive-layout.test.ts` | 48 | 回归测试：v0.6 三个面板都带 sm-v06 作用域，不污染上游页面样式；425px 规则：容器不设硬宽、表格在自身容器滚动、按钮 ≥44px、长文本可断行；窄屏走查脚本按 1280 与 425 两个视口测量，并保留审计产物… |
| `tests/roles.test.ts` | 94 | 回归测试：granularity self-check only hints; it never blocks dispatch；registry changes are versioned and audited; historical snapshots are never rewritten… |
| `tests/routing-decision.test.ts` | 165 | 回归测试：RoutingDecision 覆盖五个必需维度并严格拒绝未知字段；带 idempotencyKey 的决策可重复构造且 id 稳定，不带 key 时按时间区分；红线动作一律要求人签字且带理由，调用点不能把它改成 false… |
| `tests/semantic-guard.test.ts` | 91 | 回归测试：仓库默认已开启护栏强制与本地语义检索，但不启用外部模型 API；设备端中英文词向量：语义相近的句子明显比无关句子更接近；无 Apple 词向量时降级为本地哈希向量，仍可完成向量检索… |
| `tests/service-network.test.ts` | 14 | 回归测试：service responses stop sharing when a source is unauthorized, and cancellation is retained；an Agent can answer a peer only with exact source text already in the shared packet；the official JSON-RPC transport serves the same native task and rejects cross-task access… |
| `tests/service-status.test.ts` | 162 | 回归测试：全部在线时，只有真实接通的本机服务带 loopback 链接；Paperclip 的 SPA HTML 回退也算在线，但任意 200 不会被误判；未接通的国内与海外服务：没有 url，也没有可点入口，但给出可照做的步骤… |
| `tests/shell-domestic.test.ts` | 132 | 回归测试：构建期收敛侧栏的 Skills / 连接服务入口，保留其余导航；只在本项目之外不改文件：非目标文件与页面内容原样返回；index.html 注入中文标题与同源运行时资源，不使用 inline 脚本… |
| `tests/shell-locale.test.ts` | 13 | 回归测试：覆盖该模块的契约与失败路径。 |
| `tests/team-members.test.ts` | 11 | 回归测试：binding cannot invent a user or collapse two users onto one data principal；a member cannot approve their own request for another knowledge owner；rebinding retires the previous identity without making its credentials ownerless… |
| `tests/team-memory.test.ts` | 4 | 回归测试：memory lookup does not read or index content before the task permission gate；a model cannot approve knowledge relations or start an index as a human |
| `tests/trace-bridge.test.ts` | 86 | 回归测试：a normal append lands in the native document and the audit table；invalid or duplicate events are absorbed, never thrown at the caller；a broken trace sink does not fail the business action… |
| `tests/transfer.test.ts` | 96 | 回归测试：L0 is the default: scope is exactly this Task；the doer cannot authorise themselves, and the standard must be externalised；consultation-only calls are explicitly marked and do not move responsibility… |
| `tests/user-language.test.ts` | 97 | 回归测试：中文指令覆盖建任务、进度、补充、确认验收、打回、转交；旧英文斜杠命令仍可解析（兼容既有脚本），但不再出现在帮助文案里；闲聊与 @ 不建任务，避免误触发… |
| `tests/v06-services.test.ts` | 141 | 回归测试：independent reviewer refuses to claim a visual judgement it cannot make；evidence binder only binds captured/imported trace events, never authored output；org-level config writes require the org owner; ordinary members cannot widen grants… |
| `tests/v06-workbench.test.ts` | 112 | 回归测试：org-overview 一次返回十段组织视图（含 L2 抽取状态与飞书组织映射），单段失败不影响其余；plan-view 读回开工前锁定的清单及原生修订号；未接原生文档存储时 plan-view / round-view 返回 null 而不抛错… |
| `tests/visual-review.test.ts` | 142 | 回归测试：legacy 模式保持原评审者；independent 模式换成视觉可用且独立的评审者；结构式视觉评审：绑定截图可过，缺证据受阻，自撰材料判失败，哈希不符判失败；完整新验收流程：锁定清单 → 独立视觉评审 → 逐项报告 → 核可闸门（人仍是最终签字）… |
| `tests/workspace-action.test.ts` | 57 | 回归测试：action guard accepts lowercase names and the numbered v0.6 family；v06-plan-view；action guard still rejects path traversal, uppercase, underscores and empty names… |
| `tests/workspaces.test.ts` | 261 | 回归测试：parent acceptance waits for the development it explicitly commissioned；an exact document revision cannot pass acceptance after its underlying source was revoked；approval and expiry are both required; pending, revoking and exact deadline deny access… |
| `tests/router.test.ts` | 145 | C-3 契约 11 例：配置校验、快照、legacy 逐字回退、1/2 跳、人签位置、自环、纯函数确定性、p6/p8 闸门、9 处接线。 |

| `tests/agent-registry.test.ts` | 240 | C-4 契约 14 例：schema / 版本快照 / 范围 / 确定性解析 / 自环 / A2A 交接 / 验收编组 / Router 兼容 / p8 / 五处接线。 |
| `tests/step-execution.test.ts` | 203 | ★ P-1 契约 13 例：配置与只读视图 / 队列并发与旧令牌 / 一次一步与换机器 / 步间重评 / 拒绝反例 / 崩溃回收 / 确定性摘要 / 双泵 / 接线守门。 |
| `tests/evolution.test.ts` | 239 | C-6 契约 12 例：自查五种阻断 / 工程回放闸门 / 状态机红线 / 效果不可比 / 独立台账 / 配置与接线守门。 |
| `tests/shape-assessment.test.ts` | 175 | C-5 契约 10 例：按配置判定 / 真实在岗主管 / 防跳级反例 / 形态闭环与启用三层分离 / 接线守门。 |
| `tests/workspace-summary.test.ts` | 139 | ★ P-5 契约 9 例：默认分页与全量计数 / 越界空页 / 参数夹取 / 身份过滤 / 字段白名单不泄露内部状态 / 宿主标题优先与截断 / partial 与 local 降级 / 两次逐字节一致 / 空页不编造。 |
| `tests/step-hitl.test.ts` | 156 | ★ P-6 HITL 契约 10 例：问题编号与因果位置 / 回答关联与「不是验收」标注 / 输入校验 / 折叠投影 / 红线 / 确定性摘要 / append-only 台账 / 执行进程只提问不放行并成对闭环 / 不注入台账时无副作用。 |
| `tests/step-delivery.test.ts` | 162 | ★ P-6 契约 11 例：累计确认只前进 / 订阅边界与积压 / 通知幂等 / 投递就绪按能力声明 / `TrackedStepQueue` 送达证据 / 六态派生与并存 / 能力声明不存 argv / 分层守门 / 快照不回溯 / 只读视图新增字段。 |

## 独立控制台 console/（3）

| 路径 | 行数 | 说明 |
|---|---|---|
| `console/index.html` | 87 | C-2 自研独立外壳结构：侧栏会话与导航、六视图容器、助手与现场卡、飞书唯一发起说明；无输入框与提交表单。 |
| `console/styles.css` | 259 | LobeHub 风格设计系统：明暗两套 CSS 变量、圆角卡片、气泡时间线、1240/900/425px 断点与 44px 按钮。 |
| `console/app.js` | 260 | 六视图渲染、只读 API 调用与 8 秒超时、DOMESTIC_TERMS 统一中文语言层、主题持久化、窄屏侧栏。 |

## 前端插件 plugins/（23）

| 路径 | 行数 | 说明 |
|---|---|---|
| `plugins/knowledge-workspaces/package.json` | 9 | 插件包依赖与构建脚本。 |
| `plugins/knowledge-workspaces/src/action-name.ts` | 18 | workspace action 名 → Bridge URL 路径段的映射。 |
| `plugins/knowledge-workspaces/src/manifest.ts` | 12 | 插件清单与 SDK 入口声明（uiEntry 固定 src/ui/index.tsx）。 |
| `plugins/knowledge-workspaces/src/ui/agent-builder.tsx` | 20 | Agent 构建/配置表单。 |
| `plugins/knowledge-workspaces/src/ui/agent-services.tsx` | 43 | Agent 服务目录页。 |
| `plugins/knowledge-workspaces/src/ui/async.ts` | 29 | 统一异步契约：useRead（按 action+参数自动重取）与 useActionFeedback（写操作就地反馈）。 |
| `plugins/knowledge-workspaces/src/ui/cognee-dynamic.tsx` | 7 | Cognee 图组件的 client-only dynamic 边界适配。 |
| `plugins/knowledge-workspaces/src/ui/cognee-modules.d.ts` | 9 | Cognee 组件模块的类型声明。 |
| `plugins/knowledge-workspaces/src/ui/collaboration-network.tsx` | 65 | 服务协作网络、记忆工作区、成员绑定与 focusMemorySource。 |
| `plugins/knowledge-workspaces/src/ui/development.tsx` | 14 | 代码交付面板（本机 Git 措辞，不再出现 GitHub/PR 字样）。 |
| `plugins/knowledge-workspaces/src/ui/domestic-services.tsx` | 76 | ★ 「国内可用服务」：唯一能生成入口链接的地方，connected + loopback 校验通过才渲染 <a>。 |
| `plugins/knowledge-workspaces/src/ui/forms.tsx` | 55 | 可复用表单：知识候选/编辑、发起协作任务，失败就地提示。 |
| `plugins/knowledge-workspaces/src/ui/foundation.tsx` | 90 | 前端基础设施：展示原语 Button/Badge/Details/Icon、中文文案字典、useDraft、UI 契约、safeHttpUrl/safeLoopbackUrl、ActionError。 |
| `plugins/knowledge-workspaces/src/ui/index.tsx` | 5 | 插件 UI 的 SDK 固定入口，仅 5 行再导出 WorkspacePage / WorkspaceSidebar。 |
| `plugins/knowledge-workspaces/src/ui/knowledge-graph.tsx` | 59 | 知识图谱 GraphPanel 与知识字典 DictionaryPanel。 |
| `plugins/knowledge-workspaces/src/ui/settings.tsx` | 73 | 设置区：空间与权限、模型与代理、服务与架构、组织规则、国内服务清单。 |
| `plugins/knowledge-workspaces/src/ui/spaces.tsx` | 39 | 知识空间：内容 / 图谱 / 字典 / 关系与状态四个子视图。 |
| `plugins/knowledge-workspaces/src/ui/styles.ts` | 81 | 插件真实样式字符串（响应式与国内适配样式来源）。 |
| `plugins/knowledge-workspaces/src/ui/task-detail.tsx` | 191 | 协作任务详情：进展、上下文、交接、知识沉淀、验收与任务上下文只读投影（191 行，最大视图模块）。 |
| `plugins/knowledge-workspaces/src/ui/v06-panels.tsx` | 221 | v0.6 工作台视图：治理、组织规则、知识状态、验收与责任等面板。 |
| `plugins/knowledge-workspaces/src/ui/workspace-page.tsx` | 101 | 页面壳：宿主 action 通道、轮询、5 个主 tab 与视图路由。 |
| `plugins/knowledge-workspaces/src/worker.ts` | 26 | 插件 worker：所有读写都走 action 通道，携带宿主不可变 actor（UI 不能指定操作人）。 |
| `plugins/knowledge-workspaces/tsconfig.json` | 12 | 插件独立 TypeScript 配置（build:workspaces 会检查）。 |

## 项目文档 docs/（23）

| 路径 | 行数 | 说明 |
|---|---|---|
| `docs/ADAPTATION-v0.6.md` | 696 | ★ 逐轮适配记录与「最新边界声明」（当前以 0.0000000000000000 节为准，含第 6 小节补遗），判断「已发生/未发生」以此为准。 |
| `docs/AGENT-BUILDING.md` | 41 | Agent 构建与能力装配说明。 |
| `docs/AGENT-SERVICE-NETWORK.md` | 70 | 个人 Agent 服务网的组织方式。 |
| `docs/ARCHITECTURE-OPTIONS-v0.7.md` | 269 | ★ 架构收敛方案：主流记忆架构、auto-ontology 校正、A/B/C 三方案、缺口清单与许可证边界（含附录 A/B/C/D，D 记 B2 已落地）。 |
| `docs/ARCHITECTURE-v0.6.md` | 546 | ★ 产品架构定稿（546 行）：六层模型、M3 三层路由、M11 责任转移、默认图谱本体；是设计，不等于全部已实现。 |
| `docs/ASSISTANT-CONTEXT.md` | 80 | 协作 Agent 与上下文工作区设计。 |
| `docs/AUTONOMOUS-COLLABORATION.md` | 43 | 自主协作运行：事件、判断、工具执行与恢复。 |
| `docs/FEISHU-SOURCES.md` | 31 | 飞书原始来源证据的读取边界。 |
| `docs/KNOWLEDGE-AND-ACCESS.md` | 82 | 知识与资料授权模型。 |
| `docs/KNOWLEDGE-ENGINE.md` | 69 | 知识引擎：Cognee L1 隔离、L2 确定性抽取与语义管线口径。 |
| `docs/MEMORY-ARCHITECTURE-v0.7.md` | 94 | ★ 方案 B 全文：append-only 事件主干、四类投影、撤权 lineage、B2 投影召回 / 精确撤权 / checkpoint 与真跑证据、C 边界。 |
| `docs/OPEN-SOURCE-COMPLIANCE.md` | 119 | 开源复用与许可证合规说明（已复用/可复用/禁止复用三分类）。 |
| `docs/PRD-v0.6.md` | 412 | ★ 产品需求文档：FR 编号、R1–R5 红线、§10A 前端形态约束（S5/S6 已废弃）、§10C C 阶段产品约束 C-P1~C-P5、Q4 复用矩阵。 |
| `docs/REFERENCE-openmausbot.md` | 133 | ★ OpenMausBot 完整参考评估（固定 Apache-2.0 提交 `3f81576`）：两进程架构、决策模型/自动路由、Agent 定义与团队包、Assignment 委托树、driver SPI 与 shadow 降级、Skill 版本化、出入站 MCP 边界、三层行为评测；含逐项对照表、11 条按价值排序的差距清单、明确不做的红线与 `enterprise/` 许可证边界。**只调研，未引入任何代码/依赖/服务**。 |
| `docs/ROUTING-AND-HOST-v0.7.md` | 165 | ★ A 阶段方案全文：RoutingDecision、共享 Trace、三层判断、HostPlatformPort、开源候选矩阵与 6.1 C 阶段新增产品约束。 |
| `docs/SOURCES.md` | 46 | 上游来源与引入方式记录。 |
| `docs/SYSTEM-ARCHITECTURE.md` | 241 | ★ 「现在是什么」：技术四层、产品与业务架构、前端分层、统一路由 Trace、共享记忆主干。 |
| `docs/TEAM-NETWORK-MEMORY.md` | 70 | 多人服务协作与团队知识记忆。 |
| `docs/UPSTREAM-ADAPTERS.md` | 54 | 上游适配代码清单与引用边界。 |
| `docs/VALIDATION.md` | 745 | ★ 逐轮验证记录（含 B2、C-1 ~ C-6、P-1 全套回归与 2026-11-08 交接文档轮），判断「验证过没有」以此为准。 |
| `docs/WORKSPACES.md` | 70 | 知识空间与使用说明。 |
| `docs/agent-integration.md` | 75 | Agent 接入与 CLI 适配说明。 |
| `docs/design/workbench.md` | 11 | 工作台视觉/交互设计稿。 |

## 上游 submodule upstream/（7）

| 路径 | 行数 | 说明 |
|---|---|---|
| `upstream/acceptance` | - | git submodule（gitlink）：lobehub/acceptance，Apache-2.0，只读报告格式契约。 |
| `upstream/autoloop` | - | git submodule（gitlink）：Agent Autoloop，MIT，worker 执行循环与回执恢复。 |
| `upstream/cognee` | - | git submodule（gitlink）：Cognee，Apache-2.0，图存储/DataPoint/BM25/原生 cognify。 |
| `upstream/deepseek-harness` | - | git submodule（gitlink）：DeepSeek Harness，MIT，scope/工具/Persona 装配。 |
| `upstream/paperclip` | - | git submodule（gitlink）：Paperclip 平台底座 + 上游 UI，MIT，只 pin 不改源码。 |
| `upstream/prime-agent` | - | git submodule（gitlink）：Prime Agent，MIT，检索权重来源。 |
| `upstream/superagent` | - | git submodule（gitlink）：DeepSeek Super Agent，MIT，用于触发解析与 policy 准入。 |

## 根目录配置（13）

| 路径 | 行数 | 说明 |
|---|---|---|
| `.gitignore` | 8 | 忽略规则：node_modules/、.runtime/、workspaces/、evidence/private/、.env、*.log、plugins/*/dist/。 |
| `.gitmodules` | 21 | 7 个 git submodule 的路径与来源 URL。 |
| `AGENTS.md` | 10 | 给 Agent 的协作规则。 |
| `DESIGN.md` | 17 | 总体设计说明。 |
| `HANDOFF.md` | 189 | ★ 根目录交接总纲（2026-11-08）：5 分钟接手、产品口径、现状、环境命令、代码地图、红线、三档边界、下一步、索引、提交流程、8 个坑；详细权威仍在 `HANDOFF/`。 |
| `PRODUCT.md` | 13 | 产品定位与能力状态说明（含 Cognee 原生管线已打开的口径）。 |
| `PROJECT-SUMMARY.md` | 329 | ★ 项目总结（2026-11-08）：系统架构、产品功能架构、业务流程设计、依赖与引用（协议逐一）、验证证据、边界与索引。 |
| `README.md` | 190 | 项目主入口：交接与总结导航、架构与方案导航、实现边界、本地运行、飞书、交付验收、知识与验证。 |
| `THIRD_PARTY_NOTICES.md` | 212 | 第三方声明与版权信息。 |
| `package-lock.json` | 2686 | npm 依赖锁定文件。 |
| `package.json` | 73 | npm scripts 总表与依赖；新增脚本必须指向真实实现文件。 |
| `sources.lock.json` | 39 | ★ 7 个上游 submodule 的 URL / commit / license / 引入方式锁定，audit:upstream 校验。 |
| `tsconfig.json` | 8 | 主工程 TypeScript 配置。 |

## 其它目录（配置/许可/夹具/集成）（14）

| 路径 | 行数 | 说明 |
|---|---|---|
| `.github/workflows/ci.yml` | 37 | GitHub Actions CI 配置。 |
| `fixtures/collab-pilot.yml` | 64 | 协作试点配置夹具。 |
| `fixtures/vision-demo.html` | 15 | 视觉评审演示页面夹具。 |
| `fixtures/vision-demo.png` | 61 | 视觉评审演示截图夹具。 |
| `fixtures/wait-agent.mjs` | 5 | 协议夹具（刻意不是真实模型或第三方 Agent）。 |
| `integrations/deepseek/messages.ts` | 3 | 把 Harness 的 LLM 消息/错误工具替换为自研实现，不激活模型 provider。 |
| `integrations/deepseek/runtime.ts` | 8 | Harness 运行时装配 barrel（esbuild 入口）。 |
| `licenses/a2a-js-APACHE-2.0.txt` | 202 | @a2a-js/sdk 的 Apache-2.0 许可证全文。 |
| `licenses/acceptance-APACHE-2.0.txt` | 201 | lobehub/acceptance 的 Apache-2.0 许可证全文。 |
| `licenses/cognee-APACHE-2.0.txt` | 201 | Cognee 的 Apache-2.0 许可证全文。 |
| `licenses/harness-vendor-MIT.txt` | 21 | DeepSeek Harness 及 vendored 依赖的 MIT 声明。 |
| `licenses/pg-MIT.txt` | 21 | pg@8.23.1 的 MIT LICENSE 原文（含 @types/pg 同版本），R7 新增依赖登记凭证。 |
| `licenses/runner-MIT.txt` | 21 | Runner（Copyright (c) 2026 Yicheng Wang）的 MIT LICENSE 原文；P-6 两块协议语义移植的来源凭证，`sources.lock.json` 的 `protocolReferences` 固定提交，`audit:upstream` 校验。不是 submodule。 |
| `locales/shell.zh-CN.json` | 13 | 构建期中文壳词典（展示文案替换表）。 |

## 覆盖率

- 总条目：**299**（第十四轮 269 + C-1 新增 4 + C-2 新增 7 + C-3 新增 3 + C-4 新增 3 + C-5 新增 2 + C-6 新增 4 + P-1 新增 5 + 交接总结新增 2 个入库文件）
- 精写说明：**213**
- 自动提取（源码注释/导出/真实测试名）：**69**
- 兜底：**0**
- 未覆盖：**0**
- 说明：既有条目的行数是生成时快照；2026-11-08 同步更新了根目录两份总览入口与交接包索引。
