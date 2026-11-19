import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FeishuSources, sensitiveFeishuText } from '../feishu-sources.ts';
import { githubApi } from '../github.ts';
import { digest, type SourceVersion } from './knowledge.ts';
import { canonicalResourceId, feishuDocLocation, figmaNodeLocation, resourceView, type ProjectResource } from './project-resources.ts';
import { FigmaSources } from './figma-source.ts';

const maxChars = 12_000;
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const gitBranch = z.object({ commit: z.object({ sha, commit: z.object({ tree: z.object({ sha }) }) }) });
const gitTree = z.object({ sha, truncated: z.literal(false), tree: z.array(z.object({
  path: z.string(), type: z.string(), mode: z.string(), sha, size: z.number().int().nonnegative().optional(),
})) });
const gitBlob = z.object({
  sha, size: z.number().int().nonnegative().max(4 * maxChars), encoding: z.literal('base64'), content: z.string(),
});

/** Restrict a connection to the configured document/branch and exact paths before touching the upstream account. */
export function knowledgeSource(project: string, ref: ProjectResource, file?: string) {
  const settings = ref.knowledge;
  if (ref.state !== 'bound' || !settings) return;
  const resource = resourceView(project, ref).ref;
  const { owner, visibility, conditions } = settings;
  const scope = { owner, visibility };
  if (settings.format === 'feishu-docx') {
    const location = !file && feishuDocLocation(ref);
    if (!location) return;
    const { profile, appId, userOpenId } = settings;
    const reference = { provider: 'feishu' as const, kind: 'docx' as const, profile, appId, userOpenId,
      ...location, title: ref.label ?? '飞书项目资料', messageIds: [] };
    return { resource, path: undefined, owner, visibility, conditions, title: reference.title,
      authority: digest({ scope, resource, profile, appId, userOpenId, location }), reference };
  }
  if (settings.format === 'figma-node') {
    const location = !file && figmaNodeLocation(ref);
    if (!location) return;
    const figma = { ...location, credential: settings.credential, preview: settings.preview };
    return { resource, path: undefined, owner, visibility, conditions, title: ref.label ?? 'Figma 原型',
      authority: digest({ scope, resource, file: location.file, node: location.node,
        version: location.version, credential: settings.credential }), figma };
  }
  if (ref.source !== 'github' || !file || !settings.files.includes(file)) return;
  const repository = canonicalResourceId('github', ref.externalId);
  const { branch } = settings;
  return { resource, path: file, owner, visibility, conditions, title: file.split('/').at(-1)!,
    authority: digest({ scope, resource, repository, branch, file }), repository, branch };
}

type Connection = NonNullable<ReturnType<typeof knowledgeSource>>;

export async function readKnowledgeSource(connection: Connection, feishu: FeishuSources, github = githubApi, figma = new FigmaSources()) {
  let body: string;
  let url: string;
  let revision: string;
  let fingerprint: string;
  if (connection.reference) {
    const doc = await feishu.read(connection.reference);
    ({ body, url, revision } = doc);
    if (!/^\d+$/.test(revision)) throw new Error('飞书未返回有效的文档修订号');
    fingerprint = doc.hash;
  } else if (connection.figma) {
    ({ body, url, revision, fingerprint } = await figma.node(connection.figma));
  } else {
    const { repository, branch, path: file } = connection;
    const head = gitBranch.parse(await github(repository, 'branches/' + encodeURIComponent(branch))).commit;
    let treeSha = head.commit.tree.sha;
    const segments = file.split('/');
    for (const [index, segment] of segments.entries()) {
      const tree = gitTree.parse(await github(repository, 'git/trees/' + treeSha));
      const item = tree.tree.find(entry => entry.path === segment);
      if (tree.sha !== treeSha || !item) throw new Error('找不到已配置的 Markdown 文件');
      if (index < segments.length - 1) {
        if (item.type !== 'tree' || item.mode !== '040000') throw new Error('Markdown 路径经过非目录对象');
        treeSha = item.sha;
        continue;
      }
      if (item.type !== 'blob' || !['100644', '100755'].includes(item.mode) || !item.size || item.size > 4 * maxChars)
        throw new Error('只接入指定路径下的普通 Markdown 文件');
      treeSha = item.sha;
    }
    const blob = gitBlob.parse(await github(repository, 'git/blobs/' + treeSha));
    const bytes = Buffer.from(blob.content, 'base64');
    const actual = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    if (blob.sha !== treeSha || actual !== treeSha || bytes.length !== blob.size) throw new Error('GitHub 文件与提交不一致');
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    revision = head.sha;
    fingerprint = digest({ revision, blob: treeSha });
    url = 'https://github.com/' + repository + '/blob/' + revision + '/' + segments.map(encodeURIComponent).join('/');
  }
  if (typeof body !== 'string' || !body.trim() || body.length > maxChars || body.includes('\0') || sensitiveFeishuText.test(body))
    throw new Error('资料为空、超过正文长度限制或包含需要排除的信息');
  const source: SourceVersion = { resource: connection.resource, path: connection.path, authority: connection.authority, revision, fingerprint, url };
  return { body, source };
}

export function watchFigmaKnowledge(refresh: () => Promise<void>) {
  let closing = false;
  let active: Promise<void> | undefined;
  function sync() {
    if (closing || active) return;
    active = refresh().catch(error => {
      if (!closing) console.error('Figma 同步未完成：', (error as Error).name);
    }).finally(() => { active = undefined; });
  }
  const timer = setInterval(sync, 120_000);
  timer.unref();
  sync();
  return async () => {
    closing = true;
    clearInterval(timer);
    await active;
  };
}
