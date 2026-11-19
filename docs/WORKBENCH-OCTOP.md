# Octop 后端接入

Octop Gateway 和 Memory 以固定提交的 MIT 子模块接入。Super-agent 持有工单、委托和业务阶段，AutoLoop 领取、执行、停止并回传。Contractor 保管项目成员、专家共享、技能版本、知识授权及积分账本，只读专家使用 Contractor 的 DeepSeek 模型适配器。

## 安装与配置

只读专家使用 Python 3 标准库。启用 Octop 渠道或知识索引时，从固定源码安装所需子模块。

```sh
git submodule update --init upstream/octop-gateway upstream/octop-memory
uv venv --python 3.12 /path/to/octop-venv
uv pip install --python /path/to/octop-venv/bin/python ./upstream/octop-gateway ./upstream/octop-memory
```

工作台运行目录 `workbench.json` 的 `octop` 配置如下。模型服务和成员凭据槽由部署者设置。

```json
{
  "octop": {
    "python": "/path/to/octop-venv/bin/python",
    "profiles": [{"owner": "engineering", "model": "deepseek-v4-pro", "credential": "octop"}],
    "feishuGateway": false
  }
}
```

对应凭据位于 `member-credentials/engineering/octop.json`，内容为 `{"apiKey":"…"}`，权限为 `0600`。专家通过其所有者的执行配置选定模型。没有个人执行配置时可创建或复制为待配置的 Agent。启用 `feishuGateway` 时已有飞书连接提供原事件，主题咨询复用原版 `FeishuChannel.parse_inbound` 核对原消息、作者、群聊和话题。飞书实时消费、断线补读和同话题发送沿用现有实现。

## 权限与执行

`/api/octop/<project>` 提供已登录成员可见的技能版本、专家和模板。`skill` 接收 Markdown，Contractor 解析 YAML 技能声明并固定版本。`share` 分别控制指定成员对技能或专家的授权。`mount` 由 Agent 所有者挂载一份技能版本。技能作者发布下一版后，原挂载继续引用原版。

`expert` 创建本人 Agent。`template` 发布明确填写的配置及挂载引用。`clone` 按模板版本复制为新所有者的 Agent。模板的数据范围为职责、说明、模板版本和允许继续挂载的技能引用。凭据、工作区、聊天与项目私有资料通过独立执行和知识授权获得。`subagent` 类型模板可复制为独立 Agent。

标准 `/api/ticket` 入口调用专家。工单冻结专家共享代次和技能版本，AutoLoop 分配运行时重新检查。撤权后停止或拒绝受影响的执行，原成果和装配快照停止提供正文。重新授权产生新代次。新委托可用新代次，原执行历史保留其 ID 和证据。一个成员的撤权和另一成员的独立挂载分别记录。

只读模型适配器接收该轮装配的只读输入，按部署者指定的 DeepSeek 模型运行。文件、Shell、MCP、自动转委托和外部连接器未启用。本轮临时工作区退出即清理。执行回执保存实际模型与 Token，进入现有用量及积分账本。跨引擎手动交接仍使用已验证的 Codex / Claude Code 链；Octop 共享专家需要以新的明确委托选定技能范围。

`recall?q=…` 复用 Octop Memory 的 SQLite FTS5。只将 Contractor 当前可用于项目召回的知识版本装入本次内存索引，返回时复核有效性以及来源。现有知识采用、撤权和原版本记录仍由 Contractor 负责。

## 独立运行飞书入口和知识索引

工作台、飞书入口和索引各有启动命令。三个进程在同一台主机以同一服务账号运行，使用同一个绝对路径的 `COLLAB_STATE_DIR`。在该目录下的 `workbench.json` 增加以下配置，保留已有飞书和 Octop 字段。

| 配置 | 值 |
| --- | --- |
| `feishu.separateIngress` | `true` |
| `octop.indexSocket` | 指向服务账号专有目录的 Unix socket 绝对路径，例如 `/var/run/contractor/index.sock`。父目录需由该账号拥有，权限为 `0700`，路径少于 104 字节。 |

```sh
node --import tsx src/workbench/feishu-ingress-service.ts
node --import tsx src/workbench/octop-index-service.ts
node --import tsx src/workbench/server.ts
```

用进程管理器分别运行上面三个命令。手动启动也可用 `npm run service:feishu` 和 `npm run service:knowledge`。配置两项可以分别启用。已有部署省略新字段时沿用内置模式。

- **飞书入口**复用现有 `lark-cli` 事件监听和卡片回调。将配置中绑定的群、允许绑定的群和有效私聊命令写入运行目录下的私有 SQLite 收件箱。工作台消化后清除消息正文。同一话题的待处理消息按收到顺序推进，临时错误退避再试。服务正常退出会先关闭所属订阅，异常退出后收件箱保留，接替进程在最多约 15 秒的租约到期后接管。
- **飞书补读**由工作台持有群和话题游标，入口每次重新就绪或发现丢弃事件时触发补读。定时补读仍运行。在有授权读取者的已绑定话题内，实时事件和历史补读用同一飞书消息 ID 去重。索引暂不可用时保留相应补读游标，工作台稍后重试。卡片回调在入口收到并落盘后可重放，入口停机期间未收到的点击需要重新操作。
- **Octop 索引**只经私有 Unix socket 接收本次授权的知识片段，用原版 Octop Memory 生成临时索引，返回候选 ID。每次请求结束后销毁索引。资料失效、撤权或替代时，工作台过滤原资料及失效的派生版本，返回结果前再次核对资料版本和授权。索引停机时，指定索引的查询返回可重试错误，飞书咨询暂停派工。
- **AutoLoop**保留领取、续跑、停止和回执职责。飞书收件箱负责传输，索引负责检索，工单、人员、授权和补读游标由工作台维护。

### 入口留存、全范围检索与健康检查

未确认处理的入口消息及卡片回调不按三天期限删除，长时间断线后继续处理原事件。处理完才删除正文，并保留三天的摘要去重记录。超过三天的待处理数量在独立入口的 `feishuInbox.overdue` 显示；`pending` 为当前积压数。三天清理只针对已处理摘要。这与普通群消息整理模块的原文留存策略分别管理。

索引接收本次全部授权的现行候选，以最多 96 条为一个传输批次，在同一个请求临时索引内统一排名后返回最多六条。96 不再是候选总量上限。仍由原版 Octop Memory 执行全文检索，不持久保留授权正文。断流或超出单次传输/处理保护上限会明确失败，不返回截断的部分检索结果。单帧最多 4 MiB、整次传输最多 64 MiB，输入阶段最多 10 秒；这些是运行保护边界，不能解释为无限规模索引。

`GET /health` 会实际探测 Octop FTS 能否响应，包含 `knowledge.state`、`mode`、`checkedAt`。索引故障时整体 `ready=false`、HTTP 503，`workbenchReady` 单独表示业务工作台已启动，其他仍可用的业务接口不被整体关闭。探测合并并发请求并短暂缓存三秒，不传项目正文、不调用模型。`GET /health/live` 仅表示进程存活，返回 HTTP 200。未配置 Octop 时，业务检索使用 Contractor 内置实现，健康状态显示为本地就绪。可用 `plugins.memory: "native"` 显式选择内置实现，也可以在配置 Octop 后指定 `"octop"`。

升级顺序为先更新并重启独立索引，再更新工作台。新版索引仍接收旧版单批查询；新版工作台的流式查询和健康探测需要新版索引。飞书入口的已处理摘要表自动创建，原待处理事件继续保留。

## 原话题咨询和撤权

项目主题的 `consultations` 可设 `{"topic":"reasons","feishu":true,"sharedExperts":true}`。共享专家及其挂载的技能版本必须授权给提问人。Octop Memory 只检索现行项目资料和来源仍有效的派生知识。中文问句支持关键词匹配。未找到可用资料时不派发执行。通过 AutoLoop 取得的完整正文和对应知识修订留在工作台，飞书原话题只发状态和已配置的工作台入口。共享专家撤权后旧咨询正文不可见。原资料失效后，从它派生的知识也不能参与新咨询检索。

工作台的 `POST /api/project/:project/consult` 可额外指定 `knowledge: {"id":"<条目>","revision":"<知识修订>"}`，由该受限知识的所有者选择一个已授权的主题 Octop 专家。咨询和答复只出现在发起人的主题视图，经本工单独立授权后才执行。答复必须引用该修订；撤权后正文和快照随即隐藏。受限咨询不经飞书或其他 IM 回传。

## 其他 IM

在 `octop.channels` 中单独登记每个机器人连接和项目主题。已有飞书 bot 沿用上方配置。其他连接由 Octop 原版 `ChannelManager` 和平台 SDK 处理。Contractor 子进程只传递文本咨询和绑定事件，执行仍由 AutoLoop 领取。

```json
{
  "id": "telegram-store",
  "kind": "telegram",
  "credential": "telegram-store",
  "allowAccountBinding": true,
  "routes": [{"chat": "-100123", "thread": "7", "project": "store", "topic": "reasons"}]
}
```

- 凭据文件放在运行目录 `octop-im/telegram-store.json`，权限 `0600`。该文件按原版 Telegram 配置填写 `bot_token` 等连接字段。各平台的 SDK 凭据独立于成员模型凭据。不同机器人或租户使用不同的连接 ID。
- 已登录成员调用 `POST /api/channels/proof`，传 `{"provider":"octop"}`，再在允许绑定的机器人私聊发送返回的命令。工作台核对待确认账号后绑定。项目成员资格继续生效，父项目权限不会自动延伸到子项目。
- 群里使用 `/咨询` 或 `/consult` 加问题。选指定专家时可在命令后加 `@Agent-ID`。用原生会话和话题精确定位。Telegram 论坛话题用 `thread`，Discord 话题用该话题自己的频道 ID。启用绑定后，同一成员可以依次认领多个渠道账号。
- Telegram、Discord、企业微信、QQ 和钉钉支持把状态发回原会话。钉钉私聊优先使用原生结果卡，平台明确拒绝且原回复窗口还有效时使用 Markdown。微信结果留在项目主题工作台。各平台连接的启用取决于其账号权限。群聊纯文本以外的消息、普通闲聊和代码委托继续由已有各入口处理。
- 同一连接、会话、话题和消息 ID 重放只受理一次。回传复用 Super-agent 的发件箱和回执 ID。Gateway 收到平台成功响应后，先把确认形式和时间写进同一个业务账本，再应答工作台。工作台重启时可以用这份确认补记原回执。没有平台成功证据时保留未确认状态和工作台结果；用不了平台查询接口的情况不会尝试重复发送。发起人可在工单「咨询回复」和「当前成果」看到等待、确认中、平台已确认或未确认。该状态记录渠道发送回执，接收人阅读状态由渠道管理。
- 可用本地 Octop 环境运行 `python tests/octop-im-native.py` 核对平台解析、原地址映射与回执落账。真实凭据配置后再验证远端网络和接收权限。钉钉原生卡依赖互动卡片实例写权限。 [钉钉创建并投放卡片](https://open.dingtalk.com/document/orgapp/create-and-deliver-cards)

### 企业微信机器人

在企业微信创建 API 模式的智能机器人，选择使用长连接。凭据文件填写 `bot_id` 和 `secret`，无需公网回调地址。一个测试机器人只连接一个实例，避免与正在用的机器人争用连接。工作台等待平台认证成功后接收消息，断线期间等待 SDK 恢复。 [腾讯云企业微信机器人接入说明](https://cloud.tencent.com/document/product/1759/121473)

企业微信群的 `routes[].chat` 使用平台群会话 ID，机器人单聊使用成员在企微的 `userid`。企微绑定和飞书绑定可属于同一工作台成员。群内支持 `@机器人 /咨询 …`。回传只发送处理状态和已配置的工作台入口，等企微 SDK 确认后记为已发送。
