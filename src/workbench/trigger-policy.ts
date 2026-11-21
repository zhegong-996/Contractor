import type { SuperAgentStore } from '../superagent-ports.ts';
import { triggerPolicy, type Project, type TriggerPolicy } from './config.ts';
import { digest } from './knowledge.ts';

export type WakeRecord = {
  project: string; chat: string; at: string; message: string; text: string; keyword: string; member?: string;
};

/**
 * 触发策略账本：项目级唤醒关键词、灵敏度与沉默期，以及唤醒记录。
 * 策略存于 workbench_project_trigger，唤醒记录存于 workbench_trigger_wake（只追加）。
 */
export function openTriggerPolicies(store: Pick<SuperAgentStore, 'db'>, projects: Project[]) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_project_trigger (project TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workbench_trigger_wake (
      project TEXT NOT NULL, chat TEXT NOT NULL, at TEXT NOT NULL, message TEXT NOT NULL,
      text TEXT NOT NULL, keyword TEXT NOT NULL, member TEXT
    );
    CREATE INDEX IF NOT EXISTS workbench_trigger_wake_project ON workbench_trigger_wake(project, chat, at);
  `);
  for (const project of projects) {
    const row = store.db.prepare('SELECT value FROM workbench_project_trigger WHERE project=?').get(project.id);
    if (!row) continue;
    try { project.trigger = triggerPolicy.parse(JSON.parse(String(row.value))); } catch { /* 沿用配置默认值 */ }
  }
  const current = (project: Project) => {
    const policy = project.trigger ?? { keywords: [], sensitivity: 'balanced', silenceMinutes: 0, mentionAlways: true };
    return { revision: digest(policy), ...policy } as TriggerPolicy & { revision: string };
  };
  const save = (project: Project, policy: TriggerPolicy) => {
    store.db.prepare('INSERT OR REPLACE INTO workbench_project_trigger VALUES (?,?)')
      .run(project.id, JSON.stringify(policy));
    project.trigger = policy;
  };
  const wake = (record: WakeRecord) => store.db.prepare(
    'INSERT INTO workbench_trigger_wake(project, chat, at, message, text, keyword, member) VALUES (?,?,?,?,?,?,?)',
  ).run(record.project, record.chat, record.at, record.message, record.text.slice(0, 240), record.keyword, record.member ?? null);
  const lastWake = (project: string, chat: string) => {
    const row = store.db.prepare(
      'SELECT MAX(at) AS at FROM workbench_trigger_wake WHERE project=? AND chat=?').get(project, chat);
    const at = row && typeof row.at === 'string' ? Date.parse(row.at) : undefined;
    return Number.isFinite(at) ? at : undefined;
  };
  const recent = (project: string, limit = 50): WakeRecord[] => store.db.prepare(
    'SELECT project, chat, at, message, text, keyword, member FROM workbench_trigger_wake WHERE project=? ORDER BY at DESC LIMIT ?',
  ).all(project, Math.min(limit, 200)).map(row => ({
    project: String(row.project), chat: String(row.chat), at: String(row.at), message: String(row.message),
    text: String(row.text), keyword: String(row.keyword), member: row.member ? String(row.member) : undefined,
  }));
  return { current, save, wake, lastWake, recent };
}
