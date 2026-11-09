# 上游开源项目源码级复用清单

> 用户要求「完整补齐，代码可以复用」。本文是三个开源项目源码**逐文件读完后**的复用路线图：
> 每个机制标注「我们现状 → 复用方式（复用代码 / 借概念 / 已有跳过）」。license 全部允许复用代码
> （MIT / Apache-2.0，需保留版权与许可证声明；AGPL 的 `sd-webui-lobe-theme` 与本项目无关，不碰）。

## 0. 三个项目概览

| 项目 | 仓库 | License | 语言 | 定位 |
|---|---|---|---|---|
| dsh-superagent | `deepseek-ai/dsh-superagent-prototype` | MIT | TypeScript | 单仓库团队编码 Agent（Router + Worker + 准入三档） |
| Acceptance | `lobehub/acceptance` | Apache-2.0 | Skill（MD + shell） | Agent 交付的多模态验收报告（截图/录屏/日志 + 视觉评审） |
| agent-autoloop | `KKKKhazix/agent-autoloop` | MIT | TypeScript | 命令行 Agent 后台调度中台（1651 行内核、零运行时依赖） |

## 1. dsh-superagent（MIT）

核心领域模型：`Source → Trigger → Thread → Eval → Ticket → Mandate → Executor`。

| 机制 | 实现位置 | 我们现状 | 复用方式 |
|---|---|---|---|
| 准入三档 explicit/inferred/not-admitted | `src/core/evals.ts` + `docs/002-authorization.md` | ✅ 已有 `src/admission.ts` | 跳过（已对标） |
| Mandate 授权范围不可变（消息改不了权限） | `src/core/evals.ts` `mandate` | ✅ 已有（订阅/授权面 + 越界识别） | 跳过 |
| handback（worker 交回） | `src/core/evals.ts` `handback()` | ✅ 已有（pass-through hand-back） | 跳过 |
| **批量合并评估**（同 Thread 多条 trigger 合并一个 Eval，取最强 strength） | `evals.start()` + `stronger()` | ❌ 单条判定 | **借概念**，与 event-merge 合并（本轮已做 event-merge） |
| **Eval deadline + requeue 2 次** | `evals.due()/expire()` `REQUEUES=2` | 半（V5 超时升级，语义是「升级给 owner」） | 借概念；挂起超时已有 V5，评估超时 requeue 待补 |
| **防重复 ticket**（已 accept 的 trigger 不 spawn 重复 ticket） | `evals.accepted()` | 半（idempotency_key 有） | 借概念，与 event-merge 幂等合并 |
| worker slot 并发 + 额外人的 slot | `docs/003-execution.md` | ✅ 已有（routineParallel + 订阅释放） | 跳过 |
| 30 分钟后台任务上限 + 超时杀 | `src/app/retry-health.ts` | 半（V5 超时升级） | 借概念 |
| observe 观察模式（默认只记录不执行） | `docs/002` | 半 | 待评估 |

## 2. LobeHub Acceptance（Apache-2.0）

它是一个 **Claude skill 包**（`SKILL.md` + `references/*.md` + `scripts/*.sh`），不是独立服务——靠 `lh` CLI 驱动。

| 机制 | 实现位置 | 我们现状 | 复用方式 |
|---|---|---|---|
| 视觉评审（Acceptance Model 独立槽位，只列视觉模型） | `SKILL.md` | ✅ 第四十八轮已接 DeepSeek `deepseek-flash` | 跳过 |
| **HARD RULE：程序 gate 永远不是验收 check**（unit/tsc/lint/build/CI 只能是一行 narrative，不能作为 check） | `SKILL.md`「HARD RULE」段 | ⚠️ 口径需补 | **借概念**——补一条体检/口径，防止「CI 绿了 = 验收过」 |
| **before/after 对比截图**（UI 改动要前后同视角对照） | `SKILL.md` + `report.md#beforeafter` | ❌ 只有 evidence region 定位 | **借概念**，后续补 `comparison` 证据对 |
| **requiredEvidence 缺失 → uncertain**（缺证据就 hold，不 pass） | `SKILL.md` | 半（evidenceKind 有，强制 uncertain 待补） | 借概念 |
| **录屏章节标记（chapter）** | `references/video-chapters.md` | ❌ 录屏未解码 | **复用概念**，后续补录屏 + 章节 |
| **resource-guard 成本闸**（yellow/red 档 + stop-owned，只停自己启动的进程） | `references/resource-guard.md` + `scripts/resource-guard.sh` | ❌ 无成本闸 | **复用代码/概念**，P1 |
| evidence 可复用（commit SHA 变不 rerun） | `SKILL.md` | 半（产物 revision） | 借概念 |
| rounds immutable（修复 = 新 round，不 re-submit） | `SKILL.md` | 半 | 借概念 |
| surface 选择（CLI/web/electron/native/iOS 按 user-visible outcome 选最便宜） | `surfaces/*.md` | 半 | 借概念 |
| interaction cost（KLM 计数） | `references/interaction-cost.md` | ❌ | 可选 |

## 3. agent-autoloop（MIT）

内核 1651 行，四根柱子：事件合并、挂起零消耗、事件溯源、指令数据分离 + 跳数熔断。

| 机制 | 实现位置 | 我们现状 | 复用方式 |
|---|---|---|---|
| **指令数据分离**（字段白名单 + 外部文字进文件不进提示词 + 拒收 cwd/agent/access） | `protocol/validate.ts` `parseEvent` + `worker/contract.ts` `promptFor` | ❌ | ✅ **本轮复用代码实现** `src/instruction-data.ts` |
| **跳数熔断**（hops > 8 只记录不派活） | `kernel/decide.ts` `MAX_HOPS` + `hopsOf` | ❌ | ✅ **本轮复用代码实现** `src/hop-fuse.ts` |
| **事件合并**（同 rule+lane 合成一个 run） | `kernel/decide.ts` `enqueue` + `lane` | 半（idempotency 有，lane 合并没有） | ✅ **本轮复用代码实现** `src/event-merge.ts` |
| 事件溯源（append-only log + 可丢弃投影 + 格式指纹重建） | `kernel/evolve.ts` + `store.ts` | ✅ 已有（events.jsonl append-only + 审计） | 跳过（投影可丢弃重建的「格式指纹」待评估） |
| 挂起零消耗（进程退出、状态入库、续跑） | `kernel/decide.ts` `settleSession` | 半（bridge 常驻，但订阅 release 已做） | 借概念（我们的 bridge 常驻是架构选择，不照搬） |
| rules 派活（when/to/cwd/skill/tell 五字段） | `protocol/rules.ts` | ✅ 已有（routineParallel + 规则视图） | 跳过 |

## 4. 优先级

- **P0 安全（本轮已做）**：指令数据分离、跳数熔断、事件合并——这三个是纯函数，立即落地并进体检。
- **P1（上轮遗留 + 成本）**：resource-guard 成本闸（视觉评审/验收 per-run 上限）、录屏 + 章节标记。
- **P2（口径）**：HARD RULE「程序 gate ≠ 验收 check」补成体检条目；before/after 对比截图；requiredEvidence 强制 uncertain。
- **不照搬**：挂起零消耗（我们 bridge 常驻是架构选择）、Plane 的 AGPL（不碰代码）、Multica 的 Project（语义不同，前几轮已更正）。

## 5. 本轮落地

`src/instruction-data.ts` / `src/hop-fuse.ts` / `src/event-merge.ts` 三个纯函数模块 + 5 例契约测试 +
3 条体检（`security.instruction-data-separated` / `security.hop-fuse-stops-loop` / `routing.event-merge-single-agent`）。
均标注「对齐 agent-autoloop（MIT）」来源，license 声明保留。
