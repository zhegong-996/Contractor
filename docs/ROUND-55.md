# 第五十五轮：三上游缺口全部收口（dsh 治理 + G5 并行 + acceptance 证据采集）

用户指令：「把缺的这些全部都做完。一是那些没有实现的点全部实现出来。二是 acceptance 里面的那些全部也实现出来。」随后补充「也同步看一下 DeepSeek 的 Super Agent 对比一下」。

本轮回读 `deepseek-ai/dsh-superagent-prototype`(MIT) 的设计文档（`000-philosophy` ~ `007-architecture`），
把三家缺口合并成一份清单（`docs/THREE-UPSTREAM-GAP.md`），逐项落地。

## 一、dsh-superagent 治理层（此前缺失，本轮补齐）

| 机制 | 落点 |
|---|---|
| **accept mode 三档** `off/observe/auto` | `src/eval-mode.ts`：inferred 候选评估为 accept 时，`observe` 只记 `would-accept` 不真接；`auto` 才真接；显式请求任何模式都接 |
| **assessment 结果 → 处置** | `assessmentOutcome`：每条启用规则都要有 settled 判定，缺任一条记 `unavailable`；至少要一条命中规则 + 意图证据才可接 |
| **Mandate 恢复前重校验** | `src/revalidate.ts`：显式跟进直接过；inferred/bot 要 auto + 规则仍启用；表准入要仍达标；机器人要仍在列表 |
| **报告 6 状态 + 工单阶段机** | `src/ticket-stage.ts`：`progress/waiting/ready/blocked/failed/dropped`，阶段从「等什么」推出（person/answer、person/review、idle…） |
| **失败恢复退避 + unavailable** | `src/retry-backoff.ts`：瞬时失败 3 次指数退避（2s 封顶 60s）；硬失败记 unavailable；Eval 3 次未完成记 unavailable |

## 二、G5 多 Agent 并行（fan-out / fan-in）

`src/fanout.ts`：`planParallel`（主管拆解，子任务越权/预算越界整份拒绝）→ `fanOut`
（N 个 worker 同深度并行，各受授权/预算/深度约束）→ `fanIn`（汇总，标记空产出）。

## 三、G2 对账 → 决策上下文（最后一环）

`src/reconcile-decision.ts`：`openReconcileDecision` 把对账结论（findings / clean / 无产物）
转成 `acceptance` 决策点的 `contextRefs`，打通「执行→登记产物→巡检→对账→进决策上下文」。

## 四、V4 多通道派单（A 方案：显式指代优先）

`src/pass-through.ts` 新增 `explicitTaskReference`：多条在办任务时，消息里点名任务号
（如 `SUI-124`）就唯一接续；点名不唯一或没点，仍回「请指明任务号」，不猜一个最像的。
整词匹配，`SUI-123` 不会误匹配 `SUI-1234`。

## 五、acceptance 证据采集（对照 `references/*.md`，此前最明确缺口）

| 机制 | 落点 |
|---|---|
| 录屏章节标记 | `src/video-chapters.ts`：`step/check/flag` 三 kind + `t` 秒；负 t / 未知 kind / step 缺 label / check 缺 note 都拒；打点日志转章节 |
| 证据媒体契约 | `src/evidence-media.ts`：8 种 media 类型 + 描述必填（不能是「JSON」/文件名）+ audio 要配 text |
| 无障碍检查 | `src/a11y-check.ts`：axe 结果解析，critical/serious 阻断，moderate/minor 不阻断，incomplete 需复核 |
| 交互成本 | `src/klm-trace.ts`：GOMS-KLM 定价，blocked 记 0，外来 schema 不计价，无动作不谎报 0 秒 |

## 明确不照搬（记在 THREE-UPSTREAM-GAP.md，避免水土不服）

- agent-autoloop「挂起零消耗」（bridge 常驻是本仓架构选择）
- dsh「Source/Thread/Correlation」完整事件源模型（本仓已有 github-watch/event-inbox）
- dsh「worker 子代理标准 preset + 后台 shell」（依赖 DeepSeek Harness 运行时）

## 体检 63 → 72（ok 72 / partial 0 / gap 0）

新增 9 条：`eval.accept-mode-observes`、`runtime.ticket-stage-derives`、
`runtime.retry-transient-backoff`、`agent.mandate-revalidate-before-resume`、
`collaboration.parallel-fanout-fanin`、`acceptance.reconcile-feeds-decision`、
`pass-through.explicit-reference`、`acceptance.video-chapters-validated`、
`acceptance.evidence-contract-honest`。

## 验证

- `npm test` **752/752**（+17：dsh 治理 7 + 并行/对账/指代 5 + 证据采集 5）
- `npx tsc --noEmit` 0 错
- `npm run audit:layers` **72 条（ok 72 / partial 0 / gap 0）**
