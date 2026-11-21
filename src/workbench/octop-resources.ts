import type { DatabaseSync } from 'node:sqlite';
import { key } from '../../upstream/superagent/src/core/index.ts';
import { digest } from './knowledge.ts';

type Skill = { id: string; project: string; owner: string; slug: string; revision: string; title: string; instructions: string };
export type SkillRef = Pick<Skill, 'id' | 'revision'>;
export type ExpertSpec = { title: string; capability: string; function: string; instructions: string };
export type Expert = ExpertSpec & { id: string; project: string; owner: string; source?: { agent: string; revision: string; kind: 'expert' | 'subagent' } };
export type ExpertAuthority = { grant: number; skills: (SkillRef & { ownerGrant: number; requesterGrant: number })[] };

export class OctopResources {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_octop_skill (
        id TEXT NOT NULL, revision TEXT NOT NULL, project TEXT NOT NULL, owner TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY(id,revision)
      );
      CREATE TABLE IF NOT EXISTS workbench_octop_expert (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, owner TEXT NOT NULL, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workbench_octop_template (
        agent TEXT PRIMARY KEY, revision TEXT NOT NULL, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workbench_octop_share (
        id TEXT NOT NULL, member TEXT NOT NULL, generation INTEGER NOT NULL, active INTEGER NOT NULL, PRIMARY KEY(id,member)
      );
      CREATE TABLE IF NOT EXISTS workbench_octop_mount (
        agent TEXT NOT NULL, skill TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(agent,skill)
      );
    `);
  }

  publishSkill(project: string, owner: string, value: Pick<Skill, 'slug' | 'title' | 'instructions'>) {
    const id = key('octop-skill', project, owner, value.slug);
    const revision = digest(value);
    const skill: Skill = { ...value, id, revision, project, owner };
    this.db.prepare('INSERT OR IGNORE INTO workbench_octop_skill VALUES (?,?,?,?,?)').run(id, revision, project, owner, JSON.stringify(skill));
    return skill;
  }

  skill(id: string, revision?: string): Skill | undefined {
    const row = revision ? this.db.prepare('SELECT value FROM workbench_octop_skill WHERE id=? AND revision=?').get(id, revision)
      : this.db.prepare('SELECT value FROM workbench_octop_skill WHERE id=? ORDER BY rowid DESC LIMIT 1').get(id);
    return row && JSON.parse(String(row.value));
  }

  experts(project?: string): Expert[] {
    return (project ? this.db.prepare('SELECT value FROM workbench_octop_expert WHERE project=? ORDER BY rowid').all(project)
      : this.db.prepare('SELECT value FROM workbench_octop_expert ORDER BY rowid').all()).map(row => JSON.parse(String(row.value)));
  }

  expert(id: string): Expert | undefined {
    const row = this.db.prepare('SELECT value FROM workbench_octop_expert WHERE id=?').get(id);
    return row && JSON.parse(String(row.value));
  }

  saveExpert(value: Expert) {
    this.db.prepare('INSERT INTO workbench_octop_expert VALUES (?,?,?,?)').run(value.id, value.project, value.owner, JSON.stringify(value));
  }

  share(id: string, member: string, active: boolean) {
    this.db.prepare(`INSERT INTO workbench_octop_share VALUES (?,?,1,?) ON CONFLICT(id,member) DO UPDATE
      SET generation=generation+1,active=excluded.active WHERE active<>excluded.active`).run(id, member, Number(active));
  }

  revokeProjectParticipant(project: string, member: string) {
    this.db.prepare(`WITH resources AS (
      SELECT id,owner FROM workbench_octop_skill WHERE project=?
      UNION SELECT id,owner FROM workbench_octop_expert WHERE project=?
    )
    UPDATE workbench_octop_share SET active=0,generation=generation+1
    WHERE active=1 AND id IN (SELECT id FROM resources WHERE owner=? OR workbench_octop_share.member=?)`)
      .run(project, project, member, member);
  }

  authority(id: string, actor: string, owner: string) {
    if (actor === owner) return 0;
    const row = this.db.prepare('SELECT generation FROM workbench_octop_share WHERE id=? AND member=? AND active=1').get(id, actor);
    return row ? Number(row.generation) : undefined;
  }

  sharedWith(id: string): string[] {
    return this.db.prepare('SELECT member FROM workbench_octop_share WHERE id=? AND active=1 ORDER BY member').all(id)
      .map(row => String(row.member));
  }

  mounts(agent: string): SkillRef[] {
    return this.db.prepare('SELECT skill AS id,revision FROM workbench_octop_mount WHERE agent=? ORDER BY skill').all(agent) as SkillRef[];
  }

  setMount(agent: string, ref: SkillRef, active: boolean) {
    if (active) this.db.prepare('INSERT OR REPLACE INTO workbench_octop_mount VALUES (?,?,?)').run(agent, ref.id, ref.revision);
    else this.db.prepare('DELETE FROM workbench_octop_mount WHERE agent=? AND skill=? AND revision=?').run(agent, ref.id, ref.revision);
  }

  skillVersions(project: string, owner?: string): Skill[] {
    return this.db.prepare('SELECT value FROM workbench_octop_skill WHERE project=?'
      + (owner === undefined ? '' : ' AND owner=?') + ' ORDER BY rowid DESC').all(project, ...(owner === undefined ? [] : [owner]))
      .map(row => JSON.parse(String(row.value)));
  }

  template(agent: string): (ExpertSpec & { kind: 'expert' | 'subagent'; revision: string; skills: SkillRef[] }) | undefined {
    const row = this.db.prepare('SELECT value FROM workbench_octop_template WHERE agent=?').get(agent);
    return row && JSON.parse(String(row.value));
  }

  publishTemplate(agent: string, spec: ExpertSpec, kind: 'expert' | 'subagent', skills: SkillRef[]) {
    const revision = digest({ spec, kind, skills });
    this.db.prepare('INSERT OR REPLACE INTO workbench_octop_template VALUES (?,?,?)')
      .run(agent, revision, JSON.stringify({ ...spec, revision, skills, kind }));
    return revision;
  }
}
