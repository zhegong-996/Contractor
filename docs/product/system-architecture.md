# SuitMe 系统架构

> 版本口径：第三十六轮（2026-11-09）。组件清单、端口、数据流与部署形态。
> 深度设计文档见 [SYSTEM-ARCHITECTURE.md](../SYSTEM-ARCHITECTURE.md)（技术细节权威）。

## 1. 部署形态：单机多进程

所有进程只绑 127.0.0.1，本机即可完整运行；外部访问（钉钉/企微/GitHub webhook）需自行反向代理。

```mermaid
flowchart TB
  subgraph 用户入口
    FE[Paperclip 工作台 :3100]
    CON[管理控制台 :4200]
    FS[飞书 IM]
  end
  subgraph 核心进程
    BR[Bridge 主服务 :4180<br/>任务·路由·知识·自动化]
    PC[Paperclip 服务 :3100<br/>任务调度·审批·运行]
    VS[视觉评审 :4190]
    RP[验收报告 :4192]
    DL[交付台 :4194 + git daemon :9418]
  end
  subgraph 数据
    PG[(PostgreSQL<br/>步进队列·宿主状态)]
    SQ[(SQLite<br/>事件·审计·outbox)]
    RT[(.runtime/ 本机文件<br/>配置·凭据·预览)]
  end
  subgraph 外部（显式配置才启用）
    DS[DeepSeek API<br/>LLM 抽取]
    GH[GitHub<br/>监听·可选交付]
    DT[钉钉/企微 webhook]
  end
  FE --> PC
  CON -->|proxy| BR
  FS <-->|lark-cli| BR
  BR <--> PC
  BR --> PG & SQ & RT
  BR -->|轮询/webhook| GH
  BR -->|出站通知| DT
  BR -.->|cognify| DS
```

## 2. 进程与端口清单

| 进程 | 端口 | 职责 | 启停 |
|---|---|---|---|
| Bridge 主服务（`src/server.ts`） | 4180 | 全部业务 action、飞书监听、定时调度器、GitHub 监听、通道镜像、HTTP 端点 | `npm run up` / `npm run service -- install`（常驻） |
| Paperclip 服务 | 3100 | 任务调度核心、审批、Agent 运行、工作台前端 | `npm run up` / `npm run service -- install`（常驻） |
| 管理控制台（`scripts/console-server.ts`） | 4200 | 只读运维 + 语义检索 | `npm run up` |
| 视觉评审（`scripts/vision-server.ts`） | 4190 | 截图/录屏证据结构核对 | `npm run up` |
| 验收报告（`scripts/acceptance-report*.ts`） | 4192 | 一条链接的验收报告页 | `npm run up` |
| 交付台 + git daemon（`scripts/delivery-server.ts`） | 4194 / 9418 | 本机裸仓库、预览发布、clone/push | `npm run up` |

## 3. 分层架构

```
┌─ 入口层 ──────────────────────────────────────────────┐
│ 飞书 · Paperclip 工作台 · 控制台 · CLI · MCP ·        │
│ 钉钉/企微(可选) · GitHub 监听 · 定时调度器            │
├─ 协作层（业务语义）───────────────────────────────────┤
│ CollaborationIntake(会话归一) · Router(路由) ·        │
│ 交接与授权(Transfer) · 验收合同 · HITL 提问/回答 ·    │
│ 到点唤醒复查 · 注意力预算护栏                          │
├─ 执行层 ──────────────────────────────────────────────┤
│ WorkspaceAssistant(委托) · StepRunner(步进执行) ·     │
│ 执行适配器(codex/claude/command/acp) · ServiceNetwork │
├─ 知识层 ──────────────────────────────────────────────┤
│ KnowledgeService · KnowledgeGraph(L1 投影) ·         │
│ Cognee 原生管线(LLM 抽取+fastembed) · 团队记忆 ·      │
│ 组织图谱(L2) · 语义检索                               │
├─ 宿主层（HostPlatformPort）───────────────────────────┤
│ local-pg(默认: PG 事务+步进队列) · paperclip · local  │
├─ 交付层 ──────────────────────────────────────────────┤
│ 本机 Git(默认) · GitHub 适配器(显式回退) · CI 核对 ·  │
│ 预览发布 · 版本证据                                   │
└───────────────────────────────────────────────────────┘
```

## 4. 关键数据流

### 4.1 任务生命周期（主链路）
```
飞书消息 / 工作台 / 定时器 / GitHub 事件
  → 归一化(NativeTrigger) → 白名单校验(按通道)
  → createTask(幂等 requestKey) → Router 派活 → Agent 领取
  → 步进执行(PG 队列, 崩溃可接棒) → [需人拍板?]
      是 → 提问卡片(飞书/工作台) → 挂起(零消耗) → 回答 → 自动续跑闸
      否 → 交付 → CI → 独立评审 → 原发起人确认验收
  → 验收报告(一条链接) → 打回原因沉淀记忆 → 知识入库
```

### 4.2 出站通知（注意力预算统一把关）
```
outbox(pending) → guard.gateNotification
  ├─ 不该打扰 → suppressed(留审计)
  ├─ 人类必达 → 飞书送达 + 钉钉/企微镜像(同一预算, 不开小灶)
  └─ 飞书不可达 → 钉钉/企微兜底(mirrored) / 保持 pending 等恢复
```

### 4.3 自动化四件套（本轮新增，全部挂主循环 tick）
```
tick(15s) ─┬─ scheduler.tick(): 例行任务到点建任务(事件表幂等占位)
           │   + wake 预约到点触发复查委托
           └─ githubWatcher.tick(): 60s 节流轮询(gh api 优先, REST 兜底)
               首次只记基线; 新事件指纹 → 建任务; webhook 验签共用指纹
```

## 5. 数据与凭据

| 数据 | 存储 | 说明 |
|---|---|---|
| 任务/运行/审批 | Paperclip（宿主 local-pg） | 唯一真源，配置 `host.provider` |
| 步进队列 | PostgreSQL | `COLLAB_PG_DSN` 环境变量，缺省本机回环 |
| 事件/审计/outbox | SQLite（`bridge.sqlite`） | 幂等键也在此（routine-tick/wake/github-watch） |
| 配置 | `.runtime/config.json` | 业务配置（无凭据） |
| 凭据 | 环境变量 + `.runtime/*.json`(0600, gitignored) | key/webhook/DSN 绝不入库 |
| 知识图谱 | 本机文件 + Cognee Ladybug | L1 投影只读隔离 |

## 6. 复用与改造边界

- 7 个上游 submodule 锁定提交，**上游源码不改**；国内化（中文、品牌、海外元素清理）全部在构建期 transform 完成（`npm run build:chinese-shell`），产物可重复构建。
- 适配层代码集中在 `src/`（约 100 个模块），与上游的耦合点记录在 [上游适配清单](../UPSTREAM-ADAPTERS.md)，`npm run audit:upstream` 自动核查。
- 红线（硬编码，不提供配置项）：验收/核可/放行只在原会话；候选改进必须真人批准；不得改写清单/权限/人签/历史任务。

## 7. 验证基线（第三十六轮）

`npm test` 585/585 · tsc 零错 · 浏览器走查 11/11 · console:smoke 55/55 · guard:smoke 22/22 ·
steps 61/61 · loop/router/agents/memory/shapes/evolution/host:pg 全绿 · `audit:upstream clean` ·
四件套新增 21 个测试用例 · 定时器提前触发 bug 真实发现并修复（见 [业务流程](business-flows.md) §6）。
