import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Octop 召回覆盖全部授权现行知识，旧条目不被近期资料挤出，私有条目不进入索引', async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-recall-'));
  process.env.COLLAB_STATE_DIR = state;
  await mkdir(path.join(state, 'console'));
  const bridge = path.join(state, 'bridge');
  await writeFile(bridge, '#!' + process.execPath + '\n'
    + "const data=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(data.entries.filter(e=>e.text.includes('needle7492')).slice(0,6).map(e=>e.id)));",
  { mode: 0o700 });
  const [{ ConsoleAuth }, { settingsSchema }, { openCollaboration }] = await Promise.all([
    import('../src/console-auth.ts'), import('../src/workbench/config.ts'), import('../src/workbench/collaboration.ts')]);
  const auth = new ConsoleAuth(); await auth.ready(); await auth.bootstrapOwner('owner', 'test-password');
  const settings = settingsSchema.parse({ projects: [{ id: 'store', title: '门店', members: ['owner'], maintainers: ['owner'] }],
    functions: [{ id: 'review', title: '核对' }], agents: [], octop: { python: bridge, profiles: [] } });
  const work = await openCollaboration(settings, auth, async () => assert.fail('No notifications expected'));
  t.after(async () => { await work.close(); await rm(state, { recursive: true, force: true }); });
  const add = (title: string, body: string, visibility: 'project' | 'restricted' = 'project') => work.addKnowledge('owner', 'store',
    { title, body, conditions: '门店', kind: 'reference', visibility });
  const target = add('旧但现行的规则', 'needle7492 280px 320px 360px');
  for (let i = 0; i < 200; i++) add('新资料 ' + i, 'unrelated ' + i);
  add('私有资料', 'needle7492 secret', 'restricted');
  assert.deepEqual((await work.octopRecall('owner', 'store', 'needle7492')).map(row => row.id), [target]);
  const entry = work.browse('owner', 'store', '').find(row => row.id === target)!;
  assert.ok('revision' in entry);
  work.invalidateKnowledge('owner', target, entry.revision, '旧口径已失效');
  assert.deepEqual(await work.octopRecall('owner', 'store', 'needle7492'), []);
});
