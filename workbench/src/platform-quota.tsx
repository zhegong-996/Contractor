import { useState, type FormEvent, type ReactNode } from 'react';
import { Coins, Plus } from 'lucide-react';
import { api, useData, type ModelService, type PointPolicy, type PointPool } from './api.ts';
import { Button } from './components/button.tsx';
import { Input } from './components/input.tsx';
import { SettingsDrawer } from './components/settings-drawer.tsx';
import { Empty, Failure, Field, Loading, Pill, SearchBox, Section, useActions, useStored } from './ui.tsx';
import { PointPoolEditor } from './agent-operations.tsx';

type Rate = PointPolicy['rates'][number];
type Edit = { kind: 'policy' } | { kind: 'rate'; rate?: Rate } | { kind: 'remove'; rate: Rate };
const providers: Record<string, string> = { openai: 'OpenAI', deepseek: 'DeepSeek', ollama: 'Ollama' };
const format = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
const rateKey = (rate: Pick<Rate, 'provider' | 'model'>) => JSON.stringify([rate.provider, rate.model]);
const reservedPoints = (rate: Rate, tokensPerPoint: number) => Math.ceil(rate.reserveTokens * Math.round(rate.multiplier * 1000) / tokensPerPoint) / 1000;

export function PlatformQuota({ mayViewModels }: { mayViewModels: boolean }) {
  const policy = useData<PointPolicy>('budget/points-policy', 7000);
  const pools = useData<PointPool[]>('admin/point-budgets', 5000);
  const services = useData<ModelService[]>(mayViewModels ? 'admin/model-services' : '');
  const [edit, setEdit] = useState<Edit>();
  const [base, setBase] = useState<PointPolicy>();
  const [pool, setPool] = useState<PointPool>();
  const [poolSearch, search] = useStored('platform-point-pool-search', '');
  const { run } = useActions();
  const open = (next: Edit) => { setEdit(next); setBase(policy.data); };
  const close = () => setEdit(undefined);
  const current = policy.data;
  const stale = !!base && !!current && base.revision !== current.revision;
  const shown = pools.data?.filter(row => row.label.toLocaleLowerCase().includes(poolSearch.trim().toLocaleLowerCase()));
  const save = async (changes: Partial<Omit<PointPolicy, 'revision'>>) => {
    if (!base || stale) return;
    if (await run(() => api('budget/points-policy', { ...base, ...changes }), '积分策略已保存')) close();
    else await policy.refetch();
  };
  const refresh = stale && <div className="info-callout" role="status">积分策略已由其他人更新。请核对当前设置后重新编辑。</div>;
  return <>
    {policy.error && <Failure error={policy.error} retry={() => void policy.refetch()} />}
    {!current && !policy.error && <Loading />}
    {current && <>
      <Section title="积分管控" action={<Button size="sm" variant="outline" onClick={() => open({ kind: 'policy' })}>设置换算基准</Button>}>
        <div className="quota-base"><span className="admin-glyph"><Coins size={19} /></span>
          <div><strong>{format.format(current.tokensPerPoint)} Token / 基准积分</strong><p>实际积分按 Token 用量乘模型倍率后换算。</p></div>
          <Pill tone={current.enabled ? 'green' : 'neutral'}>{current.enabled ? '已启用' : '未启用'}</Pill>
        </div>
      </Section>
      <Section title="模型倍率" action={<Button size="sm" disabled={current.rates.length >= 200} onClick={() => open({ kind: 'rate' })}><Plus />添加倍率</Button>}>
        {current.rates.length ? <div className="workbench-table-scroll" tabIndex={0} role="region" aria-label="模型积分倍率表格">
          <table className="workbench-table admin-data-table"><thead><tr><th scope="col">模型 / 供应商</th><th scope="col">倍率</th>
            <th scope="col">单轮预留</th><th scope="col">操作</th></tr></thead>
            <tbody>{current.rates.map(rate => <tr key={rateKey(rate)}>
              <th scope="row"><strong>{rate.model}</strong><small className="admin-cell-secondary">{providers[rate.provider] ?? rate.provider}</small></th>
              <td><Pill tone="blue">{format.format(rate.multiplier)}×</Pill></td>
              <td>{format.format(reservedPoints(rate, current.tokensPerPoint))} 分<small className="admin-cell-secondary">{format.format(rate.reserveTokens)} Token</small></td>
              <td><Button size="sm" variant="ghost" onClick={() => open({ kind: 'rate', rate })}>编辑倍率</Button></td>
            </tr>)}</tbody>
          </table>
        </div> : <Empty title="暂无模型倍率" description={current.enabled ? '补齐模型倍率后，相关 Agent 才能开始新执行。' : undefined} />}
      </Section>
    </>}
    <Section title="平台与个人额度" action={<div className="admin-toolbar-search"><SearchBox label="搜索积分池" value={poolSearch} onChange={search} /></div>}>
      {pools.error ? <Failure error={pools.error} retry={() => void pools.refetch()} /> : !shown ? <Loading /> : shown.length ?
        <div className="workbench-table-scroll" tabIndex={0} role="region" aria-label="平台积分池表格">
          <table className="workbench-table admin-data-table"><thead><tr><th scope="col">积分池</th><th scope="col">周期与上限</th>
            <th scope="col">已用 / 预留</th><th scope="col">可用</th><th scope="col">操作</th></tr></thead>
            <tbody>{shown.map(row => <tr key={row.kind + ':' + row.subject}>
              <th scope="row">{row.label}<small className="admin-cell-secondary">{row.kind === 'platform' ? '平台额度' : '个人代办'}</small></th>
              <td>{row.limit === null ? '不限' : format.format(row.limit) + ' 分'}<small className="admin-cell-secondary">{row.period === 'day' ? '每日' : '每月'}</small></td>
              <td>{format.format(row.used)} / {format.format(row.reserved)} 分{row.incomplete > 0 && <small className="admin-cell-secondary">{row.incomplete} 轮用量待回报</small>}</td>
              <td>{row.remaining === null ? '不限' : format.format(row.remaining) + ' 分'}{current?.enabled && row.blocked && <div><Pill tone="amber">额度已用完</Pill></div>}</td>
              <td>{row.mayManage && <Button size="sm" variant="ghost" onClick={() => setPool(row)}>调整额度</Button>}</td>
            </tr>)}</tbody>
          </table>
        </div> : <Empty title="没有匹配的积分池" />}
    </Section>
    {edit?.kind === 'policy' && base && <BaseEditor base={base} close={close} stale={stale} refresh={refresh} save={save} />}
    {edit?.kind === 'rate' && base && <RateEditor base={base} rate={edit.rate} services={services.data ?? []} close={close} stale={stale} refresh={refresh}
      remove={edit.rate ? () => setEdit({ kind: 'remove', rate: edit.rate! }) : undefined} save={save} />}
    {edit?.kind === 'remove' && base && <SettingsDrawer title="移除模型倍率" close={close}
      submit={{ form: 'remove-rate', label: '移除倍率', danger: true, disabled: stale }}>
      <form className="form" id="remove-rate" onSubmit={event => {
        event.preventDefault();
        void save({ rates: base.rates.filter(rate => rateKey(rate) !== rateKey(edit.rate)) });
      }}><strong>{edit.rate.model}</strong>{refresh}
        <p className="muted-text">启用积分管控时，缺少倍率的模型会暂停新执行。</p>
      </form>
    </SettingsDrawer>}
    {pool && <PointPoolEditor pool={pool} close={() => setPool(undefined)} />}
  </>;
}

type EditorProps = { base: PointPolicy; close: () => void; stale: boolean; refresh: ReactNode;
  save: (changes: Partial<Omit<PointPolicy, 'revision'>>) => Promise<void> };

function BaseEditor({ base, close, stale, refresh, save }: EditorProps) {
  const [enabled, enable] = useState(!!base.enabled);
  const [tokens, setTokens] = useState(String(base.tokensPerPoint));
  const unchanged = enabled === !!base.enabled && Number(tokens) === base.tokensPerPoint;
  return <SettingsDrawer title="设置积分换算" close={close} submit={{ form: 'quota-base', label: '保存积分设置', disabled: stale || unchanged }}>
    <form className="form" id="quota-base" onSubmit={event => {
      event.preventDefault();
      if (!unchanged) void save({ enabled, tokensPerPoint: Number(tokens) });
    }}>
      {refresh}
      <label className="admin-setting-toggle"><div><strong>启用积分管控</strong><small>启用后按模型倍率和积分池上限接单。</small></div>
        <input type="checkbox" checked={enabled} onChange={event => enable(event.target.checked)} />
      </label>
      <Field label="每基准积分对应的 Token" hint="倍率为 1× 时，使用这么多 Token 消耗 1 分。">
        <Input type="number" min={1} max={10000000} required value={tokens} onChange={event => setTokens(event.target.value)} />
      </Field>
      {enabled && <p className="admin-impact">缺少倍率的模型会暂停新执行。已记录的积分按当时的换算规则查阅。</p>}
    </form>
  </SettingsDrawer>;
}

function RateEditor({ base, close, stale, refresh, save, rate, services, remove }: EditorProps & { rate?: Rate; services: ModelService[]; remove?: () => void }) {
  const { busy } = useActions();
  const [provider, setProvider] = useState(rate?.provider ?? '');
  const [model, setModel] = useState(rate?.model ?? '');
  const [multiplier, setMultiplier] = useState(String(rate?.multiplier ?? 1));
  const [tokens, setTokens] = useState(String(rate?.reserveTokens ?? 30000));
  const entry = { provider: provider.trim(), model: model.trim(), multiplier: Number(multiplier), reserveTokens: Number(tokens) };
  const providerNames = [...new Set([...services.map(service => service.provider), ...base.rates.map(row => row.provider), ...Object.keys(providers)])];
  const modelNames = [...new Set([...(services.find(service => service.provider === entry.provider)?.availableModels ?? []),
    ...base.rates.filter(row => row.provider === entry.provider).map(row => row.model)])];
  const duplicate = base.rates.some(row => rateKey(row) === rateKey(entry) && (!rate || rateKey(rate) !== rateKey(row)));
  const valid = !!entry.provider && !!entry.model && !duplicate && entry.multiplier >= 0.001 && entry.multiplier <= 100 && entry.reserveTokens > 0;
  const same = !!rate && rateKey(rate) === rateKey(entry) && rate.multiplier === entry.multiplier && rate.reserveTokens === entry.reserveTokens;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || same) return;
    const rates = rate ? base.rates.map(row => rateKey(row) === rateKey(rate) ? entry : row) : [...base.rates, entry];
    await save({ rates });
  };
  return <SettingsDrawer title={rate ? '编辑模型倍率' : '添加模型倍率'} close={close} submit={{ form: 'quota-rate', label: '保存倍率', disabled: stale || !valid || same }}
    extra={remove && <Button variant="ghost" danger disabled={busy} onClick={remove}>移除倍率</Button>}>
    <form className="form" id="quota-rate" onSubmit={submit}>
      {refresh}
      <Field label="供应商"><Input autoFocus list="rate-providers" maxLength={100} required value={provider} onChange={event => setProvider(event.target.value)} /></Field>
      <datalist id="rate-providers">{providerNames.map(name => <option value={name} key={name} label={providers[name] ?? name} />)}</datalist>
      <Field label="模型 ID" hint="可从已配置模型选择，也可输入模型 ID。"><Input list="rate-models" aria-invalid={duplicate} maxLength={100}
        required value={model} onChange={event => setModel(event.target.value)} /></Field>
      <datalist id="rate-models">{modelNames.map(name => <option value={name} key={name} />)}</datalist>
      {duplicate && <p className="field-error" role="alert">该供应商的这个模型已有倍率，请编辑现有规则。</p>}
      <div className="form-grid"><Field label="倍率（×）"><Input type="number" min={0.001} max={100} step={0.001} required value={multiplier}
        onChange={event => setMultiplier(event.target.value)} /></Field>
      <Field label="单轮预留 Token"><Input type="number" min={1} max={10000000} step={1} required value={tokens} onChange={event => setTokens(event.target.value)} /></Field></div>
      {entry.reserveTokens > 0 && entry.multiplier > 0 && <div className="admin-impact" role="status">
        每轮启动先预留 <strong>{format.format(reservedPoints(entry, base.tokensPerPoint))} 分</strong>，回执按实际 Token 结算。
      </div>}
    </form>
  </SettingsDrawer>;
}
