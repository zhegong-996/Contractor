# 09 · 目录结构完全指南（接手必读）

> 目标：搞清楚**每个目录是干什么的、哪些入库、产物放哪、新文件该放哪**。
> 根目录：`/Users/gong.zhe/Developer/ai-native-collab`｜第十八轮 C-3 收尾后 `git ls-files` 共 **283** 个入库文件（含 `HANDOFF/` 14 个）。

## 1. 完整目录树（带说明）

```
ai-native-collab/                       仓库根（main 分支）
├── console/                           ★ C-2 自研独立控制台（3 个文件，原生 HTML/CSS/JS，零运行时依赖，不依赖宿主插件接口）
│   ├── index.html / styles.css / app.js        六视图 / 明暗主题 / 只读白名单 / 统一中文语言层
├── HANDOFF/                           ★ 本交接包（入库、随 commit 推送）——唯一位置
│   ├── README.md                      总索引 + 包内每个文件的说明
│   ├── 00-START-HERE.md               接手第一步（环境/服务/坑）
│   ├── 01-PROJECT-OVERVIEW.md         产品与业务架构
│   ├── 02-ARCHITECTURE.md             技术架构与真实引用关系
│   ├── 03-WORK-LOG.md                 18 轮工作记录与用户决策
│   ├── 04-CODE-MAP.md                 按功能域的代码地图
│   ├── 05-VALIDATION-AND-COMMANDS.md  回归命令、预期输出、排障
│   ├── 06-CURRENT-STATE-AND-NEXT.md   B2 证据；C-0~C-6 清单与产品原则
│   ├── 07-RULES-AND-BOUNDARIES.md     红线与边界
│   ├── 08-OPEN-DECISIONS.md           7 项待拍板 + 3 条已解决
│   ├── DIRECTORY-GUIDE.md             ★ 本文件：目录完全指南
│   ├── SYNC-STATUS.md                 ★ 唯一位置声明、commit 与接手校验
│   ├── FILE-INVENTORY.md               ★ 逐文件一行说明（100% 覆盖入库文件）
│   └── handoff-manifest.json           ★ 机器可读元数据
├── src/                               ★ 后端核心（78 个 .ts，全部入库）
│   ├── memory-recall.ts / memory-checkpoint.ts    B2 读取链投影召回、checkpoint 增量应用
│   ├── pg-host.ts                              C-1 PostgreSQL 宿主：事务 / 步进队列 / 状态外置
│   └── router.ts                               C-3 单一 Router：planRoute / 配置快照 / 唯一写入口
│   └── vendor/prime-query.ts           从 Prime Agent 移植的检索权重（必须保留 MIT 版权头）
├── scripts/                           ★ CLI / 服务 / 构建 / 冒烟（50 个文件，含 .py/.swift/.mjs）
│   ├── memory-journey.ts / memory-checkpoint.ts  B2 真跑脚本（会写 .runtime/memory/）
│   ├── host-pg-smoke.ts                        C-1 PG 真跑 21/21（专属库 suitme_collab_c1）
│   ├── console-server.ts / console-smoke.mjs   C-2 独立控制台承载与浏览器冒烟
│   └── router-smoke.ts                         C-3 三种组织形态隔离真跑 31/31
├── tests/                             ★ 回归测试（61 个 .test.ts，node:test）
│   └── router.test.ts                           C-3 Router 契约 11 例
│   └── fixtures/                       测试夹具（prime-context-terms.json）
├── plugins/
│   └── knowledge-workspaces/           ★ 中文工作台插件（唯一插件）
│       ├── src/
│       │   ├── worker.ts              插件 worker：action 转发 + 宿主 actor
│       │   ├── manifest.ts            插件清单 / SDK 入口声明
│       │   ├── action-name.ts         action 名 → URL 路径段
│       │   └── ui/                    ★ 前端 18 个文件（第十轮已分层）
│       ├── dist/                      ⛔ 构建产物，被 .gitignore 忽略，不入库
│       ├── package.json / tsconfig.json
├── upstream/                          ★ 7 个 git submodule（只 pin commit，不改源码）
│   ├── paperclip/                     Paperclip 平台底座 + 上游 UI
│   ├── superagent/                    DeepSeek Super Agent（触发/policy 原语）
│   ├── autoloop/                      Agent Autoloop（worker 执行循环）
│   ├── prime-agent/                   Prime Agent（检索权重来源）
│   ├── deepseek-harness/              DeepSeek Harness（scope/工具装配）
│   ├── cognee/                        Cognee（图存储/DataPoint/BM25）
│   └── acceptance/                    lobehub/acceptance（只读格式契约）
├── docs/                              ★ 项目文档（21 个 .md，全部入库）
│   └── design/workbench.md            工作台设计稿
├── locales/                           构建期中文壳词典（shell.zh-CN.json）
├── integrations/deepseek/             DeepSeek Harness 的 LLM 客户端替换层（2 个 .ts）
├── licenses/                          上游许可证全文（4 个 .txt）
├── fixtures/                          联调夹具（yml / html / png / mjs）
├── .github/workflows/ci.yml           GitHub Actions CI 配置
├── workspaces/                        ⛔ 联调仓库 checkout（被 .gitignore 忽略）
│   └── desktop-tutorial/              zhegong-996/desktop-tutorial 的本地工作树
├── .runtime/                          ⛔ 全部运行证据与状态，被 .gitignore 忽略，绝不入库
├── node_modules/                      ⛔ 依赖，被 .gitignore 忽略
├── HANDOFF 之外的根目录文件：
│   ├── README.md / PRODUCT.md / DESIGN.md / AGENTS.md
│   ├── THIRD_PARTY_NOTICES.md / sources.lock.json / .gitmodules
│   ├── package.json / package-lock.json / tsconfig.json / .gitignore
```

## 2. 每个顶层目录的作用与入库状态

| 目录 | 作用 | 入库 | 备注 |
|---|---|---|---|
| `HANDOFF/` | 交接包（本套文档） | ✅ | **唯一权威位置**，只改这里，直接处理这个目录 |
| `src/` | 后端全部 TypeScript 业务代码 | ✅ | 新后端模块放这里，测试同步放 `tests/` |
| `scripts/` | 可执行入口：服务、CLI、构建、冒烟、Swift/Python 辅助 | ✅ | 新 npm script 必须有对应实现文件 |
| `tests/` | `node:test` 回归测试 | ✅ | `scripts/test.ts` 自动发现 `tests/*.test.ts` |
| `plugins/knowledge-workspaces/` | 唯一插件（中文工作台 UI + worker） | ✅（不含 dist） | SDK 的 `uiEntry` 固定指向 `src/ui/index.tsx` |
| `upstream/` | 7 个 pin 住的开源 submodule | ✅（gitlink） | 只用不改；`audit:upstream` 校验一致性 |
| `docs/` | 产品/架构/验证/合规文档 | ✅ | 最新边界在 `ADAPTATION-v0.6.md` 末尾轮次 |
| `locales/` | 构建期中文壳词典 | ✅ | 只改展示文案 |
| `integrations/deepseek/` | 把 Harness 的 LLM 依赖替换为自研实现 | ✅ | 不启用模型网关 |
| `licenses/` | 上游许可证全文 | ✅ | 合规要求 |
| `fixtures/` `tests/fixtures/` | 联调/测试夹具 | ✅ | 不含真实业务数据 |
| `.github/workflows/` | CI 配置 | ✅ | — |
| `workspaces/` | 联调仓库本地 checkout | ⛔ | `.gitignore` 忽略；里面是独立 git 仓库 |
| `.runtime/` | 运行证据、SQLite、日志、编译产物、截图、凭证 | ⛔ | **绝不入库**，见第 4 节 |
| `node_modules/` | npm 依赖 | ⛔ | — |
| `plugins/*/dist/` | 插件构建产物 | ⛔ | `.gitignore` 忽略 |
| `evidence/private/`、`.env`、`*.log`、`.DS_Store` | 私有证据与临时文件 | ⛔ | `.gitignore` 明确列出 |

## 3. 七个 upstream submodule 一览

| 路径 | 来源 | 许可证 | 本项目实际用法 |
|---|---|---|---|
| `upstream/paperclip` | `paperclipai/paperclip` | MIT | 任务真源、ACL、文档修订、上游 UI、Plugin SDK |
| `upstream/superagent` | `deepseek-ai/dsh-superagent-prototype` | MIT | 飞书触发解析、线程键、`policy.ts` 准入与范围判断 |
| `upstream/autoloop` | `KKKKhazix/agent-autoloop` | MIT | `createWorker` 执行循环、CLI 适配、回执恢复 |
| `upstream/prime-agent` | `PrimeIntellect-ai/prime-agent` | MIT | 检索词权重（移植到 `src/vendor/prime-query.ts`） |
| `upstream/deepseek-harness` | `deepseek-ai/deepseek-harness` | MIT | `Context`/`SystemPrompt`/`ToolsService`/`createScope`，esbuild 打包 13 模块 |
| `upstream/cognee` | `topoteretes/cognee` | Apache-2.0 | DataPoint、Ladybug 图、GraphSchema、BM25；Python 子进程 RPC |
| `upstream/acceptance` | `lobehub/acceptance` | Apache-2.0 | **只读**报告格式契约，不跑其 CLI/云端服务 |

约束：`.gitmodules` + `sources.lock.json` + gitlink 三者 commit 必须一致（`npm run audit:upstream` 校验）；**不改上游源码**；LobeHub 主仓库（Community License）与 Outline（BSL）不在 submodule 里，只借思想。

## 4. `.runtime/` 详解（重要：所有真实数据都在这里，且不入库）

| 子路径 | 内容 |
|---|---|
| `config.json` / `secrets.json` | 本机配置与 token（**凭据不入库**；Cognee 外部 Key 只走进程环境，不写这里） |
| `bridge.sqlite` (+`-wal`/`-shm`) | 本地 SQLite：事件去重、任务投影、outbox、audit 表 |
| `bridge-service.pid` / `*-service.pid` | 服务 PID，`up.ts` 会校验 PID 归属才允许停止 |
| `logs/` | Paperclip / Bridge 等启动日志（排查冷启动看 `paperclip.log`） |
| `routing/events.jsonl` | **A 阶段**统一路由决策 Trace（append-only，测试动作已隔离） |
| `memory/events.jsonl` | **B1** 共享记忆事件主干（append-only） |
| `tasks/<taskId>/` | 单任务上下文快照 |
| `knowledge-graph/<hash>/` | 按 `sha256(sourceId@revision)` 隔离的 L1 图、`chunk-tokens.json`、`semantic-vectors.json`、`ready.json` |
| `git/repos/*.git` | 本机 Git 裸仓库（交付链，4194/9418 停机时仍在磁盘） |
| `previews/<task>/<sha>/` | 固定版本预览制品（`version.json` + `index.html`） |
| `cognee-venv/` / `cognee-native/` | Python 虚拟环境与 Cognee 原生数据目录 |
| `compiled/` | esbuild 动态编译的 Harness 产物（`.mjs`） |
| `walkthrough/` | 真实浏览器走查截图与 `report.json` |
| `acceptance/` / `assistant-runs/` / `autoloop-*` | 验收报告、Agent 运行记录、Autoloop 回执 |
| `*.png` / `*.log` / `*.json` | 历史截图、日志与试点证据 |

**红线**：真实姓名、`open_id`、密钥、业务正文只落 `.runtime/`；提交前必须做 staged diff 敏感扫描（见 `05` 第 6 节）。

## 5. 构建产物在哪（都不入库）

| 产物 | 位置 | 由谁生成 |
|---|---|---|
| 上游 UI 构建 | `upstream/paperclip/ui/dist/` | `npm run install:upstream` → Vite |
| 中文壳 / 国内适配静态资源 | 同上目录内 `index.html`、`suitme-domestic.js/css` | `npm run build:chinese-shell` |
| 插件 UI 打包 | `plugins/knowledge-workspaces/dist/ui/index.js` | `npm run build:workspaces`（esbuild） |
| Harness 编译缓存 | `.runtime/compiled/deepseek-<hash>.mjs` | `harnessImplementation()` |
| 测试/走查报告 | `.runtime/platform-validation.json`、`.runtime/walkthrough/report.json` | `scripts/test.ts`、`workbench-walkthrough.mjs` |

## 6. 新文件该放哪（约定）

| 要加的东西 | 放这里 | 同步要做 |
|---|---|---|
| 新后端模块 | `src/<name>.ts` | `tests/<name>.test.ts`；在 `04-CODE-MAP.md` 补一行；如新增只读 action，同步 `server.ts` `readOnly` + `members.ts` `reads` |
| 新 CLI / 服务 / 冒烟 | `scripts/<name>.ts`（或 `.py`/`.swift`） | `package.json` 的 `scripts` 加一条；`05` 命令表补说明 |
| 新前端视图 | `plugins/knowledge-workspaces/src/ui/` | 遵守单向依赖（`foundation` → 视图 → `workspace-page` → `index`）；更新 `tests/frontend-structure.test.ts` 若有新边界 |
| 新文档 | `docs/`（项目文档）或 `HANDOFF/`（交接文档） | 更新 `README.md` 导航 / `HANDOFF/README.md` 文件表 |
| 新上游依赖 | `upstream/` submodule | 核许可证原文 → `sources.lock.json` 登记 → `audit:upstream` |
| 新测试夹具 | `tests/fixtures/` | 不得含真实业务数据 |
| 运行证据 | `.runtime/`（自动） | **不要** `git add` |

## 7. 工作区外的两个位置

| 路径 | 说明 |
|---|---|
| `/Users/gong.zhe/Developer/ai-native-collab/HANDOFF/` | **唯一权威位置**（入库、随 push 同步到 GitHub）。所有说明只放这里，直接处理即可 |
| `/Users/gong.zhe/WorkBuddy/2026-11-05-18-10-52/handoff/`、`SuitMe-HANDOFF.zip` | **已停用、不再维护**的历史副本，内容可能落后，不要作为依据 |
| `/Users/gong.zhe/WorkBuddy/2026-11-05-18-10-52/.workbuddy/memory/` | 本助手的工作记忆日志（项目外，仅本机） |

下一位 Agent 只要拿到仓库（或 `HANDOFF/` 目录），从 `README.md` → `00` → `06` 开始即可；唯一位置与同步校验见 `SYNC-STATUS.md`。
