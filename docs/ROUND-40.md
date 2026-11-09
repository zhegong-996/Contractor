# 第四十轮：分层契约体检 + 三上游对标 + 架构图（2026-11-09）

> 用户指令：「优化好之后做验证测试和梳理要特别注意几层的 router、直通，以及 agent 的部分包括权限等等，
> 还有知识库 以及 acceptance，功能和架构逻辑对标 lobehub、super-agent 以及 agent-autoloop，
> 同时要包括我个性化的部分包括权限，知识等等，以及把产品文档更新到最新版，
> 之后给我出一套系统架构图 包括功能架构业务架构技术架构，并把本地和云端（github）都同步到最新版本」

## 1. 这一轮做的不是「再写一遍文档」

要求是「验证测试和梳理」，所以先把七层写成**可复跑的断言**，再改代码，最后才是文档。
体检脚本直接调用真实实现（Router 的 `planRoute`、注册表的 `resolveAssignment`、
知识授权、验收工作台、直通判定），不是复述架构文档。

```
npm run audit:layers
→ 40 条：ok 39 / partial 1 / gap 0
```

七层分布：

| 层 | ok | partial | gap |
|---|---|---|---|
| 路由层 | 10 | 0 | 0 |
| 直通层 | 6 | 0 | 0 |
| Agent 层 | 6 | 0 | 0 |
| 权限层 | 6 | 0 | 0 |
| 知识层 | 2 | 1 | 0 |
| 验收层 | 6 | 0 | 0 |
| 个性化层 | 3 | 0 | 0 |

唯一的 partial 是**知识读边界**：写按业务域收窄，读不按业务域收窄。这条是既有设计
（读链有「confirmed 才可复用」的闸），本轮不放宽、也不写成通过，在体检里显式标注。

## 2. 直通：从隐含分支变成契约

**改动**：新增 `src/pass-through.ts`（98 行），`collaboration-intake.ts` 改为调用它。

之前直通散在 `ingestTrigger` 的 `if (!match)` 分支里：候选筛选、绑定校验、已完成判断、
成员归属校验混在一段代码里，只能靠读代码推断边界，也写不出针对边界情况的单测。

现在是一个纯函数，6 种判定各有名字：

| 判定 | 含义 | 调用方动作 |
|---|---|---|
| `direct` | 同会话 + 唯一在办任务 | 接续原任务 |
| `explicit-command` | 确认验收 / 退回 / 转交 / 查进度 / 建单 | 回主链路 |
| `no-binding` | 没有绑定任务 | 按新需求进 Router |
| `ambiguous` | 多条在办任务 | 要求指明任务号 |
| `accepted` | 只绑定了已验收任务 | 按新需求走，不复活 |
| `ownership` | 成员身份与发起人不符 | 拒绝（不静默降级） |

关键性质：返回结构里**没有** `scope` / `permissions` 字段——「直通只少建单、不多给权」
是类型层面的事实，不是注释里的承诺。语义对齐 Super-agent 的 Subscriptions：
「bypasses the gate and grants no new authority」。

行为没有放宽：鉴权类失败仍然抛错，路由类失败仍然返回 `routed:false`。

## 3. 知识：修掉一个自相矛盾的口径

体检第一版就报了一个 gap：`knowledge.org-create-needs-org-scope` 失败。

查下去发现是真缺陷，不是断言写错：`canCreateKnowledge` 把待建条目的业务域硬编码成 `['*']`
去比 Agent 生效范围，结果是——

- **改**已有条目：按条目域判 → 域主管改得；
- **建**新条目：一律按全域判 → 域主管建不得。

同一个 Agent 对同一分区，改得却建不得。已修：`canCreateKnowledge` 接受条目自己的 `domains`，
`server.ts` 三处调用传入 `payload.domains`。回归项 `knowledge.create-aligns-with-update` 钉住
「域内可建、跨域被拒、与 update 判定一致」。

这是本轮唯一的功能性修复。其余 39 条体检确认既有行为符合契约。

## 4. 对标：功能面 + 架构面

新增 [BENCHMARK-3UPSTREAM.md](BENCHMARK-3UPSTREAM.md)，只对标钉住的提交：

- **Agent Autoloop** `ba8cf6d`：强在安装、规则文件、`decide.ts` 的纯函数约束；
- **Super-agent** `8c32a9d`：强在准入强度三档（explicit / inferred / not admitted）与订阅生命周期；
- **lobehub/acceptance** `f720feb`：强在验收报告的产品完成度（区域标注、报告内讨论、多人分别确认）。

结论口径：

- 我们更完整在：组织编制、权限分区、知识库、验收链路打通、审计；
- 我们落后在：准入强度、报告交互、订阅 hand-back / release、安装体验；
- **未对标**：LobeHub 本体（lobe-chat）没有 pin 代码，只借设计语言，不写成「已实现」。

## 5. 架构图

新增 [ARCHITECTURE-DIAGRAMS.html](ARCHITECTURE-DIAGRAMS.html)，三张自包含 SVG（无外部依赖、可离线打开）：

1. **功能架构**：九个能力域 + 共享底座；
2. **业务架构**：发起 → 派活 → 执行 → 拍板 → 验收 → 沉淀的泳道，人 / Agent / 系统与知识三条；
3. **技术架构**：七层（入口 / 协作 / 组织 / 执行 / 知识 / 宿主 / 交付）+ 数据落点 / 外部依赖 / 验证基线。

## 6. 验证

| 命令 | 结果 |
|---|---|
| `npm test` | **639 / 639**（第三十九轮 629 + 本轮 10） |
| `npx tsc --noEmit` | 0 错 |
| `npm run audit:layers` | **40 条：ok 39 / partial 1 / gap 0** |
| `npm run console:smoke` | ok:true（7 视图 + 28 单元矩阵 + 键盘 + 权限越界用例） |
| `npm run guard:smoke` | 22 / 22 |
| `npm run steps:smoke` | 61 / 61 |
| `npm run agents:smoke` | 43 / 43 |
| `npm run loop:smoke` | ok:true |

## 7. 文档

| 文件 | 变化 |
|---|---|
| `docs/LAYER-CONTRACTS.md` | 新增：七层契约、判定表、证据、边界 |
| `docs/BENCHMARK-3UPSTREAM.md` | 新增：功能面 × 架构面对标 |
| `docs/ARCHITECTURE-DIAGRAMS.html` | 新增：功能 / 业务 / 技术三张图 |
| `docs/product/*.md` | 全部更新到第四十轮（功能树、端口、数据流、流程、验证基线） |
| `docs/FEATURE-PARITY.md` | 增补 §5.3 指向本轮体检与对标 |
| `HANDOFF/*`、`PROJECT-SUMMARY.md` | 同步版本与新增文件 |

## 8. 仍然存在的边界

1. **准入强度**未实现（Super-agent 的 inferred 档）；当前未登记的人只会被白名单挡掉。
2. **直通范围**只覆盖 IM 绑定会话；工作台动作不走直通。
3. **知识读**不按业务域收窄（体检 partial）。
4. **报告交互**只有区域数据层，没有点选与报告内讨论。
5. **体检不探测网络**：只读源码 / 配置 / 策略文件 / 本地台账；通道可用性看 `channel-health`。
6. **控制台未接入体检**：本轮只提供 CLI 与 JSON，未加只读 action（避免再次变更行为基线）。
