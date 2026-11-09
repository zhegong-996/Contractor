/**
 * 录屏章节标记（对齐 lobehub/acceptance `references/video-chapters.md`，Apache-2.0）。
 *
 * 一段没打章节的录屏，评审得从头看到尾找那关键两秒；打上章节后，评审跳到每个
 * 声明的时间点，逐帧核对。三种标记：
 *
 *   - step  —— 你做的一个动作，带 label（短名）；
 *   - check —— 你在这一帧核实的一个声明，带 note（那句声明）——「check 只对这一帧成立」；
 *   - flag  —— 你注意到并判定无害、主动披露的异常，带 note（是什么 + 为什么）。
 *
 * `t` 是相对录屏起点的秒数。时间戳必须来自日志，不能凭记忆写。
 */

export const CHAPTER_KINDS = ['step', 'check', 'flag'] as const;
export type ChapterKind = (typeof CHAPTER_KINDS)[number];

export interface VideoChapter {
  kind: ChapterKind;
  /** 相对录屏起点的秒数。 */
  t: number;
  /** step 的短名。 */
  label?: string;
  /** check / flag 的声明。 */
  note?: string;
}

export interface ChapterMark {
  /** 打点时的墙钟时间（秒）。 */
  wall: number;
  kind: ChapterKind;
  text: string;
}

export type ChapterParseResult =
  | { ok: true; chapter: VideoChapter }
  | { ok: false; error: string };

/** 校验并归一化一个章节标记（负 t、未知 kind、step 缺 label、check/flag 缺 note 都拒）。 */
export function parseChapter(raw: unknown): ChapterParseResult {
  const value = raw as Partial<VideoChapter> | null | undefined;
  if (!value || typeof value !== 'object') return { ok: false, error: '章节标记不是对象' };
  if (!CHAPTER_KINDS.includes(value.kind as ChapterKind)) {
    return { ok: false, error: `未知的章节类型 ${String(value.kind)}` };
  }
  const kind = value.kind as ChapterKind;
  const t = Number(value.t);
  if (!Number.isFinite(t) || t < 0) return { ok: false, error: '章节时间 t 缺失或为负' };
  if (kind === 'step' && !String(value.label ?? '').trim()) {
    return { ok: false, error: 'step 章节缺少 label' };
  }
  if ((kind === 'check' || kind === 'flag') && !String(value.note ?? '').trim()) {
    return { ok: false, error: `${kind} 章节缺少 note` };
  }
  return { ok: true, chapter: { kind, t: Math.round(t * 100) / 100,
    ...(kind === 'step' ? { label: String(value.label).trim() } : { note: String(value.note).trim() }) } };
}

/**
 * 把打点日志（墙钟时间）转成章节（相对录屏起点的秒数）。
 * `start` 是录屏起点的墙钟时间（秒）。负偏移会被压成 0。
 */
export function marksToChapters(marks: readonly ChapterMark[], start: number): VideoChapter[] {
  const chapters: VideoChapter[] = [];
  for (const mark of marks) {
    const t = Math.max(mark.wall - start, 0);
    const chapter = parseChapter({ kind: mark.kind, t, label: mark.kind === 'step' ? mark.text : undefined,
      note: mark.kind !== 'step' ? mark.text : undefined });
    if (chapter.ok) chapters.push(chapter.chapter);
  }
  return chapters;
}

/**
 * 校验一整段录屏的章节：任何一条畸形都整段拒绝（对齐上游「ingest 告警并丢弃每一条畸形标记」，
 * 但这里更严——畸形标记在发布前就该修掉，而不是静默丢弃后让评审看不到那个声明）。
 */
export function validateChapters(chapters: readonly unknown[]): { ok: boolean; chapters: VideoChapter[]; errors: string[] } {
  const out: VideoChapter[] = [];
  const errors: string[] = [];
  for (const raw of chapters) {
    const parsed = parseChapter(raw);
    if (parsed.ok) out.push(parsed.chapter);
    else errors.push(parsed.error);
  }
  return { ok: errors.length === 0, chapters: out, errors };
}

/** 评审驳回时按时间点抽帧的 ffmpeg 命令（把「0:07.47」落成一条可复跑命令）。 */
export function frameAt(videoPath: string, t: number, outPath: string): string {
  return `ffmpeg -ss ${t} -i ${videoPath} -frames:v 1 ${outPath}`;
}
