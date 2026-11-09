# 06 · 当前状态与下一步（接手者最该看的一份）

## 1. 状态快照（第四十一轮：五项对标差距 + 1 个 partial 全部收口，体检 45/45 全绿）

| 阶段 | 状态 | 交付 |
|---|---|---|
| **A 收敛整合** | ✅ 完成 | `architecture-contracts.ts` 统一常量、`RoutingDecision` 五维契约、5 派活点同一份 Trace、FR 覆盖三态口径、平台端口抽象 |
| **B1 记忆主干** | ✅ 完成并验证 | `memory-log.ts` + `memory-projections.ts`、8 处双写、Context Pack 运行时 lineage 过滤、三条红线真跑证据 |
| **B2 读取链切换** | ✅ **完成并验证** | 见第 2 节：投影召回融合、按主体精确撤权、真实一单端到端撤权、增量 checkpoint |
| **C 三层 Router + 底座切换** | ✅ **C-0 ~ C-6 分步清单全部完成并收口** | 见第 3 节分步清单 |
| **生产项 P-1 长程循环单步化** | ✅ **第二十二轮完成**：单步执行器接上 C-1 的 PG 队列，默认 loop 可回退 | 见第 6 节 P-1 交付与证据 |
| **生产项 P-5 控制台快照服务端分页 / 裁剪** | ✅ **第二十三轮完成**：新增只读 `view-summary`，原 `view` 逐字保留 | 见第 7 节 P-5 交付与证据 |
| **生产项 P-6 Runner 两块协议移植 + 四项借思想** | ✅ **第二十四轮完成**：HITL 成对留痕、队列累计确认 / 至少一次通知 / 投递就绪、六态派生 / 能力声明 / 分层 / 快照不回溯；MIT 固定来源、未引入第 8 个上游 | 见第 8 节 P-6 交付与证据 |
| **生产项 P-7 Anthropic agent memory 分层参考 +「参考即记忆」规则** | ✅ **第二十五轮完成**：五组纯函数守门（挂靠 / wiki 护栏 / 注入索引 / 只读 Dreaming / 参考按候选沉淀）；网页文章仅借思想、登记在 `conceptReferences`，不是第 8 个上游 | 见第 9 节 P-7 交付与证据 |
| **生产项 P-8 查漏补缺 + 取长补短** | ✅ **第二十六轮完成**：守门以只读 `memory-guard` 接真实数据；冻结基线 / golden diff / 双臂旗标 / 出站不暴露硬断言 / 决策留痕隔离落地 | 见第 10 节 P-8 交付与证据 |
| **生产项 P-9/P-10 双向回路与漏洞修复** | ✅ **第二十七 / 二十八轮完成**：回路契约 + 三个执行链节点留痕 + 回流建议；五个真实缺陷修复 + 飞书显式回答接进 HITL 台账（恒 advisory） | 见第 11 节 |
| **生产项 P-11 回答自动续跑 + 授权代办 + 服务纳管** | ✅ **第二十九轮完成**：用户三连拍板（自动续跑闸 / step 真实业务单 SUI-129·SUI-135 授权代办核可 / 四个已取消服务重启纳管） | 见第 12 节 |
| **P-12 RBAC + 用户级配置 + 前端重写；P-13 知识分区 CRUD** | ✅ **第三十轮完成**：casbin RBAC（两进程共用）、用户级配置（本人读写 / 管理员总览）、Vue 3 + Element Plus 前端重写（本地 vendor）、知识 create/update/delete + 分区权限 | 见第 13 节 |
| **③c 记忆写入链四项（第 13 条 (a)）** | ✅ **第三十一轮完成**：证据锚点 + 悬空拒绝、wiki 投影（非第二事实源）、注入索引与 Context Pack 分工、Dreaming 接 C-6 闸门；配套读分区与控制台审核升级 | 见第 14 节 |
| **③d OpenMausBot 五项（第 12 条 (b)）** | ✅ **第三十一轮完成**：Skill 能力包、对外动作不重跑（崩溃回收 + 显式失败双闸）、委托树血缘 + generation、升级只通知不代批 + 限速、团队包黑名单 / 密钥扫描 / 导入不提权 | 见第 14 节 |
| **切默认底座 local-pg + step** | ✅ **第三十二轮完成**：用户拍板「切（推荐）」；`config.ts` 默认 `host.provider=local-pg`、`execution.mode=step`，显式配 paperclip / loop 即回退；`step:once` 端到端真跑验证三红线（状态外置 / 步间重评 / 诚实失败） | 见第 15 节 |
| **DeepSeek v4 flash 接入 Cognee 原生管线** | ✅ **第三十三轮完成**：用户提供 key，LLM 走外部 DeepSeek v4 flash、embedding 默认本机 fastembed（`jinaai/jina-embeddings-v2-base-zh` 768 维）；cognify / search 端到端真跑通过、语义召回准确；bridge 带环境变量重启后状态如实显示已配置 | 见第 16 节 |
| **自动化四件套 + 运行层缺陷修复** | ✅ **第三十六 / 三十七轮完成**：定时调度器（interval/daily/cron）、GitHub 监听（轮询 + webhook HMAC）、钉钉/企微通道、定时唤醒复查；修掉「一个失效交付任务饿死整条主循环」等 4 个运行层缺陷 | 见 `docs/RE-AUDIT-2026-11-09.md` |
| **周边与运行层收口 + Acceptance 成为模块** | ✅ **第三十八轮完成**：验收工作台与审查 Agent 前端、共享上下文底座 + 三层职能组织视图、事件分流/并发上限/合并成一轮、GitLab 与通用 HTTP 事件源、交付前独立审码阶段、验收矩阵（3 视图 × 2 主题 × 1280/320）× 键盘逐键、出站重试健康视图 | 见 [`docs/ROUND-38.md`](../docs/ROUND-38.md) |
| **四条边界收口** | ✅ **第三十九轮完成**：事件源默认开启并单向归属（`claims` / `mirror`）、验收矩阵扩到 7 视图 28 单元 + 白屏判据、并发按密度缺省 + 跳过留痕、通道体检（零外部请求） | 见 [`docs/ROUND-39.md`](../docs/ROUND-39.md) |
| **分层契约体检 + 直通契约化 + 对标** | ✅ **第四十轮完成**：`npm run audit:layers` 40 条（ok 39 / partial 1 / gap 0）；直通抽成 `src/pass-through.ts`（6 判定）；修 `canCreateKnowledge` 范围口径缺陷；新增三上游架构面对标与三张架构图 | 见 [`docs/ROUND-40.md`](../docs/ROUND-40.md) · [`docs/LAYER-CONTRACTS.md`](../docs/LAYER-CONTRACTS.md) |
| **五项对标差距 + 1 个 partial 全部收口** | ✅ **第四十一轮完成**：`npm run audit:layers` **45 条（ok 45 / partial 0 / gap 0）**；准入三档、订阅 hand-back / release、报告内讨论 + 区域点选、配置规则视图、一条命令安装；知识读按业务域收窄 | 见 [`docs/ROUND-41.md`](../docs/ROUND-41.md) |

系统能跑、全套回归全绿（**690/690 单测**、**`audit:layers` 47 条（ok 47 / partial 0 / gap 0）**、**`console:smoke` ok:true / failed:[]（7 视图 + 28 单元验收矩阵）**、**`memory:hierarchy` 16/16**、**`guard:smoke` 22/22**（golden 基线已人审重冻结，第三十八轮记录见 `fixtures/behavior-golden.json` 的 `humanReview`）、**`steps:smoke` 61/61**、**`host:pg` 24/24**、**`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`loop:smoke` 18/18**、上游 clean（含 casbin / Vue / Element Plus 登记））。`HEAD = origin/main = 远端 main`。C-1 起每次代码改动都重跑全套；本机 PG 17.10 专属库 `suitme_collab_c1` 已可真跑。服务现状：3100 / 4180 / 4190 / 4192 / 4194（+git 9418）+ console 4200 全部运行中，由 `scripts/services.ts` 统一纳管。

## 2. B2 已完成（四项，均带真跑证据）

| # | 交付 | 验收证据 |
|---|---|---|
| 1 | `src/memory-recall.ts`：投影召回作为**第三路**信号接入 `TeamMemory.search` 融合排序；只在 `reusable()` / `allowed()` / hash 重评**之后**按 `sourceId@revision` 白名单裁剪，读日志失败按 advisory 降级 | `tests/memory-recall.test.ts`；全套 413/413、走查 11/11、既有权限/版本重评测试不回退；`modelCalls=0` |
| 2 | `grant-revoked` 不再进全局 `revokedSourceIds`，改记 `principalRevocations`；`recallMemory` 按当前 principal 精确排除，未指定主体时 fail-closed；`source-revoked` 仍全局阻断 | 新增「A 撤权不影响 B 的同源记忆」用例，`tests/memory-replay.test.ts` 全绿 |
| 3 | `npm run memory:journey`：真实 bridge action 跑 `create-source → review confirmed → memory-index → edges-save → l2-extract → context-pack → review withdrawn`；只新建一条专用资料并在末尾撤回，既有资料不动 | `ok:true`；四类投影 before `1/2/1/1` → after `0/0/0/0`，召回 1→0，lineage 失效 4 事件；证据 `.runtime/memory-journey.json`（不入库） |
| 4 | `src/memory-checkpoint.ts` + `npm run memory:checkpoint`：checkpoint + 增量应用；撤权/乱序/失效祖先等会回溯的情况回退全量，且增量结果始终与全量 checksum 逐字节对照 | 真实日志 `mode:incremental, applied:1, checksumEqual:true`；`tests/memory-checkpoint.test.ts` 6/6（含分批追加、重复行、跨批撤权） |

> B 阶段（B1 + B2）已验收通过。第十五轮用户已按 `08-OPEN-DECISIONS.md` 第 1 条拍板 **② 独立前端应用**，产品形态冲突解除，**C 正式启动**（严格分步，不并行）。三层判断当前仍是 `recommended=false`（8 项前置条件；p8 改用真实在岗数判定，默认空编制为 0 故仍 false），**不把三层当默认答案**。

## 3. C 分步清单（第二十一轮 C-6 全部完成并收口；严格不并行）

| 步骤 | 内容 | 状态 |
|---|---|---|
| C-0 | ② 决策固化与产品思路复盘（两篇材料分工、三层 = 同一现场的三种座位） | ✅ 完成，见 `docs/ADAPTATION-v0.6.md` `0.0000000000000000` 节 |
| C-0b | 用户追加的两条产品约束固化：**组织形态可配置** + **沉淀与自演进**（`PRD §10C` 的 C-P1~C-P5） | ✅ 完成，仅文档与清单，见同一节第 6 小节 |
| C-1 | **本机 PG 真跑 + 长程执行地基**：`PgHostPlatform`（事务 / ACL / 成本账本 / heartbeat `checkout-retry-runToken` / `SKIP LOCKED` 步进队列与崩溃恢复）、`config.host.provider=local-pg`、R7 协议登记、C-P6 产品约束 | ✅ **完成并真跑**：`npm run host:pg` **21/21 `ok:true`**，见下方「C-1 交付与证据」 |
| C-2 | **国内适配 + 自研独立控制台**：清掉旧可见层的海外品牌 / 命令 / 英文协议词；`console/` 六视图 + 明暗主题 + 425px；只读白名单 13 项、密钥不出服务端；`npm run console:smoke` 真跑 | ✅ **完成并真跑**：6 视图、主题切换、425px 无溢出、写动作 403、可见文案零海外品牌 |
| C-3 | 五个派活点收敛为单一 `Router`；**读配置决定下一跳**（扁平 1 跳 / 分层 2 跳），不写死三段；保留 legacy 一行回退 | ✅ **完成并真跑**：`npm run router:smoke` **31/31 `ok:true`**，见下方「C-3 交付与证据」 |
| C-4 | 可配置角色体系：**Agent 实例 + 职责绑定 + 生效范围 + 版本**，职责含个人助手 / 主管 / 执行 / **验收** / 标准起草 / 周期巡检；A2A handoff；验收 Agent 与产品 / 技术 / 运营 Agent 协作；禁止同一 Task 自派自验自环 | ✅ **完成并真跑**：`npm run agents:smoke` **43/43 `ok:true`**，见下方「C-4 交付与证据」 |
| C-5 | 按配置重跑 `assessThreeTier()`（P3 / P4 改为按当前配置判定）+ **扁平 / 分层两种配置各跑真实一单**，Trace 每步可回放 | ✅ **完成并真跑**：`npm run shapes:smoke` **36/36 `ok:true`**，见下方「C-5 交付与证据」 |
| C-6 | 沉淀回流与自演进闭环：自查标准回流到交付前强制比对、候选改进 → 工程闸门（回放验证）+ 人审 → 版本 / 灰度 / 可回滚 → 效果对比（通过率、返工率、单任务成本、人被打断次数） | ✅ **完成并真跑**：`npm run evolution:smoke` **45/45 `ok:true`**，见下方「C-6 交付与证据」 |
| 收尾 | 全量回归、文档同步、提交推送 | ✅ **本轮完成**：`HEAD = origin/main`，工作区干净 |

### C-1 交付与证据（第十六轮，用户改口「本机可以引入 pgsql 数据库去测试」）

- **撤回上一轮判断**：原写「本机试点不引入 PostgreSQL，用原子写 + 文件锁等价」——**作废**。本机 PG 17.10 已在 `127.0.0.1:5432` 运行（`psql` 在 `/opt/homebrew/opt/postgresql@17/bin/`），新建**专属库 `suitme_collab_c1`**，未触碰已有 `geo_flow`。
- **代码**：`src/pg-host.ts::PgHostPlatform` 实现同一 `HostPlatformPort`；`config.ts` 增加 `local-pg` 与 `pgDsnEnv`（DSN 只从 `COLLAB_PG_DSN` 环境变量读，`assertLocalPgDsn()` 拒绝非回环）；`platform-port.ts::resolvePlatform` 已接线；`scripts/host-pg-smoke.ts` + `npm run host:pg` 真跑；`tests/pg-host.test.ts` 6 例契约；`audit-upstream.ts` 纳入 R7 机器化检查。
- **产品约束 C-P6**（`PRD §10C`）：循环 / 会话状态 / 执行环境三者分离；每步一次独立调用、下一棒由队列原子激活、同一 run 只有一个 ready 步、领取带 `runToken`、崩溃可回收且旧凭据失效。**Agent 感知不到执行环境差异 ≠ 权限可跨环境放大**，步间仍按当前身份重评。
- **真跑 21/21**：事务内文档修订原子递增、ACL 未知主体被拒、cost-ledger 写读一致、heartbeat 重复领取被拒 / token 轮换、步进链 `ready→queued→done`、并发领取拿到不同 step、重复 `completeStep` 被拒、崩溃回收与旧 token 作废、错误 token 不留半写状态、`capabilities()` 如实列 9 项已实现与 3 项仍缺。报告 `.runtime/host-pg-smoke.json`（不入库）。
- **三个取舍如实**：本机不引 Redis（PG `SKIP LOCKED` 等价，切换点为 `claimStep / completeStep / recoverStaleSteps`）；不部署远端工具沙箱 / 多机 Remote Tool Calling；默认底座仍 `paperclip`；**`runner.ts` / `assistant-runner.ts` 的常驻 `while` 已在第二十二轮 P-1 移除并改为配置驱动的双泵**（`loop` 逐字等价、`step` 由队列领步），但默认仍是 `loop`、真实业务单未在 step 模式跑过。缺口如实写在 `executionView().missing`。
- **R7 协议材料**：`pg@8.23.1` + `@types/pg@8.23.1` 精确版本与 lockfile integrity、`licenses/pg-MIT.txt`、`THIRD_PARTY_NOTICES.md`、`docs/SOURCES.md`、`docs/OPEN-SOURCE-COMPLIANCE.md` G8、`audit-upstream.ts`；`audit:upstream clean:true`。

### C-3 交付与证据（第十八轮）

- **代码**：`src/router.ts` 的 `planRoute()` 纯函数 + `Router` 唯一写入口 + `getRouter()` 单例 + `routerRevision()` 快照 + `planCoverage()`；`config.router` 支持 `legacy | flat | layered`、按业务域 `domains`、`defaultDomain`、`maxHops`，默认 `flat`。
- **接线**：`controller`(3) / `coordination`(1) / `assistant`(1) / `service-network`(2) / `v06`(2) 共 **9 处**改为 `getRouter().route({...})`；`server.ts` 启动时 `configureRouter(config.router)`；`routing-status` 与控制台「协作」视图返回 `router` / `routerCoverage`。`tests/routing-decision.test.ts` 守门改为「9 处经 Router、零直写」。
- **红线**：`legacy` 逐字回退且幂等键与 flat 一致；未配主管的业务域 / 被拒待定决策 / 主管即承接人都退回 1 跳并标注 `degraded`；自派自验自环被拦并写 `rejected` 留痕；人签只在最后一跳；配置 revision 写进每条决策证据，历史决策不回溯。
- **真跑 31/31**：`npm run router:smoke` 在隔离内存 Trace 上把五个真实派活意图按三种形态各跑一遍（legacy 5 / flat 5 / layered 10 跳），验证五阶段覆盖、重放去重一致、因果链闭合、人签不扩散、p6 按证据、p8 未放行、未登记业务域降级、自环留痕；报告 `.runtime/router-smoke.json` 不入库，真实 `.runtime/routing/events.jsonl` 未被脚本写入。
- **真实服务端实测**：`routing:status allWired:true`；`router.mode=flat, domains=[]`；`routerCoverage total=65 / routed=7`；p6 false、p8 false、`recommended:false`。历史 58 条改造前决策不带 Router 快照，符合「不回溯改写」。
- **顺带修复**：控制台只读请求 in-flight 去重 + 短缓存，解决 `view` 慢（约 5.2 秒）导致切换视图时并发请求一起超时；`tests/console-shell.test.ts` 补 2 例契约，协作视图截图已无错误卡片。

**关键产品原则（复盘结论）**：三层会多一跳转发；若靠「总结成一段话往下传」，上下文折损会按乘法加倍重现。所以三层必须架在 B1/B2 已建好的**共享现场**上——三者换的是**可见范围与责任主体**，读的是同一份 append-only 主干 → 四类投影 → 按 Task 裁剪的 Context Pack，交接靠 A2A 带 `sourceIds / scope / causedBy`。**B 就是让三层不丢上下文的地基。**

**组织形态可配置（用户追加，修正上面「三层」的固定骨架口径）**：上百人团队可在产研 / 增长运营 / 销售 / 财务等业务域各设一个中间决策层 Agent；10 人团队可能一个都不设。**同一个 Agent 既能做管理、也能做某人的 Personal Agent**，由配置决定；团队长大时是「加配置」而非「换系统」。用户已确认：配置按业务域 / 组织单元生效（项目只引用不覆写）、允许兼任，但同一 Task 不得自派自验自环；变更留快照不回溯。这把 `src/roles.ts` 的「**划分是配置，责任是事实**」从主职能推广到 Agent 组织；`AGENT_ROLES` 三个名字降级为**能力类型**。

**判断分层与自演进（用户追加）**：确定性工程层（规则过滤、权限重评、注意力预算、周期巡检、清单校验，`modelCalls=0`）→ 按需 AI 层（记证据与成本，能本机不外部）→ 人层（目标、边界、高风险联签、最终核可）；必达消息不受过滤影响。**沉淀不是为了记更多，是为了下次少花一次判断**。Agent 可以提出改进，**不能自己让改进生效**：不得自动改写已锁定清单、权限规则、人签红线或历史任务；候选改进须过工程闸门 + 人审 + 版本 + 灰度 + 可回滚。L1 → L5 是分级渐进，`recommended=false` 是防跳级闸门。

**三层判断当前结论（真实数据）**：C-5 已按当前配置重跑评估。默认 `mode=flat`、编制空，真实全量日志 `routed 7/65`（改造前的历史决策不带 Router 快照、不回溯改写 → p6 仍 false），`shape.mode=flat`、P3 / P4 按扁平口径、`shape.ready=false`、`recommended=false`。p8 现在是防跳级闸门：只有「分层配置 + 真实在岗 Agent + 已配置业务域」才为 true，扁平下 evidence 明说「本形态不需要三层」。C-3 真跑发现只按角色名判定会被合成五阶段数据凑齐，闸门已焊死；C-5 的分层 P4 进一步要求派活方同时命中配置登记与真实在岗主管职责。反面依据：玉伯 OPT 访谈说人是「监工」、同时管 5 个 Agent 已达带宽上限、「暂无法实现 Agent 自主管理 Agent」；LobeHub Community License 禁止复制代码。**C-5 已按当前配置重跑评估**：扁平不要求出现 supervisor、`shape.ready` 与 `recommended` 分开表述；真实服务端因历史决策不回溯，p6 仍 false、`recommended=false`，隔离真跑中只有「分层配置 + 真实在岗主管」才 `recommended=true`。不要为凑评估转绿逼扁平团队硬造管理层，也不要把隔离真跑的分层结论当成组织已配置管理层。

## 4. 去 Paperclip 化路线（② 已拍板；C-1 ~ C-6 完成；P-1 单步执行器已就绪）

- 已完成：五个派活点收敛到单一 `Router`（C-3，9 处调用零直写）；能力收拢到 `HostPlatformPort`；默认 `PaperclipPlatform` 薄包装；`LocalHostPlatform` 不依赖 Paperclip 且 `host:smoke` 真跑通过；**C-1 新增 `PgHostPlatform` 且 `host:pg` 真跑 21/21**；`config.host.provider` 默认仍是 `paperclip`（切换前保持可回退）。
- **产品形态冲突已解决**：第十五轮用户拍板 ②，`PRD §10A` 的 S5/S6 已废弃，S1–S4 保留；飞书仍是唯一发起入口。见 `08-OPEN-DECISIONS.md` 第 1 条。
- **5 项缺口按 ② 重新定义后的真实状态**：ACL / 成员身份、cost-ledger、heartbeat `checkout/retry/runToken`、事务与并发 —— **C-1 已在 `local-pg` 后端真实实现并有真跑证据**；UI 承载由 **C-2 自研独立控制台**提供（旧插件工作台保留可回退），但**默认底座仍由宿主承载界面**，未切换 `config.host.provider`。文件后端 `local` 仍保留单进程缺口清单，不冒充已完成；`local-pg` 仍如实列出「独立应用 UI / 远端工具沙箱 / Redis 横向扩展」三项生产缺口。
- 候选（可复用代码，本轮未引入）：Pi（`earendil-works/pi`，MIT core）、CoPaw（Apache-2.0）、Octop（MIT，最接近 Paperclip 的任务+ACL+IM+插件）、DeerFlow（MIT）。只借思想：LobeHub（Community License）、n8n（Sustainable Use License）。

## 5. 其它已知未完成（不是 bug，不要「顺手补」）

- 真人在真实业务单「确认验收」（**SUI-129 未核可**）——只能由用户在原会话做。
- 飞书部门 scope 授权命令已生成，但重新登录确认只能本人操作。
- Cognee 原生 `cognify` 真实外部模型调用未发生（缺端点与凭据，本轮未外发任何业务材料）。
- 企业微信 / 腾讯文档 / 钉钉 / 国内代码托管 / 公有云 CI / 海外 SaaS 未接通，按约定**没有入口**；将来要加入口必须先配置并实测接通。
- 生产发布、业务仓库发布、真实外部 PR/CI、全员 SSO 均未发生。
- **C-6 已完成（第二十一轮）**：自查标准回流到交付前强制比对、候选改进的工程闸门 + 人审 + 版本 / 灰度 / 回滚、四项错误效果对比均已落地并真跑 45/45。**第二十二轮 P-1 已完成长程循环单步化**（`runner.ts` / `assistant-runner.ts` 无常驻 `while`；`steps:smoke` 40/40，含真实 PG 跨进程接力），详见第 6 节。**第二十三轮 P-5 已完成控制台只读快照的服务端分页 / 裁剪**（见第 7 节），原 `view` 逐字保留。**剩余生产项如下，仍需用户确认或外部凭据**：切换默认 `config.host.provider`、把真实业务单切到 step 模式验证、autoloop worker 内部子调用逐次拆分、真实外部模型端点与远端工具沙箱 / 多机切换、金额成本账本接入效果看板。
- **Runner 外部候选（第二十三轮评估 → 第二十四轮已拍板并完成）**：用户给出 `github.com/yicheng47/runner` 的终端 Agent 协作层架构图，第二十四轮拍板 (b) 移植两块协议 + 四项只借思想。固定 MIT 提交 `a42d133139bbe630e4ca3475426c7653fddd86db`、R7 六步登记完成；**协议语义用 TypeScript 重写，未复制 Rust 源码、未引入 submodule / gitlink，7 个上游不变**。交付与红线见第 8 节、`HANDOFF/08` 第 11 条与 `docs/ADAPTATION-v0.6.md` 最新边界节。

### C-4 交付与证据（第十九轮）

- **代码**：`src/agent-registry.ts`（Agent 实例、可扩展职责槽位、`domains` 生效范围、内容哈希版本、`registryRevision` 快照、`resolveAssignment` / `handoffEnvelope` / `reviewCrew` / `registrySummary` 与单例）；`config.agentRegistry` 默认**空编制**。
- **Router**：`planRoute(input, config, registry?)` 与 `Router` 第 3 参数显式传入才校验主管在岗 / 职责 / 范围，未传与 C-3 逐字等价；每跳证据带 `agents:<rev>:<n>`；`server.ts` 装配 `configureAgentRegistry` + `configureRouter(..., getAgentRegistry())`，p8 用真实 `onDuty()` 计数。
- **A2A 与验收**：`service-network.ts` 的 `route()` / `start()` 在编制非空时做在岗校验并留 `handoff:` 证据；`v06` 新增 `agent-registry-view` / `acceptance-crew` 只读动作、`review-readiness` 返回编组、`org-overview` 扩为 11 段；控制台「协作」视图显示中文「Agent 编制」卡片。
- **红线**：独立评审者 ≠ 产出方、不替代原发起人确认验收、已锁定清单不可改写；同一 Task 自派自验自环被拦；默认空编制不硬造管理层；飞书仍是唯一发起入口，控制台只新增只读动作。
- **真跑 43/43**：`npm run agents:smoke` 隔离内存 Trace（C-3 兼容、空编制降级、在岗 2 跳、停用 / 职责 / 范围降级、自环留痕、验收编组、A2A 六类失败、快照不回溯、五处接线守门）；`tests/agent-registry.test.ts` 14 例。报告 `.runtime/agent-registry-smoke.json` 不入库，不写真实 `.runtime/routing/events.jsonl`。
- **真实服务端实测**：`v06-agent-registry-view` / `v06-acceptance-crew` / `v06-review-readiness` 均 200 且空编制如实降级；`routing:status allWired:true`、`agentRegistry.onDuty=0`、p8 false、`recommended:false`。

### C-5 交付与证据（第二十轮）

- **评估口径**：`src/three-tier-assessment.ts` 新增 `OrgShape` / `ORG_SHAPE_LABELS` / `shapeOptions(router, registry)`；P3 / P4 按当前 `config.router.mode` 判定。扁平 P4 = `directDispatches`（人 / 助手直达执行者），不要求主管且历史 supervisor 角色记录不参与判定；分层 P4 = `boundSupervisorDispatches`，要求派活方同时命中「配置登记的主管」与「真实在岗带 supervisor 职责的 Agent」，合成角色名凑不齐。
- **结论分离**：新增 `shape: { mode, label, ready, applicable }`。`shape.ready` = 当前形态按自身配置是否闭环（扁平不计 p8）；`recommended` 只在 `layered` 且八项全绿时 true，只表示「当前分层配置可正式启用三层」。p8 仍是防跳级闸门，扁平下 evidence 明说「本形态不需要三层」。未声明配置时退回最保守固定口径，旧调用逐字兼容。
- **接线**：`server.ts` 的 `routing-status` 与 `scripts/routing-status.ts` 改调 `shapeOptions(getRouter(), getAgentRegistry())`；`console/app.js`「组织形态」卡加「形态判定」「三层结论」两行中文白话。服务端已 `restart:bridge`，真实 HTTP 与 CLI 口径一致。
- **真跑 36/36**：`npm run shapes:smoke` 在隔离内存 Trace 上让扁平 / 分层各跑一单五阶段；每一步带 Router 配置快照与（分层）在岗编制快照，两次 `replayRouting` 逐字节一致、`uniqueDecisions` 与跳数一致、分层两跳 `causedBy` 闭合、人签只在末跳、配置变更不回溯、真跑前后真实日志行数不变。扁平 `shape.ready=true / recommended=false`；分层 `shape.ready=true / recommended=true`。四类防跳级反例（只有角色名、扁平却有在岗 Agent、主管不在岗降级、未声明配置）均不放行。`tests/shape-assessment.test.ts` 10 例，全套 **388/388**。报告 `.runtime/shapes-smoke.json` 不入库。
- **真实浏览器修复**：演示截图复验时发现 `view` 返回整个工作区快照已增长到 **415KB / 10~12 秒**（C-3 时约 5 秒），前端统一 8 秒只读超时会稳定超时并渲染错误卡片；改为**按动作区分超时**（`view` 30 秒、其余只读仍 8 秒快速失败），保留 in-flight 去重与 1.5 秒成功结果短缓存。`tests/console-shell.test.ts` 的 C-3 契约同步守住；`console:smoke` 全绿、协作视图截图 `errorCards:0`、任务列表与「Agent 编制」卡片均正常。**未做服务端分页 / 裁剪**，如实列为后续性能项。
- **真实服务端如实**：默认 `mode=flat`、编制空，`routing:status allWired:true`、p6 false、`recommended=false`、`shape.ready=false`；`shape.ready=false` 是真实全量日志仍含改造前不带 Router 快照的历史决策（历史不回溯改写），不是 C-5 未完成，隔离真跑里扁平形态已闭环。

### C-6 交付与证据（第二十一轮）

- **独立治理台账**：`src/evolution-ledger.ts` append-only 记 7 类治理事件，每条 `modelCalls=0`、带内容哈希与幂等键，坏行记 `errors`，两次重放 checksum 一致。**刻意不并入 B1 记忆主干**（会改变既有重放与 checkpoint 证据），两者按 `taskId` / `causedBy` 引用。
- **交付前强制自查**：`src/evolution.ts` 的 `standardsRevision()` 由服务端算快照、`evaluateSelfCheck()` 逐条比对有无 / 通过 / 证据、`assertDeliverySelfCheck()` 接在 `Controller.publish()` 真正交付之前；无记录 / 缺条 / 未通过 / 空证据 / 旧快照五种全阻断。放行只留痕，不等于人签；无沉淀标准时如实「无项可比」。`config.evolution.selfCheckGate.enabled` 默认 true。
- **状态机与红线**：`proposed → gate-passed → approved → canary → active → rolled-back`；Agent 自批、跳闸门、无人审灰度、非真人让改进生效、重复登记、触碰「已锁定清单 / 权限规则 / 人签红线 / 历史任务」全部记违规痕且不前进。「生效」只是台账状态，真跑逐字节核对清单与标准文件均未改写。
- **工程闸门复用既有重放**：`engineeringGate()` 调 `memoryReplayReport()` 检查两次重放一致、`modelCalls=0`、无坏行 / 悬空因果、有真实来源，不另造第二套重放。`aggregateEffects()` / `compareEffects()` 算通过率 / 返工率 / 单任务成本（模型调用次数代理，不编造金额）/ 人被打断次数，缺观测即 `comparable=false`。
- **接线**：`server.ts` 注入 `V06Services.evolutionWithConfig(config)`、`v06Reads` 加 `evolution-view`；`v06` 七个 `evolution-*` 动作统一转发，人审 / 灰度只认组织级真人；`console-server.ts` 白名单加 `v06-evolution-view`；控制台「协作」视图新增中文「沉淀与自演进」卡片。真实 HTTP 200、控制台写动作 403、`console:smoke` 全绿且 `errorCards:0`。
- **真跑 45/45**：`npm run evolution:smoke` 在临时目录隔离台账上跑完整闭环与全部反例，前后真实治理台账 / B1 主干行数不变、已锁定清单字节未变；`tests/evolution.test.ts` 12 例，全套 **400/400**（第二十一轮当时基线；第二十二轮为 413/413）。报告 `.runtime/evolution-smoke.json` 不入库。
- **如实边界**：真实业务单上没有触发过「因缺自查而阻断交付」，该路径只在隔离台账与契约测试里真跑，避免产生真实交付副作用；默认底座仍 `paperclip`，飞书仍是唯一发起入口，4190 / 4192 / 4194 / 9418 保持停机。

## 6. P-1 交付与证据（第二十二轮，长程循环单步化）

- **代码**：`src/step-execution.ts`（`StepQueue` 契约、`InMemoryStepQueue`、`PgStepQueue` 接 C-1 的 `claimStep / completeStep / recoverStaleSteps`、`executeOneStep()` 一次调用只跑一步、`defaultStepRecheck()` 步间按当前主体重评、`driveSteppedLoop()` 可换机器的外部调度器、`stepExecutionSummary()` 确定性摘要、`executionView()` 中文只读状态）；`src/loop-pump.ts`（`driveLegacyLoop()` 与改造前逐字等价、`driveSteppedPump()` 会话快照写回队列）；`src/step-runner.ts`（`npm run step:once` 一次进程一步，工具白名单只有 `sha256`，模型步无端点即拒绝，人工确认步不得由执行进程放行）。
- **配置**：`config.execution.mode` 默认 `loop`；`step` 必须配 `host.provider=local-pg`，`configSchema.superRefine` 直接拒绝「没有状态外置队列却声称单步」。默认底座仍 `paperclip`，飞书仍是唯一发起入口。
- **接线**：`runner.ts` / `assistant-runner.ts` 的 `while(!settled)` 移除并按配置分派；`v06` 加只读 `execution-view`、`server` 的 `v06Reads` 与控制台白名单同步；控制台「协作」视图新增中文「长程执行」卡片（只读，不新增写动作）。
- **真跑 40/40**：`npm run steps:smoke` 在隔离内存队列 + 本机 PG 专属库 `suitme_collab_c1` + 真实子进程上跑完整链与全部反例。第一棒由 `step:once` 领走 `counter=1` 并原子激活第二棒；第二棒由 `COLLAB_STEP_ENVIRONMENT=另一台机器` 的独立进程领走 `counter=2`、`previousEnvironment=本机执行环境`；旧 `runToken` 作废、崩溃回收、缺身份 / 范围不一致 fail-closed、未登记步骤 / 模型步 / 人工步 / 白名单外工具一律拒绝；真跑前后 B1 主干行数不变。用唯一 `runId`，**不调用 `resetForTest()`**、不清空他人数据。`tests/step-execution.test.ts` 13 例，全套 **413/413**。
- **真实服务端**：`v06-execution-view` HTTP 200（`mode=loop`、`steppedReady=false`、`missing=6`）；控制台代理只读 200、写动作 403；`console:smoke` 全绿，四张演示截图 `errorCards:0`。
- **如实边界**：真实业务单未在 step 模式跑过；无任何外部模型调用；autoloop worker 内部一次 tick 的多次子调用尚未逐次拆分（当前 tick 级单步）；远端沙箱 / 多机切换 / Redis / 金额成本账本未落地；`host:pg` 的 `resetForTest()` 会清空专属测试库，`steps:smoke` 的 append-only 留痕不保证长期保留。

## 7. P-5 交付与证据（第二十三轮，控制台只读快照服务端分页 / 裁剪）

- **代码**：`src/workspace-summary.ts`（`parseViewSummaryPage()` 参数夹取、`visibleTasksFor()` 与 `view` 逐字一致的身份过滤、`buildWorkspaceSummary()` 确定性纯函数与字段白名单）；`server.ts` 新增只读 `view-summary` 分支（只从本机任务索引 + 工作区目录组装，宿主 issue 标题按当前页并发取、单条 2 秒超时即降级）；`members.ts` 的 `reads`、`console-server.ts` 的 `CONSOLE_READ_ACTIONS` 同步登记；`console/app.js` 四处改用摘要、走默认 8 秒快速失败，`view` 的 30 秒宽限只留给兼容调用；`tests/workspace-summary.test.ts` 9 例 + `tests/console-shell.test.ts` 2 例；`scripts/console-smoke.mjs` 补 4 项真跑检查。
- **真跑（真实服务端 HTTP）**：`view` **509,283 bytes / 4.02 秒** → `view-summary` **5,678 bytes / 0.076 秒**，`limit=2` 为 **1,078 bytes / 0.019 秒**；`taskCount=10`、`page.total=10`、`hasMore=false`、`titleSource=host`、`fieldsClipped=true`；任务对象只有 7 个白名单字段，序列化结果不含 `snapshots` / `body` / `context` / `sourceAccess`。
- **回归**：`npm test` **424/424**、`tsc`、两个构建、425px 响应式、工作台走查 **11/11**、`console:smoke` 全绿（含 4 项新检查，且旧 `/api/view` 仍 200 / 10 条真实任务，旧链路未回退）、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 40/40、`host:pg` 21/21、记忆重放 / checkpoint、`audit:upstream clean:true`、`git diff --check`。
- **环境处置**：本轮开始时 3100 / 4180 进程带失效文件代理，`fs` 读取报 `connect failed: Connection refused`，宿主静态页 500、`view` 一度 409 并随后崩溃；按 `HANDOFF/00` 第 3 / 5 节既定流程用干净环境重启 4180 / 3100 并重挂插件后恢复，走查 11/11。未改上游源码、未重启 4190 / 4192 / 4194 / 9418。
- **如实边界**：摘要只用于展示索引，不承载工作稿正文 / 授权明细 / 验收判断；`view` 逐字保留，插件工作台未改动；宿主标题为 advisory，缺失时标 `titleSource=local/partial` 并用本机任务索引首行兜底；控制台只读白名单 16 → 17 项、仍无写入口；默认底座仍 `paperclip`、飞书仍是唯一发起入口；真人业务验收 SUI-129 仍未发生。其余剩余生产项未动，仍需用户确认或外部凭据。

## 8. P-6 交付与证据（第二十四轮，Runner 两块协议移植与四项借思想）

- **来源与协议**：Runner `main` 固定 **MIT** 提交 `a42d133139bbe630e4ca3475426c7653fddd86db`（Copyright (c) 2026 Yicheng Wang）；R7 六步已走完（`licenses/runner-MIT.txt` 原文、`THIRD_PARTY_NOTICES.md`、`sources.lock.json` 的 `protocolReferences`、`docs/SOURCES.md` / `docs/OPEN-SOURCE-COMPLIANCE.md`、`scripts/audit-upstream.ts` 机器化校验、两个模块文件头保留 MIT 版权头）。**协议语义用 TypeScript 重写，未复制 Rust 源码、未引入 submodule / gitlink，7 个上游不变**；避开 2026-08-22 ~ 09-22 的 GPL-3.0-only 发布窗口。
- **① HITL 成对留痕**：`src/step-hitl.ts`（`askHuman` / `answerHuman` / `foldHitl` / `assertHitlRedLines` / `hitlSummary` / `FileHitlSink` / `MemoryHitlSink` / `HitlRefusal`）；`src/step-runner.ts` 的 `human-gate` 从「只拒绝、无证据」变成「生成带编号的 `human_question`、`HitlRefusal` 抛出、步骤仍 failed、执行进程依旧不得自行放行」；真人回答走新增 `npm run step:answer -- <问题编号> <选项> [备注]`（`scripts/step-answer.ts`，必须声明 `COLLAB_HUMAN_ACTOR`，只追加答案、不排后续步骤、不改任务状态）。台账独立、不并入 B1 主干。
- **② 队列送达证据**：`src/step-delivery.ts`（`cumulativeAck` 只前进 / `foldDelivery` 订阅边界与 backlog / `notificationText` 幂等不带消息体 / `atLeastOncePending` / `deliveryReadiness` 按能力声明且重投递只认空闲 / `TrackedStepQueue` 组合既有队列留下送达与确认证据）。`PgStepQueue` 与 `PgHostPlatform` 的表结构、40 项既有真跑语义一字未改。
- **四项借思想**：`src/mission-state.ts` 的 `deriveMissionState()` 六态由任务事实派生（安静 30 秒才 settled，settled 与 running 可并存）、`RUNTIME_CAPABILITIES` / `resolveRuntime()` 用能力声明收敛差异且 `assertNoStoredArgv()` 焊住启动参数不入库、`assertCoordinationLayering()` 守「配置库只放配置、实时协作全在追加写日志」、`assertSnapshotNoRewrite()` 守编制快照不回溯。`executionView()` 新增这些只读说明，不改 `steppedReady` / `missing` 口径。
- **执行链接线**：`src/step-execution.ts` 新增 `OneStepInput.hitl`（不注入则完全无副作用）与 `OneStepResult.hitlQuestionId`；`package.json` 新增 `step:answer`。两组新契约测试 21 例，`scripts/steps-smoke.ts` 新增 E / F / G 三段共 14 项真跑检查。
- **真跑**：`npm test` **445/445**；`npm run steps:smoke` **54/54 `ok:true`**（E 段真实子进程提问 + 真人回答 + 重复 / 匿名被拒、台账未写 B1 主干；F 段真实 PG 队列送达证据与累计确认；G 段四项借思想守门）；`tsc`、两个构建、425px、走查 11/11、`console:smoke`、router 31/31、agents 43/43、shapes 36/36、evolution 45/45、`host:pg` 21/21、`audit:upstream clean:true`、`git diff --check`。
- **如实边界**：`human_response` 只把答案送回提问者，**绝不替代**原发起人在原会话用中文「确认验收 任务编号」；Runner 由系统归档即标完成的语义没有引入；未接通飞书写回通道，真人回答目前只有本机 CLI 入口、不是网页入口；默认 `loop` + `paperclip` 未变、无外部模型调用；SUI-129 仍未核可。剩余生产项（切默认底座、真实业务单跑 step、worker 子调用拆分、外部端点 / 远端沙箱、金额成本账本）仍需用户确认或外部凭据。

## 9. P-7 交付与证据（第二十五轮，Anthropic agent memory 分层参考）

- **来源**：Anthropic Engineering《The components of agent memory》（2026-11-06，Written by Lance Martin，© 2026 Anthropic PBC），**网页研究文章、无开源代码许可证**；`sources.lock.json` 的 `conceptReferences` 登记，不是第 8 个上游。完整逐层对照与 8 条差距清单见 `docs/REFERENCE-anthropic-agent-memory.md`。
- **对照结论**：文章的 `transcripts` / `memory notes` 两层本仓库已有且更严（append-only 主干 + 人签候选链 + 四类投影 + checkpoint）；真缺口是「约束上层的规则」与「知识表示层的形态」，与 `modelCalls=0` 确定性链路不冲突的五条规则已落地。
- **五条规则**：`assertGroundedNotes()`（知识必须挂靠原始事件）、`wikiReport()` / `assertWikiRepresentation()`（链接完整 / 断言有出处 / 不比原始语料大）、`buildInjectedIndex()` / `assertInjectedIndex()`（200 行 / 25 KB、只留索引与指针）、`dreamProposals()` / `assertDreamProposals()` + `assertNoTranscriptRewrite()`（离线整理只提待复核建议、主干只追加）、`validatedRule()` 与 `referenceAsMemory()` / `assertReferenceSedimentation()`（规则含依据与陷阱；**外部参考本身按候选沉淀**）。
- **用户点题**：「参考本身也是组织记忆」——外部材料与自研结论走同一条 `candidate → confirmed → withdrawn` 候选链，恒为候选、带来源与阅读事件、带红线警告；离线整理只能提请提升，采用仍是独立真人动作。
- **真跑**：`npm test` **465/465**；`npm run memory:hierarchy` **16/16 `ok:true`**（复现文章 1.77 倍「地图」失败、真实 B1 主干 40 行前后不变）；`tsc`、两个构建、425px、走查 11/11、`console:smoke`、各隔离冒烟、`audit:upstream clean:true`、`git diff --check`。
- **如实边界**：纯函数守门**尚未接入**真实 `Knowledge` / `Context Pack` / wiki 落盘；未新增只读 action、未改控制台、未改既有投影 / 撤权 / 人签；默认 `loop` + `paperclip` 未变、无外部模型调用；SUI-129 仍未核可。待拍板见 `HANDOFF/08` 第 13 条。

## 10. P-8 交付与证据（第二十六轮，查漏补缺与取长补短）

- **查漏**：P-7 守门当时只被自身冒烟引用、生产链路零调用；出站 MCP 无「不暴露」硬断言；走查报告无冻结基线 / golden diff / 纯评分器；`compareEffects()` 缺双臂旗标；`routing-trace.ts` 决策独立留痕已有等价物，只补断言。
- **补缺**：`src/knowledge-guard.ts` 把守门以只读 advisory 接到真实数据；新增只读 action `memory-guard` 并同步 `server.ts` / `members.ts` / `console-server.ts` 三处白名单。真实 HTTP 200 / 4,337 bytes / 7 ms；真实 22 条本地知识记录全部缺 `evidenceEventIds`，如实报 `gapRecords:22`，未编造事件 id 跑绿。**不读宿主正文、不改 `propose`、不拦截交付、不新增网页入口或前端卡片**。
- **取长**：`src/behavior-baseline.ts` 落地冻结快照 / golden diff / 纯评分器 / 双臂三旗标 / 工具面版本化签名 / 出站不暴露硬断言 / 决策留痕隔离断言；`fixtures/behavior-golden.json` 是从真实 `console:smoke` 报告冻结的 61 条稳定字段（字节序排序），真跑脚本不得自动改写。`tests/p8-contracts.test.ts` 把三处白名单、真实 MCP 工具面、基线不可篡改固化进每次 `npm test`。
- **冻结基线人审**：全套回归后 golden diff 抓到白名单计数 17→18，确认为本轮新增只读 action 的合法变化，人审后手工更新基线并留 `humanReview` 记录；真跑脚本不得自动改写。
- **修掉的真实缺陷**：体检签名未覆盖记录内容（`recordFingerprint`）、注入顶层截断被静默吞掉（`injectedOmitted` + finding）、冻结基线 `localeCompare` 跨区域漂移（改字节序）；既有 B1 投影排序未动，避免影响已验证 checksum。
- **真跑**：`npm test` **532/532**、`npm run loop:smoke` **17/17**、`npm run guard:smoke` **22/22（golden 无差异）**、`memory:hierarchy` 16/16、`steps:smoke` 54/54、`tsc`、两个构建、425px、走查 11/11、`console:smoke failed: []`、各隔离冒烟、`audit:upstream clean:true`、`git diff --check`。
- **如实边界**：P-9 只接通双向留痕与回流建议，真实业务单尚未在该链跑过（`loop-guard` 如实报 `bidirectional:false`、耦合点计数 0），流转自动化不等于决策自动化；只读体检不是写入链改造；第 13 条四项与第 12 条 (b) 五项仍待拍板；默认 `loop` + `paperclip` 未变、无外部模型调用、未引入第 8 个上游或 npm 依赖、人签红线未放宽；SUI-129 仍未核可。

## 11. 第二十七轮 P-9：双向协作回路（用户质疑后的方向纠正）

- **用户质疑**：「必须要有两条相反方向的移动……不能是单向的」「之前是不是做错了？我让你参考那几个开源项目，不知道你参考成了什么样子？」；追加「从具体代码执行落地的过程来看，可以复用那些开源项目中的部分，把它们耦合进来」。
- **核实**：主链路（飞书 IM / `controller.reply()`）本来双向且会自动唤醒下一轮；断的是 P-6 单步 HITL 台账「答完就消失」。四轮参考产出全部在治理 / 评估 / 只读体检侧，零项在双向执行回路——这是真实偏差，已写入 `docs/REFERENCE-capability-comparison.md` 第 6 节复盘。
- **交付**：`src/collaboration-loop.ts`（下行 8 类 / 上行 6 类、`loopReport()` 回路判据、`attachImplicitReplies()` 就近配对、`bridgeAnswerToResume()` 回流建议、`fromAutoloopReceipt()` 与 `fromHitlLedger()` 上游归一化）；只读 action `loop-guard`（三处白名单同步）；`scripts/step-answer.ts` 产出并持久化回流建议到独立 append-only 台账；`tests/collaboration-loop.test.ts` 16 例、`tests/p9-contracts.test.ts` 6 例常态契约、`scripts/loop-smoke.ts` + `npm run loop:smoke` 16/16。
- **真实耦合**：`src/upstream.ts` 运行时直接加载未修改的 Super Agent / Autoloop / DeepSeek Harness 源码，`controller.receipt()` 的 `resultFrom()` 就是上游函数；本轮把它的输出接成上行回路事件，并在 `controller.reply()` / `collaboration-intake.ingest()` 登记下行应答。7 个上游不变、未新增 submodule / npm 依赖。
- **红线**：回执 ≠ 验收、回答 ≠ 放行、续跑建议恒 `autoExecute:false / requiresHumanApproval:true / notAcceptance:true`；`assertLoopAdvisory()` 焊死只读。自动排后续步骤、飞书回答直写 HITL 台账、`step` 默认切换仍待拍板。

## 12. 第二十九轮 P-11：回答自动续跑 + 授权代办 + 服务统一纳管（用户三连拍板）

- **用户 2026-11-08 18:05 拍板**（WorkBuddy 会话，逐字入库）：①「我回答问题后，系统自动干没问题的」；③「其他的也继续完成，模拟真人来完成，全部搞定」。
- **① 自动续跑闸**：`src/auto-resume.ts` 的 `AUTO_RESUME_MANDATE` 逐字保留授权原话；step 模式下飞书显式回答落地（`persistHitlAnswer`）后，向同一 run 的步进队列追加「续跑闸」（human-gate 种类、带 `resumeOf` 指向问题编号）；任何执行进程领到闸时**从台账重新核对** `human_response` 存在且 `acceptance !== true`，才把 `resume_next` 工作步排回队列，验证失败重新提问。`collaboration-intake.ts` 接线（loop 模式仍由 delegate 唤醒、不重复排闸）、`step-hitl.ts` 加 `resumeNext`、`step-runner.ts` 执行闸、`COLLAB_AUTO_RESUME=0` 可整体关闭。授权事实审计 `hitl.auto-resumed` / `hitl.auto-resume-refused`。
- **③ 授权代办核可**：`scripts/delegated-accept.ts`（`npm run delegated:accept -- <任务ID>`）；`controller.confirmAcceptance` 加 `delegation` 参数——核可权仍属原发起人（actor 不变），回执 `executedBy='agent-under-delegation'`、delegation 字段逐字保留授权原话与时间，审计另记 `acceptance.delegated`；逐项闸门（锁定清单 / 独立评审 / 证据核对）与真人执行完全一致，任何一关不过即拒绝。SUI-129、SUI-135 真实业务单经此代办核可收尾（phase=delivered，SUI-135 CI 通过）。
- **服务统一纳管**：`scripts/services.ts` 把 4190 视觉评审 / 4192 验收报告 / 4194+9418 本机交付台按同一套 PID 归属校验 + HTTP/TCP 健康检查纳管（start / stop / restart / status），用户明确「全部搞定」后四个服务已重启并运行中；管理后台「服务管理」tab 复用同一入口（`admin-service-control`，权限 `services-control`）。
- **红线（全部不变）**：回答仍不是验收（确认验收 / 核可 / 放行不进这条链）；隐式回答仍不路由；续跑闸执行时重新验证、不盲信入队入参；代办如实留痕、不伪造真人亲手操作；飞书仍是唯一发起入口；执行形态默认 `loop`（step 是显式配置，真实业务单在 step 模式已跑通后回归默认）。

## 13. 第三十轮 P-12 / P-13：casbin RBAC + 用户级配置 + Vue 前端重写 + 知识分区 CRUD

- **用户拍板**：「对于涉及到权限管控 rbac 相关，直接找开源项目代码复用」「每个用户都可以配置自己的部分，管理员可以看到所有的，当然管理员也是一个用户」「前端界面也做一个完整优化，复用开源代码和组件库」「知识体检……肯定也需要人可以增删改呀，agent 和人都可以增删改查，但是肯定是有对应权限区域的……你只能改自己范围内的东西」。
- **RBAC（casbin 5.51.1，Apache-2.0，R7 六步登记）**：`src/rbac.ts` 统一封装——标准 RBAC model（`g` 角色绑定 + `keyMatch` 通配）+ FileAdapter 策略文件 `.runtime/console/rbac_policy.csv`（不存在时从 `ROLE_PERMISSIONS` 种子生成，删文件即重置）；人四档 `owner/admin/operator/viewer` 走 `g` 绑定（`user:<name>` → 角色），agent 三档 `agent-supervisor/agent-worker/agent-personal` 按档位直判；`ensureHumanBound()` 判定前按 `accounts.json` 现绑自愈（解决 bridge 与 console 两进程策略快照不一致）；`rbacEnforce()` 同步 fail-closed。两进程共用同一策略文件。
- **用户级配置**：`src/console-auth.ts` 的 `ConsoleUserSettings`（默认视图 / 主题 / 刷新间隔 / 通知三开关 / 模型三项）；`settings-get` / `settings-set` 仅本人（白名单键校验，API Key 打码 `apiKeySet`）；`admin-users-settings` 管理员总览（新权限 `users-settings-view`，owner + admin；账号管理 `accounts-manage` 仍 owner 专属）。存储 `.runtime/console/users/<name>/settings.json`（0600）。
- **前端重写（Vue 3.5.45 + Element Plus 2.14.8，均 MIT，本地 vendor）**：`console/index.html` + `console/app.js`（Vue 单文件应用：登录门 → 侧栏菜单 + 顶栏身份 → 概览 / 协作 / 知识 / 验收 / 服务 / 我的配置 + 管理）；协作视图恢复组织形态 / Agent 编制 / 怎么派活 / 沉淀与自演进 / 长程执行五张契约卡与 `DOMESTIC_TERMS` 品牌词清洗；管理视图按权限分区渲染（账号与角色 / 用户配置总览 / 角色策略 / 服务管理 / 知识审核 / 待答问题 / 审计日志 / 飞书授权）。离线可用（vendor 本地、CSP 加 `'unsafe-eval'` 供 Vue 运行时编译），主题走 `html.dark`。
- **P-13 知识分区 CRUD**：`knowledge-create / update / delete` 三支写通道（console 注入 `actorUser`、bridge 端 `canCreateKnowledge` / `canWriteKnowledge` 判定 + 审计 `knowledge.crud-*`）；`src/knowledge-authz.ts` 分区规则——personal 仅归属者本人（owner 也不行）、team 需 `knowledge-write-team`（人 operator+ / agent worker 档）、org 更新需 `knowledge-write-org`、删除需 `knowledge-delete-org`（人 admin+ / agent supervisor 档），agent 额外要求 `scopeCovers` 覆盖条目业务域；`propose` 强制 owner 为可信 actor（防伪造归属）；删除 = 软撤回（state → withdrawn），编辑已确认条目重置 candidate 等人重审。知识视图（前端）带分区列 / 分区显隐 / CRUD 对话框。
- **验证**：`npm test` **540/540**、`tsc`、`console:smoke` **49/49**（未登录 401 / 错口令 401 / viewer 越权 403 / 用户配置读写 / admin 总览 / casbin 策略查看 / 知识分区正负例（viewer 建 team 拒、建改删自己 personal 可、admin 改他人 personal 拒）/ 六视图渲染 / 主题切换 / 425px / 零海外文案）、`audit:upstream clean`（casbin + Vue + Element Plus 三项新登记 + vendor 版本横幅机器校验）。
- **测试契约换代**：console-shell / agent-registry / evolution / shape-assessment / step-execution 等 8 个文件的断言从旧手写 DOM（`card(...)`、`[data-view]`）换成 Vue 结构语义，红线语义不变（六视图、无网页发起、只读边界、中文产品词、职责中文名、空编制降级）。修掉 19 个回归失败，其中两处真实缺陷：`collaboration-intake.ts` 的 `execution` 配置缺省时 TypeError 吞掉回执通知（改防御式访问）；`.runtime/config.json` 执行形态被 P-11 实验切到 step（maxStepsPerRun=7200），按交付口径回滚 `loop`。
- **红线（全部不变）**：任务发起仍在飞书（静态页无原生表单、无 create-task）；验收核可仍在原会话（授权代办见第 12 节）；默认底座仍 `paperclip`；执行形态默认 `loop`；前端显隐只是体验优化，判定以后端 casbin 为准。

## 14. 第三十一轮 ③c/③d：记忆写入链四项改造 + OpenMausBot 五项（用户拍板「继续吧」）

- **③c（`08` 第 13 条 (a) 四项）**：
  - **证据锚点**：`KnowledgeService.propose/revise` 服务端自动追加一条 `fact-extracted` 记忆事件（idempotencyKey `${stage}:${taskId}:${key}` 防重，revise 用 contentHash 后缀）；调用方提供的 `evidenceEventIds` 逐条校验存在性，悬空即抛错拒绝写入；旧文档向后兼容（体检如实报缺口，不编造事件 id）。
  - **wiki 是投影不是第二事实源**：canonical 仍在 Paperclip 任务文档；`knowledgeToWikiPages` 同 domain 互链防悬空、`claimEventIds=evidenceEventIds`、withdrawn 不进地图；`.runtime/memory/wiki-pages.json` 可随时重建；只读 action `knowledge-wiki` 体检 + 落盘投影。
  - **注入索引与 Context Pack 分工**：`buildKnowledgeInjectedIndex` 只收 confirmed + 人签 + 证据 + 人审 `injected=true` 的条目标题（≤200 行 / 25KB 持久小指针层）；`collect()` 只带指针不带正文、不占 192KB Pack 预算（manifest 不加新 kind，不动快照校验契约）；**提升只发生在人审确认**（review 的 `inject` 选项，revise 恒重置 false）——无证据的旧记录即使人审确认 + inject 也不进索引（红线联动已验证）。
  - **Dreaming 接 C-6**：`src/dreaming.ts` 纯函数建议（不模型判 salience）→ `registerDreamProposals` 焊红线断言后按 `candidateId('dreaming', 0, reason+target)` 查重 → `EvolutionService.propose` 登记进既有工程闸门 / 人审 / 灰度链；端到端真跑首跑 24 条建议全部登记、复跑 0 登记 24 跳过（幂等）。
  - **配套**：`canReadKnowledge` 读分区（personal 仅归属者本人 + admin 档；console 代理虽是 bridge admin，actorUser 由可信端注入后按真实登录用户判定）；`listLenient()` 宽松列举（坏行跳过计数）；控制台知识审核改 reviewDialog（inject 复选框）+ 知识地图体检卡片 + 离线整理入口；`dreaming-run` 写审计 `dreaming.run` 留痕。
- **③d（`08` 第 12 条 (b) 五项，全部只借思想、零代码引入）**：
  - **⑦ Skill 能力包**：`src/skill-pack.ts`——SKILL.md frontmatter 键白名单、manifest（version x.y.z / triggerTerms / `defaultEnabled` 恒 `false`）、sha256 内容校验、开启绑定 `contentSha256`（内容变即失效需重开）。
  - **⑧ 对外动作不重跑**：steps 表新列 `outward_actions` + `markOutwardAction`（**发生时**登记，running 态生效、幂等去重、journal `STEP-OUTWARD`）+ `recoverStaleSteps` 分流 `interrupted` 终态（携带已发动作清单，是否补跑由人决定）/ `ready` 可重试；**本轮修复两处真实红线缺口**：显式 `failStep` 对已对外动作的步同样标 interrupted（原实现会自动重试导致校验失败后重复发信）、PG `recoverStaleSteps` 返回值漏带 status 字段。
  - **⑨ 委托树血缘 + generation**：steps 表新列 `parent_step_id`（跨 run 连通）+ `generation`（每次领取 +1，迟到旧 token 属旧代、完成校验天然拒绝）；`lineageOf` PG 用递归 CTE（深度封顶 32 防环）、内存链表上溯。
  - **⑩ 升级通道**：`src/escalation.ts` 纯函数闸——同 (taskId, topic) 窗口去重、1 小时 3 条限速、首个新问题必达、文案恒「不代为批准」；接 `runtime-bridge.gateNotification` 的 mustDeliver 分支（静音留 `v06.escalation-muted`、放行留 `v06.escalation-notified`）。
  - **⑪ 团队包**：`src/team-pack.ts`——权限 / 凭据 / 模型三类 17 键黑名单 + zod 键白名单 + 6 类密钥二次扫描（sk- / Bearer / ghp_ / 私钥块 / DSN 等）；`importTeamPack` 只产候选引用不提权、unknownAgents 如实标出。
- **验证**：`npm test` **557/557**（+11 ③c + 6 ③d）、`steps:smoke` **61/61**（B21/B21b/B22/B23/B24）、`host:pg` **24/24**（PG 真跑对外动作 / 血缘 / generation）、`console:smoke` **55/55**（+6 读分区 / 锚点 / wiki / 注入索引）、`guard:smoke` 22/22（golden 基线人审重冻结，humanReview 第 3 条）、`loop:smoke` 18/18、其余隔离冒烟与构建 / 走查 / 425px / `audit:upstream` 全绿。修三处陈旧断言（steps D3 / agents C-4 的 `card(` 前缀、loop B3 的 `requiresHumanApproval` 位置），均为 P-11/P-12/P-13 轮未跑对应冒烟的累积漂移。
- **红线（全部不变）**：③c 红线 (c) 全守（不模型判 salience、不自动提升 / 确认、不 TTL 物理删除、不让模型改写 wiki）；升级恒 advisory 不代批；团队包导入不提权；Skill 默认关且绑内容哈希；7 个上游不变；默认底座仍 `paperclip`、执行形态默认 `loop`；飞书仍是唯一发起入口。

## 15. 第三十二轮：切默认底座 local-pg + step；Cognee 本地链路验证（用户拍板「切（推荐）」）

- **用户拍板**：用户问「Cognee 端点、切默认底座是干啥？不能直接开始吗」，确认后拍板默认底座「切（推荐）」；Cognee 方向为「embedding 我没有，LLM 试试看或有没有本地的」。
- **代码改动**：
  - `src/config.ts`：`host.provider` 默认 `paperclip` → **`local-pg`**；`execution.mode` 默认 `loop` → **`step`**（`executionConfigSchema` zod default 与 `defaultExecutionConfig()` 同步）；superRefine 依赖校验不变（step 必须 local-pg）。回退路径：显式配 `provider='paperclip'` 或 `mode='loop'` 即恢复原形态，paperclip / local / loop 全部保持完整支持。
  - `.runtime/config.json`：`execution.mode` 切 `step`（`host.provider` 原本已是 local-pg）。
  - 口径换代：`step-runner` 回退提示（「当前显式配置为常驻循环（回退形态）」）、`EXECUTION_MODE_LABELS`（step 标「当前默认」、loop 标「回退形态」）、`executionView().missing`（「默认底座已切 local-pg（paperclip 显式配置可回退）」）、`mission-state` 能力标签、`pg-host` 注释。
  - 测试契约 5 处：routing-decision（默认 provider 断言）、step-execution（默认 mode + 只读视图 steppedReady=true + 新增 loop 显式回退负例 steppedReady=false）、step-delivery（steppedReady）、steps-smoke A1（默认 step 且 loop 可显式回退）。
- **step:once 端到端真跑（新默认的行为证据）**：
  - 无 `COLLAB_STEP_PRINCIPAL`：领取 host:pg 冒烟残留步后**「步间权限重评」按最小权限拒绝**（未声明主体），步标 failed——红线「步与步之间按当前身份重评权限」真实生效。
  - 带 `COLLAB_STEP_PRINCIPAL=smoke-admin`：权限重评通过、领取并执行 `c1-race-c` 步 1，`tool` 类步无登记执行器→**如实报「没有登记 tool 的执行器」失败，不编造执行**（modelCalls=0）。
  - 两跑均连真实 PG 专属库 `suitme_collab_c1`（`queue: 'local-pg'`）。
- **验证**：`npm test` **557/557**、`steps:smoke` **61/61**、`host:pg` **24/24**、`console:smoke` **55/55**、`guard:smoke` 22/22（golden 无漂移）、`loop:smoke` 18/18、router 31 / agents 43 / shapes 36 / evolution 45 / memory:hierarchy 16、走查 11/11、425px、两构建、`atlas:check` 11/11、`audit:upstream clean`、`git diff --check`。服务（bridge 4180 / console 4200 / vision 4190 / report 4192 / delivery 4194 + git 9418）全部重启加载新默认。
- **Cognee 结论（本轮调查）**：当前用法**完全本地、无需任何 API key**——`scripts/cognee-graph.py` 文件头明确「no LLM, embedding or extraction calls」，只借 Cognee 的 Ladybug（Kùzu）图存储 + 原生 BM25 排序；隔离真跑通过（`persistenceAcrossProcesses: true, conceptRecall: true, modelCalls: 0`），venv（`.runtime/cognee-venv`）已装好。**`cogneeNative` 配置段（LLM 实体抽取 + 向量 cognify）没有任何消费者**——调用代码未写，接通需要外部 LLM + Embedding API key 或本机装 ollama，属独立工程，留待拍板。
- **剩余（真实业务单验证）**：默认已切，但「真实业务单在 step 模式跑通」仍需用户在飞书发起一单真实任务观察全链（发起 → worker 单步泵 → 快照 checkpoint → 回执 / HITL → 验收）；回退开关随时可用（`config.json` 改回 `loop`）。

## 16. 第三十三轮：DeepSeek v4 flash 接入 Cognee 原生管线（用户给 key，embedding 本地）

**用户拍板**：用户说「可以用 deepseekv4 flash 模型，你把服务调起来，我给你 key，调好之后给我，看看系统还在哪里有问题？我想本地直接用起来」，随后提供 DeepSeek API key。

**本轮交付与证据**：

1. **配置层**（`src/config.ts`）：`knowledge.cogneeNative.embedding` 增 `provider: 'custom' | 'fastembed'`，**默认 `fastembed`**（用户无 embedding 凭据，拍板本地）；新增 `fastembedModel`（默认 `jinaai/jina-embeddings-v2-base-zh`，中英双语）与 `fastembedDimensions`（768）。显式配 `provider: 'custom'` 即恢复外部 OpenAI-compatible embedding 端点旧口径。
2. **接入层**（`src/cognee-native.ts`）：fastembed 模式不要求端点/凭据（missing 只查 LLM 两个变量）；`cogneeNativeEnv` 在 fastembed 模式只传 `EMBEDDING_PROVIDER=fastembed` + 模型 + 维度，**不传** `EMBEDDING_ENDPOINT` / `EMBEDDING_API_KEY`；status 隐私文案如实分流（LLM 外发 / embedding 本机不出本机）。
3. **关键坑位排除**：pinned Cognee fork 的 keyless 本地 embedding 判定是 `not llm_available`——**配上 LLM key 后不会自动走本地**，若不显式配 fastembed，会拿 LLM key 调 embedding 端点，而 DeepSeek 不提供 embedding API，cognify 必挂。本轮以显式 `EMBEDDING_PROVIDER=fastembed` 规避（fork 的 `get_embedding_engine` 原生分发到 `FastembedEmbeddingEngine`）。
4. **模型名核实**：`deepseek-chat` / `deepseek-reasoner` 旧名 2026-07-24 已停用；使用 `deepseek-v4-flash`，经 litellm `openai/` 前缀 + `api_base=https://api.deepseek.com` 路由（本地验证通过，litellm 1.105.0）。
5. **端到端真跑**（key 只进进程环境）：key 直连验证 → `cognify` 中文业务材料（星舟小程序改版：成员/时间线/风险/验收标准）返回 `ok:true, extractor:llm, embedding:native` → `search "支付模块有什么风险？谁负责前端？"` 准确召回「微信支付商户号尚未过审，可能阻塞支付模块联调」与「前端工程师陈默」。bridge 4180 带环境变量重启后 `system-status`：`modelApi:true`、`configured:true`、`llmModel:openai/deepseek-v4-flash`、`embeddingLocal:true`。
6. **本机就绪审计（用户问「系统还在哪里有问题」）**，如实列出：
   - **cognify 仍只有 CLI 入口**：产品知识入库链路（`knowledge-graph` action → `graph.run` → `cognee-graph.py`）仍是零模型 L1 投影（`modelCalls:0` 审计），**不会自动外发任何材料**；要用原生管线需手动 `node --import tsx scripts/cognee-native.ts cognify --text ...`。把 cognify 挂到入库钩子（哪一步、什么范围的材料自动外发）是产品/隐私选择，**待拍板**（`HANDOFF/08` 第 2 项）。
   - **key 持久化**：key 只在进程环境（设计红线：不落盘）。机器重启后 bridge 需带 `COGNEE_LLM_*` 三个环境变量重启（命令见 `HANDOFF/05` 第 11 节）；CLI 每次调用同样带 env。
   - **search 结果格式**：`cognee.search` 返回 Python dict 字符串（`str(item)`），无 UI 消费，目前只能 CLI 用。
   - **真实费用**：v4-flash 定价 $0.14/M 输入 · $0.28/M 输出；每次 cognify（抽取）与 search（汇总）都产生真实调用。
   - npm 参数坑：`npm run cognee:native cognify --text ...` 会被 npm 吞掉 `--text`，须直接 `node --import tsx scripts/cognee-native.ts ...`。

**不变的边界**：产品知识图谱链路零模型调用红线不变（`cognee-graph.py` L1 投影 `modelCalls:0`）；设备端语义加权是独立链路不被替代；key 不写任何文件；7 个上游不变；飞书仍是唯一任务发起入口。

## 17. 第三十四轮：四缺口修复 + 产品断点审计 + console UI 修复（用户「本地直接用起来」收口）

**用户拍板**：修复第三十三轮审计的缺口 1（cognify 只有 CLI）/ 2（key 不持久）/ 3（search 无 UI）/ 5（npm 吞参数），费用不担心；随后要求「完整看看从功能上产品还有哪里是有断点不完整的，修复处理好……优化好之后启动服务给我看下，我还没有看到过一次」。

**本轮交付与证据**：

1. **cognify 自动接入产品链路**（缺口 1）：`knowledge.cogneeNative.autoCognify`（默认开，`.runtime/config.json` 显式可关）+ `dataset: 'suitme-knowledge'` 共享数据集。`KnowledgeGraph.run(project=true)` L1 零模型投影成功后 `triggerAutoCognify` 发后即忘：正文（标题+正文）外发 DeepSeek 抽取 + 本机 fastembed 向量化；成功写 `knowledge.native-cognified`、失败写 `knowledge.native-cognify-failed`（均含 external:true），失败不阻塞不回滚投影。cognify 进程内串行排队（lancedb 不并发写）+ 默认 10 分钟超时。真跑：重投影既有来源 → `nativeCognify:{triggered:true}`、L1 `modelCalls:0` 不变、审计落账、数据集可检索。
2. **key 持久化**（缺口 2）：`.runtime/cognee-env.json`（gitignored、0600，键=环境变量名）。`loadPersistedCogneeEnvIntoProcess` 只在 server / CLI 启动时调用（进程环境优先不覆盖）；resolve 本身不读文件——测试与隔离冒烟不经启动装载路径，不会读到真实凭据触发真实调用。CLI 新增 `persist` / `forget` / `load-env`。机器重启后 bridge / console 自动就绪（实测：无 env 重启 → configured:true）。
3. **search 接进 UI**（缺口 3）：Python 侧 `to_jsonable` 结构化结果；bridge 新 action `cognee-search`（admin-only、只读通道、180 秒）；console-server 单独放行并收口 owner/admin（数据集跨来源无法按分区收口）；console 知识页顶部「语义检索」卡片 + 插件 settings「知识检索」页。console → bridge → DeepSeek 端到端真跑通过。
4. **CLI 参数**（缺口 5）：位置参数兜底——`npm run cognee:native cognify "正文"` / `search "问题"` 不需要 `--`；`--text` / `--query` 旗标仍可用（`--` 透传文档化）。
5. **断点审计修复**（用户第二轮指令）：
   - **ServicesView 字段错配**：旧代码读不存在的 `row.running` → 服务页所有服务永远「已停止」、说明列空白（界面撒谎 bug）。修复为按真实 `state` 渲染（已接通/已降级/未接通 + 实时探测说明 + 入口链接）。修复后实测本机 6 服务 connected。
   - **vision /health 契约缺口**：返回 `status:'ok'` 而探测判定 `isOk` 要求 `ok===true` → 视觉评审端点永远「端点未启动」。补 `ok:true` 后 vision 转绿。
   - console 全六视图 + 管理 API 逐一实测（view-summary / service-status / knowledge-list / system-status / v06-org-overview / memory-status / routing-status）全部真实数据；5 个 unavailable 均为未配置的可选外部服务（企业微信/腾讯文档/钉钉/Gitee/公有云 CI），属预期。
   - 新增 `scripts/owner-screenshots.mjs`（headless Chrome + CDP，owner 身份对运行中 console 截图；凭据运行时从 .runtime 读，不进仓库）。
6. **golden 基线两次合法重冻结**：`view-服务.textLength` 2458→2624（cogneeNative 状态扩充）→2920（服务页断点修复后说明列出现文字），其余 160 项不变；人审记录按纪律写入 `fixtures/behavior-golden.json`。

**给用户的入口（用户首次看到产品）**：
- 协作台 console：`http://127.0.0.1:4200/`（账号 `gongzhe`，口令在 `.runtime/console/owner-password.txt`，登录后建议在「管理 → 账号」改口令）
- 知识工作台（宿主）：`http://127.0.0.1:3100/`
- 验收报告：`http://127.0.0.1:4192/overview`；代码交付台：`http://127.0.0.1:4194/`
- 语义检索：console「知识」页顶部（owner/admin），数据集默认 suitme-knowledge；材料进入方式：知识工作台对来源「生成图谱」（自动 cognify）或 CLI `npm run cognee:native cognify "正文"`。

**不变的边界**：L1 投影零模型红线不动（自动 cognify 是投影成功后的独立并行步）；key 不进仓库/config/secrets（只在 .runtime/cognee-env.json 与进程环境）；网页不发起任务（发起仍在飞书）；7 个上游不变。

## 18. 第四十一轮：五项对标差距 + 1 个 partial 全部收口（用户「先收口差距，做好了再说」）

**用户指令逐字**：「先收口差距，做好了再说」——即一次性把第四十轮 `docs/ROUND-40.md` §8 与 `docs/BENCHMARK-3UPSTREAM.md` §5 列出的差距全部做完，中间不汇报不请求确认，做完统一交代。

**收口的六件事与落点**：

1. **准入三档**（对标 DeepSeek Super-agent 的准入强度）：新增 `src/admission.ts` 纯函数 —— `explicit`（配对成立 / 单负责人白名单唯一人）→ 建单；`inferred`（配对失效 / 多人白名单未配对）→ 只回配对指引 + 写 `admission.inferred` 审计，**不建单不续跑**；`not-admitted` → 拒收，只留审计不回话。`collaboration-intake.ts` 入口先判准入。**结构保证不靠自觉**：`memberContext` 只有 explicit 才 true，推断档恒 false，且返回结构里没有任何权限字段。
2. **订阅 hand-back / release**（对标 Super-agent Subscriptions）：新增 `src/subscription.ts` 三态 + 越界意图识别；`pass-through.ts` 判定从 6 种扩到 8 种（加 `released` / `hand-back`），判定顺序：显式指令 → 绑定 → 释放/已验收 → 多条 → 归属 → 越界 → 接续。**释放落成独立审计事实** `subscription.released`（`controller.ts` 两处验收落库各记一条），不靠 phase 顺推，事后能查到释放时间。越界识别只认四类「改授权面」说法，**宁可漏不可误**（漏判只是沿用原链路，误判会打断正常追问）。
3. **报告内讨论 + 区域点选**（对标 lobehub/acceptance）：新增 `src/acceptance-discussion.ts`（追加式、正文上限 1000 字、无改写接口、只有 `resolvedAt/resolvedBy` 状态位）+ 控制台验收视图讨论卡片；证据区域改成可点按钮 + 按本项坐标等比缩放的底板。**两者都不参与判定**：体检 `acceptance.discussion-is-advisory` / `acceptance.regions-are-locators` 用 JSON 比对钉住「加讨论前后 readiness / summary / items 完全一致」。
4. **配置收敛为一份规则视图**（对标 Agent Autoloop）：新增 `src/rules-view.ts` 只读组合 + `npm run rules:view`（含 `--json`）。七节全字段带 `source` 路径与 `origin`（`explicit` / `default`），默认值单列。**不新造第二套口径**：并发配额直接调 `routineParallel()`、分组直接调 `routineGroup()`。
5. **一条命令安装**（对标 Autoloop）：新增 `src/bootstrap.ts` + `npm run bootstrap`。幂等计划、失败即停、`--dry-run` 不执行；Node 版本低于 `engines` 声明**默认只警告**（本机 v22.22.2 实测 681 例全过），`--strict-node` 才拦 —— **没有偷偷改 engines 粉饰**，警告文案如实写明「本机实测该版本能跑通」。
6. **知识读按业务域收窄**（第四十轮唯一 partial）：`canReadKnowledge` 加第 4 参 `readerDomains`；team 区读方域与条目域相交才可读，读方域**未知按档位兜底**（viewer 被拒）而不退回全域放行，未声明域的历史条目保持登录可读。读方域从既有事实源取（agent registry 的 `domains` / 成员个人 Agent 所在空间），不新造「可读域」配置。wiki 视图一旦按权限过滤就**不写共享投影**并追加说明，避免把个人视角变成组织索引。

**体检扩容**：`src/layers-audit.ts` 从 40 → **42 条纯判定**（CLI 追加 3 条运行时 = **45**）。新增 5 条：`pass-through.release-is-terminal`、`pass-through.out-of-scope-hands-back`、`agent.admission-three-tiers`、`acceptance.discussion-is-advisory`、`acceptance.regions-are-locators`；`knowledge.read-not-domain-scoped`(partial) 换成 `knowledge.read-scoped-by-domain`(ok) 并断言 7 个分支。

**验证**：`npm test` **681/681**（+34 例新契约）、`tsc` 0 错、`audit:layers` **45 条 ok 45 / partial 0 / gap 0**、`npm run rules:view` 七节正常、`npm run bootstrap -- --dry-run` 输出计划 + Node 警告 + 人工步骤、`console:smoke` / `guard:smoke` / `steps:smoke` / `agents:smoke` / `router:smoke` / `shapes:smoke` / `loop:smoke` / `evolution:smoke` / `host:pg` / `memory:hierarchy` / `audit:upstream` 全绿。

**七条如实边界**：① 准入推断档只给配对指引，真人配对仍需扫码，系统不代配；② 越界识别刻意收紧，宁可漏判沿用原链路；③ 讨论与区域只做记录与定位，不参与通过/不通过、不改写正文、不进 summary；④ 规则视图是纯只读组合，`origin=default` 表示「当前生效值来自默认而非显式配置」，**不代表推荐值**；⑤ bootstrap 的 Node 警告是既存事实（engines 声明比实测环境严），未为了报告好看去改声明；⑥ 知识读兜底会让「域未知的 viewer」被拒，这是刻意保守，不是漏判；⑦ 真实业务单仍未在本轮改动后重跑（飞书发起属用户动作），本轮证据全部来自隔离真跑与契约测试。
