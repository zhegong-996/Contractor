# 配置 Contractor

工作台从 `COLLAB_STATE_DIR/workbench.json` 读取部署配置。第一次启动可复制 [工作台样例](../fixtures/workbench.example.json)。样例从空工作台开始，不含预置项目、职责或 Agent；完成所有者初始化后，在页面创建第一个项目。项目、职责、模型和额度政策写入业务账本，重启后继续使用。连接密钥和成员模型凭据由部署者在服务端配置。

## 谁能改什么

| 作用范围 | 配置人和入口 | 可配置内容 |
| --- | --- | --- |
| 平台 | 所有者或具有相应权限的管理员，在「平台管理」 | 成员状态、平台角色、组织 IM 登录、模型服务、Router 与知识提炼模型、积分倍率和预算、渠道状态与审计 |
| 项目 | 项目维护人，在「项目 → 项目设置」及「职责与路由」 | 成员与读写角色、维护人交接、资料授权有效期、按主题及职责指定牵头与决定人、主备模型和执行端 |
| 个人 Agent | 成员在「个人设置 → 个人 Agent」 | 名称、个人指引、本人确认的经验和轻量模型，使用个人额度进行私有咨询 |
| 执行 Agent 与设备 | 部署者登记信任的执行配置。成员在「个人设置 → 执行设备」管理自己的设备，项目维护人配置项目路由 | 引擎、可用模型、执行能力、设备接单范围和主备设备，已有任务通过原工单交接 |
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

### Router 和验收经验的轻量模型

管理员可以在「平台管理 → 模型服务 → 连接 DeepSeek」输入 API Key 和模型 ID，验证通过后在个人 Agent 或 Router 中选择模型。工作台凭据只保存在状态目录的 `assistant-deepseek.private.json`（仅服务账号可读写）。账本恢复到新机器后，请重新连接。设置了环境变量时沿用部署凭据；已有部署模型名单仍限制可选范围。Worker 由设备所有者单独授权。

部署者也可以在 `workbench.json` 登记可选模型。可使用 DeepSeek 或本机 Ollama。DeepSeek 的 API 凭据放在服务进程的 `CONTRACTOR_DEEPSEEK_API_KEY`，Ollama 使用回环地址。平台默认未启用整理模型。

```json
{ "platformAssistant": [{ "provider": "deepseek", "models": ["deepseek-flash"] }] }
```

管理员在「平台管理 → Router 与知识提炼」选同一个模型，设置每日调用上限，查看实际模型和 Token 回执。项目维护人在待办里请求接单建议。知识负责人在验收候选的核对表单请求提炼。两项请求分别生成结构化草稿，核对后由人选择 Agent 或采用知识。启用积分时按供应商和模型配置倍率，使用平台整理池并计入原项目总额度。

知识提炼使用当前可读取的验收候选及适用条件。受限来源、已失效的来源和识别到敏感内容的候选走人工核对。候选的适用范围、引用和权限由现有知识模块管理，模型不可用时可照常人工处理。项目既有的定时群整理继续用 `discussion` 的执行配置。

成员可从同一部署模型目录单独为自己的个人 Agent 选模型。个人咨询使用本人保存的指引和经验，计入个人额度。个人经验保存在成员账号内，项目知识继续在「知识与记忆」管理。

## 渠道、运行时和资料

- 飞书在部署配置填写应用、机器人、已允许群组和补读身份。管理员为项目绑定来源，现有成员用同一账号绑定不同渠道身份。详见 [IM 登录](WORKBENCH-IM-LOGIN.md) 和 [多渠道适配](WORKBENCH-OCTOP.md)。
- 仓库在项目 `resources[]` 登记。`attribution.checkouts` 为受托代码任务指向本地仓库。工作台记录受托提交，可以额外配置 `attribution.entireCommand` 核对会话检查点。交付配置记录贡献者、基准分支、精确可写路径、必需检查、可选部署和验收模板。详见 [交付配置](WORKBENCH-DELIVERY-TEMPLATE.md)。
- 每套实例使用独立的 `COLLAB_STATE_DIR`，按 `executionRuntime` 选择一个调度器。远程设备从受信的团队 HTTPS 配对。已有实例按迁移手册检查离线状态、配对及回滚。 [切换调度器](RUNTIME-MIGRATION.md) · [执行端连接](WORKBENCH-REMOTE-RUNNER.md)
- `plugins.memory` 可以选择内置、加权词项或已配置的 Octop 索引。使用哪个检索插件都从核心授权后的候选开始。详见 [模块与插件](PLUGIN-ARCHITECTURE.md)。
- 可输入提示词的位置包括部署配置中的 `agents[].skill`、工作台共享技能和专家说明。Agent 的执行路径、凭据、模型白名单、仓库和可写范围由可信部署配置和业务授权控制。

完整字段及交叉约束见 [配置校验](../src/workbench/config.ts)、[资料与仓库配置](../src/workbench/project-resources.ts) 和 [执行端能力](../src/workbench/execution-capabilities.ts)。
