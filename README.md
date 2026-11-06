# SuitMe 协作台

个人与公共 Agent 的产品模型见[Agent 服务网](docs/AGENT-SERVICE-NETWORK.md)，事件、判断、工具执行与恢复见[自主协作运行](docs/AUTONOMOUS-COLLABORATION.md)。

当前系统的数据库、服务、模型和知识管理状态见[架构与接入核验](docs/SYSTEM-ARCHITECTURE.md)。后台主入口包含知识库和设置；轻量模型配置按用户选择保留为预备策略，暂不启用新服务。

基于 Paperclip 的团队协作工作台。飞书发起开发任务，人在自己使用的 Agent 中接单，或由后台调用已配置的 CLI；成果进入 GitHub，再按具体提交和环境验收。知识空间按项目、主题或组织需要配置，在同一任务中申请资料、授权、交接、撤权并采用专业结论。

本仓库是协作平台代码。`zhegong-996/desktop-tutorial` 是当前获准的流程联调仓库，SuitMe 业务仓库不在本轮写入范围。

## 实现边界

- **Paperclip 原版**：Web 界面、项目、成员、Agent、业务任务、运行、签出、权限和恢复机制。只有一个任务调度核心。
- **Super-agent 原版模块**：飞书消息归一化、幂等回复，以及原版策略门控和需求范围判断。
- **DeepSeek Harness 原版模块**：Agent 身份与工作方法的作用域装配、提示词与工具限制、原生工具执行管线；[构建与执行边界](docs/AGENT-BUILDING.md)。
- **Autoloop 原版模块**：原版 worker、Codex/Claude/通用命令/ACP 适配器、进程与结果日志、会话接续和回执恢复。
- **Cognee 原版模块**：Ladybug 图存储、DataPoint、来源追踪、图谱渲染与知识字典模型；**L2 组织图只读自动抽取**（确定性、0 模型调用）已接入，Cognee 原生 LLM 实体抽取、embedding 与语义记忆管线暂不启用。详见 [上游适配清单](docs/UPSTREAM-ADAPTERS.md)。
- **本仓库接入层**：原系统之间的身份和任务映射、交接包、限定范围的 GitHub 交付、版本证据和业务验收。

上游作为 Git submodule 固定到提交，不复制整套调度器。实际复用文件和版本见 [来源记录](docs/SOURCES.md)。

## 本地运行

需要 Node.js 24.11+、Corepack、Git、已登录的 GitHub CLI。飞书使用官方 `lark-cli` 的专用命名 profile。

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

发起示例：

```text
/task [codex] 在 collab-pilot/index.html 创建一个任务状态页面。
验收：可以新增任务；可以修改状态；刷新后保留任务
```

群聊需要 @机器人。回复示例：

```text
/status SUI-1
/reply SUI-1 先保留现有页面，只修改新增任务的交互。
/handoff SUI-1 workbuddy
/accept SUI-1 交付提交的完整SHA
/reject SUI-1 刷新后任务丢失
```

验收只能由原任务发起人在原会话操作。CI 与部署版本由系统核对；`/accept` 表示发起人确认任务交接包中的所有业务验收项。Agent 的“完成”只结束本轮，不关闭业务任务。

## 接入其他 Agent

见 [接入合同](docs/agent-integration.md)。

- 已验证 CLI 可用性后，后台可以通过上游 Codex／Claude 适配器执行任务。
- 任意有非交互执行入口的 CLI，可以配置 `use: command` 和 argv 参数数组；不拼接 shell。
- 支持 ACP 的执行端可以复用 Autoloop ACP 适配器，须先实际验证环境和会话恢复。
- WorkBuddy、豆包工作等可通过本地 CLI 或标准 MCP **人工接单**。这与后台自动启动该产品是两种能力，不能因支持调用 CLI 就认定产品自身提供了可被调用的 CLI。
- Grok Bot／Cursor 云端自动派单属于后续扩展，未验证领取、回传、取消、失联恢复前不启用。

当前机器的实际状态由 `npm run doctor` 给出。注册名称或生成连接配置不等于该产品已经实测接通。

## 交付和验收

试点执行器只在独立工作树内修改配置允许的路径。固定交付模块检查差异、推送任务分支并创建或更新同一个 PR，Agent 不负责合并和发布。

试点 CI 产出带提交 SHA 的静态页面产物。接入层只从同一提交成功的 Actions 下载匹配产物，校验 `version.json` 后提供本地 PR 预览。这个环境明确标记为 `local-pr-preview`，不代表生产部署，也不代表 PR 已合并。

任务的 `handoff`、`checkpoint`、`delivery`、`deployment`、`acceptance`、`decisions` 使用 Paperclip 已有的任务文档保存。SQLite 只存来源映射、消息去重、执行接入状态和发件箱，不替代 Paperclip 的任务库。

## 知识与跨职能协作

采用集成成熟方案与个性化界面的方式。知识引擎直接接入固定版本 Cognee，当前可生成确切来源修订的文档/字段图谱，使用原版图谱前端，按空间配置知识字典、属性、枚举与关系。安装：`npm run setup:graph`（需要 uv），再重启 bridge 并安装工作台插件。真实图持久化已验证；L2 组织图可从该投影确定性生成带原文证据的草稿边（`src/org-extraction.ts`，0 模型调用）。**Cognee 原生实体抽取、embedding 与 Agent 语义记忆仍未启用**；另有一套**完全在本机、不联网**的 Apple NaturalLanguage 设备端词向量用于 recall 的语义加权（`src/semantic-recall.ts`），以及 Apple Vision 设备端 OCR/分类的**本机视觉评审端点**（`scripts/vision-server.ts`，仅 `127.0.0.1`），二者都不下载模型、不调用外部模型服务，也不改变 Cognee 的隔离边界。详见 [方案比较及复用边界](docs/KNOWLEDGE-ENGINE.md)。

复用 Paperclip 自带的 **LLM Wiki 插件**作为知识浏览、来源、Markdown 页面、版本及维护入口，不另写编辑器和检索引擎。安装脚本使用同一固定提交的插件，通过其原生配置 API 绑定专用本地目录和现有接单身份。自动摄取默认关闭；插件的团队空间字段尚不能视为已经验证的保密边界，私有业务资料不进入这个共享 Wiki。

本仓库的薄接入层负责结构化知识合同：专业标签、事实字段、适用范围、来源、正文、候选/确认/撤回、版本绑定和任务引用。记录仍保存在 Paperclip 任务文档，读取时重新检查原生任务 ACL；确认签名防止模型直接改正文状态来自行升级为已确认知识。更改或撤回源资料后，后续执行不会继续自动加载原确认。

跨专业共享和授权方案、开源对照见 [知识与授权架构](docs/KNOWLEDGE-AND-ACCESS.md)。可配置知识空间与授权协作已经接入后台页面，当前实现、复用范围、验证和运行边界见 [功能说明](docs/WORKSPACES.md)。当前为本机管理员与专业 Agent 身份模式，多人身份和飞书组织映射尚未部署。

平台保留“作者自行合并、Actions 发布”的现有协作约定。试点代码不会自动合入业务仓库。

## 验证

```sh
npm test
npm run typecheck
npm run doctor
```

自动测试使用临时状态和模拟接口，覆盖去重、并发签出、过期回执、部分失败重试、交付范围、版本验收及真实 stdio MCP 协议。真实飞书消息、模型执行、GitHub CI、预览与人工验收应分别记录；通过单元测试不等于真实全流程通过。

本机已跑通的真实流程与尚未启用的能力见 [验证记录](docs/VALIDATION.md)。CLI 用量保存在回执中，费用尚未完整回填 Paperclip 成本账本，界面的零费用不代表没有发生模型调用。


### 协作 Agent 与上下文工作区

入口仍为 /SUI/knowledge-workspaces，按“我的工作、协作任务、知识空间、授权申请”组织。用户给出目标后，Agent 在已配置的资源权限和任务委托内查找上下文、准备访问申请、归纳待办、制作工作稿、保存检查点与知识候选；关键授权、知识采用和验收由人决定。支持补充背景、关联已有飞书/GitHub交付、查看输入来源与版本，内容或权限变化后停用旧结果。

运行 npm run setup:assistant、npm run restart:bridge、npm run install:workspaces 启用，当前使用已登录 Codex。详见 [Agent 与上下文说明](docs/ASSISTANT-CONTEXT.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。

真实飞书 Docx 与选定历史讨论现已按任务读取，支持从 IM 接续同一协作任务。空间与参与者可配置，不将部门名称写成权限枚举。见 [飞书来源与动态协作](docs/FEISHU-SOURCES.md)。

多人身份、A2A 服务委托、飞书成员配对、持续知识索引和新版界面的实际边界见[团队协作与记忆](docs/TEAM-NETWORK-MEMORY.md)。
