# 第四十五轮：DecisionPoint 统一抽象 + 跨域决策委派（P0 方案就绪）

> 用户指令：「先做 p0，然后 G1 G2 G3 G4 G5 依次完成，7 个漏洞修复，可以在后台分饰多角模拟。」
> 本轮落地：G1 的 DecisionPoint 抽象 + G3 的跨域委派判定；P0（切多用户）摸清并写成迁移方案，尚未执行。

## 1. G1：DecisionPoint 一等公民（`src/decision-point.ts`）

把「谁在什么时候、凭什么、拍了什么板」统一成一个模型，七类决策各声明「谁有资格判」：

| kind | 资格 |
|---|---|
| admission（准入） | human（inferred 档只给指引） |
| authorization（授权面） | domain-owner |
| acceptance（验收） | independent-reviewer |
| countersign（会签） | independent-reviewer |
| transfer（转交） | domain-owner |
| cross-domain（跨域） | domain-expert |
| out-of-scope（越界） | human |

能力：`openDecision`（开点）、`canDecide`（统一资格）、`decide`（过资格才拍板）、
`delegateDecision`（委派留痕）、`persistDecision`/`listDecisions`/`pendingDecisions`（追加式落盘 + 悬而未决清单）。

**诚实标注**：七类资格表是「统一出处」；真正接入判定流的目前是 admission 与 cross-domain 两类，
其余五类仍在原模块各自判定——下一步是把它们改成调用同一个 `canDecide`，而不是另写一套。

## 2. G3：跨域判断权委派（G1 的直接收益）

`canDecide` 里的核心规则：**跨域决策点要求对方域资格，本域 admin 也过不了**。

```
决策点 kind=cross-domain, domain=growth
产研 admin（domain=product, admin=true）→ 拒绝：跨域决策应由 growth 域的专业人/Agent 拍
增长专家（domain=growth, capabilities=[domain-expert]）→ 通过
```

这直接落实差距分析里「业务域之外由其他域专业的人/Agent 判断」这条，同时修掉漏洞 V3
（原来「域未知 admin 全放行」）。

## 3. P0：主安装切多用户（方案就绪，未执行）

摸清的事实写在 `docs/P0-MULTIUSER-MIGRATION.md`：

- 模式由 `PAPERCLIP_DEPLOYMENT_MODE` 决定，默认 `local_trusted`；主安装启动没设这个变量。
- 切换是「加环境变量 + 重启」，**PG 数据不动，不会丢**。
- 但会改变 `local-board` 信任路径，且要建真实管理员 + 把飞书身份绑到成员。

**为什么这轮不直接切**：它牵扯真实账号、飞书绑定、服务切换窗口，且第 5 步「龚哲用哪个身份登录」
需要你拍板。方案里给了备份 + 演练 + 回滚全流程，等你确认身份方式就执行。

## 4. 体检 50 → 51

| 新增 | 分类 | 钉住 |
|---|---|---|
| `decision.cross-domain-delegates-not-escalates` | 权限 | 跨域决策本域专家可判、本域 admin 被拒、委派留痕 |

## 5. 验证

`npm test` **704/704**（+5 决策点）、`tsc` 0 错、`audit:layers` **51 条 ok 51 / partial 0 / gap 0**。

## 6. 下一步（按序）

1. **G4 真切换**：等你确认龚哲的登录方式，按迁移方案执行（备份→停→切→建管理员→绑飞书→验证）。
2. **G1 收尾**：把 authorization/acceptance/countersign/transfer/out-of-scope 五类也改成调 `canDecide`。
3. **G2**：结果回流钩子（执行完成自动登记产物→巡检→对账→进决策上下文）。
4. **G5**：多 Agent 并发 + 会签 + 分歧仲裁。
5. **V1-V7**：配置哈希、产物哈希、超时升级、密钥钥匙串、多机一致性。
6. **模拟**：在隔离 pilot（3110）分饰多用户 + 多 Agent，把 G3 在真实多身份下跑一遍。
