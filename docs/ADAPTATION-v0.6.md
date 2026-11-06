# SuitMe 协作台 · 现有代码适配 v0.6 PRD 方案

> 日期：2026-11-05
> 对象仓库：`/Users/gong.zhe/Developer/ai-native-collab`（`github.com/zhegong-996/suitme-collab`）
> 依据：`docs/ARCHITECTURE-v0.6.md`（产品架构定稿）、`docs/PRD-v0.6.md`、Codex 会话「研究 AI Native 协作平台融合」、本仓库 `README.md` / `docs/*` / `sources.lock.json` / `src/*` / `git status`
> 立场：**以 PRD v0.6 为准绳，代码适配产品**。已有实现尽量保留，以「补层」为主，不推倒重来；工程红线见 `PRD-v0.6.md` 第 2.2 节。
> 状态：**方案已执行九轮**（底座 `f27a0e1`、功能补全 `7791c7b`、P3 前端增补 `c512c7b`、第四轮 L2 抽取 / P3 后半段 / 独立评审链 `255a5e9`、第五轮收尾 `78201c6`、第六轮 `285b97c`、第七轮 `7f33dd9`、第八轮 `c69e414`；第九轮见 0.0000000000 节）。文档按轮次保留历史记录，**最新边界声明以 0.0000000000 节为准**。

---

## 0.0000000000 全量功能体检与国内服务状态真实性（2026-11-07 · 第九轮）

白话说：第八轮的「国内服务」页守住了「没连接不放空入口」，但状态多半是写死的一次性快照，用户按提示启动服务后不刷新页面也看不到入口；全套回归还暴露了两个硬故障。本轮做的是**把状态变成真实探测**、把体验补齐，并修掉体检中发现的假状态与旧文案。

- **两个硬故障**：中文壳重复构建必失败（上游 `closeBundle` 就地 stamp 了 `dist/sw.js`，占位符消失），构建前从 `public/sw.js` 恢复后连续两次成功；`tests/v06-services.test.ts` 固定 `at` 导致授权 8 小时后必然过期，改为相对当前时间。
- **数据驱动的服务清单**：新增 `src/service-status.ts` 与 `service-status` 只读 action，并发实时探测 3100 / 4190 / 4192 / 4194，逐项标注状态来源；接通后自动出现入口，未接通项给原因与可照做的接通步骤，仍无任何空壳链接。交付台健康响应增加服务身份校验；Paperclip 的 SPA HTML `/health` 按「200 + `<html`」判定在线。
- **体验与诚实性**：前端自动 / 手动刷新、加载态与独立错误态；设置页两个读分别降级、保存失败就地提示；`system-status` 的 `vectorSearch` / `automaticExtraction` / `visionReviewer` 从配置派生，界面不再宣称「向量检索未接入」或「视觉模型核对截图内容」；清掉残留的 GitHub / PR 文案，外链加协议白名单。
- **截图复核补修**：宿主侧栏 `/SUI/skills` `/SUI/apps` 带公司前缀，原运行时路由正则漏匹配，已改为覆盖前缀并同时隐藏 `li` 容器，走查加禁用缓存与 `hostNavHidden` 断言；自动轮询瞬时失败改为静默保留旧数据、只在状态行标注，手动刷新失败才提示。
- **验证**：`npm test` **278/278**、`tsc`、`build:workspaces`、中文壳连续两次构建、`test:responsive`、`audit:upstream`、`git diff --check` 全绿；`test:walkthrough` **11/11**，真实浏览器测得国内服务页 12 行、仅 2 个 loopback 链接、0 个坏链接、侧栏两个未接通入口已隐藏。真实 HTTP 冒烟三个状态接口均 200。详见 `docs/VALIDATION.md` 第九轮。

### 最新边界声明（以本节为准）

- **已发生**：服务清单改为实时探测并可自动刷新；构建幂等与时间炸弹修复；状态字段与界面文案不再与配置矛盾；新增 12 例状态层测试与 1 个浏览器走查步骤。
- **未发生**：真人在真实业务单上「确认验收」（SUI-129 未核可）；部门 scope 本人在飞书确认；企业微信 / 腾讯文档 / 钉钉 / 国内代码托管 / 公有云 CI / 海外 SaaS 的实际连接；生产发布、真实外部 PR / CI、真人多租户、Cognee 原生模型管线、`lobehub/acceptance` CLI 与云端服务；4190 / 4192 保持用户取消时的停机状态。
- **红线不变**：合并审批 ≠ 业务验收；未接通服务一律不提供入口；真实姓名、`open_id`、密钥与业务正文只在 `.runtime`；上游源码不改。

---

## 0.000000000 组织映射落地、国内前端适配与本机代码交付（2026-11-06 · 第八轮）

白话说：上一轮把「组织表怎么导入」做成了能力，但还没真的导入；前端还留着 Paperclip 自带的海外入口，用户看到的「GitHub 交付」在国内环境也用不上。本轮把这三件都收口，**并且明确：没连接的服务不放可点空壳入口**。

- **组织 owner 核对并导入**：owner 确认 2 名成员已不在组织内，只导入其余 3 人（真实姓名与标识只在 `.runtime`）；owner 决策持久化到 `.runtime/v06/org-owner-decisions.json`，预览自动排除，避免历史会话成员反复回来。修掉「只带 2 个新 scope 会清空现有 162 个 scope」的危险授权命令，新增 `npm run org:auth`；修掉 `restart:bridge` 在禁用 `ps` 的沙箱里无法工作的问题。实测注册表版本 2、成员 3、`applied` 有记录。
- **前端国内适配**：构建期收敛侧栏技能库 / 连接服务入口（4 条规则全命中），运行时用同源静态资源隐藏**未连接**的海外集成卡片；中文壳串进 `install:upstream` 与 `up` 保证默认生效；插件设置新增「国内服务」，只给实测接通的服务链接，未接通项只做文字说明。
- **本机代码交付**：`DeliveryAdapter` 抽象 + `src/local-git.ts` 实现，`delivery.provider` 默认 `local`。`npm run delivery:serve` 提供 `git://127.0.0.1:9418`（clone / pull / push）与 `127.0.0.1:4194` 中文交付台（提交、本机 CI、合并审批、通知记录、确切提交预览）；`npm run delivery:demo` 真跑通全流程。GitHub 适配器保留，可显式回退。
- **验证**：`npm test` 266/266、`tsc`、`build:workspaces`、`build:chinese-shell`、`test:walkthrough` 10/10、`test:responsive`、`audit:upstream`、`git diff --check` 全绿。完整记录见 `docs/VALIDATION.md` 第八轮。

### 边界声明（历史记录，最新以 0.0000000000 节为准）

- **已发生**：组织 owner 完成成员核对并导入 3 人（只登记派单候选，不等于真人登录或资料权限）；部门 scope 授权命令已生成但**仍需本人在飞书确认**；本机 Git 交付台真跑通 clone/pull/push、本机 CI、合并审批与预览；前端入口收敛与中文壳默认生效。
- **未发生**：真人在真实业务单上执行「确认验收」（SUI-129 仍未最终核可）；企业微信 / 腾讯文档 / 钉钉 / 国内代码托管平台 / 公有云 CI 的实际连接；生产发布、真实外部 PR / CI、真实员工多租户、飞书进群；Cognee 原生模型管线、L2 在真实新资料上的端到端触发；`lobehub/acceptance` 的 CLI 与云端报告服务。
- **红线不变**：合并审批 ≠ 业务验收；模型与报告只提供证据，不代替原发起人在原会话「确认验收」；真实姓名、`open_id`、密钥与业务正文只在 `.runtime`，不入库、不上传云端；未接通的服务一律不提供入口；上游源码不改，适配全在本项目层。

---

## 0.00000000 本机服务总览与 independent 链路恢复（2026-11-06 · 第七轮）

白话说：第六轮交付完，本机实例的独立评审链因为 `4190` 视觉端点停机而处于半断状态；同时也没有一个地方能一眼看全「服务是否活着、现在走哪条验收链、用户能说什么、证据在哪」。本轮做的是**恢复**与**可见性**，不是新增业务能力。

- **恢复链路**：常驻重启 `npm run vision:start`，用真实的 `LocalModelVisionAdapter.review()` 对工作台截图跑了一次端到端视觉判定（设备端 OCR 识别 80 段文字、判定通过、返回 3 条限制）。端点停机时独立评审会失败而非静默降级，这一点在 README 中写明。
- **一页看全**：`npm run acceptance:serve` 新增只读 `/overview`，用 `node:http` 直连实时探测 3100 / 4180 / 4190 / 4192，展示验收链配置、中文指令、按清单确认验收四步、脱敏组织草案与归档报告入口；组织草案只读取计数与布尔值，真实姓名与 `open_id` 不进页面。
- **验证**：`npm test` 253/253、`tsc --noEmit`、1280 / 425 两档 Chrome 截图无溢出；四个服务实测全部在线。完整记录见 `docs/VALIDATION.md` 第七轮。

**边界不变**：总览页是状态展示，不是验收动作；没有替真人「确认验收」、没有导入组织表、没有新建真实业务任务。`confirmAcceptance` 仍待真人在真实一单上执行，SUI-129 仍未最终核可。

---

## 0.0000000 用户语言层、真实组织映射与本机验收报告（2026-11-06 · 第六轮）

白话说：第五轮把规则、界面和一单真实任务都跑通了，但用户还得记 `/accept` 这种英文命令，组织里「谁属于哪个职能」仍要手填，逐项验收报告只能看 JSON 和 Markdown。本轮补的就是这三件「最后一公里」——**用户在会话里说中文、组织成员从真实通讯录读成草案、验收报告在本机可读可归档**，同时不把任何一步说成「系统替人签了字」。

### 1. 用户看到的不再是协议词

- `src/user-language.ts` 是统一的语言层：建任务 / 查看进度 / 补充说明 / **确认验收** / 验收不通过 / 转交全用中文；`CONFIRM_ACCEPT = '确认验收'` 是报告、界面、通知复用的唯一说法。旧英文斜杠命令仍可解析（保护已跑通的脚本与链路），但**不再出现在帮助文案、README 示例、工作台、验收报告或通知里**，只作为内部兼容语法并写审计 `user.command.legacySyntax`。
- `Controller.ingest()` 改为走 `parseUserCommand()`；闲聊与 @ 仍不建任务，保持「只有明确指令才触发」的红线。
- 顺手修掉两处会让用户踩空的地方：①「任务进度 SUI-1」原会被「任务」前缀抢走当成建单，现由状态别名优先处理；②帮助文案原写「要办的事直接说」，与实现不符，改为明确写明「任务 要办的事」并注明闲聊不建单。③仓库默认 `acceptance.mode=legacy` 时，「确认验收 SUI-1」缺交付提交号会落到英文底层校验错误，现给出可照做的中文指引「确认验收 任务编号 交付提交号」，**CI / 部署版本核对这条红线没有动**。

### 2. 按开工前锁定清单确认验收：真人仍是唯一签字人

- 新增 `Controller.confirmAcceptance()`，与代码交付验收 `accept()` **并列而非替换**：`ingest` 只在「已锁定清单 + `acceptance.mode=independent`」时走它；其余仍走原有的「交付提交 + 发起人核可」。
- 硬闸门一个没省：原发起人身份（`context.requesterUserId`）→ 读回锁定清单 → 读回独立逐项评审报告 → `toAcceptanceCases()` 要求**所有检查项 passed**（有未通过 / 受阻项直接抛错，绝不算作通过）→ `verifyAcceptanceGate()` 复核清单哈希、文档修订、评审者独立性、视觉能力与事件流 → 写 `acceptance` / `decisions` 文档、改 `done`、追加 Trace、发中文通知。回执如实写 `environment: '工作台逐项评审（不是代码部署环境）'`，`decisions` 注明「不代表生产发布、其他功能或后续版本通过」。
- `tests/confirm-acceptance.test.ts` 真跑 Controller：全通过路径的归档 / 状态 / 留痕 / 通知，以及身份不符、无锁定清单、存在未通过项、清单被改写四种拒绝（均断言 `patches` 为空、任务阶段未变）；另用真实 SQLite Store 验证会话里一句「确认验收」端到端路由到该路径，以及 legacy 模式缺提交号时的中文提示。
- **边界**：这是一条已实现且有端到端单测的代码路径，**没有由真人在真实业务单上执行过**；第五轮 SUI-129 仍保持「未最终核可」。仓库默认 `legacy`，本机 `.runtime/config.json` 的 `independent` 不入库。

### 3. 飞书组织映射：读成草案，不自动生效

- `src/feishu-org.ts` + `scripts/org-mapping.ts`（`npm run org:preview` / `org:apply`）：只读当前授权范围可见的真实成员生成草案；`FeishuOrgService` 可注入以便无凭据测试，失败返回结构化草案而不打挂工作台。
- 本机实测 `org:preview` 读到 **5 名真实成员**，部门字段全为空时如实置 `departmentScopeMissing: true` 并给出一次性授权命令，不编造部门；`open_id` 按应用隔离，跨应用绑定必须由管理员按姓名 / 工号显式确认。
- 草案**不参与派单**。`org-mapping-apply` 要求组织级 owner、携带职能注册表当前修订号做乐观校验、职能必须存在且启用、已有主职能不覆盖（保留已派生领域与快照）；导入记录只写本机配置层并记审计。
- 前端「设置 → 组织规则」新增第 10 段「飞书组织映射」只读状态；`v06-org-mapping-view` 不触发外部通讯录读取，避免页面等待远端接口。
- **边界**：草案**未导入**职能注册表（实测 `applied: false`，注册表仍只有 1 名成员）；真实姓名与 `open_id` 只写 `.runtime/`（gitignore，不入库）；**成员映射 ≠ 真人登录 ≠ 多租户**，仍没有第二位真人登录的运行证据。

### 4. 本机验收报告服务：可读、可归档、可回放，但不启动云端

- `src/acceptance-report.ts` + `scripts/acceptance-report.ts` 提供 `acceptance:list` / `acceptance:report` / `acceptance:serve` / `acceptance:self-check`：把 Apache-2.0 的 `result.json` 渲染成中文 HTML（逐项判定 + 证据文件 + 锁定清单 + 自查标准 + 判定限制），索引列出所有归档轮次；报告服务**只监听 `127.0.0.1:4192`**，业务正文、密钥与截图不上传。
- `Controller.runIndependentReview()` 把打回原因经 `recordSelfCheck()` 幂等沉淀为下次自查标准，落 `.runtime/v06/self-check-standards.json`，**不改写已锁定的清单**。
- 工作台「协作 → 验收与责任 → 验收」新增「验收报告与自查标准」只读 Box（`v06-acceptance-report-view`）；`server.ts` / `members.ts` / `V06Services.dispatch` 三处只读白名单同步登记 `acceptance-report-view` 与 `org-mapping-view`。
- **边界**：`lobehub/acceptance` 的 **CLI 与云端报告服务仍未启动**，本机服务只读取已归档结果、不触发任何外部服务；报告与自查标准都只是证据，**不代替原发起人在原会话确认验收**。

### 5. 验证与接线

- 全量回归：`npm test` **252/252**、`tsc --noEmit`、`npm run build:workspaces`、`npm run test:responsive`（1280 / 425 均 0 越界、425 按钮 44px）、`npm run test:walkthrough` **10/10**、`npm run audit:upstream`（7 submodules, `clean: true`）、`git diff --check` 全绿。详见 `docs/VALIDATION.md` 第六轮。
- 真实 bridge 实测：`v06-acceptance-report-view` 返回 `available: true / verdict: pass / 2 cases / 1 归档轮次 / 1 条自查标准`；`v06-org-mapping-view` 返回草案与注册表版本；`v06-org-overview` 十段齐全且 `feishuOrg.ok: true`。本机报告服务 `/health` 返回 `loopback-only`，索引与报告页均含中文边界声明。
- 环境备注：本轮首次跑宿主走查时 9/10 步失败，截图为 `connect failed: Connection refused`；查 `.runtime/logs/` 后确认是**宿主服务继承了已失效的旧代理端口**（本机插件 worker 连 `127.0.0.1:4180` 被旧 `HTTP_PROXY` 劫持），不是前端或 action 回归。以干净的本机连接环境重启 3100 / 4180 后复跑 10/10 通过。

### 边界声明（历史记录，最新以 0.0000000000 节为准）

- **已实现**：中文用户指令与中文帮助 / 报告 / 通知（旧英文命令仅内部兼容）、按锁定清单的确认验收路径与全套闸门（含端到端单测）、飞书真实成员的只读组织草案与人工确认导入通道、本机中文验收报告服务与自查标准沉淀、两个新增只读视图接线、全套回归与宿主走查。
- **仍未实现 / 不得宣称**：真人未在真实业务单上执行最终确认验收；飞书组织草案未导入注册表，真实员工多租户 / 第二位真人登录仍未部署；生产发布、真实 PR 与 CI 交付；**Cognee 原生** LLM / embedding / cognify / 自动实体抽取与向量语义管线；L2 自动抽取在真实新确认资料上的端到端触发（`lastRun` 仍为空）；`lobehub/acceptance` 的 CLI 与云端报告服务（本机服务不替代它们，也不等于上游能力已启用）；把单测或浏览器截图冒充生产验收。
- **可回退**：仓库默认 `acceptance.mode=legacy` 一行回到原交付提交核可流程；只有本机 `.runtime/config.json` 开了 `independent`，该文件不入库。

---

## 0.000000 真实一单、本机视觉模型与收尾（2026-11-06 · 第五轮）

本轮把第四轮列出的「仍未做」逐条做完，并完成 GitHub 推送合并与本地演示。用白话说：之前是「规则写好了、界面有了，但没在真实一单上从头跑到尾，也没有真的看图」；现在这些都在本机真实实例上跑过一遍。

| 第四轮仍未做 | 第五轮落地 |
|---|---|
| 真实视觉语义模型 | macOS Apple Vision 设备端 OCR + 图像分类，只绑定 `127.0.0.1:4190`；`LocalModelVisionAdapter` 只允许本机 http 直连；SUI-129 逐项判定 **2/2 passed** |
| `lobehub/acceptance` submodule | Apache-2.0 `f720feb…` 固定引入；`src/acceptance-interop.ts` + `scripts/export-acceptance.ts` 映射计划 / 报告格式；LICENSE / NOTICES / SOURCES / lock / audit 全部补齐；其 CLI 与云端报告服务未启动 |
| 真实跨职能一单 | 飞书单聊 → Paperclip `SUI-129` → 锁定 2 条验收清单 → Transfer L0 卡片 → Trace 捕获事件 → 本机视觉独立评审 → Acceptance bundle → GitHub issue #1（已关闭） |
| 宿主实例全流程浏览器验收 | `npm run test:walkthrough` 用真实 Chrome CDP 走查 5 tab + 3 个 v0.6 子视图，**10/10 通过**；425px 无溢出、按钮 44px；修掉 worker action 正则与「责任」空态误报 |
| `runtimeGuard.enforce` 开启 | 默认 `true`，注意力预算 / Watchdog 从「只观测」切到实际生效，人工必达通知由 `protectHumanNotifications` 保护 |
| 本地语义检索 | Apple NaturalLanguage 设备端 300 维中英文词向量接入 recall 加权，无需 API Key、无需下载模型、无外部服务；`system-status` 报 `vectorSearch: true` |
| 本地演示 | `.runtime/walkthrough/demo.html` 可交互时间线 + 真实浏览器截图 + 能力全景 + 边界说明，`demo-preview.png` 为渲染预览；均在 `.runtime`，不入库 |

**顺带修掉的真实宿主问题**：`plugins/.../worker.ts` 的 action 正则 `/^[a-z-]+$/` 不允许数字，导致全部 `v06-*` 请求返回 `Invalid workspace action`（新增 `action-name.ts` 统一守卫）；中文句中「。验收：」被旧正则吞掉（`controller.ts` 的 `businessAcceptanceFrom()`）；`LocalModelVisionAdapter` 受 `HTTP_PROXY` 影响报 `fetch failed / bad port`（改 `node:http` 直连）；「责任」视图把「无跨空间授权申请」的正常空态显示成「暂不可用」（`grantCheck` 返回 `null`）；Acceptance bundle 同一证据重复列出（`written` 改 `Set`）；425px 子导航按钮 40.8px（补 `.sm-task-stage button{min-height:44px}`）。

**验证**：最终全量回归见 `docs/VALIDATION.md` 第五轮；`npm test`、`tsc --noEmit`、`npm run build:workspaces`、`npm run test:responsive`、`npm run test:walkthrough`、`npm run audit:upstream`、`git diff --check` 全部通过。

### 第五轮边界声明（历史记录，最新边界以 0.0000000000 节为准）

- **已实现**：开工前锁清单、独立评审（真实本机视觉）、逐项判定、Acceptance 格式导出、Transfer / 责任链、统一 Trace（含缺口如实提示）、L2 组织图确定性抽取与状态视图、runtimeGuard 强制、本机语义加权、三个 v0.6 视图、真实一单与全流程浏览器走查、本地演示、GitHub 推送合并。
- **仍未实现 / 不得宣称**：真实业务最终 `/accept` 未由发起人执行；真实员工多租户与飞书组织映射；生产发布 / 真实 PR 与 CI 交付；**Cognee 原生** LLM / embedding / cognify / 自动实体抽取与向量语义管线（仍关闭）；L2 自动抽取在真实新确认资料上的端到端触发（`lastRun` 仍为空，只有契约与状态验证）；Acceptance 的 CLI 与云端报告服务；把 `.runtime` 截图或单测冒充生产验收。
- **可回退**：仓库默认仍可用 `acceptance.mode=legacy` 一行回到原 `/accept`；只有本机 `.runtime/config.json` 开了 `independent`，该文件不入库。

---

## 0.00000 L2 抽取闭环、P3 后半段与独立评审链（2026-11-06 · 第四轮）

用户澄清：**L2 组织图连 Cognee 自动抽取并不是「不做」，当时只是没有模型可测**。本轮在不启用任何新模型服务的前提下把管线做完整，并按之前给出的两个方向依次完成。

### 1. L2 组织图连 Cognee 自动抽取（FR-06/08/09）

- `src/graph.ts` 新增 `KnowledgeGraph.readProjection()` 与 `CogneeL1Reader`：只走既有 `op=read` 路径读**一个** `sourceId@revision` 的 Cognee 投影，不调用 `project`、cognify、embedding，`modelCalls = 0`；读取前再跑一次跨版本泄漏检查。
- `src/org-extraction.ts` 是完整的抽取管线：`L1Reader → ExtractionAdapter（提案）→ 逐字证据校验 → 本体规则校验 → 稳定 ID 去重 → L2 草稿边`。默认 `DeterministicExtractionAdapter` 从 Cognee 结构化字段、已人审概念与谓词按显式字典生成边，**模型调用 0、无需模型即可测**；`ModelExtractionAdapter` 预留同一提案形状，将来接视觉/语言模型无需改管线。
- 每条草稿边带 `{ sourceId, revision, excerpt }`，摘录必须逐字出现在该 L1 投影里；状态恒为 `draft`，`assertUsable` / `eligibleForContextPack` 仍拒绝它作为依据，**人验收才生效**。重复抽取幂等，绝不重置已验收状态。
- 全局 L2 图存组织级配置（`org-graph:global` / `org-edges:global`），任务文档只是给现有 5 tab 工作台看的镜像；`v06-l2-status` / `l2-edges-view` / `l2-graph-view` / `l2-extract` 已登记，`org-overview` 由 8 段扩到 9 段，「关系与状态」页新增抽取状态块。
- `TeamMemory.index` 投影成功后经 `Workspaces.onSourceIndexed` 自动触发抽取（best-effort、失败只写审计，绝不回滚已验证的 L1 索引）；`config.orgExtraction.autoRunOnIndex` 可关。**L1 按 `sha256(sourceId@revision)` 物理隔离的边界完全未动**。

### 2. P3 后半段：窄屏走查 + 上游适配代码整理

- `scripts/responsive-audit.ts`（`npm run test:responsive`）用本机 Google Chrome headless 渲染**真实插件样式 + v0.6 面板骨架**；因 Chrome headless 最小窗口 500px，改用定宽 iframe `srcdoc` 得到精确 1280 / 425 视口。结果写 `.runtime/responsive-audit.json`。
- 走查实测发现并修复：子导航按钮在 425 只有 41px → 补 `.sm-v06 button{min-height:44px}`；长 JSON 摘要与 6 列表格可能撑出页面 → 补 `min-width:0` / `overflow-wrap:anywhere`，表格改为**在自身容器内横向滚动**（`min-width:620px`）。最终两档均 `scrollWidth == clientWidth`、0 个越界元素、425 按钮 ≥44px，截图存 `.runtime/responsive-425.png`。**这是布局走查，不是宿主实例的全流程浏览器验收**。
- `docs/UPSTREAM-ADAPTERS.md` 把 6 个上游分别对应到「运行时 / 知识引擎 / 业务编排 / 前端插件 / 安装锁定 / 声明审计」六组适配文件；`scripts/audit-upstream.ts`（`npm run audit:upstream`）机器化校验 gitlink vs `sources.lock.json`、上游工作树干净、LICENSE/NOTICE 齐全、声明包含各上游、无强传染协议文本、L2 抽取不含 Cognee 写入调用。结果 `.runtime/upstream-audit.json` 全绿。**未搬迁/删除上游文件、未升级 submodule、未改上游源码**，避免打断已验证构建路径。

### 3. 独立视觉评审 + 开启新验收流程（FR-16~19 / FR-25）

- `src/visual-review.ts` 提供可插拔 `VisualReviewAdapter`：`structural`（默认，确定性、可接收截图/录屏、核对哈希/来源/事件绑定，如实声明 `semanticJudgement: false`）与 `model`（OpenAI 兼容**本机**端点，端点非 localhost 直接拒绝构造，密钥只从环境变量读）。`VisionReviewer` 实现 `IndependentReviewer`，能力为 `vision: true / independent: true`，评审者 ID 与产出模型不同。
- 缺少截图/录屏时**不假装看过图**：降级为「仅依据统一事件流中捕获/导入证据判定」，并把「视觉内容未核验」写进 `limitations`；没有任何可回放证据则逐项 `blocked`，闸门不放行。
- `Controller.runIndependentReview()` 把「锁定清单 → 独立评审 → 逐项报告 → `verifyAcceptanceGate`」串成完整链路；`accept()` 在新流程下缺报告时自动跑一轮（报告只是证据，**最终核可仍是原发起人 `/accept`**）。`/workspace/acceptance-review` 可显式重跑。
- `config.acceptance.mode`：`legacy`（仓库默认，原流程零回归）/ `independent`（开启新流程：`mode` 或旧 `sealPlanOnCreate` 任一打开即生效）。**本机 `.runtime/config.json` 已切到 `independent` + `structural`，重启 bridge 后生效**；把 `mode` 改回 `legacy` 即恢复旧 `/accept`。接真实视觉模型只需把 `visualReviewer.mode` 设为 `model` 并填本机端点。

### 验证

`npm test` **204/204 通过**（新增 16 例：L2 抽取 6、独立评审链 6、响应式/上游静态守卫 4）；`tsc --noEmit`、`npm run build:workspaces`、`npm run test:responsive`、`npm run audit:upstream`、`git diff --check` 全绿。

### 第四轮当时的仍未做（已在 0.000000 节逐条补齐，勿再按本条对外表述）

真实视觉模型的语义判定（当时本机无模型，结构式评审只核验证据绑定）；`lobehub/acceptance` submodule 引入；真实「飞书 + Paperclip + GitHub」跨职能一单；`runtimeGuard.enforce` 开启；宿主实例的完整浏览器流程走查。**保留下来仍然成立的只有两条**：Cognee 原生 LLM/embedding/cognify 与向量语义检索**仍全部关闭**（L2 抽取是确定性投影，不是语义抽取）；上游冗余适配代码本轮只做了清单与边界审计，未做实际重构 / 替换。

---

## 0.0000 P3 前端增补与执行链路接入（2026-11-06 · 第三轮）

按既定顺序进入 P3。**主导航仍为 5 个 tab，未新建独立 app、未改宿主路由、未改上游 Paperclip UI**；三个视图全部长在现有 tab 的二级导航里，符合 PRD 10A 节 S5/S6。

| 现有位置 | 新增视图 | 数据来源 | 用户能看到什么 |
|---|---|---|---|
| 协作 → 任务详情 | 「验收与责任」panel（`v06-panels.tsx` / `GovernancePanel`） | `v06-plan-view`、`v06-round-view`、`v06-review-readiness`、`v06-transfer-view`、`v06-grant-check`、`trace-view` | 开工前锁定的验收清单与原生修订号、逐项判定报告、独立评审未就绪原因、Transfer 授权卡片（含撤销）、跨空间授权状态、统一过程流水（时间 / 事件 / 执行者 / 依据 / 成本 / 证据缺口） |
| 知识 → 新增子 tab | 「关系与状态」（`KnowledgeStatePanel`） | `v06-edges-view`、`v06-context-pack` | L2 组织图每条关系的状态（草稿 / 已验收 / 可复用）、生效与失效时间、证据数，可验收 / 标可复用 / 置失效；Context Pack 一次性投影快照 |
| 设置 → 新增子 tab | 「组织规则」（`OrganizationPanel`） | `v06-org-overview` 一次汇总 8 段 | 职能注册表、Transfer 授权策略、Workspace 政策、注意力预算、Watchdog、独立评审就绪度、默认本体、组织信号；**只读、逐段独立降级、只提示不排名** |

**后端配套**

- `v06.ts` 新增 3 个只读投影：`plan-view` / `round-view` / `org-overview`；`context-pack` 一并登记进 `server.ts` 与 `members.ts` 的 `v06Reads`，避免只读请求被排进写队列。
- 新增 `src/runtime-bridge.ts`：把 FR-22/23/24 的注意力预算与 Watchdog 契约接到**真实执行链路**——`assistant-result`（模型调用）与 `assistant-receipt`（执行回执）每轮产生一条 `v06.runtime-observed` 审计。**默认只观测**：不改通知、回执、租约、恢复或任务状态；`config.runtimeGuard.enforce` 为可开启开关，默认 `false`，开启前必须先跑通真实 journey。仓库既有的合并、自身进度排除、每轮工具上限与会话接续逻辑完全未动。

**三问复核**：会话里由既有 `channels.renderForChannel` + outbox 表达（本轮未改会话文案）；工作台按上表三个位置留痕；签字人仍是原发起人 `/accept`，Transfer 联签与 owner 兜底不变。

**验证**：`npm test` **188/188 通过**（新增 9 个用例，含只读 action 登记与三个视图接线断言）、`tsc --noEmit` 通过、`npm run build:workspaces`（esbuild 打包 + 插件 `tsc --noEmit`）通过。

**当时的仍未做（已在 0.00000 节更新，勿再按本条对外表述）**：前端未在真实浏览器做 1280 / 425 走查；独立视觉评审模型、Acceptance submodule 引入、真实跨职能 journey 仍未完成；L2 组织图未连 Cognee 自动抽取管线（当时误判为「不做」，用户澄清只是没有模型可测，第四轮已补齐）；`runtimeGuard.enforce` 未开启；上游复用代码整理（P3 后半段）未开始；`config.acceptance.sealPlanOnCreate` 仍默认关闭。

---

## 0.000 功能补全（2026-11-06 · 第二轮，已提交 `7791c7b`）

在底座提交 `f27a0e1` 之后，按 PRD 第 5 节把功能补齐到可调用、可测试、可留痕。**前端仍一行未改**；所有新能力经现有 `/workspace/v06-*` action 走「IM 会话 + 插件式工作台」形态，语义对象统一由 `channels.renderForChannel` 渲染，不另起界面。

| FR | 能力 | 落地文件 | 接入方式 |
|---|---|---|---|
| FR-01/02/03/28 | 职能注册表、三层能力模型、粒度自检、配置版本与审计 | `src/roles.ts`、`src/v06-store.ts` | 组织级配置（本地配置层），SQLite 只写审计；变更版本化、历史存职能快照不回溯 |
| FR-11/12/13 | Transfer 授权卡片、双段责任链、标准外置、高风险联签、L0→L2 放宽与自动收紧 | `src/transfer.ts` | 任务级事实写 Paperclip 原生文档；卡片文本经现有 outbox 推送到会话 |
| FR-16/18 | Acceptance Plan 增加 `draftedBy`，可插拔独立评审者 | `src/acceptance-plan.ts`、`src/independent-review.ts` | `Controller.sealAcceptancePlan` 在跨职能任务上强制由目标职能 owner 起草标准；`/accept` 前增加 Transfer 一致性校验 |
| FR-06/07/09/14/26 | 图谱边状态、Context Pack 投影、标签 × 能力双向校验、复用影响面 | `src/knowledge-edges.ts` | L2 组织图层；**L1 按 `sha256(sourceId@revision)` 物理隔离的证据图完全未动** |
| FR-10 | 跨空间申请授权（目标空间 owner 审批、最小可见子集、只读、可撤销） | `src/context-grant.ts` | 复用现有 `access-contract` 思路，补 owner 与期限字段 |
| FR-05/20 | 汇报拓扑开关、验证等级 L1–L4 与不可下调底线 | `src/workspace-policy.ts` | Workspace owner 只能加严；对外 / 资金 / 客户可见强制 L4；事件订阅直通在工程层不可关 |
| FR-21 | 组织状态信号面（只读、只预警、不排名）与次日复测闭环 | `src/organization-signals.ts` | 只读信号 + 聚类 + 建 Task + 复测记录，不产生考核视图 |
| FR-08 | 默认组织本体：16 类节点、五类边、三类查询 | `src/org-ontology.ts` | **L2 组织图**，与 `src/ontology.ts`（Cognee 字典校验）职责分离；节点/边级可达性供 FR-10/26 使用 |
| FR-22/23/24 | 介入叫停、两级注意力过滤、Watchdog | `src/runtime-guard.ts` | 把仓库既有零散规则（自身进度排除、每轮 ≤12 次工具、每委托 ≤2 次复查、ask 释放执行）显式化、可配置、可测；**未替换现有运行时**，无检查点禁止自动重放 |
| 编排 | 统一分派、权限分级、渠道渲染、会话通知 | `src/v06.ts`、`src/server.ts`、`src/members.ts` | 50+ 个 `v06-*` action；组织级配置写操作要求组织 owner；审批以**认证身份**为准 |

**验证**：`npm test` 179 个用例、`tsc --noEmit` 通过。新增 6 个测试文件覆盖规则与端到端链路，含「无职能注册表时不改变原有扁平派单」「Transfer 卡片在纯文本渠道不丢字段」「无 Transfer 时 `/accept` 沿用原发起人核可」「本体边规则与可达性」「Watchdog 无检查点不自动重放」。

**第二轮当时的仍未做（已在 0.000000 节补齐，勿再按本条对外表述）**：
- **前端**：现有 5 tab 工作台未新增视图，只能在 API 层调用；P3 才补界面。
- **独立视觉评审模型**：当前注册的是 `TraceEvidenceReviewer`，只做证据绑定、明确声明 `vision: false` / `externalModelEnabled: false`，`review-readiness` 会如实返回「FR-18 未就绪」；接入视觉模型前**不开启** `config.acceptance.sealPlanOnCreate`。
- **Acceptance submodule 引入**：未引入，仅自研同等契约；引入前按 `OPEN-SOURCE-COMPLIANCE.md` 第 4 节补齐协议材料。
- **图谱接入真实 Cognee 语料图**：边状态目前是产品层 L2 记录，未与 Cognee 的自动抽取管线连通（LLM/embedding 仍关闭）。
- **完整真实 journey**：单测覆盖契约与编排，尚未在真实飞书会话 + Paperclip + GitHub 链路上跑通跨职能一单。
- **接入现有执行链路**：注意力策略 / Watchdog 目前是独立契约与 API，尚未自动挂到 `Assistant` / `Autoloop` 的每轮执行上（保留现有实现不动，避免回归）；介入叫停复用现有 `stopped` / `reconcile` 能力，未替换。

---

## 0.00 底座先行（2026-11-06 · 第一轮，已提交 `f27a0e1`）

用户本轮确认：动的是代码；**先优化底座，再把功能全部补上**；现有已跑通的功能复用、不重写；**现有「IM 会话 + 插件式工作台」就是产品形态本身**，PRD 语义要嫁接到它上面；所有讨论过的开源项目都可作为复用对象，但**协议各不相同，必须逐一说明**。

> 本节是第一轮历史记录，已于 `f27a0e1` 整体提交。第二轮进展见 0.000 节，两处描述以 0.000 节为准。

**已完成**（当时为未提交改动，现已提交）：

| 项 | 文件 | 说明 |
|---|---|---|
| 类型收口 | `tests/event-stream.test.ts` | 修正泛型与枚举三处类型错误 |
| 事件流水真正接线 | `src/trace-bridge.ts`、`src/controller.ts`、`src/server.ts` | best-effort 接入 `receipt / publish / preview / accept / assistant-result`；验收时回填 Paperclip 原生成本账本；新增只读 action `trace-view`。**流水故障只写 audit，不改变任何业务结果** |
| 渠道适配层 | `src/channels.ts` | 渠道无关信封 + adapter 注册表 + 语义对象降级渲染；现有飞书直连不动 |
| 回归测试 | `tests/trace-bridge.test.ts`、`tests/channels.test.ts`、`tests/acceptance-contract.test.ts` | 覆盖 best-effort 不阻断、篡改检测、逐项判定、waived 分支、降级不丢字段 |
| 协议合规 | `docs/OPEN-SOURCE-COMPLIANCE.md`、`THIRD_PARTY_NOTICES.md`、`sources.lock.json` | 三类项目逐项协议与复用边界；补齐 Prime Agent / DeepSeek Harness 的 lock 条目；补 LobeHub Community License 说明 |
| 形态校准 | `docs/PRD-v0.6.md` 第 10A 节 | S1–S6 形态约束 + FR-29~31 |

**当时的仍未做**（现已在 0.000 节补齐大部分）：独立评审模型与视觉输入、Acceptance submodule 引入、Role Registry / Transfer、图谱边状态、汇报拓扑开关、组织信号闭环、**前端任何改动**。新验收流程仍**默认关闭**（`config.acceptance.sealPlanOnCreate = false`），因为独立评审服务未接上，贸然开启会堵死现有发起人 `/accept`。

**顺序不变**：底座（第一轮）→ 功能补全（第二轮）→ 前端增补 → 最后整理上游代码。第 6 节执行清单第 1 步「先收口上一轮 27 个未提交改动」已于 `f27a0e1` 执行完毕。

---

## 0.0 先看这里：产品视角的差异（不含技术术语）

> 本节是给产品/业务阅读的摘要，与第 1 节 C1–C5 一一对应。技术实现以第 1 节为准。

**一句话总纲**：现有代码像一个很靠谱的工单系统——任务能派、能审批、权限收得住、知识能查；v0.6 想做的是「一个组织」。工单系统只回答「这单跑完没有」，组织还要回答三件事：**谁对什么负责、凭什么算做对了、AI 是依据什么做的**。下面五处差异都落在这三个问题上。

用一件具体的事对照：让开发小李帮忙写一份客户方案 PRD。

| | 现在打开系统 | 按 v0.6 改完 |
|---|---|---|
| 验收（C2） | 开工时没写「怎样算做好」；干完由发起人一句 `/accept` 全盘接受，要么全过要么全退 | 开工前把验收清单写死并锁定；干活时每条留证据（这条从哪读的、还是 AI 自己写的）；换一个不是干活的模型逐条判定；人看着逐条报告点通过；哪条没过只退那一条，退回原因沉淀成下次自查清单。签字人不变 |
| 过程证据（C4） | 证据散在执行输出、任务回执、CI 三处；界面显示费用 0，但 `VALIDATION.md` 自己写了「不代表没调用模型」 | 一条完整流水，每一步读了什么、调了什么、花了多少都能回放，成本回填账本。**没有它，上面的逐条验收就没有可信证据源** |
| 成员与责任（C3） | 找小李就是一次 @，系统里没有「他主职能是开发」这条稳定事实，也没有责任转移记录 | 每人有稳定主职能、会随项目变的领域、可选的邻接能力；跨职能派单生成一条授权记录（谁授权、依据什么能力、只管这一个 Task、验收标准由产品职能起草、对外发布要联签）。责任不隐含在一次 @ 里 |
| 知识库（C1） | 知识按「哪份文件的哪个版本」分开存，安全，但跨文件的关系（谁负责过这个客户、这份方案引用了哪版报价）表达不了；旧关系也不会因报价更新而失效 | 关系本身要带状态（AI 猜的 / 已验收 / 可复用）和有效期，只有已验收的关系才能被 Agent 当依据；报价一换，旧关系自动作废。**做法是不动现有那份，旁边加一层新图** |
| 汇报方式（C5） | 明确不做汇报树，谁都能直接找谁 | 扁平还是分层交给每个空间的负责人设；人多了被 @ 爆再切成「只找自己的 Agent，插手要开工单」 |

**差异的性质**（这决定改造量）：

- 只有 **C1** 是「想法真不一样」，且解法是补一层、不推翻现有隔离边界；
- **C2 / C4** 是「少了两个前置步骤」；
- **C3** 是「少了两个记录对象」（职能、授权）；
- **C5** 是「把一个写死的选择改成开关」。

结论：**没有一处要求重写已经跑通的流程**，签字人、任务真源、权限红线、前端都不动；改动集中在「加记录、加前置、加开关」。

---

## 0. 现状基线（开工前必须知道）

### 0.1 代码与运行形态

| 项 | 现状 |
|---|---|
| 仓库 | `suitme-collab`，Node 24.11+ / TypeScript / tsx；Paperclip 0.3.1 提供 3100 工作台，SuitMe bridge 4180 |
| 真源 | Paperclip + PostgreSQL 18.1（54329）存任务/成员/审批/文档/修订/审计；SQLite 只存映射、幂等、接入状态 |
| 上游（开工前基线） | 当时 6 个 Git submodule 固定提交：`paperclip`、`superagent`、`autoloop`、`prime-agent`、`deepseek-harness`、`cognee`；`sources.lock.json` 锁 4 个。现为 **7 个 submodule、lock 锁 7 个**（第五轮新增 `upstream/acceptance`） |
| 多实例 | 主实例 3100 / 4180（本机管理员 `local_trusted`）；另有 3110 / 4181 三模拟成员 `authenticated` 隔离实例 |
| 前端 | 单页插件入口 `/SUI/knowledge-workspaces`，5 个 view tab（我的工作 / 协作 / 知识 / Agent / 设置）；中文由构建期 AST 词典覆盖，深层原生页面仍有未翻译部分 |
| **工作区状态（开工前历史快照）** | 当时 `git status` 有约 27 个已修改文件 + 未跟踪 `docs/AGENT-BUILDING.md`，说明上一轮 Codex 改造尚未收口；该批改动已于 `f27a0e1` 收口提交，**不是当前工作区现状** |

> **第 0 步动作**：P0 开工前先把这批未提交改动提交或明确归属，避免 v0.6 改造与上一轮改动混在同一批 diff 里，无法回滚。

### 0.2 已真实跑通（可直接作为回归基线）

| 证据 | 能力 |
|---|---|
| SUI-4 / PR #2 `4b4b49f` | 真实飞书单聊配对 → 接单 / 提问 / PR / 预览 / 原消息回写 / 发起人 `/accept` |
| SUI-10 / SUI-25 | 原生 API 全流程：审批前拒绝 → 批准后可读 → 跨岗位交接 / 撤权 / 采用（`cross-role-evidence.json`） |
| SUI-19 | 实际浏览器全流程：创建 / 申请 / 授权 / 检查点 / 重授权交接 / 撤权 / 候选 / 版本确认 / 采用 |
| SUI-81 / PR #3 `c6e74db` | 原版 Autoloop worker 真实执行、CI 通过、同 SHA `version.json` 本地预览 |
| SUI-85 / SUI-74 | 「团队 Agent」发起、范围判断、工具检索、工作稿、原版 `ask` 等待释放 |
| SUI-103 / SUI-106 | `@a2a-js/sdk` 1.3.0 真实 HTTP `delegate_service` 子任务回传、父任务自动接续 |
| SUI-123 | 知识 → 检索与记忆 → 交给 Agent 整理关系，8 概念 / 6 关系候选（无人审签名、无自动采用） |
| 自动测试 | 14/14 → 69/69 → 90/90 → 108/108；真实 stdio MCP、并发领取、过期回执、ACL 撤回过滤、确认防篡改 |
| Cognee | 原版 DataPoint / Ladybug / provenance，4 节点 3 关系、模型调用 0、跨进程持久；BM25 中文检索、别名召回 |

### 0.3 明确未启用 / 未完成（不要当成已有能力）

- 外部 / 云端新模型服务、**Cognee 原生**自动实体抽取、embedding / 向量语义检索、LLM `cognify`、自动知识采用、自动最终验收。已接通的 Apple NL 设备端语义加权与 Apple Vision 本机视觉评审**不属于这一条**（均为 macOS 系统框架、只监听 `127.0.0.1`、不外发材料，见 0.000000 节）。
- 完整 Harness `AgentLoop`、动态模块装载器、完整 preset registry、Prime Agent daemon、Autoloop hub、第二套调度器。
- 真实员工登录与飞书组织映射、跨真实员工生产协作、第二位真人登录证据、公网 Agent 发现。
- Claude Code / WorkBuddy / 豆包 / Grok Bot / Cursor 云端自动派单、ACP 远端恢复（均只到接口或人工接单层）。
- **Trace 已在 `trace-view` 可读并作为独立评审证据，但仍如实标注缺口**：SUI-129 的流水明确列出 `kind:model` / `receipt` / `ci` 缺失、tokens 与 costCents 未记录；CLI 用量仍未完整回填 Paperclip 成本账本（`docs/VALIDATION.md` 明确「界面零费用不代表没有发生模型调用」）。
- 无合并试点 PR、无生产部署、无对象存储 / 向量服务 / Redis / SSO；异机恢复与联合备份未验证。

> 边界共识（沿用现有文档）：模拟成员 ≠ 真实员工、本地预览 ≠ 生产部署、CI 通过 ≠ 业务验收、Agent 完成 ≠ 验收。这些在 v0.6 改造后继续成立。

---

## 1. 五处架构差异（必须先解决，否则会改错方向）

### C1 · 图谱：按来源修订物理隔离 vs 全局一份图谱（**真冲突**）

- **现状**：`docs/KNOWLEDGE-ENGINE.md:35` — 图文件按 `sha256(sourceId@revision)` 存 `.runtime/knowledge-graph`，读取前不加载全公司图；旧版图不能冒充新版。隔离保证很强，但跨来源关系无法表达。
- **PRD v0.6 / B4**：全局一份图谱 + 节点/边级可见性标签，用于能力地图、越权可达性、制品 lineage、证据溯源、组织体温传播路径；边带状态与有效期（FR-09）。
- **直接切全局的代价**：丢掉现有「按来源修订物理隔离」这一已验证的安全边界，且撤权/变版后的失效机制要重做。
- **建议双层，不动现状**：
  1. **L1 证据图（保留）**：现有按 `sourceId@revision` 的物理图，存文档 / 字段 / `has_field` / 来源关系，继续作为可验证的证据投影。
  2. **L2 组织图（新增）**：一份全局图，**只存跨来源的组织语义边**（PRD 第 4 节五类边），节点引用 L1 的 `sourceId@revision`；每条边带 `状态（草稿/已验收/可复用）`、`证据引用`、`valid_at / invalid_at`、`可见性标签`。
  3. **查询路径**：先按标签裁剪 L2 子图 → 再回 L1 取原文片段 → 前后双重复查来源版本与访问资格（沿用现有 `docs/KNOWLEDGE-ENGINE.md:36`）。
  4. **授权与撤权**：授权 = 开放 L2 子图可达性 + L1 片段级许可；撤权 = 写 `invalid_at` + 收回片段许可，旧边不再被引用但历史可查。
  5. **时间语义**：借鉴 **Graphiti / Zep 的 `valid_at / invalid_at` 双时间边**处理事实取代（supersession）。Cognee 是「累积型」语料图谱，不自动让旧事实失效，因此**边状态与失效必须由 SuitMe 适配层实现**；不部署 Graphiti 服务（需 Neo4j/FalkorDB），Cognee 官方 `GraphitiSource` 适配器留作未来迁移路径。
- **回滚**：L2 组织图可整体删除，L1 证据图与现有验证记录完全不受影响。

### C2 · 验收：发起人 `/accept` vs 开工前锁计划 + 独立评审（**补前置步骤，不推翻红线**）

- **现状**：验收只能由原任务发起人在原会话操作，`/accept` 表示确认交接包中所有业务验收项；后台核对提交 / CI / 预览 / 两项验收 / 发起人身份（`README.md:79`、`docs/VALIDATION.md:15`）。红线 R3 / R4 明确 Agent 完成 ≠ 验收。
- **PRD FR-16~19**：开工前锁定 Acceptance Plan、证据来源分类、独立评审者（不得是产出模型、需视觉）、逐项判定、部分打回、打回沉淀成标准、人核可。
- **适配判断**：**保留 `/accept` 作为最终人核可**，在它之前插入四步（锁计划 → 证据采集 → 独立评审 → 逐项报告）。这样 R3/R4 完全不破，也不改变「谁签字」。
- **关键区分**：独立评审产出的是**给发起人看的证据与逐项判定**，不是替代发起人核可；跨职能时职能 owner 联签是**追加签字**，同样不替代发起人。写进验收报告，避免产品语义混淆。
- **落地**：
  - Acceptance Plan 存 Paperclip 任务文档的**原生修订** —— 不可篡改特性天然满足「开工前锁定」，改动即产生新版本并作废原计划。
  - 扩展现有 `review` 记录为 Acceptance Round（通过 / 未通过 / 受阻 + 退回原因）。
  - 部分打回复用 Autoloop 原版 `ask` 等待释放机制，在失败那轮保留上下文修正。
  - 引入 `lobehub/acceptance`（Apache-2.0，v2.2.21）作为契约与实现参照；若不引入 submodule，需自研同等五要素并说明理由（PRD Q5）。
- **注意**：现有 `/accept` 是整体通过，没有「部分打回」；打回后不能关闭任务，也不能把未通过项算作通过。

### C3 · 成员：扁平 `AgentServices` + 可配置空间 vs 三层能力 + 职能注册表（**不冲突，缺一层**）

- **现状**：`src/agent-services.ts` 管服务与职责版本；可配置 `domain` 知识空间；`docs/AGENT-SERVICE-NETWORK.md:7` 明确「部门名称和汇报树不决定系统功能模块」；`docs/FEISHU-SOURCES.md:3` 明确「空间是可配置组织方式，不是预设部门」。
- **这是正确之处，必须继承**：Codex 会话里用户拍板「产研/增长/销售/职能不应该是划分好的明确界限或系统中明确的功能模块，应该是配置迭代出来的结果」——与 v0.6 的 D11「产品不预设名单」完全一致。
- **要补的只是三层**：
  1. 新增 **Role Registry**（落 Paperclip 原生私有文档）：职能 ID / 显示名 / owner / 成员 / 版本 / 生效失效时间，四条硬约束（唯一性、owner 齐备、ID 稳定、粒度自检）。
  2. 现有「当前职责版本化」保留为**领域流动**；把 `domain` 从「空间名」提升为可从 Task / Artifact / L2 图谱关系派生的标签，不覆盖主职能。
  3. 新增 **Responsibility Transfer** 与 Transfer Grant Policy，复用现有 `collaboration` 协作合同与 `handoff-assigned` 执行身份更新，补授权人 / 能力依据 / 范围 / 标准起草方 / 联签人 / 批次 ID。
- **不改**：个人 Agent 服务身份与 Codex 等执行引擎分离、职责变更使旧结果停用、成员来自原生登录 —— 三者都与 v0.6 相容。

### C4 · Trace：三套分散证据 vs 统一可回放事件流（**B2，最硬的阻塞**）

- **现状**：证据分散在 Harness `output-retention`、Autoloop 回执（含 CLI 用量）、GitHub CI / `live-journey-evidence.json`（`.runtime`）；成本未回填 Paperclip 成本账本；`docs/VALIDATION.md:42` 已自认不完整。
- **PRD FR-25 / B2**：结构化事件流是 M9 证据链、X2 回放与成本归因、闸门 HITL、独立评审的唯一真相源；缺字段禁止启用 L4 验收。
- **适配判断**：**不换框架**（用户既定「方案集成 + 个性化优化」，现有 Autoloop worker + Harness 组合已跑通真实流程）。在 J 层加一个 **Event Sink**：
  - 归一字段：`taskId / actor / model / tool / token / cost / sourceRef@revision / checkpoint / outcome / evidenceKind(捕获|导入|自撰)`
  - 落点：Paperclip 任务文档或只读事件投影（**不得成为第二业务库**，R1）；成本回填原生成本账本。
  - 三个来源各自保留原产出，Event Sink 只做汇聚与补全，不替代。
- **准入**：先跑一条真实任务（建议沿用 SUI-81 或新建 SUI-xx）验证字段齐全、可从 checkpoint 回放，再启用 FR-16~19；否则 L4 验收的证据链是断的。

### C5 · 汇报拓扑：主动排除 vs 可配置（**从「排除」改为「配置」**）

- 现有明确不把汇报树做成功能模块（这是对的，避免组织写死）；v0.6 D10 要求由 Workspace owner 配置扁平 @ / 分层汇报。
- 适配：新增一个 **Workspace 级配置项**，默认扁平 @；选分层时中途插手走 Task 卡片开工单（LobeHub 的教训）。**事件订阅直通属工程路由，不受该配置影响**（v0.2 已修正，别再混）。切换建议由跨组调用密度、人均被打断次数自动给出。

---

## 2. 逐模块差距对照

> 动作：保留 / 扩展 / 新增 / 替换。「保留」的模块不得因改造回退现有验证。

| v0.6 模块 | 现有实现 | 动作 | 主要文件 | 优先级 |
|---|---|---|---|---|
| A 场域与成员 | Paperclip 项目/成员 + `AgentServices` + 可配置 `domain` | **扩展**：Role Registry、主职能声明、粒度自检 | `src/members.ts`、`src/agent-services.ts`、新增 `src/role-registry.ts` | P0 |
| B 沟通与 @ 委派 | Super-agent 原版归一化/幂等/策略、`/task`、`/reply`、`src/coordination.ts` | **保留 + 扩展**：汇报拓扑配置 | `src/coordination.ts`、`src/commands.ts`、`src/collaboration-intake.ts` | P1 |
| C 上下文中枢 | `src/context.ts`、交接包、`bundle.manifest`、prime-query 权重 | **扩展**：独立 Context Pack 对象、版本/过期、只纳入已验收边 | `src/context.ts`、`src/assistant.ts`、新增 `src/context-pack.ts` | P0 |
| D 交织引擎 | `src/service-network.ts`、A2A `delegate_service`、`src/coordination.ts` | **扩展**：Transfer 生成、联签路由、授权批次 | 新增 `src/transfer.ts`、`src/service-network.ts` | P0 |
| E 制品与工作区 | Paperclip 文档修订、GitHub `src/github.ts`、`src/development.ts`、证据 `src/evidence.ts` | **保留 + 扩展**：制品三态、lineage 反查 | `src/evidence.ts`、`src/development.ts` | P1 |
| F 风险闸门与验收 | 发起人 `/accept`、`review`、CI/预览核对、`platform-evidence.ts` | **重点新增**：Acceptance Plan / Round、独立评审、逐项打回、验证等级策略 | 新增 `src/acceptance-plan.ts`、`src/acceptance-round.ts`、`src/verification-policy.ts` | P0 |
| G 组织状态信号面 | 「需要你决定」面板、`attention` 列表、`src/team-memory.ts` | **新增**：只读指标 + 聚类 → Task → 复测闭环 | 新增 `src/signals.ts`、前端 tab | P2 |
| H 入口与介入 | `plugins/knowledge-workspaces/src/ui`、中文壳 `scripts/build-chinese-shell.ts` | **保留**，P3 再重构弱化区 | `plugins/knowledge-workspaces/src/ui/*`、`locales/` | P3 |
| I 主动性与注意力 | 事件合并、排除自身进度、每轮 ≤12 次工具、每委托 ≤2 次复查 | **扩展**：显式两级过滤 + 注意力预算 + 静默策略 | `src/coordination.ts`、`src/assistant-turn.ts` | P1 |
| J 运行时底座 | Autoloop worker、Harness 装配、`src/native-worker.ts`、会话接续 | **扩展**：Event Sink、checkpoint、Watchdog | 新增 `src/event-stream.ts`、`src/watchdog.ts`、`integrations/deepseek/runtime.ts` | P0 |
| K 知识底座 | Cognee `LadybugAdapter` / DataPoint / provenance / GraphSchema / BM25；`src/graph.ts`、`src/ontology.ts`、`src/knowledge.ts`、`scripts/cognee-graph.py` | **扩展**：L2 组织图、边状态/有效期/可见性标签、统一 ID 与标签 | 新增 `src/org-graph.ts`、`src/edge-state.ts`，扩展 `src/graph.ts` | P0 |
| X1 治理平面 | 原生 ACL、`access-contract`、调用前后复查、`src/workspaces.ts` | **扩展**：空间 owner、子图/片段级授权、双层标签校验、配置审计 | `src/workspaces.ts`、新增 `src/policy.ts` | P0 |
| X2 可观测与成本 | `.runtime` 轨迹、回执 CLI 用量 | **扩展**：Event Sink + 成本回填 | 同 C4 | P0 |
| X3 组织信号 | 无独立模块 | 由 G 消费 | — | P2 |

---

## 3. 开源项目整合：动作清单

| 项目 | 本版动作 | 是否需要改上游 | 许可证动作 |
|---|---|---|---|
| Paperclip / LLM Wiki / Plugin SDK | **保留不动**，所有新对象落原生文档或适配层 | 否 | 已有 |
| DeepSeek Super-agent | 保留；补「订阅直通 ≠ 组织越级」的区分 | 否 | 已有 |
| Agent Autoloop | 保留；回执补 Trace 字段；`ask` 用于部分打回 | 否 | 已有 |
| DeepSeek Harness | 保留；评估启用完整 AgentLoop / checkpoint 作为 B2 准入；output-retention 接入 Event Sink | 否 | 已有 |
| Prime Agent | 保留 `prime-query.ts` 权重策略 | 否 | 已有 |
| Cognee | 保留 L1 证据图与字典；新增 SuitMe 边状态/有效期适配层；LLM/embedding 管线继续关闭 | 否 | 已有 Apache-2.0 声明 |
| Graphiti / Zep | **只借鉴双时间边语义**，不部署服务、不引入代码 | 否 | 无需（未引入） |
| @a2a-js/sdk | 保留；`delegate_service` 补 Transfer 与联签路由 | 否 | 已有 Apache-2.0 声明 |
| **Acceptance（新）** | **建议新增 submodule**，作为 FR-16~19 的契约与实现参照 | 否 | **新增** `THIRD_PARTY_NOTICES.md` 条目 + `licenses/acceptance-APACHE-2.0.txt` + `sources.lock.json` |
| LobeHub | 只作产品参照（三层汇报、L1–L5、注意力预算、Agent Vent 闭环），不引入代码 | 否 | 无需 |
| LightRAG / KAG / OpenHands / Outline / Onyx / OpenFGA | 仅参考，不叠加索引/服务；**Outline BSL 1.1 尤其不得引入代码** | 否 | 无需 |

> 两批来源的分工：现有 submodule 覆盖**工程底座**（任务真源、事件接入、执行适配、图谱存储），本轮新增参照覆盖**产品语义**（证据化验收、职能轴、责任转移、组织信号）。整合不是把项目堆在一起，是让两边各补对方缺的那一层。

---

## 4. 迁移路径

> 顺序按用户最新要求：**集成方案 + 个性化优化 → 功能全部实现 → 再改前端界面与交互 → 最后整理/优化复用过来的上游代码**（Codex 会话 USER 54）。
> 注意：本仓库 `docs/KNOWLEDGE-ENGINE.md:3` 写的是「集成 → 改造界面 → 完整流程验收 → 整理复用代码」，与用户后续表述略有差异；**以用户最新表述为准**，前端重构放在功能闭环验收之后。

### P0 · 契约地基（最先做，且不改前端）

1. 收口当前未提交改动（提交或明确归属），记录 `git status` 基线。
2. **Event Sink（C4 / FR-25 / FR-27）**：归一三套证据、补字段、成本回填；跑一条真实任务验证可回放。
3. **Acceptance Plan 前置（C2 / FR-16~19）**：锁计划 → 证据分类 → 独立评审 → 逐项报告 → 人核可；保留 `/accept` 与 R3/R4；引入 Acceptance 契约。
4. **Role Registry + 三层能力（C3 / FR-01/02）**：不预设名单、四条硬约束、职能快照不回溯。
5. **Transfer（FR-11/12）**：默认 L0，标准外置、双段责任链、高风险联签。
6. **知识底座边状态与双层图（C1 / FR-06/07/09/10）**：L1 不动，新增 L2 组织图；空间 owner 审批、子图/片段级授权、撤权写 `invalid_at`。
7. **回归**：`npm test` / `npm run typecheck` / `npm run doctor` / `npm run test:cross-role`；SUI-4、SUI-10/19/25、SUI-81、SUI-103/106 全流程不得回退。

### P1 · 核心差异化

汇报拓扑配置（C5）、授权档位 L1/L2 与自动收紧、默认图谱本体与 lineage、验证等级策略、介入/注意力/Watchdog、配置变更审计与兼容期双写。每项配一条真实 journey。

### P2 · 可自调节

粒度自检、组织信号面与「信号 → 聚类 → 建 Task → 次日复测」闭环。只读、只预警、不排名、不做情绪推断。

### P3 · 体验与代码整理

中文补全（尤其知识 / 协同 / Agent 三块弱化区）、窄屏走查（1280 / 425）、最后再整理冗余适配与替换不合适的上游界面，保留来源与升级路径。**产品闭环经真人验收后才动复用代码**。

### 验证环境顺序

先在 3110 / 4181 三模拟成员隔离实例验证权限矩阵（不同成员授权、撤权、联签），再回 3100 / 4180 主实例跑真实任务；真实员工登录与飞书组织映射仍属未完成项，不得用模拟成员冒充。

---

## 5. 风险与回滚

| 风险 | 应对 |
|---|---|
| 上一轮未提交改动与本次改造混批 | P0 第 1 步先收口；每个阶段单独提交，保留可回滚点 |
| 切全局图谱破坏已验证的隔离边界 | 采用 C1 双层；L2 可整体删除，L1 不动 |
| 新验收契约与「发起人验收」红线冲突 | 保留 `/accept` 为最终核可，评审只提供证据；联签是追加签字 |
| 上游固定提交升级导致 API 变化 | `sources.lock.json` + gitlink 锁版本；先 `npm run doctor` 再升级，升级单独提交 |
| 新增依赖的许可证与归属 | Acceptance 补声明与 licenses；Outline BSL 1.1 不引入；Cognee 商业版「单 PostgreSQL 图存储」不算已交付 |
| 真实资料外发 | 真实飞书正文不进图处理接口、不提交 GitHub、不向新模型服务发送（沿用 `docs/KNOWLEDGE-ENGINE.md:37` 与会话约定） |
| 功能未定型就改前端 | 前端重构排 P3；P0/P1 期间允许界面「不好看但能用」 |
| 模拟身份被误当成生产验证 | 文档与界面继续标注边界：三虚拟成员 ≠ 真实员工、本地预览 ≠ 生产 |

---

## 6. 给 Codex 的执行清单（可直接照做）

按序执行，每步完成后跑对应验证，不要在一步里同时改多个层：

1. `git status` 收口基线，确认 `docs/AGENT-BUILDING.md` 归属。
2. 新增 `src/event-stream.ts`：定义事件 schema，接收 Harness / Autoloop / GitHub 三路证据；补 `src/assistant-runner.ts`、`src/runner.ts`、`src/github.ts` 的埋点；成本回填原生账本。
3. 新增 `src/acceptance-plan.ts` / `src/acceptance-round.ts` / `src/verification-policy.ts`；扩展 `src/controller.ts` 的 `/accept` 前置流程；**不改发起人身份校验**。
4. 新增 `src/role-registry.ts`；扩展 `src/members.ts`、`src/agent-services.ts`；保留 `domain` 可配置语义。
5. 新增 `src/transfer.ts`；接入 `src/service-network.ts` 的 A2A 委派与 `src/workspaces.ts` 的协作合同。
6. 新增 `src/context-pack.ts`；扩展 `src/context.ts`；只引用已验收边。
7. 新增 `src/org-graph.ts` / `src/edge-state.ts`；扩展 `src/graph.ts` 与 `scripts/cognee-graph.py`；**不改动 L1 物理图隔离逻辑**。
8. 扩展 `src/workspaces.ts` 的 `access-contract`：补空间 owner、子图/片段粒度、`valid_at / invalid_at`、撤销即失效。
9. 新增 `src/policy.ts`：双层标签校验、配置审计、兼容期双写。
10. 补齐 `tests/`（参照现有 `workspaces.test.ts`、`assistant.test.ts`、`agent-services.test.ts`）与 `docs/VALIDATION.md` 记录；每个新增 FR 至少一条真实 journey 证据。
11. 更新 `THIRD_PARTY_NOTICES.md`、`licenses/`、`sources.lock.json`、`docs/SOURCES.md`、`README.md`。
12. P0 全量回归：`npm test` / `npm run typecheck` / `npm run doctor` / `npm run test:cross-role`，并在 3110 隔离实例验证多成员授权与撤权。
13. P1/P2 按第 4 节推进；P3 才动 `plugins/knowledge-workspaces/src/ui/*` 与 `scripts/build-chinese-shell.ts`。
14. 全程不得：修改上游 submodule、合并试点 PR、发布业务仓库、启用新模型服务、把真实正文提交 GitHub、用模拟成员宣称生产验证。

---

## 7. 一句话结论

现有代码把「任务 + 审批 + 权限 + 知识候选」做扎实了，缺的是 v0.6 的**职能轴、责任转移、开工前锁定的验收、以及带状态与时效的组织图谱**；四处补层 + 一条统一 Trace 即可对齐，不需要换框架、不需要推倒 Paperclip 真源、也不需要先把前端重做一遍。最该先做的是 **C4 事件流**——没有它，C2 的证据化验收就没有可信的证据来源。
