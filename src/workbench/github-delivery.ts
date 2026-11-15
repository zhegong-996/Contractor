import { z } from 'zod';
import { command } from '../commands.ts';
import { githubApi, parsePr } from '../github.ts';

export const commitSha = z.string().regex(/^[a-f0-9]{40}$/);
const identity = z.object({ id: z.number().int().positive(), login: z.string(), type: z.string().default('User') });
export type GitHubIdentity = z.infer<typeof identity>;
const repo = z.object({ id: z.number().int().positive(), full_name: z.string() });
const ref = z.object({ sha: commitSha, ref: z.string().min(1), repo: repo.nullable() });
const pull = z.object({
  number: z.number().int().positive(), html_url: z.string(), body: z.string().nullable(), base: ref, head: ref,
  user: identity, state: z.enum(['open', 'closed']), draft: z.boolean(), merged: z.boolean(),
  created_at: z.iso.datetime(), updated_at: z.iso.datetime(), merged_at: z.iso.datetime().nullable(), merged_by: identity.nullish(),
  requested_reviewers: z.array(identity), assignees: z.array(identity),
  labels: z.array(z.object({ id: z.number(), name: z.string() })),
  milestone: z.object({ number: z.number(), title: z.string() }).nullish(),
});
const commits = z.array(z.object({
  sha: commitSha, author: identity.nullable(), committer: identity.nullable(),
}));
const review = z.object({
  id: z.number(), state: z.string(), user: identity.nullable(),
  commit_id: commitSha.nullish(), html_url: z.string(), submitted_at: z.iso.datetime().nullish(),
});
const issue = z.object({
  number: z.number().int().positive(), html_url: z.string(), state: z.enum(['open','closed']),
  state_reason: z.string().nullish(), user: identity.nullable(), assignees: z.array(identity),
  labels: z.array(z.object({ id: z.number(), name: z.string() })),
  milestone: z.object({ number: z.number(), title: z.string() }).nullish(),
  updated_at: z.iso.datetime(), closed_at: z.iso.datetime().nullable(),
  pull_request: z.unknown().optional(),
});
const activity = z.object({
  id: z.number(), ref: z.string(), after: commitSha, timestamp: z.iso.datetime(),
  activity_type: z.string(), actor: identity.nullable(),
});
export type GitHubPush = z.infer<typeof activity>;
export type GitHubBranch = { repository: string; repoId: number; name: string; sha: string; push?: GitHubPush };
export type GitHubIssue = z.infer<typeof issue>;

const check = z.object({
  id: z.number().int().positive(), name: z.string(), head_sha: commitSha,
  status: z.string(), conclusion: z.string().nullable(),
  app: z.object({ id: z.number().int().positive(), slug: z.string() }).nullable(),
  html_url: z.string().nullable().optional(), completed_at: z.string().nullable().optional(),
});
export type PullCheck = z.infer<typeof check>;

// A passing check from another SHA, another app, or a superseded attempt is not evidence for this version.
export function pullChecks(sha: string, checks: PullCheck[]) {
  const attempts = checks.filter(item => item.head_sha === sha && item.name === 'collab-pilot'
    && item.app?.slug === 'github-actions').sort((a, b) => b.id - a.id);
  const selected = attempts.slice(0, 1);
  const ci = selected.some(item => item.status === 'completed' && item.conclusion !== 'success') ? 'failed' as const
    : selected.length && selected.every(item => item.status === 'completed' && item.conclusion === 'success') ? 'passed' as const
    : 'pending' as const;
  return { ci, checks: selected, attempts };
}

export async function inspectCommitChecks(repository: string, sha: string) {
  const raw = await command('gh', ['api', 'repos/' + repository + '/commits/' + commitSha.parse(sha)
    + '/check-runs?check_name=collab-pilot&filter=all&per_page=100', '--paginate', '--slurp']);
  const attempts = z.array(z.object({ check_runs: z.array(check) })).parse(JSON.parse(raw)).flatMap(page => page.check_runs);
  return pullChecks(sha, attempts);
}

export async function inspectIssue(repository: string, number: number) {
  const value = issue.parse(JSON.parse(await command('gh', ['api', 'repos/' + repository + '/issues/' + number])));
  if (value.number !== number || value.pull_request) return;
  return value;
}

export async function inspectBranch(repository: string, url: string): Promise<GitHubBranch> {
  const address = new URL(url);
  const prefix = '/' + repository.toLowerCase() + '/tree/';
  if (address.hostname !== 'github.com' || !address.pathname.toLowerCase().startsWith(prefix)) throw new Error('分支链接无效');
  const name = decodeURIComponent(address.pathname.slice(prefix.length));
  const [source, branch, pushes] = await Promise.all([
    command('gh', ['api', 'repos/' + repository]).then(value => repo.parse(JSON.parse(value))),
    githubApi(repository, 'branches/' + encodeURIComponent(name)).then(value => z.object({ name: z.string(), commit: z.object({ sha: commitSha }) }).parse(value)),
    githubApi(repository, 'activity?ref=' + encodeURIComponent(name) + '&per_page=100').then(value => z.array(activity).parse(value)).catch(() => []),
  ]);
  if (source.full_name.toLowerCase() !== repository.toLowerCase() || branch.name !== name) throw new Error('分支地址与 GitHub 记录不匹配');
  return { repository, repoId: source.id, name, sha: branch.commit.sha,
    push: pushes.find(row => row.ref === 'refs/heads/' + name && row.after === branch.commit.sha) };
}

export async function inspectPull(repository: string, url: string) {
  const number = parsePr(url, repository);
  const live = pull.parse(await githubApi(repository, 'pulls/' + number));
  if (live.base.repo?.full_name.toLowerCase() !== repository.toLowerCase() || live.number !== number) throw new Error('PR 仓库已变化');
  const reviewPages = command('gh', ['api', 'repos/' + repository + '/pulls/' + number + '/reviews?per_page=100', '--paginate', '--slurp']);
  const [{ attempts, ...shaChecks }, listed, reviews, pushes] = await Promise.all([
    inspectCommitChecks(repository, live.head.sha),
    command('gh', ['api', 'repos/' + repository + '/pulls/' + number + '/commits?per_page=100', '--paginate', '--slurp']),
    reviewPages,
    live.head.repo?.id === live.base.repo.id
      ? githubApi(repository, 'activity?ref=' + encodeURIComponent(live.head.ref) + '&per_page=100').then(value => z.array(activity).parse(value)).catch(() => [])
      : Promise.resolve([] as GitHubPush[]),
  ]);
  const after = pull.parse(await githubApi(repository, 'pulls/' + number));
  if (JSON.stringify(after) !== JSON.stringify(live)) throw new Error('PR 正在更新，请刷新后再关联。');
  const observed = z.array(commits).parse(JSON.parse(listed)).flat();
  if (!observed.some(commit => commit.sha === live.head.sha)) throw new Error('未核对到 PR 的当前提交。');
  const snapshot = {
    repository, repoId: live.base.repo.id, url: live.html_url, pr: number, baseSha: live.base.sha, headSha: live.head.sha, ...shaChecks,
    baseBranch: live.base.ref, headBranch: live.head.ref, headRepoId: live.head.repo?.id,
    state: live.merged ? 'merged' as const : live.draft && live.state === 'open' ? 'draft' as const : live.state,
    creator: live.user, createdAt: live.created_at, updatedAt: live.updated_at,
    mergedBy: live.merged_by, mergedAt: live.merged_at,
    assignees: live.assignees, labels: live.labels, requestedReviewers: live.requested_reviewers, milestone: live.milestone,
    reviews: z.array(z.array(review)).parse(JSON.parse(reviews)).flat(),
  };
  return { snapshot, attempts, commits: observed, pushes, body: live.body ?? '' };
}

export function referencesTicket(body: string, ticket: string) {
  return body.split(/\r?\n/).some(line => line.trim() === 'SuitMe-Work: ' + ticket);
}
