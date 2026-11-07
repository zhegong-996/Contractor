// 「国内可用服务」：唯一能生成入口链接的地方。
// 红线：state === 'connected' 且 URL 通过 loopback 校验才渲染 <a>；未接通项没有 url 字段。
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, date, safeLoopbackUrl, type UI } from './foundation.js';

/** 与 src/service-status.ts 的服务端契约一致：未接通项不应带 url 字段。 */
interface ServiceEntry {
  id: string;
  name: string;
  category: 'local' | 'domestic' | 'overseas';
  state: 'connected' | 'degraded' | 'unavailable';
  detail: string;
  url?: string;
  setup?: string;
  source: string;
}
interface ServiceReport {
  checkedAt: string;
  connected: number;
  unavailable: number;
  services: ServiceEntry[];
}

export function DomesticServices({ ui }: { ui: UI }) {
  const [report, setReport] = useState<ServiceReport>(), [error, setError] = useState(''), [loading, setLoading] = useState(true), [stale, setStale] = useState(false);
  const reportRef = useRef<ServiceReport | undefined>(undefined);
  async function load(manual = false) {
    setLoading(true);
    try {
      const value = await ui.read('service-status', {});
      reportRef.current = value; setReport(value); setError(''); setStale(false);
    }
    catch (e: any) {
      // 自动轮询的瞬时失败不打扰用户：保留上一次结果，只在状态行标注可能不是最新。
      // 首次加载或用户手动刷新失败才给出明确提示。
      if (manual || !reportRef.current) setError(String(e?.message ?? e));
      else setStale(true);
    }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void load();
    // 服务是外部进程，随时可能启动或停止；页面可见时自动刷新，避免「启动了却要重载页面」。
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => clearInterval(timer);
  }, []);
  const groups: [ServiceEntry['category'], string][] = [['local', '本机服务'], ['domestic', '国内服务'], ['overseas', '海外服务']];
  const entries: ServiceEntry[] = report?.services ?? [];
  return <section className="sm-stack"><div className="sm-section-head"><h2>国内可用服务</h2><Badge>未接通不放入口</Badge>
    <Button icon="refresh" disabled={loading} onClick={() => void load(true)}>刷新状态</Button></div>
    <p className="sm-small sm-muted">每项状态由本机实时探测得出。只有探测成功且通过服务身份校验的条目才出现链接；未接通项给出状态、原因与可照做的接通步骤，不放任何点了没反应的空壳按钮。页面每 15 秒自动刷新，也可手动刷新。</p>
    {error && !report && <div className="sm-error" role="alert">状态探测失败：{error}<Button onClick={() => void load(true)}>重试</Button></div>}
    {error && report && <p className="sm-small sm-muted" role="status">刷新失败：{error}。下方仍是 {report.checkedAt ? date(report.checkedAt) : '上一次'} 的探测结果，一次刷新失败不会清空已有状态。</p>}
    {loading && !report && <p role="status" className="sm-small sm-muted">正在探测本机服务…</p>}
    {!loading && !report && !error && <p role="status" className="sm-small sm-muted">尚未取得服务状态，请点「刷新状态」重试。</p>}
    {report && <>
      <p className="sm-small sm-muted" role="status">最近探测：{report.checkedAt ? date(report.checkedAt) : '—'} · 已接通 {report.connected} 项 · 未接通 {report.unavailable} 项{loading ? ' · 正在刷新…' : ''}{stale ? ' · 自动刷新暂未成功，当前为上次结果' : ''}。状态来源逐项列在表内，监听器推断与实时探测已区分。</p>
      {groups.map(([key, title]) => {
        const rows = entries.filter(s => s.category === key);
        if (!rows.length) return null;
        return <div key={key}><h3>{title}</h3><div className="sm-table-scroll"><table className="sm-table">
          <thead><tr><th>服务</th><th>当前状态</th><th>入口 / 接通说明</th><th>状态来源</th></tr></thead><tbody>
          {rows.map((s: ServiceEntry) => {
            // 唯一能生成链接的地方：必须同时满足「已接通」与「loopback URL 校验通过」。
            const href = s.state === 'connected' ? safeLoopbackUrl(s.url) : null;
            return <tr key={s.id}><th>{s.name}</th>
              <td><Badge state={s.state === 'connected' ? 'confirmed' : s.state === 'degraded' ? 'pending' : undefined}>{s.state === 'connected' ? '已接通' : s.state === 'degraded' ? '部分可用' : '未接通'}</Badge> <span className="sm-small sm-muted">{s.detail}</span></td>
              <td>{href ? <a href={href} target="_blank" rel="noreferrer">打开</a> : <span className="sm-small sm-muted">{s.setup ?? (s.state === 'connected' ? '已接通，无需单独入口' : '暂不提供入口')}</span>}</td>
              <td className="sm-small sm-muted">{s.source}</td></tr>;
          })}
          </tbody></table></div></div>;
      })}
    </>}
    <p className="sm-small sm-muted">本机 Git 交付只固定确切提交、记录合并审批与通知，<strong>不等于业务验收</strong>；业务验收仍由原发起人在原会话「确认验收」。</p>
  </section>;
}
