# 分层契约与验证（第四十轮 · 2026-11-09）

> 一句话：本文是「文档里写的分层到底有没有落地」的判定书。
> 每一节末尾的结论都能用 `npm run audit:layers` 复现；体检项直接调用真实实现，
> 不复述文档，也不把「没做」写成「等价实现」。

## 0. 结论摘要

| 层 | 结论 | 体检项 | 一句话说明 |
|---|---|---|---|
| 路由层 | ✅ ok（10） | 8 条行为 + 2 条运行时 | 三档模式可用；最多两跳；主管必须真实在岗；人签只落最后一跳 |
| 直通层 | ✅ ok（6） | 6 条 | 同会话补充说明直接接续，只少建一张单，不多给一份权 |
| Agent 层 | ✅ ok（6） | 6 条 | 编制 / 职责 / 范围 / 版本四要素齐；空编制就是扁平 |
| 权限层 | ✅ ok（6） | 5 条行为 + 1 条策略文件 | 人四级、Agent 三档、知识三分区；策略文件不得被悄悄放宽 |
| 知识层 | ◐ partial（3） | 2 条通过 + 1 条如实标注 | 写按业务域收窄；**读不按业务域收窄**（已有边界，未放宽也未假装做到） |
| 验收层 | ✅ ok（6） | 6 条 | 清单锁定、逐项判定、工作区只读、无放行按钮 |
| 个性化层 | ✅ ok（3） | 3 条 | 每人偏好、个人区知识、模型绑定、中文指令 |

体检总数 **40 条：ok 39 / partial 1 / gap 0**。唯一的 partial 是知识读边界，见 §5.3。

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

## 2. 直通层：只少建单，不多给权

**代码**：`src/pass-through.ts`（契约）· `src/collaboration-intake.ts`（唯一调用点）

「直通」= 同一个人在同一条会话里，对**已绑定任务**继续说话，这句话直接交给该任务原来的承接方，
不新建任务、不再过 Router。

### 2.1 与上游的对应

DeepSeek Super-agent 的叫法是 **Subscriptions**：订阅线程上的每条消息都送达该线程的 Tickets 作为上下文，
「delivery bypasses the gate and grants no new authority. Each Ticket remains limited by its Mandate.」
本仓库保留同样的传输优化，并把同一句话写进契约：**直通不产生任何新的授权。**

### 2.2 判定表（6 种结果）

| 情形 | `kind` | 结果 | 调用方动作 |
|---|---|---|---|
| 同一发起人 + 同一会话 + 唯一在办任务 | `direct` | 接续原任务 | 唤醒原任务 |
| 显式指令（建单 / 查进度 / 确认验收 / 退回 / 转交） | `explicit-command` | 不直通 | 回主链路，验收走核可链 |
| 会话没有绑定任务 | `no-binding` | 不直通 | 按新需求进入 Router |
| 会话绑定了多条在办任务 | `ambiguous` | 不直通 | 要求指明任务号，不猜 |
| 只绑定了已验收任务 | `accepted` | 不直通 | 按新需求走，**不复活已完成任务** |
| 配对成员与任务发起人不符 | `ownership` | **拒绝** | 抛鉴权错误，不静默降级成新需求 |

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

### 5.3 读边界：唯一如实标注的 partial

写入按业务域收窄（Agent 只能改自己域内的条目），**读不按业务域收窄**：协作区 / 组织区登录即可读。
理由是读链本来就有「confirmed 才可复用」这道闸，且成员跨域协作需要能看见团队知识。
本条在体检里标 `partial` 并写明「如需读隔离要另立规则，本轮不放宽也不假装已有」。

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
npm test                        # 639 例，含 tests/layers-audit.test.ts（10 例）
```

判读口径：

- **ok**：断言成立；
- **partial**：成立但有已知边界，`note` 必须写清边界是什么——**不当作通过**；
- **gap**：不成立，退出码 1。

---

## 9. 仍然存在的边界（不粉饰）

1. **准入强度**：Super-agent 有 `explicit / inferred / not admitted` 三档准入表；本仓库只有按通道的白名单 +
   显式指令保护，没有「未登记的人在被订阅线程里追问 → 推断候选」这一档。
2. **直通范围**：只覆盖 IM 绑定会话，工作台动作不走直通（也不需要）。
3. **知识读边界**：见 §5.3，读不按域收窄。
4. **体检不探测网络**：只读源码、配置、策略文件与本地台账；飞书长连接、GitHub 凭据的真实可用性见
   `channel-health`（服务页「通道体检」卡），两者互补，不互相替代。
5. **legacy 模式**：保留为回退开关；体检在 `legacy` 下直接判 gap（未走统一 Trace），避免拿回退态当常态。
