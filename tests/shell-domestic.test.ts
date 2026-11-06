// 国内环境前端适配层：构建期收敛入口、运行时过滤未连接的海外集成，
// 以及「中文壳默认生效」的安装链路。全部只读源码断言 + 纯函数测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { domesticShell, domesticIndexHtml, RUNTIME_FILTER_SCRIPT, RUNTIME_FILTER_CSS,
  DOMESTIC_NAV_RULES } from '../src/shell-domestic.ts';
import { chineseShell } from '../src/shell-locale.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const sidebar = `export function S(){return <nav>
  <SidebarNavItem to="/routines" label="Routines" icon={Repeat} />
  <SidebarNavItem to="/skills" label="Skills" icon={Boxes} />
  {showApps ? <SidebarNavItem to="/apps" label="Connectors" icon={Unplug} /> : null}
  <SidebarNavItem to="/company/settings" label="Settings" icon={Settings} />
</nav>}`;
const coordinator = `const moreDestinations = [
  { label: "Search", to: "/search", icon: Search },
  { label: "Skills", to: "/skills", icon: Boxes },
  { label: "Connectors", to: "/apps", icon: Unplug },
  { label: "Settings", to: "/settings", icon: Settings },
] as const;`;

test('构建期收敛侧栏的 Skills / 连接服务入口，保留其余导航', () => {
  const classic = domesticShell(sidebar, '/repo/ui/src/components/Sidebar.production.tsx');
  assert.deepEqual(classic.hidden, ['sidebar-skills', 'sidebar-connectors']);
  assert.match(classic.code, /to="\/routines"/);
  assert.match(classic.code, /to="\/company\/settings"/);
  assert.doesNotMatch(classic.code, /to="\/skills"/);
  assert.doesNotMatch(classic.code, /to="\/apps"/);

  const coord = domesticShell(coordinator, '/repo/ui/src/components/CoordinatorSidebar.tsx');
  assert.deepEqual(coord.hidden, ['coordinator-skills', 'coordinator-connectors']);
  assert.match(coord.code, /label: "Search"/);
  assert.match(coord.code, /label: "Settings"/);
  assert.doesNotMatch(coord.code, /label: "Skills"/);
  assert.doesNotMatch(coord.code, /label: "Connectors"/);
  // 收敛后的代码仍是合法 TSX / TS，可被 Babel 解析。
  assert.doesNotThrow(() => chineseShell(classic.code, '/repo/ui/src/components/Sidebar.production.tsx'));
  assert.equal(DOMESTIC_NAV_RULES.length, 4);
});

test('只在本项目之外不改文件：非目标文件与页面内容原样返回', () => {
  const other = domesticShell(sidebar, '/repo/server/src/app.ts');
  assert.equal(other.code, sidebar);
  assert.deepEqual(other.hidden, []);
  const business = domesticShell('<span>连接 GitHub 仓库</span>', '/repo/ui/src/pages/Other.tsx');
  assert.equal(business.code, '<span>连接 GitHub 仓库</span>');
});

test('index.html 注入中文标题与同源运行时资源，不使用 inline 脚本', () => {
  const html = '<!DOCTYPE html><html lang="en"><head><title>Paperclip</title></head><body></body></html>';
  const adapted = domesticIndexHtml(html);
  assert.match(adapted, /<html lang="zh-CN"/);
  assert.match(adapted, /<title>SuitMe 协作台<\/title>/);
  assert.match(adapted, /<script src="\/suitme-domestic\.js" defer><\/script>/);
  assert.match(adapted, /suitme-domestic\.css/);
  assert.doesNotMatch(adapted, /<script>\(function/);
  assert.match(RUNTIME_FILTER_CSS, /\[data-suitme-hidden\]/);
});

test('运行时脚本只隐藏未连接的海外入口，不外发数据、不动插件页面', () => {
  assert.match(RUNTIME_FILTER_SCRIPT, /MutationObserver/);
  assert.match(RUNTIME_FILTER_SCRIPT, /dataset\.suitmeHidden/);
  assert.match(RUNTIME_FILTER_SCRIPT, /suitme-workbench/);
  assert.match(RUNTIME_FILTER_SCRIPT, /CONNECTED/);
  assert.match(RUNTIME_FILTER_SCRIPT, /overseas-route/);
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'https://', 'sendBeacon']) {
    assert.doesNotMatch(RUNTIME_FILTER_SCRIPT, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('中文壳构建顺序与安装/启动链路：先收敛再翻译，默认生效', () => {
  const build = read('scripts/build-chinese-shell.ts');
  assert.ok(build.indexOf('domesticShell(code, id)') < build.indexOf('chineseShell(adapted.code, id)'),
    '必须先按原始英文结构收敛入口，再翻译文案');
  assert.match(build, /writeBundle/);
  assert.match(build, /suitme-domestic\.js/);
  assert.match(read('scripts/install-upstream.ts'), /build-chinese-shell\.ts/);
  assert.match(read('scripts/up.ts'), /suitme-domestic\.js/);
  assert.match(read('locales/shell.zh-CN.json'), /"Integrations": "集成"/);
});

test('国内服务清单：只有真正接通才给入口，未接通项不放空壳链接', () => {
  const ui = read('plugins/knowledge-workspaces/src/ui/index.tsx');
  assert.match(ui, /国内可用服务/);
  assert.match(ui, /未接通不放入口/);
  assert.match(ui, /deliveryReady \? <a href=\{delivery\.url\}/);
  assert.match(ui, /运行 npm run delivery:serve 后才显示入口/);
  assert.match(ui, /尚未接通，不提供入口/);
  assert.doesNotMatch(ui, /<a[^>]*>企业微信<\/a>/);
  assert.doesNotMatch(ui, /<a[^>]*>腾讯文档<\/a>/);
  // 交付面板不再出现 GitHub 字样。
  assert.doesNotMatch(read('plugins/knowledge-workspaces/src/ui/development.tsx'), /GitHub/);
});
