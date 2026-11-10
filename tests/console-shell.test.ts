// C-2：独立控制台外壳的静态契约。真实浏览器渲染由 `npm run console:smoke` 验证，
// 这里只守「用户可见层」与「只读边界」，不启动服务，避免没有浏览器时假绿。
// 第三十轮 P-12：前端重写为 Vue 3 + Element Plus（本地 vendor），断言从旧
// 手写 DOM 结构（card(...) / [data-view]）换成新组件语义；红线语义不变。
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
  // P-12 起前端复用 Vue 3 + Element Plus（本地 vendor）：主题切换按钮由 Vue
  // 运行时渲染，深浅两套样式来自 html.dark + element-plus.dark.css。
  assert.match(app, /toggleTheme/);
  assert.match(css, /html\.dark/);
  // 第七十二轮收敛：一级入口从 10 个压到 6 个——对话并入协作、概览并入待办、
  // 组织+服务合成团队、产物暂不单列。视图组件都还在，只是不再各占一个菜单。
  for (const id of ['decisions', 'collaboration', 'knowledge', 'team', 'acceptance', 'settings']) {
    assert.match(app, new RegExp(`id: '${id}'`), `缺少视图定义：${id}`);
  }
  // 被合并的视图不得再作为一级入口出现（防止有人把它们加回去）。
  const viewsBlock = /const VIEWS = \[([\s\S]*?)\n  \];/.exec(app)?.[1] ?? '';
  for (const retired of ['overview', 'conversation', 'organization', 'services', 'artifacts']) {
    assert.ok(!viewsBlock.includes(`id: '${retired}'`), `已下线的入口不应回到菜单：${retired}`);
  }
  assert.match(css, /@media \(max-width: 768px\)/, '要有窄屏适配');
});

test('C-2 不新增网页发起入口，飞书仍是唯一发起处', () => {
  assert.match(app, /发起任务请回到飞书/);
  assert.match(app, /这里是查看、授权与确认验收的地方/);
  // 静态 HTML 不含任何原生输入控件；登录与知识编辑表单由本地脚本在登录门后渲染。
  assert.ok(!/<input\b/i.test(html), '静态页面不得出现输入框');
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

test('C-2 控制台动作白名单：核心工作流只读，写入只限知识 / 本人配置 / 管理', () => {
  // 任务发起与工作流写操作仍一律不得进任何白名单。
  const forbiddenActions = ['create-task', 'save-model-settings', 'accept', 'review-source',
    'grant-approve', 'transfer-revoke', 'knowledge-propose', 'trace', 'confirm'];
  for (const action of forbiddenActions) {
    assert.ok(!new RegExp(`'${action}'`).test(server), `动作白名单不得包含写动作：${action}`);
  }
  for (const action of ['view', 'view-summary', 'service-status', 'system-status', 'memory-replay', 'routing-status']) {
    assert.match(server, new RegExp(`'${action}'`), `缺少只读动作：${action}`);
  }
  assert.match(server, /CONSOLE_READ_ACTIONS\.includes\(action\)/);
  // P-13：知识写入只开放 create / update / delete 三支，带登录身份转发，
  // 分区权限由 bridge 端 casbin 统一判定（前端显隐只是体验优化）。
  assert.match(server, /KNOWLEDGE_WRITE_ACTIONS: readonly string\[\] = \['knowledge-create', 'knowledge-update', 'knowledge-delete'\]/);
  assert.match(server, /只允许已登记的动作/);
  // P-12：用户配置只能改本人的（settings-set 第二个参数即被改人 = 会话本人）。
  assert.match(server, /setUserSettings\(session\.username, session\.username/);
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

test('C-3 协作视图展示当前组织形态，用中文讲清怎么派活', () => {
  assert.match(app, /组织形态/);
  assert.match(app, /怎么派活/);
  assert.match(app, /router\.shape/);
  assert.match(app, /routerCoverage/);
  assert.match(app, /没配主管的业务域不会硬造管理层/);
  assert.match(app, /同一任务不得自派自验自环/);
  assert.doesNotMatch(app, /supervisorAgentKey/, '内部配置字段名不暴露给用户');
});

test('C-3 只读请求做 in-flight 去重并短缓存，避免并发重复请求一起超时', () => {
  assert.match(app, /const inFlight = new Map\(\)/);
  assert.match(app, /const readCache = new Map\(\)/);
  assert.match(app, /if \(inFlight\.has\(key\)\) return inFlight\.get\(key\)/);
  assert.ok(app.includes('readCache.set(key, { at: Date.now(), value: data })'), '只缓存成功结果');
  assert.match(app, /finally\(\(\) => inFlight\.delete\(key\)\)/, '失败也要释放 in-flight');
  // P-12 起默认 12 秒快速失败；重放 / 体检类只读动作按 READ_TIMEOUT 放宽。
  assert.match(app, /const READ_TIMEOUT = \{/, '按动作区分超时');
  assert.match(app, /READ_TIMEOUT\[action\] \?\? 12000/, '超时保护不能丢，未登记动作走默认值');
  assert.match(app, /const CACHE_MS = 4000/);
});

test('C-4 协作视图展示 Agent 编制，职责用中文、空编制如实降级', () => {
  assert.match(app, /Agent 编制/);
  assert.match(app, /v06-agent-registry-view/);
  for (const label of ['个人助手', '业务域主管', '验收', '标准起草', '周期巡检', '专项协作']) {
    assert.ok(app.includes(label), `职责槽位必须有中文名：${label}`);
  }
  assert.match(app, /未配置在岗 Agent（扁平，不硬造管理层）/);
  assert.match(app, /独立评审者不等于产出方；最终由原发起人确认验收/);
  assert.doesNotMatch(app, /supervisorAgentKey|registryRevision|agentVersion/, '配置字段名不得出现在用户层');
});

test('C-4 编制视图走只读白名单，不新增写动作或新网页入口', () => {
  assert.match(server, /'v06-agent-registry-view'/);
  assert.ok(!html.includes('新建任务'));
  assert.ok(!app.includes('acceptance-crew'), '控制台不开验收编组的写入 / 派单动作');
});

test('P-5 控制台改拉服务端分页摘要，不再请求全量工作区快照', () => {
  assert.doesNotMatch(app, /safe\('view'\)/, '控制台不得再请求全量 view');
  // P-12 重写后任务列表出现在概览 / 协作 / 验收三个视图；验收工作台带 limit
  // 参数按需取前 50 条（仍走摘要，不碰全量快照），所以匹配时允许带参数。
  assert.ok((app.match(/safe\('view-summary'[),]/g) ?? []).length >= 3, '用到任务列表的视图都要改');
  assert.match(server, /'view-summary'/, '只读动作必须登记进控制台白名单');
  assert.doesNotMatch(app, /'view-summary': \d+/, '摘要走默认超时，不给慢请求开口子');
});

test('P-5 摘要只用于展示索引，不承载工作稿正文或验收判断', () => {
  for (const field of ['snapshots', 'sourceAccess', 'state.history']) {
    assert.ok(!app.includes(field), `摘要视图不得读取完整现场字段：${field}`);
  }
  assert.match(app, /原发起人在原会话用中文确认验收/);
});

test('C-2 静态资源自足，不依赖外部脚本或样式', () => {
  assert.match(html, /href="\/styles\.css"/);
  assert.match(html, /src="\/app\.js"/);
  assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org[^"']*/g, '')), '不得引外部资源');
  assert.match(server, /'\/styles\.css'/);
  assert.match(server, /'\/app\.js'/);
});
