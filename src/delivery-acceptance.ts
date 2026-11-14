import type { Task } from './store.ts';

export function validateAcceptance(task: Task, sha: string, cases: { name: string; passed: boolean }[]) {
  const d = task.delivery;
  if (!d || d.ci !== 'passed' || !d.deployedSha || sha !== d.headSha || sha !== d.deployedSha) throw new Error('Acceptance must target the deployed, CI-verified commit');
  if (!cases.length || cases.some(c => !c.name.trim() || c.passed !== true)) throw new Error('Every acceptance case must pass');
  const required: string[] = JSON.parse(task.context).businessAcceptance ?? ['符合任务要求'];
  if (new Set(cases.map(c => c.name)).size !== cases.length || required.some(name => !cases.some(c => c.name === name))) throw new Error('Every required business acceptance case must be recorded');
  if (!d.environment) throw new Error('Acceptance environment is missing');
}
