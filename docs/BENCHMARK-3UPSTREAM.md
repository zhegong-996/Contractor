# 三上游对标：功能面 × 架构面（第四十轮 · 2026-11-09）

> 对标对象与固定提交（见 `sources.lock.json`）：
> **Agent Autoloop** `ba8cf6d`（MIT）· **DeepSeek Super-agent** `8c32a9d`（MIT）· **lobehub/acceptance** `f720feb`（Apache-2.0）。
>
> 口径先说清楚：
> - 只对标**钉住的代码**，不对标记忆里的产品宣传；
> - LobeHub 本体（lobe-chat）**没有** pin 进来，本仓库只借用其设计语言，不复制代码。
>   因此「LobeHub 的知识库 / Agent 分组 / 插件市场」在本表里标 **未对标**，不写成「已实现」；
> - 结论分四档：**领先**（我们更完整）、**持平**（能力等价，实现不同）、**落后**（对方有我们没有）、**不同**（目标不同，不构成优劣）。

## 1. 功能面

| 能力 | Agent Autoloop | Super-agent | Acceptance | SuitMe 现状 | 结论 |
|---|---|---|---|---|---|
| 事件接入 | 插件化 source（定时 / GitHub / 业务系统 / 轮询） | GitHub + 飞书，Source 插件 | 不涉及 | 飞书 / 钉钉 / 企微 / GitHub（轮询+webhook）/ 定时器 / 通用 `POST /events/:source` | **领先**（入口最多，且逐来源密钥 + 指纹幂等） |
| 规则派活 | `rules.json`：`when{source,types|cron}`、`to`、`cwd`、`parallel`、`group`、`tell` | Ticket + Mandate，按 Thread 归属 | 不涉及 | 例程（interval / daily / cron）+ 事件分流 + 并发上限 + 窗口合并 | **持平**（上游是声明式规则文件，我们是配置 + Router；表达力接近，形态不同） |
| 路由分层 | 无（事件直接到 Agent） | 主 Session → Ticket Executor，两层 | 不涉及 | legacy / flat / layered 三档，最多两跳，主管必须真实在岗 | **领先**（层是配置，可降级可回退） |
| 直通（订阅绕过闸门） | 无此概念 | **有**：Subscriptions，bypass gate，grants no new authority | 不涉及 | 有：`pass-through.ts`，同会话补充说明接续，结构上不含 scope 字段 | **持平**（语义对齐；上游多了 hand-back / release 的完整生命周期） |
| Agent 编制 | `agents` 表 + `access: read/edit/full`（目录访问级） | Executor 绑定 worker | 不涉及 | 组织注册表：职责 / 生效范围 / 版本 / 在岗；交接信封；自派自验拦截 | **领先**（组织级职责与范围，非单机目录权限） |
| 权限模型 | 通道 answerers + askFirst + 目录 access | allowed list + admission table + **strength 三档**（explicit / inferred / not admitted） | 不涉及 | casbin RBAC：人四级 + Agent 三档 + 知识三分区 + 范围校验 | **不同**：我们更细（分区+域），上游更细在「准入强度」——这一点我们**落后** |
| 知识库 | 无（只有 memory 目录） | 无 | 打回记忆（criteria / 失败例 / 变更） | 知识空间三分区 + 状态机 + HMAC 可复用闸 + 证据锚点 + L1/L2 图谱 + 语义检索 | **领先**（上游均无知识库） |
| 记忆 | 会话续跑 + 轮次统计 | Ticket 内上下文 + 订阅线程 | 打回经验回流 | 共享记忆主干（append-only）+ 四类投影 + checkpoint + 团队记忆 + Dreaming 建议 | **领先** |
| 验收 | 无清单，人拍板后继续 | 人 accept 后继续 | **最完整**：checks → 跑真实产品 → 截图/录屏/日志报告 → 逐条打回 → 记忆 | 清单开工锁定 + 逐项判定 + 视觉证据 + 独立评审 + 只读工作台 + 一条链接报告 + 打回沉淀 | **持平**（方法对齐；上游的区域标注+线程讨论交互更成熟，我们只有区域数据层） |
| 自动化 / 调度 | 内核 cron + due + 唤醒复查 + 合并排队 | 无（事件驱动） | 不涉及 | 定时调度器 + 晚启动补跑窗口 + wake 复查 + 并发上限 + 跳过留痕 | **领先**（多了「跳过不能静默」与密度默认值） |
| 注意力预算 | `tell: always/needed/never` + 卡片重发策略 | 「占用最少人类注意力」哲学 + 通知规则 | 不涉及 | outbox 统一护栏 + 人类必达放行 + 升级限速静音 + 钉钉/企微镜像同一预算 | **持平**（上游的 `tell` 更简洁，我们的预算更可审计） |
| 部署形态 | 单机一条命令，零依赖 | 单 repo，DeepSeek Harness 插件 | 跟随宿主 | 单机多进程（bridge/console/paperclip/vision/report/delivery），127.0.0.1 | **不同**：我们重，但换来组织、权限、验收、审计；安装体验**落后**于 autoloop |
| 交付流水线 | 审代码 → 检查 → 合并 → 上线 → 核对 | 产出 PR | 不涉及 | 本机 Git + CI + 独立审码 + 预览 + 版本证据；GitHub 只监听不交付 | **持平** |
| 成本可见 | 轮数 / Token / 费用统计 | 无 | 不涉及 | PG 成本账本 + 工作台「本月花费 / Run Activity」 | **持平** |

## 2. 架构面

| 维度 | Autoloop | Super-agent | Acceptance | SuitMe |
|---|---|---|---|---|
| 核心抽象 | 内核（event → rule → job）+ 四向插件 | Engine + 五个内部部件（Intake / Evals / Tickets / Assignments / Replies） | Skill + 报告契约 | 六层（会话 / 组织 / 协作 / 执行 / 知识 / 交付）+ 七个上游适配 |
| 状态与恢复 | SQLite + 状态外置，进程可退 | Store + Effects（事务内 enqueue，提交后执行） | 无状态 | PG 步进队列 + SQLite 事件 + append-only 主干 + checkpoint |
| 幂等 | 事件指纹 + job 状态 | 事务 + 回执（receipt） | 报告轮次 | requestKey / 时间槽 / 事件指纹 / idempotencyKey 四套幂等 |
| 可重放 | `decide.ts` 纯函数（时间与密钥作为入参） | Engine 命令同步、单事务 | 报告不可变 | `planRoute` 纯函数 + 路由 Trace 重放 + 记忆重放 |
| 扩展点 | 插件（source / agent / channel / pipeline） | Source 插件 + 工具 | Skill | 七个 pinned submodule + 适配层 + 插件工作台 + MCP |
| 回退策略 | 无（单形态） | 无 | 无 | `router.mode=legacy` / 本机 Git 优先 / 通道可关 / mirror 台账 |
| 审计 | 状态表 + 日志 | Store 事实表 | 报告即证据 | 全部关键动作入审计表 + 路由 Trace + 事件流 + 26 个只读控制台动作 |
| 权限落点 | 目录 access | 准入表 + Mandate | 无 | RBAC 策略文件 + 注册表范围 + 分区规则，三处交叉 |

## 3. 逐家结论

### 3.1 Agent Autoloop

**强在**：安装一条命令、零依赖、规则文件表达力好（`when.source/types` + `parallel` + `group` 合并）、
挂起零消耗做得最干净、`decide.ts` 把「同一输入同一决定」写成了硬约束。

**我们更完整在**：组织编制、权限分区、知识库、验收清单、审计。
**我们不如它**：安装与上手成本；规则文件这种「一份 JSON 说清全部」的表达方式，我们散在
`config.router` / `scheduler` / `eventInbox` / `agentRegistry` 四处，读起来更费力。

**已吸收**：步进执行与挂起零消耗、事件溯源、`parallel` 密度语义（第三十九轮按密度定默认值）、
cron 直接复用上游实现。

### 3.2 DeepSeek Super-agent

**强在**：授权模型最细——allowed list + admission table + **strength 三档**；
订阅（Subscriptions）的完整生命周期：Executor 拥有消息、越界 hand back、Ticket 结束时 release、
主 Session 只能 stop 不能 accept；「占用最少人类注意力」是写在哲学文档里的第一原则。

**我们更完整在**：知识库、验收、组织分层、交付流水线、多通道。
**我们不如它**：准入强度这一档（我们只有白名单 + 显式指令），以及 hand-back / release 的细化语义。

**已吸收**：飞书触发归一化、线程键、出站幂等、`policy.ts` 的策略/评估纯函数、订阅直通「不授予新权限」的口径。

### 3.3 lobehub/acceptance（+ LobeHub 设计语言）

**强在**：验收的产品完成度——区域标注、报告内线程讨论、多人分别确认自己负责的 check、
打回记忆（criteria / 失败例 / 变更）真的会回到下一轮。

**我们更完整在**：验收与任务、权限、交付流水线打通（清单开工前锁定、评审者≠产出方、人签链、
打回原因沉淀进团队记忆并回流为交付前强制比对）。

**我们不如它**：报告页的交互（区域框选只有数据层，没有点选交互；没有报告内讨论）。

**未对标**：LobeHub 本体的 Agent 分组、知识库、插件市场——没有 pin 代码，不能声称对标。

## 4. 本轮据此做的两件事

1. **把直通契约化**：上游「bypasses the gate and grants no new authority」这句话，落到
   `src/pass-through.ts` 的 6 种判定 + 结构上不含 scope 字段。见 [LAYER-CONTRACTS.md](LAYER-CONTRACTS.md) §2。
2. **把分层变成可复跑的证据**：40 条体检，直接调用 Router / 注册表 / 知识授权 / 验收工作台的真实实现。
   `npm run audit:layers`。

## 5. 下一步优先级（按差距大小）

| 优先级 | 事项 | 来源 | 说明 |
|---|---|---|---|
| P1 | 准入强度（explicit / inferred / not admitted） | Super-agent | 现在未登记的人在订阅线程里追问，只会被白名单挡掉；缺「推断候选」这一档 |
| P1 | 报告内讨论 + 区域点选交互 | Acceptance | 数据层已有 `EvidenceRegion`，缺前端交互与线程 |
| P2 | 订阅的 hand-back / release | Super-agent | 我们直通只有「接续 / 不接续」，没有「越界交回」 |
| P2 | 配置收敛为一份可读的「规则视图」 | Autoloop | 降低接手成本，不改运行时 |
| P3 | 安装体验（一条命令） | Autoloop | 与本机多进程形态冲突，需单独设计 |
