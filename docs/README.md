# Contractor 文档

这里收纳当前有效的产品、架构、部署和开发说明。带日期的审计、迁移过程和上线记录见 [历史记录](HISTORY.md)，这些材料保留当时的证据，不替代当前实现。

## 开始使用

| 文档 | 用途 |
| --- | --- |
| [功能与模块手册](PRODUCT-CAPABILITY-MAP.md) | 从身份、项目、工单到验收和知识的完整功能地图 |
| [配置 Contractor](CONFIGURATION.md) | 工作台、项目、模型、积分、渠道和执行端的配置入口 |
| [第一次用执行端接单](QUICKSTART-RUNNER.md) | 完成一次真实的领取、执行、回传和验收 |
| [界面与操作](WORKBENCH-FRONTEND-WORKSPACE.md) | 任务中心、会话、待办、Agent 和平台管理的使用说明 |

## 架构与流程

| 文档 | 用途 |
| --- | --- |
| [Super Agent 思路与 Contractor](SUPER-AGENT-OPERATING-MODEL.md) | 产品哲学、过滤与研判、飞书确认、前后差异、角色分工和“包工头”命名 |
| [系统架构](ARCHITECTURE.md) | 输入、处理、输出、核心模块和部署边界 |
| [业务流程](BUSINESS-FLOWS.md) | 登录、渠道、路由、Worker、交付、验收和恢复时序 |
| [数据模型](DATA-MODEL.md) | 账号、项目、主题、工单、版本、运行和知识的关系 |
| [插件架构](PLUGIN-ARCHITECTURE.md) | 稳定业务核心与可替换适配器的边界 |
| [项目组织方式](WORKBENCH-PROJECT-ARCHITECTURE.md) | 项目、子项目、主题、工单和来源如何关联 |
| [成员执行隔离](MEMBER-EXECUTION-ISOLATION.md) | 成员、设备、代码路径和运行时数据的隔离规则 |
| [分支与协作方式](BRANCHING.md) | 主干、短期任务分支、发布分支和多人协作规则 |

## 模块说明

| 主题 | 文档 |
| --- | --- |
| 主 IM 登录 | [企业主 IM 登录](WORKBENCH-IM-LOGIN.md) |
| IM 与项目映射 | [项目与 IM 会话](WORKBENCH-IM-PROJECTS.md) |
| 主题协作 | [主题内协作](WORKBENCH-TOPIC-COLLABORATION.md) |
| 多轮交付与交接 | [原工单的交接、恢复与多轮交付](WORKBENCH-ITERATIONS.md) |
| 交付与验收 | [交付模板与验收证据](WORKBENCH-DELIVERY-TEMPLATE.md) |
| 知识与记忆 | [资料、知识与记忆](KNOWLEDGE-VERSIONS.md) |
| 协作记忆与设备 | [执行端、记忆和额度](WORKBENCH-MEMORY-AND-DEVICES.md) |
| Octop 能力 | [Octop 后端接入](WORKBENCH-OCTOP.md) |
| 跨主机执行 | [远程执行端](WORKBENCH-REMOTE-RUNNER.md) |
| 工作台总览 | [独立 Contractor 工作台](WORKBENCH.md) |

## 运维与分发

| 文档 | 用途 |
| --- | --- |
| [调度器迁移与回滚](RUNTIME-MIGRATION.md) | Contractor 调度器、AutoLoop 兼容状态和离线迁移 |
| [实现来源与第三方许可](SOURCES.md) | 上游代码、适配组件、npm 依赖和制品边界 |
| [第三方声明](../THIRD_PARTY_NOTICES.md) | 随源码和构建产物保留的许可证 |
| [产品背景](../PRODUCT.md) | 产品目标、约束和设计原则 |
| [界面设计规范](../DESIGN.md) | 视觉、组件、响应式和无障碍基线 |

## 参与开发

贡献入口、测试、提交和第三方源码引入规则见 [CONTRIBUTING](../CONTRIBUTING.md)。社区贡献如何评审和合入见 [治理与决策](../GOVERNANCE.md)，代码、名称、Logo 与官方发布的边界见 [商标与官方发行](../TRADEMARKS.md)。安全漏洞按 [Security policy](../SECURITY.md) 私密报告。当前回归命令包括：

```sh
npm run check:docs
npm run audit:upstream -- --browser
npm test
npm run typecheck
npm run build:ui
```
