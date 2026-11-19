import { createHash } from 'node:crypto';
import { z } from 'zod';
import { configuredEnv, isConfigSecretName } from './compatibility.ts';
import type { PlatformActor } from './channel-links.ts';
import { WorkbenchError } from './errors.ts';
import { octopIMNativeId } from './octop-im-contract.ts';

export const imProvider = z.enum(['feishu', 'dingtalk', 'wecom', 'wechat']);
export type IMProvider = z.infer<typeof imProvider>;
export const imProviderNames: Record<IMProvider, string> = {
  feishu: '飞书', dingtalk: '钉钉', wecom: '企业微信', wechat: '微信',
};
const appId = z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/);
const secret = { secretEnv: z.string().refine(isConfigSecretName) };
export const imLoginSettings = z.object({
  primary: imProvider,
  legacyPassword: z.boolean().default(true),
  providers: z.object({
    feishu: z.object({ appId, tenantKey: appId, ...secret }).strict().optional(),
    dingtalk: z.object({ appId, ...secret }).strict().optional(),
    wecom: z.object({ corpId: appId, agentId: z.string().regex(/^\d{1,16}$/), ...secret }).strict().optional(),
    wechat: z.object({ appId, ...secret }).strict().optional(),
  }).strict(),
}).strict().refine(value => !!value.providers[value.primary], '主登录渠道须有对应的企业应用配置');
export type IMLoginSettings = z.infer<typeof imLoginSettings>;

export type ExternalIdentity = { authority: string; subject: string };
export type VerifiedIdentity = ExternalIdentity & { label: string; channel?: PlatformActor;
  profile?: { provider: IMProvider; name?: string; avatar?: string } };
type OAuthRequest = { redirect: string; state: string; verifier: string; inWeCom?: boolean };
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
const feishuProfile = z.object({ code: z.literal(0), data: z.object({ tenant_key: appId, open_id: octopIMNativeId, name: label,
  avatar_thumb: z.unknown().optional(), avatar_url: z.unknown().optional() }) });
const dingProfile = z.object({ unionId: octopIMNativeId, nick: label, avatarUrl: z.unknown().optional() });
const dingMember = z.object({ errcode: z.literal(0),
  result: z.object({ contact_type: z.literal(0), userid: octopIMNativeId }) });
const wecomToken = z.object({ errcode: z.literal(0), access_token: token });
const wecomMember = z.object({ errcode: z.literal(0), userid: octopIMNativeId.optional(), UserId: octopIMNativeId.optional() });
const wechatToken = tokenResponse.extend({ openid: octopIMNativeId });
const wechatProfile = z.object({ openid: octopIMNativeId, nickname: label, headimgurl: z.unknown().optional() });

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
const invalidMember = () => new WorkbenchError('未能验证该渠道身份或企业成员资格。', 403);

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
    add('feishu', [tenantKey, client], secretEnv, ({ redirect, state, verifier }) =>
      url('https://accounts.feishu.cn/open-apis/authen/v1/authorize', {
        client_id: client, redirect_uri: redirect, response_type: 'code', state, target_tenant: tenantKey,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      }), async (code, { redirect, verifier }, appSecret) => {
      const data = await api(tokenResponse, 'https://open.feishu.cn/open-apis/authen/v2/oauth/token', json({
        grant_type: 'authorization_code', client_id: client, client_secret: appSecret,
        code, redirect_uri: redirect, code_verifier: verifier,
      }));
      const { data: profile } = await api(feishuProfile, 'https://open.feishu.cn/open-apis/authen/v1/user_info', bearer(data.access_token));
      if (profile.tenant_key !== tenantKey) throw invalidMember();
      return { id: profile.open_id, name: profile.name, avatars: [profile.avatar_thumb, profile.avatar_url], ...(client === feishuBotApp && {
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
  return connections;
}
