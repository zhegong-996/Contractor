/**
 * 验收报告内讨论（第四十一轮 · 对齐 lobehub/acceptance 的「报告内线程」）。
 *
 * 之前报告页只能看：逐项判定、证据引用、区域坐标。评审者和发起人想说一句
 * 「第 2 项的按钮在截图右上角被遮挡」只能另开一个渠道，说完就散。
 *
 * 这里补的是**讨论**，不是判定：
 *   - 追加式（append-only）：评论只能新增，正文不可改写；只有「已处理」这一个
 *     状态位可以由人来打；
 *   - 可挂到检查项或具体区域（区域的序号来自证据里的 regions 数组）；
 *   - 不参与 readiness 判定、不改变任何检查项的 status、不代替人签。
 *     讨论再多，「确认验收」仍然只能在原会话由原发起人完成。
 *
 * 存储落在本机 `.runtime/v06/acceptance-discussion/<taskId>.json`（0600），
 * 不上传、不进仓库、不读业务正文。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { runtime } from './config.ts';

export const DISCUSSION_BODY_LIMIT = 1000;
export const DISCUSSION_TARGETS = ['item', 'region', 'report'] as const;
export type DiscussionTargetKind = (typeof DISCUSSION_TARGETS)[number];

export type DiscussionTarget = {
  kind: DiscussionTargetKind;
  /** kind=item / region 时必填，对应验收清单的检查项 id。 */
  itemId?: string;
  /** kind=region 时必填，对应这一项 evidence.regions 的下标（0 起）。 */
  regionIndex?: number;
};

export type DiscussionComment = {
  id: string;
  at: string;
  author: string;
  target: DiscussionTarget;
  body: string;
  /** 只由人打的一个状态位：讨论是否已被处理（不影响判定）。 */
  resolvedAt?: string;
  resolvedBy?: string;
};

export type DiscussionFile = {
  schemaVersion: 1;
  taskId: string;
  comments: DiscussionComment[];
  updatedAt: string;
};

export type DiscussionDigest = {
  total: number;
  unresolved: number;
  byItem: Record<string, number>;
  note: string;
};

const safeTaskId = (taskId: string) => String(taskId).replace(/[^a-zA-Z0-9_-]/g, '_');

export function discussionFile(dir: string, taskId: string): string {
  return path.join(dir, 'acceptance-discussion', safeTaskId(taskId) + '.json');
}

export const discussionDir = () => runtime('v06');

export function listDiscussion(dir: string, taskId: string): DiscussionFile {
  const file = discussionFile(dir, taskId);
  if (!existsSync(file)) return { schemaVersion: 1, taskId, comments: [], updatedAt: '' };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as DiscussionFile;
    if (!Array.isArray(parsed?.comments)) return { schemaVersion: 1, taskId, comments: [], updatedAt: '' };
    return { schemaVersion: 1, taskId, comments: parsed.comments, updatedAt: parsed.updatedAt ?? '' };
  } catch {
    // 坏文件不猜内容：当成空线程，并且不覆盖它（写的时候会重新落一份）。
    return { schemaVersion: 1, taskId, comments: [], updatedAt: '' };
  }
}

function parseTarget(raw: unknown): DiscussionTarget {
  if (!raw || typeof raw !== 'object') throw new Error('讨论目标格式不正确');
  const target = raw as Record<string, unknown>;
  const kind = String(target.kind ?? '');
  if (!(DISCUSSION_TARGETS as readonly string[]).includes(kind)) throw new Error('讨论目标只能是 item / region / report');
  if (kind === 'report') return { kind: 'report' };
  const itemId = String(target.itemId ?? '').trim();
  if (!itemId) throw new Error('讨论必须指明检查项');
  if (kind === 'item') return { kind: 'item', itemId };
  const regionIndex = Number(target.regionIndex);
  if (!Number.isInteger(regionIndex) || regionIndex < 0 || regionIndex > 7)
    throw new Error('区域序号必须是 0-7 的整数（证据区域最多 8 个）');
  return { kind: 'region', itemId, regionIndex };
}

function write(dir: string, file: DiscussionFile): void {
  mkdirSync(path.dirname(discussionFile(dir, file.taskId)), { recursive: true, mode: 0o700 });
  const target = discussionFile(dir, file.taskId);
  writeFileSync(target + '.tmp', JSON.stringify(file, null, 2), { mode: 0o600 });
  renameSync(target + '.tmp', target);
}

/** 新增一条讨论。正文只读一次：没有 update 接口，改写只能新发一条。 */
export function addDiscussionComment(dir: string, input: {
  taskId: string; author: string; target: unknown; body: string; at?: string;
}): { comment: DiscussionComment; file: DiscussionFile } {
  const taskId = String(input.taskId ?? '').trim();
  if (!taskId) throw new Error('缺少任务 ID');
  const author = String(input.author ?? '').trim();
  if (!author) throw new Error('讨论必须留下作者身份');
  const body = String(input.body ?? '').trim();
  if (!body) throw new Error('讨论内容不能为空');
  if (body.length > DISCUSSION_BODY_LIMIT) throw new Error(`讨论内容最多 ${DISCUSSION_BODY_LIMIT} 字`);
  const target = parseTarget(input.target);
  const at = input.at ?? new Date().toISOString();
  const file = listDiscussion(dir, taskId);
  const comment: DiscussionComment = {
    id: 'dc-' + randomBytes(4).toString('hex'), at, author, target, body,
  };
  file.comments = [...file.comments, comment];
  file.updatedAt = at;
  write(dir, file);
  return { comment, file };
}

/**
 * 只改「已处理」状态位。正文与作者不可变——可见范围与判定口径都不因讨论而变。
 */
export function resolveDiscussionComment(dir: string, input: {
  taskId: string; commentId: string; actor: string; at?: string; resolved?: boolean;
}): { comment: DiscussionComment; file: DiscussionFile } {
  const at = input.at ?? new Date().toISOString();
  const resolved = input.resolved !== false;
  const file = listDiscussion(dir, input.taskId);
  const index = file.comments.findIndex(item => item.id === input.commentId);
  if (index < 0) throw new Error('没有这条讨论');
  const current = file.comments[index]!;
  const updated: DiscussionComment = resolved
    ? { ...current, resolvedAt: current.resolvedAt ?? at, resolvedBy: current.resolvedBy ?? input.actor }
    : { id: current.id, at: current.at, author: current.author, target: current.target, body: current.body };
  file.comments = file.comments.map((item, i) => (i === index ? updated : item));
  file.updatedAt = at;
  write(dir, file);
  return { comment: updated, file };
}

/** 汇总给工作台：只做计数，不参与判定。 */
export function discussionDigest(file: DiscussionFile): DiscussionDigest {
  const unresolved = file.comments.filter(item => !item.resolvedAt);
  const byItem: Record<string, number> = {};
  for (const item of unresolved) {
    const key = item.target.itemId ?? 'report';
    byItem[key] = (byItem[key] ?? 0) + 1;
  }
  return {
    total: file.comments.length,
    unresolved: unresolved.length,
    byItem,
    note: '讨论只供人看：不改变逐项判定，不替代原发起人在原会话「确认验收」',
  };
}
