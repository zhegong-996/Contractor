# SuitMe 功能架构

> 版本口径：第三十六轮（2026-11-09）。功能模块树 + 实现位置 + 验证方式。
> 判断「某个功能在哪个模块」以本文为准。

## 功能总树

```
SuitMe 协作台
├─ 1 会话与入口
│  ├─ 1.1 飞书通道（主）…………… src/upstream.ts · src/collaboration-intake.ts
│  ├─ 1.2 钉钉/企微通道（补充）…… src/im-outbound.ts · src/channels.ts ★36
│  ├─ 1.3 Paperclip 工作台……… 3100 · scripts/build-chinese-shell.ts（中文壳）
│  ├─ 1.4 管理控制台（只读）…… scripts/console-server.ts :4200
│  └─ 1.5 CLI / MCP……………… scripts/cognee-native.ts · src/server.ts
├─ 2 任务与协作
│  ├─ 2.1 任务创建（幂等）……… src/workspaces.ts createTask
│  ├─ 2.2 智能路由 ………………… src/router.ts · src/routing-trace.ts（5 派活点统一）
│  ├─ 2.3 交接与授权 …………… v06 Transfer · src/channels.ts 渲染
│  ├─ 2.4 服务网 …………………… src/agent-services.ts · src/service-network.ts
│  └─ 2.5 成员与 RBAC …………… src/members.ts · src/rbac.ts
├─ 3 执行引擎
│  ├─ 3.1 步进执行（默认）……… src/step-execution.ts · src/loop-pump.ts
│  ├─ 3.2 执行适配器 ……………… codex / claude / command / acp
│  ├─ 3.3 挂起零消耗 ……………… step 模式等人时进程退出
│  ├─ 3.4 自动续跑闸 ……………… src/auto-resume.ts（P-11，回答后自动排闸）
│  └─ 3.5 步数熔断 ……………… config.execution.maxStepsPerRun
├─ 4 自动化 ★36（本轮新增）
│  ├─ 4.1 定时调度器 ……………… src/scheduler.ts（例程 + 时间槽幂等）
│  ├─ 4.2 定时唤醒复查 …………… src/scheduler.ts（wake 预约/取消/到点触发）
│  ├─ 4.3 GitHub 监听 ……………… src/github-watch.ts（轮询 60s + webhook 验签）
│  └─ 4.4 出站镜像 ……………… src/server.ts deliver()（与飞书共享预算）
├─ 5 人机协作（HITL）
│  ├─ 5.1 提问卡片 ………………… askHuman · 飞书/工作台双渲染
│  ├─ 5.2 回答路由 ………………… src/hitl-bridge.ts（成对台账）
│  └─ 5.3 中文指令 ………………… src/user-language.ts（建单/进度/验收/退回/转交）
├─ 6 验收与交付
│  ├─ 6.1 验收合同 ………………… src/acceptance-plan.ts（开工锁定）
│  ├─ 6.2 逐项判定与证据 ………… src/acceptance-round.ts · 视觉证据绑定
│  ├─ 6.3 独立评审 ………………… src/visual-review.ts（评审者≠产出模型）
│  ├─ 6.4 本机 Git 交付台 ……… src/local-git.ts :4194/:9418
│  └─ 6.5 验收报告 ………………… :4192 一条链接
├─ 7 知识与记忆
│  ├─ 7.1 知识空间 ………………… src/workspaces.ts（分区权限/授权/撤权）
│  ├─ 7.2 L1 图谱投影 …………… src/graph.ts（零模型）
│  ├─ 7.3 Cognee 原生管线 ……… src/cognee-native.ts（DeepSeek+fastembed+autoCognify）
│  ├─ 7.4 组织图谱 L2 …………… src/ontology.ts（确定性抽取）
│  ├─ 7.5 团队记忆 ………………… src/team-memory.ts（打回沉淀/审批）
│  └─ 7.6 语义检索 ……………… 设备端词向量+BM25 · cognee-search action
├─ 8 治理与运维
│  ├─ 8.1 审计台账 ………………… src/store.ts audit（全部关键动作）
│  ├─ 8.2 注意力预算 ……………… src/runtime-bridge.ts（护栏+必达放行）
│  ├─ 8.3 成本账本 ………………… 事件流 modelCalls 计数
│  ├─ 8.4 服务体检 ………………… src/service-status.ts（实时探测）
│  └─ 8.5 金丝雀与自演进 ………… src/evolution.ts（自查闸门默认强制）
└─ 9 国际化与合规
   ├─ 9.1 i18n 标准多语言 ……… locales/i18n-zh-CN.json（445 词条单一数据源）★35
   ├─ 9.2 海外元素清理 …………… src/shell-domestic.ts（品牌/链接/文案）
   └─ 9.3 上游审计 ………………… npm run audit:upstream（clean）
```

★35 / ★36 = 第三十五 / 三十六轮新增。

## 模块 → 文件速查（第三十六轮新功能）

| 功能 | 文件 | 关键函数/类 | 测试 |
|---|---|---|---|
| 定时调度器 | `src/scheduler.ts` | `Scheduler.tick()` · `routineSlot()` | tests/scheduler.test.ts (9) |
| 定时唤醒复查 | `src/scheduler.ts` | `scheduleWake()` · `tickWakes()` | tests/scheduler.test.ts |
| GitHub 监听 | `src/github-watch.ts` | `GithubWatcher.tick()` · `handleWebhook()` · `verifyGithubSignature()` | tests/github-watch.test.ts (5) |
| 钉钉/企微出站 | `src/im-outbound.ts` | `sendDingtalk()` · `sendWecom()` · `dingtalkSignedUrl()` | tests/im-outbound.test.ts (5) |
| 钉钉/企微入站 | `src/im-outbound.ts` + `src/channels.ts` | `dingtalkToTrigger()` · `wecomPlainXmlToTrigger()` | tests/im-outbound + channels |
| 会话链复用 | `src/collaboration-intake.ts` | `ingestTrigger()`（飞书/钉钉/企微共用） | tests/collaboration-intake.test.ts |
| 出站镜像 | `src/server.ts` | `deliver()` + `mirrorToImChannels()` | 行为由 guard:smoke 覆盖 |

## Bridge action 速查（第三十六轮新增）

| action | 读/写 | 权限 | 说明 |
|---|---|---|---|
| `scheduler-status` | 读 | owner/admin | 例程列表 + 下一时间槽 + wake 预约 |
| `wake-list` | 读 | owner/admin | 全部复查预约 |
| `wake-schedule` | 写 | owner/admin | `{taskId, at(未来 ISO), note?}` 预约复查 |
| `wake-cancel` | 写 | owner/admin | 按 taskId 取消预约 |
| `github-watch-status` | 读 | owner/admin | 监听状态/传输方式/凭据就绪度 |

HTTP 端点（第三十六轮新增）：

| 端点 | 方法 | 说明 |
|---|---|---|
| `/github/webhook` | POST | GitHub 事件（HMAC-SHA256 验签，`GITHUB_WEBHOOK_SECRET`） |
| `/im/dingtalk` | POST | 钉钉回调（明文 JSON，sender 白名单） |
| `/im/wecom` | GET/POST | 企微回调（GET 验证 echostr；POST 明文 XML） |

## 配置速查（.runtime/config.json）

```jsonc
{
  "scheduler": {
    "enabled": true,
    "routines": [ { "id": "morning-brief", "title": "…", "goal": "…",
      "schedule": { "kind": "daily", "at": "09:30" }, "enabled": true } ],
    "wake": { "enabled": true }
  },
  "githubWatch": { "enabled": true, "watchPush": true, "watchIssues": true, "watchPulls": true },
  "dingtalk": { "enabled": false, "allowedSenders": [] },   // DINGTALK_WEBHOOK_URL / DINGTALK_SECRET
  "wecom":    { "enabled": false, "allowedSenders": [] }    // WECOM_WEBHOOK_URL
}
```

## 验证方式

每个功能模块的验证入口统一在 `npm test`（585 用例）+ 各专项冒烟（`npm run test:walkthrough`、
`console:smoke`、`guard:smoke`、`steps:smoke`…）。自动化四件套的真实验证证据：
审计表 `routine.triggered` / `wake.scheduled` / `github.baseline` / `im-outbound.sent` 均可在
`bridge.sqlite` 查到对应记录。
