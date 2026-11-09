# 上游功能实现对照（第三十五轮审计 · 第三十六轮落地 · 第三十七轮复盘 · 第三十八至四十轮收口）

> 用户问题：是否把 Agent Autoloop、Super Agent、LobeHub（结合 acceptance）的功能全部实现出来了？
> 本文按三个上游的公开功能面逐项对照本仓库实现位置与验证证据。
>
> **第三十六轮**：用户 2026-11-09 拍板「这几个也都要做」，第 5 节的四个未做项
> （定时调度器、GitHub 监听、钉钉/企微通道、定时唤醒复查）实现。
> **第三十七轮复盘**：把「全部实现」修正为「核心闭环全通 + 3 类周边待补」，
> 并修掉 4 个运行层缺陷 + 补 cron 排班。差异清单见 5.1 与
> [RE-AUDIT-2026-11-09.md](RE-AUDIT-2026-11-09.md)。

审计时间：2026-11-09（第三十五轮）；第三十六轮落地；第三十七轮复盘；第三十八/三十九轮收口；第四十轮补分层契约体检与架构面对标；第四十一轮收口五项差距；第四十二轮回群对账 + 主题聚合。运行基线：`npm test` **704/704**。

## 1. Agent Autoloop（KKKKhazix/agent-autoloop · MIT · 国内开源）

上游形态：零依赖内核 + 四方向插件（事件 / Agent / 通道 / 交付流水线），「拿不准才发卡片问你」。

| Autoloop 功能 | SuitMe 实现 | 位置与证据 |
|---|---|---|
| **挂起零消耗**（等拍板时进程退出，不烧 Token） | step 模式：一次进程只跑一步；HITL 等人期间进程退出，状态外置 PG 步进队列（`checkout-retry-runToken`），回来接原会话续跑 | `src/step-runner.ts`、`src/pg-host.ts`、`steps:smoke` 61/61；第三十二轮起为默认执行形态 |
| **事件溯源**（断电不丢、每步可追溯） | append-only 事件主干 + 四类投影 + checkpoint 增量应用（checksum 与全量逐字节对照） | `src/event-stream.ts`、`src/memory-log.ts`、`npm run memory:checkpoint` |
| **指令数据分离**（Issue 的话进不了提示词、改不了目录权限） | `runtimeGuard.enforce` 生产链开启；指令与数据红线（R 系列） | `src/runtime-guard.ts`、契约测试 |
| **跳数熔断**（Agent 互相触发超限自动停） | **等价收窄**（第三十七轮修正口径）：上游数「事件链累计 8 层」；本仓库直接拒绝 Agent 自造事件（`events`/`resolve`），链根本不存在，另加 `maxStepsPerRun` 限单次步数 | `src/controller.ts:266`、`src/config.ts`、`src/mission-state.ts` |
| **事件插件**（定时 / GitHub / 业务系统 / 轮询） | 飞书（上游 `feishuTrigger` 原版）+ 插件工作台 + **定时调度器 + GitHub 监听（第三十六轮实现，见第 5 节）** | `src/upstream.ts`、`src/collaboration-intake.ts`、`src/scheduler.ts`、`src/github-watch.ts` |
| **Agent 插件**（一行配置接任意 CLI Agent） | 上游 `worker/agents.ts` `adapterFor` 原版装载（codex / claude / command / acp 四 adapter） | `src/upstream.ts`、`agents:smoke` 43/43；3100 代理页 13 agents |
| **通道插件**（飞书 / 钉钉 / 企微 / 桌面通知） | 飞书通道（上游 `feishu-channel` 原版，长键 sha256 幂等）+ 桌面通知 + 升级限速静音（1 小时 3 次）+ **钉钉/企微补充通道（第三十六轮实现，见第 5 节）** | `src/channels.ts`、`src/escalation.ts`、`src/im-outbound.ts` |
| **拍板卡片 → 点一下接着干完** | HITL 台账 `askHuman`/`answerHuman` 成对留痕 + 第二十九轮「回答后自动续跑」授权代办 | `src/step-hitl.ts`、`src/auto-resume.ts`、`scripts/step-answer.ts` |
| **自动闭环：到点复查** | 「later」送达证据 + 步进队列推进 + **到点唤醒复查（第三十六轮实现，见第 5 节）** | `src/step-delivery.ts`、`src/scheduler.ts` |
| **代码交付流水线**（审代码→检查→合并→上线→核对） | 本机 Git 自动合并 / 自动发布（第八轮起 GitHub 主链路换本机 Git），上线核对走平台证据 | `src/local-git.ts`、`src/platform-evidence.ts` |
| **Token / 费用统计** | PG 成本账本逐调用入账 + 3100 总览「本月花费 / Run Activity」可视化 | `src/pg-host.ts` 成本账本、3100 dashboard |

## 2. Super-agent（deepseek-ai/dsh-superagent-prototype · MIT · 研究原型）

上游形态：监听 GitHub + 飞书，被允许的人要活才开工单，自有会话与目录里干完，原会话回答；web panel 显示需要人的事。

| Super-agent 功能 | SuitMe 实现 | 位置与证据 |
|---|---|---|
| 监听 IM、被要求才开工单 | 飞书触发（上游 `feishu-trigger` 原版：`feishuTrigger` / `feishuThreadId` / `feishuTriggerId`）→ 协作接单 | `src/upstream.ts`、`src/collaboration-intake.ts` |
| 自有 agent 会话与目录干活 | autoloop worker session + 签出目录隔离（读 / 写权限分级） | `src/step-execution.ts`、`agents:smoke` |
| **在原会话回答**（不另开线程） | P-9 双向协作回路：上行回执 / 提问 / 请示，下行发起 / 回答 / 接续 / 核可 | `src/collaboration-loop.ts`、`loop:smoke`、`step-mode-guide`（SUI-135 交付物） |
| web panel（显示需要人处理的事） | 3100 工作台「待办 / Needs you」+ 审批页 + 4200 只读控制台 | `console/`、Paperclip UI |
| 授权模型（谁可以要活 / 花钱） | casbin RBAC（bridge 与 console 两进程共用策略）+ 原会话核可红线 + 飞书组织身份映射 | `src/rbac.ts`、`src/feishu-org.ts` |
| 策略评估（settingsPolicy / assessmentOutcome） | 上游 `policy.ts` 纯函数原版复用 | `src/upstream.ts` 声明装载 |
| 「占用最少人类注意力」哲学 | 按需打扰：升级只通知不代批、限速静音、HITL 只在拿不准时发卡、挂起零消耗 | `src/escalation.ts`、产品红线 |

## 3. Acceptance（lobehub/acceptance · Apache-2.0）+ LobeHub 设计语言

上游形态：「Agent 说做完了，Acceptance 让你先看证据再验收」——把请求变成可观察 checks，跑真实产品，发布带截图 / 录屏 / 日志的报告，接受或逐条打回，打回的记忆会沉淀。

| Acceptance 功能 | SuitMe 实现 | 位置与证据 |
|---|---|---|
| **开工前锁定验收计划**（改了能发现） | `acceptance-plan.ts`：内容哈希 + Paperclip 文档修订号双重锁定，替换即检出 | 契约测试 + SUI-54 真实单 |
| 把请求变成可观察 checks | 逐项独立判定 passed / failed / blocked（不为凑绿放宽） | `src/acceptance-round.ts` |
| 证据分类与绑定（截图 / 录屏 / 日志） | `evidenceKind: captured / imported / authored` + 独立视觉评审（本机 Apple Vision 真跑识别 80 段文字） | `src/event-stream.ts`、`src/visual-review.ts`、`src/vision-semantics.ts` |
| 一条链接团队可审的报告 | `export-acceptance`：`result.json` / `report.md` / assets，兼容上游契约与文件布局 | `src/acceptance-interop.ts`、`scripts/export-acceptance.ts` |
| **打回的记忆**（criteria / 失败例 / 变更） | C-6 沉淀回流：自查标准回流为交付前强制比对 + evolution 台账（候选改进 → 工程闸门 → 人审 → 版本 / 灰度 / 可回滚） | `src/evolution.ts`、`src/evolution-ledger.ts`、`evolution:smoke` 45/45 |
| 每个决定显示是谁做的 | 人签链 candidate → confirmed → withdrawn + 全量审计留痕 | `src/memory-log.ts`、审计页 |
| LobeHub 观感（**不复制代码**，Community License 禁止） | 4200 控制台布局 / 卡片 / 明暗主题 / 会话气泡时间线参考其设计语言，自研 Vue 3 + Element Plus | `console/`；许可证边界见 `docs/OPEN-SOURCE-COMPLIANCE.md` |

## 4. Paperclip（本体上游 · MIT）

作为任务真源、调度核心与 3100 工作台宿主原版复用；SuitMe 插件（`plugins/knowledge-workspaces`）经 Plugin SDK 挂载。本输出就是它的 UI（中文壳 + 国内适配层）。

## 5. 原四个未做项 → 第三十六轮全部实现

用户 2026-11-09 拍板「定时调度器、GitHub 监听、钉钉/企微通道、定时唤醒复查，这几个也都要做」，放宽
「飞书唯一发起入口」旧边界（自动化 actor 全程留痕；验收/核可/放行红线不放宽）：

| 项 | 上游来源 | 实现（位置与证据） |
|---|---|---|
| **定时调度器** | Autoloop 事件插件 | `src/scheduler.ts`：例程（interval/daily/**cron**）+ 时间槽幂等 + 审计 `routine.triggered`；**第三十七轮补 cron**（直接复用上游 `kernel/cron.ts`，支持 `0 18 * * 0` 这类真实排班）；bridge action `scheduler-status`；运行配置已启用每日晨报（09:30）/ 每周日健康检查（cron `0 18 * * 0`） |
| **GitHub 监听接单** | Super-agent | `src/github-watch.ts`：轮询（gh api 优先/REST 兜底，60s 节流，首次只记基线）+ webhook（HMAC-SHA256 验签）；事件指纹幂等；审计 `github.event-observed`；正在监听 `zhegong-996/desktop-tutorial` |
| **钉钉 / 企微通道** | Autoloop 通道插件 | `src/im-outbound.ts` + `src/channels.ts`：出站 webhook（钉钉加签/企微 markdown，与飞书共享注意力预算）；入站端点 `/im/dingtalk`、`/im/wecom`（明文；企微加密模式如实报未支持）；出站需配置 `DINGTALK_WEBHOOK_URL`/`WECOM_WEBHOOK_URL` 环境变量后启用 |
| **定时唤醒复查** | Autoloop 自动闭环 | `src/scheduler.ts`：`wake-schedule`/`wake-cancel`/`wake-list` action + 到点自动触发复查委托（审计 `wake.review-triggered`）；已对真实任务预约次日 09:00 复查验证 |

如实边界（仍未做，非遗漏）：Slack/Discord 通道（无国内需求）；企微回调加密模式（EncodingAESKey 解密）；webhook 端点的公网暴露（需自行反代）。

## 5.1 第三十七轮复盘修正（2026-11-09）

用户要求「再复盘对比一次」。这次不看本文上一版的自评，改从上游源码 + 本仓库代码 + 现场运行三处交叉核对，
结论见 **[RE-AUDIT-2026-11-09.md](RE-AUDIT-2026-11-09.md)**。要点：

- **功能面**：核心闭环全通；周边仍差 3 类 —— 规则匹配（`when.source/types`、`parallel`、排队合并）、
  GitLab/通用 HTTP 事件源、验收的区域框选与主题矩阵。「全部实现」的旧说法改为「核心闭环全通 + 3 类周边待补」。
- **跳数熔断**：上游是「事件链累计 8 层」，本仓库是「单次运行步数上限」+「禁止 Agent 自造事件」，
  属**等价收窄**，不是同一机制，已改口径。
- **运行面**（当时最严重）：bridge 未常驻、后台循环被一个已不存在的交付任务拖死（`scheduler` 与
  `github-watch` 全程没跑）。本轮修复：逐阶段隔离、启动超时放宽、`stop` 认亲、新增 `npm run service`
  常驻安装器；并补齐 cron 排班，把「每周」例程从 `daily 18:00` 改成 `cron 0 18 * * 0`。

## 5.2 第三十八轮收口（2026-11-09）

RE-AUDIT 第 6 节列的 5 项待补**全部补上**，并把 Acceptance 从「契约 + 报告」提升为
控制台的一等模块。逐项证据见 **[ROUND-38.md](ROUND-38.md)**：

| 待补项 | 结果 |
|---|---|
| 规则匹配（`when.source/types`、`parallel`、排队合并） | ✅ 事件分流 + 并发上限（显式配置才生效）+ 窗口内合并成一轮 |
| 验收区域框选 | ◐ 数据层完成（`EvidenceRegion` + 校验 + 展示），交互未做 |
| GitLab / 通用 HTTP 事件源 | ✅ `POST /events/:source`，逐来源密钥 / 指纹幂等 / 只收事实 |
| 交付流水线独立审码阶段 | ✅ 确定性命中「密钥 / `.env`」即拦预览，独立报告，不替代人签 |
| 验收矩阵 | ✅ 3 视图 × 2 主题 × 1280/320 共 12 单元 + 键盘逐键（第三十九轮扩到 7 视图 × 2 主题 × 2 宽度 = 28 单元，并加「渲染节点 < 12 = 疑似白屏」判据） |

同轮补的两处**不在上表**但属用户明说范围：**验收工作台 + 审查 Agent 前端**（`v06-acceptance-workbench`
一次只读聚合 + `AcceptanceView` 重写，页面上刻意没有通过 / 打回按钮），**共享上下文底座 + 三层职能
组织视图**（`organization-view`，`modelCalls=0`），以及 **出站重试健康**（`retry-health`）。

## 6. 验证命令（全部真跑）

```sh
npm test            # 704/704（含三个上游装载的契约测试 + 自动化四件套 + cron + 事件收件箱 + 审码 + 重试健康 + 通道体检 + 分层契约 + 准入/订阅/讨论/规则视图/安装）
npm run steps:smoke # 61/61：step 模式 + HITL 闭环 + 送达证据
npm run agents:smoke    # 43/43：Agent 编制与 adapter
npm run loop:smoke  # 18/18：双向协作回路
npm run evolution:smoke # 45/45：沉淀回流（打回记忆）
npm run guard:smoke # 22/22：运行时红线与出站工具（golden 已人审重冻结）
npm run console:smoke   # ok:true：7 视图 + 28 单元验收矩阵 + 键盘逐键
npm run audit:upstream  # clean:true：上游固定提交与许可证
npm run service -- status  # 常驻状态（launchd 安装见 docs/RE-AUDIT-2026-11-09.md）
```

## 5.3 第四十轮：分层契约体检 + 架构面对标（2026-11-09）

本轮不再新增功能，改为「把分层变成可复跑的证据」，并补一次架构面（而非功能面）的对标：

| 事项 | 结果 |
|---|---|
| 七层契约体检 `npm run audit:layers` | **40 条：ok 39 / partial 1 / gap 0**（路由 10 / 直通 6 / Agent 6 / 权限 6 / 知识 3 / 验收 6 / 个性化 3）—— 第四十一轮扩到 45 条并清零 partial，见 §5.4 |
| 直通契约化 | 新增 `src/pass-through.ts`，6 种判定各有单测；结构上不含 scope / permissions 字段 |
| 知识创建口径 | 修复 `canCreateKnowledge` 一律按 `['*']` 判范围的缺陷，改为按条目 `domains`；与 update 判定一致 |
| 架构面对标 | 新增 [BENCHMARK-3UPSTREAM.md](BENCHMARK-3UPSTREAM.md)：分层、状态恢复、幂等、可重放、扩展点、回退、审计 |
| 架构图 | 新增 [ARCHITECTURE-DIAGRAMS.html](ARCHITECTURE-DIAGRAMS.html)：功能 / 业务 / 技术三张 |

如实标注的差距（本轮未做）：准入强度三档（Super-agent）、报告内讨论与区域点选（Acceptance）、
订阅 hand-back / release（Super-agent）、一条命令安装（Autoloop）。
逐条契约与边界见 [LAYER-CONTRACTS.md](LAYER-CONTRACTS.md)。

## 5.4 第四十一轮：五项差距收口（2026-11-09）

对标文档里列为「落后」的四项 + 体检唯一的 partial，本轮全部收口：

| 差距 | 状态 | 落点 |
|---|---|---|
| 准入强度三档（Super-agent） | ✅ | `src/admission.ts`：explicit / inferred / not-admitted；inferred 只回配对指引，不自动放行 |
| 报告内讨论 + 区域点选（Acceptance） | ✅ | `src/acceptance-discussion.ts` + 控制台验收视图；讨论不参与判定 |
| 订阅 hand-back / release（Super-agent） | ✅ | `src/subscription.ts` + pass-through 两种新判定；验收时写 `subscription.released` |
| 规则视图（Autoloop） | ✅ | `src/rules-view.ts` + `npm run rules:view`（只读，不改运行时） |
| 一条命令安装（Autoloop） | ✅（有边界） | `src/bootstrap.ts` + `npm run bootstrap`；建管理员与飞书授权仍需人做 |
| 知识读按域收窄（自身体检 partial） | ✅ | `canReadKnowledge` 第 4 参 `readerDomains`；读方域未知按档位兜底 |

体检基线：`npm run audit:layers` → **51 条：ok 51 / partial 0 / gap 0**。
