import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { z } from 'zod';
import { requiredCheckSchema } from './github-delivery.ts';
import { digest } from './knowledge.ts';

export const resourceSource = z.enum(['feishu', 'github', 'figma', 'feishu-doc', 'document']);
const purpose = z.enum(['discussion', 'reference', 'delivery']);
export const githubRepository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const gitPath = z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/).refine(value =>
  value.split('/').every((part, index, parts) => part === '' ? index === parts.length - 1 : !part.startsWith('.')));
const branchName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,79}$/);
export const markdownPath = gitPath.max(240).refine(value => /\.(?:md|markdown)$/i.test(value));
const sourceOwner = {
  owner: z.string().regex(/^[a-zA-Z0-9_-]{2,32}$/),
  visibility: z.enum(['project', 'restricted']).default('restricted'),
  conditions: z.string().trim().min(1).max(600),
};
const connectionId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const knowledge = z.discriminatedUnion('format', [
  z.object({ ...sourceOwner, format: z.literal('feishu-docx'), profile: connectionId,
    appId: connectionId, userOpenId: connectionId }).strict(),
  z.object({ ...sourceOwner, format: z.literal('github-markdown'), branch: branchName,
    files: z.array(markdownPath).min(1).max(12) }).strict(),
  z.object({ ...sourceOwner, format: z.literal('figma-node'),
    credential: z.string().regex(/^[A-Z][A-Z0-9_]{0,47}$/), preview: z.boolean().default(false),
  }).strict(),
]);
const https = z.url({ protocol: /^https$/ }).refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && ![...url.searchParams.keys()]
    .some(key => /token|password|secret|signature|credential|api[_-]?key/i.test(key));
}, '请使用不含访问凭据的 HTTPS 链接');
const metadata = {
  label: z.string().trim().min(1).max(100).optional(),
  revision: z.string().trim().min(1).max(120).optional(),
  url: https.optional(),
};

export const resourceSchema = z.object({
  source: resourceSource, externalId: z.string().trim().min(1).max(200),
  state: z.enum(['observe', 'bound']).default('observe'), purpose: purpose.optional(),
  contributors: z.array(z.string().regex(/^[a-zA-Z0-9_-]{2,32}$/)).optional(),
  execution: z.object({ base: branchName.default('main'), paths: z.array(gitPath).min(1).max(10),
    requiredChecks: z.array(requiredCheckSchema).min(1).max(30).refine(checks =>
      new Set(checks.map(check => check.name + '/' + check.app)).size === checks.length, 'CI 检查不能重复').optional() }).strict().optional(),
  topic: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/).optional(),
  route: z.boolean().optional(),
  shareNotes: z.boolean().optional(),
  digest: z.boolean().optional(),
  knowledge: knowledge.optional(),
  ...metadata,
}).strict();
export type ProjectResource = z.infer<typeof resourceSchema>;
export const referenceSchema = z.object({
  source: z.enum(['figma', 'feishu-doc', 'document']),
  label: metadata.label.unwrap(), revision: metadata.revision, url: https,
}).strict();
export type ReferenceInput = z.infer<typeof referenceSchema>;
const topicId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const topicInputSchema = z.object({ id: topicId,
  title: z.string().trim().min(1).max(100), parent: topicId.optional() }).strict();
export type ProjectTopic = z.infer<typeof topicInputSchema>;

export const resourcePurpose = (ref: ProjectResource) => ref.purpose
  ?? (ref.source === 'github' ? 'delivery' : ref.source === 'feishu' ? 'discussion' : 'reference');
export const canonicalResourceId = (source: ProjectResource['source'], value: string) => source === 'github' ? value.toLowerCase() : value;
export const routesEvents = (ref: ProjectResource) => ref.route !== false
  && resourcePurpose(ref) !== 'reference' && ['feishu', 'github'].includes(ref.source);

export function referenceResource(input: ReferenceInput): ProjectResource | undefined {
  const { source, revision, label } = input;
  const url = new URL(input.url);
  const ref = { source, label, revision, purpose: 'reference' as const, state: 'bound' as const };
  if (source === 'figma') {
    const file = /^\/(?:design|file|proto)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?(?:\/|$)/.exec(url.pathname);
    const node = url.searchParams.get('node-id')?.replace(/-/g, ':');
    if (!['figma.com', 'www.figma.com'].includes(url.hostname) || !file || (node && !/^\d+:\d+$/.test(node))) return;
    const version = url.searchParams.get('version-id');
    if (version && !/^[a-zA-Z0-9-]{1,120}$/.test(version)) return;
    return { ...ref, externalId: [file[2] ?? file[1], node].filter(Boolean).join('/'),
      revision: version ?? revision, url: url.href };
  }
  if (source === 'feishu-doc') {
    const doc = /^\/(docx|wiki)\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
    if (!/^(?:[a-z0-9-]+\.)*(?:feishu\.cn|larksuite\.com|doubao\.com)$/.test(url.hostname)
      || !doc || (url.hash && !/^#[a-zA-Z0-9_-]{1,100}$/.test(url.hash))) return;
    return { ...ref, externalId: url.hostname + '/' + doc[1] + '/' + doc[2] + url.hash, url: url.href };
  }
  // External document systems can participate with a link, while keeping their own access control.
  return { ...ref, externalId: digest(url.href), url: url.href };
}

export function resourceView(project: string, ref: ProjectResource) {
  const id = canonicalResourceId(ref.source, ref.externalId);
  return {
    ref: stringifyEntityRef({ kind: 'Resource', namespace: project, name: ref.source + '-' + digest(id).slice(0, 20) }),
    source: ref.source, externalId: ref.externalId, label: ref.label ?? ref.externalId,
    purpose: resourcePurpose(ref), state: ref.state, url: ref.url, revision: ref.revision,
  };
}
export type ResourceView = ReturnType<typeof resourceView>;

export function feishuDocLocation(ref: ProjectResource) {
  if (ref.source !== 'feishu-doc' || !ref.url) return;
  const canonical = referenceResource({ source: 'feishu-doc', label: ref.label ?? '飞书文档', url: ref.url });
  const url = new URL(ref.url);
  const token = /^\/docx\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname)?.[1];
  if (!canonical || canonical.externalId !== ref.externalId || !url.hostname.endsWith('.feishu.cn')
    || !token || url.hash.startsWith('#share-')) return;
  return { token, block: url.hash.slice(1) || undefined, url: url.origin + url.pathname + url.hash };
}

export function figmaNodeLocation(ref: ProjectResource) {
  if (ref.source !== 'figma' || !ref.url) return;
  const canonical = referenceResource({ source: 'figma', label: ref.label ?? 'Figma', url: ref.url });
  if (!canonical || canonical.externalId !== ref.externalId) return;
  const [file, node] = canonical.externalId.split('/');
  if (!file || !node) return;
  const url = new URL(ref.url);
  return { file, node, version: url.searchParams.get('version-id') || undefined, url: url.origin + url.pathname };
}

export function projectResourceRef(project: string, value: string) {
  try {
    const parsed = parseEntityRef(value);
    return parsed.kind === 'resource' && parsed.namespace === project && stringifyEntityRef(parsed) === value;
  } catch { return false; }
}
