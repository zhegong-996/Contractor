export const imProviderNames = {
  feishu: '飞书', dingtalk: '钉钉', wecom: '企业微信', wechat: '微信',
  telegram: 'Telegram', discord: 'Discord', qq: 'QQ',
} as const;

export type IMProvider = keyof typeof imProviderNames;

export const imQrOrigins = {
  feishu: 'https://passport.feishu.cn',
  dingtalk: 'https://login.dingtalk.com',
  wecom: 'https://open.work.weixin.qq.com',
} as const;
export type IMQrProvider = keyof typeof imQrOrigins;
export const isIMQrProvider = (provider: IMProvider | undefined): provider is IMQrProvider =>
  provider !== undefined && Object.hasOwn(imQrOrigins, provider);

export const imCallbackPath = '/api/auth/im/callback';
export const feishuScanAuthorizePath = '/suite/passport/oauth/authorize';

export const isIMAuthorizationCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[^\x00-\x20\x7f]{1,512}$/.test(value);

export function imQrContinuation(provider: IMQrProvider, location: string, payload: unknown, teamOrigin: string) {
  const target = URL.parse(location);
  if (!target) return;
  const event = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
  if (provider === 'feishu') {
    if (target.origin !== imQrOrigins.feishu || target.pathname !== feishuScanAuthorizePath
      || event?.source !== 'qrcode' || !isIMAuthorizationCode(event.tmp_code)) return;
    target.searchParams.set('tmp_code', event.tmp_code);
    return target.href;
  }
  if (target.origin !== teamOrigin || target.pathname !== imCallbackPath) return;
  const returned = provider === 'wecom' ? payload : event?.success === true ? event.redirectUrl : undefined;
  const callback = typeof returned === 'string' ? URL.parse(returned) : null;
  const state = target.searchParams.get('state');
  if (!state || !callback || callback.origin !== teamOrigin || callback.pathname !== imCallbackPath
    || callback.username || callback.password || callback.searchParams.getAll('state').length !== 1
    || callback.searchParams.get('state') !== state) return;
  const codes = [...callback.searchParams.getAll('code'), ...(provider === 'dingtalk' ? callback.searchParams.getAll('authCode') : [])];
  if (codes.length === 0 && provider === 'wecom') return target.href;
  if (codes.length !== 1 || !isIMAuthorizationCode(codes[0])) return;
  target.searchParams.set('code', codes[0]);
  return target.href;
}

export const imAuthorizationHints: Record<IMProvider, string> = {
  feishu: '打开飞书授权页，用所在组织的账号继续。',
  dingtalk: '打开钉钉授权页，用所在组织的账号继续。',
  wecom: '在电脑上用企业微信扫码。在企业微信内打开时，可直接授权。',
  wechat: '使用手机微信扫码继续。',
  telegram: '在 Telegram 授权页确认账号。',
  discord: '在 Discord 授权页扫码或登录后继续。',
  qq: '在 QQ 授权页扫码或登录后继续。',
};
