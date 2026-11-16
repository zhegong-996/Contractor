import type { GetFileMetaResponse, GetFileNodesResponse, GetImagesResponse } from '@figma/rest-api-spec';
import { z } from 'zod';
import { digest } from './knowledge.ts';

export type FigmaNodeScope = {
  file: string;
  node: string;
  version?: string;
  url?: string;
  credential: string;
  preview: boolean;
};

const versionId = z.string().regex(/^[A-Za-z0-9-]{1,120}$/);
const fileMetadata = z.object({
  file: z.object({ version: versionId, role: z.enum(['viewer', 'editor', 'owner']) }),
}) satisfies z.ZodType<{ file: Required<Pick<GetFileMetaResponse['file'], 'version' | 'role'>> }>;

export class FigmaAccessUnavailable extends Error {}
const nodeResult = z.object({
  version: versionId, nodes: z.record(z.string(), z.object({ document: z.unknown() }).nullable()),
}) satisfies z.ZodType<Pick<GetFileNodesResponse, 'version'> & { nodes: Record<string, { document: unknown } | null> }>;
const imageResult = z.object({
  err: z.null(), images: z.record(z.string(), z.string().nullable()),
}) satisfies z.ZodType<GetImagesResponse>;
const layer = z.object({
  id: z.string(),
  name: z.string().trim().max(1000),
  type: z.string(),
  visible: z.boolean().optional(),
  characters: z.string().optional(),
  children: z.array(z.unknown()).optional(),
});
const previewHosts = new Set(['figma-alpha-api.s3.us-west-2.amazonaws.com', 's3-alpha.figma.com']);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function boundedResponse(response: Response, limit: number) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('Figma 返回不可用或内容过大');
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > limit) throw new Error('Figma 内容过大');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
}

export class FigmaSources {
  constructor(private readonly request = fetch, private readonly credential = (name: string) => process.env['SUITME_FIGMA_' + name]) {}

  credentialVersion(scope: FigmaNodeScope) {
    const value = this.credential(scope.credential);
    return value?.trim() && !/[\r\n]/.test(value) ? digest(value) : undefined;
  }

  private async read(scope: FigmaNodeScope, path: string, query: Record<string, string>) {
    const token = this.credential(scope.credential);
    if (!token?.trim() || /[\r\n]/.test(token)) throw new FigmaAccessUnavailable('未配置 Figma 读取连接');
    const url = new URL('https://api.figma.com/v1/' + path);
    url.search = new URLSearchParams({ ...query, ...(scope.version && { version: scope.version }) }).toString();
    const response = await this.request(url, {
      headers: { 'X-Figma-Token': token }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if ([401, 403, 404].includes(response.status)) {
      await response.body?.cancel();
      throw new FigmaAccessUnavailable('Figma 连接当前无法访问指定来源');
    }
    return JSON.parse((await boundedResponse(response, 4 * 1024 * 1024)).toString('utf8')) as unknown;
  }

  async metadata(scope: FigmaNodeScope) {
    return fileMetadata.parse(await this.read({ ...scope, version: undefined },
      'files/' + encodeURIComponent(scope.file) + '/meta', {})).file;
  }

  async node(scope: FigmaNodeScope) {
    const result = nodeResult.parse(await this.read(scope, 'files/' + encodeURIComponent(scope.file) + '/nodes', { ids: scope.node }));
    const node = result.nodes[scope.node];
    if (!node) throw new FigmaAccessUnavailable('Figma 不再返回该节点');
    const root = layer.parse(node.document);
    if (root.id !== scope.node || root.visible === false) throw new FigmaAccessUnavailable('Figma 节点已删除或不可见');
    if (scope.version && result.version !== scope.version)
      throw new Error('Figma 节点或版本已变化');
    const items: string[] = [];
    const pending: { raw: unknown; depth: number }[] = [{ raw: root, depth: 0 }];
    let length = 0;
    let count = 0;
    while (pending.length) {
      const { raw, depth } = pending.pop()!;
      if (++count > 2000 || depth > 50) throw new Error('Figma 节点范围过大，请缩小接入范围');
      const item = layer.parse(raw);
      if (item.visible === false) continue;
      const content = (item.type === 'TEXT' && item.characters?.trim()) || (depth === 0 ? item.name : '');
      if (content) {
        length += content.length + 1;
        if (length > 12000) throw new Error('Figma 正文超过长度限制');
        items.push(content);
      }
      for (const child of [...item.children ?? []].reverse()) pending.push({ raw: child, depth: depth + 1 });
    }
    const body = items.join('\n');
    const url = new URL(scope.url ?? 'https://www.figma.com/design/' + scope.file);
    url.searchParams.set('node-id', scope.node.replace(':', '-'));
    url.searchParams.set('version-id', result.version);
    return { body, revision: result.version, url: url.href, fingerprint: digest({ scope: [scope.file, scope.node], revision: result.version, body }) };
  }

  async preview(scope: FigmaNodeScope & { version: string }) {
    if (!scope.preview) throw new Error('此来源尚未开启 PNG 预览');
    const { images } = imageResult.parse(await this.read(scope, 'images/' + encodeURIComponent(scope.file),
      { ids: scope.node, format: 'png', scale: '1' }));
    const address = images[scope.node];
    if (!address) throw new Error('Figma 未返回指定节点的预览');
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !previewHosts.has(url.hostname))
      throw new Error('Figma 预览地址不可用');
    const response = await this.request(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    const bytes = await boundedResponse(response, 5 * 1024 * 1024);
    if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) throw new Error('Figma 预览格式无效');
    return bytes;
  }
}
