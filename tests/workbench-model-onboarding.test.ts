import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('首次接入只发布经过验证的目录，普通成员和失败的换钥不能更改原连接', async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-model-setup-'));
  process.env.COLLAB_STATE_DIR = state;
  delete process.env.CONTRACTOR_DEEPSEEK_API_KEY;
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }, { textAssistant }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'),
    import('../src/console-auth.ts'), import('../src/workbench/plugins/assistant-model.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('owner', 'fixture-password');
  await auth.createAccount('reader', 'fixture-password', 'viewer', 'owner');
  const work = await openCollaboration(settingsSchema.parse({ executionRuntime: 'contractor' }), auth);
  t.after(async () => { await work.close(); await rm(state, { recursive: true, force: true }); });
  const provider = async () => (await work.modelServices('owner')).find(row => row.provider === 'deepseek')!;
  const input = { model: 'deepseek-flash', key: 'fixture-valid-token', revision: (await provider()).connection!.revision };
  const remote = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.deepseek.com/models');
    return new Headers(options.headers).get('authorization') === 'Bearer fixture-valid-token'
      ? Response.json({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-test' }] }) : new Response(null, { status: 401 });
  });
  await assert.rejects(work.connectDeepSeek('reader', input), /权限/);
  await assert.rejects(work.deepSeekModels('reader', input.key), { status: 403 });
  assert.equal(remote.mock.callCount(), 0);
  assert.deepEqual(await work.deepSeekModels('owner', input.key), [input.model, 'deepseek-test']);
  await work.connectDeepSeek('owner', input);
  const current = await provider();
  assert.equal((await stat(path.join(state, 'assistant-deepseek.private.json'))).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(current).includes(input.key));
  assert.deepEqual(work.personalAgent('reader').choices, [{ provider: 'deepseek', model: 'deepseek-flash', available: true }]);
  const revision = current.connection!.revision;
  await assert.rejects(work.connectDeepSeek('owner', { ...input, revision, key: 'invalid' }), /API Key/);
  await assert.rejects(work.connectDeepSeek('owner', { ...input, revision, model: 'missing' }), /模型目录/);
  await assert.rejects(work.connectDeepSeek('owner', input), /刷新/);
  assert.deepEqual(textAssistant().connection!.status(), current.connection);
  const settings = work.platformAssistant('owner');
  const draft = { selection: { provider: 'deepseek' as const, model: input.model },
    dailyLimit: 30, harness: settings.harness };
  const create = { action: 'create' as const, name: '门店整理', settings: draft };
  assert.throws(() => work.changeRouterPlan('reader', create), { status: 403 });
  const { id } = work.changeRouterPlan('owner', create);
  const original = work.routerPlans('owner')[0]!;
  work.changeRouterPlan('owner', { action: 'update', id, name: '小屏验收', revision: original.revision, settings: draft });
  assert.throws(() => work.applyRouterPlan('owner', id, original.revision, settings.revision), { status: 409 });
  const plan = work.routerPlans('owner')[0]!;
  assert.equal(work.platformAssistant('owner').selection, null);
  assert.throws(() => work.applyRouterPlan('reader', id, plan.revision, settings.revision), { status: 403 });
  assert.deepEqual(work.applyRouterPlan('owner', id, plan.revision, settings.revision).selection, draft.selection);
  work.changeRouterPlan('owner', { action: 'remove', id, revision: plan.revision });
  assert.deepEqual(work.routerPlans('owner'), []);
  assert.deepEqual(work.platformAssistant('owner').selection, draft.selection);
  const ollama = () => work.modelServices('owner').then(rows => rows.find(row => row.provider === 'ollama')!);
  work.setModelService('owner', 'ollama', { revision: (await ollama()).revision, enabled: true, models: ['local-v1'] });
  const before = await ollama();
  assert.equal(before.registered, true);
  assert.throws(() => work.removeModelService('reader', 'ollama', before.revision), { status: 403 });
  work.setModelService('owner', 'ollama', { revision: before.revision, enabled: true, models: ['local-v2'] });
  assert.throws(() => work.removeModelService('owner', 'ollama', before.revision), { status: 409 });
  work.removeModelService('owner', 'ollama', (await ollama()).revision);
  assert.equal((await ollama()).enabled, false);
  assert.equal((await ollama()).registered, false);
  await work.connectDeepSeek('owner', { ...input, revision, models: [input.model, 'deepseek-test'] });
  assert.deepEqual(work.personalAgent('reader').choices.map(row => row.model), [input.model, 'deepseek-test']);
  assert.throws(() => work.disconnectDeepSeek('owner', revision), { status: 409 });
  const connected = (await provider()).connection!.revision;
  assert.throws(() => work.disconnectDeepSeek('reader', connected), { status: 403 });
  work.disconnectDeepSeek('owner', connected);
  assert.deepEqual(work.personalAgent('reader').choices, []);
  assert.equal(textAssistant().available('deepseek'), false);
  await work.connectDeepSeek('owner', { ...input, revision: (await provider()).connection!.revision });
  let chatCalls = 0;
  remote.mock.mockImplementation(async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const request = JSON.parse(String(options.body));
    assert.equal(request.response_format, undefined);
    chatCalls++;
    return Response.json({ model: input.model, choices: [{ message: { content: '逐档检查长词能否换行。' } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 } });
  });
  work.setPersonalAgent('reader', { revision: work.personalAgent('reader').revision, title: '我的 Agent',
    instructions: '', experience: '', selection: { provider: 'deepseek', model: input.model } });
  const answer = await work.askPersonalAgent('reader', '如何验收门店推荐理由？');
  assert.equal(answer.value.answer, '逐档检查长词能否换行。');
  assert.equal(chatCalls, 1);
});
