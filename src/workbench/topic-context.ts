import type { DatabaseSync } from 'node:sqlite';
import { digest } from './knowledge.ts';
import { WorkbenchError } from './errors.ts';

export type TopicContextSource = 'web' | 'feishu';
export type TopicContextRef = { id: string; source: TopicContextSource; topic: string; revision: string };
export type TopicMessage = TopicContextRef & { actor: string; at: string; text: string; url?: string };
type Confirmation = { actor: string; at: string };

export function openTopicContext(db: DatabaseSync, feishu: {
  read(project: string, topic: string, id: string): TopicMessage | undefined;
  recent(project: string, topic: string): TopicMessage[];
}, canUse: (project: string, actor: string, text: string) => boolean) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_topic_basis (
    ticket TEXT NOT NULL, topic TEXT NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL,
    revision TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, active INTEGER NOT NULL,
    PRIMARY KEY(ticket,topic,source,message,revision)
  );`);
  type Row = { id: string; actor: string; at: string; text: string };
  const webQuery = `SELECT id,actor,at,text FROM workbench_conversation_message m WHERE project=? AND scope=?
    AND NOT EXISTS(SELECT 1 FROM workbench_topic_consultation c WHERE c.message=m.id)`;
  const webMessage = (topic: string, row: Row): TopicMessage => ({ ...row, topic, source: 'web', revision: digest(row) });
  function read(project: string, ref: Pick<TopicContextRef, 'source' | 'id' | 'topic'>) {
    const row = ref.source === 'web' ? db.prepare(webQuery + ' AND m.id=?').get(project, 'topic:' + ref.topic, ref.id) as Row | undefined : undefined;
    const value = ref.source === 'web' ? row && webMessage(ref.topic, row) : feishu.read(project, ref.topic, ref.id);
    if (value && canUse(project, value.actor, value.text)) return value;
  }
  function confirmed(ticket: string, project: string, topic: string) {
    return (db.prepare(`SELECT topic,source,message AS id,revision,actor,at FROM workbench_topic_basis
      WHERE ticket=? AND topic=? AND active=1 ORDER BY at DESC,id`).all(ticket, topic) as (TopicContextRef & Confirmation)[]).map(row => {
      const message = read(project, row);
      return { id: row.id, topic, source: row.source, revision: row.revision, confirmed: { actor: row.actor, at: row.at },
        message: message?.revision === row.revision ? message : undefined };
    });
  }
  function view(ticket: string, project: string, topic: string) {
    const basis = confirmed(ticket, project, topic);
    const rows = (db.prepare(webQuery + ' ORDER BY m.rowid DESC LIMIT 16').all(project, 'topic:' + topic) as Row[]).map(row => webMessage(topic, row));
    const recent = [...rows, ...feishu.recent(project, topic)].filter(row => canUse(project, row.actor, row.text))
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).slice(-12);
    return { basis, recent };
  }
  function set(ticket: string, project: string, ref: TopicContextRef, actor: string, active: boolean) {
    if (!active) {
      return db.prepare(`UPDATE workbench_topic_basis SET active=0 WHERE ticket=? AND topic=? AND source=? AND message=? AND revision=? AND active=1`)
        .run(ticket, ref.topic, ref.source, ref.id, ref.revision).changes === 1;
    }
    const message = read(project, ref);
    if (!message || message.revision !== ref.revision) throw new WorkbenchError('这条主题消息已修改、撤回或失去访问权限。', 409);
    const rows = confirmed(ticket, project, ref.topic);
    if (rows.some(row => row.id === ref.id && row.source === ref.source && row.revision === ref.revision)) return false;
    if (rows.filter(row => row.message && (row.id !== ref.id || row.source !== ref.source)).length >= 8)
      throw new WorkbenchError('同一工单最多保留 8 条已确认主题依据。', 409);
    db.prepare('UPDATE workbench_topic_basis SET active=0 WHERE ticket=? AND topic=? AND source=? AND message=?')
      .run(ticket, ref.topic, ref.source, ref.id);
    db.prepare(`INSERT INTO workbench_topic_basis VALUES (?,?,?,?,?,?,?,1)
      ON CONFLICT(ticket,topic,source,message,revision) DO UPDATE SET actor=excluded.actor,at=excluded.at,active=1`)
      .run(ticket, ref.topic, ref.source, ref.id, ref.revision, actor, new Date().toISOString());
    return true;
  }
  return { view, set, valid(project: string, refs?: readonly TopicContextRef[]) {
    return !refs || refs.every(ref => read(project, ref)?.revision === ref.revision);
  } };
}
