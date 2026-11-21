import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { z } from 'zod';
import { configuredEnv, isConfigSecretName } from './compatibility.ts';
import type { PlatformActor } from './channel-links.ts';
import { WorkbenchError } from './errors.ts';
import { octopIMNativeId } from './octop-im-contract.ts';
import { feishuScanAuthorizePath, imProviderNames, imQrOrigins, type IMProvider, type IMQrProvider } from './im-login-channels.ts';

export { imProviderNames, type IMProvider } from './im-login-channels.ts';
export const imProvider = z.enum(Object.keys(imProviderNames) as IMProvider[]);
const appId = z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/);
const secret = { secretEnv: z.string().refine(isConfigSecretName) };
const numericId = z.string().regex(/^\d{1,32}$/);
const numericApp = z.object({ appId: numericId, ...secret }).strict().optional();
export const imLoginSettings = z.object({
  primary: imProvider,
  legacyPassword: z.boolean().default(true),
  providers: z.object({
    feishu: z.object({ appId, tenantKey: appId, ...secret }).strict().optional(),
    dingtalk: z.object({ appId, ...secret }).strict().optional(),
    wecom: z.object({ corpId: appId, agentId: z.string().regex(/^\d{1,16}$/), ...secret }).strict().optional(),
    wechat: z.object({ appId, ...secret }).strict().optional(),
    telegram: numericApp,
    discord: numericApp,
    qq: numericApp,
  }).strict(),
}).strict().refine(value => !!value.providers[value.primary], '主登录渠道须有对应的企业应用配置');
export type IMLoginSettings = z.infer<typeof imLoginSettings>;

export type ExternalIdentity = { authority: string; subject: string };
export type VerifiedIdentity = ExternalIdentity & { label: string; channel?: PlatformActor;
  profile?: { provider: IMProvider; name?: string; avatar?: string } };
type OAuthRequest = { redirect: string; state: string; verifier: string; inWeCom?: boolean; embeddedQr?: true };
type ProviderConnection = {
  provider: IMProvider;
  authority: string;
  authorize(request: OAuthRequest): URL;
  verify(code: string, request: OAuthRequest): Promise<VerifiedIdentity>;
};
export const identityHash = (value: string) => createHash('sha256').update(value).digest('hex');
const hashParts = (...parts: string[]) => identityHash(JSON.stringify(parts));
const token = z.string().regex(/^[^\s\x00-\x1f\x7f]{1,8192}$/);
const label = z.string().max(300).optional();
const avatarHosts: Record<IMProvider, readonly string[]> = {
  feishu: ['*.feishucdn.com', '*.larksuitecdn.com'],
  dingtalk: ['static-legacy.dingtalk.com', 'static.dingtalk.com'],
  wecom: [],
  wechat: ['thirdwx.qlogo.cn', 'wx.qlogo.cn'],
  telegram: ['*.telesco.pe'],
  discord: ['cdn.discordapp.com'],
  qq: ['q.qlogo.cn', 'qzapp.qlogo.cn'],
};
export const imAvatarOrigins = Object.values(avatarHosts).flat().map(host => 'https://' + host);

function verifiedAvatar(provider: IMProvider, value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return;
  const address = URL.parse(value);
  if (!address || address.username || address.password || address.port || address.protocol !== 'https:') return;
  if (!avatarHosts[provider].some(host => host.startsWith('*.') ? address.hostname.endsWith(host.slice(1)) : address.hostname === host)) return;
  return address.href;
}

const tokenResponse = z.object({ access_token: token });
const feishuMember = z.object({ tenant_key: appId, open_id: octopIMNativeId, name: label,
  avatar_thumb: z.unknown().optional(), avatar_url: z.unknown().optional(), picture: z.unknown().optional() });
const feishuProfile = z.object({ code: z.literal(0), data: feishuMember });
const dingProfile = z.object({ unionId: octopIMNativeId, nick: label, avatarUrl: z.unknown().optional() });
const dingMember = z.object({ errcode: z.literal(0),
  result: z.object({ contact_type: z.literal(0), userid: octopIMNativeId }) });
const wecomToken = z.object({ errcode: z.literal(0), access_token: token });
const wecomMember = z.object({ errcode: z.literal(0), userid: octopIMNativeId.optional(), UserId: octopIMNativeId.optional() });
const wechatToken = tokenResponse.extend({ openid: octopIMNativeId });
const wechatProfile = z.object({ openid: octopIMNativeId, nickname: label, headimgurl: z.unknown().optional() });
const discordProfile = z.object({ id: numericId, global_name: label.nullable(), username: label,
  avatar: z.string().regex(/^(a_)?[a-f0-9]{32}$/).nullish() });
const qqIdentity = z.object({ client_id: z.union([numericId, z.number().int().positive().transform(String)]), openid: octopIMNativeId });
const qqProfile = z.object({ ret: z.literal(0), nickname: label, figureurl_qq_1: z.unknown().optional(), figureurl_qq_2: z.unknown().optional() });
const telegramIssuer = 'https://oauth.telegram.org';
const telegramHeader = z.object({ alg: z.literal('RS256'), kid: z.string().min(1).max(180) });
const telegramKeys = z.object({ keys: z.array(z.object({ kid: z.string(), kty: z.string(),
  alg: z.string().optional(), use: z.string().optional(), n: z.string().optional(), e: z.string().optional() })).max(50) });
const telegramClaims = z.object({ iss: z.literal(telegramIssuer), aud: numericId, sub: octopIMNativeId,
  iat: z.number().int(), exp: z.number().int(), name: label, picture: z.unknown().optional() });

function url(base: string, fields: Record<string, string>, fragment?: string) {
  const result = new URL(base);
  result.search = new URLSearchParams(fields).toString();
  if (fragment) result.hash = fragment;
  return result;
}
const json = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const bearer = (accessToken: string): RequestInit => ({ headers: { authorization: 'Bearer ' + accessToken } });
const tokenForm = (fields: Record<string, string>, authorization?: string): RequestInit => ({
  method: 'POST', body: new URLSearchParams(fields), headers: {
    'content-type': 'application/x-www-form-urlencoded', ...(authorization && { authorization }),
  },
});
const pkce = (verifier: string) => ({ code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
const invalidMember = () => new WorkbenchError('未能验证该渠道身份或企业成员资格。', 403);

export const qrFrames: Record<IMQrProvider, (authorize: URL, callback: URL) => { frame: string; location: string }> = {
  feishu: authorize => ({
    frame: url(imQrOrigins.feishu + '/suite/passport/sso/qr', { goto: authorize.href, sdk_version: '1.0.3' }).href,
    location: authorize.href,
  }),
  dingtalk: (authorize, callback) => {
    authorize.searchParams.set('iframe', 'true');
    return { frame: authorize.href, location: callback.href };
  },
  wecom: (authorize, callback) => ({
    frame: url(imQrOrigins.wecom + '/wwopen/sso/qrConnect', {
      ...Object.fromEntries(authorize.searchParams), login_type: 'jssdk', lang: 'zh', version: '1.2.4',
    }).href,
    location: callback.href,
  }),
};

async function verifyTelegram(jwt: string, client: string, keys: () => Promise<z.infer<typeof telegramKeys>>) {
  const parts = jwt.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw invalidMember();
  const [header, payload, signature] = parts as [string, string, string];
  const { kid } = telegramHeader.parse(JSON.parse(Buffer.from(header, 'base64url').toString('utf8')));
  const key = (await keys()).keys.find(row => row.kid === kid && row.kty === 'RSA'
    && (!row.alg || row.alg === 'RS256') && (!row.use || row.use === 'sig'));
  if (!key?.n || !key.e) throw invalidMember();
  const publicKey = createPublicKey({ format: 'jwk', key: { kty: 'RSA', n: key.n, e: key.e } });
  if (!verifySignature('RSA-SHA256', Buffer.from(header + '.' + payload), publicKey, Buffer.from(signature, 'base64url')))
    throw invalidMember();
  const claims = telegramClaims.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== client || claims.exp <= now || claims.iat > now + 60 || claims.exp <= claims.iat) throw invalidMember();
  return { id: claims.sub, name: claims.name, avatars: [claims.picture] };
}

export function imConnections(settings: IMLoginSettings | undefined, feishuBotApp?: string,
  fetcher = fetch, env: NodeJS.ProcessEnv = process.env) {
  const connections = new Map<IMProvider, ProviderConnection>();
  const configs = settings?.providers;
  if (!configs) return connections;
  async function api<T>(schema: z.ZodType<T>, address: string | URL, options?: RequestInit) {
    try {
      const response = await fetcher(address, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (response.ok) return schema.parse(await response.json());
    } catch { /* Authorization codes, tokens and remote error details stay on the server. */ }
    throw invalidMember();
  }
  function add(provider: IMProvider, scope: string[], secretEnv: string,
    authorize: ProviderConnection['authorize'],
    verify: (code: string, request: OAuthRequest, secret: string) =>
      Promise<{ id: string; name?: string; avatars?: unknown[]; channel?: PlatformActor }>) {
    const appSecret = configuredEnv(secretEnv, env)?.trim();
    if (!appSecret) return;
    const authority = hashParts(provider, ...scope);
    connections.set(provider, { provider, authority, authorize, async verify(code, request) {
      const { id, name, avatars, channel } = await verify(code, request, appSecret);
      const displayName = name?.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 120);
      const label = displayName || imProviderNames[provider] + '成员';
      const avatar = avatars?.map(value => verifiedAvatar(provider, value)).find(Boolean);
      return { authority, subject: hashParts(authority, id), label, ...(channel && { channel: { ...channel, label } }),
        profile: { provider, name: displayName || undefined, avatar } };
    } });
  }
  if (configs.feishu) {
    const { appId: client, tenantKey, secretEnv } = configs.feishu;
    add('feishu', [tenantKey, client], secretEnv, ({ redirect, state, verifier, embeddedQr }) =>
      url(embeddedQr ? imQrOrigins.feishu + feishuScanAuthorizePath : 'https://accounts.feishu.cn/open-apis/authen/v1/authorize', {
        client_id: client, redirect_uri: redirect, response_type: 'code', state, target_tenant: tenantKey,
        ...pkce(verifier),
      }), async (code, { redirect, verifier, embeddedQr }, appSecret) => {
      const fields = {
        grant_type: 'authorization_code', client_id: client, client_secret: appSecret,
        code, redirect_uri: redirect, code_verifier: verifier,
      };
      const { access_token: access } = embeddedQr
        ? await api(tokenResponse, imQrOrigins.feishu + '/suite/passport/oauth/token', tokenForm(fields))
        : await api(tokenResponse, 'https://open.feishu.cn/open-apis/authen/v2/oauth/token', json(fields));
      const profile = embeddedQr
        ? await api(feishuMember, imQrOrigins.feishu + '/suite/passport/oauth/userinfo', bearer(access))
        : (await api(feishuProfile, 'https://open.feishu.cn/open-apis/authen/v1/user_info', bearer(access))).data;
      if (profile.tenant_key !== tenantKey) throw invalidMember();
      return { id: profile.open_id, name: profile.name, avatars: [profile.avatar_thumb, profile.avatar_url, profile.picture], ...(client === feishuBotApp && {
        channel: { provider: 'feishu', namespace: client, id: profile.open_id, label: '' },
      }) };
    });
  }
  if (configs.dingtalk) {
    const { appId: client, secretEnv } = configs.dingtalk;
    add('dingtalk', [client], secretEnv, ({ redirect, state }) => url('https://login.dingtalk.com/oauth2/auth', {
      client_id: client, redirect_uri: redirect, response_type: 'code', scope: 'openid', state, prompt: 'consent',
    }), async (code, _request, appSecret) => {
      const user = await api(z.object({ accessToken: token }), 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken', json({
        clientId: client, clientSecret: appSecret, code, grantType: 'authorization_code',
      }));
      const profile = await api(dingProfile, 'https://api.dingtalk.com/v1.0/contact/users/me', {
        headers: { 'x-acs-dingtalk-access-token': user.accessToken },
      });
      const app = await api(z.object({ accessToken: token }), 'https://api.dingtalk.com/v1.0/oauth2/accessToken', json({
        appKey: client, appSecret,
      }));
      // Use the internal app's directory to verify this person belongs to its enterprise.
      const { result } = await api(dingMember, url('https://oapi.dingtalk.com/topapi/user/getbyunionid', {
        access_token: app.accessToken,
      }), json({ unionid: profile.unionId }));
      return { id: profile.unionId, name: profile.nick ?? result.userid, avatars: [profile.avatarUrl] };
    });
  }
  if (configs.wecom) {
    const { corpId, agentId, secretEnv } = configs.wecom;
    add('wecom', [corpId, agentId], secretEnv, ({ redirect, state, inWeCom }) => inWeCom
      ? url('https://open.weixin.qq.com/connect/oauth2/authorize', {
        appid: corpId, agentid: agentId, redirect_uri: redirect, response_type: 'code', scope: 'snsapi_base', state,
      }, 'wechat_redirect')
      : url('https://login.work.weixin.qq.com/wwlogin/sso/login/', {
        login_type: 'CorpApp', appid: corpId, agentid: agentId, redirect_uri: redirect, state,
      }), async (code, _request, appSecret) => {
      const access = await api(wecomToken, url('https://qyapi.weixin.qq.com/cgi-bin/gettoken', {
        corpid: corpId, corpsecret: appSecret,
      }));
      const member = await api(wecomMember, url('https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo', {
        access_token: access.access_token, code,
      }));
      const id = member.userid ?? member.UserId;
      if (!id) throw invalidMember();
      return { id, name: id };
    });
  }
  if (configs.wechat) {
    const { appId: client, secretEnv } = configs.wechat;
    add('wechat', [client], secretEnv, ({ redirect, state }) => url('https://open.weixin.qq.com/connect/qrconnect', {
      appid: client, redirect_uri: redirect, response_type: 'code', scope: 'snsapi_login', state,
    }, 'wechat_redirect'), async (code, _request, appSecret) => {
      const data = await api(wechatToken, url('https://api.weixin.qq.com/sns/oauth2/access_token', {
        appid: client, secret: appSecret, code, grant_type: 'authorization_code',
      }));
      const profile = await api(wechatProfile, url('https://api.weixin.qq.com/sns/userinfo', {
        access_token: data.access_token, openid: data.openid, lang: 'zh_CN',
      }));
      if (profile.openid !== data.openid) throw invalidMember();
      return { id: data.openid, name: profile.nickname, avatars: [profile.headimgurl] };
    });
  }
  if (configs.telegram) {
    const { appId: client, secretEnv } = configs.telegram;
    add('telegram', [client], secretEnv, ({ redirect, state, verifier }) => url(telegramIssuer + '/auth', {
      client_id: client, redirect_uri: redirect, response_type: 'code', scope: 'openid profile', state, ...pkce(verifier),
    }), async (code, { redirect, verifier }, appSecret) => {
      const credentials = 'Basic ' + Buffer.from(client + ':' + appSecret).toString('base64');
      const { id_token } = await api(z.object({ id_token: token }), telegramIssuer + '/token', tokenForm({
        grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client, code_verifier: verifier,
      }, credentials));
      return verifyTelegram(id_token, client, () => api(telegramKeys, telegramIssuer + '/.well-known/jwks.json'));
    });
  }
  if (configs.discord) {
    const { appId: client, secretEnv } = configs.discord;
    add('discord', [client], secretEnv, ({ redirect, state, verifier }) => url('https://discord.com/oauth2/authorize', {
      client_id: client, redirect_uri: redirect, response_type: 'code', scope: 'identify', state, ...pkce(verifier),
    }), async (code, { redirect, verifier }, appSecret) => {
      const data = await api(tokenResponse, 'https://discord.com/api/oauth2/token', tokenForm({
        grant_type: 'authorization_code', client_id: client, client_secret: appSecret, code, redirect_uri: redirect, code_verifier: verifier,
      }));
      const profile = await api(discordProfile, 'https://discord.com/api/v10/users/@me', bearer(data.access_token));
      const avatar = profile.avatar && `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`;
      return { id: profile.id, name: profile.global_name || profile.username, avatars: [avatar] };
    });
  }
  if (configs.qq) {
    const { appId: client, secretEnv } = configs.qq;
    add('qq', [client], secretEnv, ({ redirect, state }) => url('https://graph.qq.com/oauth2.0/authorize', {
      client_id: client, redirect_uri: redirect, response_type: 'code', scope: 'get_user_info', state,
    }), async (code, { redirect }, appSecret) => {
      const data = await api(tokenResponse, url('https://graph.qq.com/oauth2.0/token', {
        client_id: client, client_secret: appSecret, code, grant_type: 'authorization_code', redirect_uri: redirect, fmt: 'json',
      }));
      const identity = await api(qqIdentity, url('https://graph.qq.com/oauth2.0/me', { access_token: data.access_token, fmt: 'json' }));
      if (identity.client_id !== client) throw invalidMember();
      const profile = await api(qqProfile, url('https://graph.qq.com/user/get_user_info', {
        access_token: data.access_token, oauth_consumer_key: client, openid: identity.openid, format: 'json',
      }));
      return { id: identity.openid, name: profile.nickname, avatars: [profile.figureurl_qq_2, profile.figureurl_qq_1] };
    });
  }
  return connections;
}
