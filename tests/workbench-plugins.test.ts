import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { PluginHost } from '../src/workbench/capabilities.ts';
import { formerName } from '../src/workbench/compatibility.ts';
import { settingsSchema } from '../src/workbench/config.ts';
import { platformPlugins } from '../src/workbench/platform-plugins.ts';
import { cleanAcknowledged } from '../src/workbench/remote-runner.ts';
import { readSkillManifest } from '../src/workbench/skill-manifest.ts';

test('插件版本固定，可替换实现并复核当前绑定', () => {
  const config = settingsSchema.parse({
    projects: [{ id: 'store', title: '门店推荐理由', members: ['product'], maintainers: ['product'] }],
    functions: [{ id: 'review', title: '验收' }], agents: [],
  });
  const defaults = platformPlugins(config);
  assert.equal(defaults.manifest().find(row => row.capability === 'memory')?.id, 'native-search');
  const input = { query: '小屏', entries: [{ id: 'kb', rev: 'v2', text: '验收' }] };
  const other = platformPlugins(config, {
    memory: { id: 'custom-search', api: 1, service: { ...defaults.use('memory'), search: value => {
      assert.deepEqual(value, input);
      return input.entries.map(({ id, rev }) => ({ id, rev }));
    } } },
  });
  assert.deepEqual(other.use('memory').search?.(input), [{ id: 'kb', rev: 'v2' }]);
  const manifest = other.manifest();
  const memory = manifest.find(row => row.capability === 'memory')!;
  assert.equal(memory.id, 'custom-search');
  memory.id = 'different';
  assert.equal(other.manifest().find(row => row.capability === 'memory')?.id, 'custom-search');
  assert.throws(() => platformPlugins(config, { memory: { id: 'invalid id', api: 1, service: defaults.use('memory') } }), /插件接口版本或名称/);
  assert.throws(() => settingsSchema.parse({ ...config, plugins: { memory: 'octop' } }), /需要配置 octop/);
});

test('关闭插件按反序并等待启动中的实例回收', async () => {
  const host = new PluginHost();
  const closed: string[] = [];
  for (const id of ['gateway', 'figma']) {
    assert.equal(await host.mount(id, () => ({ value: id, close: () => { closed.push(id); } })), id);
  }
  await assert.rejects(host.mount('gateway', () => ({ value: 0, close: () => {} })), /已启动/);
  let release!: () => void;
  const start = new Promise<void>(resolve => { release = resolve; });
  const late = host.mount('late', async () => {
    await start;
    return { value: 1, close: () => { closed.push('late'); } };
  });
  const rejected = assert.rejects(late, /正在关闭/);
  const stopping = host.close();
  release();
  await Promise.all([stopping, rejected]);
  assert.deepEqual(closed, ['late', 'figma', 'gateway']);
  await assert.rejects(host.mount('new', () => ({ value: 0, close: () => {} })), /正在关闭/);
});

test('旧版设备确认标记接续清理，仍有执行记录时保留', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'contractor-device-upgrade-'));
  try {
    const folders = ['1-1', '2-1'].map(run => path.join(directory, 'worker/runs', run));
    for (const folder of folders) {
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, formerName('contractor-acknowledged')), '');
      await writeFile(path.join(folder, 'stdout-1.log'), '');
    }
    await writeFile(path.join(folders[1]!, 'entry.json'), '{}');
    await cleanAcknowledged(directory, false);
    await cleanAcknowledged(directory, false);
    assert.deepEqual(await readdir(folders[0]!), ['contractor-settled']);
    assert.deepEqual((await readdir(folders[1]!)).sort(), ['entry.json', 'stdout-1.log', formerName('contractor-acknowledged')].sort());
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('更名后向原版 AutoLoop 重放旧派工事件只保留一个运行', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'contractor-autoloop-upgrade-'));
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { mkdir, writeFile } from 'node:fs/promises';
      import { runtime } from './src/config.ts';
      import { formerName } from './src/workbench/compatibility.ts';
      import { assignmentEvent, executionSource, openExecution, ruleName, workerName } from './src/workbench/autoloop.ts';
      const old = formerName(executionSource);
      process.env.AGENT_AUTOLOOP_HOME = runtime('autoloop');
      process.env.AGENT_AUTOLOOP_RULES = runtime('autoloop', 'rules.json');
      await mkdir(runtime('autoloop'), { recursive: true });
      await writeFile(process.env.AGENT_AUTOLOOP_RULES, JSON.stringify({ sources: { [old]: { name: 'Legacy' } },
        agents: { review: { name: '核对', worker: formerName(workerName), use: 'codex' } },
        rules: [{ name: ruleName('review'), when: { source: old, types: [assignmentEvent('review')] },
          to: 'review', cwd: runtime(), prompt: '核对验收' }] }));
      const native = await import('./upstream/autoloop/host/runtime.ts');
      const event = { id: 'assignment-previous', type: assignmentEvent('review'), subject: 'ticket', summary: '复测', detail: '' };
      assert.deepEqual(native.ingest(old, event).routed, [ruleName('review')]);
      const { hub, nativeWorker } = await openExecution([{ id: 'review', title: '复测', engine: 'codex' }], []);
      assert.equal(nativeWorker, formerName(workerName));
      assert.deepEqual(hub.ingest(executionSource, event).routed, [ruleName('review')]);
      assert.equal(native.one('SELECT COUNT(*) AS count FROM runs').count, 1);
      hub.close();
    `], { env: { ...process.env, COLLAB_STATE_DIR: directory }, timeout: 8000 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('共享技能保留正文，拒绝含糊名称或 YAML 引用', () => {
  assert.deepEqual(readSkillManifest('---\r\nname: "store-review"\r\ndescription: "小屏验收"\r\n---\r\n# 核对规则\r\n280px'),
    { slug: 'store-review', instructions: '# 核对规则\r\n280px' });
  assert.equal(readSkillManifest('---\nname: one\nname: two\n---\n正文'), undefined);
  assert.equal(readSkillManifest('---\nfirst: &store store\nname: *store\n---\n正文'), undefined);
  assert.equal(readSkillManifest('---\nname: "wrong name"\n---\n正文'), undefined);
});
