import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import { knowledgeHealth } from '../src/workbench/knowledge-health.ts';

test('知识健康探测区分未启用、断线、真实应答与恢复，合并并发探测', async t => {
  const dir = await mkdtemp('/tmp/contractor-index-health-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const address = dir + '/index.sock';
  const config = { python: '/missing/python', indexSocket: address, profiles: [], feishuGateway: false };
  const check = knowledgeHealth(config, 0);
  assert.equal((await knowledgeHealth()()).state, 'disabled');
  assert.equal((await check()).state, 'unavailable');
  let probes = 0;
  const server = createServer(socket => socket.once('data', data => {
    assert.deepEqual(JSON.parse(data.toString()), { op: 'health' }); probes++;
    socket.end('{"ready":true}\n');
  }));
  const prior = process.umask(0o077);
  server.listen(address);
  await once(server, 'listening'); process.umask(prior);
  const results = await Promise.all([check(), check(), check()]);
  assert.ok(results.every(row => row.state === 'ready'));
  assert.equal(probes, 1);
  await new Promise<void>(resolve => server.close(() => resolve()));
  assert.equal((await check()).state, 'unavailable');
});
