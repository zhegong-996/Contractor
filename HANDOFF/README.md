# SuitMe 协作台 · 项目交接包（HANDOFF）

> 生成时间：2026-11-07（北京时间，第十八轮 C-3 同步）｜仓库：`/Users/gong.zhe/Developer/ai-native-collab`
> 远端：`github.com/zhegong-996/suitme-collab`（main）｜代码基线随 `main` 前进，**以 `git rev-parse HEAD` 为准**，不要相信写死的 hash
> 当前阶段：**A 完成 → B1 完成 → B2 完成并验证 → C 进行中（② 独立应用已拍板，C-0 / C-0b / C-1 / C-2 / C-3 完成 / C-4 为下一步）**（严格不并行，按 C-0 → C-6 + 收尾分步）

## 这个包是干什么的

给**下一位接手的 Agent**用的。目标：不依赖本对话历史，读完就能安全继续，不重复踩坑、不擅自越过红线、不把已验证的链路改坏。

- **唯一位置**：仓库内 `HANDOFF/`（随 git 提交推送，clone 即得）。所有相关说明都在这里，**不依赖任何外部副本**；来源、commit 与接手校验见 `SYNC-STATUS.md`。
- 项目原有文档（`docs/`、`README.md`）仍然有效；本包是**导航与现状归纳**，不是替代。冲突时以 `docs/ADAPTATION-v0.6.md` 最新边界声明（`0.000000000000000000` 节）、`docs/VALIDATION.md` 最新验证记录为准。

## 5 分钟接手路径

1. 读 `00-START-HERE.md`：环境、服务状态、必须记住的环境变量与常见坑。
2. 读 `06-CURRENT-STATE-AND-NEXT.md`：**现在做到哪、下一步具体做什么、什么不能动**。
3. 跑一遍 `05-VALIDATION-AND-COMMANDS.md` 的全套回归，确认基线全绿（含 `npm run host:pg` 与 `npm run console:smoke`）。
4. 需要动某块代码时查 `04-CODE-MAP.md` / `FILE-INVENTORY.md`；需要背景时查 `01` / `02` / `03`。
5. 动手前读 `07-RULES-AND-BOUNDARIES.md`，与用户拍板事项见 `08-OPEN-DECISIONS.md`。

## 本包每个文件的说明

| 文件 | 说明 |
|---|---|
| `README.md` | 本文件。交接包总索引、5 分钟接手路径、包内每个文件的用途。 |
| `00-START-HERE.md` | 新 Agent 第一份必读：运行环境、仓库/远端同步状态、服务端口、干净环境命令、首次验证步骤、7 个已知坑。 |
| `01-PROJECT-OVERVIEW.md` | 产品与业务架构：定位、渠道分工、三级 owner 与角色、8 步端到端闭环与 4 个人工决策点、5 个主 tab 功能地图、功能成熟度三档。 |
| `02-ARCHITECTURE.md` | 技术架构：四层分层与数据流、7 个上游的真实引用强度、前端分层、平台端口（含 `local-pg`）、共享记忆主干（B1 + B2）与路由契约。 |
| `03-WORK-LOG.md` | 全部 18 轮工作记录（含第十五轮补遗、第十六轮 C-1、第十八轮 C-3）：每轮提交号、用户要求、改动、真跑验证、当轮边界与遗留。 |
| `04-CODE-MAP.md` | 按功能域讲「哪些文件一起完成什么」，重点模块逐个说明职责、关键导出与依赖关系。 |
| `DIRECTORY-GUIDE.md` | **目录完全指南**：完整目录树、每个目录作用与是否入库、7 个 submodule、`.runtime/` 详解、构建产物位置、新文件该放哪。 |
| `FILE-INVENTORY.md` | **逐文件一行说明**，覆盖全部入库文件（含交接包自身），含行数与用途。 |
| `05-VALIDATION-AND-COMMANDS.md` | 全套回归命令清单、每项预期输出、真实链路冒烟脚本（含 `memory:journey` / `memory:checkpoint` / `host:pg` / `console:smoke` / `router:smoke`）、排障手册、服务端口表。 |
| `06-CURRENT-STATE-AND-NEXT.md` | 当前状态快照：A/B1/B2 已完成证据、**C-1 的 PG 真跑交付与 C-0~C-6 + 收尾清单**、三条新增产品约束、三层判断结论、去 Paperclip 化路线。 |
| `07-RULES-AND-BOUNDARIES.md` | 不可越过的红线：业务验收身份、隐私与 `.runtime`、许可证边界、已取消服务不得重启、上游源码不改、测试隔离。 |
| `08-OPEN-DECISIONS.md` | 需要用户拍板才能动的事项（**6 项待拍板** + 产品形态 ②、B2 范围、组织形态可配置与自演进、PG 与长程执行四条已解决历史记录），含冲突说明与可选方案。 |
| `SYNC-STATUS.md` | ★ 唯一位置声明、代码基线/提交关系、接手校验命令、本目录内阅读顺序。 |
| `handoff-manifest.json` | 机器可读元数据：commit、远端、测试结果、C 产品约束、服务状态、包内文件清单、下一步与开放决策。 |

## 一句话现状

系统能跑、全套回归全绿（**362/362** 单测、11/11 真实浏览器走查、上游 clean、`host:pg` 21/21）。**方案 B 整体已完成并验证**：B1 的共享记忆事件主干与四类投影，B2 的投影召回接入读取链、按主体精确撤权、真实一单端到端撤权、checkpoint 增量应用。注意原 Cognee / SQLite / Paperclip 存储仍是**主读取源**，投影是权限重评之后的**第三路叠加信号**，不是替换底座。第十五轮用户拍板 **② 独立前端应用**并把「组织形态可配置」「沉淀自演进」写进 `PRD §10C`（C-P1~C-P5）；**第十六轮用户改口允许本机引入 PostgreSQL**，C-1 在本机 PG 17 专属库 `suitme_collab_c1` 真跑事务 / 并发领取 / 步进队列与崩溃恢复 21/21，并新增 **C-P6（循环 / 会话状态 / 执行环境三者分离）**；最新边界见 `docs/ADAPTATION-v0.6.md` `0.0000000000000000000` 节。**第十八轮 C-3** 把五个派活点共 9 处调用收敛到 `src/router.ts::Router`，由 `config.router` 决定扁平 1 跳 / 按业务域分层最多 2 跳 / legacy 回退；`router:smoke` 隔离真跑 31/31，控制台「协作」视图可见当前组织形态。三层判断仍 `recommended=false`（8 项前置条件，p8 在 C-4 / C-5 前恒 false），C-5 起评估口径改为按当前配置判定，**不为凑绿逼小团队硬造管理层**。默认底座仍是 `paperclip`，`local-pg` 是显式配置，`runner.ts` 常驻循环尚未切成单步。真人在真实业务单「确认验收」从未发生；4190/4192/4194/9418 是用户主动取消的服务，**不要重启**。

## 交接检查清单

- [ ] `git status --short --branch` 干净且 `HEAD = origin/main`
- [ ] `npm test` 362/362、`npm run test:walkthrough` 11/11、`npm run host:pg` 21/21、`npm run console:smoke` ok:true、`npm run router:smoke` 31/31
- [ ] 已读 `06`、`07` 与 `PRD §10C`（C-P1~C-P8）
- [ ] 已确认 `08` 中哪些事项需要问用户
