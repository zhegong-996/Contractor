import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('旧权限 CSV 的精确规则和通配继续生效，账号禁用后立即收回', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'contractor-rbac-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  process.env.COLLAB_STATE_DIR = directory;
  await mkdir(path.join(directory, 'console'));
  await writeFile(path.join(directory, 'console', 'rbac_policy.csv'), [
    '# saved platform policy', 'p, operator, task-*, use', 'p, "viewer", "read", "use"',
    'p, user:member, specific-permission, use', 'p, viewer, other-action, delete', 'g, user:member, operator',
  ].join('\n'));
  const { initRbac, rbacEnforce, syncHumans } = await import('../src/rbac.ts');
  assert.equal(rbacEnforce('operator', 'task-control'), false);
  await initRbac();
  syncHumans([{ username: 'member', role: 'operator' }]);
  assert.equal(rbacEnforce('user:member', 'task-control'), true);
  assert.equal(rbacEnforce('user:member', 'specific-permission'), true);
  syncHumans([{ username: 'member', role: 'viewer' }]);
  assert.equal(rbacEnforce('user:member', 'task-control'), false);
  assert.equal(rbacEnforce('user:member', 'read'), true);
  assert.equal(rbacEnforce('user:member', 'other-action'), false);
  syncHumans([{ username: 'member', role: 'viewer', disabled: true }]);
  assert.equal(rbacEnforce('user:member', 'read'), false);
  assert.equal(rbacEnforce('user:member', 'specific-permission'), false);
});
