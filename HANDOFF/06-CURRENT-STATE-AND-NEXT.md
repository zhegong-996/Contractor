# 06 · 当前状态与下一步（接手者最该看的一份）

## 1. 状态快照（交接时 `b58631c`）

| 阶段 | 状态 | 交付 |
|---|---|---|
| **A 收敛整合** | ✅ 完成 | `architecture-contracts.ts` 统一常量、`RoutingDecision` 五维契约、5 派活点同一份 Trace、FR 覆盖三态口径、平台端口抽象 |
| **B1 记忆主干** | ✅ 完成并验证 | `memory-log.ts` + `memory-projections.ts`、8 处双写、Context Pack 运行时 lineage 过滤、三条红线真跑证据 |
| **B2 读取链切换** | ⏳ 待做 | 见第 2 节 |
| **C 三层 Router + 底座切换** | 🚫 排队，**不得与 B 并行** | 见第 3 节 |

系统能跑、全套回归全绿（315/315 单测、11/11 真实浏览器走查、上游 clean）。工作区干净，`HEAD = origin/main = 远端 main`。

## 2. B2 待做清单（建议按顺序，每项都有验收标准）

1. **把 `TeamMemory.search` 的召回结果切到消费投影**：当前仍读 `graph.ladybug` / `chunk-tokens.json` / `semantic-vectors.json`。目标：在不破坏既有权限重评（`reusable()` + `w.allowed()`）的前提下，用 `recallMemory(bundle, query)` 的结果参与融合排序。
   - 验收：`npm test` 全绿 + 走查 11/11 + 现有 `search` 的权限/版本重评测试不回退。
2. **`grant-revoked` 按 principal 精确过滤**：当前重放层用严格 `revokedSourceIds`（含授权撤销）做 lineage 阻断，运行时只用 `sourceRevocations`（只资料撤回）。目标：让单主体撤权只影响该主体派生记忆，不放大成全局屏蔽。
   - 验收：新增测试「A 撤权不影响 B 的同源记忆」，且 `source-revoked` 仍全局阻断。
3. **真实业务动作产生完整知识类事件并跑端到端撤权**：目前真实日志只有走查触发的 `context-packed` 与桥接的 2 条路由决策。目标：在真实一单上跑 `source-ingested → memory-indexed → edge-drafted → context-packed → source-revoked`，验证投影与检索都不可召回。
   - 验收：`memory:replay` 显示四类投影曾非零、撤权后归零；`duplicateIds` 只反映跨进程重写。
4. **投影增量构建 / 压缩**：当前每次全量重放，事件量增大后会变慢。目标：checkpoint + 增量应用，checksum 语义不变。
   - 验收：全量重放与增量重放 checksum 一致。

> B2 全部完成并跑通 `05` 的全套回归后，才算 B 阶段验收通过，才能开始 C。

## 3. C 排队内容（现在不要动）

- 把 5 个派活点收敛成**单一 `Router` 类**（`RoutingDecision` 已是地基）。
- 接 A2A handoff 实现 **Personal → Supervisor → Worker** 三层；此时重新跑 `assessThreeTier()`，P1/P3/P4/P6 全绿后再决定是否引入三层实体。
- **平台底座切换**：补 `HostPlatformPort.capabilities().missing` 的 5 项后，才考虑移除 Plugin SDK。

**三层判断当前结论（真实数据）**：`recommended=false`，覆盖率 5/7。未满足 P1（五阶段决策覆盖）、P3（Personal Agent 实体）、P4（主管 Agent 实体）、P6（单一 Router）。反面依据：玉伯 OPT 访谈说人是「监工」、同时管 5 个 Agent 已达带宽上限、「暂无法实现 Agent 自主管理 Agent」；LobeHub Community License 禁止复制代码。**不要把三层当默认答案。**

## 4. 去 Paperclip 化路线（用户方向，尚未完成）

- 已完成：能力收拢到 `HostPlatformPort`；默认 `PaperclipPlatform` 薄包装；`LocalHostPlatform` 不依赖 Paperclip 且 `host:smoke` 真跑通过；`config.host.provider` 默认 `paperclip`。
- **待补齐 5 项缺口**：ACL/成员身份、cost-ledger（`TraceBridge.flush` 依赖）、插件式 UI 承载与 Plugin SDK、heartbeat 真实执行与 `checkout/retry/runToken` 语义、PostgreSQL 事务与并发控制。
- **产品形态冲突待用户确认**：见 `08-OPEN-DECISIONS.md` 第 1 条。
- 候选（可复用代码，本轮未引入）：Pi（`earendil-works/pi`，MIT core）、CoPaw（Apache-2.0）、Octop（MIT，最接近 Paperclip 的任务+ACL+IM+插件）、DeerFlow（MIT）。只借思想：LobeHub（Community License）、n8n（Sustainable Use License）。

## 5. 其它已知未完成（不是 bug，不要「顺手补」）

- 真人在真实业务单「确认验收」（**SUI-129 未核可**）——只能由用户在原会话做。
- 飞书部门 scope 授权命令已生成，但重新登录确认只能本人操作。
- Cognee 原生 `cognify` 真实外部模型调用未发生（缺端点与凭据，本轮未外发任何业务材料）。
- 企业微信 / 腾讯文档 / 钉钉 / 国内代码托管 / 公有云 CI / 海外 SaaS 未接通，按约定**没有入口**；将来要加入口必须先配置并实测接通。
- 生产发布、业务仓库发布、真实外部 PR/CI、全员 SSO 均未发生。
