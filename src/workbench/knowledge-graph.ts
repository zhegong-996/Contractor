import type { KnowledgeEntry } from './knowledge.ts';
import { digest } from './knowledge.ts';
import { catalogReference } from './catalog-reference.ts';

type Use = { ticket: string; title: string; agent?: string; owner?: string; run: number; attempt: number; version: number; revision: string };
type Node = { id: string; kind: 'project' | 'knowledge' | 'resource' | 'ticket' | 'agent' | 'member'; title: string;
  objectId?: string; revision?: string; state?: string; url?: string };
type Edge = { source: string; target: string; type: string; run?: number; attempt?: number; version?: number };

/** Build only from already authorized entries and use records. No inferred entities or extra model calls. */
export function knowledgeGraph(project: { id: string; title: string }, entries: KnowledgeEntry[],
  uses: Map<string, Use[]>, resources: Map<string, { label: string; url?: string }>, origins: Map<string, { title: string }> = new Map()) {
  const ref = (kind: Parameters<typeof catalogReference>[0], name: string) => catalogReference(kind, project.id, name);
  const nodes = new Map<string, Node>();
  const edges = new Map<string, Edge>();
  const add = (node: Node) => { nodes.set(node.id, node); return node.id; };
  const link = (edge: Edge) => { if (nodes.has(edge.source) && nodes.has(edge.target)) edges.set(digest(edge), edge); };
  const projectId = add({ id: ref('system', project.id), kind: 'project', title: project.title });
  const knowledgeId = (entry: KnowledgeEntry) => ref('resource', 'knowledge-' + digest([entry.id, entry.revision]).slice(0, 32));
  for (const entry of entries) add({ id: knowledgeId(entry), kind: 'knowledge', title: entry.title,
    objectId: entry.id, revision: entry.revision, state: entry.retirement?.kind ?? entry.state });
  const visible = new Map(entries.map(entry => [entry.id + '@' + entry.revision, knowledgeId(entry)]));
  for (const entry of entries) {
    const id = knowledgeId(entry);
    const owner = add({ id: ref('user', entry.owner), kind: 'member', title: entry.owner });
    link({ source: id, target: owner, type: 'ownedBy' });
    link({ source: id, target: projectId, type: 'partOf' });
    const origin = entry.ticket && origins.get(entry.ticket);
    if (entry.ticket && origin) {
      const task = add({ id: ref('component', 'ticket-' + entry.ticket), kind: 'ticket', title: origin.title, objectId: entry.ticket });
      link({ source: id, target: task, type: 'derivedFrom', version: entry.draft?.version });
      link({ source: task, target: projectId, type: 'partOf' });
    }
    if (entry.source) {
      const resource = resources.get(entry.source.resource);
      if (resource) {
        const source = add({ id: ref('resource', 'source-' + digest([entry.source.resource, entry.source.revision]).slice(0, 32)),
          kind: 'resource', title: resource.label, revision: entry.source.revision, url: entry.source.url });
        link({ source: id, target: source, type: 'dependsOn' });
      }
    }
    for (const source of entry.sources) {
      const target = visible.get(source);
      if (target) link({ source: id, target, type: 'dependsOn' });
    }
    if (entry.replaces) {
      const target = visible.get(entry.replaces.id + '@' + entry.replaces.revision);
      if (target) link({ source: id, target, type: 'supersedes' });
    }
    for (const use of uses.get(entry.id) ?? []) {
      if (use.revision !== entry.revision) continue;
      const task = add({ id: ref('component', 'ticket-' + use.ticket), kind: 'ticket', title: use.title, objectId: use.ticket });
      link({ source: task, target: id, type: 'dependsOn', run: use.run, attempt: use.attempt, version: use.version });
      link({ source: task, target: projectId, type: 'partOf' });
      if (use.agent) {
        const agent = add({ id: ref('component', 'agent-' + use.agent), kind: 'agent', title: use.agent, objectId: use.agent });
        link({ source: agent, target: task, type: 'executes', run: use.run, attempt: use.attempt });
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
