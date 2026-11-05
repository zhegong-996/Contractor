import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { root, runtime, configPath, type Config } from '../src/config.ts';
import { Paperclip } from '../src/paperclip.ts';
import path from 'node:path';

mkdirSync(runtime(), { recursive: true, mode: 0o700 });
if (!existsSync(runtime('secrets.json'))) writeFileSync(runtime('secrets.json'), JSON.stringify({
  adminToken: randomBytes(32).toString('hex'), jwtSecret: randomBytes(48).toString('hex'),
  agentTokens: Object.fromEntries(['codex', 'claude', 'manual', 'workbuddy', 'doubao-work', 'command', 'acp'].map(k => [k, randomBytes(32).toString('hex')])),
}, null, 2), { mode: 0o600 });
const file = runtime('config.json');
const config: Config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
  paperclipUrl: 'http://127.0.0.1:3100', bridgePort: 4180,
  repository: 'zhegong-996/desktop-tutorial', checkout: path.join(root, 'workspaces/desktop-tutorial'),
  allowedPaths: ['collab-pilot/', '.github/workflows/collab-pilot.yml'], defaultAgent: 'codex', pollMs: 15000,
  feishu: { profile: 'ai-native-collab', enabled: false, appId: '', botId: '', allowedSenders: [], allowedChats: [] },
  agents: {
    codex: { name: 'Codex', mode: 'managed', use: 'codex', access: 'edit', enabled: true },
    claude: { name: 'Claude Code', mode: 'managed', use: 'claude', access: 'edit', enabled: false },
    manual: { name: '人工接单', mode: 'manual', use: 'command', access: 'edit', enabled: true },
    workbuddy: { name: 'WorkBuddy', mode: 'manual', use: 'command', access: 'edit', enabled: true },
    'doubao-work': { name: '豆包工作', mode: 'manual', use: 'command', access: 'edit', enabled: true },
    command: { name: '自定义 CLI', mode: 'managed', use: 'command', access: 'edit', enabled: false },
    acp: { name: 'ACP 执行端', mode: 'managed', use: 'acp', access: 'edit', enabled: false },
  },
};
writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
if (process.argv.includes('--prepare-only')) { console.log('Local configuration prepared'); process.exit(0); }
const pc = new Paperclip(config.paperclipUrl);
const authFile = runtime('secrets.json'), auth = JSON.parse(readFileSync(authFile, 'utf8'));
auth.paperclipTokens ??= {};
const companies = await pc.get<any[]>('/companies');
let company = companies.find(c => config.companyId&&c.id===config.companyId)??companies.find(c => c.name === 'SuitMe 协作台');
if (!company) company = await pc.post('/companies', { name: 'SuitMe 协作台', description: '团队与 Agent 的研发协作工作台' });
config.companyId = company.id;
await pc.patch(`/companies/${company.id}`, { requireBoardApprovalForNewAgents: false });
await pc.patch('/instance/settings/experimental', { enableNativeRunner: false });
const projects = await pc.get<any[]>(`/companies/${company.id}/projects`);
let project = projects.find(p => p.name === '协作闭环试点');
if (!project) project = await pc.post(`/companies/${company.id}/projects`, {
  idempotencyKey: 'suitme-collab-pilot', name: '协作闭环试点', status: 'in_progress',
  description: '飞书发起、Agent 执行、GitHub 交付、指定版本验收',
  workspace: { cwd: config.checkout, repoUrl: `https://github.com/${config.repository}`, isPrimary: true },
});
config.projectId = project.id;
const agents = await pc.get<any[]>(`/companies/${company.id}/agents`);
for (const [key, agent] of Object.entries(config.agents)) {
  if (key === config.assistant?.agentKey) continue; // Its dedicated native runner is configured by setup:assistant.
  let existing = agents.find(a => a.name === agent.name);
  const managed = agent.mode === 'managed';
  const data = { name: agent.name, role: 'engineer', adapterType: 'process', runner: 'legacy',
    capabilities: managed ? `通过已配置的 ${agent.use} CLI 执行任务` : '人工通过 CLI 或 MCP 领取任务，提交交接包和成果',
    adapterConfig: { command: process.execPath, args: ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'src/runner.ts'), key],
      cwd: root, timeoutSec: 1800, graceSec: 15,env:{COLLAB_STATE_DIR:runtime(),COLLAB_CONFIG:configPath} },
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: managed && agent.enabled, maxConcurrentRuns: 1 } },
    permissions: { canCreateAgents: false, canCreateSkills: false },
  };
  if (!existing) existing = await pc.post(`/companies/${company.id}/agents`, data);
  else {
    const { permissions, ...update } = data;
    await pc.patch(`/agents/${existing.id}`, update);
  }
  agent.paperclipId = existing.id;
  if (agent.enabled && !auth.paperclipTokens[key]) {
    const created = await pc.post(`/agents/${existing.id}/keys`, { name: 'SuitMe bridge access checks', scope: { kind: 'standard' } });
    if (!created.token) throw new Error('Paperclip did not return the new access-check credential');
    auth.paperclipTokens[key] = created.token;
    writeFileSync(authFile, JSON.stringify(auth, null, 2), { mode: 0o600 });
  }
}
writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ company: company.name, companyId: company.id, projectId: project.id, agents: Object.keys(config.agents), url: config.paperclipUrl }, null, 2));
