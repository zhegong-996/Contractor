import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { root, loadConfig, runtime, configPath } from '../src/config.ts';
import { Paperclip } from '../src/paperclip.ts';
import { adapterFor } from '../src/upstream.ts';
const config = loadConfig(), pc = new Paperclip(config.paperclipUrl);
if (!config.companyId) throw new Error('先运行 setup 和 setup:workspaces');
const key = 'workspace-assistant', engine = config.assistant?.engine ?? 'codex';
const adapter = await adapterFor(engine), problem = adapter.check?.();
if (problem) throw new Error(problem);
const agents = await pc.get<any[]>('/companies/' + config.companyId + '/agents');
let agent = agents.find(a => a.id === config.agents[key]?.paperclipId || a.name === '协作事务 Agent');
const data = { name: '协作事务 Agent', role: 'general', adapterType: 'process', runner: 'legacy',
  capabilities: '按已授权的岗位上下文归纳进展、准备访问申请、检查点、交接和知识候选；不批准访问、不发布知识、不验收。',
  adapterConfig: { command: process.execPath, args: ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'src/assistant-runner.ts')], cwd: root, timeoutSec: 300, graceSec: 15 },
  runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } } };
if (!agent) agent = await pc.post('/companies/' + config.companyId + '/agents', { ...data, permissions: { canCreateAgents: false, canCreateSkills: false } });
else agent = await pc.patch('/agents/' + agent.id, data);
const auth = JSON.parse(readFileSync(runtime('secrets.json'), 'utf8'));
auth.agentTokens[key] ??= randomBytes(32).toString('hex');
config.agents[key] = { name: data.name, paperclipId: agent.id, mode: 'managed', use: engine, access: 'read', enabled: true };
config.assistant = { agentKey: key, engine, enabled: true, ...config.assistant };
if (!config.assistant.projectId) config.assistant.projectId = (await pc.post('/companies/' + config.companyId + '/projects', {
  name: '协作 Agent 运行', visibility: 'private', status: 'in_progress', idempotencyKey: 'suitme-assistant-runs' })).id;
const project = await pc.get('/projects/' + config.assistant.projectId);
if (project.companyId !== config.companyId || project.visibility !== 'private') throw new Error('Assistant project boundary changed');
await pc.post('/projects/' + config.assistant.projectId + '/access-members', { subjectType: 'agent', subjectId: agent.id });
writeFileSync(runtime('secrets.json'), JSON.stringify(auth, null, 2), { mode: 0o600 });
writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ agentId: agent.id, engine, scheduler: 'native Paperclip runs', automaticAuthority: 'preparation only' }));
