# 分层契约与验证（第四十一轮 · 2026-11-09）

> 一句话：本文是「文档里写的分层到底有没有落地」的判定书。
> 每一节末尾的结论都能用 `npm run audit:layers` 复现；体检项直接调用真实实现，
> 不复述文档，也不把「没做」写成「等价实现」。

## 0. 结论摘要

| 层 | 结论 | 体检项 | 一句话说明 |
|---|---|---|---|
| 路由层 | ✅ ok（10） | 8 条行为 + 2 条运行时 | 三档模式可用；最多两跳；主管必须真实在岗；人签只落最后一跳 |
| 入站层（准入 + 直通） | ✅ ok（8 + 1） | 8 条行为 + 1 条准入 | 三档准入；同会话补充说明直接接续，越界交回，释放不复活 |
| Agent 层 | ✅ ok（7） | 7 条 | 编制 / 职责 / 范围 / 版本四要素齐；准入三档不授予成员身份；空编制就是扁平 |
| 权限层 | ✅ ok（6） | 5 条行为 + 1 条策略文件 | 人四级、Agent 三档、知识三分区；策略文件不得被悄悄放宽 |
| 知识层 | ✅ ok（3） | 3 条 | 写按业务域收窄；**读同样按业务域收窄**（读方域未知时按档位兜底，不退回全域放行） |
| 验收层 | ✅ ok（8） | 8 条 | 清单锁定、逐项判定、工作区只读、无放行按钮；讨论与区域都不参与判定 |
| 个性化层 | ✅ ok（3） | 3 条 | 每人偏好、个人区知识、模型绑定、中文指令 |

体检总数 **72 条：ok 72 / partial 0 / gap 0**（其中纯判定 69 条，运行时 3 条由 CLI 追加）。
第四十轮唯一的 partial（知识读边界）本轮已收口，见 §5.3。

复跑：

```sh
npm run audit:layers            # 人读表格；有 gap 退出码 1
npm run audit:layers -- --json  # 机读 JSON（控制台 / CI）
```

---

## 1. 路由层：三档模式，最多两跳

**代码**：`src/router.ts`（唯一入口）· `src/routing-decision.ts`（契约）· `src/routing-trace.ts`（append-only 留痕）· `src/config.ts`（配置 schema）

### 1.1 三档模式

| 模式 | 跳数 | 语义 | 什么时候用 |
|---|---|---|---|
| `legacy` | 1 | 原样产出改造前那一条决策，连 evidence 都不动 | 只做回退验证，不用于日常 |
| `flat` | 1 | 人 / Personal Agent 直接到执行者 | 默认；10 人内小团队不硬造管理层 |
| `layered` | ≤2 | 人 → 业务域主管 → 执行者 | 按业务域配置，需要中间决策层时 |

配置文件是组织级的，项目只引用不覆写；配置一变 `revision` 就变，历史决策仍带旧 `revision`，**不回溯改写**。

### 1.2 两跳成立的四个条件

缺一个就降级为 1 跳，并把原因写进 `plan.degraded`（不是静默）：

1. 业务域在 `config.router.domains` 里登记了 `supervisorAgentKey`；
2. 该主管在 Agent 注册表中**真实在岗**（`enabled`）；
3. 主管绑定了 `supervisor` 职责；
4. 主管的生效范围覆盖该业务域。

### 1.3 降级 / 拦截矩阵

| 情形 | 结果 | 留痕 |
|---|---|---|
| 业务域没登记 | 1 跳 + `未配置中间决策层，按扁平派单` | 正常决策 |
| 主管不在岗 / 职责不符 / 范围不覆盖 | 1 跳 + 具体原因（哪个条件没满足） | 正常决策 |
| 主管与承接人是同一 Agent | 1 跳 + `跳过中间层避免自派自验` | 正常决策 |
| 派活未提交（`pending` / `rejected`） | 1 跳 + `本次派活未提交` | 正常决策 |
| 调用方 / 主管 / Personal Agent 与承接人撞车 | 1 跳 + `blocked` | **写一条 rejected 决策**，不静默丢弃 |

### 1.4 人签只落最后一跳

红线动作（最终业务验收、发布、跨空间授权、知识采用、正式转派）在两跳时，第一跳会显式删除
`requiresHumanSignature`，只有第二跳携带人签标记。**中间层不替人签字，也不把红线扩散成两次签字。**

### 1.5 五个派活点同一入口

| 文件 | 用途 | `route(...)` 调用 | 绕过 Router 直写 |
|---|---|---|---|
| `src/controller.ts` | 入口路由 / 建单 / 交接 | 3 | 0 |
| `src/coordination.ts` | Super Agent 策略准入 | 1 | 0 |
| `src/assistant.ts` | 事务整理 Agent 调度 | 1 | 0 |
| `src/service-network.ts` | A2A 服务委派 | 2 | 0 |
| `src/v06.ts` | 职能责任转移与派单校验 | 2 | 0 |

体检 `runtime.dispatch-wiring` 直接读源码统计，少一个或出现直写即判 gap。

---

## 2. 入站层：准入与直通

**代码**：`src/admission.ts`（准入三档）· `src/pass-through.ts`（直通契约）·
`src/subscription.ts`（订阅生命周期）· `src/collaboration-intake.ts`（唯一调用点）

「直通」= 同一个人在同一条会话里，对**已绑定任务**继续说话，这句话直接交给该任务原来的承接方，
不新建任务、不再过 Router。进门之前还有一步：这个人算不算「我们的人」——由准入三档回答。

### 2.1 与上游的对应

DeepSeek Super-agent 的叫法是 **Subscriptions**：订阅线程上的每条消息都送达该线程的 Tickets 作为上下文，
「delivery bypasses the gate and grants no new authority. Each Ticket remains limited by its Mandate.」
本仓库保留同样的传输优化，并把同一句话写进契约：**直通不产生任何新的授权。**

### 2.2 判定表（8 种结果）

| 情形 | `kind` | 结果 | 调用方动作 |
|---|---|---|---|
| 同一发起人 + 同一会话 + 唯一在办任务 | `direct` | 接续原任务 | 唤醒原任务 |
| 显式指令（建单 / 查进度 / 确认验收 / 退回 / 转交） | `explicit-command` | 不直通 | 回主链路，验收走核可链 |
| 会话没有绑定任务 | `no-binding` | 不直通 | 按新需求进入 Router |
| 会话绑定了多条在办任务 | `ambiguous` | 不直通 | 要求指明任务号，不猜 |
| 只绑定了已验收任务 | `accepted` | 不直通 | 按新需求走，**不复活已完成任务** |
| 审计已记录订阅释放 | `released` | 不直通 | 按新需求走；释放是**终态** |
| 补充说明要改授权面（换人 / 改清单 / 加权限 / 换来源） | `hand-back` | 不接续 | **原样交回主链路**，不塞进执行端上下文 |
| 配对成员与任务发起人不符 | `ownership` | **拒绝** | 抛鉴权错误，不静默降级成新需求 |

判定顺序有讲究：显式指令 → 绑定 → 释放 / 已验收 → 多条 → 归属 → 越界 → 接续。
归属（鉴权）排在越界之前，所以「不是你的线程还要求改清单」先被拒绝，不会被交回掩盖。

### 2.5 准入三档：谁算「我们的人」

**代码**：`src/admission.ts`（纯函数，零模型调用）

| 档位 | 判定证据 | 处理方式 | 带成员身份 |
|---|---|---|---|
| `explicit` 显式准入 | ① 已配对并解析出在职成员；② 单负责人安装里通道白名单唯一登记的那个人 | `process`：走完整链路（建单 / 续跑 / 知识 / 验收仍各自过闸） | ①是 ②否 |
| `inferred` 推断准入 | ① 配对记录还在但成员身份失效（离职 / 权限被撤）；② 白名单登记多人、此人命中但未配对 | `acknowledge`：只回一条配对指引 + 留一条待确认审计，**不建单、不续跑、不读知识** | 否 |
| `not-admitted` 未准入 | 通道也不认（不在白名单、无配对） | `reject`：拒绝并只留审计，不回话（不描述系统内部） | 否 |

结构化保证：`memberContext` 只有「配对成立 + explicit」才为 true；`inferred` 的返回值里恒为 false，
且不存在任何可传给下游的权限字段（与直通同一套做法）。

### 2.6 订阅生命周期：释放与交回

**代码**：`src/subscription.ts`

| 状态 | 怎么产生 | 后果 |
|---|---|---|
| `held` | 任务在办、绑定有效 | 同会话补充说明接续原任务 |
| `handed-back` | 补充说明命中「改授权面」的四类意图 | 不回执行端；交回主链路并留审计，回执说明原因 |
| `released` | 验收回执落库时写 `subscription.released` | **终态**：同一绑定不再复活，后续消息按新需求处理 |

两处刻意的保守：

- 释放写的是**独立审计事实**（`subscription.released`），不是靠「phase 恰好是 accepted」顺推——
  否则「什么时候释放的」事后查不到；
- 越界识别只认四类明确要改授权面的说法（改清单 / 换人 / 加权限 / 换来源），
  **宁可漏、不可误**：误判会把正常补充说明推去建新单，漏判只是沿用原链路。

### 2.3 为什么这轮要把它抽出来

第四十轮之前，这段判断内联在 `ingestTrigger` 的 `if (!match)` 分支里：只能靠读代码推断边界，
写不出针对「已验收 / 多条 / 归属不符」的单测。抽出后：

- 6 条判定各有一条体检 + 一组单测（`tests/layers-audit.test.ts`）；
- 返回结构里**没有** `scope` / `permissions` 字段——结构上就堵住「顺手扩权」；
- 鉴权失败与路由失败分开（`deny` 标志），不会把拒绝伪装成「新需求」。

### 2.4 适用边界

只覆盖 IM（飞书 / 钉钉 / 企微）绑定会话里的补充说明。工作台内的操作本来就是已登录的显式动作，
不需要这条捷径；跨会话、跨人、跨任务一律不直通。

---

## 3. Agent 层：编制、职责、范围、版本

**代码**：`src/agent-registry.ts`

### 3.1 两份事实源，互不覆写

| 文件 | 是什么 | 谁用 |
|---|---|---|
| `agent-registry.ts` | **组织形态真相源**：谁在什么范围担什么职责、版本几何 | Router、A2A 交接、验收编组、知识写入授权 |
| `agent-services.ts` | **运行时服务目录**：这个 Agent 用什么工具 / 模型 / 能力，personal / shared | 执行调度 |

### 3.2 解析算法（零模型调用）

```
候选 = 在岗 ∧ 职责匹配 ∧ 范围覆盖 ∧ 不在本 Task 责任链上 ∧ 版本一致
选中 = 候选按 key 排序后的第一个（可重放，不靠模型判断）
```

返回 `{ agentKey, version, candidates, reason, modelCalls: 0 }`；没有合格候选时 `agentKey=null`，
`reason` 用中文写明是「组织未配置任何在岗 Agent」还是「四个条件没同时满足」。

### 3.3 交接信封

A2A 交接传的是**引用与范围**，不是把资料正文搬过去：`{ sourceIds, visibility, domain, responsibility, agentVersion, registryRevision }`。
校验失败返回 `ok:false` 与原因，由调用方决定降级还是 fail-closed，**绝不静默放行**。

### 3.4 验收编组三方分离

`reviewCrew()` 按 `acceptance` / `standard-drafting` / `inspection` 三个职责分别选人，逐个排除已在责任链上的主体，
保证：评审者 ≠ 产出方，起草者 ≠ 评审者，巡检者 ≠ 前两者。空编制如实降级到既有服务式验收，不硬造。

---

## 4. 权限层：人四级 + Agent 三档

**代码**：`src/rbac.ts`（casbin 封装）· `src/knowledge-authz.ts`（知识分区）

### 4.1 角色与档位

| 主体 | 角色 / 档位 | 权限要点 |
|---|---|---|
| 人 | `owner` | 全部 + 账号管理 |
| 人 | `admin` | 组织区知识增删改、任务控制、审计 |
| 人 | `operator` | 协作区知识写入、任务控制 |
| 人 | `viewer` | 只读 |
| Agent | `agent-supervisor` | 组织区知识增删改（限自己业务域） |
| Agent | `agent-worker` | 协作区知识写入（限自己业务域） |
| Agent | `agent-personal` | 只读 |

单调性由体检 `permission.role-monotonic` 钉住：owner ⊇ admin ⊇ operator ⊇ viewer，owner 额外只多 `accounts-manage`。

### 4.2 知识三分区 × 操作

| 分区 | 写（人） | 写（Agent） | 读 |
|---|---|---|---|
| `personal` 个人区 | 仅归属者本人 | 仅归属者本人（`agent:<key>`） | 本人 + admin 档总览 |
| `team` 协作区 | operator 及以上 | worker / supervisor 档 **且域覆盖** | 登录即可读 |
| `org` 组织区 | admin 及以上（删除同样要 admin） | supervisor 档 **且域覆盖** | 登录即可读 |

### 4.3 fail-closed 与两个进程

- 未初始化 casbin 时一切判定返回 false；
- bridge 与 console 是两个进程，各自读同一份策略文件；新建 / 改角色账号在判定前按 `accounts.json` 现绑（带缓存）；
- 体检 `runtime.rbac-policy` 反向检查：`viewer` 不得有 `task-control`，`agent-personal` 不得有 `knowledge-write-team`，
  `agent-worker` 不得有 `knowledge-write-org`——策略被手工改宽会直接红。

---

## 5. 知识层：三分区、可复用闸、投影

**代码**：`src/knowledge.ts`（内容与状态机）· `src/knowledge-authz.ts`（分区）· `src/graph.ts`（L1 投影）· `src/ontology.ts`（L2 组织图）· `src/cognee-native.ts`（语义管线）

### 5.1 状态机

```
candidate ──人审确认──▶ confirmed ──撤回──▶ withdrawn
    ▲                        │
    └──── 修订（重置为 candidate，退出注入索引）◀──┘
```

「可复用」要同时满足：`state=confirmed` ∧ 有确认人 ∧ 同公司 ∧ HMAC 签名一致 ∧ 未过期。缺一条就进 `excluded` 并写明原因。

### 5.2 证据必须挂得回事实源

每条候选知识写入时逐条校验 `evidenceEventIds` 存在，悬空即拒；服务端另追加「本次提出 / 修订」锚点事件，
让知识天然挂在共享记忆主干上。主干写入失败不阻断业务，缺口由 `memory-guard` 如实报数（不回填、不编造）。

### 5.3 读边界：与写同口径按业务域收窄

第四十轮这条是唯一如实标注的 `partial`（写按域收窄、读不按域收窄）。第四十一轮收口，规则写明：

| 分区 | 读规则 |
|---|---|
| `personal` | 仅归属者本人 + 管理员档（不变） |
| `org` | 登录即可读（组织区本来全员可见，不变） |
| `team` + 声明了业务域 | 读方域与条目域**相交**才可读；管理员档可总览 |
| `team` + 读方域未知 | 按协作区**档位**兜底（operator+ / worker+）；viewer 被拒，**不退回全域放行** |
| `team` + 未声明业务域 | 登录可读（历史数据兼容，不臆造它属于哪个域） |

读方业务域从哪里来（不另造一套配置）：agent 取 registry 的生效范围；人取其实名个人 Agent
所在的知识空间域——与写链 `members(domain)` 用同一个事实源。`knowledge-wiki` 视图同样按可读范围过滤，
且**一旦过滤就不写共享投影**（过滤后的视角不能当全量投影）。

回归项 `knowledge.read-scoped-by-domain` 钉住五个分支：域内可读、跨域被拒、管理员总览、
域未知 viewer 被拒、历史无域条目仍可读。

### 5.4 第四十轮修的口径缺陷

`canCreateKnowledge` 原先把条目的业务域硬编码成 `['*']` 去比 Agent 范围，结果是
**域主管改得、却建不得**（改已有条目按条目域判，新建一律按全域判）。已改为按条目自己的 `domains` 校验，
调用方（`server.ts` 三处）传入 `payload.domains`。回归项 `knowledge.create-aligns-with-update` 钉住：
域内可建、跨域被拒、与 `update` 判定一致。

---

## 6. 验收层：清单锁定、逐项、人签

**代码**：`src/acceptance-plan.ts`（锁定）· `src/acceptance-round.ts`（逐项）· `src/acceptance-workbench.ts`（只读聚合）· `src/visual-review.ts`（独立评审）· `src/acceptance-interop.ts`（对上游报告契约）

### 6.1 就绪判据（工作台 readiness）

| 缺口 | 判据 | 结论 |
|---|---|---|
| 没有开工前锁定的清单 | `plan=null` | 未就绪，沿用原发起人核可 |
| 尚未独立逐项评审 | `round=null` | 未就绪 |
| 清单被替换 | `round.planHash ≠ plan.hash` | 本轮作废 |
| 存在未通过 / 受阻项 | `round.overall ≠ passed` | 不能生成通过用例 |
| 评审者 = 产出方 | `reviewer.model == producerModel` | 本轮不成立 |
| 评审者不支持视觉 | `requiresVision=false` | 不满足独立评审 |

### 6.2 只读是结构保证，不是文案承诺

工作台产物字段里没有 `approve` / `accept` / `release` 任何动作字段（体检 `acceptance.no-approval-action` 遍历 key 断言）。
即使全部就绪，`readiness.note` 仍写「最终核可仍由原发起人在原会话完成」。

### 6.3 报告内讨论与区域点选（讨论是旁听席）

**代码**：`src/acceptance-discussion.ts`（讨论）· `src/acceptance-round.ts`（区域）· `console/app.js`（交互）

| 能力 | 规则 | 不能做什么 |
|---|---|---|
| 讨论范围 | 可挂检查项 / 具体区域 / 整份报告（区域序号 0-7，与证据区域上限一致） | 不能改判定、不能改清单、不能代替人签 |
| 讨论写入 | 追加式：只能新增；正文上限 1000 字；作者必填 | **没有修改正文的接口**——改写只能新发一条 |
| 已处理 | 只有 `resolvedAt / resolvedBy` 两个状态位，只由人打 | 不复原（取消处理会清掉处理痕迹，不伪造历史） |
| 汇总 | 只做 `total / unresolved / byItem` 计数 | 不参与 readiness，不改变 `summary` |
| 区域点选 | 框选高亮 + 键盘可达 + 每框一个可读名字；按本项坐标范围等比缩放 | 区域不参与通过 / 不通过；坐标非有限数或超上限直接拒绝 |

存储落在 `.runtime/v06/acceptance-discussion/<taskId>.json`（0600、追加式、不上传）。
体检 `acceptance.discussion-is-advisory` 与 `acceptance.regions-are-locators` 钉住
「加不加讨论、带不带区域，就绪结论与逐项统计完全一致」。

**如实边界**：区域底板是「按坐标等比缩放」的定位板，不是原始截图。证据引用是事件 id，
事件流里不存图片字节，所以不内嵌截图；需要看图仍走本机证据文件。

---

## 7. 个性化层：偏好、个人区、个人 Agent

| 维度 | 存在哪 | 谁能改 | 验证 |
|---|---|---|---|
| 界面偏好（默认视图 / 主题 / 刷新间隔 / 通知开关） | 控制台用户设置（`scripts/console-server.ts` 的 `settings-set`） | 只有本人 | `console:smoke` 的 `settingsSetOwn` / `settingsValidated` |
| 模型偏好（三档 profile + 按执行身份绑定） | Paperclip 私有文档 | 本机管理员 | `validateModelSettings`：身份必须存在、档位必须一致、外部请求必须关闭 |
| 个人区知识 | 知识空间 `visibility=personal` | 只有归属者本人 | `permission.knowledge-personal-owner-only` |
| 个人 Agent | 成员配对（`/member-pair`）→ `TeamMembers.resolve` | 本人 + 管理员 | 直通 / 归属判定 |
| 语言 | `src/user-language.ts` 中文指令 | — | 确认验收 / 打回 / 转交 / 查看进度 |

「个性化」不等于「放宽」：个人区只有本人能改，模型外发一律关闭，成员身份与任务发起人不符直接拒绝。

---

## 8. 体检怎么跑、怎么看

```sh
npm run audit:layers            # 表格：按层分组，每条带断言、证据、说明
npm run audit:layers -- --json  # JSON：counts / byLayer / checks
npm test                        # 681 例，含 tests/layers-audit.test.ts（11 例）
```

判读口径：

- **ok**：断言成立；
- **partial**：成立但有已知边界，`note` 必须写清边界是什么——**不当作通过**；
- **gap**：不成立，退出码 1。

---

## 9. 仍然存在的边界（不粉饰）

1. **准入强度**：三档已落地，但 `inferred` 档只做「回一条说明 + 留待确认」——没有「自动推断出是谁并直接放行」的路径，
   这是刻意选择（自动推断等于自动授权）。
2. **直通范围**：只覆盖 IM 绑定会话，工作台动作不走直通（也不需要）。
3. **越界识别的精度**：只认四类明确要改授权面的说法，措辞变化可能漏判；漏判的后果是沿用原链路（保守方向）。
4. **区域底板**：没有内嵌截图，只有按坐标缩放的定位板（事件流不存图片字节）。
5. **体检不探测网络**：只读源码、配置、策略文件与本地台账；飞书长连接、GitHub 凭据的真实可用性见
   `channel-health`（服务页「通道体检」卡），两者互补，不互相替代。
6. **legacy 模式**：保留为回退开关；体检在 `legacy` 下直接判 gap（未走统一 Trace），避免拿回退态当常态。
7. **一条命令安装**：机械步骤自动化（配置 / 依赖 / 起服务 / 初始化 / 体检），但建管理员、飞书授权、
   真实业务单仍需人做；Node 版本低于 engines 声明时默认只警告（本机实测可跑），`--strict-node` 才拦。
