# 03 · 全部工作记录（22 轮 + 基础建设期）

> 权威逐轮记录：`docs/VALIDATION.md`（验证）与 `docs/ADAPTATION-v0.6.md`（边界声明，**最新边界以 `0.00000000000000000000000` 节为准**）。
> 完整提交历史以 `git log --oneline | wc -l` 与 `git rev-parse HEAD` 为准（交接时 `HEAD = b58631c`，其后已多次前进）。下表按时间线归纳，`提交` 列可直接 `git show <hash>`。

## 0. 基础建设期（前 21 个提交，早于分轮记录）

`36ac556` → `2db4307`：把 Paperclip + Cognee + 服务 Agent 网络 + 持久团队记忆接成中文工作台；补齐人工验收回写飞书、交接释放原生审阅指派、通知幂等键、确切工作稿版本、知识字典、个人 Agent 服务、运行证据与目标变更分离。**这一期确立了「任务真源在 Paperclip、SQLite 只做去重与投影」的边界**，后续从未推翻。

## 1. 分轮记录

| 轮次 | 提交 | 用户要求与主要改动 | 验证 / 当轮边界 |
|---|---|---|---|
| 底座 | `f27a0e1` | 收口 Agent 服务网络改造，落地 v0.6 协作底座 | 六层模型与 FR 分层起点 |
| 功能补全 | `7791c7b`、`e9121e7` | 按 PRD 补全功能层；文档标注提交号 | — |
| P3 前端 | `c512c7b` | 中文工作台前端增补、执行链路观测接入 | — |
| 第四轮 | `255a5e9` | L2 组织图自动抽取、P3 后半段、独立视觉评审链 | 确定性抽取 `modelCalls=0` |
| 第五轮 | `78201c6` | v0.6 收尾：真实一单、本机视觉评审、Acceptance 引入 | 历史轮次：当时 Cognee 原生管线关闭 |
| 第六轮 | `285b97c` | 中文用户指令、按清单确认验收、飞书组织草案、本机验收报告 | 修 2 个测试失败（只读白名单、9→10 段断言） |
| 第七轮 | `7f33dd9` | 恢复本机 `independent` 视觉评审链，新增只读成果总览页 `/overview` | Apple Vision 真跑识别 80 段文字 |
| 第八轮 | `c69e414` | 组织 owner 核对后导入映射（3 人、排除 2 名离职）、国内前端深度适配、本机 Git 交付替换 GitHub 主链路 | 266/266；未接通服务不放空入口 |
| 第九轮 | `5ff52b5`、`d73b0c5` | 全量功能体检；「国内服务」改实时探测；修中文壳构建不幂等、测试时间炸弹、带公司前缀侧栏漏收敛、轮询失败骚扰 | 278/278、走查 11/11 |
| 第十轮 | `703189f` | 前端分层重构（527 行→5 行入口）、产品与业务架构梳理、修宿主外壳白屏 | 283/283；白屏根因是运行时脚本隐藏 `div.contents` |
| 方案文档 | `00ec48e` | `ARCHITECTURE-OPTIONS-v0.7.md`：主流记忆架构、auto-ontology 校正、三方案与许可证边界 | 仅文档，未改运行代码 |
| 方案 A | `c5fee0d` | 统一架构契约 `architecture-contracts.ts`、FR 覆盖口径、锁文件文档漂移修正 | 288/288 |
| 第十一轮 | `85c03b2` | 用户拍板：允许外部模型 API 并打开 Cognee 原生管线；本机自动合并/自动发布放开（验收仍由人）；统一改写红线文档 | 294/294；`cognify` 真实调用仍未发生 |
| 第十二轮 | `749e357` | `RoutingDecision` 五维契约 + 5 派活点写同一份 Trace、B 阶段契约复用、LobeHub 三层可执行判断、`HostPlatformPort` 与非 Paperclip 最小宿主 | 303/303；默认底座仍是 Paperclip |
| 第十三轮 | `b58631c` | **方案 B1**：append-only 记忆事件主干、四类投影重放、撤权 lineage 阻断、8 处双写、Context Pack 运行时过滤、路由契约桥接 | **315/315**、走查 11/11；B2 待做 |
| 第十四轮 | `8d3c455` | **方案 B2 收尾**：投影召回接入 `TeamMemory.search` 融合排序（权限重评之后才裁剪白名单）、`grant-revoked` 按 principal 精确过滤、真实一单跑完整知识事件链与端到端撤权、checkpoint + 增量应用（checksum 与全量逐字节对照）；修真实链路暴露的「任务级组织图镜像悬空边」与「`reviewSource` 用评审前 revision 造成真实悬空 lineage」两处缺陷，并给 `memory:journey` 加 `lineageComplete` 验收条件 | **329/329**、走查 11/11、`memory:journey ok:true`（四类投影 1/2/1/1 → 0/0/0/0、召回 1→0、本次资料悬空 lineage 0）、真实日志 `memory:checkpoint checksumEqual:true`；B 阶段验收通过，C 仍排队待拍板 |
| 第十五轮 | 本轮提交 | **方案 C 启动（C-0）**：用户拍板 **② 独立前端应用**，废弃 `PRD §10A` 的 S5/S6、保留 S1–S4 与飞书唯一入口；产品思路复盘（LobeHub 三层 = 组织维度、腾讯 Siboot 上下文论 = 信息维度；**三层 = 同一份共享现场的三种座位，不靠摘要转发**）；建立 C-0~C-5 分步任务清单 | **仅文档与任务清单，未改运行代码**；运行基线仍 329/329、走查 11/11；默认底座仍 `paperclip`，三层判断仍 `recommended=false`（5/7） |
| 第十五轮补遗 | 同轮后一提交 | **C-0b 产品约束固化**：用户确认配置粒度（业务域 / 组织单元生效、允许一个 Agent 兼任多职责、禁止同一 Task 自派自验自环）并追加「组织形态可配置 + 沉淀自演进」；核对赛博禅心 LobeHub 同篇后半段（Acceptance / Agent Vent / L1–L5 / harness 成本）与现有代码地基；新增 `PRD §10C` 的 C-P1~C-P5、ADAPTATION 最新边界第 6 小节、ROUTING-AND-HOST 6.1；C 清单扩为 C-0~C-6 + 收尾，C-3/4/5 验收口径改写 | **仅文档与任务清单，未改运行代码**；manifest JSON 解析、`git diff --check`、敏感扫描；运行基线沿用第十四轮 329/329、走查 11/11（C-1 起每次代码改动重跑全套） |
| 第十六轮 | 本轮提交 | **方案 C-1：本机 PG 真跑与长程执行地基**：用户允许本机引入 PostgreSQL，并要求把 Agent 的循环 / 会话状态 / 执行环境拆开、每一步单独调用、步间靠队列推进；新增 `src/pg-host.ts`（事务 / ACL / 成本账本 / heartbeat `checkout-retry-runToken` / `SKIP LOCKED` 步进队列 / 崩溃恢复 / 状态外置）、`config.host.provider=local-pg` 与 `resolvePlatform` 接线、`npm run host:pg` 21 项真跑、`pg@8.23.1` 走 R7 协议登记；PRD 新增 C-P6，ADAPTATION 撤回「不引入 PG」的旧判断；另把「Paperclip 去留」登记为 `08` 第 10 项待拍板 | **335/335**、tsc、两构建、425px 响应式、走查 11/11、`host:pg` **21/21 ok:true**、`audit:upstream clean`；边界：未引 Redis、未部署远端工具沙箱、未切换默认底座、未改上游 |
| 第十七轮 | 本轮提交 | **方案 C-2：国内适配 + 自研独立控制台**：用户要求把 Paperclip 的国外元素做彻底国内适配、前端参考 LobeHub 样式与功能；中文壳词典扩到 344 条并覆盖上游残留英文、移动桌面标题中文化、服务清单移除海外一等入口、工作台面板品牌与命令词全量中文化；新增 `console/`（六视图 / 明暗主题 / 425px / 统一中文语言层）、`scripts/console-server.ts`（回环 + 13 项只读白名单 + 密钥不出服务端）、`console:smoke` 真跑、14 例静态契约；核实 `@lobehub/ui` 为 MIT 但 v6 强绑 React 19，**不引入组件库、只借设计语言自研** | **362/362**、tsc、两构建、425px 响应式、走查 11/11、`console:smoke ok:true`（6/6 视图、写动作 403、零海外文案）、`host:pg` 21/21、`audit:upstream clean`；边界：默认底座仍 `paperclip`、旧工作台保留可回退、控制台非服务不常驻、飞书仍是唯一发起入口 |
| 第十八轮 | 本轮提交 | **方案 C-3：单一 Router 与可配置组织形态**：按已拍板分步清单推进 C-3；新增 `src/router.ts`（`planRoute()` 纯函数 + `Router` 唯一写入口 + 配置 revision 快照 + `planCoverage()`）、`config.router`（legacy / flat / layered + 按业务域 domains）；五个派活点共 9 处改为 `getRouter().route()`，服务端 `configureRouter(config.router)` 装配；`routing-status` 与控制台「协作」视图可见当前组织形态；p6 改为按 Trace 证据判定，新增 p8 防跳级闸门（C-3 真跑发现合成数据可凑齐旧 P3/P4）；`router:smoke` 隔离真跑、11 例 Router 契约 + 2 例控制台契约 | **362/362**、tsc、两构建、425px 响应式、走查 11/11、`router:smoke` **31/31 ok:true**、`console:smoke ok:true`、`host:pg` 21/21、`routing:status allWired:true`、`audit:upstream clean`；边界（当时）：C-4/C-5/C-6 未做，均已在后续轮次完成、默认底座仍 `paperclip`、历史路由决策不回溯、飞书仍是唯一发起入口、未引入新上游 |

| 第十九轮 | 本轮提交 | **方案 C-4：组织级 Agent 编制、验收协作与 A2A 在岗交接**：用户说「请继续完成未完成的任务」，按已拍板分步清单推进 C-4；新增 `src/agent-registry.ts`（Agent 实例 / 可扩展职责槽位 / 生效范围 / 内容哈希版本 / `registryRevision` 快照 / `resolveAssignment` / `handoffEnvelope` / `reviewCrew` / 单例）、`config.agentRegistry`（默认空编制）；`planRoute` 第 3 参数显式装配后校验主管在岗 / 职责 / 范围，未传与 C-3 逐字等价；`server.ts` 装配注册表并把真实 `onDuty()` 传给 p8；`service-network` 的 A2A `route/start` 加在岗校验与 `handoff:` 留痕；`v06` 新增 `agent-registry-view` / `acceptance-crew` 只读动作、`org-overview` 扩为 11 段；控制台「协作」视图新增中文「Agent 编制」卡片；`agents:smoke` 隔离真跑 43/43、14 例注册表契约 + 2 例控制台契约 | **378/378**、tsc、两构建、425px 响应式、走查 11/11、`router:smoke` 31/31、`agents:smoke` **43/43 ok:true**、`console:smoke ok:true` 19 项、`host:pg` 21/21、`routing:status allWired:true`、`audit:upstream clean`；边界（当时）：C-5/C-6 未做，均已在后续轮次完成、默认底座仍 `paperclip`、默认空编制故 p8 仍 false、飞书仍是唯一发起入口、未引入新上游 |
| 第二十轮 | 本轮提交 | **方案 C-5：按当前配置重跑三层评估、两种形态各跑真实一单**：用户说「请继续完成未完成的任务」，按已拍板分步清单推进 C-5；`src/three-tier-assessment.ts` 新增 `shapeOptions(router, registry)`，P3 / P4 由固定三层口径改为按当前 `config.router.mode` 判定（扁平看「直达派活」不要求主管；分层要求派活方同时是配置登记且真实在岗的 supervisor Agent）；新增 `shape.ready` 与 `recommended` 分离，`recommended` 只表示当前分层配置可正式启用三层；`server.ts` / `routing-status.ts` 共用 shapeOptions，控制台「组织形态」卡加中文白话结论；新增 `scripts/shapes-smoke.ts`（扁平 / 分层各跑一单五阶段，每步可回放）与 `tests/shape-assessment.test.ts` 10 例契约 | **388/388**、tsc、`shapes:smoke` **36/36 ok:true**（扁平 `shape.ready=true / recommended=false`、分层 `true / true`）、`router:smoke` 31/31、`agents:smoke` 43/43、`console:smoke ok:true`、真实服务端 `routing-status` 200 且 CLI/HTTP 口径一致；边界（当时）：C-6 未做，已在第二十一轮完成、默认底座仍 `paperclip`、默认扁平且真实日志含改造前决策故 p6 仍 false（历史不回溯）、飞书仍是唯一发起入口、未引入新上游 |

## 2. 反复出现的排障模式（接手者可直接复用）

1. **走查 11 步全失败** → 先看服务：3100 是否掉线、4180 是否继承失效代理。用干净环境 `npm run up` + `npm run restart:bridge` 恢复，不要当成代码回退。
2. **白屏但零 JS 异常** → 查 `[data-suitme-hidden]` 与 computed display，别只盯 console。
3. **测试「昨天绿今天挂」** → 查硬编码绝对时间（曾修 `2026-11-06T08:00:00.000Z` + 8h 授权过期的时间炸弹）。
4. **构建第二次必失败** → 上游 `closeBundle` 就地改写 `dist/sw.js` 占位符；构建前从 `public/sw.js` 恢复。
5. **状态是硬编码快照** → 「国内服务」曾只探测交付台、其余灰字，改为 `service-status` 实时探测 + 自动刷新。
6. **真实 HTTP 冒烟比单测更能抓语义冲突**：第十二/十三轮分别抓到路由 `causedBy` 语义冲突与投影/召回双层计数问题。
7. **真实业务链路才暴露的结构缺陷**：第十四轮 `memory:journey` 抓到 `view.spaces` 是数组被当字典读、以及任务级组织图镜像未带入「全局已有节点」导致 `validateOrgGraph` 报悬空边；`memory-index` 会自动先跑一次 L2 抽取，手工再抽时不能假设任务图已有全部节点。修法 `buildTaskGraphMirror()`。

## 3. 用户明确做过的决策（不要擅自反转）

| 决策 | 内容 |
|---|---|
| 前端国内适配 | 「收敛＋中文化＋国内清单」+ 深度改造 + **没连接不要放空入口** |
| 组织成员映射 | 「2 名成员已不在组织内，其他都可以复用」→ 导入 3 人、排除 2 人 |
| 阶段顺序 | **A → B → C，不并行** |
| 模型后端 | **允许外部 OpenAI-compatible 模型 API**，打开 Cognee 原生 LLM/embedding/cognify（隐私边界已变更） |
| 发布 | **本机自动合并与自动发布都放开**，真人业务验收仍是红线 |
| 平台底座 | Paperclip 底座与 Plugin SDK **不再作为长期依赖**（但当前仍默认启用，见 `08`） |
| 开源复用 | 可复用尽量复用、可参考尽量参考；LobeHub 不复制代码，Super Agent / Autoloop 可直接复用 |
| 服务 | 主动取消 4190 / 4192 / 4194 / 9418，**不得重启** |

> 第二十一轮 C-6 补记（表格行插入位置见下方追加行；旧轮次数字按当时实测保留）。

| 第二十一轮 | 本轮提交 | **方案 C-6：沉淀回流与自演进闭环**：用户说「继续吧」，按严格分步清单推进 C-6；新增 `src/evolution-ledger.ts`（独立 append-only 治理台账、7 类事件、`modelCalls=0`、状态机守门、两次重放一致）与 `src/evolution.ts`(`standardsRevision()` / `evaluateSelfCheck()` / `assertDeliverySelfCheck()` 接在 `Controller.publish()` 之前、`engineeringGate()` 复用 `memoryReplayReport()`、`aggregateEffects()` / `compareEffects()` 四项指标、`EvolutionService` 统一编排)；`config.evolution` 默认强制自查闸门；`server.ts` / `v06.ts` / `console-server.ts` / `console/app.js` 接线，真实 HTTP `v06-evolution-view` 200、控制台写动作 403；`scripts/evolution-smoke.ts` 隔离真跑 45/45、`tests/evolution.test.ts` 12 例 | **400/400**、tsc、两构建、425px、走查 11/11、`evolution:smoke` **45/45 ok:true**、`shapes:smoke` 36/36、`router:smoke` 31/31、`agents:smoke` 43/43、`console:smoke ok:true`(6 卡片 / errorCards:0)、`host:pg` 21/21、`audit:upstream clean`、`git diff --check`；边界：默认底座仍 `paperclip`、真实业务单未触发阻断交付、`runner.ts` 常驻 while 未切单步、飞书仍是唯一发起入口、未引入新上游 |

| 第二十二轮 | 本轮提交 | **生产项 P-1：长程循环单步化**：用户说「继续吧」，C 分步清单已收口，按 `06` 第 5 节剩余生产项只推进 P-1；新增 `src/step-execution.ts`（`StepQueue` / `InMemoryStepQueue` / `PgStepQueue` / `executeOneStep()` / `defaultStepRecheck()` / `driveSteppedLoop()` / `stepExecutionSummary()` / `executionView()`）、`src/loop-pump.ts`（`driveLegacyLoop()` 逐字等价 + `driveSteppedPump()`）、`src/step-runner.ts`（`npm run step:once` 一次进程一步）；`config.execution.mode` 默认 `loop`、`step` 必须配 `local-pg`；`runner.ts` / `assistant-runner.ts` 常驻 `while` 移除并按配置分派；`v06` / `server` / `console` 加只读 `execution-view` 与中文「长程执行」卡片；`scripts/steps-smoke.ts` 真跑 40/40、`tests/step-execution.test.ts` 13 例 | **413/413**、tsc、两构建、425px、走查 11/11、`steps:smoke` **40/40 ok:true**（隔离队列 + 本机 PG 专属库 + 真实子进程跨进程接力）、`evolution:smoke` 45/45、`shapes:smoke` 36/36、`router:smoke` 31/31、`agents:smoke` 43/43、`console:smoke ok:true`（7 卡片 / errorCards:0）、`host:pg` 21/21、`audit:upstream clean`、`git diff --check`；边界：默认仍 `loop` 且底座仍 `paperclip`、真实业务单未在 step 模式跑过、无外部模型调用、worker 内部子调用未逐次拆分、远端沙箱 / 金额成本账本未落地、飞书仍是唯一发起入口、未引入新上游 |

| 第二十三轮 | 本轮提交 | **生产项 P-5：控制台只读快照服务端分页 / 裁剪**：用户给出仓库路径说「继续完成」，按 `06` 第 5 节剩余生产项只推进不需要外部凭据 / 真人拍板的纯工程项；新增 `src/workspace-summary.ts`（分页参数夹取、身份过滤、确定性纯函数、字段白名单）与 `tests/workspace-summary.test.ts` 9 例；`server.ts` 新增只读 `view-summary`（宿主标题并发取、单条超时降级），`members.ts` / `console-server.ts` 白名单同步；`console/app.js` 四处改用摘要，`tests/console-shell.test.ts` 补 2 例，`scripts/console-smoke.mjs` 补 4 项真跑检查；原 `view` 逐字保留 | **424/424**、tsc、两构建、425px、走查 11/11、`console:smoke ok:true`（4 项新检查，旧 `/api/view` 仍 200 / 10 条真实任务）、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 40/40、`host:pg` 21/21、`audit:upstream clean`、`git diff --check`；真实 HTTP：`view` 509,283 bytes / 4.02 秒 → `view-summary` 5,678 bytes / 0.076 秒（`limit=2` 1,078 bytes / 0.019 秒）；环境：3100 / 4180 失效文件代理导致静态页 500 与进程崩溃，按既定流程干净重启并重挂插件后恢复；边界：摘要不承载正文 / 授权 / 验收、只读白名单 16 → 17、默认底座仍 `paperclip`、SUI-129 仍未核可、其余生产项未动 |
