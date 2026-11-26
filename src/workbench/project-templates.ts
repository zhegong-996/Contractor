import { WorkbenchError } from './errors.ts';
import { z } from 'zod';
import { approvalStage, routineSchema, title, triggerPolicy, type Project } from './config.ts';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const member = z.string().regex(/^[a-zA-Z0-9_-]{2,32}$/);

export const projectTemplateSchema = z.object({
  kind: z.literal('contractor-project-template'),
  version: z.literal(1),
  title: title.optional(),
  goals: z.array(z.object({ id, title }).strict()).max(40).default([]),
  topics: z.array(z.object({ id, title, parent: id.optional() }).strict()).max(40).default([]),
  trigger: triggerPolicy.optional(),
  approvals: z.array(approvalStage).max(6).optional(),
  routines: z.array(routineSchema).max(30).default([]),
  modelRoutes: z.array(z.object({ purpose: z.enum(['summary', 'personal', 'execution']), agent: id,
    models: z.array(z.string().min(1).max(100)).min(1).max(4) }).strict()).max(60).optional(),
}).strict();
export type ProjectTemplate = z.infer<typeof projectTemplateSchema>;

/** 只导出可迁移配置：不含成员、凭据、渠道绑定、交付仓库与额度策略。 */
export function exportProjectTemplate(project: Project): ProjectTemplate {
  return {
    kind: 'contractor-project-template', version: 1, title: project.title,
    goals: project.goals.map(goal => ({ id: goal.id, title: goal.title })),
    topics: project.topics.map(topic => ({ id: topic.id, title: topic.title, ...(topic.parent ? { parent: topic.parent } : {}) })),
    ...(project.trigger && { trigger: project.trigger }),
    ...(project.approvals && { approvals: project.approvals }),
    routines: project.routines,
    ...(project.modelRoutes && { modelRoutes: project.modelRoutes.map(({ purpose, agent, models }) => ({ purpose, agent, models })) }),
  };
}

/**
 * 把模板落到新项目：主题重编号，成员相关字段（审批人、例行任务执行人）替换为导入者，
 * 引用外部工单的 next-version 例行任务与当前部署不存在的模型路线会被丢弃。
 */
export function materializeTemplate(template: ProjectTemplate, actor: string, agentIds: Set<string>, base: string) {
  for (const rows of [template.topics, template.goals, template.routines, template.approvals ?? []]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length)
      throw new WorkbenchError('模板中的主题、目标、例行任务或审批阶段有重复标识，请检查模板。', 400);
  }
  const roots = new Set(template.topics.filter(topic => !topic.parent).map(topic => topic.id));
  for (const topic of template.topics) {
    if (topic.parent && !roots.has(topic.parent))
      throw new WorkbenchError('模板中的子主题须归属同一模板的一级主题。', 400);
  }
  const topicMap = new Map<string, string>();
  const stem = base.replace(/^project-/, '').slice(0, 8);
  const topics: { id: string; title: string; parent?: string }[] = template.topics.map((topic, index) => {
    const next = 'topic-' + stem + '-' + index;
    topicMap.set(topic.id, next);
    return { id: next, title: topic.title };
  });
  for (const topic of template.topics) {
    if (topic.parent && topicMap.has(topic.parent)) topics.find(item => item.id === topicMap.get(topic.id))!.parent = topicMap.get(topic.parent)!;
  }
  const routines = template.routines.flatMap(routine => {
    const action = routine.action;
    if (action.kind === 'next-version') return [];
    if (action.topic && !topicMap.has(action.topic))
      throw new WorkbenchError('例行任务引用的主题不在此模板中。', 400);
    const next = action.kind === 'consultation'
      ? { kind: 'consultation' as const, topic: topicMap.get(action.topic) ?? action.topic, text: action.text, agent: action.agent }
      : { kind: 'ticket' as const, title: action.title, request: action.request,
        ...(action.topic && topicMap.has(action.topic) ? { topic: topicMap.get(action.topic) } : {}) };
    return [{ id: routine.id, title: routine.title, cron: routine.cron, actor, action: next }];
  });
  return {
    ...(template.trigger && { trigger: template.trigger }),
    goals: template.goals.map(goal => ({ id: goal.id, title: goal.title, done: false })),
    topics,
    routines,
    approvals: template.approvals?.map(stage => ({ ...stage, members: [actor] })),
    modelRoutes: template.modelRoutes?.filter(route => agentIds.has(route.agent)),
  };
}

export { member };
