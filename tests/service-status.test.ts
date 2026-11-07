// 国内服务清单：状态必须来自实时探测，未接通项绝不能带可点入口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { buildServiceStatus, collectServiceStatus, safeLoopbackUrl,
  type ProbeResult, type ServiceStatusInput } from '../src/service-status.ts';

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const ok = (extra: Record<string, unknown> = {}): ProbeResult => ({ statusCode: 200, body: { ok: true, status: 'ok', ...extra } });

function input(overrides: Partial<ServiceStatusInput> = {}): ServiceStatusInput {
  return {
    paperclipPort: 3100, deliveryPort: 4194, gitPort: 9418,
    visionPort: 4190, reportPort: 4192,
    acceptanceMode: 'independent', visualReviewerMode: 'model', feishuState: 'ready',
    probes: {
      paperclip: ok(),
      delivery: ok({ scope: 'loopback-only', provider: 'local-git', port: 4194, git: 'git://127.0.0.1:9418/suitme-collab.git' }),
      vision: ok(), report: ok(),
    },
    checkedAt: '2026-11-07T00:00:00.000Z',
    ...overrides,
  };
}

test('全部在线时，只有真实接通的本机服务带 loopback 链接', () => {
  const report = buildServiceStatus(input());
  assert.equal(report.ok, true);
  assert.equal(report.loopbackOnly, true);
  const withUrl = report.services.filter(s => s.url);
  assert.deepEqual(withUrl.map(s => s.id).sort(), ['delivery', 'paperclip', 'report']);
  for (const s of withUrl) {
    assert.equal(s.state, 'connected');
    assert.match(s.url!, /^http:\/\/127\.0\.0\.1:\d+\//);
  }
  // 视觉端点只有 /health、Bridge 与飞书也不提供页面链接。
  for (const id of ['bridge', 'vision', 'feishu']) {
    assert.equal(report.services.find(s => s.id === id)!.url, undefined);
  }
});

test('Paperclip 的 SPA HTML 回退也算在线，但任意 200 不会被误判', () => {
  const html: ProbeResult = { statusCode: 200, body: null, text: '<!DOCTYPE html><html lang="zh-CN">' };
  const online = buildServiceStatus(input({ probes: { ...input().probes, paperclip: html } }));
  assert.equal(online.services.find(s => s.id === 'paperclip')!.state, 'connected');
  const bogus = buildServiceStatus(input({ probes: {
    ...input().probes, paperclip: { statusCode: 200, body: null, text: 'plain text from another server' },
  } }));
  assert.equal(bogus.services.find(s => s.id === 'paperclip')!.state, 'unavailable');
});

test('未接通的本机与国内服务：没有 url，也没有可点入口，但给出可照做的步骤', () => {
  const report = buildServiceStatus(input({ probes: {}, feishuState: 'disabled' }));
  const unconnected = report.services.filter(s => s.state === 'unavailable');
  assert.ok(unconnected.length >= 9, '停机时应覆盖本机服务与国内服务；海外服务不作为一等入口');
  for (const s of unconnected) {
    assert.equal(s.state, 'unavailable');
    assert.equal(s.url, undefined, `${s.name} 不应带链接`);
    assert.ok(s.setup && s.setup.length > 10, `${s.name} 应给出接通步骤`);
    assert.ok(s.source, `${s.name} 应标注状态来源`);
  }
  assert.equal(report.services.find(s => s.id === 'delivery')!.state, 'unavailable');
  assert.equal(report.services.find(s => s.id === 'delivery')!.url, undefined);
  assert.match(report.note, /未接通条目只给状态与接通步骤/);
});

test('端口被冒名服务占用时不误判为已接通，不生成链接', () => {
  const report = buildServiceStatus(input({ probes: {
    ...input().probes,
    delivery: ok({ port: 4194 }), // 只回了 ok:true，缺 scope / provider
  } }));
  const delivery = report.services.find(s => s.id === 'delivery')!;
  assert.equal(delivery.state, 'unavailable');
  assert.equal(delivery.url, undefined);
  assert.match(delivery.detail, /占用|拒绝误判/);
});

test('legacy 验收链下视觉端点在线也只算「部分可用」，且不给链接', () => {
  const report = buildServiceStatus(input({ acceptanceMode: 'legacy' }));
  const vision = report.services.find(s => s.id === 'vision')!;
  assert.equal(vision.state, 'degraded');
  assert.equal(vision.url, undefined);
  assert.match(vision.detail, /视觉评审未挂接/);
});

test('safeLoopbackUrl 只放行本机 http，挡掉可执行协议与外部地址', () => {
  assert.equal(safeLoopbackUrl('http://127.0.0.1:4194/'), 'http://127.0.0.1:4194/');
  assert.equal(safeLoopbackUrl('http://localhost:4192/overview'), 'http://localhost:4192/overview');
  assert.equal(safeLoopbackUrl('javascript:alert(1)'), null);
  assert.equal(safeLoopbackUrl('https://example.com/'), null);
  assert.equal(safeLoopbackUrl('http://192.168.1.5:4194/'), null);
  assert.equal(safeLoopbackUrl('http://user:pw@127.0.0.1:4194/'), null);
  assert.equal(safeLoopbackUrl(undefined), null);
  assert.equal(safeLoopbackUrl('不是链接'), null);
});

test('collectServiceStatus 并发探测，单个端点失败不影响其余条目', async () => {
  const calls: number[] = [];
  const probe = async (port: number): Promise<ProbeResult | null> => {
    calls.push(port);
    if (port === 4190) throw new Error('connection refused');
    if (port === 4192) return { statusCode: 503, body: null };
    if (port === 4194) return ok({ scope: 'loopback-only', provider: 'local-git', port: 4194 });
    return ok();
  };
  const report = await collectServiceStatus(input(), probe);
  assert.deepEqual([...calls].sort((a, b) => a - b), [3100, 4190, 4192, 4194]);
  assert.equal(report.services.find(s => s.id === 'delivery')!.state, 'connected');
  assert.equal(report.services.find(s => s.id === 'vision')!.state, 'unavailable');
  assert.equal(report.services.find(s => s.id === 'report')!.state, 'unavailable');
});

test('service-status 在三处只读白名单与前端渲染条件中保持一致', () => {
  const server = read('src/server.ts'), members = read('src/members.ts'),
    ui = read('plugins/knowledge-workspaces/src/ui/domestic-services.tsx');
  assert.match(server, /if\(action==='service-status'\)return serviceStatus\(feishuState\)/);
  assert.match(server, /'delivery-status','service-status'/);
  assert.match(members, /'delivery-status', 'service-status'/);
  assert.match(ui, /ui\.read\('service-status', \{\}\)/);
  // 唯一能生成链接的地方：已接通 + loopback URL 校验通过。
  assert.match(ui, /const href = s\.state === 'connected' \? safeLoopbackUrl\(s\.url\) : null/);
  assert.equal((ui.match(/href=\{href\}/g) ?? []).length, 1);
  assert.match(ui, /setInterval/);
  assert.match(ui, /状态探测失败/);
  // 自动轮询失败静默保留旧数据，只有手动刷新或首次加载失败才提示。
  assert.match(ui, /manual \|\| !reportRef\.current/);
  assert.match(ui, /setStale\(true\)/);
  assert.match(ui, /load\(true\)/);
  assert.doesNotMatch(ui, /<a[^>]*>企业微信<\/a>/);
  assert.doesNotMatch(ui, /<a[^>]*>腾讯文档<\/a>/);
});

test('交付台健康响应必须带服务身份，避免渲染指向错误服务的入口', () => {
  const server = read('src/server.ts');
  assert.match(server, /health\.scope === 'loopback-only'/);
  assert.match(server, /health\.provider === 'local-git'/);
  assert.match(server, /health\.port === port/);
});

test('system-status 的能力状态来自配置而非写死的常量', () => {
  const server = read('src/server.ts');
  assert.match(server, /vectorSearch: config\.knowledge\.semanticRecall\.enabled/);
  assert.match(server, /automaticExtraction: config\.orgExtraction\.enabled && config\.orgExtraction\.autoRunOnIndex/);
  assert.match(server, /config\.acceptance\?\.mode === 'independent'/);
  assert.doesNotMatch(server, /automaticExtraction: false/);
});

test('中文壳构建可重复执行：构建前恢复 sw.js 原始占位符', () => {
  const build = read('scripts/build-chinese-shell.ts');
  assert.match(build, /copyFileSync\(swSource, swTarget\)/);
  assert.match(build, /public', 'sw\.js'/);
  assert.ok(build.indexOf('copyFileSync(swSource, swTarget)') < build.indexOf('await build('),
    '必须在 Vite 构建前恢复，否则 closeBundle 会读到已 stamp 的文件');
});

test('端到端授权用例不再把时间写成固定日期（防止时间炸弹）', () => {
  const v06 = read('tests/v06-services.test.ts');
  assert.doesNotMatch(v06, /const at = '2026-/);
  assert.match(v06, /Date\.now\(\)/);
});
