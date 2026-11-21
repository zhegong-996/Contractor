import type { Project } from './config.ts';
import { WorkbenchError } from './errors.ts';
import type { AccessReader, KnowledgeEntry, ProjectKnowledge } from './knowledge.ts';
import type { Assembled, Output, Work } from './work-types.ts';

type AuthorityPorts = {
  workOf: (id: string) => Work | undefined;
  connected: (entry: KnowledgeEntry) => boolean;
  originOutput: (entry: KnowledgeEntry) => Output | undefined;
  accessReader: (work?: Work) => AccessReader | undefined;
  outputReader: (output: Output, work: Work) => AccessReader | undefined;
  manifestFor: (run: number, attempt?: number) => Assembled | undefined;
  childResultsUsable: (manifest?: Assembled) => boolean;
  topicContextUsable: (work: Work, manifest?: Assembled) => boolean;
  member: (project: string, actor: string) => boolean;
  octopCurrent: (work: Work) => boolean;
  octopIMCurrent: (work: Work) => boolean;
  workerHarnessCurrent: (work: Work, manifest?: Assembled) => boolean;
};

export function knowledgeAuthority(knowledge: Pick<ProjectKnowledge, 'get' | 'granted' | 'usable' | 'directory' | 'current'>, ports: AuthorityPorts) {
  const { workOf, connected, originOutput, accessReader, outputReader, manifestFor, childResultsUsable, topicContextUsable,
    member, octopCurrent, octopIMCurrent, workerHarnessCurrent } = ports;

  function entryEvidence(entry: KnowledgeEntry, visited = new Set<string>(), current = false): boolean {
    if (!connected(entry) || visited.has(entry.id) || current && entry.retirement) return false;
    if (!entry.ticket) return true;
    const work = workOf(entry.ticket);
    const origin = originOutput(entry);
    const manifest = origin && manifestFor(origin.run, origin.attempt);
    // A later review-only grant can reopen the output to its reviewer, never free the derived knowledge for reuse.
    return !!origin && work?.project === entry.project && octopCurrent(work) && workerHarnessCurrent(work, manifest)
      && topicContextUsable(work, manifest) && childResultsUsable(manifest) && usable(entry.ticket, origin.sources,
        new Set([...visited, entry.id]), outputReader(origin, work), '', current);
  }
  const sourceAllowed = (id: string, entry: KnowledgeEntry, visited: Set<string>, reader = accessReader(workOf(id)), access?: string, review = '', current = false): boolean => {
    if (entry.project !== workOf(id)?.project || entry.visibility === 'restricted' && (!reader || !member(entry.project, reader.owner))) return false;
    return (knowledge.usable(id, entry, reader, access) || !!review && knowledge.usable(id, entry, reader, access, review))
      && entryEvidence(entry, visited, current);
  };
  const usable = (id: string, sources: Assembled['sources'], visited = new Set<string>(), reader = accessReader(workOf(id)), review = '', current = false): boolean => sources.every(ref => {
    const entry = knowledge.get(ref.id, ref.revision);
    return !!entry && (entry.visibility !== 'restricted' || !!ref.access) && sourceAllowed(id, entry, visited, reader, ref.access, review, current);
  });
  const outputUsable = (id: string, output: Output): boolean => {
    const current = workOf(id)!;
    const manifest = manifestFor(output.run, output.attempt);
    if (!octopCurrent(current) || !octopIMCurrent(current) || !workerHarnessCurrent(current, manifest)
      || !topicContextUsable(current, manifest) || !childResultsUsable(manifest)) return false;
    const reader = outputReader(output, current);
    const sources = output.sources.map(ref => {
      const entry = knowledge.get(ref.id, ref.revision);
      const review = entry && knowledge.granted(id, entry, reader, output.revision);
      return review ? { ...ref, access: review.id } : ref;
    });
    return usable(id, sources, new Set(), reader, output.revision);
  };
  const canDiscoverEntry = (entry: KnowledgeEntry, actor: string) => entry.owner === actor
    || entry.state === 'published' && (entry.visibility === 'project' || knowledge.directory(entry) === 'requestable');

  function selectMaterials(project: string, actor: string, ids: string[], preceding?: Work) {
    return [...new Set(ids.map(id => {
      const entry = knowledge.current(id);
      const existing = preceding?.requester === actor && preceding.material.includes(id) && entry?.id === id;
      if (!entry || entry.project !== project || !(existing || canDiscoverEntry(entry, actor)) || !entryEvidence(entry, new Set(), true))
        throw new WorkbenchError('引用资料已失效或不属于当前项目。请选择当前可用的资料。', 409);
      return entry.id;
    }))];
  }
  const currentProjectMemory = (entry: KnowledgeEntry, project: Project) =>
    entry.project === project.id && entry.state === 'published' && entry.visibility === 'project' && entryEvidence(entry, new Set(), true);
  const canReadEntry = (e: KnowledgeEntry, actor: string) => {
    return entryEvidence(e) && (e.owner === actor || (e.state === 'published' && e.visibility === 'project'));
  };

  return { entryEvidence, sourceAllowed, usable, outputUsable, canDiscoverEntry, canReadEntry, selectMaterials, currentProjectMemory };
}
