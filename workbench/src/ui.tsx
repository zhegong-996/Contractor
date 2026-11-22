import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode, type UIEvent } from 'react';
import { Alert, Card, Empty as DesignEmpty, Modal as DesignModal, Spin } from 'antd';
import { ArrowUpRight, FileText, FolderOpen, HardHat, Search } from 'lucide-react';
import { Badge } from './components/badge.tsx';
import { Button } from './components/button.tsx';
import { Input } from './components/input.tsx';
export { PageTabs, Segments } from './components/page-tabs.tsx';
export { Avatar } from './components/avatar.tsx';
import type { Project, Ticket, TicketRow } from './api.ts';

type Actions = {
  busy: boolean; error: string;
  run: <T>(task: () => Promise<T>, notice?: string) => Promise<T | undefined>;
  clearError: () => void;
  stored: Record<string, unknown>;
  store: (key: string, value: unknown) => void;
  scrollPositions: Map<string, { top: number; left: number }>;
  dialogTrigger: { current: HTMLElement | null };
};
export const ActionContext = createContext<Actions | null>(null);
export const useActions = () => useContext(ActionContext)!;
export function useStored<T>(key: string, initial: T): [T, (next: T) => void] {
  const action = useActions();
  return [Object.hasOwn(action.stored, key) ? action.stored[key] as T : initial, next => action.store(key, next)];
}

export function useSessionScroll(key: string, { ready = true, visibleAt, preserveInitial = false }: {
  ready?: boolean; visibleAt?: string; preserveInitial?: boolean;
} = {}) {
  const { scrollPositions } = useActions();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pane = ref.current;
    if (!ready || !pane?.clientHeight) return;
    const saved = scrollPositions.get(key);
    if (saved || !preserveInitial) pane.scrollTo(saved ?? { top: 0, left: 0 });
  }, [key, ready, scrollPositions, visibleAt, preserveInitial]);
  return { ref, onScroll: ({ currentTarget }: UIEvent<HTMLDivElement>) => {
    if (ready && currentTarget.clientHeight) scrollPositions.set(key, { top: currentTarget.scrollTop, left: currentTarget.scrollLeft });
  } };
}

export function Logo() {
  return <span className="logo" aria-hidden="true"><HardHat size={21} strokeWidth={1.8} /></span>;
}

export function IconButton({ label, children, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} {...props}>{children}</Button>;
}

export function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="searchbox"><Search aria-hidden="true" /><Input type="search" aria-label={label} placeholder={label}
    value={value} onChange={event => onChange(event.target.value)} /></div>;
}

export function Empty({ title, description, action, icon = <FolderOpen /> }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return <DesignEmpty className="empty" image={<div className="empty-icon">{icon}</div>}
    description={<><strong>{title}</strong>{description && <p>{description}</p>}</>}>{action}</DesignEmpty>;
}

export function Loading() {
  return <div className="loading" role="status"><Spin size="small" />加载中</div>;
}

export function Failure({ error, retry }: { error: Error | null; retry?: () => void }) {
  return <Alert type="error" showIcon message={error?.message ?? '加载失败'}
    action={retry && <Button type="button" size="sm" variant="outline" onClick={retry}>重试</Button>} />;
}

export function FormError() {
  const { error } = useActions();
  return error && <Failure error={new Error(error)} />;
}

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const { busy, clearError, dialogTrigger } = useActions();
  useEffect(() => () => {
    const trigger = dialogTrigger.current;
    window.setTimeout(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }, [dialogTrigger]);
  const dismiss = () => { if (!busy) { clearError(); close(); } };
  return <DesignModal className="contractor-dialog" open title={<h2>{title}</h2>} onCancel={dismiss}
    afterClose={() => {
      if (dialogTrigger.current?.isConnected) dialogTrigger.current.focus({ preventScroll: true });
    }}
    getContainer="#app" width={620} footer={null} keyboard={!busy} closable={!busy} mask={{ closable: false }}>
    <div className="modal-body"><FormError />{children}</div>
  </DesignModal>;
}

export function Section({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return <Card id={id} className="section" size="small" title={<h2>{title}</h2>} extra={action}>{children}</Card>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Dot({ tone = 'neutral' }: { tone?: string }) { return <i className={'dot dot-' + tone} aria-hidden="true" />; }

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <Badge className={'pill pill-' + tone}><Dot tone={tone} />{children}</Badge>;
}

export function Source({ channel }: { channel: string }) {
  return <span className={'source-tag source-' + channel}>{sourceName(channel)}</span>;
}

export function sourceName(channel: string) {
  return ({ feishu: '飞书', 'feishu-doc': '飞书文档', github: 'GitHub', web: '工作台', figma: 'Figma', document: '外部文档',
    im: 'IM 会话', octop: 'IM 会话', wecom: '企业微信', weixin: '微信', dingtalk: '钉钉', qq: 'QQ', telegram: 'Telegram', discord: 'Discord' } as Record<string, string>)[channel] ?? channel;
}

const grantLabels = { requested: '待授权', granted: '已授权', revoked: '已撤回', expired: '已到期', 'source-unavailable': '访问失效 · 来源不可用' };

export function KnowledgeGrantStatus({ state, approvalState }: Pick<Ticket['requests'][number], 'state' | 'approvalState'>) {
  return <><Pill tone={state === 'granted' ? 'green' : state === 'requested' ? 'amber' : 'neutral'}>{grantLabels[state]}</Pill>
    {state === 'source-unavailable' && approvalState === 'granted' && <span className="muted-text">曾获授权</span>}</>;
}

export function Ext({ href, children, icon = true }: { href?: string; children: ReactNode; icon?: boolean }) {
  if (!href) return <span>{children}</span>;
  let destination;
  try { destination = new URL(href); } catch { return <span>{children}</span>; }
  if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password) return <span>{children}</span>;
  return <a className="external" href={destination.href} target="_blank" rel="noreferrer noopener">{children}{icon && <ArrowUpRight size={13} aria-hidden="true" />}</a>;
}

export const short = (sha?: string, length = 8) => sha?.slice(0, length) ?? '—';
export function date(value?: string, full = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', ...(full ? { year: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export function Version({ version }: { version?: number }) {
  return <Badge className="version-badge">第 {version ?? 1} 版</Badge>;
}

const recoveryLabels: Record<string, string> = {
  'receipt-pending': '回执待补写', 'old-execution-stop': '等待旧执行停止', access: '待授权', development: '待研发接单',
  answer: '等待答复', 'development-returned': '研发已退回', intake: '待确认子任务', 'child-result-missing': '子任务结果缺失',
  'child-results-pending': '等待子任务', acceptance: '待验收', 'source-changed': '资料访问已变化',
  'execution-disconnected': '执行端已断线', 'device-offline': '执行端离线', 'device-not-ready': '执行端暂不接单', 'execution-endpoint': '执行环境异常',
  'model-unavailable': '模型暂不可用', 'model-authorization': '模型授权已变化', quota: '额度受限',
  worktree: '代码工作区待核对', 'result-incomplete': '执行结果待补齐', 'execution-failed': '执行失败',
  'execution-cancelled': '执行已取消', 'authority-changed': '委托权限已变化', resuming: '正在接续',
  'ci-pending': '等待 CI', 'ci-failed': 'CI 未通过', 'deployment-pending': '等待部署', 'deployment-failed': '部署未通过',
  'stage-scope': '待确认范围依据', 'stage-verification': '待逐项核对',
};

export const recoveryLabel = (kind: string) => recoveryLabels[kind];

export function ticketStatus(ticket: Ticket | TicketRow): [string, string] {
  const { work, stage } = ticket;
  if (work.accepted) return ['已验收', 'green'];
  if (work.consultation && ticket.result) return ['咨询已回复', 'green'];
  if (ticket.endReason && ticket.endReason !== 'completed') return [ticket.endReason === 'stopped' ? '已停止' : '已结束', 'neutral'];
  const needsProductChecks = 'productChecksPending' in ticket ? ticket.productChecksPending : ticket.productVerification?.ready === false;
  const recovery = 'recoveryKind' in ticket ? ticket.recoveryKind : ticket.recovery?.kind;
  if (needsProductChecks && (!recovery || recovery === 'acceptance')) return ['待核对验收项', 'amber'];
  if (recovery && recoveryLabel(recovery)) return [recoveryLabel(recovery), 'amber'];
  if (work.handoff && !work.handoff.completedAt && !work.handoff.cancelledAt) return ['交接或恢复中', 'blue'];
  if (work.developmentResponse) return ['待重新安排', 'amber'];
  if (work.development && work.approvalRequired && !work.developmentApproval && stage.stage !== 'ended') return ['待研发接单', 'amber'];
  if (ticket.deliveryStatus && ticket.deliveryStatus.state !== 'ready') return ['待交付证据', 'amber'];
  if (ticket.result) return ['待验收', 'amber'];
  if ('waitingAccess' in ticket && ticket.waitingAccess) return ['等待资料授权', 'amber'];
  if ('materialHidden' in ticket && ticket.materialHidden) return ['资料受限', 'amber'];
  if (stage.stage === 'person') return [({ answer: '待答复', delivery: '待交付', review: '待核对', blocked: '暂时阻塞', failed: '执行失败' })[stage.action], 'amber'];
  const runState = 'runState' in ticket ? ticket.runState : ticket.currentRun?.state;
  if (stage.stage === 'working') return [stage.action === 'queued' || runState === 'queued' ? '排队中' : '执行中', 'blue'];
  if (stage.stage === 'ended') return ['已结束', 'neutral'];
  return ['等待中', 'neutral'];
}
export function TicketStatus({ ticket }: { ticket: Ticket | TicketRow }) {
  const [label, tone] = ticketStatus(ticket);
  return <Pill tone={tone}>{label}</Pill>;
}

export function topicName(project: Project, id?: string) { return project.topics.find(t => t.id === id)?.title; }

export function TopicOptions({ project, empty = '选择主题' }: { project: Project; empty?: string }) {
  return <><option value="">{empty}</option>{project.topics.map(t => <option key={t.id} value={t.id}>
    {t.parent ? (topicName(project, t.parent) ?? '') + ' / ' : ''}{t.title}
  </option>)}</>;
}

export function MaterialIcon() { return <span className="material-icon"><FileText size={17} /></span>; }
