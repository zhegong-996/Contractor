// C-2：独立控制台外壳的静态契约。真实浏览器渲染由 `npm run console:smoke` 验证，
// 这里只守「用户可见层」与「只读边界」，不启动服务，避免没有浏览器时假绿。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const html = read('console/index.html');
const css = read('console/styles.css');
const app = read('console/app.js');
const server = read('scripts/console-server.ts');

/** 用户可见层不允许出现的海外品牌、工程命令与英文协议词。 */
const FORBIDDEN_IN_HTML = [
  'Paperclip', 'GitHub', 'Slack', 'Vercel', 'Discord', 'Notion', 'Linear',
  'OpenAI', 'Claude', 'Codex', 'Cognee', 'Ladybug', 'Gemini', 'SQLite',
  'npm run', '/accept', 'acceptance:export', 'Plugin SDK',
];

test('C-2 页面不含海外品牌、工程命令与英文协议词', () => {
  for (const word of FORBIDDEN_IN_HTML) {
    assert.ok(!html.includes(word), `用户可见页面不应出现：${word}`);
  }
});

test('C-2 页面是中文、有深浅主题与六个协作视图', () => {
  assert.match(html, /<html lang="zh-CN"/);
  assert.match(html, /<title>SuitMe 协作台<\/title>/);
  assert.match(html, /apple-mobile-web-app-title" content="SuitMe 协作台"/);
  assert.match(html, /id="theme-toggle"/);
  for (const id of ['overview', 'collaboration', 'knowledge', 'acceptance', 'services', 'settings']) {
    assert.match(app, new RegExp(`id: '${id}'`), `缺少视图定义：${id}`);
  }
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /max-width: 425px/);
});

test('C-2 不新增网页发起入口，飞书仍是唯一发起处', () => {
  assert.match(html, /发起任务请回到飞书/);
  assert.match(html, /不提供网页发起入口/);
  assert.ok(!/<input\b/i.test(html), '不得出现输入框');
  assert.ok(!/<textarea\b/i.test(html), '不得出现文本域');
  assert.ok(!/<form\b/i.test(html), '不得出现提交表单');
  assert.ok(!app.includes('新建任务'), '不得提供新建任务按钮');
  assert.ok(!app.includes('create-task'), '不得调用创建任务动作');
});

test('C-2 后端品牌词在展示层统一换成中文产品语言', () => {
  assert.match(app, /DOMESTIC_TERMS/);
  assert.match(app, /本机协作服务/);
  assert.match(app, /知识引擎/);
  assert.match(app, /本地开发工具/);
  assert.match(app, /clean\(text\)/);
});

test('C-2 控制台只开放只读动作，写操作一律拒绝', () => {
  const writeActions = ['create-task', 'save-model-settings', 'accept', 'review-source',
    'grant-approve', 'transfer-revoke', 'knowledge-propose', 'trace', 'confirm'];
  for (const action of writeActions) {
    assert.ok(!new RegExp(`'${action}'`).test(server), `只读白名单不得包含写动作：${action}`);
  }
  for (const action of ['view', 'service-status', 'system-status', 'memory-replay', 'routing-status']) {
    assert.match(server, new RegExp(`'${action}'`), `缺少只读动作：${action}`);
  }
  assert.match(server, /CONSOLE_READ_ACTIONS\.includes\(action\)/);
  assert.match(server, /只允许读取已登记的状态/);
});

test('C-2 只绑定回环地址，密钥留在服务端且有安全头', () => {
  assert.match(server, /server\.listen\(port, '127\.0\.0\.1'/);
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /frame-ancestors 'none'/);
  assert.match(server, /secrets\(\)\.adminToken/);
  assert.ok(!/0\.0\.0\.0/.test(server), '不得监听所有网卡');
  assert.ok(!html.includes('adminToken'), '密钥不得出现在静态页面');
  assert.ok(!app.includes('adminToken'), '密钥不得出现在前端脚本');
});

test('C-2 静态资源自足，不依赖外部脚本或样式', () => {
  assert.match(html, /href="\/styles\.css"/);
  assert.match(html, /src="\/app\.js" defer/);
  assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org[^"']*/g, '')), '不得引外部资源');
  assert.match(server, /'\/styles\.css'/);
  assert.match(server, /'\/app\.js'/);
});
