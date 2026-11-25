import type { Ticket } from '../../upstream/superagent/src/core/index.ts';
import type { Agent, Project } from './config.ts';
import { WorkbenchError } from './errors.ts';
import { ticketListState, topicWithin, type TicketListFilters } from './ticket-list-state.ts';
import type { openWorkRecords, TicketCursor } from './work-records.ts';
import type { Work } from './work-types.ts';

type Row = Parameters<typeof ticketListState>[0];
type Ports<T extends Row> = {
  projects: (actor: string, id?: string) => Project[];
  pending: (actor: string) => Set<string>;
  read: ReturnType<typeof openWorkRecords>['recent'];
  topics: (project: Project) => { id: string; title: string; parent?: string }[];
  agent: (id: string) => Pick<Agent, 'title' | 'owner'> | undefined;
  summary: (actor: string, ticket: Ticket, work: Work, project: Project, pending: Set<string>) => T;
};

function decodeCursor(value?: string): TicketCursor | undefined {
  if (!value) return;
  const [updatedAt, id, ...rest] = Buffer.from(value, 'base64url').toString().split('\n');
  if (rest.length || !updatedAt || !Number.isFinite(Date.parse(updatedAt)) || !id || !/^[\w-]{1,128}$/.test(id))
    throw new WorkbenchError('工单分页游标无效。');
  return { updatedAt, id };
}

export function ticketQueries<T extends Row>(ports: Ports<T>) {
  return (actor: string, filters: TicketListFilters) => {
    const allowed = new Map(ports.projects(actor, filters.project).map(project => [project.id, project]));
    const ids = [...allowed.keys()];
    const pending = ports.pending(actor);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 40));
    const query = filters.q?.trim().toLocaleLowerCase();
    const related = new Map((query || filters.topic) ? [...allowed.values()].map(project => [project.id, ports.topics(project)]) : []);
    const rows: T[] = [];
    let cursor = decodeCursor(filters.after);
    const batchSize = Math.max(40, limit);
    let hasMore = false;
    // Bound the number of summaries per request, even for a selective state filter.
    for (let batch = 0; batch < 5; batch++) {
      const found = ports.read(actor, ids, batchSize + 1, cursor, filters.watching);
      hasMore = found.length > batchSize;
      for (const { ticket, work } of found.slice(0, batchSize)) {
        const project = allowed.get(work.project)!;
        const agent = ports.agent(work.agent);
        cursor = { id: ticket.id, updatedAt: ticket.updatedAt };
        if (filters.purpose === 'work' && work.consultation || filters.agent && work.agent !== filters.agent
          || filters.mine && work.requester !== actor && agent?.owner !== actor && !pending.has(ticket.id)) continue;
        const topics = related.get(project.id) ?? [];
        if (filters.topic && !topicWithin(topics, work.topic, filters.topic)) continue;
        if (query && ![ticket.id, ticket.title, work.requester, agent?.title, project.title, topics.find(topic => topic.id === work.topic)?.title]
          .filter(Boolean).join(' ').toLocaleLowerCase().includes(query)) continue;
        const row = ports.summary(actor, ticket, work, project, pending);
        if (filters.state && ticketListState(row) !== filters.state) continue;
        rows.push(row);
        if (rows.length === limit) {
          hasMore ||= ticket.id !== found.at(-1)?.ticket.id;
          break;
        }
      }
      if (!hasMore || rows.length === limit) break;
    }
    return { rows, next: hasMore && cursor ? Buffer.from(cursor.updatedAt + '\n' + cursor.id).toString('base64url') : undefined };
  };
}
