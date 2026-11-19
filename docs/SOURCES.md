# 第三方来源与分发

Contractor 原创代码使用 [MIT](../LICENSE)。源码包、浏览器构建和执行端安装包保留各自使用的第三方声明。源码子模块固定到 [sources.lock.json](../sources.lock.json) 的提交，npm 依赖固定版本和完整性校验值。[第三方声明](../THIRD_PARTY_NOTICES.md)

| 来源 | 实际使用 | 分发位置 |
| --- | --- | --- |
| [Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4) | 原版 Engine、Store、Effects、飞书来源和回传。Contractor 实现项目、主题与权限适配。 | 源码子模块，MIT |
| [Agent AutoLoop](https://github.com/KKKKhazix/agent-autoloop/tree/ba8cf6d8cf24f9ce005958c15d88f2d9cff7f05d) | 原版调度、租约、worker、会话及 CLI 的兼容部署。 | 源码子模块与默认执行端包，MIT。自研执行端专用包不含该源码 |
| [Octop Gateway](https://github.com/TencentCloud/octop-gateway/tree/224ed078ce20042fb5fa59240d6e3c7c34bcd67f) · [Octop Memory](https://github.com/TencentCloud/octop-memory/tree/37ef325d46f13181eba69591604465d04c95cb5f) | 可选的 IM 接入及全文检索。服务通过授权后的请求取得输入。 | 两个源码子模块，MIT |
| [Octop](https://github.com/TencentCloud/Octop/tree/bf134dbd379036ce7545c7df1a1da7e381ece9ff) | 成员选择、消息署名两个组件，采用 Contractor 项目权限和消息来源。 | 浏览器产物附原 MIT 声明 |
| [Ant Design](https://github.com/ant-design/ant-design/tree/6.7.1) | Contractor 侧栏、菜单、面包屑、表单、标签页、弹窗、状态和权限界面。 | npm 锁定，浏览器产物附许可证 |
| [Backstage catalog-model](https://github.com/backstage/backstage/tree/40525466a0f70119579cbfc4a60b9d2aa6c8a52d/packages/catalog-model) · [Casbin](https://github.com/casbin/node-casbin) | 资料引用、知识关系和角色策略。 | npm 锁定，Apache-2.0 |
| [Anthropic Sandbox Runtime](https://github.com/anthropics/sandbox-runtime) | Agent 执行时的文件与网络约束。原版 CLI 由隔离适配器调用。 | npm 锁定，Apache-2.0 |
| [Entire CLI](https://github.com/entireio/cli/releases/tag/v0.13.4) · [Figma REST API 类型](https://github.com/figma/rest-api-spec) | 可选本机提交溯源，Figma 响应类型。 | Entire CLI 由部署者安装，Figma 类型为开发依赖 |

## 设计参考与自研落点

- DeepSeek Harness 把 Agent Loop、Session 与外部模型、工具、接口分开，通过服务注册与插件生命周期组装。Contractor 采用启动时绑定能力、关闭时反序回收的思路。Super-agent Store 所需的 Schemastery 和 Cosmokit 使用独立发布的 MIT 包。 [Harness 架构](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/docs/architecture.md) · [能力接口](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/docs/capability-seams.md)
- LobeHub 的批量整理、题内对话和档案为设计参考。Acceptance 的需求逐项验收、产物证据和人工签收为产品参考。需求版本、回执校验、浏览器报告解析、签收和知识采用均由 Contractor 实现。 [LobeHub 许可](https://github.com/lobehub/lobehub/blob/a8424d204a7ed1eb36985ebdfa6eac8041615392/LICENSE) · [Acceptance](https://github.com/lobehub/acceptance/tree/f720feb862bdbe3acc653bdedc297e20e08be1ae)
- Octop Harness 的全量源码含使用独立许可的内置技能。当前只读专家由 Contractor 的 DeepSeek HTTPS 适配器、回执解析和 YAML 技能版本实现。Octop Gateway 和 Memory 是独立保留的选配。 [Octop Harness 技能许可](https://github.com/TencentCloud/octop-harness/blob/86a48ad11be041d1939e4c38581a7f03641bb9e7/src/octop_harness/builtin/skills/en/powerpoint/LICENSE.txt)
- 交付模板借鉴 LoopForge 的版本化交付物和门禁，落地到 Contractor 工单快照和 GitHub Actions 证据。 [LoopForge 工作流定义](https://github.com/Tencent/LoopForge/blob/e89cda9804643d3631e77652d1bca47a079adb69/internal/domain/workflow.go)

## 制品检查

`npm run audit:upstream` 检查源码提交、已保留的组件出处、npm 锁定及许可清单。 `npm run package:source` 以显式路径清单收集源码、锁文件、文档和必要上游版本。 `npm run package:runner` 生成执行端包。网页的第三方许可证可从 `/licenses/components` 和 `/licenses/browser-dependencies` 取得。

源码包只包含选定的配置样例。运行数据、账号及凭据、私有证据和本机测试记录位于部署者的运行目录。Codex、Claude Code、外部模型服务和渠道 API 由使用方配置。自带这些工具或第三方服务的安装镜像需要核对其随包条款。
