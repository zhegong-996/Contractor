import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KnowledgeService, confirmation, renderKnowledge, parseKnowledge, reusable, type Knowledge } from '../src/knowledge.ts';
import { configSchema } from '../src/config.ts';
import { Store, type Task } from '../src/store.ts';
import { Paperclip } from '../src/paperclip.ts';
const config = configSchema.parse({ companyId: 'company', projectId: 'project', paperclipUrl: 'http://127.0.0.1:3100',
  repository: 'test/repo', checkout: '/tmp/test', allowedPaths: ['pilot/'], agents: {}, defaultAgent: 'test', feishu: { profile: 'test' } });
const record: Knowledge = { schemaVersion: 1, companyId: 'company', projectId: 'project', sourceTaskId: 'source', key: 'knowledge-test',
  title: 'Shared professional finding', domains: ['product', 'growth'], kind: 'experiment', appliesTo: 'This pilot only', facts: { sampleSize: 10 },
  body: 'A contextual result, with its original evidence.', sources: ['https://example.org/evidence'], state: 'candidate', proposedBy: 'agent', updatedAt: '2026-11-04T00:00:00Z',
  visibility: 'org', owner: 'agent:test', evidenceEventIds: ['event-proposal-anchor-0001'], injected: false };
test('only confirmed unchanged knowledge can be reused; expiry and withdrawal invalidate the confirmation', () => {
  const value = { ...record, state: 'confirmed' as const, confirmedBy: 'reviewer', expiresAt: '2027-01-01T00:00:00Z' };
  assert.equal(reusable(value, config, 'test-key'), false);
  const signed = { ...value, confirmation: confirmation(value, 'test-key') };
  const roundTrip = parseKnowledge(renderKnowledge(signed));
  assert.equal(reusable(roundTrip, config, 'test-key', Date.parse('2026-11-05')), true);
  assert.equal(reusable({ ...roundTrip, body: 'changed without review' }, config, 'test-key'), false);
  assert.equal(reusable({ ...roundTrip, state: 'withdrawn' }, config, 'test-key'), false);
  assert.equal(reusable(roundTrip, config, 'test-key', Date.parse('2027-01-02')), false);
});
test('cross-task retrieval rechecks native source ACL and excludes revoked content before loading the document', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suitme-knowledge-'));
  const store = new Store(path.join(dir, 'state.sqlite'));
  try {
    const task: Task = { id: 'source', identifier: 'SUI-1', triggerId: 'one', chatId: 'local', messageId: 'local', senderId: 'test', agent: 'manual',
      workspace: dir, branch: 'none', context: '{}', generation: 1, phase: 'ready', knowledgeRefs: [{ taskId: 'source', key: record.key }] };
    store.save(task);
    const pc = new Paperclip(config.paperclipUrl); let permitted = true, documentReads = 0;
    const value = { ...record, state: 'confirmed' as const, confirmedBy: 'test-reviewer' };
    const signed = { ...value, confirmation: confirmation(value, 'test-key') };
    pc.get = (async (route: string) => { if (!permitted) throw new Error('404 Not found');
      if (!route.includes('/documents/')) return { companyId: 'company', projectId: 'project' };
      documentReads++; return { body: renderKnowledge(signed), latestRevisionId: 'revision1' }; }) as any;
    const service = new KnowledgeService(config, store, pc, 'test-key');
    assert.equal((await service.resolve(task, pc)).records.length, 1);
    permitted = false;
    const revoked = await service.resolve(task, pc);
    assert.equal(revoked.records.length, 0); assert.equal(revoked.excluded.length, 1); assert.equal(documentReads, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
