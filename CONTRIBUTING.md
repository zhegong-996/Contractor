# 参与 Contractor 开发

从 [README](README.md) 启动本机工作台。功能入口见 [文档索引](docs/README.md)，模块边界见 [系统架构](docs/ARCHITECTURE.md)，分支命名与合并方式见 [分支与协作方式](docs/BRANCHING.md)。

## 开发与验证

1. 从最新 `main` 新建短期任务分支，使用独立的 `COLLAB_STATE_DIR` 和示例配置。不要按模块建立长期分支。
2. 在已有适配接口内实现模型、渠道、资料或执行变更，注明受影响的业务状态和权限。
3. 执行 `npm run check:docs`、`npm test`、`npm run typecheck`、`npm run build:ui` 和 `npm run audit:upstream -- --browser`。有 Node 24 与 Linux 沙箱工具的环境可按 [CI](.github/workflows/ci.yml) 验证远端包装和隔离。
4. 提交 PR 时说明可复现的场景、验证范围和证据。线上连接和模型实跑结果使用测试账号与脱敏数据。

工单验收与执行完成分别记账。回执重放应回到原执行。跨端接续应等旧进程退出，并重新核对新一轮资料与额度。发生协议变更时，用原调度器和独立 Contractor 调度器各跑相关用例。

提交前检查差异，确保只包含源代码、示例和所需文档。账号令牌、运行数据库、企业消息、项目原始记录和验收私有附件留在本机运行目录。增加第三方源码时必须记录固定版本、上游路径、许可和分发位置，并更新来源锁与审计脚本。 [第三方来源与许可](docs/SOURCES.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

安全问题按 [Security policy](SECURITY.md) 私密报告，不要先开公开 issue。
