import path from 'node:path';
import { createRequire } from 'node:module';
import { root } from '../src/config.ts';
import { chineseShell } from '../src/shell-locale.ts';
const ui = path.join(root, 'upstream/paperclip/ui'), require = createRequire(path.join(ui, 'package.json'));
const { build } = await import(require.resolve('vite'));
await build({ root: ui, configFile: path.join(ui, 'vite.config.ts'), plugins: [{ name: 'suitme-chinese-display-copy', enforce: 'pre',
  transform(code: string, id: string) { const translated = chineseShell(code, id); return translated === code ? null : { code: translated, map: null }; },
  transformIndexHtml(html: string) { return html.replace('<html lang="en"', '<html lang="zh-CN"'); },
}] });
console.log('中文界面构建完成；上游源码、API 状态值和业务内容未修改。');
