import { useState, type FormEvent } from 'react';
import { Pagination } from 'antd';
import { ArrowLeft, Check, Clock3, KeyRound, ShieldCheck, UserRoundCog } from 'lucide-react';
import { api, part, useData, type PlatformMembers } from './api.ts';
import { Button } from './components/button.tsx';
import { Input } from './components/input.tsx';
import { SettingsDrawer } from './components/settings-drawer.tsx';
import { Avatar, date, Empty, Failure, Field, Loading, Pill, SearchBox, Section, Segments, useActions, useStored } from './ui.tsx';
import { imNames } from './im-login.tsx';

export const roleLabel = {
  owner: '所有者', admin: '平台管理员', operator: '协作者', viewer: '只读',
  maintainer: '项目维护人', collaborator: '协作', reader: '只读',
} as const;

type Account = PlatformMembers['rows'][number];
type Role = Account['role'];
type MemberDialog = { kind: 'details' | 'role' | 'status' | 'sessions'; account: Account };
type Approval = { kind: 'approve'; request: PlatformMembers['pending'][number] }
  | { kind: 'approve-im' | 'reject-im'; request: PlatformMembers['imPending'][number] };
type Capabilities = PlatformMembers['rolePermissions'][number]['capabilities'];
const permissionRows = [
  { id: 'collaborate', label: '发起工单与参与协作', project: true },
  { id: 'createProject', label: '创建独立项目' },
  { id: 'manageMembers', label: '审批开通与管理普通账号' },
  { id: 'privilegedAccounts', label: '授予管理角色与配置登录渠道' },
  { id: 'manageModels', label: '配置模型服务与查看运行状态' },
  { id: 'manageQuotas', label: '配置平台与个人积分' },
] as const satisfies readonly { id: keyof Capabilities; label: string; project?: true }[];

export function PlatformRoles() {
  const data = useData<PlatformMembers>('admin/members');
  if (data.error) return <Failure error={data.error} retry={() => void data.refetch()} />;
  if (!data.data) return <Loading />;
  return <Section title="角色权限对照">
    <div className="workbench-table-scroll" tabIndex={0} role="region" aria-label="平台角色权限表格">
      <table className="workbench-table role-matrix">
        <thead><tr><th scope="col">权限</th>{data.data.rolePermissions.map(role => <th scope="col" key={role.id}>{roleLabel[role.id]}</th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">查看项目内容</th>{data.data.rolePermissions.map(role => <td key={role.id}><Pill>按项目成员</Pill></td>)}</tr>
          {permissionRows.map(row => <tr key={row.id}><th scope="row">{row.label}</th>{data.data.rolePermissions.map(role => <td key={role.id}>
            {role.capabilities[row.id] ? 'project' in row ? <Pill tone="blue">按项目授权</Pill>
              : <span className="access-allowed"><Check size={15} aria-hidden="true" />允许</span> : <span className="muted-text">无权限</span>}
          </td>)}</tr>)}
        </tbody>
      </table>
    </div>
    <p className="admin-footnote">具体项目由项目维护人配置成员、协作权限和资料授权。</p>
  </Section>;
}

export function AccountManagement({ actor }: { actor: string }) {
  const request = useData<PlatformMembers>('admin/members', 5000);
  const [selected, select] = useState<MemberDialog>();
  const [approval, approve] = useState<Approval>();
  const [view, setView] = useStored<'directory' | 'requests'>('platform-member-view', 'directory');
  const [filter, setFilter] = useStored('platform-member-filters', { search: '', role: '', status: '' });
  const [page, setPage] = useStored('platform-account-page', 1);
  const data = request.data;
  if (!data) return request.error ? <Failure error={request.error} retry={() => void request.refetch()} /> : <Loading />;
  const pending = data.pending.length + data.imPending.length;
  const term = filter.search.trim().toLocaleLowerCase();
  const rows = data.rows.filter(row => (!filter.role || row.role === filter.role) && (!filter.status || row.enabled === (filter.status === 'enabled'))
    && (!term || [row.name, row.displayName, roleLabel[row.role]].some(value => value?.toLocaleLowerCase().includes(term))));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 10)));
  const visible = rows.slice((currentPage - 1) * 10, currentPage * 10);
  const update = (next: typeof filter) => { setFilter(next); setPage(1); };
  const reset = () => update({ search: '', role: '', status: '' });
  return <section className="admin-card" aria-label="平台成员管理">
    {request.error && <Failure error={request.error} retry={() => void request.refetch()} />}
    <div className="admin-card-top"><Segments label="成员视图" items={[
      ['directory', '账号列表 · ' + data.rows.length], ['requests', '开通申请 · ' + pending],
    ]} value={view} onChange={setView} />
      {view === 'directory' && <a className="text-button" href="#/platform?tab=roles"><ShieldCheck size={15} />角色权限对照</a>}
    </div>
    {view === 'directory' ? <>
      <div className="admin-filters">
        <SearchBox label="搜索名称或账号" value={filter.search} onChange={search => update({ ...filter, search })} />
        <select aria-label="筛选平台角色" value={filter.role} onChange={event => update({ ...filter, role: event.target.value })}>
          <option value="">全部角色</option>{data.rolePermissions.map(role => <option key={role.id} value={role.id}>{roleLabel[role.id]}</option>)}
        </select>
        <select aria-label="筛选账号状态" value={filter.status} onChange={event => update({ ...filter, status: event.target.value })}>
          <option value="">全部状态</option><option value="enabled">启用</option><option value="disabled">停用</option>
        </select>
        {(filter.role || filter.status || filter.search) && <Button size="sm" variant="ghost" onClick={reset}>清除筛选</Button>}
      </div>
      {visible.length > 0 ? <div className="workbench-table-scroll admin-table" tabIndex={0} role="region" aria-label="平台账号表格">
        <table className="workbench-table"><thead><tr><th scope="col">成员</th><th scope="col">平台角色</th><th scope="col">账号状态</th><th scope="col">操作</th></tr></thead>
          <tbody>{visible.map(account => <tr key={account.name}>
            <th scope="row"><div className="account-cell"><Avatar avatar={account.avatar} value={account.name} />
              <div><strong>{account.displayName ?? account.name}</strong>{account.name === actor && <small> · 当前账号</small>}
                {account.displayName && <div className="muted-text">{account.name}</div>}</div>
            </div></th>
            <td><Pill tone={account.role === 'owner' || account.role === 'admin' ? 'blue' : 'neutral'}>{roleLabel[account.role]}</Pill></td>
            <td><Pill tone={account.enabled ? 'green' : 'neutral'}>{account.enabled ? '启用' : '停用'}</Pill></td>
            <td><Button size="sm" variant="ghost" onClick={() => select({ kind: 'details', account })}>{account.mayManage ? '管理' : '查看'}</Button></td>
          </tr>)}</tbody>
        </table>
      </div> : <Empty title={data.rows.length ? '没有匹配的账号' : '暂无平台账号'} />}
      {rows.length > 10 && <Pagination className="workbench-pagination" size="small" current={currentPage} pageSize={10}
        total={rows.length} showSizeChanger={false} onChange={setPage} showTotal={total => '共 ' + total + ' 个账号'} />}
    </> : <div className="opening-requests">
      {data.imPending.map(row => <div className="access-row record-row" key={row.id}>
        <Avatar value={row.displayName} /><div className="access-identity"><strong>{row.displayName}</strong>
          <div className="inline-meta"><Pill tone="green">{imNames[row.provider]}身份已验证</Pill><time>{date(row.submittedAt)}</time></div>
        </div><div className="actions">
          <Button size="sm" variant="ghost" onClick={() => approve({ kind: 'reject-im', request: row })}>拒绝</Button>
          <Button size="sm" onClick={() => approve({ kind: 'approve-im', request: row })}>审批</Button>
        </div>
      </div>)}
      {data.pending.map(row => <div className="access-row record-row" key={row.id}>
        <Avatar value={row.feishuName} /><div className="access-identity"><strong>{row.feishuName}</strong>
          <div className="inline-meta"><span>{row.username}</span><Pill tone="green">企内飞书已验证</Pill></div></div>
        <Button size="sm" onClick={() => approve({ kind: 'approve', request: row })}>审批</Button>
      </div>)}
      {!pending && <Empty title="暂无待审批申请" icon={<Clock3 size={22} />} />}
    </div>}
    {selected && <MemberDrawer key={selected.account.name + ':' + selected.kind} selection={selected}
      account={data.rows.find(row => row.name === selected.account.name)} data={data} actor={actor}
      change={select} close={() => select(undefined)} />}
    {approval && <ApprovalEditor approval={approval} data={data} close={() => approve(undefined)} />}
  </section>;
}

function RoleChoice({ role, choose, data }: { role: Role; choose: (value: Role) => void; data: PlatformMembers }) {
  return <Field label="平台角色"><select required value={role} onChange={event => choose(event.target.value as Role)}>
    {data.roles.map(row => <option key={row.id} value={row.id}>{roleLabel[row.id]}</option>)}
  </select></Field>;
}

function RolePreview({ role, data, from }: { role: Role; data: PlatformMembers; from?: Role }) {
  const capabilities = data.rolePermissions.find(row => row.id === role)?.capabilities;
  const before = from && data.rolePermissions.find(row => row.id === from)?.capabilities;
  const visible = permissionRows.filter(row => capabilities?.[row.id]);
  const withdrawn = before ? permissionRows.filter(row => before[row.id] && !capabilities?.[row.id]) : [];
  return <div className="role-preview">
    <h3>{roleLabel[role]}的权限</h3>
    <ul><li>查看已加入项目的可见内容</li>{visible.map(row => <li key={row.id}>{row.label}{'project' in row && '（按项目授权）'}</li>)}</ul>
    {!!withdrawn.length && <p>收回 {withdrawn.map(row => row.label).join('、')}</p>}
  </div>;
}

function MemberDrawer({ selection, account, data, actor, change, close }: {
  selection: MemberDialog; account?: Account; data: PlatformMembers; actor: string; change: (next: MemberDialog) => void; close: () => void;
}) {
  const { run, busy, clearError } = useActions();
  const [role, choose] = useState(selection.account.role);
  if (!account) return <SettingsDrawer title="成员详情" close={close}><Empty title="账号已不可见" /></SettingsDrawer>;
  const { kind } = selection;
  const detail = kind === 'details';
  const status = kind === 'status';
  const danger = status && selection.account.enabled;
  const roleChanged = account.role !== selection.account.role;
  const statusChanged = account.enabled !== selection.account.enabled;
  const stale = !detail && (roleChanged || statusChanged || !account.mayManage);
  const open = (kind: MemberDialog['kind']) => { clearError(); change({ kind, account }); };
  const title = detail ? '成员详情' : kind === 'role' ? '调整平台角色' : status ? danger ? '停用账号' : '启用账号' : '撤销登录会话';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (stale || detail || kind === 'role' && role === account.role) return;
    const root = 'admin/members/' + part(account.name);
    const response = await run(() => kind === 'role' ? api(root + '/role', { role }) : status
      ? api(root + '/status', { enabled: !account.enabled }) : api(root + '/sessions', {}),
    kind === 'sessions' ? '已撤销登录会话' : '账号设置已保存');
    if (response) close();
  };
  return <SettingsDrawer title={title} close={close} extra={!detail && <Button variant="ghost" disabled={busy} onClick={() => open('details')}><ArrowLeft />返回详情</Button>}
    submit={!detail ? { form: 'member-access-form', label: kind === 'role' ? '保存角色' : title, danger,
      disabled: stale || kind === 'role' && (role === account.role || !data.roles.some(row => row.id === role)) } : undefined}>
    <div className="admin-identity"><Avatar avatar={account.avatar} value={account.name} size="medium" />
      <div><strong>{account.displayName ?? account.name}</strong><p>{account.displayName ? account.name + ' · ' : ''}{roleLabel[account.role]}</p>
        {account.bio && <p className="profile-bio">{account.bio}</p>}</div>
      <Pill tone={account.enabled ? 'green' : 'neutral'}>{account.enabled ? '启用' : '停用'}</Pill>
    </div>
    {detail ? <div className="admin-editor-stack">
      <RolePreview role={account.role} data={data} />
      {account.mayManage ? <div className="member-actions">
        <Button variant="outline" onClick={() => open('role')}><UserRoundCog />调整平台角色</Button>
        <Button variant="outline" onClick={() => open('sessions')}><KeyRound />撤销登录会话</Button>
        <Button variant="outline" danger={account.enabled} onClick={() => open('status')}>{account.enabled ? '停用账号' : '启用账号'}</Button>
      </div> : account.name === actor ? <a className="text-button" href="#/account">在个人设置中管理这个账号</a>
        : <p className="muted-text">由平台所有者管理该账号。</p>}
    </div> : <form id="member-access-form" className="form" onSubmit={submit}>
      {stale && <div className="info-callout" role="alert">账号权限或状态已变化。返回详情查看当前设置。</div>}
      {kind === 'role' && <><RoleChoice role={role} choose={choose} data={data} /><RolePreview role={role} data={data} from={account.role} />
        {role !== account.role && <p className="admin-impact">保存后，该成员需要重新登录。{role === 'viewer' && '降为只读会撤回相关委托、执行权限及资料授权。'}</p>}</>}
      {status && <p className="admin-impact">{danger ? '停用后将撤销登录会话、待办权限和项目执行权限。' : '启用后，该成员可按当前平台角色和项目授权重新登录。'}</p>}
      {kind === 'sessions' && <p className="admin-impact">该账号在各设备上的工作台会话将退出。成员需重新登录。</p>}
    </form>}
  </SettingsDrawer>;
}

function ApprovalEditor({ approval, data, close }: { approval: Approval; data: PlatformMembers; close: () => void }) {
  const reject = approval.kind === 'reject-im';
  const { run } = useActions();
  const [role, choose] = useState<Role>((data.roles.find(row => row.id === 'operator') ?? data.roles[0])?.id ?? 'viewer');
  return <SettingsDrawer title={reject ? '拒绝开通申请' : '批准账号开通'} close={close}
    submit={{ form: 'account-approval', label: reject ? '拒绝开通' : '批准开通', danger: reject }}>
    <form className="form" id="account-approval" onSubmit={async event => {
      event.preventDefault();
      const id = part(approval.request.id);
      const saved = await run(() => approval.kind === 'approve' ? api('admin/activation/' + id, { role })
        : api('admin/im-registration/' + id, reject ? { action: 'reject' } : { action: 'approve', role }),
      reject ? '已拒绝开通申请' : '已批准开通申请');
      if (saved) close();
    }}>
      <strong>{approval.kind === 'approve' ? approval.request.feishuName + ' · ' + approval.request.username : approval.request.displayName}</strong>
      {!reject && <><RoleChoice role={role} choose={choose} data={data} /><RolePreview role={role} data={data} />
        <p className="muted-text">{approval.kind === 'approve' ? '批准后由成员本人设置口令。' : '批准后成员可使用' + imNames[approval.request.provider] + '登录。'}</p></>}
    </form>
  </SettingsDrawer>;
}
