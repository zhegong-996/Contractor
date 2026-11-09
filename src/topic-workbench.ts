/**
 * 主题工作台（活文档）：把主题现状渲染成一个自带联动参数的 HTML。
 *
 * 出处：千问办公的「活动执行工作台」——切人数预算实时联动、点一下顺延。
 * 我们这边能诚实落地的联动是「口径联动」：切状态 / 切负责人 / 切时间窗，
 * 计数和清单跟着变，而不是编一个假的人数滑块。
 *
 * 边界：只读。页面上没有任何写入动作，也不参与派单与验收判定。
 */
import type { Topic } from './topic.ts';

export interface WorkbenchState { state?: string; blockedReason?: string }

const escape = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface WorkbenchRow {
  taskId: string;
  roleId: string;
  ownerUserId: string;
  addedAt: string;
  state: string;
  blockedReason: string;
}

export function workbenchRows(topic: Topic, states: Record<string, WorkbenchState> = {}): WorkbenchRow[] {
  return topic.tasks.map(task => ({
    taskId: task.taskId,
    roleId: task.roleId,
    ownerUserId: task.ownerUserId,
    addedAt: task.addedAt,
    state: String(states[task.taskId]?.state ?? 'unknown'),
    blockedReason: String(states[task.taskId]?.blockedReason ?? ''),
  }));
}

/**
 * 生成自包含 HTML：数据内嵌、无外部请求、无 CDN。
 * 联动全部在浏览器里算，所以「打开就能用」，不依赖服务在线。
 */
export function renderTopicWorkbench(topic: Topic, options: {
  states?: Record<string, WorkbenchState>; generatedAt?: string;
} = {}): string {
  const rows = workbenchRows(topic, options.states ?? {});
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const payload = JSON.stringify({ rows, channels: topic.channels,
    title: topic.title, goal: topic.goal, owner: topic.ownerUserId }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(topic.title)} · 主题工作台</title>
<style>
  :root { --line:#e3e6ea; --ink:#1c2229; --dim:#6b7683; --bg:#fbfcfd; --card:#fff; --accent:#1a6dd6; --warn:#b4441f; }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--ink);
    font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; }
  h1 { font-size:19px; margin:0 0 4px; }
  .goal { color:var(--dim); margin:0 0 18px; }
  .bar { display:flex; flex-wrap:wrap; gap:12px; align-items:center; padding:12px 14px;
    background:var(--card); border:1px solid var(--line); border-radius:10px; margin-bottom:16px; }
  .bar label { display:flex; gap:6px; align-items:center; color:var(--dim); font-size:13px; }
  select, input[type=checkbox] { font:inherit; }
  select { padding:4px 8px; border:1px solid var(--line); border-radius:6px; background:#fff; color:var(--ink); }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin-bottom:16px; }
  .card { padding:12px 14px; background:var(--card); border:1px solid var(--line); border-radius:10px; }
  .card b { display:block; font-size:22px; line-height:1.2; }
  .card span { color:var(--dim); font-size:12px; }
  table { width:100%; border-collapse:collapse; background:var(--card);
    border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); font-size:13px; }
  th { background:#f4f6f8; color:var(--dim); font-weight:600; }
  tr:last-child td { border-bottom:none; }
  .st { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  .blocked { color:var(--warn); }
  .empty { padding:28px; text-align:center; color:var(--dim); background:var(--card);
    border:1px dashed var(--line); border-radius:10px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0 0; }
  .chip { padding:5px 10px; background:var(--card); border:1px solid var(--line);
    border-radius:999px; font-size:12px; color:var(--dim); }
  footer { margin-top:18px; color:var(--dim); font-size:12px; }
</style>
</head>
<body>
<h1>${escape(topic.title)}</h1>
<p class="goal">目标：${escape(topic.goal)}｜负责人：${escape(topic.ownerUserId)}｜生成于 ${escape(generatedAt)}</p>

<div class="bar">
  <label>状态 <select id="f-state">
    <option value="">全部</option><option value="blocked">卡点</option>
    <option value="running">进行中</option><option value="accepted">已完成</option>
    <option value="unknown">状态未知</option>
  </select></label>
  <label>负责人 <select id="f-owner"><option value="">全部</option></select></label>
  <label>加入时间 <select id="f-window">
    <option value="">全部</option><option value="1">今天</option>
    <option value="7">近 7 天</option><option value="30">近 30 天</option>
  </select></label>
  <label><input type="checkbox" id="f-blocked"> 只看卡点</label>
</div>

<div class="cards">
  <div class="card"><b id="c-total">0</b><span>任务（当前口径）</span></div>
  <div class="card"><b id="c-blocked">0</b><span>卡点</span></div>
  <div class="card"><b id="c-owners">0</b><span>负责人</span></div>
  <div class="card"><b id="c-channels">${topic.channels.length}</b><span>协作入口</span></div>
</div>

<div id="table"></div>

<div class="chips" id="chips"></div>

<footer>只读工作台：切换条件只影响本页显示，不改任务状态、不参与派单与验收判定；数据快照于生成时刻。</footer>

<script id="data" type="application/json">${payload}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent);
  var rows = data.rows || [];
  var $ = function (id) { return document.getElementById(id); };

  var owners = Array.from(new Set(rows.map(function (r) { return r.ownerUserId; }))).sort();
  owners.forEach(function (owner) {
    var option = document.createElement('option');
    option.value = owner; option.textContent = owner;
    $('f-owner').appendChild(option);
  });

  function inWindow(row) {
    var days = $('f-window').value;
    if (!days) return true;
    var at = Date.parse(row.addedAt);
    if (!isFinite(at)) return true;
    var limit = Number(days) * 86400000;
    return Date.now() - at <= limit;
  }

  function matches(row) {
    var state = $('f-state').value;
    if (state && row.state !== state) return false;
    var owner = $('f-owner').value;
    if (owner && row.ownerUserId !== owner) return false;
    if ($('f-blocked').checked && !row.blockedReason) return false;
    return inWindow(row);
  }

  function render() {
    var shown = rows.filter(matches);
    $('c-total').textContent = String(shown.length);
    $('c-blocked').textContent = String(shown.filter(function (r) { return r.state === 'blocked'; }).length);
    $('c-owners').textContent = String(new Set(shown.map(function (r) { return r.ownerUserId; })).size);

    if (!shown.length) {
      $('table').innerHTML = '<div class="empty">当前条件下没有任务。换个口径看看。</div>';
      return;
    }
    var head = '<table><thead><tr><th>任务</th><th>主职能</th><th>负责人</th><th>状态</th><th>加入时间</th><th>卡点</th></tr></thead><tbody>';
    var body = shown.map(function (r) {
      return '<tr><td class="st">' + esc(r.taskId) + '</td><td>' + esc(r.roleId) + '</td>'
        + '<td>' + esc(r.ownerUserId) + '</td><td class="st">' + esc(r.state) + '</td>'
        + '<td class="st">' + esc(r.addedAt) + '</td>'
        + '<td class="blocked">' + esc(r.blockedReason || '') + '</td></tr>';
    }).join('');
    $('table').innerHTML = head + body + '</tbody></table>';
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var chips = data.channels || [];
  $('chips').innerHTML = chips.length
    ? chips.map(function (c) {
      return '<a class="chip" href="#" data-ref="' + esc(c.ref) + '">[' + esc(c.kind) + '] ' + esc(c.ref)
        + ' · ' + esc(c.ownerUserId) + '</a>';
    }).join('')
    : '<span class="chip">还没有协作入口</span>';

  ['f-state', 'f-owner', 'f-window'].forEach(function (id) { $(id).addEventListener('change', render); });
  $('f-blocked').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`;
}
