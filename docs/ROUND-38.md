# 第三十八轮 · 周边与运行层收口 + Acceptance 成为一等模块

> 时间：2026-11-09 11:00（本机 Asia/Shanghai）
> 用户指令：「周边功能和运行层全部修复，以及 [DeepSeek Super-agent 文章] 这种类似的功能；
> 我们的不同之处在于整个团队有一个共有的上下文底座，然后根据职能划分，有三的结构，
> 根据每个人的职能来划分和分配任务，类似 lobehub 的思路；acceptance 这个项目也要集成
> 进去，成为一个模块，前端也要增加这部分进来，可能是一个审查的 agent？」
>
> 这一轮做两件事：**把 RE-AUDIT 第 6 节的 5 项待补全部补上**，以及**把 Acceptance
> 从"契约 + 报告"提升为控制台的一等模块**（后端聚合 + 前端工作台 + 组织视图）。
> 口径延续第三十七轮：只写「已实现 / 仅契约 / 未发生」三种状态，不写「全部实现」。

## 1. 这一轮补了什么（按用户关心的顺序）

### 1.1 Acceptance 成为模块：验收工作台 + 审查 Agent

| 层 | 新增/改动 | 说明 |
|---|---|---|
| 后端聚合 | `src/acceptance-workbench.ts`（新） | 一次只读调用 `v06-acceptance-workbench` 返回：锁定清单 + 逐项判定合并后的条目、统计（total/passed/failed/blocked/pending）、第 N 轮结论与打回清单、审查 Agent 编组（reviewer / standardDrafter / inspector / collaborators / degraded / redLines）、报告与沉淀可用性、就绪缺口。**没有合格 Agent 时如实降级，不伪造清单** |
| 证据区域 | `src/acceptance-round.ts` | 新增 `EvidenceRegion`（x/y/width/height/note，上限 8 条）与 `assertEvidenceRegions`：区域只作定位，**不参与判定**；负数 / 零宽 / Infinity / 超限一律拒收 |
| 前端 | `console/app.js` `AcceptanceView` 重写 | 任务选择器 + 四张统计卡 + 清单表格（检查项 / 证据类型 / 判定标签 / 原因与证据区域）+ 审查 Agent 编组卡 + 报告与沉淀卡 + 签字与边界卡。**页面上没有通过 / 打回按钮** —— 最终结论只能在原会话由原发起人下 |
| 测试 | `tests/acceptance-workbench.test.ts`（新，4 例） | 合并顺序与区域、未锁定不伪造、打回进入自查标准、区域校验边界 |

### 1.2 团队共享上下文底座 + 三层职能：组织视图

用户强调的差异化在这里落到界面上：**一份共享上下文，按职能配三层座位**（LobeHub 式），层是配置不是骨架。

| 项 | 实现 |
|---|---|
| 后端 | `src/organization-view.ts`（新，`modelCalls=0`）：`shape`（flat / layered、最大跳数、业务域）、`contextBase`（事件主干条数 / 知识来源 / 空间 / 四类投影 / 模型调用数）、`layers`（个人助手 / 职能主管 / 执行与验收）、`domains`（主管 / 执行 / 验收 / 任务数）、`tasks`（按阶段 / 按 Agent / 未分配） |
| 前端 | `console/app.js` `OrganizationView`（新）：四张统计卡 + 三层职能座位卡 + 按职能分布表 + 共享上下文底座卡 + 任务分布卡 + 组织原则卡 |
| 测试 | `tests/organization-view.test.ts`（新，3 例）：空编制扁平不硬造、分层主管/执行/验收归位与任务归并、未登记业务域与未分配计数 |

### 1.3 规则匹配：事件分流 + 并发上限 + 合并成一轮（待补第 1 项）

| 能力 | 实现 | 红线 |
|---|---|---|
| 事件分流 | `routine.when = { source, types }`，支持 `*` 与 `merge_request.*`；与 `schedule` **必须二选一**（`superRefine` 强制） | 事件只提供事实，不提供指令 |
| 并发上限 | `routine.parallel` + `routine.group`；台账写在 events 表（`routine-task:{taskId}` open/closed），任务 accepted 自动结账 | **只有显式配置才生效**：缺省不限流，避免「昨天那班没验收完，今天晨报被静默跳过」 |
| 排队合并 | 同源同类型、在 `mergeMinutes`（默认 30）窗口内的事件**合并成一轮**，标题点明条数、任务 goal 逐条列事实 | 未命中类型的事件留在收件箱，不丢 |

### 1.4 通用入站事件源：GitLab / 任意业务系统（待补第 3 项）

`src/event-inbox.ts`（新）+ `POST /events/:source`：

- 归一化：GitLab（`X-Gitlab-Event` 人话事件名 → `push` / `merge_request` / `pipeline` …）、GitHub、通用 JSON（`{type, title, detail, url, id}`）；
- 验签：每来源一把独立密钥（环境变量名写在 `eventInbox.sources[name].secretEnv`），HMAC-SHA256 或 `X-Gitlab-Token` 直比，**没配密钥直接拒收**，不存在裸奔模式；
- 幂等：`inbox:{source}:{type}:{fingerprint}` 唯一，重复投递 `duplicate:true`，不重复开工单；
- 职责分离：收件箱只收事实（`pending` / `filtered` / `consumed`），**建不建任务由 scheduler 的 `when` 决定**；
- 只读面：`event-inbox-status`（来源 × 类型 × 状态计数）。

### 1.5 交付流水线独立审码阶段（待补第 4 项）

`src/code-review.ts`（新），插在 `sync`（等 CI）与 `preview`（预览部署）之间：

```
publish → sync → code-review（独立阶段）→ preview → accept（人签）
```

- **确定性**：不调模型，同一份 diff 永远同一结论 —— 模型评审可另加，但不能成为唯一闸门，否则「为什么被拦」说不清；
- 规则：硬密钥形态（AWS / 私钥 / `sk-*` / `ghp_*` / App Secret / 赋值型口令）、`.env` 进仓库 → **block**；`debugger` / `console.log` / `.only` / `.skip`、直接改 `upstream/`、大 diff（>800 行）、改了实现没改测试 → **warn**；
- 闸门：只有 block 拦部署；关掉 `codeReview.enforce` 时降级为「记录但不拦」，报告里写明没拦；
- 脱敏：报告只留 `前8***后4`，密钥原文不进报告 / 文档 / 日志；
- 落点：独立 Paperclip 文档 `code-review`，边界写死「本报告是证据，不是验收结论」。

### 1.6 验收矩阵标准化（待补第 5 项）

`scripts/console-smoke.mjs` 新增矩阵段：**3 个视图（概览 / 组织 / 验收）× 2 主题（浅/深）× 2 宽度（1280 / 320）= 12 个单元**，每单元测三条硬线：

1. 页面级无横向溢出（排除自身可滚动容器内的元素）；
2. 每个可聚焦元素有可读名字（`aria-label` / 关联 `label` / 文本 / `value` / `title`），且无 `tabindex>0` 劫持顺序；
3. 真实派发 8 次 Tab：走到文档末尾之前的落点里，至少 3 个不同元素、无缺名交互元素。

矩阵当场发现并修掉两个真问题：**侧栏菜单项默认 `tabindex=-1` 且菜单根不可聚焦 → 键盘用户根本进不了侧栏**（已给菜单项 `tabindex="0"` + `:focus-visible` 焦点环）；**验收页任务选择器内层 `el-select__input` 没有可读名字**（已加 `<label for>` 关联）。

### 1.7 出站重试健康：`retry-health` 视图（待补第 5 项之外的一处 ◐）

- `src/store.ts`：outbox 补 `at` 列（旧库原地 `ALTER TABLE`），`notify` 写投递时刻；
- `src/retry-health.ts`（新）：状态分布 + 待投递最久等待 + 超阈值卡住清单 + 近 24h 通道级失败计数 + `healthy / backlog / failing` 判定；
- 口径前置写死：**pending ≠ 失败**（飞书不可达时故意堆积等恢复）、`local_only` 是有意的、`suppressed` 只裁过程通知；
- 前端：服务视图新增「出站投递健康」与「事件收件箱」两张卡（只读角色 403 时如实显示看不到）。

## 2. 验证证据

```text
npm test                620/620（本轮新增 22 例：工作台 4 · 组织 3 · 收件箱 6 · 规则 6 · 审码 6 · 重试健康 6 中的重叠计入总数）
tsc --noEmit            0 错
console:smoke           ok:true、failed:[]
  ├─ 7 个视图全部渲染（含新增「组织」「验收」）
  ├─ 验收矩阵 12/12 单元通过（matrixOverflowAndFocus / matrixKeyboardOrder 均 ok）
  └─ Tab 顺序：li:概览→协作→组织→知识→验收→服务→我的配置→主题按钮
```

真实服务（bridge 4180，重启加载本轮代码）：

```text
POST /workspace/organization-view           200  shape.mode=flat、contextBase.projections 四类、modelCalls=0
POST /workspace/v06-acceptance-workbench    200  plan/items/round/report 一次取齐；未锁定任务如实返回 plan:null
POST /workspace/retry-health                200  状态分布 + 待投递时长 + 失败通道
POST /workspace/event-inbox-status          200  enabled:false（默认关闭，未登记来源就不收）
```

## 3. 边界（这一轮没有做的事，别当成做了）

1. **审码不含模型评审**：规则是确定性的，只覆盖「人一定会拦」的硬项；语义级代码意见（架构是否合理、命名是否贴切）仍需人或独立评审模型，本轮未接。
2. **事件源默认关闭**：`eventInbox.enabled=false`，要在 `config.json` 登记来源与密钥环境变量才收；GitHub 仍走既有的 `/github/webhook` 与轮询，两条路都在，未合并。
3. **矩阵只覆盖控制台三视图**：插件工作台的 `test:responsive`（1280/425）与这是两套，未合并成一个矩阵。
4. **`parallel` 缺省不限流**：与上游 Autoloop「缺省串行」不同，理由见 1.3；要串行就显式配 `parallel: 1`。
5. **验收区域框选只到数据层**：坐标能存、能显示、能校验，但「下一轮从该区域开始复看」的前端交互未做。
6. **真实业务单未在本轮重跑**：本轮验证以契约测试 + 本机服务真调用 + 浏览器走查为准，没有新的飞书真实工单。
