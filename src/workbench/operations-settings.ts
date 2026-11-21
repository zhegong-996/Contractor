import { z } from 'zod';
import type { SuperAgentStore } from '../superagent-ports.ts';
import { dispatchRule, modelId, modelRoute, projectResponsibility, type Agent, type Project, type Settings } from './config.ts';
import { WorkbenchError } from './errors.ts';
import { executionCapabilities } from './execution-capabilities.ts';
import { digest } from './knowledge.ts';
import type { ProjectTopic } from './project-resources.ts';

export const modelProvider = z.enum(['openai', 'deepseek', 'ollama']);
export type ModelProvider = z.infer<typeof modelProvider>;
const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const modelServiceUpdate = z.object({ revision, enabled: z.boolean(), models: z.array(modelId).max(48)
  .refine(models => new Set(models).size === models.length) }).strict();
type ModelService = Pick<z.infer<typeof modelServiceUpdate>, 'enabled' | 'models'>;
const routingSchema = z.object({ responsibilities: z.array(projectResponsibility).max(500),
  dispatch: z.array(dispatchRule).max(300), modelRoutes: z.array(modelRoute).max(60) }).strict();
export const projectRoutingUpdate = routingSchema.extend({ revision }).strict();
type Routing = z.infer<typeof routingSchema>;
const serviceTitle = { openai: 'OpenAI · Codex', deepseek: 'DeepSeek · Claude Code / Octop', ollama: 'Ollama · Claude Code' };

export function loadOperationsSettings(store: Pick<SuperAgentStore, 'db' | 'atomic'>, projects: Project[]) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS workbench_model_service (provider TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workbench_project_routing (project TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  for (const project of projects) {
    const row = store.db.prepare('SELECT value FROM workbench_project_routing WHERE project=?').get(project.id);
    if (row) Object.assign(project, routingSchema.parse(JSON.parse(String(row.value))));
  }
  const service = (provider: ModelProvider): ModelService => {
    const row = store.db.prepare('SELECT value FROM workbench_model_service WHERE provider=?').get(provider);
    return row ? JSON.parse(String(row.value)) as ModelService : { enabled: true, models: [] };
  };
  function modelAllowed(provider: string | undefined, model: string | undefined) {
    const known = modelProvider.safeParse(provider);
    if (!known.success) return true;
    const policy = service(known.data);
    return policy.enabled && (!policy.models.length || !!model && policy.models.includes(model));
  }
  return { service, modelAllowed };
}

type Ports = {
  canManageServices: (actor: string) => boolean;
  projectFor: (id: string, actor: string) => Project;
  maintain: (project: Project, actor: string) => boolean;
  mayStart: (project: Project, actor: string) => boolean;
  topicsFor: (project: Project) => ProjectTopic[];
  audit: (id: string, kind: string, value: object) => void;
};

export function operationsSettings(store: Pick<SuperAgentStore, 'db' | 'atomic'>,
  config: Pick<Settings, 'agents' | 'functions' | 'octop' | 'platformAssistant'>, loaded: ReturnType<typeof loadOperationsSettings>, ports: Ports) {
  const { canManageServices, projectFor, maintain, mayStart, topicsFor, audit } = ports;
  function assertServices(actor: string) {
    if (!canManageServices(actor)) throw new WorkbenchError('需要平台服务管理权限。', 403);
  }
  function modelServices(actor: string) {
    assertServices(actor);
    return modelProvider.options.map(provider => {
      const value = loaded.service(provider);
      const agents = config.agents.filter(agent => agent.execution?.provider === provider && executionCapabilities(agent).available);
      const profileModels = [
        ...(provider === 'deepseek' ? (config.octop?.profiles ?? []).map(profile => profile.model) : []),
        ...(config.platformAssistant?.find(row => row.provider === provider)?.models ?? []),
      ];
      return { provider, title: serviceTitle[provider], ...value, revision: digest(value),
        configured: agents.length > 0 || profileModels.length > 0,
        availableModels: [...new Set([...agents.flatMap(a => a.allowedModels ?? (a.model ? [a.model] : [])), ...profileModels])].sort() };
    });
  }

  function setModelService(actor: string, provider: ModelProvider, { revision, ...value }: z.infer<typeof modelServiceUpdate>) {
    assertServices(actor);
    if (digest(loaded.service(provider)) !== revision) throw new WorkbenchError('模型服务已被更新，请刷新后重试。', 409);
    if (digest(value) === revision) return modelServices(actor).find(item => item.provider === provider)!;
    store.atomic(() => {
      store.db.prepare('INSERT OR REPLACE INTO workbench_model_service VALUES (?,?)').run(provider, JSON.stringify(value));
      audit('platform', 'model.service-changed', { actor, provider, enabled: value.enabled, models: value.models });
    });
    return modelServices(actor).find(item => item.provider === provider)!;
  }

  const currentRouting = (project: Project): Routing => ({ responsibilities: project.responsibilities, dispatch: project.dispatch,
    modelRoutes: project.modelRoutes ?? [] });
  function routingProject(actor: string, id: string) {
    const project = projectFor(id, actor);
    if (!maintain(project, actor)) throw new WorkbenchError('由项目维护人配置职责和路由。', 403);
    return project;
  }
  const mayRouteModel = (agent: Agent) => agent.engine === 'codex' && executionCapabilities(agent).local && !!agent.allowedModels?.length;
  function projectRouting(actor: string, id: string) {
    const project = routingProject(actor, id);
    const current = currentRouting(project);
    return { ...current, revision: digest(current), duties: config.functions.map(({ id, title }) => ({ id, title })),
      members: project.members.filter(member => mayStart(project, member)), topics: topicsFor(project).map(({ id, title }) => ({ id, title })),
      agents: config.agents.filter(agent => agent.engine !== 'octop' && agent.projects.includes(id) && mayStart(project, agent.owner)).map(agent => ({
        id: agent.id, title: agent.title, function: agent.function, owner: agent.owner, kind: agent.kind,
        models: mayRouteModel(agent) ? agent.allowedModels!.filter(model => loaded.modelAllowed(agent.execution?.provider, model)) : [],
        canSummarize: project.discussion?.agent === agent.id,
      })), summaryUsesFixedModel: !!project.discussion?.model };
  }

  function setProjectRouting(actor: string, id: string, { revision, ...routing }: z.infer<typeof projectRoutingUpdate>) {
    const project = routingProject(actor, id);
    const previous = currentRouting(project);
    if (digest(previous) !== revision) throw new WorkbenchError('项目路由已被更新，请刷新后重试。', 409);
    const view = projectRouting(actor, id);
    if (digest(routing) === revision) return view;
    if (new Set(routing.responsibilities.map(row => row.member + '/' + row.function)).size !== routing.responsibilities.length
      || new Set(routing.dispatch.map(row => (row.topic ?? '') + '/' + row.function)).size !== routing.dispatch.length
      || new Set(routing.modelRoutes.map(row => row.purpose + '/' + row.agent)).size !== routing.modelRoutes.length)
      throw new WorkbenchError('职责、牵头规则或模型路由存在重复。', 409);
    const added = <T,>(rows: T[], known: T[]) => {
      const existing = new Set(known.map(row => digest(row)));
      return rows.filter(row => !existing.has(digest(row)));
    };
    if (added(routing.responsibilities, previous.responsibilities).some(row => !view.members.includes(row.member)
      || !view.duties.some(duty => duty.id === row.function))) throw new WorkbenchError('职责须分配给当前项目的协作成员。', 409);
    if (added(routing.dispatch, previous.dispatch).some(row => row.topic && !view.topics.some(topic => topic.id === row.topic)
      || row.decider && !view.members.includes(row.decider)
      || !view.agents.some(agent => agent.id === row.agent && agent.function === row.function)))
      throw new WorkbenchError('派工须使用本项目主题、对应职责的 Agent 和有协作权限的决定人。', 409);
    for (const row of added(routing.modelRoutes, previous.modelRoutes)) {
      const agent = view.agents.find(agent => agent.id === row.agent);
      if (!agent || row.models.some(model => !agent.models.includes(model)) || row.purpose === 'personal' && agent.kind !== 'personal'
        || row.purpose === 'summary' && !agent.canSummarize) throw new WorkbenchError('请选择此项目与 Agent 均获授权的模型和用途。', 409);
    }
    store.atomic(() => {
      store.db.prepare('INSERT OR REPLACE INTO workbench_project_routing VALUES (?,?)').run(id, JSON.stringify(routing));
      audit(id, 'project.routing-changed', { actor, previous: revision, revision: digest(routing) });
    });
    Object.assign(project, routing);
    return projectRouting(actor, id);
  }
  return { modelServices, setModelService, projectRouting, setProjectRouting, assertServices };
}
