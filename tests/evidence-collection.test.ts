// acceptance 证据采集：录屏章节、证据媒体契约、无障碍、交互成本。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChapter, marksToChapters, validateChapters, frameAt } from '../src/video-chapters.ts';
import { mediaTypeOf, validateEvidence, audioEvidencePair } from '../src/evidence-media.ts';
import { a11yVerdict } from '../src/a11y-check.ts';
import { parseKlmAtom, priceKlmTrace, klmSummary, KLM_SCHEMA } from '../src/klm-trace.ts';

test('录屏章节：三种 kind 校验，畸形标记整段拒绝', () => {
  assert.ok(parseChapter({ kind: 'step', t: 6, label: 'Scroll #3' }).ok);
  assert.ok(parseChapter({ kind: 'check', t: 7.9, note: '无骨架' }).ok);
  assert.ok(parseChapter({ kind: 'flag', t: 7, note: '请求数 0→1' }).ok);
  assert.equal(parseChapter({ kind: 'step', t: -1, label: 'x' }).ok, false);
  assert.equal(parseChapter({ kind: 'unknown', t: 1 }).ok, false);
  assert.equal(parseChapter({ kind: 'step', t: 1 }).ok, false);        // step 缺 label
  assert.equal(parseChapter({ kind: 'check', t: 1 }).ok, false);       // check 缺 note

  const valid = validateChapters([
    { kind: 'step', t: 1, label: 'a' },
    { kind: 'check', t: 2, note: 'b' },
  ]);
  assert.ok(valid.ok);
  const invalid = validateChapters([{ kind: 'step', t: -1, label: 'a' }]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.length, 1);
});

test('录屏章节：打点日志转章节，负偏移压 0', () => {
  const chapters = marksToChapters([
    { wall: 10, kind: 'step', text: '开始' },
    { wall: 13.5, kind: 'check', text: '无骨架' },
  ], 10);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0]!.t, 0);
  assert.equal(chapters[1]!.t, 3.5);
  assert.match(frameAt('./proof/a.mp4', 7.47, './review/f.png'), /ffmpeg -ss 7.47/);
});

test('证据媒体：8 类型 + 描述必填 + 章节只对 video 有意义', () => {
  assert.equal(mediaTypeOf('a.mp4'), 'video');
  assert.equal(mediaTypeOf('a.mp3'), 'audio');
  assert.equal(mediaTypeOf('a.log'), 'text');
  assert.equal(mediaTypeOf('a.png'), 'screenshot');
  assert.equal(mediaTypeOf('a.md'), 'markdown');
  assert.equal(mediaTypeOf('a.xyz'), null);

  assert.equal(validateEvidence({ path: 'a.png' }).ok, false);                    // 缺描述
  assert.equal(validateEvidence({ path: 'a.png', description: 'JSON' }).ok, false); // 描述无信息
  assert.ok(validateEvidence({ path: 'a.png', description: '登录后的主页，展示三个卡片' }).ok);
  assert.equal(validateEvidence({ path: 'a.txt', description: 'x', chapters: [{ kind: 'step', t: 1, label: 'a' }] }).ok, false); // 非 video 带章节

  assert.equal(audioEvidencePair({ path: 'a.mp3', description: 'TTS', type: 'audio' }).ok, false);
  assert.ok(audioEvidencePair({ path: 'a.mp3', description: 'TTS', type: 'audio' }, { path: 'b.txt', description: '输入文本+时长' }).ok);
});

test('无障碍：critical/serious 阻断，moderate 不阻断，incomplete 需复核', () => {
  const blocked = a11yVerdict({ violations: [{ id: 'color-contrast', impact: 'serious', nodes: 1 }] });
  assert.ok(blocked.blocked);
  assert.match(blocked.conclusion, /阻断/);

  const notBlocked = a11yVerdict({ violations: [{ id: 'label', impact: 'moderate', nodes: 1 }] });
  assert.equal(notBlocked.blocked, false);
  assert.match(notBlocked.conclusion, /不阻断/);

  const review = a11yVerdict({ incomplete: [{ id: 'aria-hidden-focus', impact: 'serious' }] });
  assert.equal(review.blocked, false);
  assert.equal(review.needsReview.length, 1);
});

test('交互成本：blocked 记 0，外来 schema 不计价，无动作不谎报 0 秒', () => {
  const atom = JSON.stringify({
    schema: KLM_SCHEMA, type: 'action', category: 'action',
    operators: { P: 1, K: 2, M: 1 }, durationMs: 840,
  });
  const blocked = JSON.stringify({ schema: KLM_SCHEMA, category: 'blocked', operators: {} });
  const foreign = JSON.stringify({ schema: 'foreign.tag', operators: { P: 999 } });

  const cost = priceKlmTrace([atom, blocked, foreign]);
  assert.ok(cost.priceable);
  assert.equal(cost.atoms, 1);
  assert.equal(cost.skipped, 2);
  assert.equal(cost.operators.P, 1);
  assert.equal(cost.operators.M, 1);
  // P 1.1 + K 0.4 + M 1.35 = 2.85
  assert.equal(cost.seconds, 2.85);

  const empty = priceKlmTrace([]);
  assert.equal(empty.priceable, false);
  assert.match(klmSummary(empty), /不谎报/);

  assert.equal(parseKlmAtom('not json'), null);
  assert.equal(parseKlmAtom(JSON.stringify({ schema: 'x' })), null);
});
