import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../src/config.ts';
import { eventId, type CollabEvent } from '../src/event-stream.ts';
import { createPlan } from '../src/acceptance-plan.ts';
import { judgeWithVision, expectedTokens, type VisionObservation } from '../src/vision-semantics.ts';
import { LocalModelVisionAdapter, createIndependentReviewer } from '../src/visual-review.ts';

const fixture = path.join(root, 'fixtures/vision-demo.png');
const item = (id: string, criteria: string) => ({ id, name: id, criteria, required: true, evidenceKind: 'captured' as const });
const observation = (text: string, spread = 20): VisionObservation => ({
  engine: 'apple-vision-on-device', width: 800, height: 420,
  texts: text ? [{ text, confidence: 0.99 }] : [], classifications: [{ identifier: 'screenshot', confidence: 0.7 }],
  meanLuminance: 240, luminanceSpread: spread, combinedText: text,
});

test('锁定标准中的期望文本被解析为可核验的视觉特征', () => {
  const parsed = expectedTokens({ name: '界面验收', criteria: '期望文本：验收与责任；期望文案：ACCEPTANCE PASSED' });
  assert.deepEqual(parsed.explicit, ['验收与责任', 'acceptancepassed']);
});

test('本机视觉模型按截图实际内容逐项判定，命中才通过', () => {
  const result = judgeWithVision({ items: [item('item-1', '期望文本：验收与责任'), item('item-2', '期望文本：不存在的字样')],
    observations: [observation('验收与责任\n独立视觉评审：通过')],
    bound: [{ eventId: 'ev-1', itemId: 'item-1', kind: 'screenshot', observationIndex: 0 },
      { eventId: 'ev-2', itemId: 'item-2', kind: 'screenshot', observationIndex: 0 }] });
  assert.equal(result.verdicts[0]!.status, 'passed');
  assert.equal(result.verdicts[1]!.status, 'failed');
  assert.match(result.verdicts[1]!.reason, /未检出锁定标准要求的文字/);
  assert.ok(result.limitations.some(l => l.includes('设备端 OCR')));
});

test('没有绑定截图时绝不假装看过图；纯色图不算界面证据', () => {
  const blocked = judgeWithVision({ items: [item('item-1', '期望文本：验收')], observations: [],
    bound: [] });
  assert.equal(blocked.verdicts[0]!.status, 'blocked');
  const blank = judgeWithVision({ items: [item('item-1', '期望文本：验收')], observations: [observation('', 0)],
    bound: [{ eventId: 'ev-1', itemId: 'item-1', kind: 'screenshot', observationIndex: 0 }] });
  assert.equal(blank.verdicts[0]!.status, 'failed');
  assert.match(blank.verdicts[0]!.reason, /纯色|全黑/);
});

test('标准未写死文案时按锁定关键词与 OCR 所见比对，无法对应就打回', () => {
  const hit = judgeWithVision({ items: [item('item-1', '页面应呈现独立视觉评审结果')],
    observations: [observation('独立视觉评审：通过')],
    bound: [{ eventId: 'ev-1', itemId: 'item-1', kind: 'screenshot', observationIndex: 0 }] });
  assert.equal(hit.verdicts[0]!.status, 'passed');
  const miss = judgeWithVision({ items: [item('item-1', '页面应呈现独立视觉评审结果')],
    observations: [observation('完全无关的另一屏')],
    bound: [{ eventId: 'ev-1', itemId: 'item-1', kind: 'screenshot', observationIndex: 0 }] });
  assert.equal(miss.verdicts[0]!.status, 'failed');
});

const onDarwin = process.platform === 'darwin' && existsSyncSwift();
function existsSyncSwift() { return spawnSync('/usr/bin/swift', ['--version'], { encoding: 'utf8' }).status === 0; }

test('Apple Vision 真的解码截图：中文 OCR + 图像分类 + 像素统计', { skip: !onDarwin }, () => {
  const result = spawnSync('/usr/bin/swift', [path.join(root, 'scripts/apple-vision.swift'), fixture],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  const line = result.stdout.split('\n').find(l => l.startsWith('SUITME_VISION_RESULT='));
  assert.ok(line, '必须有视觉模型输出');
  const parsed = JSON.parse(line!.slice('SUITME_VISION_RESULT='.length)) as VisionObservation;
  assert.match(parsed.combinedText, /验收与责任/);
  assert.match(parsed.combinedText, /ACCEPTANCE PASSED/);
  assert.ok(parsed.classifications.some(c => c.identifier === 'screenshot' || c.identifier === 'document'));
  assert.ok(parsed.luminanceSpread > 3);
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

test('本地视觉端点 ↔ 独立评审适配器端到端跑通（真实读图，全本机）', { skip: !onDarwin, timeout: 120000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'scripts/vision-server.ts')],
    { cwd: root, env: { ...process.env, SUITME_VISION_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const endpoint = `http://127.0.0.1:${port}/v1/chat/completions`;
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      ready = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.ok).catch(() => false);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(ready, '本机视觉模型端点未就绪');
    const bytes = readFileSync(fixture).toString('base64');
    const plan = createPlan({ taskId: 'T-VISION', names: ['期望文本：验收与责任', '期望文本：不存在的字样'],
      lockedBy: 'owner', producerModel: 'producer-gpt', reviewerModel: 'apple-vision-local',
      criteria: { '期望文本：验收与责任': '期望文本：验收与责任', '期望文本：不存在的字样': '期望文本：不存在的字样' } });
    const events: CollabEvent[] = ['one', 'two'].map((marker, i) => ({
      taskId: 'T-VISION', at: '2026-11-06T00:00:00.000Z', kind: 'ci', actor: 'chrome-headless',
      provenance: `screenshot-${marker}-${i}`, evidenceKind: 'captured', refs: [], outcome: 'captured',
    }));
    const artifacts = plan.items.map((p, i) => ({ eventId: eventId(events[i]!), kind: 'screenshot' as const,
      itemId: p.id, mimeType: 'image/png', bytesBase64: bytes }));
    const reviewer = new LocalModelVisionAdapter(endpoint, 'apple-vision-local', 60000);
    const result = await reviewer.review({ plan, producerModel: 'producer-gpt', events, artifacts });
    assert.equal(result.verdicts.length, 2);
    assert.equal(result.verdicts[0]!.status, 'passed', result.verdicts[0]!.reason);
    assert.equal(result.verdicts[1]!.status, 'failed', result.verdicts[1]!.reason);
    assert.deepEqual(result.verdicts[0]!.refs, [artifacts[0]!.eventId]);
    assert.ok(result.limitations.some(l => l.includes('设备端 OCR')));
    const config: any = { acceptance: { mode: 'independent', level: 'L3', reviewerModel: 'apple-vision-local',
      visualReviewer: { mode: 'model', model: 'apple-vision-local', endpoint, timeoutMs: 60000 } } };
    const registered = createIndependentReviewer(config);
    assert.equal(registered.capabilities.vision, true);
    assert.equal(registered.capabilities.semanticJudgement, true);
    assert.notEqual(registered.id, 'producer-gpt');
  } finally {
    child.kill('SIGTERM');
  }
});

test('本机视觉端点用 http 直连，不受环境 HTTP_PROXY 影响，且拒绝 https/外部地址', async () => {
  const { createServer: createHttpServer } = await import('node:http');
  const server = createHttpServer((req, res) => {
    let received = '';
    req.on('data', chunk => { received += chunk; });
    req.on('end', () => {
      assert.ok(received.includes('"messages"'), '本机端点应收到 OpenAI 兼容请求体');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        verdicts: [{ itemId: 'item-1', status: 'passed', reason: '', refs: [] }], limitations: [],
      }) } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const before = { HTTP_PROXY: process.env.HTTP_PROXY, http_proxy: process.env.http_proxy };
  process.env.HTTP_PROXY = 'http://127.0.0.1:1'; process.env.http_proxy = 'http://127.0.0.1:1';
  try {
    const endpoint = `http://127.0.0.1:${port}/v1/chat/completions`;
    const adapter = new LocalModelVisionAdapter(endpoint, 'local-test', 5000);
    const plan = createPlan({ taskId: 'T-PROXY', names: ['界面可见'], lockedBy: 'owner',
      producerModel: 'producer-gpt', reviewerModel: 'local-test' });
    const result = await adapter.review({ plan, producerModel: 'producer-gpt', events: [], artifacts: [] });
    assert.equal(result.verdicts[0]?.status, 'passed');
    assert.throws(() => new LocalModelVisionAdapter('https://127.0.0.1:4190/v1/chat/completions', 'x', 1000), /http 直连/);
    assert.throws(() => new LocalModelVisionAdapter('http://example.com/v1/chat/completions', 'x', 1000), /只能是本机地址/);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
