# 交接给下一位 Agent · SuitMe 协作台

> 生成：2026-11-08 10:35（北京时间）｜仓库：`/Users/gong.zhe/Developer/ai-native-collab`
> 远端：`https://github.com/zhegong-996/suitme-collab.git`（`main`）
> 代码基线：**永远以 `git rev-parse HEAD` 为准**，不要相信文档里写死的 hash。本次交接前 `HEAD = origin/main = 834b268`（第二十二轮 P-1）、工作区干净；交接文档提交后 `HEAD` 会前进，仍应与 `origin/main` 一致。
> 本文件是**根目录速览入口**；详细权威交接包在 `HANDOFF/`，项目总结在 `PROJECT-SUMMARY.md`。三者随仓库一起提交推送，clone 即得。

---

## 0. 5 分钟接手

| 顺序 | 做什么 |
|---|---|
| 1 | `git status --short --branch`，确认干净且 `HEAD = origin/main` |
| 2 | 读本文件第 1、2、5、6 节（产品口径、现状、红线、边界） |
| 3 | 读 `HANDOFF/00-START-HERE.md`（环境、端口、8 个已知坑）与 `HANDOFF/06-CURRENT-STATE-AND-NEXT.md`（现状与下一步） |
| 4 | 动手前读 `docs/PRD-v0.6.md` §10C（C-P1~C-P8）、`HANDOFF/07-RULES-AND-BOUNDARIES.md`、`HANDOFF/08-OPEN-DECISIONS.md` |
| 5 | 跑 `npm test`（413/413）确认基线，再按 `HANDOFF/05-VALIDATION-AND-COMMANDS.md` 跑全套回归 |
| 6 | 要动某块代码时查 `HANDOFF/04-CODE-MAP.md` / `HANDOFF/FILE-INVENTORY.md` |
| 7 | 拿不准的产品/隐私选择**问用户**，不要自己拍板 |

```sh
cd /Users/gong.zhe/Developer/ai-native-collab
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost NODE_USE_ENV_PROXY=0
git status --short --branch
git rev-parse HEAD; git rev-parse origin/main; git ls-remote origin main
npm test                         # 本次交接复跑：413/413，0 fail
```

---

## 1. 这是一个什么产品（口径不能跑歪）

小规模、高信任、以知识与软件产出为主的团队：需求从飞书 IM 发起，按用途授权专业资料、连续交接，成果交付到本机 Git 或专业知识空间，**由人验收**。系统要回答的不只是「这单跑完没有」，还有「谁对什么负责、凭什么算做对了、AI 依据什么做的」。

用户已拍板的产品主模型，写在这里防止被重构成别的东西：

1. 产品化的是「**织**」不是「组」：**主职能稳定、领域上下文流动、邻接能力可正式派单**。
2. **主职能名单不预设**，由 Role Registry 配置；Transfer 默认 L0「仅本 Task」，以后按数据放宽。
3. **组织形态按业务域 / 组织单元配置，层不是固定骨架**：10 人团队可全域扁平，上百人团队可按业务域分层；团队长大是「加配置」不是「换系统」。
4. **同一个 Agent 可兼任多职责**，但**同一 Task 禁止自派自验自环**；配置组织级唯一，项目只引用不覆写，变更留快照、不回溯改写历史任务。
5. **核心决策点仍由人**：设目标与边界、跨空间授权、高风险联签、原发起人在原会话「确认验收 任务编号」。
6. **判断是工程能力 + AI 能力的组合**：确定性工程层（`modelCalls=0`）先处理，AI 层只接判不准的少数并记证据与成本，能本机不外部；人必达消息不受过滤。
7. **验收是一等公民 Agent**，可与产品 / 技术 / 运营 Agent 在同一份共享现场协作；独立评审者 ≠ 产出模型，不替代真人核可。
8. 系统要**沉淀上下文并自我改进**，但 **Agent 不能自己让改进生效**：候选改进须过工程回放闸门 + 真人批准 + 版本 / 灰度 / 可回滚。
9. **飞书 IM 是唯一发起入口**；工作台与独立控制台只做授权 / 留痕 / 审阅 / 签字，不新增网页发起入口。
10. 用户可见层国内化：不出现海外品牌、工程命令、英文协议词作为一等入口；**没连接不放空入口**。

详细产品论证见 `docs/ARCHITECTURE-v0.6.md`、`docs/PRD-v0.6.md`、`docs/ADAPTATION-v0.6.md` 的轮次复盘。

---

## 2. 现在做到哪（第二十二轮收口状态）

| 阶段 | 状态 | 关键交付 |
|---|---|---|
| A 收敛整合 | 完成 | 统一契约 `RoutingDecision`、5 个派活点同一份 Trace、平台端口抽象 |
| B1 记忆主干 | 完成并验证 | append-only `.runtime/memory/events.jsonl`、四类投影、8 处双写 |
| B2 读取链切换 | 完成并验证 | 投影召回融合、按主体精确撤权、真实一单撤权、增量 checkpoint |
| C-0 ~ C-6 + 收尾 | **全部完成并收口** | PG 宿主、独立控制台、单一 Router、Agent 编制、按配置评估、自演进闭环 |
| P-1 长程循环单步化 | 完成 | 单步执行器接上 PG 队列，默认 `loop` 可逐字回退 |

严格顺序 **A → B → C → 生产项，不并行**；C 的每一步都单独真跑验收过。最新边界声明是 `docs/ADAPTATION-v0.6.md` 的 `0.00000000000000000000000` 节；最新验证记录是 `docs/VALIDATION.md` 第二十二轮。

**最后一轮全套回归（第二十二轮）**：`npm test` 413/413、`tsc`、两个构建、425px 响应式、真实浏览器走查 11/11、`console:smoke`、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`steps:smoke` 40/40、`host:pg` 21/21、记忆重放/checkpoint、上游审计 clean、`git diff --check`。本次交接又单独复跑 `npm test` **413/413、0 fail**。

---

## 3. 环境与运行

| 项 | 值 / 约束 |
|---|---|
| Node | `package.json` 声明 `>=24.11.0`；实测 22.22.2 也能跑通构建与测试；`node --import tsx` 直跑 TS |
| 包管理 | npm，`package-lock.json` 已入库 |
| 状态目录 | `.runtime/` 被 `.gitignore` 忽略，**任何运行证据、真实姓名、open_id、密钥都不入库** |
| 3100 / 4180 | Paperclip 工作台 / Bridge，**运行中**；掉线用 `npm run up`、`npm run restart:bridge` 恢复 |
| 5432 | 用户既有本机 PostgreSQL 17，只连回环、只用专属库 `suitme_collab_c1`，DSN 只从 `COLLAB_PG_DSN` 读；不要碰 `geo_flow` 等其它库 |
| 4190 / 4192 / 4194 / 9418 | **用户主动取消，停机，不得重启**；也不要再打开 4194 页面 |
| 干净环境 | 宿主机可能有失效代理变量，本机服务相关命令统一加 `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost NODE_USE_ENV_PROXY=0`；`curl` 加 `--noproxy '*'` |

常用全套回归命令见 `HANDOFF/00-START-HERE.md` 第 4 节与 `HANDOFF/05-VALIDATION-AND-COMMANDS.md`。注意 `npm run memory:journey` 会**写真实 `.runtime/memory/events.jsonl`**，不是只读检查；测试动作靠 `COLLAB_TEST_TRACE` / `COLLAB_TEST_MEMORY` 隔离到内存 sink。

---

## 4. 代码地图速查

| 功能域 | 关键文件 | 一句话 |
|---|---|---|
| 组织与路由 | `src/router.ts`、`src/routing-decision.ts`、`src/routing-trace.ts`、`src/three-tier-assessment.ts` | 五个派活点收敛到单一 Router；扁平 1 跳 / 分层最多 2 跳 / `legacy` 回退；按当前配置评估三层 |
| Agent 编制 | `src/agent-registry.ts`、`src/roles.ts`、`src/service-network.ts` | 实例 + 可扩展职责 + 生效范围 + 版本 + A2A 在岗交接 + 验收协作编组 |
| 共享现场 | `src/memory-log.ts`、`memory-projections.ts`、`memory-recall.ts`、`memory-checkpoint.ts` | append-only 主干 → 四类投影 → 权限重评后第三路召回 → 增量 checkpoint |
| 验收 | `src/acceptance-plan.ts`、`acceptance-round.ts`、`acceptance-report.ts`、`acceptance-interop.ts`、`independent-review.ts` | 开工前锁定清单、逐项判定、部分打回、沉淀标准、独立评审 |
| 自演进 | `src/evolution.ts`、`src/evolution-ledger.ts` | 交付前强制自查 + 独立治理台账 + 工程闸门 + 人审 + 灰度/回滚 + 四项效果对比 |
| 长程执行 | `src/step-execution.ts`、`loop-pump.ts`、`step-runner.ts`、`src/pg-host.ts` | `StepQueue` / 一次一步 / `runToken` / PG `SKIP LOCKED` / 跨进程换机器续跑 |
| 宿主端口 | `src/platform-port.ts`、`paperclip.ts`、`src/config.ts` | `paperclip`（默认）/ `local` / `local-pg` 三种实现共用 `HostPlatformPort` |
| 前端 | `console/`、`plugins/knowledge-workspaces/`、`src/shell-locale.ts`、`src/user-language.ts` | 自研独立控制台（只读白名单）+ 可回退插件工作台；中文语言层 |
| 服务端接线 | `src/server.ts`、`src/v06.ts`、`scripts/console-server.ts` | 新增只读 action 必须同步 `readOnly`、`members.ts` 的 `reads`/`v06Reads`、控制台白名单 |
| 验证 | `scripts/*-smoke.ts`、`scripts/test.ts`、`scripts/workbench-walkthrough.mjs` | 隔离真跑脚本与真实浏览器走查 |

---

## 5. 红线（动手前必读）

**业务验收**：`Agent 完成 ≠ 业务验收`。报告、模型判定、CI 通过、合并审批、自动发布都不替代最终核可；最终核可只能由原发起人在原会话用中文「确认验收 任务编号」完成。**SUI-129 至今未核可，不得代做或伪造**。验收标准开工前锁定、由职能 owner 起草，独立评审者不得是产出模型。

**隐私**：真实姓名 / `open_id` / 密钥 / 业务正文只落 `.runtime/`；提交前做 staged diff 敏感扫描。Cognee 原生凭据只走进程环境变量、不入库；用户 2026-11-07 已允许外部 OpenAI-compatible 模型 API，不要偷偷改回「不外发」口径，也不要未经确认把材料发到别处。

**服务**：4190 / 4192 / 4194 / 9418 不重启；只有 3100 / 4180 按需恢复且必须干净环境。

**上游与许可证**：不改 `upstream/` 任何源码，`npm run audit:upstream` 必须 clean，7 个 submodule 与 `sources.lock.json` / gitlink 一致。LobeHub 主仓库（Community License）与 Outline（BSL 1.1）只借思想、禁止复制代码；`lobehub/acceptance` 是独立 Apache-2.0，只复用格式契约。`src/vendor/prime-query.ts` 必须保留原始 MIT 版权头。新增依赖走 R7 六步（协议核验 → 固定版本 → `licenses/` 原文 → `THIRD_PARTY_NOTICES.md` → lock → `docs/SOURCES.md`）。

**前端与入口**：控制台 16 项只读白名单之外一律 403，密钥不出服务端，不新增常驻端口，不新增网页发起入口；「没连接不放空入口」；中文壳只改展示文案，构建顺序「先 domesticShell 再 chineseShell」。

**工程约束**：派活 / 状态判断必须走统一 `RoutingDecision` 与同一份 Trace，不要各写一套；Trace 写入是 advisory，失败不得改变任务、回执或验收结果；撤权是状态写入不是物理删除，`grant-revoked` 不得放大成全局屏蔽；确定性链路 `modelCalls=0` 且 `assertDeterministic()` 非零即拒绝；治理台账**刻意不并入** B1 主干；不要为凑评估转绿逼扁平团队硬造管理层；`config.execution.mode=step` 必须配 `host.provider=local-pg`，配置层直接拒绝无队列的假单步。

---

## 6. 已实现 / 仅契约 / 未发生（口径必须持续收窄）

**已实现且有回归证据**：中文指令、派单/交接、限时授权、Context Pack 裁剪、知识候选→采用/撤回、开工前锁定清单 + 逐项报告 + Trace、本机 Git 交付链（含自动合并与预览发布）、组织映射、国内服务实时探测、B1/B2 共享记忆与撤权/checkpoint、PG 事务与并发领取、独立控制台六视图、单一 Router 与两种组织形态、Agent 编制、交付前强制自查、单步执行器跨进程续跑。

**仅契约 / 预备配置，不等于启用**：模型三档策略（不存 Key）、L2 组织图草稿（人审后生效）、飞书部门 scope 授权命令（需本人在飞书确认）、Cognee 原生 LLM / embedding / cognify 链路（代码已实现、允许外部端点，但缺端点与凭据，**真实调用从未发生**）、`config.execution.mode=step`（可真跑但默认未启用）、`config.host.provider=local-pg`（可真跑但默认仍是 `paperclip`）。

**未发生 / 不要宣称**：真人在真实业务单「确认验收」、真实业务单在 step 模式跑过、worker 内部一次 tick 的多次子调用逐次拆分、外部模型调用、远端工具沙箱 / 多机切换 / Redis 横向扩展、金额成本账本接入效果看板、Cognee 原生 cognify 真跑、企业微信 / 腾讯文档 / 钉钉 / 国内代码托管 / 公有云 CI / 海外 SaaS 接通、全员 SSO、真实外部 PR/CI、生产发布。三层判断在默认扁平配置下仍 `recommended=false`，这是防跳级闸门的真实结论，不是缺陷。

---

## 7. 下一步（都要先确认，不要「顺手补」）

**剩余生产项**（`HANDOFF/06` 第 5 节与 `docs/ADAPTATION-v0.6.md` 最新边界）：
1. 切换默认 `config.host.provider`，并把**真实业务单**切到 `step` 模式验证。
2. autoloop worker 内部子调用逐次拆分（当前是 tick 级单步）。
3. 真实外部模型端点、远端工具沙箱、多机 Remote Tool Calling、Redis 横向扩展。
4. 金额成本账本接入四项效果看板（当前单任务成本用「模型调用次数 / 任务」代理，不编造金额）。
5. 控制台 `view` 快照已增至 415KB / 10~12 秒，只做了按动作区分超时，**服务端分页 / 裁剪尚未做**。

**需要用户拍板**（`HANDOFF/08`，共 10 条，其中 6 条仍待拍板）：外部模型端点与凭据、SUI-129 真人验收、飞书部门 scope 授权、国内/海外外部服务是否接通、已取消服务长期状态、「pi」的指代。第 10 条「Paperclip 去留」方向已定为 (a) 不引入第 8 个上游、继续去宿主化，但**何时切换默认底座**仍需用户确认。

---

## 8. 文档索引与权威口径

| 想找什么 | 看哪里 |
|---|---|
| 一眼看懂整个项目 | `PROJECT-SUMMARY.md`（系统架构 / 产品功能架构 / 业务流程 / 依赖与协议） |
| 接手、环境、命令、红线、下一步 | `HANDOFF/` 包（入口 `HANDOFF/README.md`） |
| 产品需求与可验收条款 | `docs/PRD-v0.6.md`（尤其 §5 FR、§6 主流程、§10C C-P1~C-P8） |
| 设计定稿（不等于全部实现） | `docs/ARCHITECTURE-v0.6.md` |
| 最新实现边界 | `docs/ADAPTATION-v0.6.md` `0.00000000000000000000000` 节 |
| 现状架构与接入状态 | `docs/SYSTEM-ARCHITECTURE.md` |
| 验证证据 | `docs/VALIDATION.md`、`HANDOFF/05-VALIDATION-AND-COMMANDS.md` |
| 复用来源与协议 | `docs/SOURCES.md`、`docs/UPSTREAM-ADAPTERS.md`、`docs/OPEN-SOURCE-COMPLIANCE.md`、`THIRD_PARTY_NOTICES.md`、`sources.lock.json` |
| 机器可读交接元数据 | `HANDOFF/handoff-manifest.json` |

**冲突时的优先级**：`docs/ADAPTATION-v0.6.md` 最新边界声明 → `docs/VALIDATION.md` 最新验证记录 → `docs/PRD-v0.6.md` §10C → `HANDOFF/06` → 其余历史轮次文档。`HANDOFF/` 是详细交接说明的唯一权威目录；根目录 `HANDOFF.md` 与 `PROJECT-SUMMARY.md` 是与之同步维护的总览入口。

---

## 9. 提交与推送流程

```sh
cd /Users/gong.zhe/Developer/ai-native-collab
git status --short
git diff --check                       # 尾部空行等格式问题
# staged diff 敏感扫描：确认无 .runtime / ui/dist / dist/ui / 真实姓名 / open_id / 密钥
git add -A
git commit -m "……"
git push origin main
git status --short --branch            # 应干净且 HEAD = origin/main
```

不要跳过 hooks，不要 `--no-verify`。代码与文档应在同一提交里一并推送；修改交接说明后同步检查 `HANDOFF/README.md`、`HANDOFF/SYNC-STATUS.md`、`HANDOFF/FILE-INVENTORY.md` 与 `HANDOFF/handoff-manifest.json` 是否仍自洽。

---

## 10. 八个真实踩过的坑（简版，详见 `HANDOFF/00`）

1. 失效代理变量导致插件 worker 连本机 4180 被劫持，走查 11 步全失败、页面 `connect failed` / 502 —— 不是代码回退。
2. Paperclip 冷启动常超 `up.ts` 45 秒，报 `paperclip did not become ready` 但进程其实在起，别重复起第二个实例。
3. 后台沙箱跑 `build:chinese-shell` 会因 Vite 批量删除触发保护；前台已授权环境退出 0。
4. 改前端脚本后走查必须禁用 Chrome 缓存，否则测到旧脚本。
5. 白屏不一定是 JS 崩溃，先查 `[data-suitme-hidden]` 与 computed display。
6. 测试若丢 `COLLAB_TEST_TRACE` / `COLLAB_TEST_MEMORY`，会污染真实 `.runtime` 日志。
7. 宿主 3100 重启后需依次 `restart:bridge` + `install:workspaces` 重挂插件，否则走查全灰。
8. 真实链路才暴露的图缺陷：`memory-index` 会先自动跑一次 L2 抽取，`view.spaces` 是数组不是字典。

---

**给下一位 Agent 的一句话**：系统能跑、全套回归全绿、代码与文档都在 `origin/main`；先把 `HANDOFF/00` + `06` + `07` 读完再动手，**不要为了「看起来完成」放宽人签红线、重启已取消服务、切换默认底座或宣称未发生的真实业务验收**。
