# 共享记忆架构：append-only 事件主干与四类投影（方案 B · 第十三轮）

> 用户决策（2026-11-07）：按 **A → B → C 不并行**，A 收尾后开始 B。B 的验收红线沿用 `ARCHITECTURE-OPTIONS-v0.7.md`：**重放可复现、来源撤权后派生记忆不可召回、确定性链路 `modelCalls=0` 不破**；不新增上游依赖。
>
> 一句话：知识库本质上是 Agent 的共享记忆架构。本轮把「事件日志为唯一真源 + 四类投影」落地为可验证链路，并复用上一轮的 `RoutingDecision` 契约。

---

## 1. 落地前的真实情况（避免重复造轮子）

| 能力 | 原有实现 | 缺口 |
|---|---|---|
| 资料确认 / 撤回 | `knowledge.ts` 的 `reusable()` 要求 `state==='confirmed'`；`TeamMemory.search` 在写入与读取两处重评 | 只是「来源本身」的动态判定，**没有派生记忆的 lineage 传播** |
| 授权撤销 | `workspaces.revoke` + `w.allowed()` 在检索时重评权限 | 同上，L2 边 / Context Pack 需人工 `edgeInvalidate` |
| L1 证据图 | Cognee + Ladybug，按 `sha256(sourceId@revision)` 物理隔离 | 隔离边界是已验证安全属性，本轮**不动** |
| BM25 / 语义召回 | `TeamMemory.index` 生成 `chunk-tokens.json` / `semantic-vectors.json`，Apple NL 设备端词向量 | 索引产物没有统一事件留痕 |
| L2 组织图 | `knowledge-edges.ts` 的 draft / accepted / reusable / `invalidAt` | 失效是状态写入，但没有自动沿 lineage 传播 |
| Context Pack | `buildContextPack` 只取 `eligibleForContextPack` 的边 | 撤权来源的证据边需人工先失效 |

**结论**：现有链路对「来源」和「授权」已有动态重评（本轮不改），缺的是**派生记忆（索引 / 边 / 上下文包）的自动 lineage 阻断**与统一可重放真源。B 阶段补的正是这一层。

## 2. 事件主干（`src/memory-log.ts`）

- 唯一真源候选：`.runtime/memory/events.jsonl`，append-only，每行一个严格 `MemoryEvent`。
- `architecture-contracts.ts` 的 `memoryEventSchema` 扩展了 `modelCalls`（非负整数）、`projection`、`visibility`，并新增 `source-revoked` / `grant-revoked` / `memory-indexed` / `projection-rebuilt` 四种 kind（共 12 种，含上一轮的 `routing-decided`）。
- `MemoryLog.append()`：进程内幂等（`idempotencyKey` 稳定 id）、单 sink 失败不影响其它 sink、写入失败**绝不改变业务结果**（与 `RoutingTrace` / `TraceBridge` 的 advisory 语义一致）；`attachAudit()` 投影一份到 SQLite `audit`。
- 测试进程由 `scripts/test.ts` 设 `COLLAB_TEST_MEMORY=memory`，事件只进内存 sink，**真实业务日志不含测试动作**。
- **契约复用**：`readBridgedEvents()` 把 `.runtime/routing/events.jsonl` 的 `routing-decided` 事件并入重放输入，不需要第二套格式。路由事件的 `causedBy` 是业务标识（triggerId / phase）而非主干事件 id，由 `bridgeRoutingEvent()` 归一化到 `payload.routingCausedBy`，避免误报悬空 lineage——这是真实 HTTP 冒烟抓到并修掉的语义冲突。

## 3. 四类投影与撤权 lineage（`src/memory-projections.ts`）

`replayMemory(events)` 是**纯函数**：排序稳定（at → id）、按 id 去重、基准时间取事件流最后一条而非 `Date.now()`、`projectionChecksum()` 用键排序的稳定序列化。两次重放同一日志必然一致。

| 投影 | 事件来源 | 内容 |
|---|---|---|
| L1 证据图 | `memory-indexed` / `fact-extracted` | 按 `sourceId@revision` 聚合 chunks / concepts / facts |
| L2 组织图 | `edge-drafted` / `edge-accepted` | 边与状态（draft → accepted / reusable） |
| BM25 向量 | `memory-indexed` 的 `chunkTexts` | 确定性中英混合分词（英文词 + 中文单字 / 二元组） |
| Context Pack | `context-packed` | 任务、证据引用、过期时间 |

**撤权传播算法**：

1. 收集 `source-revoked` / `grant-revoked` → `revokedSourceIds`（严格集合）与 `sourceRevocations`（只含资料本身撤回）。
2. 每事件若自身 `sourceRef` 命中撤权，或沿 `causedBy` 任一级祖先命中，即进 `invalidatedEventIds`；环形 lineage 保守失效，悬空 lineage 记入 `integrity.danglingCausedBy` 但不误伤正常链路。
3. 投影构建跳过失效事件，`suppressedByRevocation` 如实计数；`recallMemory()` 再过滤一次（双层），`excludedByRevocation` = 投影层 + 召回层拦截量之和。
4. **分层很重要**：`grant-revoked` 是单主体授权撤销，只进严格集合；运行时读取链路用 `sourceRevocations`，避免把一次撤权放大成全局屏蔽。

`recallMemory()` 只读投影、不调用任何模型，`modelCalls` 恒为 0；`assertDeterministic()` 在事件流累计模型调用非零时明确拒绝，不静默降级。

## 4. 真实接线（8 处双写 + 1 处运行时过滤）

| 文件 | 写入点 | 事件 |
|---|---|---|
| `workspaces.ts` | `createSource` / `reviewSource` / `revoke` | `source-ingested` / `source-revoked` / `grant-revoked` |
| `v06.ts` | `l2Extract` / `edgeAccept` / `edgeInvalidate` / `contextPack` | `edge-drafted`（带 `result.modelCalls`）/ `edge-accepted` / `edge-invalidated` / `context-packed` |
| `team-memory.ts` | `index` | `memory-indexed`（chunks / concepts / chunkTexts，`modelCalls: 0`） |
| `controller.ts` | `accept` / `confirmAcceptance` | `acceptance-recorded` |

**全部是 advisory 双写**：原存储（Cognee / Ladybug / SQLite / Paperclip 文档）照常工作，事件写入失败不影响业务。只读 `memory-replay` action 与 `npm run memory:replay` 输出重放报告；`npm run memory:smoke` 在临时目录真跑完整链路。

**运行时过滤（真实生效，不只在重放层）**：`v06.contextPack` 在构建前读取 `sourceRevocations`，剔除证据引用命中撤权来源的边；核对失败时 **fail-closed 拒绝构建上下文包**，并写 `v06.memory-lineage-filtered` 审计。

## 5. 真跑证据（不是单测模拟）

`npm run memory:smoke`（`ok: true`，临时日志）：

| | 撤权前 | `source-revoked` 后 |
|---|---|---|
| 事件数 | 5 | 6 |
| 四类投影 | L1 1 / L2 1 / BM25 2 / Pack 1 | 全部 0（验收记录保留） |
| 召回「验收 知识」 | 1 命中 | **0 命中** |
| `excludedByRevocation` | 0 | **4** |
| `modelCalls` | 0 | 0 |
| `replayTwiceEqual` | true | true |

`npm run memory:replay`：5 个文件 `wired: true`、`allWired: true`、`eventCount: 2`（桥接自真实路由决策日志）、`bridgedRoutingEvents: 2`、`replayTwiceEqual: true`、`deterministic: true`、`logErrors: []`、`danglingCausedBy: []`。

真实 HTTP `POST /workspace/memory-replay` → `200`、`ok: true`、`checksum` 稳定、`modelCalls: 0`。

**真实业务知识类事件当前为 0**：主干刚接入，尚未有真实的知识确认 / 索引 / 验收动作触发；日志里的 2 条是上一轮真实的策略准入路由决策。这是「未发生」，不是「造数据补齐」。

## 6. 回归

`npm test` **315/315**（新增 12 例 B 阶段测试：契约、落盘/幂等/坏行、重放可复现、四类投影、撤权不可召回、多级 lineage、确定性、完整性、撤权分层、桥接归一化、路由并入、接线自检）、`tsc --noEmit`、全套构建与走查（见 `VALIDATION.md` 第十三轮）。

## 7. 边界与下一步

**B1（本轮，已完成）**：事件主干、四类投影重放、三条红线的可执行验收口径、8 处双写接线、Context Pack 运行时 lineage 过滤、路由契约桥接。

**B2（尚未做，不是 bug）**：把 `TeamMemory.search` 等读取链路正式切换为「消费投影」而非读原存储；真实业务动作产生知识类事件并验证端到端撤权；把 `grant-revoked` 按 principal 精确过滤（当前运行时只用 `sourceRevocations`）；投影增量构建与压缩（当前每次全量重放）。

**C 仍未开始**：三层 Router 与平台底座切换排在 B2 验收之后，按用户要求不并行。真人业务验收（SUI-129 未核可）、Cognee 原生 `cognify` 真实外部调用、生产发布仍未发生；4190 / 4192 / 4194 / 9418 保持用户取消时的停机状态。

**隐私**：`.runtime/memory/`、`.runtime/routing/` 只在本地、不入库；事件 payload 里的 chunk 文本截断到 200 字，真实业务正文不进仓库。
