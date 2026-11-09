# SuitMe 功能架构

> 版本口径：第四十一轮（2026-11-09）。功能模块树 + 实现位置 + 验证方式。
> 判断「某个功能在哪个模块」以本文为准；分层契约见 [LAYER-CONTRACTS.md](../LAYER-CONTRACTS.md)。

## 功能总树

```
SuitMe 协作台
├─ 1 会话与入口
│  ├─ 1.1 飞书通道（主）…………… src/upstream.ts · src/collaboration-intake.ts
│  ├─ 1.2 钉钉/企微通道（补充）…… src/im-outbound.ts · src/channels.ts ★36
│  ├─ 1.3 通用事件源 ……………… src/event-inbox.ts · POST /events/:source ★38
│  ├─ 1.4 GitHub 监听 ……………… src/github-watch.ts（轮询 + webhook）★36
│  ├─ 1.5 Paperclip 工作台……… 3100 · scripts/build-chinese-shell.ts（中文壳）
│  ├─ 1.6 管理控制台（只读）…… scripts/console-server.ts :4200
│  └─ 1.7 CLI / MCP ……………… src/cli.ts · src/mcp.ts
├─ 2 任务与协作
│  ├─ 2.1 任务创建（幂等）……… src/workspaces.ts createTask
│  ├─ 2.2 分层路由（1~2 跳）…… src/router.ts · src/routing-decision.ts · src/routing-trace.ts
│  ├─ 2.3 直通（同会话接续）…… src/pass-through.ts · src/collaboration-intake.ts ★40
│  ├─ 2.4 组织编制 ……………… src/agent-registry.ts（职责/范围/版本/在岗）★38
│  ├─ 2.5 交接与授权 …………… v06 Transfer · src/context-grant.ts
│  ├─ 2.6 服务网（A2A）………… src/agent-services.ts · src/service-network.ts
│  └─ 2.7 成员与 RBAC ………… src/members.ts · src/rbac.ts
├─ 3 执行引擎
│  ├─ 3.1 步进执行（默认）……… src/step-execution.ts · src/loop-pump.ts
│  ├─ 3.2 执行适配器 …………… codex / claude / command / acp
│  ├─ 3.3 挂起零消耗 …………… step 模式等人时进程退出
│  ├─ 3.4 自动续跑闸 …………… src/auto-resume.ts（回答后重新验证）
│  └─ 3.5 步数熔断 ……………… config.execution.maxStepsPerRun
├─ 4 自动化 ★36
│  ├─ 4.1 定时调度器 …………… src/scheduler.ts（interval/daily/cron + 时间槽幂等）
│  ├─ 4.2 并发与合并 …………… 按密度缺省 + 窗口合并 + 跳过留痕 ★38/39
│  ├─ 4.3 定时唤醒复查 ………… src/scheduler.ts（wake 预约/取消/到点）
│  ├─ 4.4 出站镜像 ……………… src/server.ts deliver()（与飞书共享预算）
│  └─ 4.5 出站重试健康 ………… src/retry-health.ts ★38
├─ 5 人机协作（HITL）
│  ├─ 5.1 提问卡片 ……………… askHuman · 飞书/工作台双渲染
│  ├─ 5.2 回答路由 ……………… src/hitl-bridge.ts（成对台账）
│  ├─ 5.3 中文指令 ……………… src/user-language.ts（建单/进度/验收/退回/转交）
│  ├─ 5.4 准入三档 ……………… src/admission.ts（显式/推断/未准入）★41
│  └─ 5.5 订阅生命周期 ……… src/subscription.ts（held/交回/释放）★41
├─ 6 验收与交付
│  ├─ 6.1 验收合同 ……………… src/acceptance-plan.ts（开工锁定）
│  ├─ 6.2 逐项判定与证据 ……… src/acceptance-round.ts · EvidenceRegion ★38
│  ├─ 6.3 独立评审 ……………… src/visual-review.ts（评审者≠产出模型）
│  ├─ 6.4 验收工作台（只读）…… src/acceptance-workbench.ts ★38
│  ├─ 6.4b 报告内讨论 ………… src/acceptance-discussion.ts（追加式，不参与判定）★41
│  ├─ 6.4c 区域点选 ………… 控制台验收视图（坐标底板 + 键盘可达）★41
│  ├─ 6.5 验收编组 ……………… src/agent-registry.ts reviewCrew（验收/起草/巡检）
│  ├─ 6.6 独立审码 ……………… src/code-review.ts（密钥/.env 命中即拦预览）★38
│  ├─ 6.7 本机 Git 交付台 …… src/local-git.ts :4194/:9418
│  └─ 6.8 验收报告 ……………… :4192 一条链接 · src/acceptance-interop.ts
├─ 7 知识与记忆
│  ├─ 7.1 知识空间三分区 ……… src/knowledge.ts · src/knowledge-authz.ts
│  ├─ 7.2 L1 图谱投影 ………… src/graph.ts（零模型）
│  ├─ 7.3 Cognee 原生管线 …… src/cognee-native.ts（DeepSeek + fastembed）
│  ├─ 7.4 组织图谱 L2 ………… src/ontology.ts · src/organization-view.ts ★38
│  ├─ 7.5 团队记忆 …………… src/team-memory.ts（打回沉淀/审批）
│  └─ 7.6 语义检索 …………… 设备端词向量 + BM25 · cognee-search action
├─ 8 治理与运维
│  ├─ 8.1 审计台账 …………… src/store.ts audit（全部关键动作）
│  ├─ 8.2 注意力预算 ………… src/runtime-bridge.ts（护栏 + 必达放行）
│  ├─ 8.3 成本账本 …………… PG 成本账本 + 工作台可视化
│  ├─ 8.4 服务体检 …………… src/service-status.ts（实时探测）
│  ├─ 8.5 通道体检 …………… src/channel-health.ts（零外部请求）★39
│  ├─ 8.6 分层契约体检 ……… src/layers-audit.ts · npm run audit:layers（45 条）★41
│  ├─ 8.7 金丝雀与自演进 …… src/evolution.ts（自查闸门默认强制）
│  ├─ 8.8 规则视图 …………… src/rules-view.ts · npm run rules:view（只读）★41
│  └─ 8.9 一条命令安装 ……… src/bootstrap.ts · npm run bootstrap ★41
└─ 9 国际化与合规
   ├─ 9.1 i18n 标准多语言 ……… locales/i18n-zh-CN.json（445 词条单一数据源）★35
   ├─ 9.2 海外元素清理 ………… src/shell-domestic.ts
   └─ 9.3 上游审计 ……………… npm run audit:upstream（clean）
```

★35 / ★36 / ★38 / ★39 / ★40 = 对应轮次新增或重写。

## 模块 → 文件速查（第三十七至四十轮）

| 功能 | 文件 | 关键函数/类 | 测试 |
|---|---|---|---|
| 分层路由 | `src/router.ts` | `planRoute()` · `Router.route()` · `planCoverage()` | tests/router*.test.ts |
| 直通 | `src/pass-through.ts` | `passThroughDecision()` · `isFollowup()` | tests/layers-audit.test.ts · tests/admission-subscription.test.ts |
| 准入三档 | `src/admission.ts` | `assessAdmission()` · `admissionLabel()` | tests/admission-subscription.test.ts（7） |
| 订阅生命周期 | `src/subscription.ts` | `classifyFollowupScope()` · `subscriptionStateOf()` | tests/admission-subscription.test.ts |
| 报告内讨论 | `src/acceptance-discussion.ts` | `addDiscussionComment()` · `resolveDiscussionComment()` · `discussionDigest()` | tests/acceptance-discussion.test.ts（7） |
| 规则视图 | `src/rules-view.ts` | `buildRulesView()` · `renderRulesViewText()` | tests/rules-view.test.ts（6） |
| 一条命令安装 | `src/bootstrap.ts` | `buildBootstrapPlan()` · `runBootstrap()` | tests/bootstrap.test.ts（6） |
| 组织编制 | `src/agent-registry.ts` | `resolveAssignment()` · `handoffEnvelope()` · `reviewCrew()` | tests/agent-registry.test.ts |
| 知识分区 | `src/knowledge-authz.ts` | `canWriteKnowledge()` · `canCreateKnowledge()` · `canReadKnowledge()` | tests/knowledge-authz.test.ts |
| 事件收件箱 | `src/event-inbox.ts` | `claims()` · `mirror()` · `status()` | tests/event-inbox.test.ts |
| 通道体检 | `src/channel-health.ts` | `buildChannelHealth()` | tests/channel-health.test.ts（7） |
| 验收工作台 | `src/acceptance-workbench.ts` | `buildAcceptanceWorkbench()` | tests/acceptance-workbench.test.ts |
| 分层体检 | `src/layers-audit.ts` | `auditLayerContracts()` · `layerSummary()` | tests/layers-audit.test.ts（10） |
| 定时调度 | `src/scheduler.ts` | `Scheduler.tick()` · `routineParallel()` · `cronOccurrence()` | tests/scheduler.test.ts |
| GitHub 监听 | `src/github-watch.ts` | `GithubWatcher.tick()` · `handleWebhook()` | tests/github-watch.test.ts |
| 独立审码 | `src/code-review.ts` | `reviewCode()` | tests/code-review.test.ts |

## Bridge action 速查（第三十七轮起新增）

| action | 读/写 | 权限 | 说明 |
|---|---|---|---|
| `scheduler-status` | 读 | owner/admin | 例程列表 + 下一时间槽 + wake 预约 + 跳过原因 |
| `wake-list` | 读 | owner/admin | 全部复查预约 |
| `wake-schedule` | 写 | owner/admin | `{taskId, at(未来 ISO), note?}` |
| `wake-cancel` | 写 | owner/admin | 按 taskId 取消 |
| `github-watch-status` | 读 | owner/admin | 监听状态/传输方式/凭据就绪度 |
| `channel-health` | 读 | owner/admin | 五类通道体检（零外部请求） |
| `acceptance-workbench` | 读 | owner/admin | 清单 + 逐项 + 编组 + 报告聚合 |
| `acceptance-crew` | 读 | owner/admin | 审查编组解析 |
| `v06-acceptance-discussion-list` | 读 | 登录用户 | 报告内讨论线程 + 计数 |
| `v06-acceptance-discussion-add` | 写 | operator+（viewer 拒绝） | 新增讨论（追加式，挂在项/区域/整份报告） |
| `v06-acceptance-discussion-resolve` | 写 | operator+ | 只打「已处理」状态位 |
| `agent-registry-view` | 读 | owner/admin | 组织编制摘要 |
| `org-overview` / `organization-view` | 读 | owner/admin | 三层职能组织视图（modelCalls=0） |

HTTP 端点：

| 端点 | 方法 | 说明 |
|---|---|---|
| `/github/webhook` | POST | HMAC-SHA256 验签；未接收入收件箱时镜像进台账 |
| `/im/dingtalk` | POST | 钉钉回调（明文 JSON，sender 白名单） |
| `/im/wecom` | GET/POST | 企微回调（GET 验证 echostr；POST 明文 XML） |
| `/events/:source` | POST | 通用事件源（逐来源密钥 / token，指纹幂等，只收事实） |

## 配置速查（.runtime/config.json）

```jsonc
{
  "router": { "mode": "flat", "domains": {}, "maxHops": 2 },   // legacy | flat | layered
  "agentRegistry": { "schemaVersion": 1, "agents": [] },        // 空 = 扁平，不硬造管理层
  "scheduler": { "enabled": true, "routines": [], "wake": { "enabled": true } },
  "githubWatch": { "enabled": true, "watchPush": true, "watchIssues": true, "watchPulls": true },
  "eventInbox": { "enabled": true, "sources": [] },             // 没登记来源 = 没入口
  "dingtalk": { "enabled": false, "allowedSenders": [] },
  "wecom":    { "enabled": false, "allowedSenders": [] }
}
```

## 验证方式

| 入口 | 覆盖 |
|---|---|
| `npm test` | 678 例：契约 + 上游装载 + 自动化 + 收件箱 + 审码 + 体检 + 分层 + 准入/订阅/讨论/规则视图/安装 |
| `npm run audit:layers` | 45 条分层契约（ok 45 / partial 0 / gap 0） |
| `npm run rules:view` | 七段配置读成一份人话视图（只读） |
| `npm run bootstrap -- --dry-run` | 安装计划（不执行） |
| `npm run console:smoke` | 7 视图 + 28 单元矩阵 + 键盘 + 权限越权用例 |
| `npm run guard:smoke` | 22 条运行时红线 |
| `npm run steps:smoke` | 61 条步进 / HITL / 送达证据 |
| `npm run agents:smoke` | 43 条 Agent 编制与 adapter |
| `npm run loop:smoke` | 双向协作回路 |
| `npm run audit:upstream` | 7 个固定提交 + 许可证 |
