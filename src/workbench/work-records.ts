import { waitsForPerson, type Ticket, type Trigger } from '../../upstream/superagent/src/core/index.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import type { Project } from './config.ts';
import { requireValue, WorkbenchError } from './errors.ts';
import { measureSchema } from './learning.ts';
import type { ResourceView } from './project-resources.ts';
import type { ExpertAuthority } from './octop-resources.ts';
import type { DevelopmentTarget } from './development.ts';
import type { Work } from './work-types.ts';
import { verifyDeliveryTopic, type DeliveryTemplate } from './delivery-template.ts';

export const privateConsultationVisible = (work: Work | undefined, actor: string | undefined) =>
  !work?.consultation?.private || actor === work.requester;

export type TicketCursor = { updatedAt: string; id: string };

export function openWorkRecords(store: SuperAgentStore, projectFor: (id: string, actor: string) => Project,
  freezeTemplate?: (project: string, target: DevelopmentTarget) => DeliveryTemplate | undefined) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS workbench_ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workbench_ticket_watch(member TEXT NOT NULL,ticket TEXT NOT NULL,PRIMARY KEY(member,ticket));
    CREATE INDEX IF NOT EXISTS workbench_ticket_project_parent ON workbench_ticket(json_extract(value,'$.project'),json_extract(value,'$.parent'));
    CREATE INDEX IF NOT EXISTS workbench_ticket_recent ON ticket(json_extract(value,'$.updatedAt') DESC,id DESC);`);

  const decode = (rows: Record<string, unknown>[]) => rows.map(row => ({
    ticket: JSON.parse(String(row.ticket)) as Ticket, work: JSON.parse(String(row.work)) as Work,
  }));
  const readable = `(COALESCE(json_extract(w.value,'$.consultation.private'),0)=0 OR json_extract(w.value,'$.requester')=?)`;
  const source = 'SELECT t.value AS ticket,w.value AS work FROM ticket t JOIN workbench_ticket w ON w.id=t.id';
  function recent(actor: string, projects: string[], limit: number, cursor?: TicketCursor, watching = false) {
    if (!projects.length) return [];
    const time = "json_extract(t.value,'$.updatedAt')";
    return decode(store.db.prepare(`${source} WHERE ${readable}
      ${watching ? 'AND EXISTS (SELECT 1 FROM workbench_ticket_watch f WHERE f.ticket=w.id AND f.member=?)' : ''}
      AND json_extract(w.value,'$.project') IN (SELECT value FROM json_each(?))
      ${cursor ? `AND (${time},t.id)<(?,?)` : ''}
      ORDER BY ${time} DESC,t.id DESC LIMIT ?`).all(actor, ...(watching ? [actor] : []), JSON.stringify(projects),
        ...(cursor ? [cursor.updatedAt, cursor.id] : []), limit));
  }
  function engineeringStats(project: string, claimed: (lane: string) => boolean) {
    const rows = store.db.prepare(`SELECT w.id, json_extract(w.value,'$.agent') AS agent,
      json_extract(w.value,'$.lane') AS lane, json_extract(w.value,'$.executionBlock.kind') AS block,
      json_extract(t.value,'$.assignments[#-1].state') AS assignment,
      CASE WHEN json_extract(t.value,'$.assignments[#-1].report.state') IN ('blocked','failed') THEN t.value END AS stalled
      FROM workbench_ticket w JOIN ticket t ON t.id=w.id WHERE json_extract(w.value,'$.project')=?
        AND json_extract(w.value,'$.consultation') IS NULL AND COALESCE(json_extract(w.value,'$.personal'),0)=0
        AND json_extract(t.value,'$.ended') IS NULL`).all(project);
    const active = new Set<string>();
    let blocked = 0;
    for (const row of rows) {
      if (row.assignment === 'running' && !active.has(String(row.agent)) && claimed(String(row.lane ?? row.id))) active.add(String(row.agent));
      if (row.block || row.stalled && waitsForPerson(JSON.parse(String(row.stalled)))) blocked++;
    }
    const waiting = store.db.prepare(`SELECT w.id,json_extract(t.value,'$.title') AS title, COUNT(*) OVER () AS total
      FROM workbench_ticket w JOIN ticket t ON t.id=w.id JOIN workbench_engineering_decision e ON e.ticket=w.id
      WHERE json_extract(w.value,'$.project')=? AND json_extract(w.value,'$.accepted') IS NULL
        AND (json_extract(t.value,'$.ended') IS NULL OR json_extract(t.value,'$.ended.outcome')='completed')
        AND json_extract(e.value,'$.version')=COALESCE(json_extract(w.value,'$.version'),1)
        AND json_extract(e.value,'$.sha') IS json_extract(w.value,'$.delivery.headSha')
        AND json_extract(e.value,'$.state')='open' ORDER BY e.rowid LIMIT 5`).all(project).map(r => ({ id: String(r.id), title: String(r.title), total: Number(r.total) }));
    return { active: active.size, blocked, decisions: waiting[0]?.total ?? 0, waiting: waiting.map(({ id, title }) => ({ id, title })) };
  }
  function children(actor: string, project: string, parent: string) {
    return decode(store.db.prepare(`${source} WHERE ${readable} AND json_extract(w.value,'$.project')=?
      AND json_extract(w.value,'$.parent')=? ORDER BY t.rowid`).all(actor, project, parent));
  }

  const workOf = (id: string): Work | undefined => {
    const row = store.db.prepare('SELECT value FROM workbench_ticket WHERE id=?').get(id);
    return row && JSON.parse(String(row.value));
  };
  const saveWork = (id: string, work: Work) => store.db.prepare('UPDATE workbench_ticket SET value=? WHERE id=?')
    .run(JSON.stringify(work), id);
  const ticketFor = (id: string, actor: string) => {
    const ticket = requireValue(store.tickets.get(id), '找不到这个工单。');
    const work = requireValue(workOf(ticket.id), '工单缺少项目记录。');
    if (!privateConsultationVisible(work, actor)) throw new WorkbenchError('找不到这个工单。', 404);
    const project = projectFor(work.project, actor);
    return { ticket, work, project };
  };

  function createForMandate(id: string, event: Trigger) {
    const work: Work = { project: String(event.meta.project), requester: event.actor.id,
      agent: String(event.meta.agent), agentVersion: String(event.meta.agentVersion), function: String(event.meta.function),
      octop: event.meta.octop as ExpertAuthority | undefined,
      material: event.meta.material as string[], source: event.source === 'feishu' || (event.meta.consultation as Work['consultation'])?.feishu ? 'feishu'
        : (event.meta.consultation as Work['consultation'])?.octopIM ? 'octop' : event.source === 'github' ? 'github' : 'web',
      priority: event.meta.priority === 'urgent' ? 'urgent' : 'normal',
      ...(event.meta.parent ? { parent: String(event.meta.parent) } : {}),
      ...(event.meta.delegatedVia ? { delegatedVia: event.meta.delegatedVia as Work['delegatedVia'] } : {}),
      ...(event.meta.topic ? { topic: String(event.meta.topic) } : {}),
      ...(typeof event.meta.goal === 'string' ? { goal: event.meta.goal } : {}),
      ...(event.meta.consultation ? { consultation: event.meta.consultation as Work['consultation'] } : {}),
      ...(Array.isArray(event.meta.recall) && event.meta.recall.length ? { recall: event.meta.recall as string[] } : {}),
      ...(event.meta.personal === true ? { personal: true } : {}),
      ...(typeof event.meta.device === 'string' ? { device: event.meta.device } : {}),
      ...(event.meta.productCases ? { productCases: event.meta.productCases as Work['productCases'] } : {}),
      ...(event.meta.reusedAcceptance ? { reusedAcceptance: event.meta.reusedAcceptance as Work['reusedAcceptance'] } : {}),
      ...(Array.isArray(event.meta.resources) && event.meta.resources.length ? { resources: event.meta.resources as ResourceView[] } : {}),
      version: 1,
      ...(event.meta.development ? { development: event.meta.development as DevelopmentTarget,
        approvalRequired: true, developmentApproval: event.meta.developmentApproval as Work['developmentApproval'] } : {}),
      ...(event.meta.measure ? { measure: measureSchema.parse(event.meta.measure) } : {}),
      ...(event.meta.reusedLesson ? { reusedLesson: String(event.meta.reusedLesson) } : {}) };
    if (work.development) work.deliveryTemplate = event.meta.deliveryTemplate === undefined
      ? freezeTemplate?.(work.project, work.development) : (event.meta.deliveryTemplate as DeliveryTemplate | null) ?? undefined;
    verifyDeliveryTopic(work.deliveryTemplate, work.topic);
    store.db.prepare('INSERT INTO workbench_ticket VALUES (?,?)').run(id, JSON.stringify(work));
    return work;
  }
  function setWatching(actor: string, id: string, active: boolean) {
    ticketFor(id, actor);
    if (active) store.db.prepare('INSERT OR IGNORE INTO workbench_ticket_watch VALUES (?,?)').run(actor, id);
    else store.db.prepare('DELETE FROM workbench_ticket_watch WHERE member=? AND ticket=?').run(actor, id);
    return { active };
  }
  const watching = (actor: string, id: string) => !!store.db.prepare('SELECT 1 FROM workbench_ticket_watch WHERE member=? AND ticket=?').get(actor, id);
  return { setWatching, watching, workOf, saveWork, ticketFor, createForMandate, recent, children, engineeringStats };
}
