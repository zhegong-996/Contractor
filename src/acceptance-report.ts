/**
 * 本机验收报告服务（替代 Acceptance 云端报告服务）。
 *
 * lobehub/acceptance 的 CLI 与云端报告服务刻意不启动 —— 业务材料不外发。
 * 这里用本仓库自己的适配层提供同等的「报告可读 / 可归档 / 可回放」能力：
 * - 把 result.json 渲染成中文 HTML 报告，只绑定 127.0.0.1 的本机服务提供；
 * - 报告索引列出所有已归档轮次；
 * - 打回原因沉淀为下次自查标准，落本机 `.runtime/v06/`，不进仓库。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AcceptanceReport } from './acceptance-interop.ts';
import { selfCheckStandards, type AcceptanceRound } from './acceptance-round.ts';

const escape = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface BundleSummary {
  taskId: string;
  entry: string;
  verdict: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  createdAt: string;
  dir: string;
  hasHtml: boolean;
}

export function listBundles(rootDir: string): BundleSummary[] {
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const dir = path.join(rootDir, entry.name);
      const file = path.join(dir, 'result.json');
      if (!existsSync(file)) return null;
      try {
        const report = JSON.parse(readFileSync(file, 'utf8')) as AcceptanceReport;
        return { taskId: entry.name, entry: report.entry,
          verdict: report.summary?.verdict ?? 'unknown', total: report.summary?.total ?? 0,
          passed: report.summary?.passed ?? 0, failed: report.summary?.failed ?? 0,
          blocked: report.summary?.blocked ?? 0, createdAt: report.createdAt,
          dir, hasHtml: existsSync(path.join(dir, 'report.html')) } as BundleSummary;
      } catch { return null; }
    })
    .filter((item): item is BundleSummary => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readBundle(rootDir: string, taskId: string): AcceptanceReport | null {
  const safe = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const file = path.join(rootDir, safe, 'result.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as AcceptanceReport;
}

const statusLabel = (status: string) =>
  ({ pass: '通过', fail: '未通过', blocked: '受阻', partial: '部分通过' } as Record<string, string>)[status] ?? status;

export function renderAcceptanceHtml(report: AcceptanceReport, meta: {
  taskId: string; standards?: string[]; limitations?: string[];
}): string {
  const cases = report.cases ?? [];
  const standards = meta.standards ?? [];
  const limitations = meta.limitations ?? [];
  const rows = cases.map(item => `<tr>
      <td>${escape(item.name)}</td>
      <td class="status-${escape(item.status)}">${escape(statusLabel(item.status))}</td>
      <td>${escape(item.observation)}</td>
      <td>${escape(item.surface)}</td>
      <td>${(item.evidence ?? []).map(e => `<code>${escape(e.path)}</code>`).join('<br>') || '—'}</td>
    </tr>`).join('');
  const planRows = (report.plan ?? []).map(item => `<tr>
      <td>${escape(item.title)}</td><td>${escape(item.method)}</td>
      <td>${escape(item.expected)}</td><td>${escape(item.verifier)}</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>逐项验收报告 · ${escape(meta.taskId)}</title>
<style>
:root{color-scheme:light}
body{margin:0;padding:32px;background:#f7f8fa;color:#1f2329;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1040px;margin:0 auto;background:#fff;border:1px solid #e5e6eb;border-radius:12px;padding:28px}
h1{font-size:22px;margin:0 0 6px}h2{font-size:16px;margin:28px 0 10px}
.meta{color:#646a73;font-size:13px}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}
.card{flex:1;min-width:120px;background:#f7f8fa;border-radius:8px;padding:12px 14px}
.card b{display:block;font-size:22px;line-height:1.2}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e5e6eb;vertical-align:top}
th{background:#f7f8fa;font-weight:600}code{font-size:12px;background:#f2f3f5;padding:2px 5px;border-radius:4px;word-break:break-all}
.status-pass{color:#0f7b4f;font-weight:600}.status-fail{color:#c9353f;font-weight:600}.status-blocked{color:#b7791f;font-weight:600}
.notice{background:#f0f6ff;border-left:3px solid #2b6cb0;padding:12px 14px;border-radius:6px;margin-top:24px}
ul{margin:8px 0;padding-left:20px}
</style></head><body><div class="wrap">
<h1>逐项验收报告</h1>
<p class="meta">任务 ${escape(meta.taskId)} · ${escape(report.entry)} · 生成于 ${escape(report.createdAt)} · 格式遵循 Apache-2.0 开源验收报告契约（本机映射）</p>
<div class="cards">
  <div class="card"><b>${report.summary.total}</b>检查项</div>
  <div class="card"><b class="status-pass">${report.summary.passed}</b>通过</div>
  <div class="card"><b class="status-fail">${report.summary.failed}</b>未通过</div>
  <div class="card"><b class="status-blocked">${report.summary.blocked}</b>受阻</div>
  <div class="card"><b>${escape(statusLabel(report.summary.verdict))}</b>结论</div>
</div>
<h2>开工前锁定的验收清单</h2>
<table><thead><tr><th>检查项</th><th>判定方式</th><th>期望</th><th>执行者</th></tr></thead><tbody>${planRows || '<tr><td colspan="4">无</td></tr>'}</tbody></table>
<h2>逐项判定与证据</h2>
<table><thead><tr><th>检查项</th><th>判定</th><th>观察</th><th>界面</th><th>证据文件</th></tr></thead><tbody>${rows || '<tr><td colspan="5">无</td></tr>'}</tbody></table>
<h2>下次自查标准（由打回原因沉淀）</h2>
${standards.length ? `<ul>${standards.map(s => `<li>${escape(s)}</li>`).join('')}</ul>` : '<p class="meta">本轮没有被打回的检查项，暂无新增自查标准。</p>'}
${limitations.length ? `<h2>判定限制</h2><ul>${limitations.map(s => `<li>${escape(s)}</li>`).join('')}</ul>` : ''}
<div class="notice"><b>边界</b>：本报告由独立评审者产出，只提供证据与逐项判定，<b>不代替原发起人在原会话「确认验收」</b>；未通过的检查项不会被算作通过；本机报告只监听 127.0.0.1，业务正文、密钥与截图不上传云端。</div>
</div></body></html>`;
}

export function writeReportHtml(dir: string, report: AcceptanceReport, meta: {
  taskId: string; standards?: string[]; limitations?: string[];
}): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'report.html');
  writeFileSync(file, renderAcceptanceHtml(report, meta), { mode: 0o600 });
  return file;
}

export function renderIndexHtml(summaries: BundleSummary[]): string {
  const rows = summaries.map(item => `<tr>
    <td><a href="/acceptance/${escape(item.taskId)}">${escape(item.taskId)}</a></td>
    <td>${escape(item.entry)}</td><td>${escape(statusLabel(item.verdict))}</td>
    <td>${item.passed}/${item.total}</td><td>${escape(item.createdAt)}</td>
    <td>${item.hasHtml ? '已生成' : '待生成'}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>本机验收报告索引</title>
<style>body{margin:0;padding:32px;background:#f7f8fa;color:#1f2329;font:14px/1.6 -apple-system,"PingFang SC",sans-serif}
.wrap{max-width:960px;margin:0 auto;background:#fff;border:1px solid #e5e6eb;border-radius:12px;padding:28px}
h1{font-size:20px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #e5e6eb}
th{background:#f7f8fa}a{color:#2b6cb0}.meta{color:#646a73}</style></head><body><div class="wrap">
<h1>本机验收报告索引</h1><p class="meta">只监听 127.0.0.1 的本机报告服务；不启动开源项目的云端报告服务，业务材料不外发。</p>
<table><thead><tr><th>任务</th><th>轮次</th><th>结论</th><th>通过/总数</th><th>生成时间</th><th>HTML 报告</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">暂无归档报告，先运行 npm run acceptance:export -- &lt;任务ID&gt;</td></tr>'}</tbody></table></div></body></html>`;
}

export interface SelfCheckRecord {
  schemaVersion: 1;
  updatedAt: string;
  standards: { text: string; taskId: string; round: number; at: string }[];
  note: string;
}

const SELF_CHECK_FILE = 'self-check-standards.json';

export function readSelfCheck(dir: string): SelfCheckRecord {
  const file = path.join(dir, SELF_CHECK_FILE);
  if (!existsSync(file)) return { schemaVersion: 1, updatedAt: '', standards: [],
    note: '打回原因沉淀为下次自查标准；不自动改写已锁定的验收清单。' };
  return JSON.parse(readFileSync(file, 'utf8')) as SelfCheckRecord;
}

/** 幂等累积：同一任务同一轮的同一条原因不会重复写入。 */
export function recordSelfCheck(dir: string, round: AcceptanceRound, taskId: string): SelfCheckRecord {
  const current = readSelfCheck(dir);
  const at = new Date().toISOString();
  const known = new Set(current.standards.map(item => item.text));
  for (const text of selfCheckStandards(round)) {
    if (known.has(text)) continue;
    current.standards.push({ text, taskId, round: round.round, at });
    known.add(text);
  }
  current.updatedAt = at;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, SELF_CHECK_FILE);
  writeFileSync(file + '.tmp', JSON.stringify(current, null, 2), { mode: 0o600 });
  renameSync(file + '.tmp', file);
  return current;
}
