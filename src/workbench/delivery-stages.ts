import { digest } from './knowledge.ts';
import type { ProductVerificationState } from './product-verification.ts';
import type { TopicContextRef } from './topic-context.ts';
import type { CodeDeliveryState, Work } from './work-types.ts';

export function stageBasisRevision(refs: (Pick<TopicContextRef, 'source' | 'id' | 'revision'> | undefined)[]) {
  const current = refs.flatMap(ref => ref ? [JSON.stringify([ref.source, ref.id, ref.revision])] : []);
  return current.length ? digest(current.sort()) : undefined;
}

export type StageState = 'passed' | 'waiting' | 'failed' | 'unavailable';
export type StageCheck = { id: 'scope' | 'implementation' | 'verification' | 'acceptance'; title: string;
  state: StageState; detail: string; owner?: string; link?: 'context' | 'execution' | 'delivery' };

/** Read model over the original evidence. It never advances the work or releases a lease. */
export function deliveryStages(work: Pick<Work, 'deliveryTemplate' | 'version' | 'requester'>, input: {
  scopeApproved: boolean; basisReady: boolean; owner?: string; output: boolean; blocked: boolean;
  linked: boolean; hidden: boolean; delivery?: Pick<CodeDeliveryState, 'state' | 'detail' | 'issue'>;
  product?: ProductVerificationState; accepted: boolean;
}) {
  const template = work.deliveryTemplate;
  if (!template?.stages) return;
  const scopeReady = input.scopeApproved && input.basisReady;
  const productMissing = input.product?.cases.filter(row => row.state !== 'passed') ?? [];
  const proofReady = input.accepted || input.delivery?.state === 'ready' && input.product?.ready === true;
  const stages: StageCheck[] = [
    { id: 'scope', title: '确认范围', state: scopeReady ? 'passed' : 'waiting',
      detail: !input.basisReady ? '请确认一条当前可用的主题依据。' : input.scopeApproved
        ? '委托范围和验收条件已固定。' : '等待有仓库交付权限的研发接单。',
      owner: input.basisReady ? input.owner : work.requester, link: 'context' },
    { id: 'implementation', title: '实现与提交', state: input.hidden ? 'unavailable' : input.linked ? 'passed' : input.blocked ? 'failed' : 'waiting',
      detail: input.hidden ? '本版成果当前不可读。' : input.linked ? '已核对本版受托提交与 PR。'
        : input.output ? '待关联包含本版受托提交的 PR。' : input.blocked ? '查看执行阻塞并在原单接续。' : '等待本版执行成果。',
      owner: input.owner, link: 'execution' },
    { id: 'verification', title: '交付检查', state: input.hidden ? 'unavailable' : proofReady ? 'passed'
        : input.delivery?.issue && input.delivery.issue !== 'missing-evidence' || productMissing.some(row => row.state === 'failed') ? 'failed' : 'waiting',
      detail: input.hidden ? '当前权限下无法核对交付证据。' : proofReady ? '本版提交与必需验收条件已核对。'
        : productMissing.length ? '待核对 ' + productMissing.map(row => row.title).join('、') + '。'
        : input.delivery?.detail ?? '等待对应提交的 CI 与验收证据。',
      owner: productMissing.some(row => row.kind === 'manual') ? work.requester : input.owner, link: 'delivery' },
    { id: 'acceptance', title: '人工验收', state: input.hidden ? 'unavailable' : input.accepted ? 'passed' : 'waiting',
      detail: input.hidden ? '验收依据当前不可读。' : input.accepted ? '发起人已验收此版本。'
        : proofReady ? '请发起人确认本版验收。' : '前置证据齐备后交由发起人验收。',
      owner: work.requester, link: 'delivery' },
  ];
  return { template: template.id, templateVersion: template.version, version: work.version ?? 1, stages };
}

export type DeliveryStages = NonNullable<ReturnType<typeof deliveryStages>>;
