import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, ShieldCheck } from 'lucide-react';
import { api, useData, type LoginPolicy, type Session } from './api.ts';
import { Button } from './components/button.tsx';
import { Failure, FormError, Loading, Pill, Section, useActions } from './ui.tsx';
import { imAuthorizationHints, imProviderNames as imNames } from '../../src/workbench/im-login-channels.ts';

export { imNames };
const notices = {
  pending: '已验证你的身份。管理员开通后，用同一个账号授权即可进入工作台。',
  existing: '这个渠道身份已关联一个工作台账号。请登录原账号，在「个人设置 → 登录安全」完成绑定。',
  linked: '已绑定，可以使用此渠道登录原账号。',
  conflict: '此渠道身份已经绑定其他账号，或原账号已有该渠道的登录身份。',
  denied: '开通申请未获批准，请联系平台管理员。',
  blocked: '此工作台账号已停用，请联系平台管理员。',
  cancelled: '授权已取消，可以重新登录。',
  failed: '无法验证登录身份。请核对应用可用范围，或联系平台管理员。',
  expired: '本次授权已失效，请重新发起。',
  busy: '当前开通申请较多，请稍后重试。',
} as const;

export function useIMNotice() {
  const [status] = useState(() => {
    const flag = new URLSearchParams(location.search).get('im');
    return flag && Object.hasOwn(notices, flag) ? flag as keyof typeof notices : undefined;
  });
  useEffect(() => {
    if (!status || status === 'pending') return;
    const current = new URL(location.href);
    current.searchParams.delete('im');
    history.replaceState(history.state, '', current);
  }, [status]);
  return { status, text: status && notices[status] };
}

export function IMLoginEntry({ login, status }: { login?: Session['imLogin']; status?: keyof typeof notices }) {
  if (!login?.ready || !login.provider) return null;
  const next = new URLSearchParams({ next: location.hash });
  return <div className="login-enterprise">
    {status !== 'pending' && <p className="muted-text">{imAuthorizationHints[login.provider]}</p>}
    <Button href={'/api/auth/im/start?' + next} size="lg" block>
      <span><ShieldCheck size={18} />{status === 'pending' ? '获批后使用' : '使用'}{imNames[login.provider]}登录</span>
      <ArrowRight size={17} aria-hidden="true" />
    </Button>
    {!status && <p className="muted-text login-first-time">首次使用时，授权后会自动提交开通申请。</p>}
  </div>;
}

export function MyIMLogin({ login }: { login: NonNullable<Session['imLogin']> }) {
  const { run, busy } = useActions();
  const notice = useIMNotice();
  if (!login.provider) return null;
  function link(provider: NonNullable<Session['imLogin']>['provider']) {
    return void run(async () => {
      const { location: destination } = await api<{ location: string }>('account/im-link', { provider });
      window.location.assign(destination);
    });
  }
  return <>
    <div className="record-row">
      <span>{imNames[login.provider]}登录</span>
      <Pill tone={login.linked ? 'green' : 'neutral'}>{login.linked ? '已绑定' : '未绑定'}</Pill>
      {!login.linked && login.ready && (login.onTeamAddress ? <Button size="sm" variant="outline" disabled={busy}
        onClick={() => link(login.provider)}>绑定到当前账号</Button>
        : <Button size="sm" variant="outline" href={login.origin + '/#/account'}>打开团队工作台</Button>)}
    </div>
    {login.onTeamAddress && !!login.migration.length && <details className="minor-disclosure">
      <summary>迁移到其他登录渠道</summary>
      {login.migration.map(option => <div className="record-row" key={option.provider}>
        <span>{imNames[option.provider]}</span>{option.linked ? <Pill tone="green">已绑定</Pill>
          : <Button size="sm" variant="outline" disabled={busy} onClick={() => link(option.provider)}>绑定{imNames[option.provider]}</Button>}
      </div>)}
    </details>}
    {notice.text && <p className="muted-text" role={notice.status === 'linked' ? 'status' : 'alert'}>{notice.text}</p>}
  </>;
}

export function LoginChannelSettings() {
  const data = useData<LoginPolicy>('admin/im-login');
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  return <PolicyForm key={data.data.primary + ':' + data.data.legacyPassword} policy={data.data} />;
}

function PolicyForm({ policy }: { policy: LoginPolicy }) {
  const { busy, run } = useActions();
  const [primary, setPrimary] = useState(policy.primary ?? '');
  const [legacyPassword, setLegacyPassword] = useState(policy.legacyPassword);
  const canSave = !!policy.primary && policy.providers.some(row => row.provider === primary && row.ready)
    && (primary !== policy.primary || legacyPassword !== policy.legacyPassword);
  return <form className="admin-content" onSubmit={async event => {
    event.preventDefault();
    if (canSave) await run(() => api('admin/im-login', { primary, legacyPassword }), '登录渠道设置已保存');
  }}>
    <Section title="企业主登录渠道">
      {!policy.primary && <p className="admin-impact">当前使用工作台账号登录。请先在部署配置中指定主渠道。</p>}
      <div className="admin-channel-grid" role="radiogroup" aria-label="企业主登录渠道">
        {policy.providers.map(row => <label className="admin-channel-option" key={row.provider} data-selected={primary === row.provider}
          data-disabled={!row.ready || !policy.primary}>
          <input name="primary" type="radio" checked={primary === row.provider} disabled={!row.ready || !policy.primary || busy}
            onChange={() => setPrimary(row.provider)} />
          <span><strong>{imNames[row.provider]}</strong><small>{row.ready ? '可发起授权' : !row.configured ? '未配置应用'
            : policy.callback ? '缺少应用凭据' : '缺少团队 HTTPS 地址'}</small></span>
          {policy.primary === row.provider && <Pill tone="blue">当前使用</Pill>}
        </label>)}
      </div>
      {!policy.primary || !policy.providers.some(row => row.ready) ? <p className="admin-impact">
        请在服务端配置登录应用和 HTTPS 回调地址后启用。应用密钥保存在服务端。
      </p> : null}
      {policy.callback && <div className="admin-callback"><div><strong>授权回调地址</strong>
        <code className="login-callback">{policy.callback}</code></div>
        <Button type="button" size="sm" variant="outline" onClick={() => void run(
          () => navigator.clipboard.writeText(policy.callback!), '已复制回调地址',
        )}><Copy />复制地址</Button>
      </div>}
    </Section>
    <Section title="登录方式">
      <label className="admin-setting-toggle">
        <div><strong>保留原账号口令登录</strong><small>新成员使用主渠道验证身份，由管理员审批开通。</small></div>
        <input type="checkbox" checked={legacyPassword} disabled={!policy.primary || busy}
          onChange={event => setLegacyPassword(event.target.checked)} />
      </label>
      {canSave && (primary !== policy.primary || !legacyPassword) && <div className="admin-impact">
        {primary !== policy.primary && <p>切换后，使用旧渠道登录的成员需要重新登录。</p>}
        {!legacyPassword && policy.legacyPassword && <p>停用后，使用口令登录的成员需要改用主渠道。</p>}
      </div>}
      <FormError />
      <div className="form-actions admin-save"><Button type="submit" loading={busy} disabled={!canSave}><Check />保存登录设置</Button></div>
    </Section>
  </form>;
}
