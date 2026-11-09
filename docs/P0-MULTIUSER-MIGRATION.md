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
