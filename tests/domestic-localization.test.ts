// C-2 国内适配：守住「用户可见层不出现国外元素」这条线。
// 内部标识（import、action 名、className、配置 id）允许保持英文，但用户读到的必须是中文产品语言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { domesticIndexHtml } from '../src/shell-domestic.ts';
import { buildServiceStatus, type ProbeResult, type ServiceStatusInput } from '../src/service-status.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const dictionary = (JSON.parse(read('locales/i18n-zh-CN.json')) as { translation: Record<string, string> }).translation;
const uiDir = path.join(root, 'plugins/knowledge-workspaces/src/ui');
const visibleUiLines = () => readdirSync(uiDir)
  .filter(file => file.endsWith('.tsx') || file.endsWith('.ts'))
  .flatMap(file => readFileSync(path.join(uiDir, file), 'utf8').split('\n'))
  .filter(line => !/^\s*(import\b|\/\/|\*|\/\*)/.test(line))
  .join('\n')
  // JSX 组件标签是代码标识，不是用户读到的文案（例如图谱渲染组件）。
  .replace(/<\/?[A-Z][A-Za-z0-9]*/g, '<');

const OVERSEAS = ['Paperclip', 'GitHub', 'Slack', 'Vercel', 'Discord', 'Notion', 'Linear',
  'OpenAI', 'Claude Code', 'Codex', 'Cognee', 'Ladybug', 'Gemini', 'SQLite',
  'OpenAI-compatible', 'sha256(sourceId@revision)'];

test('C-2 中文壳词典覆盖上游残留的英文展示文案', () => {
  for (const key of ['AWS region', 'AWS discovery', 'Login to Claude Code',
    'Import from GitHub', 'Search GitHub', 'Configure an AWS provider vault to enable remote import']) {
    assert.ok(dictionary[key], `缺少词条：${key}`);
    assert.match(dictionary[key], /[\u4e00-\u9fa5]/, `${key} 必须译成中文`);
  }
});

test('C-2 词典译文里不残留海外品牌名', () => {
  for (const [key, value] of Object.entries(dictionary)) {
    for (const word of OVERSEAS) {
      assert.ok(!value.includes(word), `词条「${key}」的译文不应出现：${word}`);
    }
  }
});

test('C-2 宿主页面标题与移动桌面标题都改成中文产品名', () => {
  const html = '<html lang="en"><head><title>Paperclip</title><meta name="apple-mobile-web-app-title" content="Paperclip"></head></html>';
  const result = domesticIndexHtml(html);
  assert.match(result, /<title>SuitMe 协作台<\/title>/);
  assert.match(result, /apple-mobile-web-app-title" content="SuitMe 协作台"/);
  assert.ok(!result.includes('Paperclip'));
});

test('C-2 服务清单不再把海外服务列为一等入口', () => {
  const ok = (extra: Record<string, unknown> = {}): ProbeResult => ({ statusCode: 200, body: { ok: true, status: 'ok', ...extra } });
  const input: ServiceStatusInput = {
    paperclipPort: 3100, deliveryPort: 4194, gitPort: 9418, visionPort: 4190, reportPort: 4192,
    acceptanceMode: 'independent', visualReviewerMode: 'model', feishuState: 'ready',
    probes: { paperclip: ok(), vision: ok(), report: ok() },
    checkedAt: '2026-11-07T00:00:00.000Z',
  };
  const report = buildServiceStatus(input);
  assert.ok(report.services.length > 0);
  assert.equal(report.services.some(item => item.category === 'overseas'), false);
  assert.equal(report.services.some(item => item.id === 'overseas-saas'), false);
  for (const service of report.services) {
    for (const word of OVERSEAS) assert.ok(!service.name.includes(word), `服务名不应出现：${word}（${service.name}）`);
  }
  assert.equal(report.services.find(item => item.id === 'paperclip')?.name, '本机协作服务');
});

test('C-2 工作台用户可见文案不出现海外品牌、工程命令与英文协议词', () => {
  const visible = visibleUiLines();
  const forbidden = [...OVERSEAS, 'npm run', 'acceptance:export', '/accept', 'Token 上限', 'Markdown 目录'];
  for (const word of forbidden) {
    assert.ok(!visible.includes(word), `用户可见层不应出现：${word}`);
  }
});

test('C-2 国内服务页只列本机与国内两组，未接通仍不给空入口', () => {
  const source = read('plugins/knowledge-workspaces/src/ui/domestic-services.tsx');
  assert.ok(!source.includes("'overseas', '海外服务'"), '不得再把海外服务列为分组');
  assert.match(source, /未接通不放入口/);
  assert.match(source, /safeLoopbackUrl/);
});

test('C-2 自研控制台不依赖宿主插件接口或固定端口', () => {
  const consoleFiles = ['console/index.html', 'console/styles.css', 'console/app.js']
    .map(file => read(file)).join('\n');
  assert.ok(!consoleFiles.includes('plugin-sdk'));
  assert.ok(!consoleFiles.includes('3100'));
  assert.ok(!consoleFiles.includes('4180'));
  assert.match(read('scripts/console-server.ts'), /config\.bridgePort/);
});
