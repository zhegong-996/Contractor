import assert from 'node:assert/strict';
import test from 'node:test';
import { FeishuSources } from '../src/feishu-sources.ts';
import { FigmaSources } from '../src/workbench/figma-source.ts';
import { knowledgeSource, readKnowledgeSource } from '../src/workbench/knowledge-sources.ts';
import { resourceSchema } from '../src/workbench/project-resources.ts';

const resource = resourceSchema.parse({
  source: 'figma', externalId: 'BranchKey/1:2', state: 'bound',
  url: 'https://www.figma.com/design/FileKey/branch/BranchKey/test?node-id=1-2',
  knowledge: { format: 'figma-node', credential: 'STORE', owner: 'design', conditions: '门店推荐理由', preview: true },
});

test('仅导入已配置 Figma 节点，可见文本按原型版本留痕', async () => {
  const connection = knowledgeSource('store', resource)!;
  assert.equal(connection.visibility, 'restricted');
  assert.equal(knowledgeSource('store', { ...resource, externalId: 'DifferentFile/1:2' }), undefined);
  assert.equal(knowledgeSource('store', resource, 'other-node'), undefined);
  let version = '100';
  const reader = new FigmaSources(async (address, options) => {
    const url = new URL(String(address));
    assert.equal(url.origin, 'https://api.figma.com');
    assert.equal(url.pathname, '/v1/files/BranchKey/nodes');
    assert.equal(url.searchParams.get('ids'), '1:2');
    assert.equal(new Headers(options?.headers).get('x-figma-token'), 'test-token');
    assert.equal(options?.redirect, 'error');
    return Response.json({ version, nodes: {
      '1:2': { document: { id: '1:2', name: '门店反馈', type: 'FRAME', children: [
        { id: '1:3', name: '正文', type: 'TEXT', characters: '适合通勤' },
        { id: '1:4', name: '临时备忘', visible: false, type: 'TEXT', characters: '不可见正文' },
      ] } },
      '1:5': { document: { id: '1:5', name: '其它节点', type: 'TEXT', characters: '范围外正文' } },
    } });
  }, name => name === 'STORE' ? 'test-token' : undefined);
  const feishu = new FeishuSources(async () => assert.fail('不是飞书来源'));
  const first = await readKnowledgeSource(connection, feishu, undefined, reader);
  assert.equal(first.body, '门店反馈\n适合通勤');
  assert.equal(first.source.url, 'https://www.figma.com/design/FileKey/branch/BranchKey/test?node-id=1-2&version-id=100');
  version = '101';
  const next = await readKnowledgeSource(connection, feishu, undefined, reader);
  assert.notEqual(next.source.fingerprint, first.source.fingerprint);
  assert.equal(next.source.authority, first.source.authority);
  const pinned = knowledgeSource('store', { ...resource, url: resource.url! + '&version-id=100' })!;
  await assert.rejects(readKnowledgeSource(pinned, feishu, undefined, reader), /节点或版本/);
});

test('Figma PNG 只取指定版本及节点，图片下载不携带读取凭据', async () => {
  let target = 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/test';
  let downloads = 0;
  const reader = new FigmaSources(async (address, options) => {
    const url = new URL(String(address));
    if (url.hostname === 'api.figma.com') {
      assert.equal(url.pathname, '/v1/images/BranchKey');
      assert.deepEqual(Object.fromEntries(url.searchParams), { ids: '1:2', format: 'png', scale: '1', version: '101' });
      return Response.json({ images: { '1:2': target }, err: null });
    }
    assert.equal(new Headers(options?.headers).get('x-figma-token'), null);
    assert.equal(options?.redirect, 'error');
    downloads++;
    return new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
  }, () => 'test-token');
  const scope = { file: 'BranchKey', node: '1:2', version: '101', credential: 'STORE', preview: true };
  assert.equal((await reader.preview(scope)).byteLength, 9);
  target = 'https://other.example/image';
  await assert.rejects(reader.preview(scope), /地址不可用/);
  await assert.rejects(reader.preview({ ...scope, preview: false }), /未开启/);
  assert.equal(downloads, 1);
});
