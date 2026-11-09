# 第四十一轮：五项差距收口（2026-11-09）

> 用户指令：「先收口差距，做好了再说」
>
> 「差距」指第四十轮 `docs/ROUND-40.md` §8 与 `docs/BENCHMARK-3UPSTREAM.md` §5 列出的五项
> （准入强度 / 报告交互 / 订阅生命周期 / 规则视图 / 安装体验）+ 体检里唯一的 partial（知识读边界）。

## 1. 结果

| # | 差距 | 状态 | 落点 |
|---|---|---|---|
| 1 | 准入强度三档（explicit / inferred / not admitted） | ✅ | `src/admission.ts` · 接入 `collaboration-intake.ts` · `agent.admission-three-tiers` |
| 2 | 报告内讨论 + 区域点选 | ✅ | `src/acceptance-discussion.ts` · `v06-acceptance-discussion-*` · 控制台验收视图 · 2 条体检 |
| 3 | 订阅 hand-back / release | ✅ | `src/subscription.ts` · `pass-through.ts`（8 种判定）· `controller.ts` 释放留痕 · 2 条体检 |
| 4 | 配置收敛为一份规则视图 | ✅ | `src/rules-view.ts` · `npm run rules:view`（只读，不改运行时） |
| 5 | 一条命令安装 | ✅（有边界） | `src/bootstrap.ts` · `npm run bootstrap`（`--dry-run` / `--no-start` / `--strict-node`） |
| 6 | 知识读按业务域收窄 | ✅ | `knowledge-authz.ts` `canReadKnowledge` 第 4 参 `readerDomains` · server 注入读方域 · `knowledge.read-scoped-by-domain` |

体检：**45 条 ok 45 / partial 0 / gap 0**（第四十轮 40 条 ok 39 / partial 1）。partial 清零。

测试：**673 / 673**（第四十轮 639，本轮新增 34）。

## 2. 准入三档：不是「多一个开关」，是把「没有下文」补成一条说明

之前只有两档：白名单放行 / 抛 `Unauthorized`。中间那档缺失的后果很具体——通道认识这个人、
但还没有实名落点，消息进来既不处理也不解释，发消息的人在和机器人单聊里发完就没了下文。

| 档位 | 证据 | 处理 | 成员身份 |
|---|---|---|---|
| `explicit` | 已配对出在职成员；或单负责人安装里白名单唯一登记的那个人 | 走完整链路 | 前者是，后者否 |
| `inferred` | 配对记录还在但身份失效；或多人白名单里未配对 | 只回一条配对指引 + 留待确认审计 | 否 |
| `not-admitted` | 通道也不认 | 拒绝，只留审计，不回话 | 否 |

结构化保证：`memberContext` 只有「配对成立 + explicit」才 true；`inferred` 返回值恒 false，
且没有可传给下游的权限字段。`tests/admission-subscription.test.ts` 用 6 元组穷举钉住这条不变式。

**没有做的事**（刻意）：不让 `inferred` 自动推断出是谁然后放行。自动推断等于自动授权。

## 3. 订阅生命周期：释放要有事实，交回要有名字

- **释放**：验收回执落库时写 `subscription.released`（两处：代码交付验收、按清单确认验收）。
  直通据此报 `released`，而不是靠「phase 恰好是 accepted」顺推——否则「什么时候释放的」查不到。
- **交回**：补充说明命中「改授权面」的四类意图（改清单 / 换人 / 加权限 / 换来源）时不接续、不塞进执行端上下文，
  原样交回主链路（`routed:false` → Controller），并留 `subscription.handed-back` 审计 + 一条回执说明。

越界识别刻意收紧：只认四类明确说法，**宁可漏、不可误**。误判会把正常补充说明推去建新单；
漏判只是沿用原链路。单测同时钉住 4 条越界样本与 4 条正常样本（含「刚补充了验收要求，请继续核对」）。

## 4. 报告内讨论 + 区域点选

- 讨论可挂在检查项 / 具体区域（序号 0-7，与证据区域上限一致）/ 整份报告；
- **追加式**：只能新增，正文上限 1000 字，作者必填；**没有修改正文的接口**；
- 只有 `resolvedAt / resolvedBy` 两个状态位可由人打；
- 工作台只带 `total / unresolved / byItem` 计数，**不改变就绪判定与逐项统计**（体检钉住）；
- 控制台：区域框是可聚焦 `button`、每个都有可读名字（`aria-label`），点选高亮 + 显示坐标与备注，
  并可直接就这一区域发起讨论。

如实边界：区域底板是「按本项坐标范围等比缩放」的定位板，不是原始截图——证据引用是事件 id，
事件流不存图片字节。

## 5. 规则视图：一份按问题组织的只读视图

`npm run rules:view` 把 `router` / `scheduler` / `eventInbox` / `agentRegistry` / 通道 / 验收 / 交付
七段配置读成「谁接这一棒 / 什么时候跑什么 / 谁能投进来 / 谁在岗 / 谁能说话 / 谁说了算 / 代码怎么上线」。

- 每行带来源路径（`config.router.mode`）与「显式配置 / 取默认值」标记；
- 并发配额、分组、降级理由直接复用运行时函数（`routineParallel` / `routineGroup`），不另写一套解释；
- `defaulted` 列表单独列出「没写、按默认跑」的地方——接手时最容易误判的就是这些；
- 纯只读：不写盘、不改运行时、不提供第二个写入口。

## 6. 一条命令安装：把机械步骤串起来，边界写清楚

`npm run bootstrap`：生成配置与密钥 → 装依赖 → 拉起本机服务 → 初始化公司与 Agent → 体检 → 契约体检。

- **幂等**：已存在的配置不覆盖、已装的依赖跳过、在跑的服务不重启；
- **失败即停**：哪一步失败就停在哪，打印原始错误并提示「修好后重跑同一条命令」；
- **dry-run**：`--dry-run` 只打印计划，不执行任何命令；
- **边界不藏**：建管理员（`console:owner`）、飞书授权、真实业务单仍需人做，装完直接打印出来。

**一个如实发现**：`package.json` 的 `engines` 写 `node >= 24.11`，但这台机器实际是 `v22.22.2`，
全部 673 例测试、类型检查与本机服务都在该版本跑通。所以 preflight 默认**只警告不拦**，
`--strict-node` 才按声明拦截。这个差异写在 `warnings` 里，不静默，也不偷偷改 `engines`。

## 7. 知识读边界：从 partial 到 ok

| 分区 | 读规则 |
|---|---|
| `personal` | 归属者本人 + 管理员档 |
| `org` | 登录可读 |
| `team` + 声明域 | 读方域与条目域相交才可读；管理员可总览 |
| `team` + 读方域未知 | 按协作区档位兜底（operator+ / worker+），viewer 被拒 |
| `team` + 未声明域 | 登录可读（历史数据兼容） |

读方域来源：agent 取 registry 生效范围；人取其实名个人 Agent 所在的知识空间域（与写链同一事实源）。
`knowledge-wiki` 同样按可读范围过滤，且**一旦过滤就不写共享盘投影**。

## 8. 验证

| 命令 | 结果 |
|---|---|
| `npm test` | **673 / 673** |
| `npx tsc --noEmit` | 0 错 |
| `npm run audit:layers` | **45 条：ok 45 / partial 0 / gap 0** |
| `npm run rules:view` | 七节输出正常，默认值单独列出 |
| `npm run bootstrap -- --dry-run` | 只打印计划，含版本警告与人工步骤（本机 config / node_modules / 服务都已就绪，故计划只剩 3 步；新机器上是完整 6 步） |
| `npm run console:smoke` | **ok:true / failed:[]，58 项**（含新增的验收区域点选与讨论卡片） |
| `npm run guard:smoke` | **22/22，golden 基线无漂移**（未重冻结） |
| `npm run router:smoke` / `agents:smoke` / `shapes:smoke` / `loop:smoke` / `evolution:smoke` | 31/31 · 43/43 · 36/36 · 18/18 · 45/45 |
| `npm run steps:smoke` / `host:pg` / `memory:hierarchy` | 61/61 · 24/24 · 16/16 |
| `npm run atlas:check` / `audit:upstream` / `git diff --check` | 11/11 · clean:true · pass |

## 9. 仍然存在的边界

1. 准入 `inferred` 不自动放行（取舍，不是缺功能）；
2. 越界识别只覆盖四类明确说法，措辞变化可能漏判（漏判 = 沿用原链路）；
3. 区域底板无内嵌截图，只有坐标定位；
4. 安装的建管理员 / 飞书授权 / 真实业务单仍需人做；
5. Node 版本声明与实际可跑版本不一致（按警告处理，未改 `engines`）；
6. 体检不探测网络（通道可用性见 `channel-health`）。
