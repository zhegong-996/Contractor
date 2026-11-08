# 05 · 验证与命令手册

## 1. 全套回归（改动后必跑）

```sh
cd /Users/gong.zhe/Developer/ai-native-collab
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost NODE_USE_ENV_PROXY=0

npm test                    # 557/557（基线）
npx tsc --noEmit            # 退出 0
npm run build:workspaces    # 插件 UI 打包 + 类型检查
npm run build:chinese-shell # hiddenEntries 4 条、missed []、warning null
npm run test:responsive     # 425px 无溢出、按钮 44px
npm run agents:smoke        # C-4 Agent 编制隔离真跑 43/43
npm run shapes:smoke        # C-5 扁平 / 分层各跑真实一单 36/36（隔离内存 Trace）
npm run evolution:smoke     # C-6 沉淀回流与自演进闭环 45/45（隔离治理台账）
npm run steps:smoke         # P-1 单步执行 61/61（隔离队列 + PG 专属库 + 真实子进程；③d ⑧⑨ 含 B21~B24）
npm run test:walkthrough    # 11/11、failures []
npm run audit:upstream      # clean: true、problems []（含 casbin / Vue / Element Plus 登记）
git diff --check            # 退出 0
```

> `build:chinese-shell` 在后台沙箱会因 Vite `emptyOutDir` 批量删除触发 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，**前台已授权环境退出 0**（见 `00` 坑 3）；不是代码问题。

**功能类 CLI / 冒烟（也应全绿）**：

```sh
npm run memory:replay       # 只读重放：replayTwiceEqual / deterministic true
npm run memory:smoke        # 临时目录真跑三条红线，ok:true
npm run memory:checkpoint   # 真实日志增量应用，checksum 与全量对照
npm run memory:hierarchy    # P-7 分层规则隔离真跑 16/16（不写真实 B1 主干）
npm run guard:smoke         # P-8 真实数据联合真跑 22/22（只读，含 HTTP memory-guard；golden 基线见第三十一轮重冻结）
npm run atlas:check         # 架构图册静态自检 11/11（变量覆盖 / 离线自足 / 无敏感内容）
npm run memory:journey      # 真实 bridge action 全链路 + 端到端撤权（会写真实日志）
npm run routing:status      # allWired:true、threeTier.recommended:false
npm run host:smoke          # 非 Paperclip 宿主 ok:true
npm run host:pg             # PG 后端 24/24、ok:true（专属库 suitme_collab_c1；③d ⑧⑨ 含对外动作 / 血缘 / generation 真跑）
npm run console             # 自研独立控制台（按需启动，非常驻；默认 4200，只绑回环）
npm run router:smoke        # C-3 三种形态 31/31（隔离内存 Trace，不写真实日志）
npm run shapes:smoke        # C-5 扁平 / 分层各跑真实一单 36/36（隔离内存 Trace，不写真实日志）
npm run evolution:smoke     # C-6 完整闭环 + 全部反例 45/45（隔离治理台账，不写真实日志）
npm run steps:smoke         # P-1 完整链 + 全部反例 61/61（唯一 runId，不 reset 他人数据）
npm run step:once           # P-1 一次进程只跑一步；默认 loop 下不连库、如实返回未启用
npm run console:smoke       # 临时端口 + Chrome 真跑 55/55，输出 .runtime/console-smoke.json
npm run loop:smoke          # P-9 双向回路：真实 HTTP + 隔离子进程提问/回答/回流建议，18/18
npm run services status     # 4190/4192/4194(+git 9418) 辅助服务统一纳管状态（P-11）
npm run console:owner -- <用户名> <口令>  # 首次引导：创建 owner 账号（只能一次；P-12 登录制）
npm run cognee:native -- status   # enabled:true, configured:false（缺 4 个环境变量）
npm run delivery:demo       # 本机 Git 链路；4194/9418 停机时 gitProtocolClonePull 为 false，属预期（P-11 起两服务常驻运行中）
```

`memory:journey` 会新建一条专用资料并在末尾撤回，**不是只读检查**；`memory:checkpoint -- --reset` 会全量重建后再按 append-only 前缀增量应用。

## 2. 第二十二轮 P-1 实测结果（2026-11-08；含第十四轮 B2、第十六轮 C-1、第十七轮 C-2、第十八轮 C-3、第十九轮 C-4、第二十轮 C-5、第二十一轮 C-6 历史数据）

| 项 | 结果 |
|---|---|
| `npm test` | **413 / 413**（第二十一轮 400 + P-1 新增 13 例单步执行契约） |
| `steps:smoke` | **40/40 `ok:true`**：A 配置/只读视图 6、B 隔离内存队列 21、C 本机 PG 专属库 + 真实子进程跨进程单步 8、D 接线守门 6；第一棒 `counter=1`，第二棒由「另一台机器」的独立进程领走 `counter=2`，旧 `runToken` 作废、模型步如实拒绝、B1 主干行数前后不变；报告 `.runtime/steps-smoke.json` 不入库 |
| `v06-execution-view`（真实 HTTP / 控制台代理） | **200**：`mode=loop`、`steppedReady=false`、`queue=未接入状态外置队列`、`missing=6`、`redLines=5`；控制台写动作 403；协作视图新增中文「长程执行」卡片，四张 1280 截图 `errorCards:0` |
| `step:once`（默认 loop） | 如实返回 `{claimed:false, mode:"loop"}`，不连数据库、不产生任何步骤 |
| `npx tsc --noEmit` | 通过 |
| `build:workspaces` / `build:chinese-shell` | 通过 / `hiddenEntries` 4、`missed: []`、`warning: null`（前台重跑） |
| `test:responsive` | 425px `393/393`、溢出 0、按钮 44px、`problems: []` |
| `test:walkthrough` | **11 / 11**，`failures: []`（旧插件工作台未回退） |
| `console` 只读超时 | 真实浏览器测得 `view` 415KB / 10~12 秒；改为按动作区分超时（`view` 30 秒、其余 8 秒），保留去重与短缓存，截图 `errorCards:0`；**第二十三轮 P-5 已完成服务端分页 / 裁剪**：控制台改拉 `view-summary`（5.5KB / 0.076 秒），`view` 的 30 秒宽限只留给兼容调用，详见本节末尾第二十三轮实测 |
| `evolution:smoke` | **45/45 `ok:true`**：闸门五种阻断、标准变更防蒙混、禁改对象拒绝、Agent 自批 / 跳闸门 / 无人审灰度被拦、真人批准 → 灰度 20% → 生效 → 回滚、四项效果指标与不可比标注、台账两次重放一致、坏行留痕；真实治理台账 / B1 主干行数前后不变、已锁定清单字节未变；报告 `.runtime/evolution-smoke.json` 不入库 |
| `v06-evolution-view`（真实 HTTP / 控制台代理） | **200**：1 条沉淀标准 / 闸门已强制 / 0 次自查登记 / 暂无候选改进 / 效果不可比；控制台写动作 `v06-self-check-record` **403** |
| `console:smoke` | **`ok:true`**：6/6 视图、真实任务 10 条、主题切换持久化、425px `425/425`、可见文案零海外品牌、无输入框、写动作 403 |
| `audit:upstream` | `clean: true`、`problems: []`（7 个上游） |
| `shapes:smoke` | **36/36 `ok:true`**：扁平 `shape.ready=true / recommended=false`、分层 `true / true`；每步带 Router / 在岗快照、两次重放一致、因果链闭合、人签只在末跳、真实日志行数不变；报告 `.runtime/shapes-smoke.json` 不入库 |
| `agents:smoke` | **43/43 `ok:true`**：C-3 兼容、空编制降级、在岗 2 跳、停用 / 职责 / 范围降级、自环留痕、验收编组、A2A 六类失败、快照不回溯、五处接线守门 |
| `memory:smoke` | 撤权前 1 命中 → 撤权后 **0 命中**、`excludedByRevocation=4`、`modelCalls=0` |
| `memory:journey` | **`ok: true`，9/9 checks**：四类投影 `1/2/1/1 → 0/0/0/0`、召回 `1 → 0`、`lineageInvalidated`、新增 `lineageComplete`（本次资料悬空 lineage 前后均为 0）、`logErrors=0`、两次重放一致 |
| `memory:checkpoint` | 真实日志 `mode:incremental, applied:1, fallback:null, checksumEqual:true`（全量重建 30 → 增量后 31 事件）；journey 追加撤权事件时按预期 `fallback:retroactive-event` 回退全量，`checksumEqual:true` |
| `router:smoke` | **`ok:true`、31/31**：legacy 5 跳 / flat 5 跳 / layered 10 跳、五阶段覆盖、因果链闭合、人签不扩散、p6 按证据、p8 未放行、未登记业务域降级、自环留痕 |
| `routing:status` | `allWired:true`；`router.mode=flat`、`domains=[]`、`onDuty=0`；`routerCoverage total=65 / routed=7`；`shape.mode=flat`、P3/P4 按扁平口径、p6 false、p8 false、`recommended:false`；CLI 与真实 HTTP 200 一致 |
| `host:smoke` / `host:pg` | `ok:true` / **`ok:true`、21/21**（事务、并发领取、步进链、崩溃恢复、token 幂等） |
| `cognee:native status` | `configured:false`（缺 4 个环境变量，未外发业务材料） |
| `git diff --check` / staged 敏感扫描 | 通过 / 无 `.runtime`、无真实身份 |

## 3. 第二十三轮 P-5 实测结果（2026-11-08，服务端分页 / 裁剪）

| 项 | 结果 |
|---|---|
| `npm test` | **424 / 424**（第二十二轮 413 + 9 例摘要契约 + 2 例控制台契约） |
| 真实服务端 HTTP 对比 | `view` **509,283 bytes / 4.02 秒**；`view-summary` **5,678 bytes / 0.076 秒**；`limit=2` **1,078 bytes / 0.019 秒**（历史浏览器端到端 415KB / 10~12 秒） |
| 响应结构 | `taskCount=10`、`page.total=10`、`hasMore=false`、`titleSource=host`、`fieldsClipped=true`；任务对象 7 个白名单字段；不含 `snapshots` / `body` / `context` / `sourceAccess` |
| `console:smoke` 新增 4 项 | `summaryReady`（5,678 bytes / 94ms）、`summaryClipped`、`summaryPageHonest`、`summaryPaged`（`limit=2` 返回 2 条、`total` 仍 10）全绿；旧 `/api/view` 仍 200 且 10 条真实任务 |
| 既有回归不回退 | `tsc`、`build:workspaces`、`build:chinese-shell ok:true`、`test:responsive`、`test:walkthrough` **11/11**、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 40/40、`host:pg` 21/21、`host:smoke`、`memory:replay` / `memory:checkpoint`、`routing:status`、`audit:upstream clean:true`、`git diff --check` |
| 环境处置 | 3100 / 4180 进程带失效文件代理导致静态页 500、`view` 409 并随后崩溃；按 `HANDOFF/00` 既定流程用干净环境重启并重挂插件后恢复，走查 11/11。未改上游源码、未重启已取消服务 |
| 如实边界 | 摘要只用于展示索引，不含工作稿正文 / 授权明细 / 验收判断；`view` 逐字保留；宿主标题 advisory 降级；只读白名单 16 → 17 项；默认底座仍 `paperclip`；真人业务验收 SUI-129 仍未发生 |

> `memory:replay` 的 `eventCount` 会随真实业务动作增长，`duplicateIds` / `danglingCausedBy` 也可能保留历史行（append-only 日志不物理删除）。**判定标准是 `replayTwiceEqual` / `deterministic` / `logErrors` 为空，以及 `memory:journey` 的 `lineageComplete`**，不是固定数字。第十四轮修复前真实日志曾有 6 条悬空 lineage，旧行仍在，新链路已为 0。

## 4. 第二十四轮 P-6 实测结果（2026-11-08，Runner 协议移植）

| 项 | 结果 |
|---|---|
| `npm test` | **445 / 445**（第二十三轮 424 + `step-hitl` 10 例 + `step-delivery` 11 例） |
| `steps:smoke` | **54/54 `ok:true`**（原 40 + E 段 6 + F 段 3 + G 段 5）；真实 PG 专属库 + 真实子进程，唯一 runId、未 reset 他人数据 |
| E 段 HITL 成对留痕 | 真实子进程在 `human-gate` 只提问不放行（PG 步骤仍 `failed`）、返回 `hitlQuestionId`；`step:answer` 真人回答成对闭环、`acceptance:false`；重复回答与匿名身份被拒；台账在临时目录、B1 主干行数前后不变 |
| F 段队列送达证据 | `TrackedStepQueue` 包真实 PG 队列：`delivered=1 / acknowledged=1 / pendingDelivery=0 / notifications>=1`；累计确认推进到 `d000002` 后积压清零，旧确认 `d000001` 不回退；通知幂等、投递就绪按能力声明、重投递只认空闲 |
| G 段四项借思想 | 六态派生（安静 30 秒才 settled，且 settled 与 running 可并存）、运行时能力声明不存 argv、配置库与追加写日志分层、编制快照不回溯；`executionView()` 只读暴露且 `modelCalls=0` |
| R7 来源登记 | Runner MIT 固定 `a42d133139bbe630e4ca3475426c7653fddd86db`；`licenses/runner-MIT.txt` / `THIRD_PARTY_NOTICES.md` / `sources.lock.json` 的 `protocolReferences` / `docs/SOURCES.md` / `docs/OPEN-SOURCE-COMPLIANCE.md` / `audit:upstream` 机器化校验；`clean:true`、`problems: []`；**7 个上游不变**，避开 GPL-3.0-only 发布窗口 |
| 既有回归不回退 | `tsc`、两个构建、425px 响应式、走查 11/11、`console:smoke`、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`host:pg` 21/21、`host:smoke`、记忆重放 / checkpoint、`git diff --check` |
| 如实边界 | `human_response` 只把答案送回提问者、不等于验收；执行进程不得自行放行人工步；未接通飞书写回通道，回答目前只有本机 CLI 入口；默认仍 `loop` + `paperclip`、无外部模型调用；SUI-129 仍未核可 |

## 5. 第二十五轮 P-7 实测结果（2026-11-08，Anthropic agent memory 分层参考）

| 项 | 结果 |
|---|---|
| `npm test` | **465 / 465**（第二十四轮 445 + `tests/memory-hierarchy.test.ts` 20 例） |
| `npm run memory:hierarchy` | **16/16 `ok:true`**；隔离确定性数据，不写真实 `.runtime/memory/events.jsonl`（40 → 40 行不变） |
| A / B 段 | 四层与 200 行 / 25 KB 预算；规则与参考沉淀（含依据、陷阱、恒为候选）；挂靠校验通过并逐一拒绝无留痕 / 悬空 / 已撤回 / 无签字却确认 |
| C 段 | 健康知识地图链接完整、断言有出处、不膨胀；复现文章 Figure 12：wiki 208,908 bytes / 语料 117,760 bytes = **1.77 倍**被拒；悬空链接 / 重复主题 / 孤立页 / 无出处断言如实列出 |
| D / E 段 | 注入顶层只放已签字且真人批准提升的条目标题与 `note:` 指针、正文下移；离线整理确定性、只读、待真人复核、`modelCalls=0`，证据漂移 / 悬空链接 / 膨胀 / 超预算各触发对应建议 |
| F 段 | append-only 主干只追加、历史逐条未变；只读汇总四层齐备；真实 B1 记忆主干行数前后不变 |
| 来源登记 | `conceptReferences` + `THIRD_PARTY_NOTICES.md` + `docs/SOURCES.md` + `docs/OPEN-SOURCE-COMPLIANCE.md` + `audit:upstream` 机器化校验；`clean:true`、`problems: []`；不是第 8 个上游、未复制正文 / 代码 |
| 既有回归不回退 | `tsc`、两个构建、425px 响应式、走查 11/11、`console:smoke`、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 54/54、`host:pg` 21/21、`git diff --check` |
| 如实边界 | 纯函数守门尚未接入真实 `Knowledge` / `Context Pack` / wiki 落盘；未新增只读 action、未改控制台；默认仍 `loop` + `paperclip`，无外部模型调用；SUI-129 仍未核可 |

## 6. 第二十六轮 P-8 实测结果（2026-11-08，查漏补缺与取长补短）

| 项 | 结果 |
|---|---|
| `npm test` | **499 / 499**（465 + 12 例守门 + 16 例行为基线 + 8 例常态契约） |
| `npm run guard:smoke` | **22/22 `ok:true`**；只读，真实 B1（40 行）/ 路由（100 行）日志前后不变 |
| A 段冻结基线 | `fixtures/behavior-golden.json` 61 条稳定字段与当前真实 `console:smoke` 报告逐项一致（unchanged 61、added/removed/changed 全 0）；时间 / 端口 / 耗时变化不改签名；种类不同不比较不编造分数；退化能判 `regressed` |
| B 段出站 MCP | 从真实 `src/mcp.ts` 静态解析 16 个工具，全部通过「不暴露」硬断言；注入 `confirm_acceptance` / `admin_dump_private` 被精确名与前缀拦下；工具面签名顺序无关、增删即变 |
| C / D 段 | 100 条真实路由决策留痕无坏行、时间单调、不与业务任务 id 重合；双臂旗标样本不足不补零、有区分才 comparable、波动过大标 high-variance |
| E 段守门接真实数据 | 140 条真实事件 + 22 条本地知识索引；如实报 `gapRecords:22 / missingEvidence:22`，`unwired` 四项；`advisory:true / blocking:false / modelCalls:0`；三处白名单同步静态核对 |
| F 段真实 HTTP | `POST /workspace/memory-guard` → **200 / 4,337 bytes / 7 ms**，`source:local-store`、`documentBodiesNotRead:true` |
| 冻结基线人审 | 全套浏览器回归后 `guard:smoke` 的 golden diff 如实抓到 `checks.readOnlyAllowlist.actions` **17→18**；经人审确认为本轮新增只读 action `memory-guard` 的预期配置变化（非行为退化），**由人手工更新基线并在 `humanReview` 记录时间 / 轮次 / 变化 / 理由 / 审核人**，真跑脚本仍不得自动改写 |
| 修掉的真实缺陷 | `recordFingerprint` 覆盖记录内容；`injectedOmitted` 报出顶层截断；冻结基线改字节序排序（跨平台可复现） |
| 既有回归不回退 | `memory:hierarchy` 16/16、`steps:smoke` 54/54、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`host:pg` 21/21、走查 11/11、`console:smoke failed: []`、两个构建、425px、`tsc`、`audit:upstream clean:true`、`git diff --check` |
| 如实边界 | 只读体检不等于写入链改造；第 13 条四项与第 12 条 (b) 五项仍待拍板；默认仍 `loop` + `paperclip`，无外部模型调用；SUI-129 仍未核可 |

## 7. 第二十七轮 P-9 实测结果（2026-11-08，双向协作回路）

| 项 | 结果 |
|---|---|
| `npm test` | **532 / 532**（521 + 11 例 P-10：回路修复回归 / hitl-bridge 契约 / 飞书路由端到端） |
| `npm run loop:smoke` | **16/16 `ok:true`**；A 真实 HTTP 200 / advisory、B 四个执行链耦合点、C 真实子进程回答 + 建议落盘、D 半回路 → 完整回合（staleAnswers 1→0、closedCycles 0→1）、E 飞书补充说明就近配对、F 只读红线 |
| `loop-guard` | HTTP 200、`advisory:true`、`blocking:false`、`modelCalls:0`；**如实报 `bidirectional:false` 与耦合点计数 0** |
| 冻结基线 | golden diff 抓到白名单 18→19，人审后手工更新并写 `humanReview` |
| 既有回归 | `guard:smoke` 22/22、`steps:smoke` 54/54、`memory:hierarchy` 16/16、tsc、两构建、425px、走查 11/11、`console:smoke failed: []`、`audit:upstream clean:true`、`git diff --check` |

## 8. 第二十九 / 三十轮实测结果（2026-11-08，P-11 自动续跑与 P-12/P-13 RBAC·前端重写·知识分区 CRUD）

| 项 | 结果 |
|---|---|
| `npm test` | **540 / 540**（第二十八轮 532 + `tests/auto-resume.test.ts` 8 例等 P-11 契约；P-12/P-13 契约换代净增） |
| RBAC / 登录制 | casbin `5.51.1`（Apache-2.0）+ 策略文件 `.runtime/console/rbac_policy.csv`（种子生成、删文件即重置）；人四档 `g` 绑定 + `ensureHumanBound` 跨进程自愈；agent 三档直判；`rbacEnforce` 同步 fail-closed |
| `console:smoke` | **49/49 `ok:true`**：未登录 401 / 错口令 401 / 登录发 cookie / viewer 只读边界（admin 动作 403、用户配置总览 403）/ `settingsSetOwn` / `settingsGetOwn`（API Key 打码）/ `settingsValidated` / `adminUsersOverview`（4 用户）/ `adminAccountsForbidden`（admin 无 accounts-manage）/ `policyReadable` / 知识分区正负例（viewer 建 team 409、建改删自己 personal 200、admin 改他人 personal 409、admin 建 team 200）/ Vue 登录表单走查 / 六视图渲染 / 主题切换 / 425px `425/425` / 零海外文案 / 登出后 401 |
| 知识分区 CRUD（真实 HTTP） | `knowledge-list` 200（27 条）；`knowledge-get` 详情；`knowledge-create/update/delete` 由 console 注入 `actorUser`、bridge 端 casbin 分区判定；删除=软撤回（state→withdrawn），编辑已确认条目重置 candidate |
| 前端（Vue 3.5.45 + Element Plus 2.14.8） | 本地 vendor 离线可用（不依赖 CDN）；协作视图恢复五张契约卡（组织形态 / Agent 编制 / 怎么派活 / 沉淀与自演进 / 长程执行）；`DOMESTIC_TERMS` 品牌词清洗；管理视图按权限分区渲染；1280 截图布局无重叠错位 |
| R7 登记 | `licenses/casbin-APACHE-2.0.txt`、`licenses/vue-MIT.txt`、`licenses/element-plus-MIT.txt` + `THIRD_PARTY_NOTICES.md` 三段 + `docs/SOURCES.md` 三行 + 合规 G9 + `audit-upstream.ts` 机器校验（含 vendor 版本横幅 `vue v3.5.45` / `Element Plus v2.14.8`）；`clean:true`、7 个上游 submodule 不变 |
| 既有回归不回退 | `tsc`、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 54/54、`loop:smoke` 17/17、`host:pg` 21/21、`audit:upstream clean`、`git diff --check` |
| 如实边界 | 任务发起仍在飞书；验收核可仍在原会话（第二十九轮授权代办除外，留痕见回执 delegation 字段）；默认底座仍 `paperclip`；执行形态默认 `loop`（`.runtime/config.json` 的 step 实验配置已按交付口径回滚）；冒烟账号 smoke-viewer / smoke-admin 已禁用留痕 |

## 9. 第三十一轮实测结果（2026-11-08，③c 记忆写入链四项 + ③d OpenMausBot 五项）

| 项 | 结果 |
|---|---|
| `npm test` | **557 / 557**（第三十轮 540 + `tests/knowledge-writechain.test.ts` 11 例 + `tests/openmaus-12b.test.ts` 6 例） |
| `steps:smoke` | **61/61 `ok:true`**：B21 对外动作发生时 `markOutwardAction` → 崩溃回收 `interrupted` 终态（旧 token 作废、不可再领取）、B21b 显式 `failStep` 同样不自动重跑、B22 无副作用回收 `ready` 可重试、B23 委托树血缘沿 `parentStepId` 跨 run 连通、B24 失败重领 `generation+1` 且旧 token 拒绝 |
| `host:pg` | **24/24 `ok:true`**（原 21 + 3 新）：PG 真跑 `markOutwardAction` 幂等去重（重复登记清单仍 1 条）、interrupted 携带已发动作清单、`lineageOf` 递归 CTE 跨 run 追溯、`generation` 每领 +1；steps 表新列 `parent_step_id` / `generation` / `outward_actions` 幂等迁移 |
| `console:smoke` | **55/55 `ok:true`**（原 49 + 6）：读分区三例（viewer 看不到他人 personal、admin 总览可见、viewer `knowledge-get` 他人 personal 409）、`proposeAnchorsEvidence`（新建条目 evidence≥1）、`knowledgeWikiReadable`（modelCalls=0、无悬空）、`injectedIndexDiscipline`（条目只有 id/pointer/title） |
| 端到端真跑（smoke-admin 身份） | `knowledge-wiki`：27 记录 / 5 跳过 / 17 页 / 150 链接 / 0 悬空 / 17 断言无出处（旧记录如实报缺口）/ bloated true（真实发现）/ modelCalls 0；`dreaming-run` 首跑 24 条建议（17 correct-note + 3 fill-gap + 3 merge-duplicate + 1 prune-page）全部登记、复跑 0 登记 24 跳过（幂等）；修订 `knowledge-system-architecture` 自动挂锚点 → 确认+inject → 注入索引收 1 条（206 字节）；**无证据的旧记录即使人审确认 + inject 也不进索引**（红线联动验证） |
| `guard:smoke` | **22/22 `ok:true`**；golden 基线人审重冻结（humanReview 第 3 条）：基线上次人审停在 P-9（19 项只读白名单），承接 P-12 Vue 重写检查集换代（removed 34 / added 134 键）、P-13 白名单 19→21、本轮 `knowledge-wiki` 21→22；全套回归确认无行为退化后手工更新，新签名 `f17f73f9…`，真跑脚本仍不自动改写 |
| 陈旧断言修复 | `steps:smoke` D3 与 `agents:smoke` C-4 的 `card('长程执行'` / `card('Agent 编制'` 在 P-12 Vue 重写后失配（改查 `<template #header>`）；`loop:smoke` B3 的 `requiresHumanApproval` 在 P-11 重写后移到 `collaboration-loop.ts`（断言跟随真正强制处）——三处均为 P-11/P-12/P-13 轮未跑对应冒烟导致的累积漂移，非行为退化 |
| 既有回归不回退 | `router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`memory:hierarchy` 16/16、`loop:smoke` 18/18、走查 11/11、425px、`atlas:check` 11/11、两个构建、`tsc`、`audit:upstream clean:true`、`git diff --check` |
| 如实边界 | 红线 (c) 全守（不模型判 salience、不自动提升 / 确认、不 TTL 物理删除、不让模型改写 wiki）；升级恒 advisory 不代批；团队包导入只产候选引用不提权；Skill `defaultEnabled` 恒 false 且开启绑内容哈希；全部只借思想零代码引入、7 个上游不变；默认底座仍 `paperclip`、执行形态默认 `loop`；飞书仍是唯一发起入口 |

## 10. 真实 HTTP 冒烟模板（admin token 从 `.runtime/secrets.json` 读，不入库）

```sh
node --import tsx --input-type=module -e "
import { secrets } from 'file:///Users/gong.zhe/Developer/ai-native-collab/src/config.ts';
import http from 'node:http';
const payload = JSON.stringify({ payload: {} });
const req = http.request({ hostname: '127.0.0.1', port: 4180,
  path: '/workspace/memory-replay', method: 'POST',
  headers: { 'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    Authorization: 'Bearer ' + secrets().adminToken } },
  res => { let out = ''; res.on('data', c => out += c);
    res.on('end', () => console.log(res.statusCode, out.slice(0, 600))); });
req.on('error', e => console.log('ERR', e.message)); req.end(payload);
"
```

把 path 换成 `routing-status` / `service-status` / `delivery-status` / `system-status` 可查其它只读状态。改过 `src/server.ts` / `src/v06.ts` / `src/workspaces.ts` 等服务端代码后先 `npm run restart:bridge`。

## 11. 服务端口表

| 端口 | 用途 | 交接状态 | 启动方式 |
|---|---|---|---|
| 3100 | Paperclip 工作台 + 插件宿主 | 运行中 | `npm run up`（冷启动 45s 超时见 `00`） |
| 4180 | Bridge workspace action | 运行中 | `npm run restart:bridge` |
| 4190 | Apple Vision 本机端点 | **运行中**（第二十九轮用户拍板「全部搞定」后重启并纳管） | `npm run services start vision`（统一入口 `scripts/services.ts`） |
| 4192 | 验收报告 / 总览 | **运行中**（同上） | `npm run services start report` |
| 4194 | 本机 Git 交付台 | **运行中**（同上） | `npm run services start delivery` |
| 9418 | git daemon | **运行中**（随交付台纳管） | `npm run services start delivery` |
| 5432 | 本机 PG 17 专属库 suitme_collab_c1 | 运行中（用户既有实例） | 不新建服务；只连回环，勿动其它库 |
| 4200（按需） | 自研独立控制台（P-12 起登录制 + casbin RBAC + Vue 前端） | 运行中 | `npm run console`，只绑 127.0.0.1；owner 口令在 `.runtime/console/owner-password.txt`；冒烟用随机端口，跑完即关 |

## 12. 排障速查

| 现象 | 根因 | 处理 |
|---|---|---|
| 走查 11 步全失败、页面 93 字浏览器错误 | 3100 掉线 | 干净环境 `npm run up`，等日志 `Server startup recovery complete` |
| 页面 `connect failed: Connection refused` / 502 | 旧代理环境变量，或宿主重启后插件未重挂 | 干净环境 `restart:bridge` + `install:workspaces`，再跑走查；`00` 坑 7 |
| `npm run up` 报 `did not become ready` | 冷启动 > 45s | 不要重复起；查 `npm run status` 与 health |
| 后台 `build:chinese-shell` 退出 1 | 批量删除保护（391 文件 > 阈值 50） | 前台已授权环境重跑；非代码问题 |
| 白屏但无 JS 异常 | 运行时收敛脚本误隐藏宿主外壳 | 查 `[data-suitme-hidden]`；已有 `bodyTextLen`/`shellHidden` 断言守门 |
| 测试突然失败且涉及时间 | 硬编码绝对时间过期 | 改相对时间（曾修 `at+8h` 时间炸弹） |
| 状态接口全是灰字 / 不刷新 | 硬编码一次性快照 | 走 `service-status` / `routing-status` 实时探测 |
| 真实日志混入测试动作 | `COLLAB_TEST_*` 变量丢了 | 检查 `scripts/test.ts` 的 env 注入 |
| `memory:journey` 报「知识空间不存在」 | `view.spaces` 是数组，被 `Object.entries` 当字典读成索引 | 脚本已改为 `Array.isArray` 分支 |
| `v06-l2-extract` 报「边指向不存在的节点」 | `memory-index` 先自动抽过一次，任务级镜像未带入全局已有节点 | `buildTaskGraphMirror()` 补齐，见 `tests/l2-extraction.test.ts` |
| 真实日志出现 `danglingCausedBy` | `reviewSource` 用评审前 revision，确认事件被幂等去重 | 已改用 `reviewedRevision`；历史行不物理删除，重放如实记录 |

## 13. 提交前检查（每轮都做）

```sh
git status --short
git add -A
git diff --cached --name-only | grep -E '\.runtime/|ui/dist|dist/ui'   # 应为空
git diff --cached | grep -niE 'api[_-]?key|secret|token|open[_-]?id|private[_-]?note'  # 应为空（另按项目规则核真实姓名）
git diff --cached --check
git commit -m "..." && git push origin main
```

若 `git push` 报 `HTTP2 framing layer` / `CONNECT tunnel 502`，是环境代理瞬断；网络恢复后**只重试 push，不要重复 commit**。
