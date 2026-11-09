# 三上游源码级缺口清单（第五十五轮收口依据）

读透 `deepseek-ai/dsh-superagent-prototype`(MIT)、`lobehub/acceptance`(Apache-2.0)、
`KKKKhazix/agent-autoloop`(MIT) 源码后，逐机制对比本仓现状，得出「还没实现的点」。
本轮（第五十五轮）按此清单收口。

## 一、dsh-superagent 缺的（对齐 `docs/002-authorization` / `003-execution` / `src/policy.ts`）

| 机制 | 上游做法 | 本仓现状 | 本轮动作 |
|---|---|---|---|
| **accept mode 三档** `off/observe/auto` | inferred 候选：`off` 不接、`observe`(默认) 评估后记录「would accept」不真接、`auto` 真接 | 只有「接/不接」，没有观察模式 | 新增 `src/eval-mode.ts`：纯函数判定 + 「would accept」记录 |
| **Eval 两层：gate + assessment** | gate 确定性准入（我们有 admission）；assessment 模型研判卡片是否触及规则 | gate 有，assessment 无（纯规则） | assessment 结果→outcome 的纯函数（模型调用走既有 DeepSeek 云） |
| **Mandate revalidation before resume** | 结束的 Ticket 恢复前重校验授权是否仍成立 | 订阅有 hand-back/release，无恢复前重校验 | 新增 `src/revalidate.ts`：显式/推断/表准入/机器人四类 basis 重校验 |
| **报告 6 状态 + Stage 阶段机** | `progress/waiting/ready/blocked/failed/dropped`，Stage 从「等什么」推出 | phase 粒度较粗 | 新增 `src/ticket-stage.ts`：报告状态 + 阶段推导 |
| **失败恢复退避 + unavailable** | 瞬时失败 3 次指数退避；Eval 超时记 `unavailable` | 无统一退避 | 新增 `src/retry-backoff.ts`：退避纯函数 + unavailable 判定 |

## 二、G5 / G2 / V4（来自差距分析，仍未收口）

| 编号 | 点 | 动作 |
|---|---|---|
| G5 | 多 Agent 并行（fan-out/fan-in） | `src/fanout.ts`：主管拆解 → 多 worker 并行 → 汇总 → 会签 |
| G2 | 对账结论 → 决策上下文 | `reconcile` 结果转 `DecisionPoint`，打通最后一环 |
| V4 | 多通道派单（A 方案：显式指代优先） | `pass-through` 扩展：点名任务编号才允许跨频道接续 |

## 三、acceptance 证据采集（对齐 `references/*.md`，此前最明确缺口）

| 机制 | 上游做法 | 动作 |
|---|---|---|
| 录屏章节标记 | `video-chapters.md`：`step/check/flag` 三 kind + `t` 秒 | `src/video-chapters.ts`：mark 转 chapter + 校验 |
| 证据媒体类型契约 | `evidence.md`：8 种 media + 描述必填 + audio 校验 | `src/evidence-media.ts` |
| 无障碍检查 | `axe.md`：a11y 检查结果 | `src/a11y-check.ts`：axe 结果解析 + 严重度 |
| 交互成本 | `interaction-cost.md`：GOMS-KLM 定价 | `src/klm-trace.ts`：trace 解析 + 定价 |
| before/after 强制接入 | `evidence.md` + `common-mistakes.md`：UI 改动强制前后对比 | `comparisonComplete` 已存在，接入验收判定 |

## 明确不照搬（记录在案，避免水土不服）

- agent-autoloop「挂起零消耗」：bridge 常驻是本仓架构选择，不照搬进程退出。
- dsh「Source/Thread/Correlation」完整事件源模型：本仓已有 github-watch/event-inbox，不另造。
- dsh「worker 子代理用标准 preset + 后台 shell」：依赖 DeepSeek Harness 运行时，不引入。
