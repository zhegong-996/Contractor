# SuitMe 协作台

在同一个项目里关联飞书讨论、产品资料、Figma 原型和 GitHub 仓库。Super-agent 管理工单、授权和委托，AutoLoop 驱动 CLI Agent、等待和接续。成员在工作台决定待办事项、验收对应提交，再把确认的经验纳入项目知识。

## 启动

需要 Node.js 24.11 或更新的 24.x 版本。飞书、GitHub 和执行端按项目配置。

```sh
git submodule update --init --recursive
npm ci
export COLLAB_STATE_DIR="$PWD/.runtime/workbench"
mkdir -p "$COLLAB_STATE_DIR"
cp -n fixtures/workbench.example.json "$COLLAB_STATE_DIR/workbench.json"
npm run workbench -- init-owner product
npm start
```

在终端输入初始化口令并按 Ctrl+D，然后打开 [本机工作台](http://127.0.0.1:4280/)。已有实例沿用自己的 `COLLAB_STATE_DIR`、`workbench.json` 和账本。接入真实来源前先填写项目、成员、Agent、资料权限和连接配置。[工作台说明](docs/WORKBENCH.md)

## 目录

| 路径 | 用途 |
| --- | --- |
| `src/workbench/` | HTTP 入口、身份绑定、项目与工单路由、执行适配、交付验收和知识 |
| `src/` | 共用的登录授权、飞书读取、GitHub 校验、上游接入与知识投影 |
| `workbench/` | 基于 Paperclip 开源组件的中文 React 工作台 |
| `upstream/` | 固定版本的 Super-agent、AutoLoop、DeepSeek Harness |
| `fixtures/`、`tests/` | 配置样例、测试仓 CI 模板和回归测试 |

```sh
npm run audit:upstream
npm test
npm run typecheck
npm run build:ui
```

[交接、恢复与多轮交付](docs/WORKBENCH-ITERATIONS.md) · [迁移设计与九项生产能力](docs/SUPERAGENT-MIGRATION.md) · [上游使用位置](docs/SOURCES.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

[协作记忆、注册执行端和额度](docs/WORKBENCH-MEMORY-AND-DEVICES.md)

[九项生产能力的当前核验与缺口](docs/PRODUCTION-CAPABILITY-AUDIT.md)逐项区分已接能力、验证范围和未完成事项。迁移设计中的目标不代表全部实现。

旧 Paperclip 宿主、插件及首轮迁移原型可从 [清理前版本](https://github.com/zhegong-996/suitme-collab/tree/a7b8b1f7c97cf3fe4cba6894e14590448c0d8ae7) 查阅。旧实例与工作台使用各自的运行目录。
