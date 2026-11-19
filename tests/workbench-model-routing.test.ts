import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsSchema } from '../src/workbench/config.ts';

test('模型路线按项目、Agent 和用途严格验证授权列表', () => {
  const config = {
    projects: [{ id: 'store', title: '门店', members: ['product'], maintainers: ['product'],
      modelRoutes: [{ purpose: 'personal', agent: 'review', models: ['light', 'verified'] }] }],
    functions: [{ id: 'review', title: '核对' }],
    agents: [{ id: 'review', title: '核对', owner: 'product', engine: 'codex', model: 'verified', allowedModels: ['verified', 'light'],
      active: true, kind: 'personal', capability: '核对样例', skill: '只读', function: 'review', projects: ['store'],
      execution: { kind: 'sandbox', credential: 'own', provider: 'openai' } }],
  };
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
