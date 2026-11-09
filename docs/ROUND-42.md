# 第四十二轮：回群对账 + 主题聚合

> 用户指令：「借鉴到的概念中先做回群对账，再做主题聚合，以及这些缺的部分看看有没有开源项目可以借鉴，全部做出来」。
> 参照：千问办公 2.0 Team Agent（关联多群、改完表回群对账）、天猫技术《数字员工：有关 AI Native 新流水线的思考》（协同层 / 主题 / 频道 / 工作项）。

## 0. 先说结论

两篇文章讲的是同一层——**协同层**。千问是这一层目前做得最具体的产品，天猫那篇是这一层最好的抽象。
我们没有推翻任何既有判断，只补上它俩最强、我们最缺的两块：**聚合** 与 **续改后的对账**。

同时明确一条不跟的：**不做「什么都能关联」**。主题里每一项都必须能追到人，
否则我们唯一比千问强的地方（谁有资格、什么算验收、越界怎么退）就没了。

## 1. 开源借鉴（真实项目，不是概念对照）

| 项目 | 我们借的是什么 | 落到哪个文件 |
|---|---|---|
| **Multica**（multica-ai/multica，开源、可自托管） | Project 把 repo/文档打包成一个上下文单元；review gate 只把结果放进「待审」而不自动合入 | `src/topic.ts` 的「主题 = 有责任人的聚合单元」；`src/reconcile.ts` 的「只报不改」 |
| **Plane**（AGPL，开源自托管） | Module 是「一组 issue 的中长期目标」，不是看板泳道 | 主题不建泳道、不建状态机，只做聚合陈述 |
| **Beads**（MIT，依赖感知的 issue tracker） | ready-queue 只认无阻塞的项；其余留在队列里等 | 对账把 blocked 项单列为「卡点」，不混进通过率 |

差异点写清楚：这三家都是**先有板、再有 AI**；我们是**先有判定（准入/清单/证据）、再补聚合**。
所以主题不接管任务状态，只引用任务状态。

## 2. 回群对账（`src/reconcile.ts`）

对齐千问那句「表更新过了，和待办对一下」。

**做什么**：把「开工前锁定的清单」和「本轮逐项判定」比一遍，产出四类差异 + 一张回群卡片。

| 差异 | 含义 | 处理 |
|---|---|---|
| `missing` | 清单要求验，报告里没有 | 报出来，不补建 |
| `extra` | 报告里验了清单外的东西 | 报出来，由人决定补进清单还是删掉 |
| `unpassed` | 必做项状态不是 pass | 报状态，不改结论 |
| `pending` | 报告里还没有结论 | 报出来，不算通过 |

**三条边界（体检钉住）**

1. **只报不改**：不补建待办、不改验收结论、不动 readiness；卡片最后一句逐字写明。
2. **没得比 ≠ 没问题**：没有产物时 `comparable: false`，`conclusion` 明确写「这不是核对通过」，卡片为空。
3. **改清单不入对账**：「把验收清单改一下，少两项」不算对账请求——那是越界动作，走 hand-back。

群里的接线：`collaboration-intake.ts` 在接续路径上判 `isReconcileRequest()`，
命中就跑一次对账，结果写进讨论（advisory，不参与判定）并回一张卡片。回执里带 `reconcile` 摘要。

CLI：`npm run reconcile -- <taskId>`（无可比产物时退出码 2）。

## 3. 主题聚合（`src/topic.ts`）

对齐天猫那篇的结构：业务单元 → 主题 → 多个频道 → 多个工作项。

```ts
Topic {
  id, title, goal, ownerUserId, status,
  channels: [{ kind: 'im'|'board'|'meeting', ref, ownerUserId }],
  tasks:    [{ taskId, roleId, ownerUserId }],
}
```

**三条硬约束**

1. **必须有负责人**：标题、目标、负责人、每个入口、每个任务都缺一不可。空值直接抛错，
   错误文案是「主题里的每一项都要能追到人」。
2. **一个任务只属一个主题**：重复挂会指出已经挂在哪个主题名下——同一件活不能有两套口径。
3. **只陈述现状**：`topicDigest()` 给「几个入口 / 几个任务 / 各状态计数 / 几个卡点」，
   不替你决定下一步、不改任务状态。

存储：`.runtime/v06/topics/<id>.json`，0600，含真实标识不进仓库。

CLI：
```bash
npm run topic -- list
npm run topic -- create --title "闭门会筹备" --goal "把活动办完" --owner ou_xxx
npm run topic -- attach-task <topicId> --task <taskId> --role role-product --owner ou_xxx
npm run topic -- attach-channel <topicId> --kind im --ref oc_xxx --owner ou_xxx
```

## 4. 体检扩容 45 → 47

| 新增 | 分类 | 钉住的契约 |
|---|---|---|
| `reconcile.reports-without-mutating` | 验收 | 对账不改判定；无产物不冒充通过；改清单不入对账；清单对象未被改写 |
| `topic.aggregation-requires-owner` | 路由 | 缺负责人拒绝；跨主题重复拒绝；摘要只陈述现状 |

`auditLayerContracts()` 纯判定 44 条，CLI 追加 3 条运行时 = **47 条（ok 47 / partial 0 / gap 0）**。

## 5. 验证

| 项 | 结果 |
|---|---|
| `npm test` | **690/690**（+9：对账 5 + 主题 4；体检断言在既有用例内更新） |
| `tsc --noEmit` | 0 错 |
| `npm run audit:layers` | **47 条 ok 47 / partial 0 / gap 0** |
| `tests/topic-reconcile.test.ts` | 9/9 |
| `tests/layers-audit.test.ts` | 11/11 |

## 6. 没做与边界

- **没做**：跨群合并成一张表（千问的「跨群对齐」）——它需要先把「同一主题下的多频道」跑起来看真实口径冲突，再定合并规则，否则容易造出一个谁都不认的第三份表。
- **没做**：从既有产物「续改」起新任务、可交互工作台（活文档）。前者要动产物 revision 链，后者是前端形态，都不该和对账/主题挤在同一轮。
- **边界**：主题不参与派单与验收；对账结果不进 readiness、不进 summary；两者都只写本机，不进仓库。
- **待办**：真实业务单跑一次「群里说一句对一下」的完整回环（需用户在飞书发起）。
