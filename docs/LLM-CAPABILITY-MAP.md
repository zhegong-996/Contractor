# LLM / 多模态能力地图与口径更正

> 本文是一份**自我更正**：此前交付说明里「评审默认程序判定、不用 LLM」的说法，
> 把「模型网关被写死关闭、还没做模型化评审」包装成了「评审本来就不需要模型」。
> 这个口径不诚实，特此更正，并给出与三个上游项目的精确对标。

## 1. 一句话结论

这个系统目前的 LLM 出现在**执行**（codex/claude 外部 CLI）、**知识实体抽取**（Cognee + DeepSeek）
和**视觉评审**（DeepSeek `deepseek-flash`，第四十八轮接入）三处。**路由、准入、判定**仍是零模型的
确定性规则——这部分是刻意保留（结构性判定比 LLM 更可靠），不是缺口；但**视觉/语义评审**此前是缺口，
已在第四十八轮补上。

## 2. 上游项目用模型的真相

| 项目 | 中间过程是否用模型 | 证据 |
|---|---|---|
| DeepSeek SuperAgent | 是 | `assessor` 用模型判断 inferred 候选；`router`/`worker` session 全是 LLM；router/assessor 与 worker 模型**分开设置** |
| LobeHub Acceptance | 是，**强制视觉模型** | 独立 `Acceptance Model` 槽位（评审模型 ≠ 写作模型）；选择器「只会列出支持视觉输入的模型」；「看不见图像的评审模型就会放行」；交付报告含截图+录屏+日志 |
| Agent AutoLoop（AegisFlow） | 混合 | 哲学「harness 拥有权威、模型不得自报」；但 `reviewer` 是更强的独立模型（`claude --model opus`）做只读对抗评审；`writer/reviewer/verifier` 三种子代理角色 |

共同点：**「中间过程」的语义/视觉判断确实由 LLM（部分强制多模态）承担**；
结构性判定（编译/测试/schema/哈希）则普遍保留在确定性 harness 里。

## 3. 本系统 LLM 调用点地图（真实）

| 环节 | 用模型 | 载体 | 状态 |
|---|---|---|---|
| 执行 Agent | ✅ | `assistant-turn.ts` spawn codex/claude CLI（用各自 key `~/.codex` `~/.claude`） | 已用 |
| 知识实体抽取 | ✅ | `cognee-native.ts` → DeepSeek key（`.runtime/cognee-env.json`） | 已配 `sk-358…` |
| 语义召回 | 半 | `semantic-recall.ts` → Apple 本地 300 维词向量（**非 LLM**，是嵌入） | 本地嵌入 |
| **评审（视觉/语义）** | ✅ | `visual-review.ts` `ExternalVisionAdapter` → DeepSeek `deepseek-flash`（视觉语义判定） | 第四十八轮接入 |
| **评审（结构）** | ❌ | `TraceEvidenceReviewer` 确定性证据绑定（哈希/来源/可回放） | 刻意保留：结构判定更可靠 |
| **路由 / 准入 / 判定** | ❌ | 确定性规则（`admission.ts` / `pass-through.ts` / `router.ts`） | **零模型** |
| **模型网关** | — | `model-settings.ts` `externalRequestsEnabled: z.literal(false)` | **写死关闭** |

## 4. 关键判断：哪些评审该用模型、哪些不该

来源：arXiv 2607.25152「progress mirage」+ AegisFlow 设计原则。核心一条：**成功信号在哪，谁就该来验。**

- 成功信号在 **artifact 里**（编译、schema、哈希、清单项齐全）→ 程序判定**更可靠**；LLM 评审存在「AI 骗过 AI 评审」的自我确认偏误，反而更差。
- 成功信号在 **transcript 外**（截图符不符合设计、录屏演示对不对、文字传没传对意思）→ **必须**视觉/语义模型；程序盲评会放行，生成一份让人误信为真的绿报告。

结论：正确姿势不是「把评审全换成 LLM」，而是——
**程序判定管结构，视觉/语义模型管内容，两边分开，且评审模型 ≠ 写作模型（独立槽位）。**

本系统目前：结构判定做得很细（体检 55 条全绿），「transcript 外」那半是空（`vision:false` 是缺口不是选择）。

## 5. 差距与补法（分三层，克制地补）

1. **模型网关**：把 `externalRequestsEnabled` 从 `z.literal(false)` 改为可配置（`z.boolean()`）。
   这是「打开一扇故意关着的门」，不是补漏配；需要用户指定 provider 并提供统一 key。
2. **评审模型化（对齐 LobeHub）** ✅ 已完成（第四十八轮）：新增 `ExternalVisionAdapter`，
   `semanticJudgement:true` 时把截图交给 DeepSeek 视觉模型判内容；没有 key 时诚实报错不假装。
   借鉴 LobeHub「独立 Acceptance Model 槽位 + 只列视觉模型」，评审模型（deepseek-flash）≠ 写作模型（codex/claude）。
3. **assessor 模型化（对齐 SuperAgent）**：SuperAgent 的 inferred 候选由模型判断，我们是程序规则。
   保留程序规则兜底，加一个可选的模型 assessor 处理程序判不准的模糊候选。

风险（必须写进实现，不能踩）：
- LLM 评审与写作同源会自我确认 → 评审模型必须独立于执行模型。
- 视觉评审按量计费 → 需配 per-run 文件数上限 / 成本闸（LobeHub 明确提到）。
- 「评分不是判定」→ 模型给出的 confidence 是给判定者的信号，不是判定本身。

## 6. 实体对标（此前「没有 Skill 知识库实体」的说法同样不准确）

| 实体 | 文件 | 规模 | 状态 |
|---|---|---|---|
| Skill 能力包 | `skill-pack.ts` | 139 行 | 最小版；定位收窄为「验收标准/自查清单的可版本化载体」，非技能市场 |
| Skill 目录 | `agent-definition.ts` `skillCatalog` | 32 行 | 已定义 |
| Agent 服务目录 | `agent-registry.ts` + `agent-services.ts` + `service-network.ts` + `service-status.ts` | 324+71+… | 完整实现 |
| Evolution | `evolution.ts` | 486 行 | 完整；但明确「工程层 modelCalls=0，AI 层只接判不准的少数」 |
| Ledger 台账 | `evolution-ledger.ts` | 325 行 | append-only，完整 |

## 7. 待用户拍板

1. 是否打开模型网关？若是，用哪个 provider（DeepSeek / Ark / OpenAI / Anthropic / Gemini）？
2. 是否接入视觉/语义评审？需要视觉模型（截图判内容）的 provider 与 key。
3. 这两项都涉及「真实花钱 + 接外部服务」，不由交付者单方面决定。
