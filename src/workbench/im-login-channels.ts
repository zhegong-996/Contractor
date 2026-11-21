export const imProviderNames = {
  feishu: '飞书', dingtalk: '钉钉', wecom: '企业微信', wechat: '微信',
  telegram: 'Telegram', discord: 'Discord', qq: 'QQ',
} as const;

export type IMProvider = keyof typeof imProviderNames;

export const imAuthorizationHints: Record<IMProvider, string> = {
  feishu: '打开飞书授权页，用所在组织的账号继续。',
  dingtalk: '打开钉钉授权页，用所在组织的账号继续。',
  wecom: '在电脑上用企业微信扫码。在企业微信内打开时，可直接授权。',
  wechat: '使用手机微信扫码继续。',
  telegram: '在 Telegram 授权页确认账号。',
  discord: '在 Discord 授权页扫码或登录后继续。',
  qq: '在 QQ 授权页扫码或登录后继续。',
};
