# 第一版验证记录

第二阶段已跑通专业知识与授权协作，包含 API 任务 SUI-25 和实际浏览器任务 SUI-19，见 [当前功能与验证](WORKSPACES.md)。下面保留第一阶段记录，其“尚未验证”按第一阶段时间理解。

验证日期：2026-11-04。平台代码与流程联调仓库分别维护。没有合并试点 PR，没有生产部署。

## 真实飞书闭环：SUI-4

- 用户在新建专用飞书机器人的单聊中完成一次性配对，再发送真实任务；接单、提问、PR、预览、验收结果均已在原消息回写。
- Paperclip 只产生一个 Codex 执行轮次。Agent 编码完成后因本轮浏览器不可用结束并提出问题，没有占住执行等待。
- 使用原任务、原工作树、原分支交接到人工接单入口，由当前 Codex 桌面会话推进后续交付及浏览器验证。没有重复发起开发任务。
- 交付：[desktop-tutorial PR #2](https://github.com/zhegong-996/desktop-tutorial/pull/2)。提交：`4b4b49fc98dea89938ce3c47f029bc45dad4dc1b`。
- [该提交的 Actions](https://github.com/zhegong-996/desktop-tutorial/actions/runs/41852758048) 通过；下载同一 SHA 的产物并核对 `version.json`，环境为 `local-pr-preview`。
- 已在实际浏览器查看四个入口，逐一点击得到申请访问提示。这只是联调页面，不冒充后台的完整知识权限界面。
- 原任务发起人在原飞书单聊发送 `/accept`，后台核对提交、CI、预览环境、两项验收要求以及发起人身份，任务已关闭并原处回复。验收记录、已采用结论保存在 Paperclip 任务文档中。

原消息、用户标识、完整运行轨迹与截图保留在本机 `.runtime/`，不提交仓库。机器可核对证据为 `live-journey-evidence.json`。

## 其他实测

| 能力 | 证据与结果 |
|---|---|
| 等待释放 | 无模型的真实 Paperclip 进程验证：`ask` 产生原生问题交互、执行成功终止、任务等待、回执身份为执行 Agent；观察期只产生一轮。证据 `protocol-smoke-evidence.json` |
| 私有上下文 | 原生私有项目/任务 API：Agent 授权前拒绝；共享单条任务后任务与文档可读，所属项目仍拒绝；撤销后任务与文档拒绝。证据 `privacy-smoke-evidence.json`。测试使用 WorkBuddy 对应 Agent 身份，不代表 WorkBuddy 应用已实际接通 |
| 知识生命周期 | 使用试点资料：候选引用拒绝；确认后另一个任务可读取；撤回后下一次读取排除；重新确认新版本后恢复。证据 `knowledge-smoke-evidence.json` |
| 原版 Wiki | 同一上游提交的插件构建、安装、原生配置与浏览器页面读取通过；其原测试套件 **101/101** 通过。共享页能保存、读取；自动摄取关闭 |
| 本地单元与协议验证 | **14/14**；包括真实 stdio MCP、并发领取、过期回执、部分失败重试、版本验收、ACL 撤回过滤、确认防篡改、已提交越界代码不能绕过交付检查；TypeScript 检查通过 |
| 首轮复杂页面 | [PR #1](https://github.com/zhegong-996/desktop-tutorial/pull/1) 的 [CI](https://github.com/zhegong-996/desktop-tutorial/actions/runs/41849584725) 通过 8 组浏览器检查；桌面实际验证新增、状态改变和刷新保留。该任务验收记录明确为集成测试人员验证，区别于 SUI-4 的真实发起人验收 |

## 修复过的真实联调问题

运行时不再重复执行 Paperclip 已完成的 checkout；Agent 回执使用运行身份，避免被视为人类新消息而再次唤醒自己；等待改用原生问题交互；文档更新使用最新修订 ID；相同标题的不同来源任务不复用错误任务；预览下载支持重试；飞书断开不停止独立 GitHub/API 服务。

Wiki 原生 `bootstrap-root` 在这个固定版本会创建带不兼容设置的原生 Claude 执行者。安装脚本改走已有的目录配置、`bootstrap-space`、选择现有 Agent 和项目 API；不修改上游、不伪造原生执行器。插件 React peer 在本地测试复用同一 Paperclip UI 已安装的 React。

## 尚未验证/启用

- 多人登录、飞书组织/岗位组映射、部门私有库自动检索、活动运行中撤权及派生摘要传播。原生任务 ACL 测试不能替代这些验证。
- Claude Code 在本机未达到可运行状态；WorkBuddy、豆包工作已提供通用 MCP/CLI 接口，但没有实际启动相应产品会话。Grok Bot、Cursor 云端自动派单、ACP 远端恢复尚未启用。
- 第一阶段的 `later` 只记录；2026-11-05 已在既有控制层实现每次委托最多两次的复查，沿用原生运行，不启用第二个调度器。
- 试点是 PR 本地预览，没有作者合并或生产发布。
- CLI 用量保留在运行回执中，尚未把不同 CLI 的用量与费用完整回填到 Paperclip 成本账本。工作台显示的零费用不能视为真实调用免费，也不能用作已经生效的总费用上限。

## 2026-11-05：知识引擎与模型配置

- 核实真实 PostgreSQL 18.1、bridge SQLite、Paperclip 与飞书事件服务；完整架构与部署边界见 SYSTEM-ARCHITECTURE.md。
- 模型策略已从中文界面保存到原生私有文档，三档配置及执行身份绑定可读；新服务调用仍关闭，不存 Key。
- 平台架构核验记录经页面编辑，数字和布尔类型、正文及确切修订保留，旧修订写入被拒；资料始终为候选，未由 Agent 采用。
- 固定 Cognee 1.6.6，直接运行原版 DataPoint / LadybugAdapter / provenance。实际记录生成 **4 节点、3 关系**，模型调用 0；重启 bridge、启动新 Python 进程后仍可读，重复投影不增加重复节点。
- 中文字典界面保存实际 SourceDocument / KnowledgeField 对应的概念、6 个属性和关系；原生 JSON Schema 转换保留枚举和可关联多个目标的关系约束。旧修订写入及 Agent 管理字典被拒。
- 实际 API / stdio MCP 核对：未委托身份不能读取、Agent 不能投影、旧来源修订被拒、飞书原文不导入。旧 SUI-54 仍为 accepted，4 项资料委托及对应原生 access grants 均已撤销。
- 本轮自动测试 **69/69**、根目录类型检查与工作台构建通过。Python 图存储另外在本机真实记录上验证；CI 的接口/构建检查不代替该运行证据。
- 真实资料正文和本机 UI 证据仅保留 `.runtime`，未提交 GitHub；旧业务工作稿未作为可复用知识采用。自动实体抽取、向量检索、长期语义记忆和新增模型服务未启用。

## 2026-11-05：个人服务 Agent 与真实自主执行

- 产品基线采用用户补充的玉伯访谈：个人提供给同事的服务 Agent、当前职责变化、先评估与澄清、关键时找负责人。当前仅本机负责人真实身份已接通，不虚构员工与跨部门生产效果。
- SUI-85 从真实浏览器“团队 Agent”入口发起，绑定“我的协作 Agent”及确切职责版本；实际 Codex 调用上下文、记录、范围判断和服务发现，产出评估稿，并以原版 Autoloop `ask` 结束进程等待。
- SUI-74 已完成真实范围判断、工具检索、两份初稿和同一任务的增补稿；首次规则名错误被原版 Super-agent 拒绝，Agent 自行修正。不是只生成一次 JSON 的静态整理器。
- SUI-81 原版 worker 完成一次真实代码执行。原生审阅归属与 HTML-only CI 的集成失败修复后，仅恢复回执及交付，不重复编码。交付 [PR #3](https://github.com/zhegong-996/desktop-tutorial/pull/3)，提交 `c6e74dbb71152cbe3021d0cb84d666931da61ba7`，[CI 通过](https://github.com/zhegong-996/desktop-tutorial/actions/runs/41967526834)。文件预览的 version.json 与该 SHA 一致；没有合并、发布或代替业务验收。
- 自动测试 **90/90**，根目录类型检查通过。原版 worker 的进程级测试覆盖 journal 重建、丢失一次回执响应、业务进程仍仅启动一次；另覆盖职责版本、IM 唯一任务接续、服务发起重试、工具预算、来源失效、权限拒绝及非网页成果校验。
- `read_execution_evidence` 只读本任务既有执行事实与关联交付；平台测试记录有代码指纹和实际用例结果；关联交付可读取同一 SHA 下经文件哈希核对的有限正文，明确不代表业务验收。不要求人重新搬运后台已有日志。
- 私有来源正文、模型回执、截屏与原始执行轨迹仍只保留忽略提交的 `.runtime`。未启用新的模型服务、自动语义记忆、自动知识采用或自动最终验收。

- 执行证据写入曾被当作人工需求变更，触发本轮取消；已将机器证据与人的需求补充分开，保留关联交付的输入依赖与原生读取权限检查。人的补充仍使旧依据失效，机器记录不改写人的目标。

## 2026-11-05：服务 Agent 网络、持续知识记忆与页面适配

- 本地 **108/108** 测试、根目录类型检查、中文协作插件与中文宿主构建通过。覆盖真实成员登录映射、停用、身份独立与换绑、只读角色、资料负责人授权、单次飞书配对、服务版本、取消、官方 A2A JSON-RPC、知识引用和人审修订。新增分支上下文依赖性能回归，下一次读取仍检查来源变化及循环依赖。
- 官方 `@a2a-js/sdk` 1.3.0 实际运行 `DefaultRequestHandler`、`TaskStore`、`JsonRpcTransportHandler`；SUI-103 的 Codex 实际调用 `delegate_service`，原生子任务 SUI-106 完成两份工作稿并回传，原父任务自动接续归纳。真实 HTTP `GetTask` 返回两个 artifacts；没有另起调度器、没有最终验收。
- 已确认的平台流程知识经 Cognee 原版 BM25 与 Ladybug 持久检索，重启 bridge 后另起 Python 进程检索返回有来源修订的命中。图存储隔离测试 **5 节点、5 关系**，验证中文关系、正文未出现的概念别名召回与跨进程持久化；模型调用 0。隔离图测试不冒充真实业务知识。
- 浏览器从“知识 → 检索与记忆”真实查询，选择已有平台流程知识并点击“交给 Agent 整理关系”，产生 SUI-123。既有 Codex 实际调用 `read_context`、`assess_scope`、`read_memory_dictionary`、`read_graph`、`propose_memory`，保存 **8 个概念、6 条关系候选**；没有人审签名，没有自动采用。
- 页面整合我的工作、协作、知识、Agent、设置；任务内可委托、澄清、查看回传；知识有版本引用、结构化字段、内容、图谱、字典与关系候选。成员归属接原生目录，可开通独立身份、生成个人飞书配对码。只读查询不等待后台索引，写入仍串行；权限与来源版本不做跨请求缓存。
- 当前真实使用仍是本机同一负责人下的两个服务身份，不代表已部署给多位员工。独立登录、配对、停用与权责隔离使用原生接口适配和隔离测试验证，尚无第二位真人登录的运行证据。新模型服务、embedding 语义检索与全公司跨源事实消歧均未启用。
- 私有运行证据：`service-memory-journey.json`、`memory-ui-journey.json`、`memory-graph-integration.json` 和 `.runtime/review/` 页面截图。业务原文、密钥、回执与截图均不提交 GitHub。

- 桌面 1280 与窄屏 425 浏览器走查：服务回传稿可展开；任务直接进入关系候选审阅，保留原搜索；检索返回正文/结构化字段/来源修订；Cognee 当前来源图可读；Agent 需求草稿切换成员页再返回保持。窄屏文档宽度与视口均为425，无横向溢出。
- SUI-123 图谱读取曾超时；恢复后沿用同一任务补查，Codex 实际读取当前图谱并完成8个概念、6条关系的重复核对。图中只有文档/字段/片段及结构连接，没有已采用概念关系；没有重写候选或自动采用。

## 2026-11-06：L2 抽取、窄屏走查、上游边界与独立评审链（第四轮）

- `npm test` **204/204**、`tsc --noEmit`、`npm run build:workspaces`、`git diff --check` 通过。新增 16 个用例：L2 抽取 6（跨版本泄漏拒绝、逐字证据、幂等不重置人审状态、模型适配器幻觉证据被拒、全局图与任务镜像、reader 只读调用）、独立评审链 6（能力声明、结构式判定/受阻/自撰/哈希、完整闸门、评审者≠产出模型、Controller 自动写报告链路、本机端点限制）、响应式与上游静态守卫 4。
- `npm run test:responsive`：本机 Google Chrome headless，iframe 定宽得到精确 **1280 / 425** 视口。两档 `scrollWidth == clientWidth`、越界元素 0、表格只在自身容器滚动；425 按钮最小高度 44px（修复前 41px）。结果 `.runtime/responsive-audit.json`、截图 `.runtime/responsive-425.png`。这是插件样式与 v0.6 面板骨架的**布局走查**，不是宿主实例的完整流程验收。
- `npm run audit:upstream`：6 个 submodule 的 gitlink 与 `sources.lock.json` 一致、工作树干净、LICENSE/NOTICE 与 `THIRD_PARTY_NOTICES.md` 齐全、无强传染协议文本、`src/org-extraction.ts` 无 Cognee 写入/模型调用；结果 `.runtime/upstream-audit.json`，`clean: true`。
- L2 抽取链路用注入的 L1 投影做契约验证（零模型调用、草稿边带逐字原文证据、重复抽取不新增、不重置已验收边）；**第四轮当时**尚未在本机真实 Cognee 投影与真实已确认资料上跑一次端到端 journey，不把它冒充生产验证（第五轮已在真实链路上读取 L2 状态，仍保留 `lastRun` 为空的边界，见下一节）。
- 独立视觉评审用结构式适配器验证：截图绑定、自撰材料拒绝、哈希不匹配、缺证据受阻、缺截图时如实降级；`verifyAcceptanceGate` 完整放行。**第四轮当时**未接入真实视觉模型、不做图像内容语义判定；本机 `.runtime/config.json` 已切 `acceptance.mode=independent`，需重启 bridge 生效，旧流程可用 `legacy` 一行回退。第五轮已接入 Apple Vision 设备端视觉语义判定，见下一节。
- 私有运行证据（harness HTML、审计 JSON、截图）只保留忽略提交的 `.runtime`；真实业务正文、密钥与回执不提交。

## 2026-11-06：真实一单、本机视觉模型与宿主全流程走查（第五轮 / 收尾）

本轮把第四轮列出的「仍未做」全部补齐。**除明确标注外，以下均为真实本机实例上的运行结果，不是单测模拟**；证据在 `.runtime/walkthrough/`（gitignore，不入库）。

### 1. 真实跨职能一单 SUI-129

- 真实飞书单聊消息 `om_x100b61e688da38a0b08c6c26b9e5109` 发起 → Paperclip 生成 `SUI-129`；中文句中「。验收：」被 `businessAcceptanceFrom()` 正确解析，开工前**锁定 2 条验收清单**（`plan.hash = a9b6655a…`，原生修订 `afa861f8…`）。
- Role Registry 与 Transfer：`role-growth → role-product` 生成 L0「仅本 Task」授权卡片（`standardDraftedBy`、联签人、承接人 / 目标职能 owner 兜底的双段责任链均落 Paperclip 任务文档）。
- 统一过程流水 `trace-view`：真实写入 1 条 `chrome-headless` 截图捕获事件（`evidenceKind: captured`、`ci-screenshot`、sha256 绑定）；**如实列出 5 个缺口**（`kind:model` / `receipt` / `ci` 缺失、tokens 与 costCents 未记录），没有把「有流水」写成「流水完整」。
- 独立视觉评审：`/tasks/SUI-129/review` 经本机 Vision 端点约 4.7 秒返回，评审者 `local-vision:apple-vision-local`（`vision: true` / `independent: true` / `semanticJudgement: true`，与产出模型不同）；实际解码 2 张截图、识别 116 段文字，按「期望文本」逐项判定 **2/2 passed**。模型只判定 OCR 文字与图像分类（`document` / `screenshot`），**配色、留白、动效等主观视觉质量明确留给发起人 `/accept` 人工核可**。
- Acceptance 导出：`npm run acceptance:export -- SUI-129` 产出 `result.json`（`verdict: pass`，2 cases）、`report.md` 与 assets；同一 Trace event 被两个检查项引用时资产去重，无重复文件。
- GitHub：私有仓库联调 [issue #1](https://github.com/zhegong-996/suitme-collab/issues/1) 已创建并关闭（state `CLOSED`）。**没有合并试点 PR、没有生产部署、没有由发起人对该单执行最终 `/accept`**。

### 2. 本机能力（历史轮次口径：当时不接入任何外部 / 云端模型服务；2026-11-07 已变更，见第十一轮）

- `scripts/apple-vision.swift` 用 macOS Vision 设备端 OCR + 图像分类；`scripts/vision-server.ts` 只绑定 `127.0.0.1:4190` 提供 OpenAI 兼容端点；`src/vision-semantics.ts` 按期望文本逐项判定；`LocalModelVisionAdapter` 拒绝非本机 / https 地址，并用 `node:http` 直连避开 `HTTP_PROXY`（修复 `fetch failed / bad port`）。业务材料不外发。
- `scripts/apple-embedding.swift` + `src/semantic-recall.ts` 用 Apple NaturalLanguage 设备端 300 维中英文词向量为 recall 加权；实测「验收 / 审核」≈ 0.573、「验收 / 香蕉」≈ -0.05。`system-status` 显示 `embedding: Apple NL 设备端词向量（本机）`、`vectorSearch: true`、`modelApi: false`、`externalLlmCalls: 0`。**当时** Cognee 原生 LLM / embedding / cognify / 自动实体抽取全部关闭（`automaticExtraction: false`）；**2026-11-07 已按用户决策打开**，见本文档第十一轮与 `docs/ADAPTATION-v0.6.md` 第十一轮。
- `runtimeGuard.enforce` 默认开启，注意力预算与 Watchdog 从「只观测」切到实际生效；`protectHumanNotifications` 保护人工介入 / 结果 / 验收 / 授权等必达通知。真实 SUI-128 审计显示 `enforced: true` 且人工接单通知 `mustDeliver: true`。
- L2 组织图：`l2-status` 显示 `connected: true`、`adapter: deterministic-l1-projection`、`modelCalls: 0`、L1 仍按 `sha256(sourceId@revision)` 隔离；**`lastRun` 仍为 `null`**——真实 journey 中没有新确认资料触发索引，因此不宣称 L2 自动抽取已在真实业务资料上跑过端到端，这一条仍属契约与状态验证。
- 合规：`lobehub/acceptance` 以 Apache-2.0 submodule `f720feb…`（v0.10.0）引入，LICENSE 原文、`THIRD_PARTY_NOTICES.md` 专节、`docs/SOURCES.md`、`sources.lock.json` 与 `audit:upstream` 均已补齐；只复用契约与报告格式，其 CLI / 云端报告服务未启动。

### 3. 宿主实例全流程浏览器验收与本地演示

- `npm run test:walkthrough`（`scripts/workbench-walkthrough.mjs`）用 Chrome CDP 驱动真实 Paperclip 实例 `http://127.0.0.1:3100/SUI/knowledge-workspaces`，走查 5 tab + 3 个 v0.6 子视图共 **10/10 步通过**：所有期望文本命中、`Invalid workspace action` 0、`暂不可用` 0。
- 425px 窄屏实测 `clientWidth 393 / scrollWidth 393`、按钮最小高度 **44px**、溢出元素 **0**。修复了两个只有真实宿主才暴露的问题：worker 的 action 正则不允许数字（所有 `v06-*` 被拒）、「责任」视图把「无跨空间授权申请」的正常空态显示成「暂不可用」。
- 证据：`.runtime/walkthrough/report.json`、12 张 1280 / 425 截图、`.runtime/walkthrough/journey.json`；可交互演示 `.runtime/walkthrough/demo.html` 与预览 `demo-preview.png`。这些都在 `.runtime`，**不提交 GitHub**。
- 当前服务健康：Paperclip `3100`、bridge `4180`、本机视觉端点 `4190` 均返回 200。

### 4. 本轮边界（不得越过）

单测与浏览器截图不是生产发布或真实业务最终验收；本机单一负责人 + 服务身份不等于真实员工多租户（`multiUserSso: false`）；飞书只用了 allowlist 内的本人单聊，没有进群；CI / PR 交付未发生；真实资料正文、密钥、回执与截图只在 `.runtime`；Cognee 原生模型管线仍关闭。

## 2026-11-06：用户语言层、按清单核可、真实组织映射与本机报告（第六轮）

本轮补的是「最后一公里」：用户在会话里说中文、按锁定清单确认验收、飞书真实成员读成草案、逐项报告在本机可读可归档。实现与边界见 `ADAPTATION-v0.6.md` 0.0000000 节。

### 1. 回归结果

- `npm test` **252/252**（本轮收口时修掉两处遗留失败：`members.ts` 只读白名单补 `acceptance-report-view` / `org-mapping-view`；`v06-workbench.test.ts` 组织视图由 9 段更新为含 `feishuOrg` 的 10 段）。新增 5 个用例：中文指令歧义与帮助文案 2 个、`tests/confirm-acceptance.test.ts` 端到端 3 个（全通过归档、四类拒绝都不改任务状态、会话中文指令路由 + legacy 提交号提示）。
- `tsc --noEmit`、`npm run build:workspaces`、`npm run test:responsive`（1280 / 425 两档 `scrollWidth == clientWidth`、0 越界、425 按钮 44px）、`npm run audit:upstream`（7 submodules、`problems: []`、`clean: true`）、`git diff --check` 全绿。
- `npm run test:walkthrough` **10/10 步通过**，425px `clientWidth 393 / scrollWidth 393`、按钮 44px、溢出 0。**首次运行 9/10 失败是环境问题**：宿主服务继承了已失效的旧代理端口，插件 worker 连 `127.0.0.1:4180` 被劫持，页面显示 `connect failed: Connection refused`（截图 `.runtime/walkthrough/overview-1280.png`）；以干净的本机连接环境重启 3100 / 4180 后复跑通过，不是前端或 action 回归。重启后 3100 `/api/health`、4180 `/health` 均 200。

### 2. 新增能力的本机实测（不是单测模拟）

- `npm run org:preview` 经当前已授权的飞书 user 身份读到 **5 名真实成员**，`departmentScopeMissing: true` 并给出补 scope 的授权命令；`open_id` 按应用隔离如实标注。草案只写 `.runtime/org-mapping-draft.json`（gitignore），**未导入**注册表：`v06-org-mapping-view` 实测 `applied: false`、注册表版本 1、成员 1。
- `npm run acceptance:list` 读到 1 个归档轮次（`verdict: pass`、2 cases）；`acceptance:report` 生成中文 `report.html`；`acceptance:self-check` 连续两次写入同一打回原因，总数仍为 1（幂等）。
- `npm run acceptance:serve` 起在 `127.0.0.1:4192`：`/health` 返回 `loopback-only`，索引页列出归档任务并写明不启动云端报告服务，报告页含「逐项验收报告」「不代替原发起人在原会话」「自查标准」与边界声明。
- 真实 bridge 上的三个只读 action：`v06-acceptance-report-view`（`available: true / verdict: pass / 2 cases / 1 归档 / 1 自查标准`）、`v06-org-mapping-view`、`v06-org-overview`（10 段且 `feishuOrg.ok: true`）均正常返回。

### 3. 本轮边界（不得越过）

- `confirmAcceptance` 是已实现且有端到端单测的代码路径，**没有由真人在真实业务单上执行**；第五轮 SUI-129 仍保持未最终核可。仓库默认 `acceptance.mode=legacy`，中文「确认验收」在该模式下仍需交付提交号并由系统核对 CI 与部署版本。
- 飞书组织草案未导入，成员映射不等于真人登录或真实员工多租户，仍无第二位真人登录证据；真实姓名与 open_id 不入库。
- 本机报告服务只读取已归档结果、只绑 loopback；`lobehub/acceptance` 的 CLI 与云端报告服务仍未启动，报告与自查标准都只是证据，不代替人签字。
- （历史轮次）Cognee 原生 LLM / embedding / cognify 当时未启用、L2 自动抽取在真实新确认资料上的端到端触发（`lastRun` 仍为空）、生产发布与真实 PR / CI 交付仍未发生；`.runtime` 证据不入库。

## 2026-11-06：本机 independent 链路恢复、视觉评审复验与成果总览（第七轮）

### 1. 发现并修复的断点

- 本机实例 `.runtime/config.json` 已是 `acceptance.mode=independent`，`visualReviewer.endpoint` 指向 `http://127.0.0.1:4190/v1/chat/completions`，但 4190 端点已停机（`/health` 无响应）——**这条验收链当时是断的**，停机状态下发起独立评审会直接失败而不是自动降级。以干净的本机连接环境常驻重启 `npm run vision:start` 后，`/health` 返回 `apple-vision-on-device`、`networkEgress: false`、`swiftAvailable: true`。
- 用项目里真实的 `LocalModelVisionAdapter.review()` 对工作台截图 `.runtime/walkthrough/collaboration-1280.png` 跑了一次端到端判定：设备端 OCR 识别到 **80 段文字**，按锁定标准判定「协作、任务」`passed`，并如实返回 3 条限制（含「主观视觉质量仍由原发起人在原会话确认验收」）。评审者身份 `local-vision:apple-vision-local`、`semanticJudgement: true`，与产出模型不同。这是真实模型调用，不是单测夹具。

### 2. 本机成果总览页

- `npm run acceptance:serve` 新增只读 `/overview`：`node:http` 直连 loopback 实时探测 3100 / 4180 / 4190 / 4192，展示当前实例验收配置、中文指令、按清单确认验收四步、脱敏的飞书组织草案摘要、归档报告入口与严格边界；报告索引页增加入口链接。组织草案只读取成员计数与布尔值，**成员明细不进页面**。
- 实测 `/overview` 返回 200、四个服务全部「在线」、页面约 8KB；Chrome headless **1280 / 425 两档截图**无横向溢出、卡片不重叠。页面不含真实姓名、`open_id`、`appId` 或密钥。
- 新增 1 个单测（含「调用方误传成员明细也不渲染」的脱敏断言）与 4 条静态断言；`npm test` **253/253**、`tsc --noEmit` 通过。

### 3. 本轮边界（不得越过）

- 总览页是**状态展示**，不是验收动作：没有替任何真人「确认验收」，没有导入组织表，没有创建新的真实业务任务，没有向飞书发消息。
- 4190 视觉评审只提供证据与逐项判定；`confirmAcceptance` 仍未由真人在真实业务单上执行，第五轮 SUI-129 仍保持未最终核可；仓库默认仍是 `legacy` 可一行回退。
- 所有服务只绑 `127.0.0.1`；`lobehub/acceptance` 的 CLI 与云端报告服务、生产发布与真实 PR / CI、真实员工多租户、Cognee 原生模型管线、L2 在真实新资料上的端到端触发仍未发生。

## 2026-11-06：组织映射导入、国内前端适配与本机代码交付（第八轮）

### 1. 组织 owner 核对并完成导入

- owner 明确 **2 名成员已不在组织内**，只导入其余 **3 人**（真实姓名与标识只在 `.runtime`，不进仓库）。其中 1 人按姓名绑定到注册表已有的「增长」成员 ID（跨应用 `open_id` 不自动合并），另 2 人以草案 `open_id` 新增为「产研」；部门字段留空，如实标注 scope 未授权。
- `npm run org:table` 把 owner 决策写入 `.runtime/v06/org-owner-decisions.json`，`FeishuOrgService.preview()` 读取该决策，**下次预览只剩 3 人**（实测 `excludedByOwner` 含 2 项），历史会话成员不会被反复带回。
- `npm run org:apply` 实测 `imported: 3`、`registryVersion: 2`、`registeredMembers: 3`，`v06-org-mapping-view.applied` 已有记录；已有成员的派生领域未被覆盖。真实姓名与 `open_id` 只在 `.runtime`，不进仓库。
- **修掉一个危险命令**：原 `ORG_AUTH_HINT` 只带 2 个新 scope，飞书重新登录会把已授予的 **162 个 scope 全部冲掉**。新增 `npm run org:auth`，生成携带现有全部 scope + 缺失 scope 的登录命令（默认只打印，`--execute` 才发起；仍需本人在飞书确认）。实测 `grantedScopes: 162`、`missingScopes` 为通讯录 / 部门两项。
- **修掉受限环境下的重启失败**：`scripts/up.ts` 的 `restart-bridge` 依赖 `ps` 校验 PID，在禁用 `ps` 的沙箱里直接抛错；改为 `ps` 失败时退回 `lsof` 校验「该 PID 正在监听服务端口」，两者都失败则拒绝停止。修复后 `npm run restart:bridge` 正常，新代码得以加载。

### 2. 前端国内适配（收敛 + 中文化 + 深度改造）

- 构建期 `src/shell-domestic.ts` 精确移除 Paperclip 侧栏两个国内用不到的入口（经典侧栏 + 协调器侧栏共 **4 条规则，全部命中**，`missed: []`）；产物里 `label:"Skills"` / `label:"Connectors"` 归零。修复了一处顺序 bug：必须先按原始英文结构收敛，再跑中文文案替换，否则协调器规则匹配不到。
- 运行时通过**同源静态资源** `suitme-domestic.js` / `.css` 过滤数据驱动的**未连接**海外集成卡片；已连接服务、业务内容与 `.suitme-workbench` 插件页面不动。脚本不含 `fetch` / 外发地址，`index.html` 实测 200 返回注入标记，两个静态资源均 200。
- 中文壳不再「已提交但默认不生效」：`install-upstream.ts` 末尾与 `up.ts` 启动前都会保证构建（`up.ts` 只在标记缺失时重建）。标题改为「SuitMe 协作台」，词典补 15 条。
- 插件设置新增「国内服务」：**只有实测接通才给入口**——`delivery-status` 只读探测 4194 成功才渲染交付台链接；飞书按 `system-status` 显示状态；企业微信 / 腾讯文档 / 钉钉 / Gitee / CNB / 工蜂 / 公有云 CI / Slack / GitHub 等未接通项只做灰字说明，无可点按钮。
- `development.tsx` 的「GitHub 交付」改为「代码交付（本机 Git）」，PR 链接改为本机交付编号；控制器写入的文档标题同步改中文。

### 3. 本机代码交付链路（真跑通，不是模拟）

- `src/local-git.ts` 实现与 `Github` 相同的 `DeliveryAdapter`（`prepare/publish/inspect/preview`），`config.delivery.provider` **默认 `local`**，`server.ts` 注入；`github` 适配器保留可显式回退。
- `npm run delivery:serve` 在 `127.0.0.1:4194` 起中文交付台，并在 `127.0.0.1:9418` 起 `git daemon`（`--export-all --enable=receive-pack`），实测 `git ls-remote git://127.0.0.1:9418/suitme-collab.git HEAD` 返回提交。
- `npm run delivery:demo` 端到端实测：创建裸仓库 → 工作区提交 `collab-pilot/delivery-demo-*.md` → push → 本机 CI `passed`（1 个文件、无冲突、路径合规）→ `git://` **真实 clone + fetch** 成功 → 合并审批 `approved` → 预览固定到确切提交 `526f633a3ee0` → 3 条通知记录。
- 交付台提供仓库 clone/push 命令、分支与提交、交付请求列表、CI 判定、改动文件、审批记录（同意 / 打回 / 登记合并）、通知记录与预览页；只绑 loopback，业务通知沿用现有通道。

### 4. 回归与边界

- `npm test` **266/266**、`tsc --noEmit`、`build:workspaces`、`build:chinese-shell`（4 条规则全命中）、`test:walkthrough` **10/10**（425px `393/393`、按钮 44px、溢出 0）、`test:responsive`、`audit:upstream`（7 submodules clean）、`git diff --check` 全绿。新增 `tests/shell-domestic.test.ts`（6 例）与 `tests/local-delivery.test.ts`（5 例）。
- **严格边界**：合并审批 ≠ 业务验收，`confirmAcceptance` 仍未由真人在真实业务单执行，SUI-129 仍未最终核可；部门 scope 授权仍需本人在飞书确认（脚本不代替）；本机交付台只登记合并，不自动改写业务验收状态；未接通的国内/海外服务没有伪造入口；`lobehub/acceptance` CLI 与云端服务、生产发布、真实 PR / CI、真人多租户、Cognee 原生管线仍未发生。
- 4190 视觉端点与 4192 报告服务在本轮被用户主动取消，未重启；4194 交付台与 3100/4180 正常。

---

## 第九轮：全量功能体检与「国内服务」深度改造（2026-11-07）

用户要求充分检查「国内服务」清单、完整测试最新代码里每个功能是否有 bug 或未完成项，并修复同步。本轮先跑全套回归暴露硬故障，再做状态真实性审查，最后逐项修复并复验。

### 1. 回归暴露的两个真实硬故障

- `npm test` 从 266/266 变成 **265/266**：`tests/v06-services.test.ts:13` 把 `at` 写死为 `2026-11-06T08:00:00.000Z`，而 `requestGrant` 的有效期是 `at + 8h`；`approveGrant` 用真实当前时间判断，UTC 过 16:00 后端到端用例必然报「申请已过期」。这是随日历失效的时间炸弹，已改为 `new Date(Date.now() - 60_000)`，并补静态断言防止复发。其余 20 个含固定日期的测试均显式传入时间做纯逻辑比较，不受影响。
- `npm run build:chinese-shell` 报 `service worker offline styles or placeholder are missing`（上游 `paperclip-sw-build-id` 的 `closeBundle`）：该插件会就地改写 `dist/sw.js` 的占位符，重复构建时占位符已消失。`public/sw.js` 含占位符、`dist/sw.js` 不含，正好印证。构建前从 `public/sw.js` 恢复原始副本后，**连续两次构建均成功**，`hiddenEntries` 4 条、`missed: []`。

### 2. 「国内服务」清单从硬编码文字改为真实数据驱动

- 原实现只探测 `delivery-status`，飞书状态取一次性快照，其余服务是一整段写死的灰字；`useEffect([])` 只加载一次，`system-status` 的 `.catch(() => {})` 完全静默，探测失败被显示成「未接通」。用户按提示启动服务后不刷新页面就永远看不到入口。
- 新增 `src/service-status.ts`：`collectServiceStatus()` 并并发直连 loopback 探测 3100 / 4190 / 4192 / 4194，`buildServiceStatus()` 纯函数组装逐项 `state / detail / url / setup / source`。**只有已接通且 URL 通过 loopback 校验的条目才带 `url`**；未接通项没有 `url` 字段。逐项标注状态来源，区分实时探测、进程内判定与飞书监听器事件推断。
- 交付台健康响应增加服务身份校验（`scope=loopback-only`、`provider=local-git`、端口一致），端口被别的服务占用时不再误判为已接通。Paperclip `/health` 实测返回 SPA HTML 而非 JSON，探测改为「200 + `<html`」判定在线，任意其他 200 不算接通。
- 前端「国内服务」页重写：按本机 / 国内 / 海外分组；每 15 秒自动刷新 + 手动刷新；独立加载态与错误态；唯一生成链接的位置是 `connected && safeLoopbackUrl(url)`。未接通项给出状态、原因与可照做的接通步骤（例如 `npm run delivery:serve`），**没有任何假链接或假按钮**。
- 新增 `service-status` 只读 action，同步进 `server.ts` 的 `readOnly` 与 `members.ts` 的 `reads`；`members.reads` 另补 `trace-view`（其内部已有任务 owner 校验）。

### 3. 全量体检中修掉的其它真实问题

- `system-status` 里 `vectorSearch: true`、`automaticExtraction: false`、`lexicalRecall` 等是写死常量，且 `automaticExtraction:false` 与同对象的 `l2OrganisationExtraction.autoRunOnIndex` 直接矛盾；`visionReviewer` 只看 `visualReviewer.mode`，legacy 模式下仍宣称「Apple Vision 本机端点」。现改为从 `config` 派生，并明确「已配置」与「端点在线」的区别（端点是否在线交给 `service-status` 实时探测）。`ontology.ts` 里写死的 `automaticExtraction:false` 保留并在返回中加说明：它指知识字典实体抽取，与 L2 组织图谱抽取不是同一件事。
- 设置页「服务与架构」原写死「向量检索尚未接入」「自动摄取关闭」，与后端和 `.runtime/config.json` 矛盾；改为消费 `system.integrations` / `knowledgeEngine` 的真实字段。模型配置与系统状态两个读请求改为分别降级，任一失败不会让另一块永久停在「正在读取」；保存失败新增就地 `role="alert"`，成员视图禁用仅操作员可用的保存按钮。
- 修掉界面里与实际配置矛盾的文案：协作网络页「向量语义检索与新模型服务仍未启用」、知识字典「已保存；未启用自动抽取」、独立评审就绪页夸大「本机视觉模型核对截图内容」。
- 清掉本轮发现的海外/旧链路残留：`index.tsx` 任务上下文里的「GitHub 交付 / PR # / 代码检查」改为「代码交付（本机 Git）/ 交付 # / 本机代码检查」，`development.tsx` 的「交付 PR 与预览」改为「交付代码与固定版本预览」；普通外链统一经 `safeHttpUrl()` 挡掉 `javascript:` 等协议，服务链接经 `safeLoopbackUrl()` 只放行本机。
- README 中与默认 `delivery.provider=local` 矛盾的「成果进入 GitHub」「已登录的 GitHub CLI」「Actions 产物」「作者自行合并、Actions 发布」「GitHub CI」等一并更新。

### 4. 复验结果

- `npm test` **278/278**（新增 `tests/service-status.test.ts` 12 例：全接通 / 全停机 / 冒名服务 / legacy 降级 / URL 白名单 / 并发失败隔离 / 三处白名单一致 / 健康响应身份校验 / 状态字段来源 / 构建幂等 / 时间炸弹 / Paperclip HTML 回退）。
- `npx tsc --noEmit`、`npm run build:workspaces`（含插件 UI 类型检查）、`npm run build:chinese-shell` 连续两次、`npm run test:responsive`（425px 无溢出、按钮 44px）、`npm run audit:upstream`（7 submodules clean）、`git diff --check` 全绿。
- `npm run test:walkthrough` **11/11**（新增 `domestic-services-1280` 步骤）：真实浏览器测得国内服务页 **12 行状态、仅 2 个链接**（`http://127.0.0.1:3100/`、`http://127.0.0.1:4194/`）、`badLinks: []`、有刷新按钮、未接通项有接通步骤；425px `393/393`、溢出 0。
- 真实 HTTP 冒烟：重启 Bridge 后 `service-status` / `delivery-status` / `system-status` 均 200；`service-status` 返回的 `paperclip / bridge / delivery` 为 connected，4190 / 4192 与外部服务如实为 unavailable；重启瞬间飞书监听器为 `connecting` 时页面显示「未接通」而非假「已连接」，证明状态是实时的。

### 5. 严格边界（未发生，不是 bug）

合并审批 ≠ 业务验收；真人仍未在真实业务单上执行中文「确认验收」，SUI-129 未最终核可；部门 scope 授权仍需本人在飞书确认；企业微信 / 腾讯文档 / 钉钉 / 国内代码托管 / 公有云 CI 及海外 SaaS 均未接通，按约定没有入口；4190 与 4192 保持用户取消时的停机状态，未重启；生产发布、真实外部 PR / CI、真人多租户、Cognee 原生模型管线、`lobehub/acceptance` CLI 与云端报告仍未发生。`system-status` 里的 `modelApi / objectStorage / multiUserSso: false` 与 `offsiteRestoreVerified: false` 是如实标注未完成，不是伪装成已启用。

### 6. 真实截图复核后的补充修复

首轮走查虽然 11/11，但人工查看 `domestic-services-1280.png` 又发现两个体验问题，已一并修复并复验：

- **宿主侧栏残留入口**：走查新增的 DOM 诊断显示侧栏仍是 `<a href="/SUI/skills">` / `<a href="/SUI/apps">`——带公司前缀，而运行时脚本的路由正则只匹配 `/skills` / `/apps` 开头，构建期 4 条规则也没覆盖这种运行时拼接的路径。改为显式 `ROUTE` 正则 `^\/(?:[A-Za-z0-9_-]+\/)?(skills|apps)(\/|$)`，并同时隐藏链接与其 `li` 容器；新增单测验证 `/SUI/skills`、`/SUI/apps`、`/SUI/skills/studio` 命中而 `/SUI/knowledge-workspaces`、`/SUI/skills-other` 不误伤。走查增加禁用浏览器缓存与 `hostNavHidden` 断言，实测两个入口 `hidden: true`，截图中侧栏只剩「代理 / 审计记录」。
- **轮询抖动打扰用户**：自动刷新偶发 `Failed to fetch`（走查虚拟时间下 15 秒轮询被快速触发）时，页面弹出红色「状态探测失败」却仍保留完整数据。改为：自动轮询失败静默保留上一次结果，只在「最近探测」行标注「自动刷新暂未成功，当前为上次结果」；首次加载或用户手动点「刷新状态」失败才给明确提示，且已有数据时用温和文字而非红色错误框。走查新增 `noLoadError` 断言。

复验：修正后 `npm test` **278/278**、`tsc`、`build:workspaces`、`build:chinese-shell`、`test:walkthrough` **11/11**、`test:responsive`、`audit:upstream`、`git diff --check` 全绿；国内服务页实测 12 行、2 个 loopback 链接、0 个坏链接、无加载错误、宿主侧栏两个未接通入口已隐藏。

---

## 第十轮：前端分层重构、产品架构梳理与白屏故障修复（2026-11-07）

### 1. 为什么要改

前端 `plugins/knowledge-workspaces/src/ui/index.tsx` 单文件 527 行、35 个顶层声明，混合了 UI 原语、中文文案字典、任务详情、知识空间、设置与页面壳；`v06-panels.tsx` 另有一份重复的 `useRead` 状态机；13 处 `.catch(() => {})` 依赖页面顶部错误条，用户在表单里看不到失败原因；多个源码字符串测试直接读 `index.tsx`，把结构锁死。用户同时指出此前只讲了技术分层，产品与业务架构不清楚。

### 2. 改了什么

- **分层**：`index.tsx` 缩为 5 行入口（`WorkspacePage` / `WorkspaceSidebar` 再导出）；新增 `foundation.tsx`、`async.ts`、`forms.tsx`、`domestic-services.tsx`、`settings.tsx`、`task-detail.tsx`、`spaces.tsx`、`workspace-page.tsx`。最大模块 191 行，依赖单向（基础设施 → 视图 → 页面壳 → 入口），`v06-panels.tsx` 改用共享 `useRead`。**零路由变化、零 tab 变化、零上游改动**。
- **错误与外链**：13 处静默 catch 收敛为「两个高频表单用 `useActionFeedback` + `ActionError` 就地提示，其余统一 `UI.report` 上报」，只保留页面壳两处写明理由的静默（后台轮询不打扰、`invoke` rethrow）；`RecordBody` 的知识来源与 Spaces 的飞书来源外链改走 `safeHttpUrl`；「国内服务」补 `ServiceEntry` / `ServiceReport` 类型契约。
- **测试**：新增 `tests/frontend-structure.test.ts` 5 例（入口瘦化、原语单一来源、依赖单向、异步契约与错误上报、入口与外链红线）；`service-status` / `shell-domestic` / `v06-workbench` / `workspace-action` 四处静态断言改为按职责读模块或扫描整个 ui 目录。
- **产品与业务架构**：`SYSTEM-ARCHITECTURE.md` 新增定位、渠道形态、三级 owner 与角色职责、8 步端到端闭环（4 个人工决策点）、5 tab 功能地图、功能成熟度三档与 5 条业务红线；`PRD-v0.6.md` 10A 工作台文件指针同步；`ADAPTATION-v0.6.md` 第十轮成为最新边界声明。

### 3. 真实浏览器暴露的白屏故障（本轮最重要的发现）

首轮全套回归里 `test:walkthrough` **11 步全失败**，截图全白。CDP 诊断显示：DOM 已渲染（`root.innerHTML` 64159 字符、工作台本身 19434 字），但 `document.body.innerText` 为 0，且**没有任何 JS 异常**；`[data-suitme-hidden]` 有 4 个元素，其中第一个是宿主外壳 `div.contents`，reason `unconnected-overseas`。

根因：`src/shell-domestic.ts` 的运行时 `sweep()` 遍历 `a,button,[role="button"],[data-testid]`，带 `data-testid` 的大容器也被当作候选，并用**容器全文**做关键字匹配。页面文本同时含海外词与「连接」、又不含「已连接」时，整个外壳被隐藏——状态相关、间歇性，上一轮走查通过只是当时文案恰好不满足条件。

修复：候选只保留小型可交互节点；新增 `MAX_LABEL`(120) / `MAX_CARD`(400) / `MAX_HIDE`(600) 长度上限；`protectedEl()` 拒绝 body / html / `#root` / 含 `.suitme-workbench` 的容器；`repair()` 每轮自愈已误隐藏的大容器。走查每步新增 `bodyTextLen` / `shellHidden` 断言，单测补 8 条静态守门。

修复后实测：11 步 `bodyTextLen` 590–1774 全非空、`shellHidden: false`、隐藏元素恒为 3 个未接通海外入口（技能 / 连接服务 / Explore connectors），11/11 通过。

### 4. 回归结果

| 项 | 结果 |
|---|---|
| `npm test` | **283/283**（新增 5 例结构守卫） |
| `npx tsc --noEmit`（主工程 + 插件 tsconfig） | 通过 |
| `npm run build:workspaces`（esbuild 打包 + 插件类型检查） | 通过，产物导出 `WorkspacePage` / `WorkspaceSidebar` 正常 |
| `npm run build:chinese-shell` | 通过，`hiddenEntries` 4 条、`missed: []` |
| `npm run test:responsive` | 通过，425px 0 溢出、按钮 44px |
| `npm run test:walkthrough` | **11/11**，白屏守卫全绿 |
| `npm run audit:upstream` | `clean: true` |
| `git diff --check` | 通过 |

环境说明：后台沙箱内跑 `build:chinese-shell` 时，Vite `emptyOutDir` 需批量删除 `ui/dist/assets` 391 个文件，被运行环境的 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`（阈值 50）拦截而退出 1；在已授权的前台环境同一命令退出 0、产物正常。**这是工具环境的批量删除保护，不是代码缺陷**，其余 7 项在沙箱内也全绿。

### 5. 严格边界（未发生，不是 bug）

本轮是结构重构 + 文档，**没有新增业务功能、tab 或路由**；真人在真实业务单上「确认验收」仍未发生（SUI-129 未核可）；部门 scope 授权仍需本人在飞书确认；企业微信 / 腾讯文档 / 钉钉 / 国内代码托管 / 公有云 CI 及海外 SaaS 均未接通，按约定没有入口；4190 / 4192 保持用户取消时的停机状态；生产发布、真实外部 PR / CI、真人多租户、Cognee 原生模型管线仍未发生。合并审批 ≠ 业务验收，报告 / 模型判定 / CI 通过都不替代原发起人在原会话「确认验收」。

---

## 第十一轮：方案 A 落地、Cognee 原生管线打开、合并与发布自动化（2026-11-07）

### 1. 用户决策与事实校正

用户明确：允许外部模型 API 并打开 Cognee 原生 LLM / embedding / cognify；本机合并与发布都放开但真人业务验收仍是红线；`A → B → C` 分阶段不并行；补齐 `sources.lock.json` 缺登记。

核对结论：`sources.lock.json` **早已登记** Harness `fcc0ad46…` 与 Prime Agent `74591cdd…`，`audit:upstream` `clean: true`。「缺两条」来自 `OPEN-SOURCE-COMPLIANCE.md` 两行过时 ⚠️ 标记。本轮修正文档并加机器化断言（`tests/architecture-contracts.test.ts` 逐条比对 7 个 gitlink 与锁文件、且合规文档不得再出现过时告警），**没有重复补登记**。

### 2. 方案 A（第一阶段，已完成）

`src/architecture-contracts.ts` 成为组织本体常量、ontology 三层分工、Agent 角色、记忆投影与 `memoryEventSchema` 的单一来源；`org-ontology.ts` 改为引入并再导出，行为不变（原有 `validateOrgGraph` 5 个函数与 16 类节点 / 5 边族全部回归通过）。`docs/ARCHITECTURE-OPTIONS-v0.7.md` 增附录 A 统一 FR 覆盖三态口径。

### 3. Cognee 原生管线（允许外部模型 API）

- 配置 `knowledge.cogneeNative`（默认打开）只存环境变量名；`src/cognee-native.ts` → `scripts/cognee-native.py` 走 Cognee 原版 `add / cognify(extractor='llm') / search`，provider 为 `custom` + 外部 OpenAI-compatible 端点；数据目录固定 `.runtime/cognee-native/`。
- 凭据仅经 `spawn` 环境传递，不写 `.runtime/config.json`、`secrets.json` 或仓库；`cogneeNativeStatus()` 只返回布尔与模型名，不返回 Key / 端点值。
- 真跑 `npm run cognee:native -- status`：`enabled: true, configured: false, missing: [COGNEE_LLM_BASE_URL, COGNEE_LLM_API_KEY, COGNEE_EMBEDDING_BASE_URL, COGNEE_EMBEDDING_API_KEY]`。**真跑 cognify 需要用户提供外部端点与凭据；本轮未向任何外部服务发送业务材料。**
- `ontology.ts` 的 `automaticExtraction`、`system-status` 的 `modelApi / cogneeNative / externalLlmCallsNote`、设置页「Cognee 原生管线」一行均改为配置派生，不再写死关闭或「不调用外部模型」。

### 4. 本机自动合并与自动发布

- `delivery.autoMerge / autoPublish` 默认 `true`；`decide('approved')` 在 `ci === 'passed'` 时自动校验 fast-forward 并 `update-ref` 推进本机 main，随后写固定版本预览制品；非 fast-forward 明确报错并留可见通知。
- 真跑 `npm run delivery:demo`：`ci: "passed"` → `approvalStatus: "merged"`、`mergeSha: c777106e2e7e`（与 `mainSha` 一致）、`publishedAt: 2026-11-07T08:10:14.480Z`、`notifications: 5`。`git daemon` 未启动，`gitProtocolClonePull: false`（用户已取消 4194/9418，本轮未重启）。
- 业务验收红线未动：`local-git.ts`、交付台预览页与 demo 输出均写明「业务验收仍须由原发起人在原会话『确认验收』」；仍不发布业务仓库、不触发云端 CI、不做无人值守验收。

### 5. 回归结果

| 项 | 结果 |
|---|---|
| `npm test` | **294/294**（新增 5 例架构契约、5 例 Cognee 原生、1 例自动合并发布） |
| `npx tsc --noEmit` | 通过 |
| `npm run build:workspaces` / `build:chinese-shell` | 通过 |
| `npm run test:responsive` / `test:walkthrough` | 通过 / **11/11** |
| `npm run audit:upstream` | `clean: true` |
| `git diff --check` | 通过 |

排障记录：全套回归首次 `test:walkthrough` 11 步全失败，页面正文仅 93 字；根因是 **3100 Paperclip 服务意外停机**（`status: paperclip: stopped`）与 4180 Bridge 继承失效代理导致 `connect failed: Connection refused` / 502。按既有流程用干净环境 `npm run up` 恢复 3100、`npm run restart:bridge` 重启 4180 后复跑 11/11 通过。**不是代码回退**，4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态，未重启。

### 6. 严格边界（未发生，不是 bug）

Cognee `cognify` 的真实外部模型调用未发生（缺端点与凭据）；**方案 B 记忆主干重构与方案 C 三层 router 尚未开始**，按 A → B → C 排队；真人在真实业务单「确认验收」仍未发生（SUI-129 未核可）；生产发布 / 业务仓库发布、无人值守最终验收、知识自动采用仍不做；`.runtime` 运行证据不入库。

> 以上是**该轮次当时的历史边界**，按约定原样保留。B（B1 + B2）已于第十四轮完成并验证，C 已于第十五轮启动；最新边界见本文第十五轮与第 4 节补遗，以及 `ADAPTATION-v0.6.md` `0.0000000000000000` 节。

---

## 第十二轮：统一路由契约、共享 Trace、三层判断与宿主解耦（2026-11-07）

### 1. 用户决策与范围

把散在 5 个文件的「谁把任务交给谁」抽成 `RoutingDecision` 契约（调用方 / 目标角色 / 依据 / 资料范围 / 是否需人签字），让它们写同一份 Trace；据此判断要不要引入 LobeHub 三层；B 阶段记忆事件复用该契约；可复用尽量复用、可参考尽量参考（LobeHub 不复制代码、Super Agent / Autoloop 直接复用）；Paperclip 平台底座与 Plugin SDK 不再作为长期依赖，改用 DeepSeek Harness / Pi / 已复用部分或其它高 star 系统；然后 **B → C，不并行**。方案全文见 `docs/ROUTING-AND-HOST-v0.7.md`。

### 2. 落地内容（A 收尾 + B 前置）

| 文件 | 内容 |
|---|---|
| `src/architecture-contracts.ts` | `MEMORY_EVENT_KINDS` 新增 `routing-decided`，让路由决策成为共享记忆主干的一种事件 |
| `src/routing-decision.ts` | 五维契约 + stage / outcome / causedBy / 幂等 `decisionId`；`HUMAN_SIGNATURE_RULES` 五条红线；`toMemoryEvent()` / `decisionOf()` |
| `src/routing-trace.ts` | 单例 Trace、append-only JSONL、可选 SQLite audit 投影、`readRoutingEvents()` / `replayRouting()`；测试进程经 `COLLAB_TEST_TRACE=memory` 隔离 |
| `src/three-tier-assessment.ts` | 7 条前置条件的可执行三层判断，含许可证与玉伯 OPT 反面依据 |
| `src/platform-port.ts` | `HostPlatformPort` + `PaperclipPlatform`（默认）+ `LocalHostPlatform`（非 Paperclip 最小宿主） |
| `src/server.ts` / `src/members.ts` | `attachAudit()` 一次；只读 `routing-status` 与两处白名单 |
| `scripts/routing-status.ts` / `scripts/host-smoke.ts` | 两个新 CLI（`npm run routing:status` / `npm run host:smoke`） |
| `scripts/test.ts` | 测试子进程设 `COLLAB_TEST_TRACE=memory`，避免测试动作污染真实业务 Trace |

**5 处接线（静态自检 `allWired: true`）**：`controller.ts` 3 处（ingest / createTask / handoff）、`coordination.ts` 1 处（可注入 trace，判断与返回值未改）、`assistant.ts` 1 处、`service-network.ts` 2 处、`v06.ts` 2 处（transferCreate + guardDispatch，拒绝时额外记 `rejected` 后原样 rethrow）。**只加记录，不改任何运行路由判断。**

### 3. 真实冒烟（不是单测模拟）

- `npm run host:smoke`：`ok: true`。health `ok / local-file-host`、创建任务、`idempotencyKey` 幂等、文档修订 1→2 且未变更不升版、读回 `版本：2`、patch 状态、评论、wakeup、journal 6 条、heartbeat-run、未实现 route 明确报错、路径穿越被拒。
- 真实调用 Super Agent `admitPreparation` 两次，写入干净业务 Trace 2 条（`admissible: true / false`），`logErrors: []`。
- 重启 Bridge 后真实 HTTP `POST /workspace/routing-status` 返回 `200`、`ok: true`、`eventCount: 2`、`projection.byStage: {admission: 2}`、`threeTier.recommended: false`、verdict「暂不引入三层：继续 A 的契约收敛并先完成 B」。
- **测试隔离验证**：全套 `npm test` 跑完后业务 Trace 仍是 2 条，说明测试事件只进内存 sink；隔离前的混合日志已归档为 `.runtime/routing/events.pre-isolation.jsonl`。
- `npm run routing:status`：5 个文件 `wired: true`，`allWired: true`。

### 4. 三层判断（真实数据）

7 条前置条件中 P2（重放无坏行）、P5（高风险人签完整）、P7（LobeHub 仅借思想）满足；**P1 五阶段覆盖、P3 Personal Agent 入口、P4 主管实体、P6 单一 Router 未满足**，覆盖率 5/7。结论：暂不引入 LobeHub 三层，先完成 A 的契约收敛并跑通 B。

### 5. 回归结果

| 项 | 结果 |
|---|---|
| `npm test` | **303/303**（新增 9 例路由 / Trace / 三层 / 平台端口测试） |
| `npx tsc --noEmit`（主工程 + 插件构建链） | 通过 |
| `npm run build:workspaces` | 通过 |
| `npm run build:chinese-shell` | 通过，`hiddenEntries` 4 条、`missed: []` |
| `npm run test:responsive` | 通过，425px 0 溢出、按钮 44px |
| `npm run test:walkthrough` | **11/11**，`failures: []` |
| `npm run audit:upstream` | `clean: true`、`problems: []` |
| `npm run host:smoke` / `npm run routing:status` | 均 `ok: true` |
| `git diff --check` | 通过 |

排障：本轮开始时 3100 Paperclip 意外停机（health 000），按既有流程用干净环境 `npm run up` 恢复（`paperclip: ready`、`bridge: already running`）；4190 / 4192 / 4194 / 9418 复核仍为 000，保持用户取消时的停机状态。

### 6. 严格边界（未发生，不是 bug）

本轮**没有改运行路由判断、没新增 tab / 路由、没切换默认底座、没改上游源码、没引入任何新上游依赖**；`config.host.provider` 默认仍是 `paperclip`，Plugin SDK 未移除（完整切换需补齐 ACL / cost-ledger / Plugin UI / heartbeat 真实执行 / PG 事务五项，且与 PRD §10A「5 tab 插件单页」存在产品形态冲突，待用户确认）。方案 B 记忆主干与 C 三层 router 尚未开始；真人在真实业务单「确认验收」（SUI-129 未核可）、Cognee 原生 `cognify` 真实外部调用、生产发布均未发生。`.runtime/routing/`、`.runtime/local-host/` 与真实身份信息不入库。

---

## 第十三轮：方案 B1 共享记忆事件主干与四类投影（2026-11-07）

### 1. 用户决策与范围

「开始 b 阶段吧」。按 **A → B → C 不并行**，落地方案 B 的主干与验收口径。三条红线：重放可复现、来源撤权后派生记忆不可召回、确定性链路 `modelCalls=0` 不破。完整方案见 `docs/MEMORY-ARCHITECTURE-v0.7.md`。

### 2. 落地内容

| 文件 | 内容 |
|---|---|
| `src/architecture-contracts.ts` | `memoryEventSchema` 增 `modelCalls` / `projection` / `visibility`；新增 `source-revoked` / `grant-revoked` / `memory-indexed` / `projection-rebuilt`（共 12 种 kind） |
| `src/memory-log.ts` | append-only `.runtime/memory/events.jsonl`、幂等、advisory 双写、SQLite audit 投影、坏行报错；`readBridgedEvents()` 并入 `routing-decided`；`bridgeRoutingEvent()` 归一化业务 causedBy |
| `src/memory-projections.ts` | 纯函数重放 L1 证据图 / L2 组织图 / BM25 向量 / Context Pack；稳定 checksum；撤权沿 `causedBy` lineage 传播；投影 + 召回双层过滤；`sourceRevocations` 与严格 `revokedSourceIds` 分层；`assertDeterministic()` |
| `scripts/memory-replay.ts` / `scripts/memory-smoke.ts` | 只读重放报告 / 临时目录真跑完整链路 |
| `src/server.ts` / `src/members.ts` | 只读 `memory-replay` 与两处白名单；`getMemoryLog().attachAudit` |
| `scripts/test.ts` | `COLLAB_TEST_MEMORY=memory` 隔离测试动作 |

**8 处真实写入点双写**：`workspaces`（createSource / reviewSource / revoke，3）、`v06`（l2Extract / edgeAccept / edgeInvalidate / contextPack，4）、`team-memory.index`（1）、`controller`（accept / confirmAcceptance，2）。全部 advisory，原存储照常工作。`v06.contextPack` 构建前按 `sourceRevocations` 剔除撤权来源证据边，核对失败 **fail-closed**。

### 3. 真跑证据（不是单测模拟）

`npm run memory:smoke`（`ok: true`，临时日志）：

| | 撤权前 | `source-revoked` 后 |
|---|---|---|
| 事件数 | 5 | 6 |
| 四类投影 | L1 1 / L2 1 / BM25 2 / Pack 1 | 派生投影全部 0 |
| 召回「验收 知识」 | 1 命中 | **0 命中** |
| `excludedByRevocation` | 0 | **4** |
| `modelCalls` / `replayTwiceEqual` | 0 / true | 0 / true |

`npm run memory:replay`：`allWired: true`（5 文件）、`eventCount: 5`、`bridgedRoutingEvents: 2`、`replayTwiceEqual: true`、`deterministic: true`、`modelCalls: 0`、`contextPacks: 1`、`logErrors: []`、`danglingCausedBy: []`、`duplicateIds: 2`。

**真实业务动作已触发双写**：走查的真实 workspace action 调用了 `v06.contextPack`，日志产生 3 条 `context-packed`（同 id、不同进程各写一次）。桥接层**不去重**，由 `replayMemory` 如实记入 `integrity.duplicateIds` 再去重为 1 个 Context Pack——append-only 日志的标准做法，没有把跨进程重复悄悄藏起来。

真实 HTTP `POST /workspace/memory-replay` → `200`、`ok: true`、`eventCount: 5`、`replayTwiceEqual: true`、`deterministic: true`、`modelCalls: 0`、`duplicateIds: 2`、`logErrors: 0`。

**真实 HTTP 冒烟抓到的两个语义冲突（已修）**：① 路由事件的 `causedBy` 是业务标识（triggerId / phase），并入主干会误报悬空 lineage → `bridgeRoutingEvent()` 归一化到 `payload.routingCausedBy`；② 投影层已排除失效事件时召回层无对象可计数 → `suppressedByRevocation` 让两层拦截量都如实上报。

### 4. 回归结果

| 项 | 结果 |
|---|---|
| `npm test` | **315/315**（新增 12 例 B 阶段测试） |
| `npx tsc --noEmit` | 通过 |
| `npm run build:workspaces` / `build:chinese-shell` | 通过（`hiddenEntries` 4、`missed: []`） |
| `npm run test:responsive` | 通过，425px 0 溢出、按钮 44px |
| `npm run test:walkthrough` | **11/11**，`failures: []` |
| `npm run audit:upstream` | `clean: true` |
| `npm run host:smoke` / `routing:status` / `memory:replay` / `memory:smoke` | 均 `ok: true` |
| `git diff --check` | 通过 |

排障：本轮 3100 再次意外停机，`npm run up` 因 Paperclip 冷启动超过 45 秒报 `did not become ready`；随后 `npm run status` 显示 `paperclip: running`、日志 `Server startup recovery complete`、health 200，属既有冷启动超时而非服务故障。4190 / 4192 / 4194 / 9418 复核仍全为 000，保持用户取消时的停机状态。

### 5. 严格边界（未发生，不是 bug）

**B1 已完成**；**B2 尚未做**：把 `TeamMemory.search` 等读取链正式切到投影消费、`grant-revoked` 按 principal 精确过滤、投影增量构建。原 Cognee / Ladybug / SQLite / Paperclip 文档仍是实际读取源，事件写入失败不影响业务。C（三层 Router 与平台底座切换）排在 B2 验收之后，未开始。真人在真实业务单「确认验收」（SUI-129 未核可）、Cognee 原生 `cognify` 真实外部调用、生产发布仍未发生。`.runtime/memory/`、`.runtime/routing/` 不入库，chunk 文本截断 200 字。

> 以上为**第十三轮当时的边界**，B2 已于第十四轮完成并验证；最新边界见第十五轮与 `ADAPTATION-v0.6.md` 的 `0.0000000000000000` 节。

---

## 第十四轮：方案 B2 读取链消费投影、精确撤权、真实链路与增量 checkpoint（2026-11-07）

用户指令：从 `HANDOFF/` 继续完成当前真实待办。按 **A → B → C 不并行**，本轮收尾 B 阶段第二阶段并做全量回归、文档同步、提交推送。

### 1. 四项交付与对应验收

| # | 交付 | 验收证据 |
|---|---|---|
| 1 | `src/memory-recall.ts`：`projectRecallHits()` 按 `sourceId@revision` 白名单裁剪后，`fuseProjectionHits()` 把投影命中作为**第三路**信号接入 `TeamMemory.search`；`projectionRecall()` 读真实主干重放，`modelCalls=0` | `tests/memory-recall.test.ts` 5 例：白名单裁剪、三路融合、原分数不覆盖、**接线顺序（权限重评之后才消费投影）**、principal 精确撤权；读日志失败 advisory 降级 |
| 2 | `src/memory-projections.ts`：`grant-revoked` 只登记 `principalRevocations`，`recallMemory(..., { principal })` 精确排除；未指定主体 fail-closed；`source-revoked` 仍全局阻断 | `tests/memory-replay.test.ts` 新增「A 撤权不影响 B 的同源记忆」与分层断言 |
| 3 | `scripts/memory-journey.ts`：真实 bridge action 跑 8 步完整知识事件链并端到端撤权，只新建一条专用资料、末尾撤回 | `ok:true`、9/9 checks（含 `lineageComplete`）；证据 `.runtime/memory-journey.json`（不入库） |
| 4 | `src/memory-checkpoint.ts` + `scripts/memory-checkpoint.ts`：checkpoint + 增量应用；撤权 / 乱序 / 失效祖先 / 已撤回来源 / checksum 不一致回退全量 | `tests/memory-checkpoint.test.ts` 6 例；真实日志 `mode:incremental, applied:1, fallback:null, checksumEqual:true` |

### 2. 真跑数据（不是单测模拟）

`npm run memory:journey`（真实 4180 action）：

| | before | `review-source/withdrawn` 后 |
|---|---|---|
| 本次资料四类投影 | L1 1 / L2 2 / BM25 1 / Pack 1 | **0 / 0 / 0 / 0** |
| 召回「验收 知识 来源」 | 1 命中 | **0 命中** |
| 沿 lineage 失效的事件 | 0 | **5** |
| 本次资料悬空 lineage | 0 | **0**（`lineageComplete:true`） |
| `replayTwiceEqual` / `deterministic` / `logErrors` | true / true / 0 | true / true / 0 |

`npm run memory:checkpoint`：`--reset` 全量重建 30 事件后，用真实 `v06-context-pack` HTTP 追加 1 条普通事件，再跑得到 `mode:incremental, applied:1, fallback:null, checksumEqual:true`（31 事件）；journey 追加撤权事件时按预期 `fallback:retroactive-event` 回退全量，`checksumEqual:true`。`tests/memory-checkpoint.test.ts` 另覆盖分批增量、重复行、跨批撤权与全量 checksum 逐字节对照。

### 3. 真跑暴露并修掉的三个真实缺陷

1. `view.spaces` 是数组，脚本用 `Object.entries` 取到索引 `0`，`domain` 变成 `"0"` → 「知识空间不存在」。已改 `Array.isArray` 分支。
2. `memory-index` 会自动先跑一次 L2 抽取，手工再抽时任务级镜像只补新节点、未带入「全局已有但本任务图没有」的节点 → `validateOrgGraph` 报悬空边。新增 `src/org-extraction.ts::buildTaskGraphMirror()` 并补 `tests/l2-extraction.test.ts`。
3. 复核真实 `memory:replay` 发现 6 条 `danglingCausedBy`：`knowledge.review()` 会把资料推进到**新 revision**，而 `src/workspaces.ts::reviewSource` 仍用评审前 revision 写来源事件，确认事件与 `createSource` 幂等键相撞被去重，主干缺少派生事件的 `sourceEventId(新版本)` 锚点。已改用评审后的 `reviewedRevision`，补 2 例回归（版本前进后的完整 lineage + 接线守卫），并把 `lineageComplete` 加进 journey 验收条件。**历史 append-only 日志中的旧悬空行不物理删除**，重放如实记录。

### 4. 全套回归结果

| 项 | 结果 |
|---|---|
| `npm test` | **329 / 329**（B2 新增 12 例 + 收尾 2 例） |
| `npx tsc --noEmit` | 通过 |
| `build:workspaces` / `build:chinese-shell` | 通过 / `hiddenEntries` 4、`missed: []`、`warning: null`（前台重跑，后台沙箱批量删除保护属已知坑） |
| `test:responsive` | 425px `393/393`、溢出 0、按钮 44px |
| `test:walkthrough` | **11 / 11**，`failures: []` |
| `audit:upstream` | `clean: true`、`problems: []` |
| `memory:replay` / `memory:smoke` / `routing:status` / `host:smoke` | 均 `ok:true`；三层判断仍 `recommended:false`（5/7） |
| `git diff --check` / staged 敏感扫描 | 通过 / 无 `.runtime`、无真实身份 |

### 5. 严格边界（未发生，不是 bug）

**B 阶段（B1 + B2）已验收通过，但不等于可以自动开始 C**：C 的底座切换与「5 tab 插件式单页」形态冲突，需先由用户拍板；三层判断仍 `recommended=false`。**原 Cognee / Ladybug / SQLite / Paperclip 存储仍是主读取源**，投影是权限重评之后的第三路叠加信号，不是替换底座；事件写入失败不影响业务。真人在真实业务单「确认验收」（SUI-129 未核可）、Cognee 原生 `cognify` 真实外部调用、生产发布、真实外部 PR/CI、全员 SSO、飞书部门 scope 重新登录仍未发生。`.runtime/memory/`、`.runtime/routing/` 不入库，chunk 文本截断 200 字；4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态。

> 以上为**第十四轮当时的边界**；第十五轮用户已拍板 ② 解除产品形态冲突，C 正式启动。最新边界见下节与 `ADAPTATION-v0.6.md` 的 `0.0000000000000000` 节。

---

## 第十五轮：产品思路复盘与方案 C 启动（2026-11-07 · C-0）

**性质**：仅文档与任务清单改动，**未改任何运行代码**；运行基线仍是第十四轮提交 `8d3c455`（329/329、走查 11/11、上游 clean）。

### 1. 用户拍板与产品复盘

- 用户拍板 **② 改成独立前端应用**：废弃 `PRD §10A` 的 S5 / S6，保留 S1–S4；**飞书 IM 仍是唯一发起入口**，工作台仍只做授权 / 留痕 / 审阅 / 签字，不新增网页发起入口。
- 用户复述并确认三层汇报：每人一个 Personal Agent 替人过滤信息 → 每项目一个主管 Agent 派活和验收 → Codex / Claude Code 等执行 Agent；人只听自己的 Personal Agent，中途插手通过 Task 卡片开工单，Agent 间交接上下文原封不动。
- **两篇材料分工**：赛博禅心《如何让 Super-agent 成为同事：LobeHub 的组织实验》（组织维度）；腾讯程序员《多 Agent 协作的下一场竞争，不在模型，而在上下文》（2026-11-06，作者 poppylili，Siboot：群是场 / Topic 是焦点 / @ 是接力 / 文件是记性，信息维度）。后者只读公开文章、不引代码、不接服务。
- **复盘结论**：本产品做的是「有限可见、责任可追究的共享现场」；与全可见群、人只在验收出现一次有两点刻意不同（默认隔离 + 按身份重评；人在链路上多次签字）。最关键一句：**三层 = 同一份共享现场的三种座位，不靠摘要转发**——三层多一跳转发，若靠转述会让上下文折损按乘法加倍重现，B1/B2 的 append-only 主干 + 四类投影 + Context Pack 正是让三层不丢上下文的地基。
- 建立 C-0 ~ C-5 分步任务清单；三层判断仍 `recommended=false`（覆盖率 5/7），**C-5 前不放开主管 Agent 自主派活**。

### 2. 本轮验证（文档改动范围）

| 项 | 结果 |
|---|---|
| `HANDOFF/handoff-manifest.json` JSON 解析 | 通过 |
| `git diff --check` | 通过 |
| 运行代码 / 默认底座 / 上游 | 均未改动；`config.host.provider` 仍 `paperclip`，未移除 Plugin SDK，未引入新上游 |
| 全套回归（单测 / tsc / 构建 / 走查 / 上游审计） | **本轮未重跑**（无运行代码改动，沿用第十四轮 329/329、走查 11/11）；**C-1 起每次代码改动必须重跑全套** |

### 3. 严格边界（未发生，不是 bug）

- C-0 未改运行路由判断、未新增 tab / 路由、未切换默认底座、未移除 Plugin SDK、未改上游源码、未外发任何业务材料。
- 真人业务验收（SUI-129 未核可）、Cognee 原生 `cognify` 真实外部调用、生产发布 / 业务仓库发布、真实外部 PR·CI、全员 SSO、飞书部门 scope 重新登录仍未发生。
- `.runtime/` 下真实身份 / 密钥 / 业务正文不入库；4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态，**不得重启**。

### 4. 第十五轮补遗（C-0b：可配置组织形态与自演进）

本小节**只有文档与任务清单改动**：`docs/PRD-v0.6.md` 新增 §10C（C-P1~C-P5）、`docs/ADAPTATION-v0.6.md` 最新边界新增第 6 小节、`docs/ROUTING-AND-HOST-v0.7.md` 新增 6.1、`HANDOFF/` 的 03 / 06 / 08 与 `handoff-manifest.json` 同步。核对过的现有地基（只读，未改一行）：`acceptance-plan.ts` 锁定清单、`acceptance-round.ts` 逐项判定 / 部分打回 / `selfCheckStandards()`、`acceptance-report.ts` 的 `recordSelfCheck()` 幂等原子写且明确「不自动改写已锁定的验收清单」、`independent-review.ts` 评审者独立性、`runtime-guard.ts` 的 fast → semantic → budget、`runtime-bridge.ts` 的 `enforce` 与 `protectHumanNotifications`、B1/B2 的 `modelCalls` 记账与确定性重放。

| 项 | 结果 |
|---|---|
| `HANDOFF/handoff-manifest.json` JSON 解析 | 通过 |
| `git diff --check` | 通过 |
| 运行代码 / 默认底座 / 上游 | 均未改动；`config.host.provider` 仍 `paperclip`，未移除 Plugin SDK，未引入新上游，未外发业务材料 |
| 全套回归 | **未重跑**（无运行代码改动，沿用第十四轮 329/329、走查 11/11）；**C-1 起每次代码改动必须重跑全套并在此追加新记录** |

**当时未落地、已在后续轮次完成（C-4 / C-5 / C-6，均不算 bug）**：验收作为可配置协作 Agent、自查标准回流到交付前强制比对、候选改进的评估 / 人审 / 版本 / 灰度 / 回滚、单任务成本与效果看板、`assessThreeTier()` 按当前配置判定。


---

## 第十六轮：C-1 本机 PG 真跑与长程执行地基（2026-11-07）

**性质**：运行代码 + 测试 + 文档 + 开源协议登记；默认底座仍 `paperclip`，未改上游源码。用户允许本机引入 PostgreSQL，并明确「循环 / 会话状态 / 执行环境三者分离，每一步（一次模型或工具调用）单独调用，步间靠队列推进」。

### 1. 交付

- `src/pg-host.ts`：`PgHostPlatform` 实现 `HostPlatformPort`；`write()` 事务化，DDL 用 `pg_advisory_xact_lock` 防并发；`claimStep()` 用 `FOR UPDATE SKIP LOCKED` 原子领取，同一 run 只有一个 ready 步；`runToken` 领取、`recoverStaleSteps()` 崩溃回收且旧凭据失效；`capabilities()` 如实列出仍缺的 3 项（独立应用 UI 承载、远端工具沙箱、Redis 横向扩展）。
- `src/config.ts` / `src/platform-port.ts`：`host.provider` 增加 `local-pg`，DSN 只从 `COLLAB_PG_DSN` 读，`assertLocalPgDsn()` 拒绝一切非回环地址。
- `scripts/host-pg-smoke.ts`：只准在专属库 `suitme_collab_c1` 上跑，21 项 checks 覆盖幂等、文档修订、ACL、成本账本、heartbeat、队列顺序、并发领取、步进链 `modelCalls=3`、checkpoint 外置、崩溃恢复 / 旧 token 失效、事务回滚、capabilities。
- `tests/pg-host.test.ts`：6 例纯函数契约，不连库也不假绿；`tests/routing-decision.test.ts` 接线断言同步为 3 个 provider。
- R7：`pg@8.23.1` / `@types/pg@8.23.1` 精确版本 + lockfile integrity + `licenses/pg-MIT.txt` + `THIRD_PARTY_NOTICES.md` + `SOURCES.md` + `audit-upstream.ts` 机器化检查。

### 2. 全套回归结果（本轮重跑）

| 项 | 结果 |
|---|---|
| `npm test` | **335 / 335**（第十四轮 329 + C-1 新增 6 例） |
| `npx tsc --noEmit` | 通过 |
| `build:workspaces` / `build:chinese-shell` | 通过 / `hiddenEntries` 4、`missed: []`、`warning: null` |
| `test:responsive` | 425px 无溢出、按钮 44px、`problems: []` |
| `test:walkthrough` | **11 / 11**，`failures: []` |
| `audit:upstream` | `clean: true`、`problems: []`（含 `pg@8.23.1 MIT` 登记） |
| `npm run host:pg` | **`ok:true`、21/21**，PostgreSQL 17.10 专属库 `suitme_collab_c1`；`capabilities.missing` 3 项如实声明 |
| `host:smoke` / `routing:status` / `memory:checkpoint` | `ok:true` / `allWired:true`、三层 `recommended:false` / 增量应用 `checksumEqual:true` |
| `cognee:native status` | `configured:false`（缺 4 个环境变量，未外发业务材料） |
| `git diff --check` | 通过 |

### 3. 严格边界（未发生，不是 bug）

本轮**未引入 Redis**（用 PG `SKIP LOCKED` 等价）、**未部署远端工具沙箱 / 多机 Remote Tool Calling**（只验证循环与状态分离）、**未把 `runner.ts` / `assistant-runner.ts` 的常驻 `while` 切成单步**、**未切换默认底座**、**未改上游源码**。C-P6 的产品约束已固化，但长程执行尚未接到真实 Agent 循环上。真人业务验收（SUI-129 未核可）、Cognee 原生 `cognify` 真实调用、生产发布、真实外部 PR·CI、全员 SSO、飞书部门 scope 重新登录仍未发生。4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态；5432 是用户既有本机 PG，只连回环、只用专属库，不动 `geo_flow` 等其它库。


---

## 第十七轮：C-2 国内适配与独立控制台（2026-11-07）

**性质**：运行代码 + 前端资源 + 测试 + 文档；**未引入新上游、未改上游提交、未切换默认底座**。用户要求把 Paperclip 的「国外元素」做彻底国内适配，前端参考 LobeHub 的样式与部分功能。

### 1. 交付

- **国内适配**：中文壳词典扩到 344 条并覆盖上游残留英文；`domesticIndexHtml` 改掉移动桌面标题；服务清单移除 Slack / GitHub / Linear / Notion / Vercel / Zapier 一等入口，本机服务名中文化；工作台面板把 `npm run ...`、Cognee / Codex / Claude Code / Gemini / OpenAI / SQLite / Wiki / L1 / L2 等换成中文产品语言；内部标识不动。
- **独立控制台**：`console/` 自研六视图（概览 / 协作 / 知识 / 验收 / 服务 / 设置）、LobeHub 风格布局与卡片、气泡时间线、明暗主题、425px 窄屏；`scripts/console-server.ts` 只绑回环、13 个只读 action 白名单、写动作 403、密钥不出服务端、CSP 与禁表单；`console/app.js` 统一中文语言层与 8 秒请求超时。
- **真跑与契约**：`npm run console:smoke` 起临时端口 + Chrome 走查；`tests/console-shell.test.ts`（7 例）与 `tests/domestic-localization.test.ts`（7 例）。
- **许可证核实**：LobeHub 主仓库 Community License 禁止复制；`@lobehub/ui` 为 MIT 但 v6 强绑 React 19 + ESM，**本轮不引入**，只借设计语言自研实现。见 `OPEN-SOURCE-COMPLIANCE.md` 第 3 节、`SOURCES.md`。

### 2. 全套回归结果（本轮重跑）

| 项 | 结果 |
|---|---|
| `npm test` | **349 / 349**（第十六轮 335 + C-2 新增 14 例） |
| `npx tsc --noEmit` / `build:workspaces` | 通过 / 通过（插件已重挂真实宿主） |
| `build:chinese-shell` | `ok:true`、`hiddenEntries` 4、`missed: []`、`warning: null` |
| `test:responsive` | 425px 无溢出、按钮 44px、`problems: []` |
| `test:walkthrough` | **11 / 11**，`failures: []`（旧插件工作台未回退） |
| `console:smoke` | **`ok:true`**：6/6 视图渲染、真实任务 10 条、主题切换持久化、425px `425/425`、可见文案零海外品牌、无输入框、写动作 403、服务已连接 |
| `host:pg` / `host:smoke` / `routing:status` | `ok:true` 21/21 / `ok:true` / `allWired:true`、三层 `recommended:false` |
| `audit:upstream` / `git diff --check` | `clean:true`、`problems: []` / 通过 |

### 3. 严格边界（未发生，不是 bug）

默认 `config.host.provider` 仍是 `paperclip`；旧插件工作台保留并通过走查，控制台是**新增独立外壳**而非替换默认底座；`capabilities()` 仍如实列出「默认底座仍由宿主承载界面」。控制台由 `npm run console` 按需启动，**不新增常驻端口**、不提供网页发起入口。真人业务验收（SUI-129 未核可）、Cognee 原生 `cognify` 真实调用、生产发布、真实外部 PR·CI、全员 SSO、飞书部门 scope 重新登录仍未发生。4190 / 4192 / 4194 / 9418 保持停机；5432 只连回环专属库。`.runtime/console-smoke.json` 与 `.runtime/console/*.png` 不入库。

## 第十八轮：C-3 单一 Router 与可配置组织形态（2026-11-07）

**性质**：运行代码 + 测试 + 文档 + 状态视图；**未引入新上游、未改上游提交、未切换默认底座、未新增服务**。按 `HANDOFF/06` 分步清单推进 C-3。

### 1. 交付

- **单一 Router**：新增 `src/router.ts`（`planRoute()` 纯函数 + `Router` 唯一写入口 + `getRouter()` 单例 + `routerRevision()` 配置快照 + `planCoverage()`）；`config.router` 支持 `legacy / flat / layered`、按业务域的 `domains`、`defaultDomain`、`maxHops`，默认 `flat`。
- **9 处接线**：`controller`(3) / `coordination`(1) / `assistant`(1) / `service-network`(2) / `v06`(2) 全部改为 `getRouter().route({...})`；`server.ts` 启动时 `configureRouter(config.router)`；`routing-status` 与 CLI 返回 `router` / `routerCoverage`；控制台「协作」视图新增「组织形态」「怎么派活」。
- **红线**：`legacy` 逐字回退；未配主管的业务域、被拒 / 待定派活、主管即承接人都退回 1 跳并标注降级；自派自验自环被拦且写 `rejected` 留痕；人签只在最后一跳；幂等键与改造前一致；历史决策不回溯。
- **评估闸门**：`assessThreeTier` 的 p6 改为按 Trace 中的 Router 快照如实判定，新增 p8（Agent 实例 + 职责绑定 + 分层配置；第十八轮当时恒 false，C-5 后改为只在「真实分层配置 + 在岗编制 + 已配置业务域」下放行），修掉「合成五阶段数据即可让 `recommended=true`」的口径缺口。
- **真跑**：`npm run router:smoke` 隔离内存 Trace 跑三种形态 **31/31 `ok:true`**；`tests/router.test.ts` 11 例契约；`tests/routing-decision.test.ts` 守门改为「9 处经 Router、零直写」。
- **顺带修掉的真实问题**：真实浏览器截图发现协作视图稳定出现「暂时无法读取 / signal timed out」。测量 `view` 单次约 5.2 秒，而视图渲染与顶部状态条并发重复请求同一只读动作，三次并发 12 秒仍全部超时。在 `console/app.js` 加 **in-flight 去重 + 1.5 秒成功结果短缓存**（失败不缓存、超时保护不变），同一时刻相同只读请求只发一次；`tests/console-shell.test.ts` 补 2 例契约（组织形态卡片 + 去重）。修复后 `console:smoke ok:true`、协作视图 4 张卡片无错误提示。

### 2. 全套回归结果（本轮重跑）

| 项 | 结果 |
|---|---|
| `npm test` | **362 / 362**（第十七轮 349 + C-3 新增 11 例 Router 契约 + 2 例控制台契约） |
| `npx tsc --noEmit` / `build:workspaces` / `build:chinese-shell` | 通过 / 通过 / `ok:true`、`missed: []`、`warning: null` |
| `test:responsive` / `test:walkthrough` | 425px 无溢出、按钮 44px / **11 / 11**、`failures: []` |
| `router:smoke` | **31/31 `ok:true`**：legacy 5 跳、flat 5 跳、layered 10 跳；五阶段覆盖、因果链、人签位置、p6 证据、p8 未放行、未登记业务域降级、自环留痕 |
| `console:smoke` / `host:pg` / `host:smoke` | `ok:true` 6 视图 / `ok:true` 21/21 / `ok:true` |
| `routing:status`（真实服务端） | `allWired:true`；`router.mode=flat`、`domains=[]`；`routerCoverage total=65 / routed=7`；p6 false、p8 false、`recommended:false` |
| `audit:upstream` / `git diff --check` | `clean:true`、`problems: []` / 通过 |

### 3. 严格边界（未发生，不是 bug）

真实全量日志含改造前的历史决策，p6 仍为 `false`（历史不回溯改写）；隔离 `router:smoke` 才能看到「全部决策带 Router 快照」。C-4 / C-5 / C-6 当时未做（均已在后续轮次完成），默认底座仍 `paperclip`，飞书仍是唯一发起入口，控制台只读白名单未放宽。`.runtime/router-smoke.json` 不入库；`router:smoke` 不写真实 `.runtime/routing/events.jsonl`。4190 / 4192 / 4194 / 9418 保持停机；5432 只连回环专属库。

---

## 第十九轮：C-4 组织级 Agent 编制与验收协作（2026-11-07）

### 1. 交付

- **注册表**：新增 `src/agent-registry.ts`（Agent 实例 / 可扩展职责 / 生效范围 / 内容哈希版本 / `registryRevision` 快照 / `resolveAssignment` 确定性解析 / `handoffEnvelope` / `reviewCrew` / `registrySummary` / 单例）；`config.agentRegistry` 默认**空编制**，扁平小团队不硬造管理层。
- **Router 兼容**：`planRoute(input, config, registry?)` 第 3 参数显式传入时才校验主管在岗 / 职责 / 范围，未传与 C-3 逐字等价；`Router` 第 3 参数同理；`server.ts` 启动装配真实编制并把 `onDuty()` 真实计数传给 p8。证据追加 `agents:<rev>:<n>`，`ROUTER_MARK` 语义不变，历史决策不回溯。
- **A2A 与验收**：`service-network.ts` 的 `route()` / `start()` 在编制非空时做在岗校验并留 `handoff:` 证据；`v06.ts` 新增 `agent-registry-view` / `acceptance-crew` 两个只读动作，`review-readiness` 返回验收协作编组，`org-overview` 扩为 11 段；控制台「协作」视图新增中文「Agent 编制」卡片。
- **红线**：独立评审者 ≠ 产出方、不替代原发起人确认验收、已锁定清单不可改写；同一 Task 自派自验自环一律拦下；飞书仍是唯一发起入口，控制台只新增只读动作，未新增服务。
- **真跑**：`npm run agents:smoke` **43/43 `ok:true`**；`tests/agent-registry.test.ts` 14 例；`tests/console-shell.test.ts` 补 2 例编制视图契约；`tests/v06-workbench.test.ts` 同步 11 段；两处 C-3 守门断言改为「Router 与注册表同时装配」。

### 2. 全套回归结果（本轮重跑）

| 项 | 结果 |
|---|---|
| `npm test` | **378 / 378**（第十八轮 362 + C-4 新增 14 例注册表契约 + 2 例控制台契约） |
| `npx tsc --noEmit` / `build:workspaces` / `build:chinese-shell` | 通过 / 通过 / `ok:true`、`missed: []`、`warning: null` |
| `test:responsive` / `test:walkthrough` | 425px 无溢出、按钮 44px / **11 / 11**、`failures: []` |
| `router:smoke` / `agents:smoke` | **31/31** / **43/43**，均 `ok:true`，隔离内存 Trace 不写真实日志 |
| `console:smoke` / `host:pg` / `host:smoke` | `ok:true` 19 项（6 视图 / 主题 / 425px / 零海外文案 / 只读边界） / `ok:true` 21/21 / `ok:true` |
| `routing:status`（真实服务端） | `allWired:true`；`router.mode=flat`、`agentRegistry.onDuty=0`；p8 false、`recommended:false` |
| `memory:checkpoint` / `audit:upstream` / `git diff --check` | `logErrors:0` / `clean:true`、`problems: []` / 通过 |
| 真实只读接口 | `v06-agent-registry-view` / `v06-acceptance-crew` / `v06-review-readiness` 均 200，空编制如实降级并返回三条红线 |

### 3. 严格边界（未发生，不是 bug）

默认编制为空，所以真实服务端 p8 仍 `false`、三层判断 `recommended=false`；`agents:smoke` 的「在岗 2 跳」是隔离合成编制，不代表组织已配置管理层。C-5 / C-6 当时未做（均已在后续轮次完成）；`assessThreeTier()` 的 P3 / P4 仍按角色名判定；默认底座仍 `paperclip`；飞书仍是唯一发起入口；未引入第 8 个上游、未改上游提交、未复制 LobeHub 代码。`.runtime/agent-registry-smoke.json` 不入库。

---

## 第二十轮：C-5 按配置重跑三层评估与两种形态真实一单（2026-11-08）

### 1. 交付

- **评估口径**：`src/three-tier-assessment.ts` 新增 `OrgShape` / `shapeOptions(router, registry)`；P3 / P4 由固定三层口径改为按当前 `config.router.mode` 判定。扁平 P4 用 `directDispatches`（人 / 助手直达执行者），不要求 supervisor；分层 P4 用 `boundSupervisorDispatches`，要求派活方同时命中配置登记与真实在岗主管职责。新增 `observed.directDispatches` / `observed.boundSupervisorDispatches`。
- **结论分离**：新增 `shape: { mode, label, ready, applicable }`；`shape.ready` 表示当前形态按自身配置是否闭环（扁平不计 p8），`recommended` 只在 `layered` 且八项全绿时为 true。未声明 `routerMode` 的旧调用保持最保守固定口径（`routing-decision.test.ts` / `router:smoke` 不回退）。
- **接线**：`server.ts` 与 `scripts/routing-status.ts` 改用 `shapeOptions(getRouter(), getAgentRegistry())`；`console/app.js`「组织形态」卡加「形态判定」「三层结论」两行中文白话。服务端已 `restart:bridge`，真实 HTTP `routing-status` 返回 200 且口径一致。
- **真实浏览器修复**：演示截图复验时发现 `view` 返回整个工作区快照已增长到 **415KB / 10~12 秒**（C-3 时约 5 秒），前端统一 8 秒只读超时会稳定超时并渲染错误卡片；改为**按动作区分超时**（`view` 30 秒、其余只读仍 8 秒快速失败），保留 in-flight 去重与 1.5 秒成功结果短缓存。`tests/console-shell.test.ts` 的 C-3 契约同步守住；`console:smoke` 全绿、协作视图截图 `errorCards:0`、任务列表与「Agent 编制」卡片均正常。**未做服务端分页 / 裁剪**，如实列为后续性能项。
- **真跑**：新增 `scripts/shapes-smoke.ts` + `npm run shapes:smoke`，隔离内存 Trace 上扁平 / 分层各跑一单五阶段；`tests/shape-assessment.test.ts` 10 例契约。

### 2. 全套回归结果（本轮重跑）

| 项 | 结果 |
|---|---|
| `npm test` | **388 / 388**（第十九轮 378 + C-5 新增 10 例按配置评估契约） |
| `npx tsc --noEmit` | `TSC_OK` |
| `shapes:smoke` | **36/36 `ok:true`**：扁平 `shape.ready=true / recommended=false`；分层 `shape.ready=true / recommended=true`；每步带配置与在岗快照、两次重放一致、因果链闭合、人签只在末跳、真实日志行数不变 |
| `router:smoke` / `agents:smoke` | **31/31** / **43/43 `ok:true`**，不传 `routerMode` 时走保守口径，不回退 |
| `console:smoke` | `ok:true`、`failed: []`（6 视图 / 主题 / 425px / 零海外文案 / 只读边界） |
| `routing:status`（CLI + 真实 HTTP） | `allWired:true`；`shape.mode=flat`、P3/P4 按扁平口径、p8 false、`recommended:false`；服务端 `shape.ready=false` 因历史决策不带 Router 快照（p6 如实 false，不回溯改写） |
| `git diff --check` | 通过 |

### 3. 严格边界（未发生，不是 bug）

默认 `config.router.mode=flat`、默认编制为空，真实服务端仍 `recommended=false`；`shapes:smoke` 中分层 `recommended=true` 是**隔离真跑里的分层配置 + 真实在岗编制**，只说明「按该配置可正式启用三层」，不代表组织已配置管理层，也不代表建议所有团队升级。C-6 自演进闭环当时未做，已在第二十一轮完成；默认底座仍 `paperclip`；`runner.ts` 常驻 `while` 未切单步；真人业务验收 SUI-129 仍未发生；4190 / 4192 / 4194 / 9418 保持停机。飞书仍是唯一发起入口，控制台只读白名单未放宽；未引入第 8 个上游、未改上游提交、未复制 LobeHub 代码。`.runtime/shapes-smoke.json` 与 `.runtime/console/*.png` 不入库。

## 第二十一轮：C-6 沉淀回流与自演进闭环（2026-11-08）

### 1. 交付

- **自查回流**：`src/evolution.ts` 的 `standardsRevision()` / `evaluateSelfCheck()` / `assertDeliverySelfCheck()`；闸门接在 `Controller.publish()` 之前。五种阻断（无记录 / 缺条 / 未通过 / 空证据 / 旧快照）均给中文原因；放行只留痕、不等于人签。
- **治理台账与状态机**：`src/evolution-ledger.ts` 独立 append-only 台账（不并入 B1 主干，避免改变既有 checksum），7 类事件、`modelCalls=0`、幂等键、坏行记错、两次重放一致；候选改进从 `proposed` 到 `rolled-back` 全程守门，Agent 自批 / 跳闸门 / 无人审灰度 / 触碰四类禁改对象都被拦并留痕。
- **工程闸门**：`engineeringGate()` 复用 `memoryReplayReport()`，检查两次重放一致、零模型调用、无坏行与悬空因果、有真实来源；不另造第二套重放。
- **效果对比**：`aggregateEffects()` / `compareEffects()` 计算通过率 / 返工率 / 单任务成本（模型调用次数代理）/ 人被打断次数；缺观测即 `comparable=false`，不补零、不估算。
- **接线**：`config.evolution`、`server.ts` 注入与 `v06Reads`、`v06.ts` 七动作统一转发、`console-server.ts` 白名单、`console/app.js`「沉淀与自演进」卡片、`package.json` 新增 `evolution:smoke`。
- **真跑**：`scripts/evolution-smoke.ts`（45 项）+ `tests/evolution.test.ts`（12 例）。

### 2. 全套回归结果（本轮重跑）

| 项 | 结果 |
|---|---|
| `npm test` | **400 / 400**（第二十轮 388 + C-6 新增 12 例契约） |
| `npx tsc --noEmit` | `TSC_OK` |
| `evolution:smoke` | **45/45 `ok:true`**：完整闭环 + 全部反例；真实治理台账 / B1 主干行数前后不变，已锁定清单字节未变 |
| `shapes:smoke` / `router:smoke` / `agents:smoke` | **36/36** / **31/31** / **43/43 `ok:true`**，均不回退 |
| 两个构建 / 425px / 11 步走查 | `build:workspaces` + `build:chinese-shell` 通过；`test:responsive` 无溢出；`test:walkthrough` **11/11** |
| `console:smoke` | `ok:true`、`failed: []`；协作视图 6 张卡片、`errorCards:0`，新增「沉淀与自演进」截图 |
| 真实 HTTP | `v06-evolution-view` **200**（1 条沉淀标准 / 闸门已强制 / 0 次自查登记 / 暂无候选 / 效果不可比）；控制台代理 `v06-self-check-record` **403** |
| `host:smoke` / `host:pg` / 记忆重放 / checkpoint / `routing:status` / `audit:upstream` | 全绿；`host:pg` 21/21；`allWired:true`；`clean:true` |
| `git diff --check` | 通过 |

### 3. 严格边界（未发生，不是 bug）

真实业务单上没有触发过「因缺自查而阻断交付」，该路径只在隔离台账与契约测试里真跑，避免产生真实交付副作用；默认 `config.host.provider` 仍 `paperclip`；`runner.ts` 常驻 `while` 未切单步；真实远端沙箱 / 多机切换 / 金额成本账本 / Cognee 原生外部模型调用未发生；真人业务验收 SUI-129 仍未发生；4190 / 4192 / 4194 / 9418 保持停机。飞书仍是唯一发起入口，控制台只读白名单只增加 `v06-evolution-view` 一项；未引入第 8 个上游、未改上游提交、未复制 LobeHub 代码。`.runtime/evolution-smoke.json` 与 `.runtime/console/*.png` 不入库。

## 第二十二轮：生产项 P-1 长程循环单步化（2026-11-08）

| 项 | 结果 |
|---|---|
| `npm test` | **413 / 413**（第二十一轮 400 + P-1 新增 13 例单步执行契约） |
| `npx tsc --noEmit` / 两个构建 | 通过 / `hiddenEntries` 4、`missed: []`、`warning: null` |
| `npm run steps:smoke` | **40/40 `ok:true`**：A 配置与只读视图 6 项、B 隔离内存队列 21 项、C 本机 PG 专属库 + 真实子进程跨进程单步 8 项、D 接线守门 6 项（含 B1 主干行数前后不变）；报告 `.runtime/steps-smoke.json` 不入库 |
| 跨进程真跑要点 | `step:once` 第一棒 `counter=1` 并原子激活第二棒；第二棒由 `COLLAB_STEP_ENVIRONMENT=另一台机器` 的独立进程领走，`counter=2`、`previousEnvironment=本机执行环境`；队列空返回 `claimed:false`；PG 旧 `runToken` 完成被拒；`model-call` 步如实失败并留中文原因 |
| 真实服务端 / 控制台 | `v06-execution-view` HTTP **200**（`mode=loop`、`steppedReady=false`、`missing=6`）；控制台代理只读 200、写动作 `v06-self-check-record` **403**；`console:smoke` `failed: []`；四张 1280 截图 `errorCards:0`，新增「长程执行」卡片完整可见 |
| 既有回归不回退 | `router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`host:pg` 21/21、`host:smoke`、`memory:replay` / `memory:checkpoint`、`routing:status allWired:true`、`audit:upstream clean:true`、`test:responsive` 393/393、`test:walkthrough` 11/11、`git diff --check` |
| 默认路径 | `config.execution.mode=loop`、`host.provider=paperclip`；`driveLegacyLoop()` 与改造前逐字等价，`step:once` 在 loop 下如实返回未启用、不连数据库 |
| 如实边界 | 真实业务单未在 step 模式跑过；无外部模型调用；worker 内部子调用未逐次拆分；远端沙箱 / 多机切换 / Redis / 金额成本账本仍未落地；`host:pg` 的 `resetForTest()` 会清空专属测试库 |

## 交接与总结文档轮（2026-11-08，无代码改动）

| 项 | 结果 |
|---|---|
| 交付物 | 根目录 `HANDOFF.md`（给下一位 Agent 的接手总纲）与 `PROJECT-SUMMARY.md`（系统架构 / 产品功能架构 / 业务流程设计 / 依赖与引用及协议逐一说明）；同步更新 `README.md` 导航、`HANDOFF/README.md`、`SYNC-STATUS.md`、`DIRECTORY-GUIDE.md`、`FILE-INVENTORY.md`、`handoff-manifest.json`，并把 `08-OPEN-DECISIONS.md` 的「仍待拍板」口径修正为 6 项 |
| 基线复跑 | `npm test` **413/413、0 fail**；`git diff --check` 通过；`HANDOFF/handoff-manifest.json` JSON 解析通过（`rootEntryFiles: 2`、`totalEntries: 299`） |
| 提交与推送 | 文档与代码基线一并提交并 push 到 `origin/main`；提交后以 `git status --short --branch` 校验 `HEAD = origin/main` 且工作区干净 |
| 严格边界 | **未改动任何 `src/` / `scripts/` / `tests/` 代码**，未改产品口径、未改上游源码或提交、未新增依赖、未重启服务；默认仍 `config.execution.mode=loop` + `host.provider=paperclip`；真人业务验收 SUI-129 仍未发生；4190 / 4192 / 4194 / 9418 保持停机；`.runtime/` 证据不入库 |

## 第二十三轮：生产项 P-5 控制台只读快照的服务端分页与裁剪（2026-11-08）

| 项 | 结果 |
|---|---|
| `npm test` | **424 / 424**（第二十二轮 413 + 新增 9 例摘要契约 + 2 例控制台契约） |
| 新增代码 | `src/workspace-summary.ts`（分页参数夹取 / 身份过滤 / 确定性纯函数 / 字段白名单）、`tests/workspace-summary.test.ts` 9 例；`server.ts` 新增只读 `view-summary` 分支；三处只读白名单与 `console/app.js` 四处调用同步；`console:smoke` 补 4 项检查 |
| **真实服务端 HTTP 对比** | 同一台本机 `view` **509,283 bytes / 4.02 秒**；`view-summary` **5,678 bytes / 0.076 秒**；`limit=2` **1,078 bytes / 0.019 秒**。体积约 1.1%，耗时约 1/53。历史浏览器端到端基线为 415KB / 10~12 秒 |
| 响应结构实测 | `taskCount=10`、`page.total=10`、`hasMore=false`、`titleSource=host`、`fieldsClipped=true`；任务对象 7 个白名单字段；序列化结果不含 `snapshots` / `body` / `context` / `sourceAccess` |
| `console:smoke` | `ok:true`、`failed: []`；`summaryReady`（5,678 bytes / 94ms）、`summaryClipped`、`summaryPageHonest`、`summaryPaged` 四项新检查全绿；6/6 视图、主题持久化、425px、零海外文案、写动作 403；旧 `/api/view` 仍 200 且 10 条真实任务（旧链路未回退） |
| 既有回归不回退 | `npx tsc --noEmit`、`build:workspaces`、`build:chinese-shell ok:true`、`test:responsive` 无溢出、`test:walkthrough` **11/11**、`console:smoke`、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 40/40、`host:pg` 21/21、`host:smoke`、`memory:replay` / `memory:checkpoint`、`routing:status`、`audit:upstream clean:true`、`git diff --check` |
| 环境处置 | 本轮开始时 3100 / 4180 带失效文件代理，`fs` 读取报 `connect failed: Connection refused`，宿主静态页 500、`view` 一度 409 并随后崩溃；按 `HANDOFF/00` 既定流程用干净环境重启 4180 / 3100 并重挂插件后恢复，走查 11/11。未改上游源码、未重启 4190 / 4192 / 4194 / 9418 |
| 如实边界 | 摘要只用于展示索引，不含工作稿正文 / 授权明细 / 验收判断；`view` 逐字保留；宿主标题是 advisory，缺失即降级到本机任务索引并标 `titleSource=local/partial`；控制台只读白名单 16 → 17 项，仍无写入口；飞书仍是唯一发起入口；默认底座仍 `paperclip`；真人业务验收 SUI-129 仍未发生；其余剩余生产项未动 |

## 第二十四轮：P-6 Runner 两块协议移植与四项借思想（2026-11-08）

| 项 | 结果 |
|---|---|
| `npm test` | **445 / 445**（第二十三轮 424 + 21 例新契约：`tests/step-hitl.test.ts` 10 例、`tests/step-delivery.test.ts` 11 例） |
| `npm run steps:smoke` | **54/54 `ok:true`**（原 40 + E 段 6 项 + F 段 3 项 + G 段 5 项）；真实 PG 专属库 `suitme_collab_c1` + 真实子进程，唯一 runId、未 reset 他人数据 |
| E 段：HITL 成对留痕 | 真实子进程在 `human-gate` 步只提问不放行（PG 步骤仍 `failed`）、返回 `hitlQuestionId`；台账追加 `human_question`（因果 `triggered_by` 在载荷、信封无因果）；真人入口 `step:answer` 追加 `human_response` 并成对闭环、`acceptance:false`；同一问题重复回答被拒、未声明真人身份被拒；台账写在临时目录、B1 主干行数前后不变 |
| F 段：队列送达证据 | `TrackedStepQueue` 包住真实 PG 队列：`delivered=1`、`acknowledged=1`、`pendingDelivery=0`、`notifications>=1`；累计确认推进到 `d000002` 后积压清零，旧确认 `d000001` 不回退；通知幂等、投递就绪按 `queuesInputMidTurn` 能力声明，重投递只认空闲 |
| G 段：四项借思想 | 六态由任务事实派生（安静 30 秒才 settled，且 settled 与 running 可并存）、运行时只声明能力不存启动参数、配置库与追加写日志分层守门、编制快照不回溯改写历史决策；`executionView()` 只读暴露六态 / 能力声明 / HITL / 投递说明且 `modelCalls=0` |
| 来源登记（R7 六步） | Runner `main` 固定 MIT 提交 `a42d133139bbe630e4ca3475426c7653fddd86db`；`licenses/runner-MIT.txt` 原文、`THIRD_PARTY_NOTICES.md` 新段、`sources.lock.json` 的 `protocolReferences`、`docs/SOURCES.md` / `docs/OPEN-SOURCE-COMPLIANCE.md`、`scripts/audit-upstream.ts` 机器化校验、两个新模块保留 MIT 版权头。**未引入 submodule / gitlink / Rust 源码，7 个上游不变**；避开 2026-08-22 ~ 09-22 的 GPL-3.0-only 发布窗口 |
| `npx tsc --noEmit` / `audit:upstream` / `git diff --check` | 通过 / `clean:true`、`problems: []`（notes 新增 `Runner: MIT @ a42d133139bb`） / 通过 |
| 既有回归不回退 | `console:smoke` 全绿、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`host:pg` 21/21、`host:smoke`、记忆重放 / checkpoint、两个构建、425px 响应式、工作台走查 11/11 |
| 如实边界 | `human_response` 只把答案送回提问者，绝不替代原发起人在原会话「确认验收 任务编号」；执行进程不得自行放行人工步；未接通飞书写回通道，回答目前只有本机 CLI 入口；默认仍 `loop` + `paperclip`，未发生外部模型调用；SUI-129 仍未核可；4190 / 4192 / 4194 / 9418 保持停机 |

## 第二十五轮：P-7 Anthropic agent memory 分层参考与「参考即记忆」规则（2026-11-08）

| 项 | 结果 |
|---|---|
| 来源核实 | `https://www.anthropic.com/research/components-of-agent-memory`，Engineering，Published Nov 6, 2026，Written by Lance Martin，© 2026 Anthropic PBC；网页研究文章、无开源代码许可证；完整对照见 `docs/REFERENCE-anthropic-agent-memory.md` |
| 逐层对照 | `transcripts` / `memory notes` 两层本仓库已有且更严（append-only 主干 + `candidate → confirmed → withdrawn` 人签链）；真缺口是知识挂靠事实源、wiki 链接与规模护栏、注入顶层只留索引、离线整理只提建议、外部参考进入候选链 |
| `npm test` | **465 / 465**（第二十四轮 445 + `memory-hierarchy.test.ts` 20 例） |
| `npm run memory:hierarchy` | **16/16 `ok:true`**：A 四层与预算、B 挂靠校验（含悬空 / 撤回 / 无签字反例）、C 知识地图体检与「1.77 倍地图」拒绝（wiki 208,908 bytes / 语料 117,760 bytes）、D 注入索引只留指针与超预算下移、E 离线整理确定性只读与纠偏建议、F 主干不可回溯且真实日志行数不变（40 → 40） |
| 落地内容 | `src/memory-hierarchy.ts` 五组纯函数：挂靠校验、规则 / 参考沉淀、wiki 体检与护栏、注入索引与预算、只读 Dreaming 建议；`tests/memory-hierarchy.test.ts` 20 例；`scripts/memory-hierarchy-smoke.ts` + `npm run memory:hierarchy` 16 项真跑 |
| 用户点题落地 | `referenceAsMemory()` / `assertReferenceSedimentation()`：外部参考与自研结论走同一条候选链，恒为 `candidate`、必须带来源与阅读事件、必须带红线警告，采用是后续独立真人动作；离线整理只能提请提升，不能替人放行 |
| 来源登记 | `sources.lock.json` 新增 `conceptReferences`（不是 `sources` / `protocolReferences`）；`THIRD_PARTY_NOTICES.md` / `docs/SOURCES.md` / `docs/OPEN-SOURCE-COMPLIANCE.md` 同步；`scripts/audit-upstream.ts` 校验不得混入 `sources`、七个 pinned submodule 不变；`clean:true`、`problems: []`。**无 LICENSE 原文可留存，未伪造许可证文件；未复制正文 / 代码；不是第 8 个上游** |
| 既有回归不回退 | `tsc`、两个构建、425px 响应式、走查 11/11、`console:smoke`、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 54/54、`host:pg` 21/21、`host:smoke`、记忆重放 / checkpoint、`audit:upstream`、`git diff --check` |
| 如实边界 | 纯函数守门尚未接入真实 `Knowledge` / `Context Pack` / wiki 落盘；未新增只读 action、未改控制台、未改既有投影 / 撤权 / 人签；默认仍 `loop` + `paperclip`，无外部模型调用；SUI-129 仍未核可；4190 / 4192 / 4194 / 9418 保持停机 |

## 第二十六轮：P-8 查漏补缺与取长补短（2026-11-08）

| 项 | 结果 |
|---|---|
| 查漏结论 | P-7 守门只被自身冒烟脚本引用（生产链路零调用）；出站 MCP 无「不暴露」硬断言；走查报告无冻结基线 / golden diff / 纯评分器；`compareEffects()` 缺双臂统计旗标；`routing-trace.ts` 决策独立留痕已有等价物，只补机器化断言 |
| 补缺：`src/knowledge-guard.ts` + 只读 action `memory-guard` | 三处白名单同步（server / members / console-server）；真实 B1 + 路由事件 140 条、本地知识任务索引 22 条；`advisory:true / blocking:false / modelCalls:0`；不读宿主正文、不改写入链、不拦截交付 |
| 真实 HTTP | `POST /workspace/memory-guard` → **200 / 4,337 bytes / 7 ms**，`source:local-store`、`documentBodiesNotRead:true`、`gapRecords:22`、`signature` 稳定 |
| 诚实口径 | 22 条真实知识记录全部缺 `evidenceEventIds`，体检如实报 `missingEvidence:22`，**未编造事件 id 跑绿**；`unwired` 逐条列出四项尚未接入生产链 |
| 取长：`src/behavior-baseline.ts` | 冻结快照 / golden diff / 纯评分器 / 双臂三旗标 / 工具面版本化签名 / 出站不暴露硬断言 / 决策留痕隔离断言；基线 `fixtures/behavior-golden.json` 61 条稳定字段，排序用字节序 |
| `npm test` | **499 / 499**（第二十五轮 465 + 12 例守门 + 16 例行为基线 + 8 例常态契约） |
| `npm run guard:smoke` | **22/22 `ok:true`**：A 冻结基线 61 项 unchanged、B 真实 16 个出站工具全通过、C 100 条真实路由留痕独立有序、D 双臂旗标、E 守门跑真实数据、F 真实 HTTP 与日志行数不变（memory 40→40、routing 100→100） |
| 冻结基线人审 | 全套浏览器回归后 `guard:smoke` 的 golden diff 如实抓到 `checks.readOnlyAllowlist.actions` **17→18**；经人审确认为本轮新增只读 action `memory-guard` 的预期配置变化（非行为退化），**由人手工更新基线并在 `humanReview` 记录时间 / 轮次 / 变化 / 理由 / 审核人**，真跑脚本仍不得自动改写 |
| 修掉的真实缺陷 | 体检签名未覆盖记录内容 → `recordFingerprint`；注入顶层截断被静默吞掉 → `injectedOmitted` + finding；冻结基线 `localeCompare` 跨区域漂移 → 字节序 |
| 既有回归不回退 | `memory:hierarchy` 16/16、`steps:smoke` 54/54、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`host:pg` 21/21、两套真实浏览器走查 11/11 与 `failed: []`、两个构建、425px、`tsc`、`audit:upstream clean:true`、`git diff --check` |
| 如实边界 | 只读体检不等于写入链改造；第 13 条四项仍待拍板，第 12 条 (b) 五项仍待拍板；默认仍 `loop` + `paperclip`，无外部模型调用、未引入第 8 个上游或 npm 依赖；SUI-129 仍未核可 |

## 第二十七轮 · P-9 双向协作回路与上游协议真实耦合（2026-11-08）

| 项 | 结果 |
|---|---|
| 触发 | 用户质疑「不能是单向的」并追问「之前是不是做错了 / 参考成了什么样子」；追加要求「从具体代码执行落地的过程来看，可以复用那些开源项目中的部分，把它们耦合进来」 |
| 方向纠正 | 四轮参考产出（Runner / OpenMausBot / Anthropic / 上游七仓）全部落在治理 / 评估 / 只读体检侧，零项落在双向执行回路；复盘见 `docs/REFERENCE-capability-comparison.md` 第 6、7 节 |
| 主链路核实 | 本来就是双向：`controller.reply()` 追加 comment + `phase='ready'` + wakeup/retry 自动启动下一轮；断的是 P-6 单步 HITL 台账「答完就消失」 |
| 四个耦合点 | `controller.receipt()`（Autoloop 回执 → 上行）、`controller.reply()` 与 `collaboration-intake.ingest()`（补充说明 → 下行）、`step:answer`（Runner 成对回答 → 回流建议）、`loop-guard`（只读汇总） |
| `npm test` | **521 / 521**（499 + 16 例双向回路契约 + 6 例常态契约） |
| `npm run loop:smoke` | **16/16 `ok:true`**：真实 HTTP 200 / advisory / blocking:false；真实子进程「提问→真人回答→建议落盘」；无建议 staleAnswers:1→有建议 0、closedCycles:0→1；B1 / 路由 / 任务状态 / 回路审计前后不变 |
| `loop-guard` 真实响应 | HTTP 200、`advisory:true`、`blocking:false`、`modelCalls:0`；**如实报 `bidirectional:false` 与四个耦合点计数 0**（真实业务单尚未在该链跑过，未编造事件） |
| 冻结基线人审 | `guard:smoke` golden diff 抓到 `checks.readOnlyAllowlist.actions` **18→19**，人审确认为新增只读 action `loop-guard` 的预期配置变化，手工更新基线并追加 `humanReview`（时间 / 轮次 / 变化 / 理由 / 审核人）；真跑脚本仍不得自动改写 |
| 既有回归不回退 | `guard:smoke` 22/22、`steps:smoke` 54/54、`memory:hierarchy` 16/16、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`host:pg` 21/21、两套浏览器走查 11/11 与 `failed: []`、两个构建、425px、`tsc`、`audit:upstream clean:true`、`git diff --check` |
| 如实边界 | **流转自动化 ≠ 决策自动化**：两条方向自动接通，验收 / 放行 / 授权 / 核可仍不下放；真实业务单未跑过、`step` 默认 `loop`、无外部模型调用、7 个上游不变、SUI-129 仍未核可；自动排后续步骤与飞书直写 HITL 台账仍待拍板 |

## 第二十八轮 · P-10 漏洞修复与飞书回答接进 HITL 台账（2026-11-08）

| 项 | 结果 |
|---|---|
| 触发 | 用户要求「看看有没有什么其他的漏洞，完整修复和优化一下，包括功能上还有什么缺陷之类的也进行修复和优化，参考其他几个开源项目」 |
| 修掉的真实缺陷（5 个，不是改测试蒙过去） | ① `fromHitlLedger` 的 `at` 类型不匹配：真实台账是 ISO 字符串、审计行是 epoch 毫秒，混排时 `a.at - b.at` 得 NaN、排序与因果比较全部失效（`loop-smoke` E 段的 `2 + e.at` 字符串拼接坐实）→ `toLoopAt()` 统一归一，`loopReport` / `attachImplicitReplies` / `dedupeLoopEvents` 内部比较全部走它；② `loop-guard` 下行事件 id 撞号双计（同一 IM 消息被 `reply()` 与 `ingest()` 双留痕）→ `dedupeLoopEvents()` 按字节序保最早一条、`ledgerHealth.dedupedLoopEvents` 如实报数；③ `mapFollowupToAnswer` 的 `\b` 对中文失效，裸「确认验收」漏进回答通道 → 改为 `/^确认验收(?:\s\|$/`；④ `FileHitlSink.read()` 坏行静默丢弃 → `readWithHealth()` 报 `badLines`，`step:answer` 与 `loop-guard` 都接；⑤ `memory-guard` 知识记录 title 取到 `'{}'`（context 是真值空对象）→ 空对象回退 identifier，22 条真实记录指纹随之修正 |
| 功能缺陷修复（差距清单 #3 核心） | 新增 `src/hitl-bridge.ts`：飞书显式「回答 <问题编号> <选项>」路由进 Runner 成对 HITL 台账 + 产出 advisory 回流建议（参考 OpenMausBot question 卡片人侧回写）；`collaboration-intake.ingest()` 接线（IM 绑定校验之后、observe only、路由成功不重复写 `loop.downstream` 观察、失败退回原观察路径并如实可查）；`scripts/step-answer.ts` 重构为共用同一判据（CLI 与 IM 口径逐字节一致）；回答带 `via:'feishu-im'/'cli'` 通道标注 |
| 红线不放宽 | 只有显式带问题编号才路由（隐式回答宁可不猜）；路由成功不排后续步骤、不改任务状态、不等于验收；提问者自答 / 越界选项 / 重复回答 / 核可短语全部拒绝；`p9-contracts` / `loop-smoke` B 段把「路由必须在 IM 绑定校验之后」「hitl-bridge 不得出现 enqueueSteps / completeStep / store.save」焊成常态契约 |
| `npm test` | **532 / 532**（521 + 11 例新增：回路修复回归 3 + hitl-bridge 契约 6 + 飞书路由端到端 1 + 常态契约扩充 1） |
| `npm run loop:smoke` | **17/17 `ok:true`**（新增 B5：去重与时间归一真接进服务端）；A 段真实 HTTP 200 / advisory、`ledgerHealth:{hitlBadLines:0,dedupedLoopEvents:0}` 如实上报 |
| 冻结基线 | **golden 无差异**：本轮未新增只读 action（19 项白名单不变），`guard:smoke` 22/22、签名 `d6347436…` 与 P-9 人审后基线逐字节一致，无需人审 |
| 既有回归不回退 | `steps:smoke` 54/54、`memory:hierarchy` 16/16、`console:smoke failed: []`、走查 11/11、425px `problems: []`、两个构建、`tsc`、`audit:upstream clean:true`、`atlas:check` 全过、`git diff --check` |
| 如实边界 | 真实业务单仍未在该链跑过（`loop-guard` 如实报 `bidirectional:false`、耦合点计数 0）；自动排后续步骤、`step` 切真实业务单仍待拍板（HANDOFF/08 第 13 条）；默认仍 `loop` + `paperclip`；无外部模型调用、7 个上游与 npm 依赖不变；SUI-129 仍未核可 |

## 第二十九 / 三十轮 · P-11 自动续跑与授权代办；P-12/P-13 RBAC·用户级配置·Vue 前端重写·知识分区 CRUD（2026-11-08）

| 项 | 结果 |
|---|---|
| `npm test` | **540 / 540**（532 + P-11 契约；P-12/P-13 契约换代净增） |
| `console:smoke` | **49/49 `ok:true`**（登录制 / casbin RBAC 边界 / 知识分区正负例 / 六视图 / 主题 / 425px / 零海外文案）；详细见 `HANDOFF/05` 第 8 节 |
| R7 登记 | casbin 5.51.1（Apache-2.0）+ Vue 3.5.45 + Element Plus 2.14.8（均 MIT，本地 vendor + 版本横幅机器校验）；`audit:upstream clean` |
| 既有回归 | `tsc`、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 54/54、`loop:smoke` 17/17、`host:pg` 21/21、`git diff --check` |

## 第三十一轮 · ③c 记忆写入链四项改造 + ③d OpenMausBot 五项（2026-11-08）

| 项 | 结果 |
|---|---|
| `npm test` | **557 / 557**（540 + `tests/knowledge-writechain.test.ts` 11 例 + `tests/openmaus-12b.test.ts` 6 例） |
| `steps:smoke` | **61/61 `ok:true`**：B21 `markOutwardAction` 发生时登记 → 崩溃回收 `interrupted` 终态（旧 token 作废、不可再领取）、B21b 显式 `failStep` 同样不重跑（本轮修复的真实红线缺口）、B22 无副作用回收 `ready`、B23 委托树血缘跨 run 连通、B24 失败重领 `generation+1` |
| `host:pg` | **24/24 `ok:true`**（21 + 3）：PG 真跑对外动作幂等去重、interrupted 携带动作清单、`lineageOf` 递归 CTE、`generation` 每领 +1；steps 表新列 `parent_step_id` / `generation` / `outward_actions` 幂等迁移 |
| `console:smoke` | **55/55 `ok:true`**（49 + 6）：读分区三例（viewer 看不到他人 personal、admin 总览可见、viewer get 他人 personal 409）、`proposeAnchorsEvidence`、`knowledgeWikiReadable`（modelCalls=0、无悬空）、`injectedIndexDiscipline` |
| 端到端真跑 | `knowledge-wiki` 27 记录 / 5 跳过 / 17 页 / 150 链接 / 0 悬空 / 17 断言无出处（旧记录如实报缺口）/ bloated true；`dreaming-run` 首跑 24 条建议登记、复跑 0 登记 24 跳过（幂等）；修订自动挂锚点 → 确认+inject → 注入索引收 1 条（206 字节）；无证据旧记录即使确认 + inject 也不进索引（红线联动） |
| 冻结基线 | golden **人审重冻结**（humanReview 第 3 条）：基线上次人审停在 P-9（19 项白名单），承接 P-12 Vue 重写检查集换代（removed 34 / added 134）、P-13 白名单 19→21、本轮 `knowledge-wiki` 21→22；全套回归确认无行为退化后手工更新，新签名 `f17f73f9…`；`guard:smoke` 22/22 |
| 陈旧断言修复 | `steps:smoke` D3 / `agents:smoke` C-4 的 `card(` 前缀在 P-12 Vue 重写后失配（改查 `<template #header>`）；`loop:smoke` B3 的 `requiresHumanApproval` 在 P-11 后移到 `collaboration-loop.ts`（断言跟随真正强制处）——P-11/P-12/P-13 轮未跑对应冒烟的累积漂移，非行为退化 |
| 既有回归不回退 | `router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`memory:hierarchy` 16/16、`loop:smoke` 18/18、走查 11/11、425px、`atlas:check` 11/11、两构建、`tsc`、`audit:upstream clean:true`、`git diff --check` |
| 如实边界 | 红线 (c) 全守（不模型判 salience、不自动提升 / 确认、不 TTL 物理删除、不让模型改写 wiki）；升级恒 advisory 不代批；团队包导入不提权；Skill 默认关且绑内容哈希；只借思想零代码引入、7 个上游不变；默认底座仍 `paperclip`、执行形态默认 `loop`；飞书仍是唯一发起入口 |


## 第三十二轮 · 切默认底座 local-pg + step（2026-11-08）

| 项 | 结果 |
|---|---|
| `npm test` | **557 / 557**（契约换代 5 处断言：routing-decision 默认 provider、step-execution 默认 mode + 只读视图 + loop 显式回退负例、step-delivery steppedReady、steps-smoke A1） |
| `steps:smoke` | **61/61 `ok:true`**：A1 口径改为「当前执行形态合法（第三十二轮起默认 step）且 loop 仍可显式回退」 |
| `host:pg` / `console:smoke` / `guard:smoke` | 24/24 · 55/55 · 22/22（golden 无漂移，无需重冻结） |
| `step:once` 端到端 | 新默认真连 PG 专属库（`queue: 'local-pg'`）：未声明 `COLLAB_STEP_PRINCIPAL` → 「步间权限重评」按最小权限拒绝、步标 failed；带主体 → 领步执行，`tool` 类步无登记执行器如实报「没有登记 tool 的执行器」失败不编造（modelCalls=0）。三红线（状态外置 / 步间重评 / 诚实失败）真实生效 |
| Cognee 本地链路 | `scripts/smoke-memory-graph.ts --run` 隔离真跑通过：`engine: 'pinned Cognee + Ladybug + native BM25'`、`persistenceAcrossProcesses: true`、`conceptRecall: true`、`modelCalls: 0`——当前用法完全本地无需 API key |
| 其余回归 | `loop:smoke` 18/18、router 31/31、agents 43/43、shapes 36/36、evolution 45/45、memory:hierarchy 16/16、走查 11/11、425px 无溢出、两构建、`atlas:check` 11/11、`audit:upstream clean:true`、`git diff --check` |
| 服务 | bridge 4180 / console 4200 / vision 4190 / report 4192 / delivery 4194（+git 9418）全部重启加载新默认 |
| 如实边界 | 真实业务单在 step 模式跑通仍待用户在飞书发起一单验证；回退开关随时可用（`config.json` 的 `execution.mode` 改回 `loop`）；`cogneeNative` 原生 cognify 调用代码未写、无消费者，接通需外部 LLM+Embedding key 或本机 ollama |

## 第三十三轮 · DeepSeek v4 flash 接入 Cognee 原生管线（2026-11-08）

**改动**：`src/config.ts`（`cogneeNative.embedding.provider: 'custom'|'fastembed'` 默认 fastembed + `fastembedModel`/`fastembedDimensions`）、`src/cognee-native.ts`（fastembed 分流：不要求端点凭据、子进程环境不传 `EMBEDDING_ENDPOINT`/`EMBEDDING_API_KEY`）、`src/server.ts`（`integrations.embedding` 文案分流）、`tests/cognee-native.test.ts`（契约更新 + fastembed 用例 + custom 回退负例）。

**静态与回归**：`npm test` **558/558**、tsc、`build` / `build:chinese-shell` / `build:workspaces`、`steps:smoke` 61/61、`host:pg` 24/24、`console:smoke` 55/55、`guard:smoke` 22/22（golden 无漂移）、`loop:smoke` 18/18、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`memory:hierarchy` 16/16、走查 11/11、425px、`atlas:check` 11/11、`audit:upstream clean`、`git diff --check`。

**外部模型真跑**（key 只进进程环境，不落盘）：
1. DeepSeek key 直连：`deepseek-v4-flash` @ `https://api.deepseek.com` 正常应答（`deepseek-chat` 旧名已弃用）。
2. `cognify`：中文业务材料（项目/成员/时间线/风险/验收标准）→ `ok:true, extractor:llm, embedding:native`；DeepSeek 实体抽取 + 本机 fastembed（jina zh，768 维）+ lancedb。
3. `search`：「支付模块有什么风险？谁负责前端？」准确召回「微信支付商户号尚未过审」与「前端工程师陈默」。
4. bridge 4180 带 env 重启后 `system-status`：`modelApi:true`、`cogneeNative.configured:true`、`llmModel:openai/deepseek-v4-flash`、`embeddingLocal:true`、`dimensions:768`。

**已知边界**：cognify 仍只有 CLI 入口（产品知识入库不自动外发）；机器重启后 bridge 需带 `COGNEE_LLM_*` 重启；`cognee.search` 返回 Python dict 字符串；DeepSeek 调用有真实费用（$0.14/M 输入 · $0.28/M 输出）。

## 第三十四轮 · 四缺口修复 + 断点审计 + console UI（2026-11-08 深夜）

**改动**：`src/config.ts`（cogneeNative 增 autoCognify/dataset）、`src/cognee-native.ts`（persisted env 读写与启动装载、cognify 串行队列、超时保护、triggerAutoCognify、状态扩充）、`src/graph.ts`（投影成功后自动 cognify 钩子，发后即忘 + 双审计）、`src/server.ts`（cognee-search action、readOnly 白名单、启动装载、状态口径）、`scripts/cognee-native.ts`（位置参数 + persist/forget/load-env）、`scripts/cognee-native.py`（search 结构化 to_jsonable）、`scripts/console-server.ts`（cognee-search 放行收口 owner/admin、proxy 可调超时）、`scripts/vision-server.ts`（/health 补 ok:true）、`console/app.js`（知识页语义检索卡、服务页 state 渲染断点修复）、`plugins/knowledge-workspaces/src/ui/settings.tsx`（知识检索页）、`.runtime/cognee-env.json`（凭据持久化，gitignored 不入库）、`scripts/owner-screenshots.mjs`（截图工具）、`fixtures/behavior-golden.json`（两次合法重冻结 + 人审记录）、`tests/cognee-native.test.ts`（+5 用例）。

**静态与回归**：`npm test` **563/563**、tsc、三构建、`console:smoke` 55/55、`guard:smoke` 22/22、`steps:smoke` 61/61、`host:pg`、`loop:smoke` 18/18、router 31 / agents 43 / shapes 36 / evolution 45 / memory:hierarchy 16、`git diff --check`。

**外部模型真跑**（凭据来自 .runtime/cognee-env.json，机器重启后服务自动装载）：
1. bridge 无环境变量重启 → `system-status`：`configured:true`、`credentialsPersisted:true`、`autoCognify:true`。
2. `knowledge-graph project=true`（既有来源重投影）→ L1 `modelCalls:0` 红线不动，返回 `nativeCognify:{triggered:true, dataset:'suitme-knowledge'}`；后台 cognify 完成，审计 `knowledge.native-cognified`（external:true、llmModel:openai/deepseek-v4-flash、embeddingLocal:true）。
3. console 语义检索（owner 登录 → /api/cognee-search）：「支付模块有什么风险？」（e2e-test 数据集）、「谁负责前端？」→ 均正确召回。
4. 服务页实测：本机 6 服务 connected（paperclip / bridge / delivery / vision / report / 飞书），vision 由本轮 ok:true 修复转绿。

**console UI 截图**（scripts/owner-screenshots.mjs，owner 身份）：`.runtime/console/owner-01-login.png` ~ `owner-04-overview.png`。

**已知边界**：cognified 共享数据集跨来源，检索收口到 owner/admin；机器重启后检索/自动 cognify 依赖 .runtime/cognee-env.json（删除即回到未配置态）；DeepSeek 调用有真实费用（用户已确认不担心）。

## 第三十八轮 · 周边与运行层收口 + Acceptance 成为模块（2026-11-09）

**改动**：
- 新增 `src/acceptance-workbench.ts`、`src/organization-view.ts`、`src/event-inbox.ts`、`src/code-review.ts`、`src/retry-health.ts`；
- `src/acceptance-round.ts` 增 `EvidenceRegion` / `assertEvidenceRegions`（证据区域只定位不判定，上限 8）；
- `src/scheduler.ts` 增 `when`（事件分流）/`group`/`parallel`/`mergeMinutes`（`schedule` 与 `when` 必须二选一，`superRefine` 强制）；
- `src/store.ts` outbox 增 `at` 列（旧库原地 `ALTER TABLE`）并让 `notify` 记录投递时刻；
- `src/controller.ts` 在 `sync → preview` 之间插入独立审码阶段（`reviewDelivery` + `assertCodeReviewGate` + 独立 Paperclip 文档 `code-review`）；
- `src/config.ts` 增 `eventInbox`（默认关闭）与 `codeReview.enforce`（默认开启）；
- `src/server.ts` 增 `POST /events/:source` 与两个只读动作 `retry-health` / `event-inbox-status`（同步 `v06Reads`/`readOnly`/`scripts/console-server.ts` 三处白名单）；
- 前端：`console/app.js` 重写 `AcceptanceView`、新增 `OrganizationView`、服务页增两张卡、侧栏菜单项补 `tabindex="0"`；`console/styles.css` 增键盘焦点环；
- `scripts/console-smoke.mjs` 增 12 单元验收矩阵（3 视图 × 2 主题 × 1280/320）与键盘逐键走查；
- 新增测试 6 个文件：`tests/acceptance-workbench.test.ts`（4）、`tests/organization-view.test.ts`（3）、`tests/event-inbox.test.ts`（6）、`tests/scheduler-rules.test.ts`（6）、`tests/code-review.test.ts`（6）、`tests/retry-health.test.ts`（6）。

**静态与回归**：`npm test` **620/620**、`tsc --noEmit` 0 错、`console:smoke` **ok:true / failed:[]**（7 视图 + 矩阵 12/12）、`guard:smoke` **22/22**（golden 人审重冻结，记录在 `fixtures/behavior-golden.json`）、`steps:smoke` 61/61、`agents:smoke` 全绿、`loop:smoke` 18/18。

**真跑（bridge 4180 重启加载本轮代码）**：

```text
POST /workspace/organization-view         200  shape.mode=flat / contextBase.projections 四类 / modelCalls=0
POST /workspace/v06-acceptance-workbench  200  plan·items·round·report 一次取齐；未锁定任务如实 plan:null
POST /workspace/retry-health              200  total:29（仅本机 17 / 已送达 12）/ pending 0 / verdict healthy
POST /workspace/event-inbox-status        200  enabled:false（默认关闭）
POST /events/gitlab（默认关闭）            400  {"ok":false,"reason":"events-disabled"}
```

**验收矩阵发现的真实缺陷（已修）**：
1. 侧栏菜单项默认 `tabindex=-1`、菜单根不可聚焦 → **键盘用户根本进不了侧栏**；修法：菜单项补 `tabindex="0"` + `:focus-visible` 焦点环。修后 Tab 顺序为 `概览→协作→组织→知识→验收→服务→我的配置→主题按钮`。
2. 验收页任务选择器内层 `input.el-select__input` 无可读名字；修法：`<label for>` 关联 + `id`。

**如实边界**：审码不含模型评审（确定性规则只覆盖「人一定会拦」的硬项）；事件源默认关闭且未与 GitHub 既有通道合并；矩阵只覆盖控制台三视图（插件工作台的 `test:responsive` 仍是另一套）；`parallel` 缺省不限流（与上游缺省串行不同，理由见 `docs/ROUND-38.md` 1.3）；证据区域只到数据层，未做「从该区域开始复看」的交互；本轮没有新的飞书真实工单。

## 第三十九轮 · 四条边界的收口（2026-11-09）

**改动**
- `src/event-inbox.ts`：`enabled` 缺省 `false → true`（没登记来源=没入口）；新增 `claims()`（一个来源只有一条路径）与 `mirror()`（既有通道事实进同一台账，`state='mirrored'`，不进 `pending`）；`status()` 增 `claimed` / `mirrored` / `note`。
- `src/server.ts`：`/github/webhook` 在 `claims('github')` 时交收件箱（202），否则走既有通道并在验签成功后 `mirror`；新增只读动作 `channel-health`（同步 `readOnly` 与 `scripts/console-server.ts` 白名单）。
- `src/scheduler.ts`：`routineParallel()` 返回 `{limit, source, reason}`，缺省按密度（`interval ≤ 60 分钟` → 1，其余不限）；新增 `routineParallelLimit()`；配额跳过写 `events(routine-blocked:{id})` + 审计（每小时节流）+ 恢复时标 `recovered`；`status()` 增 `parallelSource` / `parallelReason` / `blocked`。
- `src/channel-health.ts`（新增）：只读通道体检，五条检查（飞书 / GitHub / 事件源 / 钉钉企微 / 真实工单证据），不发任何外部请求。
- `console/app.js`：服务页新增「通道体检」卡；事件收件箱空态文案改为「按登记来源开启」。
- `scripts/console-smoke.mjs`：矩阵 `3 → 7` 视图（28 单元），新增白屏判据（渲染节点 < 12）。
- 测试：新增 `tests/channel-health.test.ts`（7 例）；`tests/scheduler.test.ts` 第 13 例改写为「缺省按密度串行 + 跳过留痕 + 收尾后恢复」并新增低频不走配额 1 例；`tests/event-inbox.test.ts` 增 `claims` / `mirror` 1 例并改写总开关用例。

**回归**
- `npm test` **629/629**（620 + 9）
- `npx tsc --noEmit` 0 错；`node --check console/app.js` 与 `scripts/console-smoke.mjs` 通过
- `npm run console:smoke` **ok:true / failed:[]**，58 项检查，矩阵 **28/28**

**真跑（bridge 4180，重启加载本轮代码）**

```text
POST /workspace/channel-health  200  verdict=degraded
  ready 2 / partial 1 / blocked 0 / off 2
  feishu      ready      长连接已就绪 / 1 人 1 群
  github      partial    仓库 zhegong-996/desktop-tutorial；token 与 webhook 密钥都没配
  event-inbox off        接管来源：无
  im          off        钉钉/企微未配置（按需）
  real-story  ready      真实来源工单 5 条，最近 SUI-135（2026-11-08 11:22）
```

**本轮修正的自身错误**：第一版 `channel-health` 用 `feishuState === 'ready'` 当 `botReady`，重启后 8 秒内会显示「机器人身份未通过」（实测撞到），改为长连接四态（ready / connecting / disconnected / disabled），connecting 判 partial 而不是 blocked。

**如实边界**：`mirror` 台账无清理策略；体检不探测网络（飞书 ready 只证明监听进程在）；GitHub 的 gh 登录态未被覆盖（故意判 partial 而非 blocked）；矩阵只证明结构不证明信息正确；真实工单仍需人发。
