import { z } from 'zod';
import { key, type Trigger } from '../../upstream/superagent/src/core/index.ts';
import { command } from '../commands.ts';
import { githubAddress, githubCommentTrigger, githubIssueTrigger, githubPullTrigger } from '../upstream.ts';
import type { ChannelRef, PlatformActor } from './channel-links.ts';

const repositoryName = /^(?:[\w.-]+)\/[\w.-]+$/;
const sender = z.object({ id: z.number().int().positive(), login: z.string(), type: z.literal('User') });
const messageSchema = z.object({
  id: z.number().int().positive(), user: sender.nullable().catch(null), body: z.string().nullish(),
  html_url: z.string(), created_at: z.iso.datetime(), updated_at: z.iso.datetime(),
  number: z.number().int().positive().optional(), title: z.string().optional(),
  issue_url: z.string().optional(), pull_request_url: z.string().optional(), pull_request: z.unknown().optional(),
  in_reply_to_id: z.number().int().positive().nullish(), commit_id: z.string().regex(/^[a-f0-9]{40}$/).nullish(),
  performed_via_github_app: z.unknown().optional(),
  state: z.enum(['open','closed']).optional(), state_reason: z.string().nullish(),
});

type Repository = { id: string; name: string };
const repositorySchema = z.object({ id: z.number().int().positive(), full_name: z.string().regex(repositoryName) });
export type GitHubInput = { repository: Repository; trigger: Trigger; sender: PlatformActor; origin: ChannelRef; text: string;
  note?: boolean; evidence?: 'issue' | 'pull' };
const pullRevision = z.object({
  id: z.number().int().positive(), number: z.number().int().positive(),
  html_url: z.string(), updated_at: z.iso.datetime(),
});

function reference(repository: Repository, number: number, pr: boolean, url?: string): ChannelRef {
  return {
    key: 'github:' + repository.id + ':' + number,
    label: repository.name + ' #' + number,
    url: url ?? 'https://github.com/' + repository.name + (pr ? '/pull/' : '/issues/') + number,
  };
}
function evidenceInput(repository: Repository, origin: ChannelRef, item: { id: number; updated_at: string }, kind: 'issue' | 'pull'): GitHubInput {
  const trigger: Trigger = { id: key('github-evidence', kind, repository.id, String(item.id), item.updated_at), source: 'github',
    threads: [{ source: 'github', id: origin.key.slice('github:'.length) }], actor: { source: 'github', id: '' },
    human: false, text: '', at: item.updated_at, meta: {} };
  return { repository, trigger, origin, text: '', evidence: kind,
    sender: { provider: 'github', namespace: 'github.com', id: '', label: '' } };
}

export function githubInputs(repository: Repository, raw: unknown, comments: boolean, since: string) {
  return z.array(z.unknown()).parse(raw).flatMap<GitHubInput>(value => {
    const parsed = messageSchema.safeParse(value);
    if (!parsed.success) return [];
    const item = parsed.data;
    const targetUrl = item.pull_request_url ?? item.issue_url ?? item.html_url;
    const target = githubAddress(targetUrl, repository.name);
    if (!target || (comments ? !!item.number : item.number !== target.number)) return [];

    const text = (item.body ?? '').trim();
    const pr = target.pr || !!item.pull_request || /\/pull\//.test(item.html_url);
    const origin = reference(repository, target.number, pr);
    const evidence = !comments && !pr && item.state && Date.parse(item.updated_at) >= Date.parse(since)
      ? [evidenceInput(repository, origin, item, 'issue')] : [];
    // A pull request edit cannot speak as its recorded creator. Plain notes require a verified original author too.
    if (!item.user || item.performed_via_github_app || item.created_at !== item.updated_at
      || Date.parse(item.created_at) < Date.parse(since)) return evidence;
    const command = /^\/(协作|绑定协作)\s/.test(text);
    if (!command && (!comments || !text || text.length > 3500 || text.startsWith('/'))) return evidence;
    const message = { ...item, body: text, user: item.user };
    const native = comments
      ? githubCommentTrigger(message, { number: target.number, isPr: pr }, item.pull_request_url ? 'inline' : 'conversation', '')
      : (pr ? githubPullTrigger : githubIssueTrigger)({ ...message, number: target.number, title: item.title ?? '' }, '');
    if (!native.human) return evidence;
    const kind = item.pull_request_url ? 'inline' : comments ? 'comment' : 'issue';
    const trigger = { ...native, id: key('github-workbench', repository.id, String(item.id), kind),
      text, threads: [{ source: 'github', id: origin.key.slice('github:'.length) }], addressed: 'direct' as const,
      meta: { ...native.meta, repository: repository.name, repositoryId: repository.id, platformLogin: item.user.login,
        githubComment: comments ? { kind, thread: item.in_reply_to_id ?? item.id, commit: item.commit_id ?? undefined } : undefined },
    };
    return [...evidence, { repository, trigger, origin, text, ...(!command ? { note: true } : {}),
      sender: { provider: 'github' as const, namespace: 'github.com', id: String(item.user.id), label: item.user.login } }];
  });
}

export function githubPullChange(repository: Repository, value: unknown, since: string): GitHubInput | undefined {
  const item = pullRevision.parse(value);
  if (Date.parse(item.updated_at) < Date.parse(since)) return;
  const origin = reference(repository, item.number, true);
  return evidenceInput(repository, origin, item, 'pull');
}

async function githubRepository(name: string) {
  if (!repositoryName.test(name)) throw new Error('仓库配置无效。');
  const info = repositorySchema.parse(JSON.parse(await command('gh', ['api', 'repos/' + name, '--jq', '{id,full_name}'])));
  if (info.full_name.toLowerCase() !== name.toLowerCase()) throw new Error('仓库名称已变化，请重新核对项目来源。');
  return { id: String(info.id), name };
}

export function watchGithub(options: {
  repositories: () => string[];
  tracksPull: (origin: ChannelRef) => boolean;
  consume: (input: GitHubInput) => Promise<void>;
  refresh?: (repository: Repository, refreshed: ReadonlySet<string>) => Promise<void>;
  interval: number;
  checkpoint: (repository: string, cursor?: string) => { start: string; at: string } | undefined;
  log: (message: string) => void;
}) {
  const repositoryIds = new Map<string, Repository>();
  let closed = false;
  let running: Promise<void> | undefined;
  async function poll() {
    for (const name of new Set(options.repositories())) {
      if (closed) return;
      if (!repositoryName.test(name)) continue;
      try {
        let repository = repositoryIds.get(name);
        if (!repository) {
          repository = await githubRepository(name);
          repositoryIds.set(name, repository);
        }
        const now = new Date().toISOString();
        const previous = options.checkpoint(repository.id);
        if (!previous) { options.checkpoint(repository.id, now); continue; }
        // Overlap each read window. The input ledger deduplicates authored commands by repository and object.
        const since = new Date(Math.max(Date.parse(previous.start), Date.parse(previous.at) - 120_000)).toISOString();
        const paths = [
          'issues?state=all&sort=updated&direction=asc',
          'issues/comments?sort=updated&direction=asc',
          'pulls/comments?sort=updated&direction=asc',
        ];
        const batches = await Promise.all(paths.map(url => command('gh', ['api',
          'repos/' + name + '/' + url + '&per_page=100&since=' + encodeURIComponent(since), '--paginate', '--slurp'])));
        for (const [index, raw] of batches.entries())
          for (const batch of z.array(z.unknown()).parse(JSON.parse(raw)))
            for (const input of githubInputs(repository, batch, index > 0, since)) {
              if (closed) return;
              await options.consume(input);
            }
        // PR list has no reliable "since" filter. Walk newest changes only until the cursor window ends.
        const refreshed = new Set<string>();
        for (let page = 1; !closed; page++) {
          const raw = await command('gh', ['api', 'repos/' + name + '/pulls?state=all&sort=updated&direction=desc&per_page=50&page=' + page]);
          const items = z.array(z.unknown()).parse(JSON.parse(raw));
          const changes = items.flatMap(item => githubPullChange(repository!, item, since) ?? []);
          for (const change of changes) {
            if (options.tracksPull(change.origin)) {
              await options.consume(change);
              refreshed.add(change.origin.key);
            }
          }
          if (items.length < 50 || changes.length < items.length) break;
        }
        await options.refresh?.(repository, refreshed);
        options.checkpoint(repository.id, now);
      } catch {
        options.log('GitHub 协作入口读取失败，稍后重试（' + name + '）。');
      }
    }
  }
  const tick = () => {
    if (!running && !closed) running = poll().finally(() => { running = undefined; });
  };
  tick();
  const timer = setInterval(tick, options.interval * 1000);
  return async () => { closed = true; clearInterval(timer); await running; };
}

export async function githubReference(text: string, repositories: string[]) {
  if (!/^https:\/\/github\.com\//i.test(text)) return;
  for (const name of repositories) {
    const target = githubAddress(text, name);
    if (!target) continue;
    const repository = await githubRepository(name);
    const parsed = z.object({ number: z.number().int().positive(), pull_request: z.object({}).optional() })
      .parse(JSON.parse(await command('gh', ['api', 'repos/' + repository.name + '/issues/' + target.number])));
    if (parsed.number === target.number && !!parsed.pull_request === target.pr)
      return reference(repository, target.number, target.pr);
  }
}
