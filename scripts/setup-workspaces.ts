import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadConfig, runtime, configPath } from '../src/config.ts';
import { Paperclip } from '../src/paperclip.ts';
import { domains, domainNames, type Catalog } from '../src/workspaces.ts';

const config = loadConfig(), pc = new Paperclip(config.paperclipUrl);
if (!config.companyId) throw new Error('Run setup first');
const auth = JSON.parse(readFileSync(runtime('secrets.json'), 'utf8'));
auth.paperclipTokens ??= {}; auth.workspacePluginToken ??= randomBytes(32).toString('hex');
let catalog: Catalog = existsSync(runtime('knowledge-workspaces.json')) ? JSON.parse(readFileSync(runtime('knowledge-workspaces.json'), 'utf8')) :
  { companyId: config.companyId, coordinationProject: '', vaultProject: '', spaces: {} as Catalog['spaces'], sources: [] };
if (catalog.companyId !== config.companyId) throw new Error('Company mismatch');
async function project(name: string, id?: string) {
  if (id) { const p = await pc.get('/projects/' + id); if (p.companyId !== config.companyId || p.visibility !== 'private') throw new Error('Private project boundary changed'); return id; }
  const p = await pc.post('/companies/' + config.companyId + '/projects', { name, visibility: 'private', status: 'in_progress', idempotencyKey: 'suitme-space:' + name });
  return p.id;
}
catalog.coordinationProject = await project('跨岗位协作', catalog.coordinationProject);
catalog.vaultProject = await project('受限检查点与知识候选', catalog.vaultProject);
const initialSeeds = Object.keys(catalog.spaces).length ? Object.keys(catalog.spaces) : [...domains];
for (const domain of initialSeeds) {
  const name = catalog.spaces[domain]?.name ?? domainNames[domain] ?? domain;
  const key = catalog.spaces[domain]?.agent ?? 'role-' + domain;
  let agentId = config.agents[key]?.paperclipId;
  if (!agentId) {
    const a = await pc.post('/companies/' + config.companyId + '/agents', { name: name + '协作身份', role: 'general', runner: 'legacy', adapterType: 'process',
      capabilities: '人工/MCP 接单身份；没有自动模型执行。', adapterConfig: { command: process.execPath, args: ['-e', 'console.log("通过协作台或MCP处理此岗位任务")'] },
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false, maxConcurrentRuns: 1 } }, permissions: { canCreateAgents: false, canCreateSkills: false } });
    agentId = a.id;
  }
  config.agents[key] ??= { name: name + '协作身份', mode: 'manual', use: 'command', access: 'read', enabled: true, paperclipId: agentId };
  auth.agentTokens[key] ??= randomBytes(32).toString('hex');
  if (!auth.paperclipTokens[key]) auth.paperclipTokens[key] = (await pc.post('/agents/' + agentId + '/keys', { name: 'SuitMe workspace native ACL', scope: { kind: 'standard' } })).token;
  const projectId = await project(name, catalog.spaces[domain]?.projectId);
  const members = catalog.spaces[domain]?.members ?? [key];
  for (const member of members) { const subjectId = config.agents[member]?.paperclipId; if (!subjectId) throw new Error('Configured member not found'); await pc.post('/projects/' + projectId + '/access-members', { subjectType: 'agent', subjectId }); }
  catalog.spaces[domain] = { ...catalog.spaces[domain], projectId, agent: key, name, members };
}
writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
writeFileSync(runtime('secrets.json'), JSON.stringify(auth, null, 2), { mode: 0o600 });
writeFileSync(runtime('knowledge-workspaces.json'), JSON.stringify(catalog, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ companyId: config.companyId, spaces: Object.fromEntries(Object.keys(catalog.spaces).map(d => [catalog.spaces[d].name ?? d, catalog.spaces[d].projectId])), identityMode: 'manual professional Agent principals; no human impersonation' }, null, 2));
