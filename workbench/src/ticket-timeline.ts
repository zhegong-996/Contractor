import { checkRunLabel } from './check-run-label.ts';
import type { Ticket } from './api.ts';
import { deliveryVersionRoute, runRoute } from './navigation.ts';

const runStates: Record<string, string> = { failed: '失败', cancelled: '已停止', done: '完成' };

type Event = { id: string; at: string; title: string; detail?: string; href?: string; external?: boolean };

export function ticketMilestones(ticket: Pick<Ticket, 'id' | 'project' | 'runs' | 'engineeringReview' | 'ciAttempts' | 'versions'>) {
  const events: Event[] = [];
  for (const run of ticket.runs) {
    const href = runRoute(ticket.project, ticket.id, run.id);
    const title = '执行 #' + run.id;
    if (run.startedAt) events.push({ id: 'run-start-' + run.id, at: run.startedAt, href,
      title: title + (run.resumed ? ' 接续原会话' : ' 开始'), detail: run.attribution?.agent });
    if (run.finishedAt) events.push({ id: 'run-end-' + run.id, at: run.finishedAt, href,
      title: title + ' ' + (runStates[run.state] ?? '已结束') });
  }
  for (const row of ticket.engineeringReview.records) {
    events.push({ id: 'decision-' + row.id, at: row.openedAt, title: row.actor + (row.direction === 'escalate' ? ' 请求决策' : ' 发起交接'), detail: row.question });
    if (row.answeredAt) events.push({ id: 'answer-' + row.id, at: row.answeredAt, title: (row.answeredBy ?? row.recipient) + (row.direction === 'handover' ? ' 已接手' : ' 已答复'), detail: row.answer });
    if (row.closed) events.push({ id: 'closed-' + row.id, at: row.closed.at,
      title: row.closed.by + (row.state === 'withdrawn' ? ' 已撤回请求' : ' 已接回处理') });
  }
  for (const ci of ticket.ciAttempts) {
    if (!ci.completed_at) continue;
    const result = checkRunLabel(ci.status, ci.conclusion);
    events.push({ id: ['ci', ci.repoId, ci.pr, ci.id].join('-'), at: ci.completed_at, title: ci.name + ' · ' + result,
      detail: 'PR #' + ci.pr + ' · ' + ci.head_sha.slice(0, 8), href: ci.html_url ?? undefined, external: true });
  }
  for (const version of ticket.versions) {
    const href = deliveryVersionRoute(ticket.project, ticket.id, version.revision);
    const label = '第 ' + version.version + ' 版';
    events.push({ id: 'output-' + version.revision, at: version.at, title: label + ' 已交付', href });
    for (const review of version.reviews) {
      const result = { accepted: '已验收', rejected: '已打回', continued: '开启下一版', withdrawn: '已撤回', rechecked: '已重新核对' }[review.kind];
      events.push({ id: [version.revision, review.kind, review.at].join('-'), at: review.at, title: label + ' · ' + result,
        detail: [review.actor, review.reason].filter(Boolean).join(' · '), href });
    }
  }
  return events;
}
