import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('新工作台不预置业务项目，可从空状态创建第一个项目', async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-empty-bootstrap-'));
  process.env.COLLAB_STATE_DIR = state;
  process.env.COLLAB_ALLOW_TMP_STATE = '1';
  const [{ settingsSchema }, { openCollaboration }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/config.ts'),
    import('../src/workbench/collaboration.ts'),
    import('../src/console-auth.ts'),
  ]);
  const fixture = JSON.parse(await readFile(new URL('../fixtures/workbench.example.json', import.meta.url), 'utf8'));
  const config = settingsSchema.parse(fixture);
  assert.deepEqual(config.projects, []);
  assert.deepEqual(config.functions, []);
  assert.deepEqual(config.agents, []);
  assert.deepEqual(settingsSchema.parse({}).projects, [], '省略项目时应从空状态启动');

  const runner = settingsSchema.parse(JSON.parse(await readFile(new URL('../fixtures/workbench.runner.example.json', import.meta.url), 'utf8')));
  assert.deepEqual(runner.projects, []);

  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('product', 'only-for-unit-test');
  const work = await openCollaboration(runner, auth);
  t.after(async () => {
    await work.close();
    await rm(state, { recursive: true, force: true });
  });

  const empty = work.overview('product');
  assert.deepEqual(empty.projects, []);
  assert.equal(empty.canCreateProject, true);

  const created = work.createProject('product', { nonce: 'first-project', title: '第一个项目', firstTopic: '开始使用' });
  assert.equal(work.overview('product').agents.length, 0);
  work.addProjectAgent('product', created.id, 'first-review');
  const overview = work.overview('product');
  assert.deepEqual(overview.agents.map(agent => agent.projects), [[created.id]]);
  assert.deepEqual(overview.projects.map(project => project.id), [created.id]);
  assert.deepEqual(overview.projects[0]?.topics.map(topic => topic.title), ['开始使用']);
});
