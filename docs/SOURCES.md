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
| [Casbin](https://github.com/casbin/node-casbin) | 为工作台提供登录角色的策略判定。 |
| [Paperclip 前端](https://github.com/paperclipai/paperclip/tree/8cd2d6a73d2097253dd329f55b637e12b20361c6/ui/src) | React 工作台复用可伸缩侧栏、面包屑、按钮、状态徽标、输入框和标签页。文件位于 `workbench/src/paperclip/`，通过同源 SuitMe API 接入协作流程。 |

[第三方声明](../THIRD_PARTY_NOTICES.md)保留各组件的版本、许可和原文位置。三个源码子模块的提交记录在 [sources.lock.json](../sources.lock.json)。

LobeHub 的前端参考包括项目话题列表与搜索、Agent 分页档案、交付详情旁的协作记录。SuitMe 实现对应交互，并使用自己的项目权限、工单版本和知识投影。[LobeHub 会话导航](https://github.com/lobehub/lobehub/tree/a8424d204a7ed1eb36985ebdfa6eac8041615392/src/features/AgentSidebar/Topic) · [Agent 档案](https://github.com/lobehub/lobehub/tree/a8424d204a7ed1eb36985ebdfa6eac8041615392/src/features/AgentProfileTabs) · [交付协作记录](https://github.com/lobehub/lobehub/tree/a8424d204a7ed1eb36985ebdfa6eac8041615392/src/features/Acceptance/Viewer/Conversation)

批量整理、唤醒及上下文装配参考 LobeHub。逐项验收和版本证据参考 [Acceptance](https://github.com/lobehub/acceptance/tree/f720feb862bdbe3acc653bdedc297e20e08be1ae)。

协作记忆采用 Anthropic 对过程记录、可复用笔记和少量预载规则的组织方式。界面参考 LobeHub 的记忆详情和返回来源，也借鉴 Dify 的检索测试和 Letta 的按需挂载记忆。记忆版本、审核与权限继续调用 SuitMe 的既有实现。 [Anthropic](https://www.anthropic.com/research/components-of-agent-memory) · [LobeHub 记忆界面](https://github.com/lobehub/lobehub/tree/a8424d204a7ed1eb36985ebdfa6eac8041615392/src/routes/%28main%29/memory) · [Dify 检索与引用](https://www.dify.ai/rag) · [Letta 记忆模块](https://docs.letta.com/v1-sdk/memory/memory-blocks)

设备登记和按任务选择参考 LobeHub 的设备与执行配置，接单客户端直接复用本仓固定的 AutoLoop WorkerHub 接口和 worker 源码。 [LobeHub 执行目标选择](https://github.com/lobehub/lobehub/blob/a8424d204a7ed1eb36985ebdfa6eac8041615392/apps/server/src/services/taskRunner/resolveRunExecution.ts) · [原版 AutoLoop 协议](https://github.com/KKKKhazix/agent-autoloop/blob/ba8cf6d8cf24f9ce005958c15d88f2d9cff7f05d/docs/protocol.md) · [SuitMe 使用说明](WORKBENCH-MEMORY-AND-DEVICES.md)

跨主机模式沿用同一个 AutoLoop 账本、worker、CLI 回执协议和 Claude Code 适配。SuitMe 增加了配对入口、授权资料装配和按远端停止回执交接。 [原版 Claude 插件](https://github.com/KKKKhazix/agent-autoloop/blob/ba8cf6d8cf24f9ce005958c15d88f2d9cff7f05d/plugins/claude/agent.ts) · [远程执行端说明](WORKBENCH-REMOTE-RUNNER.md)

2026-11-16 后端补齐继续直接调用上述固定版本，不修改上游子模块。代码包传输及差异导入为 SuitMe 适配层，进程和网络隔离仍由原版 Sandbox Runtime 执行。Linux 的挂载装配修正在 `isolation.ts`，未旁路原版沙箱。

受控父子任务使用 AutoLoop 原版 `parseResult` 和原生事件协议，子单通过 Super-agent 原版 Engine 创建。`delegations.ts` 仅增加授权提案与父子关系投影，不形成新 scheduler。父子结果回流借鉴 LobeHub 的协作机制；没有复制其 supervisor 或声称已经整合其全部能力。

`knowledge-graph.ts` 实际复用 `@backstage/catalog-model@1.10.2` 的 `stringifyEntityRef`、`RELATION_OWNED_BY`、`RELATION_PART_OF`、`RELATION_DEPENDS_ON`，输入来自 SuitMe 现有授权知识与执行证据。它是来源及使用关系的后端投影，不是 Backstage 完整目录服务或自动语义图谱。

`figma-source.ts` 使用 Figma 官方生成的 `@figma/rest-api-spec@0.47.0` 响应类型和官方节点、版本及 PNG 渲染接口，接入现有知识候选与版本账本。飞书恢复补读继续调用官方 CLI，复用 Super-agent 原消息标识与既有整理游标。 [Figma OpenAPI 源码](https://github.com/figma/rest-api-spec) · [Figma 文件接口](https://developers.figma.com/docs/rest-api/file-endpoints/) · [飞书历史消息接口](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/list)
