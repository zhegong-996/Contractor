# 实现来源与取舍

上游版本由 Git submodule 提交固定；精确版本见根目录 sources.lock.json 和 gitlink。

| 来源 | 实际复用 | 保留边界 |
|---|---|---|
| Paperclip | 原 server、ui、db、进程适配器、任务文档、签出、运行和恢复 API | 唯一业务任务与调度核心；不修改上游源码 |
| Super-agent | src/sources/feishu-trigger.ts、feishu-channel.ts 及其纯函数依赖 | 不启动 DSH 主会话、第二个任务库或调度器 |
| Agent Autoloop | plugins/{codex,claude,command,acp}、worker/agents.ts、worker/contract.ts、protocol/validate.ts | 不启动 Autoloop hub；不照搬其自动合并策略 |
| OpenHands SDK | 参考执行服务与协作控制平面的边界 | 第一版不引入另一套执行服务 |
| Paperclip LLM Wiki | packages/plugins/plugin-llm-wiki 原版 UI、worker、迁移、来源与页面工具 | 与 Paperclip 同一固定提交；共享资料入口，自动摄取关闭，未把 Alpha 空间字段当作 ACL |

src/upstream.ts 只声明本项目用到的接口并加载固定源码。动态包边界避免把未使用的 DeepSeek Harness 宿主及其 peer dependencies 拉进本项目的类型检查；实际执行的是上游实现。测试覆盖这些真实导出，而非本地仿制实现。

三个复用仓库的主许可证均标为 MIT；许可证文件保留在各自子模块。第三方 CLI、账号、服务和依赖仍按各自规则使用。个人登录文件不复制进项目或 GitHub。

产品讨论依据：

- [玉伯播客](https://www.xiaoyuzhoufm.com/episode/6ac8b67ce742e36efcc05e77)：已核读节目页面，相关章节为上下文与人机交互；页面不是完整逐字稿。
- [卡兹克文章](https://mp.weixin.qq.com/s/T9_acg247gxzUNL4j5zrCw)：用户指定参考；本次网页抓取失败，未把文章正文当作已核读事实。
- [Agent Autoloop](https://github.com/KKKKhazix/agent-autoloop)：已核读源码、协议与实现约束。

落实为任务和证据共同维护、按需打扰、原处交付、等待时释放执行、按版本采用结论。以上是本项目的工程取舍，不是对原作者的逐字引述。

补充核读了 Paperclip 的 ISSUE-PRIVACY.md、LLM Wiki 源码，以及 Outline、Onyx、OpenFGA 官方资料。比较与具体复用边界见 [知识与授权](KNOWLEDGE-AND-ACCESS.md)。未引入后三个项目的代码或运行服务。
