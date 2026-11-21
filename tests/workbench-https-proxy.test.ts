import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('固定 HTTPS 地址将浏览器确认和 Worker 协议转到各自端口', { timeout: 6000 }, async t => {
  const state = await mkdtemp(path.join(tmpdir(), 'contractor-https-'));
  t.after(() => rm(state, { recursive: true, force: true }));
  const origin = 'https://workbench.example.test';
  const received: string[] = [];
  async function listener(kind: 'workbench' | 'runner' | 'port') {
    const server = createServer((req, res) => {
      received.push(kind);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        kind, path: req.url, host: req.headers.host, cookie: req.headers.cookie, auth: req.headers.authorization,
        driver: req.headers['x-contractor-execution'], origin: req.headers.origin, range: req.headers.range,
      }));
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return { server, port: address.port };
  }
  const workbench = await listener('workbench');
  const runner = await listener('runner');
  t.after(() => { workbench.server.close(); runner.server.close(); });
  const proxy = await listener('port');
  await new Promise<void>(resolve => proxy.server.close(() => resolve()));
  await writeFile(path.join(state, 'workbench.json'), JSON.stringify({
    port: workbench.port, remoteRunnerPort: runner.port, workbenchPublicUrl: origin, runnerConnectUrl: origin,
  }));
  const child = spawn(process.execPath, ['scripts/workbench-https-proxy.mjs', String(proxy.port)], {
    env: { ...process.env, COLLAB_STATE_DIR: state }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => assert.fail('反向代理提前退出'))]);
  const base = 'http://127.0.0.1:' + proxy.port;
  const confirm = '/runner/connect/' + randomUUID() + '?im=linked';
  const browser = await fetch(base + confirm, { method: 'POST', headers: {
    'content-type': 'application/x-www-form-urlencoded', origin, cookie: 'session=fixture',
  }, body: 'action=approve' });
  assert.deepEqual(await browser.json(), { kind: 'workbench', path: confirm, host: 'workbench.example.test', cookie: 'session=fixture', origin });
  const capture = '/api/ticket/fixture/product-capture';
  assert.deepEqual(await fetch(base + capture, { headers: { cookie: 'session=fixture', range: 'bytes=0-511' } }).then(res => res.json()), {
    kind: 'workbench', path: capture, host: 'workbench.example.test', cookie: 'session=fixture', range: 'bytes=0-511',
  });
  const protocol = '/api/runner/protocol';
  const headers = { 'content-type': 'application/json', authorization: 'Bearer fixture', 'x-contractor-execution': 'contractor' };
  assert.deepEqual(await fetch(base + protocol, { method: 'POST', headers, body: '{}' }).then(res => res.json()), {
    kind: 'runner', path: protocol, host: 'workbench.example.test', auth: 'Bearer fixture', driver: 'contractor',
  });
  assert.equal((await fetch(base + protocol, { method: 'POST', headers: { ...headers, cookie: 'session=fixture', origin }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + protocol)).status, 404);
  assert.equal((await fetch(base + '/health')).status, 404);
  assert.equal((await fetch(base + '/api/runner/extra', { method: 'POST', headers, body: '{}' })).status, 404);
  assert.deepEqual(received, ['workbench', 'workbench', 'runner']);
});
