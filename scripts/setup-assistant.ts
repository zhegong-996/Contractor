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
  capabilities: '按已委托任务自主判断，调用受限上下文工具、准备访问申请、检查点、交接和知识候选；需要人时结束本轮，按事件接续。授权、知识采用和最终验收由人决定。',
  adapterConfig: { command: process.execPath, args: ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'src/assistant-runner.ts')], cwd: root, timeoutSec: 420, graceSec: 15 },
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
