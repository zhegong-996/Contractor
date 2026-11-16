import { createContext, useContext, useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { ArrowUpRight, CircleAlert, FileText, FolderOpen, LoaderCircle, Search, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from './paperclip/badge.tsx';
import { Button } from './paperclip/button.tsx';
import { Input } from './paperclip/input.tsx';
import { Tabs, TabsList, TabsTrigger } from './paperclip/tabs.tsx';
import type { Project, Ticket, TicketRow } from './api.ts';

type Actions = {
  busy: boolean; error: string;
  run: <T>(task: () => Promise<T>, notice?: string) => Promise<T | undefined>;
  clearError: () => void;
  stored: Record<string, unknown>;
  store: (key: string, value: unknown) => void;
};
export const ActionContext = createContext<Actions | null>(null);
export const useActions = () => useContext(ActionContext)!;
export function useStored<T>(key: string, initial: T): [T, (next: T) => void] {
  const action = useActions();
  return [Object.hasOwn(action.stored, key) ? action.stored[key] as T : initial, next => action.store(key, next)];
}

export function Logo() {
  return <span className="logo" aria-hidden="true"><i /><i /><i /></span>;
}

export function IconButton({ label, children, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} {...props}>{children}</Button>;
}

export function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="searchbox"><Search aria-hidden="true" /><Input type="search" aria-label={label} placeholder={label}
    value={value} onChange={event => onChange(event.target.value)} /></div>;
}

export function Empty({ title, description, action, icon = <FolderOpen /> }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><strong>{title}</strong>
    {description && <p>{description}</p>}{action}</div>;
}

export function Loading() {
  return <div className="loading" role="status"><LoaderCircle size={17} />加载中</div>;
}

export function Failure({ error, retry }: { error: Error | null; retry?: () => void }) {
  return <div className="alert" role="alert"><CircleAlert size={17} /><span>{error?.message ?? '加载失败'}</span>
    {retry && <Button type="button" size="sm" variant="outline" onClick={retry}>重试</Button>}</div>;
}

export function FormError() {
  const { error } = useActions();
  return error && <Failure error={new Error(error)} />;
}

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { busy, clearError } = useActions();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const dismiss = () => { if (!busy) { clearError(); close(); } };
  return <dialog className="modal" ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); dismiss(); }}>
    <header className="modal-header"><h2>{title}</h2><IconButton label="关闭" disabled={busy} onClick={dismiss}><X /></IconButton></header>
    <div className="modal-body"><FormError />{children}</div>
  </dialog>;
}

export function Section({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return <section id={id} className="section"><div className="section-heading"><h2>{title}</h2>{action}</div>{children}</section>;
}

export function Segments<T extends string>({ value, onChange, items, label }: { value: T; onChange: (value: T) => void; items: readonly (readonly [T, string])[]; label: string }) {
  return <Tabs value={value} onValueChange={value => onChange(value as T)}>
    <TabsList className="segments" aria-label={label}>{items.map(([id, name]) => <TabsTrigger key={id} value={id}>{name}</TabsTrigger>)}</TabsList>
  </Tabs>;
}

export function PageTabs<T extends string>({ value, onChange, items, label, children }: {
  value: T; onChange: (value: T) => void; items: readonly (readonly [T, string])[]; label: string; children: ReactNode;
}) {
  return <Tabs className="page-tabs" value={value} onValueChange={v => onChange(v as T)}>
    <TabsList variant="line" className="underline-tabs" aria-label={label}>{items.map(([id, name]) => <TabsTrigger key={id} value={id}>{name}</TabsTrigger>)}</TabsList>
    {children}
  </Tabs>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Avatar({ value, kind = 'person' }: { value: string; kind?: 'person' | 'agent' | 'project' }) {
  const initials = Array.from(value.trim()).slice(0, /[A-Za-z]/.test(value[0] ?? '') ? 2 : 1).join('').toUpperCase();
  return <span className={'avatar avatar-' + kind} aria-hidden="true">{initials || '·'}</span>;
}

export function Dot({ tone = 'neutral' }: { tone?: string }) { return <i className={'dot dot-' + tone} aria-hidden="true" />; }

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <Badge variant="outline" className={'pill pill-' + tone}><Dot tone={tone} />{children}</Badge>;
}

export function Source({ channel }: { channel: string }) {
  return <span className={'source-tag source-' + channel}>{sourceName(channel)}</span>;
}

export function sourceName(channel: string) {
  return ({ feishu: '飞书', 'feishu-doc': '飞书文档', github: 'GitHub', web: '工作台', figma: 'Figma', document: '外部文档' } as Record<string, string>)[channel] ?? channel;
}

export function Ext({ href, children, icon = true }: { href?: string; children: ReactNode; icon?: boolean }) {
  if (!href) return <span>{children}</span>;
  let destination;
  try { destination = new URL(href); } catch { return <span>{children}</span>; }
  if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password) return <span>{children}</span>;
  return <a className="external" href={destination.href} target="_blank" rel="noreferrer noopener">{children}{icon && <ArrowUpRight size={13} aria-hidden="true" />}</a>;
}

export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => <Ext href={href}>{children}</Ext>,
    img: ({ alt }) => alt ? <span>〔{alt}〕</span> : null,
  }}>{text}</ReactMarkdown></div>;
}

export const short = (sha?: string, length = 8) => sha?.slice(0, length) ?? '—';
export function date(value?: string, full = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', ...(full ? { year: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export function Version({ version }: { version?: number }) {
  return <Badge variant="outline" className="version-badge">第 {version ?? 1} 版</Badge>;
}

export function ticketStatus(ticket: Ticket | TicketRow): [string, string] {
  const { work, stage } = ticket;
  if (work.handoff && !work.handoff.completedAt && !work.handoff.cancelledAt) return ['交接或恢复中', 'blue'];
  if (work.developmentResponse) return ['待重新安排', 'amber'];
  if (work.accepted) return ['已验收', 'green'];
  if (work.development && work.approvalRequired && !work.developmentApproval && stage.stage !== 'ended') return ['待研发接单', 'amber'];
  if (work.consultation && ticket.result) return ['咨询已回复', 'green'];
  if ('deliveryStatus' in ticket && ticket.deliveryStatus && ticket.deliveryStatus.state !== 'ready') return ['待交付证据', 'amber'];
  if (ticket.result) return ['待验收', 'amber'];
  if ('waitingAccess' in ticket && ticket.waitingAccess) return ['等待资料授权', 'amber'];
  if ('materialHidden' in ticket && ticket.materialHidden) return ['资料受限', 'amber'];
  if (stage.stage === 'person') return [({ answer: '待答复', delivery: '待交付', review: '待核对', blocked: '暂时阻塞', failed: '执行失败' })[stage.action], 'amber'];
  if (stage.stage === 'working') return [stage.action === 'queued' ? '排队中' : '执行中', 'blue'];
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
