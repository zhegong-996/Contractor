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
| LobeHub（**只借设计语言，不引代码**） | `console/` 独立控制台的布局、卡片、明暗主题、会话列表与气泡时间线参考其观感与交互范式；自研原生 HTML/CSS/JS 实现 | 主仓库 Community License（Apache-2.0 + 商用附加条件）**禁止复制 / fork / 分发衍生作品**；组件库 `@lobehub/ui` 虽为 MIT，但 v6 强绑 React 19 + ESM + 多个 peer，**本轮未引入依赖、未复制组件源码、未打包资源**；详见 OPEN-SOURCE-COMPLIANCE.md 第 3 节 |
| node-postgres `pg@8.23.1` / MIT | 仅作为 PostgreSQL 客户端驱动：`src/pg-host.ts` 的事务、并发领取、步进队列与状态外置，真跑于本机专属库 `suitme_collab_c1` | 精确版本与 integrity 见 `package-lock.json`，LICENSE 原文 `licenses/pg-MIT.txt`；**不引 Redis、不部署远端工具沙箱、不切换默认底座**；`assertLocalPgDsn()` 只允许回环地址，DSN 只从环境变量读取 |

src/upstream.ts 声明本项目用到的接口并加载固定源码；出站包装只把过长通知标识映射为飞书允许的稳定幂等键。动态包边界避免把未使用的 DeepSeek Harness 宿主及其 peer dependencies 拉进本项目的类型检查；实际执行的是上游实现。测试覆盖这些真实导出，而非本地仿制实现。

中文宿主通过 `scripts/build-chinese-shell.ts` 在构建阶段应用 `locales/shell.zh-CN.json`：只替换展示文案，不修改上游工作树、许可证、路由、API 枚举或用户内容；复用原生 Vite / React 构建。国内环境适配层 `src/shell-domestic.ts` 在此基础上做两件事：构建期收敛侧栏的技能库 / 连接服务入口，以及通过**同源静态资源** `suitme-domestic.js` 在运行时隐藏数据驱动、且**未连接**的海外集成卡片；脚本不注入 DOM 翻译、不改写业务内容、不发出任何网络请求，也不碰本项目插件页面。`npm run build:chinese-shell` 可复现中文资源，`npm run install:upstream` 末尾与 `npm run up` 启动前都会保证它生效；重新执行上游原版 UI 构建可恢复原界面。插件自己的文案仍由各插件维护，覆盖范围见 SYSTEM-ARCHITECTURE.md。

第十七轮 C-2 起，另有一层**自研独立控制台** `console/`：不依赖 Plugin SDK、不依赖宿主的 3100 页面，由 `scripts/console-server.ts` 只在回环地址按需提供，通过 `config.bridgePort` 只读访问本机动作分发口；浏览器只拿到 13 个只读 action 的结果，密钥不出服务端。中文展示语言由 `console/app.js` 的 `DOMESTIC_TERMS` 统一收敛。`npm run console` 按需启动、`npm run console:smoke` 真跑验证，均**不新增常驻服务**；旧插件工作台仍保留作为可回退实现。

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

- 2026-11-07（第十八轮 C-3）：单一 Router 与可配置组织形态为**完全自研**，五个派活点共 9 处收敛到 `src/router.ts`；只复用既有 `RoutingDecision` / `RoutingTrace` 契约，未引入新上游、未改上游提交、未复制 LobeHub 代码。`npm run router:smoke` 在隔离内存 Trace 真跑三种形态 31/31。

- 2026-11-08（第二十轮 C-5）：按配置重跑三层评估、两种形态真实一单与每步可回放均为**完全自研**（`src/three-tier-assessment.ts` / `scripts/shapes-smoke.ts` / `tests/shape-assessment.test.ts`）；只复用既有 `RoutingDecision` / `Router` / `AgentRegistry` 字段语义与 LobeHub 三层汇报的产品思想，**未引入第 8 个上游、未改上游提交、未复制任何上游代码**；`npm run shapes:smoke` 隔离真跑 36/36。

- 2026-11-07（第十九轮 C-4）：组织级 Agent 注册表、职责解析、A2A 交接校验与验收协作编组均为**完全自研**（`src/agent-registry.ts`）；只复用既有 `RoutingDecision` / `RoutingTrace` / A2A `Link` 字段语义，未引入新上游、未改上游提交、未复制 LobeHub 代码。`npm run agents:smoke` 在隔离内存 Trace 真跑 43/43。

- 2026-11-08（第二十一轮 C-6）：沉淀回流、交付前自查闸门、治理台账与状态机、工程回放闸门、四项效果指标均为**完全自研**（`src/evolution-ledger.ts` / `src/evolution.ts` / `scripts/evolution-smoke.ts` / `tests/evolution.test.ts`）；只复用既有 `readSelfCheck()` 沉淀标准、`memoryReplayReport()` 确定性重放与 LobeHub Acceptance「打回沉淀成标准」的产品思想，**未引入第 8 个上游、未改上游提交、未复制任何上游代码**；`npm run evolution:smoke` 隔离真跑 45/45。

- 2026-11-08（第二十二轮 P-1）：单步执行契约 / 队列适配器 / 单步泵 / 一次进程一步入口 / 真跑脚本与契约测试均为**完全自研**（`src/step-execution.ts` / `src/loop-pump.ts` / `src/step-runner.ts` / `scripts/steps-smoke.ts` / `tests/step-execution.test.ts`）；只复用 C-1 已入库的 `PgHostPlatform` 步进方法语义与 LobeHub / DeepSeek「循环、状态、执行环境三者分离」的产品思想，**未引入第 8 个上游、未新增 npm 依赖、未改上游提交、未复制任何上游代码**；`npm run steps:smoke` 在本机 PG 专属库与真实子进程上真跑 40/40。

- 2026-11-08（第二十三轮 P-5）：控制台只读快照的服务端分页 / 字段裁剪为**完全自研**（`src/workspace-summary.ts` / `tests/workspace-summary.test.ts`），原 `view` 逐字保留；未引入新上游、未改上游提交、未复制任何上游代码。

- 2026-11-08（第二十四轮 P-6）：Runner `yicheng47/runner` 固定 MIT 提交 `a42d133139bbe630e4ca3475426c7653fddd86db`（Copyright (c) 2026 Yicheng Wang）：**只移植两块协议语义，TypeScript 重写，未复制任何 Rust 源码、未引入 submodule / gitlink**。① `ask_human` → `human_question` → `human_response` 成对留痕（问题编号即提问事件自身 id、因果放载荷）落地为 `src/step-hitl.ts` / `src/step-runner.ts` / `scripts/step-answer.ts`；② 持久化队列的累计确认、至少一次通知与投递就绪落地为 `src/step-delivery.ts`。另有四项只借思想：`src/mission-state.ts` 的六态派生、运行时能力声明、配置库与追加写日志分层、编制快照不回溯。MIT 原文在 `licenses/runner-MIT.txt`，声明在 `THIRD_PARTY_NOTICES.md`，固定提交在 `sources.lock.json` 的 `protocolReferences`，`npm run audit:upstream` 机器化校验。注意 2026-08-22 ~ 09-22 发布版本为 GPL-3.0-only 且仍按该许可提供，已避开该窗口。`npm run steps:smoke` 真实 PG + 子进程真跑 **54/54**；`npm test` **445/445**。未新增第 8 个上游、未改上游提交、未放宽人签红线：人工回答只是把答案送回提问者，绝不替代原发起人在原会话确认验收。
