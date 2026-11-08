// 图册静态自检：确保 docs/architecture-atlas.html 自足、可离线打开、主题变量齐全。
// 只读：不启动服务、不写运行日志；报告落 .runtime/atlas-check.json。
// 用法：npm run atlas:check
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const htmlPath = path.join(root, 'docs/architecture-atlas.html');
const mdPath = path.join(root, 'docs/ARCHITECTURE-ATLAS.md');
const checks = [];
const check = (name, ok, detail = {}) => checks.push({ name, ok: Boolean(ok), detail });

check('图册 HTML 与 Markdown 索引都存在', existsSync(htmlPath) && existsSync(mdPath));
const html = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '';
const md = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : '';

const svgs = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(m => m[0]);
check('恰好四张 SVG 图', svgs.length === 4, { found: svgs.length });
check('每张 SVG 都有 role / title / desc 可访问性标签',
  svgs.length === 4 && svgs.every(svg => /role="img"/.test(svg)
    && /<title>[\s\S]+?<\/title>/.test(svg) && /<desc>[\s\S]+?<\/desc>/.test(svg)));
check('每张 SVG 的 viewBox 宽度固定为 680',
  svgs.every(svg => /viewBox="0 0 680 \d+"/.test(svg)));

const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) ?? [])[1] ?? '';
const defined = new Set([...styleBlock.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const used = new Set([...html.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]));
const missingVars = [...used].filter(name => !defined.has(name)).sort();
check('SVG 与页面用到的 CSS 变量全部有定义（含深色主题覆盖）',
  missingVars.length === 0 && /prefers-color-scheme:\s*dark/.test(styleBlock),
  { defined: defined.size, used: used.size, missing: missingVars });

const external = /(?:src|href)\s*=\s*["']https?:\/\/|@import\s|<script\b|url\(\s*["']?https?:\/\//i.test(html);
check('自足离线：无外部脚本 / 样式 / 字体 / 图片依赖', !external,
  { note: 'xmlns 命名空间是标识，不是网络请求' });

const sensitive = /ou_[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]{12,}|password\s*[:=]\s*["'][^"']+["']/i.test(html + md);
check('无真实身份、令牌或凭据值', !sensitive);
check('不含 .runtime 运行证据入库路径作为资源引用',
  !/(?:src|href)\s*=\s*["'][^"']*\.runtime\//.test(html));

const keywords = ['飞书 IM', '唯一发起入口', '人签验收', 'Agent 完成 ≠ 业务验收',
  'append-only', '只读守门', 'SUI-129', '4190', '18 项只读白名单', 'modelCalls=0'];
const missingKeywords = keywords.filter(word => !html.includes(word));
check('关键口径齐备（唯一入口 / 人签 / 事实源 / 停机端口 / 确定性链路）',
  missingKeywords.length === 0, { missing: missingKeywords });

const ids = [...html.matchAll(/<section id="([^"]+)"/g)].map(m => m[1]);
const anchors = [...html.matchAll(/<nav[\s\S]*?<\/nav>/g)]
  .flatMap(block => [...block[0].matchAll(/href="#([^"]+)"/g)].map(m => m[1]));
check('导航锚点与七个章节一一对应', ids.length === 7 && anchors.every(a => ids.includes(a)),
  { sections: ids, anchors });

check('Markdown 索引指向图册且含 Mermaid 总览',
  md.includes('docs/architecture-atlas.html') && /```mermaid[\s\S]*?```/.test(md)
    && md.includes('冲突时优先级'));

const failed = checks.filter(c => !c.ok).map(c => c.name);
const report = { ok: failed.length === 0, checks: checks.length, failed, details: checks,
  note: '只读静态自检；不启动服务、不写真实运行日志' };
mkdirSync(path.join(root, '.runtime'), { recursive: true, mode: 0o700 });
writeFileSync(path.join(root, '.runtime/atlas-check.json'),
  JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, failed,
  svgs: svgs.length, cssVarsDefined: defined.size,
  report: '.runtime/atlas-check.json' }, null, 2));
if (failed.length) process.exitCode = 1;
