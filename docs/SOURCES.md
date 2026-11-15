# 实现来源

| 项目 | 工作台中的实际调用 |
| --- | --- |
| [Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4) | 原版 Engine、SQLite Store、Effects、来源消息解析与飞书回复。SuitMe 写在 `src/superagent-ports.ts`、`src/upstream.ts` 和 `src/workbench/collaboration.ts` 中的适配层负责业务配置、工单关联及授权。 |
| [Agent AutoLoop](https://github.com/KKKKhazix/agent-autoloop/tree/ba8cf6d8cf24f9ce005958c15d88f2d9cff7f05d) | `src/workbench/autoloop.ts` 调用原版 Runtime、kernel 和 worker。在工单委托后开始执行，由原版存储调度、卡片、会话、重试、租约和停止记录。 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159) | `src/superagent-ports.ts` 将 Super-agent Store 的 `@deepseek-ai/schemastery` 和 `@deepseek-ai/cosmokit` 解析到该版本的原版 vendor 源码。 |
| [Backstage catalog model](https://github.com/backstage/backstage/tree/master/packages/catalog-model) | `src/workbench/project-resources.ts` 调用 `parseEntityRef`、`stringifyEntityRef` 规范化来源引用。npm 固定为 `1.10.2`。 |
| [飞书官方 CLI](https://github.com/larksuite/cli) 和 [GitHub Git Trees API](https://docs.github.com/en/rest/git/trees#get-a-tree) | `src/workbench/knowledge-sources.ts` 使用既有飞书授权读取 Markdown 与文档修订，使用既有 GitHub CLI 读取配置分支的提交、Git tree 和 blob。知识检索继续调用工作台原有 BM25 投影。 |
| [Entire CLI](https://github.com/entireio/cli/releases/tag/v0.13.4) | `src/workbench/entire.ts` 调用本机配置的 CLI 检查与提交关联的会话元数据。 |
| [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime) | `src/workbench/isolation.ts` 直接调用固定 npm 版本 `0.0.83` 的原版 CLI，在 AutoLoop 适配器外约束文件和网络。复用 OS 沙箱及代理，不另造执行调度。具体边界见 [成员执行隔离](MEMBER-EXECUTION-ISOLATION.md)。 |
| [Casbin](https://github.com/casbin/node-casbin) 和 [Vue](https://github.com/vuejs/core/tree/v3.5.45) | Casbin 提供登录角色的策略判定。工作台使用本地 Vue 3.5.45 运行时。 |

[第三方声明](../THIRD_PARTY_NOTICES.md)保留各组件的版本、许可和原文位置。三个源码子模块的提交记录在 [sources.lock.json](../sources.lock.json)。

[LobeHub](https://github.com/lobehub/lobehub) 的批量整理、唤醒及上下文装配，以及 [Acceptance](https://github.com/lobehub/acceptance/tree/f720feb862bdbe3acc653bdedc297e20e08be1ae) 的逐项验收和版本证据是设计参考。SuitMe 的项目权限、验收和知识投影在本地实现。
