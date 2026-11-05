# 实现来源与取舍

上游版本由 Git submodule 提交固定；精确版本见根目录 sources.lock.json 和 gitlink。

| 来源 | 实际复用 | 保留边界 |
|---|---|---|
| Paperclip | 原 server、ui、db、进程适配器、任务文档、签出、运行和恢复 API | 唯一业务任务与调度核心；不修改上游源码 |
| Super-agent | src/sources/feishu-trigger.ts、feishu-channel.ts 及其纯函数依赖 | 不启动 DSH 主会话、第二个任务库或调度器 |
| Agent Autoloop | plugins/{codex,claude,command,acp}、worker/agents.ts、worker/contract.ts、protocol/validate.ts | 不启动 Autoloop hub；不照搬其自动合并策略 |
| OpenHands SDK | 参考执行服务与协作控制平面的边界 | 第一版不引入另一套执行服务 |
| Paperclip LLM Wiki | packages/plugins/plugin-llm-wiki 原版 UI、worker、迁移、来源与页面工具 | 与 Paperclip 同一固定提交；共享资料入口，自动摄取关闭，未把 Alpha 空间字段当作 ACL |
| Paperclip Plugin SDK | 原版构建预设、宿主身份、导航、Markdown 组件，以及私有项目、审批、任务授权和修订 API | 第二阶段扩展位于 plugins/knowledge-workspaces，未修改上游；详见 WORKSPACES.md |

src/upstream.ts 声明本项目用到的接口并加载固定源码；出站包装只把过长通知标识映射为飞书允许的稳定幂等键。动态包边界避免把未使用的 DeepSeek Harness 宿主及其 peer dependencies 拉进本项目的类型检查；实际执行的是上游实现。测试覆盖这些真实导出，而非本地仿制实现。

中文宿主通过 `scripts/build-chinese-shell.ts` 在构建阶段应用 `locales/shell.zh-CN.json`。只替换展示文案，不修改上游工作树、许可证、路由、API 枚举或用户内容。复用原生 Vite / React 构建；不在浏览器中注入 DOM 翻译脚本。`npm run build:chinese-shell` 可复现中文资源；重新执行上游原版 UI 构建可恢复原界面。插件自己的文案仍由各插件维护，覆盖范围见 SYSTEM-ARCHITECTURE.md。

三个复用仓库的主许可证均标为 MIT；许可证文件保留在各自子模块。第三方 CLI、账号、服务和依赖仍按各自规则使用。个人登录文件不复制进项目或 GitHub。

产品讨论依据：

- [玉伯播客](https://www.xiaoyuzhoufm.com/episode/6ac8b67ce742e36efcc05e77)：已核读节目页面，相关章节为上下文与人机交互；页面不是完整逐字稿。
- [卡兹克文章](https://mp.weixin.qq.com/s/T9_acg247gxzUNL4j5zrCw)：用户指定参考；本次网页抓取失败，未把文章正文当作已核读事实。
- [Agent Autoloop](https://github.com/KKKKhazix/agent-autoloop)：已核读源码、协议与实现约束。

落实为任务和证据共同维护、按需打扰、原处交付、等待时释放执行、按版本采用结论。以上是本项目的工程取舍，不是对原作者的逐字引述。

补充核读了 Paperclip 的 ISSUE-PRIVACY.md、LLM Wiki 源码，以及 Outline、Onyx、OpenFGA 官方资料。比较与具体复用边界见 [知识与授权](KNOWLEDGE-AND-ACCESS.md)。未引入后三个项目的代码或运行服务。


## 2026-11-05 上下文与 Agent 整理

- Prime Agent 74591cddef28d11249c3171112114fc4755375d7 (MIT)：移植 harness.py 的 query runs/terms 和 harness_digest.rs 的目标/近期上下文权重，见 src/vendor/prime-query.ts。测试基准来自原版 Python 函数的实际输出。未启动其 daemon 或全局 refinement。
- DeepSeek Harness fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159 (MIT)：直接使用 packages/util/output-retention/src/index.ts 和 packages/context/session-reference/src/serialization.ts；未修改上游。system-prompt、session-reference、compaction-basic 的来源、覆盖和稳定性合同作为设计参考，没有宣称整套宿主服务已接入。
- 用户自有本体论产品原型 ai_bridge.py 与 knowledge.py：引用核验、快照与撤回投影逻辑迁移为 src/evidence.ts 并重新测试。未迁移原型数据库、模型环境或业务数据；未复制 Alice 原包恢复代码。

接线、边界和验证见 docs/ASSISTANT-CONTEXT.md。
