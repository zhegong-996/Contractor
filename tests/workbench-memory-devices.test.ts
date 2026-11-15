import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentBudgets } from '../src/workbench/agent-budget.ts';

test('额度按用途和执行尝试记一次，上海时间切换周期，未知报价与零费用分开', () => {
  const db = new DatabaseSync(':memory:');
  try {
    let at = Date.parse('2026-11-15T23:59:50+08:00');
    const budgets = new AgentBudgets(db, () => at);
    const pool = { kind: 'personal', subject: 'design' } as const;
    const project = { kind: 'execution', subject: 'store' } as const;
    const charge = { ...pool, run: 1, attempt: 1, project: 'store', owner: 'design' };
    budgets.set(pool, 'owner', 'day', 1, 3);
    assert.ok(budgets.reserve(charge));
    assert.ok(budgets.reserve(charge), '重送同一次只预留一笔');
    assert.equal(budgets.reserve({ ...charge, ...project }), false, '同一次不能转记其他池');
    assert.equal(budgets.reserve({ ...charge, attempt: 2 }), false);
    assert.equal(budgets.view(pool).pending, 1);
    assert.equal(budgets.boundTimeout(pool), 3);
    budgets.settle(1, 1, 'cancelled', { input: 15, output: 4 });
    budgets.settle(1, 1, 'done', { cost: 0 });
    assert.equal(budgets.view(pool).tokens, 19);
    assert.equal(budgets.view(pool).unpriced, 1);
    assert.equal(budgets.view(pool).pending, 0);
    assert.equal(budgets.view(project).used, 0);
    at += 20000;
    assert.equal(budgets.view(pool).remaining, 1);
    assert.ok(budgets.reserve({ ...charge, run: 2 }));
    budgets.settle(2, 1, 'done', { cost: 0 });
    assert.equal(budgets.view(pool).unpriced, 0);
  } finally { db.close(); }
});

test('同单离线执行端等待，换端只运行一次并引用替代后的公开现行记忆', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'suitme-memory-devices-'));
  process.env.COLLAB_STATE_DIR = dir;
  await mkdir(path.join(dir, 'console'));
  const worker = path.join(dir, 'fixture.mjs');
  await writeFile(worker, [
    "import { readFileSync } from 'node:fs';",
    "const input = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT, 'utf8'));",
    "const evidence = input.events.find(event => event.type === 'knowledge.source');",
    "const citation = evidence?.detail.match(/\\[记忆:[^\\]]+\\]/)?.[0];",
    "console.log('口径核对完成' + (citation ? ' ' + citation : ''));",
  ].join('\n'));
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'fixture-password-only');
  for (const actor of ['design', 'steward', 'observer']) await auth.createAccount(actor, 'fixture-password-only', 'operator', 'product');
  const cfg = settingsSchema.parse({
    projects: [
      { id: 'store', title: '门店推荐理由', members: ['product', 'design', 'steward'], maintainers: ['product'] },
      { id: 'other', title: '无关项目', members: ['observer'], maintainers: ['observer'] },
    ],
    functions: [{ id: 'style', title: '推荐口径' }],
    agents: [{ id: 'review', title: '设计 Agent', owner: 'design', kind: 'personal', projects: ['store'], function: 'style',
      execution: { kind: 'test', provider: 'fixture' }, engine: 'command', command: [process.execPath, worker],
      capability: '门店推荐', skill: '核对项目记忆', active: true }],
  });
  const work = await openCollaboration(cfg, auth);
  t.after(async () => { await work.close(); await rm(dir, { recursive: true, force: true }); });
  async function wait<T>(read: () => T | undefined, label: string) {
    for (let attempt = 0; attempt < 160; attempt++) {
      const state = read();
      if (state) return state;
      await delay(100);
    }
    assert.fail('等待 ' + label);
  }
  const note = { title: '门店推荐理由口径', kind: 'decision', visibility: 'project' as const, conditions: '仅用于试点门店' };
  const first = work.addKnowledge('product', 'store', { ...note, body: '先场景，再商品特点' });
  const revision = work.browse('product', 'store', '', true).find(entry => entry.id === first);
  assert.ok(revision && 'revision' in revision);
  work.setMemoryPin('product', first, true);
  const replacement = work.addKnowledge('product', 'store', { ...note, body: '先核实商品事实，再说明场景', replaces: { id: first, revision: revision.revision } });
  const next = work.browse('product', 'store', '', true).find(entry => entry.id === replacement);
  assert.ok(next && 'revision' in next);
  await work.publish('product', replacement, next.revision);
  work.addKnowledge('steward', 'store', { ...note, visibility: 'restricted', body: '未授权的门店材料' });
  assert.deepEqual(work.recallMemory('design', 'store', '门店推荐理由').map(ref => [ref.id, ref.pinned]), [[replacement, true]]);
  assert.throws(() => work.recallMemory('observer', 'store', '门店推荐理由'), { status: 404 });

  assert.throws(() => work.issueDevicePair('product', 'store', 'review'), { status: 403 });
  const proof = work.issueDevicePair('design', 'store', 'review');
  const paired = work.pairDevice(proof.code, '离线设备');
  assert.throws(() => work.pairDevice(proof.code, '重放'), { status: 403 });
  assert.throws(() => work.projectDevices('observer', 'store'), { status: 404 });
  work.setBudget('product', { kind: 'execution', subject: 'store' }, 'day', 1);
  assert.throws(() => work.setBudget('design', { kind: 'personal', subject: 'design' }, 'day', 1), { status: 403 });
  const started = work.start('product', { project: 'store', title: '核对门店推荐理由', request: '引用现行门店推荐理由',
    agent: 'review', device: paired.id, recall: true, material: [], priority: 'normal', nonce: randomUUID() });
  const ticket = await wait(() => work.resolveStart('product', started.trigger) ?? undefined, '工单创建');
  await delay(1200);
  const before = work.detail('product', ticket);
  assert.equal(before.device?.online, false);
  assert.deepEqual(before.work.recall, [replacement]);
  assert.equal(work.budgetPools('product', 'store').find(pool => pool.kind === 'execution')?.used, 0);
  work.resume('product', ticket, { version: 1, reason: '离线，改由工作台执行端接续', nonce: randomUUID(), device: null });
  const result = await wait(() => work.detail('product', ticket).result, '原单接续');
  assert.deepEqual(result.cited, [{ id: replacement, revision: next.revision }]);
  assert.match(result.text, /口径核对完成/);
  assert.equal(work.memoryUses('product', replacement).filter(item => item.cited && item.recalled && item.ticket === ticket).length, 1);
  assert.equal(work.budgetPools('product', 'store').find(pool => pool.kind === 'execution')?.used, 1);
  await work.accept('product', ticket, result.revision, '试点门店', '');
  assert.ok(work.memoryHome('product', 'store').some(entry => entry.ticket === ticket && entry.state === 'candidate'));
});
