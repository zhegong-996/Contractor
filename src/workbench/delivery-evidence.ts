import type { DatabaseSync } from 'node:sqlite';
import type { Ticket } from '../../upstream/superagent/src/core/index.ts';
import { deploymentState, pullChecks, type PullCheck } from './github-delivery.ts';
import type { ProjectResource } from './project-resources.ts';
import type { CodeDeliveryState, DeliveryEvidence, DeliveryPull, Output, Work } from './work-types.ts';
import { deliveryRequirements, type templateReview } from './delivery-template.ts';

export function openDeliveryEvidence(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_pull_version (
      ticket TEXT NOT NULL, repository INTEGER NOT NULL, number INTEGER NOT NULL, base TEXT NOT NULL, head TEXT NOT NULL,
      value TEXT NOT NULL, PRIMARY KEY(ticket,repository,number,base,head)
    );
    CREATE TABLE IF NOT EXISTS workbench_ci_attempt (
      ticket TEXT NOT NULL, repository INTEGER NOT NULL, number INTEGER NOT NULL, head TEXT NOT NULL,
      id INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(ticket,repository,number,head,id)
    );
    INSERT OR IGNORE INTO workbench_ci_attempt
      SELECT v.ticket,v.repository,v.number,v.head,json_extract(c.value,'$.id'),c.value
      FROM workbench_pull_version v, json_each(v.value,'$.checks') c
      WHERE json_type(c.value,'$.id')='integer' AND json_extract(c.value,'$.head_sha')=v.head;
  `);

  function storeDeliveryVersion(id: string, evidence: DeliveryEvidence) {
    // Replace the current observation for a revision and keep it newest even after a branch returns to an earlier SHA.
    db.prepare('INSERT OR REPLACE INTO workbench_pull_version VALUES (?,?,?,?,?,?)')
      .run(id, evidence.repoId!, evidence.pr, evidence.baseSha, evidence.headSha, JSON.stringify(evidence));
  }

  function recordCheckAttempts(id: string, pull: Pick<DeliveryPull, 'repoId' | 'pr'>, attempts: PullCheck[]) {
    const save = db.prepare(`INSERT INTO workbench_ci_attempt VALUES (?,?,?,?,?,?)
      ON CONFLICT DO UPDATE SET value=excluded.value WHERE value!=excluded.value
        AND (json_extract(value,'$.status')!='completed' OR json_extract(excluded.value,'$.status')='completed')`);
    for (const check of attempts) save.run(id, pull.repoId, pull.pr, check.head_sha, check.id, JSON.stringify(check));
  }

  return {
    storeDeliveryVersion, recordCheckAttempts,
    lastLinkedVersion(id: string): DeliveryEvidence | undefined {
      const saved = db.prepare(`SELECT v.value FROM workbench_pull_version v
        WHERE v.ticket=? AND json_extract(v.value,'$.url')=(SELECT json_extract(a.value,'$.pr')
          FROM workbench_audit a WHERE a.ticket=? AND a.kind='delivery.linked' ORDER BY a.id DESC LIMIT 1)
        ORDER BY v.rowid DESC LIMIT 1`).get(id, id);
      return saved ? JSON.parse(String(saved.value)) : undefined;
    },
    latestRaw(id: string, pull: Pick<DeliveryPull, 'repoId' | 'pr'>) {
      return db.prepare('SELECT value FROM workbench_pull_version WHERE ticket=? AND repository=? AND number=? ORDER BY rowid DESC LIMIT 1')
        .get(id, pull.repoId, pull.pr)?.value as string | undefined;
    },
    versions(id: string) {
      return db.prepare('SELECT value FROM workbench_pull_version WHERE ticket=? ORDER BY rowid DESC').all(id)
        .map(row => JSON.parse(String(row.value)) as DeliveryEvidence);
    },
    checkAttempts(id: string) {
      return db.prepare('SELECT repository AS repoId, number AS pr, value FROM workbench_ci_attempt WHERE ticket=? ORDER BY id DESC').all(id)
        .map(row => ({ ...JSON.parse(String(row.value)) as PullCheck, repoId: Number(row.repoId), pr: Number(row.pr) }));
    },
    tracks(id: string, repository: number, number: number) {
      return !!db.prepare('SELECT 1 FROM workbench_pull_version WHERE ticket=? AND repository=? AND number=? LIMIT 1').get(id, repository, number);
    },
  };
}

export function deliveryStatus(ports: {
  outputFor: (id: string) => Output | undefined;
  matchesCodeDelivery: (ticket: Ticket, work: Work, output: Output, evidence: DeliveryEvidence) => boolean;
  followedPull: (id: string, work: Work) => DeliveryPull | undefined;
  targets: (project: string) => ProjectResource[];
  review: (work: Work, output: Output, evidence: DeliveryEvidence) => ReturnType<typeof templateReview>;
  browserVerified?: (id: string, work: Work, output: Output, evidence: DeliveryEvidence) => boolean;
}) {
  const { outputFor, matchesCodeDelivery, followedPull, targets, review } = ports;

  return function codeDeliveryState(ticket: Ticket, work: Work): CodeDeliveryState | undefined {
    if (!work.development || work.accepted || ticket.ended?.outcome !== 'completed') return;
    const output = outputFor(ticket.id);
    if (!output) return;
    const missing = (detail: string): CodeDeliveryState => ({ state: 'missing-evidence', issue: 'missing-evidence', detail, output });
    const evidence = work.delivery;
    if (!evidence || !matchesCodeDelivery(ticket, work, output, evidence))
      return missing(followedPull(ticket.id, work) ? '原 PR 尚未核对到本版受托提交和基线，请研发核对推送。'
        : '本版尚未关联 PR，请研发推送受托提交并关联交付。');
    if (evidence.state !== 'open' && evidence.state !== 'merged') return missing('请研发核对 PR 是否已转为正式交付。');
    const target = targets(work.project).find(ref => ref.execution
      && ref.externalId.toLowerCase() === evidence.repository.toLowerCase());
    if (!target) return missing('本版交付仓库配置已变化，请研发核对。');
    const policy = deliveryRequirements(work, target);
    const { ci, checks } = pullChecks(evidence.headSha, evidence.checks ?? [], policy.checks);
    if (!checks.length) return missing('本版提交尚无配置要求的 CI 检查，请研发核对。');
    if (ci === 'failed') return { state: 'ci-failed', issue: 'ci-failed', detail: '本版提交的 CI 未通过，请研发核对检查结果。', output };
    if (ci !== 'passed') return { state: 'ci-pending', detail: '等待本版提交的 CI 结束。', output };
    if (work.deliveryTemplate?.product?.browser && !ports.browserVerified?.(ticket.id, work, output, evidence))
      return { state: 'verification-missing', issue: 'verification-missing', detail: '本版 CI 已通过，尚未核对到对应运行的产品验收报告。', output };
    const independent = review(work, output, evidence);
    if (independent?.state === 'failed')
      return { state: 'review-failed', issue: 'review-failed', detail: '本版独立审查要求修改，请研发核对审查记录。', output };
    if (independent?.state === 'pending')
      return { state: 'review-pending', detail: '等待本版提交的独立审查。', output };
    const required = policy.deployment;
    if (required) {
      const deployed = deploymentState(required, evidence.headSha, evidence.deployed);
      if (deployed === 'failed') return { state: 'deployment-failed', issue: 'deployment-failed', detail: '本版部署未成功，请研发核对目标环境。', output };
      if (deployed !== 'passed') return { state: 'deployment-pending', detail: '等待目标环境部署本版提交并返回成功状态。', output };
    }
    return { state: 'ready', detail: required ? '本版提交、CI 和部署版本已核对。' : '本版提交和 CI 已核对。', output };
  };
}
