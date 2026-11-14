import { z } from 'zod';
import { key, type Trigger } from '../../upstream/superagent/src/core/index.ts';
import { command } from '../commands.ts';
import { githubAddress, githubCommentTrigger, githubIssueTrigger, githubPullTrigger } from '../upstream.ts';
import type { ChannelRef, PlatformActor } from './channel-links.ts';

const repositoryName = /^(?:[\w.-]+)\/[\w.-]+$/;
const sender = z.object({ id: z.number().int().positive(), login: z.string(), type: z.literal('User') });
const messages = z.array(z.object({
  id: z.number().int().positive(), user: sender.nullable().catch(null), body: z.string().nullish(),
  html_url: z.string(), created_at: z.iso.datetime(), updated_at: z.iso.datetime(),
  number: z.number().int().positive().optional(), title: z.string().optional(),
  issue_url: z.string().optional(), pull_request_url: z.string().optional(), pull_request: z.unknown().optional(),
  performed_via_github_app: z.unknown().optional(),
}));

type Repository = { id: string; name: string };
const repositorySchema = z.object({ id: z.number().int().positive(), full_name: z.string().regex(repositoryName) });
export type GitHubInput = { repository: Repository; trigger: Trigger; sender: PlatformActor; origin: ChannelRef; text: string };

function reference(repository: Repository, number: number, pr: boolean, url?: string): ChannelRef {
  return {
    key: 'github:' + repository.id + ':' + number,
    label: repository.name + ' #' + number,
    url: url ?? 'https://github.com/' + repository.name + (pr ? '/pull/' : '/issues/') + number,
  };
}

function inputs(repository: Repository, raw: string, comments: boolean, since: string) {
  return messages.parse(JSON.parse(raw)).flatMap(item => {
    // The REST record names the original author, even when someone else edited it.
    if (!item.user || item.performed_via_github_app || item.created_at !== item.updated_at
      || Date.parse(item.created_at) < Date.parse(since)) return [];
    const targetUrl = item.pull_request_url ?? item.issue_url ?? item.html_url;
    const target = githubAddress(targetUrl, repository.name);
    if (!target || (comments ? !!item.number : item.number !== target.number)) return [];

    const text = (item.body ?? '').trim();
    if (!/^\/(协作|绑定协作)\s/.test(text)) return [];
    const pr = target.pr || !!item.pull_request || /\/pull\//.test(item.html_url);
    const message = { ...item, body: text, user: item.user };
    const native = comments
      ? githubCommentTrigger(message, { number: target.number, isPr: pr }, item.pull_request_url ? 'inline' : 'conversation', '')
      : (pr ? githubPullTrigger : githubIssueTrigger)({ ...message, number: target.number, title: item.title ?? '' }, '');
    if (!native.human) return [];
    const origin = reference(repository, target.number, pr);
    const trigger = { ...native, id: key('github-workbench', repository.id, String(item.id), comments ? 'comment' : 'issue'),
      text, threads: [{ source: 'github', id: origin.key.slice('github:'.length) }], addressed: 'direct' as const,
      meta: { ...native.meta, repository: repository.name, repositoryId: repository.id, platformLogin: item.user.login },
    };
    return [{ repository, trigger, origin, text,
      sender: { provider: 'github' as const, namespace: 'github.com', id: String(item.user.id), label: item.user.login } }];
  });
}

async function githubRepository(name: string) {
  if (!repositoryName.test(name)) throw new Error('仓库配置无效。');
  const info = repositorySchema.parse(JSON.parse(await command('gh', ['api', 'repos/' + name, '--jq', '{id,full_name}'])));
  if (info.full_name.toLowerCase() !== name.toLowerCase()) throw new Error('仓库名称已变化，请重新核对项目来源。');
  return { id: String(info.id), name };
}

export function watchGithub(options: {
  repositories: () => string[];
  consume: (input: GitHubInput) => Promise<void>;
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
        ];
        const batches = await Promise.all(paths.map(url => command('gh', ['api',
          'repos/' + name + '/' + url + '&per_page=100&since=' + encodeURIComponent(since), '--paginate', '--slurp'])));
        for (const [index, raw] of batches.entries())
          for (const batch of z.array(z.unknown()).parse(JSON.parse(raw)))
            for (const input of inputs(repository, JSON.stringify(batch), index > 0, since)) {
              if (closed) return;
              await options.consume(input);
            }
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
