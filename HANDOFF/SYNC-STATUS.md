# 10 · 唯一位置声明与接手校验

> 用户要求：**所有相关说明只放在 `/Users/gong.zhe/Developer/ai-native-collab/HANDOFF/`**，直接处理这个目录即可。本文件把原先分散在外部副本里的「来源 / commit / 阅读顺序」信息收拢进来，并明确其它位置已停用。

## 1. 唯一权威位置

| 项 | 值 |
|---|---|
| 唯一权威目录 | `/Users/gong.zhe/Developer/ai-native-collab/HANDOFF/` |
| 同步方式 | 随 `main` 分支提交推送到 `https://github.com/zhegong-996/suitme-collab.git`；clone 仓库即得 |
| 手工修改 | **只改本目录**，然后 `git add -A && git commit && git push origin main` |
| 已停用（不再维护） | WorkBuddy 工作区 `handoff/` 副本、`SuitMe-HANDOFF.zip` — 内容可能落后，**不要作为依据** |
| 项目原文档 | `docs/`、`README.md` 仍有效；本包是导航与现状归纳，冲突时以 `docs/ADAPTATION-v0.6.md` 最新边界、`docs/PRD-v0.6.md` §10C、`docs/VALIDATION.md` 最新验证为准 |

## 2. 提交与同步状态

| 项 | 值 |
|---|---|
| **运行代码基线** | 第二十一轮 C-6 完成（含运行代码：单一 Router / 组织形态配置 / 状态视图 / 新契约测试；C-1 的 PG 宿主与 C-2 的独立控制台已在前两轮）；**以 `git rev-parse HEAD` 为准**（交接时的 `b58631c` / `f6611e0` / `4aa6fb0` 均为历史） |
| 阶段 | A 完成 → B1 完成 → **B2 完成并验证** → **C 进行中（② 已拍板，C-0 / C-0b / C-1 / C-2 / C-3 / C-4 / C-5 / C-6 全部完成 / 收尾已提交推送）**（严格不并行，C-0 → C-6 + 收尾） |
| 本文件所在提交 | 随 `main` 前进，clone 后 `git log -1` 即最新 |
| 同步方式 | 代码与文档一并提交并 push 到 `origin/main`；`HEAD = origin/main = 远端 main` |

第二十一轮 C-6 已重跑全套回归全绿：`npm test` 400/400、`tsc`、两个构建、`test:responsive`、真实浏览器走查 11/11、`console:smoke ok:true`、`router:smoke` 31/31、`agents:smoke` 43/43、`shapes:smoke` 36/36、`evolution:smoke` 45/45、`audit:upstream clean`、`git diff --check`、`host:pg` 21/21。第十五轮 C-0 / C-0b 为文档改动；第十六轮 C-1 落地 PG 宿主与步进队列；第十七轮 C-2 落地自研独立控制台与全量国内化；第十八轮 C-3 落地单一 Router；第十九轮 C-4 落地组织级 Agent 编制、验收协作与 A2A 在岗交接；第二十轮 C-5 落地按当前配置重跑三层评估与两种形态真实一单；第二十一轮 C-6 落地沉淀回流与自演进闭环（交付前强制自查 / 候选改进闭环 / 四项效果对比），真跑 45/45。最新结果以 `05` 与 `docs/VALIDATION.md` 第二十一轮为准。

## 3. 接手时先跑这三条

```sh
cd /Users/gong.zhe/Developer/ai-native-collab
git status --short --branch                    # 应干净且与 origin/main 一致
git rev-parse HEAD; git rev-parse origin/main; git ls-remote origin main   # 三者应一致
npm run agents:smoke                            # C-4 编制真跑 43/43
npm test                                       # 400/400
```

需要本机服务时先设干净环境（见 `00-START-HERE.md` 第 2 节）：
```sh
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost NODE_USE_ENV_PROXY=0
```

## 4. 阅读顺序（本目录内即可完成）

1. `README.md` — 总索引与包内每个文件的说明
2. `00-START-HERE.md` — 环境、服务、干净环境变量、8 个已知坑
3. `06-CURRENT-STATE-AND-NEXT.md` — 现在做到哪、B2 四项与 C-1 的真跑证据、**C-0~C-6 分步清单与产品原则**、什么不能动
4. `docs/PRD-v0.6.md` §10C — C-P1~C-P8 可验收条款（动手前必读）
5. `05-VALIDATION-AND-COMMANDS.md` — 全套回归、预期输出、排障、提交前检查
6. `DIRECTORY-GUIDE.md` — 目录树、每个目录作用与入库状态、`.runtime/` 与产物位置
7. `FILE-INVENTORY.md` — 全部文件逐文件一行说明
8. `01` / `02` / `03` / `04` — 产品、技术、21 轮工作日志、代码地图（按需查）
9. `07-RULES-AND-BOUNDARIES.md` / `08-OPEN-DECISIONS.md` — 红线与需用户拍板事项（**动手前必读**）
10. `handoff-manifest.json` — 机器可读元数据

## 5. 本文件的说明

`SYNC-STATUS.md` 自身：声明唯一权威位置、记录代码基线/提交关系、给出接手校验命令与阅读顺序；是纯文档，不参与任何构建或运行。若后续新增交接文件，记得同步更新 `README.md` 的文件表、`DIRECTORY-GUIDE.md` 的目录树、`handoff-manifest.json` 的 `handoffFiles`，并重新生成 `FILE-INVENTORY.md`（生成方式：读 `git ls-files` + `HANDOFF/`，按源码注释/导出/真实测试名补齐说明）。
