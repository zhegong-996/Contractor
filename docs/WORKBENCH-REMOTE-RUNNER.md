# 跨主机执行端

## 服务端配置

在工作台运行目录的 `workbench.json` 配置 `remoteRunnerPort`。该端口使用独立的回环监听，只接受执行端的配对、领取、心跳、开始、回执和离线请求。团队在执行机通过 SSH 隧道连接，或将这个端口交给自己的 HTTPS 入口。工作台登录和项目资料页面仍通过工作台端口访问。

在 `agents` 登记负责人、项目、职责和模型。支持如下远程运行配置。

| 引擎 | 执行配置 | 执行机准备 |
| --- | --- | --- |
| Claude Code | `"engine": "claude"`，`"model": "qwen2.5:1.5b"`，`"execution": {"kind":"remote","provider":"ollama","effort":"low"}` | 在执行机装好 Claude Code 和 Ollama，在回环端口 11434 启动 Ollama 的本地模式并准备所登记的模型。每轮有独立的 CLI 配置目录，Claude 使用标准输入取得本轮上下文，以受限、无工具模式运行。 |
| Codex | `"engine": "codex"`，`"model": "gpt-6.1-sol"`，`"execution": {"kind":"remote","provider":"openai","credential":"codex","domains":["chatgpt.com","api.openai.com","auth.openai.com"]}` | 在执行机装好 Codex 和与宿主系统匹配的隔离依赖。在 Runner 数据目录下按现有约定配置 `member-credentials/<owner>/codex.json`。 |

远程 Codex 现在支持只读任务和受限代码任务；Claude Code + Ollama 仍为只读。代码任务沿用工作台已有的研发接单、仓库基线、提交回收和验收路径。平台群整理继续用 `discussion.agent` 选择工作台本机执行 Agent。项目的 `dispatch` 可把工单交给已登记的远程 Agent。Cursor、ACP 及其他引擎尚未完成隔离适配，登记名称或声明能力不会使它们自动可执行。

远端代码运行取得冻结的代码包，不取得工作台 Git 凭据或 `.git`。每包最多 8 MiB、4000 个文件，最多十个写入范围；大仓库当前会明确阻塞，尚不支持分片下载。回传必须包含本轮代码包哈希、路径差异和停止证明。工作台重新检查资料授权、写入路径及本地基线，再复用原有隔离工作区导入和 Git 提交。重复回传不会覆盖新改动，也不会产生第二个提交。远端的 CLI 模型回报与本轮配置不一致时交付失败。

执行机为 Linux 时，复用 Sandbox Runtime 的文件和网络隔离。针对只读挂载覆盖可写子路径的行为，适配层将读文件与写入范围分别装配；不放开整个仓库写权限。单文件新建采用占位文件，未实际写入的空占位不会当成交付。

## 配对与接单

1. Agent 所有者登录工作台，通过本机 API `POST /api/device/pair` 传入 `{"project":"store","agent":"engineering-claude","remote":true}`。配对码十分钟失效，只能用一次，并绑定该项目、Agent 和所有者。
2. 执行机检出同一版本，安装 Node 24 和项目依赖，为此次配对创建专属的 `COLLAB_STATE_DIR`。例如用 `ssh -N -L 4330:127.0.0.1:4290 user@workbench-host` 转发已配置的 4290，再在执行机运行：

   ```sh
   npm run runner -- pair-remote http://127.0.0.1:4330 "研发笔记本"
   npm run runner -- connect 执行端ID
   ```

   第一条命令从标准输入读取配对码，输入后用 Ctrl+D 结束。可将 URL 替换为已配置 TLS 的 HTTPS 入口。配对成功后，执行机的私有目录保存设备凭据。
3. 工单可显式传 `device`。项目规则选中远程 Agent 且只有一个合适设备在线时，系统可选用该端。若已登记的唯一设备离线，工单等它重新上线。有多个可选设备时，由人指定。
4. 原单可通过现有接续和交接接口换执行端。`POST /api/ticket/<id>/resume` 可为同一 Agent 传入 `device`。`POST /api/ticket/<id>/handoff` 可指定接替 Agent 及其 `device`。
5. 所有者通过 `POST /api/device/<id>` 提交 `{"state":"suspended"}`、`lost`、`retired` 或 `active` 管理执行端。停用后停止派入新任务，并请求结束持有的运行。丢失和退役会生成恢复停止回执的待办；两者都不等于旧进程已停止。退役不可直接重启，需重新配对；原配对仍可交回它已持有运行的停止回执。旧 `{"active":false}` 请求仍兼容为暂停。

## 断线、权限与账本

AutoLoop 原版 worker 持久化本地执行状态和待发回执。连接重建后，同一设备可以继续交回原运行与尝试的回执。派工服务在准备上下文和接收结果时复核项目、资料与委托权限，匹配设备、运行、尝试和租约。已授权执行端可能在短暂断线时继续完成本轮，断线期间新增的撤权与取消会在连接恢复后送达。回执确认后，接单程序清理本轮装配的上下文和本地会话文件。

换端时，工作台先从原生运行请求取消，旧端检查进程组及其已观察的子进程并交回停止证明。工作台核对该证明属于原尝试后，才在同一工单开启接替运行。旧端离线期间保留等待状态。证明由配对设备的接单程序生成，因此应只给受信的用户设备配对。跨轮接续重新装配原单上下文，远程 Agent 每轮以新 CLI 会话开始。

平台整理、个人代办和项目执行沿用原有用量账本，按实际发出的运行和尝试扣一次。接单程序重报同一结果不重复扣。如果 AutoLoop 已收妥结果而工作台账本写入失败，重报会补记原尝试的账本和回执。工作台保存 CLI 实际报告的模型和用量，未上报的字段保持未知。新一轮授权及人工验收沿用现有工单接口。

## 源码复用

继续使用固定提交的 AutoLoop worker 及其 CLI 适配，SuitMe 负责设备绑定、授权上下文与交接门禁。Claude Code 的输出和 Token 解析沿用原版插件。本地 Ollama 保留 Token 回执，平台不把 CLI 估价当作账单金额。 [AutoLoop 领取与回执协议](https://github.com/KKKKhazix/agent-autoloop/blob/ba8cf6d8cf24f9ce005958c15d88f2d9cff7f05d/docs/protocol.md) · [Claude Code CLI 参考](https://code.claude.com/docs/en/cli-reference) · [Ollama 连接 Claude Code](https://docs.ollama.com/integrations/claude-code)

## 门店推荐理由联调

以下是早期跨主机只读链路的证据，不能替代后续代码交付验证。

工作台运行在无共享目录的 Debian 虚拟机中，macOS 执行端经 SSH 转发接单。飞书入口使用测试事件。平台整理和后续接单实际调用 Codex，个人委托和接续实际调用 Claude Code 与本地 Ollama。

- 个人委托经资料所有者批准后领取。撤权后再次读取该轮上下文快照被拒绝。
- 切断转发连接并重启接单程序后，原设备用同一工单、运行和尝试回传，用量只记一次。
- 旧端离线或进程仍在运行期间，接替端不能领取。旧端回传退出证明后，Codex 接续同一工单，经产品测试账号验收。
- 账本共保留五条回执，分别为平台整理一次、个人委托一次、项目执行三次。被取消的尝试没有模型用量数据。

2026-11-16 的新增验证：macOS 工作台向无共享目录的 Debian Linux 执行端派单，真实飞书测试群进入，真实 Codex 修改单一 HTML 文件。测试 PR [#16](https://github.com/zhegong-996/desktop-tutorial/pull/16) 和 [#17](https://github.com/zhegong-996/desktop-tutorial/pull/17) 的精确提交 CI 通过后，由产品测试身份通过后端验收；PR 均未合并或部署。#17 还实际运行了个人 Agent 提出子单、负责人确认、研发接单、子单验收后父 Agent 汇总。完整结果和限制见[后端补齐记录](BACKEND-COMPLETION-2026-11-16.md)。
