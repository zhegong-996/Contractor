// Static regression guard for the 1280/425 layout rules. The real browser
// walkthrough is `npm run test:responsive` (Chrome headless, iframe viewport).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const styles = read('plugins/knowledge-workspaces/src/ui/styles.ts');
const panels = read('plugins/knowledge-workspaces/src/ui/v06-panels.tsx');

test('v0.6 三个面板都带 sm-v06 作用域，不污染上游页面样式', () => {
  for (const name of ['GovernancePanel', 'OrganizationPanel', 'KnowledgeStatePanel']) {
    const start = panels.indexOf(`export function ${name}`);
    assert.ok(start >= 0, `${name} 不存在`);
    const chunk = panels.slice(start, start + 1200);
    assert.match(chunk, /className="sm-stack sm-v06"/);
  }
  assert.ok(styles.includes('.suitme-workbench .sm-v06{'));
});

test('425px 规则：容器不设硬宽、表格在自身容器滚动、按钮 ≥44px、长文本可断行', () => {
  assert.match(styles, /\.suitme-workbench \.sm-v06\{min-width:0;max-width:100%\}/);
  assert.match(styles, /\.sm-v06 \.sm-table-scroll\{max-width:100%;min-width:0;overflow-x:auto/);
  assert.match(styles, /@media\(max-width:720px\)/);
  assert.match(styles, /\.sm-v06 button\{min-height:44px\}/);
  assert.match(styles, /\.sm-v06 \.sm-table\{min-width:620px\}/);
  assert.match(styles, /\.sm-v06 \.sm-document dd,\.suitme-workbench \.sm-v06 \.sm-document dt\{overflow-wrap:anywhere/);
});

test('窄屏走查脚本按 1280 与 425 两个视口测量，并保留审计产物', () => {
  const script = read('scripts/responsive-audit.ts');
  assert.match(script, /\[1280, 425\]/);
  assert.match(script, /responsive-audit\.json/);
  assert.match(script, /srcdoc/);
});

test('上游适配清单与边界审计脚本齐备', () => {
  const doc = read('docs/UPSTREAM-ADAPTERS.md');
  const flat = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const name of ['paperclip', 'superagent', 'autoloop', 'prime-agent', 'deepseek-harness', 'cognee'])
    assert.ok(flat(doc).includes(flat(name)), `清单缺少 ${name}`);
  assert.ok(doc.includes('src/org-extraction.ts'));
  const audit = read('scripts/audit-upstream.ts');
  assert.ok(audit.includes('sources.lock.json') && audit.includes('THIRD_PARTY_NOTICES.md'));
});
