import type { Trigger } from '../../upstream/superagent/src/core/index.ts';
import type { OctopIMAddress } from './octop-im-contract.ts';
import type { Provider, PlatformActor } from './channel-links.ts';
import type { ResourceView } from './project-resources.ts';
import type { ExpertAuthority } from './octop-resources.ts';
import type { WorkerHarnessStamp } from './worker-harness.ts';
import type { Development, DevelopmentTarget } from './development.ts';
import type { DeliveryTemplate } from './delivery-template.ts';
import type { inspectBranch, inspectPull, GitHubIdentity, GitHubPush } from './github-delivery.ts';
import type { Measure } from './learning.ts';
import type { KnowledgeRef } from './knowledge.ts';
import type { Isolation } from './isolation.ts';
import type { ExecutionEvidence, ModelSelection } from './execution-evidence.ts';
import type { ManualCase } from './product-verification.ts';

export type ExecutionBlockKind = 'model-unavailable' | 'model-authorization' | 'quota' | 'source-changed' | 'execution-endpoint'
  | 'worktree' | 'result-incomplete' | 'execution-failed' | 'execution-cancelled' | 'authority-changed';

export type Work = {
  project: string;
  requester: string;
  acceptanceAssignee?: { member: string; version: number; at: string };
  agent: string;
  agentVersion: string;
  function: string;
  priority: 'normal' | 'urgent';
  source: 'web' | Provider;
  executionBlock?: { kind: ExecutionBlockKind; run: number; lane: string };
  material: string[];
  recall?: string[];
  personal?: boolean;
  device?: string;
  resources?: ResourceView[];
  development?: DevelopmentTarget;
  developmentApproval?: { actor: string; agent: string; scope: string; at: string; version?: number };
  developmentOffer?: { replaces: string; agent: string; reason: string; by: string; at: string };
  developmentResponse?: { offer: string; response: 'decline' | 'return'; actor: string; agent: string; reason: string; at: string };
  approvalRequired?: boolean;
  version?: number;
  localRetry?: { run: number; discarded: string; start: string; reason: string };
  continuation?: { id: string; reason: string; actor: string; at: string; previous?: string; baseSha?: string; recheck?: true;
    consultation?: { ticket: string; revision: string } };
  delegationRecovery?: { request: string; from: number };
  topic?: string;
  consultation?: { message: string; name: string; feishu?: NonNullable<Trigger['channel']>; octopIM?: OctopIMAddress; account?: PlatformActor;
    requiredKnowledge?: KnowledgeRef; private?: true };
  related?: string[];
  branches?: Awaited<ReturnType<typeof inspectBranch>>[];
  parent?: string;
  delegatedVia?: { delegation: string; parent: string; version: number; run: number; agent: string; owner: string };
  measure?: Measure;
  reusedLesson?: string;
  lane?: string;
  handoff?: { assignment: string; from: string; to: string; by: string; reason: string; runs: number[];
    requestedAt: string; completedAt?: string; cancelledAt?: string; accessRequests?: Record<string, string>; cause?: 'access' | 'resume';
    device?: string | null };
  delivery?: DeliveryEvidence;
  deliveryTemplate?: DeliveryTemplate;
  productCases?: ManualCase[];
  reusedAcceptance?: KnowledgeRef;
  deliveryPr?: DeliveryPull;
  accepted?: { actor: string; revision: string; at: string; commit?: string };
  octop?: ExpertAuthority;
};
export type MappedIdentity = GitHubIdentity & { member?: string };
export type CommitProvenance = {
  sha: string; author: MappedIdentity | null; committer: MappedIdentity | null;
  push?: Omit<GitHubPush, 'actor'> & { actor: MappedIdentity | null };
  checkpoint?: string; run?: { ticket: string; id: number; actor: RunActor; evidence: 'worker-commit' | 'entire-checkpoint' };
};
export type PullSnapshot = Awaited<ReturnType<typeof inspectPull>>['snapshot'];
export type DeliveryEvidence = Pick<PullSnapshot, 'repository' | 'url' | 'pr' | 'baseSha' | 'headSha' | 'ci'> &
  Partial<PullSnapshot> & { creator?: MappedIdentity; commits?: CommitProvenance[]; attachedBy?: string; workReference?: boolean };
export type DeliveryPull = Pick<PullSnapshot, 'repository' | 'url' | 'pr' | 'repoId'> & { attachedBy?: string };
export type DeliveryIssue = 'missing-evidence' | 'ci-failed' | 'review-failed' | 'deployment-failed' | 'verification-missing';
export type CodeDeliveryState = { state: DeliveryIssue | 'ci-pending' | 'review-pending' | 'deployment-pending' | 'ready'; detail: string; output: Output; issue?: DeliveryIssue };
export type RunActor = {
  delegatedBy: string; requestedVia: Work['source']; delegatedAccount?: PlatformActor;
  agent: string; owner: string; function: string; engine: string; modelRoute?: ModelSelection;
};
export type Assembled = { assignment: string; agentVersion: string; contextHash: string; sources: { id: string; revision: string; access?: string; recalled?: boolean }[]; version?: number;
  topic?: string | null;
  topicContext?: import('./topic-context.ts').TopicContextRef[];
  stageBasis?: string;
  engine: string; model?: string; actor?: RunActor; resources?: ResourceView[]; development?: Development;
  octop?: ExpertAuthority;
  workerHarness?: WorkerHarnessStamp;
  isolation?: Isolation; codeBundle?: string; consultationReply?: true; fullResult?: true;
  childResults?: string[];
  confirmations?: number[]; policyVersion?: string; assembly?: ReturnType<ExecutionEvidence['freeze']> };
export type Output = { run: number; attempt?: number; text: string; revision: string; sources: Assembled['sources']; at: string; version?: number; cited?: KnowledgeRef[] };
export type Start = {
  project: string; title: string; request: string; nonce: string; material: string[];
  priority: Work['priority']; agent?: string; function?: string; parent?: string;
  resources?: string[];
  target?: string;
  topic?: string;
  measure?: Measure; reusedLesson?: string;
  recall?: boolean; personal?: boolean; device?: string;
  productCases?: { title: string; expectation: string }[];
  reuseAcceptance?: boolean;
};
export type IntakeDecision = { action: 'link'; ticket: string }
  | { action: 'create'; project?: string; topic?: string; agent?: string; parent?: string; brief?: string; separate?: boolean; material?: string[]; target?: string }
  | { action: 'project' }
  | { action: 'topic'; topic: string }
  | { action: 'dismiss' };
