# 第一次用执行端接单

适合在同一台电脑体验一张只读工单。使用 GitHub 首页的 Git 和 Node.js 环境，再在执行机准备 Claude Code 与自己的 DeepSeek 凭据。样例使用 DeepSeek Flash。公司部署使用团队 HTTPS 地址及对应的渠道授权。 [DeepSeek 接入 Claude Code](https://api-docs.deepseek.com/guides/anthropic_api/) · [跨主机执行端](WORKBENCH-REMOTE-RUNNER.md)

## 1. 启动示例工作台

在完成 `npm ci` 的源码目录打开终端。示例使用 4280、4281 和 4282 三个回环端口。如果改用其他端口，下面的工作台网址和连接命令也使用配置里的对应地址。

```sh
export COLLAB_STATE_DIR="$PWD/.runtime/first-run"
mkdir -p "$COLLAB_STATE_DIR"
cp -n fixtures/workbench.runner.example.json "$COLLAB_STATE_DIR/workbench.json"
npm run workbench -- init-owner product
npm start
```

初始化时在终端输入自己的试用口令，按 Ctrl+D 结束输入。已有示例账号重启时直接运行 `npm start`。在第二个终端进入同一源码目录，启动本机连接入口。

```sh
export COLLAB_STATE_DIR="$PWD/.runtime/first-run"
node scripts/local-runner-proxy.mjs
```

## 2. 安装并确认执行端

在第三个 Bash 或 Zsh 终端进入同一源码目录，配置本机模型凭据并安装执行端。输入凭据时终端隐藏内容。

```sh
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
printf 'DeepSeek 凭据：'
IFS= read -rs ANTHROPIC_AUTH_TOKEN
printf '\n'
export ANTHROPIC_AUTH_TOKEN
export CONTRACTOR_RUNNER_HOME="$PWD/.runtime/first-run-device"
npm run package:runner
npm install --ignore-scripts --prefix .runtime/first-run-tools ./dist/runner/contractor-runner-0.1.0.tgz
.runtime/first-run-tools/node_modules/.bin/contractor connect http://127.0.0.1:4282
```

打开命令打印的浏览器地址，用刚初始化的 `product` 账号登录，确认「示例协作项目 · 验收清单 Agent」。看到「执行端已上线」后，在 [本机工作台](http://127.0.0.1:4280/) 的 **Agent → 执行设备** 查看在线状态。

## 3. 发一张只读工单

在 **任务中心 → 工作 → 新建工单** 输入标题「整理示例验收清单」和需求「请列出预约表单的三项验收条件，分别覆盖必填、错误提示和提交成功反馈」，执行 Agent 选择「验收清单 Agent」，然后提交。工单的「执行记录」显示 Worker、模型和本轮成果，「交付与验收」显示待人验收的版本。验收后可审阅产生的知识候选。

执行端重连时，在保留 `CONTRACTOR_RUNNER_HOME` 和模型配置的终端运行同一条 `connect` 命令。退出体验时将命令中的 `connect` 改为 `stop`，然后在前两个终端用 Ctrl+C 结束示例服务。
