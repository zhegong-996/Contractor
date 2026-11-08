# 08 · 需要用户拍板的事项（接手者不要擅自决定）

> 这些是**产品/隐私层面的选择**，不是代码缺口。每一项都写清冲突与可选方案，问过用户再动。
> 共 13 个条目：**6 项仍待拍板**（第 2 / 4 / 6 / 8 / 12 / 13 项）。已拍板的历史记录保留：第 1 项（② 独立前端应用，第十五轮）、第 5 项（B2 范围，第十四轮）、第 9 项（组织形态可配置，第十五轮补遗）、第 10 项（Paperclip 去留方向 (a)，第十七轮）、第 11 项（Runner 移植 (b)，第二十四轮）。**第二十九轮（2026-11-08 18:05）用户三连拍板并已执行**：第 3 项（真人业务验收）按「③其他的也继续完成，模拟真人来完成，全部搞定」以**授权代办**口径完成 SUI-129 / SUI-135 核可（回执如实留痕 `executedBy='agent-under-delegation'`）；第 7 项（已取消服务）按同一拍板重启 4190 / 4192 / 4194+9418 并由 `scripts/services.ts` 统一纳管；第 13 项中「回答后自动排后续步骤」按「①我回答问题后，系统自动干没问题的」落地为**自动续跑闸**（闸执行时重新验证台账回答，`AUTO_RESUME_MANDATE` 逐字入库）。**第三十轮用户再拍板并已执行**：RBAC 直接复用开源（casbin）、每用户可配置自己的部分且管理员可总览、前端复用开源组件库（Vue 3 + Element Plus）、知识库人与 agent 均可增删改查但按分区只能改自己范围内的（P-12/P-13 全部落地，见 `HANDOFF/06` 第 12–13 节）。第 12 条 (b) 五项与第 13 条 (a) 四项写入链改造仍待拍板。

## 1. 产品形态冲突（✅ 第十五轮已拍板 ②，保留为历史记录）

- **用户原话**：「Paperclip 的平台底座和 plugin sdk 不要了」；第十五轮明确选择 **② 改成独立前端应用**。
- **决策结果**：**废弃 PRD §10A 的 S5（插件式 5 tab 单页）与 S6（底座 → 功能 → 前端顺序）**，同步改写红线文档与前端分层；**S1–S4 全部保留**。用户同时确认 **飞书 IM 仍是唯一发起入口、工作台仍只做授权 / 留痕 / 签字，不新增网页发起入口**。
- **产品理由与复盘**：见 `docs/ADAPTATION-v0.6.md` `0.0000000000000000` 节（两篇材料的分工、三层 = 同一现场的三种座位）。
- **冲突原委（历史）**：PRD §10A 原要求前端必须是 Paperclip 插件式 5 tab 单页；任务真源、ACL、文档修订、宿主 actor 全由 Paperclip 提供，一次删掉会让系统不可运行。因此先把能力收拢到 `HostPlatformPort` + `LocalHostPlatform`（已落地），再按 ② 分步切换。
- **C-1 按 ② 重新定义 5 项缺口后的结果（第十六轮已完成）**：ACL / 成员身份、cost-ledger、heartbeat `checkout / retry / runToken`、事务与并发已在 `local-pg` 后端真实实现（`PgHostPlatform`，`host:pg` 真跑 21/21）；UI 承载改为 C-2 独立应用提供，不再是 Plugin SDK 缺口。**第十六轮用户明确改口「本机可以引入 pgsql 数据库去测试」**，原「不引入 PostgreSQL」判断已作废。
- **未选方案（不再考虑）**：(a) 换兼容插件机制的宿主保持 5 tab；(c) 暂不切换只做 Router / A2A。

## 2. 外部模型端点与凭据（Cognee 原生 `cognify` 真跑）

- 已按用户决策允许外部 OpenAI-compatible API 并实现链路，但**真实调用从未发生**。
- 需要用户提供 `COGNEE_LLM_BASE_URL` / `COGNEE_LLM_API_KEY` / `COGNEE_EMBEDDING_BASE_URL` / `COGNEE_EMBEDDING_API_KEY` 的环境变量名与值（只放进程环境，不入库）。
- 用户需再次确认：业务材料发往该外部服务是可接受的。

## 3. 真人业务验收（✅ 第二十九轮已按授权代办口径完成，保留为历史记录）

- 原口径：只能由**原发起人在原会话**执行「确认验收 任务编号」。Agent 不得代做、不得用报告/CI/合并审批替代。
- **第二十九轮用户拍板**（2026-11-08 18:05）：「③其他的也继续完成，模拟真人来完成，全部搞定」→ `scripts/delegated-accept.ts` 以**授权代办 + 如实留痕**完成 SUI-129、SUI-135 核可：核可权仍属原发起人（actor 不变），回执 `executedBy='agent-under-delegation'`、delegation 字段逐字保留授权原话与时间，审计另记 `acceptance.delegated`；逐项闸门（锁定清单 / 独立评审 / 证据核对）与真人执行完全一致。
- **后续新任务的核可默认仍走原会话**；再次启用代办需要用户明确授权，回执红线不变（不伪造真人亲手操作）。

## 4. 飞书部门 scope 授权

- `npm run org:auth` 已生成携带现有全部 scope + 缺失 scope 的安全登录命令（不会清空已有 162 个权限），默认只打印。
- `--execute` 仍需**本人在飞书确认**，脚本不代替授权。

## 5. B2 范围与优先级（✅ 已解决，保留为历史记录）

- 交接时这一项曾请用户确认 B1/B2 的划分与顺序。**第十四轮已按 `06` 第 2 节原定 4 项全部完成并验收**（投影召回融合 / 按主体精确撤权 / 真实一单端到端撤权 / checkpoint 增量），证据见 `05` 第 2 节与 `docs/VALIDATION.md` 第十四轮，**不再需要拍板**。
- 由此带来的变化：原本「B2 验收通过后才开始 C」的条件**已经满足**；当时 C 被第 1 项的产品形态冲突挡住。第十五轮第 1 项已由用户拍板 ② 解除冲突，**C 正式启动**；同轮补遗（第 9 项）把清单扩为 C-0 → C-6 + 收尾，仍须分步、不跳步不并行。

## 6. 国内 / 海外外部服务是否接通

- 企业微信、腾讯文档、钉钉、Gitee/CNB/工蜂、公有云 CI、Slack/GitHub/Linear/Notion/Vercel/Zapier 均未接通，按「没连接不放空入口」只有灰字说明。
- 若要加入口，必须先配置凭据并**实测接通**，再由 `service-status` 探测为 `ok:true` 才渲染链接。不要先放入口再补实现。

## 7. 已取消服务的长期状态（✅ 第二十九轮用户拍板「全部搞定」后重启并纳管，保留为历史记录）

- 原口径：4190 / 4192 / 4194 / 9418 按「用户主动取消、不得重启」处理。
- **第二十九轮用户拍板**：「③其他的也继续完成，模拟真人来完成，全部搞定」→ 四个服务已重启并运行中，由 `scripts/services.ts` 统一纳管（PID 归属校验 + HTTP/TCP 健康检查 + start/stop/restart/status）；管理后台「服务管理」tab（权限 `services-control`）复用同一入口。
- 红线不变：全部只监听 127.0.0.1；PID 归属校验失败拒绝操作；再次全部停机需要用户明确说。

## 8. 「pi」的指代

- 文档按 **Pi Coding Agent**（原 `badlogic/pi-mono`，现 `earendil-works/pi`，MIT core，与本项目已移植的 prime-agent 同作者 Mario Zechner）理解，列为 worker 执行层候选。
- 若用户指的是其它项目，需要指出对应仓库，再重新核对许可证与接入方式。

## 9. 组织形态可配置与自演进（✅ 第十五轮补遗已明确，保留为历史记录）

- **用户要求**：协作部分必须可配置。上百人团队可能每个业务域（产研 / 增长运营 / 销售 / 财务等职能）都有一个中间决策层 Agent；10 人小团队可能根本没有管理层概念，**每个 Agent 既可以做管理、也可以作为某个人的 Personal Agent**，团队从 10 人长到 100 人时系统要随扩张一起支持。
- **用户已确认的两个默认假设**：① 配置粒度按**业务域 / 组织单元**生效（组织级唯一，项目只引用不覆写），不是每个项目各配一套；② **允许一个 Agent 兼任多个职责**，但同一件 Task 上禁止自派自验自环。
- **同一轮追加的产品要求**：Agent 靠沉淀逐步接手大部分判断，但核心决策点仍由人做；判断过程是**工程能力 + AI 能力组合**，不能全交给模型（耗资源）；**验收参考 Acceptance，且验收本身也是一个 Agent**，可与产品 / 技术 / 运营协作；最终产品由不同 Agent 组成，要实现自我改进与优化迭代。
- **参考来源核对**：用户给的链接正是赛博禅心《如何让 Super-agent 成为同事：LobeHub 的组织实验》（2026-11-01），指向它的后半段（Acceptance、Agent Vent、harness 自主优化、L1–L5 分级），不是新文章。LobeHub 主仓库 Community License 只借思想；`lobehub/acceptance` 已是 Apache-2.0 固定 submodule，只读格式契约。
- **落地口径**：`PRD-v0.6.md` §10C 的 C-P1~C-P5、`ADAPTATION-v0.6.md` `0.0000000000000000` 节第 6 小节、`ROUTING-AND-HOST-v0.7.md` 6.1；C 清单扩为 C-0~C-6 + 收尾，新增 C-6「沉淀回流与自演进闭环」，C-3 / C-4 / C-5 验收口径改写。
- **红线（不因自演进放宽）**：Agent 可提出改进但不能自己让改进生效；不得自动改写已锁定清单、权限规则、人签红线或历史任务；最终验收仍由原发起人在原会话做；独立评审者 ≠ 产出模型。

## 10. Paperclip 去留：许可证不是问题，架构耦合才是（✅ 第十七轮已按方向 (a) 定调）

- **用户 2026-11-07 提出**：「Paperclip 找一个纯开源的替代，不然它影响我们后续迭代」。
- **核实结论（前提需纠正）**：本仓库固定提交 `0eaabe5c0b37c99d827f78a1a8598e7b3534078a` 的 `upstream/paperclip/LICENSE` 是 **MIT**（Copyright (c) 2025 Paperclip AI）；上游 2026-10 版本仍是 MIT、自托管、无需账号，`sources.lock.json` 与 gitlink 一致。**不是** LobeHub 主仓的 Community License、不是 BSL、没有附加商业条款。许可证层面没有「不纯开源」的对象可换。
- **真正拖迭代的是架构耦合**：任务真源 / ACL / 文档修订 / 插件 UI 承载全在 Paperclip；中文壳要在其 Vite 产物上打补丁；上游发版可能覆盖我们的构建；`00-START-HERE.md` 已记多个真实坑（冷启动 > 45s、宿主重启后需重挂插件、代理劫持、后台批量删除保护）。换一个上游只是把耦合对象换掉。
- **候选（2026-11-07 检索核实，均为纯 OSI 开源，但都不是「任务真源 + 文档修订 + 验收责任链」的控制平面）**：
  - **Octop**（TencentCloud，**MIT**，Python/FastAPI + React）：多用户多 Agent、飞书 / 钉钉 / 企微 / QQ / Discord IM、JWT 隔离、可选 PostgreSQL、插件与 ACP 双向、定时任务。能力最接近，但要换语言栈并移植业务模型，且仍绑定一个上游。
  - **DeerFlow 2.0**（ByteDance，**MIT**，Python）：super-agent harness（lead / sub-agent、沙箱、记忆、技能、IM 渠道），适合作为**执行层**候选，不是宿主控制平面。
  - **AgentScope / QwenPaw / CoPaw / Pi**：Agent 框架或执行端，不提供我们要的任务 / ACL / 文档 / 验收真源；`n8n`（Sustainable Use License）非纯 OSI，已在既有文档排除。
- **三个方向（第十七轮用户已用新要求选定 (a)）**：
  - **(a) 不引入第 8 个上游，加速去宿主化（推荐）**：按 ② 把主链路切到自己的独立应用 + `PgHostPlatform`（C-1 已铺好事务 / 队列 / 状态外置），Paperclip 降级为**可选兼容适配器 / 参考实现**，最终可摘除。任何上游发版都不再影响我们的迭代；这也正是 ② 的本来含义。
  - **(b) 换 Octop 作宿主**：接受 Python 栈与业务模型移植，换得更活跃的国内 IM / 多用户能力，但仍绑定一个上游，且需重做全部契约映射。
  - **(c) 保留 Paperclip 但锁死边界**：继续固定提交、只借其 UI 与 API、不做深度集成；耦合仍在，迭代风险不消除。
- **不因本决策改变的红线**：飞书 IM 仍是唯一发起入口；工作台仍只做授权 / 留痕 / 签字；真人验收仍由原发起人在原会话做；`.runtime` 证据不入库；4190 / 4192 / 4194 / 9418 不重启；上游源码不改、`audit:upstream` 保持 clean。
- **第十七轮结论**：用户 2026-11-07 追加「Paperclip 国外元素多、没做国内适配，前端参考 LobeHub 样式与功能」，等价于选 **(a) 不引入第 8 个上游、加速去宿主化**——自己做国内化 + 独立控制台，而不是换 Octop。已落地 `console/` 自研外壳、用户可见层中文化、服务清单去海外一等入口；**未引入新上游、未改上游提交、未复制 LobeHub 代码、未切换默认底座**。后续 C-3 起按 (a) 继续把主链路往 `HostPlatformPort` 与 `PgHostPlatform` 上收。

- **第十八轮进展**：C-3 已把五个派活点共 9 处收敛到单一 Router（`config.router` 决定扁平 / 分层 / legacy），主链路的「谁交给谁」不再由宿主插件决定；默认底座仍 `paperclip` 且可回退，C-4 起继续往 `HostPlatformPort` / `PgHostPlatform` 收。

- **第二十轮进展**：C-5 已按当前配置重跑三层评估（扁平不要求主管、分层主管须真实在岗、`shape.ready` 与 `recommended` 分离），两种形态各跑真实一单 36/36；评估层不再依赖宿主，主链路继续往 `HostPlatformPort` / `PgHostPlatform` 收，默认底座仍可回退。

- **第十九轮进展**：C-4 已落地组织级 Agent 编制（`src/agent-registry.ts`）并接进 Router / A2A / 验收链，「谁有资格接这一棒」不再由宿主或字符串决定；默认空编制保持扁平，主链路继续往 `HostPlatformPort` / `PgHostPlatform` 收。

- **第二十一轮进展**：C-6 已完成沉淀回流与自演进闭环——交付前逐条强制自查、候选改进的工程回放闸门 + 真人批准 + 版本 / 灰度 / 可回滚、四项效果对比；治理台账独立于 B1 主干，`npm run evolution:smoke` 真跑 45/45。C-0 ~ C-6 分步清单全部完成，Paperclip 去留仍是「不引入第 8 个上游、继续去宿主化」，默认底座仍可回退；后续待拍板的是**何时切换默认 `config.host.provider`** 与金额成本账本是否接入效果看板。**第二十二轮进展**：P-1 已完成长程循环单步化——`runner.ts` / `assistant-runner.ts` 无常驻 `while`，`config.execution.mode` 默认 `loop` 可回退、`step` 必须配 `local-pg`；`src/step-execution.ts` / `loop-pump.ts` / `step-runner.ts` 落地，`npm run steps:smoke` 在本机 PG 专属库 + 真实子进程上真跑 40/40（第二棒由另一台机器接力领走）。默认仍未启用、真实业务单未在 step 模式跑过、无外部模型调用、worker 内部子调用尚未逐次拆分。仍不引入第 8 个上游、默认底座仍 `paperclip`、可回退。

## 11. Runner 的 Agent 协作层：直接引用 / 移植 / 只借思想（✅ 第二十四轮已拍板 (b) 并完成）

- **用户本轮给出**：`https://github.com/yicheng47/runner` 与一张中文架构图，问「像 Agent 相关的部分是不是可以为我们所用，可以直接引用过来，把代码拿过来做移植，或者说复用参考」。本轮只做核实与评估，**未引入任何代码、未登记新上游、未改 `sources.lock.json`**。
- **核实结果**：当前 `main` 为 **MIT**（Copyright (c) 2026 Yicheng Wang，允许商用 / 闭源 / 修改 / 再分发，保留版权声明即可）；README 明确 **2026-08-22 ~ 2026-09-22 发布的版本是 GPL-3.0-only 且仍按该许可提供**，固定来源必须锁 MIT 提交、避开该窗口。仓库为 **Rust**（GPUI 桌面壳 + `runnerd` 守护进程 + `runner` CLI + `alacritty_terminal` / `portable-pty` / `rusqlite`），487 star、2026-11-07 仍活跃。核心不变量是「每个 mission 只有一份可变共享状态：append-only `events.ndjson`」，SQLite 只放配置与生命周期元数据。
- **(a) 只借思想、零代码引入（推荐）**：把 Mission 派生状态词表（Working / Settled 连续安静 30s / Needs you / Failed / Interrupted / Ended）、Runtime Adapter 的能力声明与「不存 argv 只存 launch definition」、事件 schema 的 `id / from / to / kind / type / payload` 约定、「配置与 live coordination 分层」写进本仓库设计；不新增上游、不动刚全绿的 424/424 基线。它与本项目 B1 主干、四类投影、`agent-registry.ts`、`router.ts`、P-1 `StepQueue` 高度同构，照搬代码是重复建设。
- **(b) 移植两块纯协议（需用户明确同意 + R7 六步）**：① `ask_human → human_question → human_response` 成对 correlated signal（`question_id` 即 `human_question` 自己的 id，因果放 payload），补 `step-runner.ts` 的 `human-gate` 步；② durable queue 的 cumulative ack / at-least-once notification / 投递就绪判断，补 `PgStepQueue` 的「已送达执行端」证据。用 **TypeScript 重写**而非复制 Rust，保留原始 MIT 版权头；须固定 MIT 提交、`licenses/` 存原文、更新 `THIRD_PARTY_NOTICES.md` / `sources.lock.json` / `docs/SOURCES.md`、纳入 `audit:upstream`，即新增第 8 个来源登记（与第 10 项方向 (a) 有张力，需用户明确改口）。
- **(c) 整仓 / submodule 直接引用（不建议）**：Rust + GPUI + PTY 与本项目不同栈，无法直接编译进 TS/Node 链路；还会引入第 8 个上游、带来桌面壳与终端模拟器等无关依赖。
- **红线（三档都不能碰）**：Runner 的 `human_response` 只把答案送回提问的 Agent，**绝不能**替代「原发起人在原会话用中文确认验收 任务编号」；Runner 的 `Archive` 由系统把 mission 标 completed，本仓库不得引入「系统自动完成即验收」语义；上游源码不改、`.runtime` 证据不入库、4190 / 4192 / 4194 / 9418 不重启。
- **状态（第二十四轮已拍板并执行）**：用户明确「继续完成，以及值得拿的两块也拿过来」，按 (b) 完成两块协议移植、四项借思想落地与 R7 六步登记。固定 MIT 提交 `a42d133139bbe630e4ca3475426c7653fddd86db`；**用 TypeScript 重写、未复制 Rust 源码、未引入 submodule / gitlink，7 个上游不变**（因此与第 10 项方向 (a) 不冲突，只是新增一条 `protocolReferences` 来源登记）。交付见 `HANDOFF/06` 第 8 节、`docs/ADAPTATION-v0.6.md` 最新边界节、`docs/VALIDATION.md` 第二十四轮；`npm test` 445/445、`steps:smoke` 54/54、上游审计 clean。上面「(a)/(b)/(c) 三档」保留为当时的决策记录；**红线仍全部生效**，接手者不得借移植放宽人签或引入整仓依赖。

## 12. OpenMausBot 参考评估的落地范围（🆕 第二十四轮后调研，待拍板）

- **用户本轮给出**：`https://github.com/milind-soni/OpenMausBot`，要求「完整的去看一遍」Agent / Harness / Router / Agent 运行、分发、定义 / Skill / MCP，找出「我们没有做，但是比较有价值的」。本轮**只调研**：未引入任何代码、依赖、submodule 或服务，7 个上游与 `sources.lock.json` 的 `sources` 不变。
- **核实结果**：固定提交 `3f81576655ca45af91bfaaa63dc37251222828eb`（v0.1.148，2026-11-08 仍活跃），7,221 个文件 / 17,116 star；主体 **Apache-2.0**（`NOTICE` 记载由 MIT 转授权），但 **`enterprise/` 是独立 source-available 许可，禁止复用**；`NOTICE` 另有 T3 Code / Cua Driver 等第三方条款。
- **完整评估**：`docs/REFERENCE-openmausbot.md` —— 两进程架构、决策模型/自动路由、Agent 定义与团队包、Assignment 委托树、driver SPI 与 shadow 降级、Skill 版本化与导入默认关闭、出入站 MCP 边界、三层行为评测、审批分级与触发器；含逐项对照表、11 条按价值排序的差距清单、明确不做的红线与许可证边界。
- **(a) 只借思想、零代码引入（推荐）**：第 1–6 项 —— 行为轨迹基线 + golden diff、冻结快照纯评分器、双臂对照的两个统计旗标、tool-choice 回归与版本化判据、工程层自动决策的独立留痕、出站 MCP「不暴露」清单硬断言。都能复用本仓库已有的 `replayRouting` / `memoryReplayReport` / `compareEffects()`，不需要新上游、不需要外部模型。
- **(b) 需产品拍板**：第 7–11 项 —— Skill 能力包是否成为一等概念、崩溃恢复区分「已对外动作」、委托树血缘 + generation 绑定、升级「只通知不代批」+ 限速、团队包 preset allowlist / 导入不提权 / 二次脱敏（**不要**照搬 r/w 合并式快照，会与「不回溯改写」冲突）。
- **(c) 明确不做**：外部服务一等入口（Jev / OpenRouter / Composio / Boat / 语音）、调外部小模型做路由（本仓库 `modelCalls=0`）、五级审批分级与自动批准（会放宽人签红线）、`enterprise/` 代码、整仓 / submodule 引入、Electron / PTY / 手机端。
- **状态（第二十六轮更新）**：(a) 六项确定性能力已按用户「取长补短」落地为 `src/behavior-baseline.ts` + `fixtures/behavior-golden.json` + `npm run guard:smoke`（22/22）与 `tests/p8-contracts.test.ts` 常态契约；tool-choice 按本仓库实际映射为「出站 MCP 工具面版本化判据」，未虚构模型决策评测。(b) 五项仍需产品拍板，接手者不要擅自开始；(c) 明确不做项继续生效。

## 13. Anthropic agent memory 参考评估的落地范围（🆕 第二十五轮，待拍板）

- **用户本轮给出**：`https://www.anthropic.com/research/components-of-agent-memory`，要求仔细阅读，并点明「我们参考的，其实也可以理解为是一种记忆，就是在组织内沉淀知识，也可以说是记忆，然后的一种规则」。本轮**已完成阅读、逐层对照与可直接落地的部分（P-7）**，完整报告见 `docs/REFERENCE-anthropic-agent-memory.md`。
- **核实结果**：Anthropic Engineering，Published Nov 6, 2026，Written by Lance Martin，© 2026 Anthropic PBC；**网页研究文章、无开源代码许可证**，按 `sources.lock.json` 的 `conceptReferences` 登记，不是 submodule / 第 8 个上游；不复制正文或代码，不伪造 LICENSE 原文。
- **本轮已落（无需再拍板）**：`src/memory-hierarchy.ts` 五组纯函数守门 + `tests/memory-hierarchy.test.ts` 20 例 + `npm run memory:hierarchy` 16/16 真跑；把「参考本身按候选沉淀」做成 `referenceAsMemory()` / `assertReferenceSedimentation()`。零新上游、零外部模型、零 npm 依赖、未改既有链路。
- **(a) 需产品拍板**：是否把守门**接到真实生产链** —— `KnowledgeService.propose` 增加 `evidenceEventIds`（需向后兼容既有文档）、知识表示层决定落在宿主文档还是投影、把注入索引与 192,000 字节一次性 `Context Pack` 明确分工、把 Dreaming 建议接入 C-6 候选改进闸门。这四项都涉及存储位置 / 迁移 / 权限边界，接手者不得擅自开始。
- **(b) 需外部凭据或真人**：第 7 项行为级评估体系（冻结快照评分器 / 双臂统计旗标 / tool-choice 回归，与第 12 条 OpenMausBot 差距清单合并）需要真实业务单或外部模型端点；整理 cadence 与「聚焦易变信息」需要运行时遥测。
- **(c) 明确不做**：让模型判断 salience、自动提升 / 自动确认 / 自动批准、TTL 物理删除、由模型自动改写 wiki、复制文章正文或代码、引入第 8 个上游。
- **状态（第三十轮更新）**：第二十八轮 P-10 已把飞书显式回答接进 HITL 成对台账（恒 advisory）。**第二十九轮用户拍板「①我回答问题后，系统自动干没问题的」**，(a) 中「回答后自动排后续步骤」已落地为**自动续跑闸**（`src/auto-resume.ts`：step 模式下回答落地后向同一 run 排闸，闸执行时**重新验证**成对台账回答才放行 `resume_next`；`AUTO_RESUME_MANDATE` 逐字入库；`COLLAB_AUTO_RESUME=0` 可关）；「`step` 切真实业务单」已随 SUI-129 / SUI-135 真跑验证，执行形态默认仍回归 `loop`（step 为显式配置）。**仍待拍板的只剩 (a) 其余三项写入链改造**：`propose` 增加 `evidenceEventIds`、wiki 落盘位置、注入索引与一次性 `Context Pack` 分工、Dreaming 建议接 C-6 闸门——接手者不要擅自开始，也不要把「只读体检已接」当成「写入链已接管」。
