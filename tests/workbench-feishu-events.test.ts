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

test('进程仍活着但本地总线失去该订阅时自动重连，空闲群不会触发误重连', { timeout: 8000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'suitme-feishu-bus-'));
  const previousPath = process.env.PATH;
  process.env.PATH = dir + path.delimiter + previousPath;
  const pidFile = path.join(dir, 'pid'), broken = path.join(dir, 'broken');
  await writeFile(path.join(dir, 'lark-cli'), [
    '#!' + process.execPath,
    'const fs = require("node:fs");',
    `const pidFile = ${JSON.stringify(pidFile)}, broken = ${JSON.stringify(broken)};`,
    'if (process.argv.includes("status")) {',
    ' console.log(JSON.stringify({apps:[{running:true,status:"running",consumers:fs.existsSync(broken)?[]:[{pid:Number(fs.readFileSync(pidFile)),event_key:"im.message.receive_v1",dropped:0}]}]})); process.exit(0);',
    '}',
    'fs.rmSync(broken,{force:true});',
    'const child=require("node:child_process").spawn(process.execPath,["-e",`require("node:fs").writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.stdin.resume();process.stdin.on("end",()=>process.exit(0));console.error("[event] ready event_key=im.message.receive_v1");`],{stdio:"inherit"});',
    'child.on("exit",code=>process.exit(code??1));',
  ].join('\n'), { mode: 0o700 });
  const watcher = watchFeishu('test', () => assert.fail('无需消息来证明健康'), () => {}, { healthIntervalMs: 70 });
  t.after(async () => { watcher.close(); process.env.PATH = previousPath; await rm(dir, { recursive: true, force: true }); });
  async function wait(predicate: () => boolean) {
    for (let i = 0; i < 130; i++) { if (predicate()) return; await delay(30); }
    assert.fail('未恢复本地订阅');
  }
  await wait(() => watcher.status().busHealth === 'healthy');
  await delay(200);
  assert.equal(watcher.status().attempt, 1);
  await writeFile(broken, '');
  await wait(() => watcher.status().attempt === 2 && watcher.status().busHealth === 'healthy');
  assert.ok(watcher.status().disconnectedAt);
});
