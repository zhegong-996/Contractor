/**
 * 产物与续改链：同一份文件接着改，而不是存一堆版本。
 *
 * 出处：千问办公的「资料空间里勾选旧表 → 原文件接着改」，以及「跨群对账」的前提——
 * 得先知道「当前这一版是谁在哪个任务里改出来的」。
 *
 * 三条边界：
 * - 产物是「引用 + 修订号」，不是文件内容本身；内容仍在原来的地方（文档 / 报告 / 表）。
 * - 续改是新任务接在旧修订上，**不复制**旧产物；旧修订永久保留，能回答「这一版哪来的」。
 * - 只登记事实，不建任务、不派活：真正建任务走既有派活链路，这里只把「接哪儿」说清楚。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ArtifactRevision {
  revision: string;
  /** 是哪次任务产出的这一版；空表示人工登记。 */
  taskId: string | null;
  at: string;
  by: string;
  summary: string;
}

export interface Artifact {
  schemaVersion: 1;
  /** 稳定引用，例如 `report:SUI-128` 或 `sheet:budget-2026`。 */
  ref: string;
  title: string;
  current: string;
  revisions: ArtifactRevision[];
  createdAt: string;
  updatedAt: string;
}

export interface Continuation {
  id: string;
  ref: string;
  /** 从哪一版接着改。 */
  fromRevision: string;
  /** 接续产生的新任务；还没建任务时为空。 */
  toTaskId: string | null;
  at: string;
  by: string;
  note: string;
}

export const artifactDir = (dir: string) => path.join(dir, 'artifacts');
export const continuationFile = (dir: string) => path.join(dir, 'artifact-continuations.json');

/** ref 里可能有冒号、斜杠，落盘要转成安全文件名。 */
export function artifactKey(ref: string): string {
  const clean = String(ref ?? '').trim();
  if (!clean) throw new Error('产物引用不能为空');
  return createHash('sha256').update(clean).digest('hex').slice(0, 16);
}

const fileOf = (dir: string, ref: string) => path.join(artifactDir(dir), `${artifactKey(ref)}.json`);

function readJson<T>(file: string): T | null {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : null; } catch { return null; }
}

export function readArtifact(dir: string, ref: string): Artifact | null {
  return readJson<Artifact>(fileOf(dir, ref));
}

export function listArtifacts(dir: string): Artifact[] {
  if (!existsSync(artifactDir(dir))) return [];
  return readdirSync(artifactDir(dir))
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<Artifact>(path.join(artifactDir(dir), name)))
    .filter((item): item is Artifact => Boolean(item?.ref))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/**
 * 登记一版产物。同一个 ref + revision 重复登记是幂等的（返回原样），
 * 因为对账、巡检都可能重复触发同一次落库。
 */
export function registerArtifact(dir: string, input: {
  ref: string; title?: string; taskId?: string | null; revision: string;
  by: string; summary?: string; at?: string;
}): Artifact {
  const ref = String(input.ref ?? '').trim();
  const revision = String(input.revision ?? '').trim();
  if (!ref) throw new Error('产物引用不能为空');
  if (!revision) throw new Error('修订号不能为空：没有修订号就无法回答「这一版哪来的」');
  const at = input.at ?? new Date().toISOString();
  const existing = readArtifact(dir, ref);
  const artifact: Artifact = existing ?? {
    schemaVersion: 1, ref, title: input.title?.trim() || ref,
    current: revision, revisions: [], createdAt: at, updatedAt: at,
  };
  if (artifact.revisions.some(item => item.revision === revision)) return artifact;
  artifact.revisions.push({ revision, taskId: input.taskId ?? null, at, by: input.by,
    summary: input.summary?.trim() || '' });
  artifact.current = revision;
  artifact.updatedAt = at;
  if (input.title?.trim()) artifact.title = input.title.trim();
  mkdirSync(artifactDir(dir), { recursive: true, mode: 0o700 });
  writeFileSync(fileOf(dir, ref), JSON.stringify(artifact, null, 2), { mode: 0o600 });
  return artifact;
}

export function listContinuations(dir: string): Continuation[] {
  const file = readJson<{ items?: Continuation[] }>(continuationFile(dir));
  return file?.items ?? [];
}

/**
 * 从既有产物起一次续改：记下「从哪一版接的」，并给出一份可执行的任务简述。
 * 不建任务 —— 建任务要过派活、准入、绑定，不该由一个登记动作顺手做掉。
 */
export function continueArtifact(dir: string, input: {
  ref: string; by: string; note?: string; goal?: string; at?: string;
}): { continuation: Continuation; artifact: Artifact; brief: string } {
  const artifact = readArtifact(dir, input.ref);
  if (!artifact) throw new Error(`产物 ${input.ref} 未登记，先登记再续改`);
  const at = input.at ?? new Date().toISOString();
  const continuation: Continuation = {
    id: `cont-${createHash('sha256').update(`${artifact.ref}|${artifact.current}|${at}`).digest('hex').slice(0, 10)}`,
    ref: artifact.ref, fromRevision: artifact.current, toTaskId: null, at, by: input.by,
    note: input.note?.trim() || '',
  };
  const items = [...listContinuations(dir), continuation];
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(continuationFile(dir), JSON.stringify({ items }, null, 2), { mode: 0o600 });
  const goal = input.goal?.trim();
  const brief = [
    `在「${artifact.title}」（${artifact.ref}）的 ${artifact.current} 版上接着改，不新建副本。`,
    goal ? `本次目标：${goal}` : '本次目标：待补充。',
    continuation.note ? `补充：${continuation.note}` : '',
    '产出仍落同一份产物，落库时登记新修订号；旧修订保留可追溯。',
  ].filter(Boolean).join('\n');
  return { continuation, artifact, brief };
}

/** 任务 → 最新产物修订号。巡检用它判断「产物有没有被改过」。 */
export function artifactRevisionByTask(dir: string): Record<string, string> {
  const marks: Record<string, string> = {};
  for (const artifact of listArtifacts(dir)) {
    for (const revision of artifact.revisions) {
      if (!revision.taskId) continue;
      // 同一任务可能产出多份产物，取字典序最大的修订号作为该任务的「最新」标记。
      const current = marks[revision.taskId];
      if (!current || revision.revision > current) marks[revision.taskId] = revision.revision;
    }
  }
  return marks;
}
