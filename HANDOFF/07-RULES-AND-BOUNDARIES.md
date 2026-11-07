# 07 · 红线与边界（动手前必读）

## 1. 业务验收红线（最高优先级）

- `Agent 完成 ≠ 业务验收`。报告、独立评审模型判定、CI 通过、合并审批、自动发布**都不替代**最终核可。
- 最终核可只能由**原发起人在原会话**用中文「确认验收 任务编号」完成（`controller.confirmAcceptance` 会校验身份、锁定清单、逐项报告与 Trace）。
- SUI-129 至今未核可；不要为了「让系统看起来完成」而代做或伪造。
- 开工前锁定验收清单、标准由职能 owner 起草、独立评审者不得是产出模型。

## 2. 隐私与仓库边界

- 真实姓名、`open_id`、密钥、业务正文**只落 `.runtime/`**，被 `.gitignore` 忽略。
- 每次提交前做 staged diff 敏感扫描（见 `05` 第 6 节）；确认无 `.runtime` / `ui/dist` / `dist/ui` 入库。
- Cognee 原生管线的凭据只经 `spawn` 进程环境传递，**不写** `.runtime/config.json` / `secrets.json` / 仓库；配置里只存环境变量名。
- 用户 2026-11-07 已明确**允许外部模型 API**：启用后业务材料会发往所配置的外部服务。这是已变更的隐私边界，不要偷偷改回「不外发」口径，也不要在未经确认时把材料发到别处。
- `.runtime/routing/`、`.runtime/memory/` 是 append-only 真实日志；测试动作由 `COLLAB_TEST_TRACE` / `COLLAB_TEST_MEMORY` 隔离，不要往真实日志写演示数据。

## 3. 服务约束

- **4190 / 4192 / 4194 / 9418 是用户主动取消的服务，不得重启**，也不要再打开 4194 页面。
- 只有 3100 / 4180 可以按需恢复，且必须用干净环境（`NO_PROXY` 等）。
- 本机交付台与 git daemon 当前停机，因此 `delivery:demo` 的 `gitProtocolClonePull: false` 是预期，不是缺陷。

## 4. 上游与许可证

- **不改 `upstream/` 下任何上游源码**；`npm run audit:upstream` 必须 `clean: true`，7 个 submodule 与 `sources.lock.json` / gitlink 一致。
- LobeHub 主仓库（Community License）与 Outline（BSL 1.1）**只借思想，禁止复制代码与衍生分发**；`lobehub/acceptance` 是独立 Apache-2.0，可复用格式/CLI。
- Super Agent、Agent Autoloop、DeepSeek Harness、Prime Agent、Cognee、Paperclip 均为 MIT/Apache-2.0，可复用代码；`src/vendor/prime-query.ts` 必须保留 Mario Zechner 原始 MIT 版权头。
- 引入任何新上游前：先核对许可证原文、登记 `sources.lock.json`、跑 `audit:upstream`。

## 5. 前端与入口红线

- 「**没连接不要放空入口**」：只有 `service-status` 探测 `connected` 且 URL 通过 `safeLoopbackUrl` 才渲染 `<a href>`；未接通项连 `url` 字段都没有，也不放可点按钮。
- 前端必须保持 **5 tab 插件式单页**，不新增独立前端路由；工作台不是第二个任务发起入口。
- 中文壳只改展示文案，不改路由 / API enum / 业务内容 / 上游源码；构建顺序「先 domesticShell 再 chineseShell」。

## 6. 工程约束

- A → B → C **不并行**；B2 验收前不要开始 C。
- 派活 / 状态判断必须走统一 `RoutingDecision` 与同一份 Trace，不要再各写一套；新增只读 action 必须同步 `server.ts` 的 `readOnly` 与 `members.ts` 的 `reads` / `v06Reads`。
- Trace 写入是 advisory：**失败不得改变任务、回执或验收结果**。
- 撤权是状态写入，不是物理删除；`source-revoked` 全局阻断派生记忆，`grant-revoked` 不得放大成全局屏蔽。
- 确定性链路 `modelCalls=0`：设备端 Apple NL 词向量与确定性 L2 抽取不调用模型；`assertDeterministic()` 非零即拒绝，不静默降级。
- 每轮交付：全套回归 + 文档同步（README / SYSTEM-ARCHITECTURE / ADAPTATION 最新边界 / VALIDATION）+ 提交并 push 到 `origin/main`。
