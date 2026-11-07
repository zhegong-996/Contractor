# 实现来源与取舍

上游版本由 Git submodule 提交固定；精确版本见根目录 sources.lock.json 和 gitlink。

| 来源 | 实际复用 | 保留边界 |
|---|---|---|
| Paperclip | 原 server、ui、db、进程适配器、任务文档、签出、运行和恢复 API | 唯一业务任务与调度核心；不修改上游源码 |
| Super-agent | src/sources/feishu-trigger.ts、feishu-channel.ts、policy.ts 的 settingsPolicy / assessmentOutcome 及纯函数依赖 | 不启动 DSH 主会话、第二个任务库或调度器 |
| Agent Autoloop | worker/worker.ts 原版 createWorker；plugins/{codex,claude,command,acp}、worker/agents.ts、worker/contract.ts、protocol/validate.ts | 不启动 Autoloop hub；不照搬其自动合并策略 |
| OpenHands SDK | 参考执行服务与协作控制平面的边界 | 第一版不引入另一套执行服务 |
| Paperclip LLM Wiki | packages/plugins/plugin-llm-wiki 原版 UI、worker、迁移、来源与页面工具 | 与 Paperclip 同一固定提交；共享资料入口，自动摄取关闭，未把 Alpha 空间字段当作 ACL |
| Cognee 1.6.6 / Apache-2.0 | 原版 LadybugAdapter、DataPoint、provenance；GraphVisualization、GraphSchema reducer 与 JSON Schema serializer | 固定子模块不改源码；不启动 LLM/embedding/记忆管线；按来源修订接入现有权限；新增 `src/org-extraction.ts` 只读 L1 投影生成 L2 草稿边（零模型调用）。详见 KNOWLEDGE-ENGINE.md |
| Paperclip Plugin SDK | 原版构建预设、宿主身份、导航、Markdown 组件，以及私有项目、审批、任务授权和修订 API | 第二阶段扩展位于 plugins/knowledge-workspaces，未修改上游；详见 WORKSPACES.md |
| Acceptance `f720feb` / Apache-2.0 | 固定 submodule `upstream/acceptance`；只复用其开工前锁定计划、证据来源分类、逐项判定与报告/产物的**契约和文件布局**，由独立适配层 `src/acceptance-interop.ts` 与 `scripts/export-acceptance.ts` 映射为 `result.json` / `report.md` / assets | **不启动其 CLI 或云端报告服务**；`/accept` 发起人身份校验与「Agent 完成 ≠ 验收」红线不改动。LICENSE 原文保留在 `licenses/acceptance-APACHE-2.0.txt`，固定提交见 `sources.lock.json`，声明见 `THIRD_PARTY_NOTICES.md` |
| node-postgres `pg@8.23.1` / MIT | 仅作为 PostgreSQL 客户端驱动：`src/pg-host.ts` 的事务、并发领取、步进队列与状态外置，真跑于本机专属库 `suitme_collab_c1` | 精确版本与 integrity 见 `package-lock.json`，LICENSE 原文 `licenses/pg-MIT.txt`；**不引 Redis、不部署远端工具沙箱、不切换默认底座**；`assertLocalPgDsn()` 只允许回环地址，DSN 只从环境变量读取 |

src/upstream.ts 声明本项目用到的接口并加载固定源码；出站包装只把过长通知标识映射为飞书允许的稳定幂等键。动态包边界避免把未使用的 DeepSeek Harness 宿主及其 peer dependencies 拉进本项目的类型检查；实际执行的是上游实现。测试覆盖这些真实导出，而非本地仿制实现。

中文宿主通过 `scripts/build-chinese-shell.ts` 在构建阶段应用 `locales/shell.zh-CN.json`：只替换展示文案，不修改上游工作树、许可证、路由、API 枚举或用户内容；复用原生 Vite / React 构建。国内环境适配层 `src/shell-domestic.ts` 在此基础上做两件事：构建期收敛侧栏的技能库 / 连接服务入口，以及通过**同源静态资源** `suitme-domestic.js` 在运行时隐藏数据驱动、且**未连接**的海外集成卡片；脚本不注入 DOM 翻译、不改写业务内容、不发出任何网络请求，也不碰本项目插件页面。`npm run build:chinese-shell` 可复现中文资源，`npm run install:upstream` 末尾与 `npm run up` 启动前都会保证它生效；重新执行上游原版 UI 构建可恢复原界面。插件自己的文案仍由各插件维护，覆盖范围见 SYSTEM-ARCHITECTURE.md。

Paperclip、Super-agent、Autoloop 的主许可证为 MIT，Cognee 为 Apache-2.0；许可证文件保留在各自子模块。第三方 CLI、账号、服务和依赖仍按各自规则使用。个人登录文件不复制进项目或 GitHub。

产品讨论依据：

- [玉伯播客](https://www.xiaoyuzhoufm.com/episode/6ac8b67ce742e36efcc05e77)：已核读节目页面，相关章节为上下文与人机交互；页面不是完整逐字稿。
- [卡兹克文章](https://mp.weixin.qq.com/s/T9_acg247gxzUNL4j5zrCw)：用户指定参考；本次网页抓取失败，未把文章正文当作已核读事实。
- [Agent Autoloop](https://github.com/KKKKhazix/agent-autoloop)：已核读源码、协议与实现约束。

落实为任务和证据共同维护、按需打扰、原处交付、等待时释放执行、按版本采用结论。以上是本项目的工程取舍，不是对原作者的逐字引述。

补充核读了 Paperclip 的 ISSUE-PRIVACY.md、LLM Wiki 源码，以及 Outline、Onyx、OpenFGA 官方资料。比较与具体复用边界见 [知识与授权](KNOWLEDGE-AND-ACCESS.md)。未引入后三个项目的代码或运行服务。


## 2026-11-05 上下文与 Agent 整理

- Prime Agent 74591cddef28d11249c3171112114fc4755375d7 (MIT)：移植 harness.py 的 query runs/terms 和 harness_digest.rs 的目标/近期上下文权重，见 src/vendor/prime-query.ts。测试基准来自原版 Python 函数的实际输出。未启动其 daemon 或全局 refinement。
- DeepSeek Harness fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159 (MIT)：直接使用 packages/util/output-retention/src/index.ts 和 packages/context/session-reference/src/serialization.ts；未修改上游。新增直接装配原版 Cordis Context、scope、system-prompt、ToolsService、tool-executor-native、persona，以及 preset definition 的 entryListProblem。工作方法、工具选择与参数校验由 SuitMe 适配；原版作用域、提示词装配、工具限制与调用管线实际执行。集成入口为 integrations/deepseek/runtime.ts 和 src/harness-composition.ts，esbuild 只打包固定源码。没有启用完整 AgentLoop、动态模块装载器、第二套调度器或新的模型服务；compaction-basic 仍仅作设计参考。
- 用户自有本体论产品原型 ai_bridge.py 与 knowledge.py：引用核验、快照与撤回投影逻辑迁移为 src/evidence.ts 并重新测试。未迁移原型数据库、模型环境或业务数据；未复制 Alice 原包恢复代码。

接线、边界和验证见 docs/ASSISTANT-CONTEXT.md。

## 多人服务与持久记忆补充

- `@a2a-js/sdk` 固定 1.3.0 / gitHead `29417a5bb4038f804f310ce4fffd267a9375aa90`：实际 DefaultRequestHandler、JsonRpcTransportHandler、ServerCallContext 和原生 TaskStore 端口。Apache-2.0 原文保留。
- Cognee 同一固定提交新增直接调用 BM25ChunksRetriever 原版统计、评分及 chunk identity；原版 Ladybug 存放来源修订、人审概念与关系。适配不启用新的 LLM/embedding。
- 2026-11-06：七个已引入上游（含本轮新增的 `lobehub/acceptance` submodule `f720feb`）的适配层分组、固定提交核对与升级自检顺序整理为 [上游适配清单](UPSTREAM-ADAPTERS.md)；`npm run audit:upstream` 机器化校验 gitlink、锁文件、许可证、声明与 L2 只读边界。未改动任何上游源码或 submodule 提交。
- Paperclip 同一固定提交的成员目录、membership、邀请、公司角色和人工审阅负责人的 API；没有自己编写认证系统。
