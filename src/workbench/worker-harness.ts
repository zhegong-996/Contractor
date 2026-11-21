import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { WorkbenchError } from './errors.ts';
import { digest } from './knowledge.ts';
import type { OctopResources, SkillRef } from './octop-resources.ts';
import { validateAssistantText } from './assistant-harness.ts';

const revision = z.string().regex(/^[a-f0-9]{64}$/);
const skill = z.object({ id: z.string().uuid().or(z.string().regex(/^[a-f0-9]{32}$/)), revision }).strict();
const fields = z.object({ instructions: z.string().trim().max(4000), skills: z.array(skill).max(4) })
  .refine(value => new Set(value.skills.map(ref => ref.id)).size === value.skills.length, '每项技能只能挂载一个版本。');
export const workerHarnessUpdate = fields.safeExtend({ revision }).strict();

type Settings = z.infer<typeof fields>;
type GrantedSkill = SkillRef & { title: string; ownerGrant: number; requesterGrant: number };
export type WorkerHarnessStamp = { revision: string; skills: GrantedSkill[] };

export function openWorkerHarness(db: DatabaseSync, catalog: Pick<OctopResources, 'authority' | 'skill' | 'skillVersions'>) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_worker_harness (
    project TEXT NOT NULL, agent TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(project, agent)
  )`);
  const read = (project: string, agent: string): Settings => {
    const row = db.prepare('SELECT value FROM workbench_worker_harness WHERE project=? AND agent=?').get(project, agent);
    return row ? fields.parse(JSON.parse(String(row.value))) : { instructions: '', skills: [] };
  };
  const allowed = (project: string, actor: string, ref: SkillRef) => {
    const row = catalog.skill(ref.id, ref.revision);
    return row?.project === project ? catalog.authority(row.id, actor, row.owner) : undefined;
  };
  function view(project: string, agent: string, owner: string, actor: string) {
    const settings = read(project, agent);
    return { ...settings, revision: digest(settings),
      versions: catalog.skillVersions(project).filter(ref => allowed(project, actor, ref) !== undefined && allowed(project, owner, ref) !== undefined)
        .map(({ id, title, revision }) => ({ id, title, revision })) };
  }
  function save(project: string, agent: string, owner: string, actor: string, input: z.infer<typeof workerHarnessUpdate>) {
    const { revision, ...updated } = input;
    validateAssistantText(updated.instructions);
    if (digest(read(project, agent)) !== revision) throw new WorkbenchError('执行配置已变化，请刷新后再保存。', 409);
    if (updated.skills.some(ref => allowed(project, owner, ref) === undefined || allowed(project, actor, ref) === undefined))
      throw new WorkbenchError('所选技能的版本或授权已变化。', 403);
    db.prepare('INSERT OR REPLACE INTO workbench_worker_harness VALUES (?,?,?)').run(project, agent, JSON.stringify(updated));
    return view(project, agent, owner, actor);
  }
  function assemble(project: string, agent: string, owner: string, requester: string) {
    const settings = read(project, agent);
    const skills = settings.skills.map(ref => {
      const ownerGrant = allowed(project, owner, ref);
      const requesterGrant = allowed(project, requester, ref);
      if (ownerGrant === undefined || requesterGrant === undefined)
        throw new WorkbenchError('执行 Agent 或委托人没有本项目技能的访问权限，请核对技能共享。', 409);
      const { title, instructions } = catalog.skill(ref.id, ref.revision)!;
      validateAssistantText(title, instructions);
      return { ref: { ...ref, title, ownerGrant, requesterGrant }, instructions };
    });
    const stamp = { revision: digest(settings), skills: skills.map(row => row.ref) };
    const text = [settings.instructions && '项目执行提示词\n' + settings.instructions,
      ...skills.map(({ ref, instructions }) => '项目技能「' + ref.title + '」 · ' + ref.revision + '\n' + instructions)].filter(Boolean).join('\n\n');
    return { stamp, text };
  }
  const current = (project: string, owner: string, requester: string, stamp: WorkerHarnessStamp) => stamp.skills.every(ref =>
    allowed(project, owner, ref) === ref.ownerGrant && allowed(project, requester, ref) === ref.requesterGrant);
  const readable = (project: string, actor: string, stamp: WorkerHarnessStamp) => stamp.skills.every(ref => allowed(project, actor, ref) !== undefined);
  return { assemble, view, save, current, readable };
}
