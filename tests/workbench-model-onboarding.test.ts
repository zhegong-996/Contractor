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
      ? Response.json({ data: [{ id: 'deepseek-flash' }] }) : new Response(null, { status: 401 });
  });
  await assert.rejects(work.connectDeepSeek('reader', input), /权限/);
  assert.equal(remote.mock.callCount(), 0);
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
