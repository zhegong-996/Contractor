import type { Agent, ModelPurpose, Project } from './config.ts';
import { WorkbenchError } from './errors.ts';
import type { ModelSelection } from './execution-evidence.ts';
import { codexModelCatalog } from './isolation.ts';

export class ModelRouteError extends WorkbenchError {
  constructor(message: string, readonly kind: 'model-unavailable' | 'model-authorization') { super(message, 409); }
}

export function workModelPurpose(work: { personal?: boolean }): ModelPurpose {
  return work.personal ? 'personal' : 'execution';
}

export function openModelRouting(readAgent: (id: string) => Agent | undefined,
  platformAllows: (provider: string | undefined, model: string | undefined) => boolean = () => true,
  readCatalog = codexModelCatalog) {
  const modelRouteFor = (project: Project, agent: string, purpose: ModelPurpose) =>
    project.modelRoutes?.find(route => route.agent === agent && route.purpose === purpose);
  function modelRouteCurrent(project: Project, agentId: string, purpose: ModelPurpose, selected?: ModelSelection) {
    const route = modelRouteFor(project, agentId, purpose);
    if (!selected) return !route;
    return selected.purpose === purpose && !!route?.models.includes(selected.selected)
      && !!readAgent(agentId)?.allowedModels?.includes(selected.selected);
  }
  async function selectExecutionModel(project: Project, agent: Agent, purpose: ModelPurpose): Promise<ModelSelection | undefined> {
    const route = modelRouteFor(project, agent.id, purpose);
    const provider = agent.execution?.provider;
    if (!route) {
      const model = purpose === 'summary' ? project.discussion?.model ?? agent.model : agent.model;
      if (!platformAllows(provider, model)) throw new ModelRouteError('平台模型服务已暂停或未允许此模型。', 'model-authorization');
      return;
    }
    function authorizedModels(candidates: string[]) {
      if (candidates.some(model => !readAgent(agent.id)?.allowedModels?.includes(model)))
        throw new ModelRouteError('模型授权已变化，请核对项目配置。', 'model-authorization');
      const allowed = candidates.filter(model => platformAllows(provider, model));
      if (!allowed.length) throw new ModelRouteError('此路由没有平台允许的模型。', 'model-authorization');
      return allowed;
    }
    authorizedModels(route.models);
    const catalog = await readCatalog(agent).catch(() => undefined);
    const current = modelRouteFor(project, agent.id, purpose);
    if (!current) throw new ModelRouteError('模型路由已移除，请核对后接续原工单。', 'model-authorization');
    const authorized = authorizedModels(current.models);
    if (!catalog) throw new ModelRouteError('模型目录暂不可核对，等待服务恢复。', 'model-unavailable');
    const unavailable: string[] = [];
    for (const model of authorized) {
      if (catalog.models.has(model)) return { purpose, primary: current.models[0]!, selected: model, unavailable, checkedAt: catalog.checkedAt };
      unavailable.push(model);
    }
    throw new ModelRouteError('当前项目和 Agent 授权的模型均不可用。', 'model-unavailable');
  }
  return { modelRouteCurrent, selectExecutionModel };
}
