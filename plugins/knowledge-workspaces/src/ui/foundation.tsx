// 前端基础设施层：展示原语、中文文案字典、跨视图草稿状态与 UI 契约。
// 所有业务视图只从这里取 Button / Badge / Details / useDraft / UI，避免各自复制导致行为漂移。
import { useState, type ButtonHTMLAttributes, type DetailsHTMLAttributes, type Dispatch, type SetStateAction } from 'react';
import { useHostNavigation, MarkdownBlock, type PluginSidebarProps } from '@paperclipai/plugin-sdk/ui';

export const labels: Record<string, string> = { pending: '待授权', approved: '已授权', denied: '已拒绝', revoked: '已撤权', revoking: '撤权中', expired: '已过期',
  ready: '待推进', waiting: '待审阅', running: '执行中', handoff_pending: '正在恢复交接', access_blocked: '等待授权', unknown: '待核对执行', accepted: '已完成',
  candidate: '待审阅', confirmed: '已确认', withdrawn: '已撤回', queued: '等待执行', completed: '已整理', failed: '整理失败', idle: '待委托', stale: '上下文已更新',
  cancelled: '已停止', cancelling: '正在停止', unavailable: '待恢复连接', scope_changed: '需核对新职责', source: '来源证据' };

export const events: Record<string, string> = { 'task-created': '创建协作任务', 'access-requested': '申请资料访问', 'access-approved': '负责人批准访问', 'access-denied': '拒绝访问申请',
  'access-revoked': '结束资料授权', 'access-expired': '资料授权到期', checkpoint: '保存工作检查点', handoff: '完成任务交接', 'handoff-started': '开始任务交接',
  'handoff-assigned': '更新执行身份', 'knowledge-proposed': '准备知识候选', 'knowledge-confirmed': '确认知识版本', 'knowledge-withdrawn': '撤回知识结论',
  'knowledge-published': '采用到专业空间', completed: '验收完成，结束临时授权', 'execution-stop-confirmed': '核对原执行已停止', 'contract-migrated': '升级协作记录',
  'assistant-delegated': '委托 Agent 准备工作', 'assistant-paused': '暂停 Agent 自动准备', 'assistant-queued': 'Agent 已接单', 'assistant-prepared': 'Agent 已提交整理结果',
  'assistant-configuration-repaired': '恢复 Agent 运行配置', 'im-enabled': '启用飞书接续', 'im-resumed': '飞书接续任务',
  'context-note': '补充任务背景', 'context-expanded': '扩展已授权来源', 'context-linked': '关联研发交付',
  'context-included': '引用资料', 'context-excluded': '移出资料', 'context-discovered': '找到相关知识' };

export const retained = new Map<string, unknown>();
export function useDraft<T,>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [stored, update] = useState(() => ({ key, value: retained.has(key) ? retained.get(key) as T : initial }));
  const value = stored.key === key ? stored.value : retained.has(key) ? retained.get(key) as T : initial;
  const set: Dispatch<SetStateAction<T>> = next => { const previous = retained.has(key) ? retained.get(key) as T : value;
    const v = typeof next === 'function' ? (next as (v: T) => T)(previous) : next; retained.set(key, v); update({ key, value: v }); };
  return [value, set];
}

export function Details({ remember, ...props }: DetailsHTMLAttributes<HTMLDetailsElement> & { remember: string }) {
  const [open, setOpen] = useDraft(remember, false); return <details {...props} className={'sm-details ' + (props.className ?? '')} open={open} onToggle={e => setOpen(e.currentTarget.open)} />;
}

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { work: 'M8 4h8v4H8z M4 9h16v11H4z M9 14l2 2 4-4', task: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5',
    book: 'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3z M12 6v16', shield: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z M8 12l3 3 5-6',
    arrow: 'M4 12h16 M14 6l6 6-6 6', plus: 'M12 4v16 M4 12h16', refresh: 'M20 7v5h-5 M20 12a8 8 0 1 0-2 6',
    bot: 'M5 8h14v12H5z M12 3v5 M9 13v2 M15 13v2 M9 18h6 M2 12v5 M22 12v5', check: 'M5 12l4 4L19 6', link: 'M9 15l6-6 M8 17l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 5 0 M13 7l2-2a4 4 0 0 1 6 5l-5 5a4 4 0 0 1-5 0' };
  return <svg className="sm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.task} /></svg>;
}

export function Button({ variant, icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet'; icon?: string }) {
  return <button {...props} className={'sm-button ' + (props.className ?? '')} data-variant={variant}>{icon && <Icon name={icon} />}{children}</button>;
}

export function Badge({ state, children }: { state?: string; children?: any }) { return <span className="sm-badge" data-tone={state === 'accepted' || state === 'confirmed' ? 'success' : ['pending', 'candidate'].includes(state ?? '') ? 'attention' : state === 'failed' ? 'error' : undefined}>{children ?? labels[state ?? ''] ?? state}</span>; }

export const date = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
export const isLive = (r: any) => r.state === 'approved' && Date.parse(r.expiresAt) > Date.now();

/** 普通外链只放行 http/https，挡掉 javascript: 等可执行协议。 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; }
  catch { return null; }
}

/** 只放行本机 loopback 的 http 链接；服务端 service-status 使用同一套规则。 */
export function safeLoopbackUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

export type UI = { data: any; busy: boolean; prefix: string; nav: ReturnType<typeof useHostNavigation>; invoke: (name: string, payload: any) => Promise<any>;
  read: (name: string, payload: any) => Promise<any>;
  /** 写操作失败时统一上报到页面错误条，禁止各视图静默吞掉异常。 */
  report: (message: string) => void;
  run: (name: string, payload: any) => void; openTask: (id: string, panel?: string) => void; useSource: (id: string) => void;openMemory:(id:string)=>void };

export function actor(ui: UI, key: string) { return ui.data.actors.find((a: any) => a.key === key)?.name ?? key; }
export function source(ui: UI, id: string) { return ui.data.sources.find((s: any) => s.id === id); }
export function sourceName(ui: UI, id: string) { return source(ui, id)?.title ?? '受限资料'; }

export function RecordBody({ record, body }: { record?: any; body?: string }) {
  return <div className="sm-document">{record && <><p className="sm-muted sm-small">{record.appliesTo}</p><dl>{Object.entries(record.facts ?? {}).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{typeof v === 'boolean' ? v ? '是' : '否' : String(v)}</dd></div>)}</dl></>}
    <MarkdownBlock content={record?.body ?? body ?? ''} />{record?.sources?.length > 0 && <ul className="sm-source-links">{record.sources.map((url: string, i: number) => <li key={url}>{safeHttpUrl(url) ? <a href={safeHttpUrl(url)!} target="_blank" rel="noreferrer">来源 {i + 1}</a> : <span className="sm-small sm-muted">来源 {i + 1}（链接不可用）</span>}</li>)}</ul>}</div>;
}

export const contentKinds: Record<string, string> = { reference: '资料与参考', decision: '决策', procedure: '流程与规范', experiment: '实验与结论', feedback: '反馈与经验' };

export function WorkspaceSidebar(_props: PluginSidebarProps) { const nav = useHostNavigation(); return <a {...nav.linkProps('/knowledge-workspaces')} className="flex items-center px-3 py-2 text-sm">协作台</a>; }

/** 表单提交失败时就地提示；不再只依赖页面顶部的全局错误条。 */
export function ActionError({ error }: { error: string }) {
  return error ? <p className="sm-error" role="alert">操作未完成：{error}</p> : null;
}
