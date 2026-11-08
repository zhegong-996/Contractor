# 与上游 Agent / 协作平台的能力对比（2026-11-08 · 第二十六轮 P-8 后）

> 方法：只读通读 `upstream/` 下 7 个固定 submodule 的 README / docs / 关键源码，以及本仓库六环节实现；LobeHub 主仓库**未作为代码引入**（Community License，0 处代码引用），只依据本仓库 `PROJECT-SUMMARY.md` §5.4、`docs/ARCHITECTURE-OPTIONS-v0.7.md`、`docs/PRD-v0.6.md` 的记载，不编造其源码细节。
> 「Auto Agent」按仓库内已引入的 `KKKKhazix/agent-autoloop` 理解；「Super Agent」按 `deepseek-ai/dsh-superagent-prototype`；「Lobe Hub」按 LobeHub 主仓库 + 独立 Apache-2.0 的 `lobehub/acceptance` 区分对待。
> 本轮只做分析，未引入代码、未改上游、未启用任何新服务。

## 0 结论先行

**用户的定位判断基本正确，但要补三点**：本仓库确实处在「人」与「实际干活的 Agent」之间，但它不是透明管道，而是**持有治理权的协作控制平面**——任务/ACL 真源、验收标准、知识采用权与最终核可权都在这一层；Agent 报「完成」不改业务状态。执行端目前是**本机 CLI 子进程**（默认只启用 Codex），不是云端 Agent 服务；平台自己不调模型。

一句话：**把人的目标、授权和验收标准翻译成任务与证据，把执行交给外部 Agent，再把结果与请示带回给人，由人做最终核可。**

用户点名的六环节里，主链路都能跑；真正的差距不在「流程有没有」，而在**自主推理能力、运行时/沙箱、产品级在线形态、请示通道的多通道覆盖**。第七章有逐项判定。

## 1 先分清：这些项目不是一类东西

| 项目 | 形态 | 它自己是不是给终端用户用的产品 |
|---|---|---|
| Paperclip | Node server + React UI + Plugin SDK | **是**，`README.md:37-45` 自述「the app people use to manage AI agents for work」，有 dashboard 与手机端 |
| LobeHub 主仓库 | 聊天式 AI 应用（仅设计参考） | **是**，Workspace+Task、Personal Agent 单入口、Manager/Worker 三层汇报（项目文档归纳） |
| DeepSeek Harness | Agent harness / 插件框架 | **半个**，`README.md:19-39` 有 `dsh web` Web UI、headless、desktop、SDK 多种形态；自身即执行运行时 |
| Agent Autoloop | 本机自动化中台 + CLI | **否**，`README.md:19` 自述「没有后台界面」，`docs/protocol.md:366` 明列没有总览页/画布/多租户 |
| DSH Super Agent | 研究原型 / Harness bundle 插件 | **否**，`README.md:3,7`；依赖 `@deepseek-ai/dsh-*` peer |
| Prime Agent | Rust CLI / TUI 编程 Agent | **是**（单用户工具），不是训练框架；`/refine` 是改提示词/记忆的小改动 |
| Cognee | Python 记忆库 + API/UI/MCP | **否**（面向开发者集成），无业务任务语义 |
| `lobehub/acceptance` | Agent Skill + CLI 契约 | **否**，`skills/acceptance/SKILL.md` 由宿主 coding agent 驱动 |
| **SuitMe（本仓库）** | 本机可信模式的协作控制平面 | **是，但只绑回环**：飞书 IM 唯一发起入口 + 中文工作台 + 只读独立控制台；无 SSO / 真实员工入驻 / 生产发布 |

**这张表是最重要的前提**：拿一个「控制平面」去和「Agent 运行时」「记忆库」「Skill 契约」比「能不能自己写代码」，本来就不是同一层的比较。下面把差距分成**能力缺失**与**刻意不做**两类，避免把分工误读成缺陷。

## 2 六环节逐项对照

| 环节 | 上游里最强的是谁 | 本仓库实现 | 判定 |
|---|---|---|---|
| ① 项目发起 | Paperclip（goal → hire team → approve and run、routines cron/webhook/API，`README.md:49-53,143`）；LobeHub（人只听自己的 Personal Agent，`ARCHITECTURE-OPTIONS-v0.7.md:99`）；Harness（Web/CLI 发起会话） | 飞书 IM 唯一入口，7 条中文指令 → Thread → Task/Ticket → Mandate；`src/user-language.ts:56-88`、`src/controller.ts:115-159`；`src/server.ts:529-541` 消费 `im.message.receive_v1`。真实消息证据见 `docs/VALIDATION.md:7-17,95` | **能闭环，但入口单一**：只有飞书 IM，没有网页 / 桌面 / 移动端发起，也没有聊天式多轮自由对话 |
| ② 过程监管 | Paperclip（dashboard / Task Threads / run history / Activity & Events）；Super Agent（Panel 六 Tab + Ticket stages + Report 六态）；Harness（append-only SessionEvent 日志）；Autoloop（`/v1/runs/N/why` 时间线） | `RoutingTrace` append-only + 单一 Router 五维契约 + 开工前锁定 Acceptance Plan + 逐项报告 + 独立评审者≠产出模型 + 治理台账 + 交付前强制自查 + `memory-guard` 只读体检 | **责任链比上游更严**（上游 7 个仓库都未找到「职能 owner / 开工前锁定验收清单 / 原发起人最终核可」的明确实现）；但**独立视觉评审链当前是断的**：`acceptance.mode=independent` 指向停机的 4190（`docs/VALIDATION.md:149`；`README.md:177`「端点停机时会失败而不是自动降级」），且我们没有产品级实时看板，控制台只有六视图只读 |
| ③ 交接 | Super Agent（Assignment / Subscription / hand-back / resume / restart）；Autoloop（session resume + browser handoff 模板）；Paperclip（delegation / reporting lines / Atomic checkout）；LobeHub（Manager/Worker 三层、Agent 间直接交接上下文不丢） | `@a2a-js/sdk` 真接单（`src/service-network.ts:48-219`，只开放 GetTask/SendMessage/CancelTask）+ 组织级编制 + 在岗交接 + Router 扁平 1 跳 / 分层最多 2 跳 + 自环拦截；`agents:smoke` 43/43 | **能闭环，但边界明确**：上下文靠任务文档镜像，**不是 A2A task 上下文传递**（`ARCHITECTURE-OPTIONS-v0.7.md:53`）；默认空编制不硬造管理层；跨真实员工的生产验证未发生；未开放公网服务发现或任意远端 Agent 注册 |
| ④ 对接执行 Agent | Harness 自身即 agent-loop 运行时（model request + tool calls）；Autoloop 多 CLI 插件（claude/codex/acp/command）；Paperclip heartbeat + adapters + git worktrees；Runner / OpenMausBot 的 driver SPI + PTY（评估过，未引入） | spawn 本机子进程：`src/assistant-turn.ts:41-59` 起 codex/claude CLI，`src/runner.ts:48,57-65` 动态 import Autoloop `createWorker()`；另有 MCP 16 个 stdio 工具（`src/mcp.ts`）与 CLI 人工接单 | **能，但只到本机 CLI**：平台自己不调模型（确定性链路 `modelCalls=0`）；默认只有 `codex` 一个 managed 执行端 enabled；`step:once` 本机工具白名单只有 `sha256`；无沙箱、无 PTY、无多运行时注册表、无云端自动派单 |
| ⑤ 完结状态回传 | Autoloop 最完整：Result 有 done/nothing/failed/cancelled + ask/notice/resolve/later/events，**一个事务一次生效、可重放**（`docs/protocol.md:95-157`）；Super Agent Report → Ticket → Channel → Source；Paperclip runs/logs/usage/Activity | `/tasks/:id/receipt`（`src/server.ts:461-464` → `src/controller.ts:239-283`）、MCP `submit_checkpoint`、`assistant-receipt/result`、checkpoint 文档 + Trace；P-6 补了累计确认 / 至少一次通知 / 投递就绪证据 | **能，且口径更严**：回传只置 `waiting/executed/in_review`、issue `blocked/in_review`，**不等于验收**；最终核可只有 `confirmAcceptance()`。但 Autoloop 那种「事务化一次生效 + 可重放」的回执语义我们是**借它的 `resultFrom()` 解析**，不是自研等价物 |
| ⑥ 找人请示并继续 | **Autoloop 最深**：`askFirst` / `ask` 卡片、飞书/钉钉/企微/Slack/Discord/desktop 多通道、`answerers` 身份核验、回答后接原会话（`README.md:31-64`、`docs/protocol.md:199-219,245-249`）；Paperclip approvals & review gates；Super Agent Attention / person|answer|review|blocked；Harness 工具级与计划级审批 | **主链路已闭环**：原生 `ask_user_questions` + `continuationPolicy:'wake_assignee'`，飞书「补充说明」→ `controller.reply()` 追加 comment、置 `phase='ready'`、wakeup/retry **自动启动下一轮**；`/collab 接续` 建子 run；SUI-4 真跑「接单、提问、PR、预览、验收结果均已在原消息回写」（`docs/VALIDATION.md:9-15`） | **必须分段看**：主链路能跑且有真实证据；**新的单步 HITL 台账（P-6）只到「提问 + 真人回答留痕」**——`npm run step:answer` 只有本机 CLI 入口，明确「不排后续步骤、不改任务状态、不等于验收」（`scripts/step-answer.ts:43`），飞书回答写入该台账的通道**未接通**（`docs/ADAPTATION-v0.6.md:66`）；且 `execution.mode` 默认 `loop`，单步链路只在 `steps:smoke` 54/54 里真跑过 |

> 容易混淆的一点：飞书**出站通知**通道是接通的（`src/server.ts:484-506`，SUI-4 已验证）；未接通的是「飞书入站回答 → 写入 P-6 的 `human_question`/`human_response` 成对台账」这一段，不是整个 IM 通道。

## 3 他们能完成、我们无法完成的（按价值排序）

分两类：**A 类＝真实能力缺口**（没实现 / 没凭据 / 没接通），**B 类＝刻意不做**（红线或产品定位，不是缺陷）。

| # | 差距 | 类别 | 依据 |
|---|---|---|---|
| 1 | **平台自身不能自主推理、自己多轮调工具写代码**。我们是确定性工程层，模型调用发生在被 spawn 的 CLI 里 | A | `HANDOFF/07:49` `modelCalls=0`；`src/step-runner.ts` 的 `model-call` 步无端点直接抛错「本机不编造模型调用」；对比 Harness `packages/core/agent-loop/README.md:10-12,73-75`、Super Agent `docs/005-panel.md:37-38`、Prime Agent `README.md:108` |
| 2 | **没有通用运行时 / 工具沙箱 / PTY / 多 CLI driver 注册表**。`step:once` 白名单只有 `sha256`，执行端默认只启用 codex | A | `src/step-runner.ts:18-54`；`PROJECT-SUMMARY.md:259` 远端工具沙箱与多机 Remote Tool Calling「明确未引入」；对比 Harness `packages/core/tools/README.md:10-12`、Autoloop `worker/agents.ts:39-48` |
| 3 | **新 HITL / 单步链路的请示闭环不完整**：无 IM 写回、回答不续跑、默认未启用 | A | `scripts/step-answer.ts:43`、`HANDOFF/07:34`、`docs/ADAPTATION-v0.6.md:66`、`HANDOFF/06:120`「真实业务单未在 step 模式跑过」 |
| 4 | **独立视觉评审链当前是断的**（4190 停机，且按用户要求不得重启） | A | `docs/VALIDATION.md:149`、`README.md:177`、`HANDOFF/07:20` |
| 5 | **没有产品级在线形态**：无 SSO、无真实员工入驻、无多租户、无公网服务发现、无生产发布 | A | `PRODUCT.md:7`、`docs/TEAM-NETWORK-MEMORY.md:40,62-64`、`HANDOFF/06:83`；对比 Paperclip `README.md:92,220,260`、LobeHub 产品形态 |
| 6 | **模型驱动的记忆与自整理**：Cognee 原生 cognify / embedding / LLM 实体抽取链路已实现但真实调用从未发生；模型判断 salience / 自动 Dreaming / 自动提升记忆 | A + B | `HANDOFF/08:17`「真实调用从未发生」；`docs/REFERENCE-anthropic-agent-memory.md` 第 7 节明确不照搬 |
| 7 | **多通道通知与统一回答人身份核验**（飞书/钉钉/企微/Slack/desktop + `answerers`） | A | Autoloop `README.md:31-64`；本仓库只有飞书一个会话渠道 |
| 8 | **L1–L5 自主度、Agent Vent、harness 自优化、组织体温闭环、Personal Agent 1:1 过滤层** | A + B | `docs/ARCHITECTURE-OPTIONS-v0.7.md:51,54,62`「未实现（仅设计参考）」；`HANDOFF/07:68` 不做员工 KPI 排名 / 情绪推断 |
| 9 | **外部服务一等入口、云端自动派单（Grok Bot / Cursor）、金额成本账本、Redis / 多机** | B | `HANDOFF/08:38`、`PROJECT-SUMMARY.md:259`、`README.md:100-101`、`HANDOFF/07:49` |
| 10 | **五级审批与自动批准、自动确认知识、无人值守最终验收、「系统归档即完成」** | B | `HANDOFF/08:91,101`；`docs/ADAPTATION-v0.6.md` P-6 节明确未引入 Runner 的自动完成语义 |
| 11 | **网页 / 工作台发起入口、控制台写动作** | B | `HANDOFF/07:30,39,44`「飞书 IM 仍是唯一发起入口」「独立控制台只开放只读动作」 |
| 12 | **真实业务单最终验收**：SUI-129 至今未核可 | A（只能由本人完成） | `HANDOFF/08:21-24` |

## 4 反过来：我们能、单个上游开箱不提供

这一层是自研加的**组织治理**，不是「上游做不到」——上游是库/运行时，本来不管这层；但把它们组装起来也不会自动得到下面这些：

- **组织级责任链**：三级 owner（组织级 / Workspace / 职能）、开工前锁定验收清单（标准由职能 owner 起草）、独立评审者不得是产出模型、**原发起人在原会话用中文「确认验收 任务编号」**。7 个上游仓库的已读文件里均未找到这三个概念的明确实现；最接近的是 Paperclip 的 org chart + approval gates，以及 acceptance 的 plan/checks（但 `SKILL.md:78` 明确「不要求常规人工 plan 审批」）。
- **默认隔离、按用途放宽**：临时授权绑定「本任务 + 指定执行身份 + 期限」，权限挂数据上不挂身份上；`grant-revoked` 按主体精确排除、`source-revoked` 全局阻断。
- **回传 ≠ 验收**：`Agent 完成 ≠ 业务验收`，报告 / 模型判定 / CI / 合并审批都不替代最终核可。
- **确定性可回放**：append-only 主干 + 四类投影 + 增量/全量 checksum 逐字节对照；Trace 写入是 advisory，失败不改业务结果；全套 499/499 单测与隔离真跑。
- **组织形态是配置不是骨架**：扁平 1 跳 / 分层最多 2 跳，不逼小团队硬造管理层；历史路由决策不回溯。
- **治理规则的机器化**：交付前强制自查、候选改进须过工程闸门 + 人审 + 版本 + 灰度 + 可回滚、只读体检不得拦截业务、冻结基线变更须留人审理由、出站 MCP「不暴露」硬断言。

## 5 对用户定位判断的确认与修正

> 用户原话：「我们这个相当于是一个人和干活的实际 Agent 中间的一个协作的平台，应该是这个样子的。」

**对的部分**：我们确实不自己推理、不自己写代码；实际执行交给被 spawn 的本机 CLI；发起、派单、监管、交接、收口、验收、请示都在这层编排；Agent 的「完成」只是回执，业务状态由人决定。

**要补的三点**：
1. **不是透明管道，是持权控制平面**：任务 / 成员 / ACL / 文档修订 / 审计的唯一真源是 Paperclip + PostgreSQL（`HANDOFF/07:41`），验收标准、知识采用与撤回、最终核可权都在这一层。Agent 不能自批。
2. **人不是一个人**：发起人、三级 owner、独立评审者、跨空间授权审批方（是目标 Workspace owner，不是申请方主管）、资料负责人各有不可下放的职责；最终核可只能由原发起人在原会话完成。
3. **执行端是本机 CLI 进程，不是云端 Agent 服务**：平台会 spawn 它并接收回执，但公网服务发现、云端自动派单、多机执行都未接通；确定性链路 `modelCalls=0` 不覆盖 CLI 自身发生的模型调用（那些进 `usage` 与回执）。

**双向流动的口径（第二十七轮 P-9 修订）**：用户明确指出「必须要有两条相反方向的移动……不能是单向的」。核查后确认：**主链路本来就是双向的**——下行 `/collab` 发起 / 授权 / 补充说明，上行回执 / `ask_user_questions` / checkpoint，人的补充说明经 `controller.reply()` 追加 comment、置 `phase='ready'`、wakeup/retry **自动启动下一轮**（`src/controller.ts:161-178`），SUI-4 有真实消息证据。真正断的是 P-6 新加的**单步 HITL 台账**：`step:answer` 原本只追加答案并明确「不排后续步骤、不改任务状态」，回答送回提问者之后就消失了。P-9 把这条半回路补上了（见第 7 节）。

**关于「全自动化」要分清**：本项目追求的是**流转自动化**，不是**决策自动化**。两条方向要自动接通、自动唤醒、自动把结果带回给人；但验收、放行、授权、核可这些决定权不下放给执行端，回执 ≠ 验收、回答 ≠ 放行。这是产品红线（`HANDOFF/07`），不是能力缺陷，也不是「没做成全自动化」。

## 6 参考产出复盘：前四轮参考偏在了哪里

用户问「我让你参考那几个开源项目，不知道你参考成了什么样子」。逐文件核对后的事实是：**四轮参考的产出全部落在治理 / 评估 / 只读体检侧，零项落在双向执行回路侧**。

| 参考对象 | 实际落地 | 性质 | 与双向回路的关系 |
|---|---|---|---|
| Runner（MIT @ `a42d1331`） | `src/step-hitl.ts`、`src/step-delivery.ts`、`src/mission-state.ts` | 成对留痕、送达证据、状态派生 | **拿了「留痕」，砍了「回流」** |
| OpenMausBot（Apache-2.0 @ `3f81576`） | `src/behavior-baseline.ts`、`fixtures/behavior-golden.json`、`tests/p8-contracts.test.ts` | 冻结基线 / golden diff / 双臂旗标 / 出站工具面断言 | 评估与守门，不参与执行链 |
| Anthropic agent memory | `src/memory-hierarchy.ts`、`src/knowledge-guard.ts` | 知识沉淀五条规则 + 只读体检 | 知识治理，与执行回路无关 |
| 上游七仓 | `docs/REFERENCE-capability-comparison.md` | 对比分析 | 只写报告 |

**最该纠正的一处**：Runner 的 `human_response` 原义就是「把答案送回提问的 Agent，让它接着跑」，本仓库只取了「编号即问题 id、因果放载荷」这个数据契约，却在 `scripts/step-answer.ts` 里主动写成「不排后续步骤、不修改任务状态」——把回路砍成半条。Autoloop 的 `ask / notice / resolve / later` 在本文第 2 节被判为「找人请示最深」，却没有把「回答后接原会话继续」落地；OpenMausBot 的 question / approval 卡片回写通道同样没接。更关键的是，`HANDOFF/08` 第 13 条把「回流缺口」登记成**待拍板**，等于用流程纪律把本该做的核心能力推回给用户。P-9 就是对这次偏差的纠正，不是又一轮「参考报告」。

## 7 双向回路落地（P-9）：耦合进具体代码执行链

按用户「从具体代码执行落地的过程来看，可以复用那些开源项目中的部分，把它们耦合进来」的要求，本轮不再另起孤岛模块，而是把协议接在**已有的执行链节点**上。

**先说清「复用」的真实层次**。本仓库 `src/upstream.ts:6-13,29-30` 本来就在运行时直接加载**未修改的上游源码**：`superagent/src/sources/feishu-trigger.ts` 与 `feishu-channel.ts`、`autoloop/worker/contract.ts`（`readMessage` / `resultFrom`）、`autoloop/worker/agents.ts`，以及静态导出的 `deepseek-harness/.../serialization.ts`；`acceptance-interop.ts` 复用 `lobehub/acceptance` 的报告 schema。所以「代码级耦合」在这条主链上是既成事实——`controller.receipt()` 里的 `resultFrom()` 就是上游函数。Runner / OpenMausBot / Anthropic 不直接 import 代码，原因是不同栈（Rust / Electron 桌面）、会引入第 8 个上游、`enterprise/` 是专有许可、且三者只提供协议思想；它们按 `sources.lock.json` 的 `protocolReferences` / `conceptReferences` 登记，用 TypeScript 重写协议语义，不复制源码。

| 耦合点 | 上游可复用部分 | 接进哪个执行链函数 | 作用 |
|---|---|---|---|
| ① 执行端 → 人 | Autoloop 回执 `ask / notice / later / outcome`（`upstream/autoloop/docs/protocol.md:141-167`，经 `resultFrom()` 解析） | `src/controller.ts` 的 `receipt()` → `fromAutoloopReceipt()` → `loop.upstream` 审计留痕 | 回执与提问登记成**上行**事件；回执强制 `expectsHumanAction:'review'`，不等于验收 |
| ② 人 → 执行端（任务入口） | 同一协议的 `continuationPolicy:'wake_assignee'` + 补充说明语义 | `src/controller.ts` 的 `reply()` → `mapFollowupToAnswer()` → `loop.downstream` 留痕；原有 `phase='ready'` + wakeup/retry 继续生效 | 人的回答登记成**下行**应答，与上行提问成对 |
| ③ 人 → 执行端（飞书入站） | Super Agent 的 IM 事件归一化（`upstream/superagent/src/sources/feishu-trigger.ts`） | `src/collaboration-intake.ts` 的 `ingest()` → `mapFollowupToAnswer()` → `loop.downstream` 留痕；原有 `delegate()` 唤醒不变 | 飞书「补充说明」写回通道接通，不改任务状态、不把回答当验收 |
| ④ 半回路闭合 | Runner `human_response` 回流语义（`protocolReferences.runner`） | `scripts/step-answer.ts` → `bridgeAnswerToResume()` → 独立 append-only `resume-proposals.jsonl` | 答案不再消失：产出明确的「下一步由原发起人在原会话接续」建议 |

`src/collaboration-loop.ts` 是这一层的**一等契约**（纯函数、零 IO / 零模型）：显式定义下行 8 类 / 上行 6 类动作，`loopReport()` 判出「完整回合 / 未应答上行 / 答完不回流 / 回执无人复核 / 单向推送段」，`attachImplicitReplies()` 让真人直接回一句「继续」也能按时间就近配对，`assertLoopAdvisory()` 焊死回执 ≠ 验收、回答 ≠ 放行、不得自动执行。只读 action `loop-guard` 汇总三处真实留痕。

**如实边界**：真实业务单尚未在这条链上跑过，所以 `loop-guard` 当前如实报 `bidirectional:false`、四个耦合点计数为 0，**没有编造事件把体检跑绿**；`npm run loop:smoke` 的 C/D/E 段用真实执行链函数在隔离临时目录跑通「提问 → 真人回答 → 回流建议 → 半回路闭合」。仍未做的仍是产品决策：自动排后续步骤、把 `step` 模式从 `steps:smoke` 推进到真实业务单、飞书回答直接写入 HITL 台账——这些会把「回答」变成「放行」，需真人拍板，不擅自推进。

## 8 口径来源

- 上游事实：`upstream/*/README.md`、`upstream/*/docs/`、`upstream/superagent/docs/00{1,2,3,5}-*.md`、`upstream/autoloop/docs/protocol.md`、`upstream/deepseek-harness/docs/{architecture,agent-lifecycle}.md` 与 `docs/subsystems/{approval,user-questions,workflow}.md`、`upstream/paperclip/README.md`、`upstream/acceptance/skills/acceptance/SKILL.md`。
- 本仓库事实：`src/server.ts`、`src/controller.ts`、`src/mcp.ts`、`src/assistant-turn.ts`、`src/runner.ts`、`src/service-network.ts`、`src/step-hitl.ts`、`scripts/step-answer.ts`、`docs/VALIDATION.md`、`HANDOFF/07-RULES-AND-BOUNDARIES.md`、`HANDOFF/08-OPEN-DECISIONS.md`、`docs/ADAPTATION-v0.6.md` 最新边界节。
- 本文是**对比分析**，不是权威口径；冲突时以 `docs/ADAPTATION-v0.6.md` 最新边界声明与 `docs/VALIDATION.md` 为准。
