// 协作工作台：把一次协作的委托链、角色、会签、护栏日志渲染成自包含 HTML（活文档）。
// 对标 lobehub 的「活文档」形态，但只做「可读快照」：数据内嵌、无外部请求、无写入动作。
import type { CollaborationOutcome } from './collaboration-runtime.ts';

const ROLE_STYLE: Record<string, string> = {
  coordinator: '#3080ff', worker: '#8d54ff', checker: '#00bb7f',
};

export function renderCollaborationWorkbench(outcome: CollaborationOutcome): string {
  const chain = outcome.chain.map(node => `
    <div class="node" style="--accent:${ROLE_STYLE[node.role] ?? '#3080ff'}">
      <div class="role">${node.role}</div>
      <div class="task">${escapeHtml(node.task)}</div>
      <div class="meta">深度 ${node.depth} · ${node.agentId ?? '未分配'}</div>
    </div>`).join('');

  const logs = outcome.logs.map(log => `
    <li><span class="stage">${escapeHtml(log.stage)}</span><span class="detail">${escapeHtml(log.detail)}</span></li>`).join('');

  const verdictPassed = /通过/.test(outcome.checkerVerdict) && !/打回|否决|分歧/.test(outcome.checkerVerdict);
  const verdictColor = verdictPassed ? '#00bb7f' : '#fb2c36';

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>协作工作台 · 只读快照</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f7f8fa; color: #0f172a;
         max-width: 880px; margin: 0 auto; padding: 28px 20px 48px; line-height: 1.6; }
  h1 { font-size: 20px; font-weight: 650; letter-spacing: -.3px; margin: 0 0 4px; }
  .sub { font-size: 12px; color: #64748b; margin-bottom: 20px; }
  h2 { font-size: 13px; font-weight: 600; margin: 28px 0 12px; color: #334155; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
  .chain { display: flex; flex-direction: column; gap: 10px; }
  .node { background: #fff; border: 1px solid #e2e8f0; border-left: 3px solid var(--accent); border-radius: 10px; padding: 12px 14px; }
  .role { font-family: "Paper Mono", ui-monospace, Menlo, monospace; font-size: 11px; font-weight: 600; letter-spacing: .5px; color: var(--accent); }
  .task { font-size: 14px; margin: 5px 0 2px; }
  .meta { font-size: 11px; color: #94a3b8; font-family: "Paper Mono", ui-monospace, monospace; }
  .verdict { padding: 14px 16px; border-radius: 10px; border: 1px solid ${verdictColor}; background: #fff; white-space: pre-wrap; font-size: 13px; color: ${verdictColor}; }
  ul.logs { list-style: none; padding: 0; margin: 0; } ul.logs li { font-size: 12px; padding: 6px 0; border-bottom: 1px solid #eef1f5; color: #475569; }
  .stage { font-family: "Paper Mono", ui-monospace, monospace; color: #64748b; margin-right: 10px; }
  .worker { white-space: pre-wrap; font-family: "Paper Mono", ui-monospace, Menlo, monospace; font-size: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; max-height: 320px; overflow: auto; color: #0f172a; }
  .note { font-size: 11px; color: #94a3b8; margin-top: 24px; }
</style></head><body>
<h1>协作工作台</h1>
<div class="sub">只读快照 · 数据内嵌 · 无外部请求</div>
<h2>委托链</h2><div class="chain">${chain}</div>
<h2>会签结果</h2><div class="verdict">${escapeHtml(outcome.checkerVerdict)}</div>
<h2>执行 Agent 产出</h2><div class="worker">${escapeHtml(outcome.workerOutput.slice(0, 4000))}</div>
<h2>护栏日志</h2><div class="card"><ul class="logs">${logs}</ul></div>
<p class="note">护栏（准入 / 委托 / 会签）全程参与。本页为协作过程的只读快照。</p>
</body></html>`;
}

function escapeHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
