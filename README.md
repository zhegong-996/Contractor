# Contractor

Contractor 把飞书、工作台、项目资料和 GitHub 交付串成一张工单。成员定范围、处理需要人决定的事项，并按版本验收。Agent 根据项目授权读取资料、执行工作、回传证据。确认过的结论可以进入团队知识并追溯到对应版本。

## 本机运行

需要 Node.js 24.11+。源码仓库用 Git 初始化上游依赖，源码发布包已经包含这四个固定子模块。

```sh
if [ -e .git ]; then git submodule update --init --recursive; fi
npm ci
export COLLAB_STATE_DIR="$PWD/.runtime/workbench"
mkdir -p "$COLLAB_STATE_DIR"
cp -n fixtures/workbench.example.json "$COLLAB_STATE_DIR/workbench.json"
npm run workbench -- init-owner product
npm start
```

初始化时在终端输入独立口令，按 Ctrl+D 结束输入。打开 [本机工作台](http://127.0.0.1:4280/)。在接入真项目之前，按实际成员、资料权限、仓库和 Agent 更新样例。已有实例沿用自己的运行目录、项目配置和账本。新部署可以用 `CONTRACTOR_UI_DIR` 指定预构建的前端目录。

## 实现

| 模块 | 用途 |
| --- | --- |
| Super-agent | 工单、职责委托、业务状态 |
| 执行调度 | 目前工作台默认使用 AutoLoop。独立环境可配置 Contractor 调度器，提供租约、等待、停止和回执 |
| Contractor 核心 | 项目层级、账号与授权、上下文、积分、交付版本、人工验收与知识 |
| Contractor 插件 | 渠道、资料、知识检索、只读模型、GitHub 证据与运行适配 |
| Contractor 工作台 | 中文 React 与 Ant Design，按角色查看项目、鉴权、设备、工单和知识 |

[插件与业务架构](docs/PLUGIN-ARCHITECTURE.md) · [项目关系](docs/WORKBENCH-PROJECT-ARCHITECTURE.md) · [企业 IM 登录](docs/WORKBENCH-IM-LOGIN.md) · [交付模板](docs/WORKBENCH-DELIVERY-TEMPLATE.md) · [Octop 接入](docs/WORKBENCH-OCTOP.md)

### 自研调度器联调

在新建的绝对路径 `COLLAB_STATE_DIR` 中将 `workbench.json` 的 `executionRuntime` 设为 `contractor`。独立调度账本在 `dispatch/hub.sqlite`，启动检查会拒绝已有 AutoLoop 账本的目录。本机执行和已授权的远程 Codex、Claude Code 使用同一套工单接口。

远程安装包可用 `npm run package:runner -- --contractor-only` 构建。该包用于连接独立后端，浏览器批准和配对流程沿用现有入口。单个工作台只使用一个调度器。已有工作台的执行记录迁移与回退需要另行验证。

## 测试与安装包

```sh
npm run audit:upstream
npm test
npm run typecheck
python3 tests/deepseek-readonly.py
npm run build:ui
npm run package:runner
npm run package:source
```

`audit:upstream` 与 `package:source` 在 Git 检出中执行。预备执行端安装包生成到 `dist/runner/`，源码包生成到 `dist/source/`。已有模型账户、连接凭据和工作数据由部署者单独配置。

[MIT 许可证](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md) · [源码与分发范围](docs/SOURCES.md)
