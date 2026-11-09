# SuitMe 系统架构

> 版本口径：第四十一轮（2026-11-09）。组件清单、端口、数据流、部署形态与验证基线。
> 深度设计文档见 [SYSTEM-ARCHITECTURE.md](../SYSTEM-ARCHITECTURE.md)（技术细节权威）；
> 分层契约与体检见 [LAYER-CONTRACTS.md](../LAYER-CONTRACTS.md)。

## 1. 部署形态：单机多进程

所有进程只绑 127.0.0.1，本机即可完整运行；外部访问（钉钉/企微/GitHub webhook）需自行反向代理。

```mermaid
flowchart TB
  subgraph 入口
    FE[Paperclip 工作台 :3100]
    CON[管理控制台 :4200]
    FS[飞书 IM]
    WH[webhook：GitHub / 钉钉 / 企微 / 通用事件源]
    SCH[定时调度器]
  end
  subgraph 核心进程
    BR[Bridge 主服务 :4180<br/>任务·路由·知识·自动化·事件收件箱]
    PC[Paperclip 服务 :3100<br/>任务调度·审批·运行]
    VS[视觉评审 :4190]
    RP[验收报告 :4192]
    DL[交付台 :4194 + git daemon :9418]
  end
  subgraph 数据
    PG[(PostgreSQL<br/>步进队列·宿主状态·成本账本)]
    SQ[(SQLite<br/>事件·审计·outbox·幂等键)]
    RT[(.runtime/ 本机文件<br/>配置·凭据·预览·Trace)]
  end
  subgraph 外部（显式配置才启用）
    DS[DeepSeek API<br/>LLM 抽取]
    GH[GitHub<br/>监听·可选交付]
    DT[钉钉/企微 webhook]
  end
  FE --> PC
  CON -->|proxy| BR
  FS <-->|lark-cli| BR
  WH --> BR
  SCH --> BR
  BR <--> PC
  BR --> PG & SQ & RT
  BR -->|轮询/webhook| GH
  BR -->|出站通知| DT
  BR -.->|cognify| DS
```

## 2. 进程与端口

| 进程 | 端口 | 职责 | 启停 |
|---|---|---|---|
| Bridge 主服务（`src/server.ts`） | 4180 | 全部业务 action、飞书监听、定时调度器、GitHub 监听、事件收件箱、通道镜像、HTTP 端点 | `npm run up` / `npm run service -- install`（常驻） |
| Paperclip 服务 | 3100 | 任务调度核心、审批、Agent 运行、工作台前端 | `npm run up` |
| 管理控制台（`scripts/console-server.ts`） | 4200 | 只读运维 + 语义检索 + 我的配置 | `npm run up` |
| 视觉评审（`scripts/vision-server.ts`） | 4190 | 截图/录屏证据结构核对 | `npm run up` |
| 验收报告（`scripts/acceptance-report*.ts`） | 4192 | 一条链接的验收报告页 | `npm run up` |
| 交付台 + git daemon（`scripts/delivery-server.ts`） | 4194 / 9418 | 本机裸仓库、预览发布、clone/push | `npm run up` |

## 3. 分层架构

```
┌─ 入口层 ──────────────────────────────────────────────┐
│ 飞书 · 工作台 · 控制台 · CLI · MCP · 钉钉/企微(可选) · │
│ GitHub 监听 · 定时调度器 · 通用事件源 /events/:source  │
├─ 协作层（业务语义）───────────────────────────────────┤
│ CollaborationIntake(会话归一 + 直通) · Router(1~2 跳) ·│
│ Transfer · 验收合同 · HITL · 唤醒复查 · 注意力预算    │
├─ 组织层（形态）───────────────────────────────────────┤
│ AgentRegistry(职责/范围/版本) · 成员配对 · 服务网      │
├─ 执行层 ──────────────────────────────────────────────┤
│ WorkspaceAssistant · StepRunner(PG 队列) · 适配器 ×4 · │
│ ServiceNetwork(A2A)                                   │
├─ 知识层 ──────────────────────────────────────────────┤
│ KnowledgeService(三分区) · L1 图谱投影 · L2 组织图 ·   │
│ Cognee 原生管线 · 团队记忆 · 语义检索                  │
├─ 宿主层（HostPlatformPort）───────────────────────────┤
│ local-pg(默认) · paperclip · local                    │
├─ 交付层 ──────────────────────────────────────────────┤
│ 本机 Git(默认) · CI 核对 · 独立审码 · 预览 · 版本证据  │
└───────────────────────────────────────────────────────┘
```

## 4. 关键数据流

### 4.1 任务生命周期（主链路）

```
飞书消息 / 工作台 / 定时器 / GitHub 事件 / 通用事件源
  → 归一化(NativeTrigger) → 白名单校验(按通道)
  → createTask(幂等 requestKey) → Router 派活(1~2 跳) → Agent 领取
  → 步进执行(PG 队列, 崩溃可接棒) → [需人拍板?]
      是 → 提问卡片 → 挂起(零消耗) → 回答 → 自动续跑闸(重新验证)
      否 → 交付 → CI → 独立评审 / 独立审码 → 原发起人确认验收
  → 验收报告(一条链接) → 打回原因沉淀记忆 → 知识入库
```

### 4.2 直通（旁路，不建单、不扩权）

```
同会话补充说明
  → passThroughDecision(绑定 / 在办 / 唯一 / 归属)
      ├─ direct      → 接续原任务（不经过 Router，不产生新任务）
      ├─ ambiguous   → 要求指明任务号
      ├─ accepted    → 不复活，按新需求走
      ├─ ownership   → 拒绝（鉴权失败不静默降级）
      └─ 显式指令    → 回主链路（验收走核可链）
```

### 4.3 出站通知（注意力预算统一把关）

```
outbox(pending) → guard.gateNotification
  ├─ 不该打扰 → suppressed(留审计)
  ├─ 人类必达 → 飞书送达 + 钉钉/企微镜像(同一预算, 不开小灶)
  └─ 飞书不可达 → 镜像可达时 mirrored / 否则保持 pending 等恢复
```

### 4.4 自动化与后台循环（挂主循环 tick）

```
tick(15s) ─┬─ scheduler.tick(): 例程到点建任务(时间槽幂等) + wake 到点复查
           ├─ githubWatcher.tick(): 60s 节流轮询(gh api 优先, REST 兜底)
           ├─ eventInbox: /events/:source 收事实(逐来源密钥, 指纹幂等)
           └─ 并发上限: 按密度缺省(interval ≤ 60min 串行, daily/cron 不限)
                跳过不静默: events(routine-blocked) + 审计(每小时节流) + status.blocked
```

## 5. 数据与凭据

| 数据 | 存储 | 说明 |
|---|---|---|
| 任务/运行/审批 | Paperclip（宿主 local-pg） | 唯一真源，配置 `host.provider` |
| 步进队列 / 成本账本 | PostgreSQL | `COLLAB_PG_DSN`，缺省本机回环 |
| 事件/审计/outbox/幂等键 | SQLite（`bridge.sqlite`） | routine-tick / wake / github-watch / inbox 指纹 |
| 路由 Trace | `.runtime/routing/events.jsonl` | append-only，可重放 |
| 配置 | `.runtime/config.json` | 业务配置（无凭据） |
| 凭据 | 环境变量 + `.runtime/*.json`(0600, gitignored) | key/webhook/DSN 绝不入库 |
| 知识 / 图谱 | Paperclip 文档 + 本机文件 + Cognee | L1 投影只读隔离 |

## 6. 复用与改造边界

- 7 个上游 submodule 锁定提交，**上游源码不改**；国内化在构建期 transform 完成（`npm run build:chinese-shell`），产物可重复构建。
- 适配层集中在 `src/`（约 100 个模块），耦合点记录在 [上游适配清单](../UPSTREAM-ADAPTERS.md)，`npm run audit:upstream` 自动核查。
- 红线（硬编码，不提供配置项）：验收/核可/放行只在原会话；候选改进必须真人批准；不得改写清单/权限/人签/历史任务；直通不多给权。

## 7. 验证基线（第四十轮）

| 验证 | 结果 |
|---|---|
| `npm test` | **639/639** |
| `npx tsc --noEmit` | 0 错 |
| `npm run audit:layers` | **40 条：ok 39 / partial 1 / gap 0**（唯一 partial 为知识读边界） |
| `npm run console:smoke` | ok:true，7 视图 + 28 单元矩阵（7×2×1280/320）+ 键盘逐键 |
| `npm run guard:smoke` | 22/22 |
| `npm run steps:smoke` | 61/61 |
| `npm run agents:smoke` | 43/43 |
| `npm run loop:smoke` | ok:true |
| `npm run audit:upstream` | clean（7 个固定提交 + 许可证） |
