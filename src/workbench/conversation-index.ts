import type { DatabaseSync } from 'node:sqlite';
import type { Project } from './config.ts';
import { WorkbenchError } from './errors.ts';

type Topic = { id: string; title: string };
type Ports = {
  projects(actor: string, project?: string): Project[];
  topics(project: Project): Topic[];
  scope(project: Project, actor: string, target: { topic?: string; ticket?: string }): string;
};

export type ConversationIndexFilters = { project?: string; q?: string; archived?: boolean; after?: string; limit?: number };
type ConversationRow = {
  project: string; projectTitle: string; scope: string; title: string; updatedAt: string;
  ticket: string | null; topic: string | null; source: string | null; archived: number;
};

function cursor(after?: string) {
  if (!after) return;
  const [updatedAt, project, scope, ...rest] = Buffer.from(after, 'base64url').toString().split('\n');
  if (rest.length || updatedAt === undefined || updatedAt && !Number.isFinite(Date.parse(updatedAt))
    || !project || !/^[\w-]+$/.test(project) || !scope || !/^(?:project|(?:topic|ticket):[\w-]+)$/.test(scope))
    throw new WorkbenchError('会话分页游标无效。');
  return [updatedAt, project, scope] as const;
}

export function openConversationIndex(db: DatabaseSync, ports: Ports) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_conversation_archive (
    actor TEXT NOT NULL, project TEXT NOT NULL, scope TEXT NOT NULL, PRIMARY KEY(actor,project,scope)
  );`);

  return {
    list(actor: string, filters: ConversationIndexFilters = {}) {
      const catalog = ports.projects(actor, filters.project).flatMap(project => [
        { project: project.id, projectTitle: project.title, scope: 'project', title: '项目讨论', topic: null },
        ...ports.topics(project).map(topic => ({
          project: project.id, projectTitle: project.title, scope: 'topic:' + topic.id, title: topic.title, topic: topic.id,
        })),
      ]);
      const after = cursor(filters.after);
      const limit = Math.min(100, Math.max(1, filters.limit ?? 30));
      const query = filters.q?.trim() ?? '';
      const rows = db.prepare(`WITH catalog AS (
        SELECT json_extract(value,'$.project') AS project, json_extract(value,'$.scope') AS scope,
               json_extract(value,'$.projectTitle') AS projectTitle, json_extract(value,'$.title') AS title,
               json_extract(value,'$.topic') AS topic FROM json_each(?)
      ), conversations AS (
        SELECT c.*, NULL AS ticket, NULL AS source, COALESCE((
          SELECT MAX(m.at) FROM workbench_conversation_message m
          WHERE m.project=c.project AND (m.scope=c.scope OR (c.topic IS NOT NULL AND m.scope=c.scope||':private:'||?))
        ), '') AS updatedAt FROM catalog c
        UNION ALL
        SELECT c.project,'ticket:'||t.id,c.projectTitle,json_extract(t.value,'$.title'),
               json_extract(w.value,'$.topic'),t.id,json_extract(w.value,'$.source'),
               MAX(json_extract(t.value,'$.updatedAt'), COALESCE((
                 SELECT MAX(m.at) FROM workbench_conversation_message m WHERE m.project=c.project AND m.scope='ticket:'||t.id
               ), ''))
        FROM workbench_ticket w JOIN catalog c ON c.scope='project' AND c.project=json_extract(w.value,'$.project')
        JOIN ticket t ON t.id=w.id WHERE json_extract(w.value,'$.consultation') IS NULL
      )
      SELECT c.*, a.actor IS NOT NULL AS archived FROM conversations c
      LEFT JOIN workbench_conversation_archive a ON a.actor=? AND a.project=c.project AND a.scope=c.scope
      WHERE (a.actor IS NOT NULL)=? AND instr(lower(c.title||' '||c.projectTitle),lower(?))>0
      ${after ? 'AND (c.updatedAt,c.project,c.scope)<(?,?,?)' : ''}
      ORDER BY c.updatedAt DESC,c.project DESC,c.scope DESC LIMIT ?`)
        .all(JSON.stringify(catalog), actor, actor, filters.archived ? 1 : 0, query, ...(after ?? []), limit + 1) as ConversationRow[];
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return { rows: items, next: last && rows.length > limit
        ? Buffer.from([last.updatedAt, last.project, last.scope].join('\n')).toString('base64url') : undefined };
    },
    archive(actor: string, project: string, target: { topic?: string; ticket?: string; archived: boolean }) {
      const selected = ports.projects(actor, project)[0]!;
      const scope = ports.scope(selected, actor, target);
      db.prepare(target.archived
        ? 'INSERT OR IGNORE INTO workbench_conversation_archive(actor,project,scope) VALUES (?,?,?)'
        : 'DELETE FROM workbench_conversation_archive WHERE actor=? AND project=? AND scope=?').run(actor, project, scope);
      return { archived: target.archived };
    },
  };
}
