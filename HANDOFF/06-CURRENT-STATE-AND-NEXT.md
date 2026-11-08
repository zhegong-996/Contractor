# 06 · 当前状态与下一步（接手者最该看的一份）

## 1. 状态快照（第二十七轮 P-9）

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

系统能跑、全套回归全绿（**521/521 单测**、**`memory:hierarchy` 16/16**、**`guard:smoke` 22/22**、11/11 真实浏览器走查、**`console:smoke` 全绿、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 54/54**、上游 clean、`host:pg` 21/21）。`HEAD = origin/main = 远端 main`。C-1 起每次代码改动都重跑全套；本机 PG 17.10 专属库 `suitme_collab_c1` 已可真跑。

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
- **真跑**：`npm test` **521/521**、`npm run loop:smoke` **16/16**、`npm run guard:smoke` **22/22**、`memory:hierarchy` 16/16、`steps:smoke` 54/54、`tsc`、两个构建、425px、走查 11/11、`console:smoke failed: []`、各隔离冒烟、`audit:upstream clean:true`、`git diff --check`。
- **如实边界**：P-9 只接通双向留痕与回流建议，真实业务单尚未在该链跑过（`loop-guard` 如实报 `bidirectional:false`、耦合点计数 0），流转自动化不等于决策自动化；只读体检不是写入链改造；第 13 条四项与第 12 条 (b) 五项仍待拍板；默认 `loop` + `paperclip` 未变、无外部模型调用、未引入第 8 个上游或 npm 依赖、人签红线未放宽；SUI-129 仍未核可。

## 11. 第二十七轮 P-9：双向协作回路（用户质疑后的方向纠正）

- **用户质疑**：「必须要有两条相反方向的移动……不能是单向的」「之前是不是做错了？我让你参考那几个开源项目，不知道你参考成了什么样子？」；追加「从具体代码执行落地的过程来看，可以复用那些开源项目中的部分，把它们耦合进来」。
- **核实**：主链路（飞书 IM / `controller.reply()`）本来双向且会自动唤醒下一轮；断的是 P-6 单步 HITL 台账「答完就消失」。四轮参考产出全部在治理 / 评估 / 只读体检侧，零项在双向执行回路——这是真实偏差，已写入 `docs/REFERENCE-capability-comparison.md` 第 6 节复盘。
- **交付**：`src/collaboration-loop.ts`（下行 8 类 / 上行 6 类、`loopReport()` 回路判据、`attachImplicitReplies()` 就近配对、`bridgeAnswerToResume()` 回流建议、`fromAutoloopReceipt()` 与 `fromHitlLedger()` 上游归一化）；只读 action `loop-guard`（三处白名单同步）；`scripts/step-answer.ts` 产出并持久化回流建议到独立 append-only 台账；`tests/collaboration-loop.test.ts` 16 例、`tests/p9-contracts.test.ts` 6 例常态契约、`scripts/loop-smoke.ts` + `npm run loop:smoke` 16/16。
- **真实耦合**：`src/upstream.ts` 运行时直接加载未修改的 Super Agent / Autoloop / DeepSeek Harness 源码，`controller.receipt()` 的 `resultFrom()` 就是上游函数；本轮把它的输出接成上行回路事件，并在 `controller.reply()` / `collaboration-intake.ingest()` 登记下行应答。7 个上游不变、未新增 submodule / npm 依赖。
- **红线**：回执 ≠ 验收、回答 ≠ 放行、续跑建议恒 `autoExecute:false / requiresHumanApproval:true / notAcceptance:true`；`assertLoopAdvisory()` 焊死只读。自动排后续步骤、飞书回答直写 HITL 台账、`step` 默认切换仍待拍板。
