import { RefreshCw } from 'lucide-react';
import { api, part, type Ticket } from './api.ts';
import { Button } from './components/button.tsx';
import { date, Ext, Pill, short, useActions } from './ui.tsx';

const state = {
  passed: { label: '通过', tone: 'green' },
  failed: { label: '失败', tone: 'red' },
  pending: { label: '待核验', tone: 'amber' },
} as const;

export function DeliveryVerification({ ticket, revision, verification }: {
  ticket: string; revision: string; verification: NonNullable<Ticket['deliveryVerification']>;
}) {
  const { busy, run } = useActions();
  return <section className="detail-stack" aria-label="本版交付核验">
    <div className="record-row">
      <strong>本版交付核验</strong>
      <span>模板 {verification.template} · 第 {verification.version} 版</span>
      <code title={verification.head}>{short(verification.head, 12)}</code>
      {verification.mayRecheck && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(
        () => api('ticket/' + part(ticket) + '/recheck-delivery', { revision, head: verification.head }),
        '已重新核对本版交付证据',
      )}><RefreshCw />重新核验</Button>}
    </div>
    {verification.checks.map(check => <div className="record-row" key={check.app + ':' + check.name}>
      <Ext href={check.url ?? undefined}>{check.name}</Ext>
      <Pill tone={state[check.state].tone}>{state[check.state].label}</Pill>
      {check.id && <span>检查 #{check.id}</span>}
    </div>)}
    {verification.review && <div className="record-row">
      <Ext href={verification.review.url ?? undefined}>独立审查</Ext>
      <Pill tone={state[verification.review.state].tone}>
        {verification.review.state === 'failed' ? '要求修改' : state[verification.review.state].label}
      </Pill>
      {verification.review.id && <span>审查 #{verification.review.id}</span>}
    </div>}
  </section>;
}

const channels = { feishu: '飞书', dingtalk: '钉钉', wecom: '企业微信', weixin: '微信', telegram: 'Telegram', discord: 'Discord', qq: 'QQ' };
const receipts = {
  sent: { label: '平台已确认', tone: 'green' },
  waiting: { label: '等待回传', tone: 'neutral' },
  confirming: { label: '确认中', tone: 'amber' },
  unconfirmed: { label: '回传未确认', tone: 'amber' },
} as const;

export function ChannelReceipt({ receipt }: { receipt: NonNullable<Ticket['channelReturn']> }) {
  const status = receipts[receipt.state];
  return <div className="record-row" aria-label="原会话回传">
    <span>{channels[receipt.channel]} · 原会话回传</span>
    <Pill tone={status.tone}>{status.label}</Pill>
    {receipt.form && <span>{receipt.form === 'card' ? '卡片' : '消息'}</span>}
    {receipt.acknowledgedAt && <time>{date(receipt.acknowledgedAt, true)}</time>}
    {receipt.state === 'unconfirmed' && <span>可在工作台查看完整回复。</span>}
  </div>;
}
