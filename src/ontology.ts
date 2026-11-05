import { z } from 'zod';
import { toGraphModelSchema } from '../upstream/cognee/cognee-frontend/src/modules/graphModels/toGraphModelSchema.ts';
import type { Workspaces, WorkspaceActor } from './workspaces.ts';
import { cogneeCommit } from './graph.ts';

const name = z.string().trim().min(1).max(80).refine(s => !['__proto__', 'prototype', 'constructor'].includes(s));
const common = { _id: z.string().uuid(), name, required: z.boolean().optional(), description: z.string().max(2000).optional() };
const field = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('primitive'), primitiveType: z.enum(['string', 'number', 'boolean', 'date']) }).strict(),
  z.object({ ...common, kind: z.literal('enum'), enumValues: z.array(z.string().min(1).max(100)).min(1).max(80) }).strict(),
  z.object({ ...common, kind: z.literal('relation'), relation: z.object({ targetEntityName: name, cardinality: z.enum(['one', 'many']),
    inverse: z.object({ enabled: z.boolean(), name: name.optional(), cardinality: z.enum(['one', 'many']).optional() }).strict().optional() }).strict() }).strict(),
]);
export const graphSchemaInput = z.object({ options: z.object({ autoTypeNodes: z.boolean().optional() }).strict(),
  entities: z.array(z.object({ _id: z.string().uuid(), name, description: z.string().max(4000).optional(), primaryLabelField: z.string().optional(),
    indexFields: z.array(z.string()).max(80).optional(), fields: z.array(field).max(80) }).strict()).max(40) }).strict();
export function validateOntology(input: unknown) {
  const schema = graphSchemaInput.parse(input), names = schema.entities.map(e => e.name);
  if (new Set(names).size !== names.length) throw new Error('概念名称不能重复');
  if (new Set(schema.entities.map(e => e._id)).size !== schema.entities.length) throw new Error('概念标识不能重复');
  for (const entity of schema.entities) {
    if (new Set(entity.fields.map(f => f.name)).size !== entity.fields.length) throw new Error('同一概念的字段名不能重复');
    if (new Set(entity.fields.map(f => f._id)).size !== entity.fields.length) throw new Error('字段标识不能重复');
    for (const f of entity.fields) if (f.kind === 'relation' && !names.includes(f.relation.targetEntityName)) throw new Error('关系指向的概念不存在，请先补齐概念');
  }
  // The canonical schema and serialization are the pinned Cognee frontend's
  // contract. This adapter adds host authorization and optimistic concurrency.
  return { schema, extractionSchema: schema.entities.length ? toGraphModelSchema(schema) : {} };
}
export class OntologyService {
  constructor(readonly w: Workspaces) {}
  async read(space: string, actor: WorkspaceActor) {
    this.w.manager(actor); const c = this.w.catalog(), s = c.spaces[space]; if (!s) throw new Error('知识空间不存在');
    const id = c.ontologyIssues?.[space];
    if (!id) return { ...validateOntology({ options: {}, entities: [] }), revision: null, issueId: null, engine: 'cognee', commit: cogneeCommit };
    const issue = await this.w.issue(id);
    if (issue.projectId !== s.projectId || issue.visibility !== 'private') throw new Error('知识字典的存储边界发生变化');
    const doc = await this.w.pc.get('/issues/' + id + '/documents/ontology');
    return { ...validateOntology(JSON.parse(doc.body).schema), revision: doc.latestRevisionId, issueId: id, engine: 'cognee', commit: cogneeCommit };
  }
  async save(space: string, input: unknown, revision: string | null, actor: WorkspaceActor) {
    this.w.manager(actor); const data = validateOntology(input), current = await this.read(space, actor);
    if (current.revision !== revision) throw new Error('知识字典已变化，请重新读取当前版本');
    const c = this.w.catalog(); c.ontologyIssues ??= {};
    if (!current.issueId) { const issue = await this.w.pc.post('/companies/' + this.w.config.companyId + '/issues', {
      projectId: c.spaces[space]!.projectId, title: this.w.spaceName(space) + '｜知识字典', visibility: 'private', status: 'backlog',
      allowDuplicate: true, idempotencyKey: 'ontology:' + space }); c.ontologyIssues[space] = issue.id; this.w.saveCatalog(c); }
    await this.w.pc.request('PUT', '/issues/' + c.ontologyIssues[space] + '/documents/ontology', {
      title: '知识字典与图谱模型', format: 'markdown', body: JSON.stringify({ ...data, engine: 'cognee', commit: cogneeCommit, automaticExtraction: false }, null, 2), baseRevisionId: revision,
    });
    this.w.store.audit('knowledge.ontology-saved', c.ontologyIssues[space]!, { space, entities: data.schema.entities.length, automaticExtraction: false });
    return this.read(space, actor);
  }
}
