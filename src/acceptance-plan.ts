// Acceptance criteria are sealed BEFORE work starts. Paperclip's native document
// revisions make any edit create a new version; the content hash and the recorded
// revision let the gate detect that the original criteria were replaced.
import { createHash } from 'node:crypto';
import type { EvidenceKind } from './event-stream.ts';

export type VerificationLevel = 'L1' | 'L2' | 'L3' | 'L4';

export interface AcceptanceItem {
  id: string;
  name: string;
  criteria: string;
  required: boolean;
  evidenceKind: EvidenceKind;
}

export interface ReviewerSpec {
  model: string;
  differsFromProducer: boolean;
  requiresVision: boolean;
}

export interface AcceptancePlan {
  schemaVersion: 1;
  taskId: string;
  lockedAt: string;
  lockedBy: string;
  level: VerificationLevel;
  items: AcceptanceItem[];
  reviewer: ReviewerSpec;
  producerModel?: string;
  hash: string;
}

export interface PlanDocumentStore {
  get<T = any>(route: string): Promise<T>;
  document(issueId: string, key: string, title: string, body: string): Promise<any>;
}

function canonical(plan: Omit<AcceptancePlan, 'hash'>): string {
  return JSON.stringify({
    schemaVersion: plan.schemaVersion,
    taskId: plan.taskId,
    lockedAt: plan.lockedAt,
    lockedBy: plan.lockedBy,
    level: plan.level,
    items: plan.items,
    reviewer: plan.reviewer,
    producerModel: plan.producerModel ?? null,
  });
}

export function planHash(plan: AcceptancePlan | Omit<AcceptancePlan, 'hash'>): string {
  return createHash('sha256').update(canonical(plan as Omit<AcceptancePlan, 'hash'>)).digest('hex');
}

export function createPlan(input: {
  taskId: string;
  names: string[];
  lockedBy: string;
  level?: VerificationLevel;
  producerModel?: string;
  reviewerModel?: string;
  criteria?: Record<string, string>;
  evidenceKind?: EvidenceKind;
  lockedAt?: string;
}): AcceptancePlan {
  const names = [...new Set(input.names.map(name => String(name).trim()).filter(Boolean))].slice(0, 12);
  if (!names.length) throw new Error('验收清单不能为空');
  const reviewerModel = input.reviewerModel ?? 'independent-reviewer';
  const producerModel = input.producerModel ?? '';
  if (producerModel && reviewerModel === producerModel) throw new Error('评审者不得与产出模型相同');
  const base: Omit<AcceptancePlan, 'hash'> = {
    schemaVersion: 1,
    taskId: input.taskId,
    lockedAt: input.lockedAt ?? new Date().toISOString(),
    lockedBy: input.lockedBy,
    level: input.level ?? 'L3',
    items: names.map((name, index) => {
      const id = `item-${index + 1}`;
      return {
        id,
        name,
        criteria: input.criteria?.[name] ?? `按开工前约定的标准逐项核可：${name}`,
        required: true,
        evidenceKind: input.evidenceKind ?? 'captured',
      };
    }),
    reviewer: { model: reviewerModel, differsFromProducer: true, requiresVision: true },
    ...(producerModel ? { producerModel } : {}),
  };
  return { ...base, hash: planHash(base) };
}

export function verifyPlan(plan: AcceptancePlan): void {
  if (!plan || plan.schemaVersion !== 1) throw new Error('验收清单格式无效');
  if (!plan.taskId || !plan.lockedAt || !plan.lockedBy) throw new Error('验收清单缺少任务、锁定时间或锁定人');
  if (Number.isNaN(Date.parse(plan.lockedAt))) throw new Error('验收清单锁定时间无效');
  if (!plan.items.length) throw new Error('验收清单不能为空');
  if (new Set(plan.items.map(item => item.id)).size !== plan.items.length) throw new Error('验收项 ID 重复');
  if (!plan.reviewer?.differsFromProducer || !plan.reviewer.requiresVision) throw new Error('评审者必须独立于产出模型且支持视觉输入');
  if (plan.producerModel && plan.reviewer.model === plan.producerModel) throw new Error('评审者不得与产出模型相同');
  if (planHash(plan) !== plan.hash) throw new Error('验收清单已被修改，原计划作废');
}

export function encodePlan(plan: AcceptancePlan): string {
  return `# 开工前验收清单\n\n锁定时间：${plan.lockedAt}\n锁定人：${plan.lockedBy}\n验证等级：${plan.level}\n\n` +
    `本清单在开工前锁定，任何修改都会产生新的原生文档修订并使本轮验收作废。\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\``;
}

export function decodePlan(body: string): AcceptancePlan | null {
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(String(body ?? ''));
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!);
    return parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.items) && typeof parsed.hash === 'string'
      ? parsed as AcceptancePlan : null;
  } catch { return null; }
}

export async function lockPlan(pc: PlanDocumentStore, plan: AcceptancePlan): Promise<string | null> {
  verifyPlan(plan);
  await pc.document(plan.taskId, 'acceptance-plan', '开工前验收清单', encodePlan(plan));
  const loaded = await readPlan(pc, plan.taskId);
  return loaded?.revision ?? null;
}

export async function readPlan(pc: PlanDocumentStore, taskId: string): Promise<{ plan: AcceptancePlan; revision: string } | null> {
  let doc: any;
  try { doc = await pc.get(`/issues/${taskId}/documents/acceptance-plan`); }
  catch (error) { if (String(error).includes(': 404 ')) return null; throw error; }
  const plan = decodePlan(String(doc?.body ?? ''));
  if (!plan) return null;
  return { plan, revision: String(doc?.latestRevisionId ?? doc?.currentRevisionId ?? '') };
}

/** Derive the plan from the business acceptance lines already stored in task.context. */
export function planForTask(task: { id: string; context: string }, lockedBy: string, opts: {
  level?: VerificationLevel; producerModel?: string; reviewerModel?: string;
} = {}): AcceptancePlan {
  let names: string[] = [];
  try {
    const context = JSON.parse(task.context);
    if (Array.isArray(context.businessAcceptance)) names = context.businessAcceptance.map(String);
  } catch { /* fall through to the default single item */ }
  return createPlan({
    taskId: task.id,
    names: names.length ? names : ['符合任务要求'],
    lockedBy,
    ...opts,
  });
}
