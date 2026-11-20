# 实现来源与分发

Contractor 原创代码采用 [MIT](../LICENSE)。第三方代码仍采用其各自许可。npm 锁文件固定包版本和完整性校验，源码子模块固定提交。分发时按实际交付的文件保留 [第三方声明](../THIRD_PARTY_NOTICES.md)。

## 仓库复用了多少源码

| 统计范围 | 当前数量 | 核对依据 |
| --- | --- | --- |
| 固定提交的上游源码子模块 | **4 个**，均为 MIT | [子模块清单](../.gitmodules) · [来源锁定](../sources.lock.json) |
| 产品目录内从上游适配的业务组件 | **2 个**，来自同一个 Octop 仓库 | [成员选择](../workbench/src/octop/TopicMemberPicker.tsx) · [消息署名](../workbench/src/octop/SignedTopicReply.tsx) · [MIT 声明](../licenses/octop-MIT.txt) |
| 根项目 npm 直接依赖 | **13 个运行依赖、10 个开发依赖**。根锁文件共有 **327 条包记录**，包括传递依赖和不同平台的可选构建包。 | [安装清单](../package.json) · [根锁文件](../package-lock.json) |
| 独立示例与外置执行隔离 | 验收示例锁 **2 条**，外置沙箱锁 **5 条** | [验收示例](../integrations/github/store-small-screen/.github/contractor-store-small-screen/package-lock.json) · [沙箱锁](../fixtures/sandbox-provider/package-lock.json) |

源码的直接复用合计来自 **5 个上游项目**。子模块、两处适配代码和 npm 包按不同口径列出。浏览器产物的实际模块以当次构建生成的许可清单为准。

## 实际保留的源码与依赖

| 来源 | 使用边界 | 随哪份制品分发 |
| --- | --- | --- |
| [Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4) | 工单、委托与效果队列的通用内核。沿用部分飞书接入与发送实现。Contractor 在 [接口层](../src/superagent-ports.ts) 接入 Engine、Store 和 Effects，业务权限及流程在工作台实现。 | 源码子模块，MIT。Store 使用经 npm 独立安装的 Schemastery 和 Cosmokit。 |
| [Agent AutoLoop](https://github.com/KKKKhazix/agent-autoloop/tree/ba8cf6d8cf24f9ce005958c15d88f2d9cff7f05d) | 既有实例的兼容调度器和 CLI Worker。离线迁移、备份和回滚仍需读取原签名及事实日志。Contractor 模式用 [自研调度器](../src/workbench/execution/scheduler.ts) 和 [自研 Worker](../src/workbench/execution/worker.ts) 接单。 | 源码子模块和兼容执行端包，MIT。Contractor 专用执行端包的清单不带 AutoLoop 源码。 |
| [Octop Gateway](https://github.com/TencentCloud/octop-gateway/tree/224ed078ce20042fb5fa59240d6e3c7c34bcd67f) | 选配的多平台连接、消息解析、平台 SDK 和传输。Contractor 实现持久入站、业务路由、权限与原会话回执。 | 源码子模块，MIT。Python 运行环境由部署者安装。 |
| [Octop Memory](https://github.com/TencentCloud/octop-memory/tree/37ef325d46f13181eba69591604465d04c95cb5f) | 选配的全文索引和排序。由工作台先筛出授权候选，索引返回相关结果。知识版本、采用、撤权、来源和关系归 Contractor 管理。 | 源码子模块，MIT。Python 运行环境由部署者安装。 |
| [Octop Web](https://github.com/TencentCloud/Octop/tree/bf134dbd379036ce7545c7df1a1da7e381ece9ff) | 适配其成员选择和消息署名，接入 Contractor 的数据模型。 | 两个组件随源码包及浏览器产物分发，保留文件级来源及 MIT 声明。 |
| [Ant Design](https://github.com/ant-design/ant-design/tree/6.7.1)、React 等 UI 依赖 | npm UI 组件、渲染、图标、头像、Markdown 和查询缓存。页面、菜单、任务视图和角色逻辑由 Contractor 组织。 | 从 npm 安装，浏览器产物包含打入的模块和对应许可。 |
| [Figma REST API 类型](https://github.com/figma/rest-api-spec) | TypeScript 检查 Figma API 的响应字段。资料读取、复核源站权限和候选发布由 Contractor 实现。 | MIT 开发依赖，类型在构建时擦除。 |

Backstage 资料引用和 Casbin 角色判定已由 [资料引用](../src/workbench/catalog-reference.ts) 和 [角色策略](../src/rbac.ts) 接手。现行锁文件不再安装这两个包。旧资料标识、知识关系和角色策略文件格式仍可读取。历史提交保有当时的来源与许可。

## 自研范围与设计参考

| 能力 | Contractor 实现 |
| --- | --- |
| 统一入站、过滤、路由与回传 | [渠道账本](../src/workbench/channel-journal.ts)、[渠道工作流](../src/workbench/channel-workflow.ts)、[归属与派工](../src/workbench/router.ts)。台账与外部传输解耦。 |
| 调度与运行恢复 | [调度器](../src/workbench/execution/scheduler.ts)、[CLI worker](../src/workbench/execution/worker.ts)、[回执恢复](../src/workbench/execution-receipts.ts)。共用工作台的业务授权、额度、审计与验收。 |
| 知识、权限与上下文 | [知识与版本](../src/workbench/knowledge.ts)、[授权复核](../src/workbench/knowledge-authority.ts)、[知识图谱](../src/workbench/knowledge-graph.ts)、[平台策略](../src/rbac.ts)。 |
| 交付、验收、回归评估与前端 | [证据](../src/workbench/delivery-evidence.ts)、[逐项验证](../src/workbench/product-verification.ts)、[人工验收](../src/workbench/ticket-acceptance.ts)、[回归](../src/workbench/regression-review.ts)、[工作台](../workbench/src)。 |

| 设计参考 | 本项目中的实现 |
| --- | --- |
| DeepSeek Harness 的生命周期和能力分层 | 启动时组装插件与业务核心。Super-agent 源码与 npm 的 DeepSeek 通用包另外按上表登记。 [插件模块](PLUGIN-ARCHITECTURE.md) |
| LobeHub、Paperclip、Co-Sight 的任务和会话组织 | 自建工作台的会话目录、看板、角色入口、工单和执行记录。 [工作台源码](../workbench/src) |
| Acceptance、LoopForge 的逐项检查和回归 | 自研产品检查、按版验收、GitHub 工作流证据和回归对照。 [验收模块](WORKBENCH-DELIVERY-TEMPLATE.md) |
| Octop 的专家共享、技能与记忆组织 | Contractor 实现专家共享、技能版本及只读模型适配。执行侧使用本项目的 [只读模型入口](../src/workbench/deepseek_readonly.py)，源码复用集中在上表的 Gateway、Memory 和两处界面组件。 |

## 许可检查与制品

| 制品 | 依赖与声明 |
| --- | --- |
| 源码包 | `npm run package:source -- --committed` 从已跟踪的白名单路径生成。包含产品文档、样例、锁文件和固定上游源码。运行目录、口令、私有项目数据和 Git 历史在包外。 |
| 浏览器构建 | `npm run build:ui` 输出 `dist/workbench`，包含打入浏览器的模块许可清单与随附声明。以 `npm run audit:upstream -- --browser` 核对此产物。 |
| 执行端包 | `npm run package:runner` 为兼容版，`npm run package:runner -- --contractor-only` 为自研协议专用版。两种包都附本制品的声明，安装时按声明版本拉取 MIT 的 tsx、Zod。 |
| 额外的执行工具 | Codex、Claude Code、Entire 及 Anthropic Sandbox Runtime 独立安装。SRT 使用 [外置锁](../fixtures/sandbox-provider/package-lock.json) 验证固定版本，适用于需要隔离的 Codex 路径。源码包分发安装清单，浏览器和执行端包不携带 SRT。 [执行端手册](WORKBENCH-REMOTE-RUNNER.md) |

默认依赖中保留 ISC 的 `lucide-react`、`yaml` 和 Markdown 依赖链中的 `@ungap/structured-clone`。构建环境单独使用 Apache-2.0 的 TypeScript 与 MPL-2.0 的 Lightning CSS 等工具，示例验收工作流单独安装 Apache-2.0 的 Playwright。外置 SRT 为 Apache-2.0，其 `node-forge` 采用 BSD-3-Clause 选项。审核按包和使用范围明确列出例外。 [审核脚本](../scripts/audit-upstream.ts) · [Apache 2.0 第 4 节](https://www.apache.org/licenses/LICENSE-2.0) · [ISC 许可](https://opensource.org/license/isc-license-txt)

部署者如另行制作带模型 CLI、系统工具或 Octop Python 环境的镜像，需要以那个镜像的实际内容为准核对许可证和分发义务。Octop 的 Telegram 传输可选用 LGPL-3.0-only 的 `python-telegram-bot`。平台、模型 API 及凭据由部署者取得授权。 [Gateway 的 Python 安装清单](../upstream/octop-gateway/pyproject.toml)
