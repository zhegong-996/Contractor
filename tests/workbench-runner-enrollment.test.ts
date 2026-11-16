import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Devices } from '../src/workbench/devices.ts';
import { runnerAgentSchema } from '../src/workbench/config.ts';
import { runnerConnectInput, runnerEndpoint } from '../src/workbench/runner-connection.ts';

test('浏览器批准后只有原执行端可领取，领回执中断或重启不重复登记', () => {
  const db = new DatabaseSync(':memory:');
  try {
    let now = 1_000;
    let devices = new Devices(db, () => now);
    const request = runnerConnectInput.parse({ id: randomUUID(), name: '执行机', engines: ['codex'] });
    const proof = randomBytes(32).toString('base64url');
    const wrong = randomBytes(32).toString('base64url');
    const profile = runnerAgentSchema.parse({ id: 'review', owner: 'design', engine: 'codex', model: 'gpt-6.1-sol',
      execution: { kind: 'remote', provider: 'openai', credential: 'codex', domains: ['api.openai.com'] } });
    const binding = { owner: 'design', projects: ['store'], agent: 'review', remote: profile };
    const initial = devices.beginEnrollment(request, proof);
    assert.ok(initial);
    assert.deepEqual(devices.beginEnrollment(request, proof), initial);
    assert.equal(devices.beginEnrollment(request, wrong), undefined);
    assert.deepEqual(devices.finishEnrollment(request.id, proof, () => binding), { pending: true });
    assert.equal(devices.approveEnrollment(request.id, 'design', 'store', 'review'), true);
    assert.equal(devices.approveEnrollment(request.id, 'other', 'store', 'review'), false);
    assert.equal(devices.finishEnrollment(request.id, wrong, () => binding), undefined);
    assert.equal(devices.finishEnrollment(request.id, proof, () => undefined), undefined);
    assert.equal(devices.list().length, 0);

    const paired = devices.finishEnrollment(request.id, proof, () => binding);
    assert.ok(paired && 'token' in paired);
    assert.equal(paired.id, request.id);
    assert.equal(devices.byToken(paired.token)?.owner, 'design');
    now = initial.expires + 1;
    devices = new Devices(db, () => now);
    assert.equal(devices.enrollment(request.id), undefined);
    assert.deepEqual(devices.finishEnrollment(request.id, proof, () => binding), paired);
    assert.equal(devices.finishEnrollment(request.id, proof, () => undefined), undefined);
    devices.transition(request.id, 'retired');
    assert.equal(devices.finishEnrollment(request.id, proof, () => binding), undefined);
    assert.equal(devices.list().length, 1);

    const abandoned = { ...request, id: randomUUID() };
    devices.beginEnrollment(abandoned, proof);
    now += 10 * 60_000;
    assert.equal(devices.approveEnrollment(abandoned.id, 'design', 'store', 'review'), false);
    assert.equal(devices.finishEnrollment(abandoned.id, proof, () => binding), undefined);
  } finally { db.close(); }
});

test('连接地址必须是团队 HTTPS 根地址或明确的回环 HTTP 地址', () => {
  assert.equal(runnerEndpoint.parse('HTTPS://SUITME.EXAMPLE:443/'), 'https://suitme.example');
  assert.equal(runnerEndpoint.parse('http://127.0.0.1:4380'), 'http://127.0.0.1:4380');
  for (const address of ['http://suitme.example', 'https://suitme.example/path', 'https://user@suitme.example', 'https://suitme.example/?token=1'])
    assert.equal(runnerEndpoint.safeParse(address).success, false);
});
