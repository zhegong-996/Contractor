import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { watchFeishu } from '../src/workbench/feishu-events.ts';

test('飞书退出时降级，收到官方就绪标记后恢复消费', { timeout: 8000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'suitme-feishu-reconnect-'));
  const previousPath = process.env.PATH;
  process.env.PATH = dir + path.delimiter + previousPath;
  const attemptFile = path.join(dir, 'attempt');
  const stopFile = path.join(dir, 'disconnect');
  await writeFile(path.join(dir, 'lark-cli'), [
    '#!' + process.execPath,
    'const fs = require("node:fs");',
    'const file = ' + JSON.stringify(attemptFile) + ';',
    'const attempt = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8"))+1 : 1;',
    'fs.writeFileSync(file, String(attempt));',
    'process.stdin.resume();',
    'process.stdin.on("end", () => process.exit(0));',
    'setTimeout(() => {',
    '  console.error("[event] ready event_key=im.message.receive_v1");',
    '  console.log(JSON.stringify({ attempt }));',
    '}, 100);',
    'if (attempt === 1) setInterval(() => { if (fs.existsSync(' + JSON.stringify(stopFile) + ')) process.exit(4); }, 20);',
  ].join('\n'), { mode: 0o700 });
  const received: number[] = [];
  const watcher = watchFeishu('test', line => received.push(JSON.parse(line).attempt), () => {});
  t.after(async () => { watcher.close(); process.env.PATH = previousPath; await rm(dir, { recursive: true, force: true }); });
  async function wait(predicate: () => boolean) {
    for (let count = 0; count < 100; count++) { if (predicate()) return; await delay(35); }
    assert.fail('未观察到飞书订阅状态变化');
  }
  assert.equal(watcher.status().state, 'connecting');
  await wait(() => received.length === 1);
  assert.equal(watcher.status().state, 'ready');
  await writeFile(stopFile, '');
  await wait(() => watcher.status().state === 'reconnecting');
  assert.ok(watcher.status().disconnectedAt);
  await wait(() => received.length === 2);
  assert.equal(watcher.status().state, 'ready');
  assert.deepEqual(received, [1, 2]);
  assert.equal(watcher.status().attempt, 2);
  watcher.close();
  assert.equal(watcher.status().state, 'stopped');
});
