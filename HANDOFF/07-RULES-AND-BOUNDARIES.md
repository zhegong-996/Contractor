# 07 · 红线与边界（动手前必读）

## 1. 业务验收红线（最高优先级）

- `Agent 完成 ≠ 业务验收`。报告、独立评审模型判定、CI 通过、合并审批、自动发布**都不替代**最终核可。
- 最终核可只能由**原发起人在原会话**用中文「确认验收 任务编号」完成（`controller.confirmAcceptance` 会校验身份、锁定清单、逐项报告与 Trace）。
- SUI-129 至今未核可；不要为了「让系统看起来完成」而代做或伪造。
- 开工前锁定验收清单、标准由职能 owner 起草、独立评审者不得是产出模型。

## 2. 隐私与仓库边界

- 真实姓名、`open_id`、密钥、业务正文**只落 `.runtime/`**，被 `.gitignore` 忽略。
- 每次提交前做 staged diff 敏感扫描（见 `05` 第 10 节）；确认无 `.runtime` / `ui/dist` / `dist/ui` 入库。
- Cognee 原生管线的凭据只经 `spawn` 进程环境传递，**不写** `.runtime/config.json` / `secrets.json` / 仓库；配置里只存环境变量名。
- 用户 2026-11-07 已明确**允许外部模型 API**：启用后业务材料会发往所配置的外部服务。这是已变更的隐私边界，不要偷偷改回「不外发」口径，也不要在未经确认时把材料发到别处。
- `.runtime/routing/`、`.runtime/memory/` 是 append-only 真实日志；测试动作由 `COLLAB_TEST_TRACE` / `COLLAB_TEST_MEMORY` 隔离，不要往真实日志写演示数据。

## 3. 服务约束

- **4190 / 4192 / 4194 / 9418 是用户主动取消的服务，不得重启**，也不要再打开 4194 页面。
- 只有 3100 / 4180 可以按需恢复，且必须用干净环境（`NO_PROXY` 等）。5432 是用户既有的本机 PostgreSQL 实例，**只连回环、只用专属库 `suitme_collab_c1`**，不得触碰 `geo_flow` 等其它库。
- 本机交付台与 git daemon 当前停机，因此 `delivery:demo` 的 `gitProtocolClonePull: false` 是预期，不是缺陷。

## 4. 上游与许可证

- **不改 `upstream/` 下任何上游源码**；`npm run audit:upstream` 必须 `clean: true`，7 个 submodule 与 `sources.lock.json` / gitlink 一致。
- LobeHub 主仓库（Community License）与 Outline（BSL 1.1）**只借思想，禁止复制代码与衍生分发**；`lobehub/acceptance` 是独立 Apache-2.0，可复用格式/CLI。
- Super Agent、Agent Autoloop、DeepSeek Harness、Prime Agent、Cognee、Paperclip 均为 MIT/Apache-2.0，可复用代码；`src/vendor/prime-query.ts` 必须保留 Mario Zechner 原始 MIT 版权头。
- **LobeHub 只借设计语言**：主仓库 Community License 禁止复制 / fork / 分发衍生作品；`@lobehub/ui` 为 MIT 但 v6 强绑 React 19 + ESM，本轮**未引入**，`console/` 全部自研。未来若要用其组件，必须先走 R7 六步并重新评估运行时约束。
- **独立控制台只开放只读动作**：17 项只读白名单（C-2 13 + C-4 / C-6 / P-1 / P-5 各 1）之外一律 403，密钥不出服务端，无网页发起入口，不新增常驻端口。P-5 新增的 `view-summary` 是 `view` 的裁剪版，同样按当前身份过滤任务，只返回索引字段，不承载工作稿正文 / 授权明细 / 验收判断。
- 引入任何新上游前：先核对许可证原文、登记 `sources.lock.json`、跑 `audit:upstream`；新增 npm 依赖同样走 R7 六步（精确版本、LICENSE 原文至 `licenses/`、NOTICES、lockfile integrity、SOURCES、审计脚本）。`pg@8.23.1` 已按此登记（MIT）。Runner `a42d1331` 是**协议语义移植、TypeScript 重写**，登记在 `sources.lock.json` 的 `protocolReferences` 而非 `sources`，不是 submodule、不是第 8 个上游，不得复制 Rust 源码或取 2026-08-22 ~ 09-22 的 GPL-3.0-only 发布版本。
- **P-8 只读体检红线**：`memory-guard` 与 `src/knowledge-guard.ts` 只能是 `advisory:true / blocking:false / modelCalls:0` 的只读体检，**不得**因缺口拦截交付、改任务状态、放宽授权或替代人签；真实知识记录缺 `evidenceEventIds` 时如实报缺口，**不得编造事件 id 把体检跑绿**。新增只读 action 必须同步 `server.ts` `readOnly` / `members.ts` `reads` / `console-server.ts` `CONSOLE_READ_ACTIONS` 三处白名单。冻结基线 `fixtures/behavior-golden.json` **不得由真跑脚本自动改写**，新增 / 删除 / 改变都须人审并在 `humanReview` 写清时间 / 轮次 / 变化 / 理由 / 审核人；出站 MCP「不暴露」清单（验收确认 / 任务发起 / 越权 / 撤权 / 删除 / 绕过授权）不得放宽。`guard:smoke` 只读，不写真实 B1 / 路由日志。
- **P-7 概念参考红线（Anthropic agent memory）**：`https://www.anthropic.com/research/components-of-agent-memory` 是网页研究文章、无开源代码许可证，只按 `sources.lock.json` 的 `conceptReferences` 登记；**不得复制正文 / 代码、不得伪造 LICENSE 原文、不得混入 `sources` 或变成第 8 个上游**，`audit:upstream` 会机器化校验。`src/memory-hierarchy.ts` 是纯函数守门、不是接入生产链：候选知识仍需真人采用、离线整理只提待复核建议、注入顶层只留索引与指针、主干 append-only 不回溯；不得借这篇文章启用外部模型调用或自动确认知识。
- **P-6 人签红线（移植 Runner 后仍生效）**：`human_response` 只把答案送回提问者，**绝不替代**原发起人在原会话用中文「确认验收 任务编号」；执行进程（`step:once`）只能提出 `human_question`、不得自行放行 `human-gate` 步；真人回答只走本机 `npm run step:answer` 且必须声明 `COLLAB_HUMAN_ACTOR`，不新增网页发起入口；HITL 台账独立于 B1 记忆主干，历史问题与回答不回溯改写。

## 5. 前端与入口红线

- 「**没连接不要放空入口**」：只有 `service-status` 探测 `connected` 且 URL 通过 `safeLoopbackUrl` 才渲染 `<a href>`；未接通项连 `url` 字段都没有，也不放可点按钮。
- 第十五轮用户拍板 ②「改独立前端应用」，**已废弃「5 tab 插件式单页」的硬约束**（C-2 已落地 `console/` 自研外壳，旧插件工作台保留可回退）；**工作台仍不是第二个任务发起入口**，不新增网页发起入口。
- 中文壳只改展示文案，不改路由 / API enum / 业务内容 / 上游源码；构建顺序「先 domesticShell 再 chineseShell」。

## 6. 工程约束

- A → B → C **不并行**；B（B1 + B2）已验收，第十五轮用户拍板 ② 后 **C 已启动**，但 C-0 → C-6 + 收尾必须逐步验收（C-3 / C-4 已完成，下一棒 C-5），**不得跳步或并行**；动手前读 `PRD §10C` 的 C-P1~C-P8（长程执行三者分离、用户可见层国内化）。飞书 IM 仍是唯一发起入口，工作台仍只做授权 / 留痕 / 签字，不新增网页发起入口。
- **组织形态是配置不是骨架**：不得为了把 `assessThreeTier()` 跑绿，逼扁平配置的小团队硬造管理层；P3 / P4 按当前配置判定。**Agent 可提出改进但不能自己让改进生效**：不得自动改写已锁定清单、权限规则、人签红线或历史任务；候选改进须过工程闸门 + 人审 + 版本 + 灰度 + 可回滚。
- 派活 / 状态判断必须走统一 `RoutingDecision` 与同一份 Trace，不要再各写一套；新增只读 action 必须同步 `server.ts` 的 `readOnly` 与 `members.ts` 的 `reads` / `v06Reads`。
- Trace 写入是 advisory：**失败不得改变任务、回执或验收结果**。
- 撤权是状态写入，不是物理删除；`source-revoked` 全局阻断派生记忆，`grant-revoked` 不得放大成全局屏蔽。
- 确定性链路 `modelCalls=0`：设备端 Apple NL 词向量与确定性 L2 抽取不调用模型；`assertDeterministic()` 非零即拒绝，不静默降级。
- 每轮交付：全套回归 + 文档同步（README / SYSTEM-ARCHITECTURE / ADAPTATION 最新边界 / VALIDATION）+ 提交并 push 到 `origin/main`。
- **双向回路是硬要求，但流转自动化 ≠ 决策自动化**：`loopReport()` 必须能判出「未应答上行 / 答完不回流 / 回执无人复核 / 单向推送段」；任何上行提问都要有下行应答，任何回执都要有人侧复核。回执 ≠ 验收、回答 ≠ 放行、续跑建议恒 `autoExecute:false / requiresHumanApproval:true / notAcceptance:true`；不得借「全自动化」把验收 / 授权 / 核可下放给执行端。
- **复用上游可耦合，但不得借耦合放宽边界**：`src/upstream.ts` 运行时加载的是**未修改的上游源码**，新增协议映射只能消费其输出并作 append-only 观察留痕；不得改上游提交、不得引入第 8 个上游 / submodule / gitlink、不得把 `enterprise/` 专有代码或 Rust / Electron 栈复制进来。
