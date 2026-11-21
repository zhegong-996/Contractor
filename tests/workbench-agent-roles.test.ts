import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { AgentBudgets } from '../src/workbench/agent-budget.ts';
import { openPlatformAssistant } from '../src/workbench/platform-assistant.ts';
import { TokenPoints } from '../src/workbench/token-points.ts';

test('整理模型在工作台重启后将未回传用量登记为未知并保留预留', () => {
  const db = new DatabaseSync(':memory:');
  const store = { db, atomic<T>(action: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
  try {
    const budgets = new AgentBudgets(db);
    const points = new TokenPoints(db);
    const model = { provider: 'ollama' as const, model: 'fixture-model' };
    points.setPolicy({ enabled: true, tokensPerPoint: 1000, rates: [{ ...model, multiplier: 1, reserveTokens: 1000 }] });
    const pool = { kind: 'platform' as const, subject: 'platform' };
    const open = () => openPlatformAssistant(store, [{ provider: model.provider, models: [model.model] }], {
      available: () => true, complete: async () => assert.fail('重启恢复不应重新调用模型'),
    }, { admin: () => true, allowed: () => true, audit: () => {}, budgets, points });
    open();
    db.prepare("INSERT INTO workbench_platform_assistant_call(id,opened,provider,model,purpose,actor,state) VALUES(?,?,?,?,?,?,'pending')")
      .run(1, Date.now(), model.provider, model.model, 'memory', 'product');
    assert.ok(budgets.reserve({ ...pool, run: -1, attempt: 1, agent: '$platform-assistant', project: 'store', owner: 'product' }));
    points.reserve(-1, 1, points.quote(model.provider, model.model));
    const recent = open().view('product').recent;
    assert.equal(recent[0]?.state, 'unknown');
    assert.equal(recent[0]?.tokens, null);
    assert.equal(budgets.view(pool).pending, 0);
    assert.equal(points.receipts('store')[0]?.state, 'unreported');
    assert.equal(points.view(pool).reserved, 1);
    assert.equal(open().view('product').recent.length, 1);
  } finally { db.close(); }
});

test('平台模型只起草，个人经验隔离，设备登记与任务授权各自生效', { timeout: 18000 }, async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-agent-roles-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'));
  const fixture = path.join(state, 'worker.mjs');
  await writeFile(fixture, 'console.log("用连续长词在 280px、320px、360px 核对推荐理由。");\n');
  const [{ openCollaboration }, { settingsSchema }, { platformPlugins }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'),
    import('../src/workbench/platform-plugins.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'fixture-password-only');
  for (const member of ['engineering', 'outsider']) await auth.createAccount(member, 'fixture-password-only', 'operator', 'product');
  const spec = { owner: 'engineering', projects: ['store'], kind: 'specialist', function: 'review', active: true,
    skill: '只读核对', capability: '核对小屏验收' };
  const config = settingsSchema.parse({ executionRuntime: 'contractor', remoteRunnerPort: 4339,
    runnerConnectUrl: 'http://127.0.0.1:4380', platformAssistant: [{ provider: 'ollama', models: ['fixture-a', 'fixture-b'] }],
    projects: [
      { id: 'store', title: '门店推荐理由', members: ['product', 'engineering'], maintainers: ['product'] },
      { id: 'separate', title: '独立项目', members: ['outsider'], maintainers: ['outsider'] },
    ], functions: [{ id: 'review', title: '核对' }],
    agents: [{ ...spec, id: 'fixture', title: '验收演练', engine: 'command', command: [process.execPath, fixture],
      execution: { kind: 'test', provider: 'fixture' } },
    { ...spec, id: 'mobile', title: '小屏 Codex', engine: 'codex', model: 'fixture-model',
      execution: { kind: 'remote', provider: 'openai', credential: 'test' } },
    { ...spec, id: 'claude', title: '资料 Claude', engine: 'claude', model: 'fixture-model',
      execution: { kind: 'remote', provider: 'ollama' } }],
  });
  const calls: { model: string; evidence: string }[] = [];
  let delayDraft: Promise<void> | undefined;
  const plugins = platformPlugins(config, { assistant: { id: 'fixture-assistant', api: 1, service: {
    available: () => true,
    async complete(input) {
      calls.push(input);
      const data = JSON.parse(input.evidence);
      if (data.body && delayDraft) await delayDraft;
      const value = data.agents ? { agent: 'outside-model-choice', summary: '需要负责人决定' }
        : data.question ? { answer: data.experience } : { title: '小屏长词', body: '核对 280px、320px、360px', conditions: '门店推荐卡片' };
      return { model: input.model, choices: [{ message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 12, completion_tokens: 8 } };
    },
  } } });
  const work = await openCollaboration(config, auth, undefined, undefined, undefined, plugins);
  t.after(async () => { await work.close(); await rm(state, { recursive: true, force: true }); });
  async function wait<T>(read: () => T | undefined | null): Promise<T> {
    for (let i = 0; i < 95; i++) {
      const found = read();
      if (found) return found;
      await delay(70);
    }
    assert.fail('未获得回归执行成果');
  }
  const model = { provider: 'ollama' as const, model: 'fixture-a' };
  const admin = work.platformAssistant('product');
  assert.equal(admin.enabled, false);
  assert.throws(() => work.setPlatformAssistant('engineering', { revision: admin.revision, selection: model, dailyLimit: 5 }), { status: 403 });
  work.setPlatformAssistant('product', { revision: admin.revision, selection: model, dailyLimit: 5 });

  const personal = work.personalAgent('engineering');
  work.setPersonalAgent('engineering', { revision: personal.revision, title: '我的验收助手', instructions: '',
    experience: '门店小屏用连续长词', selection: { ...model, model: 'fixture-b' } });
  assert.equal(work.personalAgent('outsider').experience, '');
  const answer = await work.askPersonalAgent('engineering', '该用什么样例？');
  assert.equal(answer.value.answer, '门店小屏用连续长词');
  assert.equal(answer.model.model, 'fixture-b');
  assert.equal(work.platformAssistant('product').recent.length, 0);

  const scope = { project: 'store', title: '门店推荐理由', request: '整理小屏验收清单', material: [],
    priority: 'normal' as const };
  const pending = work.start('engineering', { ...scope, nonce: randomUUID(), agent: 'auto' });
  assert.equal(pending.pending, true);
  await assert.rejects(work.draftIntake('outsider', pending.trigger), { status: 404 });
  const routing = await work.draftIntake('product', pending.trigger);
  assert.equal(routing.value.agent, null);
  assert.equal(work.resolveStart('engineering', pending.trigger), null);

  const started = work.start('product', { ...scope, nonce: randomUUID(), agent: 'fixture' });
  const id = await wait(() => work.resolveStart('product', started.trigger));
  const result = await wait(() => work.detail('product', id).result);
  await work.accept('product', id, result.revision, '', '');
  const candidate = work.browse('product', 'store', '').find(row => 'ticket' in row && row.ticket === id);
  assert.ok(candidate && 'revision' in candidate);
  await assert.rejects(work.draftKnowledge('engineering', candidate.id, candidate.revision), { status: 403 });
  const draft = await work.draftKnowledge('product', candidate.id, candidate.revision);
  assert.deepEqual(draft.model, routing.model);
  const unchanged = work.browse('product', 'store', '').find(row => row.id === candidate.id);
  assert.ok(unchanged && 'revision' in unchanged);
  assert.equal(unchanged.revision, candidate.revision);
  await assert.rejects(async () => work.publish('product', candidate.id, candidate.revision), { status: 409 });
  let release!: () => void;
  delayDraft = new Promise(resolve => { release = resolve; });
  const stale = work.draftKnowledge('product', candidate.id, candidate.revision);
  const review = work.reviewKnowledge('product', candidate.id, { revision: candidate.revision, ...draft.value });
  release();
  await assert.rejects(stale, { status: 409 });
  await work.publish('product', candidate.id, review.revision);
  assert.equal(work.browse('product', 'store', '').find(row => row.id === candidate.id)?.state, 'published');
  assert.equal(calls.filter(row => row.model === 'fixture-a').length, 3);

  const request = { id: randomUUID(), name: '联调设备', mode: 'worker' as const, engines: ['codex', 'claude'] as ('codex' | 'claude')[] };
  const proof = randomBytes(32).toString('base64url');
  work.beginDeviceEnrollment(request, proof);
  work.approveDeviceEnrollment('engineering', request.id);
  const paired = work.finishDeviceEnrollment(request.id, proof);
  assert.ok('token' in paired);
  const worker = work.myWorkers('engineering').devices[0]!;
  assert.deepEqual(work.myWorkers('outsider').devices, []);
  assert.deepEqual(work.projectDevices('product', 'store'), []);
  assert.throws(() => work.setWorkerProjects('engineering', worker.id, { revision: worker.revision, projects: ['separate'] }), { status: 403 });
  work.setWorkerProjects('engineering', worker.id, { revision: worker.revision, projects: ['store'] });
  await work.deviceWork(paired.token, { claim: randomUUID(), wait: 0, running: [], capacity: true, engines: ['claude'] }, true);
  assert.deepEqual(work.projectDevices('product', 'store')[0]!.eligibleAgents, ['mobile', 'claude']);
  assert.deepEqual(work.projectDevices('product', 'store')[0]!.readyAgents, ['claude']);
  assert.deepEqual(work.finishDeviceEnrollment(request.id, proof), paired);
});
