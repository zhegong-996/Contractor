import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyEvidenceQuotes, projectHistoricalEvidence } from '../src/evidence.ts';
import { WorkspaceAssistant, validateAssistantOutput } from '../src/assistant.ts';
const output = { contextGaps: [], summary: '合成证据表明需要解释结果；其他结论待验证。', evidenceQuotes: [{ sourceId: 'sales', quote: '结果解释不足' }],
  workProducts: [{ title: '可编辑说明模板', kind: 'template', body: '结果：[待补充]\n解释依据：[待补充]\n适用限制：仅联调' }],
  nextSteps: [{ text: '请负责人决定是否采用', owner: 'human', kind: 'adopt', sourceIds: ['sales'] }], handoff: '目标与待补充事项', checkpoint: '已整理联调模板',
  knowledge: { title: '联调流程', appliesTo: '仅当前测试', facts: [{ name: '限制', value: '不得视为真实业务结果' }], body: '知识候选，仅供人审阅。' } };
const sources = [{ id: 'sales', revision: 'v1', body: '测试反馈是结果解释不足，尚未验证成因。' }];
function fixture() {
  const task: any = { id: 'task', identifier: 'SUI-T', messageId: 'local', agent: 'role-growth', generation: 1, phase: 'ready' };
  const state: any = { sources: ['sales'], requests: [], snapshots: [], history: [], delegation: { enabled: true, jobId: 'job', mode: 'advance' } };
  const job: any = { id: 'job', taskId: 'task', agent: task.agent, basis: 'current', status: 'running', mode: 'advance', applied: {} };
  const writes: string[] = [];
  const native: any = { get: async () => ({}), patch: async () => ({}), post: async () => ({}) };
  const ws: any = { config: { companyId: 'company', paperclipUrl: 'http://localhost:3100', assistant: { agentKey: 'engine', engine: 'codex', enabled: true, projectId: 'private-runs' }, agents: { engine: { paperclipId: 'engine-id' } } },
    pc: native, store: { get: () => task, audit: () => {} }, state: async () => state, manager: (actor: { admin: boolean }) => { if (!actor.admin) throw new Error('Unauthorized'); },
    checkpoint: async (_id: string, text: string) => { writes.push('checkpoint:' + text); return { id: 'checkpoint' }; },
    propose: async () => { writes.push('candidate'); return { id: 'candidate' }; },
    domain: () => 'growth', save: async () => {}, issue: async () => ({ executionRunId: 'run' }) };
  const service = new WorkspaceAssistant(ws);
  service.owned = async () => job; service.job = async () => job; service.save = async () => {};
  service.bundle = async () => ({ basis: 'current', context: { sources, missing: [], task: {}, instruction: '', requests: [], checkpoints: [] } }) as any;
  return { service, ws, task, state, job, writes };
}
test('reused local evidence checks reject forged or paraphrased quotes and pin original revision', () => {
  assert.deepEqual(verifyEvidenceQuotes(output.evidenceQuotes, sources), [{ sourceId: 'sales', quote: '结果解释不足', revision: 'v1' }]);
  assert.throws(() => verifyEvidenceQuotes([{ sourceId: 'foreign', quote: '结果解释不足' }], sources), /不存在/);
  assert.throws(() => verifyEvidenceQuotes([{ sourceId: 'sales', quote: '实际转化率很高' }], sources), /不存在/);
  assert.deepEqual(projectHistoricalEvidence([{ id: 'sales', revision: 'v0' }, { id: 'withdrawn', revision: 'v1' }], sources).map(s => s.state), ['historical', 'revoked']);
});
test('assistant output cannot add authority fields or references outside the supplied task', () => {
  assert.equal(validateAssistantOutput(output, ['sales']).nextSteps[0]!.owner, 'human');
  assert.throws(() => validateAssistantOutput({ ...output, approveAccess: true }, ['sales']));
  assert.throws(() => validateAssistantOutput(output, []), /以外/);
});
test('a permission or revision change during generation discards output before any write', async () => {
  const f = fixture(); f.service.bundle = async () => ({ basis: 'changed', context: { sources: [], checkpoints: [], missing: [{ id: 'sales' }] } }) as any;
  const result = await f.service.result('job', 'run', output, {}, { admin: false, agent: 'engine' });
  assert.equal((result as any).stale, true); assert.equal(f.job.status, 'stale'); assert.equal(f.job.output, undefined); assert.equal(f.writes.length, 0);
});
test('suggestions mode writes no checkpoint, knowledge, permission or acceptance', async () => {
  const f = fixture(); f.job.mode = 'prepare';
  await f.service.result('job', 'run', output, {}, { admin: false, agent: 'engine' });
  assert.equal(f.job.status, 'completed'); assert.equal(f.writes.length, 0);
});
test('delegated preparation saves real work products as a checkpoint and a candidate once, never adopts them', async () => {
  const f = fixture(); await f.service.result('job', 'run', output, {}, { admin: false, agent: 'engine' });
  assert.equal(f.job.status, 'completed'); assert.equal(f.writes.length, 2); assert.match(f.writes[0]!, /可编辑说明模板/);
  assert.deepEqual(f.job.applied, { checkpoint: 'checkpoint', knowledge: 'candidate' });
  await f.service.result('job', 'run', output, {}, { admin: false, agent: 'engine' }); assert.equal(f.writes.length, 2);
});
test('no authorized material means no prepared checkpoint or knowledge write', async () => {
  const f = fixture(); f.service.bundle = async () => ({ basis: 'current', context: { sources: [], checkpoints: [], missing: [{ id: 'sales' }] } }) as any;
  await f.service.result('job', 'run', { ...output, evidenceQuotes: [], workProducts: [], checkpoint: '', knowledge: null }, {}, { admin: false, agent: 'engine' });
  assert.equal(f.writes.length, 0); assert.equal(f.job.status, 'completed');
});
test('native run binding rejects a human token, a different engine and a foreign issue', async () => {
  const f = fixture(), nativeOwned = WorkspaceAssistant.prototype.owned;
  await assert.rejects(nativeOwned.call(f.service, 'job', 'run', { admin: true }), /Unauthorized/);
  await assert.rejects(nativeOwned.call(f.service, 'job', 'run', { admin: false, agent: 'role-growth' }), /Unauthorized/);
  f.ws.pc.get = async () => ({ agentId: 'engine-id', contextSnapshot: { issueId: 'other' }, status: 'running' });
  await assert.rejects(nativeOwned.call(f.service, 'job', 'run', { admin: false, agent: 'engine' }), /does not own/);
});
test('cancellation leaves a durable stop state and does not hold the receipt lane while native stop waits', { timeout: 1000 }, async () => {
  const f = fixture(); let stopRequested = false, finishStop: (value: unknown) => void = () => {};
  f.ws.pc.post = () => { stopRequested = true; return new Promise(resolve => { finishStop = resolve; }); };
  await f.service.cancel('task', { admin: true });
  assert.equal(stopRequested, true); assert.equal(f.job.status, 'cancelling');
  finishStop({});
});
test('the assistant context omits revoked source bodies and does not retrieve their prior checkpoints', async () => {
  const f = fixture(); f.ws.source = (id: string) => ({ id, title: '销售资料', domain: 'sales', ref: { taskId: id, key: 'knowledge-sales' } });
  f.ws.sourceStatus = async () => ({ allowed: false, reason: 'permission' });
  f.ws.issue = async () => ({ title: '授权测试', description: '整理资料' });
  f.state.snapshots = [{ id: 'old-private-note', key: 'checkpoint', sources: ['sales'] }]; let reads = 0;
  f.ws.knowledge = { read: async () => { reads++; throw new Error('must not read'); } };
  f.ws.reader = () => ({ get: async (route: string) => { if (route.endsWith('/comments')) return []; reads++; throw new Error('must not read'); } });
  const result = await WorkspaceAssistant.prototype.bundle.call(f.service, f.task);
  assert.equal(reads, 0); assert.equal(result.context.sources.length, 0); assert.equal(result.context.checkpoints.length, 0); assert.equal(result.context.missing[0]!.reason, 'permission');
});
test('automatic preparation respects a prior refusal and does not request an unconfirmed source version', async () => {
  for (const reason of ['permission', 'version']) {
    const f = fixture(); f.state.delegation.lastBasis = 'current'; f.state.delegation.jobId = undefined;
    f.ws.sourceStatus = async () => ({ allowed: false, reason }); f.state.requests = ['denied'];
    f.ws.access = async () => ({ sourceId: 'sales', agent: f.task.agent, state: 'denied' });
    let requests = 0; f.ws.request = async () => { requests++; throw new Error('must not reapply'); };
    await f.service.advance('task'); assert.equal(requests, 0);
  }
});
