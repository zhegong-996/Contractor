# 02 · 技术架构与真实引用关系

> 权威现状：`docs/SYSTEM-ARCHITECTURE.md`；上游复用：`docs/UPSTREAM-ADAPTERS.md`、`docs/OPEN-SOURCE-COMPLIANCE.md`；方案：`docs/ARCHITECTURE-OPTIONS-v0.7.md`。

## 1. 四层分层与数据流

```
入口层    飞书 IM / 中文协作台(3100 插件页) / MCP·CLI
   ↓
接入层    plugins/worker.ts（取宿主不可变 actor）→ Bridge 4180 的 /workspace/<action>
          （server.ts readOnly + members.ts 成员级 v06Reads 双白名单）
   ↓
业务核心  Controller / V06Services / Workspaces / TeamMemory / ServiceNetwork
          Paperclip 3100 + PostgreSQL = 唯一任务与 ACL 真源
          本地 SQLite(.runtime/bridge.sqlite) 只做事件去重、回执、审计与投影
   ↓
本机层    本机 Git 交付(4194/9418，当前停机) / 中文壳构建期适配 /
          Apple Vision 4190 / 报告服务 4192（后两者当前停机）
```

**不可绕过的两条**：
- 身份链：插件 worker 从宿主取 `context.actor`，带 token 打 Bridge；UI 参数**不能指定操作人**。
- 数据与任务不双写：Paperclip + PG 是唯一任务/ACL 源，SQLite 只是去重与投影。

## 2. 七个上游的真实引用强度（不是「平铺复用」）

静态 `import` 到上游源码的只有 3 个文件，其余是动态加载、esbuild 打包、Python 子进程 RPC、只读文件或纯思想。

| 上游 | 引用方式 | 实际用到 | 明确没用 |
|---|---|---|---|
| Paperclip | 平台底座 + Plugin SDK（`paperclip.ts`、`worker.ts`、`install-workspace-plugin.ts`） | 任务/ACL/文档修订/插件页/UI | 上游源码不改 |
| Super Agent | 运行时动态 import（`upstream.ts`、`coordination.ts` 的 `policy.ts`） | 飞书触发解析、线程键、出站幂等、`settingsPolicy`/`assessmentOutcome` 准入与范围判断 | **Router/Worker 双层、订阅直通、Watchdog 均未落地** |
| Agent Autoloop | 动态 import + 子进程（`assistant-runner.ts`、`runner.ts`、`assistant-turn.ts`） | `createWorker`、执行循环、CLI 适配器、回执恢复——**复用最深** | 不负责跨 Agent 路由；业务 prompt/MCP 工具/权限规则自研 |
| DeepSeek Harness | 静态 import + esbuild 打包 13 模块（`harness-composition.ts`） | `Context`/`SystemPrompt`/`ToolsService`/`NativeExecutor`/`Persona`/`createScope` | 未启动完整 Harness host；LLM 客户端换成自研 |
| Cognee | 前端工具 import + Python 子进程 RPC（`graph.ts`→`cognee-graph.py`、`cognee-native.ts`→`cognee-native.py`） | DataPoint/Ladybug/BM25/GraphSchema；原生 cognify 链路已实现待端点 | 无常驻图服务 |
| `@a2a-js/sdk` | npm import（`service-network.ts`） | `DefaultRequestHandler`/`TaskStore`/`AgentCard`/`TaskState` | 只用于服务委派，未承载三层汇报 |
| `lobehub/acceptance` | **只读文件**（`acceptance-interop.ts` 读 schema/LICENSE） | 报告格式契约 | 上游 CLI / 云端服务未跑 |
| Prime Agent | 代码移植（无 import，`src/vendor/prime-query.ts`，保留 MIT 版权头） | 检索词 / 近期目标权重 | — |
| LobeHub 主仓库 | **0 处代码引用** | 三层汇报、Workspace+Task 等思想 | 全部代码（Community License 禁止复制） |

**三者不是同类**：Super Agent = 触发/策略原语，Agent Autoloop = 执行循环，LobeHub = 组织产品形态；互补三层，不能互相替换。

## 3. 前端分层（第十轮重构）

`plugins/knowledge-workspaces/src/ui/index.tsx` 从 527 行缩为 5 行 SDK 入口：

```
foundation.tsx（原语/文案字典/UI 契约/URL 白名单）  ← 无内部依赖
async.ts（useRead / useActionFeedback）
  ↓
forms / domestic-services / settings / task-detail / spaces / v06-panels（视图）
  ↓
workspace-page.tsx（宿主 action 通道、轮询、5 tab 路由）
  ↓
index.tsx（再导出）
```

`tests/frontend-structure.test.ts` 守卫单向依赖。13 处静默 `.catch(()=>{})` 已收敛为「两个表单就地错误提示 + 其余统一 `UI.report`」，只留页面壳 2 处写明理由的静默。外链统一经 `safeHttpUrl` / `safeLoopbackUrl`。

**前端到系统单向**：插件 UI → worker（action 转发）→ Bridge 白名单 → 业务编排；前端不直接碰任何上游源码。

## 4. 中文壳与国内适配（不改上游）

- `src/shell-locale.ts` + `locales/shell.zh-CN.json`：构建期 Babel AST **只替换展示文案**，不改路由/API enum/业务内容。
- `src/shell-domestic.ts`：构建期精确收敛 4 个侧栏入口；运行时同源脚本 `suitme-domestic.js` 用 `MutationObserver` 隐藏未连接的海外集成卡片，只处理小型可交互节点，有 `MAX_LABEL`/`MAX_CARD`/`MAX_HIDE`、`protectedEl()`（拒绝 `#root`/body/含工作台的大容器）与 `repair()` 自愈。
- `scripts/build-chinese-shell.ts` 顺序必须是「先 domesticShell 再 chineseShell」；构建前从 `public/sw.js` 恢复占位符以保证幂等。
- 「没连接不放空入口」：设置页「国内服务」只有 `service-status` 探测 `ok:true` 才渲染 `<a href>`，未接通项连 `url` 字段都没有。

## 5. 统一路由契约与共享 Trace（第十二轮）

`src/routing-decision.ts` 定义 `RoutingDecision`（caller / target / basis / scope / requiresHumanSignature + stage/outcome/causedBy/幂等 id），5 个派活点（`controller` 3、`coordination` 1、`assistant` 1、`service-network` 2、`v06` 2）经 `src/routing-trace.ts` 单例写**同一份** `.runtime/routing/events.jsonl`，并投影 SQLite `audit`。只读 `routing-status`。

`src/three-tier-assessment.ts` 用真实 Trace 判断要不要引入 LobeHub 三层，当前 `recommended=false`（P1 五阶段覆盖、P3 Personal Agent、P4 主管实体、P6 单一 Router 未满足）。

## 6. 共享记忆主干（B1 + B2，第十三／十四轮）

`src/memory-log.ts` = append-only `.runtime/memory/events.jsonl`（`MemoryEvent` 严格契约，含 `modelCalls`/`projection`/`visibility`/`causedBy`）；`src/memory-projections.ts` = 纯函数重放 **L1 证据图 / L2 组织图 / BM25 向量 / Context Pack**，并把构建逻辑抽成可续算的 `ProjectionState`，供 B2 增量复用。撤权沿 lineage 传播、双层过滤、稳定 checksum。

8 处真实写入点双写（advisory），`readBridgedEvents()` 把 `routing-decided` 并入同一重放输入。**B2 已完成读取链切换**：`src/memory-recall.ts` 把 `recallMemory()` 的投影命中作为第三路信号接入 `TeamMemory.search` 融合排序——权限/版本重评之后才按 `sourceId@revision` 白名单裁剪，读日志失败 advisory 降级；原 Cognee / Ladybug / SQLite / Paperclip 存储仍是**主读取源**，投影是叠加的第三路证据，不是替换。`grant-revoked` 只登记 `principalRevocations`，由 `recallMemory` 按当前 principal 精确排除；`source-revoked` 仍全局阻断。

`src/memory-checkpoint.ts` 提供 checkpoint + 增量应用：会回溯的新事件（撤权 / 乱序 / 失效祖先 / 已撤回来源）一律回退全量，且增量结果始终与全量重放 checksum 逐字节对照。真实验收命令 `npm run memory:journey`（真实业务动作跑完整事件链与端到端撤权）与 `npm run memory:checkpoint`。

## 7. 平台端口（去 Paperclip 化第一步）

`src/platform-port.ts`：`HostPlatformPort` 收拢任务/文档/身份/健康检查/UI 承载；`PaperclipPlatform` 为默认薄包装（`config.host.provider='paperclip'`），`LocalHostPlatform` 是不依赖 Paperclip 的最小可运行实现（本地文件 + append-only journal，未实现 route 明确报错）。`capabilities().missing` 如实列出 5 项切换缺口：ACL/成员身份、cost-ledger、Plugin UI/SDK、heartbeat 真实执行、PG 事务并发。

## 8. 代码交付

`DeliveryAdapter` 接口（`prepare/publish/inspect/preview`）由 `Github` 与 `LocalGitDelivery` 共同实现，`Controller` 只依赖抽象。默认 `delivery.provider='local'`：`git://127.0.0.1:9418/suitme-collab.git` + 本机交付台 4194，**只绑 loopback**，不依赖 GitHub 账号/token。`autoMerge`/`autoPublish` 默认 true（用户 2026-11-07 放开），CI 通过后 fast-forward 合并到本机 main 并发布固定版本预览；仍不发布业务仓库、不触发云端 CI。
