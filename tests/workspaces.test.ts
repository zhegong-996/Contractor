import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, type Task } from '../src/store.ts';
const temp = mkdtempSync(path.join(tmpdir(), 'suitme-workflow-test-'));
process.env.COLLAB_STATE_DIR = temp;
writeFileSync(path.join(temp, 'secrets.json'), JSON.stringify({ jwtSecret: 'test-key', adminToken: 'operator', agentTokens: {},
  paperclipTokens: { 'role-growth': 'fake-growth-native-identity', 'role-product': 'fake-product-native-identity' } }));
const { Workspaces, requestIsCurrent, contractProof } = await import('../src/workspaces.ts');
const { collaborationOwnerMatches } = await import('../src/workspaces.ts');
const { configSchema } = await import('../src/config.ts');
const config = configSchema.parse({ companyId: 'company', projectId: 'project', paperclipUrl: 'http://127.0.0.1:3100', repository: 'test/repo',
  checkout: temp, allowedPaths: ['pilot/'], defaultAgent: 'role-growth',
  agents: { 'role-growth': { name: '增长', mode: 'manual', enabled: true, paperclipId: 'growth-id' }, 'role-product': { name: '产研', mode: 'manual', enabled: true, paperclipId: 'product-id' } }, feishu: { profile: 'test' } });
function fixture() {
  const dir = mkdtempSync(path.join(temp, 'case-')), store = new Store(path.join(dir, 'state.sqlite'));
  const task: Task = { id: 'task-one', identifier: 'SUI-ONE', kind: 'collaboration', triggerId: 'one', chatId: 'local', messageId: 'local', senderId: 'operator',
    agent: 'role-growth', workspace: '', branch: '', context: '{}', generation: 1, phase: 'ready' };
  store.save(task); const service = new Workspaces(config, store);
  const state: any = { version: 1, sources: ['sales'], requests: ['request-one'], snapshots: [{ id: 'snapshot-one', sources: ['sales'], grants: [{ agent: task.agent, id: 'snapshot-grant' }] }], outcomes: [], history: [] };
  const access: any = { id: 'request-one', taskId: task.id, sourceId: 'sales', agent: task.agent, grantId: 'source-grant',
    state: 'approved', expiresAt: '2099-01-01T00:00:00Z' };
  service.state = async () => state; service.access = async () => access; service.source = () => ({ id: 'sales', title: '销售资料', domain: 'sales', ref: { taskId: 'source-task', key: 'knowledge-sales' } });
  service.issue = async () => ({ id: task.id, companyId: 'company' });
  service.reader = () => ({ get: async () => { throw new Error('404'); } }) as any;
  service.allowed = async () => false;
  service.saveAccess = async () => {};
  service.save = async (t, s, event, detail) => { s.history.push({ at: new Date().toISOString(), event, detail }); store.save(t); };
  service.pc.patch = async () => ({}) as any;
  return { store, task, service, state, access, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test.after(() => rmSync(temp, { recursive: true, force: true }));
test('approval and expiry are both required; pending, revoking and exact deadline deny access', () => {
  const now = Date.parse('2026-11-04T00:00:00Z');
  assert.equal(requestIsCurrent({ state: 'approved', expiresAt: '2026-11-04T00:00:01Z' }, now), true);
  for (const state of ['pending', 'revoking', 'revoked', 'denied'] as const) assert.equal(requestIsCurrent({ state, expiresAt: '2099-01-01T00:00:00Z' }, now), false);
  assert.equal(requestIsCurrent({ state: 'approved', expiresAt: '2026-11-04T00:00:00Z' }, now), false);
});
test('native human review may temporarily own the coordinator only when the signed executor remains its return assignee', () => {
  const issue: any = { assigneeAgentId: null, assigneeUserId: 'local-board', reviewPolicy: 'human_only', executionPolicy: { stages: [{ id: 'review', type: 'review', participants: [{ type: 'user', userId: 'local-board' }] }] },
    executionState: { currentStageId: 'review', currentStageType: 'review', currentParticipant: { type: 'user', userId: 'local-board' }, returnAssignee: { type: 'agent', agentId: 'expected' } } };
  assert.equal(collaborationOwnerMatches(issue, ['expected']), true);
  assert.equal(collaborationOwnerMatches(issue, ['foreign']), false);
  assert.equal(collaborationOwnerMatches({ ...issue, assigneeUserId: 'another-person' }, ['expected']), false);
  assert.equal(collaborationOwnerMatches({ ...issue, executionState: { ...issue.executionState, currentStageId: 'unrelated' } }, ['expected']), false);
});
test('workflow attestations bind sources and the owning task, so direct document edits cannot widen a handoff', () => {
  const state = { sources: ['private-sales'], requests: ['approved-one'], snapshots: [{ id: 'private-checkpoint', sources: ['private-sales'] }] };
  const proof = contractProof('task', 'task-one', state, 'test-key');
  assert.equal(contractProof('task', 'task-one', { ...state, proof }, 'test-key'), proof);
  assert.notEqual(contractProof('task', 'task-two', state, 'test-key'), proof);
  assert.notEqual(contractProof('task', 'task-one', { ...state, sources: [] }, 'test-key'), proof);
  assert.notEqual(contractProof('task', 'task-one', { ...state, snapshots: [{ id: 'private-checkpoint', sources: [] }] }, 'test-key'), proof);
  const request = { agent: 'role-growth', expiresAt: '2026-11-04T10:00:00Z', state: 'pending' };
  assert.notEqual(contractProof('request', 'r', request, 'test-key'), contractProof('request', 'r', { ...request, state: 'approved' }, 'test-key'));
});
test('an Agent cannot approve, revoke or publish by choosing a different principal in input', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.decide('request-one', 'approved', 'self approval', { admin: false, agent: 'role-growth' }), /Unauthorized/);
    await assert.rejects(f.service.revoke('request-one', 'self revoke', { admin: false, agent: 'role-growth' }), /Unauthorized/);
    await assert.rejects(f.service.publish('task-one', 'outcome', 'revision', 'release', { admin: false, agent: 'role-growth' }), /Unauthorized/);
    await assert.rejects(f.service.adopt('task-one', 'outcome', 'revision', 'release', { admin: false, agent: 'role-growth' }), /Unauthorized/);
    await assert.rejects(f.service.request({ taskId: f.task.id, sourceId: 'sales', agent: 'role-product', purpose: 'x', requestKey: 'x' }, { admin: false, agent: 'role-growth' }), /Unauthorized/);
  } finally { f.close(); }
});
test('handoff refuses before any assignment mutation if the new executor lacks material access', async () => {
  const f = fixture();
  try {
    let writes = 0; f.service.domain = () => 'product'; f.service.requireSources = async () => { throw new Error('missing material access'); };
    f.service.pc.patch = async () => { writes++; return {} as any; };
    await assert.rejects(f.service.handoff(f.task.id, 'role-product', { admin: true }), /missing material/);
    assert.equal(writes, 0); assert.equal(f.store.get(f.task.id).agent, 'role-growth');
  } finally { f.close(); }
});
test('partial revocation stays fail-closed and recovery preserves manual-revocation status', async () => {
  const f = fixture();
  try {
    const removed: string[] = []; f.service.revokeGrant = async (_issue, id) => { removed.push(id); };
    let fail = true; f.service.pc.patch = async () => { if (fail) { fail = false; throw new Error('temporary native write failure'); } return {} as any; };
    await assert.rejects(f.service.revoke('request-one', '负责人撤销', { admin: true }), /temporary/);
    assert.equal(f.access.state, 'revoking'); assert.equal(requestIsCurrent(f.access), false);
    await f.service.revoke('request-one', 'background recovery', { admin: true }, true);
    assert.equal(f.access.state, 'revoked'); assert.equal(f.access.reason, '负责人撤销');
    assert.ok(removed.includes('source-grant')); assert.ok(removed.includes('snapshot-grant'));
    assert.equal(f.store.get(f.task.id).phase, 'access_blocked');
  } finally { f.close(); }
});
test('revoking a live external execution fences its lease and blocks replacement until a stopped acknowledgement', async () => {
  const f = fixture();
  try {
    f.task.phase = 'running'; f.task.lease = 'owned-lease'; f.store.save(f.task);
    f.service.revokeGrant = async () => {};
    await f.service.revoke('request-one', 'scope removed', { admin: true });
    assert.equal(f.store.get(f.task.id).phase, 'unknown'); assert.equal(f.store.get(f.task.id).lease, undefined);
    assert.equal(f.state.fence.lease, 'owned-lease');
    await assert.rejects(f.service.stopped(f.task.id, 'wrong-lease', 'stopped', true, { admin: false, agent: 'role-growth' }), /Unauthorized/);
    await assert.rejects(f.service.checkpoint(f.task.id, 'late result', { admin: false, agent: 'role-growth' }, 'owned-lease'), /Stale/);
    await f.service.stopped(f.task.id, 'owned-lease', '原执行端已结束写入', true, { admin: false, agent: 'role-growth' });
    assert.equal(f.store.get(f.task.id).phase, 'access_blocked'); assert.equal(f.state.fence, undefined);
  } finally { f.close(); }
});
test('one task cannot revoke another task authorization that shares the same native grant', async () => {
  const f = fixture();
  try {
    const second = { ...f.task, id: 'task-two', identifier: 'SUI-TWO', triggerId: 'two' }; f.store.save(second);
    const secondAccess = { ...f.access, id: 'request-two', taskId: second.id };
    const states: any = { 'task-one': f.state, 'task-two': { ...f.state, requests: ['request-two'], snapshots: [], outcomes: [], history: [] } };
    f.service.state = async t => states[t.id];
    f.service.access = async id => id === 'request-one' ? f.access : secondAccess;
    let sourceRevokes = 0;
    f.service.revokeGrant = async (_issue, id) => { if (id === 'source-grant') sourceRevokes++; };
    f.service.reader = () => ({ get: async () => ({}) }) as any;
    await f.service.revoke('request-one', 'end task one access', { admin: true });
    assert.equal(sourceRevokes, 0); assert.equal(f.access.remainingNativeAccess, true);
    assert.equal(f.store.get(second.id).phase, 'ready'); assert.equal(secondAccess.state, 'approved');
    await f.service.revoke('request-two', 'end last access', { admin: true });
    assert.equal(sourceRevokes, 1);
  } finally { f.close(); }
});
test('a persisted handoff resumes at the same generation after the native assignment response is lost', async () => {
  const f = fixture();
  try {
    f.service.domain = () => 'product'; f.service.requireSources = async () => {};
    f.state.requests = []; f.state.snapshots = [];
    let nativeAssignee = 'growth-id', fail = true;
    f.service.issue = async () => ({ id: f.task.id, assigneeAgentId: nativeAssignee });
    f.service.pc.patch = async (_route, body: any) => { assert.equal(body.assigneeUserId, null); nativeAssignee = body.assigneeAgentId; if (fail) { fail = false; throw new Error('lost native response'); } return {} as any; };
    f.service.pc.get = async () => [] as any;
    await assert.rejects(f.service.handoff(f.task.id, 'role-product', { admin: true }), /lost native/);
    assert.equal(f.store.get(f.task.id).phase, 'handoff_pending'); assert.equal(nativeAssignee, 'product-id');
    await assert.rejects(f.service.guard(f.store.get(f.task.id)), /交接尚未完成/);
    const resumed = await f.service.handoff(f.task.id, 'role-product', { admin: true });
    assert.equal(resumed.agent, 'role-product'); assert.equal(resumed.generation, 2); assert.equal(resumed.phase, 'ready');
    assert.equal(f.state.pendingHandoff, undefined);
  } finally { f.close(); }
});
test('handoff moves a task note and revokes the old executor even when the note has no knowledge dependencies', async () => {
  const f = fixture();
  try {
    f.state.requests = []; f.state.snapshots = [{ id: 'note-one', key: 'context-note', sources: [], grants: [{ agent: 'role-growth', id: 'old-note-grant' }] }];
    f.service.domain = () => 'product'; f.service.requireSources = async () => {};
    f.service.nativeGrant = async () => ({ id: 'new-note-grant' }) as any;
    f.service.pc.get = async () => [] as any;
    const revoked: string[] = []; f.service.revokeGrant = async (_issue, id) => { revoked.push(id); };
    await f.service.handoff(f.task.id, 'role-product', { admin: true });
    assert.deepEqual(revoked, ['old-note-grant']);
    assert.deepEqual(f.state.snapshots[0].grants, [{ agent: 'role-product', id: 'new-note-grant' }]);
    assert.equal(f.store.get(f.task.id).agent, 'role-product');
  } finally { f.close(); }
});
test('a retried model receipt deduplicates each artifact but cannot alias the checkpoint and knowledge native issues', async () => {
  const f = fixture();
  try {
    const ids = new Map<string, string>(); f.service.catalog = () => ({ vaultProject: 'vault' }) as any;
    f.service.pc.post = async (_route, body: any) => {
      if (!ids.has(body.idempotencyKey)) ids.set(body.idempotencyKey, 'artifact-' + ids.size);
      return { id: ids.get(body.idempotencyKey) } as any;
    };
    f.service.pc.document = async () => {}; f.service.nativeGrant = async () => ({ id: 'grant' }) as any;
    f.service.domain = () => 'product';
    const a = await f.service.snapshot(f.task, 'checkpoint', 'draft', 'body', [], 'same-receipt');
    const b = await f.service.snapshot(f.task, 'knowledge-candidate', 'candidate', 'body', [], 'same-receipt');
    const retry = await f.service.snapshot(f.task, 'checkpoint', 'draft', 'body', [], 'same-receipt');
    assert.notEqual(a.id, b.id); assert.equal(retry.id, a.id); assert.equal(ids.size, 2);
  } finally { f.close(); }
});
test('a custom project space has no department enum and creates no implicit membership grant', async () => {
  const f = fixture();
  try {
    const catalog: any = { spaces: { existing: { projectId: 'existing', agent: 'role-growth', members: ['role-growth', 'role-product'] } }, sources: [], participants: ['role-growth', 'role-product'] };
    f.service.catalog = () => catalog; f.service.saveCatalog = c => Object.assign(catalog, c);
    const calls: string[] = []; f.service.pc.post = async route => { calls.push(route); return { id: 'custom-project', companyId: 'company', visibility: 'private' } as any; };
    const space = await f.service.configureSpace({ id: 'research-pilot', name: '研究试点', agent: 'role-product', description: '按项目组织' }, { admin: true });
    assert.equal(space.domain, 'research-pilot'); assert.deepEqual(space.members, []); assert.equal(space.grantsCreated, 0);
    assert.ok(calls.every(route => !route.includes('access-members'))); assert.equal(f.service.domain('role-product'), 'existing');
    await assert.rejects(f.service.configureSpace({ id: 'another', name: 'x', agent: 'role-product' }, { admin: false, agent: 'role-growth' }), /Unauthorized/);
  } finally { f.close(); }
});
test('a space label or an existing native grant cannot bypass a different task Feishu delegation', async () => {
  const f = fixture();
  try {
    f.service.allowed = Workspaces.prototype.allowed; f.service.domain = () => 'custom-project';
    f.service.source = () => ({ id: 'sales', domain: 'custom-project', ref: { taskId: 'source-task', key: 'external-reference' }, external: { provider: 'feishu' } }) as any;
    f.service.reader = () => ({ get: async () => ({}) }) as any;
    let reads = 0; f.service.feishu.read = async () => { reads++; return {} as any; };
    f.access.state = 'pending'; assert.equal((await f.service.sourceStatus(f.task, 'sales', f.task.agent, f.state)).allowed, false); assert.equal(reads, 0);
    f.access.state = 'approved'; assert.equal(await f.service.allowed(f.task, 'sales', f.task.agent, f.state), true); assert.equal(reads, 1);
    f.access.expiresAt = '2000-01-01T00:00:00Z'; assert.equal(await f.service.allowed(f.task, 'sales', f.task.agent, f.state), false); assert.equal(reads, 1);
  } finally { f.close(); }
});
test('a collaboration coordinator has a human review path and does not wake the development runner on creation', async () => {
  const f = fixture(); try {
    f.service.domain = () => 'research'; f.service.catalog = () => ({ coordinationProject: 'coordinator', spaces: { research: { projectId: 'research-project', agent: 'role-growth' } }, sources: [] }) as any;
    let creation: any, patches = 0;
    f.service.pc.post = async (_route, body) => { creation = body; return { id: 'new-task', identifier: 'SUI-NEW' } as any; };
    f.service.pc.patch = async () => { patches++; return {} as any; };
    await f.service.createTask({ title: '研究任务', goal: '整理待审阅证据', agent: 'role-growth', sources: [], knowledgeSpace: 'research', requestKey: 'new-coordinator' }, { admin: true });
    assert.equal(creation.status, 'backlog'); assert.equal(creation.reviewPolicy, 'human_only'); assert.equal(patches, 0);
    assert.deepEqual(creation.executionPolicy.stages[0].participants, [{ type: 'user', userId: 'local-board' }]);
  } finally { f.close(); }
});
test('human draft acceptance can defer knowledge adoption, but requires an exact reviewed checkpoint and a reason', async () => {
  const f = fixture(); try {
    f.state.requests = []; f.state.snapshots = [{ id: 'reviewed-draft', key: 'checkpoint', sources: [], grants: [] }];
    f.service.pc.get = async () => ({ latestRevisionId: 'current-revision' }) as any;
    await assert.rejects(f.service.complete(f.task.id, { admin: true }), /验收依据/);
    await assert.rejects(f.service.complete(f.task.id, { admin: true }, { reason: '只验收资料整理', noKnowledge: true, checkpoint: { id: 'reviewed-draft', revision: 'old' } }), /版本已变化/);
    await assert.rejects(f.service.complete(f.task.id, { admin: false, agent: 'role-growth' }, { noKnowledge: true, reason: 'self accept' }), /Unauthorized/);
    const decisions: any[] = [];
    f.service.pc.patch = async (_route, body) => {
      assert.notEqual(f.store.get(f.task.id).phase, 'accepted'); decisions.push(body);
      return decisions.length === 1 ? { status: 'in_review', assigneeUserId: 'local-board', assigneeAgentId: null, reviewPolicy: 'human_only',
        executionPolicy: { stages: [{ id: 'human-review', type: 'review', participants: [{ type: 'user', userId: 'local-board' }] }] },
        executionState: { status: 'pending', currentStageId: 'human-review', currentStageType: 'review', currentParticipant: { type: 'user', userId: 'local-board' }, returnAssignee: { type: 'agent', agentId: 'growth-id' } } } : { status: 'done' } as any;
    };
    const result = await f.service.complete(f.task.id, { admin: true }, { reason: '已审阅资料工作稿；不表示功能已实现，暂不采用知识', noKnowledge: true, checkpoint: { id: 'reviewed-draft', revision: 'current-revision' } });
    assert.equal(result.phase, 'accepted'); assert.equal(f.state.outcomes.length, 0);
    assert.equal(f.state.history.at(-1).detail.review.noKnowledge, true);
    assert.equal(decisions.length, 2); assert.equal(decisions[0].comment, decisions[1].comment); assert.match(decisions[1].comment, /不表示功能已实现/);
  } finally { f.close(); }
});
test('completion waits for a different native reviewer and can recover a prior local completion', async () => {
  const f = fixture(); try {
    f.state.requests = []; f.state.snapshots = []; f.state.outcomes = [{ publicationId: 'confirmed-knowledge', grants: [] }];
    let calls = 0; f.service.pc.patch = async () => { calls++; return { status: 'in_review', executionState: { status: 'pending', currentParticipant: { type: 'user', userId: 'another-reviewer' } } } as any; };
    await assert.rejects(f.service.complete(f.task.id, { admin: true }), /原生人工审阅尚未完成/);
    assert.equal(calls, 1); assert.notEqual(f.store.get(f.task.id).phase, 'accepted');
    const previous = f.store.get(f.task.id); previous.phase = 'accepted'; f.store.save(previous);
    f.service.pc.patch = async () => { calls++; return { status: 'done' } as any; };
    await f.service.complete(f.task.id, { admin: true }, { reason: '恢复已获人确认的验收' });
    assert.equal(calls, 2); assert.equal(f.store.get(f.task.id).phase, 'accepted');
  } finally { f.close(); }
});
