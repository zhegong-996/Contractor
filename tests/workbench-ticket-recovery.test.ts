import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

test('模型目录暂不可用时保留原生重试，同工单的重复接续不会另派', { timeout: 12000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-ticket-recovery-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'test-only-password');
  await auth.createAccount('engineer', 'test-only-password', 'operator', 'product');
  const executionRuntime = process.env.CONTRACTOR_TEST_EXECUTION === 'contractor' ? 'contractor' : 'autoloop';
  const config = settingsSchema.parse({
    executionRuntime,
    projects: [{ id: 'store', title: '门店推荐理由', members: ['product', 'engineer'], maintainers: ['product'],
      modelRoutes: [{ purpose: 'execution', agent: 'check', models: ['fixture-model'] }] }],
    functions: [{ id: 'check', title: '小屏核对' }],
    agents: [{ id: 'check', title: '小屏验收', owner: 'engineer', engine: 'codex', model: 'fixture-model', allowedModels: ['fixture-model'],
      active: true, kind: 'specialist', capability: '核对门店推荐理由', skill: '只读', function: 'check', projects: ['store'],
      execution: { kind: 'sandbox', credential: 'unavailable-credential', provider: 'openai' } }],
  });
  const work = await openCollaboration(config, auth);
  const ledger = executionRuntime === 'contractor' ? ['dispatch', 'hub.sqlite'] : ['autoloop', 'hub.db'];
  const db = new DatabaseSync(path.join(state, ...ledger), { readOnly: true });
  t.after(async () => { db.close(); await work.close(); await rm(state, { recursive: true, force: true }); });
  const { ticket } = work.start('product', { project: 'store', agent: 'check', title: '门店小屏验收', request: '核对长词换行',
    material: [], priority: 'normal', nonce: randomUUID() }, undefined, true);
  assert.ok(ticket);
  const detail = () => work.detail('product', ticket);
  for (let count = 0; count < 40 && detail().recovery?.kind !== 'model-unavailable'; count++) await delay(150);
  const recovery = detail().recovery;
  assert.equal(recovery?.kind, 'model-unavailable');
  assert.equal(recovery?.next, 'wait-native-retry');
  assert.deepEqual(recovery?.owners, ['engineer']);
  const native = db.prepare('SELECT id,state,attempts,not_before FROM runs WHERE lane=?');
  const original = native.all(ticket);
  assert.deepEqual(original.map(row => [row.id, row.state, row.attempts, row.not_before]), [[recovery?.run, 'queued', 1, recovery?.retryAt]]);
  for (const member of ['product', 'engineer']) {
    assert.equal(work.resume(member, ticket, { version: 1, reason: '检查模型是否恢复', nonce: randomUUID() }).waiting, 'model');
    assert.ok(!work.needsYou(member).some(item => item.ticket === ticket));
  }
  assert.deepEqual(native.all(ticket), original);
  assert.equal(work.projectUsage('product', 'store').attempts.length, 0);
});
