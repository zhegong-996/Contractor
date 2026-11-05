// v0.6 storage boundary (PRD R1 / 第 4 节「落地层」).
//
// * Organization-level configuration (Role Registry, Grant Policy, Workspace
//   policy) lives in the LOCAL CONFIG layer, exactly like config.json and
//   knowledge-workspaces.json. It is not a second business database.
// * Task-level facts (Transfer, Context Grant, edge states, signals) are
//   written as Paperclip native issue documents so revisions, ACL and audit
//   stay with the existing source of truth.
// * SQLite is used only for audit / idempotency, via Store.audit.
//
// Everything is injectable so contracts can be tested without a running
// Paperclip instance.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runtime } from './config.ts';

export interface Stored<T> { value: T; revision: string }

export interface V06Store {
  readConfig<T>(key: string): Promise<Stored<T> | null>;
  writeConfig<T>(key: string, value: T, expectedRevision: string | null): Promise<string>;
  readTaskDoc<T>(taskId: string, key: string): Promise<Stored<T> | null>;
  writeTaskDoc<T>(taskId: string, key: string, value: T): Promise<string>;
}

export interface DocClient {
  get<T = any>(route: string): Promise<T>;
  document(issueId: string, key: string, title: string, body: string): Promise<any>;
}

export const encodeDoc = (value: unknown): string =>
  `# v0.6 结构化记录\n\n本记录由原生文档修订保护，任何改写都会产生新修订。\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

export function decodeDoc<T>(body: string): T | null {
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(String(body ?? ''));
  if (!match) return null;
  try { return JSON.parse(match[1]!) as T; } catch { return null; }
}

const revisionOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

/** Local config files + Paperclip native documents. */
export class RuntimeV06Store implements V06Store {
  constructor(readonly pc: DocClient, readonly dir = runtime('v06')) {}
  private file(key: string) { return path.join(this.dir, `${key}.json`); }
  async readConfig<T>(key: string): Promise<Stored<T> | null> {
    const file = this.file(key);
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { value: parsed.value as T, revision: String(parsed.revision) };
  }
  async writeConfig<T>(key: string, value: T, expectedRevision: string | null): Promise<string> {
    const current = await this.readConfig<T>(key);
    if ((current?.revision ?? null) !== expectedRevision) throw new Error('配置已变化，请刷新后再保存');
    mkdirSync(this.dir, { recursive: true });
    const revision = revisionOf({ key, value, at: new Date().toISOString(), previous: expectedRevision });
    const file = this.file(key);
    writeFileSync(file + '.tmp', JSON.stringify({ value, revision }, null, 2), { mode: 0o600 });
    renameSync(file + '.tmp', file);
    return revision;
  }
  async readTaskDoc<T>(taskId: string, key: string): Promise<Stored<T> | null> {
    let doc: any;
    try { doc = await this.pc.get(`/issues/${taskId}/documents/${key}`); }
    catch (error) { if (String(error).includes(': 404 ')) return null; throw error; }
    const value = decodeDoc<T>(String(doc?.body ?? ''));
    return value === null ? null : { value, revision: String(doc?.latestRevisionId ?? doc?.currentRevisionId ?? '') };
  }
  async writeTaskDoc<T>(taskId: string, key: string, value: T): Promise<string> {
    await this.pc.document(taskId, key, `v0.6 ${key}`, encodeDoc(value));
    const stored = await this.readTaskDoc<T>(taskId, key);
    return stored?.revision ?? revisionOf(value);
  }
}

/** In-memory implementation for contract tests; no filesystem, no network. */
export class MemoryV06Store implements V06Store {
  readonly config = new Map<string, Stored<any>>();
  readonly docs = new Map<string, Stored<any>>();
  async readConfig<T>(key: string): Promise<Stored<T> | null> { return (this.config.get(key) as Stored<T>) ?? null; }
  async writeConfig<T>(key: string, value: T, expectedRevision: string | null): Promise<string> {
    const current = this.config.get(key);
    if ((current?.revision ?? null) !== expectedRevision) throw new Error('配置已变化，请刷新后再保存');
    const revision = revisionOf({ key, value, previous: expectedRevision, seq: this.config.size });
    this.config.set(key, { value, revision }); return revision;
  }
  async readTaskDoc<T>(taskId: string, key: string): Promise<Stored<T> | null> { return (this.docs.get(`${taskId}:${key}`) as Stored<T>) ?? null; }
  async writeTaskDoc<T>(taskId: string, key: string, value: T): Promise<string> {
    const revision = revisionOf({ taskId, key, value, seq: this.docs.size });
    this.docs.set(`${taskId}:${key}`, { value, revision }); return revision;
  }
}
