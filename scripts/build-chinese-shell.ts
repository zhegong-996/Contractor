import path from 'node:path';
import { createRequire } from 'node:module';
import { writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { root } from '../src/config.ts';
import { chineseShell } from '../src/shell-locale.ts';
import { domesticShell, domesticIndexHtml, RUNTIME_FILTER_SCRIPT, RUNTIME_FILTER_CSS,
  DOMESTIC_NAV_RULES } from '../src/shell-domestic.ts';

const ui = path.join(root, 'upstream/paperclip/ui'), require = createRequire(path.join(ui, 'package.json'));
const { build } = await import(require.resolve('vite'));
const hidden = new Set<string>();
const dist = path.join(ui, 'dist');

// 上游 serviceWorkerBuildIdPlugin 在 closeBundle 里就地改写 dist/sw.js 的占位符。
// 重复构建时若沿用上一次已 stamp 的文件，插件会因找不到占位符直接抛错，
// 因此每次构建前都从 public/sw.js 恢复原始副本，保证中文壳构建可重复执行。
const swSource = path.join(ui, 'public', 'sw.js'), swTarget = path.join(dist, 'sw.js');
if (existsSync(swSource)) { mkdirSync(dist, { recursive: true }); copyFileSync(swSource, swTarget); }

await build({ root: ui, configFile: path.join(ui, 'vite.config.ts'), plugins: [{
  name: 'suitme-china-domestic-shell', enforce: 'pre',
  transform(code: string, id: string) {
    // 先按原始英文结构收敛入口，再做中文文案替换；顺序反了会匹配不到 label。
    const adapted = domesticShell(code, id);
    for (const rule of adapted.hidden) hidden.add(rule);
    const translated = chineseShell(adapted.code, id);
    return translated === code ? null : { code: translated, map: null };
  },
  transformIndexHtml(html: string) { return domesticIndexHtml(html); },
  writeBundle() {
    // 同源外部资源：运行时过滤数据驱动的「未连接海外集成」卡片，避免 inline CSP 限制。
    writeFileSync(path.join(dist, 'suitme-domestic.js'), RUNTIME_FILTER_SCRIPT, { mode: 0o644 });
    writeFileSync(path.join(dist, 'suitme-domestic.css'), RUNTIME_FILTER_CSS, { mode: 0o644 });
  },
}] });

const missed = DOMESTIC_NAV_RULES.filter(rule => !hidden.has(rule.id)).map(rule => rule.id);
console.log(JSON.stringify({
  ok: true, hiddenEntries: [...hidden], missed,
  note: '中文壳 + 国内适配已写入 ui/dist；上游源码、API 状态值与业务内容未修改。',
  warning: missed.length ? '部分入口规则未命中，可能上游 UI 已改版，请检查 DOMESTIC_NAV_RULES' : null,
}, null, 2));
