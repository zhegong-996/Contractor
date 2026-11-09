import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { KnowledgeRef } from './knowledge.ts';

export type Task = { id: string; identifier: string; triggerId: string; chatId: string; messageId: string; senderId: string;
  agent: string; workspace: string; branch: string; context: string; generation: number;
  phase: string; session?: string; runId?: string; lastMessage?: string; delivery?: Delivery; lease?: string; knowledgeRefs?: KnowledgeRef[]; kind?: 'development' | 'collaboration' | 'knowledge' };
export type Delivery = { pr: number; url: string; headSha: string; ci: 'pending' | 'passed' | 'failed'; merged: boolean;
  mergeSha?: string; artifactKind?: 'page' | 'files'; environment?: string; deployedSha?: string; previewUrl?: string; artifactRunId?: number };

export class Store {
  readonly db: DatabaseSync;
  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, trigger_id TEXT UNIQUE NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, state TEXT NOT NULL, value TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, issue_id TEXT, value TEXT NOT NULL);`);
    // 第三十八轮 · 旧库原地补 outbox.at（重试健康要算积压时长）。SQLite 没有
    // ADD COLUMN IF NOT EXISTS，重复执行会报错，这里按「已存在就跳过」处理。
    const columns = this.db.prepare('PRAGMA table_info(outbox)').all() as { name: string }[];
    if (!columns.some(column => column.name === 'at')) this.db.exec('ALTER TABLE outbox ADD COLUMN at TEXT');
  }
  list(): Task[] { return (this.db.prepare('SELECT value FROM tasks').all() as { value: string }[]).map(r => JSON.parse(r.value)); }
  get(id: string): Task {
    const task = this.list().find(t => t.id === id || t.identifier.toLowerCase() === id.toLowerCase());
    if (!task) throw new Error('Task not found'); return task;
  }
  byTrigger(id: string): Task | undefined { const row = this.db.prepare('SELECT value FROM tasks WHERE trigger_id=?').get(id) as { value: string } | undefined; return row && JSON.parse(row.value); }
  save(task: Task) { this.db.prepare('INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(task.id, task.triggerId, JSON.stringify(task)); }
  atomic<T>(work: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const value = work(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  claim(id: string, agent: string, lease: string): Task {
    return this.atomic(() => { const task = this.get(id); if (task.agent !== agent) throw new Error('Task belongs to another agent');
      if (task.lease && task.lease !== lease) throw new Error('Task already claimed');
      if (!['ready', 'waiting', 'running'].includes(task.phase)) throw new Error('Task cannot be claimed in this phase');
      task.lease = lease; task.phase = 'running'; this.save(task); return task; });
  }
  audit(action: string, issueId: string | null, value: unknown) { this.db.prepare('INSERT INTO audit(at,action,issue_id,value) VALUES(?,?,?,?)').run(new Date().toISOString(), action, issueId, JSON.stringify(value)); }
  notify(id: string, issueId: string, text: string) {
    // 第三十八轮 · 出站队列加 at（投递时刻）：没有它就算不出「积压了多久」，
    // 重试健康只能看状态分布，看不出「卡住的是一条还是四条」。旧库原地补列。
    this.db.prepare('INSERT OR IGNORE INTO outbox(id,issue_id,text,at) VALUES(?,?,?,?)').run(id, issueId, text, new Date().toISOString());
  }
  close() { this.db.close(); }
}
