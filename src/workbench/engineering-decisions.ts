import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { key } from '../../upstream/superagent/src/core/index.ts';
import { WorkbenchError } from './errors.ts';

const stamp = { version: z.number().int().positive(), sha: z.string().regex(/^[a-f0-9]{40}$/).nullable() };
const message = z.string().trim().min(1).max(1600);
export const engineeringAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), direction: z.enum(['escalate', 'handover']), nonce: z.uuid(), ...stamp, text: message }).strict(),
  z.object({ action: z.literal('answer'), id: z.string().max(100), text: message }).strict(),
  z.object({ action: z.literal('received'), id: z.string().max(100), resume: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('withdraw'), id: z.string().max(100) }).strict(),
]);
type RecordRow = { id: string; ticket: string; version: number; sha: string | null; direction: 'escalate' | 'handover';
  actor: string; recipient: string; question: string; answer?: string; answeredBy?: string; answeredAt?: string;
  state: 'open' | 'answered' | 'received' | 'withdrawn'; openedAt: string };
export type EngineeringAction = z.infer<typeof engineeringAction>;
export type DecisionScope = { project: string; ticket: string; version: number; sha: string | null; active: boolean;
  lead?: string; developer?: string; requester: string; maintain: boolean; writable: boolean };

export function engineeringDecisions(db: DatabaseSync, ports: {
  notify: (project: string, ticket: string, subject: string, recipient: string, returned: boolean, direction: RecordRow['direction']) => void;
  close: (subject: string, returned: boolean) => void;
}) {
  db.exec('CREATE TABLE IF NOT EXISTS workbench_engineering_decision(id TEXT PRIMARY KEY,ticket TEXT NOT NULL,value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS engineering_ticket ON workbench_engineering_decision(ticket)');
  const list = (ticket: string): RecordRow[] => db.prepare('SELECT value FROM workbench_engineering_decision WHERE ticket=? ORDER BY rowid DESC')
    .all(ticket).map(row => JSON.parse(String(row.value)));
  const save = (r: RecordRow) => db.prepare('INSERT INTO workbench_engineering_decision VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
    .run(r.id, r.ticket, JSON.stringify(r));
  const current = (r: RecordRow, scope: Pick<DecisionScope, 'version' | 'sha'>) => r.version === scope.version && r.sha === scope.sha;
  const open = (r: RecordRow) => r.state === 'open' || r.state === 'answered';
  // A registered replacement takes over when project responsibility changes.
  const recipient = (r: RecordRow, s: DecisionScope) => r.direction === 'escalate' ? s.lead : s.developer;
  const mayOpen = (actor: string, s: DecisionScope) => s.active && s.writable && (actor === s.developer || actor === s.requester || s.maintain);
  function view(actor: string, s: DecisionScope) {
    const rows = list(s.ticket);
    const pending = rows.some(r => current(r, s) && open(r));
    return {
      escalateTo: !pending && mayOpen(actor, s) && s.lead !== actor ? s.lead : undefined,
      handoverTo: !pending && mayOpen(actor, s) && s.maintain && s.developer !== actor ? s.developer : undefined,
      records: rows.filter(r => s.maintain || r.actor === actor || r.answeredBy === actor || recipient(r, s) === actor)
        .map(r => {
          const live = s.active && current(r, s);
          const to = live && r.state === 'open' ? recipient(r, s) : r.answeredBy ?? r.recipient;
          return { ...r, recipient: to, stale: !live && open(r), canAnswer: live && s.writable && r.state === 'open' && to === actor,
            canReceive: live && s.writable && r.state === 'answered' && r.actor === actor,
            canWithdraw: live && s.writable && open(r) && (r.actor === actor || s.maintain) };
        }),
    };
  }
  function apply(actor: string, s: DecisionScope, input: EngineeringAction) {
    if (!s.writable) throw new WorkbenchError('当前账号无法处理这个项目的研发决策。', 403);
    const rows = list(s.ticket);
    if (input.action === 'open') {
      if (!mayOpen(actor, s) || input.direction === 'handover' && !s.maintain) throw new WorkbenchError('当前工单不允许发起这项请求。', 403);
      if (input.version !== s.version || input.sha !== s.sha) throw new WorkbenchError('工单版本或提交已变化，请刷新。', 409);
      const id = key('engineering-decision', s.ticket, actor, input.nonce);
      const previous = rows.find(r => r.id === id);
      if (previous && current(previous, s) && previous.question === input.text && previous.direction === input.direction) return { id };
      if (previous || rows.some(r => current(r, s) && open(r))) throw new WorkbenchError('本版已有待处理的请求，请刷新。', 409);
      const to = input.direction === 'handover' ? s.developer : s.lead;
      if (!to || to === actor) throw new WorkbenchError('当前没有其他可接收此请求的责任人。', 409);
      save({ id, ticket: s.ticket, version: s.version, sha: s.sha, direction: input.direction, actor, recipient: to, question: input.text, state: 'open', openedAt: new Date().toISOString() });
      ports.notify(s.project, s.ticket, id, to, false, input.direction);
      return { id };
    }
    const r = rows.find(r => r.id === input.id);
    if (!r || !s.active || !current(r, s)) throw new WorkbenchError('该决策已失效，请刷新原工单。', 409);
    if (input.action === 'answer') {
      if (recipient(r, s) !== actor) throw new WorkbenchError('由此项请求的当前责任人答复。', 403);
      if (r.state !== 'open') {
        if (r.answeredBy === actor && r.answer === input.text && r.state !== 'withdrawn') return { id: r.id };
        throw new WorkbenchError('该请求已处理。', 409);
      }
      const handedOver = r.direction === 'handover';
      save({ ...r, state: handedOver ? 'received' : 'answered', answeredBy: actor, answeredAt: new Date().toISOString(), answer: input.text });
      ports.close(r.id, false);
      if (!handedOver) ports.notify(s.project, s.ticket, r.id, r.actor, true, r.direction);
    } else {
      if (r.actor !== actor && !(input.action === 'withdraw' && s.maintain)) throw new WorkbenchError('当前账号无法处理这项请求。', 403);
      const next = input.action === 'received' ? 'received' : 'withdrawn';
      if (r.state === next) return { id: r.id };
      if (!open(r) || next === 'received' && r.state !== 'answered') throw new WorkbenchError('请求状态已变化。', 409);
      ports.close(r.id, r.state === 'answered');
      save({ ...r, state: next });
    }
    return { id: r.id };
  }
  const forExecution = (ticket: string, scope: Pick<DecisionScope, 'version' | 'sha'>, allowed: (name: string) => boolean) =>
    list(ticket).reverse().filter(r => r.state === 'received' && current(r, scope) && !!r.answeredBy && allowed(r.answeredBy) && allowed(r.actor));
  function pending(id: string, scope: Pick<DecisionScope, 'version' | 'sha'>, direction?: RecordRow['direction']) {
    return list(id).some(r => current(r, scope) && open(r) && (!direction || r.direction === direction));
  }
  return { view, apply, forExecution, pending };
}
