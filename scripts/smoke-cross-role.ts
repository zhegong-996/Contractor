import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { api } from '../src/client.ts';
import { runtime, secrets, loadConfig } from '../src/config.ts';
import { Paperclip } from '../src/paperclip.ts';
import { domains, domainNames } from '../src/workspaces.ts';
if (!process.argv.includes('--run')) throw new Error('Use --run to exercise the real local cross-role workflow with labeled test data');
const baseline = runtime('cross-role-progress.json'), fresh = process.argv.includes('--new-task');
const previous = existsSync(baseline) ? JSON.parse(readFileSync(baseline, 'utf8')) : undefined;
const file = fresh ? runtime('cross-role-progress-' + Date.now() + '.json') : baseline;
const progress: any = fresh ? { sources: previous?.sources ?? {}, requests: {}, startedAt: new Date().toISOString(), requestKey: randomUUID() }
  : previous ?? { sources: {}, requests: {}, startedAt: new Date().toISOString() };
const save = () => writeFileSync(file, JSON.stringify(progress, null, 2), { mode: 0o600 });
const call = (action: string, input: unknown, agent?: string) => api('/workspace/' + action, input, agent);
const native = (agent: string) => new Paperclip(loadConfig().paperclipUrl, secrets().paperclipTokens![agent]);
const body: Record<string, string> = {
  product: '联调数据：产品方案应明确用户问题、验收条件与目标版本。',
  growth: '联调数据：增长实验以门店试用到付费转化为目标，先确定指标口径。',
  sales: '联调数据：销售反馈包含对试用结果解释不足的异议，不含真实客户。',
  operations: '联调数据：客户原始资料按用途和期限授权，交接重新核对，任务结束撤权。',
};
for (const d of domains) {
  if (!progress.sources[d]) {
    const r = await call('create-source', { domain: d, record: { key: 'knowledge-pilot-' + d, title: '联调：' + domainNames[d] + '资料',
      domains: [d], kind: 'reference', appliesTo: '仅供跨岗位功能联调，不代表真实业务结论', facts: { testData: true, version: 1 },
      body: body[d], sources: ['https://github.com/zhegong-996/suitme-collab'] } });
    await call('review-source', { id: r.source.id, state: 'confirmed', revision: r.record.revision });
    progress.sources[d] = r.source; save();
  }
}
if (!progress.task) {
  progress.task = await call('create-task', { title: '跨岗位联调：门店试用转化改进', goal: '增长分析销售反馈与职能规范，交接给产研形成方案；结束临时授权，将经过确认的流程经验沉淀到产研知识空间。全部使用联调资料。',
    agent: 'role-growth', sources: [progress.sources.sales.id, progress.sources.operations.id], requestKey: progress.requestKey ?? 'cross-role-pilot-v2' }); save();
}
const id = progress.task.id;
async function grant(agent: string, domain: string) {
  const key = agent + ':' + domain;
  if (!progress.requests[key]) {
    // Native approval is created by the same scoped API the MCP requester uses.
    progress.requests[key] = await call('request', { taskId: id, sourceId: progress.sources[domain].id, agent,
      purpose: '完成门店试用转化方案联调；仅本任务使用', hours: 8, requestKey: key }, agent === 'role-growth' ? agent : undefined); save();
  }
  const r = progress.requests[key];
  if (r.state === 'pending') { progress.requests[key] = await call('decide', { id: r.id, decision: 'approved', reason: '联调用途与资料范围匹配，允许当前执行者限时读取' }); save(); }
}
if (!progress.growthDone) {
  await assert.rejects(call('read-source', { taskId: id, sourceId: progress.sources.sales.id }, 'role-growth'), /Unauthorized/);
  await assert.rejects(native('role-growth').get('/issues/' + progress.sources.sales.ref.taskId), /404/);
  await assert.rejects(api('/tasks/' + id + '/claim', { lease: randomUUID() }, 'role-growth'), /申请或恢复访问/);
  await grant('role-growth', 'sales'); await grant('role-growth', 'operations');
  assert.ok((await call('read-source', { taskId: id, sourceId: progress.sources.sales.id }, 'role-growth')).value.body.includes('联调数据'));
  const claimed = await api('/tasks/' + id + '/claim', { lease: randomUUID() }, 'role-growth');
  const receipt = { receiptId: 'cross-role-growth-checkpoint', agent: 'role-growth', lease: claimed.lease,
    text: '联调分析：先明确试用结果说明的缺口，再按职能规范约束资料访问。已使用销售反馈与职能规范，交给产研形成可验收方案。' };
  progress.growthCheckpoint = (await api('/tasks/' + id + '/receipt', receipt, 'role-growth')).checkpoint;
  const duplicate = (await api('/tasks/' + id + '/receipt', receipt, 'role-growth')).checkpoint;
  assert.equal(duplicate.id, progress.growthCheckpoint.id); progress.growthDone = true; save();
}
if (!progress.handoffDone) {
  await assert.rejects(call('handoff', { taskId: id, agent: 'role-product' }), /申请或恢复访问/);
  await grant('role-product', 'sales'); await grant('role-product', 'operations');
  await call('handoff', { taskId: id, agent: 'role-product' });
  await assert.rejects(api('/tasks/' + id, undefined, 'role-growth'), /another agent/);
  await assert.rejects(native('role-growth').get('/issues/' + progress.sources.sales.ref.taskId), /404/);
  await assert.rejects(native('role-growth').get('/issues/' + progress.growthCheckpoint.id + '/documents/checkpoint'), /404/);
  assert.ok((await native('role-product').get('/issues/' + progress.growthCheckpoint.id + '/documents/checkpoint')).body);
  progress.handoffDone = true; save();
}
if (!progress.outcome) {
  const claimed = await api('/tasks/' + id + '/claim', { lease: randomUUID() }, 'role-product');
  progress.productCheckpoint = (await api('/tasks/' + id + '/receipt', { receiptId: 'cross-role-product-checkpoint',
    agent: 'role-product', lease: claimed.lease, text: '联调方案：产品交付需具体验收条件；资料访问和业务验收分别记录，交接重新授权。' }, 'role-product')).checkpoint;
  progress.outcome = await call('propose', { taskId: id, record: { key: 'knowledge-cross-role-lesson', title: '联调经验：跨岗位交接与资料授权',
    domains: ['product', 'growth'], kind: 'procedure', appliesTo: '本平台跨岗位协作流程', facts: { scope: '任务与当前执行者', revokeOnHandoff: true },
    body: '跨岗位任务先明确目标和验收条件；资料访问绑定任务与执行者，交接时重新核对，临时授权随任务结束。此条仅为联调形成的流程约定，不包含客户、销售或职能原始资料。',
    sources: ['https://github.com/zhegong-996/suitme-collab'] } }, 'role-product'); save();
  const v = await call('view', {}), t = v.tasks.find((t: any) => t.id === id), doc = t.snapshots.find((s: any) => s.id === progress.outcome.id);
  await call('review', { taskId: id, outcomeId: progress.outcome.id, state: 'confirmed', revision: doc.revision }); progress.confirmed = true; save();
}
if (!progress.revoked) {
  await call('revoke', { id: progress.requests['role-product:sales'].id, reason: '撤权联调：验证直接读取、旧检查点与后续执行同时失效' });
  await assert.rejects(call('read-source', { taskId: id, sourceId: progress.sources.sales.id }, 'role-product'), /Unauthorized/);
  await assert.rejects(native('role-product').get('/issues/' + progress.sources.sales.ref.taskId), /404/);
  await assert.rejects(native('role-product').get('/issues/' + progress.productCheckpoint.id + '/documents/checkpoint'), /404/);
  await assert.rejects(native('role-product').get('/issues/' + progress.outcome.id + '/documents/' + progress.outcome.key), /404/);
  await assert.rejects(api('/tasks/' + id + '/claim', { lease: randomUUID() }, 'role-product'), /申请或恢复访问/);
  const view = await call('view', {}, 'role-product'), t = view.tasks.find((t: any) => t.id === id);
  assert.ok(t.snapshots.every((s: any) => s.restricted)); progress.revoked = true; save();
}
if (!progress.published) {
  const v = await call('view', {}), t = v.tasks.find((t: any) => t.id === id), doc = t.snapshots.find((s: any) => s.id === progress.outcome.id);
  progress.published = await call('publish', { taskId: id, outcomeId: progress.outcome.id, revision: doc.revision,
    reason: '负责人确认该流程约定不包含原始业务内容，单独发布到产研知识空间，授权范围为该空间成员。原受限结论与检查点继续受源授权约束。' }); save();
}
await call('complete', { taskId: id });
const current = await api('/tasks/' + id), evidence = { type: 'live-native-cross-role-workflow', taskId: id, identifier: current.identifier,
  sourceData: 'explicitly labeled integration fixtures', modelCalls: 0, nativeProjects: 4, professionalAgentPrincipals: 4,
  requestAndNativeApproval: true, readBeforeApproval: 'denied', approvedRead: 'passed', checkpointRetry: 'same object',
  handoffBeforeNewAuthorization: 'denied', handoffAfterAuthorization: 'passed', oldExecutorAndSnapshots: 'denied',
  revokedSourceDirectApi: 'denied', revokedCheckpointAndKnowledgeDirectApi: 'denied', staleContextExecution: 'blocked',
  explicitProfessionalPublication: progress.published.id, temporaryGrantsClosed: true, phase: current.phase };
assert.equal(current.phase, 'accepted'); writeFileSync(runtime('cross-role-evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
