import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { FeishuSources } from '../src/feishu-sources.ts';
import { FigmaSources } from '../src/workbench/figma-source.ts';
import { FigmaAccess } from '../src/workbench/figma-access.ts';
import { knowledgeSource, readKnowledgeSource } from '../src/workbench/knowledge-sources.ts';
import { resourceSchema, resourceView } from '../src/workbench/project-resources.ts';

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

test('Figma 新版只生成候选，源站拒绝后隐藏正文、派生知识及运行快照，重授权另起代次', { timeout: 25000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'suitme-figma-access-'));
  await mkdir(path.join(dir, 'console'));
  process.env.COLLAB_STATE_DIR = dir;
  process.env.SUITME_FIGMA_STORE = 'isolated-test-only';
  const fixture = path.join(dir, 'agent.mjs');
  await writeFile(fixture, 'console.log("核对完成，推荐理由先说场景。");');
  let version = '100';
  let forbidden = false;
  let nodeRequests = 0;
  t.mock.method(globalThis, 'fetch', async (address: URL) => {
    assert.equal(address.origin, 'https://api.figma.com');
    if (forbidden) return Response.json({ err: 'forbidden' }, { status: 403 });
    if (address.pathname.endsWith('/meta')) return Response.json({ file: { version, role: 'viewer' } });
    assert.ok(address.pathname.endsWith('/nodes'));
    nodeRequests++;
    return Response.json({ version, nodes: { '1:2': { document: {
      id: '1:2', type: 'TEXT', name: '推荐理由', characters: '试点口径-' + version,
    } } } });
  });
  const [{ openCollaboration }, { settingsSchema }, { ConsoleAuth }] = await Promise.all([
    import('../src/workbench/collaboration.ts'), import('../src/workbench/config.ts'), import('../src/console-auth.ts'),
  ]);
  const auth = new ConsoleAuth();
  await auth.ready();
  await auth.bootstrapOwner('design', 'fixture-password-only');
  for (const member of ['product', 'engineering']) await auth.createAccount(member, 'fixture-password-only', 'operator', 'design');
  const config = settingsSchema.parse({
    projects: [{ id: 'store', title: '门店推荐理由', members: ['design', 'product', 'engineering'], maintainers: ['product'], resources: [resource] }],
    functions: [{ id: 'review', title: '核对' }],
    agents: [{ id: 'reviewer', title: '核对 Agent', projects: ['store'], owner: 'engineering', kind: 'specialist', function: 'review',
      skill: '核对推荐理由', capability: '按已授权口径核对', engine: 'command', command: [process.execPath, fixture],
      execution: { kind: 'test', provider: 'fixture' }, model: 'fixture', active: true }],
  });
  const work = await openCollaboration(config, auth);
  t.after(async () => {
    await work.close();
    await rm(dir, { recursive: true, force: true });
    delete process.env.SUITME_FIGMA_STORE;
  });
  const status = () => work.figmaSourceStatus('design', 'store')[0]!;
  const ref = resourceView('store', resource).ref;
  const first = await work.importKnowledge('design', 'store', { resource: ref });
  await work.publish('design', first.id, first.revision);
  const input = work.start('product', { project: 'store', title: '核对推荐理由', request: '核对适用场景', agent: 'reviewer',
    material: [first.id], priority: 'normal', nonce: 'figma-source-test' });
  async function wait<T>(read: () => T | undefined | null) {
    for (let i = 0; i < 160; i++) {
      const item = read();
      if (item) return item;
      await delay(60);
    }
    assert.fail('等待核对工单超时');
  }
  const ticket = await wait(() => work.resolveStart('product', input.trigger));
  const grant = await wait(() => work.detail('design', ticket).requests.find(item => item.entry === first.id));
  work.changeAccess('design', ticket, grant.id, 'granted');
  const result = await wait(() => work.detail('product', ticket).result);
  await work.accept('product', ticket, result.revision, '仅门店试点', '已核对的门店推荐理由');
  const derivedId = work.detail('product', ticket).candidate!;
  const derived = work.browse('product', 'store', '', true).find(item => item.id === derivedId);
  assert.ok(derived && 'revision' in derived && derived.revision);
  await work.publish('product', derivedId, derived.revision);

  version = '101';
  await work.refreshFigma();
  const next = status().candidate!;
  assert.notEqual(next, first.id);
  assert.ok(work.browse('design', 'store', '试点口径-100').some(item => item.id === first.id));
  assert.ok(!work.browse('design', 'store', '试点口径-101').some(item => item.id === next));
  const before = nodeRequests;
  await work.refreshFigma();
  assert.equal(nodeRequests, before, '相同 Figma 版本不重复抓取节点');
  const candidate = work.browse('design', 'store', '', true).find(item => item.id === next);
  assert.ok(candidate && 'revision' in candidate && candidate.revision);
  await work.publish('design', next, candidate.revision);
  assert.equal(work.executionSnapshot('product', ticket, result.run).readable, true);

  forbidden = true;
  await work.refreshFigma();
  assert.equal(status().state, 'unavailable');
  assert.equal(work.executionSnapshot('product', ticket, result.run).readable, false);
  assert.ok(!work.projectKnowledgeGraph('product', 'store').nodes.some(node => node.revision === derived.revision));
  assert.ok(!JSON.stringify(work.browse('design', 'store', '', true)).includes('试点口径-'));
  assert.ok(!JSON.stringify(work.browse('product', 'store', '', true)).includes('已核对的门店推荐理由'));
  const restartedDb = new DatabaseSync(path.join(dir, 'orchestrator.sqlite'));
  try {
    const authority = knowledgeSource('store', resource)!.authority;
    const restarted = new FigmaAccess(restartedDb);
    assert.ok(restarted.get(authority).denied);
    assert.notEqual(restarted.authority(authority), authority);
  } finally { restartedDb.close(); }

  forbidden = false;
  await work.refreshFigma();
  assert.equal(status().state, 'verified');
  assert.notEqual(status().candidate, next, '恢复读取后重新生成候选');
  assert.equal(work.executionSnapshot('product', ticket, result.run).readable, false, '原代次的派生资料不恢复');
});
