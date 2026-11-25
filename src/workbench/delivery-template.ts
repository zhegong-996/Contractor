import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { WorkbenchError } from './errors.ts';
import { defaultChecks, pullChecks, type GitHubIdentity, type RequiredCheck, type RequiredDeployment } from './github-delivery.ts';
import { digest } from './knowledge.ts';
import type { ProjectResource } from './project-resources.ts';
import type { DeliveryEvidence, Work } from './work-types.ts';
import { productTemplateSchema } from './product-verification.ts';

export const deliveryTemplateSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  version: z.number().int().positive().safe(),
  product: productTemplateSchema.optional(),
  stages: z.object({ requireTopicBasis: z.boolean().optional() }).strict().optional(),
  reviewerIds: z.array(z.number().int().positive().safe()).min(1).max(12)
    .refine(ids => new Set(ids).size === ids.length, '独立审查账号不能重复').optional(),
}).strict().refine(template => !template.stages || !!template.product, '分阶段交付模板需要配置明确的产品验收条件。');

export type DeliveryTemplate = z.infer<typeof deliveryTemplateSchema> & {
  repository: string;
  checks: RequiredCheck[];
  deployment?: RequiredDeployment;
};

export function verifyDeliveryTopic(template: DeliveryTemplate | undefined, topic: string | undefined) {
  if (template?.stages?.requireTopicBasis && !topic)
    throw new WorkbenchError('此交付模板需要在项目主题下立项并确认主题依据。', 409);
}

export function freezeDeliveryTemplate(target: ProjectResource | undefined): DeliveryTemplate | undefined {
  const execution = target?.execution;
  if (!target || !execution?.deliveryTemplate) return;
  const { product } = execution.deliveryTemplate;
  const checks = execution.requiredChecks ?? defaultChecks;
  const browser = product?.browser?.check;
  if (browser && !checks.some(check => check.name === browser.name && check.app === browser.app && check.appId === browser.appId))
    throw new WorkbenchError('请把产品验收工作流配置为同一 App ID 的必需 CI 检查。', 409);
  return structuredClone({ ...execution.deliveryTemplate, repository: target.externalId, checks, deployment: execution.requiredDeployment });
}

export function deliveryTemplates(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS workbench_delivery_template_version (
    project TEXT NOT NULL, repository TEXT NOT NULL, template TEXT NOT NULL, version INTEGER NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY(project,repository,template,version)
  )`);
  const insert = db.prepare('INSERT OR IGNORE INTO workbench_delivery_template_version VALUES (?,?,?,?,?)');
  const read = db.prepare('SELECT value FROM workbench_delivery_template_version WHERE project=? AND repository=? AND template=? AND version=?');
  return (project: string, target: ProjectResource | undefined) => {
    const snapshot = freezeDeliveryTemplate(target);
    if (!snapshot) return;
    snapshot.repository = snapshot.repository.toLowerCase();
    const key = [project, snapshot.repository, snapshot.id, snapshot.version] as const;
    insert.run(...key, JSON.stringify(snapshot));
    const value = read.get(...key)?.value;
    if (typeof value !== 'string' || digest(JSON.parse(value)) !== digest(snapshot))
      throw new WorkbenchError('交付模板版本已固定。更换检查或审查人时请发布新版本。', 409);
    return snapshot;
  };
}

export function deliveryRequirements(work: Pick<Work, 'deliveryTemplate'>, target: ProjectResource) {
  const template = work.deliveryTemplate;
  if (template?.repository.toLowerCase() === target.externalId.toLowerCase())
    return { checks: template.checks, deployment: template.deployment };
  return { checks: target.execution?.requiredChecks, deployment: target.execution?.requiredDeployment };
}

export function templateChecks(template: DeliveryTemplate, evidence: DeliveryEvidence) {
  return template.checks.map(rule => {
    const result = pullChecks(evidence.headSha, evidence.checks ?? [], [rule]);
    const check = result.checks[0];
    return { name: rule.name, app: rule.app, state: result.ci, ...(check && { id: check.id, url: check.html_url, status: check.status, conclusion: check.conclusion }) };
  });
}

export function templateReview(template: DeliveryTemplate | undefined, evidence: DeliveryEvidence,
  eligible: (actor: GitHubIdentity) => boolean) {
  if (!template?.reviewerIds) return;
  const authors = new Set([evidence.creator?.id, ...evidence.commits?.flatMap(commit =>
    [commit.author?.id, commit.committer?.id, commit.push?.actor?.id]) ?? []]);
  const latest = new Map<number, NonNullable<DeliveryEvidence['reviews']>[number]>();
  for (const review of evidence.reviews ?? []) {
    const reviewer = review.user;
    if (!reviewer || reviewer.type !== 'User' || reviewer.login.endsWith('[bot]') || authors.has(reviewer.id)
      || review.commit_id !== evidence.headSha || !template.reviewerIds.includes(reviewer.id) || !eligible(reviewer)
      || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) continue;
    const prior = latest.get(reviewer.id);
    if (!prior || (review.submitted_at ?? '') > (prior.submitted_at ?? '')
      || review.submitted_at === prior.submitted_at && review.id > prior.id) latest.set(reviewer.id, review);
  }
  const records = [...latest.values()];
  const rejecting = records.find(review => review.state === 'CHANGES_REQUESTED');
  const approved = records.find(review => review.state === 'APPROVED');
  const evidenceReview = rejecting ?? approved;
  return {
    state: rejecting ? 'failed' as const : approved ? 'passed' as const : 'pending' as const,
    ...(evidenceReview && { id: evidenceReview.id, url: evidenceReview.html_url }),
  };
}
