import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ConsoleAccount } from '../console-auth.ts';
import { imConnections, imProvider, identityHash, imProviderNames, type ExternalIdentity, type IMLoginSettings,
  type IMProvider, type VerifiedIdentity } from './im-login-providers.ts';
import { WorkbenchError } from './errors.ts';
import { feishuScanOrigin } from './im-login-channels.ts';

export const imCallbackPath = '/api/auth/im/callback';
export const imLoginCookie = 'contractor_im_oauth';
export const imQrCookie = (state: string | null) => state && /^[a-f0-9]{48}$/.test(state) ? 'contractor_im_qr_' + state : undefined;
const maxChallenges = 500;
const oauthTimeout = 8 * 60_000;
const registrationTimeout = 7 * 24 * 60 * 60_000;
const maxRegistrations = 500;
type BindingSession = { member: string; fingerprint: string };
type Challenge = { expires: number; proof: string; provider: IMProvider; authority: string; verifier: string; to: string;
  link?: BindingSession; embeddedQr?: true };
type Policy = { primary: IMProvider; legacyPassword: boolean };
type Registration = { id: string; provider: IMProvider; identity: VerifiedIdentity; submittedAt: number };
type CallbackResult = { to: string; status: 'expired' | 'failed' | 'cancelled' }
  | { to: string; provider: IMProvider; identity: VerifiedIdentity; link?: BindingSession };

export function imReturnPath(path: string | null) {
  if (!path || path.length > 750 || /[\x00-\x20\\\x7f]/.test(path)) return '/';
  if (/^#\/(?!\/)/.test(path)) return '/' + path;
  return /^\/runner\/connect\/[a-f0-9-]{36}$/.test(path) ? path : '/';
}

export function withIMStatus(to: string, status: string) {
  const result = new URL(to, 'https://workbench.invalid');
  result.searchParams.set('im', status);
  return result.pathname + result.search + result.hash;
}

export function openIMLogin(db: DatabaseSync, config: IMLoginSettings | undefined, origin: string | undefined,
  feishuBotApp?: string, fetcher = fetch) {
  const connections = imConnections(config, feishuBotApp, fetcher);
  const challenges = new Map<string, Challenge>();
  const now = Date.now;
  let generation = 0;
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_im_login_policy (slot INTEGER PRIMARY KEY CHECK(slot=1), provider TEXT NOT NULL, legacy_password INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workbench_im_registration (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, authority TEXT NOT NULL, identity TEXT NOT NULL,
      submitted INTEGER NOT NULL, expires INTEGER NOT NULL, rejected INTEGER NOT NULL DEFAULT 0
    );`);
  const callback = origin && new URL(imCallbackPath, origin).href;
  let policy: Policy | undefined;
  if (config) {
    const saved = db.prepare('SELECT provider,legacy_password FROM workbench_im_login_policy WHERE slot=1').get();
    const parsed = imProvider.safeParse(saved?.provider);
    policy = parsed.success && config.providers[parsed.data]
      ? { primary: parsed.data, legacyPassword: saved!.legacy_password === 1 }
      : { primary: config.primary, legacyPassword: config.legacyPassword };
  }
  const connection = () => policy && connections.get(policy.primary);
  const legacyPassword = () => policy?.legacyPassword ?? true;

  function view() {
    return {
      primary: policy?.primary, legacyPassword: legacyPassword(), origin, callback,
      providers: imProvider.options.map(provider => ({ provider, configured: !!config?.providers[provider],
        ready: !!callback && connections.has(provider) })),
    };
  }
  function select(next: Policy, accounts: ConsoleAccount[]) {
    if (!policy || !callback || !connections.has(next.primary))
      throw new WorkbenchError('请先配置该渠道的登录应用、凭据和 HTTPS 回调。', 409);
    const current = connections.get(next.primary)!;
    if (!next.legacyPassword && !accounts.some(account => !account.disabled && account.role === 'owner'
      && account.imLogins?.some(row => row.authority === current.authority)))
      throw new WorkbenchError('请先让一位平台所有者绑定此渠道，再关闭口令迁移入口。', 409);
    const changed = { provider: policy.primary !== next.primary, legacyPassword: policy.legacyPassword !== next.legacyPassword };
    if (changed.provider || changed.legacyPassword) {
      db.prepare(`INSERT INTO workbench_im_login_policy VALUES (1,?,?)
        ON CONFLICT(slot) DO UPDATE SET provider=excluded.provider,legacy_password=excluded.legacy_password`)
        .run(next.primary, next.legacyPassword ? 1 : 0);
      policy = next;
      generation++;
      challenges.clear();
    }
    return changed;
  }
  function browser(currentOrigin: string, account?: ConsoleAccount) {
    const provider = policy?.primary;
    const current = connection();
    const isLinked = (authority: string) => !!account?.imLogins?.some(row => row.authority === authority);
    return { provider, origin, ready: !!(current && callback), onTeamAddress: !!origin && origin === currentOrigin,
      embeddedQr: !!callback && current?.provider === 'feishu',
      legacyPassword: legacyPassword(), hasPassword: !!account?.passwordHash, linked: !!current && isLinked(current.authority),
      migration: account && callback ? [...connections.values()].filter(item => item.provider !== provider)
        .map(item => ({ provider: item.provider, linked: isLinked(item.authority) })) : [],
    };
  }
  function begin(to: string | null, inWeCom?: boolean, link?: BindingSession & { provider?: IMProvider }, embeddedQr?: true) {
    const current = link?.provider ? connections.get(link.provider) : connection();
    if (!current || !callback || embeddedQr && current.provider !== 'feishu')
      throw new WorkbenchError('当前工作台尚未启用此登录方式。', 409);
    const at = now();
    for (const [state, challenge] of challenges) if (challenge.expires <= at) challenges.delete(state);
    if (challenges.size >= maxChallenges) throw new WorkbenchError('登录请求较多，请稍后再试。', 429);
    const state = randomBytes(24).toString('hex');
    const proof = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const expires = at + oauthTimeout;
    challenges.set(state, { expires, proof: identityHash(proof), provider: current.provider, authority: current.authority,
      verifier, to: imReturnPath(to), link, embeddedQr });
    return { location: current.authorize({ redirect: callback, state, verifier, inWeCom, embeddedQr }).href,
      state, proof, maxAge: oauthTimeout / 1000 };
  }
  function beginQr(to: string | null) {
    const start = begin(to, undefined, undefined, true);
    const frame = new URL('/suite/passport/sso/qr', feishuScanOrigin);
    frame.search = new URLSearchParams({ goto: start.location, sdk_version: '1.0.3' }).toString();
    return { ...start, frame: frame.href };
  }
  async function finish(params: URLSearchParams, proof: string | undefined,
    mayLink: (link: BindingSession) => boolean): Promise<CallbackResult> {
    const state = params.get('state');
    const step = state && challenges.get(state);
    const current = step && (step.link ? connections.get(step.provider) : connection());
    if (!state || params.getAll('state').length !== 1 || !step || step.expires <= now() || !callback
      || !proof || !/^[A-Za-z0-9_-]{43}$/.test(proof) || !current || current.authority !== step.authority
      || !timingSafeEqual(Buffer.from(step.proof, 'hex'), Buffer.from(identityHash(proof), 'hex')))
      throw new WorkbenchError('授权请求已失效，请从工作台重新登录。', 409);
    challenges.delete(state);
    const epoch = generation;
    const codes = [...params.getAll('code'), ...(current.provider === 'dingtalk' ? params.getAll('authCode') : [])];
    try {
      if (step.link && !mayLink(step.link)) return { to: step.to, status: 'expired' };
      if (params.has('error') || codes.length === 0) return { to: step.to, status: 'cancelled' };
      if (codes.length !== 1 || !/^[^\x00-\x20\x7f]{1,512}$/.test(codes[0]!))
        return { to: step.to, status: 'failed' };
      const issuers = params.getAll('iss');
      if (current.provider === 'discord' && (issuers.length !== 1 || issuers[0] !== 'https://discord.com'))
        return { to: step.to, status: 'failed' };
      const identity = await current.verify(codes[0]!, { redirect: callback, state, verifier: step.verifier, embeddedQr: step.embeddedQr });
      if (epoch !== generation || step.expires <= now() || step.link && !mayLink(step.link))
        return { to: step.to, status: 'expired' };
      return { to: step.to, provider: current.provider, identity, link: step.link };
    } catch {
      return { to: step.to, status: 'failed' };
    }
  }

  function requestRegistration(provider: IMProvider, identity: VerifiedIdentity) {
    const at = now();
    db.prepare('DELETE FROM workbench_im_registration WHERE expires<=?').run(at);
    const prior = db.prepare('SELECT rejected FROM workbench_im_registration WHERE id=?').get(identity.subject);
    if (prior?.rejected === 1) return 'denied';
    if (!prior && Number(db.prepare('SELECT COUNT(*) AS n FROM workbench_im_registration').get()?.n) >= maxRegistrations)
      return 'busy';
    db.prepare(`INSERT INTO workbench_im_registration (id,provider,authority,identity,submitted,expires) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET identity=excluded.identity,expires=excluded.expires`)
      .run(identity.subject, provider, identity.authority, JSON.stringify(identity), at, at + registrationTimeout);
    return 'pending';
  }
  function registrations() {
    const scope = connection()?.authority;
    if (!scope) return [];
    return db.prepare(`SELECT id,provider,identity,submitted FROM workbench_im_registration
      WHERE authority=? AND expires>? AND rejected=0 ORDER BY submitted,id LIMIT 200`).all(scope, now()).map(row => ({
      id: String(row.id), provider: imProvider.parse(row.provider), identity: JSON.parse(String(row.identity)) as VerifiedIdentity,
      submittedAt: Number(row.submitted),
    })) satisfies Registration[];
  }
  function dropRegistration(id: string) {
    db.prepare('DELETE FROM workbench_im_registration WHERE id=?').run(id);
  }
  return {
    view, browser, select, legacyPassword, begin, beginQr, finish, requestRegistration, registrations, dropRegistration,
    allowsSession(_account: ConsoleAccount, external?: ExternalIdentity) {
      return external ? external.authority === connection()?.authority : legacyPassword();
    },
    rejectRegistration(id: string) {
      db.prepare('UPDATE workbench_im_registration SET rejected=1 WHERE id=?').run(id);
    },
  };
}
export type IMLogin = ReturnType<typeof openIMLogin>;
