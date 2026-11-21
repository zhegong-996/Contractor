import { z } from 'zod';
import type { SuperAgentStore } from '../superagent-ports.ts';
import { WorkbenchError } from './errors.ts';
import { digest } from './knowledge.ts';
import { sensitiveFeishuText } from '../feishu-sources.ts';
import { assistantSelection, type openPlatformAssistant } from './platform-assistant.ts';

export const personalAgentInput = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().trim().min(1).max(80),
  instructions: z.string().trim().max(2000),
  experience: z.string().trim().max(4000),
  selection: assistantSelection.nullable(),
}).strict();
type Profile = Omit<z.infer<typeof personalAgentInput>, 'revision'>;
type Assistant = Pick<ReturnType<typeof openPlatformAssistant>, 'choices' | 'usable' | 'answer'>;

export function openPersonalAgents(store: Pick<SuperAgentStore, 'db' | 'atomic'>, assistant: Assistant, active: (member: string) => boolean) {
  store.db.exec('CREATE TABLE IF NOT EXISTS workbench_personal_agent (owner TEXT PRIMARY KEY, value TEXT NOT NULL)');
  function profile(actor: string): Profile {
    if (!active(actor)) throw new WorkbenchError('成员账号不可用。', 403);
    const row = store.db.prepare('SELECT value FROM workbench_personal_agent WHERE owner=?').get(actor);
    return row ? JSON.parse(String(row.value)) : { title: '我的 Agent', instructions: '', experience: '', selection: null };
  }
  function view(actor: string) {
    const current = profile(actor);
    return { ...current, revision: digest(current), choices: assistant.choices(), enabled: assistant.usable(current.selection) };
  }
  function update(actor: string, { revision, ...value }: z.infer<typeof personalAgentInput>) {
    return store.atomic(() => {
      const current = profile(actor);
      if (digest(current) !== revision) throw new WorkbenchError('个人 Agent 已更新，请刷新。', 409);
      if (value.selection && digest(value.selection) !== digest(current.selection) && !assistant.usable(value.selection))
        throw new WorkbenchError('请选择团队已接入的模型。', 409);
      store.db.prepare('INSERT OR REPLACE INTO workbench_personal_agent VALUES(?,?)').run(actor, JSON.stringify(value));
      return view(actor);
    });
  }
  async function answer(actor: string, question: string, history?: { role: 'user' | 'assistant'; content: string }[]) {
    const current = profile(actor);
    if (!current.selection) throw new WorkbenchError('请先为个人 Agent 配置模型。', 409);
    if (sensitiveFeishuText.test([question, current.instructions, current.experience].join('\n')))
      throw new WorkbenchError('请移除问题或个人经验中的凭据、邀请链接等敏感信息。', 409);
    const result = await assistant.answer(actor, { question, instructions: current.instructions, experience: current.experience,
      ...(history?.length && { history }) }, current.selection);
    if (digest(profile(actor)) !== digest(current) || !assistant.usable(current.selection))
      throw new WorkbenchError('个人 Agent 配置或模型授权已变化，请重试。', 409);
    return result;
  }
  return { view, update, answer };
}
