# P0 · 主安装切多用户：迁移方案（待执行，带备份）

> 目标：把主安装从 `local_trusted` 换成 `authenticated`，让准入/RBAC/知识三分区/域判断第一次接触真实身份。
> 状态：**方案已摸清，尚未执行**——因为这一步会改变整个 `local-board` 信任路径，且主安装有真实任务数据，必须先备份、再验证、后切换。

## 0. 已核实的事实

- 模式由 `PAPERCLIP_DEPLOYMENT_MODE` 环境变量或 `server.deploymentMode` 配置决定，默认 `local_trusted`。
  （`upstream/paperclip/server/src/config-file.ts:75 resolveDeploymentMode`）
- 主安装 `scripts/paperclip.ts` 启动时**没有设**这个变量 → 落在 `local_trusted`。
- `authenticated` 模式下 `authReady = false`，必须有一个真实管理员账号 + 完成 bootstrap claim。
- 隔离的 team-pilot（3110）已经是 `authenticated`，并真实跑过 3 个用户（requester/owner/specialist）——
  证明「切换 + 建用户 + 分角色」这条链是通的（`scripts/setup-team-pilot.ts`）。
- **数据不会因切换模式而丢**：模式只是启动参数，PG 数据在 `.runtime/paperclip/instances/default/db` 不动。

## 1. 风险点（必须先处理的）

| 风险 | 说明 | 应对 |
|---|---|---|
| `local-board` 路径失效 | 切换后 `members.resolve('local-board')` 走 `local_trusted` 检查会失败 | 先建真实 admin，再把 bridge 的 adminToken 路径验证一遍 |
| CLI `api()` 依赖 adminToken | 大部分脚本用 `secrets().adminToken` 直接以 admin 身份过 bridge | 验证 authenticated 模式下 adminToken 仍解析为 admin |
| 飞书配对身份 | 现在飞书 open_id → 成员 的绑定是空的（成员目录空） | 切换后要把龚哲(ou_277c)绑定为第一个真实成员 |
| 迁移中断 | 重启期间 bridge/paperclip 短暂不可用 | 选低峰、先停服务再切换再起 |

## 2. 迁移步骤（先在本机复制一份演练，再动真）

1. **备份**：`cp -r .runtime/paperclip/instances/default/db .runtime/backup/paperclip-db-<date>`，校验大小非零。
2. **停服务**：`node --import tsx scripts/up.ts stop`。
3. **改启动**：`scripts/paperclip.ts` 增 `PAPERCLIP_DEPLOYMENT_MODE: 'authenticated'`（或写进配置），并记录 `local_trusted` 原值以便回滚。
4. **起服务**：`node --import tsx scripts/up.ts up`，确认 `/api/health` 返回 `deploymentMode=authenticated` 且 `bootstrapStatus=pending`。
5. **建管理员**：照 team-pilot 的做法 sign-up 第一个真实 admin（邮箱 + 密码），claim bootstrap，把龚哲的飞书 open_id 绑定到这个成员。
6. **验证**：`team-members` 能列出真实成员；准入/权限/域判断在真实身份下各跑一遍。
7. **回滚预案**：若验证不过，把 `PAPERCLIP_DEPLOYMENT_MODE` 改回 `local_trusted` 重启，数据无损。

## 3. 模拟（用户已授权「分饰多角」）

在**隔离 pilot（3110）**上，用 `scripts/setup-team-pilot.ts --run` 造 3 个真实用户，然后驱动：
- 两个 Agent（codex/manual）分别领活 → 产出 → 回系统；
- 一个跨域决策：产研 agent 想改增长口径 → 生成 DecisionPoint → 委派到增长域 owner → 回执。

这验证 G3 在真实多身份下成立，且不碰主安装。

## 4. 谁拍板

这一步不是纯代码，牵扯到真实账号、飞书绑定、服务切换窗口。**执行前我会再确认一次**，
尤其第 5 步「龚哲用哪个身份登录（邮箱/手机/飞书）」。

## 5. 「用飞书登录」的真实含义（补充，重要）

核实结果：paperclip 的原生登录是 **Better Auth 邮箱登录**（`/api/auth/sign-up/email`），
**没有飞书 OAuth**——它里面的 oauth 都是给 MCP 工具 / Slack / Muse 用的，不是用户登录。

所以「用飞书」在这个系统里的精确落法是**飞书作为身份绑定层，邮箱只作底层主账号兜底**：

1. paperclip 建一个邮箱主账号（native membership，principalId 由此来）；
2. 该成员生成配对码：`member-pair-code`；
3. 龚哲在飞书**单聊**机器人发 `/member-pair <32位码>` → 把 `ou_277c…` 绑定到这个成员；
4. 之后飞书就是主入口，日常完全用飞书，不需要记邮箱密码。

这条链能力现成（`members.ts` 的 `pairCode` / `acceptPair`，入站已识别 `/member-pair`）。

**要不要做真正的飞书 OAuth 登录？** 可以，但要给 paperclip 接 Better Auth 的飞书 social provider，
且飞书开放平台要再建一个「网页应用」OAuth。工作量大、还要飞书后台配回调域名。
建议先用「邮箱兜底 + 飞书绑定」，够用且立刻能做；OAuth 留作后续。

**执行前需要你给两样**：① 龚哲的邮箱（建底层账号，会被飞书身份顶替为主入口）；
② 确认可以短暂停一下服务（切换 + 建账号约 1-2 分钟窗口）。

## 6. 新增风险（核实后，比原以为的更重）

查 `src/controller.ts:55`：主安装的 paperclip 客户端是 `new Paperclip(config.paperclipUrl)`，**不带 token**，
靠 `local_trusted` 的 loopback 信任。paperclip 源码注释明确「TLS（或 local_trusted 的 loopback 对端）才免鉴权」。

所以**切 authenticated 不只是改个环境变量**：一切换，bridge → paperclip 的派活/执行/验收整条链会因缺 token 被 401 打断。

正确的 P0 顺序应是：

1. **子步骤 1（先在 local_trusted 下做，零风险）**：给 paperclip 客户端引入 board-token 机制
   （token 从 secrets 读，`controller.ts` / `runner.ts` / `platform-port.ts` 三处构造都带上），
   并验证「带 token 调用」在 local_trusted 下照常工作——把地基打好，还不碰模式。
2. **子步骤 2**：写 `.runtime/deployment-mode.json = authenticated` + 重启（机制已就绪，见 scripts/paperclip.ts），
   建管理员账号（手机号 18744396807 派生底层 email）+ claim bootstrap + 设 owner。
3. **子步骤 3（需龚哲在飞书操作）**：生成配对码，龚哲单聊机器人发 `/member-pair <码>`，完成飞书绑定。

已就绪：`scripts/paperclip.ts` 现在读 `deployment-mode.json`（默认仍 local_trusted，不破坏现状）。
