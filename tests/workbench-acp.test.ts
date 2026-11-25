import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { executionCapabilities } from '../src/workbench/execution-capabilities.ts';

test('ACP 只读轮次协商、拒绝工具、掉线回放和模型拒绝分别留证', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'contractor-acp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'context'), peer = path.join(dir, 'peer.mjs');
  await writeFile(input, '门店推荐理由');
  await writeFile(peer, `
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const mode = process.argv[2];
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line), send = value => console.log(JSON.stringify({ jsonrpc: '2.0', ...value }));
  appendFileSync(mode + '.log', (m.method ?? JSON.stringify(m.result ?? m.error)) + '\\n');
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: mode === 'unsupported' ? 2 : 1,
    agentInfo: { name: 'codex-acp', version: '0.16.0' }, agentCapabilities: { loadSession: true } } });
  if (m.method === 'session/new') send({ id: m.id, result: { sessionId: 'one', configOptions: [{ id: 'model', currentValue: 'configured' }], modes: {currentModeId:'read-only'} } });
  if (m.method === 'session/prompt') {
    if (mode === 'model') { send({id:m.id,error:{code:-32603,data:{message:'model_not_in_accessible_catalog'}}}); continue; }
    send({method:'session/update',params:{sessionId:'one',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'320px'}}}});
    if (mode === 'loss') process.exit(0);
    send({id:81,method:'session/request_permission',params:{sessionId:'one',options:[]}});
    send({id:82,method:'fs/read_text_file',params:{}});
  }
  if (m.id === 82) send({id:3,result:{stopReason:'end_turn'}});
  if (m.method === 'session/load') {
    send({method:'session/update',params:{sessionId:'one',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'320px'}}}});
    send({id:m.id,result:{}});
  }
}
`);
  const client = fileURLToPath(new URL('../src/workbench/acp-client.mjs', import.meta.url));
  const run = (mode: string) => promisify(execFile)(process.execPath, [client, 'run', dir, input, '核对', 'configured', process.execPath, peer, mode], { cwd: dir, timeout: 6000 });
  const calls = (mode: string) => readFile(path.join(dir, mode + '.log'), 'utf8');
  assert.match((await run('done')).stdout, /"text":"320px"/);
  assert.match(await calls('done'), /cancelled/);
  assert.match(await calls('done'), /-32601/);
  const replay = await run('loss');
  assert.match(replay.stdout, /"replayed":true/);
  assert.doesNotMatch(replay.stdout, /"text":/);
  assert.equal((await calls('loss')).split('session/prompt').length, 2);
  assert.match(await calls('loss'), /session\/load/);
  assert.match((await run('model')).stdout, /"blocked":"model"/);
  await assert.rejects(run('unsupported'));
  assert.doesNotMatch(await calls('unsupported'), /session\/new/);
  const cap = executionCapabilities({ id: 'reader', owner: 'engineering', engine: 'acp', model: 'configured',
    execution: { kind: 'remote', provider: 'openai', credential: 'slot', domains: [], effort: 'low' } });
  assert.ok(cap.remote && cap.read && !cap.code && !cap.local);
});
