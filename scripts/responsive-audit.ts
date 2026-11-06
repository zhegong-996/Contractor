// P3 narrow-screen walkthrough. Renders the REAL plugin stylesheet plus
// representative v0.6 panel markup in headless Chrome at 1280 and 425, then
// measures page-level horizontal overflow and touch-target sizes.
//
// Chrome headless enforces a 500px minimum window, so the target width is
// applied with a fixed-size iframe (srcdoc). Media queries inside the iframe
// respond to that exact width. This is a layout walkthrough, not a live
// Paperclip host walkthrough: no host process, no real business data.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { styles } from '../plugins/knowledge-workspaces/src/ui/styles.ts';
import { root, runtime } from '../src/config.ts';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) throw new Error('本机未找到 Google Chrome，无法做浏览器窄屏走查');

const long = 'L2:8f3a2c1d9b0e:source-fragment:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0';
const json = '{"schemaVersion":1,"sourceId":"source-42","revision":"rev-7","evidenceRefs":[{"sourceId":"source-42","revision":"rev-7","excerpt":"报价 3.0 由负责人李工确认"}]}';

const panel = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--foreground:#111827;--muted:#f3f4f6;--muted-foreground:#6b7280;--border:#e5e7eb;--background:#fff;--primary:#2563eb;--primary-foreground:#fff;--destructive:#dc2626}
html,body{margin:0;padding:0}body{background:#fff;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style>
<style>${styles}</style></head><body><div class="suitme-workbench"><main class="sm-v06 sm-stack">
<section class="sm-stack"><div class="sm-section-head"><h2>关系与状态</h2><button class="sm-button" data-variant="quiet">刷新</button></div>
<p class="sm-small sm-muted">空间：全部。关系本身带状态与有效期；只有已验收的关系能被 Agent 当作依据。</p>
<nav class="sm-task-stage" aria-label="子视图"><button aria-pressed="true">验收</button><button>责任</button><button>过程流水</button></nav>
<section class="sm-section sm-stack"><div class="sm-section-head"><h3>L2 组织图关系</h3><span class="sm-muted sm-small">产品层记录</span></div>
<div class="sm-table-scroll"><table class="sm-table"><thead><tr><th>关系</th><th>起点 → 终点</th><th>状态</th><th>生效 / 失效</th><th>证据</th><th>操作</th></tr></thead><tbody>
<tr><th>verified_by</th><td>${long} → ${long}</td><td>草稿</td><td>2026/11/6 08:00 / 仍有效</td><td>1 条</td>
<td><div class="sm-actions"><button class="sm-button" data-variant="quiet">验收</button><button class="sm-button" data-variant="quiet">可复用</button><button class="sm-button" data-variant="quiet">失效</button></div></td></tr>
<tr><th>responsible_for</th><td>${long}</td><td>已验收</td><td>2026/11/6 08:00 / 仍有效</td><td>2 条</td><td><div class="sm-actions"><button class="sm-button">查看</button></div></td></tr>
</tbody></table></div>
<dl class="sm-document"><div><dt>最近一次抽取</dt><dd>${json}</dd></div><div><dt>隔离键</dt><dd>${long}</dd></div></dl>
<div class="sm-notice"><p class="sm-small">结构式视觉评审：核对截图/录屏的来源、哈希、证据类型与事件可回放性，不判断图像内容是否符合标准。${long}</p></div>
<details class="sm-details" open><summary>组织状态信号 <span class="sm-muted sm-small">· 已读取</span></summary><dl class="sm-document"><div><dt>信号</dt><dd>${json}</dd></div></dl></details>
<div class="sm-empty"><strong>暂无关系</strong>协作过程中的决策、证据与责任会在这里留下带状态的边。</div>
<label class="sm-field">按任务查看<select class="sm-input"><option>SUI-1000 · 报价方案</option></select></label>
</section></section></main></div>
<pre id="audit" style="position:fixed;left:-9999px"></pre>
<script>
(function(){
  var doc=document.documentElement,vw=doc.clientWidth,offenders=[];
  function clipped(el){var p=el.parentElement;while(p&&p!==document.body){var ov=getComputedStyle(p).overflowX;
    if(ov==='auto'||ov==='scroll'||ov==='hidden')return true;p=p.parentElement;}return false;}
  document.querySelectorAll('.suitme-workbench *').forEach(function(el){
    var r=el.getBoundingClientRect();
    // Descendants of a horizontally scrollable wrapper are clipped by design;
    // only elements that can cause PAGE-level overflow are offenders.
    if(r.right>vw+1&&!clipped(el))offenders.push({tag:el.tagName.toLowerCase(),cls:String(el.className).slice(0,60),right:Math.round(r.right)});
  });
  var heights=[].slice.call(document.querySelectorAll('.sm-v06 button')).map(function(b){return Math.round(b.getBoundingClientRect().height)});
  var result={innerWidth:window.innerWidth,clientWidth:vw,scrollWidth:doc.scrollWidth,bodyScrollWidth:document.body.scrollWidth,
    offenders:offenders.slice(0,8),offenderCount:offenders.length,
    minButtonHeight:Math.min.apply(null,heights),buttons:heights.length,
    tableScrollable:[].slice.call(document.querySelectorAll('.sm-table-scroll')).every(function(w){return getComputedStyle(w).overflowX==='auto'})};
  document.getElementById('audit').textContent=btoa(JSON.stringify(result));
})();
</script></body></html>`;

mkdirSync(runtime(), { recursive: true, mode: 0o700 });
const panelFile = runtime('responsive-panel.html');
writeFileSync(panelFile, panel, { mode: 0o600 });

function outer(width: number): string {
  const b64 = Buffer.from(panel, 'utf8').toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<iframe id="frame" style="width:${width}px;height:900px;border:0;display:block"></iframe>
<pre id="audit" style="position:fixed;left:-9999px"></pre>
<script>
document.getElementById('frame').addEventListener('load',function(){
  try{
    var inside=this.contentDocument.getElementById('audit').textContent;
    document.getElementById('audit').textContent=inside;
  }catch(e){document.getElementById('audit').textContent=btoa(JSON.stringify({error:String(e)}));}
});
var bytes=Uint8Array.from(atob('${b64}'),function(c){return c.charCodeAt(0)});
document.getElementById('frame').srcdoc=new TextDecoder().decode(bytes);
</script></body></html>`;
}

function measure(width: number): Record<string, unknown> {
  const harness = runtime(`responsive-harness-${width}.html`);
  writeFileSync(harness, outer(width), { mode: 0o600 });
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    '--disable-extensions', '--force-device-scale-factor=1', `--window-size=${width},900`,
    '--virtual-time-budget=3000', '--dump-dom', `file://${harness}`];
  const run = spawnSync(chrome, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
  if (run.error || run.status !== 0) throw new Error(`Chrome 走查失败：${String(run.error ?? run.stderr).slice(0, 300)}`);
  const match = /<pre id="audit"[^>]*>([A-Za-z0-9+/=]+)<\/pre>/.exec(run.stdout ?? '');
  if (!match) throw new Error('Chrome 未返回布局测量结果');
  const value = JSON.parse(Buffer.from(match[1]!, 'base64').toString('utf8')) as Record<string, unknown>;
  if (value.error) throw new Error(`iframe 测量失败：${value.error}`);
  return { requestedWidth: width, ...value };
}

const results = [1280, 425].map(width => measure(width));
const problems: string[] = [];
for (const r of results) {
  const width = Number(r.requestedWidth), scroll = Number(r.scrollWidth), client = Number(r.clientWidth);
  if (width === 425 && Math.abs(client - 425) > 20) problems.push(`425px: 实际视口 ${client}px，走查宽度不可信`);
  if (scroll > client + 1) problems.push(`${width}px: 页面横向溢出 ${scroll - client}px`);
  if (Number(r.offenderCount) > 0) problems.push(`${width}px: ${r.offenderCount} 个元素越过视口右边界`);
  if (width === 425 && Number(r.minButtonHeight) < 44) problems.push(`425px: 按钮最小高度 ${r.minButtonHeight}px < 44px`);
  if (r.tableScrollable !== true) problems.push(`${width}px: 表格未在自身容器内滚动`);
}
const output = { at: new Date().toISOString(), engine: 'Google Chrome headless (new), iframe viewport',
  widths: results.map(r => r.requestedWidth), results, problems, harness: path.relative(root, panelFile) };
writeFileSync(runtime('responsive-audit.json'), JSON.stringify(output, null, 2), { mode: 0o600 });
console.log(JSON.stringify(output, null, 2));
if (problems.length) { console.error('窄屏走查未通过：' + problems.join('；')); process.exitCode = 1; }
