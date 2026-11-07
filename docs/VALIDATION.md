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
