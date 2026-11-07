# 05 · 验证与命令手册

## 1. 全套回归（改动后必跑）

```sh
cd /Users/gong.zhe/Developer/ai-native-collab
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost NODE_USE_ENV_PROXY=0

npm test                    # 315/315（基线）
npx tsc --noEmit            # 退出 0
npm run build:workspaces    # 插件 UI 打包 + 类型检查
npm run build:chinese-shell # hiddenEntries 4 条、missed []、warning null
npm run test:responsive     # 425px 无溢出、按钮 44px
npm run test:walkthrough    # 11/11、failures []
npm run audit:upstream      # clean: true、problems []
git diff --check            # 退出 0
```

**功能类 CLI / 冒烟（也应全绿）**：

```sh
npm run memory:replay       # 只读重放：replayTwiceEqual / deterministic true
npm run memory:smoke        # 临时目录真跑三条红线，ok:true
npm run routing:status      # allWired:true、threeTier.recommended:false
npm run host:smoke          # 非 Paperclip 宿主 ok:true
npm run cognee:native -- status   # enabled:true, configured:false（缺 4 个环境变量）
npm run delivery:demo       # 本机 Git 链路；4194/9418 停机时 gitProtocolClonePull 为 false，属预期
```

## 2. 交接时的实测结果（第十三轮）

| 项 | 结果 |
|---|---|
| `npm test` | **315 / 315** |
| `npx tsc --noEmit` | 通过 |
| `build:workspaces` / `build:chinese-shell` | 通过 / `hiddenEntries` 4、`missed: []` |
| `test:responsive` | 425px `393/393`、溢出 0、按钮 44px |
| `test:walkthrough` | **11 / 11**，`failures: []` |
| `audit:upstream` | `clean: true` |
| `memory:smoke` | 撤权前 1 命中 → 撤权后 **0 命中**、`excludedByRevocation=4`、`modelCalls=0` |
| `memory:replay` | `eventCount=5`、`bridgedRoutingEvents=2`、`replayTwiceEqual=true`、`duplicateIds=2`（跨进程重复如实记录）、`logErrors=[]` |
| 真实 HTTP `POST /workspace/memory-replay` | 200、`ok:true`、`deterministic:true` |
| `routing:status` | `allWired:true`、三层 `recommended:false` |
| `host:smoke` | `ok:true` |
| `git diff --check` / staged 敏感扫描 | 通过 / 无 `.runtime`、无真实身份 |

> `memory:replay` 的 `eventCount` 会随真实业务动作增长，`duplicateIds` 也可能变化（append-only 日志允许跨进程重复、重放按 id 去重）。**判定标准是 `replayTwiceEqual` / `deterministic` / `logErrors` 为空，不是固定数字。**

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

把 path 换成 `routing-status` / `service-status` / `delivery-status` / `system-status` 可查其它只读状态。改过 `src/server.ts` 后先 `npm run restart:bridge`。

## 4. 服务端口表

| 端口 | 用途 | 交接状态 | 启动方式 |
|---|---|---|---|
| 3100 | Paperclip 工作台 + 插件宿主 | 运行中 | `npm run up`（冷启动 45s 超时见 `00`） |
| 4180 | Bridge workspace action | 运行中 | `npm run restart:bridge` |
| 4190 | Apple Vision 本机端点 | **停机·不得重启** | — |
| 4192 | 验收报告 / 总览 | **停机·不得重启** | — |
| 4194 | 本机 Git 交付台 | **停机·不得重启** | — |
| 9418 | git daemon | **停机·不得重启** | — |

## 5. 排障速查

| 现象 | 根因 | 处理 |
|---|---|---|
| 走查 11 步全失败、页面 93 字浏览器错误 | 3100 掉线 | 干净环境 `npm run up`，等日志 `Server startup recovery complete` |
| 页面 `connect failed: Connection refused` / 502 | 旧代理环境变量 | 干净环境重启 3100 与 4180 |
| `npm run up` 报 `did not become ready` | 冷启动 > 45s | 不要重复起；查 `npm run status` 与 health |
| 后台 `build:chinese-shell` 退出 1 | 批量删除保护（391 文件 > 阈值 50） | 前台已授权环境重跑；非代码问题 |
| 白屏但无 JS 异常 | 运行时收敛脚本误隐藏宿主外壳 | 查 `[data-suitme-hidden]`；已有 `bodyTextLen`/`shellHidden` 断言守门 |
| 测试突然失败且涉及时间 | 硬编码绝对时间过期 | 改相对时间（曾修 `at+8h` 时间炸弹） |
| 状态接口全是灰字 / 不刷新 | 硬编码一次性快照 | 走 `service-status` / `routing-status` 实时探测 |
| 真实日志混入测试动作 | `COLLAB_TEST_*` 变量丢了 | 检查 `scripts/test.ts` 的 env 注入 |

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
