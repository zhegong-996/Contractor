# 上游适配代码清单与边界（P3 整理）

> 整理日期：2026-11-06。范围：把「复用了什么、我们的适配层放在哪、升级时该核对什么」讲清楚，**不改动任何上游源码、不升级 submodule、不合并试点 PR**。
> 协议总表见 [OPEN-SOURCE-COMPLIANCE.md](OPEN-SOURCE-COMPLIANCE.md)，逐项目归属见根目录 `THIRD_PARTY_NOTICES.md`，精确提交见 `sources.lock.json` 与 gitlink。

## 1. 一条不变的原则

上游 = 固定 submodule 提交 + 原版 LICENSE/NOTICE；**适配层 = 本仓库独立文件**。新增能力一律落在适配层，改上游源码、把上游文件复制进 `src/`、或起第二个调度核心都在工程红线 R2 之外。`npm run audit:upstream` 会把这条边界机器化校验（gitlink vs 锁文件、工作树是否干净、许可证与声明是否齐全、L2 抽取是否只读）。

## 2. 七个已引入上游与适配层分组

| 上游（协议 / 固定提交） | 复用能力 | 我们的适配层（按分组） | 是否改上游 |
|---|---|---|---|
| **Paperclip** MIT `0eaabe5c0b37` | 原生任务/审批/文档修订、Plugin SDK、LLM Wiki、成本账本 | ① 运行时：`src/paperclip.ts`、`src/store.ts`、`src/controller.ts`、`src/server.ts`、`src/commands.ts`；② 前端插件：`plugins/knowledge-workspaces/src/ui/*`、`src/worker.ts`；③ 构建期中文壳：`scripts/build-chinese-shell.ts` + `locales/shell.zh-CN.json` + `src/shell-domestic.ts`（国内入口收敛）；④ 安装：`scripts/install-workspace-plugin.ts`、`scripts/install-wiki.ts`；⑤ 本机代码交付：`src/local-git.ts`、`scripts/delivery-server.ts` 实现与 `src/github.ts` 相同的 `DeliveryAdapter` | 否 |
| **DSH Super-agent** MIT `8c32a9dc5d72` | 飞书触发解析、会话线程键、出站通知、settingsPolicy / assessmentOutcome | `src/upstream.ts`、`src/feishu-sources.ts`（出站只把超长通知标识映射成飞书允许的稳定幂等键） | 否 |
| **Agent Autoloop** MIT `ba8cf6d8cf24` | worker 契约、原生进程执行与回执恢复、CLI 适配器 | `src/upstream.ts`、`src/native-worker.ts`、`src/assistant-turn.ts` | 否 |
| **Prime Agent** MIT `74591cddef28` | 检索词权重、近期目标权重 | `src/vendor/prime-query.ts`、消费方 `src/team-memory.ts` | 否 |
| **DeepSeek Harness** MIT `fcc0ad462172` | 输入保留与序列化、参考信封序列化 | `src/upstream.ts`、`src/harness-composition.ts`；动态包边界避免把未使用的宿主及 peer 依赖拉进类型检查 | 否 |
| **Cognee 1.6.6** Apache-2.0 `525b1d1179c5` | DataPoint、Ladybug 图存储、provenance、GraphSchema/JSON Schema、BM25 检索；**2026-11-07 起原生 LLM/embedding/cognify 管线已打开**（`src/cognee-native.ts`、`scripts/cognee-native.py`） | ① 运行时：`src/graph.ts`、`src/ontology.ts`、`src/team-memory.ts`；② Python RPC：`scripts/cognee-graph.py`、`scripts/cognee-recall.py`；③ 安装：`scripts/setup-graph.ts`；④ **新增 L2 抽取**：`src/org-extraction.ts` | 否 |
| **Acceptance** Apache-2.0 `f720feb862bd` | 开工前锁定验收计划、证据来源分类、逐项判定与报告/产物格式的**契约与文件布局** | `src/acceptance-interop.ts`（计划/报告映射、校验、bundle 写入）、`scripts/export-acceptance.ts`（`npm run acceptance:export`）；上游 `plugin.json` / `report-schema.md` 只作格式参照 | 否 |

另有 npm 依赖 `@a2a-js/sdk` 1.3.0（Apache-2.0，服务 Agent 网络）、`@modelcontextprotocol/sdk` 1.31.0、Zod 等，许可证原文保留在 `licenses/`，声明在 `THIRD_PARTY_NOTICES.md`。

**只借思想、不引代码**：LobeHub 主仓库（Community License，非 OSI）、Graphiti（Apache-2.0，双时间边语义）、OpenHands SDK（MIT）、Outline（BSL 1.1，禁止引代码）。注意 `lobehub/acceptance` 是**同组织下的另一个仓库、另一份 Apache-2.0 协议**，已作为第七个 submodule 引入，不受 LobeHub 主仓库附加条件约束；其 CLI 与云端报告服务未启动。

## 3. 按职责看适配层目录

| 分组 | 文件 | 职责 |
|---|---|---|
| 运行时适配 | `src/upstream.ts`、`src/paperclip.ts`、`src/feishu-sources.ts`、`src/native-worker.ts`、`src/harness-composition.ts` | 把上游导出收敛到窄接口；上游版本升级时只需要重核这些点 |
| 知识引擎适配 | `src/graph.ts`、`src/ontology.ts`、`src/team-memory.ts`、`src/org-extraction.ts` 与 `scripts/cognee-*.py` | 来源版本/权限衔接、L1 只读投影、L2 草稿边生成 |
| 业务编排 | `src/controller.ts`、`src/server.ts`、`src/commands.ts`、`src/v06*.ts` | 本仓库自研，不引用上游内部实现 |
| 前端插件 | `plugins/knowledge-workspaces/` | 只在现有 5 tab 内增组件；中文壳构建期替换展示文案，不改路由/API/上游工作树 |
| 安装与锁定 | `scripts/install-upstream.ts`、`scripts/setup-graph.ts`、`scripts/install-*.ts`、`sources.lock.json`、`.gitmodules` | 固定提交、隔离 venv、插件构建 |
| 声明与审计 | `THIRD_PARTY_NOTICES.md`、`licenses/`、`docs/OPEN-SOURCE-COMPLIANCE.md`、`scripts/audit-upstream.ts` | 归属与许可证留痕 |

## 4. L2 抽取接入后的新边界（本轮）

- `KnowledgeGraph.readProjection()` 只调用既有 `op=read` 路径，**不调用 `project`、cognify、embedding、向量检索**；`modelCalls` 保持 0。
- L1 证据图仍按 `sha256(sourceId@revision)` 物理隔离；抽取器先做跨版本泄漏检查，混入其它来源版本直接拒绝。
- L2 只生成 `draft` 边，每条带 `{sourceId, revision, excerpt}` 且摘录必须逐字来自该 L1 投影；人验收前不能进 Context Pack。
- 全局 L2 图存组织级配置，任务文档只是给现有工作台看的镜像；重复抽取幂等，不重置人已验收的状态。

## 5. 升级与自检顺序

1. `npm run audit:upstream` → 边界、gitlink、许可证、声明全绿（结果写 `.runtime/upstream-audit.json`）。
2. `npm run doctor` → 本机服务与固定提交可用。
3. 升级单独提交：先改 `sources.lock.json` 与 gitlink，再逐个重核适配层导出；上游 API 变化只允许改适配层。
4. `npm run test:responsive` → 1280 / 425 走查（结果写 `.runtime/responsive-audit.json`）；`npm test` 与 `tsc --noEmit` 回归。
5. 重新核对 `THIRD_PARTY_NOTICES.md` 与 `licenses/`；Apache-2.0 项目若被修改需显著标注（当前做法是「不改上游 + 适配层独立」，规避该义务）。

## 6. 本轮整理明确没做的事

没有把上游目录重命名或搬迁（会打断固定 gitlink 与已验证的构建脚本），没有替换上游界面，没有把 Python RPC 合并进 TS 层，没有删除任何适配文件，也没有声称「上游代码已全部优化」。整理产出是**清单 + 机器化边界审计 + 分组说明**，代码行为保持不变。
