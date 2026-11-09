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

测试：**681 / 681**（第四十轮 639；本轮新增 34，同日两次补记再 +3、+2）。

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
全部 681 例测试、类型检查与本机服务都在该版本跑通。所以 preflight 默认**只警告不拦**，
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
| `npm test` | **681 / 681** |
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

## 10. 飞书部门授权：真跑一次，并修掉一处误报（同日补记）

用户指令：「飞书授权下」（随后「再来一次」「A」「好了」）——把一直挂在待拍板里的
「飞书部门 scope 需本人扫码」真做一次。

**过程与结论**

| 步骤 | 结果 |
|---|---|
| 查现状 | 用户身份 162 个 scope，只有 `contact:user.*`，缺 `contact:contact.base:readonly` / `contact:department.organize:readonly`；`departmentScopeMissing: true` |
| 第一次发起 | 照 `ORG_AUTH_HINT` 字面只传了两个新 scope（**错误**，见下） |
| 纠正后发起 | `npm run org:auth -- --execute`：读当前 token 拼出 162 + 2 = 164 个 scope |
| 扫码完成 | `newly_granted` 正好两个、`missing: []`、162 个既有权限全在 `already_granted` |
| 重跑预览 | 成员 3 → **4**（补上从没聊过天的林恒昌），`departmentScopeMissing: false`，`missingScopes: []` |

**踩到自己埋的坑**：`ORG_AUTH_HINT` 是一个裸命令，照它执行会**整体替换** scope、
清掉 100+ 既有权限（`scripts/org-auth.ts` 文件头早就写明了这点，是我没先读）。
用户那次刚好遇到链接过期没扫成，才没造成实际损失。已把这条差异记在这里，
下一个人应当使用 `npm run org:auth`，不要照 `ORG_AUTH_HINT` 抄。

**顺带修掉的两处实现问题**

1. **成员读不全**：原实现只调 `contact +search-user --has-chatted`，等于「只认识聊过天的人」。
   授权后改为先读部门树、再按部门列成员，`--has-chatted` 降为补充。实测多认出 1 人。
2. **误报缺权限**：原判据是「所有人都没有 department → 判定缺 scope」。
   但这个租户**根本没建子部门**（根部门 4 人、`departments` 返回空），
   于是权限已经到位却仍提示去重新授权。现在拆成两个字段：
   - `departmentScopeMissing`：只在「确实缺 scope **且** 无人有部门」时为 true；
   - `departmentStructure`：`tree` / `flat` / `unknown` + `departmentNote` 中文说明。
   扁平租户如实说「成员都挂根部门下，部门为空是组织现状，不是权限缺失」，不催人重复授权。

**验证**：`npm test` **676/676**（+3 例新增契约）、`tsc` 0 错、真实 `npm run org:preview`
读到 4 名成员、`departmentStructure: flat`、`departmentScopeMissing: false`。
`/health` 返回 `feishu: ready`（顺带发现 bridge 已连续 185 次重连失效，重启后恢复）。

**边界不变**：部门读到了也不改派单、不写职能注册表；草案仍需人工确认 + 携带注册表修订号导入。

## 11. 组织映射：查出一处「读错应用」的真实缺陷（同日补记）

用户交代「都在产研，龚哲是 ceo 权限最大」，并问「飞书可以设置然后映射过去吗」。
在准备导入组织表时查出：**读组织的应用与收消息的机器人应用不是同一个**，
草案里的 open_id 因此无法用于派单匹配。

**事实与证据**

| 项 | 值 | 来源 |
|---|---|---|
| 收消息的机器人应用 | `cli_aa61f940a0e15cf4` | `.runtime/config.json` 的 `feishu.appId`；`feishu-pairing-evidence.json` |
| 读组织用的应用（今天实际用的） | `cli_aab018d4daf8dcc7` | `lark-cli auth status` 的默认 profile；草案里的 `appId` |
| 同一人两个应用下的 open_id | 龚哲：`ou_277c…`（机器人）vs `ou_9b70…`（读组织） | 配对证据 vs 草案 |

`open_id` 按应用隔离，这是飞书的规定，不是本项目选择。所以今天这份草案虽然读到了 4 人，
但其中 3 人的 id 属于另一个应用：**导进去会「人在册、派单匹配不上」**，
而且从界面上看不出来 —— 这正是最该避免的一种假成功。

**已落地的防呆（结构而非自觉）**

- `src/feishu-org.ts`：新增 `idScopeVerdict(appId, botAppId)` 纯函数与
  `botAppId` / `idScopeMismatch` / `idScopeNote` 三个草案字段；读不出任一侧不算冲突。
- `scripts/org-mapping.ts apply`：草案 `idScopeMismatch === true` 时**直接拒绝导入**，
  除非显式 `--force-foreign-app`。拒绝发生在发请求之前，不留半份映射。
- `src/v06.ts`：工作台的组织映射面板透传这三个字段，界面上能直接看到为什么不能导。
- 契约测试 +2：`idScopeVerdict` 四种组合；`org:apply` 的拒绝先于请求。

**要真正完成映射，缺的是机器人应用的通讯录权限**（不是飞书里建部门）：

当前机器人应用读部门返回 `40004 no dept authority`，读指定成员返回 `41050 no user authority`
（只能读与它有会话往来的人，龚哲因为配对过所以可读）。补齐下面两个权限后，
用 `--profile ai-native-collab` 的 user 身份重读，`idScopeMismatch` 会自动变 false：

```
https://open.feishu.cn/page/scope-apply?clientID=cli_aa61f940a0e15cf4&scopes=contact%3Acontact.base%3Areadonly%2Ccontact%3Adepartment.organize%3Areadonly
```

替代路径（不改应用权限）：让许家豪、刘玉顺、林恒昌各给机器人发一条消息，
我就拿到他们在**机器人应用**下的真实 open_id，再导入。

**「权限最大」不经过飞书**：当前安装 `deploymentMode = local_trusted`，
只有 `local-board` 一个操作者，原生成员目录为空（`team-members.users = []`）。
飞书身份只承担两件事：消息入口白名单（`allowedSenders`）与配对身份，
不携带任何系统权限。要按人分权限，得先把安装切到多用户认证模式。

**顺带发现**：检查期间 paperclip（3100）实际已停止（`/health` 连接被拒），
bridge 的 `/health` 只是回显配置、并不探活下游。已用 `scripts/up.ts up` 拉起，
`/api/health` 为 `status: ok / deploymentMode: local_trusted`。

### 补记：把读取链路修到「加权限就能生效」

上一节只查出了「读错应用」，但只加防呆不够 —— 即便管理员把机器人应用的通讯录权限补齐，
原实现仍然不会读到正确数据，因为两处硬编码把路堵死了：

1. **不传 profile**：`defaultCommand` 直接调 `lark-cli`，落到默认 profile 的另一个应用。
   改为 `larkArgs(profile, args)` 统一前置 `--profile <config.feishu.profile>`。
2. **身份写死 `--as user`**：user 身份需要人扫码登录，而机器人应用自己就有 tenant token。
   改为 `contactRead()` 先试 `--as bot`、失败再退 `--as user`。用机器人身份读到的人，
   open_id 与收消息时是同一应用，可以直接派单匹配 —— 这条路径打通后**不需要任何人扫码**。

配套的可读性修正：

- `conciseCliError()`：lark-cli 报错时以非零码退出、把整段 stderr（含完整命令行）抛出来，
  原样塞进 `departmentNote` 会变成一大坨噪声。现在只取 `error.message`，例如
  「no dept authority error」。
- `departmentScopeMissing` 判据补上 `!tree.ok`：部门树压根读不到 + 确实缺 scope，就是缺权限；
  租户扁平（能读、但没有子部门）仍不算缺权限。
- 新增 `authorizationUrl`：缺权限时直接给开放平台的权限申请页，scope 已经填好，
  不用人再去权限列表里找。
- `ORG_AUTH_HINT` 从裸命令改成 `npm run org:auth` —— 裸命令会整体替换 scope、清空既有授权，
  这正是前一天踩过的坑，不该再留在提示里。

**真实结果**（`npm run org:preview`）：`appId = botAppId = cli_aa61f940a0e15cf4`、
`idScopeMismatch = false`、`members = []`、`departmentNote = no dept authority error`、
`authorizationUrl` 指向机器人应用的权限申请页。**这比之前那份「4 个人但 id 不能用」的草案诚实**：
现在它明确说「没权限」，并给出补齐的方法。

契约测试 +3（profile 前置、申请页编码、错误正文提取），`tests/feishu-org.test.ts` 15/15。
