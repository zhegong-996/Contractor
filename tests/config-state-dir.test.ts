import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('运行数据目录防护：临时目录默认拒绝，显式放行后可用', () => {
  const temporary = path.join(os.tmpdir(), 'contractor-guard-' + Math.random().toString(36).slice(2));
  const script = "import {requirePersistentStateDir} from './src/config.ts';console.log(requirePersistentStateDir(process.env.COLLAB_STATE_DIR, '测试服务'))";
  const run = (allow: string | undefined, dir = temporary) => spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    env: { ...process.env, COLLAB_STATE_DIR: dir, ...(allow === undefined ? {} : { COLLAB_ALLOW_TMP_STATE: allow }) },
    encoding: 'utf8',
  });
  const blocked = run('');
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /不能指向系统临时目录/);
  const allowed = run('1');
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, new RegExp(temporary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const relative = run('', 'not-absolute');
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /绝对路径/);
});
