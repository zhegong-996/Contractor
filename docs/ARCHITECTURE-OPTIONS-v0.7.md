# SuitMe 协作台 · 架构收敛方案 v0.7

> 日期：2026-11-07　性质：**方案与现状盘点，不是已实现声明**。
> 依据：`docs/ARCHITECTURE-v0.6.md`（产品架构定稿）、`docs/PRD-v0.6.md`、`docs/UPSTREAM-ADAPTERS.md`、`docs/OPEN-SOURCE-COMPLIANCE.md`、`docs/VALIDATION.md` 第十轮、`src/` 与 `plugins/` 源码实测，以及 2026-11-07 对 NVIDIA/auto-ontology、Cognee 官方文档、Mem0/Zep-Graphiti/Letta/CoALA/A-MEM/事件溯源记忆、LobeHub 三层汇报、玉伯 OPT 访谈的核读。
> 目的：把「前端 / 知识库 / Agent 引擎 / router / 验收」各自到底由谁承担讲清楚，给出**三种可落地方案**与「未实现功能的开源复用补齐清单」，终结当前多份文档与多套适配层各说各话的状态。

---

## 0. 结论先行

1. **设计其实不缺，缺的是统一实现。** `ARCHITECTURE-v0.6.md` 已定义 6 层架构、M3 三层路由（主职能定组 → 领域定人 → 邻接补位）、M11 责任转移、K 知识底座与「默认图谱本体」16 类节点 / 5 类边；`src/org-ontology.ts` 已实现轻量本体（节点类型、边族、domain/range、草稿/已验收/可复用状态、证据引用、`invalidAt`）。问题不是「没有设计」，而是这些概念散在 `ontology.ts` / `org-ontology.ts` / `knowledge-edges.ts` / `org-extraction.ts` / `memory-contract.ts` / `team-memory.ts` 等 10 多个文件里，没有一个统一的「记忆架构」入口。
2. **知识库确实就是 Agent 的共享记忆层**，但团队场景（多成员、带权限、带来源版本、要审计）不能照搬主流个人记忆框架。主流 mem0 / Letta / A-MEM 都假设单用户或单 Agent；带 source-derived 权限与 lineage 的「治理型共享记忆」目前学术界也认为 largely unsolved。适合本项目的是 **append-only 事件日志 + 多投影 + 检索时重评权限**，而不是换一个向量库或再上一个图数据库。
3. **「全部用开源项目代码复用补齐」需要改一个字：不是全部。** LobeHub 主仓库是 Community License（非 OSI），Outline 是 BSL 1.1，两者只能借思想、禁止复制代码；`lobehub/acceptance` 是独立 Apache-2.0 仓库，可复用；七个已 pin 的 submodule 全是 MIT / Apache-2.0。**正确做法是按许可证分三类补齐**，见第 5、6 节。

### 三个事实校正（当前认知里容易混的地方）

| 常见说法 | 实际情况 | 依据 |
|---|---|---|
| 「知识字典和 Wiki 插件是 Cognee 的部分」 | **Wiki 插件来自 Paperclip LLM Wiki（MIT），与 Cognee 无关**；Cognee 提供 DataPoint / Ladybug / GraphSchema / BM25。`src/ontology.ts` 校验的是「单个知识空间的 GraphSchema 字典」，`src/org-ontology.ts` 是跨来源的组织本体，两者不是一回事 | `UPSTREAM-ADAPTERS.md` 第 2 节；`src/org-ontology.ts` 文件头注释 |
| 「Agent 部分架构引擎不清楚，可能没有」 | 实际叠了四套：**Super-agent**（触发解析 / settingsPolicy / assessmentOutcome）、**DeepSeek Harness**（persona / scope / 工具管线 / 输入保留）、**Autoloop**（worker 契约与回执恢复）、**A2A SDK 1.3.0**（服务 Agent 委派）。它们各自有窄适配层，但没有一个统一的 Agent 运行时契约 | `UPSTREAM-ADAPTERS.md`；`src/upstream.ts` / `native-worker.ts` / `harness-composition.ts` / `service-network.ts` |
| 「引入 NVIDIA/auto-ontology 做知识库本体」 | 它是 **关系型数据库元数据 → 业务术语 / 口径 / join 关系** 的语义层（Generate → Certify → Answer），无 OWL/RDF 产物、无推理机、依赖 NVIDIA NIM 与 Postgres/pgvector，**不适合文档知识库**。可借的是「生成候选 → 人工认证 → 带 provenance 回答 → 纠正回流」的治理闭环，不是代码 | 官方 README `github.com/NVIDIA/auto-ontology`；Apache-2.0，2026-11 活跃但声明不接受外部贡献 |

---

## 1. 现状盘点

### 1.1 七个上游的真实分工

| 上游（协议 / 固定提交） | 承担的能力 | 适配层 | 当前状态 |
|---|---|---|---|
| **Paperclip** MIT | 任务 / 成员 / ACL / 文档修订 / 审批 / 审计 / **插件式前端与 LLM Wiki** | `paperclip.ts`、`server.ts`、`controller.ts`、`plugins/knowledge-workspaces/`、中文壳 | 唯一业务真源；前端 5 tab 插件页；Wiki 自动摄取关闭 |
| **DSH Super-agent** MIT | 飞书触发解析、会话线程键、`settingsPolicy` / `assessmentOutcome` 范围判断 | `upstream.ts`、`feishu-sources.ts` | 已接；其「中央 Router + Worker」双层只作为设计参考，未落地为产品 router |
| **Agent Autoloop** MIT | worker 契约、原生进程执行与回执恢复、CLI 适配器 | `native-worker.ts`、`assistant-turn.ts` | 已接，执行层 |
| **DeepSeek Harness** MIT | persona / scope / 工具管线 / 输入保留与序列化 | `harness-composition.ts` | 已接，装配层 |
| **Prime Agent** MIT | 检索词权重、近期目标权重 | `vendor/prime-query.ts`、`team-memory.ts` | 代码移植（需保留版权头） |
| **Cognee 1.6.6** Apache-2.0 | DataPoint / Ladybug / provenance / GraphSchema / BM25 / 图谱渲染 | `graph.ts`、`ontology.ts`、`team-memory.ts`、`org-extraction.ts`、`scripts/cognee-*.py` | 已接 L1 投影与 L2 确定性草稿抽取；**2026-11-07 起原生 LLM 实体抽取 / embedding / cognify 已打开**（`scripts/cognee-native.py`，外部 OpenAI-compatible API，待端点配置） |
| **Acceptance** Apache-2.0 | 验收计划 / 报告 / 产物格式的**契约与文件布局** | `acceptance-interop.ts`、`export-acceptance.ts` | 已接格式；**CLI 与云端报告服务未启动** |

npm 侧另有 `@a2a-js/sdk` 1.3.0（Apache-2.0，服务 Agent 委派）、`@modelcontextprotocol/sdk` 1.31.0、Zod。

### 1.2 「混乱」的三个具体来源

1. **同一个概念多套模型**：知识有「空间字典（`ontology.ts`）」「组织本体（`org-ontology.ts`）」「记忆标注（`memory-contract.ts`，仅 5 行）」「L1 证据图（`graph.ts`）」「L2 组织图（`org-extraction.ts`）」「团队记忆（`team-memory.ts`）」六套表述，彼此用不同 ID、不同状态字段、不同权限口径。
2. **Agent 运行时没有单一契约**：触发来自 Super-agent、装配来自 Harness、执行来自 Autoloop、委派来自 A2A、`assistant.ts` 又自己写了一遍状态机；「谁把任务交给谁」散在 `coordination.ts` / `service-network.ts` / `controller.ts` / `v06.ts`。
3. **文档指针多于实现**：`ARCHITECTURE-v0.6.md` 的 M3/M11/K 是设计定稿，`PRD-v0.6.md` 第 10A 节声明「FR 覆盖状态」但多数是「具备契约与 API」，而 `VALIDATION.md` 第十轮又列出一批「未发生」。三者没有一张对照表说明「哪条 FR 真的能端到端跑」。

### 1.3 未实现 / 半成品清单（可执行的补齐对象）

| # | 能力 | 现状 | 证据 | 可复用的开源项目 / 动作 |
|---|---|---|---|---|
| 1 | **Personal Agent 1:1 过滤层** | 无；`assistant.ts` 是任务级协作助手，不是「每人一个代理面」 | `ARCHITECTURE-v0.6.md` §14 判「部分冲突：1:1 只覆盖第一层」 | LobeHub 三层思想（**只借思想**）+ 自研 `personal-agent.ts`；超 DSH Super-agent 的过滤策略（MIT 可复用） |
| 2 | **项目主管 Agent 派活 + 三层汇报** | 有 A2A `delegate_service` 与服务网络，但没有「主管 Agent 收活 / 派活 / 验收」的角色与汇报链 | `service-network.ts`、`ARCHITECTURE-v0.6.md` §15 | LobeHub 三层（思想）+ A2A SDK task/handoff（**代码可复用**）+ 自研 supervisor |
| 3 | **Agent 之间直接交接不丢上下文** | `ServiceNetworkPanel` 有委托与回传，但上下文靠任务文档镜像，不是 A2A task 上下文传递 | `collaboration-network.tsx` | A2A 1.3.0 `Task` / `TaskStore` + 自研 handoff envelope |
| 4 | **统一 router（人只听自己的 Personal Agent）** | 无；当前用户直接在 IM / 工作台发起，多条命令路径 | `user-language.ts`、`controller.ts` | DSH Super-agent Router/Worker（思想 + 已有 MIT 触发解析代码）+ LobeHub 三层（思想） |
| 5 | **轻量 ontology 统一入口** | `org-ontology.ts` 已实现但只服务 L2 图；`ontology.ts` 只服务空间字典 | 源码 | **不另建服务**：把 `org-ontology.ts` 升为共享类型契约，对齐 Cognee `graph_model` / `DataPoint.ontology_uri` |
| 6 | **Cognee 内置 OWL grounding** | 未启用 | `KNOWLEDGE-ENGINE.md`、VALIDATION 第十轮 | Cognee `ONTOLOGY_FILE_PATH` / `RDFLibOntologyResolver`，用 `annotate` 模式起步（**同一上游能力，无需新依赖**） |
| 7 | **bi-temporal 失效 + lineage 权限合成** | `orgEdgeSchema` 有 `invalidAt` 与 `evidenceRefs`，但检索时按当前 principal 重评权限未实现 | `org-ontology.ts`、`context.ts` | Graphiti 双时间边（Apache-2.0，借语义）+ 自研 serving-layer 策略 |
| 8 | **事件溯源记忆主干** | `event-stream.ts` 是事件流，`trace-bridge.ts` 是 best-effort，未成为 system-of-record | 源码 | 自研（主流框架无满足团队权限的版本）；复用 `trace-bridge` 已有事件形状 |
| 9 | **Acceptance CLI / 云端报告服务** | 只复用格式契约 | `UPSTREAM-ADAPTERS.md` §2 | `lobehub/acceptance` Apache-2.0（**代码可复用，需单独评估运行时依赖**） |
| 10 | **独立视觉评审端点** | 4190 Apple Vision 已跑通但当前停机（用户取消） | VALIDATION 第十轮 | 本机 `vision-server.ts`（自研）+ Acceptance 证据格式 |
| 11 | ~~Cognee 原生 LLM / embedding / cognify~~ | **已按 2026-11-07 用户决策打开** | `src/cognee-native.ts`、`scripts/cognee-native.py`、`npm run cognee:native` | 链路已实现并真跑状态检查；真跑 cognify 仍需外部端点与凭据，缺配置明确报错 |
| 12 | **L1–L5 自主度 / Agent Vent / harness 自优化 / 组织体温闭环** | 未实现（仅设计参考） | `ARCHITECTURE-v0.6.md` §14 | LobeHub 只借思想；不复制代码 |
| 13 | **全员 SSO / 真实员工入驻 / 生产发布** | 未发生 | VALIDATION 第十轮 | Paperclip 原生 authenticated 模式（MIT，可复用） |
| 14 | **真人在真实业务单确认验收** | 未发生（SUI-129 未核可） | 同上 | 不是代码缺口，是流程红线，不能由补代码替代 |

> 第 14 条必须单独强调：**验收不能靠复用开源代码「补齐」**，它是产品红线（R3/R4）。

---

## 2. 主流架构与实现思路

### 2.1 Agent 记忆的五条流派

| 流派 | 代表 | 写入 / 读取 | 遗忘与版本 | 团队场景适配 |
|---|---|---|---|---|
| 向量 / 片段 | mem0、MemoryBank | 抽取事实 + embedding；读时召回 | DELETE 或 ADD-only + 读时排序 | ✗ 无来源级权限、多跳弱、定向删除困难 |
| 时序知识图谱 | Zep / Graphiti、Cognee | episode → 实体/事实边 → 社区；BM25 + 向量 + BFS | `t_valid/t_invalid` 逻辑失效不删除 | △ 时间演化好，但 provenance 不传递权限 |
| 分层 / OS 型 | Letta(MemGPT)、CoALA | core / archival / recall 分页调度 | FIFO + recursive summary | ✗ 单 Agent 假设；适合做个人工作记忆而非共享层 |
| 事件溯源 + 投影 | ActiveGraph、A-MEM、event sourcing | append-only log → 确定性 fold 出多投影 | replay / fork / 不删除 | ✓ **适合主干**：lineage 是交付物本身 |
| ontology / schema 驱动 | Cognee `graph_model`、Zep custom types、auto-ontology | 类型字典 + 约束校验 + canonical URI | schema 版本化、需 re-materialize | ✓ **适合做约束层**，不适合单独当存储 |

**判断**：团队知识库 = 共享记忆，其硬需求是「多成员 + 来源版本 + 权限 + 审计」，因此主干必须是 **事件日志 + 多投影**；时序 KG（Cognee/Graphiti 语义）是其中一个投影；轻量 ontology 是写入约束与跨源消歧层；向量只做召回入口；OS 型只用于单个 Agent 的工作记忆。

### 2.2 ontology：轻量约束 vs 完整推理

- **轻量本体（推荐）**：类 / 关系枚举 + domain/range + 必填 / 基数 / 枚举约束，用 Zod / JSON Schema / SHACL 在写入口校验，失败把 violation 回传给抽取器自修。**无需 reasoner、无需 RDF triple store**。本项目 `org-ontology.ts` 已经就是这个形态。
- **完整 OWL 推理（不推荐）**：只在有明确 competency questions（subclass 继承、disjointness、外部标准词汇对齐）时才上，且必须离线 materialize、TBox 入 Git、CI 跑一致性检查。OWL 开放世界假设会把 Agent 的错误「解释」掉而不是拒绝，写入校验必须交给 SHACL/闭合世界。
- **auto-ontology 的可借之处**：`Generate → Certify → Answer → Learn` 的治理闭环、`check_answerable` 覆盖不足时拒答、把「认证率」而非「生成率」当 KPI。**不借其代码与部署形态**。
- **Cognee 已内置 ontology 能力**：`graph_model`（抽取结构）、可选 `ONTOLOGY_FILE_PATH` + `RDFLibOntologyResolver`（词汇归一、模糊匹配 cutoff 0.80、`ontology_valid` 标记）、`DataPoint.ontology_uri` / `version` / provenance。三者互补，**再自建独立 ontology 服务会重复打架**。权限与审计仍需 Cognee 之外补齐。

### 2.3 router 的三种模式

| 模式 | 代表 | 责任转移 | 上下文传递 | 主要风险 |
|---|---|---|---|---|
| 中央 Router + Worker | DeepSeek dsh-superagent-prototype | Router 统一接活分发 | 同话题消息订阅直通绕过 Router | 中间态全塞在 Router，过程不可见、人无法插手 |
| 三层汇报（**用户想要的方向**） | LobeHub | Personal Agent 过滤 → 项目主管 Agent 派活验收 → 执行 Agent | Task 卡片工单；Agent 间直接交接上下文不丢 | 多一层转发；主管 Agent 成为新瓶颈；实现复杂度高 |
| 事件驱动 handoff | OpenAI Agents SDK handoffs / A2A 1.3.0 | task 显式委派与状态回传 | A2A `Task` / `TaskStore` 字段 | 需防止无限委派环；需统一 Trace |

LobeHub 三层的原话依据（赛博禅心《如何让 Super-agent 成为同事：LobeHub 的组织实验》，2026-11）：「第一层每个人一个 Personal Agent 替人过滤信息；第二层每个项目一个主管 Agent 负责派活和验收；第三层才是 Codex / Claude Code 执行 Agent」「**人只听自己的 Personal Agent，活由各个项目的主管 Agent 去派**」「人想中途插手，通过 Task 卡片开工单」「交接两头都是 Agent 时上下文原封不动递过去」。DeepSeek 的中央 Router 正是 LobeHub 明确要避开的形态（「下面干得怎样很难看清，更不知道从哪插手」）。

### 2.4 玉伯 OPT 与 LobeHub 的张力（方案必须正视）

玉伯在会友播客第 74 期（YouMind 创始人访谈）提出 **OPT（One Person Team）**：人是「监工」，负责给 Agent 派活、成果审核与反馈；**同时管理约 5 个 Agent 已达带宽上限**，并明确「暂无法实现 Agent 自主管理 Agent」，主观判断与品位仍靠人。这与 LobeHub「主管 Agent 自主派活」并不矛盾但不同阶段：玉伯描述的是当下的 L2–L3，LobeHub 描述的是向 L4（Agent 之间自主接力）演进。

**对方案的约束**：不要把「Agent 自主管理 Agent」当成已验证能力来设计默认路径。推荐路线里，主管 Agent 派活必须保留「人可在 Task 卡片插手 / 高风险动作人工签字 / 验收由原发起人」三条回退，正对应本项目 R3/R4 红线。

---

## 3. 三种方案

### 方案 A · 收敛整合（最小改动，先把话说清）

- **目标**：不改运行形态，把散落的概念收敛成一份权威契约与一个窄接口层；补齐「文档↔实现」对照表，消除混乱感。
- **改动面**：新增 `src/architecture-contracts.ts`（统一导出 `NodeKind` / `EdgeFamily` / 记忆事件形状 / Agent 角色枚举），把 `ontology.ts`、`org-ontology.ts`、`memory-contract.ts` 改为引用它；`docs/` 增加一张 FR 覆盖对照表；**不改前端、不改数据库、不改服务**。
- **复用**：Cognee（已有）、Acceptance（已有格式）；不新增依赖。
- **风险**：极低；收益是「可读性」，不是「能力」。
- **验证口径**：`npm test` / `tsc` / `audit:upstream` 全绿；对照表逐条可指向源码行号。

### 方案 B · 记忆架构重构（把知识库正式定义为共享记忆）

- **目标**：以 **append-only 记忆事件日志** 为 system-of-record，把 L1 证据图、L2 组织图、BM25/向量索引、Context Pack 全部降为可重放投影；统一 ontology 为写入约束层；检索时按当前 principal + 当前 policy 重评权限。
- **改动面**：新增 `src/memory/`（`events.ts` / `projections.ts` / `policy.ts` / `ontology.ts`），改造 `graph.ts` / `team-memory.ts` / `context.ts` / `org-extraction.ts` 的写入口；`src/org-ontology.ts` 升为共享 TBox；对齐 Cognee `graph_model` 与 `DataPoint.ontology_uri`；启用 Cognee `annotate` 模式 OWL grounding（小类集）。
- **复用**：Cognee 内置能力（同上游、无新依赖）、Graphiti 双时间边语义（借思想）、auto-ontology 的 certify/coverage 闭环（借思想）、`event-stream.ts` / `trace-bridge.ts` 已有事件形状。
- **风险**：中。需要迁移既有 L1/L2 图数据；权限重评会改变部分现有查询结果；必须保留旧链路开关。
- **验证口径**：同一批任务重放得到 byte-reproducible 投影；越权用例（来源权限撤销后派生记忆不可召回）必须有回归测试；`modelCalls` 保持 0 的边界不破。

### 方案 C · 全面 router 化 + ontology 驱动（目标形态，分阶段）

- **目标**：实现用户描述的形态——**人 ↔ Personal Agent（过滤）→ 项目主管 Agent（派活 + 预验收）→ 执行 Agent（Autoloop / Codex / Claude）**，Agent 之间用 A2A task 交接；知识底座作为三层共用的共享记忆（方案 B 的产物）；验收统一走 Acceptance 契约与独立视觉评审。
- **改动面**：新增 `src/router/`（personal / supervisor / handoff / delegation-policy）；`service-network.ts` 与 `coordination.ts` 收敛到 router；`channels.ts` 的 `ChannelEnvelope` 扩展为 agent-to-agent envelope；前端在现有 5 tab 内加「我的 Agent / 派单看板」二级视图（**不新增 tab、不改宿主路由**）；写作链路由 Super-agent 触发策略 + Autoloop worker + LobeHub 组织思想组装。
- **复用**：A2A SDK 1.3.0（代码）、Super-agent MIT（触发/策略，已有适配层）、Autoloop MIT（worker）、DeepSeek Harness MIT（装配）、Acceptance Apache-2.0（验收契约，评估启动其 CLI）、Paperclip（任务真源与前端插件）。LobeHub **只借思想**（许可证约束）。
- **风险**：高。会改变「谁把任务交给谁」的主链路，牵动飞书指令、工作台 action、Trace、验收身份校验；必须保留 `legacy` 一行回退（项目已有先例：`acceptance.mode=legacy`）。
- **验证口径**：真实一单端到端（飞书发起 → Personal Agent 过滤 → 主管 Agent 派活 → 执行 → Acceptance 报告 → 原发起人确认验收），且每一步在 Trace 可回放；不能只靠单测或 mock。

### 方案对比

| 维度 | A 收敛整合 | B 记忆重构 | C 全面 router 化 |
|---|---|---|---|
| 解决「太混乱」 | ✓ 文档与契约层面 | ✓ 数据层面 | ✓ 组织与运行层面 |
| 解决「知识库=记忆架构」 | △ 只定义概念 | ✓ | ✓（依赖 B） |
| 解决「人只听 Personal Agent」 | ✗ | ✗ | ✓ |
| 新增依赖 | 0 | 0（启用已有 Cognee 能力） | 0 或 1（Acceptance CLI，需评估） |
| 改动面 / 回归成本 | 低 | 中 | 高 |
| 可独立交付 | ✓ | ✓ | 建议在 B 之后 |

**推荐：A → B → C 分阶段，不并行。** A 是一次提交内可完成的收敛；B 是记忆主链路的重构，独立可验收；C 必须建立在 B 的统一契约上，否则三层 router 会各自再写一套记忆接口，把混乱放大三倍。

---

## 4. 推荐路线（每阶段都有可验收标准）

| 阶段 | 内容 | 验收标准 | 不改的东西 |
|---|---|---|---|
| **P0 · 对齐**（对应方案 A） | 统一类型契约 + FR 覆盖对照表 + 文档指针收敛到本文件 | 对照表每条可指向源码行号；`npm test` / `tsc` / `audit:upstream` 全绿 | 运行形态、前端、数据库 |
| **P1 · 记忆主干**（方案 B 前半） | 记忆事件日志 + 投影重放 + ontology 统一写入校验 | 重放可复现；越权用例回归；`modelCalls=0` 边界不破 | 用户入口、派单链路 |
| **P2 · 权限与 lineage**（方案 B 后半） | 检索时重评权限、bi-temporal 失效、Cognee `annotate` grounding | 来源撤权后派生记忆不可召回；未匹配节点标 `ontology_valid=false` 供人审 | 不启用 cognify / 外部模型 |
| **P3 · 三层 router**（方案 C） | Personal / 主管 / 执行三层 + A2A handoff + 前端二级视图 | 真实一单端到端、Trace 可回放、`legacy` 可回退、验收身份不变 | 不新增 tab、不改上游；本机合并与发布已自动化，但仍不发布业务仓库 |

---

## 5. 复用补齐清单（按许可证分三类）

**A 类 · 可直接复用代码（MIT / Apache-2.0，七个已 pin submodule + npm 依赖）**

| 缺口 | 复用对象 | 具体动作 |
|---|---|---|
| Agent 间交接 | `@a2a-js/sdk` 1.3.0 | 用 `Task` / `TaskStore` / `DefaultRequestHandler` 替换自研委托消息结构 |
| 触发与范围判断 | DSH Super-agent | 继续用 `settingsPolicy` / `assessmentOutcome`，扩展为 router 的准入策略 |
| 执行 worker | Agent Autoloop | 保持 `createWorker` 与回执恢复，作为第三层执行端 |
| 工具管线 / persona | DeepSeek Harness | 保持 `harness-composition.ts`，供 Personal / 主管 Agent 共用装配 |
| 任务真源 / 前端 / Wiki | Paperclip（含 Plugin SDK、LLM Wiki） | 保持插件式 5 tab；如需 Wiki 自动摄取，走配置而非另建知识库 |
| 记忆存储 / 图谱 / 字典 / 检索 | Cognee 1.6.6 | 启用 `graph_model` 与 `annotate` OWL grounding；**不另建 ontology 服务** |
| 验收计划 / 报告格式 | `lobehub/acceptance` | 已有 `acceptance-interop.ts`；如需 CLI，先评估运行时依赖再决定是否启动 |
| 团队登录 | Paperclip authenticated 模式 | 全员入驻阶段启用，不在 P0–P2 动 |

**B 类 · 只借思想、自研实现**

| 缺口 | 参考 | 自研内容 |
|---|---|---|
| 三层汇报 / Personal Agent / 主管派活 / Task 工单插手 | LobeHub（Community License） | `src/router/` 全部代码独立实现，不复制、不 fork、不打包其源码 |
| 双时间边与 supersession | Graphiti（Apache-2.0，但需 Neo4j/FalkorDB） | 在 Cognee / 现有边上实现 `validAt/invalidAt` 语义 |
| 中央 Router 的教训 | DeepSeek Super-agent 设计文 | 明确**不采用**中央 Router，避免过程黑盒 |
| 认证闭环 / coverage 拒答 | NVIDIA auto-ontology | 把「人工 certify 率」「覆盖不足拒答」用于 ontology 与验收，不引其代码/部署 |
| 文档权限模型 | Outline（BSL 1.1，**禁止引代码**） | 仅参考 collection/group 设计，沿用 Paperclip 原生私有项目 ACL |

**C 类 · 明确不补齐（产品红线或用户已决定）**

- ~~Cognee 原生 LLM / embedding / cognify 与向量语义管线~~：2026-11-07 已按用户决策打开（允许外部模型 API）。
- ~~自动合并 / 自动发布~~：2026-11-07 已按用户决策放开，仅限本机裸仓库与本机预览制品；业务仓库仍不发布。
- **仍不做（红线）**：无人值守最终验收、知识自动采用、真人在真实业务单「确认验收」由代码替代。
- 真人在真实业务单「确认验收」：不是代码缺口，不能靠复用补齐。
- 组织体温用于人员考核 / KPI：明确不做。

---

## 6. 许可证红线（「全部复用」的边界）

- **LobeHub 主仓库**：Community License = Apache-2.0 + 附加条件，GitHub 标 `Other`、非 OSI。允许不修改源码地商用；**基于其开发并分发衍生作品需商业授权**。本产品与其功能重叠，未来对外分发必须保留设计溯源记录。→ 只借思想。
- **Outline**：BSL 1.1，source-available 非 OSI，明确禁止引入代码。→ 只参考。
- **`lobehub/acceptance`**：独立仓库、独立 Apache-2.0，不受上述附加条件约束，已 pin `f720feb…`；CLI / 云端服务未启动。→ 可复用代码。
- **Cognee / A2A SDK**：Apache-2.0，须保留 NOTICE、对被修改文件显著标注；当前做法是「固定 commit + 不改上游 + 适配层独立」，规避修改标注义务。→ 保持这个做法。
- **Prime Agent 移植文件** `src/vendor/prime-query.ts`：须保留原 MIT 版权头。核对结论（2026-11-07）：`sources.lock.json` **已登记** Harness `fcc0ad46…` 与 Prime Agent `74591cdd…` 两条，`audit:upstream` 输出 `clean: true`、7 个 gitlink 与锁文件一致；此前「缺两条登记」的说法来自 `OPEN-SOURCE-COMPLIANCE.md` 的过时 ⚠️ 标记，已一并修正并补回归断言，P0 不再需要补登记。
- 任何新增上游：先跑 `audit:upstream` 清单（gitlink / LICENSE / NOTICE / THIRD_PARTY_NOTICES / sources.lock / 声明），非 MIT/Apache-2.0 协议先评审再引入（PRD R7）。

---

## 附录 A · FR 覆盖口径（消除多份文档互相矛盾）

`PRD-v0.6.md` §5 的「现状」列与 §10A 第 352 行的说明是**第五轮历史记录**，其中「已具备契约、API 与可运行链路」容易被读成「功能已完成」；`VALIDATION.md` 第十轮又列出一批「未发生」。二者并不矛盾，只是口径不同。本仓库今后统一为三态：

| 状态 | 定义 | 判定依据 |
|---|---|---|
| **已端到端** | 真实一单 / 真实浏览器 / 真实服务链路跑通 | `VALIDATION.md` 第十轮、`delivery:demo`、SUI-129 2/2 逐项判定、`test:walkthrough` 11/11 |
| **契约 + API** | 有类型契约、只读 action 与单测覆盖，但没有真实业务 journey | `tests/` 288 例、`service-status` / `trace-view` / `context-pack` 等接口 |
| **设计未实现** | 只有 PRD / 架构文档描述，无对应代码路径 | 本文件 §1.3 的 14 项缺口清单 |

按此口径，`ADAPTATION-v0.6.md` 0.00000000000 节（第十轮）是**最新边界声明**；本文件 §1.3 是**最新缺口清单**；`PRD-v0.6.md` §5 与 §10A 保留为设计历史，不再作为「现在支持什么」的判断依据。方案 A 落地后，`src/architecture-contracts.ts` 是节点类型 / 边族 / Agent 角色 / 记忆事件的**唯一常量来源**，`tests/architecture-contracts.test.ts` 守门其一致性、`validateOrgGraph` 行为不变、7 个 gitlink 与 `sources.lock.json` 一致、且合规文档不再出现过时告警。

---

## 附录 B · A 阶段收尾与 B 前置（2026-11-07 · 第十二轮）

**本附录之后的落地细节以 [`ROUTING-AND-HOST-v0.7.md`](ROUTING-AND-HOST-v0.7.md) 为准**；三种方案的选择、改动面与风险仍以本文档第 5–6 节为准，路线不变：**A → B → C，不并行**。

- **A 已完成**：`src/routing-decision.ts` 统一「谁把任务交给谁」五维契约；`src/routing-trace.ts` 让 `controller / coordination / assistant / service-network / v06` 五个派活点写同一份 append-only Trace；`src/three-tier-assessment.ts` 用真实数据判定「暂不引入 LobeHub 三层」；`src/platform-port.ts` 把宿主能力收拢为端口并提供可运行的非 Paperclip 实现。
- **B 的地基已备好**：`toMemoryEvent()` 把路由决策变成 `MemoryEvent`（新增 kind `routing-decided`），`readRoutingEvents()` / `replayRouting()` 给出重放与「两次投影一致」的验收口径。B 阶段把其余记忆事件接入同一日志即可，不需要第二套格式。
- **C 的门槛更明确**：P1 五阶段覆盖、P3 Personal Agent 实体、P4 主管 Agent 实体、P6 单一 Router 全部未满足；C 必须与平台底座切换一起做。
- **许可证补充**：Pi（`earendil-works/pi`，MIT core）、CoPaw（Apache-2.0）、Octop（MIT）、DeerFlow（MIT）是可考虑直接复用代码的底座 / worker 候选；LobeHub（Community License）与 n8n（Sustainable Use License）仍只借思想。本轮**未引入任何新上游依赖**。

---

## 附录 C · 方案 B1 已落地（2026-11-07 · 第十三轮）

**完整实现与真跑证据见 [`MEMORY-ARCHITECTURE-v0.7.md`](MEMORY-ARCHITECTURE-v0.7.md)**。三种方案的选择、改动面与风险仍以本文档第 5–6 节为准，路线不变：**A → B → C，不并行**。

- **B1 已完成**：append-only 事件主干（`src/memory-log.ts`）、四类投影纯函数重放（`src/memory-projections.ts`）、8 处真实写入点双写、Context Pack 运行时 lineage 过滤、只读 `memory-replay`、`npm run memory:replay` / `memory:smoke`。三条红线均有可执行验收：两次重放 checksum 一致、撤权后派生记忆 0 召回、`modelCalls=0`。
- **B2 待做**（历史记录，已于第十四轮完成，见附录 D）：把 `TeamMemory.search` 等读取链正式切到投影消费、真实业务动作产生知识类事件、`grant-revoked` 按 principal 精确过滤、投影增量构建。
- **C 仍未开始**：三层 Router 与平台底座切换排在 B 验收之后。
- **契约复用已兑现**：上一轮 `routing-decided` 事件经 `readBridgedEvents()` 并入同一重放输入，B 阶段没有另造第二套日志格式。

---

## 附录 D · 方案 B2 已落地（2026-11-07 · 第十四轮）

**完整实现与真跑证据见 [`MEMORY-ARCHITECTURE-v0.7.md`](MEMORY-ARCHITECTURE-v0.7.md) 与 `docs/VALIDATION.md` 第十四轮**。三种方案的路线不变：**A → B → C，不并行**。

- **B2-1**：`src/memory-recall.ts` 把投影召回作为第三路信号接入 `TeamMemory.search` 融合排序；只在 `reusable()` / `allowed()` / hash 版本重评之后按 `sourceId@revision` 白名单裁剪，投影不是权限来源。
- **B2-2**：`grant-revoked` 改记 `principalRevocations`，按当前 principal 精确排除，未指定主体 fail-closed；`source-revoked` 仍全局阻断。
- **B2-3**：`npm run memory:journey` 用真实 bridge action 跑完整知识事件链与端到端撤权；收尾复核又修掉 `reviewSource` 用评审前 revision 造成的悬空 lineage，并把 `lineageComplete` 加进验收条件。
- **B2-4**：`src/memory-checkpoint.ts` 的 checkpoint + 增量应用，撤权 / 乱序 / 失效祖先回退全量，增量与全量 checksum 逐字节对照。
- **边界**：原 Cognee / Ladybug / SQLite / Paperclip 存储仍是主读取源，投影是叠加证据；B 已验收；**第十五轮用户已拍板 ② 解除产品形态冲突，C 正式启动**（C-0 完成，见 `ADAPTATION-v0.6.md` `0.0000000000000000` 节），三层判断仍 `recommended=false`（覆盖率 5/7）。

---

## 7. 参考来源

**本项目内部（一手）**：`docs/ARCHITECTURE-v0.6.md`（§1 六层、§13 三项目速览、§14 对照、§15 职能轴、§17 能力契约、§18 默认图谱本体）、`docs/PRD-v0.6.md`（§10A 形态约束、FR 覆盖状态）、`docs/UPSTREAM-ADAPTERS.md`、`docs/OPEN-SOURCE-COMPLIANCE.md`、`docs/VALIDATION.md` 第十轮、`src/org-ontology.ts` / `ontology.ts` / `memory-contract.ts`。

**外部（2026-11-07 核读）**：

- NVIDIA/auto-ontology 官方 README：https://github.com/NVIDIA/auto-ontology ；治理闭环 Generate → Certify → Answer → Learn、`check_answerable`。Apache-2.0。
- Cognee 官方：https://www.cognee.ai/grounding-ai-memory 、https://www.cognee.ai/custom-ontology-rag-retrieval 、https://docs.cognee.ai/core-concepts/building-blocks/datapoints 、https://docs.cognee.ai/rust/guides/custom-graph-schema
- Agent 记忆综述与代表论文：arXiv:2512.13564（Memory in the Age of AI Agents）、arXiv:2504.19413（Mem0）、arXiv:2501.13956（Zep/Graphiti）、arXiv:2310.08560（MemGPT）、arXiv:2309.02427（CoALA）、arXiv:2502.12110（A-MEM）、arXiv:2605.21997（ActiveGraph / The Log is the Agent）、arXiv:2609.25563（AkasicMEM，权限沿 lineage 传递）
- ontology 工程取舍：https://www.adaminnes.dev/blog/ontologies-for-ai-agents 、https://www.dataaihub.co/learn/owl 、https://atlan.com/know/ai-agent/knowledge-graph/enterprise-knowledge-graph-pitfalls
- LobeHub 三层汇报原文（赛博禅心《如何让 Super-agent 成为同事：LobeHub 的组织实验》，2026-11，网易/搜狐/腾讯转载）：https://www.163.com/dy/article/LAMGOGSB0556C3J2.html ；LobeHub 官网 https://lobehub.com/
- 玉伯 OPT / 5 个 Agent 带宽上限：会友播客第 74 期《对话 YouMind 创始人玉伯》 https://www.castbox.fm/episode/74%EF%BD%9C%E5%AF%B9%E8%AF%9DYouMind%E5%88%9B%E5%A7%8B%E4%BA%BA%E7%8E%89%E4%BC%AF%EF%BC%9A%E5%A6%82%E4%BD%95%E5%9C%A8AI%E6%97%B6%E4%BB%A3%E4%BF%9D%E6%8C%81%E5%B0%8F%E5%9B%A2%E9%98%9F%E7%9A%84%E9%AB%98%E6%95%88%E6%B2%9F%E9%80%9A%E5%92%8C%E7%94%9F%E4%BA%A7%E5%8A%9B%EF%BC%9F-id6337396-id927517237
- DeepSeek Super-agent 双层 Router/Worker 与注意力上限（新智元报道，2026-11-06）：https://view.inews.qq.com/a/20261106A0CW1B00

> 二手转载与媒体解读仅用于定位原话，不作为「可直接复用代码」的依据；许可证与复用边界以 `docs/OPEN-SOURCE-COMPLIANCE.md` 与上游 LICENSE 原文为准。

> **第十九轮 C-4 补记**：C-3 的单一 Router 已接上组织级 Agent 编制（`src/agent-registry.ts`），配置里的主管名必须对应真实在岗、职责匹配、范围覆盖的 Agent；默认空编制保持扁平。A2A handoff 与验收编组已落地，C-5 按配置重跑评估、C-6 自演进闭环仍排队。三层判断仍 `recommended=false`。
