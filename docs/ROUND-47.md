# 第四十七轮：V2/V5/V6/V7 收口 + 模型 key 现状澄清

> 用户指令：「V2、V5、V6、V7 全部做完，以及看一下 Agent 相关、Skill 知识库，为什么都没有模型 API key。」

## 0. 先回答「模型 API key」——不是漏配，是分层设计

| 谁用 LLM | key 在哪 | 状态 |
|---|---|---|
| 执行 Agent（codex / claude） | 各自 CLI 自己的凭据（`~/.codex`、`~/.claude`） | 委托外部 CLI，系统刻意不持有 |
| 知识抽取（Cognee 原生管线） | `.runtime/cognee-env.json` → DeepSeek | ✅ 已配 `sk-358…` |
| 评审（reviewer） | 默认**程序判定**（`semanticJudgement: false`），不用 LLM | 不消耗 key |
| 模型网关（系统自己跑 Agent） | —— | ❌ **关闭**（`externalRequestsEnabled: false`） |

结论：`model-settings.ts` 注释写死「现有 CLI 执行保持不变，直到显式授权、测试过的模型网关开启」。
系统现在**不直接调 LLM 跑 Agent**，把活派给外部 CLI。要「系统自己调模型跑 Agent」需开启模型网关，
单独一轮做，且要用户给统一 key / 指定 provider。

Skill 知识库：能力在（`agent-services.ts` 服务目录 + Multica 式 Skills 的落点是 evolution-ledger），
但没有独立的「Skill 知识库」实体——这是另一个可补的方向，未在本轮。

## 1. V2 产物可信（落地）

`src/artifact.ts`：`registerArtifact` 登记时对「修订号 + 任务 + 产出者 + 摘要」算内容哈希存 `seal`；
新增 `verifyArtifactRevision` 校验篡改。交付产物 revision 本就是 commit sha（天然哈希），
这里补的是**非 git 元数据的完整性**（摘要、产出者）。

## 2. V5 超时升级（落地）

`src/escalation.ts` 新增 `timeoutEscalation` 纯函数：悬置超时（默认 24h，可配）升级给**该域 owner**；
域没有 owner 就明说「需要人指定」，不静默挂着。通知仍走既有 `escalationGate`（去重 + 限速），
升级只产出「该找谁」。

## 3. V6 密钥钥匙串（可选增强，落地）

`src/keychain.ts`：`keychainAvailable / get / set / delete / migrateToKeychain`，封装 macOS `security`。
**默认仍是文件**（0600），钥匙串是「共享/多机场景」的可选迁移，`migrateToKeychain` 显式调用才迁移。

## 4. V7 多机一致性（诚实收尾，未硬做）

完整落地 = 把主题/产物/巡检/决策点的存储从本地 `.runtime/v06` 迁到 PostgreSQL（paperclip 已是 PG 底座）。
前提已具备：这四个模块的存储都走 `runtime('v06')`，而 `runtime()` 支持 `COLLAB_STATE_DIR` 重定向，
即**指向共享挂载/网络盘就能多机一致**（弱一致），强一致需迁 PG。

为什么这轮不硬迁：单机部署下无法验证多机行为，迁了也是「没验证的复杂改动」。
真正多机部署时再按「文件 → 共享挂载 → PG」三步走，逐步验证。

## 5. 体检 53 → 55

| 新增 | 分类 | 钉住 |
|---|---|---|
| `artifact.seal-detects-tamper` | 验收 | 登记即盖章、改摘要检出、旧数据不阻断 |
| `escalation.timeout-escalates-to-owner` | 路由 | 未超时等、超时升级给 owner、无 owner 明说 |

## 6. 验证

`npm test` **719/719**、`tsc` 0 错、`audit:layers` **55 条 ok 55 / partial 0 / gap 0**。

## 7. 边界（诚实）

- V6 钥匙串是「可选增强」，默认文件不变；单机本地下价值有限，多机/共享机器才有意义。
- V7 只做到「重定向前提已具备 + 迁移路径」，没有硬迁 PG（单机无法验证多机一致性）。
- 模型网关（系统自己调 LLM 跑 Agent）是关闭的，开启需单独一轮 + 用户给 key。
