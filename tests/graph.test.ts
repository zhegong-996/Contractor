import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeGraph } from '../src/graph.ts';
import { validateOntology } from '../src/ontology.ts';
import { emptySchema, schemaReducer } from '../upstream/cognee/cognee-frontend/src/modules/graphModels/schemaReducer.ts';

test('graph access rechecks the owning task and source before any graph process can start', async () => {
  let reads = 0; const task: any = { agent: 'executor', phase: 'ready' }, state = { sources: ['source'] };
  const w: any = { source: () => ({ ref: { taskId: 'source', key: 'knowledge-a' } }), store: { get: () => task }, state: async () => state,
    allowed: async () => false, knowledge: { read: async () => { reads++; } } };
  const graph = new KnowledgeGraph(w);
  await assert.rejects(graph.source('source', { admin: false, agent: 'executor' }), /scope/);
  await assert.rejects(graph.source('source', { admin: false, agent: 'other' }, 'task'), /scope/);
  await assert.rejects(graph.source('source', { admin: false, agent: 'executor' }, 'task'), /scope/);
  task.phase = 'accepted'; w.allowed = async () => true;
  await assert.rejects(graph.source('source', { admin: false, agent: 'executor' }, 'task'), /scope/);
  assert.equal(reads, 0);
});
test('graph projection does not import Feishu originals or substitute a different source revision', async () => {
  const w: any = { source: () => ({ external: {} }), manager: () => {} };
  const graph = new KnowledgeGraph(w);
  await assert.rejects(graph.source('source', { admin: true }), /不会自动复制/);
  graph.source = async () => ({ record: { revision: 'new' } }) as any;
  await assert.rejects(graph.run('source', 'old', true, { admin: true }), /版本已变化/);
});
test('the actual Cognee reducer and serializer preserve configurable dates, enums and typed relations', () => {
  let schema = schemaReducer(emptySchema(), { type: 'ADD_ENTITY', name: 'Knowledge', description: '知识条目' });
  schema = schemaReducer(schema, { type: 'ADD_ENTITY', name: 'Source', description: '来源' });
  const id = schema.entities[0]!._id;
  for (const field of [
    { name: 'validUntil', kind: 'primitive', primitiveType: 'date' },
    { name: 'state', kind: 'enum', enumValues: ['candidate', 'confirmed'] },
    { name: 'sources', kind: 'relation', relation: { targetEntityName: 'Source', cardinality: 'many' } },
  ] as any[]) schema = schemaReducer(schema, { type: 'ADD_FIELD', entityId: id, field });
  const output: any = validateOntology(schema).extractionSchema;
  assert.equal(output.properties.validUntil.type, 'string');
  assert.deepEqual(output.properties.state.enum, ['candidate', 'confirmed']);
  assert.equal(output.properties.sources.items.$ref, '#/$defs/Source');
  const broken = structuredClone(schema); (broken.entities[0]!.fields[2] as any).relation.targetEntityName = 'Missing';
  assert.throws(() => validateOntology(broken), /概念不存在/);
});
