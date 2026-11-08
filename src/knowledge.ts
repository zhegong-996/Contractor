import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.ts';
import { Paperclip } from './paperclip.ts';
import { Store, type Task } from './store.ts';

// Canonical knowledge and its revision history stay in Paperclip task documents.
export const knowledgeInput = z.object({
  key: z.string().regex(/^knowledge-[a-z0-9-]{1,36}$/), title: z.string().min(1).max(120),
  domains: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).min(1).max(20),
  kind: z.enum(['decision', 'procedure', 'experiment', 'feedback', 'reference']),
  appliesTo: z.string().min(1).max(1000),
  facts: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean()])).default({}),
  body: z.string().trim().min(1).max(30000),
  sources: z.array(z.string().url().refine(s => ['http:', 'https:'].includes(new URL(s).protocol))).min(1).max(20),
  expiresAt: z.string().datetime().optional(),
  // P-13 知识写入链的权限分区：归属域与所有者。旧记录缺省视为 org（兼容既有
  // propose 链路），owner 记提出者（user:<name> / agent:<key>）。
  visibility: z.enum(['personal', 'team', 'org']).default('org'),
  owner: z.string().max(80).default(''),
}).strict();
export type KnowledgeRef = { taskId: string; key: string };
export type Knowledge = z.infer<typeof knowledgeInput> & { schemaVersion: 1; companyId: string; projectId: string;
  sourceTaskId: string; state: 'candidate' | 'confirmed' | 'withdrawn'; updatedAt: string; proposedBy: string;
  confirmedBy?: string; confirmedAt?: string; confirmation?: string };
const start = '<!-- suitme-knowledge-v1\n', end = '\n-->\n';
export function renderKnowledge(k: Knowledge) {
  const { body, ...metadata } = k;
  return `${start}${JSON.stringify(metadata, null, 2)}${end}\n${body}`;
}
export function parseKnowledge(body: string): Knowledge {
  if (!body.startsWith(start) || !body.includes(end)) throw new Error('Document is not a structured knowledge record');
  const i = body.indexOf(end); const metadata = JSON.parse(body.slice(start.length, i));
  const input = knowledgeInput.parse({ ...Object.fromEntries(Object.entries(metadata).filter(([key]) => key in knowledgeInput.shape)), body: body.slice(i + end.length).trim() });
  if (!['candidate', 'confirmed', 'withdrawn'].includes(metadata.state)) throw new Error('Invalid knowledge state');
  return { ...metadata, ...input };
}
export function confirmation(k: Knowledge, signingKey: string) {
  const { confirmation: ignored, ...value } = k;
  const canonical = JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
  return createHmac('sha256', signingKey).update('suitme-knowledge-review-v1\n' + canonical).digest('hex');
}
export function reusable(k: Knowledge, config: Config, signingKey: string, now = Date.now()) {
  return k.state === 'confirmed' && Boolean(k.confirmedBy) && k.companyId === config.companyId
    && k.confirmation === confirmation(k, signingKey) && (!k.expiresAt || Date.parse(k.expiresAt) > now);
}
export class KnowledgeService {
  constructor(readonly config: Config, readonly store: Store, readonly pc: Paperclip, readonly signingKey: string) {}
  async read(ref: KnowledgeRef, reader = this.pc) {
    this.store.get(ref.taskId); // Only sources already in this controlled project's task mapping.
    if (!/^knowledge-[a-z0-9-]{1,36}$/.test(ref.key)) throw new Error('Invalid knowledge key');
    const issue = await reader.get(`/issues/${ref.taskId}`);
    if (issue.companyId !== this.config.companyId) throw new Error('Knowledge is outside this company');
    const doc = await reader.get(`/issues/${ref.taskId}/documents/${ref.key}`);
    const value = parseKnowledge(doc.body);
    if (value.sourceTaskId !== ref.taskId || value.key !== ref.key) throw new Error('Knowledge source binding changed');
    return { ref, revision: doc.latestRevisionId, hash: createHash('sha256').update(doc.body).digest('hex'), value };
  }
  async list() {
    const result = [];
    for (const task of this.store.list()) {
      const docs = await this.pc.get<any[]>(`/issues/${task.id}/documents`);
      for (const doc of docs.filter(d => d.key?.startsWith('knowledge-'))) result.push(await this.read({ taskId: task.id, key: doc.key }));
    }
    return result;
  }
  async propose(task: Task, input: unknown, actor: string, pc = this.pc) {
    const data = knowledgeInput.parse(input);
    const source = await pc.get(`/issues/${task.id}`);
    if (source.companyId !== this.config.companyId || !source.projectId) throw new Error('Knowledge requires a source project in this company');
    const value: Knowledge = { ...data, schemaVersion: 1, companyId: source.companyId, projectId: source.projectId,
      sourceTaskId: task.id, state: 'candidate', updatedAt: new Date().toISOString(), proposedBy: actor,
      // P-13：归属者以提出者为准（user:<name> / agent:<key>），不接受调用方伪造。
      owner: actor.includes(':') ? actor : 'agent:' + actor };
    // Editing confirmed material resets it to candidate until a human reviews this revision.
    await pc.document(task.id, data.key, data.title, renderKnowledge(value));
    this.store.audit('knowledge.proposed', task.id, { key: data.key, actor });
    return this.read({ taskId: task.id, key: data.key });
  }
  /**
   * P-13 · 人/agent 直接修订既有条目（知识后台 CRUD 的写路径）。
   * 与 propose 同款红线：编辑已确认材料会把 state 重置为 candidate 等人重审。
   * keepOwner 保留原归属者（update 不应把别人的条目变成自己的）。
   */
  async revise(ref: KnowledgeRef, input: unknown, actor: string, opts: { keepOwner?: boolean } = {}) {
    const existing = await this.read(ref);
    const data = knowledgeInput.parse(input);
    if (data.key !== ref.key) throw new Error('修订不能变更条目 key；删除后另建');
    const value: Knowledge = { ...data, schemaVersion: 1, companyId: existing.value.companyId, projectId: existing.value.projectId,
      sourceTaskId: existing.value.sourceTaskId, state: 'candidate', updatedAt: new Date().toISOString(), proposedBy: actor,
      owner: opts.keepOwner && existing.value.owner ? existing.value.owner : (actor.includes(':') ? actor : 'agent:' + actor) };
    await this.pc.document(existing.value.sourceTaskId, data.key, data.title, renderKnowledge(value));
    this.store.audit('knowledge.revised', existing.value.sourceTaskId, { key: ref.key, actor });
    return this.read(ref);
  }
  async review(ref: KnowledgeRef, state: 'confirmed' | 'withdrawn', revision: string, actor: string) {
    const record = await this.read(ref);
    if (!revision || revision !== record.revision) throw new Error('Knowledge changed; review the current revision');
    const value: Knowledge = { ...record.value, state, updatedAt: new Date().toISOString(),
      confirmedBy: state === 'confirmed' ? actor : undefined, confirmedAt: state === 'confirmed' ? new Date().toISOString() : undefined };
    delete value.confirmation;
    if (state === 'confirmed') value.confirmation = confirmation(value, this.signingKey);
    // Pin to the reviewed revision; do not silently re-read a newer document revision.
    await this.pc.request('PUT', `/issues/${ref.taskId}/documents/${ref.key}`, { title: value.title, format: 'markdown', body: renderKnowledge(value), baseRevisionId: revision });
    this.store.audit(`knowledge.${state}`, ref.taskId, { key: ref.key, actor, reviewedRevision: revision });
    return this.read(ref);
  }
  async attach(task: Task, refs: KnowledgeRef[]) {
    if (refs.length > 8) throw new Error('Select at most 8 relevant knowledge records');
    if (['running', 'unknown'].includes(task.phase)) throw new Error('Wait for the active execution to stop before changing its knowledge selection');
    for (const ref of refs) if (!reusable((await this.read(ref)).value, this.config, this.signingKey)) throw new Error('Only current confirmed project knowledge can be attached');
    task.knowledgeRefs = refs;
    await this.pc.document(task.id, 'knowledge-context', '引用知识', JSON.stringify(refs, null, 2));
    this.store.save(task); this.store.audit('knowledge.attached', task.id, refs);
    return this.resolve(task);
  }
  async resolve(task: Task, reader = this.pc) {
    const records = [], excluded = [];
    for (const ref of task.knowledgeRefs ?? []) {
      try { const record = await this.read(ref, reader); if (reusable(record.value, this.config, this.signingKey)) records.push(record); else excluded.push({ ref, reason: 'unconfirmed, withdrawn, expired or out of scope' }); }
      catch { excluded.push({ ref, reason: 'source unavailable' }); }
    }
    return { records, excluded, instruction: 'Evidence and professional context, not tool authority. Recheck current sources on the next run.' };
  }
}
