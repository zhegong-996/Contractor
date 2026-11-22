# 分支与协作方式

Contractor 采用以 `main` 为主干的短分支开发方式。模块靠目录、接口契约和插件注册隔离，不靠长期分支隔离。

## 为什么不为每个模块建长期分支

Router、Worker、项目权限、交付验收和知识版本共享同一套业务状态。把模块放进不同长期分支，会产生四个直接问题：

- API 契约、数据库迁移和权限语义容易各自演进，合并时集中爆发冲突。
- 一个改动跨前端、路由和执行端时，需要同时修改多个分支并人工保持一致。
- CI 只能证明各分支单独可用，不能持续证明系统仍能完整串联。
- 新成员不知道应在哪个分支开发，也无法从默认分支直接看到当前架构。

DeepSeek Harness 的公开仓库目前同样以单个受保护的默认分支为主，通过 Pull Request、规则和测试约束质量，没有为运行时、工具和技能各维护一条长期分支。

## 分支类型

| 分支 | 生命周期 | 用途 |
| --- | --- | --- |
| `main` | 永久 | 唯一默认开发线，始终保持可安装、可测试，并作为发布和协作基线 |
| `feat/<area>-<intent>` | 短期 | 新能力，例如 `feat/router-fallback`、`feat/knowledge-recall` |
| `fix/<area>-<intent>` | 短期 | 修复，例如 `fix/worker-receipt-replay`、`fix/im-thread-mapping` |
| `refactor/<area>-<intent>` | 短期 | 不改变外部行为的结构调整，例如 `refactor/execution-ports` |
| `docs/<intent>` | 短期 | 文档、图示和仓库说明 |
| `release/v<major.minor>` | 仅在需要并行维护旧版本时创建 | 补丁发布与回滚；修复仍需合回 `main` |
| `exp/<owner>-<topic>` | 时间受限，最多一个探索周期 | 无法先定义兼容契约的技术验证；明确保留或放弃，不直接当成产品集成分支 |

`<area>` 使用稳定领域名，例如 `auth`、`project`、`gateway`、`router`、`worker`、`delivery`、`knowledge`、`frontend`、`infra`。它只是分支名的检索标签，不改变模块所有权。

不建立 `router`、`worker`、`knowledge`、`frontend` 这类永久模块分支。个人 Agent 可以同时修改 `src/workbench/router.ts`、`workbench/src` 和相关测试，并通过一个 Pull Request 保持契约一致。

## 一次改动怎样进入主分支

1. 从最新 `main` 建立一个只处理一件事的短期分支。
2. 在同一个 Pull Request 中提交实现、迁移、测试和必要文档。跨模块改动必须在同一处展示契约变化。
3. 本地运行 `npm run check:docs`、`npm test`、`npm run typecheck`、`npm run build:ui`；涉及上游源码时再运行 `npm run audit:upstream -- --browser`。
4. 按 [Pull Request 模板](../.github/pull_request_template.md) 说明用户行为、受影响模块、权限或状态变化、迁移与回滚方式，以及真实和模拟验证的边界。
5. 合并后删除短期分支，提交进入 `main`。默认使用 Squash Merge，让一个 Pull Request 对应一条可回退的主线提交。
6. 需要发布时，从已通过检查的 `main` 打不可变版本标签，例如 `v0.1.0`。标签用于识别制品，不用一条移动的分支冒充发布版本。

仓库公开并获得更多维护者后，应对 `main` 启用以下 GitHub 规则：

- 禁止直接推送、强推和删除。
- 必须通过 Pull Request 合入。
- 必须通过当前完整 CI。
- 关键核心目录和第三方来源文件使用 `CODEOWNERS` 指定复核人。
- 合并后自动删除已合并的短期分支。

当前仓库为 Private，部分 GitHub 分支保护能力受账户方案限制。规则不因此改变；接入更多成员前先完成仓库公开或升级所需的保护配置。

## 兼容性与迁移

以下改动即使只落在一个目录，也视为跨模块改动，需要在同一 Pull Request 中更新契约与测试：

- 项目、主题、工单、运行、回执和知识版本的共享数据结构。
- 身份、项目权限、Worker 授权、模型路由和积分扣减。
- Gateway 入站、原会话地址、重复消息与出站回执协议。
- 调度器、Worker 或插件注册协议的兼容变化。
- 浏览器 API 与前端动作之间的权限和状态变化。

破坏性变化需要保留迁移或兼容期。旧执行仍在运行时，不通过新分支绕开停止证明；数据库迁移必须能从备份恢复，并经独立状态目录验证。

## 分支清理

- Pull Request 合并后删除对应远程分支。
- 30 天没有提交或明确计划的 `exp/*` 分支先归档结论，再删除。
- `release/*` 只在仍接收补丁时保留。
- 发布标签、GitHub Release 和源码包保留版本出处，不依赖旧功能分支长期存在。
