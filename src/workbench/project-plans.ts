import { z } from 'zod';
import type { SuperAgentStore } from '../superagent-ports.ts';
import { goalSchema, routineSchema, type Project } from './config.ts';
import { WorkbenchError } from './errors.ts';
import { digest } from './knowledge.ts';

export const projectPlansSchema = z.object({
  revision: z.string().min(1),
  goals: z.array(goalSchema),
  routines: z.array(routineSchema),
}).strict();
export type ProjectPlans = z.infer<typeof projectPlansSchema>;

export function openProjectPlans(store: Pick<SuperAgentStore, 'db'>, projects: Project[]) {
  store.db.exec('CREATE TABLE IF NOT EXISTS workbench_project_plans (project TEXT PRIMARY KEY, value TEXT NOT NULL);');
  for (const project of projects) {
    const row = store.db.prepare('SELECT value FROM workbench_project_plans WHERE project=?').get(project.id);
    if (!row) continue;
    try {
      const plans = projectPlansSchema.parse(JSON.parse(String(row.value)));
      Object.assign(project, { goals: plans.goals, routines: plans.routines });
    } catch { /* 保留配置中的默认值 */ }
  }
  const current = (project: Project): ProjectPlans => ({
    revision: digest({ goals: project.goals, routines: project.routines }),
    goals: project.goals, routines: project.routines,
  });
  const save = (project: Project, plans: ProjectPlans) => {
    store.db.prepare('INSERT OR REPLACE INTO workbench_project_plans VALUES (?,?)')
      .run(project.id, JSON.stringify({ revision: plans.revision, goals: plans.goals, routines: plans.routines }));
    Object.assign(project, { goals: plans.goals, routines: plans.routines });
  };
  const runs = (project: Project) => store.db.prepare(
    'SELECT routine, MAX(occurrence) AS last, MAX(at) AS at FROM workbench_routine_runs WHERE routine IN ('
    + project.routines.map(() => '?').join(',') + ') GROUP BY routine').all(...project.routines.map(routine => routine.id))
    .map(row => ({ routine: String(row.routine), last: Number(row.last), at: String(row.at) }));
  const assert = (actor: string, project: Project, input: ProjectPlans, known: ProjectPlans) => {
    if (known.revision !== input.revision) throw new WorkbenchError('目标或例行任务已被更新，请刷新后重试。', 409);
    if (new Set(input.goals.map(goal => goal.id)).size !== input.goals.length
      || new Set(input.routines.map(routine => routine.id)).size !== input.routines.length)
      throw new WorkbenchError('目标或例行任务标识重复。', 409);
    for (const routine of input.routines) {
      if (!project.members.includes(routine.actor)) throw new WorkbenchError('例行任务须由项目成员执行。', 409);
      const action = routine.action;
      if (action.kind === 'consultation') {
        const agents = project.consultations?.find(item => item.topic === action.topic)?.agents ?? [];
        if (!project.topics.some(topic => topic.id === action.topic) || !agents.some(row => row.agent === action.agent))
          throw new WorkbenchError('例行咨询须使用已配置主题咨询中的 Agent。', 409);
      } else if (action.kind === 'ticket') {
        if (action.topic && !project.topics.some(topic => topic.id === action.topic))
          throw new WorkbenchError('例行工单的主题须属于当前项目。', 409);
      }
    }
  };
  const next = (project: Project, plans: ProjectPlans): ProjectPlans => ({
    ...plans, revision: digest({ goals: plans.goals, routines: plans.routines }),
  });
  return { current, save, runs, assert, next };
}
