# 06 · 当前状态与下一步（接手者最该看的一份）

## 1. 状态快照（第十六轮 C-1）

| 阶段 | 状态 | 交付 |
|---|---|---|
| **A 收敛整合** | ✅ 完成 | `architecture-contracts.ts` 统一常量、`RoutingDecision` 五维契约、5 派活点同一份 Trace、FR 覆盖三态口径、平台端口抽象 |
| **B1 记忆主干** | ✅ 完成并验证 | `memory-log.ts` + `memory-projections.ts`、8 处双写、Context Pack 运行时 lineage 过滤、三条红线真跑证据 |
| **B2 读取链切换** | ✅ **完成并验证** | 见第 2 节：投影召回融合、按主体精确撤权、真实一单端到端撤权、增量 checkpoint |
| **C 三层 Router + 底座切换** | 🟢 **进行中**（第十五轮拍板 ②；C-0 / C-0b / **C-1 已完成**，C-2 为下一步） | 见第 3 节分步清单 |

系统能跑、全套回归全绿（**335/335 单测**、11/11 真实浏览器走查、上游 clean、`host:pg` 21/21）。`HEAD = origin/main = 远端 main`。C-1 起每次代码改动都重跑全套；本机 PG 17.10 专属库 `suitme_collab_c1` 已可真跑。

## 2. B2 已完成（四项，均带真跑证据）

| # | 交付 | 验收证据 |
|---|---|---|
| 1 | `src/memory-recall.ts`：投影召回作为**第三路**信号接入 `TeamMemory.search` 融合排序；只在 `reusable()` / `allowed()` / hash 重评**之后**按 `sourceId@revision` 白名单裁剪，读日志失败按 advisory 降级 | `tests/memory-recall.test.ts`；全套 335/335、走查 11/11、既有权限/版本重评测试不回退；`modelCalls=0` |
| 2 | `grant-revoked` 不再进全局 `revokedSourceIds`，改记 `principalRevocations`；`recallMemory` 按当前 principal 精确排除，未指定主体时 fail-closed；`source-revoked` 仍全局阻断 | 新增「A 撤权不影响 B 的同源记忆」用例，`tests/memory-replay.test.ts` 全绿 |
| 3 | `npm run memory:journey`：真实 bridge action 跑 `create-source → review confirmed → memory-index → edges-save → l2-extract → context-pack → review withdrawn`；只新建一条专用资料并在末尾撤回，既有资料不动 | `ok:true`；四类投影 before `1/2/1/1` → after `0/0/0/0`，召回 1→0，lineage 失效 4 事件；证据 `.runtime/memory-journey.json`（不入库） |
| 4 | `src/memory-checkpoint.ts` + `npm run memory:checkpoint`：checkpoint + 增量应用；撤权/乱序/失效祖先等会回溯的情况回退全量，且增量结果始终与全量 checksum 逐字节对照 | 真实日志 `mode:incremental, applied:1, checksumEqual:true`；`tests/memory-checkpoint.test.ts` 6/6（含分批追加、重复行、跨批撤权） |

> B 阶段（B1 + B2）已验收通过。第十五轮用户已按 `08-OPEN-DECISIONS.md` 第 1 条拍板 **② 独立前端应用**，产品形态冲突解除，**C 正式启动**（严格分步，不并行）。三层判断当前仍是 `recommended=false`（覆盖率 5/7），**不把三层当默认答案**。

## 3. C 分步清单（第十六轮 C-1 完成，严格不并行）

| 步骤 | 内容 | 状态 |
|---|---|---|
| C-0 | ② 决策固化与产品思路复盘（两篇材料分工、三层 = 同一现场的三种座位） | ✅ 完成，见 `docs/ADAPTATION-v0.6.md` `0.0000000000000000` 节 |
| C-0b | 用户追加的两条产品约束固化：**组织形态可配置** + **沉淀与自演进**（`PRD §10C` 的 C-P1~C-P5） | ✅ 完成，仅文档与清单，见同一节第 6 小节 |
| C-1 | **本机 PG 真跑 + 长程执行地基**：`PgHostPlatform`（事务 / ACL / 成本账本 / heartbeat `checkout-retry-runToken` / `SKIP LOCKED` 步进队列与崩溃恢复）、`config.host.provider=local-pg`、R7 协议登记、C-P6 产品约束 | ✅ **完成并真跑**：`npm run host:pg` **21/21 `ok:true`**，见下方「C-1 交付与证据」 |
| C-2 | 独立应用外壳：自己的导航与视图承载，保留 5 tab 职能，移除 Plugin SDK 编译期依赖 | 下一步 |
| C-3 | 五个派活点收敛为单一 `Router`；**读配置决定下一跳**（扁平 1 跳 / 分层 2 跳），不写死三段；保留 legacy 一行回退 | 排队 |
| C-4 | 可配置角色体系：**Agent 实例 + 职责绑定 + 生效范围 + 版本**，职责含 personal / 主管 / 执行 / **验收** / 标准起草 / 周期巡检；A2A handoff；验收 Agent 与产品 / 技术 / 运营 Agent 协作；禁止同一 Task 自派自验自环 | 排队 |
| C-5 | 按配置重跑 `assessThreeTier()`（P3 / P4 改为按当前配置判定）+ **扁平 / 分层两种配置各跑真实一单**，Trace 每步可回放 | 排队 |
| C-6 | 沉淀回流与自演进闭环：自查标准回流到交付前强制比对、候选改进 → 工程闸门（回放验证）+ 人审 → 版本 / 灰度 / 可回滚 → 效果对比（通过率、返工率、单任务成本、人被打断次数） | 排队 |
| 收尾 | 全量回归、文档同步、提交推送 | 排队 |

### C-1 交付与证据（第十六轮，用户改口「本机可以引入 pgsql 数据库去测试」）

- **撤回上一轮判断**：原写「本机试点不引入 PostgreSQL，用原子写 + 文件锁等价」——**作废**。本机 PG 17.10 已在 `127.0.0.1:5432` 运行（`psql` 在 `/opt/homebrew/opt/postgresql@17/bin/`），新建**专属库 `suitme_collab_c1`**，未触碰已有 `geo_flow`。
- **代码**：`src/pg-host.ts::PgHostPlatform` 实现同一 `HostPlatformPort`；`config.ts` 增加 `local-pg` 与 `pgDsnEnv`（DSN 只从 `COLLAB_PG_DSN` 环境变量读，`assertLocalPgDsn()` 拒绝非回环）；`platform-port.ts::resolvePlatform` 已接线；`scripts/host-pg-smoke.ts` + `npm run host:pg` 真跑；`tests/pg-host.test.ts` 6 例契约；`audit-upstream.ts` 纳入 R7 机器化检查。
- **产品约束 C-P6**（`PRD §10C`）：循环 / 会话状态 / 执行环境三者分离；每步一次独立调用、下一棒由队列原子激活、同一 run 只有一个 ready 步、领取带 `runToken`、崩溃可回收且旧凭据失效。**Agent 感知不到执行环境差异 ≠ 权限可跨环境放大**，步间仍按当前身份重评。
- **真跑 21/21**：事务内文档修订原子递增、ACL 未知主体被拒、cost-ledger 写读一致、heartbeat 重复领取被拒 / token 轮换、步进链 `ready→queued→done`、并发领取拿到不同 step、重复 `completeStep` 被拒、崩溃回收与旧 token 作废、错误 token 不留半写状态、`capabilities()` 如实列 9 项已实现与 3 项仍缺。报告 `.runtime/host-pg-smoke.json`（不入库）。
- **三个取舍如实**：本机不引 Redis（PG `SKIP LOCKED` 等价，切换点为 `claimStep / completeStep / recoverStaleSteps`）；不部署远端工具沙箱 / 多机 Remote Tool Calling；默认底座仍 `paperclip`、`runner.ts` 常驻 `while` 循环尚未切成单步。三项写在 `capabilities().missing`，不假装完成。
- **R7 协议材料**：`pg@8.23.1` + `@types/pg@8.23.1` 精确版本与 lockfile integrity、`licenses/pg-MIT.txt`、`THIRD_PARTY_NOTICES.md`、`docs/SOURCES.md`、`docs/OPEN-SOURCE-COMPLIANCE.md` G8、`audit-upstream.ts`；`audit:upstream clean:true`。

**关键产品原则（复盘结论）**：三层会多一跳转发；若靠「总结成一段话往下传」，上下文折损会按乘法加倍重现。所以三层必须架在 B1/B2 已建好的**共享现场**上——三者换的是**可见范围与责任主体**，读的是同一份 append-only 主干 → 四类投影 → 按 Task 裁剪的 Context Pack，交接靠 A2A 带 `sourceIds / scope / causedBy`。**B 就是让三层不丢上下文的地基。**

**组织形态可配置（用户追加，修正上面「三层」的固定骨架口径）**：上百人团队可在产研 / 增长运营 / 销售 / 财务等业务域各设一个中间决策层 Agent；10 人团队可能一个都不设。**同一个 Agent 既能做管理、也能做某人的 Personal Agent**，由配置决定；团队长大时是「加配置」而非「换系统」。用户已确认：配置按业务域 / 组织单元生效（项目只引用不覆写）、允许兼任，但同一 Task 不得自派自验自环；变更留快照不回溯。这把 `src/roles.ts` 的「**划分是配置，责任是事实**」从主职能推广到 Agent 组织；`AGENT_ROLES` 三个名字降级为**能力类型**。

**判断分层与自演进（用户追加）**：确定性工程层（规则过滤、权限重评、注意力预算、周期巡检、清单校验，`modelCalls=0`）→ 按需 AI 层（记证据与成本，能本机不外部）→ 人层（目标、边界、高风险联签、最终核可）；必达消息不受过滤影响。**沉淀不是为了记更多，是为了下次少花一次判断**。Agent 可以提出改进，**不能自己让改进生效**：不得自动改写已锁定清单、权限规则、人签红线或历史任务；候选改进须过工程闸门 + 人审 + 版本 + 灰度 + 可回滚。L1 → L5 是分级渐进，`recommended=false` 是防跳级闸门。

**三层判断当前结论（真实数据）**：`recommended=false`，覆盖率 5/7。未满足 P1（五阶段决策覆盖）、P3（Personal Agent 实体）、P4（主管 Agent 实体）、P6（单一 Router）。反面依据：玉伯 OPT 访谈说人是「监工」、同时管 5 个 Agent 已达带宽上限、「暂无法实现 Agent 自主管理 Agent」；LobeHub Community License 禁止复制代码。**C-5 之前不要把三层当默认答案，也不要放开主管自主派活；评估口径改为按当前配置判定后，扁平配置下不得要求出现 supervisor，否则会逼小团队硬造管理层。**

## 4. 去 Paperclip 化路线（② 已拍板；C-1 完成，C-2 待做）

- 已完成：能力收拢到 `HostPlatformPort`；默认 `PaperclipPlatform` 薄包装；`LocalHostPlatform` 不依赖 Paperclip 且 `host:smoke` 真跑通过；**C-1 新增 `PgHostPlatform` 且 `host:pg` 真跑 21/21**；`config.host.provider` 默认仍是 `paperclip`（切换前保持可回退）。
- **产品形态冲突已解决**：第十五轮用户拍板 ②，`PRD §10A` 的 S5/S6 已废弃，S1–S4 保留；飞书仍是唯一发起入口。见 `08-OPEN-DECISIONS.md` 第 1 条。
- **5 项缺口按 ② 重新定义后的真实状态**：ACL / 成员身份、cost-ledger、heartbeat `checkout/retry/runToken`、事务与并发 —— **C-1 已在 `local-pg` 后端真实实现并有真跑证据**；UI 承载不再算 Plugin SDK 缺口，改为 **C-2 独立应用外壳**提供。文件后端 `local` 仍保留单进程缺口清单，不冒充已完成；`local-pg` 仍如实列出「独立应用 UI / 远端工具沙箱 / Redis 横向扩展」三项生产缺口。
- 候选（可复用代码，本轮未引入）：Pi（`earendil-works/pi`，MIT core）、CoPaw（Apache-2.0）、Octop（MIT，最接近 Paperclip 的任务+ACL+IM+插件）、DeerFlow（MIT）。只借思想：LobeHub（Community License）、n8n（Sustainable Use License）。

## 5. 其它已知未完成（不是 bug，不要「顺手补」）

- 真人在真实业务单「确认验收」（**SUI-129 未核可**）——只能由用户在原会话做。
- 飞书部门 scope 授权命令已生成，但重新登录确认只能本人操作。
- Cognee 原生 `cognify` 真实外部模型调用未发生（缺端点与凭据，本轮未外发任何业务材料）。
- 企业微信 / 腾讯文档 / 钉钉 / 国内代码托管 / 公有云 CI / 海外 SaaS 未接通，按约定**没有入口**；将来要加入口必须先配置并实测接通。
- 生产发布、业务仓库发布、真实外部 PR/CI、全员 SSO 均未发生。
- **C 新增待办（已排期，不要提前并行做）**：验收目前仍是「服务 + 报告」而非可配置协作 Agent；自查标准只展示未回流到交付前强制比对；候选改进的评估 / 人审 / 版本 / 灰度 / 回滚未落地；单任务成本与效果看板未落地；`assessThreeTier()` 仍按固定三层判定。分别归 C-4 / C-5 / C-6。
