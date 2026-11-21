import { z } from 'zod';
import type { SuperAgentStore } from '../superagent-ports.ts';
import { WorkbenchError } from './errors.ts';
import { digest } from './knowledge.ts';
import { emptyHarness, harnessBindings, validateAssistantText, type AssistantHarness, type AssistantHistory,
  type HarnessBindings } from './assistant-harness.ts';
import { assistantSelection, type openPlatformAssistant } from './platform-assistant.ts';

export const personalAgentInput = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
  instructions: z.string().trim().max(2000),
  experience: z.string().trim().max(4000),
  selection: assistantSelection.nullable(),
  harness: harnessBindings.optional(),
}).strict();
type Profile = Omit<z.infer<typeof personalAgentInput>, 'revision' | 'description' | 'harness'> & { description: string; harness: HarnessBindings };
type Assistant = Pick<ReturnType<typeof openPlatformAssistant>, 'choices' | 'usable' | 'answer' | 'personalContract'>;

export function openPersonalAgents(store: Pick<SuperAgentStore, 'db' | 'atomic'>, assistant: Assistant,
  harness: AssistantHarness, active: (member: string) => boolean) {
  store.db.exec('CREATE TABLE IF NOT EXISTS workbench_personal_agent (owner TEXT PRIMARY KEY, value TEXT NOT NULL)');
  function profile(actor: string): Profile {
    if (!active(actor)) throw new WorkbenchError('成员账号不可用。', 403);
    const row = store.db.prepare('SELECT value FROM workbench_personal_agent WHERE owner=?').get(actor);
    const saved = row ? JSON.parse(String(row.value)) as Partial<Profile> : {};
    return { title: saved.title ?? '我的 Agent', description: saved.description ?? '', instructions: saved.instructions ?? '',
      experience: saved.experience ?? '', selection: saved.selection ?? null, harness: saved.harness ?? emptyHarness() };
  }
  function view(actor: string) {
    const current = profile(actor);
    return { ...current, revision: digest(current), choices: assistant.choices(), enabled: assistant.usable(current.selection),
      modules: harness.modules('personal', current.harness), mounts: harness.mounts('personal', actor, current.harness),
      contract: assistant.personalContract };
  }
  function update(actor: string, { revision, description, harness: bindings, ...values }: z.infer<typeof personalAgentInput>) {
    return store.atomic(() => {
      const current = profile(actor);
      if (digest(current) !== revision) throw new WorkbenchError('个人 Agent 已更新，请刷新。', 409);
      if (values.selection && digest(values.selection) !== digest(current.selection) && !assistant.usable(values.selection))
        throw new WorkbenchError('请选择团队已接入的模型。', 409);
      const value = { title: values.title, description: description ?? current.description, instructions: values.instructions,
        experience: values.experience, selection: values.selection,
        harness: harness.validate('personal', actor, bindings ?? current.harness, current.harness) };
      validateAssistantText(value.title, value.description, value.instructions, value.experience);
      if (digest(value) !== revision)
        store.db.prepare('INSERT OR REPLACE INTO workbench_personal_agent VALUES(?,?)').run(actor, JSON.stringify(value));
      return view(actor);
    });
  }
  async function answer(actor: string, question: string, history?: AssistantHistory) {
    const current = profile(actor);
    if (!current.selection) throw new WorkbenchError('请先为个人 Agent 配置模型。', 409);
    validateAssistantText(question, current.title, current.instructions, current.experience);
    const revision = digest(current);
    const result = await assistant.answer(actor, { ...current, selection: current.selection, revision }, question, history);
    if (digest(profile(actor)) !== revision || !assistant.usable(current.selection))
      throw new WorkbenchError('个人 Agent 配置或模型授权已变化，请重试。', 409);
    return { ...result, agentTitle: current.title };
  }
  return { view, update, answer };
}
