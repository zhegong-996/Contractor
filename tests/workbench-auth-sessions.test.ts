import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('改口令跨进程失效原会话，不影响其他成员，新口令可重新登录', async t => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'contractor-auth-'));
  process.env.COLLAB_STATE_DIR = state;
  t.after(() => rm(state, { force: true, recursive: true }));
  await mkdir(path.join(state, 'console'));
  await writeFile(path.join(state, 'secrets.json'), JSON.stringify({ jwtSecret: 'test-signing-key-only' }));
  const { ConsoleAuth } = await import('../src/console-auth.ts');
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('owner', 'original-test-password');
  await auth.createAccount('peer', 'peer-test-password', 'operator', 'owner');
  const first = auth.login('owner', 'original-test-password').cookie;
  const peer = auth.login('peer', 'peer-test-password').cookie;
  const changed = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "import {ConsoleAuth} from './src/console-auth.ts';new ConsoleAuth().changePassword('owner','new-test-password');"],
  { env: { ...process.env, COLLAB_STATE_DIR: state }, encoding: 'utf8' });
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(auth.sessionFromRequest(first), null);
  assert.equal(auth.sessionFromRequest(peer)?.username, 'peer');
  assert.throws(() => auth.login('owner', 'original-test-password'));
  const next = auth.login('owner', 'new-test-password');
  assert.equal(auth.sessionFromRequest(next.cookie)?.username, 'owner');
  assert.ok(!('credentialVersion' in next.session));
  assert.ok(!('credentialVersion' in auth.sessionFromRequest(next.cookie)!));
  auth.changePassword('owner', 'third-test-password');
  assert.equal(auth.sessionFromRequest(next.cookie), null);
});
