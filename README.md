# SuitMe 协作台

个人与公共 Agent 的产品模型见[Agent 服务网](docs/AGENT-SERVICE-NETWORK.md)，事件、判断、工具执行与恢复见[自主协作运行](docs/AUTONOMOUS-COLLABORATION.md)。

**产品文档套件（2026-11-09 · 第三十六轮）**：[产品功能介绍](docs/product/README.md) · [系统架构](docs/product/system-architecture.md) · [产品架构](docs/product/product-architecture.md) · [功能架构](docs/product/feature-map.md) · [业务流程](docs/product/business-flows.md)——五份文档覆盖「是什么、怎么搭、怎么分层、哪个功能在哪、流程怎么走」，新读者从 [产品功能介绍](docs/product/README.md) 进入。

最新的功能、系统架构与技术架构说明见[架构总览](docs/SYSTEM-ARCHITECTURE.md)（2026-11-08 重写为第二十七轮 P-9 版本，取代旧版）。后台主入口包含知识库和设置；轻量模型配置按用户选择保留为预备策略，暂不启用新服务。

## 架构与方案导航（先看这里）

- **交接与项目总结**（2026-11-08）：[HANDOFF.md](HANDOFF.md) 是给下一位 Agent 的接手总纲；[PROJECT-SUMMARY.md](PROJECT-SUMMARY.md) 是系统架构 / 产品功能架构 / 业务流程设计 / 依赖与协议引用的总览。详细交接说明仍以 `HANDOFF/` 为唯一权威目录。
- **当前实现（最新权威说明）**：[功能、系统架构与技术架构](docs/SYSTEM-ARCHITECTURE.md)——产品定位与四个界面、最新功能地图、双向协作回路、技术四层与端口、唯一真源、记忆分层、只读守门、上游复用的三个层次、真实接入边界与验证命令。本版取代此前按轮次补记、只到第二十二轮 P-1 的旧版。
- **产品架构定稿**：[ARCHITECTURE-v0.6.md](docs/ARCHITECTURE-v0.6.md)——六层模型、M3 三层路由、M11 责任转移、K 知识底座与默认图谱本体；**这是设计定稿，不等于全部已实现**。
- **收敛方案与缺口清单**：[ARCHITECTURE-OPTIONS-v0.7.md](docs/ARCHITECTURE-OPTIONS-v0.7.md)——三种可选方案、主流 Agent 记忆 / ontology / router 架构分析、未实现功能逐条对应的开源复用动作、许可证边界。**判断「哪些还没做、该用哪个项目补」以这份为准**。
- **统一路由契约与宿主解耦**：[ROUTING-AND-HOST-v0.7.md](docs/ROUTING-AND-HOST-v0.7.md)——`RoutingDecision` 五维契约、5 个派活点接同一份 Trace、LobeHub 三层可执行判断、去 Paperclip 化的 `HostPlatformPort` 与开源候选矩阵。
- **共享记忆架构（方案 B）**：[MEMORY-ARCHITECTURE-v0.7.md](docs/MEMORY-ARCHITECTURE-v0.7.md)——append-only 事件主干、四类投影重放、来源撤权沿 lineage 阻断、`modelCalls=0` 确定性链路、8 处双写接线与真跑证据。
- **复用与合规**：[上游适配清单](docs/UPSTREAM-ADAPTERS.md)、[来源记录](docs/SOURCES.md)、[开源合规](docs/OPEN-SOURCE-COMPLIANCE.md)。
- **验证与最新边界**：[验证记录](docs/VALIDATION.md)、[轮次与边界声明](docs/ADAPTATION-v0.6.md)。
- **可视化导读**：[系统架构图册](docs/architecture-atlas.html)（四张 SVG，可离线打开）与[索引](docs/ARCHITECTURE-ATLAS.md)。
- **能力对照与定位**：[与上游 Agent 平台的六环节对比](docs/REFERENCE-capability-comparison.md)——含 P-9 双向回路复盘、执行链耦合点与「流转自动化 ≠ 决策自动化」口径。

当前仍以 Paperclip 为宿主底座，但宿主能力已收拢为 `HostPlatformPort`（`config.host.provider` 默认 `paperclip`，`local` 是可运行的最小非 Paperclip 实现）；完整切换路线与待补齐缺口见 [ROUTING-AND-HOST-v0.7.md](docs/ROUTING-AND-HOST-v0.7.md)。飞书发起开发任务，人在自己使用的 Agent 中接单，或由后台调用已配置的 CLI；成果默认进入本机 Git 代码交付台，按确切提交与本机 CI 结果验收（可显式回退到 GitHub 适配器）。知识空间按项目、主题或组织需要配置，在同一任务中申请资料、授权、交接、撤权并采用专业结论。

本仓库是协作平台代码。`zhegong-996/desktop-tutorial` 是当前获准的流程联调仓库，SuitMe 业务仓库不在本轮写入范围。

## 实现边界

- **Paperclip 原版**：Web 界面、项目、成员、Agent、业务任务、运行、签出、权限和恢复机制。只有一个任务调度核心。
- **Super-agent 原版模块**：飞书消息归一化、幂等回复，以及原版策略门控和需求范围判断。
- **DeepSeek Harness 原版模块**：Agent 身份与工作方法的作用域装配、提示词与工具限制、原生工具执行管线；[构建与执行边界](docs/AGENT-BUILDING.md)。
- **Autoloop 原版模块**：原版 worker、Codex/Claude/通用命令/ACP 适配器、进程与结果日志、会话接续和回执恢复。
- **Cognee 原版模块**：Ladybug 图存储、DataPoint、来源追踪、图谱渲染与知识字典模型；**L2 组织图只读自动抽取**（确定性、0 模型调用）已接入；2026-11-07 起 Cognee 原生 LLM 实体抽取 / embedding / cognify 已打开（`npm run cognee:native`），允许外部 OpenAI-compatible 模型 API，需在进程环境配置 `COGNEE_LLM_*` / `COGNEE_EMBEDDING_*`，业务材料会外发、凭据不入库。详见 [上游适配清单](docs/UPSTREAM-ADAPTERS.md)。
- **本仓库接入层**：原系统之间的身份和任务映射、交接包、限定范围的本机 Git 代码交付、版本证据和业务验收。

上游作为 Git submodule 固定到提交，不复制整套调度器。实际复用文件和版本见 [来源记录](docs/SOURCES.md)。

## 本地运行

需要 Node.js 24.11+、Corepack、Git。默认本机 Git 交付不需要 GitHub 账号、token 或 `gh` CLI；只有显式设置 `delivery.provider=github` 回退时才需要 GitHub CLI。飞书使用官方 `lark-cli` 的专用命名 profile。

```sh
git clone --recurse-submodules https://github.com/zhegong-996/suitme-collab.git
cd suitme-collab
npm ci
npm run install:upstream
npm run setup -- --prepare-only
npm run up
npm run setup
npm run install:wiki
npm run doctor
```

`install:upstream` 安装并构建 Paperclip 的 SDK、TypeScript 运行代码和 Web 界面，迁移单独的本地数据库。首版使用上游 `process` 适配器；不需要为了这个适配器编译可选的 Rust 原生执行器。

- 工作台：<http://127.0.0.1:3100>
- 接入层健康检查：<http://127.0.0.1:4180/health>
- 知识与授权协作：<http://127.0.0.1:3100/SUI/knowledge-workspaces>，启用步骤见 [功能说明](docs/WORKSPACES.md)。
- `npm run status` 查看服务；`npm run stop` 停止本项目管理的进程。
- 运行数据、日志、个人登录配置和凭据保留在忽略的 `.runtime/`，不提交 GitHub。

本地可信模式只监听回环地址。团队远程访问需要另行部署并启用 Paperclip 的多人认证，不能直接把当前端口暴露公网。

首次克隆后，先在 `.runtime/config.json` 配置获准的联调仓库及本地 checkout；准备该 checkout 后再派单。`setup` 使用现有项目和 Agent，不重复创建同名对象。

## 飞书

创建专用应用，而不是复用其他正在监听的机器人：

```sh
lark-cli config init --new --name ai-native-collab --lang zh_cn
```

在飞书后台确认机器人可用，并启用 `im.message.receive_v1`。根据官方 CLI 的权限提示配置消息接收与机器人回复权限。把机器人加入指定测试群，或直接与它聊天。

在 `.runtime/config.json` 填入该应用的 `appId`、`botId`、该应用下允许发起任务的 `allowedSenders`，必要时限定 `allowedChats`；核对完成后设置 `enabled: true` 并重启接入层。不同应用的 open_id 不能直接通用。默认没有允许的发起人，禁止启动派单监听。

发起示例（方括号里是执行端代号，可以省略）：

```text
任务 [codex] 在 collab-pilot/index.html 创建一个任务状态页面。
验收：可以新增任务；可以修改状态；刷新后保留任务
```

群聊需要 @机器人。用中文指令即可，不需要记英文命令；闲聊不会自动建单：

```text
任务 整理本周客户反馈
查看进度 SUI-1
补充说明 SUI-1 先保留现有页面，只修改新增任务的交互。
转交 SUI-1 workbuddy
确认验收 SUI-1
验收不通过 SUI-1 刷新后任务丢失
```

验收只能由原任务发起人在原会话操作。开工前锁定了验收清单的任务，按清单与独立逐项评审报告「确认验收」，不需要交付提交号；代码交付类任务仍由系统核对 CI 与部署版本，要写成「确认验收 SUI-1 交付提交号」。Agent 的「完成」只结束本轮，不关闭业务任务。旧英文斜杠命令仍可解析（兼容既有脚本），但不再出现在帮助文案、工作台或验收报告里。

## 接入其他 Agent

见 [接入合同](docs/agent-integration.md)。

- 已验证 CLI 可用性后，后台可以通过上游 Codex／Claude 适配器执行任务。
- 任意有非交互执行入口的 CLI，可以配置 `use: command` 和 argv 参数数组；不拼接 shell。
- 支持 ACP 的执行端可以复用 Autoloop ACP 适配器，须先实际验证环境和会话恢复。
- WorkBuddy、豆包工作等可通过本地 CLI 或标准 MCP **人工接单**。这与后台自动启动该产品是两种能力，不能因支持调用 CLI 就认定产品自身提供了可被调用的 CLI。
- Grok Bot／Cursor 云端自动派单属于后续扩展，未验证领取、回传、取消、失联恢复前不启用。

当前机器的实际状态由 `npm run doctor` 给出。注册名称或生成连接配置不等于该产品已经实测接通。

## 交付和验收

试点执行器只在独立工作树内修改配置允许的路径。默认交付模块检查差异、把任务分支推送到本机裸仓库并登记一条交付请求，Agent 不负责合并和发布。

本机 CI 校验提交存在、允许路径与无冲突，通过后把静态预览固定到确切提交（写 `version.json` 与 `index.html`）。预览只绑 loopback，不代表生产部署，也不代表已合并。

任务的 `handoff`、`checkpoint`、`delivery`、`deployment`、`acceptance`、`decisions` 使用 Paperclip 已有的任务文档保存。SQLite 只存来源映射、消息去重、执行接入状态和发件箱，不替代 Paperclip 的任务库。

## 知识与跨职能协作

采用集成成熟方案与个性化界面的方式。知识引擎直接接入固定版本 Cognee，当前可生成确切来源修订的文档/字段图谱，使用原版图谱前端，按空间配置知识字典、属性、枚举与关系。安装：`npm run setup:graph`（需要 uv），再重启 bridge 并安装工作台插件。真实图持久化已验证；L2 组织图可从该投影确定性生成带原文证据的草稿边（`src/org-extraction.ts`，0 模型调用）。**Cognee 原生实体抽取、embedding 与 Agent 语义记忆仍未启用**；另有一套**完全在本机、不联网**的 Apple NaturalLanguage 设备端词向量用于 recall 的语义加权（`src/semantic-recall.ts`），以及 Apple Vision 设备端 OCR/分类的**本机视觉评审端点**（`scripts/vision-server.ts`，仅 `127.0.0.1`），二者都不下载模型、不调用外部模型服务，也不改变 Cognee 的隔离边界。详见 [方案比较及复用边界](docs/KNOWLEDGE-ENGINE.md)。

复用 Paperclip 自带的 **LLM Wiki 插件**作为知识浏览、来源、Markdown 页面、版本及维护入口，不另写编辑器和检索引擎。安装脚本使用同一固定提交的插件，通过其原生配置 API 绑定专用本地目录和现有接单身份。自动摄取默认关闭；插件的团队空间字段尚不能视为已经验证的保密边界，私有业务资料不进入这个共享 Wiki。

本仓库的薄接入层负责结构化知识合同：专业标签、事实字段、适用范围、来源、正文、候选/确认/撤回、版本绑定和任务引用。记录仍保存在 Paperclip 任务文档，读取时重新检查原生任务 ACL；确认签名防止模型直接改正文状态来自行升级为已确认知识。更改或撤回源资料后，后续执行不会继续自动加载原确认。

跨专业共享和授权方案、开源对照见 [知识与授权架构](docs/KNOWLEDGE-AND-ACCESS.md)。可配置知识空间与授权协作已经接入后台页面，当前实现、复用范围、验证和运行边界见 [功能说明](docs/WORKSPACES.md)。当前为本机管理员与专业 Agent 身份模式，多人身份和飞书组织映射尚未部署。

平台保留“人工审批后合并、发布另行决定”的约定。本机交付台的合并审批不等于业务验收，也不会自动合入业务仓库。

## 验证

```sh
npm test
npm run typecheck
npm run doctor
npm run routing:status   # 统一路由 Trace、5 处接线自检、三层判断与平台切换清单
npm run host:smoke       # 真跑不依赖 Paperclip 的最小宿主（临时目录，无副作用）
npm run memory:replay    # 只读重放共享记忆四类投影、checksum 与撤权状态
npm run memory:smoke     # 临时目录真跑「写入 → 重放 → 撤权 → 不可召回」
```

自动测试使用临时状态和模拟接口，覆盖去重、并发签出、过期回执、部分失败重试、交付范围、版本验收及真实 stdio MCP 协议。真实飞书消息、模型执行、本机 CI、预览与人工验收应分别记录；通过单元测试不等于真实全流程通过。

本机已跑通的真实流程与尚未启用的能力见 [验证记录](docs/VALIDATION.md)。CLI 用量保存在回执中，费用尚未完整回填 Paperclip 成本账本，界面的零费用不代表没有发生模型调用。

### 本机验收报告与组织映射

这两项只在本机操作，业务正文、密钥与截图不外发：

```sh
npm run acceptance:list                       # 列出已归档的逐项验收报告
npm run acceptance:report -- <任务ID>          # 生成中文 HTML 逐项报告
npm run acceptance:serve                      # 只监听 127.0.0.1:4192 的只读报告服务
npm run acceptance:self-check -- <round.json> # 把打回原因沉淀为下次自查标准
npm run org:preview                           # 读取当前授权范围可见的飞书成员，生成草案
npm run org:auth                              # 生成补齐部门 scope 的登录命令（携带现有全部 scope）
npm run org:table -- --exclude "已离职成员"    # 记录 owner 核对结论并生成组织表
npm run org:apply -- <org-table.json>         # 组织 owner 人工确认后导入职能注册表
npm run delivery:serve                        # 本机 Git 服务 + 中文代码交付台（127.0.0.1:4194）
npm run delivery:demo                         # 真跑一遍 clone/pull、push、本机 CI、审批与预览
```

### 本机代码交付（国内环境默认）

`delivery.provider` 默认 `local`，不需要 GitHub 账号、token 或海外网络。`npm run delivery:serve` 在 `127.0.0.1:4194` 起中文交付台，同时启动 `git://127.0.0.1:9418/suitme-collab.git`（只绑 loopback），可以 `git clone` / `pull` / `push`：

```sh
git clone git://127.0.0.1:9418/suitme-collab.git
git push git://127.0.0.1:9418/suitme-collab.git HEAD:refs/heads/你的分支
```

交付台提供提交与分支查看、**本机 CI**（提交存在 / 允许路径 / 与 main 无冲突）、合并审批（同意 / 打回 / 登记合并）、通知记录与固定到确切提交的预览。控制器通过 `DeliveryAdapter` 注入该实现，`prepare/publish/inspect/preview` 四个动作与原有 GitHub 适配器一致；已有部署可显式设置 `delivery.provider=github` 回退。**合并审批不等于业务验收**，业务验收仍由原发起人在原会话「确认验收」。

### 前端国内适配

`npm run install:upstream` 与 `npm run up` 都会保证中文壳生效（上游重新构建覆盖后自动重建一次）；`npm run build:chinese-shell` 可重复执行（构建前恢复上游 `sw.js` 的原始占位符）。构建期收敛 Paperclip 侧栏的技能库 / 连接服务入口，运行时用同源静态资源过滤页面里**未连接**的海外集成卡片；两者都不改上游源码。运行时脚本只检查小型可交互节点，并保护 `#root` 与包含工作台的大容器，避免宿主外壳被误判为「未连接卡片」而整页白屏。

插件前端源码已按职责拆层：`index.tsx` 只作 SDK 入口再导出，实现分布在 `foundation.tsx`（原语与 `UI` 契约）、`async.ts`（只读状态机与写操作反馈）、`forms.tsx`、`domestic-services.tsx`、`settings.tsx`、`task-detail.tsx`、`spaces.tsx`、`workspace-page.tsx`。**5 个主 tab、路由与上游 UI 均未改动**，分层与依赖约束见 `docs/SYSTEM-ARCHITECTURE.md`，结构守卫在 `tests/frontend-structure.test.ts`。

设置里的「国内服务」由只读 `service-status` 统一提供数据：并发实时探测 3100 / 4190 / 4192 / 4194，逐项标注状态来源（实时探测、进程内判定或监听器事件推断），页面每 15 秒自动刷新，也可手动刷新，探测失败与「未启动」分开显示。**只有状态为已接通且 URL 通过 loopback 校验的条目才渲染链接**；未接通项给出原因与可照做的接通步骤，不放任何可点空壳。交付台健康响应还要校验 `scope=loopback-only` / `provider=local-git` / 端口，避免端口被别的服务占用时误判为已接通。宿主侧栏的「技能 / 连接服务」链接带公司前缀（`/SUI/skills`、`/SUI/apps`），运行时脚本也已覆盖这类路径并隐藏其列表项；自动刷新瞬时失败会静默保留上次结果，不弹误导性错误框。

启动后打开 `http://127.0.0.1:4192/overview` 可看到本机成果总览：实时探测 Paperclip `3100`、Bridge `4180`、Apple Vision `4190`、报告服务 `4192`，并展示当前验收链配置、中文指令清单（与 `USER_HELP` 同源）、按清单确认验收的四步、脱敏的飞书组织草案摘要与归档报告入口。总览页只读、只绑 loopback，不展示真实姓名与 `open_id`。本机实例的 `acceptance.mode=independent` 依赖 `4190` 视觉端点，需先运行 `npm run vision:start`；端点停机时独立评审链会失败而不是自动降级。（4190 与 4192 当前在本机未启动；服务是否在线可直接在设置 →「国内服务」页查看，不必依赖总览页。）

报告与自查标准只提供证据，不代替原发起人在原会话「确认验收」；`lobehub/acceptance` 的云端报告服务与 CLI 未启动。组织草案不参与派单、不等于真人登录，真实姓名与 `open_id` 只写 `.runtime/`（不入库）；导入需组织 owner 并携带职能注册表当前修订号。


### 协作 Agent 与上下文工作区

入口仍为 /SUI/knowledge-workspaces，按“我的工作、协作任务、知识空间、授权申请”组织。用户给出目标后，Agent 在已配置的资源权限和任务委托内查找上下文、准备访问申请、归纳待办、制作工作稿、保存检查点与知识候选；关键授权、知识采用和验收由人决定。支持补充背景、关联已有飞书来源与本机代码交付、查看输入来源与版本，内容或权限变化后停用旧结果。

运行 npm run setup:assistant、npm run restart:bridge、npm run install:workspaces 启用，当前使用已登录 Codex。详见 [Agent 与上下文说明](docs/ASSISTANT-CONTEXT.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。

真实飞书 Docx 与选定历史讨论现已按任务读取，支持从 IM 接续同一协作任务。空间与参与者可配置，不将部门名称写成权限枚举。见 [飞书来源与动态协作](docs/FEISHU-SOURCES.md)。

多人身份、A2A 服务委托、飞书成员配对、持续知识索引和新版界面的实际边界见[团队协作与记忆](docs/TEAM-NETWORK-MEMORY.md)。
