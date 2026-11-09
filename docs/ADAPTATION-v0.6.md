# SuitMe 协作台 · 现有代码适配 v0.6 PRD 方案

> 日期：2026-11-05
> 对象仓库：`/Users/gong.zhe/Developer/ai-native-collab`（`github.com/zhegong-996/suitme-collab`）
> 依据：`docs/ARCHITECTURE-v0.6.md`（产品架构定稿）、`docs/PRD-v0.6.md`、Codex 会话「研究 AI Native 协作平台融合」、本仓库 `README.md` / `docs/*` / `sources.lock.json` / `src/*` / `git status`
> 立场：**以 PRD v0.6 为准绳，代码适配产品**。已有实现尽量保留，以「补层」为主，不推倒重来；工程红线见 `PRD-v0.6.md` 第 2.2 节。
> 状态：**方案已执行三十四轮**（底座 `f27a0e1`、功能补全 `7791c7b`、P3 前端增补 `c512c7b`、第四轮 L2 抽取 / P3 后半段 / 独立评审链 `255a5e9`、第五轮收尾 `78201c6`、第六轮 `285b97c`、第七轮 `7f33dd9`、第八轮 `c69e414`；第九轮见 0.0000000000 节，第十轮见 0.00000000000 节，第十一轮见 0.000000000000 节，第十二轮见 0.0000000000000 节，第十三轮见 0.00000000000000 节，第十四轮见 0.000000000000000 节，第十五轮见 0.0000000000000000 节，第十六轮见 0.00000000000000000 节，第十七轮见 0.000000000000000000 节，第十八轮见 0.0000000000000000000 节，第十九轮见 0.00000000000000000000 节，第二十轮见 0.000000000000000000000 节，第二十一轮见 0.0000000000000000000000 节，第二十二轮见 0.00000000000000000000000 节，第二十三轮见 0.000000000000000000000000 节，第二十四轮见 0.0000000000000000000000000 节，第二十五轮见 0.00000000000000000000000000 节，第二十六轮见 0.000000000000000000000000000 节，第二十七轮见 0.0000000000000000000000000000 节，第二十八轮见 0.00000000000000000000000000000 节，第二十九轮见 0.000000000000000000000000000000 节，第三十轮见 0.0000000000000000000000000000000 节，第三十一轮见 0.00000000000000000000000000000000 节，第三十二轮见 0.000000000000000000000000000000000 节，第三十三轮见 0.0000000000000000000000000000000000 节，第三十四轮见 0.00000000000000000000000000000000000 节）。文档按轮次保留历史记录，**最新边界声明以 0.00000000000000000000000000000000000 节为准**。

---

---

---

---

## 0.00000000000000000000000000000000 第三十一轮 ③c/③d：记忆写入链四项改造与 OpenMausBot 五项（2026-11-08 · 第三十一轮）

> **本节取代 0.0000000000000000000000000000000 节成为最新边界声明**。用户拍板「继续吧」，授权推进 `HANDOFF/08` 第 13 条 (a) 四项写入链改造与第 12 条 (b) 五项 OpenMausBot 差距落地。**全部只借思想、零代码引入，7 个上游与 npm 依赖不变**。

**③c 证据锚点（写入链第一闸）**：`KnowledgeService.propose/revise` 服务端自动追加一条 `fact-extracted` 记忆事件作为知识的事实源挂靠（idempotencyKey 防重，revise 带 contentHash 后缀）；调用方提供的 `evidenceEventIds` 逐条校验存在性，**悬空即抛错拒绝写入**；向后兼容既有文档（旧记录在 `memory-guard` / `knowledge-wiki` 体检中如实报缺口，不编造事件 id 跑绿）。红线 (c) 全守：不模型判 salience、不自动提升 / 自动确认、不 TTL 物理删除、不让模型改写 wiki。

**③c wiki 是投影不是第二事实源**：canonical 仍在 Paperclip 任务文档；`.runtime/memory/wiki-pages.json` 可随时重建（`knowledgeToWikiPages`：同 domain 互链防悬空、`claimEventIds=evidenceEventIds`、withdrawn 不进地图）；只读 action `knowledge-wiki` 体检 + 落盘投影（端到端真跑：27 记录 / 17 页 / 150 链接 / 0 悬空 / 17 断言无出处如实报 / bloated true 真实发现 / modelCalls 0）。

**③c 注入索引与 Context Pack 分工**：注入索引是 ≤200 行 / 25KB 的**持久小指针层**（只收 confirmed + 人签 + 证据 + 人审 `injected=true` 的条目标题），`collect()` 只带指针不带正文、不挤占 192KB 一次性 Context Pack 预算（manifest 不加新 kind，不动快照校验契约）；**提升只发生在人审确认**——review 的 `inject` 选项是唯一路径，revise 恒重置 false；无证据的旧记录即使人审确认 + inject 也不进索引（红线联动已端到端验证）。

**③c Dreaming 接 C-6 闸门**：`src/dreaming.ts` 纯函数建议（不模型判 salience）→ `registerDreamProposals` 焊红线断言后按 candidateId 查重 → `EvolutionService.propose` 登记进既有工程回放闸门 / 人审 / 灰度链；端到端真跑首跑 24 条建议（17 correct-note + 3 fill-gap + 3 merge-duplicate + 1 prune-page）全部登记、复跑 0 登记 24 跳过（幂等）；`dreaming-run` 写审计 `dreaming.run` 留痕。配套读分区 `canReadKnowledge`（personal 仅归属者本人 + admin 档；console 代理按真实登录用户判定，不借 bridge admin 越权）与控制台知识审核升级（reviewDialog inject 复选框、知识地图体检、离线整理入口）。

**③d 五项**：⑦ `src/skill-pack.ts`（SKILL.md frontmatter 键白名单、manifest `defaultEnabled` 恒 false、sha256 内容校验、开启绑内容哈希——篡改即失效需重开）；⑧ 对外动作**发生时**登记 `markOutwardAction`（steps 表新列 `outward_actions`，running 态生效、幂等去重、journal `STEP-OUTWARD`）+ 崩溃回收区分 `interrupted` 终态（携带已发动作清单、是否补跑由人决定）/ `ready` 可重试，**并修复两处真实红线缺口**——显式 `failStep` 对已对外动作的步同样标 interrupted（原实现校验失败会自动重试导致重复发信）、PG `recoverStaleSteps` 返回值漏带 status；⑨ steps 表新列 `parent_step_id`（跨 run 委托树，`lineageOf` PG 递归 CTE 深度封顶 32）+ `generation`（每次领取 +1，迟到旧 token 属旧代、完成校验天然拒绝）；⑩ `src/escalation.ts` 升级闸（同 (taskId, topic) 去重、1 小时 3 条限速、首达必送、文案恒「不代为批准」）接 `runtime-bridge.gateNotification`；⑪ `src/team-pack.ts` 团队包（权限 / 凭据 / 模型三类 17 键黑名单 + zod 白名单 + 6 类密钥二次扫描 + 导入只产候选引用不提权、unknownAgents 如实标出）。

**golden 基线人审重冻结（承接跨轮漂移）**：`fixtures/behavior-golden.json` 上次人审停在 P-9（19 项只读白名单）；P-12 Vue 重写更换了 console:smoke 检查集命名（removed 34 / added 134 键）、P-13 白名单 19→21、本轮 `knowledge-wiki` 21→22。全套回归（557/557、console:smoke 55/55 含六视图渲染与 425px、各隔离冒烟全绿）确认无行为退化后按既定流程手工重冻结并写 humanReview 第 3 条；真跑脚本仍不自动改写。另修三处陈旧断言（steps D3 / agents C-4 的 `card(` 前缀在 Vue 重写后失配、loop B3 的 `requiresHumanApproval` 在 P-11 后移到 `collaboration-loop.ts`），均为 P-11/P-12/P-13 轮未跑对应冒烟的累积漂移，非行为退化。

**真跑与证据**：`npm test` **557/557**、`tsc`、两构建、`steps:smoke` **61/61**（B21 对外动作回收 interrupted 不重跑 / B21b 显式失败同样不重跑 / B22 无副作用回收 ready / B23 委托树血缘 / B24 generation+1）、`host:pg` **24/24**（PG 真跑对外动作 / 血缘 / generation）、`console:smoke` **55/55**（+6：读分区三例 / 锚点 / wiki / 注入索引纪律）、`guard:smoke` 22/22、`loop:smoke` 18/18、其余隔离冒烟、走查 11/11、425px、`atlas:check`、`audit:upstream clean`、`git diff --check` 全绿。服务现状：3100 / 4180 / 4190 / 4192 / 4194(+9418) / console 4200 运行新代码。

**如实边界**：升级恒 advisory 不代批；团队包导入只产候选引用不提权；Skill 默认关且开启绑内容哈希；中断步是否补跑由人在台账上决定、回收器不擅自重放；默认底座仍 `paperclip`、执行形态默认 `loop`；飞书仍是唯一发起入口；无外部模型调用、无新上游、无新 npm 依赖。仍待拍板的只剩 `HANDOFF/08` 第 2 / 4 / 6 / 8 项（均属外部凭据或产品接入选择）。

## 0.0000000000000000000000000000000 第三十轮 P-12/P-13：casbin RBAC、用户级配置、Vue 前端重写与知识分区 CRUD（2026-11-08 · 第三十轮）

> **本节取代 0.000000000000000000000000000000 节成为最新边界声明**。用户拍板四件事：「对于涉及到权限管控 rbac 相关，直接找开源项目代码复用」「每个用户都可以配置自己的部分，管理员可以看到所有的，当然管理员也是一个用户，他也可以正常使用功能」「前端界面也做一个完整优化，复用开源代码和组件库」「知识体检……肯定也需要人可以增删改呀，agent 和人都可以增删改查，但是肯定是有对应权限区域的，像我们 agent 的几层架构一样，你只能改自己范围内的东西」。

**RBAC 直接复用开源（casbin 5.51.1，Apache-2.0）**：`src/rbac.ts` 统一封装——标准 RBAC model（`g` 角色绑定 + `keyMatch` 通配）+ FileAdapter 策略文件（`.runtime/console/rbac_policy.csv`，缺省从 `ROLE_PERMISSIONS` 种子生成，删文件即重置）；人四档 `owner/admin/operator/viewer` 走 `g` 绑定（`user:<name>` → 角色），agent 三档 `agent-supervisor/agent-worker/agent-personal` 按档位直判（matcher `r.sub == p.sub` 分支）；`ensureHumanBound()` 在判定前按 `accounts.json` 现绑自愈，解决 bridge 与 console 两进程策略快照不一致；`rbacEnforce()` 同步 fail-closed。bridge（`server.ts`）与 console（`console-server.ts`）两进程共用同一策略文件。R7 六步登记完成（精确版本 + integrity + LICENSE 原文 + notices + SOURCES + 审计机器校验），是 npm 依赖、**不是第 8 个上游 submodule**。

**用户级配置**：`ConsoleUserSettings`（默认视图 / 主题 / 刷新间隔 / 通知三开关 / 模型三项）——本人读写（`settings-get/set`，白名单键校验，API Key 只回打码 `apiKeySet`），管理员总览（`admin-users-settings`，新权限 `users-settings-view`，owner + admin；账号管理 `accounts-manage` 仍 owner 专属）。「管理员也是一个用户」：admin 照常使用业务视图与「我的配置」。

**前端重写（Vue 3.5.45 + Element Plus 2.14.8，均 MIT，本地 vendor）**：登录门 → 侧栏菜单 + 顶栏身份 → 概览 / 协作 / 知识 / 验收 / 服务 / 我的配置 + 管理（按 casbin 权限分区渲染八个 tab）。离线可用（vendor 本地、不依赖 CDN，CSP 加 `'unsafe-eval'` 供 Vue 运行时编译）；协作视图恢复组织形态 / Agent 编制 / 怎么派活 / 沉淀与自演进 / 长程执行五张契约卡与 `DOMESTIC_TERMS` 品牌词清洗；主题走 `html.dark`。R7 登记 + vendor 版本横幅（`vue v3.5.45` / `Element Plus v2.14.8`）由 `audit-upstream.ts` 机器校验。

**P-13 知识分区 CRUD**：`knowledge-create/update/delete` 写通道（console 注入 `actorUser`，bridge 端 `canCreateKnowledge` / `canWriteKnowledge` 判定 + 审计）；分区规则对齐 agent 分层架构——**personal 仅归属者本人（owner 也不行）**、team 需 `knowledge-write-team`（人 operator+ / agent worker 档）、org 更新 `knowledge-write-org` / 删除 `knowledge-delete-org`（人 admin+ / agent supervisor 档），agent 额外要求 `scopeCovers` 覆盖条目业务域；`propose` 强制 owner 为可信 actor（防伪造归属）；删除 = 软撤回（state → withdrawn，沿用 review 语义不物理删除），编辑已确认条目重置 candidate 等人重审。

**测试契约换代（不是改测试蒙过去）**：console-shell / agent-registry / evolution / shape-assessment / step-execution 等 8 个文件的源码断言从旧手写 DOM（`card(...)`、`[data-view]`）换成 Vue 结构语义；红线语义逐条保留（六视图、无网页发起、只读边界、中文产品词、职责中文名、空编制如实降级、内部字段名不暴露）。修掉 19 个回归失败，其中两处真实缺陷：`collaboration-intake.ts` 在 `execution` 配置缺省时抛 TypeError 被外层 catch 吞掉、人的只读回执通知没发（改防御式访问 `?.`）；`.runtime/config.json` 执行形态被 P-11 实验切到 step（maxStepsPerRun=7200），按 `HANDOFF/05` 交付口径回滚 `loop`。

**真跑与证据**：`npm test` **540/540**、`tsc`、`console:smoke` **49/49**（未登录 401 / viewer 越权 403 / 用户配置读写 / admin 总览 / 知识分区正负例：viewer 建 team 409、建改删自己 personal 200、admin 改他人 personal 409 / 六视图渲染 / 主题切换 / 425px / 零海外文案 / 登出后 401）；`audit:upstream clean:true`（含 casbin + Vue + Element Plus 三项新登记）；`git diff --check`。服务现状：3100 / 4180 / 4190 / 4192 / 4194(+9418) / console 4200 运行新代码。

**如实边界**：任务发起仍在飞书（静态页无原生表单、无 create-task 动作）；验收核可仍在原会话（第二十九轮授权代办除外）；默认底座仍 `paperclip`；执行形态默认 `loop`；前端显隐只是体验优化、判定以后端 casbin 为准；冒烟账号 smoke-viewer / smoke-admin 已禁用留痕。第 12 条 (b) 五项与第 13 条 (a) 其余写入链改造仍待拍板。

---

## 0.000000000000000000000000000000 第二十九轮 P-11：回答自动续跑、授权代办与服务统一纳管（2026-11-08 · 第二十九轮）

> **本节取代 0.00000000000000000000000000000 节成为最新边界声明**（当时）。用户 2026-11-08 18:05 三连拍板：①「我回答问题后，系统自动干没问题的」；③「其他的也继续完成，模拟真人来完成，全部搞定」。

**① 自动续跑闸（`src/auto-resume.ts`）**：`AUTO_RESUME_MANDATE` 逐字入库（授权可回溯）；step 模式下飞书显式回答落地后向同一 run 的步进队列追加「续跑闸」（human-gate 种类、带 `resumeOf`）；**闸执行时从成对台账重新验证** `human_response` 存在且 `acceptance !== true` 才放行 `resume_next` 工作步，验证失败重新提问——不盲信入队入参。`COLLAB_AUTO_RESUME=0` 可整体关闭；loop 模式仍由 delegate 唤醒、不重复排闸。红线不变：回答 ≠ 验收，隐式回答不路由。

**③ 授权代办核可（`scripts/delegated-accept.ts`）**：`controller.confirmAcceptance` 加 `delegation` 参数——核可权仍属原发起人（actor 不变），回执 `executedBy='agent-under-delegation'`、delegation 字段逐字保留授权原话与时间，审计另记 `acceptance.delegated`；逐项闸门（锁定清单 / 独立评审 / 证据核对）与真人执行完全一致，任何一关不过即拒绝。SUI-129、SUI-135 经此核可收尾（phase=delivered）。**代办不伪造真人按键**，读回执即知「这次按键的是 Agent、凭什么」。

**服务统一纳管（`scripts/services.ts`）**：4190 / 4192 / 4194(+git 9418) 按同一套 PID 归属校验 + HTTP/TCP 健康检查纳管，用户拍板后全部重启运行中；管理后台「服务管理」复用同一入口。

**边界**：执行形态默认仍 `loop`（step 为显式配置；`.runtime/config.json` 的实验值已在第三十轮按交付口径回滚）；飞书仍是唯一发起入口；7 个上游不变。

---

## 0.00000000000000000000000000000 生产项 P-10：漏洞修复与飞书回答接进 HITL 台账（2026-11-08 · 第二十八轮）

> **本节取代 0.0000000000000000000000000000 节成为最新边界声明**。用户要求「看看有没有什么其他的漏洞，完整修复和优化一下，包括功能上还有什么缺陷之类的也进行修复和优化，参考其他几个开源项目」。本轮先真实扫描 P-6～P-9 新代码与四个耦合点，修掉查出的缺陷，再把登记在案的功能缺陷（能力对比报告第 3 节差距 #3 的核心：「飞书回答写入 HITL 台账未接通」）按 advisory 口径接通；**未引入新上游、未新增 npm 依赖、未调用外部模型、未放宽人签红线、未改写入链**。

**修掉的五个真实缺陷（逐个有回归测试，不是改测试蒙过去）**：① `fromHitlLedger` 的 `at` 类型不匹配——真实台账 `at` 是 ISO 字符串、审计行是 epoch 毫秒，混进同一份事件流后 `a.at - b.at` 得 NaN、排序与因果比较全部失效（`loop-smoke` E 段的 `2 + e.at` 字符串拼接坐实了这一点）→ 新增 `toLoopAt()` 统一归一，`loopReport` / `attachImplicitReplies` / `dedupeLoopEvents` 内部比较全部走它；② `loop-guard` 下行事件 id 撞号双计——同一条 IM 消息可能同时被 `controller.reply()` 与 `collaboration-intake.ingest()` 留痕 → `dedupeLoopEvents()` 按字节序保最早一条，`ledgerHealth.dedupedLoopEvents` 如实报数；③ `mapFollowupToAnswer` 的 `\b` 对中文失效——JS 词边界只认 ASCII 词字符，裸「确认验收」会漏进回答通道 → 改为中文感知的 `/^确认验收(?:\s|$)|确认验收\s+\S/`；④ `FileHitlSink.read()` 坏行静默丢弃 → `readWithHealth()` 报 `badLines`，`step:answer` 与 `loop-guard` 都接；⑤ `memory-guard` 知识记录 title 取到 `'{}'`（真实 knowledge 任务 context 是真值空对象，`t.context||t.identifier` 永远取前者）→ 空对象回退 identifier，22 条真实记录指纹随之修正。

**功能缺陷修复（参考三个开源项目）**：新增 `src/hitl-bridge.ts`——飞书显式「回答 <问题编号> <选项>」经 IM 绑定校验后路由进 Runner 成对 HITL 台账并产出 advisory 回流建议（参考 OpenMausBot question 卡片的人侧回写与 Autoloop `answerers` 身份核验思想）；`collaboration-intake.ingest()` 接线：路由发生在绑定校验之后、observe only（失败不影响 IM 语义）、路由成功时台账是规范留痕不再重复写 `loop.downstream` 观察（避免双计）、失败退回原观察路径并如实可查；`scripts/step-answer.ts` 重构为共用同一判据，CLI 与飞书口径逐字节一致；回答带 `via:'feishu-im'/'cli'` 通道标注。

**红线不因接通放宽**：只有显式带问题编号的回答才路由，隐式一句话宁可不猜；路由不排后续步骤、不改任务状态、不等于验收；提问者自答 / 越界选项 / 重复回答 / 核可短语全部拒绝；`tests/p9-contracts.test.ts` 与 `loop:smoke` B 段把「路由必须在 IM 绑定校验之后」「hitl-bridge 不得出现 enqueueSteps / completeStep / store.save」焊成常态契约。

**真跑与证据**：`npm test` **532/532**（521 + 11 例新增）；`npm run loop:smoke` **17/17 `ok:true`**（新增 B5：去重与时间归一真接进服务端），A 段真实 HTTP 200 / advisory、`ledgerHealth:{hitlBadLines:0,dedupedLoopEvents:0}` 如实上报；`guard:smoke` **22/22 且 golden 无差异**（本轮未新增只读 action，19 项白名单不变，无需人审）；`steps:smoke` 54/54、`memory:hierarchy` 16/16、`console:smoke failed: []`、走查 11/11、425px `problems: []`、两个构建、`tsc`、`audit:upstream clean:true`、`atlas:check` 全过、`git diff --check`。

**如实边界**：真实业务单仍未在该链跑过（`loop-guard` 如实报 `bidirectional:false`、耦合点计数 0）；**仍待拍板**：回答后自动排后续步骤、`step` 模式切真实业务单（会把回答变成放行，见 `HANDOFF/08` 第 13 条）；第 12 条 (b) 五项与第 13 条 (a) 四项写入链改造不变。默认仍 `loop` + `paperclip`，无外部模型调用，7 个上游与 npm 依赖不变，SUI-129 真人验收仍未发生，4190 / 4192 / 4194 / 9418 保持停机。

---

## 0.0000000000000000000000000000 生产项 P-9：双向协作回路与上游协议的真实耦合（2026-11-08 · 第二十七轮）

> **本节取代 0.000000000000000000000000000 节成为最新边界声明**。用户质疑「必须要有两条相反方向的移动……不能是单向的，因为人发起之后……也有可能是干活的 Agent 最后把结果传过来」，并追问「之前是不是做错了？我让你参考那几个开源项目，不知道你参考成了什么样子？」；随后明确「从具体代码执行落地的过程来看，可以复用那些开源项目中的部分，把它们耦合进来」。本轮是**方向纠正**，不是又一份参考报告。

**先分清哪里是单向的**：主链路本来就是双向的——下行 `/collab` 发起 / 授权 / 补充说明，上行回执 / `ask_user_questions` / checkpoint，人的补充说明经 `controller.reply()` 追加 comment、置 `phase='ready'`、wakeup/retry 自动启动下一轮（SUI-4 有真实消息证据）。真正断的是 **P-6 新加的单步 HITL 台账**：`scripts/step-answer.ts` 原本只追加 `human_response` 并明确「不排后续步骤、不修改任务状态」，答案送回提问者之后就消失了，是半条回路。

**参考偏在哪（逐文件核对后的事实）**：四轮参考产出全部落在治理 / 评估 / 只读体检侧，**零项落在双向执行回路**——Runner → `step-hitl.ts` / `step-delivery.ts` / `mission-state.ts`（留痕与送达）、OpenMausBot → `behavior-baseline.ts`（冻结基线 / 双臂旗标 / 工具面断言）、Anthropic agent memory → `memory-hierarchy.ts` / `knowledge-guard.ts`（知识治理）、上游七仓 → 对比报告。最该纠正的一处：Runner 的 `human_response` 原义就是「把答案送回提问的 Agent 让它接着跑」，本仓库只取了「编号即问题 id、因果放载荷」的数据契约，却主动把回流砍掉；Autoloop 的 `ask/notice/resolve/later` 在对比报告里被判「找人请示最深」，也没落地回流；而且 `HANDOFF/08` 第 13 条把回流缺口登记成「待拍板」，等于用流程纪律把核心能力推回给用户。详见 `docs/REFERENCE-capability-comparison.md` 第 6、7 节。

**复用层次（用户要求的「耦合进具体代码执行落地」）**：本仓库 `src/upstream.ts:6-13,29-30` 本来就在运行时直接加载**未修改的上游源码**——Super Agent 的 `feishu-trigger.ts` / `feishu-channel.ts`、Autoloop 的 `worker/contract.ts`（`readMessage` / `resultFrom`）与 `worker/agents.ts`、DeepSeek Harness 的 `serialization.ts`；`acceptance-interop.ts` 复用 LobeHub acceptance 的报告 schema。所以「代码级耦合」在主链上是既成事实：`controller.receipt()` 的 `resultFrom()` 就是上游函数。Runner / OpenMausBot / Anthropic 不直接 import 代码，原因是不同栈（Rust / Electron）、会引入第 8 个上游、`enterprise/` 专有许可、只提供协议思想；按 `sources.lock.json` 的 `protocolReferences` / `conceptReferences` 登记并以 TypeScript 重写语义，**7 个上游不变、未新增 submodule / gitlink / npm 依赖**。

**四个真实耦合点**：① `controller.receipt()` → `fromAutoloopReceipt()` → `loop.upstream` 审计留痕（Autoloop 的 ask / notice / later / outcome 归一成上行事件，回执强制 `expectsHumanAction:'review'`）；② `controller.reply()` → `mapFollowupToAnswer()` → `loop.downstream` 留痕（原有 phase / wakeup 继续生效）；③ `collaboration-intake.ingest()` 的飞书「补充说明」同样登记下行应答，`delegate()` 唤醒不变；④ `step:answer` → `bridgeAnswerToResume()` → 独立 append-only `resume-proposals.jsonl`，答案不再消失。

`src/collaboration-loop.ts` 是这一层的一等契约（纯函数、零 IO / 零模型）：显式定义下行 8 类 / 上行 6 类动作；`loopReport()` 判出完整回合、未应答上行、答完不回流、回执无人复核、单向推送段；`attachImplicitReplies()` 让真人直接回一句「继续」也按时间就近配对；`assertLoopAdvisory()` 焊死回执 ≠ 验收、回答 ≠ 放行、不得自动执行。只读 action `loop-guard`（三处白名单同步）汇总真实留痕。

**关于「全自动化」的口径**：本项目追求**流转自动化**，不是**决策自动化**。两条方向要自动接通、自动唤醒、自动把结果带回给人；验收、放行、授权、核可的决定权不下放给执行端。这是产品红线，不是能力缺陷。

**真跑与证据**：`npm test` **521/521**（499 + `collaboration-loop` 16 例 + `p9-contracts` 6 例常态契约）；`npm run loop:smoke` **16/16 `ok:true`** —— A 段真实 HTTP `loop-guard` 返回 200 / advisory / blocking:false / modelCalls:0，B 段四个执行链耦合点静态守门，C 段真实隔离子进程跑通「human-gate 提问 → 真人回答 → 回流建议落盘」，D 段证明「无建议时 staleAnswers:1 / closedCycles:0，有建议时 staleAnswers:0 / closedCycles:1」，E 段飞书补充说明就近配对，F 段 B1 主干 / 路由留痕 / 任务状态 / 回路审计前后不变；`guard:smoke` 22/22（golden diff 抓到白名单 18→19，人审确认为新增只读动作后手工更新并写 `humanReview`）、`steps:smoke` 54/54、`memory:hierarchy` 16/16、`tsc`、两个构建、425px、走查 11/11、`console:smoke failed: []`、`audit:upstream clean:true`、`git diff --check` 全通过。

**如实边界**：真实业务单尚未在这条链上跑过，`loop-guard` 当前如实报 `bidirectional:false`、四个耦合点计数为 0，**绝不编造事件把体检跑绿**。仍未做且需真人拍板：回答后自动排后续步骤、飞书回答直接写入 HITL 台账、把 `step` 模式从 `steps:smoke` 推进到真实业务单——这些会把「回答」变成「放行」。默认仍是 `loop` + `paperclip`，无外部模型调用，SUI-129 真人验收仍未发生。

---

## 0.000000000000000000000000000 生产项 P-8：查漏补缺与取长补短（2026-11-08 · 第二十六轮）

> **本节取代 0.00000000000000000000000000 节成为最新边界声明**。用户要求「继续完成，查漏补缺以及取长补短」。本轮先把上一轮留下的接缝查清楚，再把 `HANDOFF/08` 第 12 条推荐的六项确定性能力与第 13 条的只读体检落地；**未引入新上游、未新增 npm 依赖、未调用外部模型、未改写入链、未放宽人签红线**。

**查漏结论**：① `src/memory-hierarchy.ts`（P-7 五条守门）当时**只被自己的冒烟脚本引用**，生产链路一次都没调用过，规则跑在合成数据上；② `src/mcp.ts` 的 16 个出站工具没有「不暴露」清单硬断言；③ 真实走查报告没有冻结基线 / golden diff / 纯评分器；④ `compareEffects()` 只有 `comparable`，缺 `non-discriminating` / `high-variance` 双臂旗标；⑤ `routing-trace.ts` 的自动决策独立留痕**已有等价物**，只缺机器化断言，不重复建设。文档侧无陈旧口径残留。

**补缺（`src/knowledge-guard.ts`）**：把 P-7 守门以**只读 advisory** 接到真实数据。新增只读 action `memory-guard`，同步 `server.ts` `readOnly` / `members.ts` `reads` / `console-server.ts` `CONSOLE_READ_ACTIONS` 三处白名单；服务端读 `readBridgedEvents()` 的真实 B1 + 路由事件与本地 `kind=knowledge` 任务索引，调 `guardKnowledge()` 产出体检报告，`assertGuardIsAdvisory()` 焊死 `advisory:true / blocking:false / modelCalls:0`。**不读宿主知识正文、不改 `KnowledgeService.propose`、不做文档迁移、不因缺口拦截交付、不新增网页入口或前端卡片**。真实 22 条本地知识记录全部缺 `evidenceEventIds`，体检如实报 `gapRecords:22 / missingEvidence:22`，**绝不编造事件 id 把体检跑绿**；四项「尚未接入生产链」逐条列在 `unwired`。

**取长（`src/behavior-baseline.ts`）**：`freezeTraceSnapshot()` / `diffGolden()` / `scoreSnapshot()` 落地行为轨迹冻结基线与纯评分器（基线 `fixtures/behavior-golden.json` 来自真实 `console:smoke` 报告 61 条稳定字段，排序用**字节序**而非 `localeCompare`，保证跨平台签名可复现）；`armFlags()` 给出 `insufficient-samples` / `non-discriminating` / `high-variance` 三个旗标，样本不足不补零不估算；`toolSurfaceSignature()` / `assertOutboundTools()` 把 OpenMausBot 的 tool-choice 回归映射为**出站 MCP 工具面版本化判据**，并硬断言验收确认 / 任务发起 / 越权 / 撤权 / 删除 / 绕过授权一律不暴露；`assertDecisionTraceIsolation()` 机器化守住决策留痕不与业务写入共用 id、字段齐备、时间单调。本仓库 `modelCalls=0`、无 LLM tool-choice，因此不虚构模型决策评测。

**真跑与证据**：`npm test` **499/499**（465 + `knowledge-guard` 12 例 + `behavior-baseline` 16 例 + `p8-contracts` 7 例，其中常态契约把三处白名单同步、真实 MCP 工具面硬断言、冻结基线不可自动改写固化进每次提交）；`npm run guard:smoke` **22/22 `ok:true`**，A 段冻结基线逐项一致（61 项 unchanged）、B 段真实 16 个出站工具通过硬断言、C 段 100 条真实路由留痕独立且有序、D 段双臂旗标、E 段守门跑在 140 条真实事件与 22 条真实知识索引上、F 段真实 HTTP `memory-guard` 返回 **200 / 4,337 bytes / 7 ms** 且 `advisory:true`、`blocking:false`，并核对真实 B1 / 路由日志行数前后不变。`tsc`、两个构建、425px 响应式、走查 11/11、`console:smoke`、各隔离冒烟、`audit:upstream clean:true`、`git diff --check` 均通过。

**冻结基线人审实例**：全套浏览器回归后 `guard:smoke` 的 golden diff 如实抓到 `checks.readOnlyAllowlist.actions` 17→18，经人审确认为本轮新增只读 action `memory-guard` 的预期配置变化（非行为退化），由人手工更新基线并在 `humanReview` 写明时间 / 轮次 / 变化 / 理由 / 审核人；真跑脚本仍不得自动改写基线，`tests/p8-contracts.test.ts` 常态契约会检查每条记录字段齐备。

**本轮查出的三个真实缺陷已修，不是改测试蒙过去**：① 体检签名原先只覆盖计数与 findings，记录标题改了签名不变 → 加入不含正文的 `recordFingerprint`；② 注入顶层超预算时 `buildInjectedIndex` 直接截断，原先被静默吞掉 → 报 `injected-over-budget` 并记 `injectedOmitted`；③ 冻结基线沿用 `localeCompare` 会因 ICU 区域设置漂移 → 改字节序。既有 B1 投影 / checksum 仍沿用 `localeCompare`，本轮**不擅自改动**已验证的 sorts，避免影响投影签名。

**如实边界**：`memory-guard` 是只读体检，**不是**把守门接进写入链；`HANDOFF/08` 第 13 条的 `KnowledgeService.propose` 增加 `evidenceEventIds`、wiki 落盘位置、注入索引与 192,000 字节一次性 `Context Pack` 分工、Dreaming 建议接 C-6 闸门**仍待拍板**。第 12 条 (a) 六项已落地，(b) 五项（Skill 一等概念、崩溃恢复区分、委托树血缘、升级限速、团队包 preset）仍需产品拍板。冻结基线不得由真跑脚本自动改写；新增 / 删除 / 改变都须人审。默认仍是 `loop` + `paperclip`，SUI-129 真人验收仍未发生，4190 / 4192 / 4194 / 9418 保持停机。

---


## 0.00000000000000000000000000 生产项 P-7：Anthropic agent memory 分层参考与「参考即记忆」规则（2026-11-08 · 第二十五轮）

> **本节取代 0.0000000000000000000000000 节成为最新边界声明**。用户给出 Anthropic 官方研究文章 `https://www.anthropic.com/research/components-of-agent-memory`（Engineering，Published Nov 6, 2026，Written by Lance Martin，© 2026 Anthropic PBC），要求仔细阅读，并特意点出「我们参考的，其实也可以理解为是一种记忆，就是在组织内沉淀知识，也可以说是记忆，然后的一种规则」。完整逐层对照、8 条按价值排序的差距清单与明确不照搬项见 `docs/REFERENCE-anthropic-agent-memory.md`，待拍板事项见 `HANDOFF/08` 第 13 条。

**许可证与来源边界**：这是**网页研究文章、没有开源代码许可证**，因此按 `sources.lock.json` 新增的 `conceptReferences` 登记（与 `sources` / `protocolReferences` 分开），`THIRD_PARTY_NOTICES.md` / `docs/SOURCES.md` / `docs/OPEN-SOURCE-COMPLIANCE.md` 同步，`scripts/audit-upstream.ts` 机器化校验「不得混入 `sources`、不得成为第 8 个上游、涉及文件都在库内」。R7 六步针对代码 / 依赖；文章无 LICENSE 原文可留存，故**不伪造许可证文件**，也不复制正文段落或代码。**不是 submodule / gitlink / 新依赖**，7 个上游不变。

**逐层对照结论**：`transcripts` ↔ 本仓库 `.runtime/memory/events.jsonl` + routing trace（幂等 id / lineage / 撤权 / integrity / 增量与全量 checksum 对照 / `modelCalls=0`），`memory notes` ↔ `Knowledge`（`candidate → confirmed → withdrawn` + HMAC + 修订钉住 + 真人采用），两层**本仓库已有且治理更严**；`TaskContext.collect()` 的 192,000 字节一次性 Pack 与 `buildContextPack()` 已覆盖读取侧预算与裁剪。真缺口在**约束上层的规则**：知识记录没有 `evidenceEventIds` 挂靠主干、知识表示层没有链接 / 索引 / 出处 / 规模护栏、注入顶层没有「小且只留指针」的硬规则、离线整理没有「只提建议」的契约，以及外部参考没有进入候选沉淀链。

**本轮落地（`src/memory-hierarchy.ts`，全部纯函数、无 IO / 网络 / 模型调用）**：① `assertGroundedNotes()` 要求每条知识挂靠原始事件，悬空 / 已撤回 / 重复证据与「无真人签字却标 confirmed」一律拒绝；② `wikiReport()` / `assertWikiRepresentation()` 体检悬空链接、孤立页、重复主题、无出处断言，并拒绝「知识地图比原始语料还大」的抽象为零；③ `buildInjectedIndex()` / `assertInjectedIndex()` 只允许「已真人签字 + 证据完整 + 真人批准提升」的条目标题进入顶层，默认 200 行 / 25 KB，正文一律下移只留 `note:` 指针；④ `dreamProposals()` / `assertDreamProposals()` 产出确定性、只读、待真人复核、`modelCalls=0` 的整理建议，禁止确认 / 删除 / 验收 / 改写主干，`assertNoTranscriptRewrite()` 焊住 append-only 前缀；⑤ `validatedRule()` 与 `referenceAsMemory()` / `assertReferenceSedimentation()` 把「规则 = 结论 + 依据 + 如何知道它为真 + 陷阱警告」以及**用户点题的「参考本身按候选沉淀」**做成代码——参考恒为 `candidate`、必须带来源与阅读事件、必须带三条红线警告，采用是后续独立真人动作。

**真跑与证据**：`npm test` **465/465**（445 + 20 例新契约）；`npm run memory:hierarchy` **16/16 `ok:true`**，其中 C2 用确定性数据复现文章 Figure 12 的 1.77 倍「地图」失败（wiki 208,908 bytes / 语料 117,760 bytes），F3 核对真实 `.runtime/memory/events.jsonl` 行数前后不变（40 → 40）。`tsc`、两个构建、425px 响应式、走查 11/11、`console:smoke`、各隔离冒烟、`audit:upstream clean:true`、`git diff --check` 均通过。

**如实边界**：这些是**守门与契约，尚未接入真实 `Knowledge` 文档 / `Context Pack` / wiki 落盘**；没有新增只读 action、没有改控制台、没有改任何既有投影 / 撤权 / 人签逻辑、没有切换默认底座、没有发生外部模型调用、没有放宽人签红线。明确**不照搬**：让模型判断 salience 与 prompt steering（本仓库 `modelCalls=0`）、自动提升 / 自动确认 / 自动批准（人签红线）、TTL 物理删除（撤权是状态写入、主干 append-only）、由模型自动改写 wiki、把一次性大 Pack 与每会话注入层混为一谈、复制文章正文或代码。SUI-129 真人验收仍未发生；**剩余生产项**（仍需用户确认或外部凭据）：切换默认底座、真实业务单切 step、worker 内部子调用逐次拆分、真实外部模型端点 / 远端沙箱 / 多机切换、金额成本账本接入效果看板。

---

## 0.0000000000000000000000000 生产项 P-6：Runner 两块协议移植与四项借思想（2026-11-08 · 第二十四轮）

> **本节取代 0.000000000000000000000000 节成为最新边界声明**。用户拍板「继续完成，以及值得拿的两块也拿过来」，并点名四块「只借思想」的落地。本轮把 ① `ask_human → human_question → human_response` 成对留痕、② 持久化队列的累计确认 / 至少一次通知 / 投递就绪真正做成代码；四项借思想（六态派生、运行时能力声明、配置库与追加写日志分层、编制快照不回溯）也做成可验证模块。Runner `main` 固定 **MIT** 提交 `a42d133139bbe630e4ca3475426c7653fddd86db`（Copyright (c) 2026 Yicheng Wang）：**协议语义移植、TypeScript 重写，未复制 Rust 源码、未引入 submodule / gitlink，7 个上游保持不变**。R7 六步已走完：`licenses/runner-MIT.txt` 原文、`THIRD_PARTY_NOTICES.md`、`sources.lock.json` 的 `protocolReferences`、`docs/SOURCES.md` / `docs/OPEN-SOURCE-COMPLIANCE.md`、`audit:upstream` 机器化校验、两个模块文件头保留 MIT 版权头。**已避开 2026-08-22 ~ 09-22 的 GPL-3.0-only 发布窗口**。

**① HITL 成对留痕**：`src/step-hitl.ts` 定义 `HitlEvent`，`askHuman()` 生成 `human_question`（canonical `question_id` 就是该事件自己的 id，因果 `triggered_by` 放 payload 不放 envelope），`answerHuman()` 生成 `human_response`（`payload.question_id` 关联、`acceptance:false` 显式标注不是验收）；`foldHitl()` / `assertHitlRedLines()` / `hitlSummary()` 折叠投影、挡住孤儿回答 / 重复回答 / 冒充验收 / 坏行；台账 `FileHitlSink` 是 append-only JSONL，**刻意独立于 B1 记忆主干**（同 C-6 治理台账），测试可用 `MemoryHitlSink` 或 `COLLAB_HITL_LEDGER` 隔离。`src/step-runner.ts` 的 `human-gate` 从「只拒绝、无证据」变成「执行进程生成一条带编号的问题、`HitlRefusal` 抛出、`executeOneStep` 落到注入的台账、步骤仍是 failed」——**执行进程依旧不得自行放行**。真人回答走新增 `npm run step:answer -- <问题编号> <选项> [备注]`（`scripts/step-answer.ts`），必须声明 `COLLAB_HUMAN_ACTOR`，只追加答案、不排后续步骤、不改任务状态。

**② 队列送达证据**：`src/step-delivery.ts` 实现 `cumulativeAck()`（只前进、忽略 stale/未知编号）、`foldDelivery()`（订阅边界 `from ≠ subscriber`、`to` 为空或含订阅者，backlog = lastAck 之后）、`notificationText()`（只带未读条数、幂等、不含消息体）、`atLeastOncePending()`、`deliveryReadiness()`（空闲才可投递；唯一例外是执行端声明 `queuesInputMidTurn` 且不是重投递；重投递一律 idle-only；启动 / 草稿 / 在途 / 未确认就绪都 hold）。`TrackedStepQueue` **组合而非修改** `StepQueue`，在 enqueue / claim / complete 追加 append-only 投递事件，`evidence(runId)` 给出「消息确实送到执行端」的送达数、确认数、通知数与确定性签名；`PgStepQueue` 与 `PgHostPlatform` 的表结构、40 项既有真跑语义一字未改。

**四项借思想**：`src/mission-state.ts` 的 `deriveMissionState()` 由任务事实派生六个状态词（Working / Settled 连续安静 30 秒 / Needs you / Failed / Interrupted / Ended），`settled` 与 `running` 是两个独立维度、可同时为真；`RUNTIME_CAPABILITIES` / `resolveRuntime()` 用能力声明收敛执行端差异，`assertNoStoredArgv()` 焊住「启动参数不入库」；`assertCoordinationLayering()` 机器化守住「配置库只放配置、实时协作全在追加写日志」；`assertSnapshotNoRewrite()` 守住编制快照变更不回溯改写历史决策。`executionView()` 新增这四块的只读说明，不改 `steppedReady` 与 `missing` 口径。

**真跑与证据**：`npm test` **445/445**（424 + 21 例新契约）；`npm run steps:smoke` **54/54 `ok:true`**，新增 E 段在真实子进程 + PG 上跑 `human-gate` 提问、`step:answer` 真人回答、重复回答与匿名身份被拒、成对校验且台账未写 B1 主干；F 段在同一 PG 队列上验证送达 / 确认证据、累计确认只前进、至少一次通知与按能力声明的投递就绪；G 段验证四项借思想守门。`npx tsc --noEmit`、`audit:upstream clean:true`、`git diff --check` 均通过。

**如实边界**：`human_response` 只把答案送回提问者，**绝不替代**原发起人在原会话用中文「确认验收 任务编号」；SUI-129 仍未核可。Runner 的 `Archive` 由系统把 mission 标 completed，本仓库**没有**引入这种自动完成语义；未接通飞书写回通道，真人回答目前只有本机 CLI 入口，不是网页入口。默认 `config.execution.mode=loop`、`host.provider=paperclip` 未变；未引入第 8 个上游、未新增 npm 依赖、未改上游提交、未发生任何外部模型调用；4190 / 4192 / 4194 / 9418 保持停机。**剩余生产项**（仍需用户确认或外部凭据）：切换默认底座、真实业务单切 step、worker 内部子调用逐次拆分、真实外部模型端点 / 远端沙箱 / 多机切换、金额成本账本接入效果看板。

**外部候选评估：OpenMausBot（本轮只调研、未引入任何代码）**：用户给出 `github.com/milind-soni/OpenMausBot` 并要求完整通读 Agent / Harness / Router / 运行分发 / 定义 / Skill / MCP，找出本仓库没做但有价值的点。固定提交 `3f81576655ca45af91bfaaa63dc37251222828eb`（v0.1.148），主体 **Apache-2.0**（由 MIT 转授权），但 **`enterprise/` 是独立 source-available 许可、禁止复用**。完整对照与 11 条差距清单见 `docs/REFERENCE-openmausbot.md`，待拍板事项见 `HANDOFF/08` 第 12 条。结论摘要：它是「聊天应用形态的 bot 团队 + 本机 harness server + 单一 SSE 事件流」，与本仓库的协作台 / 验收责任链是两种形态，**整体不该搬**；本仓库已有且更严的是确定性配置路由（`modelCalls=0`）、组织级 Agent 编制与不回溯快照、append-only 主干与投影、单步队列与送达证据、只读白名单。真正缺且有价值的是**「怎么证明一次协作行为是对的」**：行为轨迹基线 + golden diff、冻结快照纯评分器、双臂对照的 `non-discriminating` / `high-variance` 旗标、tool-choice 回归与版本化判据，其次是工程层自动决策的独立留痕与出站 MCP「不暴露」清单硬断言。这些都能在不引入第 8 个上游、不接外部模型、不放宽人签红线的前提下自研落地。**明确不做**：外部服务一等入口、调外部小模型做路由、五级审批与自动批准、`enterprise/` 代码、整仓引入、r/w 合并式快照。本轮未改动任何 `src/` / `scripts/` / `tests/` 代码。

---

## 0.000000000000000000000000 生产项 P-5：控制台只读快照的服务端分页与裁剪（2026-11-08 · 第二十三轮）

> **本节为历史记录；最新边界声明见 0.0000000000000000000000000000 节（第二十七轮 P-9）**。用户本轮给出仓库路径并说「继续完成」，按 `HANDOFF/06` 第 5 节登记的剩余生产项，只推进 **P-5：控制台 `view` 全量快照的服务端分页 / 字段裁剪**——这是唯一不需要外部端点与凭据、不需要真人拍板、不触碰默认底座与人签红线的纯工程项。其余生产项（切换默认 `config.host.provider`、把真实业务单切到 step 模式、worker 内部子调用逐次拆分、真实外部模型端点与远端沙箱、金额成本账本接入效果看板）**一律未动**，仍需用户确认。本轮未引入新上游、未改上游提交、未切换默认底座、未新增服务或网页发起入口、未放宽控制台只读白名单的写权限。

**产品白话**：控制台只显示「有哪些任务、各在哪个阶段、有多少知识空间」，但原来每次打开都要服务端把每个任务的工作稿正文、授权明细、版本记录、宿主实时详情全部拼成一份大快照再传回来，真实浏览器实测 415KB / 10~12 秒，前端只能靠把超时放宽到 30 秒勉强不报错。P-5 把这条链拆开：**控制台改拉一份服务端分页的索引摘要**，每页默认 12 条、上限 50 条，每条只给编号、标题、阶段等白名单字段；总数另给，不因为分页就少报规模。完整现场仍由原来的只读快照提供，插件工作台一行没改，随时可回退。

**工程落地**：新增 `src/workspace-summary.ts`（`parseViewSummaryPage()` 参数夹取、`visibleTasksFor()` 与 `Workspaces.view()` 逐字一致的身份过滤、`buildWorkspaceSummary()` 确定性纯函数，显式构造返回对象、绝不 spread 原始 Task）；`tests/workspace-summary.test.ts` 9 例契约（分页 / 越界 / 参数夹取 / 身份过滤 / 字段白名单不泄露 `context` `lease` `runId` `delivery` / 宿主标题优先与截断 / `partial` 与 `local` 降级 / 两次逐字节一致 / 空页不编造）。服务端 `server.ts` 新增只读 `view-summary` 分支：只从本机任务索引与工作区目录组装，宿主 issue 标题按当前页**并发**取、单条 2 秒超时即降级到本地任务索引（advisory，不改变任务列表或验收状态）；不读任何工作稿正文、不跑授权重评 / 服务网络 / 助手实时详情。三处只读白名单同步（`server.ts` 的 `readOnly`、`members.ts` 的 `reads`、`scripts/console-server.ts` 的 `CONSOLE_READ_ACTIONS`），成员审计口径与 `view` 对齐。`console/app.js` 四处改用摘要动作、走默认 8 秒快速失败，`view` 的 30 秒宽限只留给兼容调用；`tests/console-shell.test.ts` 补 2 例守门；`scripts/console-smoke.mjs` 补 4 项真跑检查（摘要可用 / 字段裁剪 / 分页总数如实 / 单页 limit 生效）。

**真跑与证据（真实服务端 HTTP，非合成）**：同一台本机上 `view` 返回 **509,283 bytes / 4.02 秒**（历史浏览器端到端 415KB / 10~12 秒），`view-summary` 返回 **5,678 bytes / 0.076 秒**，`limit=2` 为 **1,078 bytes / 0.019 秒**——体积约 1.1%、耗时约 1/53。响应结构实测 `taskCount=10`、`page.total=10`、`hasMore=false`、`titleSource=host`、`fieldsClipped=true`，任务对象只有 7 个白名单字段，序列化结果不含 `snapshots` / `body` / `context` / `sourceAccess`。`console:smoke` 全绿（`failed: []`，6/6 视图、主题、425px、零海外文案、写动作 403、`errorCards:0`），旧 `/api/view` 仍 200 且 10 条真实任务（**旧链路未回退**）。全套回归：`npm test` **424/424**、`tsc`、两个构建、425px 响应式、工作台走查 **11/11**、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 40/40、`host:pg` 21/21、`host:smoke`、记忆重放 / checkpoint、`routing:status`、`audit:upstream clean:true`、`git diff --check`。

**环境处置（如实）**：本轮开始时 3100 / 4180 进程带着已失效的文件代理（broker 关闭），`fs` 读取报 `connect failed: Connection refused`，宿主静态页 500、`view` 一度 409，随后 Paperclip 进程崩溃。按 `HANDOFF/00` 第 3 / 5 节的既定恢复流程，用干净环境重启 4180 与 3100、重挂工作台插件后全部恢复；这是宿主进程的环境故障，**不是代码回退**，未改任何上游源码、未重启 4190 / 4192 / 4194 / 9418。

**如实边界**：摘要只用于展示索引，**不承载工作稿正文、授权明细与验收判断**，最终核可仍只能由原发起人在原会话完成；`view` 逐字保留，插件工作台未改动；默认底座仍 `paperclip`、飞书仍是唯一发起入口；控制台只读白名单由 16 项增至 17 项，仍是只读、写动作照旧 403；`titleSource=local` 时标题来自本机任务索引的首行，不冒充宿主权威标题。宿主标题并发读取仍是 advisory，宿主整体不可用时摘要会如实降级而不是编造标题。**剩余生产项**：切换默认 `config.host.provider` 与真实业务单切 step、worker 内部子调用逐次拆分、真实外部模型端点 / 远端工具沙箱 / 多机切换 / Redis、金额成本账本接入效果看板；这些都需要用户拍板或外部凭据，本轮未擅自推进。

**外部候选评估：Runner（`github.com/yicheng47/runner`，2026-11-08 本轮只评估、未引入任何代码）**：用户给出其终端 Agent 协作层架构图，要求核对 Agent 相关部分能否直接引用 / 移植 / 复用参考。核实：仓库当前 `main` 为 **MIT**（Copyright (c) 2026 Yicheng Wang），允许商用与闭源再分发、只需保留版权声明；**但 2026-08-22 ~ 2026-09-22 发布的版本是 GPL-3.0-only 且仍按该许可提供**，将来若固定来源必须锁 MIT 提交、不能取该窗口内的 release。技术栈是 **Rust**（GPUI 桌面壳 + `runnerd` 守护进程 + `runner` CLI + `alacritty_terminal` / `portable-pty` / `rusqlite`），与本仓库 TypeScript/Node + 自研控制台 + PG 不同栈；整仓或子模块直接引用还会打破既定方向 (a)「不引入第 8 个上游」，因此**不建议**。
其架构与本项目高度同构、**大多已有等价物**：per-mission append-only `events.ndjson`（↔ B1 `.runtime/memory/events.jsonl`）、inbox / HITL / status 投影（↔ 四类投影 + `memory-recall` + checkpoint）、Role / Crew / Slot 配置层（↔ `agent-registry.ts` 组织级编制，本项目更严格）、Router（Runner 是固定 handler 表的 flat dispatcher，本项目 `router.ts` 已按配置决定 1/2 跳）、Session 状态与崩溃恢复（↔ P-1 `StepQueue` + PG `SKIP LOCKED` + `runToken`）——照搬等于重复建设。
**真正值得移植的两块（纯协议 / 状态机，用 TS 重写而非复制 Rust）**：① `ask_human` → `human_question` → `human_response` 成对 correlated signal，`question_id` 就是 `human_question` 事件自己的 id、因果放 payload 不放 envelope，可补 `step-runner.ts` 的 `human-gate` 步（当前只拒绝、无成对留痕）；② durable queue 的 cumulative ack + at-least-once notification + 投递就绪判断（只在 idle 时投递，`queues_input_mid_turn` 能力例外），可补 `PgStepQueue` 的「消息确实送到执行端」证据。**只借思想、零代码引入即可用**：Mission 由 Task 状态派生的词表（Working / Settled 连续安静 30 秒 / Needs you / Failed / Interrupted / Ended，且 settled 与 running 可并存）、Runtime Adapter 用能力声明收敛各 CLI 差异且不存 argv、「SQLite 只放配置、live coordination 全在 append-only 日志」的分层、roster 快照不回溯。
**红线（移植前必须守住）**：Runner 的 `human_response` 只是把答案送回提问的 Agent，**绝不能**替代本仓库「原发起人在原会话用中文确认验收 任务编号」；Runner 的 `Archive` 由系统把 mission 标 completed，本仓库不得引入这种「系统自动完成」语义。若用户拍板移植，须走 R7 六步（协议核验 → 固定 MIT 提交 → `licenses/` 原文 → `THIRD_PARTY_NOTICES.md` → gitlink / `sources.lock.json` → `docs/SOURCES.md`，并纳入 `audit:upstream`），保留原始 MIT 版权头，不改上游源码。三档方向与待拍板事项见 `HANDOFF/08` 第 11 条。

---

## 0.00000000000000000000000 生产项 P-1：长程循环单步化（2026-11-08 · 第二十二轮）

> **本节为历史记录；最新边界声明见 0.0000000000000000000000000000 节（第二十七轮 P-9）**。C-0 ~ C-6 分步清单已在第二十一轮全部收口；用户本轮说「继续吧」，按 `HANDOFF/06` 第 5 节登记的剩余生产项，只推进 **P-1：把 C-P6 从「只有 PG 队列地基」推进到「执行器真的按步跑」**，不并行做默认底座切换、金额成本账本或远端沙箱。本轮未引入新上游、未改上游提交、未切换默认底座、未新增服务、未新增网页发起入口、未放宽控制台只读白名单的写权限。

**产品白话**：以前 C-1 把「队列和状态外置」的地基建好了，但真正干活的进程还是一启动就赖着不走——一个 `while` 循环把「想下一步」「记住刚才做到哪」「在哪台机器上跑」全攥在自己手里。进程一崩，上下文跟着没；换机器就得从头来。P-1 把这三件事拆开：**每一步（一次模型或工具调用）是一次独立短调用**，进程领一步、跑一步、把「做到哪了」写回队列、然后就退出；下一棒由队列激活，可以由另一台机器上的另一个进程领走。换机器只是换「工具在哪跑」，Agent 不需要知道，也不能因此看到更多资料。

**工程落地**：新增 `src/step-execution.ts`（`StepQueue` 契约、`InMemoryStepQueue` 用于隔离真跑、`PgStepQueue` 直接接 C-1 的 `claimStep / completeStep / recoverStaleSteps`、`executeOneStep()` 一次调用只跑一步、`defaultStepRecheck()` 步间按当前主体重评资料范围、`driveSteppedLoop()` 作为可换机器的外部调度器、`stepExecutionSummary()` 确定性摘要、`executionView()` 中文只读状态）；`src/loop-pump.ts` 把 `driveLegacyLoop()`（与改造前逐字等价）与 `driveSteppedPump()`（每 tick 由队列领一步、会话快照写回 checkpoint）分开；`src/step-runner.ts` 是 `npm run step:once` 的真实入口，一次进程只领一步，本机工具白名单只有 `sha256`，未配置外部模型端点时 `model-call` 步**明确拒绝且不编造模型调用**，`human-gate` 不得由执行进程自行放行。`runner.ts` / `assistant-runner.ts` 的常驻 `while` 已移除，按 `config.execution.mode` 分派；默认 `loop` 保证现有主链路逐字不变、可回退，`step` 必须同时配 `host.provider=local-pg`（配置层直接拒绝，避免「切了开关就以为已经单步化」）。只读接线：`v06` 的 `execution-view`、`server` 的 `v06Reads`、控制台白名单与「协作」视图的中文「长程执行」卡片；控制台仍只读、飞书仍是唯一发起入口。

**真跑与证据**：`npm run steps:smoke` **40/40 `ok:true`**。A 配置 / 只读视图 6 项；B 隔离内存队列 21 项（首步唯一 ready、并发领取唯一、旧 `runToken` 作废、原子激活下一棒、跨步 checkpoint、换机器续跑、未登记步骤 / 模型步 / 人工步 / 白名单外工具一律拒绝、缺身份与范围不一致 fail-closed、崩溃回收、确定性摘要、默认泵逐字等价、单步泵快照写回、调度器幂等）；C 在本机 PG 专属库 `suitme_collab_c1` 上用唯一 `runId` 与**真实子进程**跑 8 项：第一棒由 `step:once` 领走并原子激活第二棒，第二棒由「另一台机器」的另一个进程领走，`counter` 从 1 续到 2、`previousEnvironment` 记着上一台机器；队列空、PG 旧令牌、模型步如实拒绝、状态摘要一致。D 接线守门 6 项，并核对真跑前后 B1 主干行数不变。`tests/step-execution.test.ts` 13 例，全套 **413/413**；真实服务端 `v06-execution-view` HTTP 200、控制台代理写动作 403、`console:smoke` 全绿、四张演示截图 `errorCards:0`。

**如实边界**：默认仍是 `loop` 且底座仍是 `paperclip`，**真实业务单尚未在 step 模式下跑过**；`step:once` 的本机工具只证明「循环与状态分离」可跨进程续跑，**没有发生任何外部模型调用**；autoloop worker 内部一次 tick 若触发多次模型 / 工具子调用，尚未逐次拆分（当前是 tick 级单步）；远端工具沙箱 / 多机 Remote Tool Calling / Redis 横向扩展仍未部署；`host:pg` 的 `resetForTest()` 会清空专属测试库，`steps:smoke` 留下的 append-only 留痕不保证长期保留，报告 `.runtime/steps-smoke.json` 不入库。以上都写进 `executionView().missing`，不假装完成。剩余生产项：切换默认 `config.host.provider`、worker 内部子调用逐次拆分、真实远端沙箱、金额成本账本接入效果看板。

---

## 0.0000000000000000000000 方案 C-6：沉淀回流与自演进闭环（2026-11-08 · 第二十一轮）

> **本节为历史记录；最新边界声明见 0.0000000000000000000000000000 节（第二十七轮 P-9）**。用户本轮说「继续吧」，按 `HANDOFF/06` 已拍板且严格不并行的 C 分步清单推进 **C-6：自查标准回流到交付前强制比对、候选改进 → 工程闸门（回放验证）+ 人审 → 版本 / 灰度 / 可回滚 → 效果对比（通过率、返工率、单任务成本、人被打断次数）**，把 `PRD §10C` 的 C-P4 从产品约束变成可验证能力。本轮未引入新上游、未改上游提交、未切换默认底座、未新增服务、未新增网页发起入口、未放宽控制台只读白名单。

**产品白话**：以前「打回原因沉淀成自查标准」只做到了「记下来、报告里能看见」，下次交付时没人强制核对，等于沉淀没有回流。C-6 把这条链接上：**只要历史上被打回过，下次交付前就必须逐条自查并留证据，缺一条就不许交付**。改进也一样：助手可以从打回里提出「下次该怎么做」，但它自己不能拍板——先由工程层用同一份共享现场回放验证（不调模型），再由真人批准，然后才有版本、小范围灰度、正式生效，效果不好随时能退回上一版。最后用四个数（通过率、返工率、单任务成本、人被打断次数）对比前后，缺观测就老实写「不可比」，不补零、不估算。

**已发生**：

- **独立治理台账**：新增 `src/evolution-ledger.ts`，append-only 记 7 类治理事件（自查登记 / 闸门放行 / 候选改进 / 工程闸门 / 人审 / 灰度回滚 / 效果快照），每条 `modelCalls=0`、带内容哈希版本与稳定幂等键，坏行如实记 `errors` 不静默丢弃，两次重放 checksum 逐字节一致。**刻意不并入 B1 的 `.runtime/memory/events.jsonl`**：那是已验收的知识主干，写进去会改变既有重放结果与 checkpoint 证据，等于回溯改写历史；两份日志用 `taskId` / `causedBy` 互相引用，不复制数据。
- **交付前强制自查**：`src/evolution.ts` 的 `standardsRevision()` 由服务端按当前沉淀标准算快照，产出方不能自己声明版本；`evaluateSelfCheck()` 逐条比对「有没有这项自查 / 是否通过 / 有没有证据」，无记录、缺条、未通过、空证据、旧快照五种情况全部阻断并给中文原因；`assertDeliverySelfCheck()` 接在 `Controller.publish()` 真正交付之前，放行只写一条留痕，**不等于验收通过**。无历史打回标准时如实显示「无项可比」，不逼团队凭空造自查。`config.evolution.selfCheckGate.enabled` 默认 `true`，可关闭但关掉也仍要人签。
- **候选改进状态机**：打回 / 异常 → `proposed` → 工程闸门 `gate-passed / gate-failed` → 真人批准 `approved` → `canary` → `active` → `rolled-back`。状态迁移只在台账层守门：Agent 自己批准、跳过闸门、无人审直接灰度、非真人让改进生效、重复登记 / 重复跑闸门全部记违规痕且不前进；触碰「已锁定清单 / 权限规则 / 人签红线 / 历史任务」四类禁改对象的候选**直接拒绝登记**。「生效」只是台账状态，真跑逐字节核对过已锁定清单与标准文件都没被改写。
- **工程闸门复用既有重放**：`engineeringGate()` 直接调 B1/B2 已验收的 `memoryReplayReport()`，检查两次重放 checksum 一致、`modelCalls=0`、无坏行与悬空因果、有真实回放证据、有来源任务，不另造第二套重放或第二套 checksum。所有判断 `modelCalls=0`，符合 C-P3「工程层先处理、模型只接判不准的少数」。
- **效果对比四项指标**：`aggregateEffects()` / `compareEffects()` 从显式观测窗口确定性计算通过率、返工率、单任务成本（以「模型调用次数 / 任务」为代理，**未接入金额账本就不编造金额**）与人被打断次数；缺任何观测即 `comparable=false` 并逐项列中文原因，方向按「越高越好 / 越低越好」判改善或退化，退化提示人审是否回滚。
- **接线与只读呈现**：`server.ts` 注入 `V06Services.evolutionWithConfig(config)`、`v06Reads` 增加 `evolution-view`；`v06` 七个 `evolution-*` 动作统一转发，人审 / 灰度只认组织级真人身份；`scripts/console-server.ts` 白名单增加 `v06-evolution-view`；控制台「协作」视图新增中文「沉淀与自演进」卡片（交付前自查、登记与放行、候选改进、生效版本、效果对比、红线、越权留痕），写动作从控制台代理仍为 403。真实 HTTP `v06-evolution-view` 返回 200，如实显示「1 条沉淀标准 / 闸门已强制 / 0 次自查登记 / 暂无候选改进 / 效果不可比」。
- **真跑 45/45**：`npm run evolution:smoke`（`scripts/evolution-smoke.ts`）在临时目录的隔离台账上跑完整闭环与全部反例：闸门五种阻断、标准变更防蒙混、禁改对象拒绝、Agent 自批 / 跳闸门 / 无人审灰度被拦、真人批准 → 灰度 20% → 生效 → 回滚、四项指标与不可比标注、台账两次重放一致、坏行留痕、**前后真实治理台账与 B1 记忆主干行数不变、已锁定清单字节未变**；`tests/evolution.test.ts` 12 例契约，全套 **400/400**。报告 `.runtime/evolution-smoke.json` 不入库。
- **真实浏览器**：`console:smoke` 全绿，协作视图 6 张卡片、`errorCards:0`，新增 `.runtime/console/collaboration-evolution-1280.png` 直接展示中文「沉淀与自演进」卡片。

**未发生（如实）**：默认 `config.host.provider` 仍 `paperclip`；`runner.ts` / `assistant-runner.ts` 常驻 `while` 未切成单步执行；真实远端工具沙箱 / 多机 Remote Tool Calling / Redis 横向扩展 / Cognee 原生外部模型调用未发生；真实业务单上没有触发过「因缺自查而阻断交付」（避免产生真实交付副作用，该路径只在隔离台账与契约测试里真跑）；真人业务验收 SUI-129 仍待本人在原会话确认；4190 / 4192 / 4194 / 9418 保持停机。飞书仍是唯一发起入口，控制台仍只读；本轮未引入第 8 个上游、未改上游提交、未复制 LobeHub 代码。（本节是第二十轮当时的未发生清单；其中「常驻 `while` 未切单步」已在第二十二轮 P-1 移除并改为配置驱动双泵，见 0.00000000000000000000000 节。）

---

## 0.000000000000000000000 方案 C-5：按当前配置重跑三层评估、两种形态各跑真实一单（2026-11-08 · 第二十轮）

> **本节为历史记录；最新边界声明见 0.0000000000000000000000000000 节（第二十七轮 P-9）**。用户本轮说「请继续完成未完成的任务」，按 `HANDOFF/06` 已拍板且严格不并行的 C 分步清单推进 **C-5：按配置重跑 `assessThreeTier()`（P3 / P4 改为按当前配置判定）+ 扁平 / 分层两种配置各跑真实一单，Trace 每步可回放**。本轮未引入新上游、未改上游提交、未切换默认底座、未新增服务、未新增网页发起入口、未放宽只读白名单。

**产品白话**：以前的评估问的是「你们有没有长成个人助手 → 业务域主管 → 执行助手三层」，答「没有」就一直红灯，等于逼 10 人扁平团队去造一个根本不需要的管理层。C-5 把问题拆成两句：**「你当前选的形态，按它的配置跑通了没有」**、**「如果你选了分层，主管是不是真在岗」**。扁平跑通了，结论是「现在这样就好，不需要三层」；只有真的按业务域分层、且主管确有其「人」时，才说「这套分层可以正式启用」。评估不再替组织决定该长几层。

**已发生**：

- `src/three-tier-assessment.ts` 新增 `OrgShape` / `ORG_SHAPE_LABELS` / `shapeOptions(router, registry)`：口径一律从当前真实 `config.router` + `onDuty()` 在岗编制提取，服务端 / CLI / 真跑共用同一函数，不各自拼装魔数。
- **P3 / P4 按配置判定**：扁平 / 原样回退下 P3 看「人机入口是否收敛」、P4 看「人或助手直达执行者」的 `directDispatches`，**不要求出现 supervisor**，历史 supervisor 角色记录也不参与本形态判定；分层下 P3 要求在岗 `personal` 职责 Agent，P4 要求派活方同时是「配置登记的主管」且「真实在岗带 supervisor 职责」的 Agent（`boundSupervisorDispatches`），只有角色名的合成数据凑不齐。
- `recommended` 语义收窄为「**当前分层配置已被真实证据支撑、可正式启用三层**」，只有 `layered` 且八项前置条件全绿才为 true；新增 `shape: { mode, label, ready, applicable }`，把「本形态自己是否闭环」与「要不要三层」分开说。扁平不看 p8（那是跳级闸门，不是扁平形态的缺口）；未声明配置时退回最保守固定口径，旧调用逐字兼容。
- p8 仍是防跳级闸门（真实在岗数 > 0 + `layered` + 已配置业务域），但 evidence 在扁平下明确写「本形态不需要三层」，避免被误读成功能缺口；`verdict` / `reasons` 按形态分叉，统一中文白话，未齐项数如实列出。
- `server.ts` 的 `routing-status`、`scripts/routing-status.ts` 改调 `shapeOptions(getRouter(), getAgentRegistry())`；`console/app.js`「组织形态」卡新增「形态判定」「三层结论」两行中文白话，仍只读 `routing-status`，无写动作。
- **真跑**：`npm run shapes:smoke`（`scripts/shapes-smoke.ts`）在隔离内存 Trace 上让扁平 / 分层**各跑一单五阶段**，**36/36 `ok:true`**：每一步都带 Router 配置快照与（分层）在岗编制快照，`replayRouting` 两次逐字节一致、`uniqueDecisions` 与跳数一致、分层两跳 `causedBy` 闭合、人签只在最后一跳、配置变更不回溯旧事件、真跑前后真实日志行数不变。结论：扁平 `shape.ready=true / recommended=false`，分层 `shape.ready=true / recommended=true`；四类防跳级反例（只有角色名、扁平却有在岗 Agent、主管不在岗降级、未声明配置）均不放行。`tests/shape-assessment.test.ts` 10 例契约，全套 **388/388**。报告 `.runtime/shapes-smoke.json` 不入库。
- **真实浏览器修复**：演示截图复验时发现 `view` 返回整个工作区快照已增长到 **415KB / 10~12 秒**（C-3 时约 5 秒），前端统一 8 秒只读超时会稳定超时并渲染错误卡片；改为**按动作区分超时**（`view` 30 秒、其余只读仍 8 秒快速失败），保留 in-flight 去重与 1.5 秒成功结果短缓存。`tests/console-shell.test.ts` 的 C-3 契约同步守住；`console:smoke` 全绿、协作视图截图 `errorCards:0`、任务列表与「Agent 编制」卡片均正常。**未做服务端分页 / 裁剪**，如实列为后续性能项。
- 真实服务端重启后 `routing-status` 返回 200，`shape.mode=flat`、P3 / P4 按扁平口径、`recommended=false`，CLI 与 HTTP 一致；`console:smoke` 全绿。真实全量日志仍含改造前不带 Router 快照的历史决策，p6 如实为 false（**历史不回溯改写**），所以服务端 `shape.ready=false` 不是 C-5 未完成；隔离真跑里扁平形态已闭环。

**当时未发生、已在第二十一轮完成（见 0.0000000000000000000000 节）**：C-6 的沉淀回流与自演进闭环（自查标准回流到交付前强制比对、候选改进 → 工程闸门 + 人审 → 版本 / 灰度 / 可回滚 → 效果对比）；默认 `config.host.provider` 仍 `paperclip`；`runner.ts` / `assistant-runner.ts` 常驻 `while` 未切单步；真实远端工具沙箱 / Redis 横向扩展 / Cognee 原生外部模型调用未发生；真人业务验收 SUI-129 仍待本人在原会话确认；4190 / 4192 / 4194 / 9418 保持停机。飞书仍是唯一发起入口，控制台仍只读；本轮未引入第 8 个上游、未改上游提交、未复制 LobeHub 代码。

---

## 0.00000000000000000000 方案 C-4：组织级 Agent 编制、验收协作与 A2A 在岗交接（2026-11-07 · 第十九轮）

> 本节在第二十轮之前曾是最新边界声明，**当前最新以 0.00000000000000000000000 节为准**。用户本轮说「请继续完成未完成的任务」，按 `HANDOFF/06` 已拍板且严格不并行的 C 分步清单推进 **C-4：Agent 实例 + 职责绑定 + 生效范围 + 版本；职责槽位含个人助手 / 主管 / 执行 / 验收 / 标准起草 / 周期巡检；A2A handoff；验收 Agent 与产品 / 技术 / 运营 Agent 协作；禁止同一 Task 自派自验自环**。本轮未引入新上游、未改上游提交、未切换默认底座、未新增服务、未新增网页发起入口。

**产品白话**：C-3 让「谁交给谁」由配置决定，但配置里那个主管名字只是个字符串——系统并不知道它是否存在、有没有资格派活、管哪个业务域、换了版本没有。C-4 补的是「在岗事实」：一张组织级编制表登记谁在什么范围担什么职责；团队从 10 人长到 100 人是**加配置**而不是换系统；10 人团队保持空编制、扁平 1 跳，不硬造管理层。

**已发生**：

- 新增 `src/agent-registry.ts`：`agentRegistrySchema`（可扩展职责 ID、`domains` 生效范围、`enabled`）、`agentVersion()` / `registryRevision()` 内容哈希快照、`resolveAssignment()` 确定性解析（`modelCalls=0`）、`selfReviewConflict()` / `assertNoSelfReview()`、`handoffEnvelope()`（A2A 交接带 `sourceIds / scope / causedBy`，校验在岗 / 职责 / 范围 / 版本 / 自环）、`reviewCrew()`（逐项判定 / 标准起草 / 周期巡检 + 自定义职责协作者）、`registrySummary()` 与单例装配。`config.agentRegistry` 默认空注册表。
- `src/router.ts::planRoute()` 增加可选第 3 参数 `registry`：**显式传入才启用在岗校验**（主管必须在岗、绑定主管职责、范围覆盖该业务域），否则降级 1 跳并在 `degraded` 写明真实原因；未传时与 C-3 **逐字等价**（`router:smoke` 31/31 不回退）。每跳证据追加 `agents:<revision>:<onDuty>` 快照，Router 标记仍是最后一条。
- `server.ts` 启动时 `configureAgentRegistry(config.agentRegistry)` + `configureRouter(config.router, undefined, getAgentRegistry())`；`routing-status` 与 p8 闸门改用真实 `onDuty()` 计数（默认 0 → `p8=false`，扁平配置不要求出现主管）。
- `service-network.ts` 的 A2A `route()` / `start()` 在编制非空时校验目标在岗、职责、范围与自环，并把 `handoff:<to>@<version>` 留进 Trace；**空编制不校验**，SUI-103 / 106 委派链路一字不改。交接传引用与范围，不搬运资料正文。
- `v06.ts` 新增只读 `agent-registry-view` / `acceptance-crew`；`review-readiness` 追加验收协作编组；`org-overview` 从 10 段扩为 11 段。三条红线不变：独立评审者 ≠ 产出方、逐项报告不替代原发起人确认验收、已锁定清单不可改写。
- `console/`「协作」视图新增中文「Agent 编制」卡片（职责中文名、在岗数、范围、编制版本；空编制如实显示降级），只读白名单加 `v06-agent-registry-view`；无输入框、无新建任务按钮。
- **真跑**：`npm run agents:smoke` 在隔离内存 Trace 上跑 **43 项 checks `ok:true`**（C-3 兼容、空编制降级、主管在岗 2 跳、停用 / 职责 / 范围降级、自环留痕、验收编组、A2A 六类失败、快照不回溯、五处接线守门）；`tests/agent-registry.test.ts` 14 例。报告 `.runtime/agent-registry-smoke.json` 不入库，不写真实 `.runtime/routing/events.jsonl`。

**未发生（如实）**：C-5 的按配置重跑 `assessThreeTier()`（P3 / P4 仍按角色名）、两种配置各跑真实一单、C-6 的自演进闭环；默认底座仍 `paperclip`；`runner.ts` 常驻 `while` 未切单步；真实外部模型调用与真人业务验收（SUI-129）仍未发生；4190 / 4192 / 4194 / 9418 保持停机。飞书仍是唯一发起入口，控制台只新增只读编制视图。

---

## 0.0000000000000000000 方案 C-3：单一 Router 与可配置组织形态（2026-11-07 · 第十八轮）

> 本节在第十九轮之前曾是最新边界声明，**当前最新以 0.00000000000000000000000 节为准**；以下内容按轮次保留。用户本轮只说「下一步继续」，按 `HANDOFF/06` 已拍板且严格不并行的 C 分步清单推进 **C-3：五个派活点收敛为单一 Router；读配置决定下一跳（扁平 1 跳 / 分层 2 跳），不写死三段；保留 legacy 一行回退**。本轮未引入新上游、未改上游提交、未切换默认底座、未新增服务。

### 1. 用产品白话说这一轮改了什么

以前「一件事进来之后谁接、谁派、谁干」的判断散在五个地方，**每一处都自己写了一遍「交给谁」并且直接往留痕里写**。结果就是：团队想换一种分工方式，得改五处代码；而且层数写死在调用点里，10 人的小团队和上百人的大团队只能共用一种骨架。

现在只有一个「调度口」。五个地方只说「我这一跳本来想交给谁、依据是什么」，由调度口读组织配置决定要不要中间加一层：

| 配置 | 用户看到的分工 | 跳数 |
|---|---|---|
| `flat`（默认） | 人说出目标，助手直接交给执行者 | 1 跳 |
| `layered` + 业务域配了主管 | 人只跟自己的助手说，业务域主管助手负责派活，执行者干活 | 最多 2 跳 |
| `layered` 但业务域没登记主管 | 自动退回扁平，**不硬造一个中间管理层** | 1 跳 |
| `legacy` | 一行回退到改造前的直写方式，字段与幂等键逐字不变 | 1 跳 |

配置按**业务域 / 组织单元**生效、组织级唯一，项目只引用不覆写；允许一个 Agent 兼任多职责，但**同一 Task 自派自验自环会被拦下并留一条被拒记录**；配置一变 revision 就变，写进每条决策的证据里，改造前的历史决策**不回溯改写**。被拒绝 / 待定的派活不展开两跳，人签红线只留在最后一跳。

### 2. 工程接线（业务判断一字未改）

- 新增 `src/router.ts`：纯函数 `planRoute()` 决定决策链，`Router` 是唯一写入口，`getRouter()` 单例由 `server.ts` 启动时用 `config.router` 装配。
- `src/config.ts` 新增 `router` 段（`legacy | flat | layered`、`domains`、`defaultDomain`、`maxHops`），schema 放在 config.ts 避免与 `routing-trace.ts` 循环依赖；旧 `config.json` 不写该段时默认 `flat`。
- `controller.ts`(3) / `coordination.ts`(1) / `assistant.ts`(1) / `service-network.ts`(2) / `v06.ts`(2) 共 **9 处**改为 `getRouter().route({...})`，不再各自 `routingDecision() + Trace.record()`；全部字段、幂等键、`causedBy`、人签与返回值不变。`coordination` 仍保留可注入 trace 参数。
- `routing-status` 与 `npm run routing:status` 新增 `router`（当前形态 / revision / 业务域）与 `routerCoverage`（带 Router 快照的决策数）；控制台「协作」视图新增「组织形态」与「怎么派活」两张中文卡片。真实浏览器走查时顺带修掉一个 C-2 遗留问题：`view` 单次约 5.2 秒，切换视图时并发重复请求会在 8 秒超时下一起挂掉，改为只读请求 in-flight 去重 + 1.5 秒成功结果短缓存后，错误提示消失。

### 3. 一个真发现：防跳级闸门不够硬，本轮补上

`router:smoke` 用合成的五个派活阶段数据跑 `flat` 时，`assessThreeTier()` 竟然给出 `recommended=true` —— 因为旧的 P3 / P4 只看 Trace 里有没有 `personal` / `supervisor` 角色名，**角色名不等于 Agent 实体与职责绑定**。这与「C-5 之前不把三层当默认答案、不逼扁平团队硬造管理层」直接冲突。本轮不抢 C-5 的评估口径改造，而是补一条如实的前置条件 **p8**（Agent 实例 + 职责绑定 + 分层配置），默认恒为 `false`，由 C-4 / C-5 落地后传入真实绑定；同时把 p6 从硬编码 `false` 改成按 Trace 里的 Router 快照判定。真实全量日志因含改造前的历史决策，p6 仍为 `false`（历史不回溯），`npm run routing:status` 实测 `allWired:true, total 65 / routed 7, recommended:false`。

### 4. 真跑证据与严格边界

`npm run router:smoke` 在**隔离内存 Trace** 上把五个真实派活意图按三种形态各跑一遍，**31/31 `ok:true`**（legacy 5 跳 / flat 5 跳 / layered 10 跳、五阶段全覆盖、重放去重一致、因果链闭合、人签不扩散、p6 按证据、p8 未放行、未登记业务域降级、自环被拦留痕）；报告 `.runtime/router-smoke.json` 不入库，真实 `.runtime/routing/events.jsonl` 未被脚本写入。新增 `tests/router.test.ts` 11 例契约。

全套回归：`npm test` **362/362**、tsc、两个构建、425px 响应式、走查 **11/11**、`console:smoke ok:true`、`host:pg 21/21`、`host:smoke ok:true`、`routing:status allWired:true`、`audit:upstream clean`、`git diff --check`。

**未发生**：C-4 的 Agent 实例 / 职责绑定 / 范围 / 版本与验收 Agent、C-5 的按配置评估口径与两种配置真实一单、C-6 的自演进闭环；默认底座仍是 `paperclip`；`runner.ts` 常驻 `while` 未切单步；飞书仍是唯一发起入口，控制台没有新增写动作或常驻服务；真人业务验收 SUI-129 仍待本人在原会话确认；4190 / 4192 / 4194 / 9418 保持停机。

---

## 0.000000000000000000 方案 C-2：国内适配与独立控制台（2026-11-07 · 第十七轮）

> 本节在第十八轮之前曾是最新边界声明，**当前最新以 0.00000000000000000000000 节为准**；以下内容按轮次保留。用户 2026-11-07 追加：「主要的问题是 Paper clip，目前国外的元素较多，没有做国内的适配，你需要帮我去做好适配，适配的模式可以说前端那一块参考 Lob hub 的样式，包括它的一些功能。」

### 1. 产品白话：这次解决的是什么

用户抱怨的不是许可证，而是**国外那套被直接摆到了用户面前**：没译完的英文、海外品牌与入口、工程师命令、以及一套不符合国内使用习惯的界面。要的结果是「看到的、点到的、连的都是国内这套」——中文、飞书、国内模型与交付链路，而**观感和好用程度参考 LobeHub**（会话式工作台、卡片、知识库、明暗主题、气泡时间线那一类现代 AI 应用体验）。

这与第十五轮已拍板的 ②「独立前端应用」合流：**不是给宿主换皮，而是把用户这一层换成我们自己的外壳**，宿主退到后面只当数据层，随时可替换。也等于回答了 `08` 第 10 项的去留问题——按方向 (a) 走「不引入第 8 个上游、加速去宿主化」，而不是换 Octop 之类的国外宿主。

### 2. 本轮交付（两条线，都有真跑证据）

**国内适配（旧用户可见层）**

- 中文壳词典 `locales/shell.zh-CN.json` 扩到 344 条，覆盖上游 `Secrets` / `AgentDetail` / `CompanySkills` 里 AST 能替换的残留英文（托管凭据、登录本地开发工具、从代码仓库导入等）；译文不含任何海外品牌词。
- `src/shell-domestic.ts::domesticIndexHtml` 把移动桌面标题 `apple-mobile-web-app-title` 也改成「SuitMe 协作台」，宿主品牌不再出现在页面元数据里。
- `src/service-status.ts`：移除「Slack / GitHub / Linear / Notion / Vercel / Zapier」这一条**一等入口**（未连接的海外服务只留策略说明，不再列进清单）；本机服务名改成「本机协作服务 / 中文协作台数据通道」。
- 工作台面板把 `npm run ...` 命令、Cognee / Codex / Claude Code / Gemini / OpenAI / SQLite / Wiki / Markdown / L1 / L2 等品牌与工程词换成中文产品语言；内部 import、action 名、配置 id、className 一律不动，也不新增网页发起入口。

**独立控制台（C-2 的实体，自研）**

- `console/`：零运行时依赖的原生 HTML / CSS / JS 单页，LobeHub 风格的左侧会话与导航、卡片内容区、右侧助手与现场卡、气泡时间线、深浅主题（本地记忆）、425px 窄屏；六个视图：概览 / 协作 / 知识 / 验收 / 服务 / 设置。
- `scripts/console-server.ts`：只绑定 `127.0.0.1` 的本地承载服务，**只开放 13 个只读 action**，密钥留在服务端；带 CSP、禁表单、禁跨域；`npm run console` 按需启动，**不是常驻服务**。浏览器拿不到 `adminToken`，写动作返回 403。
- `console/app.js` 有统一语言层 `DOMESTIC_TERMS`：即便后端状态里仍带内部标识，展示出来也会换成中文产品词；每个请求带 8 秒超时，单个慢接口不会让整页卡住。
- `scripts/console-smoke.mjs` + `npm run console:smoke`：临时端口起服务、连真实 bridge、用 Chrome 走查六个视图、主题切换、425px 无溢出、无海外文案、无网页发起入口、写动作 403，输出 `.runtime/console-smoke.json`（不入库）。
- `tests/console-shell.test.ts` / `tests/domestic-localization.test.ts`：共 14 例静态契约，守住只读白名单、密钥不进前端、用户可见层无国外元素、中文壳与元数据改写。

### 3. 许可证边界（本轮核实，别踩）

- `lobehub/lobehub` 主仓库仍是 **Community License（Apache-2.0 + 商用附加条件）**，衍生作品分发需商业授权：**不复制、不 fork、不打包其源码**。
- 其组件库 `@lobehub/ui` 确为 **MIT**（Copyright 2023 LobeHub），但 v6 强制 React 19 + ESM + 四个 peer 依赖。本轮**不引入该组件库**，只借鉴设计语言与交互范式、自研实现，避免把前端绑死在上游版本上。
- 上游 `public/brands/apps/LOBE-LICENSE` 已说明 Paperclip 自带图标集来自 MIT 的 LobeHub 图标；本轮**未新增任何上游、未改任何上游提交、未复制任何前端代码**。

### 4. 严格边界（未发生，不是 bug）

默认 `config.host.provider` 仍是 `paperclip`；旧插件工作台仍保留并继续通过 11/11 走查，控制台是**新增的独立外壳**，不是替换默认底座；`HostPlatformPort.capabilities()` 仍如实列出「默认底座仍由宿主承载界面」。控制台按需启动、没有新增常驻端口，也没有新增网页发起入口——**飞书仍是唯一发起处**。真人业务验收（SUI-129 未核可）、Cognee 原生 `cognify` 真实调用、生产发布、真实外部 PR·CI、全员 SSO、飞书部门 scope 重新登录仍未发生。4190 / 4192 / 4194 / 9418 保持停机；5432 只连回环、只用专属库。

---

## 0.00000000000000000 方案 C-1：PG 真跑与长程执行地基（2026-11-07 · 第十六轮）

> **本节在第十七轮之前曾是最新边界声明，当前最新以 0.00000000000000000000000 节为准**。用户明确改口「本机可以引入 pgsql 数据库去测试」，并追加 LobeHub / DeepSeek 关于「把 Agent 的循环、会话状态、执行环境拆开来放」的原文。用户消息在「然后继续把」处截断；以下按检索到的**同一篇文章**（赛博禅心《如何让 Super-agent 成为同事：LobeHub 的组织实验》，「如何保持 Agent 的持续在线」一节）补全后半段——工具调用发往 AWS 沙箱或用户自己的电脑、结果传回，Agent 察觉不到思考与操作发生在不同地方，换机器只是换一个执行工具的地方。**没有凭空补写需求**，若截断处还有别的要求，需用户再确认。

### 1. 撤回上一轮的一个判断

上一轮 C-0 收尾写「本机试点不引入 PostgreSQL，用原子写 + 文件锁等价，生产多实例缺口如实声明」。**该判断作废**：用户已明确允许。核对环境后发现本机 PostgreSQL 17.10 其实一直在 `127.0.0.1:5432` 运行（`psql` 只是没进 PATH，实际在 `/opt/homebrew/opt/postgresql@17/bin/`）；本轮新建**专属库 `suitme_collab_c1`**，未触碰已有的 `geo_flow`。R7 新增依赖六步已补齐：`pg@8.23.1` + `@types/pg@8.23.1` 精确版本与 lockfile integrity、`licenses/pg-MIT.txt`、`THIRD_PARTY_NOTICES.md` 段落、`SOURCES.md` 一行、审计脚本机器化检查。

### 2. 产品白话：这一层补的是「持续在线」

前两轮对齐的是**组织形态**（谁向谁汇报、层是配置）与**验收 / 自演进**（组织怎么变聪明）；这一次补的是底下那层：**关掉电脑，Agent 的活照样跑**。三样东西拆开——**循环**（决定下一步做什么）、**会话状态**（走到第几步、手里有哪些材料）、**执行环境**（真正跑工具改文件的机器）。没有「跑几小时的长进程」，只有一串短步骤：每步一次模型或工具调用，状态先落库，下一棒由队列推进。文章里那句「Agent 自己意识不到这件事，它以为自己就活在沙箱里」的产品含义是：**换电脑只换手脚，大脑和记性不动**。

对照本仓库，`src/runner.ts` / `assistant-runner.ts` 现在是**一个进程里 `while(!settled) await worker.tick()`**，任务与本机进程绑死——文章说的「机器自动更新，在跑着的任务就完了」在这里是真实存在的。B1 / B2 的 append-only 主干、checkpoint 与四类投影已经把「记性」外置了一半；C-1 补的是把**循环**拆成可独立重跑的步与真正事务化的队列。

### 3. 在 C 清单里的落点（不新造阶段）

| 层 | 落在哪一步 | 本轮状态 |
|---|---|---|
| 会话状态外置 | B1/B2 主干 + checkpoint；C-1 PG 表 | 主干已验收，C-1 已真跑 |
| 循环拆步 / 队列推进 | C-1 的 `PgHostPlatform` 步进队列 | **本轮真跑 21/21**；`runner.ts` 仍是常驻循环，切单步属后续 |
| 执行环境可换 | C-2 独立外壳、C-4 A2A / 远端工具 | 未发生；本轮不部署外部沙箱 |
| 每步轨迹作为改进燃料 | C-6 沉淀回流与自演进 | 已完成（第二十一轮，见最新边界节） |

### 4. 三个工程取舍（如实说明，不照抄）

1. **本机不引 Redis**：LobeHub 用「队列 + Redis」，本机试点改为 PG 同一库里的队列表 + `FOR UPDATE SKIP LOCKED`。好处是队列与状态在同一事务里一致、少一个组件；生产大规模横向扩展时替换 `claimStep / completeStep / recoverStaleSteps` 三个方法即可，这个切换点留在代码与 `capabilities().missing` 里，**不把它写成「已完成」**。
2. **不部署远端工具沙箱**：本轮只验证「循环与状态分离」，工具仍在本地执行；AWS 沙箱 / 多机 Remote Tool Calling 属于生产外部服务，且涉及把业务材料发往外部，未经用户批准不做。
3. **安全与默认不变**：`assertLocalPgDsn()` 只接受回环地址，DSN 只从 `COLLAB_PG_DSN` 环境变量读取（凭据不进 `config.json` / 仓库）；`config.host.provider` 默认仍是 `paperclip`，`local-pg` 是显式配置；专属测试库之外的库一律拒绝 `resetForTest()`。

### 5. 真跑证据（不是单测模拟）

`npm run host:pg` 在本机 PG 17.10 / `suitme_collab_c1` 上 **21/21、`ok:true`**：事务内文档修订原子递增；ACL 未知主体被拒；cost-ledger 写读一致；heartbeat `checkout` 重复领取被拒、`retry` 后 token 轮换；步进链只有第 1 步 ready、完成后原子激活第 2 步、三步全 done、`modelCalls` 与 checkpoint 逐步外置；两个 worker 并发领取拿到不同 step（`SKIP LOCKED`）；重复 `completeStep` 被拒；`recoverStaleSteps` 回收超时 running 且旧 `runToken` 作废；错误 token 不留半写状态（事务回滚）；`capabilities()` 如实列出 9 项已实现与 3 项仍缺。报告在 `.runtime/host-pg-smoke.json`（不入库）。

### 6. 红线与仍未发生的事

Agent 感知不到执行环境差异，**不等于权限可以跨环境放大**：步与步之间仍按当前身份重评，已锁定清单、人签、历史任务不回溯。仍未发生：`runner.ts` / `assistant-runner.ts` 常驻循环切成单步、真实远端工具沙箱与多机切换、默认底座切换、独立应用外壳（C-2）、三层 Router（C-3）与角色体系（C-4）、真人在原会话对 SUI-129「确认验收」、Cognee 原生外部模型调用、生产发布 / 真实外部 PR·CI / 全员 SSO / 飞书部门 scope 重新登录；4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态。C 仍按 C-0 → C-6 分步、不并行。

---

## 0.0000000000000000 产品思路复盘与方案 C 启动（2026-11-07 · 第十五轮）

> 本节在第十六轮之前曾是最新边界声明，**当前最新以 0.00000000000000000000000 节为准**；以下内容按轮次保留。B（B1 + B2）已验收，用户拍板 ② 并确认渠道约束后，C 正式启动。本轮先做产品复盘与决策固化（C-0），再按 C-1 → C-6 分步推进，**严格不并行**。

### 1. 用户拍板（2026-11-07）

- 选择 **② 改成独立前端应用**：明确废弃 `PRD-v0.6.md` §10A 的 **S5（前端保持插件式单页）** 与 **S6（顺序：底座 → 功能 → 前端）**，并同步改写红线文档与前端分层。
- **S1–S4 全部保留**：入口是会话不是网页；一个语义对象两种表达；渠道能力只决定呈现不决定内容；中文指令与业务红线不变。
- **飞书 IM 仍是唯一发起入口**；工作台仍只做授权 / 留痕 / 审阅 / 签字，**不新增网页发起入口**。
- 用户复述并确认三层汇报口径：第一层**每人一个 Personal Agent，替人过滤信息**；第二层**每项目一个主管 Agent，负责派活和验收**；第三层**才是 Claude Code / Codex 这些干活的执行 Agent**。**人只听自己的 Personal Agent，活由各个项目的主管 Agent 去派**；人中途插手在 Task 卡片开工单；交接两头都是 Agent 时上下文原封不动递过去。

### 2. 两篇材料的分工（不要混为一谈）

| 材料 | 回答的问题 | 在本仓库的位置 |
|---|---|---|
| 赛博禅心《如何让 Super-agent 成为同事：LobeHub 的组织实验》（2026-11-01） | **组织维度**：谁向谁汇报、谁派活、怎样避免人越过主管微操执行 Agent（「凯申行为」） | `ARCHITECTURE-v0.6.md` 思路来源已登记；LobeHub 主仓库 Community License，**只借角色命名与思想，禁止复制代码** |
| 腾讯程序员 / 腾讯技术工程《多 Agent 协作的下一场竞争，不在模型，而在上下文》（2026-11-06，作者 poppylili，司内工具 Siboot） | **信息维度**：上下文如何在群里流动、隔离、接力，怎样不丢 | 本轮新增参考，**只读公开文章、不引代码、不接服务** |

后者的推导链：协作真正传递的不是消息而是**上下文**（决策依据、排除项、卡点、材料、边界）→ 人说出来的比脑子里的少、听的人再解码又少一层 → Agent 上桌后折损从加法变**乘法**，人被卡在链路中间当**传声筒** → 转折点是「**不靠通信共享上下文，而是靠共享上下文来通信**」，消灭转述，让下一棒直接站进同一个现场 → 落地为**群是场 / Topic 是焦点 / @ 是接力**（Topic 边界就是 Agent 的注意力边界与成本边界），再加时间维度**文件是记性**（热的上下文在场里实时共享、冷的沉淀成结构化资产，Agent 定时醒来归档、先检索去重再新建）→ 人从「中继器」回到**定目标、做判断、划边界、做验收**。

### 3. 复盘结论：我们做的是「有限可见、责任可追究的共享现场」

| 帖子的说法 | 本产品对应 | 落地状态 |
|---|---|---|
| 上下文才是协作的本体 | 「产品化的是织」：Space / Thread / Context Pack / Artifact / Trace / Policy | 对象模型已定 |
| 靠共享上下文来通信，而非互写摘要 | B1 append-only 事件主干 + 四类投影重放 | **B1 / B2 已完成并验证** |
| Topic = 注意力与成本边界 | Context Pack 按 Task 裁剪一次一包，检索时按当前身份重评权限 | 已落地 |
| @ 接力但不搬运上下文 | `RoutingDecision` 带 `sourceIds / scope / causedBy`，A2A handoff | A 有契约，**C 才真正接通** |
| 文件是记性 | L1 证据图 / L2 组织图 / checkpoint / 逐项报告与自查标准 | 部分落地，L2 草稿仍需人审 |
| 人回到判断与验收 | 开工前锁定清单、独立评审、逐项报告、原发起人确认验收 | 已落地；真人验收仍未发生 |
| 三层汇报 | Personal / 主管 / 执行 | **C 才落地** |

**两处刻意不同，不是照搬**：

1. 帖子的「群」对所有人、所有 Agent 实时可见；本产品坚持**默认隔离 + 显式授权 + 按当前身份重评权限 + 私有资料不得自动进共享 Wiki**（用户拍板 D3）。所以是「**有限可见**的共享现场」：按 Task 裁剪、带 lineage、可撤回，而不是全量广播。原因是团队里有私有客户资料与跨空间授权，全可见会直接破红线。
2. 帖子说「人只在最后出现一次：验收」；本产品的人在链路上出现多次（定目标、开工前锁定清单、跨空间授权审批、高风险联签、最终核可）。LobeHub 也承认「验收成了新瓶颈」；本产品的解法是**逐项报告 + 打回原因沉淀成自查标准**来降低负担，但**最后那一下仍由原发起人在原会话做**，不交给 Agent 或自动合并。

### 4. 最关键的一句：三层 = 同一现场的三种座位

三层会**多一跳转发**（人 → Personal → 主管 → 执行）。若这一跳靠「把上一棒总结成一段话往下传」，帖子所说的乘法折损会在三层链路上加倍重现——LobeHub 自己亦把「多一层转发」列为风险。因此三层必须架在 B1 / B2 已建好的**共享现场**上：Personal / 主管 / 执行 **换的是可见范围与责任主体，不是把话总结一遍往下传**；交接靠 A2A 带 `sourceIds / scope / causedBy`，三者直接读同一份 append-only 主干 → 四类投影 → 按 Task 裁剪的 Context Pack。

这也解释了 `assessThreeTier()` 当前 `recommended=false`（覆盖率 5/7，缺 P1 / P3 / P4 / P6）：不是三层不对，而是 Personal 实体、主管实体、单一 Router 尚未存在；它们的价值只有在「上下文已能重放、可裁剪、可撤权」之后才成立。**B 不是 C 的前置仪式，B 就是让三层不丢上下文的地基**——否则三层会各自再写一套记忆接口，把混乱放大三倍。

### 5. 平台底座切换在复盘里的位置

帖子说「Agent 得有自己的文件系统，并且知道怎么整理它」。本产品的「现场」目前寄在 Paperclip 里：任务真源、ACL、文档修订、界面承载都由它提供。要让三层直接读同一份现场、并能加「我的 Agent / 派单看板」这类二级视图，就必须把承载拿回来。这是选 ② 的**产品理由**，不是技术洁癖；也解释了为何 C 把「三层 Router」与「平台底座切换」绑在一起做。

### 6. 第十五轮补遗：可配置组织形态与自演进机制（同日，用户追加）

> 本小节与第 1~5 节同属**最新边界声明**，并修正第 1 节里把三层写成「固定骨架」的口径。用户确认了两个配置假设（按业务域 / 组织单元生效、允许一个 Agent 兼任多职责），并追加两条产品要求；完整可验收条款见 `PRD-v0.6.md` §10C。

**修正点一：层是配置，不是产品骨架。** 用户指出：上百人团队可能在产研、增长运营、销售、财务等每个业务域各有一个中间决策层 Agent；10 人团队（4~5 开发 + 产品 + UI/UX + 增长运营 + 财务类职能）可能根本没有管理层的概念。因此**每个 Agent 既能承担管理职责，也能作为某个人的 Personal Agent**，由配置决定，团队从 10 人长到 100 人时是「加配置」而非「换系统」。这把 `src/roles.ts` 的既有纪律「**划分是配置，责任是事实**」从主职能推广到 Agent 组织形态：沿用 Role Registry 的组织级唯一、项目只引用不覆写、`RoleSnapshot` 变更不回溯；`AGENT_ROLES` 三个名字降级为**能力类型**，不再是层级。用户已确认：配置粒度按业务域 / 组织单元、允许兼任，但同一 Task 上不得自派自验自环。

**修正点二：C 的目标不止三层，还要能自我改进。** 用户给的链接经核对**正是第 2 节表格里的赛博禅心 LobeHub 那篇**，只是指向它的后半段：Acceptance、Agent Vent、harness 自主优化、L1–L5 分级。四条落地口径：

1. **沉淀与渐进替代**：上下文越沉淀越多，Agent 逐步接手大部分判断，但定目标、划边界、高风险联签、最终核可永远由人做。文章原话是「Agent 能力还弱的时候人坐主驾，能力强了人退到副驾负责审核」，L1 → L5 是**分级渐进**，不是一次性放权；`assessThreeTier()` 的 `recommended=false` 就是防跳级的工程闸门。
2. **工程 + AI 组合，别让模型包办**：文章写「先通过规则进行过滤（关键词 / 频道）然后再交给模型判断」，因为「人的注意力极为有限」，并给出自主优化 harness 后 70% 通过率、单任务成本中位数 1.68 美元（Codex 66.7% / 3.47 美元、Claude Code 63.3% / 18.34 美元）。本仓库已有 `runtime-guard.ts` 的 fast → semantic → budget、确定性抽取 `modelCalls=0`、注意力预算与必达消息保护——**方向已对**，缺的是把成本 / 调用数变成可度量看板并接进 C 的判断链。
3. **验收是一个 Agent，不是一份报告**：文章说「新的瓶颈：验收」，Acceptance 把需求拆成可见检查项、在真实产品里逐项跑、人整体通过或部分打回、**每次打回沉淀成一条标准，Agent 下次交付前先自查**。本仓库已有锁定清单、逐项判定、部分打回、`recordSelfCheck()`（幂等原子写、不改写已锁定清单）、独立评审者 ≠ 产出模型，以及 Apache-2.0 只读格式契约；**但验收目前是服务 / 报告，不是配置表里的可协作角色**，也没有与产品 / 技术 / 运营 Agent 的协作协议。C-P2 把它升格为可扩展职责槽位中的一等公民。
4. **自演进闭环必须有闸门**：文章里 Agent Vent 是「吐槽聚类 → 建 Task → 次日对比」（84 条降到 49 条），不是自动改配置。本产品红线：**Agent 可以提出改进，不能自己让改进生效**；已锁定清单、权限规则、人签红线、历史任务一律不回溯改写；候选改进须过工程闸门（回放历史轨迹验证）+ 人审 + 版本 + 灰度 + 可回滚，再进入「下次交付前先自查」，并对比通过率 / 返工率 / 单任务成本 / 人被打断次数。

**由此改动 C 的验收口径**（详见 `HANDOFF/06-CURRENT-STATE-AND-NEXT.md` 第 3 节）：C-3 的单一 Router 必须读配置决定下一跳（1 跳或 2 跳），不能写死三段；C-4 造「Agent 实例 + 职责绑定 + 范围 + 版本」而不是三种硬编码实体，并加入验收 Agent；C-5 至少跑扁平 / 分层两种配置；新增 C-6 专做沉淀回流与自演进闭环；`assessThreeTier()` 的 P3 / P4 改为按当前配置判定，**否则小团队会被逼着硬造管理层才能把评估跑绿**，与用户要求正好相反。

**本补遗只改文档与任务清单，未改运行代码**：默认底座仍 `paperclip`，Plugin SDK 未移除，未引入新上游，未外发业务材料；运行基线沿用第十四轮 329/329、走查 11/11。

按 ② 的形态，`HostPlatformPort.capabilities().missing` 五项需要**重新定义而非照抄补齐**：ACL / 成员身份、cost-ledger、UI 承载（改为独立应用提供，**不再是 Plugin SDK**）、heartbeat 真实执行与 `checkout / retry / runToken`、并发与事务（本机试点用原子写 + 文件锁等价满足，**不引入 PostgreSQL**；生产多实例事务缺口如实声明）。

### 6. C 分步（不并行）

| 步骤 | 内容 |
|---|---|
| C-0 | ② 决策固化与产品思路复盘（本节） |
| C-1 | 按独立应用形态补齐本地宿主能力，逐条处理 5 项缺口 |
| C-2 | 独立应用外壳：自己的导航与视图承载，保留 5 tab 职能，移除 Plugin SDK 编译期依赖 |
| C-3 | 五个派活点收敛为单一 `Router`（统一接活 → 派活 → 交接，保留 legacy 回退） |
| C-4 | Personal / 主管 / 执行三层实体 + A2A handoff，人通过 Task 卡片插手 |
| C-5 | 重跑 `assessThreeTier()`（P1/P3/P4/P6 全绿才讨论放开自主派活）+ 真实一单端到端 |

每步验收：全套回归 + `routing:status` + `host:smoke`；C-5 还需真实一单：飞书发起 → Personal 过滤 → 主管派活 → 执行 → 逐项报告 → 原发起人确认验收，每一步 Trace 可回放。

### 7. C-0 阶段边界（本轮未发生）

- **C-0 只改文档**：未改运行代码、未切换默认底座（`config.host.provider` 仍 `paperclip`）、未新增 tab、未移除 Plugin SDK、未引入新上游。
- 三层判断仍是 `recommended=false`；**不把「Agent 自主管理 Agent」当默认路径**。反面依据保留：玉伯 OPT 访谈中人是「监工」、同时管约 5 个 Agent 已达带宽上限、「暂无法实现 Agent 自主管理 Agent」。
- 红线全部不变：高风险动作真人签字、验收标准开工前锁定且不由承接人自定、独立评审者不得是产出模型、`Agent 完成 ≠ 业务验收`、最终核可只能由原发起人在原会话用中文「确认验收 任务编号」。
- 仍未发生：真人业务验收 SUI-129、Cognee 原生 `cognify` 真实外部调用、生产发布 / 真实外部 PR·CI / 全员 SSO / 飞书部门 scope 重新登录；4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态，不得重启。

---

## 0.000000000000000 方案 B2：读取链消费投影、精确撤权与完整知识事件链（2026-11-07 · 第十四轮）

用户指令：从 `HANDOFF/` 继续完成当前真实待办。按 **A → B → C 不并行**，本轮收尾方案 B 的第二阶段；完整方案见 `docs/MEMORY-ARCHITECTURE-v0.7.md`，真跑证据见 `docs/VALIDATION.md` 第十四轮。

### 1. 四项落地

- **B2-1 读取链**：`src/memory-recall.ts` 把 `recallMemory()` 的投影命中作为**第三路**信号接入 `TeamMemory.search` 融合排序。接线顺序是硬约束：`reusable()` / `allowed()` / hash 版本重评**之后**才按 `sourceId@revision` 白名单裁剪投影命中（`projectRecallHits`），投影永远不是权限来源；读日志失败只按 advisory 降级，不改业务结果；`modelCalls=0`。
- **B2-2 精确撤权**：`source-revoked`（资料本身撤回）仍全局阻断派生记忆；`grant-revoked`（单主体授权撤销）不再进 `revokedSourceIds`，改记 `principalRevocations`。`recallMemory(..., { principal })` 只排除该主体的同源记忆；**未指定主体时 fail-closed**。
- **B2-3 真实链路**：`npm run memory:journey` 经真实 bridge action 跑 `view → create-source → review confirmed → memory-index → edges-save → l2-extract → context-pack → review withdrawn`，只新建一条专用资料并在末尾撤回；四类投影 `1/2/1/1 → 0/0/0/0`、召回 `1 → 0`、lineage 失效 4 事件。真跑暴露并修掉两个缺陷：`view.spaces` 是数组被当字典读；L2 自动抽取后任务级镜像未带入「全局已有节点」导致悬空边（`buildTaskGraphMirror()`）。
- **B2-4 checkpoint**：`src/memory-checkpoint.ts` + `npm run memory:checkpoint` 保存 raw events / logErrors / bundle / checksum，普通新事件增量应用；撤权、乱序、失效祖先、已撤回来源、checksum 不一致等会回溯变化的情况一律**回退全量**，增量结果始终与全量 checksum 逐字节对照。

### 2. 收尾复核时又修的一处真实接线缺陷

复核 `memory:replay` 的真实日志发现 6 条 `danglingCausedBy`：`knowledge.review()` 会把资料推进到**新 revision**，而 `src/workspaces.ts::reviewSource` 仍用评审前的 revision 写来源事件，导致确认事件与 `createSource` 的幂等键相撞被去重，主干里没有派生事件引用的 `sourceEventId(新版本)` 锚点。现已改为使用评审后的 `reviewedRevision`，补 2 例回归（版本前进后的完整 lineage + 接线守卫），并把 `memory:journey` 的验收条件加上 `lineageComplete`（本次资料的悬空 lineage 必须为 0）。**历史 append-only 日志中的旧悬空行不物理删除**，重放会如实记录。

### 最新边界声明（以本节为准）

- **已发生**：B1 主干与四类投影；B2 四项（投影召回融合、按 principal 精确撤权、真实一单端到端撤权、checkpoint 增量）；真实链路完整 lineage 修复；全套回归、真实浏览器走查与真跑脚本证据。
- **未发生**：C（三层 Router + 平台底座切换，且需先由用户拍板「5 tab 插件式单页」的产品形态冲突）；真人在真实业务单「确认验收」（SUI-129 未核可）；Cognee 原生 `cognify` 真实外部调用；生产发布、真实外部 PR/CI、全员 SSO、飞书部门 scope 重新登录。
- **原存储仍是主读取源**：Cognee / Ladybug / SQLite / Paperclip 文档照常工作，投影是权限重评之后的第三路叠加证据，**不是替换底座**；事件写入失败不影响业务。
- **红线不变**：合并 / 发布 / CI / 报告 / 模型判定不替代原发起人在原会话「确认验收」；`.runtime/memory/` 与 `.runtime/routing/` 不入库，chunk 文本截断 200 字；4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态。

## 0.00000000000000 方案 B1：共享记忆事件主干与四类投影（2026-11-07 · 第十三轮）

用户指令：「开始 b 阶段吧」。按 **A → B → C 不并行**，本轮落地方案 B 的主干与验收口径，完整方案见 `docs/MEMORY-ARCHITECTURE-v0.7.md`。

### 1. 落地内容

- `architecture-contracts.ts`：`memoryEventSchema` 增 `modelCalls` / `projection` / `visibility`，新增 `source-revoked` / `grant-revoked` / `memory-indexed` / `projection-rebuilt` 四种 kind（共 12 种）。
- `src/memory-log.ts`：append-only `.runtime/memory/events.jsonl`、幂等、advisory 双写、SQLite audit 投影、坏行如实报错；`COLLAB_TEST_MEMORY=memory` 隔离测试动作。`readBridgedEvents()` 把上一轮 `routing-decided` 并入同一重放输入，`bridgeRoutingEvent()` 归一化业务 causedBy（真实 HTTP 冒烟抓到的语义冲突）。
- `src/memory-projections.ts`：纯函数重放 L1 证据图 / L2 组织图 / BM25 向量 / Context Pack；基准时间取事件流而非 `Date.now()`、稳定 checksum；撤权沿 `causedBy` lineage 传播，投影 + 召回双层过滤；`sourceRevocations` 与严格 `revokedSourceIds` 分层，避免把单主体授权撤销放大成全局屏蔽；`assertDeterministic()` 在 `modelCalls≠0` 时明确拒绝。
- 8 处真实写入点双写（`workspaces` 3、`v06` 4、`team-memory` 1、`controller` 2，含 `l2Extract` 的 `result.modelCalls`）；`v06.contextPack` 运行时按 `sourceRevocations` 剔除撤权来源证据边，核对失败 fail-closed。只读 `memory-replay` 与 `npm run memory:replay` / `memory:smoke`。

### 2. 真跑证据（三条红线）

`npm run memory:smoke` `ok:true`：撤权前四类投影 L1 1 / L2 1 / BM25 2 / Pack 1、召回 1 命中；`source-revoked` 后四类派生投影全部归零、召回 **0 命中**、`excludedByRevocation=4`、`modelCalls=0`、两次重放 checksum 各自一致。`npm run memory:replay`：`allWired:true`、`eventCount=2`（桥接真实路由决策）、`replayTwiceEqual:true`、`deterministic:true`、`logErrors:[]`、`danglingCausedBy:[]`。真实 HTTP `POST /workspace/memory-replay` 200 同结果。

### 最新边界声明（以本节为准）

- **已发生**：方案 B1（事件主干、四类投影、三条红线可执行验收、8 处双写、Context Pack 运行时 lineage 过滤、路由契约桥接）；全套回归与真实 HTTP 冒烟。
- **未发生**：B2（读取链正式切到投影消费、真实业务知识类事件、按 principal 精确过滤、投影增量构建）；C（三层 Router 与平台底座切换）；真人在真实业务单「确认验收」（SUI-129 未核可）；Cognee 原生 `cognify` 真实外部调用；生产发布。
- **真实业务知识类事件当前为 0**：主干刚接入，日志里 2 条是上一轮真实策略准入路由决策，不是造数据补齐。
- **红线不变**：原存储（Cognee / Ladybug / SQLite / Paperclip 文档）仍是实际读取源，事件写入失败不影响业务；合并 / 发布 / CI / 报告 / 模型判定不替代原发起人在原会话「确认验收」；`.runtime/memory/` 与 `.runtime/routing/` 不入库，chunk 文本截断 200 字；4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态。

## 0.0000000000000 统一路由契约、共享 Trace 与宿主解耦（2026-11-07 · 第十二轮）

用户决策：把 5 个文件里的「谁把任务交给谁」抽成 `RoutingDecision` 契约并写同一份 Trace；据此判断要不要引入 LobeHub 三层；B 阶段记忆事件复用该契约；可复用尽量复用、可参考尽量参考；LobeHub 不能复制代码但可参考；Super Agent / Agent Autoloop 直接复用；**Paperclip 平台底座与 Plugin SDK 不再作为长期依赖**，改用 DeepSeek Harness / Pi / 已复用部分或其它高 star 开源系统；然后 B → C，不并行。完整方案见 `docs/ROUTING-AND-HOST-v0.7.md`。

### 1. A 阶段收尾（已完成）

- `src/routing-decision.ts`：五维契约（调用方 / 目标角色 / 依据 / 资料范围 / 是否需人签字）+ stage / outcome / causedBy / 幂等 decisionId；五条人签红线集中在 `HUMAN_SIGNATURE_RULES`。
- `src/routing-trace.ts`：`controller / coordination / assistant / service-network / v06` 五个派活点经单例写同一份 `.runtime/routing/events.jsonl`，每行是严格 `MemoryEvent`（kind `routing-decided`），并投影进 SQLite `audit`。只读 `routing-status` 与 `npm run routing:status` 可复核。测试进程经 `COLLAB_TEST_TRACE=memory` 隔离，真实业务日志不含测试动作；隔离前混合日志已归档。
- `src/three-tier-assessment.ts`：用真实 Trace 做 7 条前置条件判断，当前 `recommended=false`（P1 五阶段覆盖 / P3 Personal Agent / P4 主管实体 / P6 单一 Router 未满足）。真实 HTTP `routing-status` 200 返回「暂不引入三层」。
- `src/platform-port.ts`：`HostPlatformPort` 收拢平台能力，`PaperclipPlatform` 为默认薄包装，`LocalHostPlatform` 不依赖 Paperclip 且 `npm run host:smoke` 真跑通过；`config.host.provider` 默认 `paperclip`，**未切换底座**。

### 2. B 的前置已备好，但 B 与 C 尚未开始

`toMemoryEvent()` / `replayRouting()` 给出「同一日志两次重放一致、去重、按时间有序、坏行报错」口径，B 阶段把其余记忆事件接入同一日志即可。C 必须与平台底座切换一起做，先补齐 ACL / cost-ledger / Plugin UI / heartbeat 真实执行 / PG 事务五项。

### 3. 开源复用边界（本轮未引入任何新上游）

已直接复用：Super Agent `policy`、DeepSeek Harness `createScope` 语义、Autoloop `jobId/nonce`、A2A `Link` 字段。可直接复用但列为候选：Pi（`earendil-works/pi`，MIT core）、CoPaw（Apache-2.0）、Octop（MIT）、DeerFlow（MIT）。只参考不复制：LobeHub（Community License）、n8n（Sustainable Use License）。

### 最新边界声明（以本节为准）

- **已发生**：统一路由契约与 5 处接线、同一份 Trace 与只读状态接口、三层可执行判断、平台端口与非 Paperclip 最小宿主真跑、全套回归与真实 HTTP 冒烟。
- **未发生**：运行路由判断 / tab / 路由 / 上游源码未改；**默认底座仍是 Paperclip**，Plugin SDK 未移除；方案 B 记忆主干与 C 三层 router 尚未开始；真人在真实业务单「确认验收」（SUI-129 未核可）；Cognee `cognify` 真实外部调用；生产发布。
- **红线不变**：合并 / 发布 / CI / 报告 / 模型判定不替代原发起人在原会话「确认验收」；真实姓名、`open_id`、密钥与业务正文只在 `.runtime`；4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态。
- **产品形态冲突待用户确认**：移除 Plugin SDK 意味着 5 tab 插件单页要换承载方式，与 PRD §10A 既有约束相反；本轮不动前端。

## 0.000000000000 方案 A 落地、Cognee 原生管线打开、合并与发布自动化（2026-11-07 · 第十一轮）

用户在本轮明确三项决策：**① 允许外部模型 API，`Cognee 原生 LLM / embedding / cognify` 打开并实现好；② 本机合并与发布都放开，但「真人业务验收」仍是红线；③ `A → B → C` 分阶段落地，不并行。** 另要求补齐 `sources.lock.json` 缺登记。

### 1. 先纠正一个事实

核对 `.gitmodules`、`git ls-files -s` 与 `sources.lock.json` 后确认：**Harness 与 Prime Agent 两条登记早已存在**（`fcc0ad46…` / `74591cdd…`），`audit:upstream` 输出 `clean: true`。「缺两条」来自 `OPEN-SOURCE-COMPLIANCE.md` 表格里两行过时的 ⚠️ 标记（同文档第 4 节已记「✅ 已补齐」）。本轮修正这两行与 `ARCHITECTURE-OPTIONS-v0.7.md` 的引用，并在 `tests/architecture-contracts.test.ts` 加机器化断言（7 个 gitlink 与锁文件逐条一致、合规文档不再出现过时告警）。**没有重复补登记，也没有假装补了。**

### 2. 方案 A 落地（顺序上的第一阶段）

新增 `src/architecture-contracts.ts` 作为唯一常量来源：组织本体 16 类节点 / 5 边族 / domain-range 规则（从 `org-ontology.ts` 上移并再导出保持兼容）、ontology 三层分工、三层 Agent 角色、四套运行时来源、共享记忆投影与 `memoryEventSchema`。`ARCHITECTURE-OPTIONS-v0.7.md` 增附录 A 统一 FR 覆盖三态口径。零运行行为变化，`npm test` 288/288。

### 3. Cognee 原生管线打开（允许外部模型 API · 隐私边界已变更）

- `src/config.ts` 新增 `knowledge.cogneeNative`（默认 `enabled: true`），只存**环境变量名**；`src/cognee-native.ts` 解析 `COGNEE_LLM_*` / `COGNEE_EMBEDDING_*`，凭据只经 `spawn` 的进程环境传给 `scripts/cognee-native.py`，不写 `.runtime/config.json` / `secrets.json` / 仓库。
- Python 侧走 Cognee 原版 `add → cognify(extractor='llm') → search`，通过 `LLM_PROVIDER=custom` + `LLM_ENDPOINT` / `EMBEDDING_*` 接外部 OpenAI-compatible 服务；数据目录固定到 `.runtime/cognee-native/`。`npm run cognee:native status|cognify|search` 为入口。
- **未配置端点时明确报中文错，不静默降级成设备端能力**；设备端 Apple NL 语义加权是独立、不外发的链路，两者并存。`ontology.ts` 的 `automaticExtraction` 与 `system-status` / 设置页状态均改为从配置派生，不再写死关闭。
- 真跑：`npm run cognee:native -- status` 返回 `enabled:true, configured:false, missing:[4 个环境变量]`。**真跑 cognify 仍需用户提供外部端点与凭据**；本轮没有外发任何业务材料。

### 4. 本机合并与发布自动化（业务验收红线不变）

- `delivery.autoMerge` / `autoPublish` 默认 `true`。`LocalGitDelivery.decide('approved')` 在本机 CI 通过后自动 `merge-base --is-ancestor` 校验并 `update-ref` fast-forward 推进本机 main，随后自动写固定版本预览制品（`version.json` + `index.html`）；非 fast-forward 明确报错并留可见通知，由人工点「合并」重试，不做自动三方合并。
- 真跑 `npm run delivery:demo`：`ci: passed` → `status: merged`、`mergeSha: c777106e2e7e`（与 `mainSha` 一致）、`publishedAt` 已写入、5 条通知；`git daemon` 未启动故跳过 `git://` 拉取验证（用户已取消 4194/9418，本轮未重启）。
- **仍不做**：发布业务仓库、触发云端 CI、无人值守最终验收、知识自动采用。`local-git.ts` 与交付台页面都明确写着「业务验收仍须由原发起人在原会话『确认验收』」。

### 5. 红线文档同步改写

按用户决策改写了 `PRODUCT.md`、`README.md`、`PRD-v0.6.md`（§1.3 / R5 / FR-15 / 复用矩阵 / Q4）、`ARCHITECTURE-OPTIONS-v0.7.md`（缺口 11 与 C 类清单）、`SYSTEM-ARCHITECTURE.md`、`KNOWLEDGE-ENGINE.md`、`UPSTREAM-ADAPTERS.md`、`VALIDATION.md` 中的旧表述；历史轮次记录保留但统一标注「当时 / 历史，2026-11-07 已变更」，不再把旧口径当作现状。

### 最新边界声明（以本节为准）

- **已发生**：方案 A 统一契约与 FR 口径；Cognee 原生管线代码链路与 CLI 已实现并真跑状态检查；本机自动合并与自动发布真跑通；文档口径统一；`sources.lock.json` 一致性有回归断言。
- **未发生**：Cognee `cognify` 的真实外部模型调用（缺端点与凭据，本轮没有外发材料）；**方案 B 记忆主干重构与方案 C 三层 router 尚未开始**（按 A→B→C 顺序排队，不并行）；真人在真实业务单「确认验收」（SUI-129 未核可）；生产发布与业务仓库发布；4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态。
- **红线不变**：`Agent 完成 ≠ 业务验收`；合并 / 发布 / CI / 报告 / 模型判定都不替代原发起人在原会话「确认验收」；上游源码不改；真实姓名、`open_id`、密钥与业务正文只在 `.runtime`。
- **隐私新边界**：Cognee 原生管线启用后，业务材料会发往用户配置的外部模型服务；这是用户 2026-11-07 的明确决策，配置里不保存凭据。

## 0.00000000000 前端分层重构、产品与业务架构梳理（2026-11-07 · 第十轮）

白话说：上一轮把功能修对了，但前端仍是一个 527 行、35 个顶层声明的单文件，UI 原语、任务详情、设置和页面壳全堆在一起，测试还用源码字符串断言把结构锁死；用户也指出此前只讲了技术分层，产品与业务架构不清楚。本轮做两件事：**按职责重构前端**，并**补一份业务视角的产品架构**；过程中真实浏览器走查暴露并修掉一个间歇性白屏故障。

- **前端分层**：`index.tsx` 缩成 5 行入口；新增 `foundation.tsx`（原语 / 文案字典 / `UI` 契约 / URL 协议白名单 / `ActionError`）、`async.ts`（`useRead` 与 `useActionFeedback`）、`forms.tsx`、`domestic-services.tsx`、`settings.tsx`、`task-detail.tsx`、`spaces.tsx`、`workspace-page.tsx`。依赖单向，`v06-panels.tsx` 删除私有 `useRead` 副本改用共享契约。静态断言测试从「只读 index.tsx」改为按职责读模块或扫描整个 ui 目录，新增 `tests/frontend-structure.test.ts` 5 例结构守卫。
- **体验与真实性**：13 处 `.catch(() => {})` 收敛为「两个高频表单就地错误提示 + 其余统一 `UI.report` 上报」，只保留页面壳两处有注释说明的合理静默（后台轮询不打扰、`invoke` rethrow 避免未处理拒绝）；知识来源与飞书来源外链改走 `safeHttpUrl`；「国内服务」清单补 `ServiceEntry` / `ServiceReport` 类型契约，未接通项在数据契约里就不保证有 `url`。
- **产品与业务架构**：`SYSTEM-ARCHITECTURE.md` 新增「产品与业务架构」章节，写清定位、渠道形态（IM 发起 / 工作台留痕）、三级 owner 与其余角色、8 步端到端闭环及 4 个人工决策点、5 tab 功能地图、功能成熟度三档（已跑通 / 预备配置 / 未接通）与 5 条业务红线；`PRD-v0.6.md` 10A 的工作台文件指针同步到新分层。
- **真实白屏故障修复**：`RUNTIME_FILTER_SCRIPT` 的 `sweep()` 把带 `data-testid` 的宿主外壳 `div.contents` 也列为候选，用几千字全文做关键字匹配；页面文案同时含海外词与「连接」、又不含「已连接」时，会把整个应用外壳隐藏，造成**状态相关的间歇性白屏**（DOM 仍在、无 JS 异常、`body.innerText` 为 0）。改为只遍历小型可交互节点（`MAX_LABEL` / `MAX_CARD` / `MAX_HIDE`），`protectedEl` 拒绝 `#root`、body 与含工作台的大容器，`repair()` 自愈已误隐藏节点。走查每步新增 `bodyTextLen` / `shellHidden` 断言，复跑 11/11。
- **验证**：`npm test` **283/283**（新增 5 例结构守卫）、`tsc --noEmit`、`build:workspaces`、`build:chinese-shell`、`test:responsive`、`test:walkthrough` **11/11**、`audit:upstream`、`git diff --check` 全绿；真实浏览器每步页面文本非空、外壳未隐藏、隐藏元素恰为 3 个未接通海外入口。详见 `docs/VALIDATION.md` 第十轮。

### 最新边界声明（以本节为准）

- **已发生**：前端按职责拆分且共享原语 / 异步契约统一；写操作不再静默吞错、外链经协议校验；产品与业务架构、角色口径、功能地图与成熟度三档写入文档；宿主外壳白屏故障修复并有浏览器断言守门；**新增 `docs/ARCHITECTURE-OPTIONS-v0.7.md`**（三种收敛方案、主流记忆 / ontology / router 架构分析、14 项未实现能力清单与开源复用补齐映射、许可证边界），README 增加架构导航。该文档是**方案，不是已实现声明**，落地需先选方案。
- **未发生**：本轮**没有新增业务功能、没有新增 tab、没有改路由与上游 UI**，是结构重构 + 文档；真人在真实业务单上「确认验收」（SUI-129 未核可）；部门 scope 本人在飞书确认；企业微信 / 腾讯文档 / 钉钉 / 国内代码托管 / 公有云 CI / 海外 SaaS 的实际连接；生产发布、真实外部 PR / CI、真人多租户、Cognee 原生模型管线；4190 / 4192 保持用户取消时的停机状态。
- **红线不变**：合并审批 ≠ 业务验收；未接通服务一律不提供入口；真实姓名、`open_id`、密钥与业务正文只在 `.runtime`；上游源码不改；`Agent 完成 ≠ 业务验收`。

---

## 0.0000000000 全量功能体检与国内服务状态真实性（2026-11-07 · 第九轮）

白话说：第八轮的「国内服务」页守住了「没连接不放空入口」，但状态多半是写死的一次性快照，用户按提示启动服务后不刷新页面也看不到入口；全套回归还暴露了两个硬故障。本轮做的是**把状态变成真实探测**、把体验补齐，并修掉体检中发现的假状态与旧文案。

- **两个硬故障**：中文壳重复构建必失败（上游 `closeBundle` 就地 stamp 了 `dist/sw.js`，占位符消失），构建前从 `public/sw.js` 恢复后连续两次成功；`tests/v06-services.test.ts` 固定 `at` 导致授权 8 小时后必然过期，改为相对当前时间。
- **数据驱动的服务清单**：新增 `src/service-status.ts` 与 `service-status` 只读 action，并发实时探测 3100 / 4190 / 4192 / 4194，逐项标注状态来源；接通后自动出现入口，未接通项给原因与可照做的接通步骤，仍无任何空壳链接。交付台健康响应增加服务身份校验；Paperclip 的 SPA HTML `/health` 按「200 + `<html`」判定在线。
- **体验与诚实性**：前端自动 / 手动刷新、加载态与独立错误态；设置页两个读分别降级、保存失败就地提示；`system-status` 的 `vectorSearch` / `automaticExtraction` / `visionReviewer` 从配置派生，界面不再宣称「向量检索未接入」或「视觉模型核对截图内容」；清掉残留的 GitHub / PR 文案，外链加协议白名单。
- **截图复核补修**：宿主侧栏 `/SUI/skills` `/SUI/apps` 带公司前缀，原运行时路由正则漏匹配，已改为覆盖前缀并同时隐藏 `li` 容器，走查加禁用缓存与 `hostNavHidden` 断言；自动轮询瞬时失败改为静默保留旧数据、只在状态行标注，手动刷新失败才提示。
- **验证**：`npm test` **278/278**、`tsc`、`build:workspaces`、中文壳连续两次构建、`test:responsive`、`audit:upstream`、`git diff --check` 全绿；`test:walkthrough` **11/11**，真实浏览器测得国内服务页 12 行、仅 2 个 loopback 链接、0 个坏链接、侧栏两个未接通入口已隐藏。真实 HTTP 冒烟三个状态接口均 200。详见 `docs/VALIDATION.md` 第九轮。

### 边界声明（历史记录，最新以 0.00000000000000 节为准）

- **已发生**：服务清单改为实时探测并可自动刷新；构建幂等与时间炸弹修复；状态字段与界面文案不再与配置矛盾；新增 12 例状态层测试与 1 个浏览器走查步骤。
- **未发生**：真人在真实业务单上「确认验收」（SUI-129 未核可）；部门 scope 本人在飞书确认；企业微信 / 腾讯文档 / 钉钉 / 国内代码托管 / 公有云 CI / 海外 SaaS 的实际连接；生产发布、真实外部 PR / CI、真人多租户、Cognee 原生模型管线、`lobehub/acceptance` CLI 与云端服务；4190 / 4192 保持用户取消时的停机状态。
- **红线不变**：合并审批 ≠ 业务验收；未接通服务一律不提供入口；真实姓名、`open_id`、密钥与业务正文只在 `.runtime`；上游源码不改。

---

## 0.000000000 组织映射落地、国内前端适配与本机代码交付（2026-11-06 · 第八轮）

白话说：上一轮把「组织表怎么导入」做成了能力，但还没真的导入；前端还留着 Paperclip 自带的海外入口，用户看到的「GitHub 交付」在国内环境也用不上。本轮把这三件都收口，**并且明确：没连接的服务不放可点空壳入口**。

- **组织 owner 核对并导入**：owner 确认 2 名成员已不在组织内，只导入其余 3 人（真实姓名与标识只在 `.runtime`）；owner 决策持久化到 `.runtime/v06/org-owner-decisions.json`，预览自动排除，避免历史会话成员反复回来。修掉「只带 2 个新 scope 会清空现有 162 个 scope」的危险授权命令，新增 `npm run org:auth`；修掉 `restart:bridge` 在禁用 `ps` 的沙箱里无法工作的问题。实测注册表版本 2、成员 3、`applied` 有记录。
- **前端国内适配**：构建期收敛侧栏技能库 / 连接服务入口（4 条规则全命中），运行时用同源静态资源隐藏**未连接**的海外集成卡片；中文壳串进 `install:upstream` 与 `up` 保证默认生效；插件设置新增「国内服务」，只给实测接通的服务链接，未接通项只做文字说明。
- **本机代码交付**：`DeliveryAdapter` 抽象 + `src/local-git.ts` 实现，`delivery.provider` 默认 `local`。`npm run delivery:serve` 提供 `git://127.0.0.1:9418`（clone / pull / push）与 `127.0.0.1:4194` 中文交付台（提交、本机 CI、合并审批、通知记录、确切提交预览）；`npm run delivery:demo` 真跑通全流程。GitHub 适配器保留，可显式回退。
- **验证**：`npm test` 266/266、`tsc`、`build:workspaces`、`build:chinese-shell`、`test:walkthrough` 10/10、`test:responsive`、`audit:upstream`、`git diff --check` 全绿。完整记录见 `docs/VALIDATION.md` 第八轮。

### 边界声明（历史记录，最新以 0.00000000000000 节为准）

- **已发生**：组织 owner 完成成员核对并导入 3 人（只登记派单候选，不等于真人登录或资料权限）；部门 scope 授权命令已生成但**仍需本人在飞书确认**；本机 Git 交付台真跑通 clone/pull/push、本机 CI、合并审批与预览；前端入口收敛与中文壳默认生效。
- **未发生**：真人在真实业务单上执行「确认验收」（SUI-129 仍未最终核可）；企业微信 / 腾讯文档 / 钉钉 / 国内代码托管平台 / 公有云 CI 的实际连接；生产发布、真实外部 PR / CI、真实员工多租户、飞书进群；Cognee 原生模型管线、L2 在真实新资料上的端到端触发；`lobehub/acceptance` 的 CLI 与云端报告服务。
- **红线不变**：合并审批 ≠ 业务验收；模型与报告只提供证据，不代替原发起人在原会话「确认验收」；真实姓名、`open_id`、密钥与业务正文只在 `.runtime`，不入库、不上传云端；未接通的服务一律不提供入口；上游源码不改，适配全在本项目层。

---

## 0.00000000 本机服务总览与 independent 链路恢复（2026-11-06 · 第七轮）

白话说：第六轮交付完，本机实例的独立评审链因为 `4190` 视觉端点停机而处于半断状态；同时也没有一个地方能一眼看全「服务是否活着、现在走哪条验收链、用户能说什么、证据在哪」。本轮做的是**恢复**与**可见性**，不是新增业务能力。

- **恢复链路**：常驻重启 `npm run vision:start`，用真实的 `LocalModelVisionAdapter.review()` 对工作台截图跑了一次端到端视觉判定（设备端 OCR 识别 80 段文字、判定通过、返回 3 条限制）。端点停机时独立评审会失败而非静默降级，这一点在 README 中写明。
- **一页看全**：`npm run acceptance:serve` 新增只读 `/overview`，用 `node:http` 直连实时探测 3100 / 4180 / 4190 / 4192，展示验收链配置、中文指令、按清单确认验收四步、脱敏组织草案与归档报告入口；组织草案只读取计数与布尔值，真实姓名与 `open_id` 不进页面。
- **验证**：`npm test` 253/253、`tsc --noEmit`、1280 / 425 两档 Chrome 截图无溢出；四个服务实测全部在线。完整记录见 `docs/VALIDATION.md` 第七轮。

**边界不变**：总览页是状态展示，不是验收动作；没有替真人「确认验收」、没有导入组织表、没有新建真实业务任务。`confirmAcceptance` 仍待真人在真实一单上执行，SUI-129 仍未最终核可。

---

## 0.0000000 用户语言层、真实组织映射与本机验收报告（2026-11-06 · 第六轮）

白话说：第五轮把规则、界面和一单真实任务都跑通了，但用户还得记 `/accept` 这种英文命令，组织里「谁属于哪个职能」仍要手填，逐项验收报告只能看 JSON 和 Markdown。本轮补的就是这三件「最后一公里」——**用户在会话里说中文、组织成员从真实通讯录读成草案、验收报告在本机可读可归档**，同时不把任何一步说成「系统替人签了字」。

### 1. 用户看到的不再是协议词

- `src/user-language.ts` 是统一的语言层：建任务 / 查看进度 / 补充说明 / **确认验收** / 验收不通过 / 转交全用中文；`CONFIRM_ACCEPT = '确认验收'` 是报告、界面、通知复用的唯一说法。旧英文斜杠命令仍可解析（保护已跑通的脚本与链路），但**不再出现在帮助文案、README 示例、工作台、验收报告或通知里**，只作为内部兼容语法并写审计 `user.command.legacySyntax`。
- `Controller.ingest()` 改为走 `parseUserCommand()`；闲聊与 @ 仍不建任务，保持「只有明确指令才触发」的红线。
- 顺手修掉两处会让用户踩空的地方：①「任务进度 SUI-1」原会被「任务」前缀抢走当成建单，现由状态别名优先处理；②帮助文案原写「要办的事直接说」，与实现不符，改为明确写明「任务 要办的事」并注明闲聊不建单。③仓库默认 `acceptance.mode=legacy` 时，「确认验收 SUI-1」缺交付提交号会落到英文底层校验错误，现给出可照做的中文指引「确认验收 任务编号 交付提交号」，**CI / 部署版本核对这条红线没有动**。

### 2. 按开工前锁定清单确认验收：真人仍是唯一签字人

- 新增 `Controller.confirmAcceptance()`，与代码交付验收 `accept()` **并列而非替换**：`ingest` 只在「已锁定清单 + `acceptance.mode=independent`」时走它；其余仍走原有的「交付提交 + 发起人核可」。
- 硬闸门一个没省：原发起人身份（`context.requesterUserId`）→ 读回锁定清单 → 读回独立逐项评审报告 → `toAcceptanceCases()` 要求**所有检查项 passed**（有未通过 / 受阻项直接抛错，绝不算作通过）→ `verifyAcceptanceGate()` 复核清单哈希、文档修订、评审者独立性、视觉能力与事件流 → 写 `acceptance` / `decisions` 文档、改 `done`、追加 Trace、发中文通知。回执如实写 `environment: '工作台逐项评审（不是代码部署环境）'`，`decisions` 注明「不代表生产发布、其他功能或后续版本通过」。
- `tests/confirm-acceptance.test.ts` 真跑 Controller：全通过路径的归档 / 状态 / 留痕 / 通知，以及身份不符、无锁定清单、存在未通过项、清单被改写四种拒绝（均断言 `patches` 为空、任务阶段未变）；另用真实 SQLite Store 验证会话里一句「确认验收」端到端路由到该路径，以及 legacy 模式缺提交号时的中文提示。
- **边界**：这是一条已实现且有端到端单测的代码路径，**没有由真人在真实业务单上执行过**；第五轮 SUI-129 仍保持「未最终核可」。仓库默认 `legacy`，本机 `.runtime/config.json` 的 `independent` 不入库。

### 3. 飞书组织映射：读成草案，不自动生效

- `src/feishu-org.ts` + `scripts/org-mapping.ts`（`npm run org:preview` / `org:apply`）：只读当前授权范围可见的真实成员生成草案；`FeishuOrgService` 可注入以便无凭据测试，失败返回结构化草案而不打挂工作台。
- 本机实测 `org:preview` 读到 **5 名真实成员**，部门字段全为空时如实置 `departmentScopeMissing: true` 并给出一次性授权命令，不编造部门；`open_id` 按应用隔离，跨应用绑定必须由管理员按姓名 / 工号显式确认。
- 草案**不参与派单**。`org-mapping-apply` 要求组织级 owner、携带职能注册表当前修订号做乐观校验、职能必须存在且启用、已有主职能不覆盖（保留已派生领域与快照）；导入记录只写本机配置层并记审计。
- 前端「设置 → 组织规则」新增第 10 段「飞书组织映射」只读状态；`v06-org-mapping-view` 不触发外部通讯录读取，避免页面等待远端接口。
- **边界**：草案**未导入**职能注册表（实测 `applied: false`，注册表仍只有 1 名成员）；真实姓名与 `open_id` 只写 `.runtime/`（gitignore，不入库）；**成员映射 ≠ 真人登录 ≠ 多租户**，仍没有第二位真人登录的运行证据。

### 4. 本机验收报告服务：可读、可归档、可回放，但不启动云端

- `src/acceptance-report.ts` + `scripts/acceptance-report.ts` 提供 `acceptance:list` / `acceptance:report` / `acceptance:serve` / `acceptance:self-check`：把 Apache-2.0 的 `result.json` 渲染成中文 HTML（逐项判定 + 证据文件 + 锁定清单 + 自查标准 + 判定限制），索引列出所有归档轮次；报告服务**只监听 `127.0.0.1:4192`**，业务正文、密钥与截图不上传。
- `Controller.runIndependentReview()` 把打回原因经 `recordSelfCheck()` 幂等沉淀为下次自查标准，落 `.runtime/v06/self-check-standards.json`，**不改写已锁定的清单**。
- 工作台「协作 → 验收与责任 → 验收」新增「验收报告与自查标准」只读 Box（`v06-acceptance-report-view`）；`server.ts` / `members.ts` / `V06Services.dispatch` 三处只读白名单同步登记 `acceptance-report-view` 与 `org-mapping-view`。
- **边界**：`lobehub/acceptance` 的 **CLI 与云端报告服务仍未启动**，本机服务只读取已归档结果、不触发任何外部服务；报告与自查标准都只是证据，**不代替原发起人在原会话确认验收**。

### 5. 验证与接线

- 全量回归：`npm test` **252/252**、`tsc --noEmit`、`npm run build:workspaces`、`npm run test:responsive`（1280 / 425 均 0 越界、425 按钮 44px）、`npm run test:walkthrough` **10/10**、`npm run audit:upstream`（7 submodules, `clean: true`）、`git diff --check` 全绿。详见 `docs/VALIDATION.md` 第六轮。
- 真实 bridge 实测：`v06-acceptance-report-view` 返回 `available: true / verdict: pass / 2 cases / 1 归档轮次 / 1 条自查标准`；`v06-org-mapping-view` 返回草案与注册表版本；`v06-org-overview` 十段齐全且 `feishuOrg.ok: true`。本机报告服务 `/health` 返回 `loopback-only`，索引与报告页均含中文边界声明。
- 环境备注：本轮首次跑宿主走查时 9/10 步失败，截图为 `connect failed: Connection refused`；查 `.runtime/logs/` 后确认是**宿主服务继承了已失效的旧代理端口**（本机插件 worker 连 `127.0.0.1:4180` 被旧 `HTTP_PROXY` 劫持），不是前端或 action 回归。以干净的本机连接环境重启 3100 / 4180 后复跑 10/10 通过。

### 边界声明（历史记录，最新以 0.00000000000000 节为准）

- **已实现**：中文用户指令与中文帮助 / 报告 / 通知（旧英文命令仅内部兼容）、按锁定清单的确认验收路径与全套闸门（含端到端单测）、飞书真实成员的只读组织草案与人工确认导入通道、本机中文验收报告服务与自查标准沉淀、两个新增只读视图接线、全套回归与宿主走查。
- **仍未实现 / 不得宣称**：真人未在真实业务单上执行最终确认验收；飞书组织草案未导入注册表，真实员工多租户 / 第二位真人登录仍未部署；生产发布、真实 PR 与 CI 交付；**Cognee 原生** LLM / embedding / cognify / 自动实体抽取与向量语义管线；L2 自动抽取在真实新确认资料上的端到端触发（`lastRun` 仍为空）；`lobehub/acceptance` 的 CLI 与云端报告服务（本机服务不替代它们，也不等于上游能力已启用）；把单测或浏览器截图冒充生产验收。
- **可回退**：仓库默认 `acceptance.mode=legacy` 一行回到原交付提交核可流程；只有本机 `.runtime/config.json` 开了 `independent`，该文件不入库。

---

## 0.000000 真实一单、本机视觉模型与收尾（2026-11-06 · 第五轮）

本轮把第四轮列出的「仍未做」逐条做完，并完成 GitHub 推送合并与本地演示。用白话说：之前是「规则写好了、界面有了，但没在真实一单上从头跑到尾，也没有真的看图」；现在这些都在本机真实实例上跑过一遍。

| 第四轮仍未做 | 第五轮落地 |
|---|---|
| 真实视觉语义模型 | macOS Apple Vision 设备端 OCR + 图像分类，只绑定 `127.0.0.1:4190`；`LocalModelVisionAdapter` 只允许本机 http 直连；SUI-129 逐项判定 **2/2 passed** |
| `lobehub/acceptance` submodule | Apache-2.0 `f720feb…` 固定引入；`src/acceptance-interop.ts` + `scripts/export-acceptance.ts` 映射计划 / 报告格式；LICENSE / NOTICES / SOURCES / lock / audit 全部补齐；其 CLI 与云端报告服务未启动 |
| 真实跨职能一单 | 飞书单聊 → Paperclip `SUI-129` → 锁定 2 条验收清单 → Transfer L0 卡片 → Trace 捕获事件 → 本机视觉独立评审 → Acceptance bundle → GitHub issue #1（已关闭） |
| 宿主实例全流程浏览器验收 | `npm run test:walkthrough` 用真实 Chrome CDP 走查 5 tab + 3 个 v0.6 子视图，**10/10 通过**；425px 无溢出、按钮 44px；修掉 worker action 正则与「责任」空态误报 |
| `runtimeGuard.enforce` 开启 | 默认 `true`，注意力预算 / Watchdog 从「只观测」切到实际生效，人工必达通知由 `protectHumanNotifications` 保护 |
| 本地语义检索 | Apple NaturalLanguage 设备端 300 维中英文词向量接入 recall 加权，无需 API Key、无需下载模型、无外部服务；`system-status` 报 `vectorSearch: true` |
| 本地演示 | `.runtime/walkthrough/demo.html` 可交互时间线 + 真实浏览器截图 + 能力全景 + 边界说明，`demo-preview.png` 为渲染预览；均在 `.runtime`，不入库 |

**顺带修掉的真实宿主问题**：`plugins/.../worker.ts` 的 action 正则 `/^[a-z-]+$/` 不允许数字，导致全部 `v06-*` 请求返回 `Invalid workspace action`（新增 `action-name.ts` 统一守卫）；中文句中「。验收：」被旧正则吞掉（`controller.ts` 的 `businessAcceptanceFrom()`）；`LocalModelVisionAdapter` 受 `HTTP_PROXY` 影响报 `fetch failed / bad port`（改 `node:http` 直连）；「责任」视图把「无跨空间授权申请」的正常空态显示成「暂不可用」（`grantCheck` 返回 `null`）；Acceptance bundle 同一证据重复列出（`written` 改 `Set`）；425px 子导航按钮 40.8px（补 `.sm-task-stage button{min-height:44px}`）。

**验证**：最终全量回归见 `docs/VALIDATION.md` 第五轮；`npm test`、`tsc --noEmit`、`npm run build:workspaces`、`npm run test:responsive`、`npm run test:walkthrough`、`npm run audit:upstream`、`git diff --check` 全部通过。

### 第五轮边界声明（历史记录，最新边界以 0.00000000000000000000000 节为准）

- **已实现**：开工前锁清单、独立评审（真实本机视觉）、逐项判定、Acceptance 格式导出、Transfer / 责任链、统一 Trace（含缺口如实提示）、L2 组织图确定性抽取与状态视图、runtimeGuard 强制、本机语义加权、三个 v0.6 视图、真实一单与全流程浏览器走查、本地演示、GitHub 推送合并。
- **当时仍未实现 / 不得宣称（历史轮次，2026-11-07 口径变更见第十一轮）**：真实业务最终 `/accept` 未由发起人执行；真实员工多租户与飞书组织映射；生产发布 / 真实 PR 与 CI 交付；**Cognee 原生** LLM / embedding / cognify 与向量语义管线（当时关闭，现已打开）；L2 自动抽取在真实新确认资料上的端到端触发（`lastRun` 仍为空，只有契约与状态验证）；Acceptance 的 CLI 与云端报告服务；把 `.runtime` 截图或单测冒充生产验收。
- **可回退**：仓库默认仍可用 `acceptance.mode=legacy` 一行回到原 `/accept`；只有本机 `.runtime/config.json` 开了 `independent`，该文件不入库。

---

## 0.00000 L2 抽取闭环、P3 后半段与独立评审链（2026-11-06 · 第四轮）

用户澄清：**L2 组织图连 Cognee 自动抽取并不是「不做」，当时只是没有模型可测**。本轮在不启用任何新模型服务的前提下把管线做完整，并按之前给出的两个方向依次完成。

### 1. L2 组织图连 Cognee 自动抽取（FR-06/08/09）

- `src/graph.ts` 新增 `KnowledgeGraph.readProjection()` 与 `CogneeL1Reader`：只走既有 `op=read` 路径读**一个** `sourceId@revision` 的 Cognee 投影，不调用 `project`、cognify、embedding，`modelCalls = 0`；读取前再跑一次跨版本泄漏检查。
- `src/org-extraction.ts` 是完整的抽取管线：`L1Reader → ExtractionAdapter（提案）→ 逐字证据校验 → 本体规则校验 → 稳定 ID 去重 → L2 草稿边`。默认 `DeterministicExtractionAdapter` 从 Cognee 结构化字段、已人审概念与谓词按显式字典生成边，**模型调用 0、无需模型即可测**；`ModelExtractionAdapter` 预留同一提案形状，将来接视觉/语言模型无需改管线。
- 每条草稿边带 `{ sourceId, revision, excerpt }`，摘录必须逐字出现在该 L1 投影里；状态恒为 `draft`，`assertUsable` / `eligibleForContextPack` 仍拒绝它作为依据，**人验收才生效**。重复抽取幂等，绝不重置已验收状态。
- 全局 L2 图存组织级配置（`org-graph:global` / `org-edges:global`），任务文档只是给现有 5 tab 工作台看的镜像；`v06-l2-status` / `l2-edges-view` / `l2-graph-view` / `l2-extract` 已登记，`org-overview` 由 8 段扩到 9 段，「关系与状态」页新增抽取状态块。
- `TeamMemory.index` 投影成功后经 `Workspaces.onSourceIndexed` 自动触发抽取（best-effort、失败只写审计，绝不回滚已验证的 L1 索引）；`config.orgExtraction.autoRunOnIndex` 可关。**L1 按 `sha256(sourceId@revision)` 物理隔离的边界完全未动**。

### 2. P3 后半段：窄屏走查 + 上游适配代码整理

- `scripts/responsive-audit.ts`（`npm run test:responsive`）用本机 Google Chrome headless 渲染**真实插件样式 + v0.6 面板骨架**；因 Chrome headless 最小窗口 500px，改用定宽 iframe `srcdoc` 得到精确 1280 / 425 视口。结果写 `.runtime/responsive-audit.json`。
- 走查实测发现并修复：子导航按钮在 425 只有 41px → 补 `.sm-v06 button{min-height:44px}`；长 JSON 摘要与 6 列表格可能撑出页面 → 补 `min-width:0` / `overflow-wrap:anywhere`，表格改为**在自身容器内横向滚动**（`min-width:620px`）。最终两档均 `scrollWidth == clientWidth`、0 个越界元素、425 按钮 ≥44px，截图存 `.runtime/responsive-425.png`。**这是布局走查，不是宿主实例的全流程浏览器验收**。
- `docs/UPSTREAM-ADAPTERS.md` 把 6 个上游分别对应到「运行时 / 知识引擎 / 业务编排 / 前端插件 / 安装锁定 / 声明审计」六组适配文件；`scripts/audit-upstream.ts`（`npm run audit:upstream`）机器化校验 gitlink vs `sources.lock.json`、上游工作树干净、LICENSE/NOTICE 齐全、声明包含各上游、无强传染协议文本、L2 抽取不含 Cognee 写入调用。结果 `.runtime/upstream-audit.json` 全绿。**未搬迁/删除上游文件、未升级 submodule、未改上游源码**，避免打断已验证构建路径。

### 3. 独立视觉评审 + 开启新验收流程（FR-16~19 / FR-25）

- `src/visual-review.ts` 提供可插拔 `VisualReviewAdapter`：`structural`（默认，确定性、可接收截图/录屏、核对哈希/来源/事件绑定，如实声明 `semanticJudgement: false`）与 `model`（OpenAI 兼容**本机**端点，端点非 localhost 直接拒绝构造，密钥只从环境变量读）。`VisionReviewer` 实现 `IndependentReviewer`，能力为 `vision: true / independent: true`，评审者 ID 与产出模型不同。
- 缺少截图/录屏时**不假装看过图**：降级为「仅依据统一事件流中捕获/导入证据判定」，并把「视觉内容未核验」写进 `limitations`；没有任何可回放证据则逐项 `blocked`，闸门不放行。
- `Controller.runIndependentReview()` 把「锁定清单 → 独立评审 → 逐项报告 → `verifyAcceptanceGate`」串成完整链路；`accept()` 在新流程下缺报告时自动跑一轮（报告只是证据，**最终核可仍是原发起人 `/accept`**）。`/workspace/acceptance-review` 可显式重跑。
- `config.acceptance.mode`：`legacy`（仓库默认，原流程零回归）/ `independent`（开启新流程：`mode` 或旧 `sealPlanOnCreate` 任一打开即生效）。**本机 `.runtime/config.json` 已切到 `independent` + `structural`，重启 bridge 后生效**；把 `mode` 改回 `legacy` 即恢复旧 `/accept`。接真实视觉模型只需把 `visualReviewer.mode` 设为 `model` 并填本机端点。

### 验证

`npm test` **204/204 通过**（新增 16 例：L2 抽取 6、独立评审链 6、响应式/上游静态守卫 4）；`tsc --noEmit`、`npm run build:workspaces`、`npm run test:responsive`、`npm run audit:upstream`、`git diff --check` 全绿。

### 第四轮当时的仍未做（已在 0.000000 节逐条补齐，勿再按本条对外表述）

真实视觉模型的语义判定（当时本机无模型，结构式评审只核验证据绑定）；`lobehub/acceptance` submodule 引入；真实「飞书 + Paperclip + GitHub」跨职能一单；`runtimeGuard.enforce` 开启；宿主实例的完整浏览器流程走查。**当时保留下来的两条（历史，2026-11-07 已变更其一）**：Cognee 原生 LLM/embedding/cognify 与向量语义检索当时全部关闭（L2 抽取是确定性投影，不是语义抽取），现原生管线已打开；上游冗余适配代码本轮只做了清单与边界审计，未做实际重构 / 替换。

---

## 0.0000 P3 前端增补与执行链路接入（2026-11-06 · 第三轮）

按既定顺序进入 P3。**主导航仍为 5 个 tab，未新建独立 app、未改宿主路由、未改上游 Paperclip UI**；三个视图全部长在现有 tab 的二级导航里，符合 PRD 10A 节 S5/S6。

| 现有位置 | 新增视图 | 数据来源 | 用户能看到什么 |
|---|---|---|---|
| 协作 → 任务详情 | 「验收与责任」panel（`v06-panels.tsx` / `GovernancePanel`） | `v06-plan-view`、`v06-round-view`、`v06-review-readiness`、`v06-transfer-view`、`v06-grant-check`、`trace-view` | 开工前锁定的验收清单与原生修订号、逐项判定报告、独立评审未就绪原因、Transfer 授权卡片（含撤销）、跨空间授权状态、统一过程流水（时间 / 事件 / 执行者 / 依据 / 成本 / 证据缺口） |
| 知识 → 新增子 tab | 「关系与状态」（`KnowledgeStatePanel`） | `v06-edges-view`、`v06-context-pack` | L2 组织图每条关系的状态（草稿 / 已验收 / 可复用）、生效与失效时间、证据数，可验收 / 标可复用 / 置失效；Context Pack 一次性投影快照 |
| 设置 → 新增子 tab | 「组织规则」（`OrganizationPanel`） | `v06-org-overview` 一次汇总 8 段 | 职能注册表、Transfer 授权策略、Workspace 政策、注意力预算、Watchdog、独立评审就绪度、默认本体、组织信号；**只读、逐段独立降级、只提示不排名** |

**后端配套**

- `v06.ts` 新增 3 个只读投影：`plan-view` / `round-view` / `org-overview`；`context-pack` 一并登记进 `server.ts` 与 `members.ts` 的 `v06Reads`，避免只读请求被排进写队列。
- 新增 `src/runtime-bridge.ts`：把 FR-22/23/24 的注意力预算与 Watchdog 契约接到**真实执行链路**——`assistant-result`（模型调用）与 `assistant-receipt`（执行回执）每轮产生一条 `v06.runtime-observed` 审计。**默认只观测**：不改通知、回执、租约、恢复或任务状态；`config.runtimeGuard.enforce` 为可开启开关，默认 `false`，开启前必须先跑通真实 journey。仓库既有的合并、自身进度排除、每轮工具上限与会话接续逻辑完全未动。

**三问复核**：会话里由既有 `channels.renderForChannel` + outbox 表达（本轮未改会话文案）；工作台按上表三个位置留痕；签字人仍是原发起人 `/accept`，Transfer 联签与 owner 兜底不变。

**验证**：`npm test` **188/188 通过**（新增 9 个用例，含只读 action 登记与三个视图接线断言）、`tsc --noEmit` 通过、`npm run build:workspaces`（esbuild 打包 + 插件 `tsc --noEmit`）通过。

**当时的仍未做（已在 0.00000 节更新，勿再按本条对外表述）**：前端未在真实浏览器做 1280 / 425 走查；独立视觉评审模型、Acceptance submodule 引入、真实跨职能 journey 仍未完成；L2 组织图未连 Cognee 自动抽取管线（当时误判为「不做」，用户澄清只是没有模型可测，第四轮已补齐）；`runtimeGuard.enforce` 未开启；上游复用代码整理（P3 后半段）未开始；`config.acceptance.sealPlanOnCreate` 仍默认关闭。

---

## 0.000 功能补全（2026-11-06 · 第二轮，已提交 `7791c7b`）

在底座提交 `f27a0e1` 之后，按 PRD 第 5 节把功能补齐到可调用、可测试、可留痕。**前端仍一行未改**；所有新能力经现有 `/workspace/v06-*` action 走「IM 会话 + 插件式工作台」形态，语义对象统一由 `channels.renderForChannel` 渲染，不另起界面。

| FR | 能力 | 落地文件 | 接入方式 |
|---|---|---|---|
| FR-01/02/03/28 | 职能注册表、三层能力模型、粒度自检、配置版本与审计 | `src/roles.ts`、`src/v06-store.ts` | 组织级配置（本地配置层），SQLite 只写审计；变更版本化、历史存职能快照不回溯 |
| FR-11/12/13 | Transfer 授权卡片、双段责任链、标准外置、高风险联签、L0→L2 放宽与自动收紧 | `src/transfer.ts` | 任务级事实写 Paperclip 原生文档；卡片文本经现有 outbox 推送到会话 |
| FR-16/18 | Acceptance Plan 增加 `draftedBy`，可插拔独立评审者 | `src/acceptance-plan.ts`、`src/independent-review.ts` | `Controller.sealAcceptancePlan` 在跨职能任务上强制由目标职能 owner 起草标准；`/accept` 前增加 Transfer 一致性校验 |
| FR-06/07/09/14/26 | 图谱边状态、Context Pack 投影、标签 × 能力双向校验、复用影响面 | `src/knowledge-edges.ts` | L2 组织图层；**L1 按 `sha256(sourceId@revision)` 物理隔离的证据图完全未动** |
| FR-10 | 跨空间申请授权（目标空间 owner 审批、最小可见子集、只读、可撤销） | `src/context-grant.ts` | 复用现有 `access-contract` 思路，补 owner 与期限字段 |
| FR-05/20 | 汇报拓扑开关、验证等级 L1–L4 与不可下调底线 | `src/workspace-policy.ts` | Workspace owner 只能加严；对外 / 资金 / 客户可见强制 L4；事件订阅直通在工程层不可关 |
| FR-21 | 组织状态信号面（只读、只预警、不排名）与次日复测闭环 | `src/organization-signals.ts` | 只读信号 + 聚类 + 建 Task + 复测记录，不产生考核视图 |
| FR-08 | 默认组织本体：16 类节点、五类边、三类查询 | `src/org-ontology.ts` | **L2 组织图**，与 `src/ontology.ts`（Cognee 字典校验）职责分离；节点/边级可达性供 FR-10/26 使用 |
| FR-22/23/24 | 介入叫停、两级注意力过滤、Watchdog | `src/runtime-guard.ts` | 把仓库既有零散规则（自身进度排除、每轮 ≤12 次工具、每委托 ≤2 次复查、ask 释放执行）显式化、可配置、可测；**未替换现有运行时**，无检查点禁止自动重放 |
| 编排 | 统一分派、权限分级、渠道渲染、会话通知 | `src/v06.ts`、`src/server.ts`、`src/members.ts` | 50+ 个 `v06-*` action；组织级配置写操作要求组织 owner；审批以**认证身份**为准 |

**验证**：`npm test` 179 个用例、`tsc --noEmit` 通过。新增 6 个测试文件覆盖规则与端到端链路，含「无职能注册表时不改变原有扁平派单」「Transfer 卡片在纯文本渠道不丢字段」「无 Transfer 时 `/accept` 沿用原发起人核可」「本体边规则与可达性」「Watchdog 无检查点不自动重放」。

**第二轮当时的仍未做（已在 0.000000 节补齐，勿再按本条对外表述）**：
- **前端**：现有 5 tab 工作台未新增视图，只能在 API 层调用；P3 才补界面。
- **独立视觉评审模型**：当前注册的是 `TraceEvidenceReviewer`，只做证据绑定、明确声明 `vision: false` / `externalModelEnabled: false`，`review-readiness` 会如实返回「FR-18 未就绪」；接入视觉模型前**不开启** `config.acceptance.sealPlanOnCreate`。
- **Acceptance submodule 引入**：未引入，仅自研同等契约；引入前按 `OPEN-SOURCE-COMPLIANCE.md` 第 4 节补齐协议材料。
- **图谱接入真实 Cognee 语料图**：边状态目前是产品层 L2 记录，未与 Cognee 的自动抽取管线连通（LLM/embedding 仍关闭）。
- **完整真实 journey**：单测覆盖契约与编排，尚未在真实飞书会话 + Paperclip + GitHub 链路上跑通跨职能一单。
- **接入现有执行链路**：注意力策略 / Watchdog 目前是独立契约与 API，尚未自动挂到 `Assistant` / `Autoloop` 的每轮执行上（保留现有实现不动，避免回归）；介入叫停复用现有 `stopped` / `reconcile` 能力，未替换。

---

## 0.00 底座先行（2026-11-06 · 第一轮，已提交 `f27a0e1`）

用户本轮确认：动的是代码；**先优化底座，再把功能全部补上**；现有已跑通的功能复用、不重写；**现有「IM 会话 + 插件式工作台」就是产品形态本身**，PRD 语义要嫁接到它上面；所有讨论过的开源项目都可作为复用对象，但**协议各不相同，必须逐一说明**。

> 本节是第一轮历史记录，已于 `f27a0e1` 整体提交。第二轮进展见 0.000 节，两处描述以 0.000 节为准。

**已完成**（当时为未提交改动，现已提交）：

| 项 | 文件 | 说明 |
|---|---|---|
| 类型收口 | `tests/event-stream.test.ts` | 修正泛型与枚举三处类型错误 |
| 事件流水真正接线 | `src/trace-bridge.ts`、`src/controller.ts`、`src/server.ts` | best-effort 接入 `receipt / publish / preview / accept / assistant-result`；验收时回填 Paperclip 原生成本账本；新增只读 action `trace-view`。**流水故障只写 audit，不改变任何业务结果** |
| 渠道适配层 | `src/channels.ts` | 渠道无关信封 + adapter 注册表 + 语义对象降级渲染；现有飞书直连不动 |
| 回归测试 | `tests/trace-bridge.test.ts`、`tests/channels.test.ts`、`tests/acceptance-contract.test.ts` | 覆盖 best-effort 不阻断、篡改检测、逐项判定、waived 分支、降级不丢字段 |
| 协议合规 | `docs/OPEN-SOURCE-COMPLIANCE.md`、`THIRD_PARTY_NOTICES.md`、`sources.lock.json` | 三类项目逐项协议与复用边界；补齐 Prime Agent / DeepSeek Harness 的 lock 条目；补 LobeHub Community License 说明 |
| 形态校准 | `docs/PRD-v0.6.md` 第 10A 节 | S1–S6 形态约束 + FR-29~31 |

**当时的仍未做**（现已在 0.000 节补齐大部分）：独立评审模型与视觉输入、Acceptance submodule 引入、Role Registry / Transfer、图谱边状态、汇报拓扑开关、组织信号闭环、**前端任何改动**。新验收流程仍**默认关闭**（`config.acceptance.sealPlanOnCreate = false`），因为独立评审服务未接上，贸然开启会堵死现有发起人 `/accept`。

**顺序不变**：底座（第一轮）→ 功能补全（第二轮）→ 前端增补 → 最后整理上游代码。第 6 节执行清单第 1 步「先收口上一轮 27 个未提交改动」已于 `f27a0e1` 执行完毕。

---

## 0.0 先看这里：产品视角的差异（不含技术术语）

> 本节是给产品/业务阅读的摘要，与第 1 节 C1–C5 一一对应。技术实现以第 1 节为准。

**一句话总纲**：现有代码像一个很靠谱的工单系统——任务能派、能审批、权限收得住、知识能查；v0.6 想做的是「一个组织」。工单系统只回答「这单跑完没有」，组织还要回答三件事：**谁对什么负责、凭什么算做对了、AI 是依据什么做的**。下面五处差异都落在这三个问题上。

用一件具体的事对照：让开发小李帮忙写一份客户方案 PRD。

| | 现在打开系统 | 按 v0.6 改完 |
|---|---|---|
| 验收（C2） | 开工时没写「怎样算做好」；干完由发起人一句 `/accept` 全盘接受，要么全过要么全退 | 开工前把验收清单写死并锁定；干活时每条留证据（这条从哪读的、还是 AI 自己写的）；换一个不是干活的模型逐条判定；人看着逐条报告点通过；哪条没过只退那一条，退回原因沉淀成下次自查清单。签字人不变 |
| 过程证据（C4） | 证据散在执行输出、任务回执、CI 三处；界面显示费用 0，但 `VALIDATION.md` 自己写了「不代表没调用模型」 | 一条完整流水，每一步读了什么、调了什么、花了多少都能回放，成本回填账本。**没有它，上面的逐条验收就没有可信证据源** |
| 成员与责任（C3） | 找小李就是一次 @，系统里没有「他主职能是开发」这条稳定事实，也没有责任转移记录 | 每人有稳定主职能、会随项目变的领域、可选的邻接能力；跨职能派单生成一条授权记录（谁授权、依据什么能力、只管这一个 Task、验收标准由产品职能起草、对外发布要联签）。责任不隐含在一次 @ 里 |
| 知识库（C1） | 知识按「哪份文件的哪个版本」分开存，安全，但跨文件的关系（谁负责过这个客户、这份方案引用了哪版报价）表达不了；旧关系也不会因报价更新而失效 | 关系本身要带状态（AI 猜的 / 已验收 / 可复用）和有效期，只有已验收的关系才能被 Agent 当依据；报价一换，旧关系自动作废。**做法是不动现有那份，旁边加一层新图** |
| 汇报方式（C5） | 明确不做汇报树，谁都能直接找谁 | 扁平还是分层交给每个空间的负责人设；人多了被 @ 爆再切成「只找自己的 Agent，插手要开工单」 |

**差异的性质**（这决定改造量）：

- 只有 **C1** 是「想法真不一样」，且解法是补一层、不推翻现有隔离边界；
- **C2 / C4** 是「少了两个前置步骤」；
- **C3** 是「少了两个记录对象」（职能、授权）；
- **C5** 是「把一个写死的选择改成开关」。

结论：**没有一处要求重写已经跑通的流程**，签字人、任务真源、权限红线、前端都不动；改动集中在「加记录、加前置、加开关」。

---

## 0. 现状基线（开工前必须知道）

### 0.1 代码与运行形态

| 项 | 现状 |
|---|---|
| 仓库 | `suitme-collab`，Node 24.11+ / TypeScript / tsx；Paperclip 0.3.1 提供 3100 工作台，SuitMe bridge 4180 |
| 真源 | Paperclip + PostgreSQL 18.1（54329）存任务/成员/审批/文档/修订/审计；SQLite 只存映射、幂等、接入状态 |
| 上游（开工前基线） | 当时 6 个 Git submodule 固定提交：`paperclip`、`superagent`、`autoloop`、`prime-agent`、`deepseek-harness`、`cognee`；`sources.lock.json` 锁 4 个。现为 **7 个 submodule、lock 锁 7 个**（第五轮新增 `upstream/acceptance`） |
| 多实例 | 主实例 3100 / 4180（本机管理员 `local_trusted`）；另有 3110 / 4181 三模拟成员 `authenticated` 隔离实例 |
| 前端 | 单页插件入口 `/SUI/knowledge-workspaces`，5 个 view tab（我的工作 / 协作 / 知识 / Agent / 设置）；中文由构建期 AST 词典覆盖，深层原生页面仍有未翻译部分 |
| **工作区状态（开工前历史快照）** | 当时 `git status` 有约 27 个已修改文件 + 未跟踪 `docs/AGENT-BUILDING.md`，说明上一轮 Codex 改造尚未收口；该批改动已于 `f27a0e1` 收口提交，**不是当前工作区现状** |

> **第 0 步动作**：P0 开工前先把这批未提交改动提交或明确归属，避免 v0.6 改造与上一轮改动混在同一批 diff 里，无法回滚。

### 0.2 已真实跑通（可直接作为回归基线）

| 证据 | 能力 |
|---|---|
| SUI-4 / PR #2 `4b4b49f` | 真实飞书单聊配对 → 接单 / 提问 / PR / 预览 / 原消息回写 / 发起人 `/accept` |
| SUI-10 / SUI-25 | 原生 API 全流程：审批前拒绝 → 批准后可读 → 跨岗位交接 / 撤权 / 采用（`cross-role-evidence.json`） |
| SUI-19 | 实际浏览器全流程：创建 / 申请 / 授权 / 检查点 / 重授权交接 / 撤权 / 候选 / 版本确认 / 采用 |
| SUI-81 / PR #3 `c6e74db` | 原版 Autoloop worker 真实执行、CI 通过、同 SHA `version.json` 本地预览 |
| SUI-85 / SUI-74 | 「团队 Agent」发起、范围判断、工具检索、工作稿、原版 `ask` 等待释放 |
| SUI-103 / SUI-106 | `@a2a-js/sdk` 1.3.0 真实 HTTP `delegate_service` 子任务回传、父任务自动接续 |
| SUI-123 | 知识 → 检索与记忆 → 交给 Agent 整理关系，8 概念 / 6 关系候选（无人审签名、无自动采用） |
| 自动测试 | 14/14 → 69/69 → 90/90 → 108/108；真实 stdio MCP、并发领取、过期回执、ACL 撤回过滤、确认防篡改 |
| Cognee | 原版 DataPoint / Ladybug / provenance，4 节点 3 关系、模型调用 0、跨进程持久；BM25 中文检索、别名召回 |

### 0.3 明确未启用 / 未完成（不要当成已有能力）

- 外部 / 云端新模型服务、**Cognee 原生**自动实体抽取、embedding / 向量语义检索、LLM `cognify`、自动知识采用、自动最终验收。已接通的 Apple NL 设备端语义加权与 Apple Vision 本机视觉评审**不属于这一条**（均为 macOS 系统框架、只监听 `127.0.0.1`、不外发材料，见 0.000000 节）。
- 完整 Harness `AgentLoop`、动态模块装载器、完整 preset registry、Prime Agent daemon、Autoloop hub、第二套调度器。
- 真实员工登录与飞书组织映射、跨真实员工生产协作、第二位真人登录证据、公网 Agent 发现。
- Claude Code / WorkBuddy / 豆包 / Grok Bot / Cursor 云端自动派单、ACP 远端恢复（均只到接口或人工接单层）。
- **Trace 已在 `trace-view` 可读并作为独立评审证据，但仍如实标注缺口**：SUI-129 的流水明确列出 `kind:model` / `receipt` / `ci` 缺失、tokens 与 costCents 未记录；CLI 用量仍未完整回填 Paperclip 成本账本（`docs/VALIDATION.md` 明确「界面零费用不代表没有发生模型调用」）。
- 无合并试点 PR、无生产部署、无对象存储 / 向量服务 / Redis / SSO；异机恢复与联合备份未验证。

> 边界共识（沿用现有文档）：模拟成员 ≠ 真实员工、本地预览 ≠ 生产部署、CI 通过 ≠ 业务验收、Agent 完成 ≠ 验收。这些在 v0.6 改造后继续成立。

---

## 1. 五处架构差异（必须先解决，否则会改错方向）

### C1 · 图谱：按来源修订物理隔离 vs 全局一份图谱（**真冲突**）

- **现状**：`docs/KNOWLEDGE-ENGINE.md:35` — 图文件按 `sha256(sourceId@revision)` 存 `.runtime/knowledge-graph`，读取前不加载全公司图；旧版图不能冒充新版。隔离保证很强，但跨来源关系无法表达。
- **PRD v0.6 / B4**：全局一份图谱 + 节点/边级可见性标签，用于能力地图、越权可达性、制品 lineage、证据溯源、组织体温传播路径；边带状态与有效期（FR-09）。
- **直接切全局的代价**：丢掉现有「按来源修订物理隔离」这一已验证的安全边界，且撤权/变版后的失效机制要重做。
- **建议双层，不动现状**：
  1. **L1 证据图（保留）**：现有按 `sourceId@revision` 的物理图，存文档 / 字段 / `has_field` / 来源关系，继续作为可验证的证据投影。
  2. **L2 组织图（新增）**：一份全局图，**只存跨来源的组织语义边**（PRD 第 4 节五类边），节点引用 L1 的 `sourceId@revision`；每条边带 `状态（草稿/已验收/可复用）`、`证据引用`、`valid_at / invalid_at`、`可见性标签`。
  3. **查询路径**：先按标签裁剪 L2 子图 → 再回 L1 取原文片段 → 前后双重复查来源版本与访问资格（沿用现有 `docs/KNOWLEDGE-ENGINE.md:36`）。
  4. **授权与撤权**：授权 = 开放 L2 子图可达性 + L1 片段级许可；撤权 = 写 `invalid_at` + 收回片段许可，旧边不再被引用但历史可查。
  5. **时间语义**：借鉴 **Graphiti / Zep 的 `valid_at / invalid_at` 双时间边**处理事实取代（supersession）。Cognee 是「累积型」语料图谱，不自动让旧事实失效，因此**边状态与失效必须由 SuitMe 适配层实现**；不部署 Graphiti 服务（需 Neo4j/FalkorDB），Cognee 官方 `GraphitiSource` 适配器留作未来迁移路径。
- **回滚**：L2 组织图可整体删除，L1 证据图与现有验证记录完全不受影响。

### C2 · 验收：发起人 `/accept` vs 开工前锁计划 + 独立评审（**补前置步骤，不推翻红线**）

- **现状**：验收只能由原任务发起人在原会话操作，`/accept` 表示确认交接包中所有业务验收项；后台核对提交 / CI / 预览 / 两项验收 / 发起人身份（`README.md:79`、`docs/VALIDATION.md:15`）。红线 R3 / R4 明确 Agent 完成 ≠ 验收。
- **PRD FR-16~19**：开工前锁定 Acceptance Plan、证据来源分类、独立评审者（不得是产出模型、需视觉）、逐项判定、部分打回、打回沉淀成标准、人核可。
- **适配判断**：**保留 `/accept` 作为最终人核可**，在它之前插入四步（锁计划 → 证据采集 → 独立评审 → 逐项报告）。这样 R3/R4 完全不破，也不改变「谁签字」。
- **关键区分**：独立评审产出的是**给发起人看的证据与逐项判定**，不是替代发起人核可；跨职能时职能 owner 联签是**追加签字**，同样不替代发起人。写进验收报告，避免产品语义混淆。
- **落地**：
  - Acceptance Plan 存 Paperclip 任务文档的**原生修订** —— 不可篡改特性天然满足「开工前锁定」，改动即产生新版本并作废原计划。
  - 扩展现有 `review` 记录为 Acceptance Round（通过 / 未通过 / 受阻 + 退回原因）。
  - 部分打回复用 Autoloop 原版 `ask` 等待释放机制，在失败那轮保留上下文修正。
  - 引入 `lobehub/acceptance`（Apache-2.0，v2.2.21）作为契约与实现参照；若不引入 submodule，需自研同等五要素并说明理由（PRD Q5）。
- **注意**：现有 `/accept` 是整体通过，没有「部分打回」；打回后不能关闭任务，也不能把未通过项算作通过。

### C3 · 成员：扁平 `AgentServices` + 可配置空间 vs 三层能力 + 职能注册表（**不冲突，缺一层**）

- **现状**：`src/agent-services.ts` 管服务与职责版本；可配置 `domain` 知识空间；`docs/AGENT-SERVICE-NETWORK.md:7` 明确「部门名称和汇报树不决定系统功能模块」；`docs/FEISHU-SOURCES.md:3` 明确「空间是可配置组织方式，不是预设部门」。
- **这是正确之处，必须继承**：Codex 会话里用户拍板「产研/增长/销售/职能不应该是划分好的明确界限或系统中明确的功能模块，应该是配置迭代出来的结果」——与 v0.6 的 D11「产品不预设名单」完全一致。
- **要补的只是三层**：
  1. 新增 **Role Registry**（落 Paperclip 原生私有文档）：职能 ID / 显示名 / owner / 成员 / 版本 / 生效失效时间，四条硬约束（唯一性、owner 齐备、ID 稳定、粒度自检）。
  2. 现有「当前职责版本化」保留为**领域流动**；把 `domain` 从「空间名」提升为可从 Task / Artifact / L2 图谱关系派生的标签，不覆盖主职能。
  3. 新增 **Responsibility Transfer** 与 Transfer Grant Policy，复用现有 `collaboration` 协作合同与 `handoff-assigned` 执行身份更新，补授权人 / 能力依据 / 范围 / 标准起草方 / 联签人 / 批次 ID。
- **不改**：个人 Agent 服务身份与 Codex 等执行引擎分离、职责变更使旧结果停用、成员来自原生登录 —— 三者都与 v0.6 相容。

### C4 · Trace：三套分散证据 vs 统一可回放事件流（**B2，最硬的阻塞**）

- **现状**：证据分散在 Harness `output-retention`、Autoloop 回执（含 CLI 用量）、GitHub CI / `live-journey-evidence.json`（`.runtime`）；成本未回填 Paperclip 成本账本；`docs/VALIDATION.md:42` 已自认不完整。
- **PRD FR-25 / B2**：结构化事件流是 M9 证据链、X2 回放与成本归因、闸门 HITL、独立评审的唯一真相源；缺字段禁止启用 L4 验收。
- **适配判断**：**不换框架**（用户既定「方案集成 + 个性化优化」，现有 Autoloop worker + Harness 组合已跑通真实流程）。在 J 层加一个 **Event Sink**：
  - 归一字段：`taskId / actor / model / tool / token / cost / sourceRef@revision / checkpoint / outcome / evidenceKind(捕获|导入|自撰)`
  - 落点：Paperclip 任务文档或只读事件投影（**不得成为第二业务库**，R1）；成本回填原生成本账本。
  - 三个来源各自保留原产出，Event Sink 只做汇聚与补全，不替代。
- **准入**：先跑一条真实任务（建议沿用 SUI-81 或新建 SUI-xx）验证字段齐全、可从 checkpoint 回放，再启用 FR-16~19；否则 L4 验收的证据链是断的。

### C5 · 汇报拓扑：主动排除 vs 可配置（**从「排除」改为「配置」**）

- 现有明确不把汇报树做成功能模块（这是对的，避免组织写死）；v0.6 D10 要求由 Workspace owner 配置扁平 @ / 分层汇报。
- 适配：新增一个 **Workspace 级配置项**，默认扁平 @；选分层时中途插手走 Task 卡片开工单（LobeHub 的教训）。**事件订阅直通属工程路由，不受该配置影响**（v0.2 已修正，别再混）。切换建议由跨组调用密度、人均被打断次数自动给出。

---

## 2. 逐模块差距对照

> 动作：保留 / 扩展 / 新增 / 替换。「保留」的模块不得因改造回退现有验证。

| v0.6 模块 | 现有实现 | 动作 | 主要文件 | 优先级 |
|---|---|---|---|---|
| A 场域与成员 | Paperclip 项目/成员 + `AgentServices` + 可配置 `domain` | **扩展**：Role Registry、主职能声明、粒度自检 | `src/members.ts`、`src/agent-services.ts`、新增 `src/role-registry.ts` | P0 |
| B 沟通与 @ 委派 | Super-agent 原版归一化/幂等/策略、`/task`、`/reply`、`src/coordination.ts` | **保留 + 扩展**：汇报拓扑配置 | `src/coordination.ts`、`src/commands.ts`、`src/collaboration-intake.ts` | P1 |
| C 上下文中枢 | `src/context.ts`、交接包、`bundle.manifest`、prime-query 权重 | **扩展**：独立 Context Pack 对象、版本/过期、只纳入已验收边 | `src/context.ts`、`src/assistant.ts`、新增 `src/context-pack.ts` | P0 |
| D 交织引擎 | `src/service-network.ts`、A2A `delegate_service`、`src/coordination.ts` | **扩展**：Transfer 生成、联签路由、授权批次 | 新增 `src/transfer.ts`、`src/service-network.ts` | P0 |
| E 制品与工作区 | Paperclip 文档修订、GitHub `src/github.ts`、`src/development.ts`、证据 `src/evidence.ts` | **保留 + 扩展**：制品三态、lineage 反查 | `src/evidence.ts`、`src/development.ts` | P1 |
| F 风险闸门与验收 | 发起人 `/accept`、`review`、CI/预览核对、`platform-evidence.ts` | **重点新增**：Acceptance Plan / Round、独立评审、逐项打回、验证等级策略 | 新增 `src/acceptance-plan.ts`、`src/acceptance-round.ts`、`src/verification-policy.ts` | P0 |
| G 组织状态信号面 | 「需要你决定」面板、`attention` 列表、`src/team-memory.ts` | **新增**：只读指标 + 聚类 → Task → 复测闭环 | 新增 `src/signals.ts`、前端 tab | P2 |
| H 入口与介入 | `plugins/knowledge-workspaces/src/ui`、中文壳 `scripts/build-chinese-shell.ts` | **保留**，P3 再重构弱化区 | `plugins/knowledge-workspaces/src/ui/*`、`locales/` | P3 |
| I 主动性与注意力 | 事件合并、排除自身进度、每轮 ≤12 次工具、每委托 ≤2 次复查 | **扩展**：显式两级过滤 + 注意力预算 + 静默策略 | `src/coordination.ts`、`src/assistant-turn.ts` | P1 |
| J 运行时底座 | Autoloop worker、Harness 装配、`src/native-worker.ts`、会话接续 | **扩展**：Event Sink、checkpoint、Watchdog | 新增 `src/event-stream.ts`、`src/watchdog.ts`、`integrations/deepseek/runtime.ts` | P0 |
| K 知识底座 | Cognee `LadybugAdapter` / DataPoint / provenance / GraphSchema / BM25；`src/graph.ts`、`src/ontology.ts`、`src/knowledge.ts`、`scripts/cognee-graph.py` | **扩展**：L2 组织图、边状态/有效期/可见性标签、统一 ID 与标签 | 新增 `src/org-graph.ts`、`src/edge-state.ts`，扩展 `src/graph.ts` | P0 |
| X1 治理平面 | 原生 ACL、`access-contract`、调用前后复查、`src/workspaces.ts` | **扩展**：空间 owner、子图/片段级授权、双层标签校验、配置审计 | `src/workspaces.ts`、新增 `src/policy.ts` | P0 |
| X2 可观测与成本 | `.runtime` 轨迹、回执 CLI 用量 | **扩展**：Event Sink + 成本回填 | 同 C4 | P0 |
| X3 组织信号 | 无独立模块 | 由 G 消费 | — | P2 |

---

## 3. 开源项目整合：动作清单

| 项目 | 本版动作 | 是否需要改上游 | 许可证动作 |
|---|---|---|---|
| Paperclip / LLM Wiki / Plugin SDK | **保留不动**，所有新对象落原生文档或适配层 | 否 | 已有 |
| DeepSeek Super-agent | 保留；补「订阅直通 ≠ 组织越级」的区分 | 否 | 已有 |
| Agent Autoloop | 保留；回执补 Trace 字段；`ask` 用于部分打回 | 否 | 已有 |
| DeepSeek Harness | 保留；评估启用完整 AgentLoop / checkpoint 作为 B2 准入；output-retention 接入 Event Sink | 否 | 已有 |
| Prime Agent | 保留 `prime-query.ts` 权重策略 | 否 | 已有 |
| Cognee | 保留 L1 证据图与字典；新增 SuitMe 边状态/有效期适配层；LLM/embedding 管线继续关闭 | 否 | 已有 Apache-2.0 声明 |
| Graphiti / Zep | **只借鉴双时间边语义**，不部署服务、不引入代码 | 否 | 无需（未引入） |
| @a2a-js/sdk | 保留；`delegate_service` 补 Transfer 与联签路由 | 否 | 已有 Apache-2.0 声明 |
| **Acceptance（新）** | **建议新增 submodule**，作为 FR-16~19 的契约与实现参照 | 否 | **新增** `THIRD_PARTY_NOTICES.md` 条目 + `licenses/acceptance-APACHE-2.0.txt` + `sources.lock.json` |
| LobeHub | 只作产品参照（三层汇报、L1–L5、注意力预算、Agent Vent 闭环），不引入代码 | 否 | 无需 |
| LightRAG / KAG / OpenHands / Outline / Onyx / OpenFGA | 仅参考，不叠加索引/服务；**Outline BSL 1.1 尤其不得引入代码** | 否 | 无需 |

> 两批来源的分工：现有 submodule 覆盖**工程底座**（任务真源、事件接入、执行适配、图谱存储），本轮新增参照覆盖**产品语义**（证据化验收、职能轴、责任转移、组织信号）。整合不是把项目堆在一起，是让两边各补对方缺的那一层。

---

## 4. 迁移路径

> 顺序按用户最新要求：**集成方案 + 个性化优化 → 功能全部实现 → 再改前端界面与交互 → 最后整理/优化复用过来的上游代码**（Codex 会话 USER 54）。
> 注意：本仓库 `docs/KNOWLEDGE-ENGINE.md:3` 写的是「集成 → 改造界面 → 完整流程验收 → 整理复用代码」，与用户后续表述略有差异；**以用户最新表述为准**，前端重构放在功能闭环验收之后。

### P0 · 契约地基（最先做，且不改前端）

1. 收口当前未提交改动（提交或明确归属），记录 `git status` 基线。
2. **Event Sink（C4 / FR-25 / FR-27）**：归一三套证据、补字段、成本回填；跑一条真实任务验证可回放。
3. **Acceptance Plan 前置（C2 / FR-16~19）**：锁计划 → 证据分类 → 独立评审 → 逐项报告 → 人核可；保留 `/accept` 与 R3/R4；引入 Acceptance 契约。
4. **Role Registry + 三层能力（C3 / FR-01/02）**：不预设名单、四条硬约束、职能快照不回溯。
5. **Transfer（FR-11/12）**：默认 L0，标准外置、双段责任链、高风险联签。
6. **知识底座边状态与双层图（C1 / FR-06/07/09/10）**：L1 不动，新增 L2 组织图；空间 owner 审批、子图/片段级授权、撤权写 `invalid_at`。
7. **回归**：`npm test` / `npm run typecheck` / `npm run doctor` / `npm run test:cross-role`；SUI-4、SUI-10/19/25、SUI-81、SUI-103/106 全流程不得回退。

### P1 · 核心差异化

汇报拓扑配置（C5）、授权档位 L1/L2 与自动收紧、默认图谱本体与 lineage、验证等级策略、介入/注意力/Watchdog、配置变更审计与兼容期双写。每项配一条真实 journey。

### P2 · 可自调节

粒度自检、组织信号面与「信号 → 聚类 → 建 Task → 次日复测」闭环。只读、只预警、不排名、不做情绪推断。

### P3 · 体验与代码整理

中文补全（尤其知识 / 协同 / Agent 三块弱化区）、窄屏走查（1280 / 425）、最后再整理冗余适配与替换不合适的上游界面，保留来源与升级路径。**产品闭环经真人验收后才动复用代码**。

### 验证环境顺序

先在 3110 / 4181 三模拟成员隔离实例验证权限矩阵（不同成员授权、撤权、联签），再回 3100 / 4180 主实例跑真实任务；真实员工登录与飞书组织映射仍属未完成项，不得用模拟成员冒充。

---

## 5. 风险与回滚

| 风险 | 应对 |
|---|---|
| 上一轮未提交改动与本次改造混批 | P0 第 1 步先收口；每个阶段单独提交，保留可回滚点 |
| 切全局图谱破坏已验证的隔离边界 | 采用 C1 双层；L2 可整体删除，L1 不动 |
| 新验收契约与「发起人验收」红线冲突 | 保留 `/accept` 为最终核可，评审只提供证据；联签是追加签字 |
| 上游固定提交升级导致 API 变化 | `sources.lock.json` + gitlink 锁版本；先 `npm run doctor` 再升级，升级单独提交 |
| 新增依赖的许可证与归属 | Acceptance 补声明与 licenses；Outline BSL 1.1 不引入；Cognee 商业版「单 PostgreSQL 图存储」不算已交付 |
| 真实资料外发 | 真实飞书正文不进图处理接口、不提交 GitHub、不向新模型服务发送（沿用 `docs/KNOWLEDGE-ENGINE.md:37` 与会话约定） |
| 功能未定型就改前端 | 前端重构排 P3；P0/P1 期间允许界面「不好看但能用」 |
| 模拟身份被误当成生产验证 | 文档与界面继续标注边界：三虚拟成员 ≠ 真实员工、本地预览 ≠ 生产 |

---

## 6. 给 Codex 的执行清单（可直接照做）

按序执行，每步完成后跑对应验证，不要在一步里同时改多个层：

1. `git status` 收口基线，确认 `docs/AGENT-BUILDING.md` 归属。
2. 新增 `src/event-stream.ts`：定义事件 schema，接收 Harness / Autoloop / GitHub 三路证据；补 `src/assistant-runner.ts`、`src/runner.ts`、`src/github.ts` 的埋点；成本回填原生账本。
3. 新增 `src/acceptance-plan.ts` / `src/acceptance-round.ts` / `src/verification-policy.ts`；扩展 `src/controller.ts` 的 `/accept` 前置流程；**不改发起人身份校验**。
4. 新增 `src/role-registry.ts`；扩展 `src/members.ts`、`src/agent-services.ts`；保留 `domain` 可配置语义。
5. 新增 `src/transfer.ts`；接入 `src/service-network.ts` 的 A2A 委派与 `src/workspaces.ts` 的协作合同。
6. 新增 `src/context-pack.ts`；扩展 `src/context.ts`；只引用已验收边。
7. 新增 `src/org-graph.ts` / `src/edge-state.ts`；扩展 `src/graph.ts` 与 `scripts/cognee-graph.py`；**不改动 L1 物理图隔离逻辑**。
8. 扩展 `src/workspaces.ts` 的 `access-contract`：补空间 owner、子图/片段粒度、`valid_at / invalid_at`、撤销即失效。
9. 新增 `src/policy.ts`：双层标签校验、配置审计、兼容期双写。
10. 补齐 `tests/`（参照现有 `workspaces.test.ts`、`assistant.test.ts`、`agent-services.test.ts`）与 `docs/VALIDATION.md` 记录；每个新增 FR 至少一条真实 journey 证据。
11. 更新 `THIRD_PARTY_NOTICES.md`、`licenses/`、`sources.lock.json`、`docs/SOURCES.md`、`README.md`。
12. P0 全量回归：`npm test` / `npm run typecheck` / `npm run doctor` / `npm run test:cross-role`，并在 3110 隔离实例验证多成员授权与撤权。
13. P1/P2 按第 4 节推进；P3 才动 `plugins/knowledge-workspaces/src/ui/*` 与 `scripts/build-chinese-shell.ts`。
14. 全程不得：修改上游 submodule、合并试点 PR、发布业务仓库、启用新模型服务、把真实正文提交 GitHub、用模拟成员宣称生产验证。

---

## 7. 一句话结论

现有代码把「任务 + 审批 + 权限 + 知识候选」做扎实了，缺的是 v0.6 的**职能轴、责任转移、开工前锁定的验收、以及带状态与时效的组织图谱**；四处补层 + 一条统一 Trace 即可对齐，不需要换框架、不需要推倒 Paperclip 真源、也不需要先把前端重做一遍。最该先做的是 **C4 事件流**——没有它，C2 的证据化验收就没有可信的证据来源。


---

## 0.000000000000000000000000000000000 · 第三十二轮边界：默认底座切 local-pg + step（2026-11-08）

**用户拍板**：用户问「Cognee 端点、切默认底座是干啥？不能直接开始吗」，经说明后拍板默认底座「切（推荐）」。

**本轮改变**：
1. **默认宿主 `host.provider`：`paperclip` → `local-pg`**。`src/config.ts` zod default 与对象 default 同步切换；`pgDsn()` 未设环境变量时回退本机回环无密码默认 DSN（仅 127.0.0.1，`assertLocalPgDsn` 红线不变：真实业务材料不得写入未批准的外部数据库）。paperclip / local 保持完整支持，显式配置即回退。
2. **默认执行形态 `execution.mode`：`loop` → `step`**。superRefine 依赖校验不变（step 必须 local-pg）。worker 进程（runner / assistant-runner）在 step 模式走单步泵（`driveSteppedPump`：领步 → tick → 快照写回 PG checkpoint → 原子激活下一棒），进程不持有跨步状态，崩溃后任意机器 `step:once` 可接棒。`config.json` 的 `execution.mode` 改回 `loop` 即回退到与改造前逐字等价的常驻循环。
3. **`step:once` 端到端真跑验证**：无主体 → 步间权限重评按最小权限拒绝；带主体 → 领步执行、无登记执行器如实报失败不编造。三红线（状态外置 / 步间重评 / 诚实失败）真实生效。
4. **Cognee 边界澄清**：当前用法（`cognee-graph.py`）只借 Cognee 的 Ladybug 图存储 + 原生 BM25，**无 LLM / embedding / cognify 调用**，完全本地、无需 API key（隔离真跑 `conceptRecall:true, modelCalls:0`）。`cogneeNative` 配置段（原生 cognify）无消费者、调用代码未写——接通属独立工程，需外部 LLM+Embedding key 或本机 ollama，仍待拍板。

**不变的边界**：飞书仍是唯一任务发起入口；验收核可仍在原会话（授权代办口径见第二十九轮）；7 个上游不变；步间权限重评、对外动作不重跑、诚实失败三条红线不变；真实业务单在 step 模式的全链验证待用户在飞书发起（回退开关随时可用）。

**验证**：`npm test` 557/557、`steps:smoke` 61/61、`host:pg` 24/24、`console:smoke` 55/55、`guard:smoke` 22/22、`loop:smoke` 18/18 及其余隔离冒烟 / 两构建 / 走查 / 425px / `atlas:check` / `audit:upstream` / `git diff --check` 全绿；服务全部重启加载新默认。

## 0.0000000000000000000000000000000000 第三十三轮边界声明（34 位零：DeepSeek v4 flash 接入 Cognee 原生管线）

**用户拍板**：用户说「可以用 deepseekv4 flash 模型，你把服务调起来，我给你 key，调好之后给我，看看系统还在哪里有问题？我想本地直接用起来」并提供 DeepSeek API key。

**本轮改变**：
1. **embedding 分工落地**：`knowledge.cogneeNative.embedding.provider` 新增 `'fastembed'` 档并设为默认——本机 CPU 模型 `jinaai/jina-embeddings-v2-base-zh`（768 维，fastembed 0.9.1 在 pinned venv 内，已预下载），无端点、无凭据、不出本机。显式配 `'custom'` 即恢复外部 OpenAI-compatible embedding 端点旧口径。**关键坑**：fork 的 keyless 本地 embedding 判定为 `not llm_available`，配上 LLM key 后不会自动走本地，必须显式 `EMBEDDING_PROVIDER=fastembed`，否则会拿 LLM key 调 DeepSeek 的 embedding 端点（不存在）导致 cognify 失败。
2. **LLM 外部化真跑**：`deepseek-v4-flash`（旧名 `deepseek-chat` 已于 2026-07-24 停用）经 litellm `openai/` 前缀 + `api_base=https://api.deepseek.com` 接入。cognify 中文业务材料与 search 语义检索端到端真实跑通（抽取、召回均正确）；bridge 带环境变量重启后管理后台如实显示已配置。
3. **凭据边界不变**：key 只进进程环境（CLI 与 bridge 进程 env），不写 `.runtime/config.json` / `secrets.json` / 仓库 / 文档。隐私口径如实分流：正文外发 DeepSeek 做实体抽取；embedding 本机运行不出本机。

**不变的边界**：产品知识图谱链路（`cognee-graph.py` L1 投影）零模型调用红线不变；设备端语义加权独立链路不变；cognify 仍只有 CLI 入口、产品入库不自动外发（自动接入与 key 持久化方式待用户拍板，见 `HANDOFF/08` 第 2 项）；7 个上游不变；飞书仍是唯一任务发起入口。

**验证**：`npm test` 558/558、tsc、四构建、全部隔离冒烟（steps 61 / host:pg 24 / console 55 / guard 22 golden 无漂移 / loop 18 / router 31 / agents 43 / shapes 36 / evolution 45 / memory:hierarchy 16）、走查 11/11、425px、`atlas:check` 11/11、`audit:upstream clean`、`git diff --check`；DeepSeek 真实调用（cognify + search + key 直连）全部通过；五服务运行中。

## 0.00000000000000000000000000000000000 第三十四轮边界声明（35 位零：四缺口修复 + 断点审计 + console UI）

**用户拍板**：修复第三十三轮审计的缺口 1/2/3/5（费用不担心）；随后要求完整审计产品功能断点并修复、优化 UI、启动服务展示。

**本轮改变**：
1. **cognify 自动接入产品链路**（此前仅有 CLI 入口）：`cogneeNative.autoCognify` 默认开——L1 零模型投影成功后，该来源正文自动外发 DeepSeek 抽取 + 本机 fastembed 向量化（共享数据集 suitme-knowledge）。L1 投影零模型红线不变：自动 cognify 是投影成功后的独立并行步，失败不阻塞不回滚，成功/失败各写审计（external:true 如实标注外发）。
2. **凭据持久化**：`.runtime/cognee-env.json`（gitignored、0600）由 server / CLI 启动时装载进进程环境（进程环境优先）。resolve 不读文件——隔离冒烟与测试不经装载路径，不会意外触发真实外部调用。key 仍不进仓库 / config.json / secrets.json。
3. **语义检索接进 UI**：console「知识」页语义检索卡（owner/admin；cognified 数据集跨分区故收口）+ 插件 settings「知识检索」页；bridge `cognee-search` action（admin-only、只读通道）。检索提问会外发 DeepSeek 汇总，UI 如实标注「外部模型调用」。
4. **断点修复**：console 服务页此前读不存在的 `row.running` 导致**所有服务永远显示「已停止」**——已修复为按真实 `state` 渲染；vision /health 缺 `ok:true` 致探测永远失败——已补齐（本机 6 服务实测 connected）。

**不变的边界**：L1 投影零模型红线；网页不发起任务（发起仍在飞书）；7 个上游不变；key 不进仓库；测试与隔离冒烟不触发真实外部调用（凭据装载只在启动路径）。

**验证**：npm test 563/563、tsc、三构建、console:smoke 55/55、guard:smoke 22/22（golden 两次合法重冻结均留人审记录）、steps 61/61、host:pg、loop 18、router 31 / agents 43 / shapes 36 / evolution 45 / memory:hierarchy 16；DeepSeek 真跑（自动 cognify + console 检索）通过；五服务 + git 全部在线。

## 000000000000000000000000000000000000 第三十五轮边界声明（36 位零：Paperclip 前端国内化 + i18n 标准多语言 + 三上游功能审计）

**用户拍板**：「还是用我们最开始用的那套海外的开源项目前端吧，Paperclip，不过要去掉所有海外的部分，适配国内」+「多语言用 i18n 就行」+ 睡前指令「做好了验证一下，是不是把 Agent Auto Loop 的项目，包括 Super Agent 以及 Lob Hub（结合 acceptance）的功能全部实现出来了」。

**已发生**：前端主界面仍是 3100 Paperclip 工作台（中文壳构建），本轮把它彻底国内化。① i18next 标准多语言接入：语言数据单一来源 `locales/i18n-zh-CN.json`（i18next resources 结构，445 词条，英文原文作 key），构建期注入上游 en/zh-CN 双语言包并把 DEFAULT_LOCALE 切到 zh-CN（上游 UI 目前零 t() 调用，i18next 是架构就位；硬编码文案由词典替换层兜底，两层同源）。② 词典层增强：JSXText 空白归一化、显示属性扩展（message/action/mobileLabel/effect/subtitle）、显示映射表启发式（snake_case 键 + 首字母大写值）。③ 海外清理：页面标题去 Paperclip 品牌尾缀；活动动词表 29 条中文化；运行时间/计数模板中文化；设置页治理、可观测性、部署块全中文。④ `docs/FEATURE-PARITY.md` 三上游功能对照审计（Autoloop / Super-agent / Acceptance 逐项对照 + 四个拍板过的未做边界）。⑤ 真实页面文本探查与六张截图留证。

**未发生（如实）**：上游 UI 源码与提交未改（全部为构建期 transform）；未引入第 8 个上游或新 npm 依赖；`LLM Wiki` 子页签名是服务端插件注册名（运行时数据，词典层够不着，如实保留）；图表图例部分状态词（Done/Blocked/Cancelled/Backlog）来自运行时数据映射，本轮未覆盖；默认底座 local-pg + step、飞书唯一发起入口、真人验收红线均不变；4200 自研控制台与 3100 工作台并行保留。7 个上游 submodule、`audit:upstream clean:true` 不变。

## 0000000000000000000000000000000000000 第三十六轮边界声明（37 位零：自动化四件套 + 产品文档套件）

**用户拍板**：「定时调度器（飞书唯一入口红线）、GitHub 监听（换本机 Git）、钉钉/企微通道、定时唤醒复查，这几个也都要做，做完之后，把本地和GitHub…全部同步到最新，然后把相关说明全部都做好，包括产品的功能介绍、系统架构、产品架构、功能架构、业务流程等等」。

**已发生**：四个原「拍板未做」项全部实现——定时调度器（例程 + 时间槽幂等）、定时唤醒复查（wake 预约/到点触发）、GitHub 监听（轮询 + webhook 验签，交付链路不变）、钉钉/企微补充通道（出站 webhook + 明文入站端点）。**放宽的边界**：飞书不再是唯一发起入口，定时器与监听器可以发起任务（automation actor 全程留痕，任务卡片写明自动发起）。**不放宽的红线**：验收/核可/放行仍只在原会话由原发起人确认；自动化四件套的委托指令全部写明「不要自行替人做验收结论/评审合并走审批链」。产品文档套件 docs/product/ 五份全中文（功能介绍/系统架构/产品架构/功能架构/业务流程）。真实发现并修复 daily 例程提前触发 bug（缺「已过 at 时刻」判定）。

**未发生（如实）**：上游 UI/源码与提交未改；未引入新 npm 依赖（钉钉签名用 node:crypto）；Slack/Discord 通道未做（无国内需求）；企微回调加密模式（EncodingAESKey）未实现（明文可用，端点对密文如实报错）；webhook 入站端点只绑 127.0.0.1（公网需自行反代）；钉钉/企微出站默认关闭（需配置 DINGTALK_WEBHOOK_URL / WECOM_WEBHOOK_URL 环境变量）；默认底座 local-pg + step、真人验收红线均不变。7 个上游 submodule、audit:upstream clean:true 不变。
