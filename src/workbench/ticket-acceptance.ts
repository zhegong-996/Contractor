import type { Ticket } from '../../upstream/superagent/src/core/index.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import type { ExecutionHub } from './execution/contract.ts';
import type { Project } from './config.ts';
import { requireValue, WorkbenchError } from './errors.ts';
import { DeliveryChangedError, deploymentState, type inspectPull, type DeploymentSelection, type PullCheck } from './github-delivery.ts';
import type { Iterations } from './iterations.ts';
import { digest, type ProjectKnowledge } from './knowledge.ts';
import type { ProjectResource } from './project-resources.ts';
import type { Assembled, CommitProvenance, DeliveryEvidence, Output, Work } from './work-types.ts';
import { deliveryRequirements, type templateReview } from './delivery-template.ts';
import type { ProductVerification } from './product-verification.ts';
import type { DeliveryStages } from './delivery-stages.ts';

type AcceptancePorts = {
  decisionPending: (id: string, work: Work) => boolean;
  ticketFor: (id: string, actor: string) => { ticket: Ticket; work: Work; project: Project };
  mayStart: (project: Project, actor: string) => boolean;
  delegationAuthority: (work: Work) => boolean;
  pendingDelegation: (id: string, version: number) => boolean;
  missingRequiredDelegation: (id: string, work: Work) => boolean;
  delegationResultsCurrent: (id: string, work: Work) => boolean;
  approvalComplete: (work: Work, project: Project) => boolean;
  readableOutput: (id: string, actor: string) => Output | undefined;
  pullTarget: (project: Project, url: string) => ProjectResource;
  inspectPull: typeof inspectPull;
  provenance: (ticket: Ticket, work: Work, project: Project, observed: Awaited<ReturnType<typeof inspectPull>>) => Promise<CommitProvenance[]>;
  verifyCodeDelivery: (ticket: Ticket, work: Work, evidence: DeliveryEvidence) => unknown;
  review: (work: Work, output: Output, evidence: DeliveryEvidence) => ReturnType<typeof templateReview>;
  product: ProductVerification['state'];
  stages: (ticket: Ticket, work: Work, output: Output, product: ReturnType<ProductVerification['state']>) => DeliveryStages | undefined;
  storeDeliveryVersion: (id: string, evidence: DeliveryEvidence) => void;
  recordCheckAttempts: (id: string, pull: {repoId: number; pr: number}, attempts: PullCheck[]) => void;
  saveWork: (id: string, work: Work) => unknown;
  recordConflict: (ticket: Ticket, current: Work, evidence: DeliveryEvidence) => void;
  conflict: (id: string, evidence: DeliveryEvidence) => number | undefined;
  closeAcceptance: (id: string) => void;
  closeDeliveryIssues: (id: string, output: Output) => void;
  manifestFor: (run: number) => Assembled | undefined;
  knowledgeId: (id: string, output: Output) => string;
  audit: (id: string, kind: string, data: object) => void;
};

export function acceptanceAssignee(work: Work) {
  return work.acceptanceAssignee?.version === (work.version ?? 1) ? work.acceptanceAssignee.member : work.requester;
}

export function openTicketAcceptance(store: Pick<SuperAgentStore, 'atomic'>, hub: Pick<ExecutionHub, 'confirmed'>,
  iterations: Iterations, knowledge: Pick<ProjectKnowledge, 'get' | 'save'>, ports: AcceptancePorts) {
  const { ticketFor, mayStart, delegationAuthority, pendingDelegation, missingRequiredDelegation, delegationResultsCurrent,
    readableOutput, pullTarget, inspectPull, provenance, verifyCodeDelivery, review, product, storeDeliveryVersion, recordCheckAttempts, saveWork,
    closeAcceptance, closeDeliveryIssues, manifestFor, knowledgeId, audit, stages, approvalComplete } = ports;

  return async function accept(actor: string, id: string, revision: string, conditions: string, body: string, commit?: string, deployment?: DeploymentSelection) {
    const { ticket, work, project } = ticketFor(id, actor);
    if (work.consultation) throw new WorkbenchError('咨询已经回到主题讨论。', 409);
    if (!delegationAuthority(work)) throw new WorkbenchError('上游委托已失效，请重新确认验收范围。', 409);
    if (!approvalComplete(work, project)) throw new WorkbenchError('请先完成本版的审批流程。', 409);
    if (acceptanceAssignee(work) !== actor || !mayStart(project, actor)) throw new WorkbenchError('由当前版本的验收人验收。', 403);
    if (!work.accepted && (pendingDelegation(id, work.version ?? 1) || missingRequiredDelegation(id, work) || !delegationResultsCurrent(id, work)))
      throw new WorkbenchError('必需子任务的验收结果尚未齐备或已失效。', 409);
    if (body && !conditions.trim()) throw new WorkbenchError('请填写这条结论的适用条件。');
    const output = requireValue(readableOutput(id, actor), '当前成果不可读取，请重新核对权限。', 409);
    if (ticket.ended?.outcome !== 'completed' || output.revision !== revision) throw new WorkbenchError('请验收当前已生成的版本。', 409);
    const verifyRepeat = (accepted: Work) => {
      if (commit !== undefined && commit !== accepted.accepted?.commit)
        throw new WorkbenchError('请求的提交与本版验收记录不一致。', 409);
      const recorded = accepted.delivery?.deployed;
      if (deployment && (recorded?.id !== deployment.id || recorded.status?.id !== deployment.statusId))
        throw new WorkbenchError('请选择已验收的部署记录。', 409);
    };
    if (work.accepted) return verifyRepeat(work);
    if (work.development && (!commit || !work.delivery)) throw new WorkbenchError('代码工单必须关联本单提交与 PR，并核对该提交的 CI 后验收。', 409);
    if (commit && !work.delivery) throw new WorkbenchError('请先关联交付版本。', 409);
    if (deployment && !work.delivery) throw new WorkbenchError('请先关联包含该部署的交付版本。', 409);
    const checkResult = product(id, revision, work, work.development ? work.delivery : undefined);
    if (checkResult && !checkResult.ready) throw new WorkbenchError('先核对本版产品验收条件，再确认最终验收。', 409);
    let verified: DeliveryEvidence | undefined;
    let attempts: PullCheck[] = [];
    if (work.delivery) {
      const target = pullTarget(project, work.delivery.url);
      const requirements = deliveryRequirements(work, target);
      const required = requirements.deployment;
      if (required && (!deployment || deployment.id !== work.delivery.deployed?.id
        || deployment.statusId !== work.delivery.deployed.status?.id))
        throw new WorkbenchError('部署环境、版本或状态待核对，请选择当前部署记录后验收。', 409);
      if (!required && deployment) throw new WorkbenchError('本工单未配置该部署验收范围。', 409);
      const fresh = await inspectPull(target.externalId, work.delivery.url, requirements.checks, required).catch(error => {
        if (error instanceof DeliveryChangedError) throw new WorkbenchError(error.message, 409);
        throw error;
      });
      const observed = fresh.snapshot;
      attempts = fresh.attempts;
      const current = ticketFor(id, actor);
      const selected = current.work.delivery;
      if (observed.mergeable === false && selected && !current.work.accepted && current.work.development &&
          selected.repoId === observed.repoId && selected.pr === observed.pr && selected.headSha === observed.headSha &&
          selected.baseSha === observed.baseSha && digest(selected) === digest(work.delivery) && readableOutput(id, actor)?.revision === revision &&
          acceptanceAssignee(current.work) === actor && mayStart(current.project, actor))
        ports.recordConflict(current.ticket, current.work, { ...selected, mergeable: false });
      if (observed.mergeable === false || (observed.mergeable == null && ports.conflict(id, work.delivery)))
        throw new WorkbenchError('PR 合并冲突尚未确认解决，请更新后再验收。', 409);
      if (observed.state === 'draft' || observed.state === 'closed' || observed.ci !== 'passed'
        || observed.headSha !== commit || digest(selected ?? null) !== digest(work.delivery)
        || work.delivery.headSha !== observed.headSha || observed.baseSha !== work.delivery.baseSha)
        throw new WorkbenchError('PR 提交、基线或 CI 已变化，请更新交付版本后再验收。', 409);
      if (required && (deploymentState(required, observed.headSha, observed.deployed) !== 'passed'
        || digest(work.delivery.deployed ?? null) !== digest(observed.deployed ?? null)))
        throw new WorkbenchError('部署环境、版本或状态已变化，请更新交付证据后再验收。', 409);
      verified = { ...work.delivery, ...observed, commits: await provenance(ticket, work, project, fresh) };
      verifyCodeDelivery(ticket, work, verified);
    }
    const check = ticketFor(id, actor);
    const current = check.work;
    if (acceptanceAssignee(current) !== actor || !mayStart(check.project, actor))
      throw new WorkbenchError('由当前版本的验收人验收。', 403);
    if (current.accepted?.revision === revision) return verifyRepeat(current);
    if (current.accepted || !delegationAuthority(current) || readableOutput(id, actor)?.revision !== revision
      || digest(current.delivery ?? null) !== digest(work.delivery ?? null)
      || digest(current.deliveryTemplate ?? null) !== digest(work.deliveryTemplate ?? null))
      throw new WorkbenchError('成果或交付版本已变化，请刷新。', 409);
    store.atomic(() => {
      if (ports.decisionPending(id, current)) throw new WorkbenchError('请先完成本版研发决策并接回处理。', 409);
      const productResult = product(id, revision, current, current.development ? verified : undefined);
      if (productResult && (!productResult.ready || digest(productResult) !== digest(checkResult)))
        throw new WorkbenchError('需求验收证据已变化，请在工作台重新核对本版。', 409);
      if (verified) {
        verifyCodeDelivery(ticketFor(id, actor).ticket, current, verified);
        const independent = review(current, output, verified);
        if (independent && independent.state !== 'passed') throw new WorkbenchError('当前提交尚未通过独立审查。', 409);
      }
      if (verified) {
        storeDeliveryVersion(id, verified);
        if (verified.repoId) recordCheckAttempts(id, { repoId: verified.repoId, pr: verified.pr }, attempts);
      }
      saveWork(id, { ...current, ...(verified ? { delivery: verified } : {}), accepted: { actor, revision, at: new Date().toISOString(), ...(commit ? { commit } : {}) } });
      iterations.record(id, { version: current.version ?? 1, revision, kind: 'accepted', actor, at: new Date().toISOString(),
        ...(commit ? { commit } : {}), delivery: verified ?? current.delivery, template: current.deliveryTemplate,
        ...(productResult && { product: productResult, topic: current.topic }),
        stages: stages(check.ticket, current, output, productResult) });
      closeAcceptance(id);
      closeDeliveryIssues(id, output);
      const confirmedIds = new Set(manifestFor(output.run)?.confirmations ?? []);
      const confirmed = hub.confirmed(id).filter(card => confirmedIds.has(card.id));
      const candidateBody = body || [
        '本工单第 ' + (output.version ?? 1) + ' 版已由验收人确认。以下是本次工作记录，适用条件待核对。',
        ...(productResult ? ['本版验收条件：\n' + productResult.cases.map(row =>
          '- ' + row.title + '：' + row.expectation + '（通过）').join('\n')] : []),
        ...confirmed.map(card => ['人确认的问题：' + card.title, card.text,
          '当时的决定：' + (card.choice === null ? card.answer : JSON.parse(card.options)[card.choice]),
          '确认人：' + card.by + '；时间：' + card.decided_at].join('\n')),
        '本版成果：\n' + output.text,
      ].join('\n\n').slice(0, 16000);
      knowledge.save({ project: work.project, owner: actor, ticket: id, title: ticket.title, kind: 'decision',
        body: candidateBody, conditions: conditions || '仅记录 ' + project.title + ' 本工单第 ' + (output.version ?? 1) + ' 版，适用条件待核对。',
        ...(!body ? { draft: { run: output.run, version: output.version ?? 1, cards: confirmed.map(card => card.id), needsReview: true } } : {}),
        visibility: output.sources.some(ref => knowledge.get(ref.id)?.visibility === 'restricted') ? 'restricted' : 'project',
        state: 'candidate', sources: [id + '@' + revision, ...(work.delivery ? [work.delivery.url + '@' + work.delivery.headSha] : []),
          ...confirmed.map(card => 'confirmation:' + card.id + '@' + card.run_id),
          ...output.sources.map(ref => ref.id + '@' + ref.revision)] }, knowledgeId(id, output));
      audit(id, 'output.accepted', { revision, actor, ...(commit ? { commit } : {}),
        ...(verified ? { pr: verified.url, checks: verified.checks?.map(item => ({ id: item.id, head: item.head_sha })) } : {}) });
    });
  }
}
