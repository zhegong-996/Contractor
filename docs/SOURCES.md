# 实现来源与分发

Contractor 原创代码采用 [MIT](../LICENSE)。第三方代码仍采用其各自许可。npm 锁文件固定包版本和完整性校验，源码子模块固定提交。分发时按实际交付的文件保留 [第三方声明](../THIRD_PARTY_NOTICES.md)。

## 实际保留的源码与依赖

| 来源 | 使用边界 | 随哪份制品分发 |
| --- | --- | --- |
| [Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4) | 工单和委托 Engine、Store、Effects，飞书来源及回传适配。项目关系、资料权限、路由和验收由 Contractor 实现。 | 源码子模块，MIT。其 Store 使用独立发布的 MIT Schemastery、Cosmokit。 |
| [Agent AutoLoop](https://github.com/KKKKhazix/agent-autoloop/tree/ba8cf6d8cf24f9ce005958c15d88f2d9cff7f05d) | 既有运行目录使用的兼容调度器与 CLI worker。离线回滚复用固定版的事实日志写入接口。Contractor 自研调度器使用自己的账本。 | 源码子模块及兼容执行端包，MIT。Contractor 专用执行端包按单独清单打包。 |
| [Octop Gateway](https://github.com/TencentCloud/octop-gateway/tree/224ed078ce20042fb5fa59240d6e3c7c34bcd67f) · [Octop Memory](https://github.com/TencentCloud/octop-memory/tree/37ef325d46f13181eba69591604465d04c95cb5f) | 选配的多平台传输和全文排序。统一入站、原会话回执、授权与知识账本由 Contractor 实现。 | 源码子模块，MIT。Python 安装环境由部署者准备。 |
| [Octop](https://github.com/TencentCloud/Octop/tree/bf134dbd379036ce7545c7df1a1da7e381ece9ff) | 两个经适配的成员选择和消息署名组件，保留文件级来源。 | 源码包及浏览器产物，MIT。 |
| [Ant Design](https://github.com/ant-design/ant-design/tree/6.7.1) 与 React | UI 组件，Contractor 自己组织页面、状态和权限。 | 从 npm 安装，浏览器产物包含实际打入的模块和许可。 |
| [Figma REST API 类型](https://github.com/figma/rest-api-spec) | TypeScript 检查 Figma API 的响应字段。资料读取、复核源站权限和候选发布由 Contractor 实现。 | MIT 开发依赖，类型在构建时擦除。 |

Backstage 资料引用和 Casbin 角色判定已经替换为 Contractor 实现。旧资料标识、知识关系类型和既有角色策略文件格式有兼容处理。根锁文件、浏览器和执行端包按现行实现审计。历史提交仍有当时的依赖和许可。

## 自研范围与设计参考

| 能力 | Contractor 实现 |
| --- | --- |
| 统一入站、过滤、路由与回传 | [渠道账本](../src/workbench/channel-journal.ts)、[渠道工作流](../src/workbench/channel-workflow.ts)、[归属与派工](../src/workbench/router.ts)。台账与外部传输解耦。 |
| 调度与运行恢复 | [调度器](../src/workbench/execution/scheduler.ts)、[CLI worker](../src/workbench/execution/worker.ts)、[回执恢复](../src/workbench/execution-receipts.ts)。共用工作台的业务授权、额度、审计与验收。 |
| 知识、权限与上下文 | [知识与版本](../src/workbench/knowledge.ts)、[授权复核](../src/workbench/knowledge-authority.ts)、[知识图谱](../src/workbench/knowledge-graph.ts)、[平台策略](../src/rbac.ts)。 |
| 交付、验收、回归评估与前端 | [证据](../src/workbench/delivery-evidence.ts)、[逐项验证](../src/workbench/product-verification.ts)、[人工验收](../src/workbench/ticket-acceptance.ts)、[回归](../src/workbench/regression-review.ts)、[工作台](../workbench/src)。 |

DeepSeek Harness 的生命周期和能力分层、LobeHub 的对话与整理、Acceptance 和 LoopForge 的逐项验证与交付门禁、Co-Sight 的任务和会话管理是设计参考。这些设计落在 Contractor 的模块中。它们的上游项目不作为安装依赖列入。 [DeepSeek Harness 架构](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/docs/architecture.md) · [LobeHub](https://github.com/lobehub/lobehub) · [Acceptance](https://github.com/lobehub/acceptance) · [LoopForge](https://github.com/Tencent/LoopForge)

## 许可检查与制品

| 制品 | 依赖与声明 |
| --- | --- |
| 源码包 | `npm run package:source -- --committed` 从已跟踪的白名单路径生成。包含产品文档、样例、锁文件和固定上游源码。运行目录、口令、私有项目数据和 Git 历史在包外。 |
| 浏览器构建 | `npm run build:ui` 输出 `dist/workbench`，包含打入浏览器的模块许可清单与随附声明。以 `npm run audit:upstream -- --browser` 核对此产物。 |
| 执行端包 | `npm run package:runner` 为兼容版，`npm run package:runner -- --contractor-only` 为自研协议专用版。两种包都附本制品的声明，安装时按声明版本拉取 MIT 的 tsx、Zod。 |
| 额外的执行工具 | Codex、Claude Code、Entire 及 Anthropic Sandbox Runtime 独立安装。SRT 使用 [外置锁](../fixtures/sandbox-provider/package-lock.json) 验证固定版本，适用于需要隔离的 Codex 路径。源码包分发安装清单，浏览器和执行端包不携带 SRT。 [执行端手册](WORKBENCH-REMOTE-RUNNER.md) |

默认依赖中保留 ISC 的 `lucide-react`、`yaml` 和 Markdown 依赖链中的 `@ungap/structured-clone`。构建环境单独使用 Apache-2.0 的 TypeScript 与 MPL-2.0 的 Lightning CSS 等工具，示例验收工作流单独安装 Apache-2.0 的 Playwright。外置 SRT 为 Apache-2.0，其 `node-forge` 采用 BSD-3-Clause 选项。审核按包和使用范围明确列出例外。 [审核脚本](../scripts/audit-upstream.ts) · [Apache 2.0 第 4 节](https://www.apache.org/licenses/LICENSE-2.0) · [ISC 许可](https://opensource.org/license/isc-license-txt)

部署者如另行制作带模型 CLI、系统工具或 Octop Python 环境的镜像，需要以那个镜像的实际内容为准核对许可证和分发义务。Octop 的 Telegram 传输可选用 LGPL-3.0-only 的 `python-telegram-bot`。平台、模型 API 及凭据由部署者取得授权。 [Gateway 的 Python 安装清单](../upstream/octop-gateway/pyproject.toml)
