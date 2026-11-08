# OpenMausBot 参考评估（2026-11-08 · 第二十四轮后的外部候选调研）

> 仓库：`https://github.com/milind-soni/OpenMausBot`，固定提交 `3f81576655ca45af91bfaaa63dc37251222828eb`（tag v0.1.148，2026-11-08 仍在提交），17,116 star / 2,417 fork / 839 open issues，TypeScript，7,221 个文件（`server/` 2,612 个 TS、`docs/` 250 篇 md、`evals/` 71 个文件）。
> 方法：完整 clone 到本机临时目录通读 README、`docs/` 关键文档、`server/` 核心源码、`shared/` 契约、`skills/`、`evals/`。下文路径均相对 OpenMausBot 仓库根；本仓库路径单独标注。
> **本轮只做调研，未引入任何代码、依赖、submodule 或服务**，本仓库 7 个上游与 `sources.lock.json` 的 `sources` 不变。

## 0. 许可证边界（先读）

- 主体 **Apache-2.0**，`NOTICE` 记载 © 2026 Milind Soni and OpenMausBot contributors，且明确「由 MIT 重新授权为 Apache-2.0，已取得此前贡献者同意」。因此历史 release 可能是 MIT、当前 `main` 是 Apache-2.0；固定来源必须锁当前提交。
- `enterprise/` 是**独立的 OpenMausBot Enterprise License**（source-available，生产运行需 license key、禁止再分发与第三方托管），**不属于 Apache-2.0，禁止当作可复用代码**。删除该目录后余下为 OSS 版。
- `NOTICE` 还列了第三方条款（T3 Code MIT、Cua Driver MIT / SIL OFL / MPL-2.0 等）。若将来真要复制文件，须按本仓库 R7 六步逐项核验。
- 结论：**本轮建议只借思想、零代码引入**；这与既定方向 (a)「不引入第 8 个上游」一致。

## 1. 它是什么 / 整体架构

「聊天应用形态的 Agent 团队」：侧栏每个 bot 是本机真实 CLI Agent（Claude / Codex / Grok / ACP / OpenAI-compatible），各有自己的模型、computer、connected apps 与审批流；local-first，数据落 `~/.openmausbot`。

两进程模型（README `## How it works`）：

```
App（React + Tailwind, 5199） ── HTTP typed commands ──► Harness server（127.0.0.1:8799）
        ◄── 单一 SSE 事件流 ───────────────────────────────┤ Driver registry / Event bus / Permission broker
                                                            ├──► 本机 claude / codex / grok CLI
                                                            ├──► Boat API（云端 computer）
                                                            └──► Composio Session（Gmail / Slack / …）
```

- `server/contracts.ts` 的 driver SPI 刻意很小：`ProviderDriver` 只有 `driverKind/metadata/install?/decodeConfig/defaultConfig/models/create()`；运行面 `ProviderAdapter` 为 `sendTurn/interruptTurn/respondToRequest/steer?/hasSession/enginePid?/stopAll/onEvent/cacheKeepWarm?`。
- `server/harness/registry.ts` 把配置变成活实例，未知 driver / 坏配置产出 `ShadowInstance`（只让该实例 `unavailable`，**整支 fleet 不崩**）。
- `server/harness/bus.ts` 把各 provider 原生协议归一成 `shared/runtime-events.ts` 的 `RuntimeEvent` 联合，按线程写 `0600` 的 NDJSON transcript，带 `redactSecrets`、有界队列（4,096 条 / 32MB）、terminal 事件强制 flush、落盘失败只告警不撒谎；`server/sse-fanout.ts` 有背压（只丢 screen 帧）、心跳与 Last-Event-ID 重放。

## 2. 用户点名的六块，逐域拆解

### 2.1 Router / 决策模型

- `docs/decision-model.md` + `server/decider/`：一条**独立的「快决策缝」**，与干活的模型分离。房间 responder 设为 Auto 时，对「没有 @ 点名」的消息，1.5 秒内问一次小模型（TypeSafe Jev 或 OpenRouter decisions model）选哪个 bot 回答。
- 输入是有界状态：`{room, humans_in_room, bots_in_room, recent_messages, new_message}`，出机前 `redactSecretsInText` + 去附件，字段按 80/120/400/500/6000/8000 字符裁剪（`server/decider/room-routing.ts`、`server/host/room-routing-input.ts`）。输出 `ChoiceAnswer{choice,pTop,margin,probabilities}`。
- **校验 + fail-open**：choice 必须是被提供的选项、概率为 [0,1] 且和≈1、choice 必须是概率最大者、`pTop ≥ 0.6`；任何失败（无 key / 超时 / 429 / 529 / 畸形答案）都回退到「转 Auto 前的 lead，否则首个成员」。@点名 / @everyone / team goals 从不问模型。
- **两份留痕分账**：`server/decider/log.ts` 的 `decider-log/YYYY-MM.ndjson` 记 `seam/provider/latencyMs/pTop/stateHash`，**不含正文、bot 描述、密钥**；`server/decision-log.ts` 的 `decisions/YYYY-MM.ndjson` 记 `auto-approved/user-approved/...` 的授权结论，含 `rule/unattended/actor`。
- 本仓库对照：`src/router.ts` 是**确定性配置路由**（flat 1 跳 / layered 2 跳 / legacy 回退，`modelCalls=0`），有 `routerRevision()` 快照与 `planCoverage()`，但**没有独立决策缝、概率校验、fail-open 到兜底、以及「自动判断」的独立决策日志**。

### 2.2 Agent 定义 / 编制 / 分发

- `shared/wire.ts` 的 `WireBot`：人格 `name/title/description/soul(+soulHash/soulDrift)`、模型 `modelSelection/fallback[]/helperModel`、computer `computer/cloudBackend/cwd/browser`、能力 `playbooks/mcpServers/toolScope/assignedSkills`、权限 `approvalMode/autoApprove/alwaysAllow/approvePeerComms/peers[]`、编制 `section/chiefOfStaff/managedSections/reportsTo`。`server/peer-roster.ts` 按部门 + Chief 管辖区判权，明确「可达 ≠ 授权」。
- 团队包（`docs/team-sharing.md`、`shared/package-format.ts`）：一份带 YAML frontmatter 的 Markdown 可一键装出 bots / Chief of Staff / channels / playbooks / routines。**格式本身没有**聊天历史、密钥、模型选择、computer、权限字段；`docs/presets.md` 的 preset 是 allowlist；导入后 skills 默认关闭、routines 暂停、连接关闭；导出前二次密钥扫描 + 地址脱敏。
- 组织库用 `r`（发布态哈希）/ `w`（本机写入态哈希）逐部件合并，只在「发布方改了且本地没改」时更新，升级永不提权（`docs/org-library.md`）。**这是发布/合并式快照，不是可回滚的运行时快照**。
- 分发：`docs/runtime-contract.md` 定义每个 turn 是一棵 `Assignment` 树，状态只在 `runtime.db` 一处，`tick()` 是唯一准入/派发入口，10 条不变量（拒回祖先、dedupe、同一请求合并作答…）；`coordinate_bots` 建子树、子项 settled 自动 resume 发起者。`server/turn-dispatch-guard.ts` 用 generation 绑定 + 退休 turn 注册表隔离「迟到的 provider 完成事件」。`server/turn-outcome.ts` 的 `outwardActions()` 让「已对外发信/推送/付款」的被切断 turn **绝不重跑**。
- 升级：`docs/team-incidents.md` / `docs/team-escalations.md` 的事故与 gate 升级线程，Chief **只通知、不代人批准、不派活**，1 小时 3 次限速静音，无 Chief 回落给人通知。
- 本仓库对照：`src/agent-registry.ts` 已有「实例 + 可扩展职责 + 生效范围 + 内容哈希版本 + `registryRevision` 快照 + A2A handoff + 验收编组」，且**组织级唯一、项目只引用、变更留快照不回溯**，比它的 r/w 合并更严格。缺的是「团队包分发格式 / 导入最小权限」与「跨 bot 委托血缘树 / 迟到事件隔离 / 对外副作用决定重跑」。

### 2.3 Harness / 运行

`docs/runtime-contract.md` 的 Assignment 生命周期 `queued → running → completed|failed|cancelled`，交出工作转 `waiting`，向人提问转 `needs_input`；`server/runtime/runtime.ts` 的 `DEFAULT_LIMITS`（depth 4 / requests / executions / stalls）与 `validate()` 每 tick 重跑访问边界。`server/harness/live-steps.ts` 采样进程树判 `network/busy/idle`，`outputTail` 剥 VT 与密钥。ACP 启动期崩溃仅在「无模型/工具/文件活动」时换备用模型重试一次（`docs/verification/automatic-recovery.md`）。

本仓库对照：P-1 `StepQueue` + PG `SKIP LOCKED` + P-6 `TrackedStepQueue` 送达证据 + HITL 成对留痕 + 六态派生，已有「循环/会话/执行环境三者分离」与「已送达执行端」证据；**线性步进队列没有委托树血缘，崩溃回收也不区分是否已对外动作**。

### 2.4 Skill

`shared/skill-md.ts` 规定 `SKILL.md` 必须有 frontmatter（`name` 等于目录名、`description`），`server/skill-library.ts` 的 `manifest.json` 要 `id/name/version(x.y.z)/description/defaultEnabled/triggerTerms/requiredCapabilities`；`server/skill-storage.ts` 用 sha256 校验内容、`reviewState==="approved" && intact` 才启用、一次 rename 发布不可变 revision；`server/skills.ts` 按 bot manifest 链接进引擎 skills 目录；`server/skill-switch.ts` 让开启动作绑定 `contentSha256`，批准后内容变了就失效；导入的外部 skill 一律 `enabled:false`，开启须人在 Settings 做（`server/setup-import.ts`、`server/imported-skills.ts`）。内置 4 个 skill，其中 `create-verification-skill` 是**验证型 skill**（要求先真实跑通一条工作流再写）。

本仓库对照：**没有 Skill 体系**（仓库内无 `skills/`）。但 C-6 的「沉淀标准 → 交付前强制自查」正需要「可版本化、可导入、可关闭、默认不启用」的能力包载体。

### 2.5 MCP

- 出站（作为 MCP server 被外部编排）：`docs/mcp-server.md` 三簇工具 Inspect / Create / Run，**明确不暴露**：审批放行、记住授权、删除数据、导入团队、改凭据、computer/VM 生命周期；`server/mcp-server.test.ts` 用测试**硬断言**这些工具不存在，且每个工具 `additionalProperties:false` + annotations；transcript ≤200 条、search ≤100、去截图像素与 grant keys。
- 入站（用户自定义 MCP server）：`server/mcp-registry.ts` 区分 stdio / remote，最多 20 个，保留名拒绝、`OMB_*` 环境变量拒绝、URL 不得带凭据；`server/mcp-bot-rules.ts` 按 bot 归属限制谁能改；`server/mcp-gate.ts` 把 stdout 严格留给 MCP 传输、按 `ToolScope` 过滤、结果预算默认 8,000 字符。OAuth PKCE，token 存独立 `0600` 文件、改址即丢弃。
- 本仓库对照：`src/mcp.ts` **已有** stdio MCP server（17 个工具，含 `claim_task` / `publish_delivery` 等写动作，靠 `COLLAB_AGENT` 身份 + 服务端权限校验）；控制台另有 17 项只读白名单。缺的是「明确不暴露清单的机器化硬断言」「按身份的 toolScope / 工具预算」「出站与入站分离」。

### 2.6 评估体系（最值得看的一块）

`evals/README.md` 开宗明义 **「evaluate the harness, never the models」**：脚本化引擎确定性重放、零外部 API、hermetic。

- 三层：tier1 `pnpm eval`（每个 scenario 起一个**真实 harness server**，`evals/runners/run-scenario.ts`）；tier2 golden transcript 回放；tier3 live-model smoke。离线还有 `evals/evals.test.ts` 作为 CI 闸门。
- `evals/golden/trace/behavior-trace.ts` 把真实 thread 归一化成**故意不含参数值**的行为轨迹——只钉 tool 序列、`argKeys`、`errored`、handoffs、sends、outcome；`evals/golden/trace/diff-trace.ts` 输出逐行人类可读 delta；committed baseline 只有 `--update-baseline` 才能改；`evals/golden/golden.test.ts` 做双泄漏扫描并要求与 redactor 输出逐字节一致。
- `evals/scorers/assertions.ts` 15 种纯函数评分器对**冻结快照**打分（`handoffTree` / `turnOrder` / `gateAnswer` / `noActivityPrefix` …），scorer 自身异常也记失败。
- `evals/tool-choice/cases.json` 收 12 个「真实用错工具」的请求（中英德文），在 shipped 工具清单上验证模型是否还摸得到对的工具，并记录 `searched` 与成本；`OMB_EVAL_LIVE=1` 才开、**永不进 CI**。
- `evals/live/judge/judge.ts` 的 LLM judge 是**版本化 + manifest 按 sha256 钉死 prompt**（改文件必须 bump），verdict 用严格 zod 校验，防「话多的模型把场景夸过」。
- `evals/runners/run-skill-bench.ts` 双臂（with / without skill）对照，并给两个统计旗标：`non-discriminating`（两臂通过率相同 → 只是对照组，不是效果）与 `high-variance`（同臂重复判定翻转）。
- `docs/verification/README.md` 另有 100+ 篇人工/半自动验收配方，统一模板「证明什么 + Run 命令 + Evidence + Limits / Last exercised」，并明确「绿色单测不算用户流程」。

本仓库对照：有 445 例单测 + 各 `*-smoke.ts` 隔离真跑 + `docs/VALIDATION.md`，且 `src/evolution.ts` 的 `compareEffects()` 已有前后窗口四项效果对比与「缺观测即不可比」；但**没有行为轨迹基线、golden diff、纯函数快照评分器、tool-choice 回归集、双臂统计旗标、版本化 judge**。这是最大的真缺口。

### 2.7 审批与触发器（补充）

- 审批五级 Ask / Auto-accept edits / Approve for me / Full access / Custom（`docs/approval-levels.md`），但**任何级别都不替人回答问题**；`server/auto-approve.ts` 的 `autoVerdict` 是纯函数且顺序固定：问题工具 → no-grant、outbound → block、own-files-read 放行、web-search 白名单…；`shared/runtime-events.ts` 把 `request.opened` 分成 `permission` 与 `question` 两类卡片。
- 触发器三类：schedule（Croner 五字段 + IANA 时区）、webhook（secret 只显示一次、推荐 Bearer）、app-event（Composio 长轮询）；`server/app-triggers.ts` 的 cursor 只在 run 与文件都落盘后推进、按 `(triggerId,eventId)` 去重、未完成 run 的事件合并、`DEFAULT_MAX_PENDING_RUNS=3` 超出记 `skipped tooMany`；`docs/headless-cli.md` 的 CLI 有 `--json` 单文档与退出码契约（3 = 需要人回答、6 = `team apply --check` 发现变化）。

## 3. 逐项对照结论

| 域 | 本仓库现状 | 判定 |
|---|---|---|
| 确定性配置路由 + 配置快照 | `src/router.ts`、`src/routing-trace.ts` | **已有且更严**（`modelCalls=0`、不回溯） |
| 组织级 Agent 编制 + 版本快照 | `src/agent-registry.ts` | **已有且更严**（组织级唯一、项目只引用） |
| append-only 主干 + 投影 + 撤权 + checkpoint | `src/memory-log.ts` / `memory-projections.ts` / `memory-recall.ts` / `memory-checkpoint.ts` | **已有**；缺 `redactSecrets` 全文脱敏与「落盘失败只告警不撒谎」 |
| 单步队列 / 送达证据 / HITL 成对留痕 / 六态 | P-1 / P-6 三个模块 | **已有**；缺委托树血缘、对外副作用判定、迟到事件隔离 |
| 出站 MCP + 只读白名单 | `src/mcp.ts`、`scripts/console-server.ts` | **部分具备**；缺不暴露清单硬断言、toolScope 与结果预算 |
| 交付前强制自查 + 四项效果对比 | `src/evolution.ts` | **部分具备**；缺双臂统计旗标与行为基线 |
| 行为评测三层 / golden trace / tool-choice / judge | 无 | **真缺口（最高价值）** |
| Skill 能力包（版本化 / 导入默认关 / 哈希审批） | 无 | **真缺口** |
| 团队包分发 / preset allowlist / 二次脱敏 | 无 | **真缺口（中等价值）** |
| 自动决策留痕 / 决策与授权分账 | 有 `RoutingTrace` + 治理台账，但无「自动判断」独立日志 | **真缺口** |
| 外部服务一等入口（Jev / Composio / Boat / 语音） | 明确不放空入口 | **不该照搬** |

## 4. 值得做的差距清单（按价值排序）

| # | 缺口 | 建议做法（只借思想，零代码引入） | 前置条件 |
|---|---|---|---|
| 1 | **行为轨迹基线 + golden diff** | 复用本仓库已有的 `replayRouting` / `memoryReplayReport` 确定性重放，新增一层「归一化行为轨迹」：只钉动作序列、参数键、结果、交接树，丢弃参数值以便脱敏提交；committed baseline + 逐行 diff，只有显式更新才改 | 无外部依赖；可直接进 `scripts/` + `tests/` |
| 2 | **冻结快照纯函数评分器** | 把现有 smoke 的「过程断言」抽成对冻结快照的纯评分器，评分器自身异常也记失败；与第 1 项组成 tier1 行为回归 | 同上 |
| 3 | **双臂对照的两个统计旗标** | 在 `src/evolution.ts::compareEffects()` 上补 `non-discriminating`（两臂通过率相同）与 `high-variance`（同臂重复判定翻转，n≥2 才评估），避免把无效对照当成改进收益 | 已有前后窗口观测结构，改动局部 |
| 4 | **tool-choice 回归集 + 版本化判据** | 收集真实「选错动作」的中文指令，在本仓库已登记的只读动作表上做回归；判据/prompt 用内容哈希钉住，改动必须显式 bump | 若接真实模型需用户确认外发；确定性版可零模型 |
| 5 | **决策与授权留痕分账 + unattended 标记** | 独立 append-only 月度日志：工程层自动判断记 `rule/stateHash/latencyMs`（不含正文/密钥），人授权记 `actor/来源`；给「无人值守放行」显式标记。契合 C-P3 三层判断 | 与治理台账并列，不并入 B1 主干 |
| 6 | **出站 MCP「不暴露」清单硬断言 + toolScope 预算** | 给 `src/mcp.ts` 的工具集写一份机器化黑名单测试（审批放行 / 删除 / 凭据 / 导入 / 环境生命周期），并给每个工具补 `additionalProperties:false`、按身份裁剪与结果体积上限 | 不新增工具，只收紧 |
| 7 | **Skill 能力包最小版** | `SKILL.md` frontmatter + manifest（`version/triggerTerms/defaultEnabled`）+ sha256 内容校验 + 导入默认关闭 + 开启绑定哈希；优先承载 C-6 的沉淀标准与验收清单，而不是通用「技能市场」 | 需产品确认 Skill 是不是本仓库的一等概念 |
| 8 | **崩溃恢复区分「是否已对外动作」** | 在 `recoverStaleSteps` 之外补一条：步骤若已产生对外副作用（发消息 / 交付 / 发布），回收后标 `interrupted` 而不是重跑 | 与 P-1「旧 runToken 立即失效」兼容 |
| 9 | **委托树血缘 + generation 绑定** | 给 `StepQueue` 的每一步加父步 id 与 generation，跨 bot 委托时建子树；迟到完成事件不得结算新 turn | 对应剩余生产项「worker 内部子调用逐次拆分」 |
| 10 | **升级「只通知不代批」+ 限速静音** | 把 `Needs you` 与「人必达消息不受过滤」扩成有去重的升级通道，明确不代为批准；呼应 C-6 的「人被打断次数」指标 | 不新增网页发起入口 |
| 11 | **团队包：preset allowlist + 导入不提权 + 二次脱敏** | 只借「格式里没有权限/凭据/模型字段」「导入默认关闭」「地址与文本二次密钥扫描」；**不要**照搬 r/w 合并（会与本仓库「不回溯改写」冲突） | 组织级配置仍以 `agent-registry.ts` 为准 |

## 5. 明确不做（红线）

- **外部服务一等入口**：Jev / OpenRouter / Composio / Boat / ElevenLabs / Fish Audio 都是外部账号与计费服务，本仓库「没连接不放空入口」「不出现海外品牌作为一等入口」「不未经确认外发材料」不适用。
- **调外部小模型做路由**：`src/router.ts` 坚持 `modelCalls=0`、确定性优先。可借的是「独立决策缝 + 答案校验 + fail-open 到兜底 + 留痕」的**结构**，用确定性规则实现，或作为显式可选的 AI 层（须用户确认外发，且不得改变 `recommended=false` 防跳级闸门）。
- **五级审批分级 / 自动批准**：会放宽「Agent 完成 ≠ 业务验收」「核心决策点仍由人」；本仓库 P-6 已把「问题」独立成 `human_question`，且 `human_response` 明确不等于验收，比自动批准更严。只借「approval 与 question 分离、任何级别不代答问题」的防呆。
- **`enterprise/` 任何代码**：独立 source-available 许可，禁止复用。
- **整仓 / submodule 引入、Electron / PTY / 语音 / 手机端**：与形态无关，且违反不引入第 8 个上游的方向 (a)。
- **r/w 双哈希合并式快照**：本仓库「变更留快照、不回溯改写历史任务」是更严格的口径，不能被「升级时逐部件合并」稀释。

## 6. 结论

OpenMausBot 与本仓库是**两种产品形态**（个人/小团队的 bot 聊天应用 vs 高信任团队的协作台与验收责任链），整体架构、桌面壳、外部服务接入都不该搬。真正有价值且本仓库确实没有的，集中在**「怎么证明一次协作行为是对的」**这条线上：行为轨迹基线、冻结快照评分器、双臂统计旗标、tool-choice 回归、版本化判据（第 1–4 项），其次是**工程层自动决策的独立留痕**与**出站 MCP 的不暴露硬断言**（第 5–6 项）。这些都可以在不引入新上游、不接外部模型、不放宽人签红线的前提下用 TypeScript 自研落地，且能直接复用本仓库已有的确定性重放与效果对比结构。

第 7–11 项需要产品拍板或属于既有剩余生产项，已登记为 `HANDOFF/08-OPEN-DECISIONS.md` 第 12 条；**接手者不要擅自开始实现或引入外部服务**。
