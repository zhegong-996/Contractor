# 第四十六轮：会签与分歧仲裁 + 内容密封（纯代码，G5/V1/V2 地基）

> 用户指令：「先做纯代码的，然后一项一项 p0 做。」
> 本轮：G5 的会签/仲裁判定、V1/V2 共享的内容密封工具；均纯函数 + 契约测试，不碰运行服务。

## 1. 会签与分歧仲裁（`src/countersign.ts`）

把验收层已有的「独立评审者 / 会签」抽象到通用决策域，落成三个纯函数：

| 能力 | 规则 |
|---|---|
| `tallyVerdicts` | 多份独立判断计票；同一判断者重复投票只算一次 |
| 一票否决 | 有 deny 即 deny（默认），多数票洗不白 |
| 分歧仲裁 | `disagree:'arbitrate'` 时，allow/deny 并存 → deadlock → 升级仲裁 |
| `arbitrate` | 只有 deadlock 才能仲裁；结果单独标 `arbitrated`，不与会签通过混淆 |

为什么「一票否决」是默认：会签常用于验收/授权，宁严勿松；「分歧仲裁」留给「判断有争议、需要拍板」的场景，由调用方显式选择。

## 2. 内容密封（`src/content-seal.ts`，V1/V2 共享地基）

- `contentHash` / `seal` / `verifySeal` / `sealDiff`：键排序稳定序列化 + 可排除易变字段（时间戳/端口）。
- V1 配置篡改检测：关键配置（role-registry / org-table）落盘盖章、读回校验。
- V2 产物可信：产物登记时盖章，验收比对时校验「声称的结果就是产出的内容」。
- 与验收清单的 `planHash` 同一套思路，这次抽成通用工具。

## 3. 体检 51 → 53

| 新增 | 分类 | 钉住 |
|---|---|---|
| `collaboration.countersign-veto-and-arbitrate` | 验收 | 一票否决、去重、分歧仲裁标记、没卡住不能仲裁 |
| `security.content-seal-detects-tamper` | 权限 | 键序无关、改状态检出、易变字段排除 |

## 4. 验证

`npm test` **713/713**（+5 会签 +4 密封；体检断言在既有用例内更新）、`tsc` 0 错、`audit:layers` **53 条 ok 53 / partial 0 / gap 0**。

## 5. 纯代码剩余（按序）

1. **G1 收尾**：把 authorization/acceptance/countersign/transfer/out-of-scope 五类决策接入 `canDecide`。
2. **G2**：结果回流钩子（执行完成自动登记产物 → 巡检 → 对账 → 进决策上下文）。
3. **V1 落地**：把 `contentSeal` 接到 role-registry / org-table 的落盘与读回。
4. **V2 落地**：把 `contentSeal` 接到产物登记。
5. **V5**：超时升级（依赖多用户，放 P0 后）。
6. **V6/V7**：密钥钥匙串、多机一致性（依赖系统能力，最后）。

P0（切多用户）按用户「一项一项」单独推进，见 `docs/P0-MULTIUSER-MIGRATION.md`。
