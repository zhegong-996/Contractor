import { RELATION_DEPENDS_ON, RELATION_OWNED_BY, RELATION_PART_OF, stringifyEntityRef } from '@backstage/catalog-model';
import type { KnowledgeEntry } from './knowledge.ts';
import { digest } from './knowledge.ts';

type Use = { ticket: string; title: string; agent?: string; owner?: string; run: number; attempt: number; version: number; revision: string };
type Node = { id: string; kind: 'project' | 'knowledge' | 'resource' | 'ticket' | 'agent' | 'member'; title: string;
  objectId?: string; revision?: string; state?: string; url?: string };
type Edge = { source: string; target: string; type: string; run?: number; attempt?: number; version?: number };

/** Build only from already authorized entries and use records. No inferred entities or extra model calls. */
export function knowledgeGraph(project: { id: string; title: string }, entries: KnowledgeEntry[],
  uses: Map<string, Use[]>, resources: Map<string, { label: string; url?: string }>, origins: Map<string, { title: string }> = new Map()) {
  const ref = (kind: string, name: string) => stringifyEntityRef({ kind, namespace: project.id, name });
  const nodes = new Map<string, Node>();
  const edges = new Map<string, Edge>();
  const add = (node: Node) => { nodes.set(node.id, node); return node.id; };
  const link = (edge: Edge) => { if (nodes.has(edge.source) && nodes.has(edge.target)) edges.set(digest(edge), edge); };
  const projectId = add({ id: ref('System', project.id), kind: 'project', title: project.title });
  const knowledgeId = (entry: KnowledgeEntry) => ref('Resource', 'knowledge-' + digest([entry.id, entry.revision]).slice(0, 32));
  for (const entry of entries) add({ id: knowledgeId(entry), kind: 'knowledge', title: entry.title,
    objectId: entry.id, revision: entry.revision, state: entry.retirement?.kind ?? entry.state });
  const visible = new Map(entries.map(entry => [entry.id + '@' + entry.revision, knowledgeId(entry)]));
  for (const entry of entries) {
    const id = knowledgeId(entry);
    const owner = add({ id: ref('User', entry.owner), kind: 'member', title: entry.owner });
    link({ source: id, target: owner, type: RELATION_OWNED_BY });
    link({ source: id, target: projectId, type: RELATION_PART_OF });
    const origin = entry.ticket && origins.get(entry.ticket);
    if (entry.ticket && origin) {
      const task = add({ id: ref('Component', 'ticket-' + entry.ticket), kind: 'ticket', title: origin.title, objectId: entry.ticket });
      link({ source: id, target: task, type: 'derivedFrom', version: entry.draft?.version });
      link({ source: task, target: projectId, type: RELATION_PART_OF });
    }
    if (entry.source) {
      const resource = resources.get(entry.source.resource);
      if (resource) {
        const source = add({ id: ref('Resource', 'source-' + digest([entry.source.resource, entry.source.revision]).slice(0, 32)),
          kind: 'resource', title: resource.label, revision: entry.source.revision, url: entry.source.url });
        link({ source: id, target: source, type: RELATION_DEPENDS_ON });
      }
    }
    for (const source of entry.sources) {
      const target = visible.get(source);
      if (target) link({ source: id, target, type: RELATION_DEPENDS_ON });
    }
    if (entry.replaces) {
      const target = visible.get(entry.replaces.id + '@' + entry.replaces.revision);
      if (target) link({ source: id, target, type: 'supersedes' });
    }
    for (const use of uses.get(entry.id) ?? []) {
      if (use.revision !== entry.revision) continue;
      const task = add({ id: ref('Component', 'ticket-' + use.ticket), kind: 'ticket', title: use.title, objectId: use.ticket });
      link({ source: task, target: id, type: RELATION_DEPENDS_ON, run: use.run, attempt: use.attempt, version: use.version });
      link({ source: task, target: projectId, type: RELATION_PART_OF });
      if (use.agent) {
        const agent = add({ id: ref('Component', 'agent-' + use.agent), kind: 'agent', title: use.agent, objectId: use.agent });
        link({ source: agent, target: task, type: 'executes', run: use.run, attempt: use.attempt });
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
