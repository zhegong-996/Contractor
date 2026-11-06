# SuitMe 协作台：架构、功能与接入状态

核验日期：2026-11-05（北京时间）。依据本机运行服务、数据库只读查询及固定版本源码。当前是本机试点，包含开发和联调记录；不是已经部署到全体员工的生产系统。

## 当前架构

```mermaid
flowchart TD
  Events[飞书 / GitHub / 当前任务事件] --> Control[协作控制层 · SuitMe · 4180]
  Humans[人的界面 · 讨论 / 决定 / 修改 / 验收] <--> Control
  Services[个人与公共服务 Agent · 负责人 / 当前职责 / 版本] <--> Control
  Context[团队上下文 · 目标 / 规则 / 获准资料 / 历史决定] --> Control
  Control --> Policy[Super-agent 原版策略 · 范围判断]
  Policy --> PC[Paperclip · 唯一任务 / 原生运行 / 锁 / ACL / 文档修订 · 3100]
  PC --> PG[(真实 PostgreSQL 18.1)]
  Control --> SQLite[(SQLite · 事件去重 / 回执 / 接入投影)]
  Control --> Harness[DeepSeek Harness 原版 · 作用域 / 身份 / 提示词 / 工具管线]
  Harness --> Tools
  PC --> Worker[Autoloop 原版 worker · 执行适配层]
  Worker --> Exec[现有 Codex CLI / 已验证执行端]
  Exec --> Tools[任务绑定工具 · 检索 / 记录 / 图谱 / 申请 / 证据]
  Tools --> Context
  Exec --> Evidence[可审阅工作稿 / GitHub PR / CI / 同 SHA 预览]
  Evidence --> Control
  Humans -->|明确采用| Source[知识内容 · 正文 / 类型字段 / 来源修订]
  Source --> Gate[当前身份 / 用途 / 确切版本检查]
  Gate --> Cognee[Cognee 原版 SDK / 图谱渲染 / GraphSchema 字典]
  Cognee --> Ladybug[(Ladybug · 按来源版本隔离)]
  Source --> Context
  Model[Flash/Lite · 通用 · 编码模型配置] -.预备策略，未启用新服务.-> Exec
  Cognee --> Memory[已确认知识 / BM25 持久记忆 / 人审概念]
  Cognee -->|op=read 只读投影| L2[L2 组织图 · 确定性抽取 / 草稿边 / 人审后才生效]
  Cognee -.仍未启用.-> Semantic[Cognee 原生 LLM 实体抽取 / embedding / cognify]
  Cognee --> Recall[BM25 检索 + Apple NL 设备端词向量语义加权 · 本机]
  Recall --> Vision[Apple Vision 本机端点 · 截图 OCR / 分类 → 独立视觉评审]
```

## 真实接入状态

| 服务或能力 | 本机已核实 | 实际边界 |
|---|---|---|
| Paperclip | 0.3.1，health ok，3100 | 唯一业务任务与运行核心；local_trusted 本机管理员模式 |
| PostgreSQL | 18.1，数据库 paperclip，54329，实际 SQL 读取及持久化 | 任务、项目、Agent、授权、文档、修订与审计；不是内存假数据或 PGlite |
| SuitMe bridge / SQLite | 4180 health ok，真实本地数据库 | 飞书事件、去重、发件箱、接入记录与任务投影；不取代主业务库 |
| 飞书 | 专用测试机器人与事件监听已连通 | 白名单测试单聊；文档/历史讨论已按明确任务许可实测，旧任务授权到期或撤销后不继续使用 |
| GitHub | 测试仓库 PR、CI 与带 SHA 的本机预览已实测 | 不表示业务仓库已合并或生产部署 |
| 协作与开发执行 | 真实 Codex CLI + 原版 Autoloop worker；SUI-74、SUI-81、SUI-85 已运行 | 协作按证据调用工具、提问等待并接续；开发 PR #3 已交付且 CI 通过。旧项目访问失败不通过扩大授权解决 |
| 服务 Agent | 原生成员归属、Harness 构建、A2A 子任务、澄清、回传与取消；独立 3110 实例具有三套 operator 账号和三个资料身份 | 业务与成员为模拟角色；主实例仍为本机管理员模式，不能替代真实员工生产验证 |
| 其他 Agent | 通用 CLI / MCP / 人工接单接入合同 | 注册名称不等于云端自动执行已验证；WorkBuddy、豆包等逐端核实 |
| 模型设置 | 轻量、通用、编码三档与动态执行身份绑定已保存到私有原生文档 | 仅预备配置，不存 API Key；**不接入任何外部 / 云端模型网关**。例外是两套 macOS 设备端能力：Apple NaturalLanguage 词向量（recall 语义加权）与 Apple Vision（截图 OCR / 分类，独立视觉评审），均只监听 `127.0.0.1`、不外发业务材料、不下载模型 |
| Cognee + Ladybug | 固定 1.6.6；持久 chunk、BM25 检索、原文概念与关系候选、人审图版本、原版图谱 | 已确认知识持续索引，当前权限和版本前后复查；**Cognee 原生** LLM / embedding / cognify 与向量语义检索仍未启用；另有不写入 Cognee 的 Apple NL 设备端词向量用于 recall 加权 |
| 知识字典 | Cognee 原生 GraphSchema / reducer / JSON Schema 转换 | 概念、定义、文本/数字/布尔/日期/枚举/关系；按空间配置，尚未驱动自动抽取 |
| Wiki 插件 | 原版插件已安装，本地 Markdown 目录 | 自动摄取关闭，未把共享 Wiki 空间字段当作可靠私有 ACL |
| 存储与部署 | PG、SQLite、版本图及配置均为真实本机持久化 | 没有接对象存储、向量服务、Redis、SSO 或云数据库 |
| 备份 | PostgreSQL 本机备份正常 | 异机恢复未验证；SQLite、图文件、配置与 Wiki 文件还需要联合备份恢复验证 |

## 上下文、知识与记忆

上下文不是审批记录的集合。每次执行组合目标、当前负责人、来源及修订、已获准原文、已确认知识、工作稿、决策、GitHub 版本证据与缺口。范围由任务用途、参与者、原生权限和临时委托决定；公司组织划分由配置迭代，四个早期专业空间只是种子。

- **资料层**：飞书保留实时引用，内部内容使用 Paperclip 文档与原生修订。非结构化正文与有类型的事实字段共同版本化，可编辑、搜索、筛选、审阅和撤回。
- **知识引擎层**：直接集成 Cognee 的 DataPoint、Ladybug、来源追踪、图谱渲染与 GraphSchema。图引擎、字典模型和序列化不重写；SuitMe 只负责现有身份、确切资料版本和原生权限的衔接。
- **当前图层**：已确认内部知识按当前修订持续建立文档、字段、片段和关系索引；Agent 按原文和字典准备概念关系，人审后进入图谱。按来源修订物理隔离；旧修订、过期权限或已验收任务不能用来读取当前上下文。生成图不会确认候选，也不会复活旧授权。
- **当前记忆与后续扩展**：Cognee 原版 BM25 已用于获准来源和已采用概念的持久检索；另有 Apple NaturalLanguage 设备端 300 维中英文词向量（`scripts/apple-embedding.swift`、`src/semantic-recall.ts`）对 recall 结果做语义加权——设备端计算、不下载模型、不写 Cognee、不外发材料，与 Cognee 原生管线无关。跨来源自动消歧、**Cognee 原生** embedding 语义检索与 LLM cognify 管线仍未启用；按用户选择不接入任何外部 / 云端模型服务。

生命周期为来源 → 获准用于本任务 → 工作稿 → 人审候选 → 确认/采用 → 可复用知识。一次任务中出现过不代表可以成为长期记忆；模型不能自行批准授权、采用知识或最终验收。临时访问也不包含将别人的资料永久发布为知识的权限；专业负责人在其有权负责的空间审阅采用。修改内容后进入新的候选修订，确认不能跨版本沿用。

图谱投影与字典目前分别版本化；保存字典不自动迁移旧事实。外部飞书原文当前不进入图处理接口，SUI-54 的私有工作稿未被采用或导入。权限变更后当前接口拒绝读取，并在交付前复查；这不等同于已经实现所有外部副本的物理删除与远程缓存清理。

方案比较、精确复用文件、许可证和启用边界见 [知识引擎集成](KNOWLEDGE-ENGINE.md)。不再计划自行创建一套 knowledge_objects / schemas / relations 作为新的知识引擎。

## 人和 Agent 的协作

人从飞书或后台提出目标；协作助手在既有任务中归纳上下文、准备资料申请、列出缺口、制作工作稿和交接材料。低风险整理按委托推进；授权、知识采用、最终验收由人决定。执行端换手时沿用任务、已确认的输入、检查点和 GitHub 证据，Paperclip 管签出与运行，避免另开一套调度。

个人 Agent 的服务身份与 Codex 等执行引擎分开。职责随当前工作版本化；变更后旧任务暂停沿用旧结果，负责人核对范围后继续。服务登记不会扩大资料权限。详见 [个人 Agent 服务网](AGENT-SERVICE-NETWORK.md) 和 [实际运行合同](AUTONOMOUS-COLLABORATION.md)。

个人模型的三档配置记录提供商、模型标识、凭据环境变量名与输入输出预算，并绑定现有执行身份。保存预备策略不会修改既有运行、加载 Key 或向新的服务发送资料。成员到独立 Agent 身份的适配已实现，使用原生 active membership 与真实通讯录校验；主实例部署仍只有本机负责人；另外的隔离认证实例用于三虚拟成员演练，尚未组织真实员工全员登录。当前不能宣称每位员工都有上线运行的轻量代理。

## 当前页面

- 我的工作：人的待决事项、Agent 进展与最近沉淀。
- Agent：服务目录、成员归属与飞书配对；直接找服务 Agent 提需求，职责设置按需展开。
- 协作任务：目标、负责人、上下文、授权、工作稿、交接、版本证据与验收。
- 知识：检索与记忆、动态知识空间；内容、图谱与字典；结构化字段与正文、来源、版本、关系候选与人审。
- 授权申请：同一任务中的资料、接收身份、用途、期限和处理记录。
- 设置：模型与代理的预备配置，真实服务、存储和知识引擎状态。
- v0.6 增补（P3~P4，2026-11-06）：协作任务详情新增「验收与责任」（开工前锁定清单、逐项评审报告、独立评审就绪状态、**验收报告与自查标准**、Transfer 授权卡片、跨空间授权、统一过程流水与成本）；知识新增「关系与状态」子视图（L2 组织图边状态、Context Pack，**以及 L2 自动抽取状态与全局关系数**）；设置新增「组织规则」只读子视图（职能注册表、授权策略、政策、注意力、Watchdog、本体、**L2 抽取状态**、**飞书组织映射**与组织信号，共 10 段）。**主导航仍为 5 个 tab**，未新建独立界面，全部经 `/workspace/v06-*` 只读 action 消费；执行链路的注意力预算与 Watchdog 已在 `runtimeGuard.enforce`（默认开启）下从「只观测」切到实际生效，人工介入 / 结果 / 验收 / 授权等必达通知由 `protectHumanNotifications` 保护，不被低价值通知抑制。第四轮已做 1280 / 425 Chrome headless 布局走查（`npm run test:responsive`）与上游适配边界审计（`npm run audit:upstream`，清单见 `docs/UPSTREAM-ADAPTERS.md`）；第五轮完成真实宿主实例 5 tab + 3 个 v0.6 视图的全流程浏览器走查（`npm run test:walkthrough`，10/10 通过）与本地演示页；第六轮补上用户语言层（会话里全中文指令，旧英文命令只作内部兼容）、按开工前锁定清单的确认验收路径、飞书真实成员只读组织草案与只绑 loopback 的本机中文验收报告服务，两个新增只读视图仍挂在原有 tab 内，走查复跑 10/10 通过。

常用宿主文案通过构建期 AST 中文词典覆盖；只改展示文案，保留路由、API 值和用户内容，上游源码不变。深层原生页面、原生认证页面和插件动态文案仍有未翻译部分，不宣称所有页面已经完整中文化。

## 集成后再完善

1. 将已适配的原生成员登录与个人代理归属部署给实际同事，验证多人共同使用；补全组织映射及联合备份恢复。
2. 在用户选定服务后启用轻量模型网关与 Cognee 原生管线，验证真实资料的引用、关系、冲突、撤权与成本；不因无 Key 路径存在而下载运行模型。
3. 根据真实知识规模补全文档附件、全文/语义混合检索、跨来源消歧和图编辑；优先原版模块，先验证权限隔离再打开共享。
4. 产品闭环经用户验收后，才整理冗余适配、替换不合适的上游界面与优化复用代码，保留来源及升级路径。

## 实现指针

`src/agent-services.ts` 管服务与职责版本；`src/coordination.ts` 调用 Super-agent 原版策略；`src/assistant-runner.ts`、`src/runner.ts` 使用 Autoloop 原版 worker；`src/assistant-tools.ts` 暴露任务绑定工具；`src/workspaces.ts` 管任务授权、交接和人审；`src/context.ts` 管执行上下文；`src/knowledge.ts` 管原生内容与确认；`src/graph.ts` 和 `scripts/cognee-graph.py` 衔接 Cognee；`src/ontology.ts` 保存字典模型；`src/model-settings.ts` 保存预备模型策略；`plugins/knowledge-workspaces/src/ui` 是中文工作台。

## 多人协作与持续记忆适配更新

本轮直接复用 Paperclip 的真实成员与角色，官方 A2A 1.3.0 的处理器与传输，Cognee 的持久图和原版 BM25。服务任务、上下文、成果和已确认知识已经接通；不是新增独立审批台或第二个调度器。当前原生 authenticated 登录与实际团队入驻仍待配置，不通过填写虚拟成员证明全员可用。完整合同、接口、前端结构和验证边界见 [多人服务与团队记忆](TEAM-NETWORK-MEMORY.md)。

知识层现支持已确认资料持续索引、权限过滤的中文检索、概念关系候选与采用、当前字典/来源变动失效。前文“后续记忆层”中 BM25 与人审关系已经落地；**L2 组织图已连 Cognee L1 只读投影做确定性自动抽取**（`src/org-extraction.ts`，零模型调用、带逐字原文证据、草稿待人审），**Cognee 原生**自动 LLM 实体抽取、embedding 与向量语义检索继续关闭；本机 Apple NL 设备端语义加权不在此列。验收侧已接入真实本机视觉语义评审：Apple Vision 设备端 OCR + 图像分类经 `http://127.0.0.1:4190/v1/chat/completions` 提供，`LocalModelVisionAdapter` 只允许本机 http 直连、拒绝代理与外发；新验收流程通过 `config.acceptance.mode=independent` 开启，本机实例已开启并在 SUI-129 上跑通 2/2 逐项判定，报告可导出为 `lobehub/acceptance` 格式的 bundle。仓库默认仍可 `legacy` 一行回退。


## 三成员隔离实例

新增模拟实例使用原版 Paperclip authenticated 模式、独立 PostgreSQL 与独立状态目录，工作台 3110、桥接 4181。它不修改主实例的成员、飞书白名单或真实项目资料。三个业务角色均非管理员；正向申请、授权、委托、知识采用与验收通过前端操作，原生 API 权限矩阵另行验证。运行方式及复用边界见 [Agent 构建](AGENT-BUILDING.md)。

## 本机只读总览（第七轮）

`scripts/acceptance-report.ts serve` 在 `127.0.0.1:4192` 额外提供 `/overview`：`src/acceptance-report.ts` 的 `renderOverviewHtml` 只渲染纯数据，脚本侧用 `node:http` 直连探测 3100 / 4180 / 4190 / 4192 的实时状态，读取 `.runtime/config.json` 的验收配置与 `.runtime/org-mapping-draft.json` 的**成员计数与布尔值**（成员明细不进页面），中文指令清单直接引用 `USER_HELP` 避免文档漂移。该页不写任何状态、不调用业务写接口，也不依赖 bridge 的身份令牌；`4190` 视觉端点停机时只显示离线，不会伪装成结构式评审通过。

## 国内环境适配与本机代码交付（第八轮）

`config.delivery.provider` 默认 `local`：`src/github.ts` 导出 `DeliveryAdapter`（`prepare / publish / inspect / preview`），`src/local-git.ts` 以本机裸仓库 + 本机合并请求记录 + 本机 CI（提交存在、允许路径、与 main 无冲突）+ 确切提交预览实现同一契约，`src/server.ts` 按配置注入 `Controller`，`github` 适配器保留供已有部署回退，业务验收红线未动。`scripts/delivery-server.ts` 只绑 `127.0.0.1:4194` 提供中文交付台，并在 `127.0.0.1:9418` 起 `git daemon` 供 clone / pull / push；合并审批与通知记录落 `.runtime/git/deliveries/`，不改写业务任务状态。

前端适配分两层：`src/shell-domestic.ts` 在构建期精确收敛上游侧栏的技能库 / 连接服务入口，运行时通过同源 `suitme-domestic.js` 过滤**数据驱动且未连接**的海外集成卡片；`scripts/build-chinese-shell.ts` 先收敛再翻译，`install-upstream.ts` 与 `up.ts` 保证中文壳默认生效。插件设置的「国内服务」由只读 `service-status` 统一提供数据（见下节），**只有实测接通才渲染链接**，未接通项只做文字说明，不留空壳入口。

## 服务状态真实性与前端体验修复（第九轮）

`src/service-status.ts` 是国内服务清单的唯一数据来源。`collectServiceStatus()` 用 `node:http` 并发直连 loopback 探测 3100 / 4190 / 4192 / 4194，绕过可能失效的环境代理；`buildServiceStatus()` 是纯函数，负责把结果组装成逐项 `state / detail / url / setup / source`。只有 `state==='connected'` **且** `safeLoopbackUrl()` 校验通过的条目才带 `url`；未接通项只有原因与可照做的步骤，没有 `url` 字段，因此前端不可能渲染出空壳链接。交付台还额外校验 `scope=loopback-only`、`provider=local-git` 与端口，防止端口被别的服务占用时误判。Paperclip 的 `/health` 是 SPA HTML 回退而非 JSON，探测按「200 + `<html`」判定在线，其他任意 200 不算接通。

前端「国内服务」页改为完全数据驱动：按本机 / 国内 / 海外分组，显示状态来源（区分实时探测、进程内判定与飞书监听器事件推断），每 15 秒在页面可见时自动刷新，提供手动刷新、加载态与独立的错误态；探测失败不再被静默显示成「未接通」。设置页的两个读请求改为分别降级，任一失败不会让另一块永久停在「正在读取」，模型配置保存失败有就地提示，成员视图禁用仅操作员可用的保存按钮。`system-status` 里写死的 `vectorSearch: true`、`automaticExtraction: false` 与只看 `visualReviewer.mode` 的评审者文案，改为从 `config` 派生并明确区分「已配置」与「端点在线」；`service-status` 同步补进服务端只读白名单与成员只读白名单。

`scripts/build-chinese-shell.ts` 在每次构建前从 `public/sw.js` 恢复 `dist/sw.js` 的原始占位符，修复上游 `closeBundle` 就地 stamp 后重复构建必失败的幂等问题；`tests/v06-services.test.ts` 的 `at` 改为相对当前时间，去掉固定日期导致的「过 8 小时就必然失败」的时间炸弹。
