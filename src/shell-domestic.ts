/**
 * 国内环境前端适配层（构建期 + 运行时两层，都不改上游源码）。
 *
 * 1) 构建期：移除 Paperclip 侧栏里 Skills / Connectors 两个国内用不到的入口；
 *    只做精确的文本级收敛，命中不到就如实报告，不猜、不 blanket 替换。
 * 2) 运行时：上游「连接服务」页里的应用名来自服务端数据，AST 改不到。
 *    注入一个同源脚本，只隐藏「未连接」的海外集成卡片/按钮；
 *    已连接的服务、业务内容与插件页面一律不动。
 *
 * 约定：**没有实际连接的服务不提供可点入口**，未接通项只在本项目
 * 自己的「国内可用服务」清单里以文字说明，不放空壳按钮或链接。
 */
export interface DomesticNavRule {
  id: string;
  file: RegExp;
  pattern: RegExp;
}

export const DOMESTIC_NAV_RULES: DomesticNavRule[] = [
  { id: 'sidebar-skills', file: /Sidebar\.production\.tsx/,
    pattern: /^[ \t]*<SidebarNavItem to="\/skills"[^>]*\/>[ \t]*\r?\n/m },
  { id: 'sidebar-connectors', file: /Sidebar\.production\.tsx/,
    pattern: /^[ \t]*\{showApps \? <SidebarNavItem to="\/apps"[^>]*\/> : null\}[ \t]*\r?\n/m },
  { id: 'coordinator-skills', file: /CoordinatorSidebar\.tsx/,
    pattern: /^[ \t]*\{ label: "Skills", to: "\/skills",[^}]*\},[ \t]*\r?\n/m },
  { id: 'coordinator-connectors', file: /CoordinatorSidebar\.tsx/,
    pattern: /^[ \t]*\{ label: "Connectors", to: "\/apps",[^}]*\},[ \t]*\r?\n/m },
];

export function domesticShell(source: string, file: string): { code: string; hidden: string[] } {
  let code = source;
  const hidden: string[] = [];
  for (const rule of DOMESTIC_NAV_RULES) {
    if (!rule.file.test(file.replaceAll('\\', '/'))) continue;
    const next = code.replace(rule.pattern, '');
    if (next !== code) { hidden.push(rule.id); code = next; }
  }
  return { code, hidden };
}

/** 同源外部脚本，避免 inline script 被 CSP 拦截。 */
export const RUNTIME_FILTER_SCRIPT = `(function(){
  'use strict';
  var OVERSEAS = /slack|github|linear|notion|vercel|stripe|zapier|discord|jira|google workspace|openai|anthropic|figma|asana|trello/i;
  var CONNECTING = /connect|connect your|add connection|set up|未连接|连接|接入/i;
  var CONNECTED = /\\bconnected\\b|已连接|已接通|manage|配置完成|disconnect/i;
  // 宿主侧栏链接带公司前缀（实测 /SUI/skills、/SUI/apps），不能只匹配 /skills 开头。
  var ROUTE = /^\\/(?:[A-Za-z0-9_-]+\\/)?(skills|apps)(\\/|$)/;
  var MAX_LABEL = 120, MAX_CARD = 400, MAX_HIDE = 600;
  function text(el){ return (el && (el.innerText || el.textContent) || '').trim(); }
  // 宿主外壳（#root / .contents 等）可能带 data-testid，且全文里同时含海外词与「连接」。
  // 绝不能把这种大容器当成「未连接卡片」隐藏，否则整个应用白屏。
  function protectedEl(el){
    if(!el || el === document.body || el === document.documentElement || el.id === 'root') return true;
    if(text(el).length > MAX_HIDE) return true;
    if(el.querySelector && (el.querySelector('.suitme-workbench') || el.querySelector('#root'))) return true;
    return false;
  }
  function hide(el, reason){ if(protectedEl(el) || el.dataset.suitmeHidden) return;
    el.dataset.suitmeHidden = reason; el.style.setProperty('display','none','important'); }
  function repair(){
    var hidden = document.querySelectorAll('[data-suitme-hidden]');
    for (var j=0;j<hidden.length;j++){ var e = hidden[j];
      if(protectedEl(e)){ delete e.dataset.suitmeHidden; e.style.removeProperty('display'); } }
  }
  function sweep(){
    repair();
    var nodes = document.querySelectorAll('a,button,[role="button"]');
    for (var i=0;i<nodes.length;i++){
      var el = nodes[i], label = text(el), href = el.getAttribute('href') || '';
      if (el.closest('.suitme-workbench')) continue;      // 本项目插件页面不处理
      if (ROUTE.test(href)) { hide(el,'overseas-route'); var li = el.closest('li'); if (li) hide(li,'overseas-route'); continue; }
      if (!label || label.length > MAX_LABEL || !OVERSEAS.test(label)) continue;
      if (CONNECTING.test(label) && !CONNECTED.test(label)) { hide(el,'unconnected-overseas'); continue; }
      var card = el.closest('[data-testid],[class*="card"],[class*="Card"]');
      var cardText = card ? text(card) : '';
      if (card && cardText.length <= MAX_CARD && !CONNECTED.test(cardText) && CONNECTING.test(cardText)) hide(card,'unconnected-overseas-card');
    }
  }
  sweep();
  new MutationObserver(sweep).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(sweep,1200);
})();`;

export function domesticIndexHtml(html: string): string {
  return html
    .replace('<html lang="en"', '<html lang="zh-CN"')
    .replace(/<title>[^<]*<\/title>/, '<title>SuitMe 协作台</title>')
    .replace('</head>', '<link rel="stylesheet" href="/suitme-domestic.css"><script src="/suitme-domestic.js" defer></script></head>');
}

export const RUNTIME_FILTER_CSS = '[data-suitme-hidden]{display:none!important}';
