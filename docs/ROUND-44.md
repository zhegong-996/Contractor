# 第四十四轮：产物续改链 + 主题工作台（活文档）

> 用户指令：「1、2 做完，3 你有什么方案？说出来给我，我来看看要哪个。」
> 1 = 产物续改链 + 产物 revision 变了→重算待办；2 = 活文档；3 = 派单多通道（只出方案）。

## 1. 产物续改链（`src/artifact.ts`）

把「同一份文件接着改」做成一等公民：产物不是文件内容，而是**引用 + 一串修订**。

```ts
Artifact { ref, title, current, revisions: [{ revision, taskId, at, by, summary }] }
```

三条规则（体检 `artifact.continuation-keeps-history` 钉住）：

1. **同一修订幂等**：`ref + revision` 重复登记返回原样，不追加——对账和巡检会重复触发同一次落库。
2. **新修订只追加**：`current` 跟着走，旧修订永久保留，能回答「这一版是哪次任务改出来的」。
3. **续改不复制**：`continueArtifact()` 只记一条「从当前版接的」，并给出一份任务简述；
   **不建任务**——建任务要过派活、准入、绑定，不该由一个登记动作顺手做掉。

```bash
npm run artifact -- register --ref report:SUI-128 --title "验收报告" --revision r3 --by ou_xxx --task <taskId>
npm run artifact -- continue report:SUI-128 --by ou_xxx --goal "把预算改成 80 人档"
npm run artifact -- list / view <ref>
```

### 顺带把「产物 revision 变了 → 待办重算」接上了

上一轮这条标的是「半做：数据源没接上」。现在 `artifactRevisionByTask()` 从产物登记里导出
「任务 → 最新修订号」，`npm run patrol` 把它写进巡检快照：

- 修订号变了 → 巡检卡片出现「产物修订：r2 → r3（产物改过，建议和待办对一遍）」；
- 需要核对时执行 `npm run reconcile -- <taskId>`，拿锁定清单比一遍。
- **仍然不自动跑**：提示和动作分开，巡检不替人做判定。

## 2. 主题工作台（`src/topic-workbench.ts` + `npm run topic -- workbench <id>`）

千问的「活动执行工作台」是切人数预算联动。我们这边能诚实落地的联动是**口径联动**：
切状态 / 切负责人 / 切时间窗，「任务数、卡点数、负责人数」和清单跟着变。

- **自包含 HTML**：数据内嵌、无外部请求、无 CDN，打开就能用，不依赖服务在线。
- **只读**：页面上没有任何写入动作，也不参与派单与验收判定。
- **缺状态不猜**：没有状态的任务显示 `unknown`，不默认成「正常」。

体检 `workbench.is-readonly-snapshot` 钉住：数据内嵌、无 `<script src=`、无 `fetch(`、无 POST。

## 3. 性能与安全

- 产物文件 0600，ref 经 sha256 转安全文件名（冒号、斜杠不会撑破路径）。
- 工作台 HTML 对标题/目标/卡点原因全部转义后再拼接。
- 巡检直接读本机 sqlite，不经过 bridge：巡检不该依赖「服务在线」。

## 4. 体检 48 → 50

| 新增 | 分类 | 钉住 |
|---|---|---|
| `artifact.continuation-keeps-history` | 验收 | 幂等登记、修订追加、续改记录来源且不建任务、旧修订保留 |
| `workbench.is-readonly-snapshot` | 验收 | 缺状态不猜、无外部资源、无写入动作 |

## 5. 验证

`npm test` **699/699**（+6 产物与工作台）、`tsc` 0 错、`audit:layers` **50 条 ok 50 / partial 0 / gap 0**、
`console:smoke` `ok:true / failed:[]`。

## 6. 边界

- 续改只登记链路，**不自动建任务**：建任务仍走派活链路，本轮不做隐式建单。
- 工作台是**生成式快照**，不是实时订阅；要看最新就重新生成。
- 「一个主题绑多个群」的派单侧仍是单通道判定，方案见 `docs/ROUND-44-ROUTING-OPTIONS.md`，等用户选。
