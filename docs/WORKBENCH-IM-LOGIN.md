# 企业主 IM 登录

每套 Contractor选定一个主登录渠道。登录页优先显示该渠道，消息接入仍可配置多个渠道。平台所有者在「平台管理 → 登录渠道」切换已配置的应用。

## 登录与开通

- 已绑定的成员使用主渠道授权，成功后回到原工作台链接。执行端确认页使用同一个入口。
- 首次授权提交开通申请。平台管理员核对身份、设定平台账号和角色。成员获批后再次授权即可登录。项目维护人另行分配项目的协作或只读权限。
- 已有账号在迁移期间用原口令登录，进入「个人设置 → 登录安全」绑定主渠道。工作台保留原账号、项目关系、工单和历史。先确认成员已完成绑定，再由平台所有者关闭旧口令入口。工作台要求至少有一位在岗所有者绑定目标渠道，才能从页面关闭迁移入口。
- 更换企业主渠道时，成员可在原渠道仍可用期间，从「迁移到其他登录渠道」提前绑定新身份。平台切换后，原渠道会话失效，成员使用新渠道进入同一账号。
- 飞书登录应用与现有飞书消息应用一致时，可用同一个已验证的 Open ID 关联飞书协作身份。独立应用或不同渠道的消息身份按已有绑定流程核对。
- 个人微信通过微信网站应用证明微信身份，管理员仍须单独批准。企业微信要求返回当前企业的成员 ID。

## 服务端接入

在当前实例受信任的 `workbench.json` 增加 `imLogin`，只填写要提供的应用。示例中所有标识均为占位符。

```json
{
  "workbenchPublicUrl": "https://workbench.example.com",
  "imLogin": {
    "primary": "feishu",
    "legacyPassword": true,
    "providers": {
      "feishu": { "appId": "cli_example", "tenantKey": "tenant_example", "secretEnv": "CONTRACTOR_FEISHU_LOGIN_SECRET" },
      "dingtalk": { "appId": "ding_example", "secretEnv": "CONTRACTOR_DINGTALK_LOGIN_SECRET" },
      "wecom": { "corpId": "ww_example", "agentId": "1000001", "secretEnv": "CONTRACTOR_WECOM_LOGIN_SECRET" },
      "wechat": { "appId": "wx_example", "secretEnv": "CONTRACTOR_WECHAT_LOGIN_SECRET" }
    }
  }
}
```

应用密钥由服务进程的环境注入，管理页只显示配置状态。将「登录渠道」页显示的 `/api/auth/im/callback` 完整 HTTPS 地址或域名登记到相应应用的回调白名单。反向代理保留工作台 Host，并放行 `GET /api/auth/im/start` 和 `GET /api/auth/im/callback`。企微按自建应用要求配置可信域名及可信出口。

| 渠道 | 开放平台需要的应用与校验 |
| --- | --- |
| 飞书 | 自建应用网页授权，回调核对企业 `tenant_key`，支持 PKCE。 [飞书网页授权说明](https://open.feishu.cn/document/home/qr-code-scanning-login-for-web-app/introduction) |
| 钉钉 | 企业内部应用，授权获取个人身份，再通过本企业通讯录验证内部成员。需配置用户身份与通讯录查询权限。 [钉钉网页登录](https://open.dingtalk.com/document/orgapp/tutorial-obtaining-user-personal-information) |
| 企业微信 | 企业自建应用的网页扫码登录，在企微客户端内使用网页授权。服务端核对自建应用签发的企业成员 ID。 [企微网页登录](https://developer.work.weixin.qq.com/document/path/98152) |
| 微信 | 微信开放平台已审核的网站应用与微信扫码登录。使用应用内 OpenID。 [微信网站应用登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html) |

授权回调以短期浏览器凭证和一次性 state 关联。平台不持久化用于完成登录的第三方访问令牌。工作台角色、项目访问和资料授权继续由 Contractor 管理；飞书、钉钉、企微、GitHub、Figma 的应用和用户权限由各自源站管理。跳转到源站时，浏览器使用访问者自己的源站权限。

前后端联合验证可用 `npm run build:ui -- --outDir /absolute/preview` 生成独立制品，测试后端以 `CONTRACTOR_UI_DIR=/absolute/preview` 加载，避免同机测试覆盖运行中的前端。
