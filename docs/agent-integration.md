# Agent 接入合同

所有执行端围绕同一个 Paperclip 任务工作。交接包包括任务、需求来源、代码基线、允许修改的路径、业务验收项、检查点和已采用决策。

## 后台执行

`.runtime/config.json` 中的每个 Agent 指定 `mode`、`use`、`access`、`enabled`。`setup` 把配置映射为 Paperclip 原有进程适配器。进程调度、运行互斥和取消仍由 Paperclip 管理。

```json
{
  "name": "我的 CLI Agent",
  "mode": "managed",
  "use": "command",
  "enabled": false,
  "access": "edit",
  "command": ["my-agent", "run", "--prompt", "{prompt}"]
}
```

先用该产品的官方文档核对真实参数，再进行一次无副作用探测。不要照抄这里的示意命令并启用。通用命令模式默认没有会话恢复合同；需要恢复时应提供支持 session 的适配器，或改用人工接单与交接包。

## 人工接单：CLI

以 WorkBuddy 为例，在其本地终端工具中使用当前 checkout 的绝对路径，并设置对应协作身份：

```sh
COLLAB_AGENT=workbuddy node --import /absolute/suitme-collab/node_modules/tsx/dist/loader.mjs /absolute/suitme-collab/src/cli.ts tasks
COLLAB_AGENT=workbuddy node --import /absolute/suitme-collab/node_modules/tsx/dist/loader.mjs /absolute/suitme-collab/src/cli.ts claim SUI-1
```

领取后保留返回的 lease，在指定工作目录内继续开发。回执 JSON 文件示例：

```json
{
  "receiptId": "每次提交固定的UUID",
  "agent": "workbuddy",
  "lease": "领取时返回的UUID",
  "text": "已完成任务，并验证新增任务与状态修改。",
  "session": "产品自身会话标识，可选"
}
```

同一回执重试使用同一个 receiptId。同一任务不能用新的 lease 强行领取。换执行端须在旧执行已停止、交接包已保存后，由任务负责人转交。

## 人工接单：MCP

生成配置时，把 `/absolute/suitme-collab` 换成实际 checkout 路径：

```json
{
  "mcpServers": {
    "suitme-collab": {
      "command": "node",
      "args": ["--import", "/absolute/suitme-collab/node_modules/tsx/dist/loader.mjs", "/absolute/suitme-collab/src/mcp.ts"],
      "env": { "COLLAB_AGENT": "workbuddy" }
    }
  }
}
```

工具为 list_tasks、read_task、claim_task、submit_checkpoint、publish_delivery。没有任意 shell、跨 Agent 派单、合并、生产发布或业务验收工具。

WorkBuddy 官方连接器文档支持 MCP + Skill 与 CLI + Skill：[官方文档](https://open.workbuddy.cn/docs/connector)。这证明可以让 WorkBuddy 调用协作平台，不证明平台可以通过一个 `workbuddy -p` 命令自动启动 WorkBuddy。

豆包工作的自动执行入口仍需对应官方版本及登录态验证；当前只提供通用接入合同，不宣称已接通其后台 CLI。

## 等待与恢复

需要人的决定时，复用 Autoloop 的 ask 回执。进程结束，问题和检查点保留在任务中；答复到达后恢复任务。不要在 CLI 进程中无限等待人。

模型会话标识属于具体执行端。换产品不迁移私人完整聊天，而是继续使用同一任务、代码工作树和交接包。

取消只有在 Paperclip 运行终止且本地 Agent 进程组消失后才算确认。失联后的动作结果不明时，保留现场，不能直接换工具重做。

现阶段 Autoloop 的 later 回执只作为保留的复查意图记录，未转换为新的模型定时任务；不要据此声称已经约好自动执行。CI 和产物核对由确定性的交付检查完成。
