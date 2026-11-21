# 企业主 IM 登录

每个团队为 Contractor 选定一个主登录渠道。成员打开团队工作台，使用页面上的渠道授权入口。平台所有者在「平台管理 → 登录渠道」切换已配置的应用。登录验证成员身份，Gateway 处理多渠道消息与原会话回传，两者分别配置。

## 登录与开通

- 已绑定登录身份的成员使用主渠道授权，成功后回到原工作台链接。飞书登录应用和消息应用相同时，经过同一租户及应用核验的 Open ID 可以直接接续原成员。系统沿用该成员的角色和项目权限。执行端确认页使用同一个入口。
- 团队选用飞书时，工作台登录页直接显示飞书二维码。成员在手机上确认后，电脑自动继续。其他主渠道使用各自的授权入口。新成员验证身份后，页面显示「等待开通」。姓名和头像从渠道同步，系统在审批通过后生成内部成员编号。平台管理员在「平台管理 → 成员 → 开通申请」按已验证的身份分配角色。获批后，新成员用同一 IM 账号再次授权，回到最初打开的链接。项目维护人另行分配项目的协作或只读权限。
- 旧账号还没有经过验证的主渠道身份时，可在迁移期间进入「个人设置 → 登录安全」完成绑定。完成后只需主渠道授权。先确认成员已完成绑定，再由平台所有者关闭旧口令入口。工作台要求至少有一位在岗所有者绑定目标渠道，才能从页面关闭迁移入口。
- 更换企业主渠道时，成员可在原渠道仍可用期间，从「迁移到其他登录渠道」提前绑定新身份。平台切换后，原渠道会话失效，成员使用新渠道进入同一账号。
- 同一渠道身份的两份记录指向不同成员时，登录会暂停，原账号保持各自的权限。独立应用或不同渠道的身份需要分别经过验证。显示名仅用于展示。
- 企业微信自建应用使用企业成员身份。电脑浏览器打开企业微信扫码页面，在企业微信内可经网页授权。个人微信使用已审核的微信网站应用，需要平台管理员单独批准。 [腾讯云企业微信扫码登录](https://cloud.tencent.com/document/product/1441/107281)

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
      "wechat": { "appId": "wx_example", "secretEnv": "CONTRACTOR_WECHAT_LOGIN_SECRET" },
      "telegram": { "appId": "12345601", "secretEnv": "CONTRACTOR_TELEGRAM_LOGIN_SECRET" },
      "discord": { "appId": "12345602", "secretEnv": "CONTRACTOR_DISCORD_LOGIN_SECRET" },
      "qq": { "appId": "12345603", "secretEnv": "CONTRACTOR_QQ_LOGIN_SECRET" }
    }
  }
}
```

应用密钥由服务进程的环境注入，管理页显示是否可以发起授权，以及缺少的凭据或团队地址。消息机器人连通后，登录应用仍需配置网页授权。将「登录渠道」页显示的 `/api/auth/im/callback` 完整 HTTPS 地址或域名登记到相应应用的回调白名单。反向代理保留工作台 Host，并放行 `GET /api/auth/im/start`、`GET /api/auth/im/callback` 和 `POST /api/auth/im/qr`。企微按自建应用要求配置可信域名及可信出口。配置后用企业成员在浏览器完成一次授权，并检查回到原工单或设备确认页，再考虑关闭原账号口令入口。

| 渠道 | 开放平台需要的应用与校验 |
| --- | --- |
| 飞书 | 自建应用网页登录，工作台嵌入飞书二维码，回调核对企业 `tenant_key`。 [飞书扫码登录集成](https://open.feishu.cn/solutions/detail/qrcode) |
| 钉钉 | 企业内部应用，授权获取个人身份，再通过本企业通讯录验证内部成员。需配置用户身份与通讯录查询权限。 [钉钉网页登录](https://open.dingtalk.com/document/orgapp/tutorial-obtaining-user-personal-information) |
| 企业微信 | 企业自建应用的网页扫码登录，在企微客户端内使用网页授权。服务端核对自建应用签发的企业成员 ID。 [企微网页登录](https://developer.work.weixin.qq.com/document/path/98152) |
| 微信 | 微信开放平台已审核的网站应用与微信扫码登录。使用应用内 OpenID。 [微信网站应用登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html) |
| Telegram | 在 BotFather 的 Login Widget 设置允许回调并取得 Client ID 和 Client Secret。使用 `openid profile` 和默认 RS256 签名。 [Telegram Login](https://core.telegram.org/bots/telegram-login) |
| Discord | 创建 OAuth2 应用并登记回调。用 `identify` 获取账号。 [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2) |
| QQ | 在 QQ 互联审核网站应用并配置回调。通过应用内 OpenID 识别成员。 [QQ 互联](https://wiki.connect.qq.com/使用authorization_code获取access_token) |

授权回调以短期浏览器凭证和一次性 state 关联。平台不持久化用于完成登录的第三方访问令牌。工作台角色、项目访问和资料授权继续由 Contractor 管理；飞书、钉钉、企微、GitHub、Figma 的应用和用户权限由各自源站管理。跳转到源站时，浏览器使用访问者自己的源站权限。

前后端联合验证可用 `npm run build:ui -- --outDir /absolute/preview` 生成独立制品，测试后端以 `CONTRACTOR_UI_DIR=/absolute/preview` 加载，避免同机测试覆盖运行中的前端。
