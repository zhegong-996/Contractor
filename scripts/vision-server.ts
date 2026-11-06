// Local OpenAI-compatible endpoint backed by the on-device Apple Vision model.
// Binds to 127.0.0.1 only. No key, no network egress, no model download:
// screenshots stay on this Mac and are deleted immediately after decoding.
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { root, runtime } from '../src/config.ts';
import { judgeWithVision, type VisionObservation, type BoundVisualEvidence } from '../src/vision-semantics.ts';
import type { AcceptanceItem } from '../src/acceptance-plan.ts';

const port = Number(process.env.SUITME_VISION_PORT ?? 4190);
const host = '127.0.0.1';
const model = process.env.SUITME_VISION_MODEL ?? 'apple-vision-local';
const swift = process.env.SUITME_SWIFT_BIN ?? '/usr/bin/swift';
const script = path.join(root, 'scripts/apple-vision.swift');
const workDir = runtime('vision');
mkdirSync(workDir, { recursive: true });

function decodeAppleVision(file: string): VisionObservation {
  if (!existsSync(swift) || !existsSync(script)) throw new Error('本机 Apple Vision 运行时不可用');
  const result = spawnSync(swift, [script, file], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`Apple Vision 解码失败：${String(result.error ?? result.stderr).split('\n')[0]}`);
  }
  const line = String(result.stdout).split('\n').find(l => l.startsWith('SUITME_VISION_RESULT='));
  if (!line) throw new Error(`Apple Vision 未返回结果：${String(result.stderr).split('\n')[0]}`);
  return JSON.parse(line.slice('SUITME_VISION_RESULT='.length)) as VisionObservation;
}

function respond(res: any, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}:${port}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    respond(res, 200, { status: 'ok', model, engine: 'apple-vision-on-device',
      endpoint: `http://${host}:${port}/v1/chat/completions`, networkEgress: false,
      swiftAvailable: existsSync(swift), script });
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') { respond(res, 404, { error: 'not found' }); return; }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 24 * 1024 * 1024) { respond(res, 413, { error: 'payload too large' }); return; }
    chunks.push(chunk as Buffer);
  }
  let payload: any;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { respond(res, 400, { error: 'invalid JSON' }); return; }
  const content = payload?.messages?.[0]?.content;
  if (!Array.isArray(content)) { respond(res, 400, { error: 'expected multimodal content array' }); return; }
  const instructionPart = content.find((part: any) => part?.type === 'text' && typeof part.text === 'string');
  const imageParts = content.filter((part: any) => part?.type === 'image_url' && typeof part?.image_url?.url === 'string');
  if (!instructionPart) { respond(res, 400, { error: 'missing review instruction' }); return; }
  let instruction: any;
  try { instruction = JSON.parse(instructionPart.text); } catch { respond(res, 400, { error: 'invalid instruction JSON' }); return; }
  const items = (instruction?.items ?? []) as AcceptanceItem[];
  const declared = (instruction?.visualImages ?? []) as { eventId: string; itemId?: string; kind: string }[];
  if (!items.length || !imageParts.length) { respond(res, 400, { error: 'plan items and screenshots are required' }); return; }

  const observations: VisionObservation[] = [];
  const bound: BoundVisualEvidence[] = [];
  const tempFiles: string[] = [];
  try {
    for (let index = 0; index < Math.min(imageParts.length, 6); index++) {
      const url: string = imageParts[index].image_url.url;
      const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url);
      if (!match) throw new Error('第 ' + (index + 1) + ' 张视觉证据不是合法的 base64 图片');
      const bytes = Buffer.from(match[2]!, 'base64');
      if (bytes.length > 12 * 1024 * 1024) throw new Error('单张截图超过 12MB');
      const file = path.join(workDir, `${randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`);
      writeFileSync(file, bytes, { mode: 0o600 }); tempFiles.push(file);
      observations.push(decodeAppleVision(file));
      const meta = declared[index];
      if (meta) bound.push({ eventId: meta.eventId, itemId: meta.itemId,
        kind: meta.kind === 'recording' ? 'recording' : 'screenshot', observationIndex: index });
    }
    const judgement = judgeWithVision({ items, observations, bound });
    // Auditable local record for the demo: what the model saw and decided.
    appendFileSync(path.join(workDir, 'reviews.jsonl'), JSON.stringify({
      at: new Date().toISOString(), model, images: observations.length,
      seenText: observations.map(o => o.combinedText.slice(0, 300)),
      classifications: observations.map(o => o.classifications.slice(0, 3)),
      verdicts: judgement.verdicts, limitations: judgement.limitations,
    }) + '\n', { mode: 0o600 });
    respond(res, 200, {
      id: `chatcmpl-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(judgement) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (error) {
    respond(res, 500, { error: String(error instanceof Error ? error.message : error) });
  } finally {
    for (const file of tempFiles) { try { unlinkSync(file); } catch { /* best effort */ } }
  }
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ status: 'ready', model, endpoint: `http://${host}:${port}/v1/chat/completions`,
    engine: 'apple-vision-on-device', networkEgress: false }));
});
