import { z } from 'zod';
import { sensitiveFeishuText } from '../feishu-sources.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import { WorkbenchError } from './errors.ts';
import { digest } from './knowledge.ts';
import type { OctopResources, SkillRef } from './octop-resources.ts';
import type { readSkillManifest } from './skill-manifest.ts';

export type AssistantPurpose = 'router' | 'memory' | 'personal';
export type AssistantHistory = { role: 'user' | 'assistant'; content: string }[];
type Context = { topic?: string; experience?: string; history?: AssistantHistory };

/** A deployed plugin contributes read-only context from inputs already checked by the caller. */
export type AssistantContextPlugin = {
  id: string;
  version: string;
  title: string;
  description: string;
  purposes: readonly AssistantPurpose[];
  defaultEnabled: boolean;
  contribute: (context: Readonly<Context>) => Record<string, unknown>;
};
export type AssistantSkill = {
  id: string;
  revision: string;
  slug: string;
  title: string;
  instructions: string;
  scope: 'builtin' | 'team' | 'personal';
  active: boolean;
  editable: boolean;
  purposes: readonly AssistantPurpose[];
};
export type AssistantHarnessProvider = {
  context: readonly AssistantContextPlugin[];
  skills: readonly (Pick<AssistantSkill, 'slug' | 'title' | 'instructions' | 'purposes'> & { id: string })[];
};

const identifier = /^[a-z][a-z0-9-]{0,47}$/;
const skillRef = z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const harnessBindings = z.object({
  skills: z.array(skillRef).max(8).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, '同一技能只能挂载一个版本。'),
  context: z.record(z.string().regex(identifier), z.boolean()),
}).strict();
export type HarnessBindings = z.infer<typeof harnessBindings>;
export const emptyHarness = (): HarnessBindings => ({ skills: [], context: {} });
export const assistantSkillChange = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), slug: z.string().regex(identifier), title: z.string().trim().min(1).max(100),
    markdown: z.string().trim().min(1).max(6000) }).strict(),
  z.object({ action: z.literal('status'), id: skillRef.shape.id, active: z.boolean() }).strict(),
]);

type Scope = 'team' | 'personal';
const scopeId = (scope: Scope) => scope === 'team' ? '$assistant-team' : '$assistant-personal';
const skillOwner = (scope: Scope, actor: string) => scope === 'team' ? scopeId(scope) : actor;
const platformPurposes: readonly AssistantPurpose[] = ['router', 'memory'];
const allPurposes: readonly AssistantPurpose[] = [...platformPurposes, 'personal'];
const fullId = (id: string) => digest(['assistant-skill', id]).slice(0, 32);

export function validateAssistantText(...values: string[]) {
  if (values.some(value => sensitiveFeishuText.test(value)))
    throw new WorkbenchError('请从 Agent 配置中移除凭据、访问密码或邀请链接。', 400);
}

export type AssistantHarnessStamp = {
  revision: string;
  skills: (SkillRef & { title: string })[];
  context: { id: string; version: string; title: string }[];
};

export function openAssistantHarness(store: Pick<SuperAgentStore, 'db' | 'atomic'>, resources: OctopResources,
  provider: AssistantHarnessProvider, ports: { admin: (actor: string) => boolean; active: (actor: string) => boolean;
    readSkill: typeof readSkillManifest; audit: (id: string, event: string, data: object) => void }) {
  const { db } = store;
  if (new Set(provider.context.map(row => row.id)).size !== provider.context.length
    || provider.context.some(row => !identifier.test(row.id) || !row.version)
    || new Set(provider.skills.map(row => row.id)).size !== provider.skills.length) throw new Error('Agent Harness 插件标识或版本不合法。');
  const builtin = provider.skills.map(row => ({ ...row, id: fullId(row.id), revision: digest(row),
    scope: 'builtin' as const, active: true, editable: false }));
  db.exec('CREATE TABLE IF NOT EXISTS workbench_assistant_skill_state (skill TEXT PRIMARY KEY, active INTEGER NOT NULL, generation INTEGER NOT NULL)');
  const status = (id: string) => db.prepare('SELECT active,generation FROM workbench_assistant_skill_state WHERE skill=?').get(id);

  function requireScope(actor: string, scope: Scope) {
    if (scope === 'team' ? !ports.admin(actor) : !ports.active(actor)) throw new WorkbenchError('无权管理这组技能。', 403);
  }

  function accessible(purpose: AssistantPurpose, actor: string, ref: SkillRef) {
    const installed = builtin.find(row => row.id === ref.id && row.revision === ref.revision && row.purposes.includes(purpose));
    if (installed) return { ...installed, generation: 0 };
    const row = resources.skill(ref.id, ref.revision);
    if (!row) return;
    const scope = row.project === scopeId('team') && row.owner === skillOwner('team', actor) ? 'team'
      : purpose === 'personal' && row.project === scopeId('personal') && row.owner === actor ? 'personal' : undefined;
    if (!scope) return;
    const state = status(row.id);
    return { ...row, scope, active: !state || state.active === 1, generation: Number(state?.generation ?? 0) };
  }

  function catalog(actor: string, scope: Scope): AssistantSkill[] {
    requireScope(actor, scope);
    const visible: readonly AssistantPurpose[] = scope === 'personal' ? ['personal'] : platformPurposes;
    return [
      ...builtin.filter(row => row.purposes.some(purpose => visible.includes(purpose))),
      ...[...resources.skillVersions(scopeId('team'), skillOwner('team', actor)),
        ...(scope === 'personal' ? resources.skillVersions(scopeId(scope), actor) : [])]
        .map(({ project, slug, title, id, revision, instructions }) => ({
          id, revision, slug, title, instructions,
          scope: project === scopeId('team') ? 'team' as const : 'personal' as const,
          active: status(id)?.active !== 0, editable: project === scopeId(scope),
          purposes: project === scopeId('team') ? allPurposes : ['personal'] as const,
        })),
    ];
  }

  function change(actor: string, scope: Scope, input: z.infer<typeof assistantSkillChange>) {
    requireScope(actor, scope);
    const project = scopeId(scope), owner = skillOwner(scope, actor);
    return store.atomic(() => {
      if (input.action === 'publish') {
        const manifest = ports.readSkill(input.markdown);
        if (!manifest || manifest.slug !== input.slug || manifest.instructions.length > 5000)
          throw new WorkbenchError('SKILL.md 需包含匹配的 name 和正文，正文最多 5000 字。');
        validateAssistantText(input.title, manifest.instructions);
        const skill = resources.publishSkill(project, owner, { slug: input.slug, title: input.title, instructions: manifest.instructions });
        if (scope === 'team') ports.audit('platform', 'assistant.skill-published', { actor, skill: skill.id, revision: skill.revision });
        return { id: skill.id, revision: skill.revision };
      }
      const skill = resources.skill(input.id);
      if (!skill || skill.project !== project || skill.owner !== owner) throw new WorkbenchError('找不到可管理的技能。', 404);
      const previous = status(skill.id);
      if ((previous?.active !== 0) !== input.active) {
        db.prepare(`INSERT INTO workbench_assistant_skill_state VALUES(?,?,1) ON CONFLICT(skill)
          DO UPDATE SET active=excluded.active,generation=generation+1`).run(skill.id, Number(input.active));
        if (scope === 'team') ports.audit('platform', 'assistant.skill-status', { actor, skill: skill.id, active: input.active });
      }
      return { id: skill.id, revision: skill.revision };
    });
  }

  function validate(purpose: AssistantPurpose, actor: string, bindings: HarnessBindings, previous: HarnessBindings): HarnessBindings {
    const known = provider.context.filter(row => row.purposes.includes(purpose));
    if (Object.entries(bindings.context).some(([id, value]) => !known.some(row => row.id === id) && previous.context[id] !== value))
      throw new WorkbenchError('有上下文组件已移除或不适用于这个 Agent。', 409);
    let length = 0;
    for (const ref of bindings.skills) {
      const skill = accessible(purpose, actor, ref);
      if (!skill?.active && !previous.skills.some(row => row.id === ref.id && row.revision === ref.revision))
        throw new WorkbenchError('有技能版本已停用或当前账号无权挂载。', 409);
      if (skill) length += skill.instructions.length;
    }
    if (length > 14000) throw new WorkbenchError('已挂载技能的正文合计最多 14000 字。');
    return { skills: bindings.skills, context: Object.fromEntries(Object.entries(bindings.context).sort(([a], [b]) => a.localeCompare(b))) };
  }

  const modules = (purpose: AssistantPurpose, config: HarnessBindings) => provider.context
    .filter(row => row.purposes.includes(purpose))
    .map(({ contribute: _contribute, id, title, description, version, defaultEnabled }) => ({
      id, title, description, version, defaultEnabled, enabled: config.context[id] ?? defaultEnabled,
    }));
  const mounts = (purpose: AssistantPurpose, actor: string, config: HarnessBindings) => config.skills.map(ref => {
    const skill = accessible(purpose, actor, ref);
    return { ...ref, title: skill?.title ?? '技能版本不可用', active: skill?.active ?? false };
  });
  function assemble(purpose: AssistantPurpose, actor: string, bindings: HarnessBindings, inputs: Context) {
    const contexts = provider.context.filter(row => row.purposes.includes(purpose) && (bindings.context[row.id] ?? row.defaultEnabled));
    const skills = bindings.skills.flatMap(ref => {
      const row = accessible(purpose, actor, ref);
      return row?.active ? [row] : [];
    });
    return {
      fields: Object.assign({}, ...contexts.map(row => row.contribute(inputs))) as Record<string, unknown>,
      sections: skills.map(row => '技能「' + row.title + '」\n' + row.instructions),
      skillVersions: skills.map(row => ({ id: row.id, revision: row.revision, title: row.title })),
      contextVersions: contexts.map(({ id, version, title }) => ({ id, version, title })),
      authority: skills.map(row => row.generation),
    };
  }
  return { catalog, change, validate, mounts, modules, assemble };
}

export type AssistantHarness = ReturnType<typeof openAssistantHarness>;
