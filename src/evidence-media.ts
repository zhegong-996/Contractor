/**
 * 跨 surface 证据契约（对齐 lobehub/acceptance `references/evidence.md`，Apache-2.0）。
 *
 * 把「什么证据类型证明什么」做成一条共享契约：
 *   - 8 种媒体类型，每种有各自的使用时机；
 *   - 每个文件证据都必须有描述（description），不能靠文件名兜底；
 *   - audio 证据有额外校验（播放的是内容本身，不是播放器截图）。
 */

export const EVIDENCE_MEDIA = [
  'text', 'markdown', 'dom_snapshot', 'screenshot', 'gif', 'video', 'audio', 'transcript',
] as const;
export type EvidenceMedia = (typeof EVIDENCE_MEDIA)[number];

/** 每种媒体类型「什么时候用」的一句话。 */
export const EVIDENCE_MEDIA_USE: Record<EvidenceMedia, string> = {
  text: '命令输出、日志、聚焦的请求/响应、或计算出来的断言',
  markdown: '面向评审的推理说明或结构化发现，应作为正文渲染',
  dom_snapshot: '结构化内容比像素更强、更小',
  screenshot: '一个稳定的视觉状态、布局或原生渲染本身就是要证明的东西',
  gif: '短时间的时序状态（一般 ≤ 10 秒）',
  video: '较长的动画、转场、手势或多步流程',
  audio: '交付物是用户「听到」的东西——TTS、语音回复、提示音',
  transcript: '一段对话、事件流或请求日志本身就是证明',
};

/** 按扩展名推断媒体类型（对齐上游 audio 的扩展名白名单）。 */
export function mediaTypeOf(extOrPath: string): EvidenceMedia | null {
  const ext = String(extOrPath).split('.').pop()!.toLowerCase();
  switch (ext) {
    case 'txt': case 'log': case 'json': case 'jsonl': return 'text';
    case 'md': case 'markdown': return 'markdown';
    case 'html': return 'dom_snapshot';
    case 'png': case 'jpg': case 'jpeg': case 'webp': return 'screenshot';
    case 'gif': return 'gif';
    case 'mp4': case 'mov': case 'webm': return 'video';
    case 'mp3': case 'wav': case 'm4a': case 'aac': case 'flac': case 'ogg': case 'opus': return 'audio';
    case 'srt': case 'vtt': return 'transcript';
    default: return null;
  }
}

export interface EvidenceEntry {
  path: string;
  description?: string;
  type?: EvidenceMedia;
  /** 视频证据的章节（见 video-chapters.ts）。 */
  chapters?: unknown[];
}

export type EvidenceValidateResult = { ok: boolean; errors: string[] };

/**
 * 校验一条文件证据：描述必填且不能是文件名/路径/「JSON」这类无信息文本；
 * 类型缺失时按扩展名推断；视频章节畸形时告警（但不改证据本身）。
 */
export function validateEvidence(entry: EvidenceEntry): EvidenceValidateResult {
  const errors: string[] = [];
  const description = String(entry.description ?? '').trim();
  if (!description) errors.push('证据缺少描述（description 必填）');
  else if (/^(json|evidence|文件|截图|录屏|附件)$/i.test(description) || description === entry.path) {
    errors.push('描述不能只是文件名/路径/「JSON」，要说明内容和它为什么证明该条标准');
  }
  const type = entry.type ?? mediaTypeOf(entry.path);
  if (!type) errors.push(`无法从扩展名推断证据类型：${entry.path}`);
  if (entry.chapters && type === 'video') {
    // 章节校验交给 video-chapters.validateChapters；这里只提示它们只对 video 有意义。
  } else if (entry.chapters && type !== 'video') {
    errors.push('章节只对 video 证据有意义，其它类型会被忽略');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * audio 证据的「可审计配对」：播放的音频文件本身是证据，配一条 text 说明
 * 说了什么（输入文本、声音/模型、实测时长），否则只有播放器、无法核对内容。
 */
export function audioEvidencePair(audio: EvidenceEntry, text?: EvidenceEntry): { ok: boolean; reason: string } {
  if (audio.type !== 'audio') return { ok: true, reason: '' };
  if (!text || !String(text.description ?? '').trim()) {
    return { ok: false, reason: 'audio 证据应配一条 text 说明「说了什么」（输入文本/声音/时长），否则无法核对内容' };
  }
  return { ok: true, reason: '' };
}
