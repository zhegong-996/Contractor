# 知识引擎集成与源码复用

核验日期：2026-11-05。产品顺序为**集成成熟方案 → 按真实协作需求改造界面 → 完整流程验收 → 整理复用代码**。不另写图数据库、实体抽取器、图查询语言或 Agent 记忆引擎。上游固定提交，适配层与上游源码分开。

## 已比较的方案

| 项目与核读版本 | 源码已有能力 | 本次取舍 |
|---|---|---|
| [Cognee](https://github.com/topoteretes/cognee/tree/525b1d1179c550cd5b5661bcbf8f00f57a676928)，Apache-2.0 | DataPoint、图存储适配、来源追踪、图谱前端、GraphSchema/JSON Schema、本体接口及 remember/recall/improve/forget | 主知识引擎。直接集成图存储、图谱渲染和模型模块；自动抽取及语义记忆管线暂不启用 |
| [LightRAG](https://github.com/HKUDS/LightRAG/tree/aaebfe1bb8d55deb6a4304d357a3bf4c92fcd40a)，MIT | 文档入库、GraphRAG、实体关系查询/修改/合并、React 图谱与文档管理 | 文档检索和图谱编辑的参考；暂不叠加第二套索引及运行服务 |
| [Graphiti](https://github.com/getzep/graphiti/tree/fb60e59d4a208c99e7d0186ee6335d2a257f17f2)，Apache-2.0 | Episode、类型化实体、关系有效/失效时间、增量图谱与 Agent 记忆 | 时间关系和冲突处理的参考；`group_id` 不代替访问控制，独立服务不能直接作为授权边界 |
| [KAG / OpenSPG](https://github.com/OpenSPG/KAG/tree/fdab15b3929d2ee40dfcdd388f90233096a6afc9)，Apache-2.0 | 概念、Schema、属性/关系、约束、词典、知识构建与逻辑推理 | 专业知识字典和领域建模的参考；当前不为一个词典页面再部署整套 OpenSPG |

选择 Cognee 的依据是上述源码与当前需要的匹配程度，不是已验证的检索准确率排名。没有把四个框架全部安装并宣称集成完成。

源码入口：Cognee 的 `cognee/infrastructure/databases/graph/ladybug/adapter.py`、`cognee/infrastructure/engine`、`cognee/infrastructure/databases/provenance/source_refs.py`；前端的 `cognee-frontend/src/app/(graph)/GraphVisualization.tsx`、`src/modules/graphModels/{types,schemaReducer,toGraphModelSchema}.ts`。LightRAG 对照 `lightrag/api/routers/graph_routes.py` 和 `lightrag_webui/src/components/graph`；KAG 对照 `knext/schema/model`、`knext/schema/rest/concept_api.py`；Graphiti 对照 `graphiti_core` 的 episodes、edges 和 temporal 逻辑。

## 已实际集成

| 层次 | 直接复用 | SuitMe 的必要适配 |
|---|---|---|
| 持久化 | Cognee `LadybugAdapter`、`DataPoint`、原生 provenance helper | 将获准的原生文档当前修订映射为来源文档与字段；按来源及修订隔离物理图文件 |
| 图谱页面 | 原版 `GraphVisualization.tsx` 与节点颜色模块 | 中文工具栏、节点明细、键盘可用的节点选择器、真实数据边界、宿主尺寸；Next client-only 动态加载转为 React lazy |
| 知识字典 | 原版 `GraphSchema`、`emptySchema`、`schemaReducer`、`toGraphModelSchema` | 中文概念、定义、属性、枚举和关系表单；身份检查、校验及 Paperclip 私有文档修订 |
| Agent 工具 | 同一图存储读接口 | `read_knowledge_graph` MCP：任务归属、来源范围、原生 ACL、知识确认和版本先行核对 |

上游子模块不修改。Apache-2.0 原文保留在 `licenses/cognee-APACHE-2.0.txt`，归属见 `THIRD_PARTY_NOTICES.md`。

Cognee README 明确把“单 PostgreSQL 图存储”标为演示能力，生产版本另有授权。本轮选用开源 **Ladybug** 适配，不把商业能力算作已交付。Paperclip 的 PostgreSQL 继续保存业务任务与文档，两者职责分开。

## 数据和权限

1. 原始资料、工作稿、确认及撤回状态、修订仍由 Paperclip 保存；飞书保留实时来源引用。
2. 图谱生成是管理员对**某一条内部资料的确切修订**执行的动作。当前生成文档、结构化字段和 `has_field` 关系；不改变资料状态。
3. 图文件按 `sha256(sourceId@revision)` 存在忽略的 `.runtime/knowledge-graph`，不会在读取前加载整个公司图再过滤。旧版图即使仍在磁盘，也不能通过当前接口冒充新版。
4. Agent 读取还须属于当前未验收任务，资料已纳入该任务，原生权限及委托仍有效，知识已确认且未过期。调用前后都重查来源版本和访问资格，结果期间发生变化则不交付。
5. 外部飞书原文目前明确禁止进入该图处理接口。SUI-54 已验收工作稿和已撤销的临时授权不因接入引擎而重新开放，也未被复制入图。
6. 本地管理员有当前本机的管理权限；员工登录、组织映射和远程团队部署未完成。不能将这种单机边界宣传为已部署的企业多租户系统。

每个空间可以自行定义知识概念与属性，不依赖“产研/增长/销售/职能”四个固定模块。字典和内容分别版本化；保存字典不会自动重新解释旧事实，尚未启用按字典抽取或迁移已有图数据。

## 运行与启用边界

需要 `uv`。在已经安装 Node 依赖及 Paperclip SDK 的 checkout 中：

```sh
npm run setup:graph
npm run build:workspaces
npm run restart:bridge
npm run install:workspaces
```

`setup:graph` 使用上游锁文件，在 `.runtime/cognee-venv` 创建 Python 3.12 隔离环境。`upstream/cognee`、`uv.lock` 与 gitlink 共同固定版本。进程只接收当前选中资料，不继承模型凭据；关闭 Cognee telemetry。

**已运行**：本地确定性图投影、图读取、原版图谱渲染、字典保存、原生修订冲突检查与任务权限拦截。

**未启用**：`remember / recall / cognify / improve / forget` 业务管线、LLM 实体抽取、embedding、向量检索、自动跨来源消歧合并、长期记忆整理、OWL 导入接口。Cognee 的无 API Key 路径仍会下载并执行 GLiNER 与本地 embedding 模型；用户选择暂不启用新服务，因此本轮也不以“无 Key”为由启动这些模型。

**已启用但不同层**：L2 组织图的自动抽取（`src/org-extraction.ts`）。它只调用 `KnowledgeGraph.readProjection()` 的 `op=read` 路径读**单个** `sourceId@revision` 的既有 Cognee 投影，按确定性规则把结构化字段、人审概念与显式谓词字典映射成带逐字原文引用的 **L2 草稿边**；不写入 L1、不调用 cognify/embedding、模型调用 0、草稿必须人验收才能作依据。经 `Workspaces.onSourceIndexed` 在已确认资料索引完成后自动触发，best-effort 且失败只写审计。这是产品层的组织语义投影，不是 Cognee 的语义实体抽取，因此不违背上一段的关闭边界。

目前图谱是**真实内容的结构投影**，不是自动语义知识图谱，也没有完成跨会话语义记忆服务。后续启用原生管线前，应绑定用户选择的处理服务与资料许可，再验证引用准确性、冲突、撤权、派生内容失效及成本。

## 实际验证依据

平台空间中的真实架构核验记录包含 PostgreSQL 版本、数字字段、布尔字段及正文，保持候选状态。Cognee 生成 4 个节点、3 条关系，未发生模型调用。验证记录与界面截图保存在本机 `.runtime`，不提交真实正文。

自动检查覆盖真实上游 reducer/serializer、字段及关系类型、无权限时禁止读取、验收任务禁止恢复读取、外部来源拒绝和旧版本拒绝。真实落盘与重复读取另以本机该记录核验，不能用单元测试代替实际集成证据。
