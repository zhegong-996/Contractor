import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, runtime, root } from '../src/config.ts';
import { Paperclip } from '../src/paperclip.ts';
import { command } from '../src/commands.ts';
import { Controller } from '../src/controller.ts';
import { Store } from '../src/store.ts';
import assert from 'node:assert/strict';

const config = loadConfig();
if (!process.argv.includes('--run')) throw new Error('Pass --run to exercise a local Paperclip process using a non-model fixture');
if (config.repository !== 'zhegong-996/desktop-tutorial') throw new Error('This fixture is scoped to the approved pilot repository');
const pc = new Paperclip(config.paperclipUrl);
config.agents['smoke-wait'] = { name: '协议验证（无模型）', mode: 'managed', use: 'command', enabled: true, access: 'read',
  command: [process.execPath, path.join(root, 'fixtures/wait-agent.mjs')] };
writeFileSync(runtime('config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
const secretFile = runtime('secrets.json'), auth = JSON.parse(readFileSync(secretFile, 'utf8'));
auth.agentTokens['smoke-wait'] ??= randomBytes(32).toString('hex'); writeFileSync(secretFile, JSON.stringify(auth), { mode: 0o600 });
await command(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'scripts/setup.ts')], root);
const pid = Number(readFileSync(runtime('bridge-service.pid'), 'utf8'));
try { process.kill(pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
await new Promise(resolve => setTimeout(resolve, 500));
await command(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'scripts/up.ts')], root);
const current = loadConfig(); const store = new Store(runtime('bridge.sqlite')); const controller = new Controller(current, store);
try {
  const task = await controller.createTask({ triggerId: `protocol-smoke:${Date.now()}`, chatId: 'local-test', messageId: 'local-test',
    senderId: 'integration-test', agent: 'smoke-wait', text: '协议验证：收到 ask 后结束一轮并等待人工；不调用模型，不交付 GitHub。' });
  const deadline = Date.now() + 45000; let run: any;
  while (Date.now() < deadline) {
    const rows = await pc.get<any[]>(`/companies/${current.companyId}/heartbeat-runs?limit=100`);
    const runs = rows.filter(r => r.contextSnapshot?.issueId === task.id);
    if (runs.length > 1) throw new Error('Agent receipt woke the same task again');
    run = runs[0];
    if (run?.status === 'failed') throw new Error(`Managed fixture failed: ${run.id}`);
    if (run?.status === 'succeeded' && store.get(task.id).phase === 'waiting') break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(run?.status, 'succeeded'); assert.equal(store.get(task.id).phase, 'waiting');
  await new Promise(resolve => setTimeout(resolve, 2000));
  const runs = (await pc.get<any[]>(`/companies/${current.companyId}/heartbeat-runs?limit=100`)).filter(r => r.contextSnapshot?.issueId === task.id);
  assert.equal(runs.length, 1);
  const comments = await pc.get<any[]>(`/issues/${task.id}/comments`);
  const receiptComment = comments.find(c => c.body.includes('协议验证完成'));
  assert.equal(receiptComment?.authorAgentId, current.agents['smoke-wait']!.paperclipId);
  const evidence = { type: 'live-local-process-protocol', modelCalled: false, issueId: task.id, runId: run.id,
    state: store.get(task.id).phase, runCount: runs.length, receiptAuthorIsAssignedAgent: true };
  writeFileSync(runtime('protocol-smoke-evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
} finally { store.close(); }
