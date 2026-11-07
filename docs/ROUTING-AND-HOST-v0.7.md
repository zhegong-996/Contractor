# 统一路由契约、共享 Trace 与宿主解耦（v0.7 · 第十二轮）

> 用户决策（2026-11-07）：把散在 5 个文件里的「谁把任务交给谁」抽成一份 `RoutingDecision` 契约（调用方 / 目标角色 / 依据 / 资料范围 / 是否需人签字），让它们都写同一份 Trace；据此再判断要不要引入 LobeHub 三层；B 阶段记忆事件日志复用这份契约；可复用的尽量复用、可参考的尽量参考；LobeHub 不能复制代码但可参考；Super Agent 与 Agent Autoloop 可直接复用；**Paperclip 的平台底座与 Plugin SDK 不再作为长期依赖**，改用 DeepSeek Harness / Pi / 已复用的 Super Agent、Autoloop 部分，或其它高 star 开源系统；然后 **B → C**，不并行。
>
> 本轮是**A 的收尾 + B 的前置**：统一契约、统一 Trace、接线、平台端口抽象、非 Paperclip 最小宿主真跑、三层判断。没有改运行路由判断、没有新增 tab、没有切换默认底座、没有开始 C。

---

## 1. 先纠正「七个上游平铺复用」的印象

上一轮只读扫描（`src/*.ts` 的 import 图）结论：静态 import 上游源码的只有 3 个文件，其余是动态加载、esbuild 打包、Python 子进程 RPC、只读 schema 或纯思想。真实引用强度分五档：

| 引用强度 | 上游 | 本轮是否复用 |
|---|---|---|
| 静态 import / esbuild 打包 13 模块 | DeepSeek Harness | ✅ `scope` 隔离语义、`tools.restrict` 白名单沿用 `harness-composition.ts` |
| 动态 import + 函数调用 | Super Agent `policy.ts` | ✅ `basis.policyVersion` / `ruleId` 与 `assessmentOutcome` 对齐，不重写策略 |
| 动态 import + 子进程 | Agent Autoloop `createWorker` / `contract` / `agents` | ✅ `causedBy` 绑定 `jobId` / `runId` / `nonce`，执行循环不动 |
| npm import | `@a2a-js/sdk` | ✅ `ServiceNetwork.Link` 的 `caller / serviceId / sourceIds / serviceVersion` 原样映射到契约字段 |
| 只读文件 | `lobehub/acceptance` | 验收格式契约，仍只读，不动 |
| 纯思想（0 代码引用） | LobeHub 主仓库 | ✅ 只取 `personal / supervisor / worker` 角色命名（已在 `AGENT_ROLES`），不复制代码 |

Super Agent、Autoloop、LobeHub **不是同类**：触发策略 → 执行循环 → 组织形态，互补三层，不能互相替换。`ARCHITECTURE-v0.6.md` 第 13 节把三者并列成「速览」，是混淆来源，本文件与 `ARCHITECTURE-OPTIONS-v0.7.md` 的口径优先。

---

## 2. `RoutingDecision` 契约（`src/routing-decision.ts`）

统一五个维度，全部强类型 + zod strict 校验：

| 维度 | 字段 | 约束 |
|---|---|---|
| 调用方 | `caller: { actor, role, source }` | `role ∈ AGENT_ROLES`；`source` 标注判断来自哪个上游，不表示代码依赖强度 |
| 目标角色 | `target: { role, agentKey?, serviceId?, roleId? }` | 三层角色 + 具体承接标识 |
| 依据 | `basis: { kind, evidence[], policyVersion?, ruleId? }` | 证据最多 12 条且可回溯 |
| 资料范围 | `scope: { sourceIds[], allowedPaths[], visibility, expiresAt? }` | 交接方只能在此范围工作；`visibility` 默认 `private` |
| 是否需人签字 | `requiresHumanSignature` + `signatureReason` | 五条红线集中在 `HUMAN_SIGNATURE_RULES`，`signatureFor()` 恒返回 `true`，调用点不得放宽 |

另有 `stage`（intake / admission / dispatch / delegation / transfer）、`outcome`（committed / rejected / pending）、`causedBy`（上游可追溯标识）、`decisionId`（带 `idempotencyKey` 时不含时间，重试不产生重复事件）。

**B 阶段复用**：`toMemoryEvent()` 把决策变成严格的 `MemoryEvent`（新增 kind `routing-decided`），`decisionOf()` 往返还原。B 阶段不需要第二套日志格式；`readRoutingEvents()` / `replayRouting()` 就是重放的最小实现，验收口径是「同一日志两次投影一致、去重、按时间有序、坏行如实报错」。

---

## 3. 同一份 Trace（`src/routing-trace.ts`）

- 五个调用点共用 `getRoutingTrace()` 单例，写 `.runtime/routing/events.jsonl`（append-only、每行一个合法 `MemoryEvent`）。
- `server.ts` 启动时 `attachAudit()` 一次，把同一决策投影进 SQLite `audit` 表，工作台「过程流水」可读；五个调用点无需各自持有 `Store`。
- **与 `TraceBridge` 的分工**：`TraceBridge` 写验收证据 / 成本（`checkpoint` / `model` / `ci` 等），属于业务验收链；`RoutingTrace` 写路由决策链。两者都 best-effort，写入失败绝不改变任务、回执或验收结果。
- **审计纯净性**：`scripts/test.ts` 给测试子进程设 `COLLAB_TEST_TRACE=memory`，测试事件只进内存 sink，不污染真实业务 Trace。隔离前的混合日志已归档为 `.runtime/routing/events.pre-isolation.jsonl`。
- 只读接口 `routing-status`（`server.ts` + `members.ts` 白名单同步）返回 `projection` 与 `threeTier`；CLI `npm run routing:status` 额外给出 5 处接线自检与平台切换清单。

### 真实接线（静态自检 `allWired: true`）

| 文件 | 派活点 | stage | 人签 |
|---|---|---|---|
| `controller.ts` | `ingest` / `createTask` / `handoff` | intake / dispatch / transfer | `accept` 指令强制人签 |
| `coordination.ts` | `admitPreparation` | admission | 否（Super Agent policy 判断） |
| `assistant.ts` | `delegate` | dispatch | 否（资料授权另行人工审批） |
| `service-network.ts` | `route` / `start` | delegation | 否（A2A Link 原字段映射） |
| `v06.ts` | `transferCreate` / `guardDispatch` | transfer / dispatch | 正式跨职能 Transfer 强制人签 |

**所有接线只加记录，不改任何判断与返回值**：`admitPreparation` 改为可注入 `trace` 参数但结果对象一字未改；`guardDispatch` 用 try/catch 只在被拒时额外记一条 `rejected` 后原样 rethrow。

---

## 4. 要不要引入 LobeHub 三层：**现在不引入**

判断不是文档印象，而是 `src/three-tier-assessment.ts` 对真实 Trace 的可执行评估（7 条前置条件）：

| 前置条件 | 当前 | 证据 |
|---|---|---|
| P1 五个派活阶段都有决策记录 | ❌ | 干净业务 Trace 当前只有真实的 `admission` 事件；其余四个 stage 待对应业务动作触发 |
| P2 记忆事件可重放、日志无坏行 | ✅ | `events=2, 坏行=0`；单测另验证两次重放一致 |
| P3 Personal Agent 作为唯一人机入口 | ❌ | 真实链路仍是「人经飞书 IM 直达 Bridge」，没有 Personal Agent 实体 |
| P4 主管 Agent 承担派活 | ❌ | `supervisor` 目前只是策略 / 注册表的调用方标注，不是独立实体 |
| P5 高风险动作全部人签 | ✅ | 红线集中在 `signatureFor()`，理由完整 |
| P6 入口收敛为单一 Router | ❌ | 五个调用点各自构造决策，尚无统一 Router 类（C 阶段目标） |
| P7 LobeHub 仅借思想、不复制代码 | ✅ | Community License；本项目 0 处代码引用 |

真实 HTTP 结果：`routing-status` 200，`threeTier.recommended=false`，`verdict=暂不引入三层：继续 A 的契约收敛并先完成 B`。

反面依据（保留人工插手，不把三层当默认答案）：玉伯 OPT 访谈中人是「监工」、同时管 5 个 Agent 已达带宽上限、「暂无法实现 Agent 自主管理 Agent」；LobeHub 主仓库 Community License 禁止复制与衍生分发。三层若建立在未统一的记忆接口上，会把混乱放大三倍。

---

## 5. 去 Paperclip 化：第一步是端口，不是删除

用户要求「Paperclip 的平台底座和 Plugin SDK 不要了」。但当前任务真源、ACL、文档修订、插件 UI 承载、宿主 `actor` 全部由它提供；一次删掉会让系统不可运行，且与此前「前端必须保持 5 tab 插件式单页」的产品约束冲突。因此本轮做：

### 5.1 `HostPlatformPort`（`src/platform-port.ts`）

统一 `get / post / patch / document / health / uiBaseUrl / capabilities`，两个实现：

- `PaperclipPlatform`：薄包装现有 `Paperclip`，行为完全一致，**默认仍启用**（`config.host.provider='paperclip'`），零回归。
- `LocalHostPlatform`：不依赖 Paperclip，本地文件 + append-only journal，实现主链路真正用到的 route 子集；**未实现的 route 明确抛中文错**，绝不静默返回假数据。

`npm run host:smoke` 真跑结果（`ok: true`）：health `ok / local-file-host`、创建任务、`idempotencyKey` 幂等、文档修订 1→2 且未变更时不升版、读回 `版本：2`、patch 状态、评论、wakeup、journal 6 条、`heartbeat-run`、未实现 route 明确报错、路径穿越被拒。

### 5.2 如实的切换缺口（`capabilities().missing`）

1. ACL / 成员身份（现由 `members.ts` + 宿主 actor 提供）
2. `cost-ledger`（`TraceBridge.flush` 依赖）
3. 插件式 UI 承载与 Plugin SDK（现由 Paperclip 提供）
4. heartbeat 真实执行与 `checkout / retry / runToken` 语义
5. PostgreSQL 事务与并发控制（现为本地 JSON 文件）

**产品形态冲突需用户确认**（第十二轮当时状态）：移除 Plugin SDK 意味着 5 tab 插件单页要改成独立前端或换宿主插件机制；这与 PRD §10A 的既有约束相反。本轮不动前端，`config.host.provider` 默认保持 `paperclip`，切换是显式配置行为。**后续**：第十五轮用户已拍板 ② 独立前端应用，§10A 的 S5/S6 废弃、S1–S4 保留，详见 `ADAPTATION-v0.6.md` `0.0000000000000000` 节。

### 5.3 开源候选矩阵（可复用 / 可参考 / 禁止复制）

> star 数与版本按 2026-11-07 检索，会变化；引用前仍需核对 `sources.lock.json` 与实际许可证文件。

| 项目 | 许可证 | 定位 | 可否复用代码 | 对本项目用途 |
|---|---|---|---|---|
| **Pi Coding Agent**（原 `badlogic/pi-mono`，现 `earendil-works/pi`） | MIT core（约 115k star） | 极简 TypeScript coding agent harness，4 工具、<1000 token 系统提示、`--mode rpc` JSONL / SDK / MCP 扩展 | **可**（MIT core），本轮未引入 | worker 执行层替代或补充 Autoloop；`rpc` JSONL 可作 handoff 传输格式 |
| **CoPaw**（`agentscope-ai/CoPaw`） | Apache-2.0 | 个人 AI 助理工作站，飞书 / 钉钉 / QQ 通道、Skills、工作区记忆、Ollama / llama.cpp / MLX 本地后端 | **可** | Personal Agent 与 IM 网关候选，最贴合「人只听自己的 agent」 |
| **Octop**（腾讯云开源） | MIT | 自托管多用户多智能体平台，`harness-agent` 单进程运行时、SQLite/PG 状态、IM gateway、工作区记忆、Connector / Hook / Tool / Skill 扩展 | **可** | **最接近 Paperclip 底座的替代**：任务 + ACL + 通道 + 插件 UI 一体 |
| **DeerFlow**（字节） | MIT（约 57k star） | 长任务深度研究 Agent，支持 IM 接任务 | **可** | 长任务执行与委派参考 |
| **LobeHub** | Community License | 三层汇报、Workspace + Task | **否**，只参考思想 | `AGENT_ROLES` 命名来源 |
| **n8n** | Sustainable Use License（Fair-code） | 工作流自动化、审计日志 | **否**，只借思想 | 事件驱动编排参考 |
| Super Agent / Autoloop / DeepSeek Harness / A2A SDK | MIT / MIT / MIT / npm（已 pin） | 触发策略 / 执行循环 / scope 装配 / 交接协议 | **已直接复用** | 见第 1 节 |

> 「pi」按 Mario Zechner 的 Pi Coding Agent 理解（与本项目已移植的 `prime-agent` 同作者）。若你指的是其它项目，请指出，我按对应仓库重新核对许可证与接入方式。

**可复用尽量复用的落地**：本轮没有新增任何上游依赖；契约字段直接复用 Super Agent `policy`、Harness `createScope` 语义、Autoloop `jobId/nonce`、A2A `Link`，LobeHub 只借角色命名。Pi / CoPaw / Octop 列为**候选**，不引代码——引入前需先按 `sources.lock.json` 与 `audit:upstream` 走完合规登记。

---

## 6. A → B → C 路线（不并行）

- **A（已完成）**：统一架构常量（`architecture-contracts.ts`）、FR 覆盖口径、统一 `RoutingDecision`、统一 Trace、5 处接线、平台端口抽象。
- **B1（第十三轮已完成）**：共享记忆事件主干与四类投影重放已落地，三条红线有真跑证据；`routing-decided` 经 `readBridgedEvents()` 并入同一重放输入，契约复用兑现。详见 `MEMORY-ARCHITECTURE-v0.7.md`。
- **B2（第十四轮已完成并验证）**：投影召回融合进 `TeamMemory.search`（权限重评之后裁剪白名单）、`grant-revoked` 按 principal 精确过滤、真实一单完整知识事件链与端到端撤权、checkpoint 增量应用；真跑证据 `npm run memory:journey` / `memory:checkpoint`。原存储仍是主读取源，投影是第三路叠加信号。
- **C（B 已验收；第十五轮用户拍板 ②，已启动）**：把五个调用点收敛成单一 `Router` 类，接 A2A handoff 实现按配置组织的 Personal / 主管 / 执行 / 验收 Agent；此时才重新跑 `assessThreeTier()`，按当前配置判定 P1/P3/P4/P6 后再决定是否放开自主派活。**C 阶段同时承载平台底座切换**（先按 ② 重新定义并补齐 5.2 的五项缺口，再移除 Plugin SDK），严格分步不并行；原「5 tab 插件式单页」约束已随 §10A 的 S5/S6 一并废弃，S1–S4 与飞书唯一入口保留。当前三层判断仍是 `recommended=false`。

### 6.1 C 阶段新增产品约束（第十五轮补遗，详见 `PRD-v0.6.md` §10C）

- **组织形态可配置**：10 人团队可全域扁平、上百人团队可按业务域逐域启用中间层；Agent 实例与「职责绑定 / 生效范围 / 版本」分离，允许兼任，禁止同一 Task 自派自验自环；配置组织级唯一、项目只引用不覆写、变更留快照不回溯。`AGENT_ROLES` 三个名字是**能力类型**，不是固定层级。
- **职责槽位可扩展**：验收、标准起草、周期巡检与 personal / supervisor / worker 一样是配置里的职责；验收 Agent 与产品 / 技术 / 运营 Agent 在同一份共享现场协作。红线不动：独立评审者 ≠ 产出模型、不替代原发起人确认验收。
- **判断三层、模型按需**：确定性工程层（`runtime-guard.ts` 的 fast → semantic → budget、`modelCalls=0` 的确定性抽取）先过滤 → AI 层只处理判不准的少数并记账 → 人层保留目标 / 边界 / 高风险联签 / 最终核可；必达消息不受过滤影响。
- **沉淀回流与自演进**：打回原因 → 自查标准 → 下次交付前强制先自查 → 候选改进 → 工程闸门（回放验证）+ 人审 → 版本 / 灰度 / 可回滚 → 效果对比。Agent 可提出改进但不能自己生效，不得自动改写已锁定清单、权限规则、人签红线或历史任务。
- **评估口径改造**：`assessThreeTier()` 的 P3 / P4 改为按当前配置判定，扁平配置下不要求出现 supervisor；否则小团队为凑绿会被逼着硬造管理层。L1–L5 水位单独只读呈现，不与 `recommended` 混为一谈。
- **C 分步清单因此扩展为 C-0 → C-6 + 收尾**：新增 C-6「沉淀回流与自演进闭环」，C-3 / C-4 / C-5 的验收标准同步改写，见 `HANDOFF/06-CURRENT-STATE-AND-NEXT.md`。

每阶段验收必须跑：全套回归（303+ 单测、tsc、两个构建、响应式、走查、上游审计、diff-check）+ `npm run routing:status` + `npm run host:smoke`。

---

## 7. 严格边界（未发生，不是 bug）

- 本轮**没有改运行路由判断、没有新增 tab / 路由、没有切换默认底座、没有改上游源码**。
- 干净业务 Trace 当前只有 2 条真实策略准入事件；其余 stage 的真实事件需对应业务动作触发，不能靠伪造数据凑齐 P1。
- 真人在真实业务单「确认验收」仍未发生（SUI-129 未核可）；合并 / 发布 / CI / 报告 / 模型判定都不替代它。
- Cognee 原生 `cognify` 的真实外部模型调用仍未发生（缺端点与凭据）；4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态。
- 真实姓名、`open_id`、密钥与业务正文只在 `.runtime`；`.runtime/routing/` 与 `.runtime/local-host/` 均不入库。

## 8. 参考来源

- <https://github.com/earendil-works/pi>（Pi，MIT core；原 `badlogic/pi-mono`）
- <https://github.com/agentscope-ai/CoPaw>（Apache-2.0）
- <https://copaw.agentscope.io/>（CoPaw 文档）
- 腾讯云开发者社区《游向开源的海洋：腾讯云自研 AI 助手 Octop 正式开源》（MIT）
- 字节 DeerFlow 2.0 开源报道（MIT）、n8n Sustainable Use License
- LobeHub Community License、玉伯 OPT 访谈（详见 `ARCHITECTURE-OPTIONS-v0.7.md` 第 7 节）
- 本地：`src/upstream.ts`、`src/harness-composition.ts`、`src/coordination.ts`、`src/assistant.ts`、`src/service-network.ts`、`docs/UPSTREAM-ADAPTERS.md`、`docs/OPEN-SOURCE-COMPLIANCE.md`
