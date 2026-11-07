# 00 · 接手第一步（必读）

## 1. 环境与仓库

| 项 | 值 |
|---|---|
| 仓库路径 | `/Users/gong.zhe/Developer/ai-native-collab` |
| 远端 | `https://github.com/zhegong-996/suitme-collab.git`，分支 `main` |
| 运行代码基线 | **随 `main` 前进，以 `git rev-parse HEAD` 为准**；交接包生成时是 `b58631c`，其后已有 `f6611e0` / `4aa6fb0` / `8d3c455` / `c27d7c0` / `3a563d3` 与第十六轮 C-1、第十七轮 C-2、第十八轮 C-3 提交 |
| 运行时 | 实测 Node **22.22.2**（`~/.workbuddy/binaries/node/...`）；`package.json` 声明 `>=24.11.0`，但构建与测试在 22 上能跑通 |
| 包管理 | npm（`package-lock.json` 已入库），`node --import tsx` 直跑 TS |
| 状态目录 | `.runtime/`（被 `.gitignore` 忽略，**任何运行证据都不入库**） |
| 交接文档 | 仓库内 `HANDOFF/` 是**唯一位置**，不依赖外部副本（见 `SYNC-STATUS.md`） |

```sh
cd /Users/gong.zhe/Developer/ai-native-collab
git status --short --branch       # 应为干净且与 origin/main 一致
git log -3 --oneline
npm test                          # 基线：388/388
```

## 2. 干净环境（很重要）

宿主机可能带**已失效的代理环境变量**，导致插件 worker 连本机 4180 被劫持，页面报 `connect failed: Connection refused` / 502。所有涉及本机服务的命令都加：

```sh
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost NODE_USE_ENV_PROXY=0
```

`curl` 探测一律加 `--noproxy '*'`。

## 3. 服务端口现状

| 端口 | 服务 | 状态 | 约束 |
|---|---|---|---|
| 3100 | Paperclip 工作台（任务真源 + 插件 UI 宿主） | 运行中 | 掉线可用 `npm run up` 恢复；冷启动常超 `up.ts` 45 秒超时，见坑 2 |
| 4180 | Bridge（workspace action 分发） | 运行中 | 改 `src/server.ts` / `src/v06.ts` 等服务端代码后需 `npm run restart:bridge` |
| 4190 | Apple Vision 本机端点 | **停机** | 用户主动取消，**不得重启** |
| 4192 | 验收报告 / 总览服务 | **停机** | 同上 |
| 4194 | 本机 Git 代码交付台 | **停机** | 同上；不要再 `present_files` 打开它 |
| 9418 | git daemon | **停机** | 同上 |
| 5432 | 本机 PostgreSQL 17（专属库 suitme_collab_c1） | 运行中·用户既有实例 | 不要动 geo_flow 等其它库；只连回环，DSN 走 COLLAB_PG_DSN |

只恢复 3100 / 4180，用 `npm run up` 与 `npm run restart:bridge`（都带干净环境）。

## 4. 首次验证建议顺序

```sh
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost NODE_USE_ENV_PROXY=0
npm test                    # 388/388
npx tsc --noEmit
npm run build:workspaces
npm run build:chinese-shell
npm run test:responsive
npm run test:walkthrough    # 11/11，依赖 3100 + 4180
npm run audit:upstream      # clean: true
npm run memory:replay       # 只读重放现状
npm run memory:smoke        # 临时目录真跑三条红线
npm run memory:checkpoint   # 真实日志增量应用，checksum 与全量对照
npm run routing:status      # 5 处接线 + 三层判断
npm run host:smoke          # 非 Paperclip 最小宿主
npm run agents:smoke             # C-4 Agent 编制隔离真跑 43/43
npm run shapes:smoke             # C-5 两种形态各跑真实一单 36/36
npm run host:pg             # PG 后端真跑 21/21（需本机 PG 17 + 专属库 suitme_collab_c1）
npm run router:smoke        # C-3 三种组织形态真跑 31/31（隔离内存 Trace，不写真实日志）
npm run console:smoke       # 自研独立控制台 6 视图 + 主题 + 425px + 只读边界（临时端口，跑完即关）
git diff --check
```

> `npm run memory:journey` 是 B2 的**真跑脚本**：会经真实 bridge action 新建一条专用资料、跑完整知识事件链并在末尾撤回，**会写 `.runtime/memory/events.jsonl`**，不是只读检查。接手者确认要重跑时再看 `05` 第 2 节，别把它当成常规冒烟。

完整预期输出见 `05-VALIDATION-AND-COMMANDS.md`。

## 5. 八个已知坑（都真实发生过）

1. **失效代理**：见第 2 节。现象是走查 11 步全失败、页面 `connect failed` / 502；不是代码回退。
2. **Paperclip 冷启动 > 45 秒**：`npm run up` 会报 `paperclip did not become ready`，但进程其实在起；等日志出现 `Server startup recovery complete` 后 `npm run status` 会显示 running、health 200。别重复起第二个实例。
3. **后台沙箱跑 `build:chinese-shell` 会失败**：Vite `emptyOutDir` 批量删 391 个文件触发 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`（阈值 50）。**前台已授权环境退出 0**，是工具环境限制不是代码缺陷。
4. **Chrome 缓存**：改了 `suitme-domestic.js` 后走查必须 `Network.setCacheDisabled`（脚本已加），否则测到旧脚本。
5. **白屏不等于 JS 崩溃**：曾因运行时收敛脚本把宿主外壳 `div.contents` 加 `data-suitme-hidden` 导致整页白屏、零 JS 异常。先查 `[data-suitme-hidden]` 与 computed display，走查已加 `bodyTextLen` / `shellHidden` 断言。
6. **测试污染真实日志**：`scripts/test.ts` 给测试子进程设 `COLLAB_TEST_TRACE=memory` 与 `COLLAB_TEST_MEMORY=memory`，测试事件只进内存 sink。若发现 `.runtime/routing` 或 `.runtime/memory` 里混进测试动作，先检查这两个变量有没有丢。
7. **Paperclip 重启后走查全灰**：宿主 3100 恢复后若插件区显示 connect failed，即使 overview 可见，其余 10 个视图仍会 0 命中。需按干净环境依次 npm run restart:bridge + npm run install:workspaces 重挂插件，再跑走查；这是宿主/插件连接，不是代码回退。
8. **真实链路才暴露的图缺陷**：`memory:journey` 曾因任务级组织图镜像未带入「全局已有节点」而报悬空边；`memory-index` 会先自动跑一次 L2 抽取，手工再抽时不能假设任务图已包含全部节点。修法见 `src/org-extraction.ts::buildTaskGraphMirror()`；`view.spaces` 是数组不是字典也踩过一次。

## 6. 不要做的事

- 不要重启 4190 / 4192 / 4194 / 9418。
- 不要改 `upstream/` 下任何上游源码（审计 `audit:upstream` 会报）。
- 不要把 `.runtime/` 里的真实姓名、`open_id`、密钥、业务正文提交进仓库。
- 不要用报告 / 模型判定 / CI 通过 / 合并审批代替真人在原会话「确认验收」。
- **C 已按 ② 启动，严格分步不跳步**：第十五轮用户拍板「独立前端应用」，产品形态冲突已解除（§10A 的 S5/S6 废弃、S1–S4 与飞书唯一入口保留）。按 `06` 第 3 节的 **C-0 → C-6 + 收尾**推进（C-0 / C-0b / C-1 / C-2 / C-3 / C-4 / C-5 已完成，C-6 为下一步）；动手前读 `docs/PRD-v0.6.md` §10C（C-P1~C-P8：组织形态可配置、长程执行三者分离、用户可见层国内化、验收是一等公民 Agent、工程+AI 分层判断、沉淀回流与自演进、评估按配置判定）与 `docs/ADAPTATION-v0.6.md` `0.000000000000000000000` 节最新边界（三层 = 同一份共享现场的三种座位，且层是配置不是骨架）。三层判断在默认扁平配置下仍 `recommended=false`（8 项前置条件；p8 按真实在岗数判定，默认空编制为 0 故仍 false）；C-5 已按当前配置重跑评估，扁平不要求主管、分层主管须真实在岗。**不要放开主管 Agent 自主派活，也不要为凑评估转绿逼扁平团队硬造管理层**。
