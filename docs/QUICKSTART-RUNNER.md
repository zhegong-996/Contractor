# 第一次用执行端接单

适合在同一台电脑体验一张只读工单。使用 GitHub 首页的 Git 和 Node.js 环境，再在执行机准备 Claude Code 与自己的 DeepSeek 凭据。样例使用 DeepSeek Flash。公司部署使用团队 HTTPS 地址及对应的渠道授权。 [DeepSeek 接入 Claude Code](https://api-docs.deepseek.com/guides/anthropic_api/) · [跨主机执行端](WORKBENCH-REMOTE-RUNNER.md)

## 1. 启动示例工作台

先克隆仓库并安装锁定依赖。

```sh
git clone --recurse-submodules https://github.com/zhegong-996/Contractor.git contractor
cd contractor
npm ci
```

示例使用 4280、4281 和 4282 三个回环端口。如果改用其他端口，下面的工作台网址和连接命令也使用配置里的对应地址。

```sh
export COLLAB_STATE_DIR="$PWD/.runtime/first-run"
mkdir -p "$COLLAB_STATE_DIR"
cp -n fixtures/workbench.runner.example.json "$COLLAB_STATE_DIR/workbench.json"
node --import tsx src/workbench/server.ts init-owner product
npm start
```

初始化时按提示设置口令并回车。重启时直接运行 `npm start`。用 `product` 登录工作台，点 **新建项目**，填写项目名称与首个主题。在 **项目结构 → 项目 Agent → 加入我的 Agent** 选择「验收清单 Agent」。

如果已经按 README 创建项目，可以沿用原工作台。停服务，把执行端样例中的 `remoteRunnerPort`、`runnerConnectUrl`、职责和 Agent 合并进原配置，设置 Agent 的 `owner` 为本人账号、`projects` 为空数组。重启后在原项目点「加入我的 Agent」。代理和工作台须使用相同的状态目录。

在第二个终端进入同一源码目录，启动本机连接入口。

```sh
export COLLAB_STATE_DIR="$PWD/.runtime/first-run"
node scripts/local-runner-proxy.mjs
```

## 2. 安装并确认执行端

在第三个终端进入源码目录，用仓库自带的连接工具启动 Worker。首次确认设备后，终端提示输入 DeepSeek API Key，输入隐藏。工具会核对服务商返回的模型目录。

```sh
export CONTRACTOR_RUNNER_HOME="$PWD/.runtime/first-run-device"
node bin/contractor.mjs connect http://127.0.0.1:4282 --bind-agent
```

打开命令打印的浏览器地址，用刚初始化的账号登录，选择自己的项目和「验收清单 Agent」，确认连接。看到「执行端已上线」后返回工作台。

如果还要体验个人对话或 Router，在 **平台管理 → 模型服务 → 连接 DeepSeek** 验证工作台使用的 Key，然后到「配置个人 Agent」或「配置 Router」选择模型并保存。

## 3. 发一张只读工单

在 **项目结构 → 主题 → 发起** 输入工单标题和验收条件，执行 Agent 选择「验收清单 Agent」，点击「提交委托」。在「执行记录」核对设备与模型，完成后在「交付」核对本轮正文和版本。填写可复用结论及适用条件，点击「验收第 1 版」。打开「查看知识候选」核对内容后点「确认采用」，可在「知识与记忆 → 现行」点回原工单。

执行端重连时，在保留 `CONTRACTOR_RUNNER_HOME` 和模型配置的终端运行同一条 `connect` 命令。退出体验时将命令中的 `connect` 改为 `stop`，然后在前两个终端用 Ctrl+C 结束示例服务。
