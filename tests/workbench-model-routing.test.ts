import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readCodexCatalog } from '../src/workbench/codex-catalog.ts';
import { settingsSchema } from '../src/workbench/config.ts';
import { openModelRouting } from '../src/workbench/model-routing.ts';

const config = {
    projects: [{ id: 'store', title: '门店', members: ['product'], maintainers: ['product'],
      modelRoutes: [{ purpose: 'personal', agent: 'review', models: ['light', 'verified'] }] }],
    functions: [{ id: 'review', title: '核对' }],
    agents: [{ id: 'review', title: '核对', owner: 'product', engine: 'codex', model: 'verified', allowedModels: ['verified', 'light'],
      active: true, kind: 'personal', capability: '核对样例', skill: '只读', function: 'review', projects: ['store'],
      execution: { kind: 'sandbox', credential: 'own', provider: 'openai' } }],
};

test('模型路线按项目、Agent 和用途严格验证授权列表', () => {
  assert.ok(settingsSchema.safeParse(config).success);
  const rejected = structuredClone(config);
  rejected.projects[0]!.modelRoutes[0]!.models.push('outside-scope');
  assert.equal(settingsSchema.safeParse(rejected).success, false);
  const ambiguous = structuredClone(config);
  ambiguous.projects[0]!.modelRoutes.push(ambiguous.projects[0]!.modelRoutes[0]!);
  assert.equal(settingsSchema.safeParse(ambiguous).success, false);
  const remote = structuredClone(config);
  remote.agents[0]!.execution.kind = 'remote';
  assert.equal(settingsSchema.safeParse(remote).success, false);
});

test('模型目录短重试会读取后续页，只有供应商确认的模型可以进入路由', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'contractor-model-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const script = `
    const fs = require('node:fs');
    const count = (fs.existsSync('attempts') ? Number(fs.readFileSync('attempts')) : 0) + 1;
    fs.writeFileSync('attempts', String(count));
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      if (request.method === 'initialize') console.log(JSON.stringify({ id: request.id, result: {} }));
      if (request.method !== 'model/list') return;
      const page = request.params.cursor === 'page-2';
      if (page && count > 1) fs.writeFileSync('models_cache.json', JSON.stringify({
        models: [{ slug: 'verified' }], fetched_at: new Date().toISOString(),
      }));
      console.log(JSON.stringify({ id: request.id, result: page
        ? { data: [{ model: 'verified' }] }
        : { data: [{ model: 'bundled' }], ...(count > 1 && { nextCursor: 'page-2' }) }
      }));
    });`;
  const result = await readCodexCatalog(process.execPath, ['-e', script], folder, path.join(folder, 'models_cache.json'));
  assert.deepEqual([...result.models], ['verified']);
  assert.equal(await readFile(path.join(folder, 'attempts'), 'utf8'), '2');
});

test('目录读取期间重新核对授权，目录故障不选备选模型', async () => {
  const parsed = settingsSchema.parse(config);
  const project = parsed.projects[0]!, agent = parsed.agents[0]!;
  const supported = new Set(['light', 'verified']);
  const routes = openModelRouting(() => agent, (_provider, model) => supported.has(model!),
    async () => {
      supported.delete('light');
      return { models: new Set(['light', 'verified', 'unapproved']), checkedAt: new Date().toISOString() };
    });
  assert.equal((await routes.selectExecutionModel(project, agent, 'personal'))?.selected, 'verified');
  const outage = openModelRouting(() => agent, () => true, async () => { throw new Error('服务暂不可用'); });
  await assert.rejects(outage.selectExecutionModel(project, agent, 'personal'), { kind: 'model-unavailable' });
  supported.clear();
  await assert.rejects(routes.selectExecutionModel(project, agent, 'personal'), { kind: 'model-authorization' });
});
