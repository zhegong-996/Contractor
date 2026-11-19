import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { watchGithub } from '../src/workbench/github-intake.ts';

test('仓库同步失败可见，保留原游标，完整重试后才恢复就绪', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contractor-github-health-'));
  const state = path.join(directory, 'mode');
  const previousPath = process.env.PATH;
  process.env.PATH = directory + path.delimiter + previousPath;
  const gh = path.join(directory, 'gh');
  await writeFile(gh, '#!' + process.execPath + '\n' + [
    'const fs = require("node:fs");',
    'const mode = fs.readFileSync(' + JSON.stringify(state) + ', "utf8");',
    'const route = process.argv[3];',
    'if (route === "repos/team/store") console.log(JSON.stringify({ id: 17, full_name: "Team/Store" }));',
    'else if (mode === "offline") { console.error("TLS handshake timeout"); process.exit(1); }',
    'else if (route.includes("/pulls?")) console.log("[]");',
    'else console.log("[[]]");',
  ].join('\n'));
  await chmod(gh, 0o700);
  await writeFile(state, 'offline');
  const start = '2026-11-16T00:00:00.000Z';
  let checkpoint = { start, at: start };
  let refreshFailure = false;
  const watcher = watchGithub({
    repositories: () => ['Team/Store', 'team/store'],
    tracksPull: () => false,
    seen: () => false,
    consume: async () => assert.fail('空仓库列表不应产生派工'),
    refresh: async () => { if (refreshFailure) throw new Error('HTTP 403: API rate limit exceeded'); },
    interval: 30,
    checkpoint: (repo, at) => {
      assert.equal(repo, '17');
      if (at) checkpoint = { start, at };
      return checkpoint;
    },
    log: () => {},
  });
  t.after(async () => {
    await watcher.close();
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  });
  async function until(test: () => boolean) {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (test()) return;
      await delay(30);
    }
    assert.fail('等待 GitHub 连接状态超时');
  }
  assert.deepEqual(watcher.status(['other/repo']), [{ repository: 'other/repo', state: 'connecting' }]);
  await until(() => watcher.status()[0]?.state === 'unavailable');
  assert.equal(watcher.status().length, 1);
  assert.equal(watcher.status()[0]?.failure?.reason, 'network');
  assert.equal(watcher.status()[0]?.failure?.stage, 'messages');
  assert.equal(watcher.status()[0]?.lastSuccessAt, undefined);
  assert.equal(checkpoint.at, start);

  await writeFile(state, 'online');
  t.mock.timers.tick(30000);
  await until(() => watcher.status()[0]?.state === 'ready');
  const lastGood = watcher.status()[0]!;
  assert.ok(lastGood.lastSuccessAt);
  assert.equal(lastGood.cursor, checkpoint.at);
  assert.notEqual(lastGood.cursor, start);

  refreshFailure = true;
  t.mock.timers.tick(30000);
  await until(() => watcher.status()[0]?.failure?.stage === 'delivery');
  assert.equal(watcher.status()[0]?.failure?.reason, 'rate-limit');
  assert.equal(watcher.status()[0]?.lastSuccessAt, lastGood.lastSuccessAt);
  assert.equal(checkpoint.at, lastGood.cursor);
});
