# 资料、知识与记忆

在项目的已绑定来源上配置正文接入。飞书 Docx 使用指定用户的授权与官方 CLI，保存文档修订。GitHub Markdown 先确定配置分支的提交，再按 Git tree 找到获准路径的普通文件并核对 blob。Figma 按文件、分支及节点冻结原型版本。关联资源使用 Contractor 的稳定项目引用。

```mermaid
flowchart LR
    A[飞书 Docx、GitHub Markdown 或 Figma 节点] --> B[资料负责人导入候选]
    B --> C[核对上游修订并由负责人采用]
    C --> D[现行版本进入检索与新委托]
    C --> E[旧版本留在原工单的证据中]
    D --> F[新工单或原单下一版]
    F --> G[执行与人工验收]
    G --> H[核对来源和适用条件后采用知识]
    I[撤回工单资料授权] --> J[隐藏对应正文与派生知识]
    E --> J
    H --> J
```

## 沉淀与读取规则

| 阶段 | 规则 |
| --- | --- |
| 进入候选 | 已验收工单可生成一个与成果修订对应的候选。资料导入、人工记录、已核对的项目观察也可以形成候选。会话和执行历史仍留在各自的业务对象中。 |
| 采用 | 资料或结论负责人核对正文、适用条件、可见性和证据，确认后进入项目现行知识。原资料仍有效时才可采用。 |
| 装配 | 先限定项目、账号、工单、用途和资料授权，再按当前知识版本检索。主题内批准的规则、人工锁定的依据和本次选中的资料都有明确出处。每个执行尝试记录实际装配的修订。 |
| 更新 | 新版可替代同一范围的旧版。新任务找到新版，历史工单保留当时依据。废止且未替代的版本退出新任务检索。 |
| 撤权 | 依赖被撤权资料的历史正文、派生知识和图谱节点一起收回。已有验收及权限变更仍留下元数据。重新授权只对获准的新范围生效。 |

知识同时保存非结构化正文和结构化的类型、条件、版本、负责人、来源、适用范围和关系。图谱从业务账本生成来源、使用、替代、项目和负责人关系，展示时按查看者的资料权限裁剪。 [授权规则](../src/workbench/knowledge-authority.ts) · [知识图谱](../src/workbench/knowledge-graph.ts)

同一来源的版本有独立的知识条目和修订。导入同一快照返回同一条目。采用时再读一次真实来源，如果所审阅的候选已经落后，返回 409。通过后，在同一个账本事务内将指针从旧版指向新版。对于人工记录，可以新建一个带 `replaces` 的候选。对于验收形成的结论，在采用新候选时指定它替代的已采用版本。新版必须与原版本同项目、同所有者、同类型、同可见性，并且有有效来源。

知识所有者可以标记失效。失效没有替代项时，旧引用无法开新工单或进入下一版。新版被采用后，选中旧引用的新委托会解析到当前版本，多个指向同一版本的引用只装配一次。使用已替换或失效资料的派生结论也会退出当前检索，直到从有效来源重新确认。

工单每个业务版本在立项或开启下一版时锁定资料。已经派出的版本依约继续，已完成的运行快照保存原版本。原工单下一版会重查当前条目，受限资料需要新的版本授权。不再装配仅在旧资料版本下有效的成果或确认记录；涉及旧权限范围的修改理由只留在有权查看的历史中。

撤回工单授权会影响原始快照、历史成果正文和引用该授权代次的多级派生知识。后续批准产生新授权，不会恢复旧快照。专为历史成果补发的查阅许可仅用于该成果的人审。Figma 连接的有效读取权限也参与这条判断。可在可信本地项目配置中取消资料的正文接入，重载后该接入范围的快照停止供协作台读取。

## 后端入口

| 操作 | 入参和结果 |
| --- | --- |
| `POST /api/project/:project/knowledge-import` | `resource` 为项目内绑定的资料引用，GitHub 加传配置中的 `path`。资料负责人调用，返回 `id`、工作台 `revision`、状态和 `sourceRevision` |
| `POST /api/knowledge/:entry/publish` | 提交候选的 `revision`。验收生成的结论可附 `replaces: {id, revision}`，由两个版本的共同所有者确认 |
| `POST /api/knowledge/:entry/invalidate` | 所有者提供现行 `revision` 和 `reason`，旧版本退出现行检索 |
| `GET /api/knowledge/:project` | `q` 只检索仍可采用和有权读取的内容。没有 `q` 时可以用 `history=1` 核对有权限的历史条目 |
| `GET /api/knowledge/:entry/preview?revision=…` | 使用工作台修订号读取该次 Figma 原型的 PNG。服务端按原始 Figma 版本获取图片，调用前后都核对工作台权限 |
| `GET /api/project/:project/figma-sources` | 资料负责人查看自己的来源状态、最近核对时间、来源版本和候选编号。可用已有的 `knowledge-import` 入口立即核对 |
| `POST /api/channels/:event/resolve` | 负责人确认 `action=create` 时可附 `material` 选择已采用资料，渠道身份、项目归属和受限授权仍分别校验 |
| `POST /api/ticket/:ticket/revise` | 默认根据原单引用找到当前可用版本，可显式传入本版选用的 `material` |
| `GET /api/ticket/:ticket/runs/:run` | 正文可读时在 `materials` 中记录工作台知识版本及真实资料版本，`contents` 保留实际输入 |

在本机 `workbench.json` 的 `projects[].resources[]` 为已绑定资源加 `knowledge`。每种类型都需要 `owner` 和 `conditions`，`visibility` 默认 `restricted`。飞书用 `format=feishu-docx`，配置 `profile`、`appId`、`userOpenId` 和原本已登记的 Docx 链接。GitHub 用 `format=github-markdown`，配置 `branch` 和具体 `files`。既有普通链接仍可用。导入支持最多 12,000 字符的文本。

Figma 使用 `format=figma-node`。例如下列配置将项目内已登记的原型节点交给 `design` 管理。已有动态登记的同一节点由本机有正文授权的配置接管。

```json
{
  "source": "figma",
  "externalId": "FileKey/1:2",
  "label": "门店推荐理由原型",
  "url": "https://www.figma.com/design/FileKey/prototype?node-id=1-2",
  "state": "bound",
  "knowledge": {
    "format": "figma-node",
    "credential": "STORE",
    "owner": "design",
    "conditions": "仅用于门店推荐理由的试点验收",
    "visibility": "restricted",
    "preview": false
  }
}
```

凭据由部署方通过 `CONTRACTOR_FIGMA_STORE` 提供，使用已有节点访问权限且包含 `file_metadata:read` 和 `file_content:read` 的个人访问令牌。分支链接的 `externalId` 使用分支 key。链接带 `version-id` 会固定到该历史版本，省略时同步服务端最新版本。

服务启动时和每两分钟轮询文件元数据。相同文件和凭据在一轮内共用一次元数据请求。版本变化时读取指定节点，产生待审核候选。采用前仍重新核对真实版本，由资料负责人确认切换。

Figma 明确返回 401、403、404，或不再返回指定节点时，工作台使当前来源授权代次失效。同时隐藏依赖它的资料、派生知识、成果正文、运行快照及图谱节点。已有工单的版本、授权和验收账本保留。连接恢复后重新生成候选，旧代次的访问记录不会恢复。服务重启先核对来源再开放正文。限流或网络故障期间沿用最近一次核对，最多五分钟，超时暂停读取。这个机制核对的是工作台所用 Figma 账号的读取许可，成员授权继续由工作台管理。

`preview` 默认关闭。启用后才向 Figma 请求 PNG 渲染。图片只从限定的 Figma 图像地址读取，接口返回同源 PNG，临时外链和令牌留在服务端请求中。当前采用轮询，同步延迟取决于轮询间隔及 Figma 的接口限额。

## 门店推荐理由示例

验收负责人将小屏版的可读性和长词换行结论保存为候选，注明适用的推荐卡片、工单版次、提交和 CI。采用后，其他有权的工单可以调取当前版本并打开验收出处。下一版增加更小的视口时，旧版依据留在对应工单，新知识待负责人确认后进入现行检索。撤掉原资料权限时，与该授权有关的正文与派生条目随之收回。 [版本与撤权回归](../tests/workbench-knowledge-versions.test.ts) · [Figma 接入回归](../tests/workbench-figma-source.test.ts)
