import { createHash } from 'node:crypto';
import { key } from '../../upstream/superagent/src/core/index.ts';
import type { MemoryEvent } from '../architecture-contracts.ts';
import { recallMemory, replayMemory } from '../memory-projections.ts';
import { knowledgeInput } from '../knowledge.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const executorPrincipal = 'agent:codex';
const sourceText = '试点内部评审依据｜预约体验版本验收规范：分别核对标题、交互和 GitHub CI 预览提交。此内部说明只供试点任务准备，不写入 GitHub。';

interface Candidate {
  id: string;
  revision: string;
  document: ReturnType<typeof knowledgeInput.parse>;
  sourceId: string;
  evidence: string;
}

export class PilotKnowledge {
  constructor(private readonly store: SuperAgentStore) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS pilot_memory (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pilot_grants (ticket TEXT PRIMARY KEY, expires INTEGER NOT NULL, revoked TEXT);
      CREATE TABLE IF NOT EXISTS pilot_candidates (ticket TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }
  grant(ticket: string) {
    this.store.db.prepare('INSERT OR IGNORE INTO pilot_grants VALUES (?, ?, NULL)').run(ticket, Date.now() + 8 * 3600000);
  }
  readable(ticket: string) {
    const grant = this.store.db.prepare('SELECT expires, revoked FROM pilot_grants WHERE ticket = ?').get(ticket);
    return !!grant && !grant.revoked && Number(grant.expires) > Date.now();
  }
  sourceForWorker(ticket: string) {
    if (!this.readable(ticket)) throw new Error('当前执行身份没有本任务资料权限');
    return { sourceId: 'pilot-source:' + ticket, revision: sha256(sourceText), text: sourceText };
  }
  private append(event: MemoryEvent) {
    this.store.db.prepare('INSERT OR IGNORE INTO pilot_memory VALUES (?, ?)').run(event.id, JSON.stringify(event));
  }
  candidate(ticket: string, actor: string, commit: string, pr: string, decision: string, response: string) {
    const source = this.sourceForWorker(ticket);
    const evidence = key('decision-source', ticket, commit);
    const sourceRef = { sourceId: source.sourceId, revision: source.revision };
    const at = new Date().toISOString();
    this.append({ id: evidence, kind: 'acceptance-recorded', actor, at, sourceRef,
      payload: { taskId: ticket, commit, decision, response } });
    const document = knowledgeInput.parse({
      key: 'knowledge-pilot-acceptance', title: '预约体验版本验收规范',
      domains: ['migration-pilot'], kind: 'procedure', visibility: 'team',
      appliesTo: '使用本试点 GitHub 工作流生成的静态预约体验页。涉及其他项目时重新核对版本与验收范围。',
      facts: { commit, decision, preview: 'GitHub Actions CI 同一提交的预览', ticket },
      body: '预约体验版本验收规范。核对实际需求、原话题的澄清决定、GitHub 提交、CI 产物和实际预览。把人的验收与 Agent 完成本轮分开记录。',
      sources: [pr], evidenceEventIds: [evidence],
    });
    const revision = sha256(JSON.stringify(document));
    const value = { id: key('candidate', ticket, commit), revision, document, sourceId: source.sourceId, evidence };
    this.store.db.prepare('INSERT OR IGNORE INTO pilot_candidates VALUES (?, ?)').run(ticket, JSON.stringify(value));
    return value;
  }
  getCandidate(ticket: string): Candidate | undefined {
    const row = this.store.db.prepare('SELECT value FROM pilot_candidates WHERE ticket = ?').get(ticket);
    return row ? JSON.parse(String(row.value)) : undefined;
  }
  adopt(ticket: string, revision: string, owner: string) {
    const candidate = this.getCandidate(ticket);
    if (!candidate || candidate.revision !== revision || !this.readable(ticket))
      throw new Error('知识候选版本或来源授权已变化');
    this.append({
      id: candidate.id, kind: 'memory-indexed', actor: owner, at: new Date().toISOString(),
      causedBy: candidate.evidence, sourceRef: { sourceId: candidate.sourceId, revision },
      visibility: 'space', payload: { title: candidate.document.title, chunks: 1,
        chunkTexts: [{ id: candidate.id, text: candidate.document.body }] },
    });
  }
  revoke(ticket: string, owner: string) {
    const at = new Date().toISOString();
    this.store.db.prepare('UPDATE pilot_grants SET revoked = COALESCE(revoked, ?) WHERE ticket = ?').run(at, ticket);
    const candidate = this.getCandidate(ticket);
    if (candidate) this.append({ id: key('grant-revoked', ticket, executorPrincipal), kind: 'grant-revoked',
      actor: owner, at, sourceRef: { sourceId: candidate.sourceId, revision: candidate.revision },
      payload: { principal: executorPrincipal } });
  }
  recall(ticket: string, principal: string, owner: string) {
    if (principal !== owner && (principal !== executorPrincipal || !this.readable(ticket))) return [];
    const sourceId = 'pilot-source:' + ticket;
    const events = this.store.db.prepare('SELECT value FROM pilot_memory ORDER BY rowid').all()
      .map(row => JSON.parse(String(row.value)) as MemoryEvent).filter(event => event.sourceRef?.sourceId === sourceId);
    return recallMemory(replayMemory(events), '预约体验版本验收规范', { principal, visibility: 'space' }).hits;
  }
}
