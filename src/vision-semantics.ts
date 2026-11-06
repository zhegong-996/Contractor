// Semantic judgement for the local Apple Vision reviewer.
//
// This is deliberately a SMALL, auditable model adapter, not a multimodal
// LLM: it reads the actual pixels (on-device OCR + image classification) and
// decides each sealed criterion only from what it can observe. When a criterion
// needs subjective design judgement, it says so and blocks instead of guessing.
// The human originator still makes the final call via /accept (R3/R4).
import type { AcceptanceItem } from './acceptance-plan.ts';
import type { VisualVerdict } from './visual-review.ts';

export interface VisionObservation {
  engine: string;
  width: number;
  height: number;
  texts: { text: string; confidence: number }[];
  classifications: { identifier: string; confidence: number }[];
  meanLuminance: number;
  luminanceSpread: number;
  combinedText: string;
}

export interface BoundVisualEvidence {
  itemId?: string;
  eventId: string;
  kind: 'screenshot' | 'recording' | 'log';
  /** Index into the observations array (screenshots only are decoded). */
  observationIndex?: number;
}

export interface SemanticJudgementInput {
  items: AcceptanceItem[];
  observations: VisionObservation[];
  bound: BoundVisualEvidence[];
}

const STOP_WORDS = new Set([
  '按开工前约定的标准逐项核可', '符合任务要求', '需要', '应该', '必须', '可以', '标准', '要求', '检查', '验收',
  '页面', '显示', '展示', '正确', '通过', 'the', 'and', 'with', 'from', 'that', 'this', 'should', 'must',
]);

const normalise = (value: string) => String(value ?? '').toLowerCase()
  .replace(/[\s\u00a0,，。；;：:!！?？、'"“”‘’()（）\[\]【】<>《》/\\|_\-]+/g, '');

/** Explicit expected on-screen text wins; otherwise derive keywords from the
 *  sealed criterion so the reviewer can at least say what it actually saw. */
export function expectedTokens(item: Pick<AcceptanceItem, 'name' | 'criteria'>): { explicit: string[]; keywords: string[]; } {
  const source = `${item.criteria}\n${item.name}`;
  const explicit: string[] = [];
  // 期望文本：X / 期望文案：X / expect:X / OCR:X — several may be separated by ；/;
  const pattern = /(?:期望文本|期望文案|可见文字|expect|ocr)\s*[:：]\s*([^；;\n]+)/gi;
  for (const match of source.matchAll(pattern)) {
    const value = match[1]!.trim().replace(/^[「『"']|[」』"']$/g, '');
    if (value && normalise(value).length >= 2) explicit.push(normalise(value));
  }
  // Quoted fragments are also treated as expected on-screen text.
  for (const match of source.matchAll(/[「『"]([^」』"\n]{2,40})[」』"]/g)) {
    const value = normalise(match[1]!);
    if (value && !explicit.includes(value)) explicit.push(value);
  }
  const keywords: string[] = [];
  for (const part of source.match(/[\u4e00-\u9fff]{2,40}|[a-zA-Z][a-zA-Z0-9_-]{2,}/g) ?? []) {
    const token = normalise(part);
    if (token.length < 2 || STOP_WORDS.has(part.trim()) || STOP_WORDS.has(token)) continue;
    if (/^[\u4e00-\u9fff]+$/.test(token)) {
      // Chinese has no spaces: compare overlapping bigrams so a paraphrased
      // criterion can still be matched against what OCR actually saw.
      for (let i = 0; i + 2 <= token.length; i++) {
        const gram = token.slice(i, i + 2);
        if (!STOP_WORDS.has(gram) && !keywords.includes(gram)) keywords.push(gram);
      }
    } else if (!keywords.includes(token)) keywords.push(token);
  }
  return { explicit: [...new Set(explicit)], keywords: keywords.slice(0, 24) };
}

/** Pure, replayable judgement used by the local vision server and its tests. */
export function judgeWithVision(input: SemanticJudgementInput): { verdicts: VisualVerdict[]; limitations: string[] } {
  const allText = normalise(input.observations.map(o => o.combinedText).join('\n'));
  const observationsWithContent = input.observations.filter(o =>
    o.texts.length > 0 || o.classifications.some(c => c.confidence > 0.1));
  const limitations = [
    `本机视觉模型 ${input.observations[0]?.engine ?? 'apple-vision-on-device'}：实际解码 ${input.observations.length} 张截图，识别到 ${input.observations.reduce((n, o) => n + o.texts.length, 0)} 段文字`,
    '判定依据为设备端 OCR 文字与图像分类；主观视觉质量（配色、留白、动效）仍由发起人 /accept 人工核可',
  ];
  if (input.observations.length) {
    const labels = [...new Set(input.observations.flatMap(o => o.classifications.slice(0, 2).map(c => c.identifier)))];
    if (labels.length) limitations.push(`本轮图像分类标签：${labels.join('、')}`);
  }
  const verdicts: VisualVerdict[] = input.items.map(item => {
    const bound = input.bound.filter(b => (b.itemId ?? '') === item.id && b.kind !== 'log');
    const refs = [...new Set(bound.map(b => b.eventId))];
    if (!bound.length) return { itemId: item.id, status: 'blocked' as const,
      reason: '该检查项没有绑定截图/录屏，视觉模型不能凭事件文字判定图像内容', refs: [] };
    const views = bound.map(b => input.observations[b.observationIndex ?? -1]).filter(Boolean) as VisionObservation[];
    if (!views.length) return { itemId: item.id, status: 'blocked' as const,
      reason: '截图/录屏未能被本机视觉模型解码', refs };
    if (views.every(v => v.luminanceSpread < 3)) return { itemId: item.id, status: 'failed' as const,
      reason: '截图近乎纯色或全黑，不是可核验的界面状态', refs };
    const seen = normalise(views.map(v => v.combinedText).join('\n'));
    if (!seen && !observationsWithContent.length) return { itemId: item.id, status: 'blocked' as const,
      reason: '视觉模型未从图像中检出可核验的文字或内容标签', refs };
    const { explicit, keywords } = expectedTokens(item);
    if (explicit.length) {
      const missing = explicit.filter(token => !seen.includes(token));
      if (missing.length) return { itemId: item.id, status: 'failed' as const,
        reason: `截图中未检出锁定标准要求的文字：${missing.join('、')}；OCR 所见：${seen.slice(0, 160) || '(无文字)'}`, refs };
      return { itemId: item.id, status: 'passed' as const,
        reason: `本机视觉模型在截图中检出全部 ${explicit.length} 处预期文字`, refs };
    }
    const hits = keywords.filter(token => seen.includes(token));
    const needed = Math.max(2, Math.ceil(keywords.length * 0.25));
    if (hits.length < needed) return { itemId: item.id, status: 'failed' as const,
      reason: `截图内容与锁定标准缺少足够对应文字（${hits.length}/${needed}），需人工核可；OCR 所见：${seen.slice(0, 160) || '(无文字)'}`, refs };
    return { itemId: item.id, status: 'passed' as const,
      reason: `本机视觉模型在截图中检出与标准相关的文字：${hits.slice(0, 4).join('、')}`, refs };
  });
  if (!allText) limitations.push('本轮截图未识别到任何文字；图像内容语义判定受限');
  return { verdicts, limitations };
}
