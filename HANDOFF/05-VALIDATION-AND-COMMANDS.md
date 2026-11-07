# 05 · 验证与命令手册

## 1. 全套回归（改动后必跑）

```sh
cd /Users/gong.zhe/Developer/ai-native-collab
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost NODE_USE_ENV_PROXY=0

npm test                    # 335/335（基线）
npx tsc --noEmit            # 退出 0
npm run build:workspaces    # 插件 UI 打包 + 类型检查
npm run build:chinese-shell # hiddenEntries 4 条、missed []、warning null
npm run test:responsive     # 425px 无溢出、按钮 44px
npm run test:walkthrough    # 11/11、failures []
npm run audit:upstream      # clean: true、problems []
git diff --check            # 退出 0
```

> `build:chinese-shell` 在后台沙箱会因 Vite `emptyOutDir` 批量删除触发 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，**前台已授权环境退出 0**（见 `00` 坑 3）；不是代码问题。

**功能类 CLI / 冒烟（也应全绿）**：

```sh
npm run memory:replay       # 只读重放：replayTwiceEqual / deterministic true
npm run memory:smoke        # 临时目录真跑三条红线，ok:true
npm run memory:checkpoint   # 真实日志增量应用，checksum 与全量对照
npm run memory:journey      # 真实 bridge action 全链路 + 端到端撤权（会写真实日志）
npm run routing:status      # allWired:true、threeTier.recommended:false
npm run host:smoke          # 非 Paperclip 宿主 ok:true
npm run host:pg             # PG 后端 21/21、ok:true（专属库 suitme_collab_c1）
npm run cognee:native -- status   # enabled:true, configured:false（缺 4 个环境变量）
npm run delivery:demo       # 本机 Git 链路；4194/9418 停机时 gitProtocolClonePull 为 false，属预期
```

`memory:journey` 会新建一条专用资料并在末尾撤回，**不是只读检查**；`memory:checkpoint -- --reset` 会全量重建后再按 append-only 前缀增量应用。

## 2. 第十六轮 C-1 实测结果（2026-11-07；含第十四轮 B2 历史数据）

| 项 | 结果 |
|---|---|
| `npm test` | **335 / 335**（第十四轮 329 + C-1 新增 6 例 PG 契约） |
| `npx tsc --noEmit` | 通过 |
| `build:workspaces` / `build:chinese-shell` | 通过 / `hiddenEntries` 4、`missed: []`、`warning: null`（前台重跑） |
| `test:responsive` | 425px `393/393`、溢出 0、按钮 44px、`problems: []` |
| `test:walkthrough` | **11 / 11**，`failures: []` |
| `audit:upstream` | `clean: true`、`problems: []`（7 个上游） |
| `memory:smoke` | 撤权前 1 命中 → 撤权后 **0 命中**、`excludedByRevocation=4`、`modelCalls=0` |
| `memory:journey` | **`ok: true`，9/9 checks**：四类投影 `1/2/1/1 → 0/0/0/0`、召回 `1 → 0`、`lineageInvalidated`、新增 `lineageComplete`（本次资料悬空 lineage 前后均为 0）、`logErrors=0`、两次重放一致 |
| `memory:checkpoint` | 真实日志 `mode:incremental, applied:1, fallback:null, checksumEqual:true`（全量重建 30 → 增量后 31 事件）；journey 追加撤权事件时按预期 `fallback:retroactive-event` 回退全量，`checksumEqual:true` |
| `routing:status` | `allWired:true`、三层 `recommended:false`（覆盖率 5/7） |
| `host:smoke` / `host:pg` | `ok:true` / **`ok:true`、21/21**（事务、并发领取、步进链、崩溃恢复、token 幂等） |
| `cognee:native status` | `configured:false`（缺 4 个环境变量，未外发业务材料） |
| `git diff --check` / staged 敏感扫描 | 通过 / 无 `.runtime`、无真实身份 |

> `memory:replay` 的 `eventCount` 会随真实业务动作增长，`duplicateIds` / `danglingCausedBy` 也可能保留历史行（append-only 日志不物理删除）。**判定标准是 `replayTwiceEqual` / `deterministic` / `logErrors` 为空，以及 `memory:journey` 的 `lineageComplete`**，不是固定数字。第十四轮修复前真实日志曾有 6 条悬空 lineage，旧行仍在，新链路已为 0。

## 3. 真实 HTTP 冒烟模板（admin token 从 `.runtime/secrets.json` 读，不入库）

```sh
node --import tsx --input-type=module -e "
import { secrets } from 'file:///Users/gong.zhe/Developer/ai-native-collab/src/config.ts';
import http from 'node:http';
const payload = JSON.stringify({ payload: {} });
const req = http.request({ hostname: '127.0.0.1', port: 4180,
  path: '/workspace/memory-replay', method: 'POST',
  headers: { 'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    Authorization: 'Bearer ' + secrets().adminToken } },
  res => { let out = ''; res.on('data', c => out += c);
    res.on('end', () => console.log(res.statusCode, out.slice(0, 600))); });
req.on('error', e => console.log('ERR', e.message)); req.end(payload);
"
```

把 path 换成 `routing-status` / `service-status` / `delivery-status` / `system-status` 可查其它只读状态。改过 `src/server.ts` / `src/v06.ts` / `src/workspaces.ts` 等服务端代码后先 `npm run restart:bridge`。

## 4. 服务端口表

| 端口 | 用途 | 交接状态 | 启动方式 |
|---|---|---|---|
| 3100 | Paperclip 工作台 + 插件宿主 | 运行中 | `npm run up`（冷启动 45s 超时见 `00`） |
| 4180 | Bridge workspace action | 运行中 | `npm run restart:bridge` |
| 4190 | Apple Vision 本机端点 | **停机·不得重启** | — |
| 4192 | 验收报告 / 总览 | **停机·不得重启** | — |
| 4194 | 本机 Git 交付台 | **停机·不得重启** | — |
| 9418 | git daemon | **停机·不得重启** | — |
| 5432 | 本机 PG 17 专属库 suitme_collab_c1 | 运行中（用户既有实例） | 不新建服务；只连回环，勿动其它库 |

## 5. 排障速查

| 现象 | 根因 | 处理 |
|---|---|---|
| 走查 11 步全失败、页面 93 字浏览器错误 | 3100 掉线 | 干净环境 `npm run up`，等日志 `Server startup recovery complete` |
| 页面 `connect failed: Connection refused` / 502 | 旧代理环境变量，或宿主重启后插件未重挂 | 干净环境 `restart:bridge` + `install:workspaces`，再跑走查；`00` 坑 7 |
| `npm run up` 报 `did not become ready` | 冷启动 > 45s | 不要重复起；查 `npm run status` 与 health |
| 后台 `build:chinese-shell` 退出 1 | 批量删除保护（391 文件 > 阈值 50） | 前台已授权环境重跑；非代码问题 |
| 白屏但无 JS 异常 | 运行时收敛脚本误隐藏宿主外壳 | 查 `[data-suitme-hidden]`；已有 `bodyTextLen`/`shellHidden` 断言守门 |
| 测试突然失败且涉及时间 | 硬编码绝对时间过期 | 改相对时间（曾修 `at+8h` 时间炸弹） |
| 状态接口全是灰字 / 不刷新 | 硬编码一次性快照 | 走 `service-status` / `routing-status` 实时探测 |
| 真实日志混入测试动作 | `COLLAB_TEST_*` 变量丢了 | 检查 `scripts/test.ts` 的 env 注入 |
| `memory:journey` 报「知识空间不存在」 | `view.spaces` 是数组，被 `Object.entries` 当字典读成索引 | 脚本已改为 `Array.isArray` 分支 |
| `v06-l2-extract` 报「边指向不存在的节点」 | `memory-index` 先自动抽过一次，任务级镜像未带入全局已有节点 | `buildTaskGraphMirror()` 补齐，见 `tests/l2-extraction.test.ts` |
| 真实日志出现 `danglingCausedBy` | `reviewSource` 用评审前 revision，确认事件被幂等去重 | 已改用 `reviewedRevision`；历史行不物理删除，重放如实记录 |

## 6. 提交前检查（每轮都做）

```sh
git status --short
git add -A
git diff --cached --name-only | grep -E '\.runtime/|ui/dist|dist/ui'   # 应为空
git diff --cached | grep -niE 'api[_-]?key|secret|token|open[_-]?id|private[_-]?note'  # 应为空（另按项目规则核真实姓名）
git diff --cached --check
git commit -m "..." && git push origin main
```

若 `git push` 报 `HTTP2 framing layer` / `CONNECT tunnel 502`，是环境代理瞬断；网络恢复后**只重试 push，不要重复 commit**。
