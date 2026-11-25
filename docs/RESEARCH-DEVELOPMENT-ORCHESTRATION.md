# 一张研发工单怎样从派发走到验收

2026-11-25 源码对照。Contractor 基线为 `54153708b318`。下文的源码链接固定到本次读取的提交。Agent Orchestrator 选取 ComposioHQ 的实现。GitHub Checks 依据 GitHub 公开的 OpenAPI 和 REST 接口，服务端实现不公开。对上游测试的引用表示读过测试及断言，本次运行的是 Contractor 的回归。

## 一张单的六个问题

| 人要知道什么 | 权威记录 | 在 Contractor 哪里看 |
| --- | --- | --- |
| 现在谁交付，轮到谁行动？ | 工单职责、有效的决策记录及其接收权限 | 工单首屏、待我处理 |
| 当前是哪一个 Worker 在写？ | 工单的执行轮次、设备、租约和停止回执 | 执行记录、设备状态 |
| 对方是否接到决定？ | 答复、接回、决定实际装入的执行快照 | 协作动态、研发决策 |
| 多人协作还缺什么？ | 必需子单、有效交付版本、当前资料授权 | 主单的必需结果 |
| 这次到底有什么证据？ | 仓库、PR、提交 SHA、检查来源和运行 ID | 本版代码核对、CI 运行记录 |
| 以后可以复用什么？ | 有权人的按版验收、知识候选、采用与来源授权 | 测试与验收、知识与记忆 |

以「门店推荐理由」为例，开发者提交一版小屏改动后，请负责人决定是否调整验收范围。负责人答复，开发者接回；原 Worker 接续时重新核权，并在快照里记录实际装入的决定。若同一 SHA 的新检查超时，界面同时保留前一次通过与本次超时。只有本版必需检查满足项目策略且有权人完成验收，才进入知识候选流程。

## 源码里的机制及取舍

### Paperclip · 领取工单与唤醒执行

在 `issues.ts` 的 checkout 路径中，已属于本轮的锁可以复用；接管旧锁时传入预期的旧运行号并核对结果。是否唤醒接单者另有判断。四个测试分别覆盖人工操作、Agent 在活跃轮次领取自己的单、缺少轮次和代其他 Agent 领取。前端的 Inbox 又单独记录用户是否在交互，选择合适的时机采用新排序。[领取实现](https://github.com/paperclipai/paperclip/blob/5347c01de5bc00f4933a975b28d280ea9001339b/server/src/services/issues.ts#L13165-L13248) · [唤醒条件测试](https://github.com/paperclipai/paperclip/blob/5347c01de5bc00f4933a975b28d280ea9001339b/server/src/__tests__/issues-checkout-wakeup.test.ts) · [待办排序](https://github.com/paperclipai/paperclip/blob/5347c01de5bc00f4933a975b28d280ea9001339b/ui/src/hooks/useInboxSortAttention.ts)

Contractor 已有[执行租约接口](../src/workbench/execution/contract.ts)、[回执重放账本](../src/workbench/receipt-journal.ts)和[待办排序保护](../workbench/src/inbox.tsx)。值得沿用的是三个身份分开记录：交付负责人、当前待行动人、当前可写的执行轮次。某人接回决定，可以更新待办；是否再次派工，还取决于原单能否接续。切换机器时，过了心跳期限仍须核对旧执行确已停止。

### Agent Orchestrator · 观察到变化，何时值得打扰人

在当前 Go 实现中，PR 观察与向会话发送提醒分别处理。合并冲突的去重记录可在确认恢复后单独解除；观察到不确定状态时保留原记录。审查回传还区分排队、已到达、开始前失败；早先一个尝试仍排队或已经到达，就不重复转发。重连测试检查活动时间能否保持，以及控制代次或提供方身份变化时是否拒绝旧重连。[PR 变化与恢复](https://github.com/ComposioHQ/agent-orchestrator/blob/e2070ea642f80d37e335c364a2aa9522c2c1d359/backend/internal/lifecycle/reactions.go#L389-L430) · [回传状态](https://github.com/ComposioHQ/agent-orchestrator/blob/e2070ea642f80d37e335c364a2aa9522c2c1d359/backend/internal/lifecycle/review_done.go#L41-L97) · [重连测试](https://github.com/ComposioHQ/agent-orchestrator/blob/e2070ea642f80d37e335c364a2aa9522c2c1d359/backend/internal/lifecycle/chat_reconnect_test.go)

Contractor 的执行回执已按轮次与租约处理重放。下一项值得补的是**同一个问题真正复发**的场景：同一个 PR 连续报告冲突，只需一次提醒；明确解决后再发生，允许生成新的待办；中途的未知状态不能触发第二次提醒。该规则适合放在 PR 观察记录上。IM 继续投递同一个业务待办，避免每个渠道各算一次。

### Sheepdog · “等人”需要一张能处理的待办

`verify_receipt_no_dead_ball` 在启用对应规则时，会核对“需要决策”的回执是否真有未结提问，也检查账本里是否留下无人可接的等待。决策中心的测试验证两处卡片可指向同一个事项，任一处点完即可结清；重复提问可原地更新。它也使用文本匹配检查某些报告，这是依赖具体沟通习惯的实现。[回执核对](https://github.com/Matthewoho/sheepdog/blob/084770e97a9b8d9f1bff215692bf1b32ccc63b06/sheepdog/decision_hub.py#L166-L204) · [两处卡片处理同一事项的测试](https://github.com/Matthewoho/sheepdog/blob/084770e97a9b8d9f1bff215692bf1b32ccc63b06/tests/test_decision_hub_and_alert_group_781.py#L229-L326)

Contractor 已掌握当前负责人、版本、SHA、待办和动作权限，可直接检查结构化记录。此次补的是一个用户原先看不到的事实：开发者请求决策后，负责人回答与开发者接回分别进入时间线；负责人主动交接、开发者填写接手说明时，一次动作只显示一次接手。撤回记录实际操作人及时间。旧记录缺精确时间时保留现有状态。[研发决策](../src/workbench/engineering-decisions.ts) · [工单时间线](../workbench/src/ticket-timeline.ts)

### ACP · 恢复对话与恢复写入权

协议仓同时包含 v1 和 v2 的 Rust 类型。v2 的 `session/resume` 可以显式提供 `replayFrom`。省略它会同步当前状态；要求回放时，游标包含对应位置，消费者需要去重。`session/cancel` 和取消某个 RPC 请求也有不同语义。v2 对已取消的前台工作要求发送最后的更新并报告 idle 和取消原因。采用时必须按实际客户端与 Agent 协商的版本及能力处理。[v1 类型](https://github.com/agentclientprotocol/agent-client-protocol/blob/d3ac0e6d8b1132c9a749a4210f04bb788c9a75a4/agent-client-protocol-schema/src/v1/agent.rs#L1967) · [v2 类型](https://github.com/agentclientprotocol/agent-client-protocol/blob/d3ac0e6d8b1132c9a749a4210f04bb788c9a75a4/agent-client-protocol-schema/src/v2/agent.rs#L1819-L1858) · [恢复与回放](https://github.com/agentclientprotocol/agent-client-protocol/blob/d3ac0e6d8b1132c9a749a4210f04bb788c9a75a4/docs/protocol/v2/session-setup.mdx#current-state-synchronization) · [取消协议](https://github.com/agentclientprotocol/agent-client-protocol/blob/d3ac0e6d8b1132c9a749a4210f04bb788c9a75a4/docs/protocol/v2/cancellation.mdx)

Contractor 当前的[执行能力判定](../src/workbench/execution-capabilities.ts)尚未开放 ACP 引擎。建议第一个适配器只接只读任务，保存协议版本、能力、外部 session ID 与回放位置。回放只补会话；设备租约、Token 结算、资料授权与可写范围仍由核心校验。准入测试应覆盖游标重叠、断线期间撤权，以及取消到达时仍有权限请求或后台工具在运行。前台进入 idle 只能证明该次前台工作结束，跨机器切换还需验证本地写入者已退出。

### GitHub Checks · 检查结论、门禁和人工验收

官方 OpenAPI 分别定义按 ref 列检查、读单次运行、列文件或行级 annotations、请求重跑。检查记录带 head SHA、App、运行 ID、过程状态和结束结论。一个运行已结束，可能是成功、失败、超时、取消、跳过、中性或要求人工处理。GitHub Actions 的 workflow run、attempt、job 与 check run 各有自己的标识。[固定版 OpenAPI](https://github.com/github/rest-api-description/blob/c9c95fe34ced05fe076001f5c55704742bc8e7f8/descriptions/api.github.com/api.github.com.json) · [Checks 官方接口](https://docs.github.com/en/rest/checks/runs)

Contractor 的[检查选择](../src/workbench/github-delivery.ts)已按当前 SHA 和指定检查来源挑选匹配运行；[产品验证](../src/workbench/github-product-verification.ts)再关联对应 job、workflow attempt 和制品。此次统一了页面显示：摘要显示项目门禁是否通过，具体检查保留原始结论。同 SHA 曾经通过而当前未通过时有明确提示。下一步可按需读取 annotations：先核对工单、版本、当前仓库和可读路径，再展示对应文件或行；覆盖无 annotations、源站拒绝及旧 SHA 迟到三种情况。服务账号的源站访问能力不可扩大成员的数据权限。

### AutoByteus · 可复用的职责与一次性的执行身份

研发团队定义把方案、实现、独立审查和验证分别交给对应职责，按工作范围选择审查路径。运行时区别更重要：`TeamRunMemberAuthority` 核对 root run、成员地址及活跃执行；已离队但正在收尾的成员与当前可接收任务的成员有不同权限。委派命令又区分按目录地址创建一次新执行，以及持已有执行标识接续分派。混合运行测试包含根执行停止、关闭后恢复子执行会话的用例。[研发团队定义](https://github.com/AutoByteus/autobyteus-agents/blob/8c2da3accdb28d7355f72a67df6a3e64e8c16453/agent-teams/software-engineering-team/team.md) · [成员运行权限](https://github.com/AutoByteus/autobyteus-workspace/blob/bc4351cad782cedc18682cde2b9305a9bff4530e/autobyteus-server-ts/src/agent-team-execution/domain/team-run-member-authority.ts) · [委派命令](https://github.com/AutoByteus/autobyteus-workspace/blob/bc4351cad782cedc18682cde2b9305a9bff4530e/autobyteus-server-ts/src/agent-collaboration/execution/task/task-delegation-command.ts) · [混合执行测试](https://github.com/AutoByteus/autobyteus-workspace/blob/bc4351cad782cedc18682cde2b9305a9bff4530e/autobyteus-server-ts/tests/e2e/runtime/mixed-task-delegation.e2e.test.ts#L878)

Contractor 已有项目职责、原子单接续和[必需结果撤权回归](../tests/workbench-delegation-access.test.ts)。建议在交接详情把“职责归属”与“本轮由哪个设备和 Agent 执行”并排展示。收尾阶段仅允许提交旧租约的停止及用量凭证。新增输入、资料读取、授权和继续写代码都要按当前权限判定。项目是否采用独立审查应由维护人设置，轻量任务可以直接走现行验收模板。

## 下一轮按什么顺序验证

| 顺序 | 研发场景 | 可判定的通过条件 |
| --- | --- | --- |
| 1 | 同一 PR 冲突、解决、再次冲突，其间重复回调并重启 | 第一次和复发各一条有效待办；未知状态不产生新待办；两次均回到原单。 |
| 2 | 开发者从失败检查下钻到改动文件或行 | 显示对应版本、SHA 和 check run；无权限账号看不到路径与摘要；外部缺证据时保留原检查链接。 |
| 3 | 已授权的只读 ACP Worker 断线后恢复 | 能力协商成功才显示为可用；重叠回放只入一次；撤权后隐藏受限内容；断线和取消均不重复派工或扣分。 |
| 4 | 多 Agent 主单中的一个执行成员退出并换端 | 原子单、职责和版本连续；旧端只能交回该轮收尾凭证；其他子单成果独立保留；必需结果齐后出现一条验收待办。 |

边界建议：状态、权限、租约、预算、交付版本和采用知识的规则留在业务核心。IM、SCM 事件、检查证据和会话协议各自通过适配器输入事实。工作台、飞书和其他 IM 展示同一业务记录，动作按当前用户权限提交。


## 本次验证

- 用现有研发测试单只读查询其 PR 当前提交的 GitHub Checks，两项指定检查均通过。浏览器使用候选前端读取同一工单，时间线与交付详情均能回看四条已保存的检查记录，包括历史失败。浏览器在登录后的核对阶段没有业务写入。
- 隔离的 SQLite 决策测试覆盖重启、改任负责人、旧 SHA、重复点击接回、开发者直接接手和维护人撤回。取消、超时、跳过、中性结果与要求人工操作等 Checks 分支使用受控夹具，逐项核对实际结论和门禁。
- 以上工作使用 Contractor 自研实现，没有新增上游源码、SDK、子模块或运行时依赖。ACP 互通、跨机器停止和恢复验证列入下一轮。
