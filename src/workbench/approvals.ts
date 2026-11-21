import { key } from '../../upstream/superagent/src/core/index.ts';
import type { Project } from './config.ts';
import type { Work } from './work-types.ts';

export type WorkApprovals = NonNullable<Work['approvals']>;

export const approvalSubject = (ticket: string, revision: string, stage: number) => key('approval', ticket, revision, String(stage));

export function currentApprovalStage(project: Project, approvals: WorkApprovals) {
  return project.approvals?.[approvals.stage];
}

export function mayApprove(project: Project, approvals: WorkApprovals, actor: string) {
  const stage = currentApprovalStage(project, approvals);
  if (!stage) return false;
  if (approvals.history.some(row => row.stage === approvals.stage && row.actor === actor)) return false;
  return stage.members.includes(actor);
}

/** 记录一次同意并推进阶段；全部完成时写入 completedAt。调用方负责 saveWork。 */
export function approveStage(project: Project, approvals: WorkApprovals, actor: string, note?: string, at = new Date().toISOString()) {
  const stage = currentApprovalStage(project, approvals)!;
  if (!stage.members.includes(actor) || approvals.history.some(row => row.stage === approvals.stage && row.actor === actor))
    throw new Error('当前成员不在本阶段审批人内或已审批。');
  approvals.history.push({ stage: approvals.stage, actor, at, ...(note ? { note } : {}) });
  const decided = stage.requireAll
    ? stage.members.every(member => approvals.history.some(row => row.stage === approvals.stage && row.actor === member))
    : true;
  if (decided) {
    approvals.stage += 1;
    if (approvals.stage >= (project.approvals?.length ?? 0)) approvals.completedAt = at;
  }
  return approvals;
}
