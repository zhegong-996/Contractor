import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('组织边界：绑定组织后的账号被其他组织工作台拒绝，未绑定旧账号仍可登录', async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-org-'));
  process.env.COLLAB_STATE_DIR = state;
  t.after(() => rm(state, { force: true, recursive: true }));
  await mkdir(path.join(state, 'console'));
  await writeFile(path.join(state, 'secrets.json'), JSON.stringify({ jwtSecret: 'test-signing-key-only' }));
  const { ConsoleAuth } = await import('../src/console-auth.ts');
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('owner', 'original-test-password');
  auth.bindOrg('org-alpha');
  await auth.createAccount('member-a', 'member-a-password', 'operator', 'owner');
  const legacy = auth.login('owner', 'original-test-password').cookie;
  const bound = auth.login('member-a', 'member-a-password').cookie;
  assert.equal(auth.sessionFromRequest(legacy)?.username, 'owner');
  assert.equal(auth.sessionFromRequest(bound)?.username, 'member-a');
  const other = new ConsoleAuth();
  await other.ready();
  other.bindOrg('org-beta');
  assert.throws(() => other.login('member-a', 'member-a-password'), /其他工作台组织/);
  assert.equal(other.login('owner', 'original-test-password').session.username, 'owner', '未打组织标记的历史账号不受影响');
});
