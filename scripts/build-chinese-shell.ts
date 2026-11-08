import path from 'node:path';
import { createRequire } from 'node:module';
import { writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { root } from '../src/config.ts';
import { chineseShell } from '../src/shell-locale.ts';
import { domesticShell, domesticIndexHtml, RUNTIME_FILTER_SCRIPT, RUNTIME_FILTER_CSS,
  DOMESTIC_NAV_RULES } from '../src/shell-domestic.ts';
import i18nPack from '../locales/i18n-zh-CN.json' with { type: 'json' };

const ui = path.join(root, 'upstream/paperclip/ui'), require = createRequire(path.join(ui, 'package.json'));
const { build } = await import(require.resolve('vite'));
const hidden = new Set<string>();
const dist = path.join(ui, 'dist');

// i18next 标准多语言接入（构建期三处 transform，不改上游源码）：
// 1) DEFAULT_LOCALE 切 zh-CN（上游默认 en）；
// 2) 词条注入 en.json / zh-CN.json 两个语言包（英文原文作 key，
//    en 值 = 英文原文，zh-CN 值 = 中文），key 集合一致；
// 3) 校验循环在构建产物中 no-op（注入后其它语言包必然缺 key，
//    保留校验会让上游模块初始化直接 throw）。
// 上游 UI 目前没有组件调用 t()，词条经词典替换层兜底生效；这里把
// i18next 架构与数据标准先接上，上游未来任何 t() 调用自动中文。
const i18nTerms = (i18nPack as { translation: Record<string, string> }).translation;
const I18N_LOCALES_TS = /\/ui\/src\/i18n\/locales\.ts$/;
const I18N_EN_JSON = /\/ui\/src\/i18n\/locales\/en\.json$/;
const I18N_ZH_JSON = /\/ui\/src\/i18n\/locales\/zh-CN\.json$/;
function injectLocaleJson(code: string, translate: (english: string) => string): string {
  const original = JSON.parse(code) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...original };
  for (const [english, chinese] of Object.entries(i18nTerms)) merged[english] = translate(english) || chinese;
  return JSON.stringify(merged);
}
function i18nShell(code: string, id: string): string | null {
  const file = id.replaceAll('\\', '/');
  if (I18N_LOCALES_TS.test(file)) {
    let next = code.replace('export const DEFAULT_LOCALE = "en" as const;', 'export const DEFAULT_LOCALE = "zh-CN" as const;');
    next = next.replace('    assertValidLocaleMessages(messages);', '    void messages; // suitme: injected locale terms bypass strict en-parity validation');
    return next === code ? null : next;
  }
  if (I18N_EN_JSON.test(file)) return injectLocaleJson(code, english => english);
  if (I18N_ZH_JSON.test(file)) return injectLocaleJson(code, () => '');
  return null;
}

// 上游 serviceWorkerBuildIdPlugin 在 closeBundle 里就地改写 dist/sw.js 的占位符。
// 重复构建时若沿用上一次已 stamp 的文件，插件会因找不到占位符直接抛错，
// 因此每次构建前都从 public/sw.js 恢复原始副本，保证中文壳构建可重复执行。
const swSource = path.join(ui, 'public', 'sw.js'), swTarget = path.join(dist, 'sw.js');
if (existsSync(swSource)) { mkdirSync(dist, { recursive: true }); copyFileSync(swSource, swTarget); }

await build({ root: ui, configFile: path.join(ui, 'vite.config.ts'), plugins: [{
  name: 'suitme-china-domestic-shell', enforce: 'pre',
  transform(code: string, id: string) {
    const i18n = i18nShell(code, id);
    if (i18n !== null) return { code: i18n, map: null };
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
