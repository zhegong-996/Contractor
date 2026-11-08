import {taskOnlyContext} from './agent-definition.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { Workspaces, WorkspaceActor } from './workspaces.ts';
import type { Task } from './store.ts';
import { reusable } from './knowledge.ts';
import { secrets } from './config.ts';
import { readInjectedIndex } from './knowledge-representation.ts';
import { primeQueryTerms, primeDigestQueryTerms } from './vendor/prime-query.ts';
import { TextRetainer, ItemRetainer } from '../upstream/deepseek-harness/packages/util/output-retention/src/index.ts';
export const contextHash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export type InputRef = { kind: 'goal' | 'knowledge' | 'checkpoint' | 'note' | 'delivery' | 'conversation' | 'service'; id: string; key?: string; revision: string; hash: string };
const ignored = new Set(['联调','整理','方案','资料','目标','任务','知识','授权','交接','验收','流程','测试','岗位','候选','准备','需要','专业','数据','当前','仅供','仅用','以及','并且','其中','可以','结果']);
export function contextTerms(text: string) {
  return primeQueryTerms(text).filter(w => !ignored.has(w)).slice(0, 160);
}
export function relevance(query: string, text: string) { const lower = text.toLowerCase(); return contextTerms(query).reduce((n, term) => n + (lower.includes(term) ? 1 : 0), 0); }
export function selectPassage(body: string, query: string, maxBytes: number) {
  const retain = (text: string) => { const r = new TextRetainer({ kind: 'head', maxBytes }); r.push(text); return r.finish().text; };
  const totalBytes = Buffer.byteLength(body), terms = contextTerms(query); let start = 0, text = retain(body), best = -1;
  if (totalBytes > maxBytes && maxBytes > 0) for (let offset = 0; offset < body.length; offset += Math.max(1, Math.floor(maxBytes / 6))) {
    if (/[\uDC00-\uDFFF]/.test(body[offset] ?? '')) continue;
    const piece = retain(body.slice(offset)), lower = piece.toLowerCase(), score = terms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
    if (score > best) { best = score; start = offset; text = piece; }
  }
  return { body: text, range: { start, end: start + text.length }, includedChars: text.length, totalChars: body.length,
    includedBytes: Buffer.byteLength(text), totalBytes, truncated: text.length < body.length };
}
export function retainFacts(facts: Record<string, unknown>, maxBytes: number) {
  const items = new ItemRetainer<[string, unknown]>({ kind: 'head', maxItems: 16 }); for (const item of Object.entries(facts)) items.push(item);
  const selected = items.finish(), result: Record<string, unknown> = {}; let truncated = selected.truncated;
  for (const [key, value] of selected.items) {
    const room = maxBytes - Buffer.byteLength(JSON.stringify(result)) - Buffer.byteLength(key) - 8;
    if (room <= 0 || key.length > 200) { truncated = true; continue; }
    let kept = value;
    if (typeof value === 'string') { const r = new TextRetainer({ kind: 'head', maxBytes: Math.min(1000, room) }); r.push(value); const v = r.finish(); kept = v.text; truncated ||= v.truncated; }
    if (Buffer.byteLength(JSON.stringify({ ...result, [key]: kept })) > maxBytes) { truncated = true; continue; }
    result[key] = kept;
  }
  return { facts: result, truncated };
}
export function deliveryEvidence(task: Task, issue: any) {
  return { title: issue.title, description: issue.description ?? '', status: task.phase, delivery: task.delivery ?? null,
    origin: task.messageId.startsWith('om_') ? 'feishu' : 'local', messageId: task.messageId.startsWith('om_') ? task.messageId : undefined };
}
export function goalEvidence(issue: any, state: any) { return { title: issue.title, goal: issue.description, service: state.context?.service, serviceRoutes: state.context?.serviceRoutes, requirements: state.context?.requirements ?? [],
  sourceIds: state.sources, knowledgeSpace: state.context?.knowledgeSpace, notes: state.snapshots.filter((s: any) => s.key === 'context-note' && !s.systemEvidence).map((s: any) => s.id), linkedTasks: state.context?.linkedTasks ?? [] }; }
export function discussionEvidence(comments: any[]) { return comments.filter(c => c.authorUserId && !c.authorAgentId).map(c => ({ id: c.id, body: c.body, createdAt: c.createdAt, updatedAt: c.updatedAt })); }
export class TaskContext {
  constructor(readonly w: Workspaces) {}
  authorize(task: Task, actor: WorkspaceActor) { if (!actor.admin && actor.agent !== task.agent) throw new Error('Unauthorized: task context'); }
  async search(task: Task, query: string) {
    const state = await this.w.state(task), matches: any[] = [], recent = [];
    for (const note of state.snapshots.filter(s => s.key === 'context-note').slice(-4).reverse()) {
      try { recent.push((await this.w.reader(task.agent).get('/issues/' + note.id + '/documents/' + note.key)).body); } catch {}
    }
    const weighted = primeDigestQueryTerms(query, recent);
    if(this.w.config?.companyId){try{const {TeamMemory}=await import('./team-memory.ts');const recalled=await new TeamMemory(this.w).search(task.id,query,{admin:false,agent:task.agent});for(const hit of recalled.hits){const s=this.w.source(hit.sourceId);if(!matches.some(m=>m.id===s.id))matches.push({id:s.id,title:s.title,domain:s.domain,revision:hit.revision,score:hit.score+6,selected:state.sources.includes(s.id),reason:'Cognee BM25 持久记忆检索；当前版本与权限已复查'});}}catch(error){this.w.store.audit?.('memory.recall-unavailable',task.id,{error:String(error).slice(0,160)});}}
    // Discovery uses the executor's original professional membership. Other departments
    // enter through an explicit task reference + normal access application, never admin RAG.
    for (const source of this.w.catalog().sources.filter(s => (!taskOnlyContext(state) || state.sources.includes(s.id)) && (s.external ? state.sources.includes(s.id) : (this.w.members?.(s.domain) ?? [this.w.catalog().spaces[s.domain].agent]).includes(task.agent)) && !state.outcomes.some(o => o.publicationId === s.id))) {
      try {
        if (source.external && !await this.w.allowed(task, source.id, task.agent, state)) continue;
        const record = this.w.readMaterial ? await this.w.readMaterial(source.id, task.agent) : await this.w.knowledge.read(source.ref, this.w.reader(task.agent));
        if (!source.external && !reusable(record.value, this.w.config, secrets().jwtSecret)) continue;
        const text = (source.title + '\n' + record.value.appliesTo + '\n' + JSON.stringify(record.value.facts) + '\n' + record.value.body).toLowerCase();
        const score = [...weighted].reduce((n, [term, weight]) => n + (!ignored.has(term) && text.includes(term) ? weight : 0), 0);
        if (score >= 6 && !matches.some(m=>m.id===source.id)) matches.push({ id: source.id, title: source.title, domain: source.domain, revision: record.revision, score, selected: state.sources.includes(source.id), reason: '按当前目标及近期背景匹配，执行岗位已有读取权限' });
      } catch {}
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, 5);
  }
  async enrich(taskId: string, actor: WorkspaceActor, automatic = false) {
    const task = this.w.store.get(taskId); this.authorize(task, actor); const state = await this.w.state(task);
    if (['accepted', 'running', 'unknown', 'handoff_pending'].includes(task.phase)) return { added: [], matches: [] };
    if (automatic && !state.context?.autoDiscover) return { added: [], matches: [] };
    const issue = await this.w.issue(task.id), matches = await this.search(task, issue.title + '\n' + issue.description + '\n' + (state.delegation?.instruction ?? ''));
    const added = matches.filter(m => !m.selected && !state.context?.excludedSources?.includes(m.id)).slice(0, Math.min(3, 8 - state.sources.length)).map(m => m.id);
    if (added.length) { state.sources=[...new Set([...state.sources,...added])]; await this.w.save(task, state, 'context-discovered', { sourceIds: added, scope: task.agent, automatic }); }
    return { added, matches };
  }
  async collect(task: Task, omitReceipt?: string) {
    const state = await this.w.state(task), issue = await this.w.issue(task.id), query = issue.title + '\n' + issue.description + '\n' + (state.delegation?.instruction ?? '');
    const sources: any[] = [], missing: any[] = [], manifest: InputRef[] = [], checkpoints: any[] = [], excludedCheckpoints: any[] = [];
    const goalHash = contextHash(goalEvidence(issue, state)); manifest.push({ kind: 'goal', id: task.id, revision: goalHash, hash: goalHash });
    let budget = 192000;
    for (const id of state.sources) {
      const source = this.w.source(id), status = await this.w.sourceStatus(task, id, task.agent, state);
      if (!status.allowed) { missing.push({ id, title: source.title, domain: source.domain, reason: status.reason }); continue; }
      const record = this.w.readMaterial ? await this.w.readMaterial(id, task.agent) : await this.w.knowledge.read(source.ref, this.w.reader(task.agent));
      // Revalidate the actual record sent to the model, not the record read by sourceStatus.
      if (!source.external && !reusable(record.value, this.w.config, secrets().jwtSecret)) { missing.push({ id, title: source.title, domain: source.domain, reason: 'version' }); continue; }
      const passage = selectPassage(record.value.body, query, Math.min(state.context?.fullSources?.includes(id) ? 120000 : 9000, Math.max(0, budget)));
      budget -= passage.includedBytes;
      const facts = retainFacts(record.value.facts, Math.min(12000, Math.max(0, budget))); budget -= Buffer.byteLength(JSON.stringify(facts.facts));
      sources.push({ id, kind: 'knowledge', title: source.title, domain: source.domain, revision: record.revision, hash: record.hash,
        appliesTo: record.value.appliesTo, facts: facts.facts, factsTruncated: facts.truncated, external: source.external ? { provider: 'feishu', kind: source.external.kind, url: source.external.url, details: record.details } : undefined,
        ...passage, selectionReason: passage.truncated ? '按任务目标选取相关片段；其余内容未载入本轮' : source.external ? '飞书当前可读原文；历史讨论不等于当前决定' : '当前已确认版本的完整正文' });
      manifest.push({ kind: 'knowledge', id, revision: record.revision, hash: record.hash });
    }
    const validated=new Set<string>();
    for (const snap of state.snapshots.filter(s => !omitReceipt || s.receiptId !== omitReceipt)) {
      if (snap.sources.some(id => !state.sources.includes(id) || missing.some(m => m.id === id))) continue;
      try {
        if (snap.inputManifest && this.w.assertManifest) {
          try { await this.w.assertManifest(task, snap.inputManifest,new Set(),validated); }
          catch { excludedCheckpoints.push({ id: snap.id, title: snap.title, reason: '生成所用来源已变化；保留审计，不作为当前输入' }); continue; }
        }
        const doc = await this.w.reader(task.agent).get('/issues/' + snap.id + '/documents/' + snap.key), kind = snap.key === 'context-note' ? 'note' : 'checkpoint';
        const passage = selectPassage(doc.body, query, Math.min(state.context?.fullSources?.includes(snap.id) ? 80000 : kind === 'note' ? 12000 : 9000, Math.max(0, budget))); budget -= passage.includedBytes;
        const ref = { kind, id: snap.id, key: snap.key, revision: doc.latestRevisionId, hash: contextHash(doc.body) } as InputRef; manifest.push(ref);
        if (kind === 'note') sources.push({ ...ref, title: snap.title, ...passage, selectionReason: snap.systemEvidence ? '后台实时核对的执行事实；不作为人的需求变更或最终验收' : '用户明确补充到本任务的背景与约束' });
        else checkpoints.push({ ...ref, title: snap.title, contextState: snap.inputManifest ? 'current' : 'legacy', ...passage, selectionReason: '本任务已有工作记录，含机器工作稿和人工修订；旧记录须重新核对' });
      } catch { missing.push({ id: snap.id, title: snap.title, reason: 'unavailable' }); }
    }
    for (const id of state.context?.linkedTasks ?? []) {
      try {
        const linked = this.w.store.get(id), native = await this.w.reader(task.agent).get('/issues/' + linked.id);
        if (native.companyId !== this.w.config.companyId) throw new Error('Unauthorized');
        const value = deliveryEvidence(linked, native), fingerprint = contextHash(value), body = JSON.stringify(value, null, 2), passage = selectPassage(body, query, Math.min(18000, Math.max(0, budget))); budget -= passage.includedBytes;
        sources.push({ id, kind: 'delivery', title: linked.identifier + ' · ' + native.title, revision: fingerprint, hash: fingerprint, ...passage,
          delivery: value.delivery, taskStatus: value.status, origin: value.origin,
          selectionReason: '关联研发任务的真实需求、飞书来源标识、GitHub交付、CI和验收状态；状态分别记录' });
        manifest.push({ kind: 'delivery', id, revision: fingerprint, hash: fingerprint });
      } catch { missing.push({ id, title: '关联任务', reason: 'unavailable' }); }
    }
    for (const id of [task.id, ...(state.context?.linkedTasks ?? [])]) {
      try {
        const comments = await this.w.reader(task.agent).get('/issues/' + id + '/comments');
        if (!Array.isArray(comments)) continue;
        const value = discussionEvidence(comments); if (!value.length) continue;
        const take = state.context?.fullSources.includes('conversation:' + id) ? 80 : 20;
        const fingerprint = contextHash(value), text = value.slice(-take).map(c => `${c.createdAt} · 成员补充或系统回写\n${c.body}`).join('\n\n');
        const passage = selectPassage(text, query, Math.min(18000, Math.max(0, budget))); budget -= passage.includedBytes;
        sources.push({ id: 'conversation:' + id, nativeIssueId: id, kind: 'conversation', title: '任务讨论补充', revision: fingerprint, hash: fingerprint,
          ...passage, totalMessages: value.length, includedMessages: Math.min(take, value.length), truncatedMessages: value.length > take,
          selectionReason: '该任务中原生接口已返回的成员补充和系统回写；机器回复不作为新的人工决定' });
        manifest.push({ kind: 'conversation', id, revision: fingerprint, hash: fingerprint });
      } catch { missing.push({ id: 'conversation:' + id, title: '任务讨论补充', reason: 'unavailable' }); }
    }
    const requests = [];
    for (const id of state.requests) { const r = await this.w.access(id); if (r.agent === task.agent) requests.push({ id: r.id, sourceId: r.sourceId, state: r.state, expiresAt: r.expiresAt }); }
    const decisions = state.history.filter(h => ['handoff', 'knowledge-published', 'knowledge-withdrawn', 'context-discovered', 'context-note', 'context-linked'].includes(h.event)).slice(-20);
    // 13a ③：注入索引与 Context Pack 的分工。索引是持久小指针层（≤25KB，
    // 只收人审批准提升的已确认知识标题），本 Pack 只携带指针不携带索引正文，
    // 不挤占 192KB 预算；投影文件缺失 / 损坏不影响任务执行（索引可重建）。
    let injectedIndex;
    try {
      const stored = readInjectedIndex();
      if (stored && stored.entries.length) injectedIndex = { entries: stored.entries, lines: stored.lines, bytes: stored.bytes,
        selectionReason: '组织级已确认知识的索引指针（人审批准提升）；正文按任务需要经知识引用加载，不在本 Pack 内展开' };
    } catch { /* 投影缺失不阻断任务输入组装 */ }
    const layers = { goal: { title: issue.title, goal: issue.description, requirements: state.context?.requirements ?? [], origin: task.messageId.startsWith('om_') ? 'feishu' : 'workbench' },
      sources, checkpoints, excludedCheckpoints, decisions, missing, requests, injectedIndex };
    return { layers, manifest, coverage: { includedChars: sources.reduce((n, s) => n + s.includedChars, 0) + checkpoints.reduce((n, s) => n + s.includedChars, 0),
      partialSources: [...sources, ...checkpoints].filter(s => s.truncated || s.truncatedMessages || s.factsTruncated).length, missingCount: missing.length, limitBytes: 192000 } };
  }
  async inspect(taskId: string, actor: WorkspaceActor) {
    const task = this.w.store.get(taskId); this.authorize(task, actor);
    const current = await this.collect(task), state = await this.w.state(task), availableDeliveries = [];
    for (const other of this.w.store.list().filter(t => !['knowledge', 'collaboration'].includes(t.kind ?? '') && t.delivery)) {
      try { const issue = await this.w.reader(task.agent).get('/issues/' + other.id); if (issue.companyId === this.w.config.companyId) availableDeliveries.push({ id: other.id, identifier: other.identifier, title: issue.title, delivery: other.delivery, linked: state.context?.linkedTasks.includes(other.id) }); } catch {}
    }
    return { ...current, matches: await this.search(task, current.layers.goal.title + '\n' + current.layers.goal.goal), availableDeliveries,
      autoDiscover: state.context?.autoDiscover ?? false, fullSources: state.context?.fullSources ?? [] };
  }
  async note(taskId: string, text: string, actor: WorkspaceActor) {
    this.w.manager(actor); const task = this.w.store.get(taskId), state = await this.w.state(task);
    if (task.phase === 'accepted' || !text.trim() || text.length > 20000) throw new Error('请在进行中的任务补充有效背景（最多两万字符）');
    const receiptId = 'context-note:' + contextHash(text.trim()), prior = state.snapshots.find(s => s.receiptId === receiptId); if (prior) return prior;
    const snap = await this.w.snapshot(task, 'context-note', '背景与约束', text.trim(), [], receiptId); snap.receiptId = receiptId;
    state.snapshots.push(snap); await this.w.save(task, state, 'context-note', { id: snap.id, scope: '当前任务，可随岗位交接接续', author: 'local-operator' });
    return snap;
  }
  async link(taskId: string, linkedId: string, actor: WorkspaceActor) {
    this.w.manager(actor); const task = this.w.store.get(taskId), state = await this.w.state(task), other = this.w.store.get(linkedId);
    if (task.phase === 'accepted' || ['knowledge', 'collaboration'].includes(other.kind ?? '') || !other.delivery) throw new Error('请选择可用研发交付');
    const issue = await this.w.reader(task.agent).get('/issues/' + linkedId); if (issue.companyId !== this.w.config.companyId) throw new Error('Unauthorized');
    state.context ??= { autoDiscover: true, linkedTasks: [], requirements: [], fullSources: [] };
    if (!state.context.linkedTasks.includes(linkedId)) { if (state.context.linkedTasks.length >= 5) throw new Error('单任务最多关联五份研发交付'); state.context.linkedTasks.push(linkedId); await this.w.save(task, state, 'context-linked', { linkedId }); }
    return { linked: linkedId };
  }
  async expand(taskId: string, sourceId: string, actor: WorkspaceActor) {
    const task = this.w.store.get(taskId); this.authorize(task, actor); const state = await this.w.state(task);
    if (task.phase === 'accepted') throw new Error('任务已完成，不能扩展执行上下文');
    if (sourceId.startsWith('conversation:')) {
      const id = sourceId.slice('conversation:'.length); if (id !== task.id && !state.context?.linkedTasks.includes(id)) throw new Error('Unauthorized: task discussion');
      await this.w.reader(task.agent).get('/issues/' + id + '/comments');
    } else if (state.sources.includes(sourceId)) { if (!await this.w.allowed(task, sourceId, task.agent, state)) throw new Error('Unauthorized: context material'); }
    else { await this.readRecord(taskId, sourceId, { admin: false, agent: task.agent }); }
    state.context ??= { autoDiscover: true, linkedTasks: [], requirements: [], fullSources: [] };
    if (!state.context.fullSources.includes(sourceId)) { if (state.context.fullSources.length >= 2) throw new Error('本任务最多扩展两份长资料；可补充更具体的问题以重新检索'); state.context.fullSources.push(sourceId); await this.w.save(task, state, 'context-expanded', { sourceId }); }
    return { expanded: sourceId };
  }
  async readRecord(taskId: string, recordId: string, actor: WorkspaceActor) {
    const task = this.w.store.get(taskId); this.authorize(task, actor); const state = await this.w.state(task), record = state.snapshots.find(s => s.id === recordId);
    if (!record) throw new Error('Unauthorized: record is outside this task');
    if (!actor.admin) for (const id of record.sources) if (!state.sources.includes(id) || !await this.w.allowed(task, id, task.agent, state)) throw new Error('Unauthorized: record source access');
    const doc = await (actor.admin ? this.w.pc : this.w.reader(task.agent)).get('/issues/' + record.id + '/documents/' + record.key);
    return { id: record.id, key: record.key, title: record.title, revision: doc.latestRevisionId, hash: contextHash(doc.body), body: doc.body };
  }
  async include(taskId: string, sourceId: string, actor: WorkspaceActor) {
    this.w.manager(actor); const task = this.w.store.get(taskId), state = await this.w.state(task); this.w.source(sourceId);
    if (['accepted', 'running', 'unknown', 'handoff_pending'].includes(task.phase)) throw new Error('先核对当前任务状态，再调整参考资料');
    if (!state.sources.includes(sourceId)) { if (state.sources.length >= 8) throw new Error('单任务最多引用八份专业资料'); state.sources.push(sourceId); }
    if (state.context?.excludedSources) state.context.excludedSources = state.context.excludedSources.filter(id => id !== sourceId);
    await this.w.save(task, state, 'context-included', { sourceId, requestedBy: 'local-operator' }); return { included: sourceId };
  }
  async exclude(taskId: string, sourceId: string, actor: WorkspaceActor) {
    this.w.manager(actor); let task = this.w.store.get(taskId), state = await this.w.state(task);
    if (['accepted', 'running', 'unknown', 'handoff_pending'].includes(task.phase)) throw new Error('先核对当前任务状态，再移出参考资料');
    for (const id of state.requests) {
      const r = await this.w.access(id); if (r.sourceId !== sourceId) continue;
      if (r.state === 'pending') await this.w.decide(id, 'denied', '负责人将此资料移出任务，结束未处理申请', actor);
      else if (['approved', 'revoking'].includes(r.state)) await this.w.revoke(id, '负责人将此资料移出任务，结束本任务授权', actor);
    }
    task = this.w.store.get(taskId); state = await this.w.state(task);
    state.sources = state.sources.filter(id => id !== sourceId);
    state.context ??= { autoDiscover: true, linkedTasks: [], requirements: [], fullSources: [] };
    state.context.excludedSources = [...new Set([...(state.context.excludedSources ?? []), sourceId])];
    state.context.fullSources = state.context.fullSources.filter(id => id !== sourceId);
    if (task.phase === 'access_blocked') try { await this.w.requireSources(task, task.agent, state); task.phase = 'ready'; } catch {}
    await this.w.save(task, state, 'context-excluded', { sourceId, temporaryAccessEnded: true }); return { excluded: sourceId };
  }
}
