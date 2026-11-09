// 协作编排器：把护栏（instruction-data / hop-fuse / event-merge）与委托（agent-delegation）
// 接进真实执行链，跑一次「coordinator(人) → worker(Agent) → checker(云评审)」三角色协作。
//
// 护栏是「运行时门」，不是纯函数摆设：外部文字先进字段白名单，委托链深度先过熔断，
// 多个事件先合并。执行与评审用真实模型（DeepSeek 云，复用 .runtime/cognee-env.json 的 key）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime } from '../src/config.ts';
import { delegate, narrowMandate, ROLE_SPECS, type Assignment } from '../src/agent-delegation.ts';
import { parseExternalEvent, externalTextAsData, type SanitizedEvent } from '../src/instruction-data.ts';
import { fuseDecision, MAX_HOPS } from '../src/hop-fuse.ts';
import { groupEvents } from '../src/event-merge.ts';
import { tallyVerdicts } from '../src/countersign.ts';

function deepseekKey(): string {
  try {
    const env = JSON.parse(readFileSync(path.join(runtime(), 'cognee-env.json'), 'utf8'));
    return env.COGNEE_LLM_API_KEY ?? '';
  } catch { return ''; }
}

/** 一次 OpenAI 兼容的模型调用（DeepSeek 云）。reasoning 模型可能把 content 空掉，空则重试。 */
async function llm(role: string, system: string, user: string): Promise<string> {
  const key = deepseekKey();
  if (!key) throw new Error('DeepSeek key 未配置（.runtime/cognee-env.json）');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const body = JSON.stringify({
      model: 'deepseek-flash', max_tokens: 4000, effort: 'low',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body,
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(`${role} 模型返回 ${response.status}`);
    const payload = await response.json() as any;
    const text = String(payload?.choices?.[0]?.message?.content ?? '').trim();
    if (text) return text;
    if (attempt < 3) await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`${role} 模型连续 3 次返回空 content（reasoning 占满 token）`);
}

export interface CollaborationLog {
  stage: string;
  detail: string;
}

export interface CollaborationOutcome {
  chain: { role: string; agentId: string; depth: number; task: string }[];
  workerOutput: string;
  checkerVerdict: string;
  logs: CollaborationLog[];
}

/**
 * 真跑一次三角色协作。`task` 是外部来的任务文字（模拟飞书消息），先进护栏再进委托链。
 */
export async function runCollaboration(task: string, external: { id: string; type: string; detail: string }): Promise<CollaborationOutcome> {
  const logs: CollaborationLog[] = [];

  // —— 护栏 1：外部文字先进字段白名单，subject 不得含指令文字 ——
  const parsed = parseExternalEvent({ id: external.id, type: external.type, subject: 'collab-task', detail: external.detail });
  if (!parsed.ok) throw new Error(`护栏拒绝外部事件：${parsed.error}`);
  const event: SanitizedEvent = parsed.event;
  logs.push({ stage: 'instruction-data', detail: `外部事件通过字段白名单（subject=collab-task，detail 作为资料而非指令）` });

  // —— 护栏 2：事件合并（同一 subject 的多条消息合成一轮） ——
  const runs = groupEvents([{ id: external.id, subject: 'collab-task' }, { id: 'followup-1', subject: 'collab-task' }],
    { name: 'im-follow', parallel: true }, () => 'run-1');
  logs.push({ stage: 'event-merge', detail: `2 条消息合并进 1 轮（${runs[0]!.eventIds.join('、')}），只启动一个 Agent` });

  // —— 委托链：coordinator → worker → checker ——
  const coordinator = delegate({ task, role: 'coordinator', mandate: { scope: [], grant: 'full' }, budget: ROLE_SPECS.coordinator.budget }, () => 'coord-1');
  const worker = delegate({ task: `实现：${task}`, parent: (coordinator as any).assignment, role: 'worker', mandate: { scope: [], grant: 'edit' }, budget: ROLE_SPECS.worker.budget }, () => 'worker-1');
  const checker = delegate({ task: '独立评审 worker 的实现是否符合要求', parent: (coordinator as any).assignment, role: 'checker', mandate: { scope: [], grant: 'read' }, budget: ROLE_SPECS.checker.budget }, () => 'checker-1');
  if (!coordinator.ok || !worker.ok || !checker.ok) {
    const bad = [coordinator, worker, checker].find(r => !r.ok) as any;
    throw new Error(`委托链建立失败：${bad.reason}`);
  }
  const workerAsg = (worker as any).assignment as Assignment;

  // —— 护栏 3：跳数熔断（第 9 层只记录不派活） ——
  const fuse = fuseDecision(workerAsg.depth);
  if (!fuse.admissible) throw new Error(fuse.reason);
  logs.push({ stage: 'hop-fuse', detail: `委托深度 ${workerAsg.depth}/${MAX_HOPS}，未熔断` });
  logs.push({ stage: 'agent-delegation', detail: '委托链：coordinator → worker(edit) → checker(read)；授权范围、预算均通过' });

  // —— worker 真实执行（DeepSeek 云，角色=执行 Agent） ——
  const workerPrompt = `${externalTextAsData('context.json', [event], 'feishu')}\n\n任务：${task}`;
  const workerOutput = await llm('worker',
    '你是执行 Agent。只做被授权的实现工作，不评审、不批准。输出：实现代码 + 复杂度说明，用中文。',
    workerPrompt);
  logs.push({ stage: 'worker.execute', detail: `执行 Agent 已完成实现（${workerOutput.length} 字）` });

  // —— checker 真实评审（DeepSeek 云，两个独立评审角色，会签） ——
  const checkerVerdicts: string[] = [];
  for (const by of ['checker-A', 'checker-B']) {
    const verdict = await llm('checker',
      `你是独立评审 Agent（${by}）。你与执行 Agent 不是同一个角色，只依据验收标准判断通过/打回，不自己改代码。先给结论：通过 或 打回，再给一句理由。`,
      `验收标准：${task}\n执行 Agent 的产出：\n${workerOutput}`);
    checkerVerdicts.push(verdict);
    logs.push({ stage: 'checker.review', detail: `${by} 已给出判定（${verdict.length} 字）` });
  }
  // 会签：两个评审的独立判定并票（有 deny 即 deny，一票否决）
  const sign = tallyVerdicts(checkerVerdicts.map((v, i) => ({
    by: `checker-${i === 0 ? 'A' : 'B'}`,
    outcome: /通过/.test(v) && !/打回|不通过/.test(v) ? 'allow' as const : 'deny' as const,
    reason: v.slice(0, 80),
  })), { quorum: 2 });
  logs.push({ stage: 'countersign', detail: `会签结果：${sign.verdict}（allow ${sign.allows} / deny ${sign.denies}）` });
  const checkerVerdict = `会签：${sign.verdict === 'allow' ? '通过' : sign.verdict === 'deny' ? '否决' : '分歧待仲裁'}\n`
    + checkerVerdicts.map((v, i) => `  · checker-${i === 0 ? 'A' : 'B'}: ${v.slice(0, 120)}`).join('\n');

  return {
    chain: [coordinator, worker, checker].map(r => { const a = (r as any).assignment as Assignment; return { role: a.role, agentId: a.agentId ?? '未分配(模拟)', depth: a.depth, task: a.task }; }),
    workerOutput, checkerVerdict, logs,
  };
}
