# 开源复用与协议合规说明（v0.6）

> 日期：2026-11-06　适用范围：本仓库 `suitme-collab`（`package.json` 标 `private: true`）。
> 本文件是**工程合规清单**，不是法律意见。它把「已引入源码」「仅设计参考」「权属/协议未核实」三类严格分开，避免把参照过的项目误当成可自由复用的代码。
> 依据：`THIRD_PARTY_NOTICES.md`、`sources.lock.json`、`.gitmodules`、`licenses/`、`docs/SOURCES.md`、`docs/PRD-v0.6.md` 第 10 节，以及 2026-11-06 对各项目官方仓库/文档的核读。

## 0. 先说结论

1. **已引入源码的 9 个上游，全部是 MIT 或 Apache-2.0，没有 GPL / AGPL / SSPL 等传染性协议**（逐个核对 7 个 submodule 的 LICENSE 与各 `licenses/` 原文）。这是当前可以安全做私有集成的前提。
2. **但"可以复用"不等于"协议相同"**：MIT 只要求保留版权与许可声明；Apache-2.0 还要求保留 NOTICE、标注修改，并带专利授权与专利报复条款。
3. **最需要注意的一处**：`lobehub/lobehub` 主仓库**不是标准 Apache-2.0**，而是 **LobeHub Community License（Apache-2.0 + 附加条件）**，GitHub 标为 `Other`、非 OSI 开源；而其组织下的 `lobehub/acceptance` 是**独立的 Apache-2.0 仓库**。两者必须分开判断，不能因为同属 LobeHub 就按同一协议处理。
4. 当前仓库为私有、不对外分发；**一旦产品化交付或对外发布，第 2 节 B 类项目必须重新评估**，其中 Outline (BSL 1.1) 与 LobeHub 主仓库的衍生分发限制会立刻生效。

---

## 1. A 类 · 已引入源码（宽松许可，可闭源集成）

| 项目 | 协议 | 固定版本 | 引入方式 | 实际复用 | 声明状态 |
|---|---|---|---|---|---|
| Paperclip | MIT | `0eaabe5c…` | submodule | server/ui/db、任务文档、签出、ACL、修订、审计、成员/邀请 | ✅ `THIRD_PARTY_NOTICES.md` 全文 |
| Paperclip LLM Wiki + Plugin SDK | MIT（同提交） | 同上 | 上游子目录 | 原版 Wiki UI/worker、插件导航、私有项目与审批 API | ✅ 随 Paperclip 声明 |
| DSH Super-agent (`dsh-superagent-prototype`) | MIT | `8c32a9dc…` | submodule | `feishu-trigger.ts`、`feishu-channel.ts`、`settingsPolicy` / `assessmentOutcome` | ✅ 全文 |
| Agent Autoloop | MIT | `ba8cf6d8…` | submodule | `createWorker`、Codex/Claude/command/ACP 适配器、回执与会话接续 | ✅ 全文 |
| DeepSeek Harness | MIT | `fcc0ad46…` | submodule | output-retention、session-reference、Cordis/scope/ToolsService/tool-executor-native/persona | ✅ 全文 + `licenses/harness-vendor-MIT.txt`（含 vendored deps 声明）；`sources.lock.json` 已登记 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`，`audit:upstream` 已核验 |
| Prime Agent | MIT | `74591cdd…` | submodule + **代码移植** | `harness.py` query runs/terms、`harness_digest.rs` 权重 → `src/vendor/prime-query.ts` | ✅ 全文（含 Mario Zechner 原始 MIT 声明）；`sources.lock.json` 已登记 `74591cddef28d11249c3171112114fc4755375d7`，`audit:upstream` 已核验；移植文件须保留版权头 |
| Cognee 1.6.6 | **Apache-2.0** | `525b1d11…` | submodule | LadybugAdapter、DataPoint/provenance、GraphVisualization、GraphSchema、BM25ChunksRetriever | ✅ `upstream/cognee/LICENSE` + `licenses/cognee-APACHE-2.0.txt` |
| `@a2a-js/sdk` 1.3.0 | **Apache-2.0** | npm，gitHead `29417a5b…` | npm 依赖 | `DefaultRequestHandler`、`TaskStore`、`delegate_service` 原生委派 | ✅ `licenses/a2a-js-APACHE-2.0.txt` + lockfile 完整性 |
| `lobehub/acceptance` | **Apache-2.0** | `f720feb…`（v0.10.0） | submodule | **验收计划 / 报告格式的契约与文件布局**；`src/acceptance-interop.ts`、`scripts/export-acceptance.ts` 做映射；不启动其 CLI / 云端报告服务 | ✅ `licenses/acceptance-APACHE-2.0.txt` + `THIRD_PARTY_NOTICES.md` 专节 + lock 条目 |

**MIT 与 Apache-2.0 的差异（落地时必须体现）**

- MIT：保留版权声明与许可全文即可；允许修改、闭源、再分发。
- Apache-2.0：除 LICENSE 外须保留 **NOTICE**（如有）、**对被修改文件作显著标注**、保留专利授权；触发专利诉讼会导致授权终止。Cognee 与 A2A SDK 属此类。
- 二者都**不要求**公开本仓库源码，但都要求分发时随附相应声明。
- 本仓库的做法是「固定 submodule commit + 不改上游源码 + 适配层单独写」，既满足标注要求，也便于升级时重新核对。

## 2. B 类 · 仅设计参考（未引入代码，协议各不相同）

| 项目 | 协议 | 参考了什么 | 为什么不能当代码复用 |
|---|---|---|---|
| **LobeHub `lobehub/lobehub`** | **Community License = Apache-2.0 + 附加条件**（GitHub 标 `Other`，非 OSI 开源） | Workspace+Task、Manager/Worker 三层汇报、L1–L5 自主度、两级事件过滤、运行时三层分离、Agent Vent、harness 自优化 | **见第 3 节**：允许"不修改源码地商用"，但**开发并分发衍生作品须取得商业授权**；贡献者还同意作者可调整协议。故只借产品思想，不复制、不 fork、不打包其源码 |
| **Graphiti (getzep)** | Apache-2.0 | Episode、**边的 `valid_at` / `invalid_at` 双时间有效性**、supersession 语义 | 协议允许，但需 Neo4j/FalkorDB 与 LLM 服务，本版只借时间边模型，不部署整套；Cognee 有 `GraphitiSource` 可留作未来迁移 |
| **OpenHands Software Agent SDK** | MIT | 执行服务与协作控制平面的边界 | 协议允许，但会引入第二套执行服务与 Python 运行时，本版不引入 |
| **Outline** | **BSL 1.1**（source-available，非 OSI 开源，有生产使用限制与转换期） | collection/group、文档权限模型 | **明确禁止引入代码**；仅作权限设计参照（PRD R7、ADAPTATION 已标注） |
| **Onyx / OpenFGA** | **本仓库未核实**（仅核读官方资料） | ReBAC、文档权限 | 未引入任何代码；**引入前必须先核实协议与商业条款**，不得凭印象按 Apache-2.0 处理 |
| **LightRAG** / **KAG (OpenSPG)** | MIT / Apache-2.0（PRD 记载） | GraphRAG 编辑与合并、概念/Schema/词典 | 仅参考，不叠加第二套索引与运行服务 |

> 名称备注：Codex 会话中提到的「戴拿」未找到对应仓库；实际承担「多人服务 Agent 网络 + 团队知识记忆」的是 `@a2a-js/sdk` 与 Cognee BM25/Ladybug，二者协议均已声明。

## 3. 重点风险：LobeHub Community License 的附加条件

其 LICENSE 以 Apache-2.0 为基础，但自 1.0 起附加：

1. **允许**：把 LobeChat/LobeHub 作为前端与后端服务用于商业用途，**前提是不修改源码**。
2. **需要商业授权**：若"基于 LobeChat 开发并分发衍生作品（develop and distribute a derivative work）"，必须向作者取得商业许可（联系 `hello@lobehub.com`）。
3. **贡献者条款**：贡献者同意作者可调整开源协议、并将其贡献用于商业用途（含云端版）。
4. **分类**：GitHub 报 `Other`；社区普遍归类为 *source available*，不是 OSI 定义的开源。

**对本项目的直接约束**

- ✅ 可以：阅读其架构、借鉴「岗位 Agent / 三层汇报 / 注意力预算 / 组织体温闭环」这些**思想与方法**，在自研模块里重新实现。
- ❌ 不可以：复制其源码、fork 后改品牌打包、把其组件随本产品一起分发。
- ⚠️ 特别注意：本产品也是「AI 协作平台」，与 LobeHub 存在功能重叠；若未来要对外分发，建议把「借鉴了哪些概念、是否为独立实现」留一份设计溯源记录（本文件 + `ARCHITECTURE-v0.6.md` 已承担该作用）。
- ✅ `lobehub/acceptance` 是**另一个仓库、另一份协议（Apache-2.0）**，不受上述附加条件约束；2026-11-06 已作为第七个 submodule 引入（`f720feb…`），单独保留版权、LICENSE 原文与声明，动作清单见第 4 节。

## 4. Acceptance 引入的合规动作（2026-11-06 已完成）

**状态：已引入。** `upstream/acceptance` 固定 commit `f720feb862bdbe3acc653bdedc297e20e08be1ae`（v0.10.0），`.gitmodules`、`sources.lock.json` 与 gitlink 三者一致，`npm run audit:upstream` 已纳入该条目检查。下面逐条核对当时的前置清单：

| # | 前置动作 | 落地结果 |
|---|---|---|
| 1 | submodule 锁 commit + 双处登记 | ✅ `.gitmodules` 登记 `upstream/acceptance`，`sources.lock.json` 记 URL / commit / `license: Apache-2.0`，不跟随主分支 |
| 2 | 保存 LICENSE、检查 NOTICE | ✅ `licenses/acceptance-APACHE-2.0.txt` 为上游 `LICENSE` 原文；上游无 NOTICE 文件需随附 |
| 3 | `THIRD_PARTY_NOTICES.md` 条目 | ✅ 新增 `## Acceptance (lobehub/acceptance) — Apache-2.0` 专节：Copyright © 2026 LobeHub、固定 commit、实际复用内容、未启动 CLI / 云端报告服务 |
| 4 | `docs/SOURCES.md` 补一行 | ✅ 已补「实际复用 / 保留边界」 |
| 5 | 只复用契约与报告格式 | ✅ `src/acceptance-interop.ts` 做计划 / 报告映射、校验与 bundle 写入，`scripts/export-acceptance.ts` 导出；`/accept` 发起人身份校验与「Agent 完成 ≠ 验收」红线未改动 |
| 6 | 若不引入则记录不复用理由 | — 已引入，本条不适用 |

**复用边界（仍未启用 / 不得宣称）**：不启动 Acceptance 的 CLI 与云端报告服务；第六轮的 `src/acceptance-report.ts` / `scripts/acceptance-report.ts` 是**本仓库自研的本机只读报告服务**（只绑 `127.0.0.1`），读取已归档 `result.json` 渲染中文 HTML，不是上游 CLI 的封装，也不等于云端报告能力已启用；独立评审者必须不同于产出模型；自撰证据一律拒绝；导出的 bundle 是本机 `.runtime` 产物，不是生产发布或真实业务最终验收。

## 5. 当前声明缺口与修正状态

| # | 缺口 | 影响 | 本轮动作 |
|---|---|---|---|
| G1 | `sources.lock.json` 只锁 4 个项目，`.gitmodules` 有 6 个（缺 Prime Agent、DeepSeek Harness） | 升级/审计时无法核对两个已引入 MIT 上游的精确版本 | ✅ 已补齐 |
| G2 | 根目录无 `LICENSE` | 私有项目当前不影响；若要开源或对外交付会缺主许可 | ⬜ 待定：先明确本项目是否对外分发 |
| G3 | `THIRD_PARTY_NOTICES.md` 未写清「LobeHub 主仓库为何只参考不引入」 | 容易被误当成可按 MIT/Apache 复用 | ✅ 已补本节说明 |
| G4 | 用户自有原型 `ai_bridge.py` / `knowledge.py` 权属未声明 | `src/evidence.ts` 的迁移来源缺书面依据 | ✅ 已在本文件与 notices 标注为用户自有、经授权迁移 |
| G5 | Alice 研究包 manifest 标 MIT、完整许可未核实 | 静态恢复不等同原厂授权证明 | ✅ 保持「仅设计参考、不复制代码、不宣称已授权」 |
| G6 | npm 传递依赖未做全量法律审计 | `THIRD_PARTY_NOTICES.md` 已声明该边界 | ⬜ 发行前需单独做一次依赖扫描 |
| G7 | Acceptance 未引入、协议动作未做 | FR-16~19 目前是自研契约 | ✅ 已引入 submodule `f720feb…` 并按第 4 节补齐全部协议材料；契约映射与导出已可运行 |
| G8 | C-1 新增 npm 依赖 `pg` 未走 R7 六步 | 发行前缺精确版本、许可证原文与声明 | ✅ 已补：`pg@8.23.1` / `@types/pg@8.23.1` 精确版本 + lockfile integrity、`licenses/pg-MIT.txt`、`THIRD_PARTY_NOTICES.md` 段落、`SOURCES.md` 一行、`audit-upstream.ts` 机器化检查 |

## 6. 工程红线 R7：新增依赖的检查清单

`PRD-v0.6.md` R7 要求「新增依赖须写入 `THIRD_PARTY_NOTICES.md` 与 `licenses/`」。扩展为可执行六步：

1. 查官方仓库的 **SPDX 标识**；`Other` / `BSL` / 带附加条件的协议一律先人工评审，禁止直接复制源码。
2. 以 submodule commit 或 lockfile integrity **固定版本**，不跟随分支。
3. 保存 LICENSE 原文到 `licenses/`；Apache-2.0 额外检查 `NOTICE`。
4. 在 `THIRD_PARTY_NOTICES.md` 写：版权归属、commit、复用了什么、**明确没启用什么**（边界声明）。
5. 更新 `sources.lock.json`（submodule）或 `package-lock.json`（npm）。
6. 在 `docs/SOURCES.md` 补一行「实际复用 / 保留边界」。

## 7. 功能补全与协议路线（供后续 PRD 落地对照）

| 功能 | 可复用对象 | 协议是否允许 | 动作 |
|---|---|---|---|
| FR-25/27 事件流水与成本归因 | DeepSeek Harness output-retention、Autoloop 回执（MIT） | ✅ | 已引入；本轮自研 `event-stream.ts` / `trace-bridge.ts` 适配层 |
| FR-16~19 证据化验收 | `lobehub/acceptance`（Apache-2.0） | ✅ | 已引入 submodule；`src/acceptance-interop.ts` 映射契约与报告格式，独立评审链已可运行，本机实例已开 `independent`；仓库默认仍可用 `legacy` 一行回退 |
| FR-06/08 知识底座 | Cognee（Apache-2.0） | ✅ | 已引入；新增边状态层为自研 |
| FR-09 图谱边状态 / 失效 | Graphiti 双时间边语义（Apache-2.0） | ✅（借语义） | 不部署其服务，只借模型 |
| FR-11/12 Transfer 责任链 | `@a2a-js/sdk`（Apache-2.0） | ✅ | 已引入；Transfer 对象自研 |
| FR-05/23 汇报拓扑、注意力预算 | LobeHub 主仓库（Community License） | ❌ 复制源码不行 / ✅ 借思想可以 | 只做独立实现，保留设计溯源 |
| FR-01/02 职能注册表 | 无对应开源实现 | — | 自研，不涉及第三方代码 |
| C-1 事务 / 并发 / 步进队列 | `pg` 8.23.1（MIT） | ✅ | 已引入；`src/pg-host.ts` 自研适配，本机专属库 `npm run host:pg` 真跑 21/21；未引 Redis、未部署远端沙箱 |
| 权限标签粒度 | Outline (BSL 1.1) / Onyx / OpenFGA | ❌ / 未核实 | 仅设计参考，不引入代码 |

---

**一句话**：底座里能安全复用的都是 MIT/Apache-2.0；真正需要"注意说明"的是 **LobeHub 主仓库的附加商业条款**、**Outline 的 BSL 1.1**，以及**同组织不同仓库协议不同**（Acceptance 独立 Apache-2.0）。这三点写清楚，后续功能补全才不会在发行时踩雷。
