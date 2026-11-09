import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelSettingsService, validateModelSettings } from '../src/model-settings.ts';
const input = { profiles: [{ id: 'fast', name: '轻量事务', tier: 'fast', provider: 'unconfigured', model: '', credentialEnv: '', maxInputChars: 12000, maxOutputTokens: 2048 }],
  bindings: [{ agent: 'executor', fast: 'fast', standard: '', code: '' }], externalRequestsEnabled: false };
test('model drafts cannot enable a provider, carry credentials, or bind an unauthorized identity', () => {
  assert.equal(validateModelSettings(input, ['executor']).externalRequestsEnabled, false);
  // 外部请求开关从「写死关闭」改为「可显式开启」：true 是合法的，默认仍 false。
  assert.equal(validateModelSettings({ ...input, externalRequestsEnabled: true }, ['executor']).externalRequestsEnabled, true);
  assert.throws(() => validateModelSettings({ ...input, profiles: [{ ...input.profiles[0], apiKey: 'forbidden' }] }, ['executor']));
  assert.throws(() => validateModelSettings(input, ['another-executor']), /未配置/);
  assert.throws(() => validateModelSettings({ ...input, bindings: [{ ...input.bindings[0], code: 'fast' }] }, ['executor']), /分层/);
});
test('model configuration uses exact native revision and refuses agent self-configuration', async () => {
  let writes = 0;
  const w: any = { config: { agents: { executor: { name: '执行端', mode: 'manual', use: 'command' } } }, manager: (a: any) => { if (!a.admin) throw new Error('Unauthorized'); }, participantKeys: () => ['executor'],
    catalog: () => ({ modelRegistryIssueId: 'registry', vaultProject: 'vault' }),
    issue: async () => ({ id: 'registry', projectId: 'vault', visibility: 'private' }),
    pc: { get: async () => ({ body: JSON.stringify(input), latestRevisionId: 'current' }), request: async () => { writes++; } }, store: { audit: () => {} } };
  const service = new ModelSettingsService(w);
  await assert.rejects(service.save(input, 'current', { admin: false, agent: 'executor' }), /Unauthorized/);
  await assert.rejects(service.save(input, 'old', { admin: true }), /已变化/);
  assert.equal(writes, 0);
});
test('participant iteration keeps model settings readable without carrying a removed identity into new bindings', async () => {
  const w: any = { config: { agents: { replacement: { name: '新执行身份', mode: 'manual', use: 'command' } } }, manager: () => {}, participantKeys: () => ['replacement'],
    catalog: () => ({ modelRegistryIssueId: 'registry', vaultProject: 'vault' }), issue: async () => ({ id: 'registry', projectId: 'vault', visibility: 'private' }),
    pc: { get: async () => ({ body: JSON.stringify(input), latestRevisionId: 'current' }) } };
  const result = await new ModelSettingsService(w).read({ admin: true });
  assert.deepEqual(result.settings.bindings, [{ agent: 'replacement', fast: '', standard: '', code: '' }]); assert.equal(result.externalRequestsEnabled, false);
});
