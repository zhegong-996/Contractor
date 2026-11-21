import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { AgentBudgets } from '../src/workbench/agent-budget.ts';
import { emptyHarness, openAssistantHarness } from '../src/workbench/assistant-harness.ts';
import { OctopResources } from '../src/workbench/octop-resources.ts';
import { openPlatformAssistant } from '../src/workbench/platform-assistant.ts';
import { assistantContext } from '../src/workbench/plugins/assistant-context.ts';
import { readSkillManifest } from '../src/workbench/skill-manifest.ts';
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
    const harness = openAssistantHarness(store, new OctopResources(db), assistantContext,
      { admin: () => true, active: () => true, audit: () => {}, readSkill: readSkillManifest });
    db.exec(`CREATE TABLE workbench_platform_assistant_call (
      id INTEGER PRIMARY KEY, opened INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL, actor TEXT NOT NULL,
      state TEXT NOT NULL, reported TEXT, tokens INTEGER
    )`);
    const open = () => openPlatformAssistant(store, [{ provider: model.provider, models: [model.model] }], {
      available: () => true, complete: async () => assert.fail('重启恢复不应重新调用模型'),
    }, { admin: () => true, allowed: () => true, audit: () => {}, budgets, points, harness });
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

test('Router、知识提炼与个人 Agent 分别装配提示词、技能和上下文，设备授权由独立规则管理', { timeout: 18000 }, async t => {
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
  const calls: { model: string; evidence: string; system: string }[] = [];
  let delayDraft: Promise<void> | undefined;
  let delayPersonal: Promise<void> | undefined;
  const plugins = platformPlugins(config, {
    assistantHarness: { id: 'fixture-context', api: 1, service: { ...assistantContext, context: [
      ...assistantContext.context,
      { id: 'fixture-label', version: '2', title: '测试标签', description: '测试独立上下文组件', defaultEnabled: false,
        purposes: ['personal'], contribute: () => ({ testLabel: '门店验收' }) },
    ] } },
    assistant: { id: 'fixture-assistant', api: 1, service: {
      available: () => true,
      async complete(input) {
        calls.push(input);
        const data = JSON.parse(input.evidence);
        if (data.body && delayDraft) await delayDraft;
        if (data.question === '复核待停用技能' && delayPersonal) await delayPersonal;
        const value = data.agents ? { agent: 'outside-model-choice', summary: '需要负责人决定' }
          : data.question ? { answer: data.history?.[0]?.content ?? data.experience ?? '根据当前问题核对' }
            : { title: '小屏长词', body: '核对 280px、320px、360px', conditions: '门店推荐卡片' };
        return { model: input.model, choices: [{ message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 12, completion_tokens: 8 } };
      },
    } },
  });
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
  assert.throws(() => work.assistantSkills('engineering', 'team'), { status: 403 });
  const publish = (actor: string, scope: 'team' | 'personal', slug: string, title: string, body: string) =>
    work.changeAssistantSkill(actor, scope, { action: 'publish', slug, title, markdown: '---\nname: ' + slug + '\n---\n' + body });
  assert.throws(() => publish('engineering', 'team', 'misuse', '未经批准的技能', '尝试创建团队技能'), { status: 403 });
  assert.throws(() => publish('product', 'team', 'bad-name', '配置凭据', 'API_KEY: forbidden-fixture-token'), { status: 400 });
  const team = publish('product', 'team', 'store-check', '门店核对技能', '提供三档宽度的出处。');
  const privateSkill = publish('engineering', 'personal', 'personal-check', '个人小屏清单', '先看低宽度长词样例。');
  const memory = work.assistantSkills('product', 'team').find(row => row.slug === 'capture-reusable-rule');
  assert.ok(memory);
  assert.ok(work.assistantSkills('engineering', 'personal').some(row => row.id === team.id && !row.editable));
  assert.ok(!work.assistantSkills('product', 'personal').some(row => row.id === privateSkill.id));
  const editedAdmin = { revision: admin.revision, selection: model, dailyLimit: 5, harness: {
    router: { instructions: '门店问题路由优先核对现象和职责。', bindings: { ...emptyHarness(), skills: [team] } },
    memory: { instructions: '提炼时先写验证条件。', bindings: { ...emptyHarness(), skills: [{ id: memory.id, revision: memory.revision }] } },
  } };
  assert.throws(() => work.setPlatformAssistant('product', { ...editedAdmin,
    harness: { ...editedAdmin.harness, router: { ...editedAdmin.harness.router, bindings: { ...emptyHarness(), skills: [privateSkill] } } },
  }), { status: 409 });
  work.setPlatformAssistant('product', editedAdmin);
  assert.throws(() => work.setPlatformAssistant('product', editedAdmin), { status: 409 });

  const personal = work.personalAgent('engineering');
  const personalInput = { revision: personal.revision, title: '我的验收助手', description: '门店小屏检查',
    instructions: '用清单答复。', experience: '门店小屏用连续长词', selection: { ...model, model: 'fixture-b' },
    harness: { skills: [team, privateSkill], context: { 'fixture-label': true } } };
  work.setPersonalAgent('engineering', personalInput);
  assert.throws(() => work.setPersonalAgent('outsider', { ...personalInput, revision: work.personalAgent('outsider').revision }), { status: 409 });
  assert.throws(() => work.changeAssistantSkill('outsider', 'personal', { action: 'status', id: privateSkill.id, active: false }), { status: 404 });
  assert.equal(work.personalAgent('outsider').experience, '');
  assert.equal(work.personalAgent('engineering').description, personalInput.description);
  const newer = publish('product', 'team', 'store-check', '门店核对技能', '新版还需要核对原型。');
  assert.equal(newer.id, team.id);
  assert.notEqual(newer.revision, team.revision);
  const answer = await work.askPersonalAgent('engineering', '该用什么样例？');
  assert.equal(answer.value.answer, '门店小屏用连续长词');
  assert.equal(answer.model.model, 'fixture-b');
  assert.deepEqual(answer.harness.skills.map(({ id, revision }) => ({ id, revision })), [team, privateSkill]);
  assert.deepEqual(answer.harness.context.find(row => row.id === 'fixture-label'), { id: 'fixture-label', version: '2', title: '测试标签' });
  assert.match(calls.at(-1)!.system, /用清单答复[\s\S]*提供三档宽度的出处[\s\S]*先看低宽度长词样例/);
  assert.doesNotMatch(calls.at(-1)!.system, /核对原型|提炼时先写验证条件/);
  assert.equal(JSON.parse(calls.at(-1)!.evidence).agentName, '我的验收助手');
  assert.equal(JSON.parse(calls.at(-1)!.evidence).testLabel, '门店验收');
  assert.equal(work.platformAssistant('product').recent.length, 0);

  const opening = { nonce: randomUUID(), question: '门店标签是柚木-71。' };
  const first = work.sendPersonalMessage('engineering', opening);
  assert.deepEqual(work.sendPersonalMessage('engineering', opening), first);
  assert.throws(() => work.sendPersonalMessage('engineering', { ...opening, question: '改用其他标签' }), { status: 409 });
  assert.throws(() => work.sendPersonalMessage('engineering', { ...opening, conversation: first.conversation, nonce: randomUUID() }),
    { status: 409 });
  assert.equal(work.personalConversations('engineering').rows[0]?.id, first.conversation);
  for (const other of ['product', 'outsider']) {
    assert.equal(work.personalConversations(other).rows.length, 0);
    assert.throws(() => work.personalConversation(other, first.conversation), { status: 404 });
    assert.throws(() => work.sendPersonalMessage(other, { ...opening, conversation: first.conversation }), { status: 404 });
  }
  await wait(() => work.personalConversation('engineering', first.conversation).rows[0]?.answer);
  const followup = { nonce: randomUUID(), conversation: first.conversation, question: '刚才的门店标签是什么？' };
  work.sendPersonalMessage('engineering', followup);
  assert.equal(await wait(() => work.personalConversation('engineering', first.conversation).rows.at(-1)?.answer), opening.question);
  assert.deepEqual(work.personalConversation('engineering', first.conversation).rows.map(turn => turn.model), ['fixture-b', 'fixture-b']);
  assert.equal(calls.filter(call => JSON.parse(call.evidence).question === opening.question).length, 1);
  assert.deepEqual(JSON.parse(calls.find(call => JSON.parse(call.evidence).question === followup.question)!.evidence).history,
    [{ role: 'user', content: opening.question }, { role: 'assistant', content: '门店小屏用连续长词' }]);
  const turn = work.personalConversation('engineering', first.conversation).rows.at(-1)!;
  assert.equal(turn.harness?.title, '我的验收助手');
  assert.equal(turn.harness?.skills[0]?.revision, team.revision);
  let releasePersonal!: () => void;
  delayPersonal = new Promise(resolve => { releasePersonal = resolve; });
  const underway = work.askPersonalAgent('engineering', '复核待停用技能');
  work.changeAssistantSkill('product', 'team', { action: 'status', id: team.id, active: false });
  work.changeAssistantSkill('product', 'team', { action: 'status', id: team.id, active: true });
  releasePersonal();
  await assert.rejects(underway, { status: 409 });
  work.changeAssistantSkill('product', 'team', { action: 'status', id: team.id, active: false });
  assert.equal(work.personalAgent('engineering').mounts.find(row => row.id === team.id)?.active, false);
  const updatedPersonal = work.setPersonalAgent('engineering', { ...personalInput, revision: work.personalAgent('engineering').revision,
    title: '新的验收助手', harness: { ...personalInput.harness, context: { 'confirmed-experience': false, 'conversation-history': false } } });
  assert.equal(updatedPersonal.title, '新的验收助手');
  work.sendPersonalMessage('engineering', { ...followup, nonce: randomUUID(), question: '仅根据本轮核对。' });
  assert.equal(await wait(() => work.personalConversation('engineering', first.conversation).rows.at(-1)?.answer), '根据当前问题核对');
  const input = calls.at(-1)!;
  assert.doesNotMatch(input.system, /提供三档宽度的出处|新版还需要核对原型/);
  assert.doesNotMatch(input.evidence, /"history"|"experience"|"testLabel"/);
  assert.equal(work.personalConversation('engineering', first.conversation).rows[0]?.harness?.title, '我的验收助手');
  work.changeAssistantSkill('product', 'team', { action: 'status', id: team.id, active: true });

  const scope = { project: 'store', title: '门店推荐理由', request: '整理小屏验收清单', material: [],
    priority: 'normal' as const };
  const pending = work.start('engineering', { ...scope, nonce: randomUUID(), agent: 'auto' });
  assert.equal(pending.pending, true);
  await assert.rejects(work.draftIntake('outsider', pending.trigger), { status: 404 });
  const routing = await work.draftIntake('product', pending.trigger);
  assert.equal(routing.value.agent, null);
  assert.match(calls.at(-1)!.system, /门店问题路由优先核对现象和职责[\s\S]*提供三档宽度的出处/);
  assert.doesNotMatch(calls.at(-1)!.system, /提炼时先写验证条件|个人小屏清单/);
  assert.equal(routing.harness.skills[0]?.revision, team.revision);
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
  assert.match(calls.at(-1)!.system, /提炼时先写验证条件[\s\S]*提炼可复用的规则/);
  assert.doesNotMatch(calls.at(-1)!.system, /门店核对技能|门店问题路由/);
  assert.notEqual(draft.harness.revision, routing.harness.revision);
  assert.ok(work.platformAssistant('product').recent.some(row => row.harness?.revision === draft.harness.revision));
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
