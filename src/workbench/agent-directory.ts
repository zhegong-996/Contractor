import type { DatabaseSync } from 'node:sqlite';
import type { Agent, Project, Settings } from './config.ts';
import { requireValue, WorkbenchError } from './errors.ts';
import { executionCapabilities } from './execution-capabilities.ts';
import { digest } from './knowledge.ts';
import type { Expert } from './octop-resources.ts';

export function openAgentDirectory(db: DatabaseSync, config: Pick<Settings, 'agents' | 'octop'>,
  configuredProjects: Map<string, string[]>, experts: Expert[]) {
  db.exec('CREATE TABLE IF NOT EXISTS workbench_agent (id TEXT PRIMARY KEY, active INTEGER NOT NULL)');
  const agentById = new Map(config.agents.map(agent => [agent.id, agent]));
  function octopAgent(expert: Expert): Agent {
    const profile = config.octop?.profiles.find(row => row.owner === expert.owner);
    return { id: expert.id, projects: [expert.project], owner: expert.owner, title: expert.title, capability: expert.capability,
      skill: expert.instructions, kind: 'personal', function: expert.function, active: !!profile, engine: 'octop', model: profile?.model,
      execution: profile && { kind: 'harness', provider: 'deepseek', effort: 'low', domains: [] } };
  }
  function register(agent: Agent) {
    configuredProjects.set(agent.id, [...agent.projects]);
    agentById.set(agent.id, agent);
    config.agents.push(agent);
  }
  for (const expert of experts) register(octopAgent(expert));

  function available(agent: Agent | undefined, project: Project, canStart: (project: Project, owner: string) => boolean): agent is Agent {
    if (!agent) return false;
    const row = db.prepare('SELECT active FROM workbench_agent WHERE id=?').get(agent.id);
    return agent.active && (!row || Number(row.active) === 1) && executionCapabilities(agent).available
      && agent.projects.includes(project.id) && canStart(project, agent.owner);
  }

  function setActive(actor: string, id: string, active: boolean, canStart: (project: string) => boolean, accountActive: boolean) {
    const agent = requireValue(agentById.get(id), '找不到这个 Agent。');
    if (agent.owner !== actor || !accountActive || !agent.active || active && !agent.projects.some(canStart))
      throw new WorkbenchError('由 Agent 所有者管理已配置的执行端。', 403);
    db.prepare('INSERT INTO workbench_agent VALUES (?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active')
      .run(agent.id, active ? 1 : 0);
    return agent;
  }
  const version = (agent: Agent) => digest({ ...agent, projects: configuredProjects.get(agent.id) });
  return { agentById, octopAgent, register, available, setActive, version };
}
