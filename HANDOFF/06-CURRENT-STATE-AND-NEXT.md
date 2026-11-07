# 06 · 当前状态与下一步（接手者最该看的一份）

## 1. 状态快照（第十四轮 B2 收尾）

| 阶段 | 状态 | 交付 |
|---|---|---|
| **A 收敛整合** | ✅ 完成 | `architecture-contracts.ts` 统一常量、`RoutingDecision` 五维契约、5 派活点同一份 Trace、FR 覆盖三态口径、平台端口抽象 |
| **B1 记忆主干** | ✅ 完成并验证 | `memory-log.ts` + `memory-projections.ts`、8 处双写、Context Pack 运行时 lineage 过滤、三条红线真跑证据 |
| **B2 读取链切换** | ✅ **完成并验证** | 见第 2 节：投影召回融合、按主体精确撤权、真实一单端到端撤权、增量 checkpoint |
| **C 三层 Router + 底座切换** | 🚫 排队（**B 已验收，但需先按 `08` 拍板产品形态**） | 见第 3 节 |

系统能跑、全套回归全绿（**329/329 单测**、11/11 真实浏览器走查、上游 clean、真实日志增量 checksum 一致）。`HEAD = origin/main = 远端 main`。

## 2. B2 已完成（四项，均带真跑证据）

| # | 交付 | 验收证据 |
|---|---|---|
| 1 | `src/memory-recall.ts`：投影召回作为**第三路**信号接入 `TeamMemory.search` 融合排序；只在 `reusable()` / `allowed()` / hash 重评**之后**按 `sourceId@revision` 白名单裁剪，读日志失败按 advisory 降级 | `tests/memory-recall.test.ts`；全套 329/329、走查 11/11、既有权限/版本重评测试不回退；`modelCalls=0` |
| 2 | `grant-revoked` 不再进全局 `revokedSourceIds`，改记 `principalRevocations`；`recallMemory` 按当前 principal 精确排除，未指定主体时 fail-closed；`source-revoked` 仍全局阻断 | 新增「A 撤权不影响 B 的同源记忆」用例，`tests/memory-replay.test.ts` 全绿 |
| 3 | `npm run memory:journey`：真实 bridge action 跑 `create-source → review confirmed → memory-index → edges-save → l2-extract → context-pack → review withdrawn`；只新建一条专用资料并在末尾撤回，既有资料不动 | `ok:true`；四类投影 before `1/2/1/1` → after `0/0/0/0`，召回 1→0，lineage 失效 4 事件；证据 `.runtime/memory-journey.json`（不入库） |
| 4 | `src/memory-checkpoint.ts` + `npm run memory:checkpoint`：checkpoint + 增量应用；撤权/乱序/失效祖先等会回溯的情况回退全量，且增量结果始终与全量 checksum 逐字节对照 | 真实日志 `mode:incremental, applied:1, checksumEqual:true`；`tests/memory-checkpoint.test.ts` 6/6（含分批追加、重复行、跨批撤权） |

> B 阶段（B1 + B2）已验收通过。**这不等于可以自动开始 C**：C 的底座切换与「5 tab 插件式单页」形态冲突，需先按 `08-OPEN-DECISIONS.md` 第 1 条由用户拍板；三层判断当前仍是 `recommended=false`（覆盖率 5/7）。

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
