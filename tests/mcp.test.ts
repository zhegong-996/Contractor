// Exercise the actual stdio MCP transport without using a personal agent or any live app credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { root } from '../src/config.ts';

test('an external agent can discover scoped task tools and submit through the standard MCP protocol', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'suitme-mcp-test-'));
  const calls: { url?: string; authorization?: string }[] = [];
  const bridge = createServer((req, res) => { calls.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url === '/tasks' ? [{ id: 'task-one', agent: 'workbuddy' }] : { id: 'task-one', context: '{}' })); });
  await new Promise<void>(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const port = (bridge.address() as { port: number }).port;
  await writeFile(path.join(dir, 'config.json'), JSON.stringify({ paperclipUrl: 'http://127.0.0.1:3100', bridgePort: port,
    repository: 'test/repo', checkout: '/tmp/test', allowedPaths: ['collab-pilot/'], defaultAgent: 'workbuddy',
    agents: { workbuddy: { name: 'WorkBuddy', mode: 'manual' } }, feishu: { profile: 'test' } }));
  await writeFile(path.join(dir, 'secrets.json'), JSON.stringify({ adminToken: 'not-used', agentTokens: { workbuddy: 'scoped-test-token' }, jwtSecret: 'not-used' }), { mode: 0o600 });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'src/mcp.ts')],
    env: { PATH: process.env.PATH ?? '', COLLAB_AGENT: 'workbuddy', COLLAB_STATE_DIR: dir }, stderr: 'pipe' });
  const client = new Client({ name: 'test-external-agent', version: '1' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(t => t.name === 'claim_task')); assert.ok(tools.tools.some(t => t.name === 'submit_checkpoint'));
    assert.ok(!tools.tools.some(t => /accept|merge|shell|credential/i.test(t.name)));
    const result = await client.callTool({ name: 'list_tasks', arguments: {} });
    assert.match(JSON.stringify(result), /task-one/);
    assert.deepEqual(calls, [{ url: '/tasks', authorization: 'Bearer scoped-test-token' }]);
  } finally { await client.close(); await new Promise<void>(resolve => bridge.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});
