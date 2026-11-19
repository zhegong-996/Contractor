# 配置 Contractor

工作台从 `COLLAB_STATE_DIR/workbench.json` 读取部署配置。第一次启动可复制 [工作台样例](../fixtures/workbench.example.json)。管理页面保存的项目职责、模型和额度政策写入业务账本，重启后继续使用。连接密钥和成员模型凭据由部署者在服务端配置。

## 谁能改什么

| 作用范围 | 配置人和入口 | 可配置内容 |
| --- | --- | --- |
| 平台 | 所有者或具有相应权限的管理员，在「平台管理」 | 成员状态、平台角色、组织 IM 登录、模型服务开关及允许模型、积分倍率和预算、渠道健康和审计 |
| 项目 | 项目维护人，在「项目 → 项目设置」及「职责与路由」 | 成员与读写角色、维护人交接、资料授权有效期、按主题及职责指定牵头与决定人、主备模型和执行端 |
| Agent | 所有者在「Agent → 我的 Agent」和「专家与技能」，部署者登记受信执行配置 | 在岗状态、个人代办与共享专家、技能版本、可使用项目、模型、凭据槽位和执行能力 |
| 资料 | 项目维护人关联来源，资料负责人审核内容及访问 | 飞书、GitHub、Figma 与外部文件链接，正文引入、版本采用、受限可见性及临时授权 |
| 工单 | 具备项目委托权限的成员 | 主题、任务范围、Agent 或职责、可选执行端、资料引用、验收条件和交付仓库。受限代码要由有仓库资格的研发接单。 |
| 部署 | 工作台运营方，在 `workbench.json`、各平台管理后台及服务环境 | IM 凭据、历史补读授权、团队 HTTPS、连接端口、工作树、运行时选择、检索插件和操作系统沙箱 |

平台角色决定可使用哪些平台能力。项目成员关系决定可见项目，读者可以查看允许公开的项目内容。子项目可以单独授权。受限资料还要精确核对工单、Agent、资料修订和授权代次。GitHub、飞书与 Figma 对原页继续使用各平台自己的权限。

平台权限从 `$COLLAB_STATE_DIR/console/rbac_policy.csv` 加载。首次启动生成默认策略，旧策略仍可以用 `p, 角色, 权限, use` 表示。本机修改后重启生效。末尾的 `*` 可匹配权限前缀。账号的当前角色和状态来自平台账号记录。访问项目和资料须经过对应的业务检查。

## 项目职责和模型

`projects[].topics` 维护主题与父主题。`projects[].dispatch` 按主题和职责指定牵头 Agent 及可选决定人。`projects[].responsibilities` 为成员登记项目职责。`projects[].modelRoutes` 可以为支持目录探测的本机 Codex 分别配置 `summary`、`personal`、`execution` 的模型顺序。

下面是一个项目对象中的配置片段。示例中的成员、职责和 Agent 都需先登记。

```json
{
  "responsibilities": [{ "member": "engineering", "function": "delivery" }],
  "dispatch": [
    { "topic": "small-screen", "function": "delivery", "agent": "review-agent", "decider": "product" }
  ],
  "modelRoutes": [
    { "agent": "review-agent", "purpose": "execution", "models": ["approved-primary", "approved-fallback"] }
  ]
}
```

每个候选模型都要处于 Agent 的 `allowedModels` 内，并通过平台服务政策。当前模型不可用时按配置尝试备选。积分先预留，再按实际执行 Token 和本轮倍率结算。更换模型或设备继续受同一业务额度约束。平台额度、整理额度、个人与项目池以及 Agent 上限以实际启用的账本规则为准。用量未回传时保留未知状态。

## 渠道、运行时和资料

- 飞书在部署配置填写应用、机器人、已允许群组和补读身份。管理员为项目绑定来源，现有成员用同一账号绑定不同渠道身份。详见 [IM 登录](WORKBENCH-IM-LOGIN.md) 和 [多渠道适配](WORKBENCH-OCTOP.md)。
- 仓库在项目 `resources[]` 登记。`attribution.checkouts` 为受托代码任务指向本地仓库。工作台记录受托提交，可以额外配置 `attribution.entireCommand` 核对会话检查点。交付配置记录贡献者、基准分支、精确可写路径、必需检查、可选部署和验收模板。详见 [交付配置](WORKBENCH-DELIVERY-TEMPLATE.md)。
- 每套实例使用独立的 `COLLAB_STATE_DIR`，按 `executionRuntime` 选择一个调度器。远程设备从受信的团队 HTTPS 配对。已有实例需要按运行时备份和迁移。详见 [执行端连接](WORKBENCH-REMOTE-RUNNER.md)。
- `plugins.memory` 可以选择内置、加权词项或已配置的 Octop 索引。使用哪个检索插件都从核心授权后的候选开始。详见 [模块与插件](PLUGIN-ARCHITECTURE.md)。
- 可输入提示词的位置包括部署配置中的 `agents[].skill`、工作台共享技能和专家说明。Agent 的执行路径、凭据、模型白名单、仓库和可写范围由可信部署配置和业务授权控制。

完整字段及交叉约束见 [配置校验](../src/workbench/config.ts)、[资料与仓库配置](../src/workbench/project-resources.ts) 和 [执行端能力](../src/workbench/execution-capabilities.ts)。
