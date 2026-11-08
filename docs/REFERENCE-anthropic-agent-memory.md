# Anthropic《The components of agent memory》参考评估（2026-11-08 · 第二十五轮）

> 来源：`https://www.anthropic.com/research/components-of-agent-memory`，`Engineering` 栏目，**Published Nov 6, 2026**，Written by **Lance Martin**（致谢名单见原文），© 2026 Anthropic PBC。
> 方法：完整通读正文与图注（含 Figure 1–15 的数据标注），逐层对照本仓库 `src/memory-log.ts` / `memory-projections.ts` / `memory-checkpoint.ts` / `knowledge.ts` / `knowledge-edges.ts` / `context.ts` / `evolution.ts` 的真实实现。
> **许可证边界**：这是网页研究文章、不是开源仓库，**没有可复用的代码许可证**；本轮只借架构思想，不复制正文段落、不复制代码、不引入依赖、不引入 submodule。`sources.lock.json` 的 `conceptReferences` 登记来源，`sources` 七个上游不变。
> 用户点题：「我们参考的，其实也可以理解为是一种记忆，就是在组织内沉淀知识，也可以说是记忆，然后的一种规则」——本报告第 5 节正面回答，第 6 节给出本轮落成的代码。

## 0. 先说结论

这篇文章**不是**「给 Agent 配一个大记忆库」，而是把记忆设计成**分层、可维护、由离线计算持续纠偏的生态**。对本仓库价值最高的，不是它最出名的「让模型自己判断什么值得记」，而是三条**工程规则**：

1. 任何上层知识都必须能**回到最底层的原始事件流**校验（transcript 是 ground truth）；
2. 知识表示层必须**有链接、有索引、有出处，且不得比原始语料还大**（文章用「和帝国一样大的地图」讽刺抽象为零）；
3. 每会话自动加载的顶层必须**很小、只放索引和指针**，细节一律下移；离线整理只负责**提出建议**，不替人放行。

第 3 条与本仓库「Agent 可提出改进但不能自己让改进生效」「候选改进须过工程闸门 + 人审」高度同构，是可以直接落地、且不需要外部模型的部分；第 1、2 条本仓库确实缺。文章里那些依赖**模型判断 salience** 的结论（对强模型只说用途不说做法、固定规则反而掉分）在本仓库 `modelCalls=0` 的确定性链路上**不适用**，本报告明确不照搬。

## 1. 文章讲了什么

### 1.1 定义与明确排除

Agent memory 被定义为：模型从经验（与人的交互、被分配的任务）中获得、**跨 session 保留**、之后可作为 context 读回来的知识。明确排除三类：`weights`（训练参数）、`in-context learning`（单会话内获得）、`compaction`（为续跑而写的会话摘要）。

**它没有采用** `short-term / long-term`、`episodic / semantic / procedural` 这两组常见分类法，也**没有**伪代码、没有统一的遗忘 / TTL / 淘汰算法、没有给 transcript 的删除或压缩规则、没有数值化优先级分数。人脑类比（海马体快速捕捉、离线 replay 整合到新皮层）只是引入语，不是工程分类。

### 1.2 真正的分类法：memory hierarchy（Figure 1）

自下而上四层，加一个跨层离线过程：

| 层 | 名称 | 职责 | 访问方式 |
|---|---|---|---|
| 底 | `transcripts` / `session logs` | 可检索的原始事件流；为上层校验提供 ground truth | 按需 search；文章结尾认为可视为记忆的 foundation |
| 2 | `memory notes` | 模型当下判断 salient 的观察、已验证事实、规则、失败、计划、陷阱警告 | 后续 session retrieve；可向上提升 |
| 3 | `memory representations such as wikis` | 由链接页与索引构成 knowledge map，帮助在增长的知识库中导航 | 按需 read / search；与 search 配合通常更强 |
| 顶 | `injected context` | 每 session 开头预加载，不必搜索甚至不必知道有东西可搜 | 可见性最高、检索成本最低，但 token 成本与错误传播风险最高 |
| 跨层 | `Dreaming` / `sleep-time compute` | 空闲时回看日志：纠错、建表示、提升、按目标聚焦、跨 session 补缺 | 不是存储层，是维护机制；要花 compute，产物不立即可用 |

文章的一句核心洞见：**「记忆有时是对未来的预测」**——写下一条规则，就是预测这个 pattern 未来还会相关；写下一条已验证事实，就是预测未来的 session 会直接依赖它而不复核。这正是组织内「规则沉淀」的本质，也是本仓库把知识做成 `candidate → confirmed → withdrawn` 的原因。

文章特别强调顶层必须小：`Claude Code auto memory` 只把 `MEMORY.md` 的**前 200 行 / 25 KB** 加载进每个 context window，这个 header 只作为索引（告诉模型「它知道什么、去哪里找」），细节下移、只留链接。原因有三：占用 token、错误 note 会被带进每个 session、长 instruction 文件会降低遵循度。

### 1.3 Dreaming 的六个方向

① 用 transcript 纠正错误 note；② 构建 wiki 等表示层；③ 把 note 提升到 injected；④ 按特定目标塑造记忆增长；⑤ 跨 session 找共同模式、修正共同错误、补齐悬空链接 / 缺失页；⑥ 总体整理（合并重复、检查断言出处、裁剪、改指链接）。

## 2. 支撑结论的评估数据（原文图注）

| 评估 | 关键数据 | 说明的组件 |
|---|---|---|
| `CL-Bench 1.0` 数据库任务 | 无记忆基线 → 有记忆目录：`Opus 5.5 0.655→0.838`、`Sonnet 5.5 0.644→0.833`、`Opus 5 0.564→0.828`、`Opus 4.7 0.383→0.700` | 规则沉淀的 learning loop：失败 → 假设 → 验证 → 规则 |
| steering 对照 | 硬性规则 `record only failures` 使 `Opus 5` 的记忆增益 **−0.234**；`Sonnet 4.6` 加「先读记忆、显式验证假设」后 `0.330→0.364→0.641` | 强模型给自由度更好；弱模型才需要细指令（本仓库不适用） |
| `Pokémon Red` salience | 约 1 万步时 `Sonnet 3.7` 写了 **413 个文件 / 225 个目录 / 977,930 字符 / 1 枚徽章**；`Fable 5` 只有 **10 个文件 / 43,406 字符 / 4 枚徽章** | 不要把随时可从环境读出、快速过期的状态写进记忆；要写策略、计划、验证过的规则、陷阱 |
| Mt. Moon 纠错 | 错误记下 PokéCenter 方位后，未纠正的 run 三次掉下单向坡、回退到 Pewter；`Dreaming` 对照 transcript 改写 note 后在 action 1,935 抵达 Cerulean | transcript 是校验 note 的 ground truth |
| `Stainless` 内部文档 | 约 350,000 文件 / 420M tokens / 25 个问题 / 128 个 Dreaming session；`wiki alone 13%→48%`，`wiki + search 54%→61%`，`search alone 53%`，每题省约 20,000 tokens | 组织知识地图的价值与增量维护 |
| `Harvey LAB` / 并购文档 | 24 个跨文档、需判断或计算的问题：`wiki 87%` vs `search 73%`；而 57 条单文档文本检索即可回答的 criteria，wiki 无明显增益 | **wiki 不是万能**：对单文档可解任务反而多余 |
| 合同任务与 reflection loop | 多 agent 共写 shared table 互相覆盖，只有 `41/57` facts 存活、brief 满足 `72%`；改为「每份合同独立页、单一 agent 写、条款逐字引用」后 `57/57`、`100%` | 「什么信息最重要」本身必须沉淀成规则 |
| 地图失控（Figure 12） | 语料 10 份文档 / 115 KB，wiki 长到 **68 页 / 255 链接 / 203 KB = 语料的 1.77 倍**，且存在无链接页 | 表示层必须裁剪，否则「抽象了等于没抽象」 |
| 第二次 Dreaming pass（Figure 15） | `38 条 / 225 链接` → `41 条 / 278 链接`；9 个指向不存在页的链接被改指，新增 index / instructions / escalations 页 | 跨 session 补缺与链接维护 |

## 3. 逐层对照本仓库现状

| 文章组件 | 本仓库实现 | 判断 |
|---|---|---|
| `transcripts` | `.runtime/memory/events.jsonl` + routing trace，`MemoryLog` / `bridgeRoutingEvent` / `readBridgedEvents` / `replayMemory` / `memory-checkpoint.ts` | ✅ **已有且更严**：幂等 id、`causedBy` lineage、按主体精确撤权、integrity 如实记录重复与悬空、增量与全量 checksum 逐字节对照、`assertDeterministic()` + `modelCalls=0` |
| `memory notes` | `Knowledge`（`candidate / confirmed / withdrawn`、HMAC 签字、修订钉住、`expiresAt`、最多 8 份 attach）、`context-note` 快照、`validatedRule` | ✅ **治理更严**（真人采用、撤回、版本）；❌ 原缺口：知识记录没有 `evidenceEventIds` 挂靠主干、没有「如何知道它为真」与陷阱字段、没有统一的规则沉淀入口 |
| `wikis` 表示层 | `knowledge-edges.ts` 的图边 / `impactOf()`、`ontology.ts` / `graph.ts`、`TeamMemory` 检索 | ❌ **真缺口**：没有 page / link / index 形态，没有链接完整性检查、重复合并、断言出处核对、规模护栏 |
| `injected context` | `TaskContext.collect()`（192,000 字节**一次性** Pack）、`selectPassage` / `retainFacts` 逐源裁剪、`buildContextPack()` 的 refs + labels | ⚠️ 已有预算与裁剪，但语义不同：这是「本轮输入包」，不是「每会话常驻的小索引」；缺「顶层只留指针、细节下移」的硬规则 |
| `Dreaming` | `memory-checkpoint.ts` 增量重放 + 全量回退、`memory:replay`、C-6 的反思循环 / 工程闸门 / 候选改进 | ⚠️ 有重算与反思；❌ 无「回 transcript 纠正 note」、无跨 session 补缺、无提升 / 降级、无按访问频次的 cadence |
| 让模型判断 salience | 确定性工程层，`assertDeterministic()` 非零即拒绝 | ⛔ **不照搬**：需外部模型调用，与 `modelCalls=0` 及「未配外部端点」现状冲突 |

**结论：架构主干不用补，缺的是「约束上层的规则」与「知识表示层的形态」。** 文章的四层在本仓库其实是「一个 append-only 主干 + 四类投影 + 一次性 Context Pack」，已经覆盖了底层和读取侧；但**上层怎么才算可交付、谁准它进入每会话上下文、错了怎么被发现**，此前没有机器化守门。

## 4. 按价值排序的差距清单

| # | 差距 | 建议做法 | 前置条件 / 红线 | 本轮状态 |
|---|---|---|---|---|
| 1 | 知识记录无法回到原始事件校验 | 候选带 `evidenceEventIds`；悬空 / 已撤回 / 重复证据一律拒；`confirmed` 必须有真人签字 | 若接 `KnowledgeService.propose` 需向后兼容既有文档 | ✅ 已落纯函数 `assertGroundedNotes`（未接真实 Knowledge） |
| 2 | 知识表示层无链接 / 索引 / 出处 / 规模护栏 | page + link + claim 事件；体检列出悬空链接、孤立页、重复主题、无出处断言；超过原始语料即拒绝 | 需先决定 wiki 落在哪（宿主文档 or 投影），不改主干 | ✅ 已落 `wikiReport` / `assertWikiRepresentation` |
| 3 | 顶层缺「小 + 只留索引」硬规则 | 默认 200 行 / 25 KB；只放已签字且真人批准提升的条目标题与 `note:` 指针 | 与 192,000 字节一次性 Pack **分工并存**，不要混成一个东西 | ✅ 已落 `buildInjectedIndex` / `assertInjectedIndex` |
| 4 | 离线整理没有「只提建议」的契约 | 产出确定性、只读、待真人复核的建议；禁止 `confirm-note` / `delete-event` / `accept-acceptance` / `rewrite-transcript` | 接 C-6 候选改进闸门 + 人审，绝不自动生效 | ✅ 已落 `dreamProposals` / `assertDreamProposals` |
| 5 | **外部参考没有进入知识沉淀链** | 参考材料与自研结论走同一条候选链：来源 URL + 阅读 / 对照事件 + 红线警告，且只能是候选 | 采用仍是独立真人动作 | ✅ 已落 `referenceAsMemory` / `assertReferenceSedimentation` |
| 6 | 规则沉淀没有统一结构 | 规则 = 结论 + 依据 + 「如何知道它为真」+ 陷阱警告 + 恒为候选 | 与 `Knowledge.kind='procedure'` 对齐即可 | ✅ 已落 `validatedRule` |
| 7 | 缺行为级评估：冻结快照评分器 / 双臂统计旗标 / tool-choice 回归 | 复用 `replayRouting` / `memoryReplayReport` / `compareEffects()` 做确定性评分器 | 需要真实业务单或外部模型端点才有对照臂 | ⏳ 与 `HANDOFF/08` 第 12 条 OpenMausBot 差距清单合并待拍板 |
| 8 | 整理 cadence 与「聚焦易变信息」 | 按记忆被访问频次调 Dreaming cadence；只复核 likely-to-change 条目 | 需要运行时遥测，本仓库暂无 | ⏳ 未做，不建议先做 |

第 1–6 项**零新上游、零外部模型、零 npm 依赖**即可落地，因此本轮直接做成代码；第 7、8 项需要产品拍板或外部凭据，列入 `HANDOFF/08` 第 13 条。

## 5. 用户点题：参考本身就是记忆，而「算不算记住了」必须是一条规则

文章把记忆定义为「跨 session 保留、之后可读回的知识」。按这个定义，**本仓库每次外部调研写下的评估报告本身就是组织记忆**——但此前它只是散落的 markdown，没有进入 `candidate → confirmed → withdrawn` 链，也没有任何机制能回答「这条结论当初凭什么写下」。

本轮把这句话落成两条可执行的规则：

- `referenceAsMemory()`：外部材料要变成一条 `MemoryNote`，类别 `reference`、状态**恒为 `candidate`**，必须带可核对的来源 URL、阅读 / 对照过程的原始事件 id、「如何知道它为真」，以及三条红线警告（不复制正文或代码、必须真人采用才生效、不得据此放宽人签或启用外部模型）。
- `assertReferenceSedimentation()`：焊死「只能是候选、不得带签字字段、必须有事实源与红线」。**采用是后续独立动作**，和 `KnowledgeService.review()` 的人签语义一致；离线整理（`Dreaming`）只能提出 `promote-note` 建议，不能替人把它提升到注入层。

换句话说：**「参考」不是写进文档就完事，它和组织自己产出的规则走同一条沉淀链、受同一套规则约束**——这正是用户说的「在组织内沉淀知识，也可以说是记忆，然后的一种规则」。

## 6. 本轮落地（P-7）

新增（全部纯函数，无 IO / 网络 / 时钟 / 模型调用）：

- `src/memory-hierarchy.ts`：四层常量、挂靠校验、规则与参考沉淀、wiki 体检与护栏、注入索引与预算、离线整理建议、`assertNoTranscriptRewrite`、只读汇总 `memoryHierarchyView()`。
- `tests/memory-hierarchy.test.ts`：20 例契约测试。
- `scripts/memory-hierarchy-smoke.ts` + `npm run memory:hierarchy`：16 项隔离真跑，其中 C2 用确定性数据复现文章 Figure 12 的 **1.77 倍「地图」失败**，F3 核对真实 `.runtime/memory/events.jsonl` 行数前后不变（40 → 40）。

**如实边界**：这些是**守门与契约**，尚未接到真实 `Knowledge` 文档、`Context Pack` 或 wiki 落盘；没有新增只读 action、没有改控制台、没有改任何既有投影 / 撤权 / 人签逻辑，也没有引入第 8 个上游或 npm 依赖。默认仍是 `loop` + `paperclip`，SUI-129 真人验收仍未发生。

## 7. 明确不照搬

| 文章机制 | 不照搬的原因 |
|---|---|
| 让模型自己判断 salience、只说用途不说做法 | 本仓库是确定性工程层，`modelCalls=0`；外部模型端点与凭据仍待拍板 |
| 自动把 note 提升到 injected、自动确认 / 自动批准 | 违反「Agent 可提出改进但不能自己让改进生效」与「原发起人在原会话中文确认验收」红线 |
| TTL / 物理删除式遗忘、transcript 压缩 | 本仓库撤权是状态写入、主干 append-only；历史不回溯改写（`assertNoTranscriptRewrite`） |
| 由模型自动构建 / 裁剪 / 改写 wiki | 候选改进须过工程闸门 + 人审 + 版本 + 灰度 + 可回滚；本轮只产出建议 |
| 把一次性大 Context Pack 当成每会话注入层 | 两者语义不同：前者是本轮输入证据并带输入清单，后者是常驻小索引；混用会让顶层膨胀且错误扩散 |
| 复制原文段落或代码 | 文章无开源许可证，© 2026 Anthropic PBC，仅作思想参考 |

## 8. 来源登记与合规

- `sources.lock.json` 新增 **`conceptReferences`** 段（与 `sources` / `protocolReferences` 分开）：记录 URL、发布日期、作者、权利说明、只借思想的用法、涉及文件。**不是 submodule、不是 gitlink、不是第 8 个上游**；`THIRD_PARTY_NOTICES.md` 与 `docs/SOURCES.md` 同步登记，`docs/OPEN-SOURCE-COMPLIANCE.md` 增加一行结论，`scripts/audit-upstream.ts` 增加机器化校验（概念参考不得混入 `sources`、不得声明可复制代码、七个子模块数量不变）。
- 说明：**R7 六步针对代码 / 依赖**（精确版本、LICENSE 原文、NOTICES、lockfile integrity、SOURCES、审计脚本）；网页文章没有可留存的许可证原文，因此按 `conceptReferences` 走「登记 + 审计 + 零代码引入」的等价口径，不伪造 LICENSE 文件。
- 原文提到的两份官方 cookbook（dreaming 入门、knowledge wiki quickstart）本轮**未拉取、未引入**，仅作为将来若决定做第 7 项时的线索；届时必须重新走完整许可证评估。

## 9. 待拍板

见 `HANDOFF/08` **第 13 条**：是否把 P-7 的守门接到真实 `Knowledge` 文档 / `Context Pack` / wiki 落盘（需先定存储位置与向后兼容迁移），以及是否启动第 7 项行为级评估体系。接手者不要把「已写成纯函数」当成「已接入生产链」。
